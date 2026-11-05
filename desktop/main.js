// Diwali Lantern - Windows desktop overlay (Electron)
// (c) 2026 Doneology Labs (OPC) Pvt Ltd - MIT License
const { app, BrowserWindow, Tray, Menu, ipcMain, screen, shell, globalShortcut, nativeImage } = require('electron');
const path = require('path');

if (!app.requestSingleInstanceLock()) { app.quit(); }
app.setAppUserModelId('in.doneology.diwalilantern');

let win = null, tray = null, mode = 'celebrate', onTop = true;

function webDir() {
  // packaged: resources/web ; dev: ../docs
  const packed = path.join(process.resourcesPath || '', 'web', 'index.html');
  try { require('fs').accessSync(packed); return packed; } catch (e) { return path.join(__dirname, '..', 'docs', 'index.html'); }
}

function createWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  win = new BrowserWindow({
    x: workArea.x, y: workArea.y, width: workArea.width, height: workArea.height,
    transparent: true, frame: false, resizable: false, movable: false, minimizable: false, maximizable: false,
    fullscreenable: false, skipTaskbar: true, hasShadow: false, alwaysOnTop: onTop, backgroundColor: '#00000000',
    title: 'Diwali Lantern', icon: path.join(__dirname, 'icon.png'), show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  });
  win.setAlwaysOnTop(onTop, 'floating');
  win.loadFile(webDir(), { query: { desktop: '1' } });
  win.once('ready-to-show', () => { win.showInactive(); sendMode(); });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });
  win.on('closed', () => { win = null; });
}

function fitToScreen() {
  if (!win) return;
  const { workArea } = screen.getPrimaryDisplay();
  win.setBounds({ x: workArea.x, y: workArea.y, width: workArea.width, height: workArea.height });
}

function sendMode() {
  if (!win) return;
  if (mode === 'celebrate') win.setIgnoreMouseEvents(false);
  else win.setIgnoreMouseEvents(true, { forward: true });
  win.webContents.send('mode', mode);
  buildTray();
}

function setMode(m) { mode = m === 'desktop' ? 'desktop' : 'celebrate'; sendMode(); }

function buildTray() {
  if (!tray) {
    tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'tray.png')));
    tray.setToolTip('Diwali Lantern - Happy Diwali from Doneology Labs');
    tray.on('click', () => { if (win) { win.showInactive(); win.webContents.send('open-options'); win.setIgnoreMouseEvents(false); } });
  }
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Options…', click: () => { if (win) { win.setIgnoreMouseEvents(false); win.focus(); win.webContents.send('open-options'); } } },
    { type: 'separator' },
    { label: 'Celebrate mode (clicks go to the scene)', type: 'radio', checked: mode === 'celebrate', click: () => setMode('celebrate') },
    { label: 'Desktop mode (work underneath)    Ctrl+Shift+D', type: 'radio', checked: mode === 'desktop', click: () => setMode('desktop') },
    { label: 'Always on top', type: 'checkbox', checked: onTop, click: (i) => { onTop = i.checked; if (win) win.setAlwaysOnTop(onTop, 'floating'); } },
    { label: 'Hide / Show', click: () => { if (!win) return; if (win.isVisible()) win.hide(); else win.showInactive(); } },
    { type: 'separator' },
    { label: 'Happy Diwali from Doneology Labs', click: () => shell.openExternal('https://arunkw6.wixsite.com/doneology-labs') },
    { label: 'Source code on GitHub', click: () => shell.openExternal('https://github.com/arunkw/diwali-lantern') },
    { type: 'separator' },
    { label: 'Quit    Ctrl+Shift+Q', click: () => app.quit() },
  ]));
}

ipcMain.on('set-ignore', (e, ignore) => {
  if (!win || mode !== 'desktop') return;
  if (ignore) win.setIgnoreMouseEvents(true, { forward: true }); else win.setIgnoreMouseEvents(false);
});
ipcMain.on('set-mode', (e, m) => setMode(m));
ipcMain.on('open-external', (e, url) => { if (/^https:\/\//.test(url)) shell.openExternal(url); });
ipcMain.on('focus', () => { if (win) win.focus(); });
ipcMain.on('quit', () => app.quit());

app.whenReady().then(() => {
  createWindow();
  buildTray();
  globalShortcut.register('CommandOrControl+Shift+D', () => setMode(mode === 'desktop' ? 'celebrate' : 'desktop'));
  globalShortcut.register('CommandOrControl+Shift+Q', () => app.quit());
  screen.on('display-metrics-changed', fitToScreen);
  screen.on('display-added', fitToScreen);
  screen.on('display-removed', fitToScreen);
});
app.on('second-instance', () => { if (win) { win.showInactive(); win.webContents.send('open-options'); win.setIgnoreMouseEvents(false); } });
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());
