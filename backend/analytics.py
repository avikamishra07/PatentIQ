"""
PatentIQ backend — analytics extensions.

Adds three read-only endpoints on top of the existing dataset_stats.json,
all pure arithmetic over real numbers already in that file. No new data,
no model calls, no fabricated content.

    GET /analytics/grant-rate          granted ÷ published, by field and by city
    GET /analytics/application-types   filing-type mix with plain-language labels
    GET /analytics/insights            short templated sentences from real totals

This module is NOT imported by the current frontend. It's wired into the
FastAPI app in main.py (`app.include_router(analytics_router)`) so it's
live and testable on its own, but nothing in patentiq_app.jsx calls it yet
— hook it up whenever you're ready to surface it in the UI.
"""
import json
from pathlib import Path

from fastapi import APIRouter

MODEL_DIR = Path(__file__).parent / "model"

with open(MODEL_DIR / "dataset_stats.json", encoding="utf-8") as f:
    STATS = json.load(f)

router = APIRouter(prefix="/analytics", tags=["analytics"])

# Plain-language labels for the raw application-type strings in the dataset.
APPLICATION_TYPE_LABELS = {
    "ORDINARY APPLICATION": "A standard, first-time filing for a new invention.",
    "PCT NATIONAL PHASE APPLICATION": "An international (PCT) filing entering the national phase in India.",
    "CONVENTION APPLICATION": "A filing that claims priority from an earlier application in another country.",
    "DIVISIONAL PCT NATIONAL PHASE APPLICATION": "A PCT national-phase filing split out from a parent application.",
    "PATENT OF ADDITION FOR ORDINARY APPLICATION": "An improvement filed as an addition to an existing ordinary patent.",
    "DIVISIONAL ORDINARY APPLICATION": "An ordinary filing split out from a parent application.",
    "DIVISIONAL CONVENTION APPLICATION": "A convention filing split out from a parent application.",
    "PATENT OF ADDITION FOR PCT NATIONAL PHASE APPLICATION": "An improvement filed as an addition to an existing PCT national-phase patent.",
    "PATENT OF ADDITION FOR CONVENTION APPLICATION": "An improvement filed as an addition to an existing convention patent.",
}


def _round1(n):
    return round(n, 1)


@router.get("/grant-rate")
def grant_rate():
    """Granted ÷ published, expressed as a percentage, per field and per city.

    A high rate means a large share of what's been published in that field
    or city has gone on to be granted; a low rate can mean either that most
    filings are rejected/withdrawn, or that many are still pending (the
    dataset doesn't distinguish the two, so this is a rate, not a verdict).
    """
    pub_field = STATS["field_distribution_published"]
    grant_field = STATS["field_distribution_granted"]
    by_field = []
    for field, published in pub_field.items():
        granted = grant_field.get(field, 0)
        rate = (granted / published * 100) if published else 0.0
        by_field.append({
            "field": field,
            "published": published,
            "granted": granted,
            "grant_rate_pct": _round1(rate),
        })
    by_field.sort(key=lambda r: r["grant_rate_pct"], reverse=True)

    pub_city = STATS["city_totals_published"]
    grant_city = STATS["city_totals_granted"]
    by_city = []
    for city, published in pub_city.items():
        granted = grant_city.get(city, 0)
        rate = (granted / published * 100) if published else 0.0
        by_city.append({
            "city": city,
            "published": published,
            "granted": granted,
            "grant_rate_pct": _round1(rate),
        })
    by_city.sort(key=lambda r: r["grant_rate_pct"], reverse=True)

    overall_published = STATS["total_published"]
    overall_granted = STATS["total_granted"]
    overall_rate = (overall_granted / overall_published * 100) if overall_published else 0.0

    return {
        "overall_grant_rate_pct": _round1(overall_rate),
        "note": (
            "Published and granted counts are not the same filing cohort — "
            "a patent granted in this window may have been filed years "
            "earlier, before the published-application snapshot. Rates can "
            "exceed 100% for small fields/cities as a result; treat this as "
            "a rough activity ratio, not a literal pass rate."
        ),
        "by_field": by_field,
        "by_city": by_city,
    }


@router.get("/application-types")
def application_types():
    """Filing-type mix (ordinary / PCT national phase / convention / etc.)
    with a share of total and a one-line plain-language explanation."""
    mix = STATS["application_type_mix_published"]
    total = sum(mix.values())
    rows = []
    for app_type, count in mix.items():
        rows.append({
            "type": app_type,
            "count": count,
            "share_pct": _round1((count / total * 100) if total else 0.0),
            "description": APPLICATION_TYPE_LABELS.get(app_type, "Filing type recorded in the registry."),
        })
    rows.sort(key=lambda r: r["count"], reverse=True)
    return {"total_published": total, "types": rows}


@router.get("/insights")
def insights():
    """A handful of short, templated, factual sentences derived directly
    from dataset_stats.json — no generation, just arithmetic filled into
    fixed templates. Safe to display as-is."""
    out = []

    pub_field = STATS["field_distribution_published"]
    top_field, top_field_count = max(pub_field.items(), key=lambda kv: kv[1])
    top_field_pct = _round1(top_field_count / STATS["total_published"] * 100)
    out.append(
        f"{top_field.title()} accounts for the largest share of published "
        f"applications, at {top_field_pct}% of all filings."
    )

    pub_city = STATS["city_totals_published"]
    top_city, top_city_count = max(pub_city.items(), key=lambda kv: kv[1])
    out.append(
        f"{top_city} leads all registry cities with {top_city_count:,} "
        f"published applications."
    )

    overall_rate = _round1(STATS["total_granted"] / STATS["total_published"] * 100)
    out.append(
        f"Across the full registry, {overall_rate}% of published "
        f"applications have gone on to be granted."
    )

    grant_field = STATS["field_distribution_granted"]
    rates = {
        f: (grant_field.get(f, 0) / c * 100)
        for f, c in pub_field.items() if c >= 1000  # ignore tiny fields for a stable ranking
    }
    if rates:
        best_field, best_rate = max(rates.items(), key=lambda kv: kv[1])
        out.append(
            f"{best_field.title()} has the highest granted-to-published "
            f"activity ratio among major fields, at {_round1(best_rate)}% "
            f"— published and granted aren't the same filing cohort, so "
            f"treat this as an activity signal, not a literal approval rate."
        )

    y0, y1 = STATS["year_range"]
    out.append(
        f"The registry spans filings from {y0} to {y1}, totalling "
        f"{STATS['total_published']:,} published and {STATS['total_granted']:,} granted records."
    )

    return {"insights": out}
