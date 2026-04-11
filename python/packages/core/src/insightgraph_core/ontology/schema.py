from __future__ import annotations

from pydantic import BaseModel, Field


class PropertyDef(BaseModel):
    """Definition of a node/edge property."""

    type: str
    required: bool = False


class ConstraintDef(BaseModel):
    """A uniqueness constraint on a node type."""

    unique: list[str] = Field(default_factory=list)


class IndexDef(BaseModel):
    """An index definition (e.g., fulltext) on a node type."""

    fulltext: list[str] = Field(default_factory=list)


class VectorIndexDef(BaseModel):
    """A vector index definition on a node type."""

    property: str = "embedding"
    dimensions: int = 1536
    similarity: str = "cosine"


class NodeTypeDef(BaseModel):
    """Definition of a node type in the ontology."""

    name: str
    properties: dict[str, PropertyDef] = Field(default_factory=dict)
    constraints: list[ConstraintDef] = Field(default_factory=list)
    indexes: list[IndexDef] = Field(default_factory=list)
    vector_indexes: list[VectorIndexDef] = Field(default_factory=list)


class EdgeTypeDef(BaseModel):
    """Definition of an edge type in the ontology."""

    name: str
    from_types: list[str] = Field(default_factory=list)
    to_types: list[str] = Field(default_factory=list)


class Ontology(BaseModel):
    """The complete ontology: node types and edge types."""

    nodes: dict[str, NodeTypeDef] = Field(default_factory=dict)
    edges: dict[str, EdgeTypeDef] = Field(default_factory=dict)

    def get_node(self, name: str) -> NodeTypeDef | None:
        return self.nodes.get(name)

    def get_edge(self, name: str) -> EdgeTypeDef | None:
        return self.edges.get(name)

    def node_names(self) -> list[str]:
        return list(self.nodes.keys())

    def edge_names(self) -> list[str]:
        return list(self.edges.keys())
