@echo off
rem ============================================================
rem  Prepare a clean output directory for electron-builder.
rem  Usage:  call "%~dp0_prepare-out.bat" "builds\<version>\installer"
rem  Sets  : OUT      final output dir (may gain a timestamp suffix)
rem          OUT_ARG  same path with forward slashes (electron-builder override)
rem
rem  Why: electron-builder unlinks the previous
rem  win-unpacked\resources\app.asar before writing a new one. If another
rem  process still holds a handle (AV scan, explorer, left-over app instance)
rem  the build dies with "EBUSY: resource busy or locked". We therefore clear
rem  the directory first; when it is locked we rename it away, and when even
rem  that fails we switch to a fresh timestamped directory so the build still
rem  completes instead of aborting.
rem ============================================================
set "OUT=%~1"
for /f "usebackq delims=" %%i in (`powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0_prepare-out.ps1" -OutDir "%~1"`) do set "OUT=%%i"
if not defined OUT set "OUT=%~1"
rem electron-builder expects the override value unquoted; forward slashes are safest
set "OUT_ARG=%OUT:\=/%"
exit /b 0
