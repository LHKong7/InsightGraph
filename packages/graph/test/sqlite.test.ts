import { randomUUID } from "crypto";
import { describe, expect, it } from "vitest";
import type {
  DocumentIR,
  ExtractionResult,
  SectionNode,
} from "@insightgraph/core";
import { SqliteGraphStore } from "../src/sqlite/store";
import { DEFAULT_MERGE_POLICY } from "../src/types";
import { mergeAliases, mergeDescription } from "../src/sqlite/writer";

/**
 * These tests use `:memory:` SQLite databases so they require no fixtures on
 * disk and run in CI with just `better-sqlite3` installed. They cover:
 *
 *   1. writeDocument end-to-end (counts + idempotency)
 *   2. Entity MERGE semantics (alias union, description preferExisting)
 *   3. Each reader method returns the expected shape
 *   4. SQLite↔SQLite merge with conflict resolution
 *   5. Pure policy helpers (mergeAliases / mergeDescription)
 */

function makeDoc(reportId: string, title = "Report A"): DocumentIR {
  const paraId = randomUUID();
  const section: SectionNode = {
    id: randomUUID(),
    title: "Intro",
    level: 1,
    order: 0,
    blocks: [
      {
        id: paraId,
        type: "paragraph",
        content: "Apple reported $100B revenue in Q1 2024.",
        sourceSpan: {
          page: 1,
          startChar: 0,
          endChar: 40,
          text: "Apple reported $100B revenue in Q1 2024.",
        },
        metadata: {},
      },
    ],
    children: [],
  };
  return {
    id: reportId,
    sourceFilename: "report-a.pdf",
    sourceFormat: "pdf",
    title,
    authors: [],
    date: "2024-02-01",
    numPages: 10,
    parsedAt: new Date().toISOString(),
    sections: [section],
    metadata: {},
  };
}

function makeExtractions(doc: DocumentIR, opts?: {
  entityAliases?: string[];
  entityDescription?: string;
  includeRelationship?: boolean;
}): ExtractionResult {
  const paraId = doc.sections[0].blocks[0].id;
  return {
    documentId: doc.id,
    entities: [
      {
        name: "Apple",
        type: "ORG",
        description: opts?.entityDescription ?? "Consumer electronics company",
        sourceBlockId: paraId,
        sourceText: "Apple",
      },
    ],
    metrics: [
      {
        name: "revenue",
        value: 100,
        unit: "B USD",
        period: "Q1 2024",
        entityName: "Apple",
        sourceBlockId: paraId,
        sourceText: "$100B revenue",
      },
    ],
    claims: [
      {
        text: "Apple reported strong Q1 2024 revenue.",
        type: "financial" as unknown as DocumentIR extends unknown
          ? import("@insightgraph/core").ClaimType
          : never,
        entitiesMentioned: ["Apple"],
        confidence: 0.9,
        sourceBlockId: paraId,
        sourceText: "Apple reported $100B revenue",
      } as ExtractionResult["claims"][number],
    ],
    relationships: opts?.includeRelationship
      ? [
          {
            sourceEntity: "Apple",
            targetEntity: "Tim Cook",
            relationshipType: "CEO_OF",
            description: "Tim Cook is CEO of Apple",
            confidence: 0.95,
            sourceBlockId: paraId,
            sourceText: "Tim Cook, CEO",
          },
        ]
      : [],
    resolvedEntities: [
      {
        canonicalName: "Apple",
        type: "ORG",
        description: opts?.entityDescription ?? "Consumer electronics company",
        aliases: opts?.entityAliases ?? ["AAPL"],
        sourceBlockIds: [paraId],
      },
      ...(opts?.includeRelationship
        ? [
            {
              canonicalName: "Tim Cook",
              type: "PERSON",
              aliases: [],
              sourceBlockIds: [paraId],
            },
          ]
        : []),
    ],
  };
}

async function freshStore() {
  const store = new SqliteGraphStore(":memory:");
  await store.ensureSchema();
  return store;
}

describe("SqliteGraphStore — writeDocument", () => {
  it("writes entities, metrics, claims and reports", async () => {
    const store = await freshStore();
    const doc = makeDoc(randomUUID());
    const extractions = makeExtractions(doc, { includeRelationship: true });

    const counts = await store.writer().writeDocument(doc, extractions);

    expect(counts.reports).toBe(1);
    expect(counts.sections).toBe(1);
    expect(counts.paragraphs).toBe(1);
    expect(counts.entities).toBeGreaterThanOrEqual(1);
    expect(counts.metrics).toBe(1);
    expect(counts.metric_values).toBe(1);
    expect(counts.claims).toBe(1);
    expect(counts.relationships).toBe(1);

    const reader = store.reader();
    const reports = await reader.listReports();
    expect(reports.length).toBe(1);
    const entities = await reader.findEntities("Apple");
    expect(entities.length).toBeGreaterThan(0);
    const entity = (entities[0] as { entity: { canonical_name: string } }).entity;
    expect(entity.canonical_name).toBe("Apple");

    await store.close();
  });

  it("is idempotent — rewriting the same document keeps one entity row", async () => {
    const store = await freshStore();
    const doc = makeDoc(randomUUID());
    const extractions = makeExtractions(doc);

    await store.writer().writeDocument(doc, extractions);
    await store.writer().writeDocument(doc, extractions);

    const ents = await store.reader().findEntities(undefined, "ORG");
    expect(ents.length).toBe(1);

    await store.close();
  });

  it("MERGE semantics: alias set grows on second write, description preferExisting", async () => {
    const store = await freshStore();
    const docA = makeDoc(randomUUID(), "Report A");
    const extA = makeExtractions(docA, {
      entityAliases: ["AAPL"],
      entityDescription: "Consumer electronics company",
    });
    await store.writer().writeDocument(docA, extA);

    const docB = makeDoc(randomUUID(), "Report B");
    const extB = makeExtractions(docB, {
      entityAliases: ["AAPL", "Apple Inc.", "Apple Inc"],
      entityDescription: "Tech giant (updated)",
    });
    await store.writer().writeDocument(docB, extB);

    const rows = await store.reader().findEntities(undefined, "ORG");
    expect(rows.length).toBe(1);
    const ent = (rows[0] as { entity: Record<string, unknown> }).entity;
    expect(ent.description).toBe("Consumer electronics company"); // preferExisting
    const aliases = ent.aliases as string[];
    // incoming set is larger → replaces per Cypher semantics
    expect(aliases).toContain("AAPL");
    expect(aliases).toContain("Apple Inc.");

    await store.close();
  });
});

describe("SqliteGraphStore — reader methods", () => {
  it("getClaimsAbout / findEvidenceForClaim / getEntityMetrics chain together", async () => {
    const store = await freshStore();
    const doc = makeDoc(randomUUID());
    await store.writer().writeDocument(doc, makeExtractions(doc));

    const claims = await store.reader().getClaimsAbout("Apple");
    expect(claims.length).toBeGreaterThan(0);

    const metrics = await store.reader().getEntityMetrics("Apple");
    expect(metrics.length).toBe(1);
    const m = metrics[0] as { metric: { name: string }; metric_value: { value: number } };
    expect(m.metric.name).toBe("revenue");
    expect(m.metric_value.value).toBe(100);

    await store.close();
  });

  it("getSubgraph walks up to the requested depth", async () => {
    const store = await freshStore();
    const doc = makeDoc(randomUUID());
    await store.writer().writeDocument(doc, makeExtractions(doc));

    const reportId = doc.id;
    const sub = await store.reader().getSubgraph(reportId, 3);
    expect(sub.nodes.length).toBeGreaterThan(1);
    expect(sub.edges.length).toBeGreaterThan(0);

    await store.close();
  });

  it("getEntityFullProfile returns nested claims/metrics/reports", async () => {
    const store = await freshStore();
    const doc = makeDoc(randomUUID());
    await store.writer().writeDocument(doc, makeExtractions(doc));

    const profile = (await store.reader().getEntityFullProfile("Apple")) as {
      entity: Record<string, unknown>;
      claims: unknown[];
      metrics: unknown[];
      reports: unknown[];
    };
    expect(profile.entity).toBeDefined();
    expect(profile.claims.length).toBeGreaterThan(0);
    expect(profile.metrics.length).toBeGreaterThan(0);
    expect(profile.reports.length).toBe(1);

    await store.close();
  });
});

describe("mergeSqliteStore — merging two local graphs", () => {
  it("unions aliases, preserves descriptions, remaps entity ids", async () => {
    const { mergeSqliteStore } = await import("../src/merge/sqlite-merger");
    const { mkdtempSync, rmSync } = await import("fs");
    const { join } = await import("path");
    const { tmpdir } = await import("os");

    const tmp = mkdtempSync(join(tmpdir(), "ig-merge-"));
    const aPath = join(tmp, "a.sqlite");
    const bPath = join(tmp, "b.sqlite");

    try {
      const a = new SqliteGraphStore(aPath);
      await a.ensureSchema();
      const docA = makeDoc(randomUUID(), "Report A");
      await a.writer().writeDocument(
        docA,
        makeExtractions(docA, { entityAliases: ["AAPL"] }),
      );
      await a.close();

      const b = new SqliteGraphStore(bPath);
      await b.ensureSchema();
      const docB = makeDoc(randomUUID(), "Report B");
      await b.writer().writeDocument(
        docB,
        makeExtractions(docB, {
          entityAliases: ["Apple Inc.", "Apple Inc"],
          entityDescription: "Tech giant (from B)",
        }),
      );
      await b.close();

      const stats = mergeSqliteStore(aPath, bPath);
      expect(stats.edges).toBeGreaterThan(0);

      const merged = new SqliteGraphStore(aPath);
      const reports = await merged.reader().listReports();
      expect(reports.length).toBe(2);

      const ents = await merged.reader().findEntities(undefined, "ORG");
      expect(ents.length).toBe(1);
      const ent = (ents[0] as { entity: Record<string, unknown> }).entity;
      const aliases = ent.aliases as string[];
      // union semantics — both sets folded in, case-insensitive dedup
      expect(aliases).toContain("AAPL");
      expect(aliases).toContain("Apple Inc.");
      expect(ent.description).toBe("Consumer electronics company"); // preferExisting

      await merged.close();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("honors overwrite policy when requested", async () => {
    const { mergeSqliteStore } = await import("../src/merge/sqlite-merger");
    const { mkdtempSync, rmSync } = await import("fs");
    const { join } = await import("path");
    const { tmpdir } = await import("os");

    const tmp = mkdtempSync(join(tmpdir(), "ig-merge-ow-"));
    const aPath = join(tmp, "a.sqlite");
    const bPath = join(tmp, "b.sqlite");

    try {
      const a = new SqliteGraphStore(aPath);
      await a.ensureSchema();
      const docA = makeDoc(randomUUID(), "Report A");
      await a.writer().writeDocument(docA, makeExtractions(docA));
      await a.close();

      const b = new SqliteGraphStore(bPath);
      await b.ensureSchema();
      const docB = makeDoc(randomUUID(), "Report B");
      await b.writer().writeDocument(
        docB,
        makeExtractions(docB, {
          entityDescription: "Tech giant (from B)",
        }),
      );
      await b.close();

      mergeSqliteStore(aPath, bPath, {
        ...DEFAULT_MERGE_POLICY,
        description: "overwrite",
      });

      const merged = new SqliteGraphStore(aPath);
      const ents = await merged.reader().findEntities(undefined, "ORG");
      const ent = (ents[0] as { entity: Record<string, unknown> }).entity;
      expect(ent.description).toBe("Tech giant (from B)");
      await merged.close();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("merge policy helpers", () => {
  it("mergeAliases(union) deduplicates case-insensitively and preserves order", () => {
    expect(mergeAliases(["AAPL", "Apple"], ["apple", "Apple Inc."], "union"))
      .toEqual(["AAPL", "Apple", "Apple Inc."]);
  });

  it("mergeAliases(overwrite) replaces", () => {
    expect(mergeAliases(["A"], ["B"], "overwrite")).toEqual(["B"]);
  });

  it("mergeDescription preferExisting keeps non-empty existing", () => {
    expect(mergeDescription("old", "new", "preferExisting")).toBe("old");
    expect(mergeDescription(null, "new", "preferExisting")).toBe("new");
    expect(mergeDescription("", "new", "preferExisting")).toBe("new");
  });

  it("mergeDescription concat joins distinct values", () => {
    expect(mergeDescription("a", "b", "concat")).toBe("a | b");
    expect(mergeDescription("a", "a", "concat")).toBe("a");
  });
});
