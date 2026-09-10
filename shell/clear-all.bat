@echo off
rem ============================================================
rem  Delete every export under builds\ (all versions, all modes:
rem  installer / portable / dir / _testout ...).
rem
rem  Usage:  shell\clear-all.bat        (asks for confirmation)
rem          shell\clear-all.bat /y     (no prompt, for CI)
rem
rem  Why: builds\ grows fast (each run leaves a few hundred MB of
rem  unpacked Electron). This resets it without touching dist\,
rem  dist-electron\ or node_modules\.
rem ============================================================
chcp 65001 >nul

rem Every script may be launched from anywhere (double click, IDE, cmd),
rem so always jump back to the project root (parent of shell\).
cd /d "%~dp0.."
set "PROJECT_DIR=%CD%"
set "BUILD_DIR=%CD%\builds"

set "QUIET="
if /i "%~1"=="/y" set "QUIET=1"
if /i "%~1"=="-y" set "QUIET=1"
if /i "%~1"=="--yes" set "QUIET=1"

echo ============================================
echo  Clear all exports under builds\
echo ============================================
echo Target : %BUILD_DIR%
echo.

if not exist "%BUILD_DIR%\" (
    echo [INFO] Nothing to do: builds\ does not exist.
    if not defined QUIET pause
    exit /b 0
)

rem Count top level entries (0 when the directory is already empty).
set "COUNT=0"
for /f %%i in ('dir /b /a "%BUILD_DIR%" 2^>nul ^| find /c /v ""') do set "COUNT=%%i"
if "%COUNT%"=="0" (
    echo [INFO] builds\ is already empty.
    if not defined QUIET pause
    exit /b 0
)
echo Entries : %COUNT%

if not defined QUIET (
    echo.
    echo [WARN] This permanently deletes %COUNT% item^(s^) under builds\,
    echo        including every version directory and its artifacts.
    choice /c YN /n /m "Continue? [Y/N]: "
    if errorlevel 2 goto cancel
)

echo.
echo [1/3] Releasing file locks ...
rem A running / recently packaged app keeps a write handle on its exe and on
rem resources\app.asar. Kill the known names first; deletion then succeeds far
rem more often. node is optional here - skip the product name lookup when the
rem toolchain is not installed.
taskkill /F /IM electron.exe >nul 2>nul
taskkill /F /IM electron-vite-react.exe >nul 2>nul
if exist "package.json" (
    where node >nul 2>nul
    if not errorlevel 1 (
        for /f "delims=" %%i in ('node -p "require('./package.json').productName || require('./package.json').name" 2^>nul') do taskkill /F /IM "%%i.exe" >nul 2>nul
    )
)
echo        done.

echo [2/3] Deleting ...
rem powershell.exe normally lives in PATH; some stripped environments miss it.
set "PS_EXE=powershell"
where powershell >nul 2>nul
if errorlevel 1 set "PS_EXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
"%PS_EXE%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0_clear-builds.ps1" -BuildDir "%BUILD_DIR%"
if errorlevel 2 goto leftovers

echo.
echo [3/3] Verifying ...
for /f %%i in ('dir /b /a "%BUILD_DIR%" 2^>nul ^| find /c /v ""') do set "COUNT=%%i"
if not "%COUNT%"=="0" (
    echo [WARN] %COUNT% item^(s^) still present under builds\.
    if not defined QUIET pause
    exit /b 1
)

echo.
echo ============================================
echo  [OK] builds\ is empty.
echo ============================================
if not defined QUIET pause
exit /b 0

:leftovers
echo.
echo [WARN] Some exports are still held by another process and could not be
echo        removed. Where Windows allowed it they were renamed aside to
echo        *.deleted-^<timestamp^> so the next build is not blocked; the paths
echo        listed above still need attention. Close whatever holds them
echo        ^(explorer window, AV scan, running app^) and re-run this script.
if not defined QUIET pause
exit /b 1

:cancel
echo.
echo [INFO] Cancelled, nothing was deleted.
if not defined QUIET pause
exit /b 0
