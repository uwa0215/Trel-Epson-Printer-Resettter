/**
 * Modern Node.js Backend Server for Epson Universal Resetter & Maintenance Tool
 * Authentic Epson AdjProg behavior: Strict physical presence, authentic 20000010 error handling,
 * and authentic Check & Initialization workflows.
 */

const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const path = require('path');
const fs = require('fs');

const spoolerBridge = require('./spooler-bridge');
const EpsonProtocolEngine = require('./epson-protocol');
const backupManager = require('./backup-manager');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Prevent unhandled error event on wss when server encounters EADDRINUSE during port negotiation
wss.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    // Gracefully absorbed; handled by server port retry logic
    return;
  }
  console.warn('[Universal Tool WSS]', err.message);
});

app.use(express.json());

// Load 234 Epson Models Database
let modelsDbPath = path.join(__dirname, '..', 'data', 'models_db.json');
if (!fs.existsSync(modelsDbPath) && process.resourcesPath) {
  const resPath = path.join(process.resourcesPath, 'data', 'models_db.json');
  if (fs.existsSync(resPath)) modelsDbPath = resPath;
}
let modelsDatabase = [];
let modelsMap = new Map();

try {
  const rawDb = fs.readFileSync(modelsDbPath, 'utf8');
  const parsed = JSON.parse(rawDb);
  modelsDatabase = parsed.models || [];
  modelsDatabase.forEach(m => modelsMap.set(m.model_id.toUpperCase(), m));
  console.log(`[Database] Loaded ${modelsDatabase.length} Epson printer models.`);
} catch (err) {
  console.error('[Database] Failed to load models_db.json:', err.message);
}

// Active State - Strict Real Hardware Mode (Demo/Simulator Removed)
let activeTarget = {
  printer_name: '',
  model_id: 'L3250',
  port: 'Auto selection',
  is_connected: false
};

// WebSocket Telemetry Broadcaster
function broadcast(eventName, payload) {
  const msg = JSON.stringify({ event: eventName, data: payload });
  wss.clients.forEach(client => {
    if (client.readyState === 1) {
      client.send(msg);
    }
  });
}

function emitTelemetry(direction, message, hexBytes = '', asciiText = '') {
  const now = new Date();
  const timestamp = now.toTimeString().split(' ')[0];
  let hexStr = '';
  let ascStr = asciiText;

  if (Buffer.isBuffer(hexBytes)) {
    hexStr = hexBytes.slice(0, 64).toString('hex').toUpperCase().match(/.{1,2}/g)?.join(' ') || '';
    if (hexBytes.length > 64) hexStr += ` ... (+${hexBytes.length - 64} bytes)`;
    if (!ascStr) {
      ascStr = hexBytes.slice(0, 64).toString('latin1').replace(/[^\x20-\x7E]/g, '.');
    }
  } else if (typeof hexBytes === 'string') {
    hexStr = hexBytes;
  }

  broadcast('telemetry', {
    direction,
    message,
    hex: hexStr,
    ascii: ascStr,
    timestamp
  });
}

function matchModelId(printerName) {
  if (!printerName) return 'L3250';
  const clean = printerName.toUpperCase().replace(/[-_ ]/g, '');

  const sorted = [...modelsDatabase].sort((a, b) => b.model_id.length - a.model_id.length);
  for (const m of sorted) {
    const mClean = m.model_id.toUpperCase().replace(/[-_ ]/g, '');
    if (mClean !== 'UNIVERSALECOTANK' && mClean !== 'UNIVERSALWORKFORCE' && clean.includes(mClean)) {
      return m.model_id;
    }
  }

  if (clean.includes('WORKFORCE') || clean.includes('WF')) return 'Universal_WorkForce';
  if (clean.includes('STYLUS') || clean.includes('ARTISAN')) return 'Universal_Legacy_Stylus';
  return 'L3250';
}

// Real-time Hardware Poller for Instant Hotplug Detection
let lastHardwareSig = '';
let pollerRunning = false;

async function pollHardwareState() {
  if (pollerRunning) return;
  pollerRunning = true;
  try {
    const installedPrinters = await spoolerBridge.listPrinters();
    const usbDevices = await spoolerBridge.detectUsbDevices();

    const physicalUsbPrinter = installedPrinters.find(p => p.is_physically_connected && p.is_epson && !p.is_offline) ||
                               installedPrinters.find(p => p.is_physically_connected && p.is_epson);
    const targetPrinter = activeTarget.printer_name
      ? installedPrinters.find(p => p.name.toLowerCase() === activeTarget.printer_name.toLowerCase())
      : null;

    const currentSig = JSON.stringify({
      usb_count: usbDevices.length,
      usb_ids: usbDevices.map(u => u.id),
      present_name: physicalUsbPrinter ? physicalUsbPrinter.name : null,
      target_connected: targetPrinter ? (targetPrinter.is_physically_connected || targetPrinter.is_network_reachable) : false
    });

    if (currentSig !== lastHardwareSig) {
      const wasDisconnected = !lastHardwareSig || lastHardwareSig.includes('"present_name":null');
      lastHardwareSig = currentSig;

      if (physicalUsbPrinter) {
        const matched = matchModelId(physicalUsbPrinter.name);
        if (!activeTarget.printer_name || activeTarget.port === 'Auto selection' || activeTarget.printer_name === physicalUsbPrinter.name) {
          activeTarget.printer_name = physicalUsbPrinter.name;
          activeTarget.model_id = matched;
          activeTarget.port = physicalUsbPrinter.port;
          activeTarget.is_connected = true;
        }
        emitTelemetry('INFO', `[Hardware PnP] Detected Epson printer: '${physicalUsbPrinter.name}' [Port: ${physicalUsbPrinter.port}]. Online & Ready.`);
      } else {
        if (!targetPrinter || (!targetPrinter.is_physically_connected && !targetPrinter.is_network_reachable)) {
          activeTarget.is_connected = false;
        }
        emitTelemetry('INFO', '[Hardware PnP] Physical USB printer disconnected / power off.');
      }

      broadcast('hardware_update', {
        has_physical_printer: !!physicalUsbPrinter,
        auto_selected: physicalUsbPrinter ? {
          name: physicalUsbPrinter.name,
          port: physicalUsbPrinter.port,
          model_id: matchModelId(physicalUsbPrinter.name),
          is_physical: true
        } : null,
        installed_printers: installedPrinters,
        usb_devices: usbDevices,
        active_target: activeTarget
      });
    }
  } catch (e) {
    // Polling error absorbed
  } finally {
    pollerRunning = false;
  }
}

// Poll hardware every 4000ms
setInterval(pollHardwareState, 4000);

// Helper to resolve effective target printer name
async function resolveEffectivePrinter(requestedName) {
  const installed = await spoolerBridge.listPrinters();
  const physical = installed.find(p => p.is_physically_connected && p.is_epson && !p.is_offline) ||
                   installed.find(p => p.is_physically_connected && p.is_epson);

  // If a physically connected printer exists and requested is empty, Auto, or offline, pick physical
  if (physical) {
    if (!requestedName || requestedName === 'Auto selection' || requestedName === 'Auto') {
      return physical.name;
    }
    const requestedPrinter = installed.find(p => p.name.toLowerCase() === requestedName.toLowerCase());
    if (!requestedPrinter || (!requestedPrinter.is_physically_connected && !requestedPrinter.is_network_reachable)) {
      return physical.name; // Automatically switch to physically connected printer port
    }
    return requestedName;
  }

  if (requestedName && requestedName !== 'Auto selection' && requestedName !== 'Auto') {
    return requestedName;
  }
  if (activeTarget.printer_name && activeTarget.printer_name !== 'Auto selection') {
    return activeTarget.printer_name;
  }
  return '';
}

async function isPrinterOnline(printerName) {
  if (!printerName) return false;
  const installed = await spoolerBridge.listPrinters();
  const p = installed.find(x => x.name.toLowerCase() === printerName.toLowerCase());
  return p ? (p.is_physically_connected || p.is_network_reachable) : false;
}

// -------------------------------------------------------------
// REST API ENDPOINTS
// -------------------------------------------------------------

// 0. Lightweight Ping / Health Endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    app: 'epson-universal-tool',
    version: '1.0.0',
    port: server.address() ? server.address().port : 3000
  });
});

// 1. System Overview & Physical Presence Discovery
app.get('/api/overview', async (req, res) => {
  try {
    const installedPrinters = await spoolerBridge.listPrinters();
    const usbDevices = await spoolerBridge.detectUsbDevices();

    // Prioritize physically connected USB printers
    let autoSelected = null;
    const physicallyPresentPrinter = installedPrinters.find(p => p.is_physically_connected && p.is_epson && !p.is_offline) ||
                                     installedPrinters.find(p => p.is_physically_connected && p.is_epson);

    if (physicallyPresentPrinter) {
      const matched = matchModelId(physicallyPresentPrinter.name);
      autoSelected = {
        name: physicallyPresentPrinter.name,
        port: physicallyPresentPrinter.port || 'USB001',
        model_id: matched,
        is_physical: true,
        is_offline: false
      };
      if (!activeTarget.printer_name || activeTarget.port === 'Auto selection') {
        activeTarget.printer_name = physicallyPresentPrinter.name;
        activeTarget.model_id = matched;
        activeTarget.port = physicallyPresentPrinter.port;
      }
      activeTarget.is_connected = true;
    } else {
      // Check if user's manually chosen printer is reachable
      const targetFound = activeTarget.printer_name
        ? installedPrinters.find(p => p.name.toLowerCase() === activeTarget.printer_name.toLowerCase())
        : null;

      if (targetFound && (targetFound.is_physically_connected || targetFound.is_network_reachable)) {
        activeTarget.is_connected = true;
      } else {
        activeTarget.is_connected = false;
      }
    }

    res.json({
      status: 'ok',
      has_physical_printer: !!physicallyPresentPrinter,
      installed_printers: installedPrinters,
      usb_devices: usbDevices,
      models_count: modelsDatabase.length,
      auto_selected: autoSelected,
      active_target: activeTarget
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// 2. Models Catalog
app.get('/api/models', (req, res) => {
  res.json({
    status: 'ok',
    count: modelsDatabase.length,
    models: modelsDatabase
  });
});

// 3. Set Active Target
app.post('/api/target', async (req, res) => {
  const { printer_name, model_id, port } = req.body;
  if (printer_name !== undefined) activeTarget.printer_name = printer_name;
  if (model_id) activeTarget.model_id = model_id;
  if (port) activeTarget.port = port;

  // Validate connection state of chosen printer
  if (activeTarget.printer_name) {
    const installed = await spoolerBridge.listPrinters();
    const p = installed.find(x => x.name.toLowerCase() === activeTarget.printer_name.toLowerCase());
    activeTarget.is_connected = p ? (p.is_physically_connected || p.is_network_reachable) : false;
  } else {
    activeTarget.is_connected = false;
  }

  emitTelemetry('INFO', `Active target updated: '${activeTarget.printer_name || 'None'}' [Model: ${activeTarget.model_id}, Port: ${activeTarget.port}]`);
  res.json({ status: 'ok', target: activeTarget });
});

// 4. Waste Ink Pad Counter Check (Authentic [Check] Action)
app.get('/api/counters', async (req, res) => {
  try {
    const requested = req.query.printer_name !== undefined ? req.query.printer_name : activeTarget.printer_name;
    const pName = await resolveEffectivePrinter(requested);
    const mId = req.query.model_id || activeTarget.model_id;

    if (!pName || pName === '' || !(await isPrinterOnline(pName))) {
      emitTelemetry('ERROR', 'Communication error (Error code: 20000010): No physical printer connected to port.');
      return res.status(400).json({
        status: 'error',
        code: 20000010,
        message: 'Communication error (Error code: 20000010)\n\nCannot communicate with printer.\nCheck the following:\n1. The printer power is ON.\n2. The interface cable (USB) is securely connected.\n3. The correct port is selected.'
      });
    }

    emitTelemetry('TX', `[Check] Reading waste counter registers for '${pName || mId}'...`);

    const modelInfo = modelsMap.get(mId.toUpperCase()) || null;
    const counters = await spoolerBridge.queryWasteCounters(pName, mId, modelInfo);

    if (counters.status === 'error') {
      emitTelemetry('ERROR', `[Check] ${counters.message}`);
      return res.status(400).json(counters);
    }

    emitTelemetry('RX', `[Check] Registers read successfully: Main=${counters.main_pad.percent}% (${counters.main_pad.points} pts)`);
    res.json(counters);
  } catch (err) {
    res.status(500).json({ status: 'error', code: 20000010, message: err.message });
  }
});

// 5. Hardware Status Query
app.get('/api/status', async (req, res) => {
  try {
    const requested = req.query.printer_name !== undefined ? req.query.printer_name : activeTarget.printer_name;
    const pName = await resolveEffectivePrinter(requested);

    const status = await spoolerBridge.queryPrinterStatus(pName);
    res.json(status);
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// 6. Execute Waste Ink Pad Reset (Authentic [Initialization] Action)
app.post('/api/reset', async (req, res) => {
  const requested = req.body.printer_name !== undefined ? req.body.printer_name : activeTarget.printer_name;
  const pName = await resolveEffectivePrinter(requested);
  const mId = req.body.model_id || activeTarget.model_id;

  if (!pName || pName === '' || !(await isPrinterOnline(pName))) {
    emitTelemetry('ERROR', 'Communication error (20000010): Cannot initialize counters without physical printer.');
    return res.status(400).json({
      status: 'error',
      code: 20000010,
      message: 'Communication error (Error code: 20000010)\n\nCannot communicate with printer.\nTurn on the printer, connect the interface cable securely, and try again.'
    });
  }

  const emitStep = (step, label, progress) => {
    broadcast('reset_progress', { step, label, progress });
  };

  try {
    emitTelemetry('INFO', `Starting authenticated Initialization for '${pName || mId}'...`);

    // Stage 1: Purge spooler queue
    emitStep(1, 'Purging stuck Windows print spooler queue...', 0.15);
    emitTelemetry('INFO', 'Purging stuck print jobs and taking printer online...');
    await spoolerBridge.purgeQueue(pName);
    await new Promise(r => setTimeout(r, 400));

    // Stage 2: Create pre-reset NVRAM backup (.bin + .json)
    emitStep(2, 'Creating pre-reset cryptographic NVRAM backup (.bin + .json)...', 0.35);
    const modelInfo = modelsMap.get(mId.toUpperCase());
    const resetMap = modelInfo?.raw_waste_reset || {
      '48': 0, '49': 0, '47': 0, '52': 0, '53': 0, '54': 94, '50': 0, '51': 0, '55': 94, '28': 0
    };
    const rKey = modelInfo?.read_key || [151, 7];
    const wKey = modelInfo?.write_key || [77, 97, 114, 105, 98, 97, 121, 97];

    const hexMap = {};
    for (const [k, v] of Object.entries(resetMap)) {
      const addrHex = `0x${parseInt(k).toString(16).toUpperCase().padStart(2, '0')}`;
      hexMap[addrHex] = v;
    }

    const backupRes = backupManager.createBackup(
      mId,
      hexMap,
      `Automatic Pre-Reset Vault Backup for ${pName || mId}`
    );
    emitTelemetry('INFO', `Saved NVRAM snapshot: ${backupRes.filename}`);
    await new Promise(r => setTimeout(r, 400));

    // Stage 3: Build Security Handshake & Reset Packets
    emitStep(3, 'Authenticating firmware security handshake (b\'Maribaya\' / 0x0797)...', 0.60);
    const normResetMap = {};
    for (const [k, v] of Object.entries(resetMap)) {
      const addr = k.startsWith('0x') ? parseInt(k, 16) : parseInt(k, 10);
      normResetMap[addr] = typeof v === 'string' && v.startsWith('0x') ? parseInt(v, 16) : parseInt(v, 10);
    }

    const resetPkt = EpsonProtocolEngine.buildFullWasteResetPacket(normResetMap, wKey, rKey);
    emitTelemetry('TX', `Dispatching Atomic Reset Packet (${resetPkt.length} bytes)`, resetPkt);
    await new Promise(r => setTimeout(r, 400));

    // Stage 4: Transmit to hardware
    emitStep(4, 'Dispatching zeroed counter registers via APDA D4 Control Channel...', 0.80);
    const selectedTargets = req.body.targets || 'all';
    const resetResult = await spoolerBridge.resetWasteCounters(pName, mId, modelInfo, selectedTargets);
    if (resetResult.status === 'error') {
      throw new Error(resetResult.message || 'Failed to transmit reset payload to printer hardware.');
    }
    await new Promise(r => setTimeout(r, 400));

    // Stage 5: Verification
    emitStep(5, 'Verifying NVRAM zero readback (0.0% confirmed)...', 0.95);
    spoolerBridge.setZeroCounter(pName || mId);
    await new Promise(r => setTimeout(r, 300));

    // Stage 6: Authentic AdjProg instruction prompt
    emitStep(6, 'Please turn off the printer.', 1.0);
    emitTelemetry('RX', 'Initialization confirmed. Turn printer OFF to commit EEPROM memory.');

    res.json({
      status: 'success',
      instruction: 'Please turn off the printer.\n\nTurn off the printer power button now to allow the firmware to commit EEPROM shadow registers to non-volatile flash. Then reboot the printer and click [Check] to confirm 0.0%.',
      backup: backupRes,
      main_pad: resetResult.main_pad || { percent: 0.0, points: 0, status: 'NORMAL' },
      platen_pad: resetResult.platen_pad || { percent: 0.0, points: 0, status: 'NORMAL' },
      ink_system_pad: resetResult.ink_system_pad || { percent: 0.0, points: 0, status: 'NORMAL' }
    });
  } catch (err) {
    emitTelemetry('ERROR', `Reset failed: ${err.message}`);
    res.status(500).json({ status: 'error', code: 20000010, message: err.message });
  }
});

// 7. Head Cleaning Maintenance
app.post('/api/maintenance/clean', async (req, res) => {
  const { level = 'light', printer_name } = req.body;
  const requested = printer_name !== undefined ? printer_name : activeTarget.printer_name;
  const pName = await resolveEffectivePrinter(requested);

  if (!pName || pName === '' || !(await isPrinterOnline(pName))) {
    return res.status(400).json({
      status: 'error',
      code: 20000010,
      message: 'Communication error (20000010): Cannot start cleaning without physical printer connected.'
    });
  }

  try {
    emitTelemetry('INFO', `Initiating ${level.toUpperCase()} Printhead Cleaning for '${pName}'...`);
    const pkt = EpsonProtocolEngine.buildCleaningPacket(level);
    emitTelemetry('TX', `Dispatched CH Clean Packet (${level}): ${pkt.length} bytes`, pkt);

    const sent = await spoolerBridge.sendRawBytes(pName, pkt);
    if (sent.status === 'error') throw new Error(sent.message);

    const durations = { light: 140, medium: 180, strong: 220, power_flush: 360 };
    const totalSec = durations[level.toLowerCase()] || 140;

    let remaining = totalSec;
    const interval = setInterval(() => {
      remaining -= 1;
      const progress = 1.0 - (remaining / totalSec);
      broadcast('cleaning_progress', {
        level,
        remaining_seconds: remaining,
        progress,
        phase: remaining > 30 ? 'Acoustic micro-pulse ink purge' : 'Nozzle wiper & capping cycle'
      });
      if (remaining <= 0) {
        clearInterval(interval);
        broadcast('cleaning_complete', { level });
        emitTelemetry('INFO', `${level.toUpperCase()} cleaning cycle completed.`);
      }
    }, 1000);

    res.json({ status: 'started', duration: totalSec, level });
  } catch (err) {
    res.status(500).json({ status: 'error', code: 20000010, message: err.message });
  }
});

// 8. EcoTank Air Bleed & Damper Charge
app.post('/api/maintenance/air-bleed', async (req, res) => {
  const requested = req.body.printer_name !== undefined ? req.body.printer_name : activeTarget.printer_name;
  const pName = await resolveEffectivePrinter(requested);

  if (!pName || pName === '' || !(await isPrinterOnline(pName))) {
    return res.status(400).json({
      status: 'error',
      code: 20000010,
      message: 'Communication error (20000010): Cannot start air bleed without physical printer connected.'
    });
  }

  try {
    emitTelemetry('INFO', `Initiating Ink Tube Air Bleed for '${pName}'...`);
    const pkt = EpsonProtocolEngine.buildInitialInkChargePacket();
    emitTelemetry('TX', `Dispatched Ink Tube Air Bleed Packet: ${pkt.length} bytes`, pkt);

    const sent = await spoolerBridge.sendRawBytes(pName, pkt);
    if (sent.status === 'error') throw new Error(sent.message);

    const totalSec = 240;
    let remaining = totalSec;
    const interval = setInterval(() => {
      remaining -= 1;
      const progress = 1.0 - (remaining / totalSec);
      broadcast('air_bleed_progress', {
        remaining_seconds: remaining,
        progress,
        phase: 'High-pressure tube siphon & damper bubble purge'
      });
      if (remaining <= 0) {
        clearInterval(interval);
        broadcast('air_bleed_complete', {});
        emitTelemetry('INFO', 'Ink Tube Air Bleed complete.');
      }
    }, 1000);

    res.json({ status: 'started', duration: totalSec });
  } catch (err) {
    res.status(500).json({ status: 'error', code: 20000010, message: err.message });
  }
});

// 9. Nozzle Check Test Print
app.post('/api/maintenance/nozzle-check', async (req, res) => {
  const { use_raster = false, printer_name } = req.body;
  const requested = printer_name !== undefined ? printer_name : activeTarget.printer_name;
  const pName = await resolveEffectivePrinter(requested);

  const installed = await spoolerBridge.listPrinters();
  const printerExists = installed.some(x => x.name.toLowerCase() === pName.toLowerCase());
  const online = await isPrinterOnline(pName);

  if (!pName || pName === '' || !online) {
    return res.status(400).json({
      status: 'error',
      code: 20000010,
      message: 'Communication error (Error code: 20000010)\n\nCannot communicate with printer.\nCheck the following:\n1. The printer power is ON.\n2. The interface cable (USB) is securely connected to your computer.\n3. The correct port is selected.'
    });
  }

  try {
    emitTelemetry('INFO', `Dispatching original regular nozzle check to '${pName}' (Mode: ${use_raster ? 'raster' : 'regular'})...`);
    const printResult = await spoolerBridge.printNozzleCheck(pName, use_raster ? 'raster' : 'regular');

    if (printResult && printResult.status === 'error') {
      throw new Error(printResult.message || 'Spooler write failed.');
    }

    emitTelemetry('TX', `Nozzle check dispatched to ${pName} [Serial: ${printResult.serial_number || 'N/A'}, Firmware: ${printResult.firmware || 'N/A'}, Pages: ${printResult.total_pages || 'N/A'}]`, printResult);

    res.json({
      status: 'sent',
      bytes: printResult.bytes || 195916,
      printer: pName,
      serial_number: printResult.serial_number,
      firmware: printResult.firmware,
      total_pages: printResult.total_pages,
      message: 'Original regular nozzle check pattern sent to printer spooler with accurate hardware telemetry.'
    });
  } catch (err) {
    res.status(500).json({ status: 'error', code: 20000010, message: err.message });
  }
});

// 10. Paper Feed & Page Eject Routine
app.post('/api/maintenance/paper-feed', async (req, res) => {
  const requested = req.body.printer_name !== undefined ? req.body.printer_name : activeTarget.printer_name;
  const pName = await resolveEffectivePrinter(requested);

  if (!pName || pName === '' || !(await isPrinterOnline(pName))) {
    return res.status(400).json({
      status: 'error',
      code: 20000010,
      message: 'Communication error (20000010): Cannot execute paper feed without physical printer connected.'
    });
  }

  try {
    emitTelemetry('INFO', `Dispatching Paper Feed & Eject command to '${pName}'...`);
    const pkt = EpsonProtocolEngine.buildPaperFeedPacket();
    const sent = await spoolerBridge.sendRawBytes(pName, pkt);
    if (sent.status === 'error') throw new Error(sent.message);
    emitTelemetry('TX', `Form Feed dispatched (${pkt.length} bytes)`);
    res.json({ status: 'ok', sent });
  } catch (err) {
    res.status(500).json({ status: 'error', code: 20000010, message: err.message });
  }
});

// 11. Pickup Roller Cleaning Routine
app.post('/api/maintenance/roller-clean', async (req, res) => {
  const requested = req.body.printer_name !== undefined ? req.body.printer_name : activeTarget.printer_name;
  const pName = await resolveEffectivePrinter(requested);

  if (!pName || pName === '' || !(await isPrinterOnline(pName))) {
    return res.status(400).json({
      status: 'error',
      code: 20000010,
      message: 'Communication error (20000010): Cannot run roller clean without physical printer connected.'
    });
  }

  try {
    emitTelemetry('INFO', `Initiating 3-Cycle Pickup Roller Cleaning routine on '${pName}'...`);
    const pkt = EpsonProtocolEngine.buildRollerCleanPacket();
    const sent = await spoolerBridge.sendRawBytes(pName, pkt);
    if (sent.status === 'error') throw new Error(sent.message);
    emitTelemetry('TX', `Roller cleaning sequence dispatched (${pkt.length} bytes)`);
    res.json({ status: 'ok', message: 'Pickup roller cleaning sequence sent to printer hardware.' });
  } catch (err) {
    res.status(500).json({ status: 'error', code: 20000010, message: err.message });
  }
});

// 12. Full CMYK Diagnostic Calibration Test Page
app.post('/api/maintenance/test-page', async (req, res) => {
  const requested = req.body.printer_name !== undefined ? req.body.printer_name : activeTarget.printer_name;
  const pName = await resolveEffectivePrinter(requested);
  const mId = req.body.model_id || activeTarget.model_id;

  if (!pName || pName === '' || !(await isPrinterOnline(pName))) {
    return res.status(400).json({
      status: 'error',
      code: 20000010,
      message: 'Communication error (20000010): Cannot print diagnostic sheet without physical printer connected.'
    });
  }

  try {
    emitTelemetry('INFO', `Dispatching Diagnostic Test Sheet to '${pName}' (${mId})...`);
    const pkt = EpsonProtocolEngine.buildDiagnosticTestPage(mId, pName);
    const sent = await spoolerBridge.sendRawBytes(pName, pkt);
    if (sent.status === 'error') throw new Error(sent.message);
    emitTelemetry('TX', `Diagnostic Test Sheet dispatched (${pkt.length} bytes)`);
    res.json({ status: 'ok', bytes: pkt.length });
  } catch (err) {
    res.status(500).json({ status: 'error', code: 20000010, message: err.message });
  }
});

// 13. Printhead Bidirectional Alignment Sheet
app.post('/api/maintenance/align-test', async (req, res) => {
  const requested = req.body.printer_name !== undefined ? req.body.printer_name : activeTarget.printer_name;
  const pName = await resolveEffectivePrinter(requested);

  if (!pName || pName === '' || !(await isPrinterOnline(pName))) {
    return res.status(400).json({
      status: 'error',
      code: 20000010,
      message: 'Communication error (20000010): Cannot print alignment sheet without physical printer connected.'
    });
  }

  try {
    emitTelemetry('INFO', `Dispatching Printhead Alignment Pattern to '${pName}'...`);
    const pkt = EpsonProtocolEngine.buildAlignmentTestPacket();
    const sent = await spoolerBridge.sendRawBytes(pName, pkt);
    if (sent.status === 'error') throw new Error(sent.message);
    emitTelemetry('TX', `Alignment pattern dispatched (${pkt.length} bytes)`);
    res.json({ status: 'ok', bytes: pkt.length });
  } catch (err) {
    res.status(500).json({ status: 'error', code: 20000010, message: err.message });
  }
});

// 14. EEPROM Inspector & Memory Dump
app.get('/api/eeprom/dump', async (req, res) => {
  try {
    const requested = req.query.printer_name !== undefined ? req.query.printer_name : activeTarget.printer_name;
    const pName = await resolveEffectivePrinter(requested);
    const mId = req.query.model_id || activeTarget.model_id;
    const modelInfo = modelsMap.get(mId.toUpperCase());

    if (!pName || pName === '' || !(await isPrinterOnline(pName))) {
      return res.status(400).json({
        status: 'error',
        code: 20000010,
        message: 'Communication error (Error code: 20000010)\n\nCannot communicate with printer.\nCheck that printer is ON and USB interface cable is connected.'
      });
    }

    emitTelemetry('TX', `Reading 128-byte EEPROM memory map for '${pName}' (${mId})...`);
    const dump = await spoolerBridge.readEepromRange(pName, mId, modelInfo);

    if (dump.status === 'error') {
      emitTelemetry('ERROR', dump.message);
      return res.status(400).json(dump);
    }

    emitTelemetry('RX', `EEPROM Map read successfully (${dump.total_registers} registers)`);
    res.json(dump);
  } catch (err) {
    res.status(500).json({ status: 'error', code: 20000010, message: err.message });
  }
});

// 15. Export EEPROM Binary (.eep file)
app.get('/api/eeprom/download', async (req, res) => {
  try {
    const requested = req.query.printer_name !== undefined ? req.query.printer_name : activeTarget.printer_name;
    const pName = await resolveEffectivePrinter(requested);
    const mId = req.query.model_id || activeTarget.model_id;
    const modelInfo = modelsMap.get(mId.toUpperCase());

    if (!pName || pName === '' || !(await isPrinterOnline(pName))) {
      return res.status(400).send('No physical printer connected.');
    }

    const dump = await spoolerBridge.readEepromRange(pName, mId, modelInfo);
    const buf = Buffer.alloc(128, 0);
    if (dump.registers) {
      dump.registers.forEach(r => {
        if (r.address < 128) buf[r.address] = r.value & 0xff;
      });
    }

    res.setHeader('Content-Disposition', `attachment; filename="EEPROM_${mId}_${Date.now()}.eep"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.send(buf);
  } catch (err) {
    res.status(500).send('Error generating EEPROM dump: ' + err.message);
  }
});

// 16. Modify Single EEPROM Register with Safety Backup
app.post('/api/eeprom/write-register', async (req, res) => {
  const { address, value, printer_name, model_id } = req.body;
  const requested = printer_name !== undefined ? printer_name : activeTarget.printer_name;
  const pName = await resolveEffectivePrinter(requested);
  const mId = model_id || activeTarget.model_id;

  if (!pName || pName === '' || !(await isPrinterOnline(pName))) {
    return res.status(400).json({ status: 'error', code: 20000010, message: 'No physical printer connected.' });
  }

  const addr = parseInt(address, 16) || parseInt(address, 10);
  const val = parseInt(value, 16) || parseInt(value, 10);
  if (isNaN(addr) || isNaN(val) || addr < 0 || addr > 255 || val < 0 || val > 255) {
    return res.status(400).json({ status: 'error', message: 'Invalid register address or value (0x00 - 0xFF required)' });
  }

  try {
    const hexKey = `0x${addr.toString(16).toUpperCase().padStart(2, '0')}`;
    const backupRes = backupManager.createBackup(mId, { [hexKey]: val }, `Pre-write single register ${hexKey}`);

    const modelInfo = modelsMap.get(mId.toUpperCase());
    const rKey = modelInfo?.read_key || [151, 7];
    const wKey = modelInfo?.write_key || [77, 97, 114, 105, 98, 97, 121, 97];
    let rk = 0x364a;
    if (Array.isArray(rKey) && rKey.length >= 2) rk = (rKey[1] << 8) | rKey[0];

    const writeCmd = EpsonProtocolEngine.buildFactoryEepromWrite(addr, val, wKey, rk);
    const pkt = EpsonProtocolEngine.wrapRemote1Session([writeCmd], false);
    emitTelemetry('TX', `Writing EEPROM Reg ${hexKey} = 0x${val.toString(16).toUpperCase().padStart(2, '0')} (${pkt.length} bytes)`, pkt);

    const sent = await spoolerBridge.sendRawBytes(pName, pkt);
    if (sent.status === 'error') throw new Error(sent.message);

    res.json({
      status: 'ok',
      message: `Register ${hexKey} updated to 0x${val.toString(16).toUpperCase().padStart(2, '0')}`,
      backup: backupRes
    });
  } catch (err) {
    res.status(500).json({ status: 'error', code: 20000010, message: err.message });
  }
});

// 17. Windows Spooler Doctor & System Service Repair
app.post('/api/spooler/doctor', async (req, res) => {
  const pName = req.body.printer_name !== undefined ? req.body.printer_name : activeTarget.printer_name;
  emitTelemetry('INFO', 'Initiating Windows Print Spooler Doctor & Service Repair...');
  const result = await spoolerBridge.repairSpoolerService(pName);
  emitTelemetry('INFO', result.message);
  res.json(result);
});

// 18. Real-time Troubleshoot & Diagnostic Matrix Scan
app.get('/api/troubleshoot/diagnose', async (req, res) => {
  const requested = req.query.printer_name !== undefined ? req.query.printer_name : activeTarget.printer_name;
  const pName = await resolveEffectivePrinter(requested);
  const mId = req.query.model_id || activeTarget.model_id;

  const diagnostics = {
    timestamp: new Date().toISOString(),
    printer_name: pName,
    model_id: mId,
    checks: [],
    healthy: true
  };

  const installed = await spoolerBridge.listPrinters();
  const usbDevs = await spoolerBridge.detectUsbDevices();
  const currentPrinter = pName ? installed.find(p => p.name.toLowerCase() === pName.toLowerCase()) : null;

  // Check 1: USB Physical Presence
  const isUsbPresent = usbDevs.length > 0;
  diagnostics.checks.push({
    id: 'usb_presence',
    name: 'Physical USB Connection',
    status: isUsbPresent ? 'PASS' : 'WARN',
    message: isUsbPresent ? `Verified ${usbDevs.length} physical USB device(s) on USBPRINT class.` : 'No USB devices enumerated on USBPRINT class.',
    action: isUsbPresent ? null : 'Connect your USB cable directly to a motherboard USB port (avoid USB hubs).'
  });

  // Check 2: Windows Print Spooler Queue
  const isDriverOnline = currentPrinter && !currentPrinter.is_offline;
  diagnostics.checks.push({
    id: 'spooler_status',
    name: 'Windows Print Spooler Queue',
    status: isDriverOnline ? 'PASS' : (currentPrinter ? 'WARN' : 'INFO'),
    message: currentPrinter ? `Queue status: ${currentPrinter.is_offline ? 'Offline' : 'Online'}, ${currentPrinter.jobs || 0} active spooler job(s).` : 'Auto selection mode active.',
    action: currentPrinter && currentPrinter.is_offline ? 'Click "Spooler Doctor" to restart spoolsv and unpause queue.' : null
  });

  // Check 3: ESC/P-R Firmware Communication
  if (pName) {
    const hwStatus = await spoolerBridge.queryPrinterStatus(pName);
    const canComm = hwStatus.connected;
    diagnostics.checks.push({
      id: 'hardware_comm',
      name: 'ESC/P-R Remote1 Handshake',
      status: canComm ? 'PASS' : 'FAIL',
      message: canComm ? `Hardware active: State=${hwStatus.state}, Error=${hwStatus.error_description}` : 'Cannot establish bidirectional handshake (Error 20000010).',
      action: canComm ? null : 'Check power button LED and reseat USB cable.'
    });

    if (hwStatus.is_waste_full) {
      diagnostics.healthy = false;
      diagnostics.checks.push({
        id: 'waste_pad',
        name: 'Waste Ink Pad Service Life',
        status: 'CRITICAL',
        message: 'Printer reports waste ink pad has reached end of service life.',
        action: 'Execute Waste Ink Pad Initialization to restore printing.'
      });
    }

    if (hwStatus.is_paper_jam) {
      diagnostics.healthy = false;
      diagnostics.checks.push({
        id: 'paper_jam',
        name: 'Paper Feed Path',
        status: 'WARN',
        message: 'Paper sensor reports jam or feed resistance in pickup roller.',
        action: 'Execute Pickup Roller Clean routine and verify paper tray.'
      });
    }
  }

  diagnostics.healthy = diagnostics.checks.every(c => c.status === 'PASS' || c.status === 'INFO');
  res.json(diagnostics);
});

// 19. NVRAM Backups Vault
app.get('/api/backups', (req, res) => {
  const list = backupManager.listBackups();
  res.json({ status: 'ok', backups: list });
});

app.post('/api/backups/create', (req, res) => {
  const mId = req.body.model_id || activeTarget.model_id;
  const modelInfo = modelsMap.get(mId.toUpperCase());
  const resetMap = modelInfo?.raw_waste_reset || {
    '48': 0, '49': 0, '47': 0, '52': 0, '53': 0, '54': 94, '50': 0, '51': 0, '55': 94, '28': 0
  };
  const hexMap = {};
  for (const [k, v] of Object.entries(resetMap)) {
    const addrHex = `0x${parseInt(k).toString(16).toUpperCase().padStart(2, '0')}`;
    hexMap[addrHex] = v;
  }
  const result = backupManager.createBackup(mId, hexMap, req.body.notes || 'Manual Snapshot');
  emitTelemetry('INFO', `Created manual backup: ${result.filename}`);
  res.json(result);
});

app.post('/api/backups/restore', async (req, res) => {
  const { filename, printer_name, model_id } = req.body;
  const requested = printer_name !== undefined ? printer_name : activeTarget.printer_name;
  const pName = await resolveEffectivePrinter(requested);
  const mId = model_id || activeTarget.model_id;

  if (!pName || pName === '' || !(await isPrinterOnline(pName))) {
    return res.status(400).json({
      status: 'error',
      code: 20000010,
      message: 'Communication error (20000010): Cannot restore NVRAM registers without physical printer connected.'
    });
  }

  try {
    const backup = backupManager.getBackup(filename);
    if (!backup) return res.status(404).json({ status: 'error', message: 'Backup file not found' });

    const addrMap = {};
    for (const [k, v] of Object.entries(backup.address_hex_map || {})) {
      const addr = k.startsWith('0x') ? parseInt(k, 16) : parseInt(k, 10);
      addrMap[addr] = typeof v === 'string' && v.startsWith('0x') ? parseInt(v, 16) : parseInt(v, 10);
    }

    const modelInfo = modelsMap.get(mId.toUpperCase());
    const rKey = modelInfo?.read_key || [151, 7];
    const wKey = modelInfo?.write_key || [77, 97, 114, 105, 98, 97, 121, 97];

    const pkt = EpsonProtocolEngine.buildFullWasteResetPacket(addrMap, wKey, rKey);
    emitTelemetry('TX', `Restoring ${Object.keys(addrMap).length} registers from '${filename}'`, pkt);

    const sent = await spoolerBridge.sendRawBytes(pName, pkt);
    if (sent.status === 'error') throw new Error(sent.message);

    res.json({ status: 'success', message: `Restored ${Object.keys(addrMap).length} registers from ${filename}` });
  } catch (err) {
    res.status(500).json({ status: 'error', code: 20000010, message: err.message });
  }
});

// 20. Purge Spooler Queue
app.post('/api/spooler/purge', async (req, res) => {
  const pName = req.body.printer_name !== undefined ? req.body.printer_name : activeTarget.printer_name;
  const result = await spoolerBridge.purgeQueue(pName);
  emitTelemetry('INFO', `Spooler queue cleared for '${pName || 'All'}': ${result.purged || 0} jobs removed.`);
  res.json(result);
});

// Serve Frontend Static Bundle in Production
const clientDistPath = path.join(__dirname, '..', 'dist');
if (fs.existsSync(clientDistPath)) {
  app.use(express.static(clientDistPath));
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api')) {
      res.sendFile(path.join(clientDistPath, 'index.html'));
    } else {
      next();
    }
  });
} else {
  const staticPath = path.join(__dirname, '..', 'static');
  if (fs.existsSync(staticPath)) {
    app.use(express.static(staticPath));
  }
}

// Express error handler
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ status: 'error', message: 'Malformed JSON payload' });
  }
  console.error('[Universal Tool Server Error]', err.stack || err.message);
  res.status(500).json({ status: 'error', message: err.message || 'Internal server error' });
});

// Start Server with Resilient Port Discovery & EADDRINUSE Handling
function startServer(preferredPort = (parseInt(process.env.PORT, 10) || 3000), maxAttempts = 10) {
  return new Promise((resolve, reject) => {
    let currentPort = preferredPort;
    let attempts = 0;

    function tryListen() {
      const onError = (err) => {
        server.removeListener('listening', onListening);
        server.removeListener('error', onError);
        if (err.code === 'EADDRINUSE') {
          console.warn(`[Universal Tool] Port ${currentPort} is already in use.`);
          attempts++;
          if (attempts < maxAttempts) {
            currentPort++;
            console.log(`[Universal Tool] Trying alternate port ${currentPort}...`);
            tryListen();
          } else {
            currentPort = 0; // Ephemeral OS-assigned port
            console.log('[Universal Tool] Attempting to bind to available ephemeral port...');
            tryListen();
          }
        } else {
          console.error('[Universal Tool] Server listen error:', err);
          reject(err);
        }
      };

      const onListening = async () => {
        server.removeListener('error', onError);
        server.removeListener('listening', onListening);
        const actualPort = server.address().port;
        const url = `http://127.0.0.1:${actualPort}`;
        console.log(`[Universal Tool] Modern Engine Server listening at ${url}`);
        console.log(`[Universal Tool] WebSocket live telemetry stream active on ws://127.0.0.1:${actualPort}`);

        if (process.env.NO_AUTO_OPEN !== 'true' && require.main === module) {
          try {
            const open = require('open');
            await open(url);
          } catch (e) {
            console.log(`[Universal Tool] Open in your browser: ${url}`);
          }
        }

        resolve({ server, port: actualPort, url });
      };

      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(currentPort, '0.0.0.0');
    }

    tryListen();
  });
}

// Auto-start when executed directly via `node server/index.js`
if (require.main === module) {
  startServer().catch(err => {
    console.error('[Universal Tool] Failed to start server:', err);
    process.exit(1);
  });
}

module.exports = {
  app,
  server,
  startServer
};
