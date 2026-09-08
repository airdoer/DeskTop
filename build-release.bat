@echo off
cd /d "%~dp0"

REM ============================================================
REM  Build and Auto-Release Electron App (build + copy exe)
REM ============================================================

REM ====== Config: release target dir (edit as needed) ======
set "TARGET_DIR=D:\Release\DeskTop"
REM ==========================================================

where pnpm >nul 2>nul
if errorlevel 1 (
    echo [ERROR] pnpm not found in PATH.
    echo Please install pnpm first: npm install -g pnpm
    pause
    exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] node not found in PATH.
    pause
    exit /b 1
)

REM ============================================================
REM  Fix electron-builder 26.x known issue on Windows:
REM  "Node module collector spawn ... failed: spawn powershell.exe ENOENT"
REM  cross-spawn needs powershell.exe to run pnpm.CMD,
REM  but some environments miss WindowsPowerShell in PATH.
REM ============================================================
set "PATH=%PATH%;C:\Windows\System32\WindowsPowerShell\v1.0"

REM Read app name and version from package.json
for /f "delims=" %%i in ('node -p "require('./package.json').name"') do set "APP_NAME=%%i"
for /f "delims=" %%i in ('node -p "require('./package.json').version"') do set "VERSION=%%i"

echo App name : %APP_NAME%
echo Version  : %VERSION%
echo Target   : %TARGET_DIR%
echo.
echo [1/3] Building an install package with electron-builder...
echo.

call pnpm build
if errorlevel 1 (
    echo.
    echo [ERROR] Build failed!
    pause
    exit /b 1
)

REM Output path: release\<version>\<name>_<version>.exe
set "EXE_FILE=%APP_NAME%_%VERSION%.exe"
set "SRC=release\%VERSION%\%EXE_FILE%"

if not exist "%SRC%" (
    echo.
    echo [ERROR] exe not found: %SRC%
    echo Please check electron-builder.json directories.output settings.
    pause
    exit /b 1
)

echo.
echo [2/3] Creating target directory if needed...
if not exist "%TARGET_DIR%" mkdir "%TARGET_DIR%"

echo.
echo [3/3] Copying exe to target directory...
copy /Y "%SRC%" "%TARGET_DIR%\%EXE_FILE%" >nul
if errorlevel 1 (
    echo [ERROR] Copy failed!
    pause
    exit /b 1
)

echo.
echo ============================================
echo  [OK] Release done!
echo  File: %TARGET_DIR%\%EXE_FILE%
echo ============================================
echo.
pause
