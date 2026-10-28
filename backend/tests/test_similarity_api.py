"""
HTTP tests for the Phase 3 routes (/similarity/*) and /report/generate, plus
regression checks that every earlier route is still registered.

Uses a small synthetic index injected into the shared IndexManager, so no
751k-row index is built. Run from backend/:
    pip install pytest httpx
    python -m pytest tests -v
"""
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent))
import similarity_fixtures as fx  # noqa: E402

import similarity_engine as se  # noqa: E402
from main import app  # noqa: E402


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def ready_index():
    """Inject the synthetic index; restore the manager afterwards."""
    m = se.manager
    saved = (m._index, m.state, m.error)
    m.set_index(fx.make_index())
    yield m
    m._index, m.state, m.error = saved
    m.clear_cache()


# ------------------------------------------------------------ /similarity/search
def test_search_ok(client, ready_index):
    r = client.post("/similarity/search", json={"description": "solar water pump for irrigation"})
    assert r.status_code == 200
    d = r.json()
    assert d["results"][0]["title"] == "Solar powered water pump for irrigation"
    assert d["cache_hit"] is False
    assert "disclaimer" in d and "not a novelty" in d["disclaimer"].lower()


def test_search_second_call_is_cache_hit(client, ready_index):
    body = {"description": "solar water pump", "top_k": 3}
    assert client.post("/similarity/search", json=body).json()["cache_hit"] is False
    assert client.post("/similarity/search", json=body).json()["cache_hit"] is True


def test_search_filters(client, ready_index):
    r = client.post("/similarity/search", json={
        "description": "solar water pump", "status": "granted", "office": "delhi"})
    assert r.status_code == 200
    assert r.json()["results"]
    assert all(x["status"] == "Granted" and x["office"] == "Delhi" for x in r.json()["results"])


@pytest.mark.parametrize("body", [
    {},
    {"description": ""},
    {"description": "x" * (se.MAX_DESCRIPTION_CHARS + 1)},
    {"description": "solar", "top_k": 0},
    {"description": "solar", "top_k": se.MAX_TOP_K + 1},
    {"description": "solar", "min_score": 2},
    {"description": "solar", "year_from": 1000},
    {"description": "solar", "top_k": "many"},
])
def test_search_request_validation_is_422(client, ready_index, body):
    assert client.post("/similarity/search", json=body).status_code == 422


def test_search_engine_validation_errors(client, ready_index):
    assert client.post("/similarity/search", json={"description": "   "}).status_code in (400, 422)
    assert client.post("/similarity/search", json={"description": "method and system"}).status_code == 422
    assert client.post("/similarity/search", json={"description": "solar", "year_from": 2022,
                                                    "year_to": 2020}).status_code == 422
    r = client.post("/similarity/search", json={"description": "solar", "field": "NOPE"})
    assert r.status_code == 422
    assert "ENGINEERING" in r.json()["detail"]["allowed"]


def test_search_503_with_retry_after_while_building(client):
    m = se.manager
    saved = (m._index, m.state, m.error)
    m._index, m.state = None, "building"
    try:
        r = client.post("/similarity/search", json={"description": "solar pump"})
        assert r.status_code == 503
        assert r.headers.get("retry-after") == "5"
        # everything else keeps working
        assert client.get("/health").status_code == 200
        assert client.post("/predict", json={"title": "solar pump"}).status_code == 200
    finally:
        m._index, m.state, m.error = saved


def test_search_503_when_index_failed(client):
    m = se.manager
    saved = (m._index, m.state, m.error)
    m._index, m.state, m.error = None, "failed", "FileNotFoundError: x"
    try:
        r = client.post("/similarity/search", json={"description": "solar pump"})
        assert r.status_code == 503
        assert "unavailable" in str(r.json()["detail"])
    finally:
        m._index, m.state, m.error = saved


# ------------------------------------------------------- /similarity/status, /filters
def test_status_and_filters(client, ready_index):
    s = client.get("/similarity/status").json()
    assert s["state"] == "ready" and s["indexed_records"] == len(fx.ROWS)
    f = client.get("/similarity/filters").json()
    assert set(f) == {"field", "status", "office"}
    assert "Granted" in f["status"]


def test_filters_503_when_not_ready(client):
    m = se.manager
    saved = (m._index, m.state, m.error)
    m._index, m.state = None, "building"
    try:
        assert client.get("/similarity/filters").status_code == 503
        assert client.get("/similarity/status").json()["state"] == "building"
    finally:
        m._index, m.state, m.error = saved


# ------------------------------------------------------------ /report/generate
def test_report_generate(client):
    r = client.post("/report/generate", json={"title": "A wireless communication system using neural networks",
                                              "project_name": "demo"})
    assert r.status_code == 200
    d = r.json()
    assert d["project_name"] == "demo"
    assert d["predicted_field"] == d["top_fields"][0]["field"]
    assert len(d["top_fields"]) == 3
    assert {"field_context", "top_filing_city_for_field", "registry_context", "disclaimer"} <= set(d)
    assert "not a prior-art" in d["disclaimer"]


def test_report_validation(client):
    assert client.post("/report/generate", json={"title": ""}).status_code == 422
    assert client.post("/report/generate", json={}).status_code == 422
    assert client.post("/report/generate", json={"title": "x" * 1001}).status_code == 422


def test_report_predicted_field_matches_predict(client):
    title = "Herbal composition for treating diabetes"
    top = client.post("/predict", json={"title": title}).json()["top"][0]["field"]
    assert client.post("/report/generate", json={"title": title}).json()["predicted_field"] == top


# ----------------------------------------------------- regression: all routes present
def test_all_routes_registered(client):
    paths = set(client.get("/openapi.json").json()["paths"])
    assert {"/health", "/stats", "/metrics", "/predict",
            "/analytics/grant-rate", "/analytics/application-types", "/analytics/insights",
            "/dataset/stats", "/patents/search",
            "/similarity/search", "/similarity/status", "/similarity/filters",
            "/report/generate"} <= paths


def test_phase1_endpoints_still_work(client):
    assert client.get("/health").json() == {"status": "ok", "classes": 16}
    assert client.get("/stats").status_code == 200
    assert client.get("/metrics").status_code == 200
    for p in ("/analytics/grant-rate", "/analytics/application-types", "/analytics/insights"):
        assert client.get(p).status_code == 200
    assert client.post("/predict", json={"title": "solar water pump"}).status_code == 200


# ------------------------------------------------------------ CORS (Phase 4)
def test_cors_exposes_retry_after_to_browsers(client):
    """The frontend runs on another origin; browsers only let it read
    Retry-After (sent with the 503 while the index builds) if it is exposed."""
    r = client.get("/health", headers={"Origin": "http://localhost:5173"})
    assert r.status_code == 200
    exposed = r.headers.get("access-control-expose-headers", "")
    assert "retry-after" in exposed.lower()
