// Узкий мост между окном и главным процессом: только эти вызовы, без доступа к Node.js.
'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

// Как запустили окно: после тихого автообновления заставку не показываем.
let launch = {};
try { launch = ipcRenderer.sendSync('app:launch') || {}; } catch { launch = {}; }

contextBridge.exposeInMainWorld('som', {
  launch,
  isShown: () => ipcRenderer.invoke('app:is-shown'),
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
  idleTime: () => ipcRenderer.invoke('app:idle'),
  linkPreview: (url) => ipcRenderer.invoke('link:preview', url),
  openLink: (url) => ipcRenderer.invoke('link:open', url),
  overlayState: (st) => ipcRenderer.invoke('overlay:state', st),
  overlayToast: (t) => ipcRenderer.invoke('overlay:toast', t),
  onLock: (cb) => ipcRenderer.on('app:lock', (_e, on) => cb(on)),
  onShown: (cb) => ipcRenderer.on('app:shown', (_e, on) => cb(on)),
  setBusy: (on) => ipcRenderer.invoke('app:busy', Boolean(on)),
  sbConfig: () => ipcRenderer.invoke('sb:config'),
  sbClear: () => ipcRenderer.invoke('sb:clear'),
  platform: process.platform,
  screenSources: () => ipcRenderer.invoke('screen:sources'),
  screenPrepare: (opts) => ipcRenderer.invoke('screen:prepare', opts),
  screenError: () => ipcRenderer.invoke('screen:last-error'),
  saveProfile: (p) => ipcRenderer.invoke('profile:save', p),
  games: {
    get: () => ipcRenderer.invoke('games:get'),
    set: (next) => ipcRenderer.invoke('games:set', next),
    running: () => ipcRenderer.invoke('games:running'),
    onState: (cb) => ipcRenderer.on('games:state', (_e, st) => cb(st)),
  },
  updateState: () => ipcRenderer.invoke('update:state'),
  updateCheck: () => ipcRenderer.invoke('update:check'),
  updateRestart: (opts) => ipcRenderer.invoke('update:restart', { auto: Boolean(opts?.auto) }),
  onUpdate: (cb) => ipcRenderer.on('update:state', (_e, st) => cb(st)),
  onInvite: (cb) => ipcRenderer.on('app:invite', (_e, inv) => cb(inv)),
  setZoom: (f) => ipcRenderer.invoke('app:zoom', f),
  setCleanMeta: (on) => ipcRenderer.invoke('files:clean-meta', on),
  pickFiles: (id) => ipcRenderer.invoke('file:pick', id),
  sendFiles: (id, files) => ipcRenderer.invoke('file:send-paths', id, Array.from(files, (f) => webUtils.getPathForFile(f)).filter(Boolean)),
  pasteImage: (id) => ipcRenderer.invoke('file:paste-image', id),
  sendVoice: (id, bytes, dur, wave, meta) => ipcRenderer.invoke('file:send-voice', id, bytes, dur, wave, meta),
  openFile: (id, mid, name) => ipcRenderer.invoke('file:open', id, mid, name),
  saveFile: (id, mid, name) => ipcRenderer.invoke('file:save', id, mid, name),
});
