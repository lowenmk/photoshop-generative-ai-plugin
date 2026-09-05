$ErrorActionPreference = "Stop"

$Repo = "C:\ai\photoshop\photoshop-sd-plugin"
$Python = Join-Path $Repo "venv\Scripts\python.exe"
$Manifest = Join-Path $Repo "dist\manifest.json"

Set-Location $Repo

$env:NODE_OPTIONS = "--openssl-legacy-provider"
$env:Path += ";$env:LOCALAPPDATA\Yarn\bin"

Write-Host "=== Easy SD Photoshop Plugin ==="

# ------------------------------------------------------------
# Python environment
# ------------------------------------------------------------

if (-not (Test-Path $Python)) {
    Write-Host "Creating Python virtual environment..."
    python -m venv "$Repo\venv"
}

Write-Host "Installing/updating Python requirements..."
& $Python -m pip install -r "$Repo\local_server\requirements.txt"

# ------------------------------------------------------------
# Kill stale bridge instances
# ------------------------------------------------------------

Write-Host "Stopping stale uvicorn processes..."

Get-CimInstance Win32_Process |
    Where-Object {
        $_.CommandLine -and
        $_.CommandLine -match "uvicorn" -and
        $_.CommandLine -match "photoshop"
    } |
    ForEach-Object {
        Write-Host "Stopping PID $($_.ProcessId)"
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }

Start-Sleep -Seconds 1

# ------------------------------------------------------------
# Build plugin
# ------------------------------------------------------------

Write-Host "Building plugin..."

& npm.cmd run build

if ($LASTEXITCODE -ne 0) {
    throw "Plugin build failed."
}

# ------------------------------------------------------------
# Start Python bridge
# ------------------------------------------------------------

Write-Host "Starting FastAPI bridge on port 8088..."

Start-Process powershell.exe -ArgumentList @(
    "-NoExit",
    "-Command",
    "& '$Python' -m uvicorn --app-dir='$Repo\local_server' main:app --reload --port 8088"
)

# ------------------------------------------------------------
# Start UXP service
# ------------------------------------------------------------

Write-Host "Starting UXP service..."

Start-Process powershell.exe -ArgumentList @(
    "-NoExit",
    "-Command",
    "`$env:Path += ';$env:LOCALAPPDATA\Yarn\bin'; uxp service start"
)

Start-Sleep -Seconds 2

# ------------------------------------------------------------
# Load / reload plugin
# ------------------------------------------------------------

Write-Host "Loading Photoshop plugin..."

try {
    & uxp plugin load --manifest $Manifest
}
catch {
    Write-Host "Load failed; trying reload..."
    & uxp plugin reload --manifest $Manifest
}

Write-Host ""
Write-Host "Ready."
Write-Host "Bridge:  http://127.0.0.1:8088"
Write-Host "A1111:   http://127.0.0.1:7860"
Write-Host "Manifest: $Manifest"