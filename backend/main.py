"""
PatentIQ backend — FastAPI service for the field-of-invention classifier.

Endpoints
---------
GET  /health            liveness check
GET  /stats              full dataset_stats.json (for the Registry screen)
GET  /metrics             model accuracy / f1 / per-class report
POST /predict             { "title": "..." } -> top-3 predicted fields + confidence
GET  /dataset/stats       statistics computed from the combined 751k-record dataset
GET  /patents/search      filter + paginate patent metadata (see dataset_api.py)
POST /similarity/search   title-overlap similar-patent search (see similarity_api.py)
GET  /similarity/status   similarity index state
GET  /similarity/filters  allowed filter values for similarity search
POST /report/generate     structured report for an invention title (see report.py)

Run locally
-----------
    pip install -r requirements.txt
    uvicorn main:app --reload --port 8000

Then point the frontend's predictField() at http://localhost:8000/predict
(see the commented-out fetch call in patentiq_app.jsx).
"""
import json
import os
import threading
from contextlib import asynccontextmanager
from pathlib import Path

import joblib
import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from analytics import router as analytics_router
from dataset_api import router as dataset_router, warm_up as warm_up_dataset
from report import router as report_router
from suggestions_api import router as suggestions_router
from similarity_api import router as similarity_router, warm_up as warm_up_similarity

MODEL_DIR = Path(__file__).parent / "model"

@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Load the 751k-record dataset in the background so startup and /predict
    # are never blocked; the dataset endpoints wait for it if hit early.
    threading.Thread(target=warm_up_dataset, daemon=True).start()
    # Build / load the similarity index in its own background thread. Set
    # PATENTIQ_SIMILARITY_AUTOSTART=0 to defer it to the first similarity request.
    if os.environ.get("PATENTIQ_SIMILARITY_AUTOSTART", "1") != "0":
        warm_up_similarity()
    yield


app = FastAPI(
    lifespan=lifespan,
    title="PatentIQ API",
    description="Field-of-invention classifier trained on India's published & granted patent registries.",
    version="1.0.0",
)

# Grant-rate / application-type / insight endpoints — additive, read-only,
# not called by the current frontend yet (see analytics.py).
app.include_router(analytics_router)

# Dataset statistics + patent metadata search over the combined dataset
# (additive, read-only; see dataset_api.py).
app.include_router(dataset_router)

# Title-based similar-patent search (additive; see similarity_api.py).
app.include_router(similarity_router)

# Structured report for an invention title (additive; see report.py).
app.include_router(report_router)

# Personalized suggestions: ranked records from the similarity index (additive; see suggestions_api.py).
app.include_router(suggestions_router)

# Wide-open CORS since this is a small internal/demo tool served from a
# static frontend on a different origin. Tighten allow_origins for prod.
# expose_headers: browsers hide non-safelisted response headers from
# cross-origin JavaScript, so Retry-After (sent with the 503 while the
# similarity index builds) must be exposed for the frontend to read it.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Retry-After"],
)

# ---------------------------------------------------------------------------
# Load model + reference data once at startup
# ---------------------------------------------------------------------------
import warnings

with warnings.catch_warnings(record=True) as _load_warnings:
    warnings.simplefilter("always")
    vectorizer = joblib.load(MODEL_DIR / "vectorizer.joblib")
    classifier = joblib.load(MODEL_DIR / "classifier.joblib")
if any("unpickle" in str(w.message).lower() for w in _load_warnings):
    import sklearn
    print(f"[PatentIQ] NOTICE: model files were saved with scikit-learn 1.8.0 but {sklearn.__version__} is "
          "installed. Predictions were verified identical on 5,000 titles, but for an exact match run: "
          "pip install scikit-learn==1.8.0")

with open(MODEL_DIR / "dataset_stats.json", encoding="utf-8") as f:
    STATS = json.load(f)

with open(MODEL_DIR / "model_metrics.json", encoding="utf-8") as f:
    METRICS = json.load(f)

CLASSES = list(classifier.classes_)


class PredictRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=1000, description="Patent title or short description")


class FieldScore(BaseModel):
    field: str
    confidence: float


class PredictResponse(BaseModel):
    top: list[FieldScore]
    matched: bool  # kept for shape-compatibility with the frontend's stub classifier


@app.get("/health")
def health():
    return {"status": "ok", "classes": len(CLASSES)}


@app.get("/stats")
def stats():
    return STATS


@app.get("/metrics")
def metrics():
    return METRICS


@app.post("/predict", response_model=PredictResponse)
def predict(req: PredictRequest):
    title = req.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="title must not be empty")

    X = vectorizer.transform([title])

    # LinearSVC has no predict_proba; turn the one-vs-rest decision scores
    # into a pseudo-probability distribution via softmax so the API shape
    # matches the frontend's { field, confidence } stub output.
    scores = classifier.decision_function(X)[0]
    exp_scores = np.exp(scores - np.max(scores))
    probs = exp_scores / exp_scores.sum()

    ranked = sorted(zip(CLASSES, probs), key=lambda x: x[1], reverse=True)
    top3 = [{"field": field, "confidence": round(float(p) * 100, 1)} for field, p in ranked[:3]]

    # Below a low-confidence threshold, treat it the same as the frontend's
    # "no keyword overlap" fallback case.
    matched = top3[0]["confidence"] >= 15.0

    return {"top": top3, "matched": matched}
