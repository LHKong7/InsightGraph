from __future__ import annotations

from pathlib import Path

import yaml

from insightgraph_core.ontology.schema import (
    ConstraintDef,
    EdgeTypeDef,
    IndexDef,
    NodeTypeDef,
    Ontology,
    PropertyDef,
)

_ONTOLOGY_DIR = Path(__file__).parent


def _parse_node(name: str, raw: dict) -> NodeTypeDef:
    properties = {}
    for prop_name, prop_raw in raw.get("properties", {}).items():
        properties[prop_name] = PropertyDef(**prop_raw)

    constraints = []
    for c in raw.get("constraints", []):
        constraints.append(ConstraintDef(**c))

    indexes = []
    for idx in raw.get("indexes", []):
        indexes.append(IndexDef(**idx))

    return NodeTypeDef(
        name=name,
        properties=properties,
        constraints=constraints,
        indexes=indexes,
    )


def _parse_edge(name: str, raw: dict) -> EdgeTypeDef:
    from_types = raw.get("from", [])
    to_types = raw.get("to", [])
    if isinstance(from_types, str):
        from_types = [from_types]
    if isinstance(to_types, str):
        to_types = [to_types]
    return EdgeTypeDef(name=name, from_types=from_types, to_types=to_types)


def load_ontology(
    nodes_path: Path | None = None,
    edges_path: Path | None = None,
) -> Ontology:
    """Load ontology from YAML files.

    Defaults to the bundled nodes.yaml and edges.yaml in the ontology package.
    """
    nodes_path = nodes_path or (_ONTOLOGY_DIR / "nodes.yaml")
    edges_path = edges_path or (_ONTOLOGY_DIR / "edges.yaml")

    with open(nodes_path) as f:
        nodes_raw = yaml.safe_load(f)

    with open(edges_path) as f:
        edges_raw = yaml.safe_load(f)

    nodes = {}
    for name, raw in nodes_raw.get("nodes", {}).items():
        nodes[name] = _parse_node(name, raw)

    edges = {}
    for name, raw in edges_raw.get("edges", {}).items():
        edges[name] = _parse_edge(name, raw)

    return Ontology(nodes=nodes, edges=edges)
