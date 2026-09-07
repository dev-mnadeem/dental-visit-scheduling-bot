"""
Integration tests for API endpoints
"""
import os
import pytest
from fastapi.testclient import TestClient


@pytest.fixture(autouse=True)
def set_env():
    """Set test environment."""
    os.environ["OPENAI_API_KEY"] = "test-key"
    os.environ["LLM_PROVIDER"] = "openai"


@pytest.fixture
def client():
    """Create test client. Skips if LLM init fails."""
    from main import app
    return TestClient(app)


def test_health_endpoint(client):
    """Test health check returns 200."""
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert "service" in data
    assert "version" in data


def test_chat_endpoint_validation(client):
    """Test chat endpoint validation."""
    # Missing required fields
    response = client.post("/chat", json={})
    assert response.status_code == 422

    # Empty message
    response = client.post("/chat", json={
        "session_id": "test",
        "message": "",
        "user_id": 1,
    })
    assert response.status_code == 422


@pytest.mark.skip(reason="Requires real API key for full integration")
def test_chat_endpoint_full_flow(client):
    """Test full chat flow. Requires OPENAI_API_KEY."""
    response = client.post("/chat", json={
        "session_id": "integration-test-session",
        "message": "I want to book an appointment",
        "user_id": 1,
    })
    assert response.status_code == 200
    data = response.json()
    assert "response" in data
    assert "session_id" in data
    assert data["session_id"] == "integration-test-session"


def test_chat_requires_backend_service_authentication(client):
    response = client.post("/chat", json={"session_id": "private-session", "message": "yes", "user_id": 1})
    assert response.status_code == 401
