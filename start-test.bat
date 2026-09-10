@echo off
setlocal

cd /d "%~dp0"

rem The PowerShell supervisor owns the bridge lifetime. Do not detach it with cmd /k.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-test-supervisor.ps1"
exit /b %ERRORLEVEL%
