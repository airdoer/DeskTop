@echo off
call "%~dp0_common.bat"

rem ------------------------------------------------------------
rem  Mode 3/3 : Unpacked folder (no installation, fastest startup)
rem             Ship / zip the whole win-unpacked folder as-is.
rem  Output   : builds\<version>\dir\win-unpacked\
rem ------------------------------------------------------------
set "OUT=%OUT_ROOT%\dir"
rem electron-builder expects the override value unquoted; forward slashes are safest on Windows
set "OUT_ARG=builds/%VERSION%/dir"

echo ============================================
echo  Build [3/3] Unpacked folder (no install)
echo ============================================
echo Version : %VERSION%
echo Output  : %PROJECT_DIR%\%OUT%\win-unpacked
echo.

echo [1/2] Building renderer + main ...
call %RUNNER% vite build
if errorlevel 1 goto fail

echo [2/2] Packaging (dir) ...
call %RUNNER% electron-builder --win --dir --x64 -c.directories.output=%OUT_ARG%
if errorlevel 1 goto fail

set "EXE=%PROJECT_DIR%\%OUT%\win-unpacked\%APP_NAME%.exe"
if not exist "%EXE%" (
    echo [ERROR] artifact not found: %EXE%
    pause
    exit /b 1
)

echo.
echo ============================================
echo  [OK] %EXE%
echo  Zip the whole folder to distribute it.
echo ============================================
pause
exit /b 0

:fail
echo.
echo [ERROR] Build failed!
pause
exit /b 1
