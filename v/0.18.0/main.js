// Som — главный процесс: окно, свой протокол som://app и ядро som-core рядом.
// Окно не держит ключей: всё шифрование, сеть и хранение — в ядре (Rust).
'use strict';

const { app, BrowserWindow, ipcMain, protocol, clipboard, Menu, nativeImage, shell, dialog, powerMonitor, desktopCapturer, screen, Tray } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const { spawn } = require('node:child_process');

const VERSION = require('./package.json').version;
const updater = require('./updater.cjs');
const radio = require('./radio.cjs');
const gamesMod = require('./games.cjs');
const SCHEME = 'som';
const ORIGIN = `${SCHEME}://app`;
const RENDERER_DIR = path.join(__dirname, 'renderer');

// ---------- Профиль: для проверки вдвоём на одном ПК запускается второй с --profile=b ----------
const profileArg = process.argv.find((a) => a.startsWith('--profile='));
const PROFILE = profileArg && /^[a-z0-9]{1,16}$/.test(profileArg.slice(10)) ? profileArg.slice(10) : 'main';
if (PROFILE !== 'main') app.setPath('userData', `${app.getPath('userData')}-${PROFILE}`);
const PORT = { main: 47810, b: 47811, c: 47812, d: 47813 }[PROFILE] ?? 47811;

// У каждого профиля — своя копия программы; вторая копия того же профиля просто показывает окно.
if (!app.requestSingleInstanceLock()) { app.quit(); }

protocol.registerSchemesAsPrivileged([{
  scheme: SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
}, {
  // Радио: живой поток станции идёт через главный процесс (см. radio.cjs).
  scheme: radio.SCHEME,
  privileges: { standard: true, secure: true, stream: true },
}]);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.wasm': 'application/wasm',
};
const CSP = [
  "default-src 'self'", "script-src 'self' 'wasm-unsafe-eval'", "worker-src 'self' blob:", "style-src 'self'", "img-src 'self' data: blob:",
  "media-src 'self' blob: mediastream: somradio:", "connect-src 'self' blob:", "font-src 'self'", "object-src 'none'",
  "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
].join('; ');

function isOurUrl(url) {
  try { const u = new URL(url); return u.protocol === `${SCHEME}:` && u.host === 'app'; } catch { return false; }
}

async function serveFile(request) {
  const url = new URL(request.url);
  if (url.host !== 'app') return new Response('Not found', { status: 404 });
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const full = path.normalize(path.join(RENDERER_DIR, rel));
  if (!full.startsWith(RENDERER_DIR + path.sep)) return new Response('Forbidden', { status: 403 });
  try {
    const body = await fs.readFile(full);
    const headers = { 'content-type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream', 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' };
    if (full.endsWith('.html')) headers['content-security-policy'] = CSP;
    return new Response(body, { status: 200, headers });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}

// ---------- Адрес узла: Radmin (26.x.x.x), иначе домашняя сеть ----------
function pickAddress() {
  const all = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      all.push({ name, address: a.address, radmin: a.address.startsWith('26.') || /radmin/i.test(name) });
    }
  }
  const radmin = all.find((a) => a.radmin);
  const lan = all.find((a) => /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))\./.test(a.address)) || all[0];
  const pick = radmin || lan || null;
  return { address: pick?.address || null, radmin: Boolean(radmin), all };
}

// ---------- Ядро ----------
const core = {
  proc: null,
  ready: null,
  pending: new Map(),
  nextId: 1,
  addr: null,
};

function corePath() {
  return path.join(__dirname, 'core', 'bin', process.platform === 'win32' ? 'som-core.exe' : 'som-core');
}

function sendToWindows(channel, payload) {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed() && w !== overlay.win) w.webContents.send(channel, payload);
}

// ---------- Превью ссылок ----------
const linkCache = new Map();
function privateHost(host) {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (!app.isPackaged && process.env.SOM_LINK_TEST_HOST === h) return false; // только для проверок
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.lan') || !h.includes('.') && !h.includes(':')) return true;
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return a === 10 || a === 127 || a === 0 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254) || a === 26 || (a === 100 && b >= 64 && b <= 127);
  }
  return h.includes(':'); // IPv6-адреса напрямую не открываем
}
async function readLimited(res, max) {
  const reader = res.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
    n += value.length;
    if (n >= max) { reader.cancel().catch(() => {}); break; }
  }
  return Buffer.concat(chunks).subarray(0, max);
}
function decodeEntities(t) {
  return t.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp|laquo|raquo|mdash|ndash|hellip);/gi, (_, e) => {
    const k = e.toLowerCase();
    if (k.startsWith('#x')) return String.fromCodePoint(parseInt(k.slice(2), 16) || 32);
    if (k.startsWith('#')) return String.fromCodePoint(Number(k.slice(1)) || 32);
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', laquo: '«', raquo: '»', mdash: '—', ndash: '–', hellip: '…' }[k] || '';
  }).replace(/\s+/g, ' ').trim();
}
async function fetchLimited(url, max, accept) {
  const { net } = require('electron');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await net.fetch(url, { signal: ctrl.signal, redirect: 'follow', headers: { accept, 'accept-language': 'ru,en;q=0.8', 'user-agent': 'Mozilla/5.0 (compatible; Som link preview)' } });
    if (!res.ok) return null;
    const finalUrl = res.url || url;
    if (privateHost(new URL(finalUrl).hostname)) return null;
    return { buf: await readLimited(res, max), type: res.headers.get('content-type') || '', url: finalUrl };
  } catch { return null; } finally { clearTimeout(timer); }
}
async function linkPreview(url) {
  if (typeof url !== 'string' || url.length > 2000) return null;
  let u;
  try { u = new URL(url); } catch { return null; }
  if (!/^https?:$/.test(u.protocol) || privateHost(u.hostname)) return null;
  const hit = linkCache.get(url);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.v;
  let v = null;
  const page = await fetchLimited(url, 600 * 1024, 'text/html,application/xhtml+xml');
  if (page && /html/i.test(page.type)) {
    const cs = (/charset=([\w-]+)/i.exec(page.type) || /<meta[^>]+charset=["']?([\w-]+)/i.exec(page.buf.subarray(0, 4096).toString('latin1')) || [])[1] || 'utf-8';
    let html;
    try { html = new TextDecoder(cs.toLowerCase()).decode(page.buf); } catch { html = page.buf.toString('utf8'); }
    const head = html.slice(0, 300000);
    const meta = (names) => {
      for (const n of names) {
        const re = new RegExp(`<meta[^>]+(?:property|name)=["']${n}["'][^>]*>`, 'i');
        const tag = re.exec(head)?.[0];
        const c = tag && /content=(["'])([\s\S]*?)\1/i.exec(tag)?.[2];
        if (c) return decodeEntities(c);
      }
      return '';
    };
    const title = meta(['og:title', 'twitter:title']) || decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1] || '');
    const desc = meta(['og:description', 'twitter:description', 'description']);
    const site = meta(['og:site_name']) || new URL(page.url).hostname.replace(/^www\./, '');
    let img = null;
    const imgUrl = meta(['og:image', 'og:image:url', 'twitter:image']);
    if (imgUrl) {
      try {
        const abs = new URL(imgUrl, page.url).toString();
        if (/^https?:/.test(abs) && !privateHost(new URL(abs).hostname)) {
          const pic = await fetchLimited(abs, 3 * 1024 * 1024, 'image/*');
          if (pic && /^image\/(jpeg|png|webp|gif|bmp)/i.test(pic.type)) {
            let im = nativeImage.createFromBuffer(pic.buf);
            if (!im.isEmpty()) {
              const { width } = im.getSize();
              if (width > 480) im = im.resize({ width: 480, quality: 'good' });
              for (const q of [72, 58, 45]) { const j = im.toJPEG(q); if (j.length <= 24000) { img = j.toString('base64'); break; } }
              if (!img) { const j = im.resize({ width: 240, quality: 'good' }).toJPEG(60); if (j.length <= 24000) img = j.toString('base64'); }
            }
          }
        }
      } catch { /* без картинки */ }
    }
    if (title || desc || img) v = { url, title: title.slice(0, 200), desc: desc.slice(0, 300), site: site.slice(0, 80), img };
  }
  linkCache.set(url, { at: Date.now(), v });
  if (linkCache.size > 200) linkCache.delete(linkCache.keys().next().value);
  return v;
}

// ---------- Оверлей поверх игры ----------
// Отдельное прозрачное окно поверх всех, клики проходят сквозь него, программы записи (и наша демка) его не видят.
// Внутрь игры ничего не внедряем — античитам не на что ругаться; в эксклюзивном полноэкранном режиме его не видно.
const overlay = { win: null, state: null, toastUntil: 0, testUntil: 0, timer: 0 };

// ---------- Общий браузер ----------
// Отдельный раздел без «persist:» — память, не диск: вкладки, куки и вход никуда не сохраняются
// и стираются при закрытии. Подпись браузера — обычный Chrome, без Som и Electron.
const SB_PARTITION = 'som-shared-anon';
const SB_UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${(process.versions.chrome || '120').split('.')[0]}.0.0.0 Safari/537.36`;
const SB_PRELOAD = path.join(__dirname, 'sb-guest.cjs');
let sbSession = null;
function sbSetup() {
  if (sbSession) return sbSession;
  const ses = require('electron').session.fromPartition(SB_PARTITION);
  ses.setUserAgent(SB_UA);
  // Сайтам в общем браузере — ничего: ни камеры, ни микрофона, ни геолокации, ни уведомлений.
  ses.setPermissionRequestHandler((_wc, _p, cb) => cb(false));
  ses.setPermissionCheckHandler(() => false);
  ses.setDisplayMediaRequestHandler((_r, cb) => { try { cb(null); } catch { /* уже */ } });
  sbSession = ses;
  return ses;
}
async function sbClear() {
  if (!sbSession) return;
  try { await sbSession.clearStorageData(); await sbSession.clearCache(); await sbSession.clearAuthCache(); } catch { /* не страшно */ }
}
const OV_W = 320;
const OV_H = 460;
function overlayWanted() {
  const st = overlay.state;
  const cfg = st?.cfg;
  if (!cfg || !mainWindow || mainWindow.isDestroyed()) return false;
  if (Date.now() < overlay.testUntil) return true;
  if (cfg.mode === 'off') return false;
  const busy = Boolean(st.call) || Date.now() < overlay.toastUntil;
  if (!busy) return false;
  if (cfg.mode === 'always') return true;
  return Boolean(games?.state().current);
}
function overlayPlace() {
  const { screen } = require('electron');
  const cfg = overlay.state?.cfg || {};
  const area = screen.getPrimaryDisplay().workArea;
  const right = cfg.corner === 'tr' || cfg.corner === 'br';
  const bottom = cfg.corner === 'bl' || cfg.corner === 'br';
  const x = right ? area.x + area.width - OV_W - 8 : area.x + 8;
  const y = bottom ? area.y + area.height - OV_H - 8 : area.y + 8;
  overlay.win.setBounds({ x: Math.round(x), y: Math.round(y), width: OV_W, height: OV_H });
}
function overlayEnsure() {
  if (overlay.win && !overlay.win.isDestroyed()) return overlay.win;
  const w = new BrowserWindow({
    width: OV_W, height: OV_H, show: false, frame: false, transparent: true, backgroundColor: '#00000000', resizable: false, movable: false,
    minimizable: false, maximizable: false, fullscreenable: false, focusable: false, skipTaskbar: true, hasShadow: false, alwaysOnTop: true,
    title: 'Som — оверлей',
    webPreferences: {
      preload: path.join(__dirname, 'overlay-preload.cjs'),
      contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, spellcheck: false, backgroundThrottling: false,
    },
  });
  w.setAlwaysOnTop(true, 'screen-saver');
  w.setIgnoreMouseEvents(true);
  w.setContentProtection(true);
  w.loadURL(`${ORIGIN}/overlay.html`);
  w.webContents.once('did-finish-load', () => { if (overlay.state) w.webContents.send('overlay:state', overlay.state); });
  overlay.win = w;
  return w;
}
function overlayUpdate() {
  clearTimeout(overlay.timer);
  const want = overlayWanted();
  if (!want) { if (overlay.win && !overlay.win.isDestroyed() && overlay.win.isVisible()) overlay.win.hide(); return; }
  const w = overlayEnsure();
  overlayPlace();
  if (!w.webContents.isLoading()) w.webContents.send('overlay:state', overlay.state);
  if (!w.isVisible()) w.showInactive();
  // Уведомление без звонка — спрячем окно, когда оно погаснет.
  if (!overlay.state?.call && (overlay.toastUntil || overlay.testUntil)) overlay.timer = setTimeout(overlayUpdate, Math.max(50, Math.max(overlay.toastUntil, overlay.testUntil) - Date.now() + 50));
}

function startCore() {
  if (core.ready) return core.ready;
  core.ready = new Promise((resolve) => {
    let announced = false;
    const proc = spawn(corePath(), [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    core.proc = proc;
    let buf = '';
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.ready && !announced) { announced = true; resolve({ ok: true }); continue; }
        if (msg.event) { sendToWindows('core:event', msg); continue; }
        const p = core.pending.get(msg.id);
        if (p) { core.pending.delete(msg.id); p(msg); }
      }
    });
    proc.stderr.on('data', () => {});
    proc.on('error', (err) => { if (!announced) resolve({ ok: false, error: err.message }); });
    proc.on('exit', (code) => {
      core.proc = null;
      core.ready = null;
      for (const [, p] of core.pending) p({ ok: false, error: `ядро завершилось (${code})` });
      core.pending.clear();
      if (!announced) resolve({ ok: false, error: `ядро не запустилось (${code})` });
      sendToWindows('core:event', { event: 'core-exit', code });
    });
  });
  return core.ready;
}

async function callCore(cmd, args, timeoutMs = 30000) {
  const r = await startCore();
  if (!r.ok) return r;
  const id = core.nextId++;
  return new Promise((resolve) => {
    const timer = setTimeout(() => { core.pending.delete(id); resolve({ ok: false, error: 'ядро не ответило' }); }, timeoutMs);
    core.pending.set(id, (msg) => { clearTimeout(timer); resolve(msg); });
    core.proc.stdin.write(`${JSON.stringify({ id, cmd, args: args || {} })}\n`);
  });
}

// Команды, которые окну можно вызывать. Папку профиля и адрес задаёт главный процесс.
const ALLOWED = new Set(['me', 'create_profile', 'set_name', 'friends', 'check_invite', 'add_friend', 'accept', 'decline', 'remove',
  'history', 'read', 'send', 'version', 'typing', 'file_download', 'file_data', 'thumb', 'call_signal', 'diag', 'bulk_rate', 'edit', 'delete', 'react', 'search', 'set_profile', 'set_presence', 'avatar', 'set_note', 'set_privacy', 'media', 'ptt', 'pin', 'saved', 'saved_add', 'saved_delete', 'groups', 'group_create', 'group_add', 'group_remove', 'group_rename', 'group_leave', 'gcall_signal', 'sb_signal']);

// ---------- Файлы ----------
const MIME_BY_EXT = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.flac': 'audio/flac', '.opus': 'audio/opus',
  '.pdf': 'application/pdf', '.txt': 'text/plain', '.zip': 'application/zip', '.7z': 'application/x-7z-compressed', '.rar': 'application/vnd.rar',
  '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.json': 'application/json',
};
// Картинки, которые умеет читать nativeImage, — для них делаем превью.
const THUMBABLE = new Set(['.png', '.jpg', '.jpeg', '.bmp']);
// Такие файлы от друга не открываем двойным щелчком — только «Сохранить как…».
const RISKY = new Set(['.exe', '.com', '.bat', '.cmd', '.msi', '.msp', '.scr', '.pif', '.lnk', '.url', '.ps1', '.psm1', '.vbs', '.vbe',
  '.js', '.jse', '.wsf', '.wsh', '.hta', '.jar', '.reg', '.cpl', '.dll', '.sys', '.appx', '.msix', '.application', '.gadget', '.inf', '.scf']);

function cleanName(name) {
  const base = path.basename(String(name || '')).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '').trim();
  return base.slice(0, 150) || 'файл';
}

function makeThumb(img) {
  if (img.isEmpty()) return null;
  const { width, height } = img.getSize();
  for (const box of [360, 280, 200]) {
    const scale = Math.min(1, box / Math.max(width, height));
    const small = scale < 1 ? img.resize({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), quality: 'good' }) : img;
    for (const q of [72, 55]) {
      const jpg = small.toJPEG(q);
      if (jpg.length <= 24000) return { thumb: jpg.toString('base64'), w: width, h: height };
    }
  }
  return { thumb: null, w: width, h: height };
}

// Убирать ли из фото геолокацию, модель камеры и даты (настройка в окне, по умолчанию да).
let cleanMeta = true;
async function sendFilePath(id, file, nameOverride) {
  const ext = path.extname(nameOverride || file).toLowerCase();
  const args = { id, path: file, name: nameOverride || path.basename(file), mime: MIME_BY_EXT[ext] || 'application/octet-stream', clean: cleanMeta };
  if (THUMBABLE.has(ext)) {
    try {
      const t = makeThumb(nativeImage.createFromPath(file));
      if (t) Object.assign(args, t);
    } catch { /* без превью */ }
  }
  return callCore('send_file', args);
}

function tmpDir() {
  return path.join(app.getPath('userData'), 'core', 'tmp');
}

// ---------- Окно ----------
let mainWindow = null;
let games = null;

// Перезапуск ради обновления: запоминаем окно (размер, свёрнуто ли), чтобы вернуть его таким же.
// auto — Som перезапустился сам, пока человека нет у экрана: без заставки и не перехватывая фокус.
const restartFile = () => path.join(app.getPath('userData'), 'restart.json');
const LAUNCH = { quiet: false };
function saveRestart(auto) {
  const w = mainWindow;
  if (!w || w.isDestroyed()) return;
  const st = { at: Date.now(), auto, hidden: !w.isVisible(), min: w.isMinimized(), max: w.isMaximized(), focused: w.isFocused(), bounds: w.getNormalBounds() };
  try { fsSync.writeFileSync(restartFile(), JSON.stringify(st)); } catch { /* вернём окно по умолчанию */ }
}
function takeRestart() {
  try {
    const st = JSON.parse(fsSync.readFileSync(restartFile(), 'utf8'));
    fsSync.rmSync(restartFile(), { force: true });
    return Date.now() - st.at < 5 * 60_000 ? st : null;
  } catch { return null; }
}
/** Прежние размеры окна, если они ещё помещаются на каком-то экране. */
function fitBounds(b) {
  if (!b || ![b.x, b.y, b.width, b.height].every(Number.isFinite)) return null;
  const area = screen.getDisplayMatching(b).workArea;
  const w = Math.max(900, Math.min(b.width, area.width));
  const h = Math.max(600, Math.min(b.height, area.height));
  const visible = b.x < area.x + area.width - 80 && b.x + w > area.x + 80 && b.y >= area.y - 10 && b.y < area.y + area.height - 80;
  return visible ? { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(w), height: Math.round(h) } : null;
}

function createWindow() {
  const R = takeRestart();
  // SOM_NO_INTRO — только для автотестов: без заставки.
  LAUNCH.quiet = Boolean(R?.auto) || process.env.SOM_NO_INTRO === '1';
  const bounds = fitBounds(R?.bounds);
  mainWindow = new BrowserWindow({
    width: 1200, height: 800, minWidth: 900, minHeight: 600,
    ...(bounds || {}), // прежние размер и место окна после перезапуска
    title: PROFILE === 'main' ? 'Som' : `Som — профиль ${PROFILE}`,
    backgroundColor: '#15181b',
    // В Windows берём .ico: в нём для 16–32 px нарисован упрощённый сом, а не уменьшенная картинка.
    icon: nativeImage.createFromPath(path.join(RENDERER_DIR, 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png')),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, spellcheck: false,
      // Вне звонка окно в фоне засыпает, как обычная вкладка: не рисует и редко будит таймеры.
      // На время звонка окно само просит не усыплять его (app:busy) — иначе встанет звук и push-to-talk.
      backgroundThrottling: true,
      // FaceDetector для кнопки «По лицу» в редакторе фото (в Windows работает на встроенном распознавании).
      enableBlinkFeatures: 'ShapeDetection',
      // Общий браузер показывает страницы в <webview> с отдельной, закрытой сессией.
      webviewTag: true,
    },
  });
  mainWindow.once('ready-to-show', () => {
    // Было спрятано в трей — так и остаётся в трее.
    if (R?.hidden && tray) return;
    // Свёрнутое (или открытое без фокуса, пока вас не было) — открываем свёрнутым и не отнимаем фокус у других программ.
    if (R && (R.min || (R.auto && !R.focused))) {
      mainWindow.minimize();
      if (R.max) mainWindow.once('restore', () => mainWindow.maximize());
    } else if (R?.max) mainWindow.maximize();
    else mainWindow.show();
  });
  // Крестик: по настройке — спрятать в трей (Som работает дальше) или закрыть полностью.
  mainWindow.on('close', (e) => {
    if (quitting || WINPREFS.close !== 'tray' || !tray) return;
    e.preventDefault();
    mainWindow.hide();
    if (!WINPREFS.trayHinted) {
      WINPREFS.trayHinted = true;
      saveWinPrefs();
      if (process.platform === 'win32') {
        tray.displayBalloon({
          iconType: 'info', title: 'Som работает в трее',
          content: 'Сообщения и звонки приходят как обычно. Открыть — щелчок по сому у часов, выйти — правой кнопкой → «Выйти из Som». Поменять — в настройках, «Уведомления».',
        });
      }
    }
  });
  // Выход из Windows или выключение — не держим окно, иначе Windows скажет «приложение мешает выключению».
  mainWindow.on('query-session-end', () => { quitting = true; });
  // Непрочитанные — в подсказку и точку на значке в трее (окно пишет их в заголовок: «(3) Som»).
  mainWindow.on('page-title-updated', (_e, title) => updateTray(title));
  // Свёрнуто или спрятано — окну незачем перерисовывать звонок (звук и сеть работают как прежде).
  const shown = (on) => { if (!mainWindow.isDestroyed()) mainWindow.webContents.send('app:shown', on); };
  mainWindow.on('minimize', () => shown(false));
  mainWindow.on('hide', () => shown(false));
  mainWindow.on('restore', () => { ringShown = false; shown(true); });
  mainWindow.on('focus', () => { ringShown = false; });
  mainWindow.on('show', () => shown(!mainWindow.isMinimized()));
  mainWindow.on('closed', () => { if (overlay.win && !overlay.win.isDestroyed()) overlay.win.destroy(); overlay.win = null; });
  mainWindow.loadURL(`${ORIGIN}/index.html`);
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') { mainWindow.webContents.toggleDevTools(); event.preventDefault(); }
  });
}

ipcMain.on('app:launch', (event) => { event.returnValue = { quiet: LAUNCH.quiet }; });

// ---------- Ссылки som://add/… из браузера и мессенджеров ----------
// Windows запускает Som с ссылкой в командной строке (или передаёт её уже запущенной копии).
// Ссылка только открывает окно «Добавить друга» с подставленным приглашением — решает человек.
const INVITE_RE = /^som:\/\/add\/[A-Za-z0-9_-]{20,4000}\/?$/;
function findInvite(argv) {
  const hit = (argv || []).find((a) => typeof a === 'string' && INVITE_RE.test(a));
  return hit ? hit.replace(/\/$/, '') : null;
}
let pendingInvite = findInvite(process.argv);
function deliverInvite(inv) {
  if (!inv) return;
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isLoading()) mainWindow.webContents.send('app:invite', inv);
  else pendingInvite = inv;
}

app.on('second-instance', (_e, argv) => {
  showWindow();
  deliverInvite(findInvite(argv));
});

// ---------- Трей ----------
// Настройки окна живут здесь, а не в окне: крестик нажимают, когда окно уже может не отвечать.
const winPrefsFile = () => path.join(app.getPath('userData'), 'window.json');
const WINPREFS = { close: 'tray', trayHinted: false };
try { Object.assign(WINPREFS, JSON.parse(fsSync.readFileSync(winPrefsFile(), 'utf8'))); } catch { /* по умолчанию */ }
if (WINPREFS.close !== 'quit') WINPREFS.close = 'tray';
function saveWinPrefs() { try { fsSync.writeFileSync(winPrefsFile(), JSON.stringify(WINPREFS)); } catch { /* не страшно */ } }

let tray = null;
let quitting = false;
let trayUnread = -1;
let ringShown = false; // окно показали из трея ради входящего звонка
app.on('before-quit', () => { quitting = true; });

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  ringShown = false;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}
const trayIcon = (dot) => nativeImage.createFromPath(path.join(RENDERER_DIR, 'assets', dot ? 'tray-dot.png' : 'tray.png'));
const appTitle = () => (PROFILE === 'main' ? 'Som' : `Som — профиль ${PROFILE}`);
function createTray() {
  try {
    tray = new Tray(trayIcon(false));
  } catch { tray = null; return; } // нет области уведомлений — крестик просто закрывает
  tray.setToolTip(appTitle());
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Открыть Som', click: showWindow },
    { type: 'separator' },
    { label: 'Выйти из Som', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('click', showWindow);
  tray.on('double-click', showWindow);
  tray.on('balloon-click', showWindow);
  if (process.env.SOM_TEST_HOOKS === '1') global.somTray = tray; // только для автотестов
}
function updateTray(title) {
  if (!tray || tray.isDestroyed()) return;
  const n = Number((/^\((\d+)\)/.exec(title || '') || [])[1] || 0);
  if (n === trayUnread) return;
  trayUnread = n;
  tray.setImage(trayIcon(n > 0));
  tray.setToolTip(n ? `${appTitle()} — непрочитанных: ${n}` : appTitle());
}

app.on('web-contents-created', (_e, contents) => {
  const type = contents.getType();
  if (type === 'webview') {
    // Гостевая страница общего браузера: новые окна/вкладки открываем в том же месте (чтобы синхронизация их видела).
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url) && url.length < 4000 && !contents.isDestroyed()) contents.loadURL(url).catch(() => {});
      return { action: 'deny' };
    });
    // Не даём IP утечь мимо соединения (WebRTC) — для анонимности.
    try { contents.setWebRTCIPHandlingPolicy('default_public_interface_only'); } catch { /* не критично */ }
    contents.setAudioMuted(false);
    return;
  }
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event, url) => { if (!isOurUrl(url)) event.preventDefault(); });
  // Разрешаем прикрепить только наш <webview> общего браузера: закрытый раздел, свой preload, песочница.
  contents.on('will-attach-webview', (event, prefs, params) => {
    const okPreload = /(^|[/\\])sb-guest\.cjs$/.test(String(params.preload || prefs.preload || '').replace(/^file:\/+/, ''));
    if (params.partition !== SB_PARTITION || !okPreload) { event.preventDefault(); return; }
    prefs.nodeIntegration = false;
    prefs.nodeIntegrationInSubFrames = false;
    prefs.contextIsolation = true;
    prefs.sandbox = true;
    prefs.webSecurity = true;
    prefs.allowRunningInsecureContent = false;
    prefs.enableBlinkFeatures = '';
    prefs.webviewTag = false;
    sbSetup();
  });
});

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  protocol.handle(SCHEME, serveFile);
  protocol.handle(radio.SCHEME, (req) => radio.serve(req));
  radio.init({ version: VERSION, meta: (m) => sendToWindows('radio:meta', m) });
  const ses = require('electron').session.defaultSession;
  // Окну Som можно: микрофон и камеру (кружки), показ экрана, выбор колонок и запись в буфер обмена.
  ses.setPermissionRequestHandler((_wc, permission, cb, details) => {
    if (!isOurUrl(details.requestingUrl || '')) return cb(false);
    if (permission === 'media') {
      const types = details.mediaTypes || [];
      // Показ экрана (getDisplayMedia) приходит как media без типов — разрешаем, только когда окно само выбрало, что показывать.
      if (!types.length) return cb(Boolean(pendingCapture));
      return cb(types.every((t) => t === 'audio' || t === 'video'));
    }
    cb(['clipboard-sanitized-write', 'speaker-selection', 'display-capture', 'fullscreen'].includes(permission));
  });
  ses.setPermissionCheckHandler((_wc, permission, origin) => isOurUrl(origin || '') && ['media', 'speaker-selection', 'clipboard-sanitized-write', 'display-capture'].includes(permission));
  // Демонстрация экрана: окно сначала выбирает источник в своём списке, потом вызывает getDisplayMedia.
  let pendingCapture = null;
  // Почему захват не начался — окно покажет понятную причину и запишет её в отчёт.
  let captureError = null;
  ses.setDisplayMediaRequestHandler(async (request, callback) => {
    const want = pendingCapture;
    pendingCapture = null;
    captureError = null;
    const fail = (reason, detail = '') => { captureError = { reason, detail: String(detail).slice(0, 300) }; try { callback(null); } catch { /* уже ответили */ } };
    try {
      if (!want) { fail('no-choice'); return; }
      if (!isOurUrl(request.frame?.url || `${ORIGIN}/`)) { fail('not-ours', request.frame?.url); return; }
      // Свёрнутое окно Windows не отдаёт в список — подождём и поищем ещё раз, в том числе по названию.
      let source = null;
      let names = [];
      for (let i = 0; i < 3 && !source; i += 1) {
        if (i) await new Promise((r) => setTimeout(r, 400));
        const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } });
        names = sources.map((x) => x.name);
        source = sources.find((x) => x.id === want.sourceId) || (want.name && !want.sourceId.startsWith('screen:') ? sources.find((x) => x.name === want.name) : null);
      }
      if (!source) { fail('gone', `${want.sourceId} «${want.name || ''}»; доступно: ${names.length}`); return; }
      const result = { video: source };
      // Звук системы есть только в Windows; restrictOwnAudio из окна убирает из него звук самого Som (голос друга).
      if (request.audioRequested && want.audio && process.platform === 'win32') result.audio = 'loopback';
      callback(result);
    } catch (err) { fail('error', err?.message || err); }
  }, { useSystemPicker: false });
  ipcMain.handle('screen:last-error', (event) => (isOurUrl(event.senderFrame.url) ? captureError : null));
  ipcMain.handle('screen:sources', async (event) => {
    if (!isOurUrl(event.senderFrame.url)) return [];
    const list = () => desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: true });
    let sources = await list();
    if (!sources.length) { await new Promise((r) => setTimeout(r, 600)); sources = await list(); }
    const me = new Set(BrowserWindow.getAllWindows().map((w) => w.getMediaSourceId()));
    const screens = sources.filter((y) => y.id.startsWith('screen:')).length;
    let n = 0;
    return sources
      .filter((x) => !me.has(x.id) && (x.id.startsWith('screen:') || x.name.trim()))
      .map((x) => ({
        id: x.id, screen: x.id.startsWith('screen:'),
        name: x.id.startsWith('screen:') ? (screens > 1 ? `Экран ${++n}` : 'Весь экран') : x.name,
        thumb: x.thumbnail.isEmpty() ? null : x.thumbnail.toDataURL(),
        icon: x.appIcon && !x.appIcon.isEmpty() ? x.appIcon.toDataURL() : null,
      }));
  });
  ipcMain.handle('screen:prepare', (event, opts) => {
    if (!isOurUrl(event.senderFrame.url) || typeof opts?.sourceId !== 'string') return false;
    pendingCapture = { sourceId: opts.sourceId, audio: Boolean(opts.audio), name: typeof opts.name === 'string' ? opts.name.slice(0, 300) : '' };
    return true;
  });

  const own = (event) => isOurUrl(event.senderFrame.url);
  ipcMain.handle('core:init', async (event) => {
    if (!own(event)) return { ok: false };
    const net = pickAddress();
    core.addr = net;
    const bind = net.address ? `${net.address}:${PORT}` : null;
    const r = await callCore('init', { dir: path.join(app.getPath('userData'), 'core'), bind });
    // Окно открылось и ядро ответило — эта версия рабочая, откатывать её не нужно.
    if (r.ok) { updater.markGood(); games?.start(); games?.resend(); }
    return { ...r, net: { address: net.address, radmin: net.radmin, port: PORT }, profile: PROFILE };
  });
  ipcMain.handle('core:call', (event, cmd, args) => {
    if (!own(event) || !ALLOWED.has(cmd)) return { ok: false, error: 'команда не разрешена' };
    return callCore(cmd, args && typeof args === 'object' ? args : {});
  });
  // В Electron 44 буфер обмена асинхронный: readText/writeText возвращают Promise.
  ipcMain.handle('clip:write', async (event, text) => {
    if (!own(event) || typeof text !== 'string') return false;
    await clipboard.writeText(text.slice(0, 20000));
    return true;
  });
  ipcMain.handle('clip:read', async (event) => (own(event) ? String(await clipboard.readText() || '').slice(0, 20000) : ''));
  // Второй профиль на этом же ПК — чтобы проверить друзей и переписку без второго компьютера.
  ipcMain.handle('app:second-profile', (event) => {
    if (!own(event) || PROFILE !== 'main') return false;
    const args = process.defaultApp ? [process.argv[1], '--profile=b'] : ['--profile=b'];
    spawn(process.execPath, args, { detached: true, stdio: 'ignore' }).unref();
    return true;
  });
  ipcMain.handle('app:busy', (event, on) => {
    if (!own(event) || event.sender !== mainWindow?.webContents) return false;
    event.sender.setBackgroundThrottling(!on);
    return true;
  });
  sbSetup();
  ipcMain.handle('sb:config', (event) => (own(event) ? { partition: SB_PARTITION, preload: `file://${SB_PRELOAD}`, ua: SB_UA } : null));
  ipcMain.handle('sb:clear', (event) => (own(event) ? sbClear() : null));
  ipcMain.handle('app:zoom', (event, f) => {
    if (!own(event) || typeof f !== 'number' || !(f >= 0.5 && f <= 2)) return false;
    event.sender.setZoomFactor(f);
    return true;
  });
  ipcMain.handle('files:clean-meta', (event, on) => { if (own(event)) cleanMeta = on !== false; return cleanMeta; });
  ipcMain.handle('file:pick', async (event, id) => {
    if (!own(event) || typeof id !== 'string') return [];
    const win = BrowserWindow.fromWebContents(event.sender);
    const r = await dialog.showOpenDialog(win, { title: 'Отправить файлы', properties: ['openFile', 'multiSelections'] });
    if (r.canceled) return [];
    const out = [];
    for (const f of r.filePaths.slice(0, 20)) out.push(await sendFilePath(id, f));
    return out;
  });
  ipcMain.handle('file:send-paths', async (event, id, paths) => {
    if (!own(event) || typeof id !== 'string' || !Array.isArray(paths)) return [];
    const out = [];
    for (const f of paths.slice(0, 20)) if (typeof f === 'string' && path.isAbsolute(f)) out.push(await sendFilePath(id, f));
    return out;
  });
  // Картинка из буфера обмена (снимок экрана): сохраняем во временный PNG и отправляем как файл.
  ipcMain.handle('file:paste-image', async (event, id) => {
    if (!own(event) || typeof id !== 'string') return null;
    let png = null;
    for (const item of await clipboard.read()) {
      const type = item.types.find((t) => t === 'image/png') || item.types.find((t) => t.startsWith('image/'));
      if (!type) continue;
      const raw = Buffer.from(await (await item.getType(type)).arrayBuffer());
      // Любой формат картинки приводим к PNG — так у неё будет и превью.
      png = type === 'image/png' ? raw : nativeImage.createFromBuffer(raw).toPNG();
      break;
    }
    if (!png || !png.length) return null;
    await fs.mkdir(tmpDir(), { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const file = path.join(tmpDir(), `Снимок ${stamp}.png`);
    await fs.writeFile(file, png);
    return sendFilePath(id, file);
  });
  // Голосовое: окно записало звук, сохраняем во временный файл и отправляем как файл с пометкой voice.
  // Голосовое (Ogg Opus или WebM) и видео-кружок (WebM) — записаны в окне, сюда приходят байтами.
  ipcMain.handle('file:send-voice', async (event, id, bytes, dur, wave, meta) => {
    if (!own(event) || typeof id !== 'string' || !(bytes instanceof Uint8Array) || bytes.length > 30 * 1024 * 1024) return { ok: false, error: 'неверная запись' };
    await fs.mkdir(tmpDir(), { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const circle = meta?.circle === true;
    const mime = circle ? 'video/webm' : meta?.mime === 'audio/ogg' ? 'audio/ogg' : 'audio/webm';
    const ext = mime === 'audio/ogg' ? 'ogg' : 'webm';
    const name = `${circle ? 'Кружок' : 'Голосовое'} ${stamp}.${ext}`;
    const file = path.join(tmpDir(), name);
    await fs.writeFile(file, bytes);
    const w = Array.isArray(wave) ? wave.slice(0, 64).map((x) => Math.max(0, Math.min(255, Math.round(Number(x) || 0)))) : [];
    const voice = { dur: Number(dur) || 0, wave: w };
    if (circle) voice.circle = true;
    return callCore('send_file', { id, path: file, name, mime, voice });
  });
  ipcMain.handle('file:open', async (event, id, mid, name) => {
    if (!own(event)) return { ok: false };
    const clean = cleanName(name);
    if (RISKY.has(path.extname(clean).toLowerCase())) return { ok: false, error: 'Такой файл может запустить программу. Сохраните его и проверьте антивирусом.' };
    const dest = path.join(app.getPath('userData'), 'core', 'open', String(mid).replace(/[^a-z0-9]/gi, '').slice(0, 32), clean);
    const r = await callCore('file_export', { id, mid, dest }, 600000);
    if (!r.ok) return r;
    const err = await shell.openPath(dest);
    return err ? { ok: false, error: err } : { ok: true };
  });
  ipcMain.handle('file:save', async (event, id, mid, name) => {
    if (!own(event)) return { ok: false };
    const win = BrowserWindow.fromWebContents(event.sender);
    const r = await dialog.showSaveDialog(win, { title: 'Сохранить файл', defaultPath: path.join(app.getPath('downloads'), cleanName(name)) });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    const res = await callCore('file_export', { id, mid, dest: r.filePath }, 600000);
    if (res.ok) shell.showItemInFolder(r.filePath);
    return res;
  });
  // Входящий звонок: мигаем кнопкой на панели задач, пока окно не в фокусе.
  ipcMain.handle('app:attention', (event, on) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!own(event) || !win) return false;
    if (on && !win.isVisible()) { ringShown = true; win.minimize(); } // из трея — свёрнутым, без кражи фокуса
    else if (!on && ringShown) { ringShown = false; win.hide(); } // звонок кончился, окно так и не открыли — обратно в трей
    win.flashFrame(Boolean(on) && !win.isFocused());
    return true;
  });
  ipcMain.handle('app:open-firewall-help', () => { shell.openExternal('ms-settings:windowsdefender'); return true; });

  // Временные копии прошлых сеансов (снимки из буфера, открытые файлы) больше не нужны.
  for (const d of [tmpDir(), path.join(app.getPath('userData'), 'core', 'open')]) {
    try { fsSync.rmSync(d, { recursive: true, force: true }); } catch { /* файл открыт в другой программе */ }
  }
  // Регистрируем som:// за основным профилем (HKCU, без прав администратора). Перезаписываем при каждом
  // запуске: если папку с Som перенесли, ссылки поведут на новое место.
  if (PROFILE === 'main' && app.isPackaged) {
    try { app.setAsDefaultProtocolClient('som'); } catch { /* не страшно — приглашение можно вставить вручную */ }
  }
  ipcMain.handle('app:idle', (event) => (own(event) ? powerMonitor.getSystemIdleTime() : 0));
  // Блокировка экрана — сразу «отошёл».
  powerMonitor.on('lock-screen', () => sendToWindows('app:lock', true));
  powerMonitor.on('unlock-screen', () => sendToWindows('app:lock', false));
  // Игры: определяет главный процесс, ядро рассылает друзьям.
  games = gamesMod.create(path.join(app.getPath('userData'), 'games.json'), (cur) => {
    callCore('set_activity', cur ? { game: cur.game, since: cur.since } : { game: '' }).catch?.(() => {});
    sendToWindows('games:state', games.state());
    overlayUpdate();
  }, async (withWindows) => {
    const r = await callCore('procs', { windows: Boolean(withWindows) }, 5000);
    return r.ok ? r.result : null;
  });
  // Превью ссылки собирает отправитель: страницу открывает его компьютер, друг сайт не открывает вовсе.
  ipcMain.handle('link:preview', async (event, url) => (own(event) ? linkPreview(url) : null));
  ipcMain.handle('link:open', (event, url) => {
    if (!own(event) || typeof url !== 'string' || !/^https?:\/\//i.test(url) || url.length > 4000) return false;
    shell.openExternal(url);
    return true;
  });
  ipcMain.handle('overlay:state', (event, st) => {
    if (!own(event) || event.sender === overlay.win?.webContents) return false;
    overlay.state = st && typeof st === 'object' ? st : null;
    overlayUpdate();
    return overlayWanted();
  });
  ipcMain.handle('overlay:toast', (event, t) => {
    if (!own(event) || !t || typeof t !== 'object' || (!overlay.state?.cfg?.messages && !t.test)) return false;
    if (t.test) overlay.testUntil = Date.now() + 5400; else overlay.toastUntil = Date.now() + 5400;
    overlayUpdate();
    if (!overlayWanted()) return false;
    const send = () => overlay.win.webContents.send('overlay:toast', { id: String(t.id || Date.now()), title: String(t.title || '').slice(0, 80), text: String(t.text || '').slice(0, 200), kind: t.kind === 'call' ? 'call' : '' });
    if (overlay.win.webContents.isLoading()) overlay.win.webContents.once('did-finish-load', send); else send();
    return true;
  });
  ipcMain.handle('games:get', (event) => (own(event) ? games.state() : null));
  ipcMain.handle('games:set', (event, next) => (own(event) && next && typeof next === 'object' ? games.set(next) : null));
  ipcMain.handle('games:running', (event) => (own(event) ? games.running() : []));
  // Профиль: анимация и баннер приходят байтами — кладём во временные файлы и отдаём ядру путь.
  ipcMain.handle('profile:save', async (event, p) => {
    if (!own(event) || !p || typeof p !== 'object') return { ok: false, error: 'неверные данные' };
    const args = { ...p };
    await fs.mkdir(tmpDir(), { recursive: true });
    for (const kind of ['anim', 'banner', 'banner_anim']) {
      const v = p[kind];
      if (v instanceof Uint8Array) {
        if (v.length > 8 * 1024 * 1024) return { ok: false, error: 'файл профиля больше 8 МБ' };
        const file = path.join(tmpDir(), `${kind}-${Date.now()}.${kind === 'banner' ? 'jpg' : 'webm'}`);
        await fs.writeFile(file, v);
        args[kind] = file;
      } else if (v !== null && v !== 'keep') {
        args[kind] = 'keep';
      }
    }
    return callCore('set_profile', args, 60000);
  });
  ipcMain.handle('app:info', (event) => {
    if (!own(event)) return {};
    const cpus = os.cpus();
    const addrs = pickAddress().all.map((a) => `${a.name} ${a.address}`).join(', ');
    return {
      version: VERSION, platform: process.platform === 'win32' ? 'Windows' : process.platform, os: os.release(), arch: process.arch, electron: process.versions.electron,
      cpu: cpus[0]?.model?.trim() || '?', cores: cpus.length, ramGb: Math.round(os.totalmem() / 1073741824), addrs,
    };
  });
  ipcMain.handle('update:state', (event) => (own(event) ? updater.state() : null));
  ipcMain.handle('update:check', (event) => (own(event) ? updater.check(true) : null));
  ipcMain.handle('update:restart', (event, opts) => {
    if (!own(event)) return false;
    saveRestart(Boolean(opts?.auto));
    updater.restart();
    return true;
  });
  // Радио: каталог станций, логотипы, поток.
  ipcMain.handle('radio:search', (event, q) => (own(event) ? radio.search(q || {}) : []));
  ipcMain.handle('radio:catalog', (event) => (own(event) ? radio.catalog() : []));
  ipcMain.handle('radio:world-down', (event) => (own(event) ? radio.worldDown() : ''));
  ipcMain.handle('radio:logo', (event, url) => (own(event) ? radio.logo(url) : null));
  ipcMain.handle('radio:play', (event, st) => {
    if (!own(event)) return null;
    const src = radio.prepare(st);
    radio.click(st?.id);
    return src;
  });
  ipcMain.handle('radio:stop', (event) => { if (own(event)) radio.stop(); return true; });
  ipcMain.handle('win:prefs', (event) => (own(event) ? { close: WINPREFS.close, tray: Boolean(tray) } : null));
  ipcMain.handle('win:set-close', (event, mode) => {
    if (!own(event) || (mode !== 'tray' && mode !== 'quit')) return false;
    WINPREFS.close = mode;
    saveWinPrefs();
    return true;
  });
  ipcMain.handle('app:is-shown', (event) => (own(event) ? Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && !mainWindow.isMinimized()) : false));
  ipcMain.handle('app:take-invite', (event) => {
    if (!own(event)) return null;
    const inv = pendingInvite;
    pendingInvite = null;
    return inv;
  });
  // Обновления проверяет только основной профиль (второй профиль — для проверки на одном ПК).
  if (PROFILE === 'main' && (app.isPackaged || process.env.SOM_UPDATE_URL)) updater.start(VERSION, (st) => sendToWindows('update:state', st));
  startCore();
  createTray();
  createWindow();
});

app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => {
  if (core.proc) { try { core.proc.stdin.end(); } catch { /* уже */ } }
});
