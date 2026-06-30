/**
 * @fileoverview Core type definitions for binary and image content extraction results.
 */

/** Result of extracting text content from a binary or image file. */
export interface ExtractResult {
  content: string;
  ok: boolean;
  error?: string;
}
