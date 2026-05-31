#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$SCRIPT_DIR"
PLUGIN_NAME="opencode-rag-plugin"
CLI_BIN_DIR="$HOME/.local/bin"
GLOBAL_OPENCODE="$HOME/.config/opencode"

command -v npm >/dev/null 2>&1 || {
  echo "npm is required but was not found in PATH" >&2
  exit 1
}

command -v opencode >/dev/null 2>&1 || {
  echo "opencode is required but was not found in PATH" >&2
  exit 1
}

# --- uninstall ---------------------------------------------------------------
if [ "${1:-}" = "uninstall" ]; then
  echo "Uninstalling $PLUGIN_NAME..."

  rm -f "$CLI_BIN_DIR/opencode-rag"

  # Remove from OpenCode config's node_modules
  rm -rf "$GLOBAL_OPENCODE/node_modules/$PLUGIN_NAME"
  rm -f "$GLOBAL_OPENCODE/$PLUGIN_NAME-"*.tgz

  # Remove from package.json in config dir
  if [ -f "$GLOBAL_OPENCODE/package.json" ]; then
    node -e "
      const fs = require('fs');
      const p = '$GLOBAL_OPENCODE/package.json';
      const pkg = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (pkg.dependencies && pkg.dependencies['$PLUGIN_NAME']) {
        delete pkg.dependencies['$PLUGIN_NAME'];
      }
      fs.writeFileSync(p, JSON.stringify(pkg, null, 2) + '\n');
    "
    cd "$GLOBAL_OPENCODE" && npm prune --silent 2>/dev/null || true
  fi

  # Remove from opencode config
  for cfg in opencode.jsonc opencode.json; do
    cfgpath="$GLOBAL_OPENCODE/$cfg"
    if [ -f "$cfgpath" ]; then
      node -e "
        const fs = require('fs');
        const c = JSON.parse(fs.readFileSync('$cfgpath', 'utf8'));
        if (c.plugin) {
          c.plugin = c.plugin.filter(p => p !== '$PLUGIN_NAME');
          if (c.plugin.length === 0) delete c.plugin;
        }
        fs.writeFileSync('$cfgpath', JSON.stringify(c, null, 2) + '\n');
      "
    fi
  done

  # Remove old workspace-local wrappers
  rm -f "$REPO_ROOT/.opencode/plugins/rag-plugin.js" \
        "$REPO_ROOT/.opencode/plugins/package.json"
  rmdir "$REPO_ROOT/.opencode/plugins" 2>/dev/null || true

  echo "Uninstalled. Restart OpenCode if it is running."
  exit 0
fi

# --- install -----------------------------------------------------------------
cd "$REPO_ROOT"

echo "Building $PLUGIN_NAME..."
npm run build

echo "Installing globally in OpenCode (~/.config/opencode)..."
mkdir -p "$GLOBAL_OPENCODE"

# Remove any previous installation
rm -rf "$GLOBAL_OPENCODE/node_modules/$PLUGIN_NAME"
rm -f "$GLOBAL_OPENCODE/$PLUGIN_NAME-"*.tgz

# Pack into a .tgz (capture only stdout, not stderr with warnings)
PACKED=$(npm pack --pack-destination "$GLOBAL_OPENCODE" 2>/dev/null | tail -1)

if [ -z "$PACKED" ] || [ ! -f "$GLOBAL_OPENCODE/$PACKED" ]; then
  echo "Error: npm pack failed to produce a .tgz file." >&2
  exit 1
fi

echo "  Packed: $GLOBAL_OPENCODE/$PACKED"

# Install into OpenCode's config node_modules
npm install --prefix "$GLOBAL_OPENCODE" --silent "$GLOBAL_OPENCODE/$PACKED" 2>&1 || {
  echo "Error: npm install failed." >&2
  exit 1
}

# Verify installation
if [ ! -d "$GLOBAL_OPENCODE/node_modules/$PLUGIN_NAME/dist" ]; then
  echo "Error: Installation verification failed - $PLUGIN_NAME not found in $GLOBAL_OPENCODE/node_modules/" >&2
  exit 1
fi

echo "  Installed to: $GLOBAL_OPENCODE/node_modules/$PLUGIN_NAME/"

echo "Making CLI available on PATH..."
mkdir -p "$CLI_BIN_DIR"
rm -f "$CLI_BIN_DIR/opencode-rag"
cat > "$CLI_BIN_DIR/opencode-rag" << WRAPPER
#!/usr/bin/env bash
exec node "$HOME/.config/opencode/node_modules/$PLUGIN_NAME/dist/cli.js" "\$@"
WRAPPER
chmod +x "$CLI_BIN_DIR/opencode-rag"

echo "Registering plugin with OpenCode..."
if [ -f "$GLOBAL_OPENCODE/opencode.jsonc" ]; then
  if ! grep -q "\"$PLUGIN_NAME\"" "$GLOBAL_OPENCODE/opencode.jsonc" 2>/dev/null; then
    TEMP=$(mktemp)
    node -e "
      const fs = require('fs');
      const c = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
      c.plugin = c.plugin || [];
      if (!c.plugin.includes('$PLUGIN_NAME')) {
        c.plugin.push('$PLUGIN_NAME');
      }
      fs.writeFileSync(process.argv[2], JSON.stringify(c, null, 2) + '\n');
    " "$GLOBAL_OPENCODE/opencode.jsonc" "$TEMP"
    mv "$TEMP" "$GLOBAL_OPENCODE/opencode.jsonc"
    echo "  Added $PLUGIN_NAME to opencode.jsonc"
  else
    echo "  $PLUGIN_NAME already registered in opencode.jsonc"
  fi
elif [ -f "$GLOBAL_OPENCODE/opencode.json" ]; then
  if ! grep -q "\"$PLUGIN_NAME\"" "$GLOBAL_OPENCODE/opencode.json" 2>/dev/null; then
    node -e "
      const fs = require('fs');
      const c = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
      c.plugin = c.plugin || [];
      if (!c.plugin.includes('$PLUGIN_NAME')) {
        c.plugin.push('$PLUGIN_NAME');
      }
      fs.writeFileSync(process.argv[1], JSON.stringify(c, null, 2) + '\n');
    " "$GLOBAL_OPENCODE/opencode.json"
    echo "  Added $PLUGIN_NAME to opencode.json"
  else
    echo "  $PLUGIN_NAME already registered in opencode.json"
  fi
else
  cat > "$GLOBAL_OPENCODE/opencode.jsonc" << JSONEOF
{
  "\$schema": "https://opencode.ai/config.json",
  "plugin": ["$PLUGIN_NAME"]
}
JSONEOF
  echo "  Created opencode.jsonc with $PLUGIN_NAME"
fi

echo "Cleaning up old workspace-local wrapper (no longer needed)..."
rm -f "$REPO_ROOT/.opencode/plugins/rag-plugin.js" \
      "$REPO_ROOT/.opencode/plugins/package.json"
rmdir "$REPO_ROOT/.opencode/plugins" 2>/dev/null || true

# --- verification ------------------------------------------------------------
echo ""
echo "Verifying installation..."
PLUGIN_ENTRY="$GLOBAL_OPENCODE/node_modules/$PLUGIN_NAME/dist/plugin-entry.js"
if [ -f "$PLUGIN_ENTRY" ]; then
  echo "  Plugin entry:  OK ($PLUGIN_ENTRY)"
else
  echo "  Plugin entry:  MISSING" >&2
fi

if [ -x "$CLI_BIN_DIR/opencode-rag" ]; then
  echo "  CLI wrapper:  OK ($CLI_BIN_DIR/opencode-rag)"
else
  echo "  CLI wrapper:  FAILED" >&2
fi

echo ""

echo "Installation complete!"
echo ""
echo "What to do next:"
echo "  1. Restart OpenCode if it is running."
echo "  2. In any workspace where you want RAG context, create a config file"
echo "     at PROJECT_ROOT/opencode-rag.json (or copy from $REPO_ROOT/opencode-rag.json)."
echo "  3. Run 'opencode-rag index' from that workspace to index its files."
echo "  4. OpenCode will automatically use the indexed data for context-aware queries."
echo ""
echo "Run '$0 uninstall' to remove."
