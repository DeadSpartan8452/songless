@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden ^
  -File "%~dp0Lancer-Songless.ps1" -Mode internet
