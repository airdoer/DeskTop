@echo off
rem ============================================================
rem  Common setup shared by every script in shell\
rem  Usage:  call "%~dp0_common.bat"
rem  Exports: PROJECT_DIR  APP_NAME  VERSION  RUNNER  PKG  OUT_ROOT
rem ============================================================
chcp 65001 >nul

rem Every script may be launched from anywhere (double click, IDE, cmd),
rem so always jump back to the project root (parent of shell\).
cd /d "%~dp0.."
set "PROJECT_DIR=%CD%"

rem electron-builder 26.x spawns the package manager via cross-spawn, which needs
rem powershell.exe; some environments miss WindowsPowerShell in PATH ("spawn ENOENT").
set "PATH=%PATH%;C:\Windows\System32\WindowsPowerShell\v1.0"

where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] node not found in PATH.
    pause
    exit /b 1
)

rem RUNNER = run a local binary (vite / electron-builder)
rem PKG    = run a package.json script (dev)
set "RUNNER=npx"
set "PKG=npm run"
where pnpm >nul 2>nul
if not errorlevel 1 (
    set "RUNNER=pnpm exec"
    set "PKG=pnpm run"
)

rem APP_NAME follows electron-builder's product name so the verify step can find
rem the real executable (defaults to package.json "name" when productName is unset,
rem e.g. "DeskTop" here -> win-unpacked\DeskTop.exe).
for /f "delims=" %%i in ('node -p "require('./package.json').productName || require('./package.json').name"') do set "APP_NAME=%%i"
for /f "delims=" %%i in ('node -p "require('./package.json').version"') do set "VERSION=%%i"

rem Unified output root: builds\<version>\<mode>
set "OUT_ROOT=builds\%VERSION%"
exit /b 0
