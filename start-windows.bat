@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 22 LTS or newer, then run this file again.
  pause
  exit /b 1
)
if not exist node_modules (
  call npm ci
  if errorlevel 1 (
    echo Dependency installation failed. Please check your network.
    pause
    exit /b 1
  )
)
echo Open http://localhost:4173 in your browser.
call npm run dev
pause
