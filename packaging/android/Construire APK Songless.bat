@echo off
setlocal
title Construction de Songless pour Android
powershell.exe -NoProfile -ExecutionPolicy Bypass ^
  -File "%~dp0Construire-APK-Songless.ps1"
set "SONGLESS_EXIT=%ERRORLEVEL%"
echo.
if not "%SONGLESS_EXIT%"=="0" (
  echo La construction a echoue. Le message utile est affiche au-dessus.
) else (
  echo APK Songless pret a etre transfere.
)
pause
exit /b %SONGLESS_EXIT%
