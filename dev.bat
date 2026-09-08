@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================
echo  Start Electron App (dev mode)
echo ============================================
echo.

where pnpm >nul 2>nul
if errorlevel 1 (
    echo [ERROR] pnpm not found in PATH.
    echo Please install pnpm first: npm install -g pnpm
    pause
    exit /b 1
)

call pnpm dev

echo.
echo App exited.
pause
