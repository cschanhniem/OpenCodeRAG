import { mkdirSync, copyFileSync, existsSync, readdirSync, unlinkSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";

const distDir = join(fileURLToPath(import.meta.url), "..", "..", "dist");
const srcDir = join(fileURLToPath(import.meta.url), "..", "..", "src");

mkdirSync(join(distDir, "types"), { recursive: true });
copyFileSync(
  join(srcDir, "types", "opencode-plugin.d.ts"),
  join(distDir, "types", "opencode-plugin.d.ts"),
);

const uiDir = join(distDir, "web", "ui");
mkdirSync(uiDir, { recursive: true });

copyFileSync(join(srcDir, "web", "ui", "index.html"), join(uiDir, "index.html"));

for (const f of ["app.css", "github-dark.css", "highlight.min.js"]) {
  const src = join(srcDir, "web", "ui", f);
  if (existsSync(src)) {
    copyFileSync(src, join(uiDir, f));
  }
}

// Remove source maps from dist/ to reduce package size
function removeSourceMaps(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      removeSourceMaps(fullPath);
    } else if (entry.name.endsWith(".js.map")) {
      unlinkSync(fullPath);
    }
  }
}
removeSourceMaps(distDir);
