@echo off
if /i not "%~1"=="--minimized" (
    start "Songless Internet - fermer pour arreter" /min ^
      "%ComSpec%" /c ""%~f0" --minimized"
    exit /b
)

chcp 65001 >nul
REM Lanceur principal Songless : PC, telephones et lien Internet HTTPS.
REM Une seule fenetre reduite reste ouverte. La fermer coupe le lien public.

powershell.exe -NoProfile -ExecutionPolicy Bypass ^
  -File "%~dp0tools\start-internet.ps1"

if errorlevel 1 (
    echo.
    echo Le lancement a echoue. Message ci-dessus.
    pause
)
