/**
 * @fileoverview Provides fallback error messages and no-results behavior dispatch for the read tool.
 */

import type { ReadNoResultsBehavior } from "../core/config.js";

/**
 * Error message wrapper for retrieval failures.
 */
export function retrievalErrorMessage(shortError: string): string {
  return [
    "OpenCodeRAG retrieval failed.",
    "",
    "Error:",
    shortError,
  ].join("\n");
}

/**
 * Dispatch to the correct fallback message based on behavior config.
 */
export function getNoResultsMessage(
  behavior: ReadNoResultsBehavior,
  filePath?: string
): string {
  switch (behavior) {
    case "error":
      throw new Error(
        "OpenCodeRAG read: no indexed chunks found." +
          (filePath ? ` File: ${filePath}` : "")
      );
    case "empty":
      return "No indexed chunks found.";
    case "hint":
    default:
      if (filePath) {
        return `No indexed chunks found for ${filePath}.`;
      }
      return "No relevant chunks found.";
  }
}
