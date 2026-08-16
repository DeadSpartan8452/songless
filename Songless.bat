@echo off
chcp 65001 >nul

REM Tailscale sous Windows protege Funnel derriere les droits administrateur.
REM Le lanceur demande donc une validation UAC, puis garde une fenetre visible
REM afin qu'une erreur ne disparaisse plus dans une console reduite.
if /i not "%~1"=="--elevated" (
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
)

REM Lanceur principal Songless : PC, telephones et lien Internet HTTPS.
REM La fenetre reste ouverte. La fermer coupe le lien public.

title Songless Internet - fermer pour arreter

set "SONGLESS_START_OPTION="
if /i "%~2"=="--no-browser" set "SONGLESS_START_OPTION=-SkipBrowser"

powershell.exe -NoProfile -ExecutionPolicy Bypass ^
  -File "%~dp0tools\start-internet.ps1" %SONGLESS_START_OPTION%

if errorlevel 1 (
    echo.
    echo Le lancement a echoue. Message ci-dessus.
    pause
)
