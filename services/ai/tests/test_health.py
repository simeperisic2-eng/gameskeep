"""Hermetic tests proving the AI service harness works."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_returns_ok() -> None:
    res = client.get("/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert body["service"] == "ai"
    assert "mode" in body


def test_ping_echoes_message() -> None:
    res = client.get("/ping", params={"msg": "hello"})
    assert res.status_code == 200
    body = res.json()
    assert body["pong"] is True
    assert body["echo"] == "hello"


def test_ping_defaults() -> None:
    res = client.get("/ping")
    assert res.status_code == 200
    assert res.json()["echo"] == "ping"
