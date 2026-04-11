"""Tests for configuration loading."""

from insightgraph_core.config import Settings, get_settings


def test_default_settings():
    settings = Settings()
    assert settings.neo4j_uri == "bolt://localhost:7687"
    assert settings.neo4j_user == "neo4j"
    assert settings.llm_model == "gpt-4o-mini"
    assert settings.max_file_size_mb == 100


def test_settings_from_env(monkeypatch):
    monkeypatch.setenv("IG_NEO4J_URI", "bolt://custom:7687")
    monkeypatch.setenv("IG_LLM_MODEL", "claude-sonnet-4-20250514")
    settings = Settings()
    assert settings.neo4j_uri == "bolt://custom:7687"
    assert settings.llm_model == "claude-sonnet-4-20250514"


def test_get_settings():
    settings = get_settings()
    assert isinstance(settings, Settings)
