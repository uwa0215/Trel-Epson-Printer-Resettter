---
name: epson-hardware-bridge
description: Technical protocol specifications, IEEE 1284.4 D4 control channel routines, EEPROM register mappings, and 32-bit compilation invariants for Epson printer utilities.
---

# Epson Hardware Bridge & EEPROM Protocol Guide

This skill documents the hardware communication architecture, low-level packet framing, EEPROM register mappings, and native compilation invariants discovered while calibrating waste ink pad counter reads and resets for modern Epson EcoTank and WorkForce printers (e.g., L3250 series).

## 1. IEEE 1284.4 DOT4 (`D4`) Control Channel Protocol

### Why Raw Writes Fail
On modern Epson USB printers, sending raw ESC/P-R or BDC command packets directly via `usbprint.sys` Bulk OUT or standard Windows Spooler raw jobs (`StartDocPrinter` / `WritePrinter`) results in **0 bytes returned** or timeout when reading EEPROM memory.

### Required Driver & Call Sequence
EEPROM read and write operations require packet framing negotiated over the IEEE 1284.4 D4 control channel using `apdadrv.dll`:
1. `ADPortOpen(IntPtr.Zero, portName)` — Opens exclusive port access (e.g. `USB048`).
2. `ADInitDevice(IntPtr.Zero)` — Initializes the device context.
3. `ADD4Negotiation(IntPtr.Zero)` — Negotiates the IEEE 1284.4 D4 session.
4. `ADD4SendAndReceiveCtrlCh(IntPtr.Zero, txBuf, txLen, rxBuf, rxCap, ref rxLen)` — Transmits the framed command and receives the binary/ASCII response.
5. `ADD4Termination(IntPtr.Zero)` — Terminates the D4 session cleanly.
6. `ADPortClose(IntPtr.Zero)` — Releases the exclusive port handle.

### D4 Packet Structure
- Header: `0x7C 0x7C` (`||`) followed by 2-byte payload length (little-endian).
- Factory Read Payload: Read key (2 bytes), command byte `0x41` (`'A'`), bit-inverted command byte, rotated command byte, target register address (2 bytes).
- Factory Write Payload: Read key (2 bytes), command byte `0x42` (`'B'`), bit-inverted command byte, rotated command byte, target register address (2 bytes), value (1 byte), shifted write key bytes (`"Maribaya"` with each byte + 1).

---

## 2. EEPROM Register Mappings (Modern EcoTank)

### Waste Ink Pad Counters
| Counter / Parameter | Address (LSB) | Address (MSB) | Decoding | Max Calibration |
| :--- | :--- | :--- | :--- | :--- |
| **Main Pad Counter** | `0x30` | `0x31` | `LSB \| (MSB << 8)` | `6,346 pts` |
| **Platen Pad Counter** | `0x32` | `0x33` | `LSB \| (MSB << 8)` | `3,416 pts` |
| **Ink System Pad Counter** | `0xFC` | `0xFD` | `LSB \| (MSB << 8)` | `1,300 pts` |
| **Fallback Borderless Pad**| `0x34` | `0x35` | `LSB \| (MSB << 8)` | Model-dependent |

### Ink Remaining Registers (Shadow EEPROM)
EcoTank printers do not use IC chip cartridges; ink levels are estimated by firmware droplet counters and mirrored in shadow registers. Standard `@BDC ST2` frames omit the `INK:` tag, requiring direct register reads or telemetry caching:
| Channel | Register Address | Range / Scale | Notes |
| :--- | :--- | :--- | :--- |
| **Black (BK)** | `0x36` | `0 – 100` (%) | Direct percentage (e.g. `0x5E` = 94%) |
| **Cyan (C)** | `0x37` | `0 – 100` (%) | Direct percentage (e.g. `0x5E` = 94%) |
| **Magenta (M)** | `0x38` | `0 – 127` | `0x7F` (127) = full tank / initialized (scaled 90–94%) |
| **Yellow (Y)** | `0x39` | `0 – 127` | `0x7F` (127) = full tank / initialized (scaled 92–94%) |

### Lifetime Hardware Counters
| Metric | Register Address | Decoding | Example (L3250) |
| :--- | :--- | :--- | :--- |
| **Total Printed Pages** | `0x92` (LSB), `0x93` (MSB) | `LSB \| (MSB << 8)` | 3,586 pages |
| **Scanner Scan Count** | `0x58` | Single byte | 40 scans |
| **Head Cleaning Cycles**| `0x65` (or `0x5F`) | Single byte | 20 cycles (16 manual + 4 auto) |
| **Borderless B/W** | `0x9E` (LSB), `0x9F` (MSB) | `LSB \| (MSB << 8)` | 1,881 pages |
| **Borderless Color** | `0x9C` (LSB), `0x9D` (MSB) | `LSB \| (MSB << 8)` | 308 pages |
| **Bordered B/W** | `0xA2` (LSB), `0xA3` (MSB) | `LSB \| (MSB << 8)` | 845 pages |
| **Bordered Color** | `0xA0` (LSB), `0xA1` (MSB) | `LSB \| (MSB << 8)` | 346 pages |
| **Blank Pages** | `0xAB` | Single byte | 3 pages |

### Protocol Timeout Invariant (Avoid Unmapped Registers)
- Probing unmapped or protected registers (such as `0x96` through `0x9B` on L3250) incurs individual 2.5-second IEEE 1284.4 D4 transport timeouts.
- Accumulating timeouts desynchronizes the D4 session and blocks subsequent operations.
- **Rule**: Always query known mapped registers directly (`0x92`/`0x93` for total pages, `0x36`–`0x39` for ink, `0x58` for scans, `0x65` for cleanings) and load secondary split baselines from cache.

---

## 3. 32-Bit (x86) Compilation Invariant

`apdadrv.dll` is compiled as a 32-bit (x86) DLL using `ThisCall` calling conventions. Any 64-bit caller will fail with `BadImageFormatException`.

- **Compiler**: Must use 32-bit .NET Framework compiler at `C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe`.
- **Target Flag**: Always specify `/platform:x86`.
- **Command Line**:
  ```cmd
  C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe /nologo /optimize+ /platform:x86 /r:System.Drawing.dll /target:exe /out:server\native\spooler_bridge.exe server\native\SpoolerBridge.cs
  ```

---

## 4. Port Concurrency & Process Serialization

- `ADPortOpen` creates an exclusive lock on the USB port. Multiple concurrent instances of `spooler_bridge.exe` trying to access the same port will block and hang.
- **Node.js Bridge Rule**: All calls to `execNative` must be serialized through a promise queue (`this._queue = this._queue.then(...)`).
- **Client Polling Rule**: Hardware polling intervals should remain at or above 4,000ms. Check and reset actions must include single-flight guards (`state.isQueryingCounters`) to prevent duplicate in-flight requests.

---

## 5. USB Serial Number & Composite Device Resolution

- **18-Character Hex Serial Decoding**:
  Windows USB enumeration registers Epson composite devices with 18-character hex serial numbers (e.g., `58384A5A3030333319`). The first 16 characters represent 8 ASCII characters in hex pair encoding (`58`='X', `38`='8', `4A`='J', `5A`='Z', `30`='0', `30`='0', `33`='3', `33`='3'), followed by 2 trailing decimal digits (`19`), yielding the 10-character serial: `X8JZ003319`.
- **Port-to-Parent Composite Resolution**:
  When querying via a Windows spooler port name (e.g., `USB048`), find the active `USBPRINT` device in `HKLM\SYSTEM\CurrentControlSet\Enum\USBPRINT`, read its `ContainerID` (or `ParentIdPrefix`), and match it to the parent composite USB device under `HKLM\SYSTEM\CurrentControlSet\Enum\USB` to extract the true hardware serial number.

---

## 6. Real-Time Hardware UI Anti-Jitter Guidelines

When building real-time hardware status dashboards subject to polling (e.g. WebSocket PnP updates and REST API responses):
1. **Enforce Static Container Heights**:
   Diagnostic banners must have fixed minimum heights (`min-height: 72px; box-sizing: border-box;`) to prevent dynamic content from expanding or collapsing the container.
2. **Prevent Text Wrapping**:
   Dynamic sub-labels must include `white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`. Text wrapping onto a second line causes vertical layout shifts that push down adjacent dashboard cards.
3. **Unify Status Strings**:
   Ensure background poller broadcasts and on-demand query handlers emit uniform text structures (e.g., `Normal Ready State (Hardware Verified) • Port: USB048`) rather than alternating between short and verbose descriptions.
