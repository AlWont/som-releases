// Узкий мост между окном и главным процессом: только эти вызовы, без доступа к Node.js.
'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('som', {
  init: () => ipcRenderer.invoke('core:init'),
  call: (cmd, args) => ipcRenderer.invoke('core:call', cmd, args),
  onEvent: (cb) => {
    const fn = (_e, ev) => cb(ev);
    ipcRenderer.on('core:event', fn);
    return () => ipcRenderer.removeListener('core:event', fn);
  },
  copy: (text) => ipcRenderer.invoke('clip:write', text),
  paste: () => ipcRenderer.invoke('clip:read'),
  secondProfile: () => ipcRenderer.invoke('app:second-profile'),
  attention: (on) => ipcRenderer.invoke('app:attention', on),
  takeInvite: () => ipcRenderer.invoke('app:take-invite'),
  appInfo: () => ipcRenderer.invoke('app:info'),
  updateState: () => ipcRenderer.invoke('update:state'),
  updateCheck: () => ipcRenderer.invoke('update:check'),
  updateRestart: () => ipcRenderer.invoke('update:restart'),
  onUpdate: (cb) => ipcRenderer.on('update:state', (_e, st) => cb(st)),
  onInvite: (cb) => ipcRenderer.on('app:invite', (_e, inv) => cb(inv)),
  pickFiles: (id) => ipcRenderer.invoke('file:pick', id),
  sendFiles: (id, files) => ipcRenderer.invoke('file:send-paths', id, Array.from(files, (f) => webUtils.getPathForFile(f)).filter(Boolean)),
  pasteImage: (id) => ipcRenderer.invoke('file:paste-image', id),
  sendVoice: (id, bytes, dur, wave) => ipcRenderer.invoke('file:send-voice', id, bytes, dur, wave),
  openFile: (id, mid, name) => ipcRenderer.invoke('file:open', id, mid, name),
  saveFile: (id, mid, name) => ipcRenderer.invoke('file:save', id, mid, name),
});
