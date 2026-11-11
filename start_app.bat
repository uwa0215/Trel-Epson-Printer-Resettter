@echo off
title TREL - Universal Maintenance Tool
cd /d "%~dp0"

echo ======================================================================
echo   TREL - Universal Maintenance Tool (Native Desktop Application)
echo ======================================================================

:: Build native spooler bridge if missing (32-bit x86 required for apdadrv.dll)
if not exist "server\native\spooler_bridge.exe" (
    echo [1/3] Compiling native Windows Spooler Bridge (x86)...
    "C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe" /nologo /optimize+ /platform:x86 /r:System.Drawing.dll /target:exe /out:server\native\spooler_bridge.exe server\native\SpoolerBridge.cs
)

:: Check if Node dependencies (Electron) are installed
if not exist "node_modules\electron\dist\electron.exe" (
    where npm >nul 2>&1
    if errorlevel 1 (
        echo.
        echo [ERROR] Node.js is not installed on this computer!
        echo.
        echo To run on another PC without installing Node.js, use the standalone
        echo 'TREL Setup 1.0.0.exe' or 'TREL-Portable-1.0.0.exe' installer.
        echo Otherwise, install Node.js LTS from https://nodejs.org and re-run this script.
        echo.
        pause
        exit /b 1
    )
    echo [2/3] Installing dependencies ^(first run on this PC^)...
    call npm install
)

:: Build frontend bundle if missing
if not exist "dist\index.html" (
    echo [3/3] Building modern client bundle via Vite...
    call npm run build:ui
)

:: Launch native desktop application
echo Launching TREL Desktop Application...
if exist "TREL.exe" (
    start "" "TREL.exe"
) else (
    call npm start
)
