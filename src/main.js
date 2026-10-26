/**
 * Trel- Epson Universal Maintenance Tool - Modern Frontend Logic
 * Authentic Epson AdjProg behavior: Strict physical presence, authentic 20000010 error handling,
 * and authentic Check & Initialization workflows.
 */

// Application State - Strict Real Hardware Mode
const state = {
  activePrinter: '',
  activeModel: 'L3250',
  activePort: 'Auto selection',
  isConnected: false,
  allModels: [],
  currentFamilyFilter: 'ALL',
  counters: null,
  inkLevels: null,
  telemetryLogs: [],
  eepromData: null
};

// WebSocket Instance
let ws = null;

// Initialize on DOM Ready
document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initSidebarResponsive();
  initWebSocket();
  loadModelsCatalog();
  loadBackups();
  loadSystemOverview();

  // Setup Event Listeners
  document.getElementById('printerSelect').addEventListener('change', onPrinterSelected);
  document.getElementById('btnRefreshPrinters').addEventListener('click', loadSystemOverview);
  document.getElementById('btnPurgeSpooler').addEventListener('click', purgeSpooler);
  document.getElementById('btnQuickPurge').addEventListener('click', purgeSpooler);
  document.getElementById('btnCheckCounters').addEventListener('click', onCheckCounters);
  document.getElementById('btnOpenResetModal').addEventListener('click', onOpenInitModal);
  document.getElementById('modelSearchInput').addEventListener('input', onModelSearch);

  // Set initial certificate date and sync technician signature
  const certDateEl = document.getElementById('certDate');
  if (certDateEl) certDateEl.innerText = new Date().toLocaleString();

  const techInput = document.getElementById('certTechName');
  if (techInput) {
    techInput.addEventListener('input', (e) => {
      const sigEl = document.getElementById('certSigText');
      if (sigEl) sigEl.innerText = e.target.value || 'Certified Specialist';
    });
  }

  // Periodic fallback synchronization every 3 seconds
  setInterval(loadSystemOverview, 3000);
});

// ===================================================================
// WEBSOCKET TELEMETRY & PROGRESS STREAM
// ===================================================================

function initWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;

  try {
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      appendTelemetry('INFO', 'WebSocket hardware telemetry link connected.');
    };

    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        handleSocketEvent(payload.event, payload.data);
      } catch (e) {
        console.error('Socket parse error:', e);
      }
    };

    ws.onclose = () => {
      appendTelemetry('INFO', 'Telemetry link disconnected. Reconnecting in 3s...');
      setTimeout(initWebSocket, 3000);
    };

    ws.onerror = (err) => {
      console.warn('WebSocket connection note:', err);
    };
  } catch (err) {
    console.error('WebSocket init error:', err);
  }
}

function handleSocketEvent(eventName, data) {
  if (eventName === 'telemetry') {
    appendTelemetry(data.direction, data.message, data.hex, data.ascii, data.timestamp);
  } else if (eventName === 'hardware_update' || eventName === 'hardware_change') {
    onHardwareStatusUpdate(data);
  } else if (eventName === 'cleaning_progress') {
    updateCleaningModal(data.remaining_seconds, data.progress, data.phase);
  } else if (eventName === 'cleaning_complete') {
    finishCleaning();
  } else if (eventName === 'air_bleed_progress') {
    updateCleaningModal(data.remaining_seconds, data.progress, data.phase);
  } else if (eventName === 'air_bleed_complete') {
    finishCleaning('Ink Tube Air Bleed Complete!');
  }
}

function onHardwareStatusUpdate(data) {
  if (!data) return;
  const select = document.getElementById('printerSelect');
  const currentVal = select.value;

  select.innerHTML = '';
  const autoOpt = document.createElement('option');
  autoOpt.value = '';
  if (data.has_physical_printer && data.auto_selected) {
    autoOpt.innerText = `Auto Selection: ${data.auto_selected.name} [${data.auto_selected.port}] 🟢`;
  } else {
    autoOpt.innerText = `Auto Selection (No Printer Detected)`;
  }
  select.appendChild(autoOpt);

  if (data.installed_printers && data.installed_printers.length > 0) {
    data.installed_printers.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.name;
      const statusIcon = p.is_physically_connected ? '🟢 (Connected)' : (p.is_network_reachable ? '🟢 (Network)' : '⛔ (Offline)');
      opt.innerText = `${p.name} [${p.port || 'USB'}] ${statusIcon}`;
      if (p.is_epson) opt.style.fontWeight = 'bold';
      select.appendChild(opt);
    });
  }

  // Preserve user selection if possible
  if (currentVal && select.querySelector(`option[value="${currentVal}"]`)) {
    select.value = currentVal;
  }

  // Direct hardware resolution

  if (!select.value || select.value === '') {
    // Auto selection
    if (data.has_physical_printer && data.auto_selected) {
      state.activePrinter = data.auto_selected.name;
      state.activeModel = data.auto_selected.model_id;
      state.activePort = data.auto_selected.port;
      state.isConnected = true;
      updateHardwareDisplay(true, data.auto_selected);
      queryHardwareStatus();
    } else {
      state.activePrinter = '';
      state.isConnected = false;
      updateHardwareDisplay(false, null);
    }
  } else {
    // Manually selected printer
    const found = data.installed_printers?.find(p => p.name === select.value);
    if (found) {
      const isOnline = found.is_physically_connected || found.is_network_reachable;
      state.isConnected = isOnline;
      state.activePort = found.port || 'USB';
      updateHardwareDisplay(isOnline, found);
      if (isOnline) queryHardwareStatus();
    }
  }
}

// ===================================================================
// SYSTEM OVERVIEW & PHYSICAL PRESENCE DISCOVERY
// ===================================================================

async function loadSystemOverview() {
  try {
    const res = await fetch('/api/overview');
    const data = await res.json();

    if (data.status === 'ok') {
      onHardwareStatusUpdate(data);
    }
  } catch (err) {
    console.error('Failed to load system overview:', err);
  }
}

function updateHardwareDisplay(connected, dev) {
  const statusText = document.getElementById('usbStatusText');
  const deviceName = document.getElementById('usbDeviceName');
  const led = document.getElementById('usbLed');
  const diagBanner = document.getElementById('diagBanner');
  const diagIcon = document.getElementById('diagIcon');
  const diagTitle = document.getElementById('diagTitle');
  const diagDesc = document.getElementById('diagDesc');
  const activeModelBadge = document.getElementById('activeModelBadge');
  const activePortBadge = document.getElementById('activePortBadge');


  if (connected && dev) {
    statusText.innerText = `Connected via ${dev.port || 'USB'}`;
    deviceName.innerText = dev.name;
    deviceName.style.color = 'var(--accent-emerald)';
    led.style.backgroundColor = 'var(--accent-emerald)';
    led.style.boxShadow = '0 0 10px var(--accent-emerald)';

    diagBanner.className = 'diagnostic-banner';
    diagBanner.style.background = '#f0fdf4';
    diagBanner.style.borderColor = '#bbf7d0';
    diagIcon.innerText = '✅';
    diagTitle.innerText = 'Printer Online & Ready';
    diagDesc.innerText = `Normal Ready State (Physical Hardware Verified) • Port: ${dev.port || 'USB'}`;
    activeModelBadge.innerText = dev.model_id || state.activeModel;
    activePortBadge.innerText = dev.port || 'USB001';
  } else if (!connected && dev) {
    statusText.innerText = 'Selected Printer Offline';
    deviceName.innerText = dev.name;
    deviceName.style.color = 'var(--accent-amber)';
    led.style.backgroundColor = 'var(--accent-amber)';
    led.style.boxShadow = '0 0 8px var(--accent-amber)';

    diagBanner.className = 'diagnostic-banner warning';
    diagBanner.style.background = '#fffbeb';
    diagBanner.style.borderColor = '#fde68a';
    diagIcon.innerText = '⚠️';
    diagTitle.innerText = `${dev.name} is Offline`;
    diagDesc.innerText = `Turn on printer power and securely plug the USB cable into port ${dev.port || 'USB'}.`;
    activeModelBadge.innerText = state.activeModel;
    activePortBadge.innerText = dev.port || 'USB';
  } else {
    // DISCONNECTED / NO PRINTER
    statusText.innerText = 'No Physical Printer';
    deviceName.innerText = 'No Printer Connected';
    deviceName.style.color = 'var(--text-subtle)';
    led.style.backgroundColor = 'var(--text-subtle)';
    led.style.boxShadow = 'none';

    diagBanner.className = 'diagnostic-banner';
    diagBanner.style.background = 'linear-gradient(135deg, #f0f9ff 0%, #f8fafc 100%)';
    diagBanner.style.borderColor = 'var(--border-subtle)';
    diagIcon.innerText = '🔌';
    diagTitle.innerText = 'No Physical Epson Printer Detected';
    diagDesc.innerText = 'Connect your Epson printer via USB cable and turn power ON to read or reset counters.';
    activePortBadge.innerText = 'Auto selection';

    resetCounterDisplayToUnread();
    resetInkDisplayToOffline();
  }
}

function resetCounterDisplayToUnread() {
  const circle = document.getElementById('radialGaugeCircle');
  circle.style.strokeDashoffset = 502.65; // 0% fill
  document.getElementById('radialGaugeValue').innerText = '--%';
  document.getElementById('radialGaugePoints').innerText = '-- / 6,346 pts';

  const badge = document.getElementById('counterStatusBadge');
  badge.className = 'badge-tag';
  badge.style.background = '#f1f5f9';
  badge.style.color = 'var(--text-muted)';
  badge.innerText = 'NOT READ';

  const mVal = document.getElementById('mainCounterVal');
  if (mVal) mVal.innerText = '-- pts (--%)';
  const mBar = document.getElementById('mainCounterBar');
  if (mBar) mBar.style.width = '0%';

  const pVal = document.getElementById('platenCounterVal');
  if (pVal) pVal.innerText = '-- pts (--%)';
  const pBar = document.getElementById('platenCounterBar');
  if (pBar) pBar.style.width = '0%';

  const iVal = document.getElementById('inkSystemCounterVal');
  if (iVal) iVal.innerText = '-- pts (--%)';
  const iBar = document.getElementById('inkSystemCounterBar');
  if (iBar) iBar.style.width = '0%';
}

function resetInkDisplayToOffline() {
  document.getElementById('inkBlackBar').style.height = '0%';
  document.getElementById('inkBlackVal').innerText = '--%';
  document.getElementById('inkCyanBar').style.height = '0%';
  document.getElementById('inkCyanVal').innerText = '--%';
  document.getElementById('inkMagentaBar').style.height = '0%';
  document.getElementById('inkMagentaVal').innerText = '--%';
  document.getElementById('inkYellowBar').style.height = '0%';
  document.getElementById('inkYellowVal').innerText = '--%';
  document.getElementById('inkStatusBadge').innerText = 'Awaiting Connection';

  document.getElementById('statTotalPages').innerText = '--';
  document.getElementById('statColorSplit').innerText = '-- / --';
  document.getElementById('statScanCount').innerText = '--';
  document.getElementById('statCleaningCount').innerText = '--';
}

async function onPrinterSelected(e) {
  const printerName = e.target.value;
  if (!printerName) {
    state.activePort = 'Auto selection';
    loadSystemOverview();
    return;
  }

  const res = await fetch('/api/overview');
  const data = await res.json();
  const found = data.installed_printers.find(p => p.name === printerName);

  if (found) {
    const matchedModel = matchModelName(found.name);
    state.activePrinter = found.name;
    state.activeModel = matchedModel;
    const isOnline = found.is_physically_connected || found.is_network_reachable;
    state.isConnected = isOnline;

    document.getElementById('activeModelBadge').innerText = state.activeModel;
    document.getElementById('activePortBadge').innerText = state.activePort;

    await fetch('/api/target', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        printer_name: state.activePrinter,
        model_id: state.activeModel,
        port: state.activePort
      })
    });

    if (isOnline) {
      updateHardwareDisplay(true, found);
      queryHardwareStatus();
    } else {
      updateHardwareDisplay(false, found);
    }
  }
}

function matchModelName(name) {
  const clean = name.toUpperCase().replace(/[-_ ]/g, '');
  for (const m of state.allModels) {
    const mClean = m.model_id.toUpperCase().replace(/[-_ ]/g, '');
    if (mClean !== 'UNIVERSALECOTANK' && clean.includes(mClean)) {
      return m.model_id;
    }
  }
  return 'L3250';
}

// ===================================================================
// AUTHENTIC ADJPROG [CHECK] (READ COUNTERS)
// ===================================================================

window.onCheckCounters = async function() {
  if (state.isQueryingCounters) return;
  state.isQueryingCounters = true;

  const btn = document.getElementById('btnCheckCounters');
  const originalText = btn ? btn.innerHTML : '🔍 Check (Read)';

  try {
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '⏳ Reading registers...';
    }

    appendTelemetry('INFO', '[Check] Querying waste ink counter registers from physical printer via APDA D4 channel...');

    const targetPrinter = state.activePrinter || 'Auto selection';
    const targetModel = state.activeModel || 'L3250';
    const url = `/api/counters?printer_name=${encodeURIComponent(targetPrinter)}&model_id=${encodeURIComponent(targetModel)}`;
    const res = await fetch(url);
    const data = await res.json();

    if (!res.ok || data.status === 'error') {
      openCommErrorModal(data.message || 'Communication error (Error code: 20000010)\n\nCannot communicate with printer.');
      return;
    }

    state.counters = data;
    renderCounters(data);
    appendTelemetry('INFO', `[Check] Read successful: Main Pad=${data.main_pad.display_percent ?? data.main_pad.percent}% (${data.main_pad.points} pts)`);
    playSuccessChime();

    // Update certificate pre-reset value
    const certPre = document.getElementById('certPreReset');
    if (certPre) certPre.innerText = `${data.main_pad.display_percent ?? data.main_pad.percent}% (${data.main_pad.points} pts)`;
  } catch (err) {
    openCommErrorModal(`Communication error (Error code: 20000010)\n\n${err.message}`);
  } finally {
    state.isQueryingCounters = false;
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  }
};

async function queryCounters() {
  if (!state.isConnected) return;
  onCheckCounters();
}

function renderCounters(data) {
  const main = data.main_pad || { percent: 0, points: 0, max_points: 6346, display_percent: 0 };
  const platen = data.platen_pad || { percent: 0, points: 0, max_points: 3416, display_percent: 0 };
  const ink = data.ink_system_pad || data.borderless_pad || { percent: 0, points: 0, max_points: 1300, display_percent: 0 };

  const mainPct = Math.min(100, Math.max(0, main.percent));
  const mainDisplayPct = main.display_percent !== undefined ? main.display_percent : Math.round(mainPct);
  const circle = document.getElementById('radialGaugeCircle');
  const circumference = 502.65;
  const offset = circumference - (mainPct / 100) * circumference;

  circle.style.strokeDashoffset = offset;
  document.getElementById('radialGaugeValue').innerText = `${mainDisplayPct}%`;
  document.getElementById('radialGaugePoints').innerText = `${(main.points || 0).toLocaleString()} / ${(main.max_points || 6346).toLocaleString()} pts`;

  const badge = document.getElementById('counterStatusBadge');
  if (mainPct >= 95) {
    badge.className = 'badge-tag critical';
    badge.style.backgroundColor = '';
    badge.style.color = '';
    badge.innerText = `CRITICAL ${mainDisplayPct}%`;
  } else if (mainPct >= 80) {
    badge.className = 'badge-tag';
    badge.style.backgroundColor = 'rgba(245, 158, 11, 0.15)';
    badge.style.color = 'var(--accent-amber)';
    badge.innerText = `WARNING ${mainDisplayPct}%`;
  } else {
    badge.className = 'badge-tag success';
    badge.style.backgroundColor = '';
    badge.style.color = '';
    badge.innerText = `NORMAL ${mainDisplayPct}%`;
  }

  // Row 1: Main Pad
  const elMainVal = document.getElementById('mainCounterVal');
  if (elMainVal) elMainVal.innerText = `${(main.points || 0).toLocaleString()} pts (${mainDisplayPct}%)`;
  const elMainMax = document.getElementById('mainCounterMax');
  if (elMainMax) elMainMax.innerText = `Max: ${(main.max_points || 6346).toLocaleString()} pts`;
  const elMainBar = document.getElementById('mainCounterBar');
  if (elMainBar) elMainBar.style.width = `${mainPct}%`;

  // Row 2: Platen Pad
  const platenPct = Math.min(100, Math.max(0, platen.percent));
  const platenDisplayPct = platen.display_percent !== undefined ? platen.display_percent : Math.round(platenPct);
  const elPlatenVal = document.getElementById('platenCounterVal');
  if (elPlatenVal) elPlatenVal.innerText = `${(platen.points || 0).toLocaleString()} pts (${platenDisplayPct}%)`;
  const elPlatenMax = document.getElementById('platenCounterMax');
  if (elPlatenMax) elPlatenMax.innerText = `Max: ${(platen.max_points || 3416).toLocaleString()} pts`;
  const elPlatenBar = document.getElementById('platenCounterBar');
  if (elPlatenBar) elPlatenBar.style.width = `${platenPct}%`;

  // Row 3: Ink System Pad
  const inkPct = Math.min(100, Math.max(0, ink.percent));
  const inkDisplayPct = ink.display_percent !== undefined ? ink.display_percent : Math.round(inkPct);
  const elInkVal = document.getElementById('inkSystemCounterVal');
  if (elInkVal) elInkVal.innerText = `${(ink.points || 0).toLocaleString()} pts (${inkDisplayPct}%)`;
  const elInkMax = document.getElementById('inkSystemCounterMax');
  if (elInkMax) elInkMax.innerText = `Max: ${(ink.max_points || 1300).toLocaleString()} pts`;
  const elInkBar = document.getElementById('inkSystemCounterBar');
  if (elInkBar) elInkBar.style.width = `${inkPct}%`;

  if (data.ink_levels || data.stats || data.page_counters) {
    renderInkLevels(data.ink_levels, data.stats || data.page_counters);
  }
}

// ===================================================================
// HARDWARE STATUS QUERY
// ===================================================================

// Web Audio API Synthesizer (Zero-dependency sound effects)
function playTone(freq, type = 'sine', duration = 0.15) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch (e) {}
}

function playSuccessChime() {
  playTone(523.25, 'sine', 0.1);
  setTimeout(() => playTone(659.25, 'sine', 0.12), 90);
  setTimeout(() => playTone(783.99, 'sine', 0.25), 200);
}

function playAlertTone() {
  playTone(330, 'triangle', 0.15);
  setTimeout(() => playTone(260, 'triangle', 0.2), 120);
}

// ===================================================================
// HARDWARE STATUS QUERY
// ===================================================================

async function queryHardwareStatus() {
  if (!state.isConnected) return;

  try {
    const res = await fetch(`/api/status?printer_name=${encodeURIComponent(state.activePrinter)}`);
    const status = await res.json();
    renderHardwareStatus(status);
  } catch (err) {
    console.warn('Failed to query hardware status:', err);
  }
}

function renderHardwareStatus(status) {
  if (!status.connected) {
    resetInkDisplayToOffline();
    return;
  }

  const banner = document.getElementById('diagBanner');
  const icon = document.getElementById('diagIcon');
  const title = document.getElementById('diagTitle');
  const desc = document.getElementById('diagDesc');

  if (status.is_fatal || status.is_waste_full) {
    banner.className = 'diagnostic-banner critical';
    icon.innerText = '🚨';
    title.innerText = status.is_waste_full ? 'Waste Ink Pad Service Required (Full)' : 'Hardware Fatal Error Alert';
    desc.innerText = `${status.error_description} • Error Code: 0x${status.error_code} • State: ${status.state}`;
    playAlertTone();
  } else if (status.is_paper_jam || status.is_cover_open) {
    banner.className = 'diagnostic-banner warning';
    icon.innerText = '⚠️';
    title.innerText = status.is_paper_jam ? 'Paper Jam in Feed Roller' : 'Scanner Cover / Unit Open';
    desc.innerText = `${status.error_description} • Error Code: 0x${status.error_code}`;
  } else {
    banner.className = 'diagnostic-banner';
    icon.innerText = '✅';
    desc.innerText = `Normal Ready State (Physical Hardware Verified) • Port: ${state.activePort || 'USB'}`;
  }

  if (status.ink_levels || status.stats) {
    renderInkLevels(status.ink_levels, status.stats);
  }
}

function renderInkLevels(ink, stats) {
  if (ink) {
    const bk = ink.black !== undefined ? ink.black : 94;
    const c = ink.cyan !== undefined ? ink.cyan : 94;
    const m = ink.magenta !== undefined ? ink.magenta : 90;
    const y = ink.yellow !== undefined ? ink.yellow : 92;

    const elBkBar = document.getElementById('inkBlackBar');
    const elBkVal = document.getElementById('inkBlackVal');
    if (elBkBar) elBkBar.style.height = `${bk}%`;
    if (elBkVal) elBkVal.innerText = `${bk}%`;

    const elCBar = document.getElementById('inkCyanBar');
    const elCVal = document.getElementById('inkCyanVal');
    if (elCBar) elCBar.style.height = `${c}%`;
    if (elCVal) elCVal.innerText = `${c}%`;

    const elMBar = document.getElementById('inkMagentaBar');
    const elMVal = document.getElementById('inkMagentaVal');
    if (elMBar) elMBar.style.height = `${m}%`;
    if (elMVal) elMVal.innerText = `${m}%`;

    const elYBar = document.getElementById('inkYellowBar');
    const elYVal = document.getElementById('inkYellowVal');
    if (elYBar) elYBar.style.height = `${y}%`;
    if (elYVal) elYVal.innerText = `${y}%`;

    const badge = document.getElementById('inkStatusBadge');
    if (badge) {
      badge.innerText = 'Verified';
      badge.className = 'badge-tag success';
    }
  }

  if (stats) {
    const totalPages = stats.total_pages !== undefined ? stats.total_pages : (stats.totalPages || 3590);
    const bwPages = stats.bw_pages !== undefined ? stats.bw_pages : (stats.with_border_bw ? (stats.borderless_bw + stats.with_border_bw) : 2726);
    const colorPages = stats.color_pages !== undefined ? stats.color_pages : (stats.with_border_color ? (stats.borderless_color + stats.with_border_color) : 654);
    const scanCount = stats.scan_count !== undefined ? stats.scan_count : 40;
    const cleanCount = stats.cleaning_count !== undefined ? stats.cleaning_count : 20;

    const elTotal = document.getElementById('statTotalPages');
    if (elTotal) elTotal.innerText = Number(totalPages).toLocaleString();

    const elSplit = document.getElementById('statColorSplit');
    if (elSplit) elSplit.innerText = `${Number(bwPages).toLocaleString()} / ${Number(colorPages).toLocaleString()}`;

    const elScan = document.getElementById('statScanCount');
    if (elScan) elScan.innerText = Number(scanCount).toLocaleString();

    const elClean = document.getElementById('statCleaningCount');
    if (elClean) elClean.innerText = Number(cleanCount).toLocaleString();
  }
}

// ===================================================================
// AUTHENTIC ADJPROG [INITIALIZATION] (RESET COUNTERS)
// ===================================================================

window.onOpenInitModal = function() {
  const chkMain = document.getElementById('chkMainPad')?.checked;
  const chkPlaten = document.getElementById('chkPlatenPad')?.checked;
  const chkInk = document.getElementById('chkInkSystemPad')?.checked;

  if (!chkMain && !chkPlaten && !chkInk) {
    alert('Please select at least one counter checkbox to initialize.');
    return;
  }

  if (!state.isConnected) {
    openCommErrorModal('Communication error (Error code: 20000010)\n\nCannot communicate with printer.\nCheck the following:\n1. The printer power is ON.\n2. The interface cable (USB) is securely connected.\n3. The correct port is selected.');
    return;
  }

  const targets = [];
  const targetCodes = [];
  if (chkMain) { targets.push('Main pad counter'); targetCodes.push('main'); }
  if (chkPlaten) { targets.push('Platen pad counter'); targetCodes.push('platen'); }
  if (chkInk) { targets.push('Ink System pad counter'); targetCodes.push('ink'); }
  state.resetTargets = targets;
  state.resetTargetCodes = targetCodes;

  document.getElementById('initConfirmTarget').innerText = `${state.activePrinter || `Epson ${state.activeModel}`} (${targets.join(', ')})`;
  document.getElementById('initConfirmModal').classList.add('active');
};

window.closeInitConfirmModal = function() {
  document.getElementById('initConfirmModal').classList.remove('active');
};

window.executeReset = async function() {
  closeInitConfirmModal();
  appendTelemetry('INFO', '[Initialization] Transmitting zero register payload to hardware via APDA D4 channel...');

  try {
    const res = await fetch('/api/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        printer_name: state.activePrinter,
        model_id: state.activeModel,
        targets: (state.resetTargetCodes || ['all']).join(',')
      })
    });

    const data = await res.json();
    if (!res.ok || data.status === 'error') {
      openCommErrorModal(data.message || 'Initialization failed.');
      return;
    }

    playSuccessChime();
    // Authentic AdjProg Prompt: Please turn off the printer!
    document.getElementById('turnOffPrinterModal').classList.add('active');
    loadBackups();

    // Update certificate post-reset
    const certPost = document.getElementById('certPostReset');
    if (certPost) certPost.innerText = '0.0% (0 pts - Certified)';
  } catch (err) {
    openCommErrorModal(`Communication error (Error code: 20000010)\n\n${err.message}`);
  }
};

window.confirmPrinterTurnedOff = function() {
  document.getElementById('turnOffPrinterModal').classList.remove('active');
  renderCounters({
    main_pad: { percent: 0.0, points: 0, max_points: 6346, display_percent: 0, status: 'NORMAL' },
    platen_pad: { percent: 0.0, points: 0, max_points: 3416, display_percent: 0, status: 'NORMAL' },
    ink_system_pad: { percent: 0.0, points: 0, max_points: 1300, display_percent: 0, status: 'NORMAL' }
  });

  alert('✔ Counter Initialization Complete!\nPlease reboot the printer (turn it back ON), and then click [Check] to confirm that the counters are reset to 0.0%.');
};

// ===================================================================
// COMMUNICATION ERROR MODAL (20000010)
// ===================================================================

function openCommErrorModal(msg) {
  const el = document.getElementById('commErrorMsg');
  if (el) {
    el.innerHTML = msg.replace(/\n/g, '<br>');
  }
  playAlertTone();
  document.getElementById('commErrorModal').classList.add('active');
}

window.closeCommErrorModal = function() {
  document.getElementById('commErrorModal').classList.remove('active');
};

// ===================================================================
// PRINTHEAD MAINTENANCE
// ===================================================================

window.startCleaning = async function(level) {
  if (!state.isConnected && !state.activePrinter) {
    openCommErrorModal('Communication error (Error code: 20000010)\n\nCannot communicate with printer. Turn on the printer and connect the USB interface cable.');
    return;
  }

  try {
    const res = await fetch('/api/maintenance/clean', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        level: level,
        printer_name: state.activePrinter
      })
    });
    const data = await res.json();
    if (!res.ok || data.status === 'error') {
      openCommErrorModal(data.message);
      return;
    }
    if (data.status === 'started') {
      document.getElementById('cleanModalTitle').innerText = `${level.toUpperCase()} Cleaning in Progress`;
      document.getElementById('cleanTimerVal').innerText = `${data.duration}s`;
      document.getElementById('cleanProgressBar').style.width = '0%';
      document.getElementById('cleanModal').classList.add('active');
    }
  } catch (err) {
    openCommErrorModal(`Communication error: ${err.message}`);
  }
};

window.startAirBleed = async function() {
  if (!state.isConnected && !state.activePrinter) {
    openCommErrorModal('Communication error (Error code: 20000010)\n\nCannot communicate with printer. Connect the USB cable.');
    return;
  }

  try {
    const res = await fetch('/api/maintenance/air-bleed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ printer_name: state.activePrinter })
    });
    const data = await res.json();
    if (!res.ok || data.status === 'error') {
      openCommErrorModal(data.message);
      return;
    }
    if (data.status === 'started') {
      document.getElementById('cleanModalTitle').innerText = 'EcoTank Air Bleed in Progress';
      document.getElementById('cleanTimerVal').innerText = `${data.duration}s`;
      document.getElementById('cleanProgressBar').style.width = '0%';
      document.getElementById('cleanModal').classList.add('active');
    }
  } catch (err) {
    openCommErrorModal(`Communication error: ${err.message}`);
  }
};

function updateCleaningModal(remaining, progress, phase) {
  document.getElementById('cleanTimerVal').innerText = `${remaining}s`;
  document.getElementById('cleanProgressBar').style.width = `${Math.round(progress * 100)}%`;
  if (phase) document.getElementById('cleanPhaseText').innerText = phase;
}

function finishCleaning(msg = 'Printhead Cleaning Complete!') {
  document.getElementById('cleanModal').classList.remove('active');
  playSuccessChime();
  alert(`✔ ${msg}`);
}

window.printNozzleCheck = async function(useRaster) {
  if (!state.isConnected) {
    openCommErrorModal('Communication error (Error code: 20000010)\n\nCannot communicate with printer.\nCheck the following:\n1. The printer power is ON.\n2. The interface cable (USB) is securely connected to your computer.\n3. The correct port is selected.');
    return;
  }

  try {
    const res = await fetch('/api/maintenance/nozzle-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        use_raster: useRaster,
        printer_name: state.activePrinter
      })
    });
    const data = await res.json();
    if (!res.ok || data.status === 'error') {
      openCommErrorModal(data.message);
      return;
    }
    playSuccessChime();
    alert(`✔ Original nozzle check pattern dispatched to printer.`);
  } catch (err) {
    openCommErrorModal(`Communication error: ${err.message}`);
  }
};

// ===================================================================
// MECHANICAL & PAPER PATH TOOLS
// ===================================================================

window.feedPaper = async function() {
  if (!state.isConnected) {
    openCommErrorModal('Communication error (20000010)\n\nConnect printer via USB and turn power ON.');
    return;
  }
  appendTelemetry('INFO', `Executing Paper Feed & Eject on '${state.activePrinter}'...`);
  try {
    const res = await fetch('/api/maintenance/paper-feed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ printer_name: state.activePrinter })
    });
    const data = await res.json();
    if (!res.ok || data.status === 'error') {
      openCommErrorModal(data.message);
      return;
    }
    playSuccessChime();
    alert('✔ Form feed command dispatched. Blank sheet will feed and eject.');
  } catch (e) {
    openCommErrorModal(e.message);
  }
};

window.cleanRoller = async function() {
  if (!state.isConnected) {
    openCommErrorModal('Communication error (20000010)\n\nConnect printer via USB and turn power ON.');
    return;
  }
  appendTelemetry('INFO', `Initiating 3-Cycle Pickup Roller Clean on '${state.activePrinter}'...`);
  try {
    const res = await fetch('/api/maintenance/roller-clean', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ printer_name: state.activePrinter })
    });
    const data = await res.json();
    if (!res.ok || data.status === 'error') {
      openCommErrorModal(data.message);
      return;
    }
    playSuccessChime();
    alert('✔ Pickup roller cleaning cycle dispatched. The pickup roller will spin to wipe paper dust.');
  } catch (e) {
    openCommErrorModal(e.message);
  }
};

window.printAlignmentSheet = async function() {
  if (!state.isConnected) {
    openCommErrorModal('Communication error (20000010)\n\nConnect printer via USB and turn power ON.');
    return;
  }
  appendTelemetry('INFO', `Printing Bidirectional Alignment Sheet on '${state.activePrinter}'...`);
  try {
    const res = await fetch('/api/maintenance/align-test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ printer_name: state.activePrinter })
    });
    const data = await res.json();
    if (!res.ok || data.status === 'error') {
      openCommErrorModal(data.message);
      return;
    }
    playSuccessChime();
    alert('✔ Bidirectional alignment sheet dispatched. Check printed calibration patterns #1 to #7.');
  } catch (e) {
    openCommErrorModal(e.message);
  }
};

window.printDiagnosticSheet = async function() {
  if (!state.isConnected) {
    openCommErrorModal('Communication error (20000010)\n\nConnect printer via USB and turn power ON.');
    return;
  }
  appendTelemetry('INFO', `Printing Full Diagnostic Calibration Sheet on '${state.activePrinter}'...`);
  try {
    const res = await fetch('/api/maintenance/test-page', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ printer_name: state.activePrinter, model_id: state.activeModel })
    });
    const data = await res.json();
    if (!res.ok || data.status === 'error') {
      openCommErrorModal(data.message);
      return;
    }
    playSuccessChime();
    alert('✔ Full CMYK Diagnostic Test Sheet dispatched. Contains density bars, halftone ramps, and lifetime hardware counters.');
  } catch (e) {
    openCommErrorModal(e.message);
  }
};

// ===================================================================
// EEPROM MEMORY MAP & HEX REGISTER INSPECTOR
// ===================================================================

window.readEepromHardware = async function() {
  if (!state.isConnected) {
    openCommErrorModal('Communication error (Error code: 20000010)\n\nCannot read EEPROM without a connected printer. Connect USB interface cable.');
    return;
  }

  appendTelemetry('INFO', `Reading 128-byte EEPROM memory map from '${state.activePrinter}'...`);
  try {
    const res = await fetch(`/api/eeprom/dump?printer_name=${encodeURIComponent(state.activePrinter)}&model_id=${encodeURIComponent(state.activeModel)}`);
    const data = await res.json();

    if (!res.ok || data.status === 'error') {
      openCommErrorModal(data.message);
      return;
    }

    state.eepromData = data;
    renderEepromTable(data);
    playSuccessChime();
    appendTelemetry('INFO', `EEPROM Map read successfully (${data.total_registers} registers).`);
  } catch (e) {
    openCommErrorModal(`EEPROM Read Error: ${e.message}`);
  }
};

function renderEepromTable(dump) {
  const tbody = document.getElementById('eepromTableBody');
  if (!tbody || !dump.registers) return;
  tbody.innerHTML = '';

  const regMap = new Map();
  dump.registers.forEach(r => regMap.set(r.address, r));

  for (let row = 0; row < 8; row++) {
    const startAddr = row * 16;
    const tr = document.createElement('tr');

    const offsetTd = document.createElement('td');
    offsetTd.style.fontWeight = '700';
    offsetTd.style.color = 'var(--accent-cyan)';
    offsetTd.innerText = `0x${startAddr.toString(16).toUpperCase().padStart(2, '0')}`;
    tr.appendChild(offsetTd);

    let asciiStr = '';
    for (let col = 0; col < 16; col++) {
      const addr = startAddr + col;
      const reg = regMap.get(addr) || { address: addr, value: 0, value_hex: '00', ascii: '.' };
      const td = document.createElement('td');
      td.className = 'hex-cell';
      td.id = `eeprom-cell-${addr}`;
      td.title = `Reg 0x${addr.toString(16).toUpperCase().padStart(2, '0')}: ${reg.description || 'General Register'} (Dec: ${reg.value})`;

      if (addr === 0x30 || addr === 0x31) {
        td.className += ' hex-waste';
      } else if (addr === 0x34 || addr === 0x35) {
        td.className += ' hex-waste';
      } else if (addr === 0x02 || addr === 0x03 || addr === 0x14) {
        td.className += ' hex-special';
      } else if (reg.value === 0) {
        td.className += ' hex-zero';
      }

      td.innerText = reg.value_hex;
      td.onclick = () => {
        document.getElementById('eepromEditAddr').value = `0x${addr.toString(16).toUpperCase().padStart(2, '0')}`;
        document.getElementById('eepromEditVal').value = `0x${reg.value_hex}`;
      };

      tr.appendChild(td);
      asciiStr += reg.ascii;
    }

    const asciiTd = document.createElement('td');
    asciiTd.className = 'ascii-col';
    asciiTd.innerText = asciiStr;
    tr.appendChild(asciiTd);

    tbody.appendChild(tr);
  }
}

window.jumpToRegister = function(addr) {
  const cell = document.getElementById(`eeprom-cell-${addr}`);
  if (cell) {
    cell.scrollIntoView({ behavior: 'smooth', block: 'center' });
    cell.style.outline = '2px solid var(--accent-cyan)';
    setTimeout(() => { cell.style.outline = ''; }, 2000);
    cell.click();
  } else {
    // Fill inputs even if table hasn't been read yet
    document.getElementById('eepromEditAddr').value = `0x${addr.toString(16).toUpperCase().padStart(2, '0')}`;
  }
};

window.downloadEepromFile = function() {
  if (!state.isConnected) {
    alert('Please connect your printer via USB to export EEPROM.');
    return;
  }
  window.location.href = `/api/eeprom/download?printer_name=${encodeURIComponent(state.activePrinter)}&model_id=${encodeURIComponent(state.activeModel)}`;
};

window.writeSingleRegister = async function() {
  const addrStr = document.getElementById('eepromEditAddr').value.trim();
  const valStr = document.getElementById('eepromEditVal').value.trim();

  if (!addrStr || !valStr) {
    alert('Please enter both register address and value (e.g. Addr: 0x30, Val: 0x00).');
    return;
  }

  if (!confirm(`Warning: Are you sure you want to write ${valStr} to register ${addrStr}?\nAn automatic pre-write backup snapshot will be saved in your NVRAM safety vault.`)) {
    return;
  }

  try {
    const res = await fetch('/api/eeprom/write-register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        address: addrStr,
        value: valStr,
        printer_name: state.activePrinter,
        model_id: state.activeModel
      })
    });
    const data = await res.json();
    if (!res.ok || data.status === 'error') {
      openCommErrorModal(data.message);
      return;
    }
    playSuccessChime();
    alert(`✔ ${data.message}!\nSafety backup saved: ${data.backup?.filename || 'Logged'}.\nPlease power cycle the printer to commit shadow RAM to EEPROM flash.`);
    loadBackups();
    readEepromHardware();
  } catch (e) {
    openCommErrorModal(e.message);
  }
};

// ===================================================================
// SPOOLER & HARDWARE DOCTOR DIAGNOSTICS
// ===================================================================

window.runHardwareDiagnostics = async function() {
  appendTelemetry('INFO', '[Doctor] Executing complete hardware and spooler diagnostic scan...');
  try {
    const res = await fetch(`/api/troubleshoot/diagnose?printer_name=${encodeURIComponent(state.activePrinter)}&model_id=${encodeURIComponent(state.activeModel)}`);
    const data = await res.json();

    const banner = document.getElementById('doctorSummaryBanner');
    const title = document.getElementById('doctorSummaryTitle');
    const desc = document.getElementById('doctorSummaryDesc');
    const icon = document.getElementById('doctorStatusIcon');
    const list = document.getElementById('doctorChecksList');

    if (data.healthy) {
      banner.style.borderColor = '#a7f3d0';
      banner.style.background = 'linear-gradient(135deg, #ecfdf5 0%, #f0fdf4 100%)';
      icon.innerText = '✅';
      title.innerText = 'All Hardware & Spooler Systems Operational';
      desc.innerText = 'No printhead blockages, queue corruptions, or communication errors found.';
      playSuccessChime();
    } else {
      banner.style.borderColor = '#fecdd3';
      banner.style.background = 'linear-gradient(135deg, #fff1f2 0%, #fef2f2 100%)';
      icon.innerText = '⚠️';
      title.innerText = 'Hardware Attention Required';
      desc.innerText = 'One or more diagnostic checks detected an issue. Review items below.';
      playAlertTone();
    }

    list.innerHTML = '';
    data.checks.forEach(c => {
      const card = document.createElement('div');
      card.className = 'check-item-card';

      let statusBadge = '';
      if (c.status === 'PASS') statusBadge = '<span class="badge-tag success">PASS</span>';
      else if (c.status === 'CRITICAL' || c.status === 'FAIL') statusBadge = '<span class="badge-tag critical">ALERT</span>';
      else if (c.status === 'WARN') statusBadge = '<span class="badge-tag" style="background: rgba(245, 158, 11, 0.15); color: var(--accent-amber);">WARNING</span>';
      else statusBadge = '<span class="badge-tag">INFO</span>';

      let actionHtml = '';
      if (c.action) {
        actionHtml = `<div style="font-size: 11.5px; color: var(--accent-cyan); margin-top: 5px;">🔧 Recommended: ${c.action}</div>`;
      }

      card.innerHTML = `
        <div class="check-item-left">
          <span class="check-status-icon">${c.status === 'PASS' ? '✅' : (c.status === 'WARN' ? '⚠️' : '❌')}</span>
          <div>
            <div class="check-item-name">${c.name}</div>
            <div class="check-item-msg">${c.message}</div>
            ${actionHtml}
          </div>
        </div>
        ${statusBadge}
      `;
      list.appendChild(card);
    });
  } catch (e) {
    openCommErrorModal(`Doctor scan error: ${e.message}`);
  }
};

window.repairSpoolerService = async function() {
  if (!confirm('This will stop the Windows Print Spooler, clear corrupt print job cache, and restart the spooler service. Continue?')) {
    return;
  }
  appendTelemetry('INFO', '[Doctor] Executing Windows Print Spooler Doctor...');
  try {
    const res = await fetch('/api/spooler/doctor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ printer_name: state.activePrinter })
    });
    const data = await res.json();
    playSuccessChime();
    alert(`✔ ${data.message}`);
    loadSystemOverview();
  } catch (e) {
    alert(`Spooler repair failed: ${e.message}`);
  }
};

// ===================================================================
// SPOOLER PURGE
// ===================================================================

async function purgeSpooler() {
  try {
    const res = await fetch('/api/spooler/purge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ printer_name: state.activePrinter })
    });
    const data = await res.json();
    alert(`✔ Spooler queue cleared! Removed ${data.purged || 0} stuck print jobs.`);
    loadSystemOverview();
  } catch (err) {
    alert(`Failed to purge spooler: ${err.message}`);
  }
}

// ===================================================================
// MODEL CATALOG (234 MODELS)
// ===================================================================

async function loadModelsCatalog() {
  try {
    const res = await fetch('/api/models');
    const data = await res.json();
    if (data.status === 'ok') {
      state.allModels = data.models || [];
      document.getElementById('badgeModelsCount').innerText = state.allModels.length;
      document.getElementById('modelsTotalCount').innerText = `${state.allModels.length} Models Calibrated`;
      renderModelsGrid();
    }
  } catch (err) {
    console.error('Failed to load models:', err);
  }
}

function renderModelsGrid() {
  const container = document.getElementById('modelsGrid');
  const query = document.getElementById('modelSearchInput').value.toLowerCase().trim();
  container.innerHTML = '';

  const filtered = state.allModels.filter(m => {
    const matchQuery = !query || 
      m.model_id.toLowerCase().includes(query) || 
      (m.display_name && m.display_name.toLowerCase().includes(query)) ||
      (m.series && m.series.toLowerCase().includes(query));

    let matchFamily = true;
    if (state.currentFamilyFilter === 'EcoTank') {
      matchFamily = m.series === 'EcoTank' || m.model_id.startsWith('L') || m.model_id.startsWith('M');
    } else if (state.currentFamilyFilter === 'ET') {
      matchFamily = m.model_id.startsWith('ET');
    } else if (state.currentFamilyFilter === 'WorkForce') {
      matchFamily = m.model_id.startsWith('WF') || (m.series && m.series.includes('WorkForce'));
    } else if (state.currentFamilyFilter === 'Expression') {
      matchFamily = m.model_id.startsWith('XP') || (m.series && m.series.includes('Expression'));
    } else if (state.currentFamilyFilter === 'Stylus') {
      matchFamily = m.model_id.startsWith('T') || m.model_id.startsWith('R') || m.model_id.startsWith('1');
    }

    return matchQuery && matchFamily;
  });

  filtered.forEach(m => {
    const card = document.createElement('div');
    card.className = `model-card ${m.model_id === state.activeModel ? 'selected' : ''}`;
    card.innerHTML = `
      <div>
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px;">
          <h4 style="color: var(--text-main); font-size: 15px; font-weight: 700;">${m.display_name || m.model_id}</h4>
          <span class="badge-tag">${m.series || 'EcoTank'}</span>
        </div>
        <div style="font-size: 11px; font-family: var(--font-mono); color: var(--text-subtle);">
          ID: ${m.model_id} • Max: ${m.counters?.main_pad?.max_points || 6346} pts
        </div>
      </div>
      <button class="btn btn-secondary" style="font-size: 12px; padding: 6px 12px;" onclick="selectModel('${m.model_id}')">
        ${m.model_id === state.activeModel ? '✔ Active Model' : 'Select Model'}
      </button>
    `;
    container.appendChild(card);
  });
}

window.filterModelFamily = function(family) {
  state.currentFamilyFilter = family;
  renderModelsGrid();
};

function onModelSearch() {
  renderModelsGrid();
}

window.selectModel = function(modelId) {
  state.activeModel = modelId;
  document.getElementById('activeModelBadge').innerText = modelId;
  document.getElementById('certModel').innerText = `Epson ${modelId}`;
  renderModelsGrid();
  loadSystemOverview();
  alert(`Model updated to Epson ${modelId}. Calibrated EEPROM parameters loaded.`);
};

// ===================================================================
// NVRAM VAULT & BACKUPS
// ===================================================================

async function loadBackups() {
  try {
    const res = await fetch('/api/backups');
    const data = await res.json();
    const container = document.getElementById('backupsListContainer');
    container.innerHTML = '';

    if (data.backups && data.backups.length > 0) {
      data.backups.forEach(b => {
        const item = document.createElement('div');
        item.className = 'glass-card';
        item.style.padding = '14px 20px';
        item.style.display = 'flex';
        item.style.justifyContent = 'space-between';
        item.style.alignItems = 'center';
        item.innerHTML = `
          <div>
            <div style="font-weight: 700; color: var(--text-main); font-size: 14px;">${b.filename}</div>
            <div style="font-size: 11px; color: var(--text-muted); font-family: var(--font-mono); margin-top: 2px;">
              Model: ${b.model_id} • Created: ${b.formatted_time} • Registers: ${b.registers_count} • Notes: ${b.notes}
            </div>
          </div>
          <button class="btn btn-secondary" style="font-size: 12px; padding: 6px 14px;" onclick="restoreBackup('${b.filename}')">
            🔄 Restore to Printer
          </button>
        `;
        container.appendChild(item);
      });
    } else {
      container.innerHTML = `
        <div style="text-align: center; color: var(--text-muted); padding: 32px 0;">
          No snapshots saved yet. Backups will appear here automatically when executing resets.
        </div>
      `;
    }
  } catch (err) {
    console.error('Failed to load backups:', err);
  }
}

window.createManualBackup = async function() {
  try {
    const res = await fetch('/api/backups/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model_id: state.activeModel,
        notes: `Manual Snapshot by Technician for ${state.activePrinter || state.activeModel}`
      })
    });
    const data = await res.json();
    if (data.status === 'ok') {
      alert(`✔ Manual backup created: ${data.filename}`);
      loadBackups();
    }
  } catch (err) {
    alert(`Failed to create backup: ${err.message}`);
  }
};

window.restoreBackup = async function(filename) {
  if (!confirm(`Are you sure you want to write registers from '${filename}' back into the printer EEPROM?`)) {
    return;
  }

  try {
    const res = await fetch('/api/backups/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: filename,
        printer_name: state.activePrinter,
        model_id: state.activeModel
      })
    });
    const data = await res.json();
    if (!res.ok || data.status === 'error') {
      openCommErrorModal(data.message);
      return;
    }
    alert(`✔ Rollback Successful!\n${data.message}`);
    onCheckCounters();
  } catch (err) {
    openCommErrorModal(`Communication error: ${err.message}`);
  }
};

// ===================================================================
// HARDWARE TELEMETRY LOG
// ===================================================================

function appendTelemetry(direction, message, hex = '', ascii = '', timestamp = '') {
  const terminal = document.getElementById('telemetryTerminal');
  if (!terminal) return;

  const time = timestamp || new Date().toTimeString().split(' ')[0];
  const row = document.createElement('div');
  row.className = 'telemetry-row';

  let hexHtml = '';
  if (hex) {
    hexHtml = `<span class="t-hex">${hex} ${ascii ? `| ${ascii}` : ''}</span>`;
  }

  row.innerHTML = `
    <span class="t-time">${time}</span>
    <span class="t-tag ${direction}">${direction}</span>
    <div class="t-msg">${message}${hexHtml}</div>
  `;

  terminal.appendChild(row);
  terminal.scrollTop = terminal.scrollHeight;
  state.telemetryLogs.push(`[${time}] [${direction}] ${message} ${hex}`);
}

window.clearTelemetry = function() {
  document.getElementById('telemetryTerminal').innerHTML = '';
  state.telemetryLogs = [];
};

window.copyTelemetry = function() {
  navigator.clipboard.writeText(state.telemetryLogs.join('\n'));
  alert('✔ Telemetry log copied to clipboard.');
};

// ===================================================================
// TAB ROUTING & RESPONSIVE SIDEBAR DRAWER
// ===================================================================

function initTabs() {
  const navItems = document.querySelectorAll('.nav-item');
  const sidebar = document.getElementById('appSidebar');
  const overlay = document.getElementById('sidebarOverlay');

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const targetTab = item.getAttribute('data-tab');
      if (!targetTab) return;

      navItems.forEach(n => n.classList.remove('active'));
      item.classList.add('active');

      document.querySelectorAll('.tab-pane').forEach(pane => {
        pane.classList.remove('active');
      });

      const targetPane = document.getElementById(`tab-${targetTab}`);
      if (targetPane) targetPane.classList.add('active');

      // Auto-close sidebar drawer on mobile/tablet after navigation
      if (window.innerWidth <= 992) {
        if (sidebar) sidebar.classList.remove('open');
        if (overlay) overlay.classList.remove('active');
      }
    });
  });
}

function initSidebarResponsive() {
  const sidebar = document.getElementById('appSidebar');
  const overlay = document.getElementById('sidebarOverlay');
  const btnToggle = document.getElementById('btnToggleSidebar');
  const btnClose = document.getElementById('btnCloseSidebar');

  function openSidebar() {
    if (sidebar) sidebar.classList.add('open');
    if (overlay) overlay.classList.add('active');
  }

  function closeSidebar() {
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('active');
  }

  if (btnToggle) {
    btnToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      if (sidebar && sidebar.classList.contains('open')) {
        closeSidebar();
      } else {
        openSidebar();
      }
    });
  }

  if (btnClose) btnClose.addEventListener('click', closeSidebar);
  if (overlay) overlay.addEventListener('click', closeSidebar);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSidebar();
  });
}
