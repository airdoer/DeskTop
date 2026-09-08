@echo off
call "%~dp0_common.bat"

rem ------------------------------------------------------------
rem  Mode 2/3 : Portable single exe (no installation, double click to run)
rem             Self-extracting archive: unpacks to TEMP on start,
rem             app data goes to "<exe dir>\Portable Settings".
rem  Output   : builds\<version>\portable\<name>_<version>_portable.exe
rem ------------------------------------------------------------
set "OUT=%OUT_ROOT%\portable"
rem electron-builder expects the override value unquoted; forward slashes are safest on Windows
set "OUT_ARG=builds/%VERSION%/portable"

echo ============================================
echo  Build [2/3] Portable exe (no install)
echo ============================================
echo Version : %VERSION%
echo Output  : %PROJECT_DIR%\%OUT%
echo.

echo [1/2] Building renderer + main ...
call %RUNNER% vite build
if errorlevel 1 goto fail

echo [2/2] Packaging (portable) ...
call %RUNNER% electron-builder --win portable --x64 -c.directories.output=%OUT_ARG%
if errorlevel 1 goto fail

set "EXE=%PROJECT_DIR%\%OUT%\%APP_NAME%_%VERSION%_portable.exe"
if not exist "%EXE%" (
    echo [ERROR] artifact not found: %EXE%
    pause
    exit /b 1
)

echo.
echo ============================================
echo  [OK] %EXE%
echo  Note: not auto-updatable, ship a new exe instead.
echo ============================================
pause
exit /b 0

:fail
echo.
echo [ERROR] Build failed!
pause
exit /b 1
