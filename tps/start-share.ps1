# ============ TPS Game One-Click Share Script ============
# Double-click to run. It will:
#   1. Start the game server (localhost:5173)
#   2. Start cloudflared tunnel to expose the game publicly
#   3. Open browser showing the public URL
#
# Close this window to stop sharing.

$ErrorActionPreference = 'Stop'
$cloudflared = "$env:USERPROFILE\cloudflared.exe"

Write-Host "==============================================" -ForegroundColor Cyan
Write-Host "   TPS Multiplayer - Share" -ForegroundColor Cyan
Write-Host "==============================================" -ForegroundColor Cyan

# Check cloudflared
if (-not (Test-Path $cloudflared)) {
    Write-Host "[ERROR] cloudflared.exe not found" -ForegroundColor Red
    Write-Host "Download it first with:" -ForegroundColor Yellow
    Write-Host '  curl.exe -L -o "%USERPROFILE%\cloudflared.exe" "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"' -ForegroundColor Yellow
    Read-Host "Press Enter to exit"
    exit 1
}

# Check dependencies
if (-not (Test-Path "$PSScriptRoot\node_modules\ws")) {
    Write-Host "[INFO] Installing dependencies (npm install) ..." -ForegroundColor Yellow
    Set-Location $PSScriptRoot
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[ERROR] npm install failed" -ForegroundColor Red
        Read-Host "Press Enter to exit"
        exit 1
    }
}

# Check port 5173 and clean up leftover servers
Write-Host ""
Write-Host "[0/3] Checking port 5173 ..." -ForegroundColor Green
$listeners = Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue
if ($listeners) {
    $pids = $listeners | Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($pid in $pids) {
        $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
        if ($proc -and $proc.ProcessName -eq "node") {
            Write-Host "      Killing leftover server (PID $pid) ..." -ForegroundColor Yellow
            Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
        }
    }
    Start-Sleep -Seconds 1
}

# Start game server (background)
Write-Host ""
Write-Host "[1/3] Starting game server (port 5173) ..." -ForegroundColor Green
$nodePath = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $nodePath) {
    Write-Host "[ERROR] Node.js not found in PATH" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}
$server = Start-Process -FilePath $nodePath -ArgumentList "server.js" -WorkingDirectory $PSScriptRoot -PassThru -WindowStyle Minimized
Start-Sleep -Seconds 2

if ($server.HasExited) {
    Write-Host "[ERROR] Server failed to start. Is Node.js installed?" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}
Write-Host "      Server started (PID $($server.Id))" -ForegroundColor Green

# Start cloudflared tunnel
Write-Host ""
Write-Host "[2/3] Starting cloudflared tunnel, connecting ..." -ForegroundColor Green
Write-Host "      (first connection may take a few seconds)" -ForegroundColor Yellow
Write-Host ""

$logFile = "$env:TEMP\cloudflared_tps.log"
$errFile = "$env:TEMP\cloudflared_tps_err.log"
if (Test-Path $logFile) { Remove-Item $logFile -Force }
if (Test-Path $errFile) { Remove-Item $errFile -Force }

$tunnel = Start-Process -FilePath $cloudflared `
    -ArgumentList "tunnel","--url","http://localhost:5173","--no-autoupdate" `
    -RedirectStandardOutput $logFile -RedirectStandardError $errFile `
    -PassThru -WindowStyle Minimized

# Wait for tunnel, extract public URL from log (cloudflared writes to stderr)
$publicUrl = $null
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    foreach ($f in @($logFile, $errFile)) {
        if (Test-Path $f) {
            $content = Get-Content $f -Raw -ErrorAction SilentlyContinue
            if ($content -match 'https://[a-z0-9-]+\.trycloudflare\.com') {
                $publicUrl = $Matches[0]
                break
            }
        }
    }
    if ($publicUrl) { break }
    if ($tunnel.HasExited) { break }
}

Write-Host ""
Write-Host "==============================================" -ForegroundColor Cyan
if ($publicUrl) {
    Write-Host "  Share link ready!" -ForegroundColor Green
    Write-Host "  $publicUrl" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  Send this link to friends, open in browser to play" -ForegroundColor Green
    Start-Process $publicUrl
} else {
    Write-Host "  Could not auto-detect link, see log below" -ForegroundColor Red
    Write-Host "  Or manually open the trycloudflare.com URL shown in log" -ForegroundColor Yellow
}
Write-Host "==============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "[3/3] Sharing active. Close this window to stop." -ForegroundColor Cyan
Write-Host "      (Server PID $($server.Id) / Tunnel PID $($tunnel.Id))" -ForegroundColor DarkGray

# Keep running until window closed
try {
    Wait-Process -Id $tunnel.Id -ErrorAction SilentlyContinue
} catch {
}

# Cleanup
if (-not $server.HasExited) { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
if (-not $tunnel.HasExited) { Stop-Process -Id $tunnel.Id -Force -ErrorAction SilentlyContinue }
