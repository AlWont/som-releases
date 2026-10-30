// Оверлей поверх игры: окну оверлея нужно только получать состояние. Больше ничего.
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlay', {
  onState: (cb) => ipcRenderer.on('overlay:state', (_e, st) => cb(st)),
  onToast: (cb) => ipcRenderer.on('overlay:toast', (_e, t) => cb(t)),
});
