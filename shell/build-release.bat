@echo off
call "%~dp0_common.bat"

rem ------------------------------------------------------------
rem  Mode 1/3 : NSIS installer (needs installation)
rem  Output   : builds\<version>\installer\<name>_<version>.exe
rem ------------------------------------------------------------
set "OUT=%OUT_ROOT%\installer"
rem electron-builder expects the override value unquoted; forward slashes are safest on Windows
set "OUT_ARG=builds/%VERSION%/installer"

echo ============================================
echo  Build [1/3] NSIS installer
echo ============================================
echo Version : %VERSION%
echo Output  : %PROJECT_DIR%\%OUT%
echo.

echo [1/2] Building renderer + main ...
call %RUNNER% vite build
if errorlevel 1 goto fail

echo [2/2] Packaging (nsis) ...
call %RUNNER% electron-builder --win nsis --x64 -c.directories.output=%OUT_ARG%
if errorlevel 1 goto fail

set "EXE=%PROJECT_DIR%\%OUT%\%APP_NAME%_%VERSION%.exe"
if not exist "%EXE%" (
    echo [ERROR] artifact not found: %EXE%
    pause
    exit /b 1
)

echo.
echo ============================================
echo  [OK] %EXE%
echo ============================================
pause
exit /b 0

:fail
echo.
echo [ERROR] Build failed!
pause
exit /b 1
