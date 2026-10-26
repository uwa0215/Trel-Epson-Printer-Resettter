/**
 * Trel- Epson Universal Maintenance Tool - Electron Native Desktop Main Process
 * Creates a dedicated, high-performance standalone Windows application window.
 */

const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');

let mainWindow = null;
let serverInstance = null;
const SERVER_PORT = parseInt(process.env.PORT, 10) || 3000;

// Set unique app name & isolated user data path to avoid collision with other Electron apps
app.setName('TrelEpsonUniversalTool');
app.setPath('userData', path.join(app.getPath('appData'), 'TrelEpsonUniversalTool'));

// Single-instance lock: ensure only one desktop window instance runs at a time
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  console.log('[Electron] Another instance is already running. Quitting.');
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(createWindow);
}

function checkEpsonServer(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/api/health`, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.app === 'epson-universal-tool');
        } catch {
          resolve(false);
        }
      });
    });
    req.on('error', () => resolve(false));
    req.setTimeout(800, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function startBackendServer() {
  // 1. Fast check: is our engine already active on the preferred port?
  const alreadyRunning = await checkEpsonServer(SERVER_PORT);
  if (alreadyRunning) {
    console.log(`[Electron] Connected to existing active engine on port ${SERVER_PORT}`);
    return SERVER_PORT;
  }

  // 2. Start internal Node.js maintenance engine cleanly
  console.log('[Electron] Starting internal Node.js maintenance engine...');
  process.env.NO_AUTO_OPEN = 'true';
  const backend = require('../server/index.js');
  try {
    const result = await backend.startServer(SERVER_PORT);
    serverInstance = result.server;
    return result.port;
  } catch (err) {
    console.error('[Electron] Failed to start backend server:', err);
    // If startServer encountered an issue, double check if server is active
    if (await checkEpsonServer(SERVER_PORT)) {
      return SERVER_PORT;
    }
    throw err;
  }
}

async function createWindow() {
  try {
    const activePort = await startBackendServer();

    const iconPng = path.join(__dirname, '..', 'Logo.png');
    const iconIco = path.join(__dirname, '..', 'app_icon.ico');
    const iconPath = fs.existsSync(iconPng) ? iconPng : iconIco;

    mainWindow = new BrowserWindow({
      width: 1280,
      height: 840,
      minWidth: 360,
      minHeight: 500,
      title: 'Trel- Epson Universal Maintenance Tool',
      backgroundColor: '#0a0d14',
      icon: iconPath,
      show: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    // Sleek borderless/modern menu
    Menu.setApplicationMenu(null);

    mainWindow.loadURL(`http://127.0.0.1:${activePort}`);

    mainWindow.once('ready-to-show', () => {
      mainWindow.show();
      mainWindow.focus();
    });

    mainWindow.on('closed', () => {
      mainWindow = null;
    });
  } catch (err) {
    console.error('[Electron] Error creating window:', err);
  }
}

app.on('window-all-closed', () => {
  if (serverInstance) {
    try {
      serverInstance.close();
    } catch (e) {}
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

