import { getSettings } from "@insightgraph/core";
import {
  createGraphStore,
  type GraphStore,
  type IGraphReader,
} from "@insightgraph/graph";

let _store: GraphStore | null = null;
let _reader: IGraphReader | null = null;

async function getReader(): Promise<IGraphReader> {
  if (_reader) return _reader;
  const settings = getSettings();
  _store = createGraphStore(settings);
  try {
    await _store.verifyConnectivity();
  } catch {
    // continue — ensureSchema will surface a clearer error
  }
  await _store.ensureSchema();
  _reader = _store.reader();
  return _reader;
}

export const TOOLS = [
  {
    name: "find_entities",
    description: "Search for entities by name and/or type",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "Entity name to search for" },
        entity_type: { type: "string", description: "Filter by entity type" },
        limit: { type: "number", description: "Max results (default 50)" },
      },
    },
  },
  {
    name: "get_entity_profile",
    description: "Get comprehensive entity profile with claims, metrics, relationships",
    inputSchema: {
      type: "object" as const,
      properties: {
        entity_name: { type: "string", description: "Entity name" },
      },
      required: ["entity_name"],
    },
  },
  {
    name: "get_claims_about",
    description: "Get claims/assertions about an entity",
    inputSchema: {
      type: "object" as const,
      properties: {
        entity_name: { type: "string", description: "Entity name" },
      },
      required: ["entity_name"],
    },
  },
  {
    name: "get_metric_history",
    description: "Get metric values over time",
    inputSchema: {
      type: "object" as const,
      properties: {
        metric_name: { type: "string", description: "Metric name" },
        entity_name: { type: "string", description: "Optional entity filter" },
      },
      required: ["metric_name"],
    },
  },
  {
    name: "find_evidence_for_claim",
    description: "Find source evidence supporting a claim",
    inputSchema: {
      type: "object" as const,
      properties: {
        claim_id: { type: "string", description: "Claim ID" },
      },
      required: ["claim_id"],
    },
  },
  {
    name: "find_related_entities",
    description: "Find entities connected to a given entity via relationships",
    inputSchema: {
      type: "object" as const,
      properties: {
        entity_name: { type: "string", description: "Entity name" },
      },
      required: ["entity_name"],
    },
  },
  {
    name: "find_path_between_entities",
    description: "Find shortest path between two entities",
    inputSchema: {
      type: "object" as const,
      properties: {
        entity_a: { type: "string", description: "First entity" },
        entity_b: { type: "string", description: "Second entity" },
      },
      required: ["entity_a", "entity_b"],
    },
  },
  {
    name: "agent_query",
    description: "Ask a complex question using the full agent pipeline",
    inputSchema: {
      type: "object" as const,
      properties: {
        question: { type: "string", description: "The question to answer" },
      },
      required: ["question"],
    },
  },
];

export async function handleToolCall(
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  const reader = await getReader();

  switch (toolName) {
    case "find_entities": {
      const results = await reader.findEntities(
        args.name as string | undefined,
        args.entity_type as string | undefined,
        (args.limit as number) ?? 50,
      );
      return JSON.stringify(results, null, 2);
    }
    case "get_entity_profile": {
      const result = await reader.getEntityFullProfile(args.entity_name as string);
      return JSON.stringify(result, null, 2);
    }
    case "get_claims_about": {
      const results = await reader.getClaimsAbout(args.entity_name as string);
      return JSON.stringify(results, null, 2);
    }
    case "get_metric_history": {
      const results = await reader.getMetricHistory(
        args.metric_name as string,
        args.entity_name as string | undefined,
      );
      return JSON.stringify(results, null, 2);
    }
    case "find_evidence_for_claim": {
      const results = await reader.findEvidenceForClaim(args.claim_id as string);
      return JSON.stringify(results, null, 2);
    }
    case "find_related_entities": {
      const results = await reader.getEntityRelationships(args.entity_name as string);
      return JSON.stringify(results, null, 2);
    }
    case "find_path_between_entities": {
      const result = await reader.findPath(
        args.entity_a as string,
        args.entity_b as string,
      );
      return JSON.stringify(result, null, 2);
    }
    case "agent_query": {
      const settings = getSettings();
      const { Orchestrator } = await import("@insightgraph/agent-runtime");
      const { GraphRetriever, AgentTools } = await import("@insightgraph/retriever");
      const graphRetriever = new GraphRetriever(reader);
      const agentTools = new AgentTools(graphRetriever);
      const orchestrator = new Orchestrator(
        agentTools,
        settings.llmModel,
        settings.llmApiKey,
        settings.llmBaseUrl,
      );
      const response = await orchestrator.query(args.question as string);
      return JSON.stringify(response, null, 2);
    }
    default:
      return JSON.stringify({ error: `Unknown tool: ${toolName}` });
  }
}

export async function cleanup(): Promise<void> {
  if (_store) await _store.close();
}
