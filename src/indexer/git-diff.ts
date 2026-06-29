/**
 * @fileoverview Uses git to detect changed, deleted, and untracked files for incremental indexing.
 */
import { execSync } from "node:child_process";

/** Result of comparing the working tree against a prior commit. */
export interface GitDiffResult {
  changedFiles: string[];
  deletedFiles: string[];
  currentCommit: string;
}

/**
 * Resolve the root directory of the git repository containing `cwd`.
 *
 * @param cwd - A path inside the repository.
 * @returns The absolute repository root path, or `null` if not a git repo.
 */
export function getRepoRoot(cwd: string): string | null {
  try {
    return execSync("git rev-parse --show-toplevel", {
      cwd,
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Get the full SHA of the current HEAD commit.
 *
 * @param cwd - A path inside the repository.
 * @returns The commit SHA, or `null` on failure.
 */
export function getCurrentCommit(cwd: string): string | null {
  try {
    return execSync("git rev-parse HEAD", {
      cwd,
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * List changed, added, and deleted files between `fromCommit` and HEAD.
 *
 * @param cwd - A path inside the repository.
 * @param fromCommit - The commit SHA to diff against.
 * @returns A diff result, or `null` if the git command fails.
 */
export function getChangedFilesSince(
  cwd: string,
  fromCommit: string,
): GitDiffResult | null {
  try {
    const changedRaw = execSync(
      `git diff --name-only --diff-filter=ACMRT "${fromCommit}" HEAD`,
      { cwd, encoding: "utf-8", timeout: 10000, stdio: ["ignore", "pipe", "ignore"] },
    ).trim();

    const deletedRaw = execSync(
      `git diff --name-only --diff-filter=D "${fromCommit}" HEAD`,
      { cwd, encoding: "utf-8", timeout: 10000, stdio: ["ignore", "pipe", "ignore"] },
    ).trim();

    const changedFiles = changedRaw.length > 0 ? changedRaw.split("\n") : [];
    const deletedFiles = deletedRaw.length > 0 ? deletedRaw.split("\n") : [];

    const currentCommit = getCurrentCommit(cwd);
    if (!currentCommit) return null;

    return { changedFiles, deletedFiles, currentCommit };
  } catch {
    return null;
  }
}

/**
 * List untracked files in the repository, respecting .gitignore rules.
 *
 * @param cwd - A path inside the repository.
 * @returns An array of untracked file paths (relative to repo root).
 */
export function getUntrackedFiles(cwd: string): string[] {
  try {
    const raw = execSync(
      "git ls-files --others --exclude-standard",
      { cwd, encoding: "utf-8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    return raw.length > 0 ? raw.split("\n") : [];
  } catch {
    return [];
  }
}
