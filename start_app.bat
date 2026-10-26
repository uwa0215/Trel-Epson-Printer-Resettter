@echo off
title Trel- Epson Universal Maintenance Tool
cd /d "%~dp0"

echo ======================================================================
echo   Trel- Epson Universal Maintenance Tool (Native Desktop Application)
echo ======================================================================

:: Build native spooler bridge if missing (0.3s)
if not exist "server\native\spooler_bridge.exe" (
    echo [1/2] Compiling native Windows Spooler Bridge...
    "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /optimize+ /target:exe /out:server\native\spooler_bridge.exe server\native\SpoolerBridge.cs
)

:: Build frontend bundle if missing (130ms)
if not exist "dist\index.html" (
    echo [2/2] Building modern client bundle via Vite...
    call npm run build
)

:: Launch native desktop application
echo Launching Standalone Desktop Application...
start "" "EpsonUniversalTool.exe"
