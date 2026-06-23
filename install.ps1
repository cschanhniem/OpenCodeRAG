#!/usr/bin/env pwsh
#Requires -Version 5.1

$ErrorActionPreference = "Stop"

$SCRIPT_DIR = Split-Path -Parent $PSCommandPath
$REPO_ROOT = $SCRIPT_DIR
$PLUGIN_NAME = "opencode-rag-plugin"
$CLI_BIN_DIR = Join-Path (Join-Path $env:USERPROFILE ".local") "bin"
$GLOBAL_CONFIG = Join-Path (Join-Path $env:USERPROFILE ".config") "opencode"
$RUNTIME_DIR = Join-Path $env:USERPROFILE ".opencode"

function die { param([string]$Message); Write-Host "Error: $Message" -ForegroundColor Red; exit 1 }
function info { Write-Host "  $($args -join ' ')" }
function step { Write-Host ""; Write-Host $($args -join ' ') }
function ok { Write-Host "  $($args[0])  OK" -ForegroundColor Green }
function fail_msg { Write-Host "  $($args[0])  FAILED" -ForegroundColor Red }

function ensure_user_path_contains {
    param([string]$Dir)
    if (-not (Test-Path -LiteralPath $Dir -PathType Container)) { return $false }
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ([string]::IsNullOrWhiteSpace($userPath)) { [Environment]::SetEnvironmentVariable("Path", $Dir, "User"); return $true }
    $entries = $userPath -split ";" | Where-Object { $_ -and $_.Trim().Length -gt 0 }
    foreach ($entry in $entries) { if ($entry.TrimEnd('\\') -ieq $Dir.TrimEnd('\\')) { return $false } }
    [Environment]::SetEnvironmentVariable("Path", "$userPath;$Dir", "User")
    return $true
}

function remove_stale_plugin_from_global_config {
    $removed = $false
    foreach ($cfgFile in @("opencode.jsonc", "opencode.json")) {
        $cfgPath = Join-Path $GLOBAL_CONFIG $cfgFile
        if (-not (Test-Path -LiteralPath $cfgPath -PathType Leaf)) { continue }
        try {
            $cfg = Get-Content -LiteralPath $cfgPath -Raw | ConvertFrom-Json
            if ($cfg.plugin) {
                $cfg.PSObject.Properties.Remove('plugin')
                $cfg | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $cfgPath -NoNewline
                Add-Content -LiteralPath $cfgPath -Value "`n"
                info "Removed stale plugin entry from $cfgPath"
                $removed = $true
            }
        } catch { continue }
    }
    return $removed
}

function cleanup_tgz {
    Remove-Item -Path "$RUNTIME_DIR\$PLUGIN_NAME-*.tgz" -Force -ErrorAction SilentlyContinue
}

function remove_from_npm {
    param([string]$dir)
    $pkg = Join-Path $dir "package.json"
    $pluginDir = Join-Path (Join-Path $dir "node_modules") $PLUGIN_NAME
    if (Test-Path -LiteralPath $pluginDir) {
        & cmd /c "rmdir /q `"$pluginDir`" 2>nul"
        if (Test-Path -LiteralPath $pluginDir) {
            Remove-Item -LiteralPath $pluginDir -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
    if (Test-Path -LiteralPath $pkg -PathType Leaf) {
        try {
            $content = Get-Content -LiteralPath $pkg -Raw | ConvertFrom-Json
            if ($content.dependencies -and $content.dependencies.$PLUGIN_NAME) {
                $content.dependencies.PSObject.Properties.Remove($PLUGIN_NAME)
            }
            $content | ConvertTo-Json | Set-Content -LiteralPath $pkg -NoNewline
            Add-Content -LiteralPath $pkg -Value "`n"
        } catch {}
        Push-Location $dir
        & cmd /c "npm prune --prefix `"$dir`" --silent 2>nul"
        Pop-Location
    }
}

function remove_from_config {
    foreach ($cfg in @("opencode.jsonc", "opencode.json")) {
        $cfgpath = Join-Path $GLOBAL_CONFIG $cfg
        if (-not (Test-Path -LiteralPath $cfgpath -PathType Leaf)) { continue }
        try {
            $content = Get-Content -LiteralPath $cfgpath -Raw | ConvertFrom-Json
            if ($content.plugin) {
                $content.plugin = @($content.plugin | Where-Object { $_ -ne $PLUGIN_NAME })
                if ($content.plugin.Count -eq 0) {
                    $content.PSObject.Properties.Remove('plugin')
                }
            }
            $content | ConvertTo-Json | Set-Content -LiteralPath $cfgpath -NoNewline
            Add-Content -LiteralPath $cfgpath -Value "`n"
            info "Removed $PLUGIN_NAME from $cfgpath"
        } catch {}
    }
}

# --- preflight checks ---

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { die "npm is required but was not found in PATH" }
if (-not (Get-Command opencode -ErrorAction SilentlyContinue)) { die "opencode is required but was not found in PATH" }

# --- uninstall ---

if ($args[0] -eq "uninstall") {
    step "Uninstalling $PLUGIN_NAME from all locations..."

    info "Removing CLI wrapper..."
    Remove-Item -Path "$CLI_BIN_DIR\opencode-rag.ps1" -Force -ErrorAction SilentlyContinue
    Remove-Item -Path "$CLI_BIN_DIR\opencode-rag" -Force -ErrorAction SilentlyContinue
    Remove-Item -Path "$CLI_BIN_DIR\opencode-rag.sh" -Force -ErrorAction SilentlyContinue

    info "Removing from global config ($GLOBAL_CONFIG)..."
    remove_from_npm $GLOBAL_CONFIG

    info "Removing from OpenCode runtime ($RUNTIME_DIR)..."
    remove_from_npm $RUNTIME_DIR

    info "Removing .tgz package files..."
    cleanup_tgz
    Remove-Item -Path "$GLOBAL_CONFIG\$PLUGIN_NAME-*.tgz" -Force -ErrorAction SilentlyContinue

    info "Removing OpenCode cache..."
    Remove-Item -Path "$env:USERPROFILE\.cache\opencode\packages\$PLUGIN_NAME-*" -Recurse -Force -ErrorAction SilentlyContinue

    info "Updating OpenCode configuration..."
    remove_from_config

    info "Removing stale plugin registrations..."
    remove_stale_plugin_from_global_config | Out-Null

    info "Removing workspace-local files..."
    Remove-Item -Path "$REPO_ROOT\.opencode\plugins\rag-plugin.js" -Force -ErrorAction SilentlyContinue
    Remove-Item -Path "$REPO_ROOT\.opencode\plugins\package.json" -Force -ErrorAction SilentlyContinue
    Remove-Item -Path "$REPO_ROOT\.opencode\plugins" -Recurse -Force -ErrorAction SilentlyContinue

    step "Uninstalled. Restart OpenCode if it is running."
    exit 0
}

# --- install ---

Set-Location $REPO_ROOT

step "Building $PLUGIN_NAME..."
& cmd /c "npm run build"
if ($LASTEXITCODE -ne 0) { die "npm run build failed" }

step "Installing into OpenCode runtime ($RUNTIME_DIR)..."
$junctionScript = Join-Path $REPO_ROOT "scripts\make-junction.cjs"
& node $junctionScript "$RUNTIME_DIR\node_modules\$PLUGIN_NAME" "$REPO_ROOT"
if ($LASTEXITCODE -eq 0) { ok "Runtime node_modules (junction to repo)" } else { fail_msg "Runtime node_modules"; die "Failed to link runtime node_modules" }

step "Making CLI available on PATH..."
New-Item -ItemType Directory -Path $CLI_BIN_DIR -Force | Out-Null
$wrapperLine = '& node "{0}\node_modules\{1}\dist\cli.js" @args' -f $RUNTIME_DIR, $PLUGIN_NAME
Set-Content -LiteralPath "$CLI_BIN_DIR\opencode-rag.ps1" -Value $wrapperLine -Encoding UTF8
ok "$CLI_BIN_DIR\opencode-rag.ps1"

$pathUpdated = ensure_user_path_contains $CLI_BIN_DIR
if ($pathUpdated) { info "Added $CLI_BIN_DIR to your user PATH" }

# --- verification ---

step "Verifying installation..."
$verified = $true

$runtimeLink = "$RUNTIME_DIR\node_modules\$PLUGIN_NAME"
if (Test-Path -LiteralPath "$runtimeLink\dist") { ok "Runtime link (resolves via junction)" } else { fail_msg "Runtime link"; $verified = $false }

if (Test-Path -LiteralPath "$CLI_BIN_DIR\opencode-rag.ps1") { ok "CLI wrapper" } else { fail_msg "CLI wrapper"; $verified = $false }

# --- workspace init ---

step "Initializing workspace for OpenCodeRAG..."
& node "$runtimeLink\dist\cli.js" init --skip-health-check --skip-install
if ($LASTEXITCODE -eq 0) { ok "Workspace config files" } else { Write-Host "  init command completed with warnings, continuing..." -ForegroundColor Yellow }

$workspaceNodeModules = Join-Path $REPO_ROOT ".opencode\node_modules"
& node $junctionScript "$workspaceNodeModules\$PLUGIN_NAME" $runtimeLink
ok "Workspace node_modules (junction to runtime)"

# --- done ---

step ""
if ($verified) { Write-Host "Installation complete!" -ForegroundColor Green } else { Write-Host "Installation finished with warnings (see above)." -ForegroundColor Yellow }

Write-Host ""
Write-Host "What to do next:"
Write-Host "  1. Restart OpenCode if it is running."
Write-Host "  2. Run opencode-rag index in this workspace to index its files."
Write-Host "  3. OpenCode will automatically use the indexed data for context-aware queries."
Write-Host "  (The workspace was already initialized by the install script.)"
if ($pathUpdated) {
    $hint = "  4. In your current PowerShell session run: " + '$env:Path += ' + $CLI_BIN_DIR
    Write-Host $hint
}
Write-Host ""
$uninstallHint = "Run " + $PSCommandPath + " uninstall to remove."
Write-Host $uninstallHint
