@echo off
rem ============================================================
rem  Pre-retry preparation shared by every build script.
rem  Usage:  call "%~dp0_pre-retry.bat" "<OUT_BASE>"
rem  Why   : electron-builder often dies on EBUSY right after it
rem          unpacks electron-vite-react.exe, because Windows
rem          Defender / AV or a stale app instance holds a write
rem          lock on the exe (signAndEditResources writes it back
rem          in place via resedit). Before each retry we:
rem            1) kill stale electron / app processes,
rem            2) wait a few seconds for AV scan window to pass,
rem            3) re-prepare the output dir (clear / rename aside).
rem  Exports (set back into the caller scope):
rem           OUT      final output dir (may gain a timestamp suffix)
rem           OUT_ARG  same path with forward slashes
rem ============================================================

rem ---- 1) kill stale processes that may hold the exe / asar ----
rem  app exe is "<productName>.exe" (APP_NAME from _common.bat).
rem  Also cover "electron.exe" (dev mode) and the generic helper.
if defined APP_NAME (
    taskkill /F /IM "%APP_NAME%.exe" >nul 2>nul
)
taskkill /F /IM electron.exe >nul 2>nul
taskkill /F /IM electron-vite-react.exe >nul 2>nul

rem ---- 2) wait for AV scan window to release the file ----
rem  Use ping as a portable sub-second sleep fallback; timeout is
rem  available on every modern Windows but we keep ping as backup.
timeout /t 10 /nobreak >nul 2>nul
if errorlevel 1 (
    ping -n 11 127.0.0.1 >nul 2>nul
)

rem ---- 3) re-prepare the output directory ----
rem  _prepare-out.bat sets OUT and OUT_ARG in the caller scope.
call "%~dp0_prepare-out.bat" "%~1"
exit /b 0
