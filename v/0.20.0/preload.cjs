// Узкий мост между окном и главным процессом: только эти вызовы, без доступа к Node.js.
'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

// Как запустили окно: после тихого автообновления заставку не показываем.
let launch = {};
try { launch = ipcRenderer.sendSync('app:launch') || {}; } catch { launch = {}; }

contextBridge.exposeInMainWorld('som', {
  launch,
  isShown: () => ipcRenderer.invoke('app:is-shown'),
  winPrefs: () => ipcRenderer.invoke('win:prefs'),
  notify: (n) => ipcRenderer.invoke('app:notify', n),
  lib: {
    stickers: () => ipcRenderer.invoke('lib:stickers'),
    addStickers: (packId, packName, items) => ipcRenderer.invoke('lib:sticker-add', packId, packName, items),
    removeSticker: (packId, id) => ipcRenderer.invoke('lib:sticker-remove', packId, id),
    newPack: (name) => ipcRenderer.invoke('lib:pack-new', name),
    renamePack: (packId, name) => ipcRenderer.invoke('lib:pack-rename', packId, name),
    deletePack: (packId) => ipcRenderer.invoke('lib:pack-delete', packId),
    importPack: (bytes) => ipcRenderer.invoke('lib:pack-import', bytes),
    sendSticker: (chat, packId, id) => ipcRenderer.invoke('lib:sticker-send', chat, packId, id),
    sendPack: (chat, packId) => ipcRenderer.invoke('lib:pack-send', chat, packId),
    sounds: () => ipcRenderer.invoke('lib:sounds'),
    addSound: (snd) => ipcRenderer.invoke('lib:sound-add', snd),
    editSound: (id, patch) => ipcRenderer.invoke('lib:sound-edit', id, patch),
  },
  onOpenChat: (cb) => ipcRenderer.on('app:open-chat', (_e, id) => cb(id)),
  autostart: (on) => ipcRenderer.invoke('app:autostart', on),
  hotkeys: (cfg) => ipcRenderer.invoke('hotkeys:set', cfg),
  onHotkey: (cb) => ipcRenderer.on('hotkey', (_e, action) => cb(action)),
  radio: {
    search: (q) => ipcRenderer.invoke('radio:search', q),
    catalog: () => ipcRenderer.invoke('radio:catalog'),
    worldDown: () => ipcRenderer.invoke('radio:world-down'),
    logo: (url) => ipcRenderer.invoke('radio:logo', url),
    play: (st) => ipcRenderer.invoke('radio:play', st),
    stop: () => ipcRenderer.invoke('radio:stop'),
    onMeta: (cb) => ipcRenderer.on('radio:meta', (_e, m) => cb(m)),
  },
  setCloseMode: (mode) => ipcRenderer.invoke('win:set-close', mode),
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
