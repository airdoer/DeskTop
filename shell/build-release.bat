@echo off
call "%~dp0_common.bat"

rem ------------------------------------------------------------
rem  Mode 1/3 : NSIS installer (needs installation)
rem  Output   : builds\<version>\installer\<name>_<version>.exe
rem ------------------------------------------------------------
set "OUT_BASE=%OUT_ROOT%\installer"

echo ============================================
echo  Build [1/3] NSIS installer
echo ============================================
echo Version : %VERSION%

echo [1/3] Preparing output directory ...
call "%~dp0_prepare-out.bat" "%OUT_BASE%"
echo Output  : %PROJECT_DIR%\%OUT%
if /i not "%OUT%"=="%OUT_BASE%" (
    echo [WARN] The previous output is locked, writing to a new directory.
)
echo.

echo [2/3] Building renderer + main ...
call %RUNNER% vite build
if errorlevel 1 goto fail

echo [3/3] Packaging (nsis) ...
call %RUNNER% electron-builder --win nsis --x64 -c.directories.output=%OUT_ARG%
if not errorlevel 1 goto verify

set RETRY_LEFT=3
:retry_loop
echo.
echo [WARN] Packaging failed (retries left: %RETRY_LEFT%). Common cause: the
echo        previous win-unpacked\%APP_NAME%.exe is still locked by
echo        AV scan / explorer / a stale app instance. Killing stale processes,
echo        waiting for the lock to release, clearing output, then retrying ...
call "%~dp0_pre-retry.bat" "%OUT_BASE%"
if /i not "%OUT%"=="%OUT_BASE%" (
    echo [WARN] Retried in a new directory: %OUT%
)
call %RUNNER% electron-builder --win nsis --x64 -c.directories.output=%OUT_ARG%
if not errorlevel 1 goto verify
set /a RETRY_LEFT-=1
if %RETRY_LEFT% GTR 0 goto retry_loop
goto fail

:verify
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
echo [ERROR] Build failed! Inspect the electron-builder stack trace above:
echo         - "Icon must be at least 256x256 pixels" -> replace build\icon.ico
echo           and build\icon.png with a 256x256+ image, then rebuild.
echo         - "EBUSY / resource busy or locked" -> a process still holds
echo           win-unpacked\%APP_NAME%.exe (AV scan, explorer, or a
echo           running instance). Close it or reboot, then retry.
pause
exit /b 1
