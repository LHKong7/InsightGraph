import * as path from "path";
import * as fs from "fs";
import type { DocumentIR } from "@insightgraph/core";
import type { BaseParser } from "./base";
import { PdfParser } from "./pdf";
import { CsvParser } from "./csv";
import { JsonParser } from "./json";
import { MarkdownParser } from "./markdown";
import { XlsxParser } from "./xlsx";

/**
 * Registry-based service that delegates parsing to format-specific parsers.
 *
 * By default the service ships with {@link PdfParser}, {@link CsvParser}, and
 * {@link JsonParser} registered for their respective extensions.  Additional
 * parsers can be supplied at construction time or registered later via
 * {@link register}.
 */
export class ParserService {
  private readonly _parsers: Map<string, BaseParser>;

  constructor(parsers?: Record<string, BaseParser>) {
    if (parsers) {
      this._parsers = new Map(Object.entries(parsers));
    } else {
      const md = new MarkdownParser();
      const xlsx = new XlsxParser();
      this._parsers = new Map<string, BaseParser>([
        ["pdf", new PdfParser()],
        ["csv", new CsvParser()],
        ["json", new JsonParser()],
        ["md", md],
        ["markdown", md],
        ["xlsx", xlsx],
        ["xls", xlsx],
      ]);
    }
  }

  /**
   * Register a parser for a given file extension.
   *
   * @param extension - Lowercase extension without leading dot, e.g. `"docx"`.
   * @param parser - A {@link BaseParser} implementation.
   */
  register(extension: string, parser: BaseParser): void {
    this._parsers.set(extension.toLowerCase().replace(/^\./, ""), parser);
  }

  /**
   * Parse a file using the appropriate registered parser.
   *
   * @param filePath - Path to the document.
   * @returns A fully populated {@link DocumentIR}.
   * @throws If the file does not exist or no parser is registered for the extension.
   */
  async parse(filePath: string): Promise<DocumentIR> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const ext = path.extname(filePath).toLowerCase().replace(/^\./, "");
    const parser = this._parsers.get(ext);
    if (!parser) {
      const available = Array.from(this._parsers.keys()).sort().join(", ");
      throw new Error(
        `No parser registered for .${ext} files. Available formats: ${available}`,
      );
    }

    return parser.parse(filePath);
  }

  /**
   * Return all currently registered file extensions.
   */
  get supportedFormats(): string[] {
    return Array.from(this._parsers.keys()).sort();
  }
}
