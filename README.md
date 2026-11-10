# Universal Adjustment Program & Maintenance Utility (AdjProg Pro Universal)

**AdjProg Pro Universal v3.0** is a standalone, ultra-modern Windows desktop application engineered for diagnosing, maintaining, reading, and resetting waste ink pad counters across **234 printer models**.

Converted from legacy Python/PyInstaller to a modern, lightning-fast **Node.js + Electron + Vite** architecture with direct Windows Spooler (`winspool.drv`) hardware communication.

---

## ⚡ Key Improvements Over Python

| Metric / Feature | Old Python / PyInstaller Stack | New Modern Node.js + Electron Stack |
| :--- | :--- | :--- |
| **Build Time** | 2 to 3 minutes (slow, fragile) | **~130 to 180 milliseconds** (Instant Vite build) |
| **Startup Speed** | 4 to 8s (unpacking pyinstaller temp files) | **Instant (< 1 second)** |
| **Desktop Window** | Python webview / Tkinter fallback | **Native Windows Desktop Application (Electron)** |
| **Executable Size** | 27 MB to 30 MB bloated Python runtime | **39 KB native launcher (`UniversalTool.exe`)** |
| **Antivirus Compatibility** | Frequent false-positives with PyInstaller | Clean native Windows P/Invoke execution |
| **Hardware Detection** | Polling Win32 print spooler | Real-time native P/Invoke + USB SetupAPI auto-detection |
| **Telemetry & Live Dials** | Static periodic UI updates | **Live WebSocket streaming, dynamic radial gauge & fluid ink tanks** |

---

## 🚀 How to Launch

### Option 1: Standalone Desktop Application (1-Click)
Double-click `UniversalTool.exe` or `start_app.bat` in the project root:
```bash
.\UniversalTool.exe
```

### Option 2: Via npm Scripts
```bash
npm start
```
Or run the dedicated Electron desktop window directly:
```bash
npm run app
```

---

## 🛠️ Instant Build & Development

- **Build Client Bundle:**
  ```bash
  npm run build
  ```
  *(Completed in ~130ms via Vite)*

- **Rebuild Native Windows Spooler Bridge:**
  ```bash
  npm run build:native
  ```
  *(Compiled in ~300ms using Windows built-in `csc.exe`)*

- **Fast Hot-Reload Dev Server:**
  ```bash
  npm run dev
  ```

---

## 📋 Comprehensive Feature Suite

1. **Strict Physical Hardware Communication (Zero Demo Mode):**
   - 100% tied to physical hardware through `usbprint.sys`, `winspool.drv`, or TCP port 9100.
   - Immediate sub-second detection of physical USB printers via Windows SetupAPI (`GUID_DEVINTERFACE_USBPRINT`).
   - Authentic AdjProg error handling (`code: 20000010`) when the printer is powered off or disconnected.

2. **Waste Ink Pad Counter Check & Reset (0%):**
   - Real-time querying of Main Pad, Platen Pad, and Borderless Pad counters.
   - Large animated SVG radial dial with dynamic color coding (Normal green, Warning amber, Critical red ≥95%).
   - Authenticated 6-stage safe reset with `b'Maribaya' / 0x0797` firmware security handshake and automated queue purge.
   - Web Audio synthesized acoustic chimes upon successful operation.

3. **EEPROM Memory Map & Hex Register Inspector:**
   - Real-time 128-byte memory map (0x00 to 0x7F) with offset matrix and ASCII decoding.
   - Quick jump pills for critical firmware registers (Main Pad LSB/MSB, Platen Pad, Head Voltage, Serial Number, Page Counter, Cleaning Cycles).
   - Single-register byte modifier with mandatory automatic cryptographic safety backup before flash commit.
   - 1-click `.EEP` binary dump export.

4. **Windows Spooler Doctor & System Service Repair:**
   - 1-click automated service recovery: stops frozen `spoolsv`, purges orphaned `.SPL` / `.SHD` spool buffers, and restarts service.
   - Automated queue unpausing and offline flag clearing.
   - Real-time 3-stage troubleshoot matrix (Physical USB Presence, Spooler Queue Health, ESC/P-R Handshake Readiness).

5. **Mechanical & Paper Path Maintenance:**
   - **Paper Feed & Eject Routine:** Feeds and ejects a single sheet to test pickup sensors.
   - **Pickup Roller Cleaning:** 3-cycle multi-speed friction spin to strip micro-fine paper dust and eliminate slipping.
   - **Bidirectional Head Alignment Sheet:** 7-stage alignment pattern for vertical line straightness.
   - **Full CMYK Calibration Page:** Test sheet with dense color bars, halftone gradients, and lifetime counter statistics.

6. **Printhead Cleaning & Purge Cycles:**
   - Routine Light Clean (~140s)
   - Medium Deep Clean (~180s)
   - Intensive Ultrasonic Purge (~220s)
   - Heavy Power Ink Flush (~360s)
   - EcoTank Ink Tube Air Bleed & Damper Charge (~240s)
   - Print Nozzle Check Pattern (ESC/P-R Vector & High-Res Raster Fallback)

7. **Calibrated Catalog for 234 Printer Models:**
   - Complete database with instant search and family filters (EcoTank L/M, ET-Series, WorkForce WF, Expression XP, Stylus/Photo).

8. **NVRAM EEPROM Safety Vault & Rollback:**
   - Automatic pre-reset `.json` + `.bin` dumps stored in `backups/`.
   - 1-click restore/rollback back to hardware.
   - Manual snapshot creation with technician notes.

9. **Live Hardware Telemetry Terminal:**
   - Real-time TX/RX packet hex inspector with ASCII decode and millisecond timestamps.

10. **Commercial Service Completion Certificate:**
    - Professional technician certificate with Customer/Organization Name, Work Order #, Certified Technician Name, verified service routine checklists, and printable layout.

---

## 🧪 Automated Verification Suite

Run the full 20-point industry readiness test suite:
```bash
node scratch/test_industry_features.js
```
Validates server health, 234-model catalog, zero-simulator enforcement, Spooler Doctor service repair, NVRAM vault encryption, and strict `20000010` rejection across all physical hardware endpoints when offline.

---

## 📦 Directory Structure

```
├── UniversalTool.exe         # 39KB Native Desktop Application Launcher
├── start_app.bat             # 1-click application runner
├── electron/
│   └── main.js               # Electron native window & lifecycle manager
├── server/
│   ├── index.js              # High-performance Node.js REST & WebSocket server
│   ├── protocol-engine.js    # Authentic ESC/P-R Remote1 & factory packet engine
│   ├── spooler-bridge.js     # Node.js wrapper for Windows Spooler & USB detection
│   ├── backup-manager.js     # NVRAM .json + .bin vault snapshots and restore
│   └── native/
│       ├── SpoolerBridge.cs  # High-speed P/Invoke C# bridge (winspool.drv)
│       └── spooler_bridge.exe# 20KB compiled Windows native bridge
├── src/
│   ├── main.js               # Reactive frontend application logic
│   └── styles.css            # Modern glassmorphic Obsidian theme
├── index.html                # Vite entrypoint & desktop interface layout
├── data/
│   └── models_db.json        # 234 model profiles & EEPROM registers
├── backups/                  # Timestamped NVRAM backup vault
└── package.json              # Modern npm toolchain & scripts
```
