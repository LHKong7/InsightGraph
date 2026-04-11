from __future__ import annotations

from functools import lru_cache

from insightgraph_core.config import Settings, get_settings
from insightgraph_core.ontology.loader import load_ontology
from insightgraph_core.ontology.schema import Ontology


@lru_cache
def get_cached_settings() -> Settings:
    return get_settings()


@lru_cache
def get_ontology() -> Ontology:
    return load_ontology()
