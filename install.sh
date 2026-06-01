#!/usr/bin/env bash
# shellcheck shell=bash
set -Eeuo pipefail
IFS=$'\n\t'

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly REPO_ROOT="$SCRIPT_DIR"
readonly PLUGIN_NAME="opencode-rag-plugin"
readonly CLI_BIN_DIR="$HOME/.local/bin"
readonly GLOBAL_CONFIG="$HOME/.config/opencode"
readonly RUNTIME_DIR="$HOME/.opencode"

# --- helpers ------------------------------------------------------------------

die() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

info()  { printf '  %s\n' "$*"; }
step()  { printf '\n%s\n' "$*"; }
ok()    { printf '  %s  OK\n' "$1"; }
fail()  { printf '  %s  FAILED\n' "$1" >&2; }

cleanup_tgz() {
  rm -f "$GLOBAL_CONFIG/$PLUGIN_NAME-"*.tgz
}

remove_from_npm() {
  local dir="$1"
  local pkg="$dir/package.json"

  rm -rf "$dir/node_modules/$PLUGIN_NAME"

  if [[ -f "$pkg" ]]; then
    node -e "
      const fs = require('fs');
      const p = '$pkg';
      const pkg = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (pkg.dependencies && pkg.dependencies['$PLUGIN_NAME']) {
        delete pkg.dependencies['$PLUGIN_NAME'];
      }
      fs.writeFileSync(p, JSON.stringify(pkg, null, 2) + '\n');
    "
    (cd "$dir" && npm prune --silent 2>/dev/null || true)
  fi
}

remove_from_config() {
  for cfg in opencode.jsonc opencode.json; do
    local cfgpath="$GLOBAL_CONFIG/$cfg"
    [[ -f "$cfgpath" ]] || continue
    node -e "
      const fs = require('fs');
      const c = JSON.parse(fs.readFileSync('$cfgpath', 'utf8'));
      if (c.plugin) {
        c.plugin = c.plugin.filter(p => p !== '$PLUGIN_NAME');
        if (c.plugin.length === 0) delete c.plugin;
      }
      fs.writeFileSync('$cfgpath', JSON.stringify(c, null, 2) + '\n');
    "
    info "Removed $PLUGIN_NAME from $cfgpath"
  done
}

# --- preflight checks ---------------------------------------------------------

command -v npm >/dev/null 2>&1 || die "npm is required but was not found in PATH"
command -v opencode >/dev/null 2>&1 || die "opencode is required but was not found in PATH"

# --- uninstall ---------------------------------------------------------------

if [[ "${1:-}" = "uninstall" ]]; then
  step "Uninstalling $PLUGIN_NAME..."

  rm -f "$CLI_BIN_DIR/opencode-rag"

  remove_from_npm "$GLOBAL_CONFIG"
  remove_from_npm "$RUNTIME_DIR"
  cleanup_tgz

  remove_from_config

  # Remove old workspace-local wrappers (legacy)
  rm -f "$REPO_ROOT/.opencode/plugins/rag-plugin.js" \
        "$REPO_ROOT/.opencode/plugins/package.json"
  rmdir "$REPO_ROOT/.opencode/plugins" 2>/dev/null || true

  step "Uninstalled. Restart OpenCode if it is running."
  exit 0
fi

# --- install -----------------------------------------------------------------

cd "$REPO_ROOT"

step "Building $PLUGIN_NAME..."
npm run build

step "Packing plugin..."
mkdir -p "$GLOBAL_CONFIG"
cleanup_tgz

PACKED=$(npm pack --pack-destination "$GLOBAL_CONFIG" 2>/dev/null | tail -1)
[[ -n "$PACKED" && -f "$GLOBAL_CONFIG/$PACKED" ]] \
  || die "npm pack failed to produce a .tgz file."
info "Packed: $GLOBAL_CONFIG/$PACKED"

# Install into opencode runtime node_modules (primary global location)
step "Installing into OpenCode runtime ($RUNTIME_DIR)..."
mkdir -p "$RUNTIME_DIR"
npm install --prefix "$RUNTIME_DIR" --silent "$GLOBAL_CONFIG/$PACKED" 2>&1 \
  || die "npm install into runtime failed."

if [[ -d "$RUNTIME_DIR/node_modules/$PLUGIN_NAME/dist" ]]; then
  ok "Runtime node_modules"
else
  fail "Runtime node_modules"
  die "$PLUGIN_NAME not found in $RUNTIME_DIR/node_modules/"
fi

# Also install into config node_modules (opencode plugin command resolution)
step "Installing into OpenCode config ($GLOBAL_CONFIG)..."
npm install --prefix "$GLOBAL_CONFIG" --silent "$GLOBAL_CONFIG/$PACKED" 2>&1 \
  || die "npm install into config failed."

if [[ -d "$GLOBAL_CONFIG/node_modules/$PLUGIN_NAME/dist" ]]; then
  ok "Config node_modules"
else
  fail "Config node_modules"
  die "$PLUGIN_NAME not found in $GLOBAL_CONFIG/node_modules/"
fi

# Register plugin in opencode config if not already present
step "Registering plugin with OpenCode..."
if [[ -f "$GLOBAL_CONFIG/opencode.jsonc" ]]; then
  if grep -q "\"$PLUGIN_NAME\"" "$GLOBAL_CONFIG/opencode.jsonc" 2>/dev/null; then
    info "$PLUGIN_NAME already registered in opencode.jsonc"
  else
    _tmp=$(mktemp)
    node -e "
      const fs = require('fs');
      const c = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
      c.plugin = c.plugin || [];
      if (!c.plugin.includes('$PLUGIN_NAME')) {
        c.plugin.push('$PLUGIN_NAME');
      }
      fs.writeFileSync(process.argv[2], JSON.stringify(c, null, 2) + '\n');
    " "$GLOBAL_CONFIG/opencode.jsonc" "$_tmp"
    mv "$_tmp" "$GLOBAL_CONFIG/opencode.jsonc"
    ok "Added $PLUGIN_NAME to opencode.jsonc"
  fi
elif [[ -f "$GLOBAL_CONFIG/opencode.json" ]]; then
  if grep -q "\"$PLUGIN_NAME\"" "$GLOBAL_CONFIG/opencode.json" 2>/dev/null; then
    info "$PLUGIN_NAME already registered in opencode.json"
  else
    node -e "
      const fs = require('fs');
      const c = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
      c.plugin = c.plugin || [];
      if (!c.plugin.includes('$PLUGIN_NAME')) {
        c.plugin.push('$PLUGIN_NAME');
      }
      fs.writeFileSync(process.argv[1], JSON.stringify(c, null, 2) + '\n');
    " "$GLOBAL_CONFIG/opencode.json"
    ok "Added $PLUGIN_NAME to opencode.json"
  fi
else
  cat > "$GLOBAL_CONFIG/opencode.jsonc" << JSONEOF
{
  "\$schema": "https://opencode.ai/config.json",
  "plugin": ["$PLUGIN_NAME"]
}
JSONEOF
  ok "Created opencode.jsonc with $PLUGIN_NAME"
fi

# Clean up .tgz
cleanup_tgz

# Also register via `opencode plugin --global` to let the runtime validate it
opencode plugin "$PLUGIN_NAME" --global 2>/dev/null || true

# Create CLI wrapper (pointing to runtime's node_modules for stability)
step "Making CLI available on PATH..."
mkdir -p "$CLI_BIN_DIR"
rm -f "$CLI_BIN_DIR/opencode-rag"
cat > "$CLI_BIN_DIR/opencode-rag" << WRAPPER
#!/usr/bin/env bash
exec node "$RUNTIME_DIR/node_modules/$PLUGIN_NAME/dist/cli.js" "\$@"
WRAPPER
chmod +x "$CLI_BIN_DIR/opencode-rag"
ok "$CLI_BIN_DIR/opencode-rag"

# Clean up old workspace-local wrappers (legacy)
rm -f "$REPO_ROOT/.opencode/plugins/rag-plugin.js" \
      "$REPO_ROOT/.opencode/plugins/package.json"
rmdir "$REPO_ROOT/.opencode/plugins" 2>/dev/null || true

# --- verification ------------------------------------------------------------

step "Verifying installation..."

verified=true

if [[ -f "$RUNTIME_DIR/node_modules/$PLUGIN_NAME/dist/plugin-entry.js" ]]; then
  ok "Runtime plugin entry"
else
  fail "Runtime plugin entry"; verified=false
fi

if [[ -f "$GLOBAL_CONFIG/node_modules/$PLUGIN_NAME/dist/plugin-entry.js" ]]; then
  ok "Config plugin entry"
else
  fail "Config plugin entry"; verified=false
fi

if [[ -x "$CLI_BIN_DIR/opencode-rag" ]]; then
  ok "CLI wrapper"
else
  fail "CLI wrapper"; verified=false
fi

# Quick smoke test: can the plugin be resolved by Node?
if node -e "require.resolve('$PLUGIN_NAME', {paths:['$RUNTIME_DIR']})" 2>/dev/null; then
  ok "Node resolution (runtime)"
else
  fail "Node resolution (runtime)"; verified=false
fi

if node -e "require.resolve('$PLUGIN_NAME', {paths:['$GLOBAL_CONFIG']})" 2>/dev/null; then
  ok "Node resolution (config)"
else
  fail "Node resolution (config)"; verified=false
fi

step ""
if $verified; then
  printf 'Installation complete!\n'
else
  printf 'Installation finished with warnings (see above).\n' >&2
fi

printf '\n'
printf 'What to do next:\n'
printf '  1. Restart OpenCode if it is running.\n'
printf '  2. In any workspace where you want RAG context, create a config file\n'
printf '     at PROJECT_ROOT/opencode-rag.json (or copy from %s/opencode-rag.json).\n' "$REPO_ROOT"
printf '  3. Run "opencode-rag index" from that workspace to index its files.\n'
printf '  4. OpenCode will automatically use the indexed data for context-aware queries.\n'
printf '\n'
printf 'Run "%s uninstall" to remove.\n' "$0"
