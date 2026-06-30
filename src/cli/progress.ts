/**
 * @fileoverview Terminal-based live-updating progress table for indexing through chunking/description/embedding stages.
 */
import type { IndexProgress } from "../core/interfaces.js";

const STAGE_LABELS = ["Chunking", "Description", "Embedding"] as const;

/** Build a human-readable breadcrumb trail through the indexing pipeline stages. */
function formatBreadcrumb(stageIdx: number, failed?: boolean): string {
  if (failed) {
    return "Failed!";
  }
  const parts: string[] = [];
  for (let i = 0; i < STAGE_LABELS.length; i++) {
    if (i < stageIdx) {
      parts.push(STAGE_LABELS[i]!);
    } else if (i === stageIdx) {
      parts.push(STAGE_LABELS[i]! + "...");
      break;
    } else {
      break;
    }
  }
  const breadcrumb = parts.join(" -> ");
  if (stageIdx >= STAGE_LABELS.length) {
    return breadcrumb + " -> Finished!";
  }
  return breadcrumb;
}

/** Format a single terminal progress line with padded label and breadcrumb. */
function logLine(label: string, maxLabelLength: number, breadcrumb: string): string {
  return `  ${label.padEnd(maxLabelLength + 2)}${breadcrumb}`;
}

/**
 * Terminal-based progress reporter that renders a live-updating table of
 * indexing progress for each file through the chunking → description → embedding pipeline.
 *
 * When output is a TTY, the table is re-rendered in-place on a 100 ms interval.
 * For non-TTY streams (piped output), each finished or failed file is logged as a single line.
 */
export class TerminalProgressTable implements IndexProgress {
  private readonly entries = new Map<string, number>();
  private readonly failed = new Set<string>();
  private readonly fileLabels: string[] = [];
  private fileCount = 0;
  private maxLabelLength = 0;
  private renderedLineCount = 0;
  private dirty = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private done_ = false;
  private readonly isTTY: boolean;

  /**
   * @param stream - The write stream used for rendering (typically `process.stdout` or `process.stderr`).
   */
  constructor(private stream: NodeJS.WriteStream) {
    this.isTTY = stream.isTTY;
    if (this.isTTY) {
      this.timer = setInterval(() => this.flush(), 100);
    }
  }

  /** Set the total number of files to be processed (shown in the table header). */
  setFileCount(n: number): void {
    this.fileCount = n;
    this.dirty = true;
  }

  /** Register a new file with the given label and reset its stage to 0. */
  startFile(label: string): void {
    if (!this.entries.has(label)) {
      this.fileLabels.push(label);
      this.maxLabelLength = Math.max(this.maxLabelLength, label.length);
    }
    this.entries.set(label, 0);
    this.dirty = true;
  }

  /** Advance the file to its next pipeline stage. */
  finishStage(label: string): void {
    const idx = this.entries.get(label);
    if (idx !== undefined && idx < STAGE_LABELS.length) {
      this.entries.set(label, idx + 1);
      this.dirty = true;
    }
  }

  /** Mark the file as fully processed through all stages. */
  finishFile(label: string): void {
    const idx = this.entries.get(label);
    if (idx !== undefined) {
      this.entries.set(label, STAGE_LABELS.length);
      this.dirty = true;
      if (!this.isTTY) {
        console.log(logLine(label, this.maxLabelLength, formatBreadcrumb(STAGE_LABELS.length)));
      }
    }
  }

  /** Mark the file as failed and log the failure. */
  failFile(label: string): void {
    this.failed.add(label);
    this.dirty = true;
    if (!this.isTTY) {
      console.log(logLine(label, this.maxLabelLength, formatBreadcrumb(0, true)));
    }
  }

  /** Signal that indexing is complete — flush remaining output and clean up the interval timer. */
  done(): void {
    this.done_ = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.flush();
    this.stream.write("\n");
  }

  private flush(): void {
    if (!this.dirty || this.done_) return;
    this.dirty = false;
    this.render();
  }

  private render(): void {
    if (!this.isTTY) return;

    const lines: string[] = [];
    if (this.fileCount > 0) {
      lines.push(`Indexing ${this.fileCount} files:`);
    }

    for (const label of this.fileLabels) {
      const stageIdx = this.entries.get(label);
      if (stageIdx === undefined) continue;
      lines.push(logLine(label, this.maxLabelLength, formatBreadcrumb(stageIdx, this.failed.has(label))));
    }

    const clearCount = this.renderedLineCount;
    if (clearCount > 0) {
      this.stream.write(`\x1b[${clearCount}A\x1b[J`);
    }
    this.stream.write(lines.join("\n"));
    this.renderedLineCount = lines.length;
  }
}
