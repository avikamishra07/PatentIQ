"""Tests for the Groq-backed Innovation Assistant (no network/API key required)."""
from fastapi.testclient import TestClient

import suggestions_api
from main import app


def test_chat_uses_groq_and_supplied_patent_context(monkeypatch):
    captured = {}

    def fake_groq(payload, timeout=60.0):
        captured["payload"] = payload
        captured["timeout"] = timeout
        return {
            "model": "openai/gpt-oss-20b",
            "choices": [{"message": {"content": "Compare sensor placement and power use in a prototype."}}],
        }

    monkeypatch.setattr(suggestions_api, "GROQ_API_KEY", "test-key")
    monkeypatch.setattr(suggestions_api, "_groq_request", fake_groq)
    response = TestClient(app).post("/suggestions/chat", json={
        "description": "Solar irrigation controller using soil moisture sensors",
        "message": "How could I improve it?",
        "history": [{"role": "user", "content": "I want it to be low cost."}],
        "patent_matches": [{
            "title": "Solar powered irrigation control system",
            "publication_number": "12345",
            "field": "AGRICULTURE",
            "status": "Published",
            "relevance_score": 0.32,
            "reasons": ["Title shares irrigation and solar"],
        }],
    })

    assert response.status_code == 200
    body = response.json()
    assert body["provider"] == "groq-cloud"
    assert body["answer"].startswith("Compare sensor placement")
    assert body["context_patents_used"] == 1
    assert captured["payload"]["model"] == "openai/gpt-oss-20b"
    assert captured["payload"]["max_completion_tokens"] == 900
    assert captured["payload"]["temperature"] == 0.35
    serialized = "\n".join(item["content"] for item in captured["payload"]["messages"])
    assert "Solar powered irrigation control system" in serialized
    assert "Solar irrigation controller" in serialized
    assert "not establish novelty" in serialized


def test_chat_returns_setup_hint_without_key(monkeypatch):
    monkeypatch.setattr(suggestions_api, "GROQ_API_KEY", "")
    response = TestClient(app).get("/suggestions/chat/status")
    assert response.status_code == 200
    body = response.json()
    assert body["available"] is False
    assert body["provider"] == "groq-cloud"
    assert "GROQ_API_KEY" in body["setup_hint"]


def test_chat_status_does_not_accept_unedited_example_placeholder(monkeypatch):
    monkeypatch.setattr(suggestions_api, "GROQ_API_KEY", "replace_with_your_groq_api_key")
    body = TestClient(app).get("/suggestions/chat/status").json()
    assert body["available"] is False


def test_chat_validates_required_fields():
    client = TestClient(app)
    response = client.post("/suggestions/chat", json={"description": " ", "message": "Hello"})
    assert response.status_code == 422


def test_chat_reports_rate_limit_without_leaking_provider_body(monkeypatch):
    from fastapi import HTTPException

    def rate_limited(*args, **kwargs):
        raise HTTPException(status_code=429, detail="Groq's current rate limit or free-tier quota was reached. Please wait and try again later.")

    monkeypatch.setattr(suggestions_api, "GROQ_API_KEY", "test-key")
    monkeypatch.setattr(suggestions_api, "_groq_request", rate_limited)
    response = TestClient(app).post("/suggestions/chat", json={"description": "A device to water plants", "message": "How can I improve it?"})
    assert response.status_code == 429
    assert "rate limit" in response.json()["detail"]
