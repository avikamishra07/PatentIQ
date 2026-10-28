"""
PatentIQ backend — dataset endpoints.

Exposes the combined registry dataset (backend/data/patents_combined.csv,
loaded through patent_data.load_patents) over HTTP. Read-only and additive:
nothing here touches the classifier or the existing /stats, /metrics,
/predict or /analytics/* routes.

    GET /dataset/stats      live statistics computed from the combined dataset
    GET /patents/search     filter + paginate patent metadata

Note: the existing GET /stats serves the *model's* training statistics
(model/dataset_stats.json). /dataset/stats is computed from the full
combined dataset and is a separate thing.
"""
import threading
from functools import lru_cache
from typing import Literal, Optional

from fastapi import APIRouter, HTTPException, Query

from patent_data import load_patents

router = APIRouter(tags=["dataset"])

MAX_PAGE_SIZE = 100
MAX_SEARCH_TERMS = 10

_load_lock = threading.Lock()


def get_df():
    """Return the cached dataframe, or raise 503 if the dataset can't load.

    The lock stops a startup warm-up and a first request from both loading
    the 180 MB CSV at the same time (lru_cache alone does not prevent that).
    """
    with _load_lock:
        try:
            return load_patents()
        except (FileNotFoundError, ValueError) as exc:
            raise HTTPException(status_code=503, detail=f"Patent dataset unavailable: {exc}")


def warm_up():
    """Best-effort preload, called from a background thread at app startup."""
    try:
        get_df()
        dataset_stats()
    except Exception as exc:  # never let a dataset problem break the app / /predict
        print(f"[dataset_api] warm-up failed: {exc}")


@lru_cache(maxsize=1)
def _known_values():
    """Canonical spellings of the filterable categorical columns."""
    df = get_df()
    return {
        "field": sorted(v for v in df["FIELD_OF_INVENTION"].unique() if v),
        "status": sorted(v for v in df["PATENT_STATUS"].unique() if v),
        "office": sorted(v for v in df["IPO_LOCATION"].unique() if v),
    }


def _canonical(kind: str, value: str) -> str:
    """Case-insensitive match against real dataset values; 422 if unknown."""
    allowed = _known_values()[kind]
    wanted = value.strip().casefold()
    for candidate in allowed:
        if candidate.casefold() == wanted:
            return candidate
    raise HTTPException(
        status_code=422,
        detail={"error": f"Unknown {kind}: {value!r}", "allowed": allowed},
    )


@lru_cache(maxsize=1)
def dataset_stats():
    df = get_df()
    year = df["PUBLICATION_DATE"].str[:4]

    def counts(series):
        return {str(k): int(v) for k, v in series.value_counts().items() if k}

    by_year = {}
    for (y, status), n in df.groupby([year, df["PATENT_STATUS"]]).size().items():
        if not y:
            continue
        row = by_year.setdefault(str(y), {"total": 0})
        row[str(status)] = int(n)
        row["total"] += int(n)

    years = sorted(by_year)
    return {
        "total_records": int(len(df)),
        "by_status": counts(df["PATENT_STATUS"]),
        "by_field": counts(df["FIELD_OF_INVENTION"]),
        "by_office": counts(df["IPO_LOCATION"]),
        "by_publication_year": {y: by_year[y] for y in years},
        "publication_year_range": [int(years[0]), int(years[-1])] if years else None,
        "records_with_titles": int(df["TITLE_OF_INVENTION"].ne("").sum()),
        "distinct_application_numbers": int(df["APPLICATION_NUMBER"].nunique()),
        "application_numbers_in_multiple_rows": int(
            df["APPLICATION_NUMBER"].duplicated(keep=False).sum()
        ),
        "note": (
            "A Published and a Granted row can share an application number, "
            "so distinct_application_numbers is lower than total_records."
        ),
    }


@router.get("/dataset/stats")
def get_dataset_stats():
    """Statistics computed from the full combined dataset."""
    return dataset_stats()


def _record(row):
    return {
        "application_number": row.APPLICATION_NUMBER,
        "publication_number": row.PUBLICATION_NUMBER,
        "publication_date": row.PUBLICATION_DATE,
        "office": row.IPO_LOCATION,
        "title": row.TITLE_OF_INVENTION,
        "field": row.FIELD_OF_INVENTION,
        "status": row.PATENT_STATUS,
    }


@router.get("/patents/search")
def search_patents(
    q: Optional[str] = Query(None, max_length=200, description="Words to find in the title (all must match, case-insensitive)"),
    field: Optional[str] = Query(None, description="Field of invention, e.g. COMPUTER"),
    status: Optional[str] = Query(None, description="Published or Granted"),
    office: Optional[str] = Query(None, description="Patent office city, e.g. Delhi"),
    application_number: Optional[str] = Query(None, max_length=100, description="Exact application number"),
    publication_number: Optional[str] = Query(None, max_length=100, description="Exact publication number"),
    year_from: Optional[int] = Query(None, ge=1800, le=2200, description="Earliest publication year"),
    year_to: Optional[int] = Query(None, ge=1800, le=2200, description="Latest publication year"),
    sort: Literal["date_desc", "date_asc"] = Query("date_desc"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=MAX_PAGE_SIZE),
):
    """Search patent metadata. All supplied filters are combined with AND."""
    if year_from is not None and year_to is not None and year_from > year_to:
        raise HTTPException(status_code=422, detail="year_from must not be greater than year_to")

    df = get_df()
    mask = None

    def add(cond):
        nonlocal mask
        mask = cond if mask is None else (mask & cond)

    filters = {}

    if q is not None and q.strip():
        terms = q.casefold().split()
        if len(terms) > MAX_SEARCH_TERMS:
            raise HTTPException(status_code=422, detail=f"At most {MAX_SEARCH_TERMS} search words are allowed")
        titles = df["TITLE_OF_INVENTION"].str.casefold()
        for term in terms:
            add(titles.str.contains(term, regex=False))  # literal match, never a regex
        filters["q"] = q.strip()

    for kind, value, column in (
        ("field", field, "FIELD_OF_INVENTION"),
        ("status", status, "PATENT_STATUS"),
        ("office", office, "IPO_LOCATION"),
    ):
        if value is not None and value.strip():
            canon = _canonical(kind, value)
            add(df[column] == canon)
            filters[kind] = canon

    for name, value, column in (
        ("application_number", application_number, "APPLICATION_NUMBER"),
        ("publication_number", publication_number, "PUBLICATION_NUMBER"),
    ):
        if value is not None and value.strip():
            add(df[column].str.casefold() == value.strip().casefold())
            filters[name] = value.strip()

    if year_from is not None or year_to is not None:
        year = df["PUBLICATION_DATE"].str[:4]
        if year_from is not None:
            add(year >= f"{year_from:04d}")
            filters["year_from"] = year_from
        if year_to is not None:
            add(year <= f"{year_to:04d}")
            filters["year_to"] = year_to

    matched = df if mask is None else df[mask]
    total = int(len(matched))
    total_pages = (total + page_size - 1) // page_size

    start = (page - 1) * page_size
    if start >= total:
        results = []
    else:
        # ISO dates sort correctly as strings; stable sort keeps dataset order on ties.
        ordered = matched.sort_values(
            "PUBLICATION_DATE", ascending=(sort == "date_asc"), kind="stable"
        )
        results = [_record(r) for r in ordered.iloc[start:start + page_size].itertuples(index=False)]

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": total_pages,
        "sort": sort,
        "filters": filters,
        "results": results,
    }
