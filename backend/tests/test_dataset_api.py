"""
Tests for the dataset endpoints (/dataset/stats, /patents/search) plus
regression checks that the existing endpoints are untouched.

Run from backend/:
    pip install pytest httpx
    python -m pytest tests -v
"""
import json
import sys
from pathlib import Path

import pandas as pd
import pytest
from fastapi.testclient import TestClient

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

import dataset_api  # noqa: E402
import patent_data  # noqa: E402
from main import app  # noqa: E402

CSV = BACKEND / "data" / "patents_combined.csv"


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:  # `with` runs the lifespan (background warm-up)
        yield c


@pytest.fixture(scope="module")
def raw():
    """Independent read of the CSV — deliberately NOT via patent_data.py."""
    return pd.read_csv(
        CSV, dtype=str, keep_default_na=False, encoding="utf-8-sig",
        usecols=["APPLICATION_NUMBER", "PUBLICATION_DATE", "TITLE_OF_INVENTION",
                 "FIELD_OF_INVENTION", "PATENT_STATUS", "IPO_LOCATION"],
    )


# --------------------------------------------------------------- /dataset/stats
def test_stats_match_known_totals(client):
    d = client.get("/dataset/stats").json()
    assert d["total_records"] == 751_100
    assert d["by_status"] == {"Published": 447_203, "Granted": 303_897}


def test_stats_match_independent_read(client, raw):
    d = client.get("/dataset/stats").json()
    assert d["by_field"] == {k: int(v) for k, v in raw["FIELD_OF_INVENTION"].value_counts().items()}
    assert d["by_office"] == {k: int(v) for k, v in raw["IPO_LOCATION"].value_counts().items()}
    assert d["records_with_titles"] == int((raw["TITLE_OF_INVENTION"].str.strip() != "").sum())
    assert d["distinct_application_numbers"] == raw["APPLICATION_NUMBER"].nunique()


def test_stats_internal_consistency(client):
    d = client.get("/dataset/stats").json()
    assert sum(d["by_field"].values()) == d["total_records"]
    assert sum(d["by_office"].values()) == d["total_records"]
    assert sum(y["total"] for y in d["by_publication_year"].values()) == d["total_records"]
    lo, hi = d["publication_year_range"]
    assert lo == 2016 and hi == 2026
    assert "NA" in d["by_field"]  # literal 'NA' field must survive CSV parsing


# --------------------------------------------------------------- /patents/search
def test_search_no_filters_paginates_everything(client):
    d = client.get("/patents/search").json()
    assert d["total"] == 751_100
    assert d["page"] == 1 and d["page_size"] == 20 and d["total_pages"] == 37_555
    assert len(d["results"]) == 20
    dates = [r["publication_date"] for r in d["results"]]
    assert dates == sorted(dates, reverse=True)
    assert set(d["results"][0]) == {
        "application_number", "publication_number", "publication_date",
        "office", "title", "field", "status",
    }


def test_search_sort_ascending(client):
    d = client.get("/patents/search", params={"sort": "date_asc", "page_size": 50}).json()
    dates = [r["publication_date"] for r in d["results"]]
    assert dates == sorted(dates) and dates[0].startswith("2016")


def test_title_search_matches_independent_count(client, raw):
    expected = int(raw["TITLE_OF_INVENTION"].str.contains("solar", case=False, regex=False).sum())
    d = client.get("/patents/search", params={"q": "solar", "page_size": 100}).json()
    assert d["total"] == expected > 0
    assert all("solar" in r["title"].lower() for r in d["results"])


def test_title_search_is_case_insensitive(client):
    a = client.get("/patents/search", params={"q": "SoLaR"}).json()["total"]
    b = client.get("/patents/search", params={"q": "solar"}).json()["total"]
    assert a == b


def test_multiword_search_is_AND(client, raw):
    t = raw["TITLE_OF_INVENTION"].str.casefold()
    expected = int((t.str.contains("solar", regex=False) & t.str.contains("water", regex=False)).sum())
    d = client.get("/patents/search", params={"q": "solar water"}).json()
    assert d["total"] == expected
    assert d["total"] < client.get("/patents/search", params={"q": "solar"}).json()["total"]
    assert all({"solar", "water"} <= set(r["title"].lower().split()) or
               ("solar" in r["title"].lower() and "water" in r["title"].lower()) for r in d["results"])


@pytest.mark.parametrize("value", ["COMPUTER", "computer", "Computer"])
def test_field_filter_case_insensitive(client, raw, value):
    d = client.get("/patents/search", params={"field": value}).json()
    assert d["total"] == int((raw["FIELD_OF_INVENTION"] == "COMPUTER").sum())
    assert d["filters"]["field"] == "COMPUTER"
    assert all(r["field"] == "COMPUTER" for r in d["results"])


def test_field_NA_is_filterable(client):
    d = client.get("/patents/search", params={"field": "NA"}).json()
    assert d["total"] == 1478
    assert all(r["field"] == "NA" for r in d["results"])


def test_status_and_office_filters(client, raw):
    d = client.get("/patents/search", params={"status": "granted", "office": "delhi"}).json()
    expected = int(((raw["PATENT_STATUS"] == "Granted") & (raw["IPO_LOCATION"] == "Delhi")).sum())
    assert d["total"] == expected > 0
    assert all(r["status"] == "Granted" and r["office"] == "Delhi" for r in d["results"])


def test_application_number_lookup(client, raw):
    app_no = "364/CHE/2009"
    expected = int((raw["APPLICATION_NUMBER"] == app_no).sum())
    d = client.get("/patents/search", params={"application_number": app_no.lower()}).json()
    assert d["total"] == expected >= 1
    assert all(r["application_number"] == app_no for r in d["results"])


def test_year_range_filter(client, raw):
    year = raw["PUBLICATION_DATE"].str[:4]
    expected = int(((year >= "2020") & (year <= "2021")).sum())
    d = client.get("/patents/search", params={"year_from": 2020, "year_to": 2021}).json()
    assert d["total"] == expected
    assert all(r["publication_date"][:4] in ("2020", "2021") for r in d["results"])


def test_combined_filters(client, raw):
    t = raw["TITLE_OF_INVENTION"].str.casefold().str.contains("battery", regex=False)
    m = t & (raw["FIELD_OF_INVENTION"] == "ELECTRICAL") & (raw["PATENT_STATUS"] == "Published") \
        & (raw["PUBLICATION_DATE"].str[:4] >= "2023")
    d = client.get("/patents/search", params={
        "q": "battery", "field": "electrical", "status": "published", "year_from": 2023}).json()
    assert d["total"] == int(m.sum())


def test_pagination_pages_differ_and_do_not_overlap(client):
    p = {"q": "system", "page_size": 25}
    one = client.get("/patents/search", params={**p, "page": 1}).json()
    two = client.get("/patents/search", params={**p, "page": 2}).json()
    assert one["total"] == two["total"] and len(one["results"]) == len(two["results"]) == 25
    key = lambda r: (r["application_number"], r["publication_number"], r["status"])
    assert not ({key(r) for r in one["results"]} & {key(r) for r in two["results"]})


def test_page_beyond_end_is_empty_not_error(client):
    d = client.get("/patents/search", params={"q": "solar", "page": 99999}).json()
    assert d["results"] == [] and d["total"] > 0


def test_no_match_returns_zero(client):
    d = client.get("/patents/search", params={"q": "zzzqqqxxxnotaword"}).json()
    assert d["total"] == 0 and d["results"] == [] and d["total_pages"] == 0


@pytest.mark.parametrize("q", ["(", "a.*", "[abc", "\\", "'; DROP TABLE x;--", "सौर ऊर्जा", "%", "+"])
def test_special_characters_are_literal_and_never_500(client, q):
    r = client.get("/patents/search", params={"q": q})
    assert r.status_code == 200
    assert all(q.casefold().split()[0] in x["title"].casefold() for x in r.json()["results"])


def test_blank_q_is_ignored(client):
    assert client.get("/patents/search", params={"q": "   "}).json()["total"] == 751_100


# ------------------------------------------------------------------ validation
@pytest.mark.parametrize("params", [
    {"page": 0}, {"page_size": 0}, {"page_size": 101}, {"sort": "random"},
    {"year_from": 2024, "year_to": 2020}, {"year_from": "abc"},
    {"q": "x" * 201}, {"q": " ".join(["w"] * 11)},
])
def test_invalid_params_are_422(client, params):
    assert client.get("/patents/search", params=params).status_code == 422


def test_unknown_field_422_lists_allowed_values(client):
    r = client.get("/patents/search", params={"field": "ASTROLOGY"})
    assert r.status_code == 422
    assert "COMPUTER" in r.json()["detail"]["allowed"]


# ------------------------------------------------- regression: existing endpoints
def test_health_unchanged(client):
    assert client.get("/health").json() == {"status": "ok", "classes": 16}


def test_old_stats_and_metrics_unchanged(client):
    model_dir = BACKEND / "model"
    assert client.get("/stats").json() == json.loads((model_dir / "dataset_stats.json").read_text())
    assert client.get("/metrics").json() == json.loads((model_dir / "model_metrics.json").read_text())


def test_predict_unchanged(client):
    r = client.post("/predict", json={"title": "A wireless communication system using neural networks"})
    assert r.status_code == 200
    assert r.json() == {
        "top": [
            {"field": "COMMUNICATION", "confidence": 19.5},
            {"field": "COMPUTER", "confidence": 15.6},
            {"field": "ELECTRONICS", "confidence": 9.1},
        ],
        "matched": True,
    }


def test_predict_validation_unchanged(client):
    assert client.post("/predict", json={"title": ""}).status_code == 422
    assert client.post("/predict", json={}).status_code == 422
    assert client.post("/predict", json={"title": "x" * 1001}).status_code == 422


@pytest.mark.parametrize("path", ["/analytics/grant-rate", "/analytics/application-types", "/analytics/insights"])
def test_analytics_unchanged(client, path):
    assert client.get(path).status_code == 200


def test_all_routes_registered(client):
    paths = set(client.get("/openapi.json").json()["paths"])
    assert {"/health", "/stats", "/metrics", "/predict", "/analytics/grant-rate",
            "/analytics/application-types", "/analytics/insights",
            "/dataset/stats", "/patents/search"} <= paths


def test_cors_still_enabled(client):
    r = client.options("/predict", headers={
        "Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST"})
    assert r.headers.get("access-control-allow-origin") == "*"


# ------------------------------------------- failure isolation (keep this LAST)
def test_missing_dataset_gives_503_and_predict_still_works(monkeypatch):
    """If the CSV is absent, dataset routes 503 but /predict must be unaffected."""
    monkeypatch.setattr(patent_data, "DATASET_PATH", BACKEND / "data" / "does_not_exist.csv")
    for fn in (patent_data.load_patents, dataset_api._known_values, dataset_api.dataset_stats):
        fn.cache_clear()
    try:
        with TestClient(app) as c:
            assert c.get("/dataset/stats").status_code == 503
            assert c.get("/patents/search", params={"q": "solar"}).status_code == 503
            assert c.get("/health").status_code == 200
            assert c.post("/predict", json={"title": "solar pump"}).status_code == 200
    finally:
        monkeypatch.undo()
        for fn in (patent_data.load_patents, dataset_api._known_values, dataset_api.dataset_stats):
            fn.cache_clear()
