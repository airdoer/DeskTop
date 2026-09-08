@echo off
call "%~dp0_common.bat"

echo ============================================
echo  Start Electron App - dev mode
echo ============================================
echo Project : %PROJECT_DIR%
echo Command : %PKG% dev
echo.

call %PKG% dev

echo.
echo App exited.
pause
