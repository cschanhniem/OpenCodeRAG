// postinstall: runs after `npm install -g opencode-rag-plugin`.
// Only executes setup when installed globally — skips silently for local dev installs.

const isGlobal = process.env.npm_config_global === "true";
if (!isGlobal) {
  process.exit(0);
}

let setupRuntime;
try {
  const mod = await import("../dist/core/setup-runtime.js");
  setupRuntime = mod.setupRuntime;
} catch {
  console.error("OpenCodeRAG: could not find runtime setup module.");
  console.error("Run `opencode-rag setup` manually after install.");
  process.exit(0);
}

const result = await setupRuntime({ silent: true });

if (!result.success) {
  console.error("");
  console.error("OpenCodeRAG runtime setup failed during postinstall.");
  for (const err of result.errors) {
    console.error(`  ${err}`);
  }
  console.error("");
  console.error("Run `opencode-rag setup` manually to retry.");
  console.error("");
}
