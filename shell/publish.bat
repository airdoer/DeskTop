@echo off
rem ============================================================
rem  Publish : build the NSIS installer and upload it to the release server.
rem
rem  Usage : shell\publish.bat              build + upload
rem          shell\publish.bat --no-upload  build only (local verification)
rem          shell\publish.bat --yes        skip the overwrite prompt
rem
rem  This file is only a launcher. Every step lives in scripts\publish.mjs,
rem  because SSH round-trips, artifact verification and remote pruning are not
rem  expressible in .bat without a second implementation that would drift.
rem
rem  Upload order is deliberate: the .exe and its .blockmap go up first,
rem  latest.yml goes up LAST. Clients poll latest.yml, so publishing it first
rem  would advertise a version whose installer is not on the server yet.
rem ============================================================
setlocal

rem Validates node, jumps to the project root and patches PATH so that
rem electron-builder can find powershell.exe.
call "%~dp0_common.bat"
if errorlevel 1 exit /b 1

node "scripts\publish.mjs" %*
set "RC=%ERRORLEVEL%"

echo.
pause
exit /b %RC%
