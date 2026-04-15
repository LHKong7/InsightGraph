import * as fs from "fs";
import * as path from "path";
import { getDocumentProxy } from "unpdf";
import {
  createDocumentIR,
  createSectionNode,
  createBlock,
} from "@insightgraph/core";
import type {
  DocumentIR,
  Block,
  SectionNode,
  SourceSpan,
} from "@insightgraph/core";
import type { BaseParser } from "./base";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface TextBlock {
  text: string;
  page: number;
  startChar: number;
  endChar: number;
}

/**
 * Heuristic heading detection for plain-text extracted from PDF.
 *
 * A line is treated as a heading when it is:
 *   - Short (< 100 characters), AND
 *   - ALL-CAPS, or starts with a number followed by a dot/space pattern
 *     (e.g. "1. Introduction", "2.3 Methods").
 */
function isHeadingLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.length >= 100) {
    return false;
  }
  // All-caps heuristic (at least 3 alpha characters)
  const alphaOnly = trimmed.replace(/[^A-Za-z]/g, "");
  if (alphaOnly.length >= 3 && trimmed === trimmed.toUpperCase()) {
    return true;
  }
  // Numbered heading pattern: "1.", "1.2", "1.2.3" followed by space and text
  if (/^\d+(\.\d+)*\.?\s+\S/.test(trimmed)) {
    return true;
  }
  return false;
}

/**
 * Build a section hierarchy from a flat list of text blocks.
 *
 * Level 1 is the document-level section, level 2 is for detected headings.
 * Each paragraph becomes a Block with a sourceSpan recording page, startChar,
 * and endChar.
 */
function buildSectionTree(textBlocks: TextBlock[]): SectionNode[] {
  const rootSections: SectionNode[] = [];
  // Stack of (level, SectionNode)
  const stack: Array<{ level: number; section: SectionNode }> = [];
  let sectionOrder = 0;

  // Default top-level section for leading content
  const defaultSection = createSectionNode(0, sectionOrder);
  sectionOrder++;
  rootSections.push(defaultSection);
  stack.push({ level: 0, section: defaultSection });

  for (const tb of textBlocks) {
    if (isHeadingLine(tb.text)) {
      const level = 2; // All detected headings get level 2

      // Pop from stack until the top has a strictly smaller level
      while (stack.length > 0 && stack[stack.length - 1].level >= level) {
        stack.pop();
      }

      const headingBlock = createBlock("heading", tb.text, {
        page: tb.page,
        startChar: tb.startChar,
        endChar: tb.endChar,
        text: tb.text,
      }, { level });

      const newSection = createSectionNode(level, sectionOrder, {
        title: tb.text,
      });
      newSection.blocks.push(headingBlock);
      sectionOrder++;

      if (stack.length > 0) {
        stack[stack.length - 1].section.children.push(newSection);
      } else {
        rootSections.push(newSection);
      }

      stack.push({ level, section: newSection });
    } else {
      // Paragraph block – append to current (top-of-stack) section
      const block = createBlock("paragraph", tb.text, {
        page: tb.page,
        startChar: tb.startChar,
        endChar: tb.endChar,
        text: tb.text,
      });

      if (stack.length > 0) {
        stack[stack.length - 1].section.blocks.push(block);
      } else {
        rootSections[rootSections.length - 1].blocks.push(block);
      }
    }
  }

  // Remove the default section if it ended up empty
  if (
    rootSections.length > 0 &&
    rootSections[0].blocks.length === 0 &&
    rootSections[0].children.length === 0
  ) {
    rootSections.shift();
  }

  return rootSections;
}

// ---------------------------------------------------------------------------
// Public parser
// ---------------------------------------------------------------------------

/**
 * PDF parser backed by `unpdf`.
 *
 * Extracts text per page, detects headings via heuristics (short lines that
 * are ALL-CAPS or start with numbered patterns), and builds a section
 * hierarchy with paragraph blocks.
 */
export class PdfParser implements BaseParser {
  supportedFormats(): string[] {
    return ["pdf"];
  }

  async parse(filePath: string): Promise<DocumentIR> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`PDF file not found: ${filePath}`);
    }

    const ext = path.extname(filePath).toLowerCase();
    if (ext !== ".pdf") {
      throw new Error(`Unsupported file format: ${ext}`);
    }

    const buffer = fs.readFileSync(filePath);
    const data = new Uint8Array(buffer);
    const pdf = await getDocumentProxy(data);

    // ------------------------------------------------------------------
    // Extract text blocks from each page
    // ------------------------------------------------------------------
    const textBlocks: TextBlock[] = [];
    let charOffset = 0;

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();

      // Group items into lines by approximate y-coordinate
      const lines: Map<number, string[]> = new Map();
      for (const item of textContent.items) {
        if (!("str" in item) || !item.str.trim()) continue;
        // Round y to nearest integer to group items on the same line.
        // pdf.js types `transform` as `number[]`, but some items (notably
        // marked-content hints) don't include it — guard with isArray.
        const transform = (item as { transform?: unknown }).transform;
        const rawY =
          Array.isArray(transform) && typeof transform[5] === "number"
            ? transform[5]
            : 0;
        const y = Math.round(rawY);
        if (!lines.has(y)) {
          lines.set(y, []);
        }
        lines.get(y)!.push(item.str);
      }

      // Sort by y descending (PDF coordinates: top of page has higher y)
      const sortedYs = Array.from(lines.keys()).sort((a, b) => b - a);

      for (const y of sortedYs) {
        const lineText = lines.get(y)!.join(" ").trim();
        if (!lineText) continue;

        const startChar = charOffset;
        charOffset += lineText.length;
        const endChar = charOffset;

        textBlocks.push({
          text: lineText,
          page: pageNum,
          startChar,
          endChar,
        });
      }
    }

    // ------------------------------------------------------------------
    // Build section hierarchy
    // ------------------------------------------------------------------
    const sections = buildSectionTree(textBlocks);

    // ------------------------------------------------------------------
    // Assemble DocumentIR
    // ------------------------------------------------------------------
    const doc = createDocumentIR(path.basename(filePath), "pdf", {
      numPages: pdf.numPages,
    });
    doc.sections = sections;

    return doc;
  }
}
