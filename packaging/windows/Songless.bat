@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass ^
  -File "%~dp0Lancer-Songless.ps1" -Mode menu
