"""Tests for POST /suggestions/search (reuses the similarity index; synthetic data only)."""
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent))
import similarity_fixtures as fx  # noqa: E402

import similarity_engine as se  # noqa: E402
import suggestions_api as sg  # noqa: E402
from main import app  # noqa: E402


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def ready_index():
    m = se.manager
    saved = (m._index, m.state, m.error)
    m.set_index(fx.make_index())
    yield m
    m._index, m.state, m.error = saved
    m.clear_cache()


def post(client, **body):
    return client.post("/suggestions/search", json=body)


def test_basic_ranked_suggestions(client, ready_index):
    r = post(client, description="solar powered water pump for irrigation")
    assert r.status_code == 200
    d = r.json()
    s = d["suggestions"]
    assert s and d["returned"] == len(s)
    assert s[0]["title"] == "Solar powered water pump for irrigation"
    assert [x["rank"] for x in s] == list(range(1, len(s) + 1))
    scores = [x["relevance_score"] for x in s]
    assert scores == sorted(scores, reverse=True)
    top = s[0]
    for k in ("publication_number", "application_number", "field", "status", "office",
              "publication_date", "filing_date", "relevance_label", "reasons", "explanation"):
        assert k in top
    assert top["field"] == "ENGINEERING"
    assert "persistence" in d and "not stored" in d["persistence"]
    assert "not a novelty" in d["disclaimer"].lower()


def test_matches_similarity_engine_exactly(client, ready_index):
    body = {"description": "neural network image", "top_k": 5, "max_per_title": 2}
    sim = client.post("/similarity/search", json=body).json()["results"]
    sug = post(client, **body).json()["suggestions"]
    assert [x["title"] for x in sug] == [x["title"] for x in sim]
    assert [x["relevance_score"] for x in sug] == [x["similarity_score"] for x in sim]


def test_reasons_use_real_matches_only(client, ready_index):
    top = post(client, description="solar water pump").json()["suggestions"][0]
    joined = " ".join(top["reasons"]).lower()
    for w in top["matched_words"]:
        assert w.lower() in joined
    assert top["matched_words"]
    # no reason may mention a word the title does not contain
    assert "herbal" not in joined


def test_filters_applied_and_reported(client, ready_index):
    d = post(client, description="solar water pump", status="Granted", office="Delhi").json()
    assert d["suggestions"]
    assert all(x["status"] == "Granted" and x["office"] == "Delhi" for x in d["suggestions"])
    assert d["query"]["filters"]["status"] == "Granted"
    assert any("filters" in r for r in d["suggestions"][0]["reasons"])


def test_year_filter(client, ready_index):
    d = post(client, description="solar water pump", year_from=2022, year_to=2022).json()
    assert d["suggestions"]
    assert all(x["publication_date"].startswith("2022") for x in d["suggestions"])


def test_empty_results_returns_200_with_note(client, ready_index):
    d = post(client, description="quantum chromodynamics hadron").json()
    assert d["suggestions"] == [] and d["returned"] == 0 and d["note"]


def test_no_searchable_terms_is_422(client, ready_index):
    assert post(client, description="method and system").status_code == 422
    assert post(client, description="12345 !!!").status_code == 422


@pytest.mark.parametrize("body", [
    {"description": ""},
    {"description": "x" * 2001},
    {"description": "solar pump", "top_k": 0},
    {"description": "solar pump", "top_k": 31},
    {"description": "solar pump", "min_score": 1.5},
    {},
])
def test_invalid_input_is_422(client, ready_index, body):
    assert client.post("/suggestions/search", json=body).status_code == 422


def test_whitespace_only_description_rejected(client, ready_index):
    assert post(client, description="    ").status_code in (400, 422)


def test_unknown_filter_value_rejected(client, ready_index):
    assert post(client, description="solar pump", field="NOT_A_FIELD").status_code in (400, 422)


def test_503_with_retry_after_when_building(client):
    m = se.manager
    saved = (m._index, m.state, m.error)
    m._index, m.state = None, "building"
    try:
        r = post(client, description="solar pump")
        assert r.status_code == 503 and r.headers.get("retry-after")
    finally:
        m._index, m.state, m.error = saved


def test_503_without_retry_when_failed(client):
    m = se.manager
    saved = (m._index, m.state, m.error)
    m._index, m.state, m.error = None, "failed", "boom"
    try:
        r = post(client, description="solar pump")
        assert r.status_code == 503 and "retry-after" not in r.headers
    finally:
        m._index, m.state, m.error = saved


def test_missing_fields_become_null():
    rec = {"title": "  Odd\n title ", "publication_number": "nan", "application_number": "",
           "field": "NA", "status": "None", "office": None, "publication_date": "NaT",
           "filing_date": "2020-01-01", "similarity_score": 0.5, "match_strength": "moderate overlap",
           "shared_concepts": [], "shared_phrases": [], "query_term_coverage": 0.0}
    s = sg.to_suggestion(rec, 1, {})
    assert s["title"] == "Odd title"
    for k in ("publication_number", "application_number", "field", "status", "office", "publication_date"):
        assert s[k] is None, k
    assert s["filing_date"] == "2020-01-01"
    assert s["reasons"] == []          # nothing invented when nothing matched


def test_existing_routes_still_registered(client):
    paths = set(client.get("/openapi.json").json()["paths"])
    for p in ("/predict", "/health", "/stats", "/metrics", "/similarity/search", "/similarity/status",
              "/similarity/filters", "/dataset/stats", "/patents/search", "/report/generate",
              "/analytics/grant-rate", "/analytics/application-types", "/analytics/insights",
              "/suggestions/search"):
        assert p in paths, p
