// Narrow, explicit bridge between the page and the desktop shell. No Node access is exposed.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  isDesktop: true,
  setIgnore: (ignore) => ipcRenderer.send('set-ignore', !!ignore),
  setMode: (m) => ipcRenderer.send('set-mode', m === 'desktop' ? 'desktop' : 'celebrate'),
  onMode: (cb) => ipcRenderer.on('mode', (_e, m) => cb(m)),
  onOpenOptions: (cb) => ipcRenderer.on('open-options', () => cb()),
  openExternal: (url) => ipcRenderer.send('open-external', String(url)),
  focus: () => ipcRenderer.send('focus'),
  quit: () => ipcRenderer.send('quit'),
});
