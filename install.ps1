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

function get_plugin_version {
    return (Get-Content -LiteralPath "$REPO_ROOT\package.json" -Raw | ConvertFrom-Json).version
}

function cleanup_tgz {
    Remove-Item -Path "$RUNTIME_DIR\$PLUGIN_NAME-*.tgz" -Force -ErrorAction SilentlyContinue
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

function warn_if_opencode_running {
    $procs = @(Get-Process -Name "opencode" -ErrorAction SilentlyContinue)
    if ($procs.Count -eq 0) { return }
    Write-Host ""
    Write-Host "WARNING: OpenCode is currently running ($($procs.Count) process(es))." -ForegroundColor Yellow
    foreach ($p in $procs) {
        Write-Host "  PID $($p.Id) - started $($p.StartTime.ToString('yyyy-MM-dd HH:mm:ss'))" -ForegroundColor Yellow
    }
    Write-Host ""
    Write-Host "  OpenCode may have native modules (sharp/libvips) locked, " -ForegroundColor Yellow -NoNewline
    Write-Host "which will cause npm install to fail with EBUSY." -ForegroundColor Yellow
    Write-Host ""
    $choice = $host.UI.PromptForChoice(
        "OpenCode is still running",
        "Terminate all OpenCode processes before installing? Unsaved work may be lost.",
        @(
            [System.Management.Automation.Host.ChoiceDescription]::new("&Kill processes", "Terminate all OpenCode instances and continue")
            [System.Management.Automation.Host.ChoiceDescription]::new("&Cancel install", "Abort — close OpenCode manually, then re-run")
        ),
        1
    )
    if ($choice -eq 1) { die "Installation aborted. Close all OpenCode instances and re-run install.ps1" }
    info "Terminating OpenCode process(es)..."
    $procs | Stop-Process -Force
    Start-Sleep -Seconds 2
    info "OpenCode terminated."
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

    info "Removing from OpenCode runtime ($RUNTIME_DIR)..."
    Remove-Item -LiteralPath "$RUNTIME_DIR\node_modules" -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath "$RUNTIME_DIR\package.json" -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath "$RUNTIME_DIR\.bundle-version" -Force -ErrorAction SilentlyContinue

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

# --- ignore optional ---
if ($args[0] -eq "ignore-optional") {
    step "Installing $PLUGIN_NAME with --ignore-optional (skipping optional native deps)..."
    Push-Location $RUNTIME_DIR
    if (-not (Test-Path "package.json")) {
        @{private = $true; type = "module"} | ConvertTo-Json | Set-Content "package.json"
    }
    $installOutput = cmd /c "npm install $PLUGIN_NAME --no-package-lock --legacy-peer-deps --ignore-optional 2>&1"
    if ($LASTEXITCODE -ne 0) { Pop-Location; die "npm install failed: $installOutput" }
    Pop-Location
    step "Installed $PLUGIN_NAME with --ignore-optional. Restart OpenCode if it is running."
    exit 0
}

# --- install ---

Push-Location $REPO_ROOT

$pluginDir = "$RUNTIME_DIR\node_modules\$PLUGIN_NAME"
$versionFile = Join-Path $RUNTIME_DIR ".bundle-version"

# Rebuild if the bundle marker doesn't exist or if any dist file is newer (source code changed)
$distFiles = @(Get-ChildItem -LiteralPath "$REPO_ROOT\dist" -Recurse -File -ErrorAction SilentlyContinue)
$newestDist = if ($distFiles.Count -gt 0) { ($distFiles | Sort-Object LastWriteTime -Descending)[0].LastWriteTime } else { [datetime]"1970-01-01" }
$bundleTime = (Get-Item $versionFile -ErrorAction SilentlyContinue).LastWriteTime
if (-not $bundleTime) { $bundleTime = [datetime]"1970-01-01" }
$sourceChanged = ($newestDist -gt $bundleTime) -or ($distFiles.Count -gt 0 -and $bundleTime -eq [datetime]"1970-01-01")

# Also rebuild if the installed version doesn't match the repo version
$currentVersion = get_plugin_version
$installedVersion = $null
try {
    $installedVersion = (Get-Content -LiteralPath "$pluginDir\package.json" -Raw | ConvertFrom-Json).version
} catch {}
$versionChanged = $currentVersion -ne $installedVersion

$runtimeReady = (Test-Path -LiteralPath "$pluginDir\dist\cli.js") -and
                (Test-Path -LiteralPath "$RUNTIME_DIR\node_modules\commander") -and
                (Test-Path -LiteralPath "$RUNTIME_DIR\node_modules\@opencode-ai\plugin\package.json") -and
                -not $sourceChanged -and
                -not $versionChanged

if ($runtimeReady) {
    step "Runtime already up-to-date at $RUNTIME_DIR"
    ok "Plugin + dependencies already installed"
} else {
    step "Building $PLUGIN_NAME..."
    npm run build
    if ($LASTEXITCODE -ne 0) { Pop-Location; die "npm run build failed" }

    step "Installing $PLUGIN_NAME into global runtime ($RUNTIME_DIR)..."
    New-Item -ItemType Directory -Path $RUNTIME_DIR -Force | Out-Null

    # Pack plugin (dist/ + wasm/ + package.json, ~13 MB, no node_modules)
    $version = get_plugin_version
    $tgzName = "$PLUGIN_NAME-$version.tgz"
    $tgzPath = Join-Path $REPO_ROOT $tgzName
    Remove-Item -Path $tgzPath -Force -ErrorAction SilentlyContinue
    $null = cmd /c "npm pack --pack-destination `"$REPO_ROOT`" 2>&1"
    if ($LASTEXITCODE -ne 0) { Pop-Location; die "npm pack failed" }

    # Move .tgz to runtime dir
    Move-Item -LiteralPath $tgzPath -Destination $RUNTIME_DIR -Force

    # Warn about running OpenCode (native module locking) and clean stale modules
    warn_if_opencode_running
    if (Test-Path -LiteralPath "$RUNTIME_DIR\node_modules\opencode-rag-plugin") {
        info "Removing stale node_modules to prevent DLL lock conflicts..."
        Remove-Item -LiteralPath "$RUNTIME_DIR\node_modules\opencode-rag-plugin" -Recurse -Force -ErrorAction SilentlyContinue
        if (Test-Path -LiteralPath "$RUNTIME_DIR\node_modules\opencode-rag-plugin") {
            Start-Sleep -Seconds 2
            Remove-Item -LiteralPath "$RUNTIME_DIR\node_modules\opencode-rag-plugin" -Recurse -Force -ErrorAction SilentlyContinue
        }
        if (Test-Path -LiteralPath "$RUNTIME_DIR\node_modules\opencode-rag-plugin") {
            die "Could not remove stale node_modules even after terminating OpenCode. Close any process locking $RUNTIME_DIR\node_modules\opencode-rag-plugin and re-run."
        }
        ok "node_modules"
    }

    # Install from .tgz — resolves all required dependencies (commander, picocolors,
    # sharp, lancedb, etc.) with prebuilt binaries via npm.

    Push-Location $RUNTIME_DIR
    if (-not (Test-Path "package.json")) {
        @{private = $true; type = "module"} | ConvertTo-Json | Set-Content "package.json"
    }
    $installOutput = cmd /c "npm install $tgzName --no-package-lock --legacy-peer-deps 2>&1"
    if ($LASTEXITCODE -ne 0) { Pop-Location; Pop-Location; die "npm install from .tgz failed: $installOutput" }

    # Install @opencode-ai/plugin (peer dep, pure JS, always succeeds)
    $null = cmd /c "npm install @opencode-ai/plugin --no-save 2>&1"

    Pop-Location

    if (-not (Test-Path -LiteralPath "$pluginDir\dist")) {
        Pop-Location; fail_msg "$pluginDir"; die "Failed to install plugin — dist/ not found"
    }
    ok "$pluginDir (installed from $tgzName via npm)"
    $version = get_plugin_version
    Set-Content -Path $versionFile -Value $version
}

step "Making CLI available on PATH..."
New-Item -ItemType Directory -Path $CLI_BIN_DIR -Force | Out-Null
$wrapperLine = '& node "{0}\dist\cli.js" @args' -f $pluginDir
Set-Content -LiteralPath "$CLI_BIN_DIR\opencode-rag.ps1" -Value $wrapperLine -Encoding UTF8
ok "$CLI_BIN_DIR\opencode-rag.ps1"

$pathUpdated = ensure_user_path_contains $CLI_BIN_DIR
if ($pathUpdated) { info "Added $CLI_BIN_DIR to your user PATH" }

# --- verification ---

step "Verifying installation..."
$verified = $true

if (Test-Path -LiteralPath "$pluginDir\dist") { ok "Runtime plugin (installed via npm)" } else { fail_msg "Runtime plugin"; $verified = $false }
if (Test-Path -LiteralPath "$CLI_BIN_DIR\opencode-rag.ps1") { ok "CLI wrapper" } else { fail_msg "CLI wrapper"; $verified = $false }

# --- CLI smoke test ---

step "Verifying CLI works..."
$cliOutput = & "$CLI_BIN_DIR\opencode-rag.ps1" --help 2>&1
if ($LASTEXITCODE -eq 0 -and $cliOutput -match "opencode-rag") {
  ok "CLI help loads successfully"
} else {
  fail_msg "CLI smoke test"; $verified = $false
}

Pop-Location

# --- done ---

step ""
if ($verified) { Write-Host "Installation complete!" -ForegroundColor Green } else { Write-Host "Installation finished with warnings (see above)." -ForegroundColor Yellow }

Write-Host ""
Write-Host "What to do next:"
Write-Host "  1. Run opencode-rag init in each workspace you want to use with OpenCodeRAG."
Write-Host "  2. Run opencode-rag index to index workspace files."
Write-Host "  3. Restart OpenCode if it is running so it discovers the RAG tools."
Write-Host "  4. OpenCode will automatically use the indexed data for context-aware queries."
if ($pathUpdated) {
    $hint = "  5. In your current PowerShell session run: " + '$env:Path += ' + $CLI_BIN_DIR
    Write-Host $hint
}
Write-Host ""
$uninstallHint = "Run " + $PSCommandPath + " uninstall to remove."
Write-Host $uninstallHint
