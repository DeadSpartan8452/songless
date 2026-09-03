@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Sauvegarder-Signature-Android.ps1"
if errorlevel 1 (
  echo.
  echo La sauvegarde a echoue. Aucun fichier existant n a ete supprime.
  pause
  exit /b 1
)
echo.
echo Sauvegarde de signature Songless terminee.
pause
exit /b 0
