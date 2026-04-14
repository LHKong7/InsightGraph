import { randomUUID } from "crypto";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import type {
  DocumentIR,
  ExtractionResult,
  SectionNode,
} from "@insightgraph/core";
import { FalkorGraphStore } from "../src/falkor/store";

/**
 * Live-server smoke test for the FalkorDB backend. This test is gated behind
 * `IG_RUN_FALKOR_TESTS=1` because it needs the `redis-server` + FalkorDB
 * binary that `falkordblite` downloads on first use — CI environments without
 * network or with pnpm's "ignored build scripts" policy won't have it.
 *
 * To run locally:
 *   IG_RUN_FALKOR_TESTS=1 pnpm vitest run packages/graph/test/falkor.test.ts
 *
 * We cover one happy path: open → ensureSchema → writeDocument → read back.
 * That's enough to verify wiring; deeper query coverage is exercised by the
 * SQLite test suite against the same GraphReader interface.
 */
const ENABLED = process.env.IG_RUN_FALKOR_TESTS === "1";

function makeDoc(reportId: string): DocumentIR {
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
    title: "Report A",
    authors: [],
    date: "2024-02-01",
    numPages: 10,
    parsedAt: new Date().toISOString(),
    sections: [section],
    metadata: {},
  };
}

function makeExtractions(doc: DocumentIR): ExtractionResult {
  const paraId = doc.sections[0].blocks[0].id;
  return {
    documentId: doc.id,
    entities: [
      {
        name: "Apple",
        type: "ORG",
        description: "Consumer electronics company",
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
        type: "financial" as unknown as ExtractionResult["claims"][number]["type"],
        entitiesMentioned: ["Apple"],
        confidence: 0.9,
        sourceBlockId: paraId,
        sourceText: "Apple reported $100B revenue",
      },
    ],
    relationships: [],
    resolvedEntities: [
      {
        canonicalName: "Apple",
        type: "ORG",
        description: "Consumer electronics company",
        aliases: ["AAPL"],
        sourceBlockIds: [paraId],
      },
    ],
  };
}

describe.skipIf(!ENABLED)("FalkorGraphStore (live server)", () => {
  it("writes a document and reads entities back", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "ig-falkor-"));
    const store = new FalkorGraphStore(tmp);
    try {
      await store.verifyConnectivity();
      await store.ensureSchema();

      const doc = makeDoc(randomUUID());
      const counts = await store.writer().writeDocument(doc, makeExtractions(doc));

      expect(counts.reports).toBe(1);
      expect(counts.entities).toBeGreaterThanOrEqual(1);
      expect(counts.claims).toBe(1);

      const reports = await store.reader().listReports();
      expect(reports.length).toBe(1);

      const entities = await store.reader().findEntities(undefined, "ORG");
      expect(entities.length).toBe(1);
      const row = entities[0] as { entity: Record<string, unknown> };
      expect(row.entity.canonical_name).toBe("Apple");
    } finally {
      await store.close();
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 30_000);
});
