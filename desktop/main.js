// Diwali Lantern - Windows desktop overlay (Electron)
// (c) 2026 Doneology Labs (OPC) Pvt Ltd - MIT License
//
// The scene is drawn on a frameless, transparent, always-on-top window that covers the screen's work area
// (everything above the taskbar). In Overlay mode (the default) the window ignores the mouse except over the
// kandil, diya, bulbs and options, so you keep working in the apps underneath. A read-only global mouse hook
// lets clicks that pass through still make sparkles (and double-clicks drop crackers) at that spot.
const { app, BrowserWindow, Tray, Menu, ipcMain, screen, shell, globalShortcut, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

if (!app.requestSingleInstanceLock()) { app.quit(); }
app.setAppUserModelId('in.doneology.diwalilantern');

let win = null, tray = null, mode = 'overlay', onTop = true, ignoring = false, ambient = true, hook = null;
const prefsFile = () => path.join(app.getPath('userData'), 'desktop-prefs.json');
function loadPrefs() { try { const p = JSON.parse(fs.readFileSync(prefsFile(), 'utf8')); if (p.mode === 'play') mode = 'play'; if (p.ambient === false) ambient = false; } catch (e) { /* first run */ } }
function savePrefs() { try { fs.writeFileSync(prefsFile(), JSON.stringify({ mode, ambient })); } catch (e) { /* ignore */ } }

function webDir() {
  const packed = path.join(process.resourcesPath || '', 'web', 'index.html');
  try { fs.accessSync(packed); return packed; } catch (e) { return path.join(__dirname, '..', 'docs', 'index.html'); }
}

function createWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  win = new BrowserWindow({
    x: workArea.x, y: workArea.y, width: workArea.width, height: workArea.height,
    transparent: true, frame: false, resizable: false, movable: false, minimizable: false, maximizable: false,
    fullscreenable: false, skipTaskbar: true, hasShadow: false, focusable: false, alwaysOnTop: onTop,
    backgroundColor: '#00000000', title: 'Diwali Lantern', icon: path.join(__dirname, 'icon.png'), show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  });
  win.setAlwaysOnTop(onTop, 'screen-saver');
  win.loadFile(webDir(), { query: { desktop: '1' } });
  win.once('ready-to-show', () => { win.showInactive(); applyMode(true); });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });
  win.on('closed', () => { win = null; });
}

function setIgnore(ig) {
  if (!win) return;
  ignoring = ig;
  if (ig) win.setIgnoreMouseEvents(true, { forward: true }); else win.setIgnoreMouseEvents(false);
}

function fitToScreen() {
  if (!win) return;
  const { workArea } = screen.getPrimaryDisplay();
  win.setBounds({ x: workArea.x, y: workArea.y, width: workArea.width, height: workArea.height });
}

function applyMode(first) {
  if (!win) return;
  setIgnore(mode === 'overlay');
  win.webContents.send('mode', mode === 'overlay' ? 'desktop' : 'celebrate', !!first);
  buildTray();
}
function setMode(m) { mode = m === 'play' || m === 'celebrate' ? 'play' : 'overlay'; savePrefs(); applyMode(false); }

function openOptions() { if (!win) return; win.showInactive(); setIgnore(false); win.webContents.send('open-options'); }

function buildTray() {
  if (!tray) {
    tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'tray.png')));
    tray.setToolTip('Diwali Lantern - Happy Diwali from Doneology Labs');
    tray.on('click', openOptions);
  }
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Options…    Ctrl+Shift+O', click: openOptions },
    { type: 'separator' },
    { label: 'Overlay mode: work in your apps underneath', type: 'radio', checked: mode === 'overlay', click: () => setMode('overlay') },
    { label: 'Play mode: every click goes to the scene', type: 'radio', checked: mode === 'play', click: () => setMode('play') },
    { label: 'Switch mode    Ctrl+Shift+D', click: () => setMode(mode === 'overlay' ? 'play' : 'overlay') },
    { type: 'separator' },
    { label: 'Sparkles and crackers when clicking in other apps', type: 'checkbox', checked: ambient, enabled: !!hook, click: (i) => { ambient = i.checked; savePrefs(); } },
    { label: 'Always on top', type: 'checkbox', checked: onTop, click: (i) => { onTop = i.checked; if (win) win.setAlwaysOnTop(onTop, 'screen-saver'); } },
    { label: 'Hide / Show    Ctrl+Shift+H', click: toggleVisible },
    { type: 'separator' },
    { label: 'Happy Diwali from Doneology Labs', click: () => shell.openExternal('https://arunkw6.wixsite.com/doneology-labs') },
    { label: 'Source code on GitHub', click: () => shell.openExternal('https://github.com/arunkw/diwali-lantern') },
    { type: 'separator' },
    { label: 'Quit    Ctrl+Shift+Q', click: () => app.quit() },
  ]));
}
function toggleVisible() { if (!win) return; if (win.isVisible()) win.hide(); else win.showInactive(); }

// Global mouse hook (read-only): only used to place sparkles where a click passed through the overlay.
function startHook() {
  try {
    const { uIOhook } = require('uiohook-napi');
    uIOhook.on('mousedown', (e) => {
      if (!win || !ambient || mode !== 'overlay' || !ignoring || !win.isVisible() || e.button !== 1) return;
      const dip = process.platform === 'win32' ? screen.screenToDipPoint({ x: e.x, y: e.y }) : { x: e.x, y: e.y };
      const b = win.getBounds(), x = dip.x - b.x, y = dip.y - b.y;
      if (x < 0 || y < 0 || x > b.width || y > b.height) return; // on the taskbar or another monitor
      win.webContents.send('global-click', { x, y });
    });
    uIOhook.start();
    hook = uIOhook;
  } catch (err) {
    hook = null; // the overlay still works; clicks in other apps just won't sparkle
    console.error('Global mouse hook unavailable:', err && err.message);
  }
}

ipcMain.on('set-ignore', (e, ig) => { if (mode === 'overlay') setIgnore(!!ig); });
ipcMain.on('set-mode', (e, m) => setMode(m === 'desktop' ? 'overlay' : 'play'));
ipcMain.on('open-external', (e, url) => { if (/^https:\/\//.test(url)) shell.openExternal(url); });
ipcMain.on('focus', () => { /* the overlay never takes keyboard focus away from your apps */ });
ipcMain.on('quit', () => app.quit());

app.whenReady().then(() => {
  loadPrefs();
  createWindow();
  startHook();
  buildTray();
  globalShortcut.register('CommandOrControl+Shift+D', () => setMode(mode === 'overlay' ? 'play' : 'overlay'));
  globalShortcut.register('CommandOrControl+Shift+O', openOptions);
  globalShortcut.register('CommandOrControl+Shift+H', toggleVisible);
  globalShortcut.register('CommandOrControl+Shift+Q', () => app.quit());
  screen.on('display-metrics-changed', fitToScreen);
  screen.on('display-added', fitToScreen);
  screen.on('display-removed', fitToScreen);
  if (tray && process.platform === 'win32') {
    try { tray.displayBalloon({ title: 'Diwali Lantern is running', content: 'It floats over your apps. Right-click the kandil or diya, or click this icon, for options. Ctrl+Shift+Q quits.', iconType: 'none' }); } catch (e) { /* ignore */ }
  }
});
app.on('second-instance', openOptions);
app.on('will-quit', () => { globalShortcut.unregisterAll(); try { if (hook) hook.stop(); } catch (e) { /* ignore */ } });
app.on('window-all-closed', () => app.quit());
