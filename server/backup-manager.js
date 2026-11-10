/**
 * NVRAM EEPROM Backup Vault & Rollback Manager
 * Creates cryptographic timestamped .json and .bin dumps before any EEPROM write
 */

const fs = require('fs');
const path = require('path');

class BackupManager {
  constructor(backupDir) {
    if (backupDir) {
      this.backupDir = backupDir;
    } else if (process.env.APPDATA) {
      const preferred = path.join(process.env.APPDATA, 'TrelUniversalTool', 'backups');
      const legacy = path.join(process.env.APPDATA, 'TrelEpsonUniversalTool', 'backups');
      this.backupDir = fs.existsSync(legacy) && !fs.existsSync(preferred) ? legacy : preferred;
    } else {
      this.backupDir = path.join(process.cwd(), 'backups');
    }
    if (!fs.existsSync(this.backupDir)) {
      try {
        fs.mkdirSync(this.backupDir, { recursive: true });
      } catch (e) {
        this.backupDir = path.join(process.cwd(), 'backups');
        if (!fs.existsSync(this.backupDir)) {
          fs.mkdirSync(this.backupDir, { recursive: true });
        }
      }
    }
  }

  /**
   * Generates timestamp string: YYYYMMDD_HHMMSS
   */
  getTimestamp() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  }

  /**
   * Creates a backup (.json + .bin)
   */
  createBackup(modelId, registersHexMap, notes = 'Pre-Reset Automatic Vault Backup') {
    const timestamp = this.getTimestamp();
    const cleanModel = (modelId || 'Universal').replace(/[^a-zA-Z0-9_-]/g, '_');
    const baseName = `backup_${cleanModel}_${timestamp}`;

    const jsonPath = path.join(this.backupDir, `${baseName}.json`);
    const binPath = path.join(this.backupDir, `${baseName}.bin`);

    // Create 512-byte EEPROM image
    const binBuffer = Buffer.alloc(512, 0xff);
    for (const [addrStr, val] of Object.entries(registersHexMap)) {
      const addr = typeof addrStr === 'string' && addrStr.startsWith('0x')
        ? parseInt(addrStr, 16)
        : parseInt(addrStr, 10);
      if (addr >= 0 && addr < 512) {
        binBuffer[addr] = typeof val === 'string' && val.startsWith('0x')
          ? parseInt(val, 16)
          : parseInt(val, 10) & 0xff;
      }
    }

    fs.writeFileSync(binPath, binBuffer);

    const metadata = {
      model_id: modelId,
      timestamp: new Date().toISOString(),
      formatted_time: new Date().toLocaleString(),
      notes: notes,
      bin_file: path.basename(binPath),
      registers_count: Object.keys(registersHexMap).length,
      address_hex_map: registersHexMap
    };

    fs.writeFileSync(jsonPath, JSON.stringify(metadata, null, 2), 'utf8');

    return {
      status: 'ok',
      base_name: baseName,
      json_path: jsonPath,
      bin_path: binPath,
      filename: `${baseName}.json`,
      metadata
    };
  }

  /**
   * Lists all saved backups
   */
  listBackups() {
    if (!fs.existsSync(this.backupDir)) return [];
    const files = fs.readdirSync(this.backupDir);
    const results = [];

    for (const file of files) {
      if (file.endsWith('.json')) {
        const fullPath = path.join(this.backupDir, file);
        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          const data = JSON.parse(content);
          const stat = fs.statSync(fullPath);
          results.push({
            filename: file,
            model_id: data.model_id || 'Unknown',
            timestamp: data.timestamp || stat.mtime.toISOString(),
            formatted_time: data.formatted_time || stat.mtime.toLocaleString(),
            notes: data.notes || '',
            bin_file: data.bin_file || '',
            file_size: stat.size,
            registers_count: data.registers_count || Object.keys(data.address_hex_map || {}).length
          });
        } catch (e) {
          // Ignore corrupt backup files
        }
      }
    }

    return results.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }

  /**
   * Reads a backup file content (sanitized against path traversal)
   */
  getBackup(filename) {
    if (!filename) return null;
    const safeName = path.basename(String(filename));
    const fullPath = path.join(this.backupDir, safeName);
    if (!fs.existsSync(fullPath)) return null;
    return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  }

  /**
   * Resolves path to binary (.bin) or JSON (.json) backup file for download
   */
  getBackupFilePath(filename) {
    if (!filename) return null;
    const safeName = path.basename(String(filename));
    const fullPath = path.join(this.backupDir, safeName);
    if (!fs.existsSync(fullPath)) return null;
    return fullPath;
  }

  /**
   * Deletes a backup (.json and associated .bin)
   */
  deleteBackup(filename) {
    if (!filename) return { status: 'error', message: 'Filename is required.' };
    const safeName = path.basename(String(filename));
    const jsonPath = path.join(this.backupDir, safeName);
    if (!fs.existsSync(jsonPath)) {
      return { status: 'error', message: 'Backup file not found.' };
    }
    try {
      const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      if (data && data.bin_file) {
        const binPath = path.join(this.backupDir, path.basename(String(data.bin_file)));
        if (fs.existsSync(binPath)) fs.unlinkSync(binPath);
      }
    } catch (e) {}
    fs.unlinkSync(jsonPath);
    return { status: 'ok', deleted: safeName };
  }

  /**
   * Imports a backup JSON payload into the NVRAM Vault
   */
  importBackup(payload) {
    if (!payload || typeof payload !== 'object' || !payload.address_hex_map) {
      return { status: 'error', message: 'Invalid backup payload: missing address_hex_map.' };
    }
    const modelId = payload.model_id || 'Universal';
    const notes = payload.notes ? `${payload.notes} (Imported)` : 'Imported Community Backup Snapshot';
    return this.createBackup(modelId, payload.address_hex_map, notes);
  }
}

module.exports = new BackupManager();
