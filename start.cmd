@echo off
cd /d "%~dp0" || exit /b 1
if exist "%~dp0GNZ48-Monitor.exe" (
  start "" "%~dp0GNZ48-Monitor.exe"
) else (
  start "" "%SystemRoot%\System32\wscript.exe" "%~dp0start-desktop.vbs"
)
exit /b 0
