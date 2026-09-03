@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Restaurer-Signature-Android.ps1"
if errorlevel 1 (
  echo.
  echo La restauration a echoue. La signature locale n a pas ete remplacee.
  pause
  exit /b 1
)
echo.
echo Signature Songless restauree.
pause
exit /b 0
