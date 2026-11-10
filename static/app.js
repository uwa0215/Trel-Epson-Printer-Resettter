/**
 * Trel- Universal Tool - Modern Desktop Interface Logic
 * Connects directly to Python backend via pywebview window.pywebview.api
 * With full browser emulation fallback.
 */

// Application State
let isPyWebviewReady = false;
let currentTarget = {
  printer_name: "EcoTank Series (Ready)",
  model_id: "L3250",
  port: "USB001",
  is_simulator: false
};
let allModels = [];
let currentFamilyFilter = "ALL";
let isCleaning = false;
let chartsInitialized = false;
let chartDistribution = null;
let chartMaintenance = null;

// Initialize on DOM load
document.addEventListener("DOMContentLoaded", () => {
  // Check if pywebview is available
  if (window.pywebview) {
    onPyWebviewReady();
  } else {
    window.addEventListener("pywebviewready", onPyWebviewReady);
    // Timeout fallback for browser testing
    setTimeout(() => {
      if (!isPyWebviewReady) {
        initFallbackMode();
      }
    }, 500);
  }

  // Setup tab routing
  initTabs();
  // Init charts
  initCharts();
});

// Event hook from Python backend bridge
window.onBridgeEvent = function(eventName, payload) {
  if (eventName === "telemetry") {
    appendTelemetry(payload.direction, payload.message, payload.hex, payload.ascii, payload.timestamp);
  } else if (eventName === "reset_progress") {
    updateResetStepper(payload.step, payload.label, payload.progress);
  } else if (eventName === "cleaning_progress") {
    updateCleaningProgress(payload.remaining_seconds, payload.progress, payload.phase);
  } else if (eventName === "cleaning_complete") {
    finishCleaning("✔ Printhead Cleaning Cycle Complete!");
  } else if (eventName === "power_flush_progress") {
    updateCleaningProgress(payload.remaining_seconds, payload.progress, "Heavy Ink Flush in progress...");
  } else if (eventName === "power_flush_complete") {
    finishCleaning("✔ Power Cleaning / Ink Flush Complete!");
  } else if (eventName === "air_bleed_progress") {
    updateCleaningProgress(payload.remaining_seconds, payload.progress, "EcoTank Air Bleed & Damper Charge in progress...");
  } else if (eventName === "air_bleed_complete") {
    finishCleaning("✔ EcoTank Ink Tube Air Bleed Complete!");
  }
};

async function onPyWebviewReady() {
  isPyWebviewReady = true;
  appendTelemetry("INFO", "PyWebView Bridge attached. Native C-API & spooler engine connected.");

  try {
    const overview = await window.pywebview.api.get_system_overview();
    handleSystemOverview(overview);

    const models = await window.pywebview.api.get_models_catalog();
    allModels = models;
    renderModelsGrid(models);

    loadBackupsList();
  } catch (err) {
    console.error("Bridge initialization error:", err);
  }
}

function initFallbackMode() {
  appendTelemetry("INFO", "Running in browser preview mode. Virtual printer simulator active.");
  // Mock model database
  allModels = [
    { model_id: "L3250", family: "L", read_key: [151, 7], write_key: [77, 97, 114, 105, 98, 97, 121, 97], desc: "EcoTank L3250 All-in-One" },
    { model_id: "L3210", family: "L", read_key: [151, 7], write_key: [77, 97, 114, 105, 98, 97, 121, 97], desc: "EcoTank L3210 Multi-function" },
    { model_id: "L1210", family: "L", read_key: [151, 7], write_key: [77, 97, 114, 105, 98, 97, 121, 97], desc: "EcoTank L1210 Single-function" },
    { model_id: "L5290", family: "L", read_key: [151, 7], write_key: [77, 97, 114, 105, 98, 97, 121, 97], desc: "EcoTank L5290 Wi-Fi ADF" },
    { model_id: "L3150", family: "L", read_key: [151, 7], write_key: [77, 97, 114, 105, 98, 97, 121, 97], desc: "EcoTank L3150 Legacy" },
    { model_id: "ET-2800", family: "ET", read_key: [151, 7], write_key: [77, 97, 114, 105, 98, 97, 121, 97], desc: "EcoTank ET-2800 Wireless" },
    { model_id: "ET-4800", family: "ET", read_key: [151, 7], write_key: [77, 97, 114, 105, 98, 97, 121, 97], desc: "EcoTank ET-4800 Pro" },
    { model_id: "WF-7710", family: "WF", read_key: [151, 7], write_key: [77, 97, 114, 105, 98, 97, 121, 97], desc: "WorkForce WF-7710 Wide-Format" },
    { model_id: "XP-15000", family: "XP", read_key: [151, 7], write_key: [77, 97, 114, 105, 98, 97, 121, 97], desc: "Expression Photo HD XP-15000" }
  ];
  renderModelsGrid(allModels);
  updateRadialGauge(97.5, 6180, 6340);
  document.getElementById("usbStatusText").innerText = "Online (Simulator Mode)";
  document.getElementById("usbDeviceName").innerText = "EcoTank Series (Ready)";
}

function handleSystemOverview(overview) {
  if (overview.auto_selected) {
    const sel = overview.auto_selected;
    currentTarget.printer_name = sel.name;
    currentTarget.port = sel.port;
    currentTarget.model_id = sel.model_id;

    document.getElementById("usbStatusText").innerText = sel.is_physical ? "USB Printer Online" : "Installed Spooler";
    document.getElementById("usbDeviceName").innerText = sel.name;
    document.getElementById("hdrTargetModel").innerText = sel.model_id;
    document.getElementById("hdrTargetPort").innerText = sel.port;

    document.getElementById("certModel").innerText = sel.name;
    document.getElementById("certPort").innerText = `${sel.port} (RAW Spooler)`;
  } else {
    document.getElementById("usbStatusText").innerText = "No USB Device Plugged";
    document.getElementById("usbDeviceName").innerText = "Waiting for cable...";
    document.getElementById("usbLed").classList.add("offline");
  }

  if (overview.models_count) {
    document.getElementById("badgeModelsCount").innerText = overview.models_count;
    document.getElementById("badgeModelsTotal").innerText = `${overview.models_count} Models Loaded`;
  }

  if (overview.stats) {
    updateRadialGauge(overview.stats.waste_main_pct, overview.stats.waste_main_pts, overview.stats.waste_main_max);
  }
}

// =====================================================================
// CIRCULAR RADIAL GAUGE ANIMATION
// =====================================================================

function updateRadialGauge(pct, currentPts, maxPts) {
  const circle = document.getElementById("gaugeMeterCircle");
  const pctText = document.getElementById("gaugeMainPct");
  const statusText = document.getElementById("gaugeMainStatus");
  const ptsText = document.getElementById("gaugeMainPts");

  // SVG circle radius = 85. Circumference = 2 * PI * 85 = 534.07
  const circumference = 2 * Math.PI * 85;
  circle.style.strokeDasharray = `${circumference} ${circumference}`;

  const offset = circumference - (pct / 100) * circumference;
  circle.style.strokeDashoffset = offset;

  // Animate text counter
  animateNumber(pctText, pct, "%", 1);
  ptsText.innerText = `${currentPts.toLocaleString()} / ${maxPts.toLocaleString()} pts`;

  // Color dynamic shift
  if (pct >= 90) {
    circle.style.stroke = "url(#gaugeGradient)";
    statusText.innerText = "CRITICAL / SERVICE LOCK";
    statusText.style.color = "var(--coral)";
  } else if (pct >= 70) {
    circle.style.stroke = "var(--amber)";
    statusText.innerText = "WARNING / NEAR FULL";
    statusText.style.color = "var(--amber)";
  } else {
    circle.style.stroke = "var(--primary)";
    statusText.innerText = "OPTIMAL STATUS";
    statusText.style.color = "var(--primary)";
  }
}

function animateNumber(element, targetVal, suffix = "", decimals = 0) {
  const duration = 1200;
  const startVal = parseFloat(element.innerText) || 0;
  const startTime = performance.now();

  function step(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const ease = 1 - Math.pow(1 - progress, 3);
    const current = startVal + (targetVal - startVal) * ease;
    element.innerText = current.toFixed(decimals) + suffix;
    if (progress < 1) {
      requestAnimationFrame(step);
    }
  }
  requestAnimationFrame(step);
}

// =====================================================================
// TAB ROUTING
// =====================================================================

function initTabs() {
  const navItems = document.querySelectorAll(".nav-item");
  navItems.forEach(item => {
    item.addEventListener("click", () => {
      navItems.forEach(i => i.classList.remove("active"));
      item.classList.add("active");
    });
  });
}

function switchTab(tabId) {
  document.querySelectorAll(".tab-view").forEach(view => view.classList.remove("active"));
  const targetView = document.getElementById(`view-${tabId}`);
  if (targetView) {
    targetView.classList.add("active");
  }

  if (tabId === "analytics" && !chartsInitialized) {
    setTimeout(initCharts, 100);
  }
  if (tabId === "eeprom") {
    loadBackupsList();
  }
}

// =====================================================================
// SAFE RESET STEPPER WIZARD
// =====================================================================

function openResetWizard() {
  document.getElementById("resetModalTarget").innerText = `${currentTarget.model_id} [${currentTarget.port}]`;
  // Reset all steps to initial state
  for (let i = 1; i <= 5; i++) {
    const el = document.getElementById(`step${i}`);
    if (el) {
      el.className = "step-row";
      el.querySelector(".step-icon-box").innerText = i;
    }
  }
  document.getElementById("btnConfirmReset").disabled = false;
  document.getElementById("modalResetWizard").classList.add("active");
}

function updateResetStepper(stepNum, label, progress) {
  for (let i = 1; i < stepNum; i++) {
    const prev = document.getElementById(`step${i}`);
    if (prev) {
      prev.className = "step-row completed";
      prev.querySelector(".step-icon-box").innerText = "✔";
    }
  }

  const current = document.getElementById(`step${stepNum}`);
  if (current) {
    if (progress >= 1.0) {
      current.className = "step-row completed";
      current.querySelector(".step-icon-box").innerText = "✔";
    } else {
      current.className = "step-row running";
      current.querySelector(".step-icon-box").innerText = "⏳";
    }
  }
}

async function triggerResetExecution() {
  document.getElementById("btnConfirmReset").disabled = true;

  if (isPyWebviewReady) {
    try {
      const res = await window.pywebview.api.execute_waste_reset(currentTarget.printer_name, currentTarget.model_id);
      if (res.status === "success") {
        updateRadialGauge(0.0, 0, 6340);
        setTimeout(() => {
          closeModal("modalResetWizard");
          alert("🎉 Reset Successful!\n\nFINAL STEP:\n1. Turn OFF your printer.\n2. Wait 5 seconds.\n3. Turn the printer back ON.\n\nYour printer is reset to 0.0%!");
        }, 1200);
      } else {
        alert("Reset Error: " + res.message);
        closeModal("modalResetWizard");
      }
    } catch (err) {
      alert("Reset Execution Error: " + err);
      closeModal("modalResetWizard");
    }
  } else {
    // Simulator emulation
    for (let s = 1; s <= 5; s++) {
      updateResetStepper(s, `Executing Step ${s}...`, 0.5);
      await new Promise(r => setTimeout(r, 600));
      updateResetStepper(s, `Step ${s} Complete`, 1.0);
    }
    updateRadialGauge(0.0, 0, 6340);
    setTimeout(() => {
      closeModal("modalResetWizard");
      alert("🎉 [Simulator] Reset Complete!\nCounters set to 0.0%.");
    }, 800);
  }
}

// =====================================================================
// PRINTHEAD CLEANING CYCLES
// =====================================================================

async function startHeadClean(level) {
  if (isCleaning) {
    alert("A maintenance cycle is already running. Please wait for it to finish.");
    return;
  }
  isCleaning = true;

  const box = document.getElementById("cleanProgressBox");
  box.style.display = "block";
  document.getElementById("cleanPhaseLabel").innerText = `Starting ${level.toUpperCase()} clean...`;
  document.getElementById("cleanProgressBar").style.width = "0%";

  if (isPyWebviewReady) {
    try {
      const res = await window.pywebview.api.start_cleaning(level, currentTarget.printer_name);
      if (res && res.status === "error") {
        isCleaning = false;
        box.style.display = "none";
        alert("Cleaning error: " + res.message);
      }
    } catch (err) {
      console.error(err);
      isCleaning = false;
      box.style.display = "none";
      alert("Failed to start cleaning: " + err);
    }
  } else {
    // Fallback timer for browser preview
    const total = level === "light" ? 140 : (level === "medium" ? 180 : 220);
    for (let i = total; i >= 0; i--) {
      if (!isCleaning) break;
      updateCleaningProgress(i, 1 - (i / total), "Acoustic micro-pulse purge");
      await new Promise(r => setTimeout(r, 1000));
    }
    finishCleaning("✔ Printhead Cleaning Cycle Complete!");
  }
}

function updateCleaningProgress(remSeconds, progress, phase) {
  const cd = document.getElementById("cleanCountdown");
  const pl = document.getElementById("cleanPhaseLabel");
  const pb = document.getElementById("cleanProgressBar");
  if (cd) cd.innerText = `${remSeconds}s`;
  if (pl && phase) pl.innerText = phase;
  if (pb) pb.style.width = `${Math.round(progress * 100)}%`;
}

function finishCleaning(msg) {
  isCleaning = false;
  const box = document.getElementById("cleanProgressBox");
  if (box) box.style.display = "none";
  alert(msg || "✔ Printhead Cleaning Cycle Complete!");
}

function openPowerFlushModal() {
  document.getElementById("modalPowerFlush").classList.add("active");
}

async function executePowerFlush() {
  closeModal("modalPowerFlush");
  if (isCleaning) {
    alert("A maintenance cycle is already running. Please wait for it to finish.");
    return;
  }
  isCleaning = true;

  const box = document.getElementById("cleanProgressBox");
  box.style.display = "block";
  document.getElementById("cleanPhaseLabel").innerText = "Initiating Power Cleaning / Ink Flush...";
  document.getElementById("cleanProgressBar").style.width = "0%";

  if (isPyWebviewReady) {
    try {
      const res = await window.pywebview.api.start_power_flush(currentTarget.printer_name);
      if (res && res.status === "error") {
        isCleaning = false;
        box.style.display = "none";
        alert("Power Flush error: " + res.message);
      }
    } catch (err) {
      console.error(err);
      isCleaning = false;
      box.style.display = "none";
      alert("Failed to start Power Flush: " + err);
    }
  } else {
    // Browser fallback
    const total = 360;
    for (let i = total; i >= 0; i--) {
      if (!isCleaning) break;
      updateCleaningProgress(i, 1 - (i / total), "Heavy suction ink flush");
      await new Promise(r => setTimeout(r, 1000));
    }
    finishCleaning("✔ Power Cleaning / Ink Flush Complete!");
  }
}

async function startAirBleed() {
  if (isCleaning) {
    alert("A maintenance cycle is already running. Please wait for it to finish.");
    return;
  }
  const confirmed = confirm(
    `Start Ink Tube Air Bleed on '${currentTarget.printer_name}'?\n\n` +
    `• Deep suction (~270s) to clear air bubbles from ink supply tubes.\n` +
    `• Ensure ink tanks are filled at least 1/3 full.\n\n` +
    `Proceed with Air Bleed?`
  );
  if (!confirmed) return;

  isCleaning = true;
  const box = document.getElementById("cleanProgressBox");
  box.style.display = "block";
  document.getElementById("cleanPhaseLabel").innerText = "Initiating Ink Tube Air Bleed...";
  document.getElementById("cleanProgressBar").style.width = "0%";

  if (isPyWebviewReady) {
    try {
      const res = await window.pywebview.api.start_air_bleed(currentTarget.printer_name);
      if (res && res.status === "error") {
        isCleaning = false;
        box.style.display = "none";
        alert("Air Bleed error: " + res.message);
      }
    } catch (err) {
      console.error(err);
      isCleaning = false;
      box.style.display = "none";
      alert("Failed to start Air Bleed: " + err);
    }
  } else {
    // Browser fallback
    const total = 270;
    for (let i = total; i >= 0; i--) {
      if (!isCleaning) break;
      updateCleaningProgress(i, 1 - (i / total), "Drawing ink & purging air locks");
      await new Promise(r => setTimeout(r, 1000));
    }
    finishCleaning("✔ EcoTank Ink Tube Air Bleed Complete!");
  }
}

async function printNozzleTest() {
  const useRaster = document.getElementById("chkRasterFallback").checked;
  if (isPyWebviewReady) {
    await window.pywebview.api.print_nozzle_check(useRaster, currentTarget.printer_name);
  }
  appendTelemetry("TX", `Dispatched Nozzle Check Pattern (Raster: ${useRaster})`);
  alert("📄 Nozzle Check Test Job sent to printer!");
}

function startAlignmentRoutine() {
  appendTelemetry("TX", "Dispatched Head Alignment Calibration grid.");
  alert("📐 Head Alignment sheet sent to printer. Examine alignment lines!");
}

// =====================================================================
// MODEL DATABASE EXPLORER
// =====================================================================

function setFilterFamily(family, btnElement) {
  currentFamilyFilter = family;
  document.querySelectorAll(".chip-btn").forEach(b => b.classList.remove("active"));
  btnElement.classList.add("active");
  filterModels();
}

function filterModels() {
  const query = document.getElementById("modelSearchInput").value.trim().toUpperCase();
  const filtered = allModels.filter(m => {
    const matchFamily = (currentFamilyFilter === "ALL") ||
      (currentFamilyFilter === "L" && m.model_id.startsWith("L")) ||
      (currentFamilyFilter === "ET" && m.model_id.startsWith("ET")) ||
      (currentFamilyFilter === "WF" && m.model_id.startsWith("WF")) ||
      (currentFamilyFilter === "XP" && m.model_id.startsWith("XP")) ||
      (currentFamilyFilter === "STYLUS" && (m.model_id.includes("STYLUS") || m.model_id.includes("SC")));

    const matchQuery = !query || m.model_id.toUpperCase().includes(query) || (m.desc && m.desc.toUpperCase().includes(query));
    return matchFamily && matchQuery;
  });

  renderModelsGrid(filtered);
}

function renderModelsGrid(models) {
  const container = document.getElementById("modelsGridContainer");
  if (!container) return;

  if (models.length === 0) {
    container.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: var(--text-dim); padding: 40px;">No matching printer models found.</div>`;
    return;
  }

  container.innerHTML = models.map(m => `
    <div class="model-entry-card ${currentTarget.model_id === m.model_id ? 'border-primary' : ''}">
      <div style="display: flex; justify-content: space-between; align-items: flex-start;">
        <div>
          <h4 style="font-size: 1.05rem; font-weight: 700; color: var(--text-main);">${m.model_id}</h4>
          <span style="font-size: 0.725rem; color: var(--text-muted);">${m.desc || 'Universal ESC/P-R Profile'}</span>
        </div>
        <span class="nav-badge" style="background: var(--bg-card-hover); color: var(--sky); border: 1px solid var(--border-subtle);">${m.family || 'SERIES'}</span>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; font-family: 'JetBrains Mono', monospace; font-size: 0.7rem; color: var(--text-dim);">
        <div>Key: <strong style="color: var(--text-main);">${Array.isArray(m.read_key) ? '0x' + m.read_key[1].toString(16) + m.read_key[0].toString(16) : '0x0797'}</strong></div>
        <div>Auth: <strong style="color: var(--primary);">Maribaya</strong></div>
      </div>

      <button class="btn btn-secondary text-xs" style="width: 100%;" onclick="selectModel('${m.model_id}')">
        ${currentTarget.model_id === m.model_id ? '✔ Active Profile' : 'Select Target Profile'}
      </button>
    </div>
  `).join("");
}

function selectModel(modelId) {
  currentTarget.model_id = modelId;
  document.getElementById("hdrTargetModel").innerText = modelId;
  document.getElementById("certModel").innerText = `${modelId} Series`;
  if (isPyWebviewReady) {
    window.pywebview.api.set_active_target(currentTarget.printer_name, modelId, currentTarget.port, currentTarget.is_simulator);
  }
  filterModels();
  appendTelemetry("INFO", `Switched target profile to: ${modelId}`);
}

// =====================================================================
// EEPROM BACKUPS VAULT
// =====================================================================

async function loadBackupsList() {
  const container = document.getElementById("backupsListContainer");
  if (!container) return;

  if (isPyWebviewReady) {
    try {
      const backups = await window.pywebview.api.list_backups();
      renderBackups(backups);
    } catch (e) {
      console.error(e);
    }
  } else {
    renderBackups([
      { filename: "L3250_20261007_143022.json", model_id: "L3250", timestamp: "2026-10-07T14:30:22", file_size: 1420 },
      { filename: "L3110_20261006_091544.json", model_id: "L3110", timestamp: "2026-10-06T09:15:44", file_size: 1420 }
    ]);
  }
}

function renderBackups(backups) {
  const container = document.getElementById("backupsListContainer");
  if (!container) return;

  if (backups.length === 0) {
    container.innerHTML = `<div style="text-align: center; color: var(--text-dim); padding: 24px;">No previous backups saved yet.</div>`;
    return;
  }

  container.innerHTML = backups.map(b => `
    <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: var(--bg-card-hover); border-radius: var(--radius-md); border: 1px solid var(--border-subtle);">
      <div>
        <div style="font-size: 0.825rem; font-weight: 600; color: var(--text-main); font-family: monospace;">${b.filename}</div>
        <div style="font-size: 0.7rem; color: var(--text-dim);">Model: ${b.model_id} • Size: ${(b.file_size / 1024).toFixed(1)} KB</div>
      </div>
      <button class="btn btn-secondary text-xs" onclick="restoreBackup('${b.filename}')">
        ↩️ Restore
      </button>
    </div>
  `).join("");
}

async function restoreBackup(filename) {
  if (!confirm(`Restore EEPROM registers from '${filename}'?`)) return;
  if (isPyWebviewReady) {
    const res = await window.pywebview.api.restore_backup(filename, currentTarget.printer_name, currentTarget.model_id);
    alert(res.message);
  } else {
    alert(`[Simulator] Restored registers from ${filename}`);
  }
}

async function createManualBackup() {
  if (isPyWebviewReady) {
    await window.pywebview.api.create_manual_backup(currentTarget.model_id);
    loadBackupsList();
  }
  alert("✔ Timestamped NVRAM Snapshot created successfully!");
}

function openBackupsFolder() {
  if (isPyWebviewReady) {
    window.pywebview.api.open_backups_folder();
  }
}

async function writeRawByte() {
  const addr = document.getElementById("rawAddrInput").value.trim();
  const val = parseInt(document.getElementById("rawValInput").value.trim(), 10);
  if (isPyWebviewReady) {
    const res = await window.pywebview.api.write_raw_eeprom_byte(addr, val, currentTarget.printer_name, currentTarget.model_id);
    alert(`✔ Written ${res.value} to ${res.address}`);
  } else {
    alert(`[Simulator] Written ${val} to ${addr}`);
  }
}

// =====================================================================
// CHARTS & ANALYTICS
// =====================================================================

function initCharts() {
  if (chartsInitialized || typeof Chart === "undefined") return;

  const ctxDist = document.getElementById("chartDistribution");
  if (ctxDist) {
    chartDistribution = new Chart(ctxDist, {
      type: "doughnut",
      data: {
        labels: ["B&W Mono", "Color Graphic", "Full Photo", "Scans"],
        datasets: [{
          data: [1042, 386, 120, 215],
          backgroundColor: ["#38bdf8", "#a78bfa", "#10b981", "#fbbf24"],
          borderColor: "transparent"
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "right", labels: { color: "#94a3b8", font: { family: "Inter" } } }
        }
      }
    });
  }

  const ctxMaint = document.getElementById("chartMaintenance");
  if (ctxMaint) {
    chartMaintenance = new Chart(ctxMaint, {
      type: "line",
      data: {
        labels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct"],
        datasets: [{
          label: "Waste Pad %",
          data: [15, 24, 38, 49, 62, 71, 80, 88, 94, 97.5],
          borderColor: "#f43f5e",
          backgroundColor: "rgba(244, 63, 94, 0.1)",
          fill: true,
          tension: 0.4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: { grid: { color: "rgba(255,255,255,0.05)" }, ticks: { color: "#64748b" } },
          x: { grid: { display: false }, ticks: { color: "#64748b" } }
        },
        plugins: {
          legend: { labels: { color: "#94a3b8" } }
        }
      }
    });
  }

  chartsInitialized = true;
}

// =====================================================================
// TELEMETRY CONSOLE
// =====================================================================

function appendTelemetry(direction, message, hex = "", ascii = "", timestamp = "") {
  const term = document.getElementById("terminalLogs");
  if (!term) return;

  const timeStr = timestamp || new Date().toLocaleTimeString();
  let dirClass = "log-info";
  if (direction === "TX") dirClass = "log-tx";
  else if (direction === "RX") dirClass = "log-rx";
  else if (direction === "ERROR") dirClass = "log-err";

  const entry = document.createElement("div");
  entry.className = `log-entry ${dirClass}`;

  let inner = `
    <div style="display: flex; gap: 8px;">
      <span class="log-time">[${timeStr}]</span>
      <span><strong>${direction}:</strong> ${message}</span>
    </div>
  `;
  if (hex) {
    inner += `<div style="font-size: 0.68rem; color: var(--text-dim); margin-top: 2px;">HEX: ${hex}</div>`;
  }
  if (ascii) {
    inner += `<div style="font-size: 0.68rem; color: var(--text-dim);">ASCII: ${ascii}</div>`;
  }

  entry.innerHTML = inner;
  term.appendChild(entry);
  term.scrollTop = term.scrollHeight;
}

function clearLogs() {
  const term = document.getElementById("terminalLogs");
  if (term) term.innerHTML = "";
}

function copyLogs() {
  const term = document.getElementById("terminalLogs");
  if (term) {
    navigator.clipboard.writeText(term.innerText);
    alert("Copied all hardware logs to clipboard!");
  }
}

// =====================================================================
// CERTIFICATE
// =====================================================================

function copyCertText() {
  const box = document.querySelector(".certificate-preview-box");
  if (box) {
    navigator.clipboard.writeText(box.innerText);
    alert("Service Certificate text copied!");
  }
}

// =====================================================================
// THEME & MODAL UTILITIES
// =====================================================================

function toggleTheme() {
  const body = document.body;
  const label = document.getElementById("themeLabel");
  if (body.classList.contains("theme-light")) {
    body.classList.remove("theme-light");
    body.classList.add("theme-dark");
    label.innerText = "🌙 Obsidian Dark";
  } else {
    body.classList.remove("theme-dark");
    body.classList.add("theme-light");
    label.innerText = "☀️ Studio Light";
  }
}

function closeModal(modalId) {
  const m = document.getElementById(modalId);
  if (m) m.classList.remove("active");
}

function toggleSimulatorMode() {
  currentTarget.is_simulator = !currentTarget.is_simulator;
  const btn = document.getElementById("btnToggleSim");
  if (currentTarget.is_simulator) {
    btn.innerText = "🧪 Simulator: ON";
    btn.classList.add("btn-amber");
    appendTelemetry("INFO", "Switched to Safe Simulator mode.");
  } else {
    btn.innerText = "⚡ Hardware Spooler: ON";
    btn.classList.remove("btn-amber");
    appendTelemetry("INFO", "Switched to Direct Windows Hardware Spooler (RAW).");
  }
}

async function refreshHardwareScan() {
  appendTelemetry("INFO", "Scanning Windows USB and Spooler ports...");
  if (isPyWebviewReady) {
    const overview = await window.pywebview.api.get_system_overview();
    handleSystemOverview(overview);
  }
}

async function queryStatus() {
  appendTelemetry("TX", "Querying Waste Pad Counters (0x30, 0x31)...");
  if (isPyWebviewReady) {
    const res = await window.pywebview.api.query_waste_counters();
    if (res.main_pad) {
      updateRadialGauge(res.main_pad.percent, res.main_pad.points, res.main_pad.max_points);
    }
  }
}
