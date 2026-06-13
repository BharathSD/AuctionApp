@echo off
title Cricket Auction
setlocal

:: ── Add bundled Node.js to PATH ──────────────────────────────
set "NODE_DIR=%~dp0node-v24.16.0-win-x64"
if exist "%NODE_DIR%\node.exe" set "PATH=%NODE_DIR%;%PATH%"

:: Check Node is available
node --version >nul 2>&1
if errorlevel 1 (
    echo.
    echo  [ERROR] Node.js not found.
    echo  Install from https://nodejs.org or place the node folder here.
    echo.
    pause
    exit /b 1
)

echo.
echo  ==========================================
echo        Cricket Auction — Starting...
echo  ==========================================
echo.

:: Start backend server in a separate window (needed for online mode)
start "Auction Server — port 3001" cmd /k "set "PATH=%NODE_DIR%;%PATH%" && cd /d "%~dp0server" && node index.js"

:: Wait briefly then start frontend
timeout /t 2 /nobreak >nul
start "Auction Frontend — port 5173" cmd /k "set "PATH=%NODE_DIR%;%PATH%" && cd /d "%~dp0client" && npm run dev"

:: Open browser on the landing page — pick your mode there
timeout /t 4 /nobreak >nul
start "" "http://localhost:5173"

echo  Server and frontend are starting in separate windows.
echo  Your browser will open to the auction landing page.
echo.
echo  Close the Server and Frontend windows to stop.
echo.
pause


