/**
 * @fileoverview Update command for checking and installing OpenCodeRAG updates from GitHub.
 */
/**
 * `update` command — checks for and installs OpenCodeRAG updates from GitHub.
 */

import type { Command } from "commander";
import path from "node:path";
import { getCurrentVersion, checkForUpdate, applyUpdate } from "../../updater.js";
import { c } from "../format.js";
import { getPackageRoot } from "../helpers.js";

/** Options specific to the `update` command. */
interface UpdateOptions {
  /** Only check for updates without installing. */
  check?: boolean;
  /** Skip the confirmation prompt. */
  yes?: boolean;
  /** Show build/install output during the update. */
  verbose?: boolean;
}

/**
 * Register the `update` command on the given Commander program.
 *
 * Checks the GitHub repository for a newer release, displays the current
 * and latest versions, and optionally applies the update by pulling
 * the latest code and rebuilding.
 *
 * @param program - The Commander `Command` instance to register on.
 */
export function registerUpdateCommand(program: Command): void {
  program
    .command("update")
    .description("Check for and install OpenCodeRAG updates from GitHub")
    .option("--check", "only check for updates, don't install")
    .option("-y, --yes", "skip confirmation prompt")
    .option("-v, --verbose", "show build/install output")
    .action(async (options: UpdateOptions) => {
      try {
        const currentVersion = getCurrentVersion();

        console.log(`\n${c.heading("OpenCodeRAG Updater")}\n`);
        console.log(`  ${c.label("Current version:")} ${c.value(currentVersion)}`);
        console.log(`  ${c.label("Checking for updates...")}`);

        const info = await checkForUpdate(currentVersion);

        if (!info.updateAvailable) {
          console.log(`  ${c.success("Already up to date.")}\n`);
          return;
        }

        console.log(`  ${c.label("Latest version:")}  ${c.value(info.latestVersion)}`);
        if (info.releaseUrl) {
          console.log(`  ${c.label("Release:")}         ${c.file(info.releaseUrl)}`);
        }
        console.log();

        if (options.check) {
          console.log(`  ${c.warn("Update available. Run `opencode-rag update` to install.")}\n`);
          return;
        }

        if (!options.yes) {
          const readline = await import("node:readline");
          const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
          const answer = await new Promise<string>((resolve) => {
            rl.question(`  Install update to ${info.latestVersion}? [y/N] `, resolve);
          });
          rl.close();
          if (answer.toLowerCase() !== "y" && answer.toLowerCase() !== "yes") {
            console.log(`  ${c.dim("Cancelled.")}\n`);
            return;
          }
        }

        console.log(`  ${c.label("Applying update...")}\n`);
        const result = applyUpdate({
          repoRoot: path.resolve(getPackageRoot()),
          verbose: options.verbose ?? false,
        });

        if (result.success) {
          console.log(`  ${c.success(result.message)}\n`);
        } else {
          console.error(`  ${c.error(result.message)}\n`);
          process.exit(1);
        }
      } catch (err) {
        const message = (err as Error).message || String(err);
        console.error(c.error(`\nUpdate failed: ${message}\n`));
        process.exit(1);
      }
    });
}
