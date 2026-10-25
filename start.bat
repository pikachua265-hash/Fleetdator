@echo off
title Minecraft Mod Updater AI - Ultra-Fast Launcher
cls
echo ========================================================
echo   MINECRAFT MOD UPDATER AI - HIGH-SPEED PRODUCTION
echo ========================================================
echo.

set "SCRIPT_DIR=%~dp0"

:: Check port 5050
netstat -ano | findstr :5050 | findstr LISTENING >nul
if %ERRORLEVEL% equ 0 (
    echo [OK] Backend Engine is already running on port 5050.
) else (
    echo [1/3] Starting Backend Production Engine on port 5050...
    start "Mod Updater Backend Engine" /D "%SCRIPT_DIR%backend" cmd /k node dist/index.js
    ping 127.0.0.1 -n 3 >nul
)

:: Check port 3000
netstat -ano | findstr :3000 | findstr LISTENING >nul
if %ERRORLEVEL% equ 0 (
    echo [OK] Web Interface is already running on port 3000.
) else (
    echo [2/3] Starting High-Speed Production Web Interface on port 3000...
    start "Mod Updater Web Interface" /D "%SCRIPT_DIR%frontend" cmd /k npm start
    ping 127.0.0.1 -n 3 >nul
)

echo.
echo [3/3] Opening browser at http://localhost:3000...
start http://localhost:3000

echo.
echo ========================================================
echo   APPLICATION IS PERMANENTLY ONLINE AND ULTRA-FAST!
echo   Web UI:   http://localhost:3000
echo   API:      http://localhost:5050
echo   VS Code:  Use "Open in VS Code.bat" to inspect code
echo ========================================================
echo (This launcher will close in 4 seconds; background servers will stay ON)
ping 127.0.0.1 -n 4 >nul
exit
