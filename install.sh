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

get_plugin_version() {
  node -e "console.log(JSON.parse(require('fs').readFileSync('$REPO_ROOT/package.json','utf-8')).version)"
}

cleanup_tgz() {
  rm -f "$RUNTIME_DIR/$PLUGIN_NAME-"*.tgz
}

remove_from_config() {
  for cfg in opencode.jsonc opencode.json; do
    local cfgpath="$GLOBAL_CONFIG/$cfg"
    [[ -f "$cfgpath" ]] || continue
    node -e "const fs=require('fs');const c=JSON.parse(fs.readFileSync('$cfgpath','utf8'));if(c.plugin){c.plugin=c.plugin.filter(p=>p!=='$PLUGIN_NAME');if(c.plugin.length===0)delete c.plugin}fs.writeFileSync('$cfgpath',JSON.stringify(c,null,2)+'\n')"
    info "Removed $PLUGIN_NAME from $cfgpath"
  done
}

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

# --- preflight ---

command -v npm >/dev/null 2>&1 || die "npm is required but was not found in PATH"
command -v opencode >/dev/null 2>&1 || die "opencode is required but was not found in PATH"

# --- uninstall ---

if [[ "${1:-}" = "uninstall" ]]; then
  step "Uninstalling $PLUGIN_NAME from all locations..."
  info "Removing CLI wrapper..."
  rm -f "$CLI_BIN_DIR/opencode-rag" "$CLI_BIN_DIR/opencode-rag.ps1" "$CLI_BIN_DIR/opencode-rag.sh"
  info "Removing from OpenCode runtime ($RUNTIME_DIR)..."
  rm -rf "$RUNTIME_DIR/node_modules" "$RUNTIME_DIR/package.json"
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

plugin_dir="$RUNTIME_DIR/node_modules/$PLUGIN_NAME"
version=$(get_plugin_version)
version_file="$RUNTIME_DIR/.bundle-version"
version_match=false
[[ -f "$version_file" ]] && [[ "$(cat "$version_file")" = "$version" ]] && version_match=true
if [[ -d "$plugin_dir/dist/cli.js" ]] && \
   [[ -d "$RUNTIME_DIR/node_modules/commander" ]] && \
   [[ -f "$RUNTIME_DIR/node_modules/@opencode-ai/plugin/package.json" ]] && \
   $version_match; then
  step "Runtime already up-to-date at $RUNTIME_DIR"
  ok "Plugin + dependencies already installed"
else
  step "Building $PLUGIN_NAME..."
  npm run build

  step "Installing $PLUGIN_NAME into global runtime ($RUNTIME_DIR)..."
  mkdir -p "$RUNTIME_DIR"

  # Pack plugin (dist/ + wasm/ + package.json, ~13 MB, no node_modules)
  version=$(get_plugin_version)
  tgz_name="$PLUGIN_NAME-$version.tgz"
  tgz_path="$REPO_ROOT/$tgz_name"
  rm -f "$tgz_path"
  npm pack --pack-destination "$REPO_ROOT" 2>/dev/null
  if [[ $? -ne 0 ]]; then die "npm pack failed"; fi

  # Move .tgz to runtime dir
  mv "$tgz_path" "$RUNTIME_DIR/"
  tgz_path="$RUNTIME_DIR/$tgz_name"

  # Install from .tgz — resolves ALL dependencies (commander, picocolors, canvas,
  # sharp, lancedb, etc.) with prebuilt binaries via npm. This is the ONE install.
  if [[ ! -f "$RUNTIME_DIR/package.json" ]]; then
    printf '{"private":true,"type":"module"}\n' > "$RUNTIME_DIR/package.json"
  fi
  if ! (cd "$RUNTIME_DIR" && npm install "./$tgz_name" --no-package-lock --legacy-peer-deps --ignore-scripts 2>/dev/null); then
    die "npm install from .tgz failed"
  fi

  # Install @opencode-ai/plugin (peer dep, pure JS, always succeeds)
  (cd "$RUNTIME_DIR" && npm install @opencode-ai/plugin --no-save 2>/dev/null || true)

  if [[ ! -d "$plugin_dir/dist" ]]; then
    fail "$plugin_dir"; die "Failed to install plugin — dist/ not found"
  fi
  ok "$plugin_dir (installed from $tgz_name via npm)"
  printf '%s\n' "$version" > "$version_file"
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

if [[ -d "$plugin_dir/dist" ]]; then
  ok "Runtime plugin (installed via npm)"
else
  fail "Runtime plugin"; verified=false
fi

if [[ -x "$CLI_BIN_DIR/opencode-rag" ]]; then
  ok "CLI wrapper"
else
  fail "CLI wrapper"; verified=false
fi

# --- CLI smoke test ---

step "Verifying CLI works..."
cli_help=$("$CLI_BIN_DIR/opencode-rag" --help 2>&1)
if echo "$cli_help" | grep -q "opencode-rag"; then
  ok "CLI help loads successfully"
else
  fail "CLI smoke test"; verified=false
fi

# --- done ---

step ""
if $verified; then printf 'Installation complete!\n'; else printf 'Installation finished with warnings (see above).\n' >&2; fi

printf '\nWhat to do next:\n'
printf '  1. Run "opencode-rag init" in each workspace you want to use with OpenCodeRAG.\n'
printf '  2. Run "opencode-rag index" to index workspace files.\n'
printf '  3. Restart OpenCode if it is running so it discovers the RAG tools.\n'
printf '  4. OpenCode will automatically use the indexed data for context-aware queries.\n'
printf '\nRun "%s uninstall" to remove.\n' "$0"
