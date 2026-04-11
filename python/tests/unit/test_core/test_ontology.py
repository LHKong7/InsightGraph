"""Tests for ontology loading and schema definitions."""

from insightgraph_core.ontology.loader import load_ontology
from insightgraph_core.ontology.schema import Ontology


def test_load_ontology():
    ontology = load_ontology()
    assert isinstance(ontology, Ontology)
    assert len(ontology.nodes) > 0
    assert len(ontology.edges) > 0


def test_node_types():
    ontology = load_ontology()
    expected_nodes = [
        "Report",
        "Section",
        "Paragraph",
        "Entity",
        "Metric",
        "MetricValue",
        "Claim",
        "SourceSpan",
        "TimePeriod",
    ]
    for name in expected_nodes:
        assert name in ontology.nodes, f"Missing node type: {name}"


def test_edge_types():
    ontology = load_ontology()
    expected_edges = [
        "HAS_SECTION",
        "HAS_PARAGRAPH",
        "MENTIONS",
        "ASSERTS",
        "MEASURES",
        "HAS_VALUE",
        "SUPPORTED_BY",
        "SAME_AS",
    ]
    for name in expected_edges:
        assert name in ontology.edges, f"Missing edge type: {name}"


def test_entity_node_properties():
    ontology = load_ontology()
    entity = ontology.get_node("Entity")
    assert entity is not None
    assert "name" in entity.properties
    assert "entity_type" in entity.properties
    assert entity.properties["name"].required is True


def test_entity_has_constraints():
    ontology = load_ontology()
    entity = ontology.get_node("Entity")
    assert entity is not None
    assert len(entity.constraints) > 0
    assert "entity_id" in entity.constraints[0].unique


def test_entity_has_fulltext_index():
    ontology = load_ontology()
    entity = ontology.get_node("Entity")
    assert entity is not None
    assert len(entity.indexes) > 0
    assert "name" in entity.indexes[0].fulltext


def test_edge_from_to_types():
    ontology = load_ontology()
    has_section = ontology.get_edge("HAS_SECTION")
    assert has_section is not None
    assert "Report" in has_section.from_types
    assert "Section" in has_section.to_types

    mentions = ontology.get_edge("MENTIONS")
    assert mentions is not None
    assert "Paragraph" in mentions.from_types
    assert "Entity" in mentions.to_types


def test_ontology_helpers():
    ontology = load_ontology()
    assert "Report" in ontology.node_names()
    assert "HAS_SECTION" in ontology.edge_names()
    assert ontology.get_node("NonExistent") is None
    assert ontology.get_edge("NonExistent") is None
