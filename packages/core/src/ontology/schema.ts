export interface PropertyDef {
  type: string;
  required: boolean;
}

export interface ConstraintDef {
  unique: string[];
}

export interface IndexDef {
  fulltext: string[];
}

export interface NodeTypeDef {
  name: string;
  properties: Record<string, PropertyDef>;
  constraints: ConstraintDef[];
  indexes: IndexDef[];
}

export interface EdgeTypeDef {
  name: string;
  fromTypes: string[];
  toTypes: string[];
}

export interface Ontology {
  nodes: Record<string, NodeTypeDef>;
  edges: Record<string, EdgeTypeDef>;
}

export function getNode(ontology: Ontology, name: string): NodeTypeDef | undefined {
  return ontology.nodes[name];
}

export function getEdge(ontology: Ontology, name: string): EdgeTypeDef | undefined {
  return ontology.edges[name];
}

export function nodeNames(ontology: Ontology): string[] {
  return Object.keys(ontology.nodes);
}

export function edgeNames(ontology: Ontology): string[] {
  return Object.keys(ontology.edges);
}
