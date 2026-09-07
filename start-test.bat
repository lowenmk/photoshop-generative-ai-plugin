@echo off
setlocal

cd /d C:\ai\photoshop\photoshop-sd-plugin

set EASYSD_DEV_TEST_API=1
set NODE_OPTIONS=--openssl-legacy-provider

echo === Easy SD Photoshop Plugin - TEST MODE ===
echo.

echo Checking port 8088...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$listener = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 8088 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($listener) { $process = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue; if ($process) { Write-Host ('Port 8088 is already in use by PID ' + $process.Id + ' (' + $process.ProcessName + ').'); } else { Write-Host ('Port 8088 is already in use by PID ' + $listener.OwningProcess + '.'); } exit 1 }"
if errorlevel 1 (
  echo.
  echo Existing bridge detected. No new Uvicorn process was started.
  exit /b 1
)

echo Starting dev-test FastAPI bridge on port 8088...
start "EasySD Test Bridge" cmd /k ^
  ".\venv\Scripts\python.exe -m uvicorn --app-dir=local_server main:app --port 8088"

echo.
echo Starting UXP service...
start "UXP Service" cmd /k ^
  "uxp service start"

timeout /t 2 /nobreak >nul

echo.
echo Loading/reloading Photoshop plugin...

uxp plugin load --manifest "C:\ai\photoshop\photoshop-sd-plugin\dist\manifest.json"
if errorlevel 1 (
    uxp plugin reload --manifest "C:\ai\photoshop\photoshop-sd-plugin\dist\manifest.json"
)

echo.
echo TEST MODE READY
echo Bridge: http://127.0.0.1:8088
echo Dev health: http://127.0.0.1:8088/dev/photoshop/health
echo.

pause
