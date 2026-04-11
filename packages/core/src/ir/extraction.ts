import type { ClaimType } from "../types";

export interface ExtractedEntity {
  name: string;
  type: string;
  description?: string;
  sourceBlockId: string;
  sourceText: string;
}

export interface ExtractedMetric {
  name: string;
  value: number;
  unit?: string;
  period?: string;
  entityName?: string;
  sourceBlockId: string;
  sourceText: string;
}

export interface ExtractedClaim {
  text: string;
  type: ClaimType;
  entitiesMentioned: string[];
  confidence: number;
  sourceBlockId: string;
  sourceText: string;
}

export interface ExtractedRelationship {
  sourceEntity: string;
  targetEntity: string;
  relationshipType: string;
  description: string;
  confidence: number;
  sourceBlockId: string;
  sourceText: string;
}

export interface ResolvedEntity {
  canonicalName: string;
  type: string;
  description?: string;
  aliases: string[];
  sourceBlockIds: string[];
}

export interface ExtractionResult {
  documentId: string;
  entities: ExtractedEntity[];
  metrics: ExtractedMetric[];
  claims: ExtractedClaim[];
  relationships: ExtractedRelationship[];
  resolvedEntities: ResolvedEntity[];
}
