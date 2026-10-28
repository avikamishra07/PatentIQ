"""
PatentIQ backend — report generation.

Combines the existing classifier with the analytics module to assemble a
single structured "report" for a given invention title: predicted field,
where that field sits in the registry (share of total, grant-rate context,
top filing city), and general registry context.

    POST /report/generate   { "title": "...", "project_name": "..." (optional) }

Everything returned is either a direct model prediction or arithmetic over
dataset_stats.json — nothing here is invented or looked up externally.

This module is self-contained (loads its own copy of the model + stats, same
pattern as analytics.py) and is registered in main.py via include_router().
It is NOT called by the current frontend yet.
"""
import json
from pathlib import Path
from typing import Optional

import joblib
import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

MODEL_DIR = Path(__file__).parent / "model"

_vectorizer = joblib.load(MODEL_DIR / "vectorizer.joblib")
_classifier = joblib.load(MODEL_DIR / "classifier.joblib")
_classes = list(_classifier.classes_)

with open(MODEL_DIR / "dataset_stats.json", encoding="utf-8") as f:
    _STATS = json.load(f)

router = APIRouter(prefix="/report", tags=["report"])


class ReportRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=1000)
    project_name: Optional[str] = Field(None, max_length=200)


def _predict(title: str):
    """Same softmax-over-decision-function logic as main.py's /predict,
    duplicated here so this module has no import-time dependency on main.py."""
    X = _vectorizer.transform([title])
    scores = _classifier.decision_function(X)[0]
    exp_scores = np.exp(scores - np.max(scores))
    probs = exp_scores / exp_scores.sum()
    ranked = sorted(zip(_classes, probs), key=lambda x: x[1], reverse=True)
    return [{"field": field, "confidence": round(float(p) * 100, 1)} for field, p in ranked[:3]]


def _top_city_for_field(field: str):
    breakdown = _STATS.get("city_field_breakdown_published", {})
    best_city, best_count = None, -1
    for city, dist in breakdown.items():
        c = dist.get(field, 0)
        if c > best_count:
            best_city, best_count = city, c
    return {"city": best_city, "count": best_count}


@router.post("/generate")
def generate_report(req: ReportRequest):
    title = req.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="title must not be empty")

    top3 = _predict(title)
    predicted_field = top3[0]["field"]

    published = _STATS["field_distribution_published"].get(predicted_field, 0)
    granted = _STATS["field_distribution_granted"].get(predicted_field, 0)
    total_published = _STATS["total_published"]

    field_context = {
        "field": predicted_field,
        "published": published,
        "granted": granted,
        "share_of_all_filings_pct": round((published / total_published * 100), 1) if total_published else 0.0,
        "grant_activity_ratio_pct": round((granted / published * 100), 1) if published else 0.0,
    }

    top_city = _top_city_for_field(predicted_field)

    app_type_mix = _STATS.get("application_type_mix_published", {})
    most_common_app_type = max(app_type_mix.items(), key=lambda kv: kv[1])[0] if app_type_mix else None

    return {
        "project_name": req.project_name,
        "title": title,
        "predicted_field": predicted_field,
        "confidence_pct": top3[0]["confidence"],
        "top_fields": top3,
        "field_context": field_context,
        "top_filing_city_for_field": top_city,
        "registry_context": {
            "year_range": _STATS["year_range"],
            "total_published": total_published,
            "total_granted": _STATS["total_granted"],
            "most_common_application_type": most_common_app_type,
        },
        "disclaimer": (
            "Auto-generated from PatentIQ's field classifier and registry "
            "statistics. This is a field-classification and dataset summary, "
            "not a prior-art or novelty determination."
        ),
    }
