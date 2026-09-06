@echo off
setlocal EnableExtensions

set "REPO_ROOT=%~dp0"
set "VENDORED=%REPO_ROOT%third_party\sd-webui-controlnet"
set "FROZEN_SHA=56cec5b2958edf3b1807b7e7b2b1b5186dbd2f81"

echo EasySD frozen ControlNet installer
echo.
set /p "A1111_ROOT=Enter the Automatic1111 root directory: "
if not defined A1111_ROOT (
  echo No directory supplied.
  exit /b 1
)
if not exist "%A1111_ROOT%\webui.py" (
  echo This does not look like an Automatic1111 root: %A1111_ROOT%
  exit /b 1
)
if not exist "%A1111_ROOT%\webui-user.bat" (
  echo Missing webui-user.bat; refusing to install into this directory.
  exit /b 1
)
if not exist "%A1111_ROOT%\modules\" (
  echo Missing modules directory; refusing to install into this directory.
  exit /b 1
)
if not exist "%A1111_ROOT%\extensions\" (
  echo Missing extensions directory; refusing to install into this directory.
  exit /b 1
)
if not exist "%VENDORED%\ANZOTH_VENDOR_INFO.md" (
  echo Vendored ControlNet snapshot is missing.
  exit /b 1
)

set "TARGET=%A1111_ROOT%\extensions\sd-webui-controlnet"
if exist "%TARGET%" (
  if exist "%TARGET%\ANZOTH_VENDOR_MARKER.txt" (
    findstr /C:"upstream_commit=%FROZEN_SHA%" "%TARGET%\ANZOTH_VENDOR_MARKER.txt" >nul
    if not errorlevel 1 (
      echo Exact EasySD frozen snapshot already installed.
      echo No files changed.
      exit /b 0
    )
    echo A different or invalid EasySD marker was found.
  ) else (
    echo Existing ControlNet extension found at:
    echo   %TARGET%
  )
  echo Existing files will be preserved in a backup before replacement.
  choice /C YN /N /M "Replace this existing ControlNet directory? [Y/N] "
  if errorlevel 2 (
    echo Installation cancelled; no files changed.
    exit /b 2
  )
  set "BACKUP=%TARGET%.backup-%RANDOM%"
  move "%TARGET%" "%BACKUP%" >nul
  if errorlevel 1 (
    echo Could not preserve the existing ControlNet directory.
    exit /b 1
  )
  echo Existing directory preserved at %BACKUP%
) else (
  echo No existing ControlNet extension found.
)

echo Installing the frozen snapshot from this repository only.
mkdir "%TARGET%"
robocopy "%VENDORED%" "%TARGET%" /E /XD .git __pycache__ .github example samples tests unit_tests web_tests /XF *.pyc *.data *.ckpt *.safetensors *.pt *.bin *.pth >nul
if errorlevel 8 (
  echo Installation failed.
  exit /b 1
)

>"%TARGET%\ANZOTH_VENDOR_MARKER.txt" echo upstream_repository=https://github.com/Mikubill/sd-webui-controlnet
>>"%TARGET%\ANZOTH_VENDOR_MARKER.txt" echo upstream_commit=%FROZEN_SHA%
>>"%TARGET%\ANZOTH_VENDOR_MARKER.txt" echo installed_by=easy-photoshop-stable-diffusion-plugin

echo.
echo Frozen ControlNet snapshot installed.
echo Restart Automatic1111 before validating the ControlNet API.
exit /b 0
