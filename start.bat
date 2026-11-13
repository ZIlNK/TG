@echo off
setlocal
cd /d "%~dp0"

echo ============================================
echo   Text Game Launcher (build + server + browser)
echo ============================================
echo.

rem Check Node
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Install Node 18+ from https://nodejs.org
  pause
  exit /b 1
)

rem Build frontend (pass -s or --no-build to skip)
if /i "%~1"=="-s" goto :skip_build
if /i "%~1"=="--no-build" goto :skip_build

echo [1/3] Building frontend (build.bat)...
call build.bat
if errorlevel 1 (
  echo [ERROR] Build failed.
  pause
  exit /b 1
)
goto :check_dist

:skip_build
echo [1/3] Skipping build.

:check_dist
if not exist "dist\index.html" (
  echo [ERROR] dist\index.html not found. Run build.bat first.
  pause
  exit /b 1
)

echo [2/3] Starting backend (server/index.js)...
start "TG-Backend" cmd /k "chcp 65001 >nul && node server/index.js"

echo [3/3] Opening browser...
timeout /t 2 /nobreak >nul
start "" http://localhost:3000

echo.
echo Done! Backend runs in the "TG-Backend" window (close it to stop).
echo Logs: that window's terminal + logs\llm.jsonl / logs\game.jsonl
echo.
pause
endlocal
