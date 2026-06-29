/**
 * @fileoverview Eval commands for listing, analyzing, and comparing evaluation sessions with token usage breakdowns.
 */
/**
 * `eval:sessions`, `eval:analyze`, `eval:compare` commands —
 * evaluation session listing, per-session token analysis, and cross-session comparison.
 */

import type { Command } from "commander";
import path from "node:path";
import { c, resolveCliContext } from "../format.js";
import type { CliOptions } from "../types.js";

/**
 * Register the `eval:sessions` command on the given Commander program.
 *
 * Lists all logged evaluation sessions with their query counts,
 * token usage, RAG context tokens, and estimated cost.
 *
 * @param program - The Commander `Command` instance to register on.
 */
export function registerEvalSessionsCommand(program: Command): void {
  program
    .command("eval:sessions")
    .description("List all logged evaluation sessions")
    .option("-c, --config <path>", "path to config file")
    .action(async (options: CliOptions) => {
      try {
        const cwd = process.cwd();
        const logFilePath = path.resolve(cwd, ".opencode", "opencode-rag.log");
        const ctx = await resolveCliContext(options, logFilePath);
        const { storePath } = ctx;

        const { listSessions } = await import("../../eval/storage.js");
        const sessions = listSessions(storePath);

        if (sessions.length === 0) {
          console.log(c.warn("\nNo evaluation sessions found. Sessions are logged automatically during OpenCode usage.\n"));
          return;
        }

        console.log(`\n${c.heading("Evaluation Sessions")} (${sessions.length})\n`);
        console.log("  ID                          Queries  Input Tok  RAG Ctx   Cost");
        console.log("  " + "─".repeat(64));

        for (const s of sessions) {
          const id = (s.sessionID ?? "").padEnd(28);
          const queries = String(s.messageCount).padStart(6);
          const input = String(s.totalTokens.input).padStart(9);
          const ragCtx = String(s.ragContextTokens).padStart(8);
          const cost = `$${s.totalCost.toFixed(4)}`.padStart(7);
          console.log(`  ${id}  ${queries}  ${input}  ${ragCtx}  ${cost}`);
        }
        console.log();
      } catch (err) {
        const message = (err as Error).message || String(err);
        console.error(c.error(`\nFailed: ${message}\n`));
        process.exit(1);
      }
    });
}

/**
 * Register the `eval:analyze <sessionID>` command on the given Commander program.
 *
 * Analyzes token usage for a specific evaluation session, including input/output
 * tokens, reasoning tokens, cache reads, cost, and RAG impact projections.
 *
 * @param program - The Commander `Command` instance to register on.
 */
export function registerEvalAnalyzeCommand(program: Command): void {
  program
    .command("eval:analyze <sessionID>")
    .description("Analyze token usage for a specific session")
    .option("-c, --config <path>", "path to config file")
    .action(async (sessionID: string, options: CliOptions) => {
      try {
        const cwd = process.cwd();
        const logFilePath = path.resolve(cwd, ".opencode", "opencode-rag.log");
        const ctx = await resolveCliContext(options, logFilePath);
        const { storePath } = ctx;

        const { analyzeTokenUsage } = await import("../../eval/token-analysis.js");
        const analysis = analyzeTokenUsage(storePath, sessionID);

        if (analysis.queryCount === 0) {
          console.log(c.warn(`\nNo messages found for session '${sessionID}'.\n`));
          return;
        }

        console.log(`\n${c.heading("Token Analysis")} — ${c.value(sessionID)}\n`);
        console.log(`  Queries:          ${analysis.queryCount}`);
        console.log(`  Input tokens:     ${c.num(analysis.totals.inputTokens.toLocaleString())}`);
        console.log(`  Output tokens:    ${c.num(analysis.totals.outputTokens.toLocaleString())}`);
        console.log(`  Reasoning tokens: ${c.num(analysis.totals.reasoningTokens.toLocaleString())}`);
        console.log(`  Cache read:       ${c.num(analysis.totals.cacheRead.toLocaleString())}`);
        console.log(`  Cost:             ${c.num(`$${analysis.totals.cost.toFixed(4)}`)}`);
        console.log();
        console.log(`  ${c.heading("RAG Impact")}`);
        console.log(`  Context injected: ${c.num(analysis.totals.ragContextTokens.toLocaleString())} tokens`);
        console.log(`  System guidance:  ${c.num(analysis.totals.systemGuidanceTokens.toLocaleString())} tokens`);
        console.log(`  Read calls:       ${c.num(analysis.totals.readToolCalls)}`);
        console.log(`  RAG tool calls:   ${c.num(analysis.totals.ragToolCalls)}`);
        console.log();
        console.log(`  ${c.heading("Projection")}`);
        console.log(`  Tokens with RAG:    ${c.num(analysis.estimates.tokensWithRAG.toLocaleString())}`);
        console.log(`  Tokens without RAG: ${c.num(analysis.estimates.tokensWithoutRAG.toLocaleString())}`);
        const savingsColor = analysis.estimates.netSavings > 0 ? c.success : c.warn;
        console.log(`  Net savings:        ${savingsColor(`${analysis.estimates.netSavings > 0 ? "+" : ""}${analysis.estimates.netSavings.toLocaleString()} tokens (${analysis.estimates.percentSavings}%)`)}`);
        console.log();

        if (analysis.breakdowns.length > 0) {
          console.log(`  ${c.heading("Per-Query Breakdown")}`);
          console.log("  #    Input   RAG ctx  Reads  RAG tools  Score");
          console.log("  " + "─".repeat(52));
          for (let i = 0; i < analysis.breakdowns.length; i++) {
            const b = analysis.breakdowns[i]!;
            const num = String(i + 1).padStart(3);
            const input = String(b.inputTokens).padStart(7);
            const ctx = String(b.ragContextTokens).padStart(7);
            const reads = String(b.readToolCalls).padStart(5);
            const tools = String(b.ragToolCalls).padStart(9);
            const score = b.ragTopScore.toFixed(2);
            console.log(`  ${num}  ${input}  ${ctx}  ${reads}  ${tools}  ${score}`);
          }
        }
        console.log();
      } catch (err) {
        const message = (err as Error).message || String(err);
        console.error(c.error(`\nFailed: ${message}\n`));
        process.exit(1);
      }
    });
}

/**
 * Register the `eval:compare <sessionA> <sessionB>` command on the given Commander program.
 *
 * Compares token usage between two evaluation sessions (e.g. RAG-on vs RAG-off)
 * and prints a formatted comparison report with deltas and percentage changes.
 *
 * @param program - The Commander `Command` instance to register on.
 */
export function registerEvalCompareCommand(program: Command): void {
  program
    .command("eval:compare <sessionA> <sessionB>")
    .description("Compare token usage between two sessions (e.g. RAG-on vs RAG-off)")
    .option("-c, --config <path>", "path to config file")
    .action(async (sessionA: string, sessionB: string, options: CliOptions) => {
      try {
        const cwd = process.cwd();
        const logFilePath = path.resolve(cwd, ".opencode", "opencode-rag.log");
        const ctx = await resolveCliContext(options, logFilePath);
        const { storePath } = ctx;

        const { analyzeTokenUsage, compareTokenAnalyses, formatTokenReport } = await import("../../eval/token-analysis.js");
        const a = analyzeTokenUsage(storePath, sessionA);
        const b = analyzeTokenUsage(storePath, sessionB);

        if (a.queryCount === 0 && b.queryCount === 0) {
          console.log(c.warn(`\nNo messages found for sessions '${sessionA}' or '${sessionB}'.\n`));
          return;
        }

        const comparison = compareTokenAnalyses(a, b);
        const report = formatTokenReport(a, b, comparison);
        console.log(report);
      } catch (err) {
        const message = (err as Error).message || String(err);
        console.error(c.error(`\nFailed: ${message}\n`));
        process.exit(1);
      }
    });
}
