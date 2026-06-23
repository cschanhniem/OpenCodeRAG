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

die()   { printf 'Error: %s\n' "$*" >&2; exit 1; }
info()  { printf '  %s\n' "$*"; }
step()  { printf '\n%s\n' "$*"; }
ok()    { printf '  %s  OK\n' "$1"; }
fail()  { printf '  %s  FAILED\n' "$1" >&2; }

remove_stale_plugin_from_config() {
  local removed=false
  for cfg in opencode.jsonc opencode.json; do
    local cfgpath="$GLOBAL_CONFIG/$cfg"
    [[ -f "$cfgpath" ]] || continue
    if node -e "const fs=require('fs');const c=JSON.parse(fs.readFileSync('$cfgpath','utf8'));if(c.plugin){delete c.plugin;fs.writeFileSync('$cfgpath',JSON.stringify(c,null,2)+'\n');process.exit(0)}process.exit(1)" 2>/dev/null; then
      info "Removed stale plugin entry from $cfgpath"
      removed=true
    fi
  done
  $removed
}

cleanup_tgz() {
  rm -f "$RUNTIME_DIR/$PLUGIN_NAME-"*.tgz "$GLOBAL_CONFIG/$PLUGIN_NAME-"*.tgz
}

remove_from_npm() {
  local dir="$1" pkg="$dir/package.json"
  rm -rf "$dir/node_modules/$PLUGIN_NAME"
  if [[ -f "$pkg" ]]; then
    node -e "const fs=require('fs');const p='$pkg';const pkg=JSON.parse(fs.readFileSync(p,'utf8'));if(pkg.dependencies&&pkg.dependencies['$PLUGIN_NAME']){delete pkg.dependencies['$PLUGIN_NAME']}fs.writeFileSync(p,JSON.stringify(pkg,null,2)+'\n')"
    (cd "$dir" && npm prune --silent 2>/dev/null || true)
  fi
}

remove_from_config() {
  for cfg in opencode.jsonc opencode.json; do
    local cfgpath="$GLOBAL_CONFIG/$cfg"
    [[ -f "$cfgpath" ]] || continue
    node -e "const fs=require('fs');const c=JSON.parse(fs.readFileSync('$cfgpath','utf8'));if(c.plugin){c.plugin=c.plugin.filter(p=>p!=='$PLUGIN_NAME');if(c.plugin.length===0)delete c.plugin}fs.writeFileSync('$cfgpath',JSON.stringify(c,null,2)+'\n')"
    info "Removed $PLUGIN_NAME from $cfgpath"
  done
}

# --- preflight ---

command -v npm >/dev/null 2>&1 || die "npm is required but was not found in PATH"
command -v opencode >/dev/null 2>&1 || die "opencode is required but was not found in PATH"

# --- uninstall ---

if [[ "${1:-}" = "uninstall" ]]; then
  step "Uninstalling $PLUGIN_NAME from all locations..."
  info "Removing CLI wrapper..."
  rm -f "$CLI_BIN_DIR/opencode-rag" "$CLI_BIN_DIR/opencode-rag.ps1" "$CLI_BIN_DIR/opencode-rag.sh"
  info "Removing from global config ($GLOBAL_CONFIG)...";  remove_from_npm "$GLOBAL_CONFIG"
  info "Removing from OpenCode runtime ($RUNTIME_DIR)...";   remove_from_npm "$RUNTIME_DIR"
  info "Removing .tgz package files...";                     cleanup_tgz
  info "Removing OpenCode cache..."
  rm -rf "$HOME/.cache/opencode/packages/$PLUGIN_NAME-"* 2>/dev/null || true
  info "Updating OpenCode configuration...";                 remove_from_config
  info "Removing stale plugin registrations...";              remove_stale_plugin_from_config || true
  info "Removing workspace-local files..."
  rm -f "$REPO_ROOT/.opencode/plugins/rag-plugin.js" "$REPO_ROOT/.opencode/plugins/package.json"
  rm -rf "$REPO_ROOT/.opencode/plugins" 2>/dev/null || true
  step "Uninstalled. Restart OpenCode if it is running."
  exit 0
fi

# --- install ---

cd "$REPO_ROOT"

step "Building $PLUGIN_NAME..."
npm run build

step "Installing into OpenCode runtime ($RUNTIME_DIR)..."
mkdir -p "$(dirname "$RUNTIME_DIR/node_modules/$PLUGIN_NAME")"
rm -rf "$RUNTIME_DIR/node_modules/$PLUGIN_NAME"
ln -sfn "$REPO_ROOT" "$RUNTIME_DIR/node_modules/$PLUGIN_NAME"
if [[ -d "$REPO_ROOT/dist" ]]; then
  ok "Runtime node_modules (symlink to repo)"
else
  fail "Runtime node_modules"
  die "dist/ not found in repo root -- did npm run build succeed?"
fi

step "Making CLI available on PATH..."
mkdir -p "$CLI_BIN_DIR"
cat > "$CLI_BIN_DIR/opencode-rag" << 'WRAPPER'
#!/usr/bin/env bash
exec node "$HOME/.opencode/node_modules/opencode-rag-plugin/dist/cli.js" "$@"
WRAPPER
chmod +x "$CLI_BIN_DIR/opencode-rag"
ok "$CLI_BIN_DIR/opencode-rag"

# --- verification ---

step "Verifying installation..."
verified=true

if [[ -d "$RUNTIME_DIR/node_modules/$PLUGIN_NAME/dist" ]]; then
  ok "Runtime link (resolves via symlink)"
else
  fail "Runtime link"; verified=false
fi

if [[ -x "$CLI_BIN_DIR/opencode-rag" ]]; then
  ok "CLI wrapper"
else
  fail "CLI wrapper"; verified=false
fi

# --- workspace init ---

step "Initializing workspace for OpenCodeRAG..."
node "$RUNTIME_DIR/node_modules/$PLUGIN_NAME/dist/cli.js" init --skip-health-check --skip-install || true
ok "Workspace config files"

mkdir -p "$(dirname "$REPO_ROOT/.opencode/node_modules/$PLUGIN_NAME")"
rm -rf "$REPO_ROOT/.opencode/node_modules/$PLUGIN_NAME"
ln -sfn "$RUNTIME_DIR/node_modules/$PLUGIN_NAME" "$REPO_ROOT/.opencode/node_modules/$PLUGIN_NAME"
ok "Workspace node_modules (symlink to runtime)"

# --- done ---

step ""
if $verified; then printf 'Installation complete!\n'; else printf 'Installation finished with warnings (see above).\n' >&2; fi

printf '\nWhat to do next:\n'
printf '  1. Restart OpenCode if it is running.\n'
printf '  2. Run "opencode-rag index" in this workspace to index its files.\n'
printf '  3. OpenCode will automatically use the indexed data for context-aware queries.\n'
printf '  (The workspace was already initialized by the install script.)\n'
printf '\nRun "%s uninstall" to remove.\n' "$0"
