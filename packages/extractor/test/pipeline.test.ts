import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { Block, DocumentIR } from "@insightgraph/core";
import * as core from "@insightgraph/core";

import { ExtractionPipeline } from "../src/pipeline";

/**
 * Verifies that phase 1 (entities + metrics + claims) actually runs in
 * parallel and that the per-extractor concurrency limit is respected.
 *
 * We stub `chatJSON` with a fake that:
 *   1. Tracks how many calls are in flight at any moment.
 *   2. Resolves after a short delay so overlapping is observable.
 *
 * If the pipeline were still sequential, we'd see at most `maxConcurrency`
 * calls in flight (4 by default). With the parallelization, we expect up to
 * `3 * maxConcurrency` (one "slot" per category) during phase 1.
 */
describe("ExtractionPipeline parallelism", () => {
  let inFlight = 0;
  let peakInFlight = 0;
  let totalCalls = 0;

  beforeEach(() => {
    inFlight = 0;
    peakInFlight = 0;
    totalCalls = 0;

    vi.spyOn(core, "chatJSON").mockImplementation(async () => {
      totalCalls++;
      inFlight++;
      peakInFlight = Math.max(peakInFlight, inFlight);
      // Sleep long enough that overlapping is guaranteed to be observable.
      await new Promise((r) => setTimeout(r, 15));
      inFlight--;
      // Return a minimal but valid JSON shape for every extractor prompt.
      // Each extractor tolerates missing keys (falls through to `?? []`).
      return JSON.stringify({
        entities: [],
        metrics: [],
        claims: [],
        relationships: [],
      });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeDoc(blockCount: number): DocumentIR {
    const blocks: Block[] = Array.from({ length: blockCount }, (_, i) => ({
      id: `b${i}`,
      type: "paragraph",
      content: `Block ${i} text with value ${i * 100}.`,
      sourceSpan: {
        page: 1,
        startChar: 0,
        endChar: 40,
        text: `Block ${i}`,
      },
      metadata: {},
    }));
    return {
      id: "doc1",
      sourceFilename: "fixture.pdf",
      sourceFormat: "pdf",
      title: "Fixture",
      authors: [],
      date: "2024-01-01",
      numPages: 1,
      parsedAt: new Date().toISOString(),
      sections: [
        {
          id: "s1",
          title: "Only",
          level: 1,
          order: 0,
          blocks,
          children: [],
        },
      ],
      metadata: {},
    };
  }

  it("runs entities + metrics + claims concurrently", async () => {
    // 20 blocks / batchSize 5 = 4 batches per extractor. With 3 extractors in
    // parallel each capped at concurrency 4, we expect up to 12 simultaneous
    // LLM calls in phase 1.
    const pipeline = new ExtractionPipeline(
      "fake-model",
      "fake-key",
      "",
      undefined,
      { batchSize: 5, maxConcurrency: 4 },
    );
    const doc = makeDoc(20);

    await pipeline.extract(doc);

    // 3 categories × 4 batches (ent/claim) + 4 numeric batches (metric) +
    // relationship extraction returns early because we have 0 entities in
    // this fixture → only 3 × 4 = 12 phase-1 calls.
    expect(totalCalls).toBe(12);

    // If the three categories were serialized, peakInFlight would be ≤ 4.
    // With parallel phase 1 it must exceed 4.
    expect(peakInFlight).toBeGreaterThan(4);
  });

  it("honors smaller maxConcurrency setting", async () => {
    const pipeline = new ExtractionPipeline(
      "fake-model",
      "fake-key",
      "",
      undefined,
      { batchSize: 5, maxConcurrency: 1 },
    );
    const doc = makeDoc(20);

    await pipeline.extract(doc);

    // With maxConcurrency=1 per extractor and 3 categories running in parallel,
    // the peak should be exactly 3 (one slot per category).
    expect(peakInFlight).toBeLessThanOrEqual(3);
  });

  it("skips relationship extraction when no entities found", async () => {
    const pipeline = new ExtractionPipeline(
      "fake-model",
      "fake-key",
      "",
      undefined,
      { batchSize: 5, maxConcurrency: 4 },
    );
    const doc = makeDoc(20);

    await pipeline.extract(doc);

    // Only 12 phase-1 calls — zero for relationships, since our mocked LLM
    // returns no entities and the extractor short-circuits empty entity lists.
    expect(totalCalls).toBe(12);
  });
});
