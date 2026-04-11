import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { parse as parseYaml } from "yaml";
import type {
  ConstraintDef,
  EdgeTypeDef,
  IndexDef,
  NodeTypeDef,
  Ontology,
  PropertyDef,
} from "./schema";

const ONTOLOGY_DIR = resolve(__dirname, "..", "..", "src", "ontology");

function parseNode(name: string, raw: Record<string, unknown>): NodeTypeDef {
  const propsRaw = (raw.properties ?? {}) as Record<string, Record<string, unknown>>;
  const properties: Record<string, PropertyDef> = {};
  for (const [propName, propDef] of Object.entries(propsRaw)) {
    properties[propName] = {
      type: (propDef.type as string) ?? "string",
      required: (propDef.required as boolean) ?? false,
    };
  }

  const constraints: ConstraintDef[] = ((raw.constraints ?? []) as Record<string, unknown>[]).map(
    (c) => ({ unique: (c.unique as string[]) ?? [] }),
  );

  const indexes: IndexDef[] = ((raw.indexes ?? []) as Record<string, unknown>[]).map((idx) => ({
    fulltext: (idx.fulltext as string[]) ?? [],
  }));

  return { name, properties, constraints, indexes };
}

function parseEdge(name: string, raw: Record<string, unknown>): EdgeTypeDef {
  let fromTypes = raw.from ?? [];
  let toTypes = raw.to ?? [];
  if (typeof fromTypes === "string") fromTypes = [fromTypes];
  if (typeof toTypes === "string") toTypes = [toTypes];
  return { name, fromTypes: fromTypes as string[], toTypes: toTypes as string[] };
}

export function loadOntology(nodesPath?: string, edgesPath?: string): Ontology {
  const nPath = nodesPath ?? resolve(ONTOLOGY_DIR, "nodes.yaml");
  const ePath = edgesPath ?? resolve(ONTOLOGY_DIR, "edges.yaml");

  const nodesRaw = parseYaml(readFileSync(nPath, "utf-8")) as Record<string, unknown>;
  const edgesRaw = parseYaml(readFileSync(ePath, "utf-8")) as Record<string, unknown>;

  const nodes: Record<string, NodeTypeDef> = {};
  for (const [name, raw] of Object.entries(
    (nodesRaw.nodes ?? {}) as Record<string, Record<string, unknown>>,
  )) {
    nodes[name] = parseNode(name, raw);
  }

  const edges: Record<string, EdgeTypeDef> = {};
  for (const [name, raw] of Object.entries(
    (edgesRaw.edges ?? {}) as Record<string, Record<string, unknown>>,
  )) {
    edges[name] = parseEdge(name, raw);
  }

  return { nodes, edges };
}
