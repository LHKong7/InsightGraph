import type { DocumentIR } from "@insightgraph/core";

/**
 * Abstract interface for document parsers.
 *
 * Each implementation handles one or more file formats and converts
 * raw file content into a {@link DocumentIR} intermediate representation.
 */
export interface BaseParser {
  /**
   * Parse a document file and return its intermediate representation.
   *
   * @param filePath - Absolute path to the document file.
   * @returns A fully populated DocumentIR instance.
   * @throws If the file does not exist or the format is unsupported.
   */
  parse(filePath: string): Promise<DocumentIR>;

  /**
   * Return the list of file extensions this parser supports.
   *
   * @returns Lowercase extensions without dots, e.g. `["pdf"]`.
   */
  supportedFormats(): string[];
}
