@echo off
title TREL - Universal Maintenance Tool
cd /d "%~dp0"

echo ======================================================================
echo   TREL - Universal Maintenance Tool (Native Desktop Application)
echo ======================================================================

:: Build native spooler bridge if missing (32-bit x86 required for apdadrv.dll)
if not exist "server\native\spooler_bridge.exe" (
    echo [1/2] Compiling native Windows Spooler Bridge (x86)...
    "C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe" /nologo /optimize+ /platform:x86 /r:System.Drawing.dll /target:exe /out:server\native\spooler_bridge.exe server\native\SpoolerBridge.cs
)

:: Build frontend bundle if missing (130ms)
if not exist "dist\index.html" (
    echo [2/2] Building modern client bundle via Vite...
    call npm run build
)

:: Launch native desktop application
echo Launching Standalone Desktop Application...
if exist "UniversalTool.exe" (
    start "" "UniversalTool.exe"
) else (
    start "" "EpsonUniversalTool.exe"
)
