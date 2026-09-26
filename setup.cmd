@echo off
setlocal
cd /d "%~dp0" || goto :path_error

where node.exe >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js 20 or newer is required. Install it from nodejs.org.
  pause
  exit /b 1
)

where pnpm.cmd >nul 2>&1
if not errorlevel 1 (
  echo Installing dependencies with pnpm...
  call pnpm.cmd install --frozen-lockfile
) else (
  where npm.cmd >nul 2>&1
  if errorlevel 1 (
    echo [ERROR] npm or pnpm was not found. Check your Node.js installation.
    pause
    exit /b 1
  )
  echo Installing dependencies with npm...
  call npm.cmd install --no-audit --no-fund
)
if errorlevel 1 (
  echo [ERROR] Installation failed. Check the network connection.
  pause
  exit /b 1
)

echo Installation completed.
pause
exit /b 0

:path_error
echo [ERROR] Unable to open the monitor folder.
pause
exit /b 1
