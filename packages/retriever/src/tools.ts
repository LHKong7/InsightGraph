import { GraphRetriever } from "./graph-retriever";
import { CrossReportAnalyzer } from "./cross-report";

// ------------------------------------------------------------------
// Tool definition type
// ------------------------------------------------------------------

export interface ToolDefinition {
  name: string;
  description: string;
  parameters_schema: Record<string, unknown>;
}

// ------------------------------------------------------------------
// AgentTools
// ------------------------------------------------------------------

/**
 * Agent-callable tool functions backed by graph retrieval.
 *
 * Provides 12 tool definitions and an execute() dispatcher.
 */
export class AgentTools {
  private graph: GraphRetriever;

  constructor(graphRetriever: GraphRetriever) {
    this.graph = graphRetriever;
  }

  /**
   * Return tool definitions for the agent runtime.
   */
  getToolDefinitions(): ToolDefinition[] {
    return [
      {
        name: "find_entities",
        description:
          "Find entities matching a name query and optional type filter. Returns a list of entities with their IDs, names, types, and descriptions.",
        parameters_schema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Name or search query for entities" },
            entity_type: { type: "string", description: "Filter by entity type" },
            report_id: { type: "string", description: "Filter by report ID" },
            limit: { type: "integer", description: "Max results to return", default: 50 },
          },
          required: [],
        },
      },
      {
        name: "get_claims_about",
        description:
          "Get all claims/assertions that mention a specific entity. Returns claims with their text, type, and confidence.",
        parameters_schema: {
          type: "object",
          properties: {
            entity_name: { type: "string", description: "Name of the entity" },
            claim_type: { type: "string", description: "Filter by claim type" },
          },
          required: ["entity_name"],
        },
      },
      {
        name: "get_metric_history",
        description:
          "Get historical values for a metric, optionally filtered by entity. Returns time-ordered metric values with periods and units.",
        parameters_schema: {
          type: "object",
          properties: {
            metric_name: { type: "string", description: "Name of the metric" },
            entity_name: { type: "string", description: "Filter by entity name" },
          },
          required: ["metric_name"],
        },
      },
      {
        name: "find_evidence_for_claim",
        description:
          "Find the source text spans that support a specific claim. Returns the original text with page numbers and character offsets.",
        parameters_schema: {
          type: "object",
          properties: {
            claim_id: { type: "string", description: "ID of the claim" },
          },
          required: ["claim_id"],
        },
      },
      {
        name: "get_subgraph_for_question",
        description:
          "Retrieve a relevant subgraph for answering an open-ended question. Finds matching entities and expands their neighborhood.",
        parameters_schema: {
          type: "object",
          properties: {
            question: {
              type: "string",
              description: "The question to find relevant context for",
            },
            max_depth: {
              type: "integer",
              description: "Max hops from matched entities",
              default: 2,
            },
          },
          required: ["question"],
        },
      },
      {
        name: "find_related_entities",
        description:
          "Find entities related to the given entity via graph relationships.",
        parameters_schema: {
          type: "object",
          properties: {
            entity_name: { type: "string", description: "Name of the entity" },
            relationship_type: { type: "string", description: "Filter by relationship type" },
          },
          required: ["entity_name"],
        },
      },
      {
        name: "find_path_between_entities",
        description:
          "Find the shortest path between two entities in the graph.",
        parameters_schema: {
          type: "object",
          properties: {
            entity_a: { type: "string", description: "Name of the first entity" },
            entity_b: { type: "string", description: "Name of the second entity" },
            max_depth: { type: "integer", description: "Maximum path length", default: 4 },
          },
          required: ["entity_a", "entity_b"],
        },
      },
      {
        name: "get_entity_profile",
        description:
          "Get comprehensive entity profile: claims, metrics, evidence, relationships.",
        parameters_schema: {
          type: "object",
          properties: {
            entity_name: { type: "string", description: "Name of the entity" },
          },
          required: ["entity_name"],
        },
      },
      {
        name: "compare_entity_across_reports",
        description:
          "Compare an entity's data across all reports it appears in.",
        parameters_schema: {
          type: "object",
          properties: {
            entity_name: { type: "string", description: "Name of the entity" },
          },
          required: ["entity_name"],
        },
      },
      {
        name: "find_metric_trend",
        description:
          "Find metric trend for an entity across reports.",
        parameters_schema: {
          type: "object",
          properties: {
            entity_name: { type: "string", description: "Name of the entity" },
            metric_name: { type: "string", description: "Name of the metric" },
          },
          required: ["entity_name", "metric_name"],
        },
      },
      {
        name: "find_contradictions",
        description:
          "Find contradicting claims about an entity.",
        parameters_schema: {
          type: "object",
          properties: {
            entity_name: { type: "string", description: "Name of the entity" },
          },
          required: ["entity_name"],
        },
      },
      {
        name: "entity_timeline",
        description:
          "Build chronological timeline of claims and metrics for an entity.",
        parameters_schema: {
          type: "object",
          properties: {
            entity_name: { type: "string", description: "Name of the entity" },
          },
          required: ["entity_name"],
        },
      },
    ];
  }

  /**
   * Execute a tool by name with the given arguments.
   */
  async execute(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    switch (toolName) {
      case "find_entities":
        return this.findEntities(args);
      case "get_claims_about":
        return this.getClaimsAbout(args);
      case "get_metric_history":
        return this.getMetricHistory(args);
      case "find_evidence_for_claim":
        return this.findEvidenceForClaim(args);
      case "get_subgraph_for_question":
        return this.getSubgraphForQuestion(args);
      case "find_related_entities":
        return this.findRelatedEntities(args);
      case "find_path_between_entities":
        return this.findPathBetweenEntities(args);
      case "get_entity_profile":
        return this.getEntityProfile(args);
      case "compare_entity_across_reports":
        return this.compareEntityAcrossReports(args);
      case "find_metric_trend":
        return this.findMetricTrend(args);
      case "find_contradictions":
        return this.findContradictions(args);
      case "entity_timeline":
        return this.entityTimeline(args);
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }

  // --- Handler implementations ---

  private async findEntities(args: Record<string, unknown>) {
    return this.graph.findEntities(
      args.name as string | undefined,
      args.entity_type as string | undefined,
      args.report_id as string | undefined,
      (args.limit as number) ?? 50,
    );
  }

  private async getClaimsAbout(args: Record<string, unknown>) {
    return this.graph.getClaimsAbout(
      args.entity_name as string,
      args.claim_type as string | undefined,
    );
  }

  private async getMetricHistory(args: Record<string, unknown>) {
    return this.graph.getMetricHistory(
      args.metric_name as string,
      args.entity_name as string | undefined,
    );
  }

  private async findEvidenceForClaim(args: Record<string, unknown>) {
    return this.graph.findEvidenceForClaim(args.claim_id as string);
  }

  private async getSubgraphForQuestion(args: Record<string, unknown>) {
    const question = args.question as string;
    const maxDepth = (args.max_depth as number) ?? 2;

    const entities = await this.graph.findEntities(question, undefined, undefined, 5);
    if (entities.length === 0) {
      return { nodes: [], edges: [] };
    }

    const topEntityId = (entities[0] as Record<string, unknown>).entity_id as string | undefined;
    if (topEntityId) {
      return this.graph.getSubgraph(topEntityId, maxDepth);
    }

    return { nodes: entities, edges: [] };
  }

  private async findRelatedEntities(args: Record<string, unknown>) {
    const entityName = args.entity_name as string;
    const relationshipType = args.relationship_type as string | undefined;

    let results = await this.graph._reader.getEntityRelationships(entityName);
    if (relationshipType) {
      results = results.filter((r) => r.relationship_type === relationshipType);
    }
    return results;
  }

  private async findPathBetweenEntities(args: Record<string, unknown>) {
    return this.graph._reader.findPath(
      args.entity_a as string,
      args.entity_b as string,
      (args.max_depth as number) ?? 4,
    );
  }

  private async getEntityProfile(args: Record<string, unknown>) {
    return this.graph._reader.getEntityFullProfile(args.entity_name as string);
  }

  private async compareEntityAcrossReports(args: Record<string, unknown>) {
    return this.graph._reader.getCrossReportEntity(args.entity_name as string);
  }

  private async findMetricTrend(args: Record<string, unknown>) {
    const analyzer = new CrossReportAnalyzer(this.graph._reader);
    return analyzer.findMetricTrend(
      args.entity_name as string,
      args.metric_name as string,
    );
  }

  private async findContradictions(args: Record<string, unknown>) {
    const analyzer = new CrossReportAnalyzer(this.graph._reader);
    return analyzer.findContradictions(args.entity_name as string);
  }

  private async entityTimeline(args: Record<string, unknown>) {
    const analyzer = new CrossReportAnalyzer(this.graph._reader);
    return analyzer.entityTimeline(args.entity_name as string);
  }
}
