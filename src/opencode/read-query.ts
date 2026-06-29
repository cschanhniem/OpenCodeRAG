/**
 * @fileoverview Builds deterministic retrieval queries for the read tool from file path, line range, and user intent.
 */

/**
 * Build a retrieval query string for the read tool.
 *
 * Combines user intent (optional query/reason) with file path
 * and optional line range to create a focused retrieval query.
 */

export interface QueryBuilderOptions {
  /** The user's explicit query or reason for reading. */
  query?: string;
  /** The normalized absolute file path being read. */
  filePath: string;
  /** Optional start line. */
  startLine?: number;
  /** Optional end line. */
  endLine?: number;
}

/**
 * Build a deterministic retrieval query from read arguments.
 *
 * Rules:
 *   - If query is provided: use it as prefix, then append file path instructions.
 *   - If no query: use a generic "Relevant implementation details" template.
 *   - If line range exists: append focus instruction.
 *   - If only startLine: append "at or after" instruction.
 */
export function buildReadQuery(options: QueryBuilderOptions): string {
  const { query, filePath, startLine, endLine } = options;
  const parts: string[] = [];

  if (query && query.trim().length > 0) {
    parts.push(query.trim());
    parts.push("");
    parts.push(`File: ${filePath}`);
    parts.push(
      "Return relevant indexed code chunks from this file with line numbers."
    );
  } else {
    parts.push(
      `Relevant implementation details in file ${filePath}.`,
      "Return indexed code chunks with line numbers."
    );
  }

  if (startLine !== undefined && endLine !== undefined) {
    parts.push(
      `Focus on chunks overlapping lines ${startLine}-${endLine}.`
    );
  } else if (startLine !== undefined) {
    parts.push(`Focus on chunks at or after line ${startLine}.`);
  } else if (endLine !== undefined) {
    parts.push(`Focus on chunks at or before line ${endLine}.`);
  }

  return parts.join("\n");
}
