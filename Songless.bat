@echo off
chcp 65001 >nul

if /i "%~1"=="--local" goto local
if /i "%~1"=="--lan" goto lan
if /i "%~1"=="--internet" goto internet
if /i "%~1"=="--elevated" goto internet_elevated

cls
echo SONGLESS
echo.
echo [1] Local - ce PC uniquement, sans Internet
echo [2] Reseau maison - telephones et TV sur le Wi-Fi
echo [3] Internet - invitation HTTPS avec Tailscale
echo.
choice /c 123 /n /m "Choisis 1, 2 ou 3 : "
if errorlevel 3 goto internet
if errorlevel 2 goto lan

:local
powershell.exe -NoProfile -ExecutionPolicy Bypass ^
  -File "%~dp0Songless.ps1"
exit /b %errorlevel%

:lan
powershell.exe -NoProfile -ExecutionPolicy Bypass ^
  -File "%~dp0Songless.ps1" -Lan
exit /b %errorlevel%

:internet
REM Tailscale protege Funnel derriere les droits administrateur.
set "SONGLESS_LAUNCHER=%~f0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "$q=[char]34 + $env:SONGLESS_LAUNCHER + [char]34" ^
  " + ' --elevated';" ^
  "Start-Process -FilePath $env:ComSpec -Verb RunAs" ^
  " -ArgumentList @('/d','/c',$q)"
if errorlevel 1 (
  echo.
  echo La validation Windows a ete annulee ou a echoue.
  pause
)
exit /b

:internet_elevated
title Songless Internet - fermer pour arreter
powershell.exe -NoProfile -ExecutionPolicy Bypass ^
  -File "%~dp0tools\start-internet.ps1"
if errorlevel 1 (
  echo.
  echo Le lancement a echoue. Message ci-dessus.
  pause
)
exit /b %errorlevel%
