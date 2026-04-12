import * as fs from "fs";
import * as path from "path";
import {
  createDocumentIR,
  createSectionNode,
  createBlock,
} from "@insightgraph/core";
import type { DocumentIR, SectionNode, SourceSpan } from "@insightgraph/core";
import type { BaseParser } from "./base";

/**
 * XLSX parser that converts Excel files into DocumentIR.
 *
 * Each worksheet becomes a section. Rows become `data_row` blocks with the
 * first row used as column headers. Supports .xlsx and .xls formats.
 */
export class XlsxParser implements BaseParser {
  supportedFormats(): string[] {
    return ["xlsx", "xls"];
  }

  async parse(filePath: string): Promise<DocumentIR> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const XLSX = await import("xlsx");
    const workbook = XLSX.readFile(filePath);

    const stem = path.basename(filePath, path.extname(filePath));
    const filename = path.basename(filePath);
    const ext = path.extname(filePath).replace(/^\./, "");

    const sections: SectionNode[] = [];

    for (let sheetIdx = 0; sheetIdx < workbook.SheetNames.length; sheetIdx++) {
      const sheetName = workbook.SheetNames[sheetIdx];
      const worksheet = workbook.Sheets[sheetName];

      const rows: unknown[][] = XLSX.utils.sheet_to_json(worksheet, {
        header: 1,
        defval: "",
      });

      if (rows.length === 0) continue;

      const section = createSectionNode(1, sheetIdx, { title: sheetName });

      // First row as headers
      const headers = rows[0].map((h) => String(h ?? "").trim());

      for (let rowIdx = 1; rowIdx < rows.length; rowIdx++) {
        const row = rows[rowIdx] as unknown[];
        // Skip completely empty rows
        if (row.every((cell) => !String(cell ?? "").trim())) continue;

        const pairs: string[] = [];
        const metadata: Record<string, string> = {};
        for (let colIdx = 0; colIdx < headers.length; colIdx++) {
          const key = headers[colIdx] || `col${colIdx}`;
          const val = String(row[colIdx] ?? "").trim();
          if (val) {
            pairs.push(`${key}: ${val}`);
            metadata[key] = val;
          }
        }

        const rowText = pairs.join(", ");
        if (!rowText) continue;

        const span: SourceSpan = {
          page: sheetIdx + 1,
          startChar: rowIdx * 100,
          endChar: (rowIdx + 1) * 100,
          text: rowText,
        };

        section.blocks.push(
          createBlock("data_row", rowText, span, { metadata }),
        );
      }

      if (section.blocks.length > 0) {
        sections.push(section);
      }
    }

    const totalRows = sections.reduce((sum, s) => sum + s.blocks.length, 0);

    const doc = createDocumentIR(filename, ext, {
      title: stem,
      numPages: workbook.SheetNames.length,
      metadata: {
        sheets: workbook.SheetNames,
        total_rows: totalRows,
      },
    });
    doc.sections = sections;

    return doc;
  }
}
