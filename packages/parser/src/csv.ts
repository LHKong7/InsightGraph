import * as fs from "fs";
import * as path from "path";
import { parse as csvParse } from "csv-parse/sync";
import {
  createDocumentIR,
  createSectionNode,
  createBlock,
} from "@insightgraph/core";
import type { DocumentIR, SourceSpan } from "@insightgraph/core";
import type { BaseParser } from "./base";

/**
 * CSV parser that converts tabular data into DocumentIR.
 *
 * Each row becomes a Block of type `data_row`. The first row is treated as
 * column headers. A single section contains all row blocks.
 */
export class CsvParser implements BaseParser {
  supportedFormats(): string[] {
    return ["csv"];
  }

  async parse(filePath: string): Promise<DocumentIR> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const raw = fs.readFileSync(filePath, "utf-8");
    const records: Record<string, string>[] = csvParse(raw, {
      columns: true,
      skip_empty_lines: true,
    });

    // Derive headers from the first record's keys
    const headers: string[] =
      records.length > 0 ? Object.keys(records[0]) : [];

    const section = createSectionNode(1, 0, {
      title: path.basename(filePath, path.extname(filePath)),
    });

    for (let rowIdx = 0; rowIdx < records.length; rowIdx++) {
      const row = records[rowIdx];
      const rowText = Object.entries(row)
        .filter(([, v]) => v)
        .map(([k, v]) => `${k}: ${v}`)
        .join(", ");

      const span: SourceSpan = {
        page: 1,
        startChar: rowIdx * 100,
        endChar: (rowIdx + 1) * 100,
        text: rowText,
      };

      const block = createBlock("data_row", rowText, span, {
        metadata: { ...row },
      });
      section.blocks.push(block);
    }

    const stem = path.basename(filePath, path.extname(filePath));
    const doc = createDocumentIR(path.basename(filePath), "csv", {
      title: stem,
      numPages: 1,
      metadata: {
        headers,
        row_count: records.length,
      },
    });
    doc.sections = [section];

    return doc;
  }
}
