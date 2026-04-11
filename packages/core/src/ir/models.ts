import { randomUUID } from "crypto";
import type { BlockType } from "../types";

export interface SourceSpan {
  page: number;
  startChar: number;
  endChar: number;
  text: string;
}

export interface TableCell {
  row: number;
  col: number;
  text: string;
  isHeader: boolean;
}

export interface Block {
  id: string;
  type: BlockType;
  content: string;
  sourceSpan: SourceSpan;
  level?: number;
  metadata: Record<string, unknown>;
}

export interface TableBlock extends Block {
  type: "table";
  cells: TableCell[];
  caption?: string;
}

export interface SectionNode {
  id: string;
  title?: string;
  level: number;
  order: number;
  blocks: Block[];
  children: SectionNode[];
}

export interface DocumentIR {
  id: string;
  sourceFilename: string;
  sourceFormat: string;
  title?: string;
  authors: string[];
  date?: string;
  numPages: number;
  parsedAt: string;
  sections: SectionNode[];
  metadata: Record<string, unknown>;
}

// --- Factory helpers ---

export function createBlock(
  type: BlockType,
  content: string,
  sourceSpan: SourceSpan,
  opts?: { level?: number; metadata?: Record<string, unknown> },
): Block {
  return {
    id: randomUUID(),
    type,
    content,
    sourceSpan,
    level: opts?.level,
    metadata: opts?.metadata ?? {},
  };
}

export function createSectionNode(
  level: number,
  order: number,
  opts?: { title?: string },
): SectionNode {
  return {
    id: randomUUID(),
    title: opts?.title,
    level,
    order,
    blocks: [],
    children: [],
  };
}

export function createDocumentIR(
  sourceFilename: string,
  sourceFormat: string,
  opts?: Partial<Pick<DocumentIR, "title" | "authors" | "date" | "numPages" | "metadata">>,
): DocumentIR {
  return {
    id: randomUUID(),
    sourceFilename,
    sourceFormat,
    title: opts?.title,
    authors: opts?.authors ?? [],
    date: opts?.date,
    numPages: opts?.numPages ?? 0,
    parsedAt: new Date().toISOString(),
    sections: [],
    metadata: opts?.metadata ?? {},
  };
}

// --- Iteration helpers ---

export function* iterTextBlocks(
  doc: DocumentIR,
): Generator<[SectionNode, Block]> {
  function* walk(section: SectionNode): Generator<[SectionNode, Block]> {
    for (const block of section.blocks) {
      yield [section, block];
    }
    for (const child of section.children) {
      yield* walk(child);
    }
  }
  for (const section of doc.sections) {
    yield* walk(section);
  }
}

export function* iterAllBlocks(doc: DocumentIR): Generator<Block> {
  for (const [, block] of iterTextBlocks(doc)) {
    yield block;
  }
}

export function fullText(doc: DocumentIR): string {
  return Array.from(iterAllBlocks(doc))
    .map((b) => b.content)
    .join("\n");
}
