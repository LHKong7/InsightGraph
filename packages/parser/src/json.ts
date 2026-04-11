import * as fs from "fs";
import * as path from "path";
import {
  createDocumentIR,
  createSectionNode,
  createBlock,
} from "@insightgraph/core";
import type { DocumentIR, SourceSpan } from "@insightgraph/core";
import type { BaseParser } from "./base";

/**
 * JSON parser that converts JSON files into DocumentIR.
 *
 * Supports three top-level shapes:
 *
 * - **Array of objects**: each object becomes a `data_row` block inside a
 *   single section, similar to {@link CsvParser}.
 * - **Single object**: each top-level key becomes its own section. Scalar
 *   values produce a paragraph block; nested objects/arrays are serialised
 *   to indented JSON text.
 * - **Scalar**: wrapped in a single paragraph block.
 */
export class JsonParser implements BaseParser {
  supportedFormats(): string[] {
    return ["json"];
  }

  async parse(filePath: string): Promise<DocumentIR> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const raw = fs.readFileSync(filePath, "utf-8");
    const data: unknown = JSON.parse(raw);
    const stem = path.basename(filePath, path.extname(filePath));
    const filename = path.basename(filePath);

    if (Array.isArray(data)) {
      return this.parseArray(data, filename, stem);
    }
    if (data !== null && typeof data === "object") {
      return this.parseObject(data as Record<string, unknown>, filename, stem);
    }
    return this.parseScalar(data, filename, stem);
  }

  // ------------------------------------------------------------------
  // Internal helpers
  // ------------------------------------------------------------------

  private parseArray(
    items: unknown[],
    filename: string,
    stem: string,
  ): DocumentIR {
    const section = createSectionNode(1, 0, { title: stem });
    const headers: string[] = [];

    for (let rowIdx = 0; rowIdx < items.length; rowIdx++) {
      const item = items[rowIdx];
      let rowText: string;
      let metadata: Record<string, unknown>;

      if (item !== null && typeof item === "object" && !Array.isArray(item)) {
        const dict = item as Record<string, unknown>;
        if (rowIdx === 0) {
          headers.push(...Object.keys(dict));
        }
        rowText = Object.entries(dict)
          .filter(([, v]) => v != null)
          .map(([k, v]) => `${k}: ${v}`)
          .join(", ");
        metadata = Object.fromEntries(
          Object.entries(dict).map(([k, v]) => [
            k,
            v != null ? String(v) : "",
          ]),
        );
      } else {
        rowText = String(item);
        metadata = { value: rowText };
      }

      const span: SourceSpan = {
        page: 1,
        startChar: rowIdx * 100,
        endChar: (rowIdx + 1) * 100,
        text: rowText,
      };

      section.blocks.push(
        createBlock("data_row", rowText, span, { metadata }),
      );
    }

    const doc = createDocumentIR(filename, "json", {
      title: stem,
      numPages: 1,
      metadata: {
        structure: "array",
        row_count: items.length,
        headers,
      },
    });
    doc.sections = [section];
    return doc;
  }

  private parseObject(
    data: Record<string, unknown>,
    filename: string,
    stem: string,
  ): DocumentIR {
    const sections: import("@insightgraph/core").SectionNode[] = [];
    let order = 0;

    for (const [key, value] of Object.entries(data)) {
      const content =
        typeof value === "object" && value !== null
          ? JSON.stringify(value, null, 2)
          : String(value);

      const span: SourceSpan = {
        page: 1,
        startChar: order * 200,
        endChar: (order + 1) * 200,
        text: content.slice(0, 200),
      };

      const block = createBlock("paragraph", content, span, {
        metadata: { key },
      });

      const section = createSectionNode(1, order, { title: key });
      section.blocks.push(block);
      sections.push(section);
      order++;
    }

    const doc = createDocumentIR(filename, "json", {
      title: stem,
      numPages: 1,
      metadata: {
        structure: "object",
        keys: Object.keys(data),
      },
    });
    doc.sections = sections;
    return doc;
  }

  private parseScalar(
    data: unknown,
    filename: string,
    stem: string,
  ): DocumentIR {
    const content = String(data);
    const span: SourceSpan = {
      page: 1,
      startChar: 0,
      endChar: content.length,
      text: content,
    };

    const block = createBlock("paragraph", content, span);
    const section = createSectionNode(1, 0, { title: stem });
    section.blocks.push(block);

    const doc = createDocumentIR(filename, "json", {
      title: stem,
      numPages: 1,
      metadata: { structure: "scalar" },
    });
    doc.sections = [section];
    return doc;
  }
}
