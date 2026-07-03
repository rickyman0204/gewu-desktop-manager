const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell, screen, dialog, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile, execFileSync } = require('child_process');

app.commandLine.appendSwitch('high-dpi-support', '1');
app.commandLine.appendSwitch('force-device-scale-factor', '1');

const DATA_FILE = path.join(app.getPath('userData'), 'zones.json');
const DESKTOP_PATH = app.getPath('desktop');
const resizingZones = new Set();
const ZONES_ROOT = path.join(app.getPath('userData'), 'zone-data');

const COLOR_THEMES = {
  chinese: {
    name: '中国传统色', icon: '🏮',
    colors: ['#B22222','#CD5C5C','#E9967A','#DB7093','#C71585','#8B0000','#A52A2A','#D2691E','#DAA520','#B8860B','#556B2F','#6B8E23','#8FBC8F','#2E8B57','#228B22','#4682B4','#5F9EA0','#6495ED','#4169E1','#0000CD','#483D8B','#6A5ACD','#7B68EE','#9370DB','#8A2BE2']
  },
  cyberpunk: {
    name: '赛博朋克霓虹', icon: '🤖',
    colors: ['#FF00FF','#FF1493','#FF4500','#FF6347','#FF69B4','#00FFFF','#00CED1','#00BFFF','#1E90FF','#0080FF','#ADFF2F','#7FFF00','#00FF7F','#39FF14','#00FF00','#FFD700','#FFA500','#FF8C00','#FF6600','#FF3300','#E0FFFF','#B0E0E6','#87CEEB','#ADD8E6','#B0C4DE']
  },
  macaron: {
    name: '马卡龙色', icon: '🧁',
    colors: ['#FFB3BA','#FFC2CC','#FFD1DC','#E8A0BF','#D4A5A5','#BAE1FF','#B5EAD7','#C7CEEA','#E2F0CB','#FFDAC1','#FF9AA2','#FFB7B2','#FFDFD3','#B5EAD7','#C7CEEA','#FFD1DC','#FFE0AC','#E2F0CB','#B5EAD7','#C7CEEA','#FF9AA2','#FFB7B2','#FFDFD3','#FFDAC1','#FFD1DC']
  },
  nordic: {
    name: '北欧极简', icon: '🏔',
    colors: ['#2C3E50','#34495E','#7F8C8D','#95A5A6','#BDC3C7','#ECF0F1','#D5DBDB','#AEB6BF','#85929E','#5D6D7E','#1C2833','#212F3D','#2C3E50','#34495E','#566573','#1A5276','#1F618D','#2471A3','#2E86C1','#5499C7','#1E8449','#239B56','#28B463','#2ECC71','#58D68D']
  },
  earth: {
    name: '大地色系', icon: '🌍',
    colors: ['#8B4513','#A0522D','#CD853F','#D2B48C','#DEB887','#F4A460','#D2691E','#B8860B','#DAA520','#C0C0C0','#556B2F','#6B8E23','#808000','#9ACD32','#9E9E3E','#8B7355','#A0826D','#C4A882','#D2B48C','#CDB79E','#696969','#778899','#708090','#2F4F4F','#36454F']
  },
  memphis: {
    name: '孟菲斯撞色', icon: '🎪',
    colors: ['#FF6B6B','#FF8E8E','#FF4757','#FF3838','#FF6348','#4ECDC4','#45B7AF','#2ED8A3','#1DD1A1','#10AC84','#FFE66D','#FFC312','#F79F1F','#FFA502','#FF7F50','#A29BFE','#6C5CE7','#5F3DC4','#4834D4','#30336B','#FD79A8','#E84393','#D63031','#E17055','#FDCB6E']
  }
};

const ZONE_COLORS = COLOR_THEMES.nordic.colors;

const ICON_EXE = path.join(__dirname, 'icon-extractor.exe');
const ICON_CS = path.join(__dirname, 'icon-extractor.cs');
let iconExtractorReady = false;

const iconCache = new Map();
const ICON_CACHE_MAX = 200;

function findCsc() {
  const fwDir = 'C:\\Windows\\Microsoft.NET\\Framework64';
  try {
    const versions = fs.readdirSync(fwDir).filter(v => v.startsWith('v4'));
    if (versions.length === 0) return null;
    versions.sort();
    return path.join(fwDir, versions[versions.length - 1], 'csc.exe');
  } catch (e) { return null; }
}

function compileIconExtractor() {
  if (fs.existsSync(ICON_EXE)) { iconExtractorReady = true; return; }
  if (!fs.existsSync(ICON_CS)) return;
  const csc = findCsc();
  if (!csc) { console.log('[ICON] csc.exe not found, skip native extractor'); return; }
  try {
    execFileSync(csc, ['/nologo', '/optimize', '/target:exe', '/reference:System.Drawing.dll', `/out:${ICON_EXE}`, ICON_CS], { timeout: 30000 });
    iconExtractorReady = fs.existsSync(ICON_EXE);
    console.log('[ICON] Native extractor compiled:', iconExtractorReady);
  } catch (e) { console.error('[ICON] Compile failed:', e.message); }
}

function trimIconCache() {
  if (iconCache.size <= ICON_CACHE_MAX) return;
  const keys = [...iconCache.keys()];
  const removeCount = keys.length - ICON_CACHE_MAX + 50;
  for (let i = 0; i < removeCount; i++) {
    iconCache.delete(keys[i]);
  }
}

function extractIconNative(filePath) {
  if (!iconExtractorReady) return null;
  if (iconCache.has(filePath)) return iconCache.get(filePath);
  try {
    const result = execFileSync(ICON_EXE, [filePath], {
      encoding: 'utf-8', timeout: 4000
    }).trim();
    if (!result) return null;
    return parseIconResult(filePath, result);
  } catch (e) {}
  return null;
}

function extractIconNativeAsync(filePath) {
  if (!iconExtractorReady) return Promise.resolve(null);
  if (iconCache.has(filePath)) return Promise.resolve(iconCache.get(filePath));
  return new Promise((resolve) => {
    execFile(ICON_EXE, [filePath], {
      encoding: 'utf-8', timeout: 4000
    }, (err, stdout) => {
      if (err || !stdout) { resolve(null); return; }
      const result = stdout.trim();
      if (!result) { resolve(null); return; }
      resolve(parseIconResult(filePath, result));
    });
  });
}

function parseIconResult(filePath, result) {
  const parts = result.split('|');
  const icons = {};
  for (const part of parts) {
    const decoded = Buffer.from(part, 'base64').toString('utf-8');
    const colonIdx = decoded.indexOf(':');
    if (colonIdx === -1) continue;
    const size = parseInt(decoded.substring(0, colonIdx));
    const b64 = decoded.substring(colonIdx + 1);
    if (size === 96) icons.tiny = 'data:image/png;base64,' + b64;
    else if (size === 288) icons.normal = 'data:image/png;base64,' + b64;
    else if (size === 576) icons.huge = 'data:image/png;base64,' + b64;
  }
  if (icons.tiny && icons.normal && icons.huge) {
    iconCache.set(filePath, icons);
    trimIconCache();
    return icons;
  }
  return null;
}

let appData = { zones: [] };
let zoneWindows = new Map();
let tray = null;

let saveTimer = null;
function saveDataDebounced() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { fs.writeFileSync(DATA_FILE, JSON.stringify(appData, null, 2), 'utf-8'); }
    catch (e) { console.error('Save error:', e); }
    saveTimer = null;
  }, 500);
}

function saveData() {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(appData, null, 2), 'utf-8'); }
  catch (e) { console.error('Save error:', e); }
}

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const d = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
      if (!d.zones) d.zones = [];
      return d;
    }
  } catch (e) { console.error('Load error:', e); }
  return { zones: [] };
}

function generateId() {
  return 'z-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6);
}

function getNextColor() {
  const usedColors = appData.zones.map(z => z.color);
  for (const c of ZONE_COLORS) {
    if (!usedColors.includes(c)) return c;
  }
  return ZONE_COLORS[appData.zones.length % ZONE_COLORS.length];
}

function getNextName() {
  let idx = appData.zones.length + 1;
  let name = '分区 ' + idx;
  const names = new Set(appData.zones.map(z => z.name));
  while (names.has(name)) { idx++; name = '分区 ' + idx; }
  return name;
}

function getZoneDir(zoneName) {
  return path.join(ZONES_ROOT, zoneName);
}

function ensureZoneDir(zoneName) {
  const dir = getZoneDir(zoneName);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function createZoneOverlay(zone) {
  if (zoneWindows.has(zone.id)) {
    const old = zoneWindows.get(zone.id);
    if (!old.isDestroyed()) { old.removeAllListeners('close'); old.close(); }
    zoneWindows.delete(zone.id);
  }

  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: sw, height: sh } = primaryDisplay.workAreaSize;
  const bounds = zone.bounds || { x: 100, y: 100, width: 380, height: 300 };
  if (bounds.x + bounds.width > sw) bounds.x = sw - bounds.width - 20;
  if (bounds.y + bounds.height > sh) bounds.y = sh - bounds.height - 20;

  const win = new BrowserWindow({
    x: bounds.x, y: bounds.y,
    width: bounds.width, height: bounds.height,
    minWidth: 240, minHeight: 200,
    transparent: true,
    frame: false,
    resizable: false,
    alwaysOnTop: false,
    skipTaskbar: true,
    hasShadow: false,
    focusable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      webSecurity: false
    }
  });

  win.loadFile('zone-overlay.html');

  if (zone.locked) win.setMovable(false);

  win.webContents.on('did-finish-load', () => {
    win.webContents.send('zone-init', zone);
  });

  let moveTimer = null;
  win.on('moved', () => {
    if (win.isDestroyed()) return;
    if (resizingZones.has(zone.id)) return;
    if (moveTimer) clearTimeout(moveTimer);
    moveTimer = setTimeout(() => {
      try {
        const b = win.getBounds();
        const z = appData.zones.find(zz => zz.id === zone.id);
        if (z) { z.bounds = { x: b.x, y: b.y, width: b.width, height: b.height }; saveDataDebounced(); }
        if (!win.isDestroyed()) win.webContents.send('zone-bounds-updated', z.bounds);
      } catch (e) {}
      moveTimer = null;
    }, 150);
  });

  win.on('close', (e) => {
    e.preventDefault();
    win.hide();
  });

  zoneWindows.set(zone.id, win);
}

function closeZoneOverlay(zoneId) {
  if (zoneWindows.has(zoneId)) {
    const win = zoneWindows.get(zoneId);
    if (!win.isDestroyed()) { win.removeAllListeners('close'); win.close(); }
    zoneWindows.delete(zoneId);
  }
}

function refreshZoneOverlay(zoneId) {
  const zone = appData.zones.find(z => z.id === zoneId);
  if (zone && zoneWindows.has(zoneId)) {
    const win = zoneWindows.get(zoneId);
    if (!win.isDestroyed()) win.webContents.send('zone-init', zone);
  }
}

function doCreateZone() {
  const name = getNextName();
  const color = getNextColor();
  try {
    ensureZoneDir(name);
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: sw, height: sh } = primaryDisplay.workAreaSize;
    const offset = appData.zones.length * 35;
    const zone = {
      id: generateId(), name, color, theme: 'nordic',
      bounds: {
        x: Math.min(90 + offset, sw - 420),
        y: Math.min(20 + offset, sh - 360),
        width: 380, height: 300
      },
      iconSize: 'normal',
      createdAt: Date.now()
    };
    appData.zones.push(zone);
    saveData();
    createZoneOverlay(zone);
    return { success: true, zone };
  } catch (e) { return { success: false, error: e.message }; }
}

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  let trayIcon;
  if (fs.existsSync(iconPath)) {
    trayIcon = nativeImage.createFromPath(iconPath);
  } else {
    trayIcon = nativeImage.createEmpty();
  }
  tray = new Tray(trayIcon);
  const contextMenu = Menu.buildFromTemplate([
    { label: '➕ 新建分区', click: () => { doCreateZone(); } },
    { type: 'separator' },
    { label: '显示所有分区', click: () => { zoneWindows.forEach(w => { if (!w.isDestroyed()) w.show(); }); } },
    { label: '隐藏所有分区', click: () => { zoneWindows.forEach(w => { if (!w.isDestroyed()) w.hide(); }); } },
    { type: 'separator' },
    { label: '退出', click: () => { appData.zones.forEach(z => closeZoneOverlay(z.id)); app.quit(); } }
  ]);
  tray.setToolTip('桌面分区管理器');
  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => { zoneWindows.forEach(w => { if (!w.isDestroyed()) w.show(); }); });
}

function createShortcut(targetPath, shortcutPath) {
  return createShortcutWithOptions(targetPath, shortcutPath, {
    target: targetPath,
    description: '快捷方式'
  });
}

function createShortcutWithOptions(targetPath, shortcutPath, options) {
  try {
    if (typeof shell.writeShortcutLink === 'function') {
      shell.writeShortcutLink(shortcutPath, 'create', options);
      if (fs.existsSync(shortcutPath)) {
        return true;
      }
    }
  } catch (e) {
    console.error('[SHORTCUT] shell.writeShortcutLink failed:', e.message);
  }
  try {
    const psScript = `$s = New-Object -COM WScript.Shell; $l = $s.CreateShortcut('${shortcutPath.replace(/'/g, "''")}'); $l.TargetPath = '${targetPath.replace(/'/g, "''")}'; $l.Description = '快捷方式'; $l.Save()`;
    execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psScript], { windowsHide: true, timeout: 5000 });
    if (fs.existsSync(shortcutPath)) {
      return true;
    }
  } catch (e) {
    console.error('[SHORTCUT] PowerShell fallback failed:', e.message);
  }
  console.error('[SHORTCUT] All methods failed for:', targetPath, '->', shortcutPath);
  return false;
}

const ICON_COLORS = ['#e74c3c','#e67e22','#f1c40f','#2ecc71','#1abc9c','#3498db','#9b59b6','#e84393','#00cec9','#6c5ce7','#fd79a8','#00b894'];

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0; }
  return Math.abs(h);
}

function generateFallbackIcons(fileName, isFolder) {
  if (isFolder) return generateFolderIcons(fileName);
  const h = hashStr(fileName);
  const bg = ICON_COLORS[h % ICON_COLORS.length];
  const bg2 = ICON_COLORS[(h + 3) % ICON_COLORS.length];
  const ext = path.extname(fileName).toLowerCase().replace('.', '');
  const letter = (ext || fileName.charAt(0)).toUpperCase().substring(0, 2);
  const makeSvg = (sz, fs2) => `<svg xmlns="http://www.w3.org/2000/svg" width="${sz}" height="${sz}" viewBox="0 0 ${sz} ${sz}"><defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" style="stop-color:${bg}"/><stop offset="100%" style="stop-color:${bg2}"/></linearGradient></defs><rect width="${sz}" height="${sz}" rx="${Math.round(sz*0.19)}" fill="url(#g)"/><text x="${sz/2}" y="${sz*0.57}" font-family="Segoe UI,Arial,sans-serif" font-size="${fs2}" font-weight="700" fill="white" text-anchor="middle" dominant-baseline="central">${letter}</text></svg>`;
  return {
    tiny: 'data:image/svg+xml;base64,' + Buffer.from(makeSvg(96, 36)).toString('base64'),
    normal: 'data:image/svg+xml;base64,' + Buffer.from(makeSvg(288, 112)).toString('base64'),
    huge: 'data:image/svg+xml;base64,' + Buffer.from(makeSvg(576, 224)).toString('base64')
  };
}

function generateFolderIcons(fileName) {
  const makeSvg = (sz) => {
    const s = sz;
    const tabW = s * 0.35;
    const tabH = s * 0.08;
    const r = s * 0.06;
    const bodyY = tabH;
    const bodyH = s - tabH - s * 0.12;
    const bodyW = s * 0.88;
    const bodyX = (s - bodyW) / 2;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}"><defs><linearGradient id="ft" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" style="stop-color:#FFD54F"/><stop offset="100%" style="stop-color:#FFB300"/></linearGradient><linearGradient id="fb" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" style="stop-color:#FFCA28"/><stop offset="100%" style="stop-color:#FFA000"/></linearGradient><filter id="fs" x="-5%" y="-5%" width="110%" height="120%"><feDropShadow dx="0" dy="${s*0.02}" stdDeviation="${s*0.03}" flood-color="#000" flood-opacity="0.18"/></filter></defs><g filter="url(#fs)"><path d="M${bodyX},${bodyY} L${bodyX},${bodyY - tabH + r} Q${bodyX},${bodyY - tabH} ${bodyX + r},${bodyY - tabH} L${bodyX + tabW - r},${bodyY - tabH} Q${bodyX + tabW},${bodyY - tabH} ${bodyX + tabW + r*0.5},${bodyY - tabH + tabH*0.6} L${bodyX + tabW + r},${bodyY} Z" fill="url(#ft)"/><rect x="${bodyX}" y="${bodyY}" width="${bodyW}" height="${bodyH}" rx="${r}" fill="url(#fb)"/><rect x="${bodyX}" y="${bodyY}" width="${bodyW}" height="${bodyH * 0.15}" rx="${r}" fill="rgba(255,255,255,0.2)"/></g></svg>`;
  };
  return {
    tiny: 'data:image/svg+xml;base64,' + Buffer.from(makeSvg(96)).toString('base64'),
    normal: 'data:image/svg+xml;base64,' + Buffer.from(makeSvg(288)).toString('base64'),
    huge: 'data:image/svg+xml;base64,' + Buffer.from(makeSvg(576)).toString('base64')
  };
}

async function extractMultiSizeIcons(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  let nativePath = filePath;
  let isFolderTarget = false;
  if (ext === '.lnk') {
    try {
      const shortcut = shell.readShortcutLink(filePath);
      if (shortcut.target && fs.existsSync(shortcut.target)) {
        nativePath = shortcut.target;
        try { isFolderTarget = fs.statSync(nativePath).isDirectory(); } catch (e) {}
      }
    } catch (e) {}
  } else {
    try { isFolderTarget = fs.statSync(filePath).isDirectory(); } catch (e) {}
  }

  if (isFolderTarget) {
    const folderIconPaths = [
      path.join(process.env.SystemRoot || 'C:\\Windows', 'explorer.exe'),
      path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'shell32.dll'),
      path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'imageres.dll')
    ];
    for (const iconPath of folderIconPaths) {
      const result = await extractIconNativeAsync(iconPath);
      if (result) return result;
    }
  }

  const nativeResult = await extractIconNativeAsync(nativePath);
  if (nativeResult) return nativeResult;
  let rawIcon = null;
  if (ext === '.lnk') {
    try {
      const shortcut = shell.readShortcutLink(filePath);
      const shortcutIconPath = (shortcut.icon && fs.existsSync(shortcut.icon)) ? shortcut.icon : null;
      const targetPath = (shortcut.target && fs.existsSync(shortcut.target)) ? shortcut.target : null;
      if (shortcutIconPath) {
        const icon = await app.getFileIcon(shortcutIconPath, { size: 'extra-large' });
        if (icon && !icon.isEmpty()) rawIcon = icon;
      }
      if (!rawIcon && targetPath) {
        const icon = await app.getFileIcon(targetPath, { size: 'extra-large' });
        if (icon && !icon.isEmpty()) rawIcon = icon;
      }
    } catch (e) {}
    if (!rawIcon) {
      const icon = await app.getFileIcon(filePath, { size: 'extra-large' });
      if (icon && !icon.isEmpty()) rawIcon = icon;
    }
  } else {
    const icon = await app.getFileIcon(filePath, { size: 'extra-large' });
    if (icon && !icon.isEmpty()) rawIcon = icon;
  }
  if (rawIcon) {
    try {
      return {
        tiny: rawIcon.resize({ width: 96, height: 96, quality: 'best' }).toDataURL(),
        normal: rawIcon.resize({ width: 288, height: 288, quality: 'best' }).toDataURL(),
        huge: rawIcon.resize({ width: 1024, height: 1024, quality: 'best' }).toDataURL()
      };
    } catch (e) {
      const d = rawIcon.toDataURL();
      return { tiny: d, normal: d, huge: d };
    }
  }
  return null;
}

const fileIconCache = new Map();
const FILE_ICON_CACHE_MAX = 100;

async function getFilesWithIcons(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  const files = fs.readdirSync(dirPath);
  const result = [];
  const pending = [];

  for (const file of files) {
    const filePath = path.join(dirPath, file);
    try {
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) continue;
      const ext = path.extname(file).toLowerCase();
      if (fileIconCache.has(filePath)) {
        result.push(fileIconCache.get(filePath));
        continue;
      }
      pending.push({ filePath, file, ext });
    } catch (e) {}
  }

  const batchSize = 6;
  for (let i = 0; i < pending.length; i += batchSize) {
    const batch = pending.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(async ({ filePath, file, ext }) => {
      let icons = null;
      let isFolder = false;
      if (ext === '.lnk') {
        try {
          const shortcut = shell.readShortcutLink(filePath);
          if (shortcut.target && fs.existsSync(shortcut.target)) {
            try { isFolder = fs.statSync(shortcut.target).isDirectory(); } catch (e) {}
          }
        } catch (e) {}
      }
      try { icons = await extractMultiSizeIcons(filePath); } catch (e) {}
      if (!icons) icons = generateFallbackIcons(file, isFolder);
      const entry = {
        name: path.basename(file, ext === '.lnk' ? ext : ''),
        fullName: file, path: filePath, ext,
        isShortcut: ext === '.lnk', isFolder, icons
      };
      fileIconCache.set(filePath, entry);
      return entry;
    }));
    result.push(...results);
  }

  if (fileIconCache.size > FILE_ICON_CACHE_MAX) {
    const keys = [...fileIconCache.keys()];
    for (let i = 0; i < keys.length - FILE_ICON_CACHE_MAX + 20; i++) {
      fileIconCache.delete(keys[i]);
    }
  }

  return result;
}

function getZoneMetaPath(zoneName) {
  return path.join(getZoneDir(zoneName), 'zone-meta.json');
}

function readZoneMeta(zoneName) {
  const metaPath = getZoneMetaPath(zoneName);
  try {
    if (fs.existsSync(metaPath)) return JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  } catch (e) {}
  return { fromDesktop: {} };
}

function writeZoneMeta(zoneName, meta) {
  const metaPath = getZoneMetaPath(zoneName);
  try {
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
  } catch (e) {}
}

function doMoveFileToZone(filePath, zoneId) {
  const zone = appData.zones.find(z => z.id === zoneId);
  if (!zone) return { success: false, error: '分区不存在' };
  try {
    const zoneDir = ensureZoneDir(zone.name);
    const ext = path.extname(filePath).toLowerCase();
    const isShortcut = ext === '.lnk';
    const isFromDesktop = filePath.startsWith(DESKTOP_PATH);
    let targetPath = filePath;
    let isFolder = false;

    try { isFolder = fs.statSync(filePath).isDirectory(); } catch (e) {}

    if (isShortcut) {
      try {
        const shortcut = shell.readShortcutLink(filePath);
        if (shortcut.target) {
          targetPath = shortcut.target;
          try { isFolder = fs.statSync(targetPath).isDirectory(); } catch (e) {}
        }
      } catch (e) {}
    }

    let baseName;
    if (isFolder) {
      baseName = path.basename(filePath);
    } else if (isShortcut) {
      baseName = path.basename(filePath, '.lnk');
    } else {
      baseName = path.basename(filePath);
    }

    const lnkName = baseName + '.lnk';
    let destPath = path.join(zoneDir, lnkName);
    if (fs.existsSync(destPath)) {
      destPath = path.join(zoneDir, `${baseName}_${Date.now()}.lnk`);
    }

    const shortcutOpts = {
      target: targetPath,
      description: '快捷方式'
    };
    if (isFolder) {
      shortcutOpts.workingDir = targetPath;
    }

    const ok = createShortcutWithOptions(targetPath, destPath, shortcutOpts);
    if (!ok) return { success: false, error: '创建快捷方式失败' };

    if (isFromDesktop && isShortcut) {
      const meta = readZoneMeta(zone.name);
      const lnkFileName = path.basename(destPath);
      meta.fromDesktop[lnkFileName] = path.basename(filePath);
      writeZoneMeta(zone.name, meta);
    }

    if (isShortcut && filePath !== destPath) {
      try { fs.unlinkSync(filePath); } catch (e) {}
    }
    return { success: true, destPath };
  } catch (e) { return { success: false, error: e.message }; }
}

app.whenReady().then(() => {
  protocol.registerFileProtocol('local', (request, callback) => {
    let filePath = request.url.replace('local://', '');
    if (filePath.startsWith('/')) filePath = filePath.substring(1);
    filePath = decodeURIComponent(filePath);
    callback({ path: filePath });
  });

  appData = loadData();
  if (!fs.existsSync(ZONES_ROOT)) fs.mkdirSync(ZONES_ROOT, { recursive: true });
  compileIconExtractor();

  appData.zones = appData.zones.filter(z => {
    if (!z.id) z.id = generateId();
    if (!z.iconSize) z.iconSize = 'normal';
    if (!z.bounds) z.bounds = { x: 100, y: 100, width: 380, height: 300 };
    delete z.icon;
    delete z.fileCount;
    const zoneDir = getZoneDir(z.name);
    if (!fs.existsSync(zoneDir)) {
      fs.mkdirSync(zoneDir, { recursive: true });
    }
    return true;
  });

  delete appData.settings;
  saveData();
  createTray();
  appData.zones.forEach(zone => createZoneOverlay(zone));
  if (appData.zones.length === 0) {
    doCreateZone();
  }
});

app.on('window-all-closed', () => {});

ipcMain.on('renderer-log', (event, msg) => {
  console.log('[RENDERER]', msg);
});

ipcMain.handle('create-zone', () => doCreateZone());

ipcMain.handle('get-zone-count', () => appData.zones.length);

ipcMain.handle('delete-zone', (event, zoneId) => {
  const zone = appData.zones.find(z => z.id === zoneId);
  if (!zone) return { success: false, error: '分区不存在' };
  if (appData.zones.length <= 1) return { success: false, error: '至少需要保留一个分区' };
  try {
    const zoneDir = getZoneDir(zone.name);
    if (fs.existsSync(zoneDir)) {
      const meta = readZoneMeta(zone.name);
      const files = fs.readdirSync(zoneDir);
      for (const file of files) {
        const filePath = path.join(zoneDir, file);
        try {
          if (!fs.statSync(filePath).isFile()) continue;
          const ext = path.extname(file).toLowerCase();
          if (ext === '.lnk' && meta.fromDesktop[file]) {
            const originalName = meta.fromDesktop[file];
            let destPath = path.join(DESKTOP_PATH, originalName);
            if (fs.existsSync(destPath)) {
              const base = path.basename(originalName, '.lnk');
              destPath = path.join(DESKTOP_PATH, `${base}_${Date.now()}.lnk`);
            }
            fs.copyFileSync(filePath, destPath);
          }
        } catch (e) {}
      }
      try { fs.rmSync(zoneDir, { recursive: true, force: true }); } catch (e) {}
    }
    closeZoneOverlay(zoneId);
    appData.zones = appData.zones.filter(z => z.id !== zoneId);
    saveData();
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('rename-zone', (event, zoneId, newName) => {
  const zone = appData.zones.find(z => z.id === zoneId);
  if (!zone) return { success: false, error: '分区不存在' };
  if (appData.zones.some(z => z.name === newName && z.id !== zoneId)) return { success: false, error: '名称已存在' };
  try {
    const oldDir = getZoneDir(zone.name);
    const newDir = getZoneDir(newName);
    if (fs.existsSync(oldDir)) {
      if (fs.existsSync(newDir)) return { success: false, error: '目标文件夹已存在' };
      fs.renameSync(oldDir, newDir);
    }
    zone.name = newName;
    saveData();
    refreshZoneOverlay(zoneId);
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('read-zone-files', async (event, zoneName) => {
  return await getFilesWithIcons(getZoneDir(zoneName));
});

ipcMain.handle('read-zone-files-fast', (event, zoneName) => {
  const dirPath = getZoneDir(zoneName);
  if (!fs.existsSync(dirPath)) return [];
  const files = fs.readdirSync(dirPath);
  const result = files.filter(f => {
    if (f === 'zone-meta.json') return false;
    try { return !fs.statSync(path.join(dirPath, f)).isDirectory(); } catch (e) { return false; }
  }).map(f => {
    const ext = path.extname(f).toLowerCase();
    return {
      name: path.basename(f, ext === '.lnk' ? ext : ''),
      fullName: f, path: path.join(dirPath, f), ext,
      isShortcut: ext === '.lnk', icons: null
    };
  });
  return result;
});

ipcMain.handle('get-file-icons', async (event, filePaths) => {
  console.log('[GET-ICONS] Requested for', filePaths.length, 'files');
  const results = {};
  const batchSize = 6;
  for (let i = 0; i < filePaths.length; i += batchSize) {
    const batch = filePaths.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(async fp => {
      try {
        let icons = await extractMultiSizeIcons(fp);
        console.log('[GET-ICONS]', path.basename(fp), icons ? 'OK' : 'NULL');
        if (!icons) {
          let displayName = path.basename(fp);
          let isFolder = false;
          const ext = path.extname(fp).toLowerCase();
          if (ext === '.lnk') {
            try {
              const shortcut = shell.readShortcutLink(fp);
              if (shortcut.target) {
                displayName = path.basename(shortcut.target);
                try { isFolder = fs.statSync(shortcut.target).isDirectory(); } catch (e) {}
              }
            } catch (e) {}
          } else {
            try { isFolder = fs.statSync(fp).isDirectory(); } catch (e) {}
          }
          icons = generateFallbackIcons(displayName, isFolder);
        }
        return [fp, icons];
      } catch (e) {
        return [fp, generateFallbackIcons(path.basename(fp), false)];
      }
    }));
    for (const [fp, icons] of batchResults) {
      results[fp] = icons;
    }
  }
  return results;
});

ipcMain.handle('move-file-to-zone', (event, filePath, zoneId) => {
  return doMoveFileToZone(filePath, zoneId);
});

ipcMain.handle('remove-file-from-zone', (event, filePath) => {
  try {
    if (!fs.existsSync(filePath)) return { success: false, error: '文件不存在' };

    const fileName = path.basename(filePath);
    const ext = path.extname(fileName).toLowerCase();

    if (ext === '.lnk') {
      const dirPath = path.dirname(filePath);
      const zoneName = path.basename(dirPath);
      const meta = readZoneMeta(zoneName);

      if (meta.fromDesktop && meta.fromDesktop[fileName]) {
        const originalName = meta.fromDesktop[fileName];
        let destPath = path.join(DESKTOP_PATH, originalName);
        if (fs.existsSync(destPath)) {
          const base = path.basename(originalName, '.lnk');
          destPath = path.join(DESKTOP_PATH, `${base}_${Date.now()}.lnk`);
        }
        fs.copyFileSync(filePath, destPath);
        delete meta.fromDesktop[fileName];
        writeZoneMeta(zoneName, meta);
      }
    }

    fs.unlinkSync(filePath);
    fileIconCache.delete(filePath);
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('drop-files-on-zone', (event, zoneId, filePaths) => {
  const zone = appData.zones.find(z => z.id === zoneId);
  if (!zone) return [];
  const results = [];
  for (const fp of filePaths) {
    const r = doMoveFileToZone(fp, zoneId);
    results.push({ filePath: fp, ...r });
  }
  return results;
});

ipcMain.handle('update-zone-bounds', (event, zoneId, bounds) => {
  const zone = appData.zones.find(z => z.id === zoneId);
  if (!zone) return false;
  zone.bounds = bounds;
  saveDataDebounced();
  if (zoneWindows.has(zoneId)) {
    const win = zoneWindows.get(zoneId);
    if (!win.isDestroyed()) {
      win.setBounds({
        x: Math.round(bounds.x),
        y: Math.round(bounds.y),
        width: Math.round(bounds.width),
        height: Math.round(bounds.height)
      }, false);
    }
  }
  return true;
});

// Resize handled entirely in main process - renderer sends mouse deltas
const resizeState = new Map(); // zoneId -> { dir, startMouse, startBounds }

ipcMain.handle('resize-start', (event, zoneId, dir, mouseX, mouseY) => {
  if (!zoneWindows.has(zoneId)) return false;
  const win = zoneWindows.get(zoneId);
  if (win.isDestroyed()) return false;
  resizingZones.add(zoneId);
  const b = win.getBounds();
  resizeState.set(zoneId, {
    dir,
    startMouse: { x: mouseX, y: mouseY },
    startBounds: { x: b.x, y: b.y, width: b.width, height: b.height }
  });
  return true;
});

ipcMain.handle('resize-move', (event, zoneId, mouseX, mouseY) => {
  const state = resizeState.get(zoneId);
  if (!state) return null;
  if (!zoneWindows.has(zoneId)) return null;
  const win = zoneWindows.get(zoneId);
  if (win.isDestroyed()) return null;

  const dx = mouseX - state.startMouse.x;
  const dy = mouseY - state.startMouse.y;
  const sb = state.startBounds;
  const b = { ...sb };

  if (state.dir.includes('e')) b.width = Math.max(240, sb.width + dx);
  if (state.dir.includes('w')) {
    const newWidth = Math.max(240, sb.width - dx);
    b.x = (sb.x + sb.width) - newWidth;
    b.width = newWidth;
  }
  if (state.dir.includes('s')) b.height = Math.max(200, sb.height + dy);
  if (state.dir.includes('n')) {
    const newHeight = Math.max(200, sb.height - dy);
    b.y = (sb.y + sb.height) - newHeight;
    b.height = newHeight;
  }

  if (b.width >= 240 && b.height >= 200) {
    win.setBounds({
      x: Math.round(b.x),
      y: Math.round(b.y),
      width: Math.round(b.width),
      height: Math.round(b.height)
    }, false);
    // Update appData
    const zone = appData.zones.find(z => z.id === zoneId);
    if (zone) { zone.bounds = { ...b }; saveDataDebounced(); }
    return { ...b };
  }
  return null;
});

ipcMain.handle('resize-end', (event, zoneId) => {
  resizeState.delete(zoneId);
  resizingZones.delete(zoneId);
  // Save final bounds
  if (zoneWindows.has(zoneId)) {
    const win = zoneWindows.get(zoneId);
    if (!win.isDestroyed()) {
      const b = win.getBounds();
      const zone = appData.zones.find(z => z.id === zoneId);
      if (zone) { zone.bounds = { x: b.x, y: b.y, width: b.width, height: b.height }; saveData(); }
      win.webContents.send('zone-bounds-updated', zone.bounds);
    }
  }
  return true;
});

ipcMain.handle('open-file', (event, filePath) => { shell.openPath(filePath); });
ipcMain.handle('open-folder', (event, folderPath) => {
  if (!path.isAbsolute(folderPath)) folderPath = path.join(DESKTOP_PATH, folderPath);
  shell.openPath(folderPath);
});
ipcMain.handle('show-item-in-folder', (event, filePath) => { shell.showItemInFolder(filePath); });

ipcMain.handle('get-zone-data', (event, zoneId) => {
  return appData.zones.find(z => z.id === zoneId) || null;
});

ipcMain.handle('update-zone-color', (event, zoneId, color) => {
  const zone = appData.zones.find(z => z.id === zoneId);
  if (!zone) return false;
  zone.color = color;
  saveData();
  return true;
});

ipcMain.handle('update-zone-icon-size', (event, zoneId, iconSize) => {
  const zone = appData.zones.find(z => z.id === zoneId);
  if (!zone) return false;
  zone.iconSize = iconSize;
  saveData();
  return true;
});

ipcMain.handle('update-zone-lock', (event, zoneId, locked) => {
  const zone = appData.zones.find(z => z.id === zoneId);
  if (!zone) return false;
  zone.locked = locked;
  saveData();
  if (zoneWindows.has(zoneId)) {
    const win = zoneWindows.get(zoneId);
    if (!win.isDestroyed()) win.setMovable(!locked);
  }
  return true;
});

ipcMain.handle('hide-zone', (event, zoneId) => {
  if (zoneWindows.has(zoneId)) {
    const win = zoneWindows.get(zoneId);
    if (!win.isDestroyed()) win.hide();
  }
  return true;
});

ipcMain.handle('get-file-icon', async (event, filePath) => {
  try {
    const icons = await extractMultiSizeIcons(filePath);
    if (icons) return icons;
    let isFolder = false;
    try { isFolder = fs.statSync(filePath).isDirectory(); } catch (e) {}
    return generateFallbackIcons(path.basename(filePath), isFolder);
  } catch (e) { return generateFallbackIcons(path.basename(filePath), false); }
});

ipcMain.handle('get-zone-colors', () => COLOR_THEMES);

ipcMain.handle('update-zone-theme', (event, zoneId, theme) => {
  const zone = appData.zones.find(z => z.id === zoneId);
  if (!zone) return false;
  zone.theme = theme;
  saveData();
  return true;
});

ipcMain.handle('pick-files', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win, {
    properties: ['openFile', 'openDirectory', 'multiSelections'],
    filters: [
      { name: '所有文件', extensions: ['*'] },
      { name: '图片', extensions: ['jpg','jpeg','png','gif','bmp','webp','svg','ico','tiff','tif'] },
      { name: '快捷方式', extensions: ['lnk','exe'] }
    ]
  });
  return result.canceled ? [] : result.filePaths;
});

ipcMain.handle('pick-folders', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win, {
    properties: ['openDirectory', 'multiSelections']
  });
  return result.canceled ? [] : result.filePaths;
});

ipcMain.handle('pick-image', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [{ name: '图片', extensions: ['jpg','jpeg','png','gif','bmp','webp','svg','ico','tiff','tif'] }]
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('add-zone-bg-image', (event, zoneId, imagePath) => {
  const zone = appData.zones.find(z => z.id === zoneId);
  if (!zone) return { success: false, error: '分区不存在' };
  try {
    const zoneDir = ensureZoneDir(zone.name);
    const imgDir = path.join(zoneDir, '_images');
    if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });
    const ext = path.extname(imagePath).toLowerCase();
    const destName = 'bg_' + Date.now() + ext;
    const destPath = path.join(imgDir, destName);
    fs.copyFileSync(imagePath, destPath);
    zone.bgImage = destPath;
    saveData();
    return { success: true, path: destPath };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('remove-zone-bg-image', (event, zoneId) => {
  const zone = appData.zones.find(z => z.id === zoneId);
  if (!zone) return { success: false, error: '分区不存在' };
  try {
    if (zone.bgImage && fs.existsSync(zone.bgImage)) {
      fs.unlinkSync(zone.bgImage);
    }
    delete zone.bgImage;
    saveData();
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});
