# Kiln v4 — Windows Installer
$ErrorActionPreference = "Stop"

$Repo = "https://github.com/Fredasterehub/kiln.git"
$Branch = "v4"
$TmpDir = Join-Path $env:TEMP "kiln-install-$(Get-Random)"

# ── Banner ──────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  ╔══════════════════════════════════════════╗" -ForegroundColor DarkYellow
Write-Host "  ║                                          ║" -ForegroundColor DarkYellow
Write-Host "  ║        🔥  K I L N  —  v4                ║" -ForegroundColor DarkYellow
Write-Host "  ║                                          ║" -ForegroundColor DarkYellow
Write-Host "  ║   Multi-model orchestration pipeline     ║" -ForegroundColor DarkYellow
Write-Host "  ║   for Claude Code                        ║" -ForegroundColor DarkYellow
Write-Host "  ║                                          ║" -ForegroundColor DarkYellow
Write-Host "  ╚══════════════════════════════════════════╝" -ForegroundColor DarkYellow
Write-Host ""

# ── Preflight checks ───────────────────────────────────────────────
Write-Host "  Preflight checks" -ForegroundColor DarkYellow
Write-Host ""

# Check git
if (Get-Command git -ErrorAction SilentlyContinue) {
    Write-Host "  ✓ git found" -ForegroundColor Green
} else {
    Write-Host "  ✗ git not found — install git first" -ForegroundColor Red
    exit 1
}

# Check Claude Code
if (Get-Command claude -ErrorAction SilentlyContinue) {
    Write-Host "  ✓ Claude Code found" -ForegroundColor Green
} else {
    Write-Host "  ✗ Claude Code not found" -ForegroundColor Red
    Write-Host "  Install: npm i -g @anthropic-ai/claude-code"
    exit 1
}

# Check Codex CLI
if (Get-Command codex -ErrorAction SilentlyContinue) {
    Write-Host "  ✓ Codex CLI found" -ForegroundColor Green
} else {
    Write-Host "  ✗ Codex CLI not found" -ForegroundColor Red
    Write-Host "  Install: npm i -g @openai/codex"
    exit 1
}

Write-Host ""

# ── Install mode ────────────────────────────────────────────────────
Write-Host "  Where would you like to install Kiln?" -ForegroundColor DarkYellow
Write-Host ""
Write-Host "  1)  Global plugin — available in every project" -ForegroundColor White
Write-Host "      $env:USERPROFILE\.claude\plugins\kiln\" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  2)  This project only — scoped to current directory" -ForegroundColor White
Write-Host "      $(Get-Location)\.claude\plugins\kiln\" -ForegroundColor DarkGray
Write-Host ""

$Choice = Read-Host "  Choice [1/2]"

if ($Choice -eq "2") {
    $PluginDir = Join-Path (Get-Location) ".claude\plugins\kiln"
    $Scope = "project"
} else {
    $PluginDir = Join-Path $env:USERPROFILE ".claude\plugins\kiln"
    $Scope = "global"
}

# ── Existing install ───────────────────────────────────────────────
if (Test-Path $PluginDir) {
    Write-Host ""
    Write-Host "  Existing installation found." -ForegroundColor Yellow
    $Overwrite = Read-Host "  Overwrite? [Y/n]"
    if ($Overwrite -match "^[Nn]") {
        Write-Host "  Aborted."
        exit 0
    }
    Remove-Item -Recurse -Force $PluginDir
}

# ── Download ────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  Installing" -ForegroundColor DarkYellow
Write-Host ""

Write-Host "  ▸ Downloading Kiln v4..." -ForegroundColor Cyan
git clone --depth 1 --branch $Branch $Repo "$TmpDir\kiln" 2>$null
Write-Host "  ✓ Downloaded" -ForegroundColor Green

# ── Copy plugin files ──────────────────────────────────────────────
Write-Host "  ▸ Copying plugin files..." -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $PluginDir | Out-Null
Copy-Item -Recurse "$TmpDir\kiln\.claude-plugin" "$PluginDir\"
Copy-Item -Recurse "$TmpDir\kiln\agents" "$PluginDir\"
Copy-Item -Recurse "$TmpDir\kiln\commands" "$PluginDir\"
Copy-Item -Recurse "$TmpDir\kiln\skills" "$PluginDir\"
Write-Host "  ✓ Installed to $PluginDir" -ForegroundColor Green

# ── Count ──────────────────────────────────────────────────────────
$AgentCount = (Get-ChildItem "$PluginDir\agents\*.md").Count
$CommandCount = (Get-ChildItem "$PluginDir\commands\*.md").Count

# ── Cleanup ─────────────────────────────────────────────────────────
Remove-Item -Recurse -Force $TmpDir
Write-Host "  ✓ Cleaned up temporary files" -ForegroundColor Green

# ── Summary ─────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  ────────────────────────────────────────────" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  Ready to fire" -ForegroundColor DarkYellow
Write-Host ""
Write-Host "  Kiln v4 installed successfully." -ForegroundColor Green
Write-Host ""
Write-Host "  $AgentCount agents  ·  $CommandCount commands  ·  1 skill" -ForegroundColor DarkGray
Write-Host "  Scope: $Scope  ·  Path: $PluginDir" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  ────────────────────────────────────────────" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  Open Claude Code with:"
Write-Host ""
Write-Host "    claude --dangerously-skip-permissions" -ForegroundColor White
Write-Host ""
Write-Host "  Then type:"
Write-Host ""
Write-Host "    /kiln-fire" -ForegroundColor White
Write-Host ""
Write-Host "  That's it. Da Vinci will take it from here." -ForegroundColor DarkGray
Write-Host ""
