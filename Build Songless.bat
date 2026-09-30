@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\build-host-packages.ps1"
if errorlevel 1 (
  echo La creation des fichiers Songless a echoue.
  pause
  exit /b 1
)
pause
