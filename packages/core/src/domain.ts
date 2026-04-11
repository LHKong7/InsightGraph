import { readFileSync, existsSync } from "fs";
import { parse as parseYaml } from "yaml";

export interface DomainConfig {
  name: string;
  description: string;
  entityTypes: string[];
  relationshipTypes: string[];
  extractionInstructions: string;
  exampleEntities: Record<string, unknown>[];
  exampleRelationships: Record<string, unknown>[];
}

export const STOCK_DOMAIN: DomainConfig = {
  name: "stock_analysis",
  description: "Stock market news and price movement analysis",
  entityTypes: [
    "STOCK", "COMPANY", "NEWS_EVENT", "PRICE_MOVEMENT",
    "SECTOR", "MARKET_INDEX", "PERSON", "POLICY",
  ],
  relationshipTypes: [
    "CAUSES_PRICE_CHANGE", "AFFECTS_SECTOR", "REPORTED_BY", "TRIGGERS",
    "CORRELATES_WITH", "HEDGES_AGAINST", "BELONGS_TO_SECTOR", "COMPETES_WITH",
  ],
  extractionInstructions:
    "You are analyzing stock market news and price data. Extract:\n" +
    "- STOCK entities (ticker symbols, company names)\n" +
    "- NEWS_EVENT entities (earnings reports, product launches, regulatory changes)\n" +
    "- PRICE_MOVEMENT entities (price increases/decreases with percentages)\n" +
    "- Causal relationships: which news events caused which price movements\n" +
    "- Focus on identifying CAUSES_PRICE_CHANGE and TRIGGERS relationships",
  exampleEntities: [
    { name: "AAPL", type: "STOCK", description: "Apple Inc. stock" },
    { name: "iPhone 16 Launch", type: "NEWS_EVENT", description: "Product launch event" },
    { name: "+5.2%", type: "PRICE_MOVEMENT", description: "Stock price increase" },
  ],
  exampleRelationships: [
    {
      source: "iPhone 16 Launch", target: "+5.2%",
      type: "CAUSES_PRICE_CHANGE", description: "Product launch drove stock up",
    },
  ],
};

export const RESTAURANT_DOMAIN: DomainConfig = {
  name: "restaurant_analysis",
  description: "Restaurant operations, dish performance, and customer traffic analysis",
  entityTypes: [
    "RESTAURANT", "DISH", "INGREDIENT", "CUSTOMER_SEGMENT",
    "LOCATION", "PROMOTION", "SEASON", "COMPETITOR",
  ],
  relationshipTypes: [
    "DRIVES_TRAFFIC", "REDUCES_TRAFFIC", "PAIRS_WITH", "SUBSTITUTES_FOR",
    "POPULAR_WITH", "SEASONAL_IN", "COMPETES_WITH", "SERVED_AT",
  ],
  extractionInstructions:
    "You are analyzing restaurant reports. Extract:\n" +
    "- DISH entities (menu items, food categories)\n" +
    "- CUSTOMER_SEGMENT entities (demographics, dining preferences)\n" +
    "- RESTAURANT entities (restaurant names, chains)\n" +
    "- Relationships: which dishes drive customer traffic, which segments prefer which dishes\n" +
    "- Focus on DRIVES_TRAFFIC and POPULAR_WITH relationships",
  exampleEntities: [
    { name: "Truffle Burger", type: "DISH", description: "Premium burger item" },
    { name: "Weekend Families", type: "CUSTOMER_SEGMENT", description: "Family diners on weekends" },
  ],
  exampleRelationships: [
    {
      source: "Truffle Burger", target: "Weekend Families",
      type: "DRIVES_TRAFFIC", description: "Popular item that attracts family diners",
    },
  ],
};

export const DEFAULT_DOMAIN: DomainConfig = {
  name: "default",
  description: "General-purpose report analysis",
  entityTypes: [
    "ORGANIZATION", "PERSON", "LOCATION", "PRODUCT",
    "INDUSTRY", "EVENT", "OTHER",
  ],
  relationshipTypes: [
    "SUBSIDIARY_OF", "CEO_OF", "FOUNDER_OF", "BOARD_MEMBER_OF",
    "COMPETES_WITH", "PARTNERS_WITH", "INVESTED_IN", "SUPPLIES_TO",
    "ACQUIRED", "MERGED_WITH", "REGULATES", "OPERATES_IN", "EMPLOYS",
  ],
  extractionInstructions: "",
  exampleEntities: [],
  exampleRelationships: [],
};

const BUILTIN_DOMAINS: Record<string, DomainConfig> = {
  stock_analysis: STOCK_DOMAIN,
  restaurant_analysis: RESTAURANT_DOMAIN,
};

export function loadDomainConfig(nameOrPath: string): DomainConfig {
  if (nameOrPath === "default") return DEFAULT_DOMAIN;
  if (nameOrPath in BUILTIN_DOMAINS) return BUILTIN_DOMAINS[nameOrPath];

  if (existsSync(nameOrPath)) {
    const raw = readFileSync(nameOrPath, "utf-8");
    const data = parseYaml(raw) as Record<string, unknown>;
    return {
      name: (data.name as string) ?? "custom",
      description: (data.description as string) ?? "",
      entityTypes: (data.entity_types as string[]) ?? [],
      relationshipTypes: (data.relationship_types as string[]) ?? [],
      extractionInstructions: (data.extraction_instructions as string) ?? "",
      exampleEntities: (data.example_entities as Record<string, unknown>[]) ?? [],
      exampleRelationships: (data.example_relationships as Record<string, unknown>[]) ?? [],
    };
  }

  return { ...DEFAULT_DOMAIN, name: "default" };
}
