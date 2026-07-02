/**
 * @fileoverview Line-per-line progress reporter for indexing through chunking/description/embedding stages.
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

/**
 * Line-per-line progress reporter for indexing.
 *
 * Emits one `console.log` line per progress event (start, stage transition,
 * finish, failure) with a plain breadcrumb format.  No ANSI escape codes,
 * no TTY branching, no live redraw.  Suitable for all output modes: TTY,
 * pipe, CI, log files.
 */
export class LineProgressReporter implements IndexProgress {
  private readonly entries = new Map<string, number>();
  private readonly failed = new Set<string>();

  constructor(_stream?: NodeJS.WriteStream) {
    // stream param retained for constructor parity; all output goes via console.log
  }

  setFileCount(n: number): void {
    if (n > 0) console.log(`Indexing ${n} files:`);
  }

  startFile(label: string): void {
    if (this.entries.has(label)) return;
    this.entries.set(label, 0);
    console.log(`  ${label}: ${formatBreadcrumb(0)}`);
  }

  finishStage(label: string): void {
    const idx = this.entries.get(label);
    if (idx === undefined || idx >= STAGE_LABELS.length) return;
    const next = idx + 1;
    this.entries.set(label, next);
    console.log(`  ${label}: ${formatBreadcrumb(next)}`);
  }

  finishFile(label: string): void {
    const idx = this.entries.get(label);
    if (idx === undefined || idx >= STAGE_LABELS.length) return;
    this.entries.set(label, STAGE_LABELS.length);
    console.log(`  ${label}: ${formatBreadcrumb(STAGE_LABELS.length)}`);
  }

  failFile(label: string): void {
    if (this.failed.has(label)) return;
    this.failed.add(label);
    console.log(`  ${label}: Failed!`);
  }

  done(): void {
    this.entries.clear();
    this.failed.clear();
  }
}
