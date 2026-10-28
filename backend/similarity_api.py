"""
PatentIQ backend - Phase 3: similar-patent search (HTTP layer).

Thin FastAPI wrapper over similarity_engine.manager. Read-only and additive:
it does not touch /predict, /stats, /metrics, /analytics/*, /dataset/* or
/patents/search.

    POST /similarity/search    title-overlap search for a free-text description
    GET  /similarity/status    index state (not_started | building | ready | failed)
    GET  /similarity/filters   allowed values for field / status / office

Scores are TITLE-ONLY lexical similarity. They are not a novelty, prior-art or
patentability assessment (see similarity_engine.DISCLAIMER).

The index is built in a background thread. While it is building, search
returns 503 with a Retry-After header; every other route keeps working.
"""
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

import similarity_engine as engine
from similarity_engine import SimilarityError, manager

router = APIRouter(prefix="/similarity", tags=["similarity"])


class SimilarityRequest(BaseModel):
    description: str = Field(..., min_length=1, max_length=engine.MAX_DESCRIPTION_CHARS,
                             description="Free-text description of the invention")
    top_k: int = Field(engine.DEFAULT_TOP_K, ge=1, le=engine.MAX_TOP_K)
    min_score: float = Field(engine.DEFAULT_MIN_SCORE, ge=0.0, le=1.0)
    max_per_title: int = Field(engine.DEFAULT_MAX_PER_TITLE, ge=1, le=engine.MAX_MAX_PER_TITLE,
                               description="Max records shown for one identical title")
    field: Optional[str] = Field(None, max_length=100, description="Field of invention, e.g. COMPUTER")
    status: Optional[str] = Field(None, max_length=50, description="Published or Granted")
    office: Optional[str] = Field(None, max_length=100, description="Patent office city")
    year_from: Optional[int] = Field(None, ge=1800, le=2200, description="Earliest publication year")
    year_to: Optional[int] = Field(None, ge=1800, le=2200, description="Latest publication year")


def _raise(exc: SimilarityError):
    headers = None
    if exc.status == 503 and isinstance(exc.detail, dict) and "retry_after_seconds" in exc.detail:
        headers = {"Retry-After": str(exc.detail["retry_after_seconds"])}
    raise HTTPException(status_code=exc.status, detail=exc.detail, headers=headers)


def warm_up():
    """Best-effort: start the background index build. Never raises."""
    try:
        manager.start()
    except Exception as exc:  # a similarity problem must never break the app
        print(f"[similarity_api] warm-up failed: {exc}")


@router.post("/search")
def similarity_search(req: SimilarityRequest):
    """Find patent records whose titles overlap with the description."""
    kw = req.model_dump(exclude={"description"})
    try:
        return manager.search(req.description, **kw)
    except SimilarityError as exc:
        _raise(exc)


@router.get("/status")
def similarity_status():
    """Index state; also kicks off the build if it has not started."""
    if manager.state == "not_started":
        manager.start()
    return manager.status()


@router.get("/filters")
def similarity_filters():
    """Allowed (canonical) values for the filter parameters."""
    try:
        return manager.filter_options()
    except SimilarityError as exc:
        _raise(exc)
