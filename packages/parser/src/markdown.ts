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
 * Markdown parser that converts .md files into DocumentIR.
 *
 * Headings (`#`, `##`, etc.) create sections. Text between headings becomes
 * paragraph blocks. The heading level maps directly to the section level.
 */
export class MarkdownParser implements BaseParser {
  supportedFormats(): string[] {
    return ["md", "markdown"];
  }

  async parse(filePath: string): Promise<DocumentIR> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const raw = fs.readFileSync(filePath, "utf-8");
    const lines = raw.split("\n");
    const stem = path.basename(filePath, path.extname(filePath));
    const filename = path.basename(filePath);

    const doc = createDocumentIR(filename, "markdown", {
      title: stem,
      numPages: 1,
    });

    // Stack-based section builder
    const rootSections: SectionNode[] = [];
    const sectionStack: { level: number; section: SectionNode }[] = [];
    let currentSection = createSectionNode(0, 0, { title: stem });
    let sectionOrder = 0;
    let charOffset = 0;

    const flushParagraph = (text: string, offset: number) => {
      if (!text.trim()) return;
      const span: SourceSpan = {
        page: 1,
        startChar: offset,
        endChar: offset + text.length,
        text: text.trim(),
      };
      currentSection.blocks.push(
        createBlock("paragraph", text.trim(), span),
      );
    };

    let paragraphBuffer = "";
    let paragraphStart = 0;

    for (const line of lines) {
      const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);

      if (headingMatch) {
        // Flush accumulated paragraph
        flushParagraph(paragraphBuffer, paragraphStart);
        paragraphBuffer = "";

        const level = headingMatch[1].length;
        const title = headingMatch[2].trim();

        // Pop sections from stack that are at the same or deeper level
        while (
          sectionStack.length > 0 &&
          sectionStack[sectionStack.length - 1].level >= level
        ) {
          sectionStack.pop();
        }

        // If we have blocks in currentSection and it's the implicit root, push it
        if (
          sectionStack.length === 0 &&
          currentSection.blocks.length > 0 &&
          !rootSections.includes(currentSection)
        ) {
          rootSections.push(currentSection);
        }

        sectionOrder++;
        const newSection = createSectionNode(level, sectionOrder, { title });

        // Add heading block
        const span: SourceSpan = {
          page: 1,
          startChar: charOffset,
          endChar: charOffset + line.length,
          text: title,
        };
        newSection.blocks.push(
          createBlock("heading", title, span, { level }),
        );

        if (sectionStack.length > 0) {
          sectionStack[sectionStack.length - 1].section.children.push(newSection);
        } else {
          rootSections.push(newSection);
        }

        sectionStack.push({ level, section: newSection });
        currentSection = newSection;
      } else {
        if (!paragraphBuffer && line.trim()) {
          paragraphStart = charOffset;
        }
        if (line.trim() === "" && paragraphBuffer.trim()) {
          flushParagraph(paragraphBuffer, paragraphStart);
          paragraphBuffer = "";
        } else {
          paragraphBuffer += (paragraphBuffer ? "\n" : "") + line;
        }
      }

      charOffset += line.length + 1; // +1 for newline
    }

    // Flush remaining paragraph
    flushParagraph(paragraphBuffer, paragraphStart);

    // If no headings were found, push the root section
    if (rootSections.length === 0 && currentSection.blocks.length > 0) {
      rootSections.push(currentSection);
    }

    doc.sections = rootSections;
    return doc;
  }
}
