// «Мои игры»: всё, что установлено на этом ПК, — Steam, Epic Games, GOG Galaxy, Ubisoft Connect, — и свои игры
// (любой .exe или ярлык). Только читаем файлы лаунчеров и реестр; ничего в них не меняем.
//
// Steam: libraryfolders.vdf → appmanifest_*.acf в каждой библиотеке; время в игре и «последний запуск» —
//   из localconfig.vdf последнего вошедшего пользователя; обложки — из кэша Steam (appcache/librarycache),
//   нет в кэше — с CDN Steam (только для этого ПК, друзьям ничего не уходит).
// Epic: манифесты C:\ProgramData\Epic\EpicGamesLauncher\Data\Manifests\*.item.
// GOG и Ubisoft: ветки реестра, выгруженные через «reg export» (UTF-16 — русские пути не портятся).
'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFile, spawn } = require('node:child_process');

// ---------- VDF (формат Valve: "ключ" "значение" и { … }) ----------
function parseVdf(text) {
  const root = {};
  const stack = [root];
  let i = 0;
  const n = text.length;
  let key = null;
  const str = () => {
    let out = '';
    i += 1;
    while (i < n && text[i] !== '"') {
      if (text[i] === '\\' && i + 1 < n) { const c = text[i + 1]; out += c === 'n' ? '\n' : c === 't' ? '\t' : c; i += 2; continue; }
      out += text[i];
      i += 1;
    }
    i += 1;
    return out;
  };
  while (i < n) {
    const c = text[i];
    if (c === '"') {
      const s = str();
      if (key === null) key = s;
      else { stack[stack.length - 1][key] = s; key = null; }
    } else if (c === '{') {
      const obj = {};
      if (key !== null) stack[stack.length - 1][key] = obj;
      stack.push(obj);
      key = null;
      i += 1;
    } else if (c === '}') {
      if (stack.length > 1) stack.pop();
      key = null;
      i += 1;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < n && text[i] !== '\n') i += 1;
    } else if (/\s/.test(c)) {
      i += 1;
    } else {
      // Значение без кавычек (редко) — до пробела или скобки.
      let s = '';
      while (i < n && !/[\s{}"]/.test(text[i])) { s += text[i]; i += 1; }
      if (key === null) key = s; else { stack[stack.length - 1][key] = s; key = null; }
    }
  }
  return root;
}
/** Ключ без учёта регистра (в файлах Steam бывает и «Software», и «software»). */
function ci(obj, ...keys) {
  let o = obj;
  for (const k of keys) {
    if (!o || typeof o !== 'object') return undefined;
    const hit = Object.keys(o).find((x) => x.toLowerCase() === k.toLowerCase());
    o = hit === undefined ? undefined : o[hit];
  }
  return o;
}

// ---------- Реестр Windows: «reg export» в .reg (UTF-16) и разбор ----------
function parseReg(text) {
  const out = {};
  let cur = null;
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  for (let k = 0; k < lines.length; k += 1) {
    let line = lines[k];
    while (line.endsWith('\\') && k + 1 < lines.length) { line = line.slice(0, -1) + lines[k + 1].trim(); k += 1; } // перенос длинных hex-значений
    const sec = /^\[(.+)\]$/.exec(line.trim());
    if (sec) { cur = {}; out[sec[1]] = cur; continue; }
    if (!cur) continue;
    const m = /^("(?:[^"\\]|\\.)*"|@)=(.*)$/.exec(line);
    if (!m) continue;
    const name = m[1] === '@' ? '' : m[1].slice(1, -1).replace(/\\(.)/g, '$1');
    const raw = m[2];
    if (raw.startsWith('"')) cur[name] = raw.slice(1, -1).replace(/\\(.)/g, '$1');
    else if (raw.startsWith('dword:')) cur[name] = parseInt(raw.slice(6), 16);
  }
  return out;
}
function regExport(key) {
  if (process.platform !== 'win32') return Promise.resolve({});
  const file = path.join(os.tmpdir(), `som-reg-${process.pid}-${crypto.randomBytes(4).toString('hex')}.reg`);
  return new Promise((resolve) => {
    execFile('reg', ['export', key, file, '/y'], { windowsHide: true, timeout: 8000 }, (err) => {
      if (err) { resolve({}); return; }
      let text = '';
      try { text = fs.readFileSync(file).toString('utf16le'); } catch { text = ''; }
      fs.rm(file, { force: true }, () => {});
      resolve(parseReg(text));
    });
  });
}
const lastPart = (k) => k.split('\\').pop();

// ---------- Где что лежит (подмена — только для проверок) ----------
function roots(isPackaged) {
  const test = !isPackaged && process.env.SOM_TEST_GAMES_ROOT;
  return {
    test,
    epicManifests: test ? path.join(test, 'Epic', 'Manifests') : path.join(process.env.ProgramData || 'C:\\ProgramData', 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests'),
  };
}
async function steamRoot(isPackaged) {
  const r = roots(isPackaged);
  if (r.test) return path.join(r.test, 'Steam');
  const reg = await regExport('HKCU\\Software\\Valve\\Steam');
  const v = Object.values(reg).find((x) => x.SteamPath)?.SteamPath;
  const guess = [v, 'C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam'].filter(Boolean).map((p) => path.normalize(p));
  return guess.find((p) => fs.existsSync(path.join(p, 'steamapps'))) || null;
}

// ---------- Steam ----------
const STEAM_SKIP = new Set([228980, 1070560, 1391110, 1628350, 1493710, 2180100, 250820, 1826330, 2348590, 2805730, 3658110]);
const STEAM_SKIP_NAME = /redistributable|steam linux runtime|^proton\b|steamvr|steamworks shared|steam audio/i;
async function steamGames(isPackaged) {
  const root = await steamRoot(isPackaged);
  if (!root) return { root: null, games: [] };
  const libs = new Set([path.join(root, 'steamapps')]);
  try {
    const lf = parseVdf(await fsp.readFile(path.join(root, 'steamapps', 'libraryfolders.vdf'), 'utf8'));
    const top = ci(lf, 'libraryfolders') || {};
    for (const v of Object.values(top)) {
      const p = typeof v === 'string' ? v : ci(v, 'path');
      if (typeof p === 'string' && p) libs.add(path.join(path.normalize(p), 'steamapps'));
    }
  } catch { /* только основная библиотека */ }
  // Время в игре и последний запуск — у последнего вошедшего пользователя.
  let stats = {};
  try {
    const lu = parseVdf(await fsp.readFile(path.join(root, 'config', 'loginusers.vdf'), 'utf8'));
    const users = ci(lu, 'users') || {};
    const ids = Object.keys(users);
    const sid = ids.find((k) => ci(users[k], 'MostRecent') === '1') || ids[0];
    if (sid) {
      const acc = (BigInt(sid) - 76561197960265728n).toString();
      const lc = parseVdf(await fsp.readFile(path.join(root, 'userdata', acc, 'config', 'localconfig.vdf'), 'utf8'));
      stats = ci(lc, 'UserLocalConfigStore', 'Software', 'Valve', 'Steam', 'apps') || {};
    }
  } catch { stats = {}; }
  const games = [];
  for (const lib of libs) {
    let files = [];
    try { files = (await fsp.readdir(lib)).filter((f) => /^appmanifest_\d+\.acf$/.test(f)); } catch { continue; }
    for (const f of files) {
      try {
        const st = ci(parseVdf(await fsp.readFile(path.join(lib, f), 'utf8')), 'AppState');
        const appid = Number(ci(st, 'appid'));
        const name = String(ci(st, 'name') || '').trim();
        if (!appid || !name || STEAM_SKIP.has(appid) || STEAM_SKIP_NAME.test(name)) continue;
        const flags = Number(ci(st, 'StateFlags')) || 0;
        const s = ci(stats, String(appid)) || {};
        const dir = path.join(lib, 'common', String(ci(st, 'installdir') || ''));
        games.push({
          id: `steam-${appid}`, src: 'steam', name, appid, dir,
          size: Number(ci(st, 'SizeOnDisk')) || 0,
          played: (Number(ci(s, 'LastPlayed')) || Number(ci(st, 'LastPlayed')) || 0) * 1000,
          minutes: Number(ci(s, 'Playtime')) || 0,
          ready: (flags & 4) === 4,
        });
      } catch { /* битый манифест — пропускаем */ }
    }
  }
  return { root, games };
}
/** Обложка из кэша Steam: старые имена <appid>_library_600x900.jpg и новые папки librarycache/<appid>/… */
function steamCover(root, appid) {
  if (!root) return null;
  const cache = path.join(root, 'appcache', 'librarycache');
  for (const flat of [`${appid}_library_600x900.jpg`, `${appid}_library_600x900_2x.jpg`, `${appid}_header.jpg`]) {
    if (fs.existsSync(path.join(cache, flat))) return path.join(cache, flat);
  }
  const found = [];
  const walk = (d, depth) => {
    let list = [];
    try { list = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of list) {
      if (e.isDirectory() && depth < 2) walk(path.join(d, e.name), depth + 1);
      else if (e.isFile()) found.push(path.join(d, e.name));
    }
  };
  walk(path.join(cache, String(appid)), 0);
  for (const re of [/^library_600x900(_2x)?\.(jpg|png)$/i, /^header\.(jpg|png)$/i, /^library_header(_2x)?\.(jpg|png)$/i]) {
    const hit = found.find((f) => re.test(path.basename(f)));
    if (hit) return hit;
  }
  return null;
}

// ---------- Epic Games ----------
async function epicGames(isPackaged) {
  const dir = roots(isPackaged).epicManifests;
  let files = [];
  try { files = (await fsp.readdir(dir)).filter((f) => f.toLowerCase().endsWith('.item')); } catch { return []; }
  const out = [];
  for (const f of files) {
    try {
      const m = JSON.parse(await fsp.readFile(path.join(dir, f), 'utf8'));
      const cats = (m.AppCategories || []).map((c) => String(c).toLowerCase());
      if (m.bIsIncompleteInstall || !m.DisplayName || !m.AppName || (cats.length && !cats.includes('games')) || cats.includes('addons') || cats.includes('plugins')) continue;
      out.push({
        id: `epic-${crypto.createHash('sha1').update(m.AppName).digest('hex').slice(0, 12)}`, src: 'epic', name: String(m.DisplayName).trim(),
        dir: m.InstallLocation || '', exe: m.InstallLocation && m.LaunchExecutable ? path.join(m.InstallLocation, m.LaunchExecutable) : '',
        size: Number(m.InstallSize) || 0, played: 0, minutes: 0, ready: true,
        launch: `com.epicgames.launcher://apps/${encodeURIComponent(m.CatalogNamespace || '')}%3A${encodeURIComponent(m.CatalogItemId || '')}%3A${encodeURIComponent(m.AppName)}?action=launch&silent=true`,
      });
    } catch { /* пропускаем */ }
  }
  return out;
}

// ---------- GOG Galaxy и Ubisoft Connect (реестр) ----------
async function gogGames() {
  const reg = { ...(await regExport('HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games')), ...(await regExport('HKLM\\SOFTWARE\\GOG.com\\Games')) };
  const out = [];
  for (const [k, v] of Object.entries(reg)) {
    const id = v.gameID || lastPart(k);
    if (!v.gameName || !/^\d+$/.test(String(id)) || !v.exe) continue;
    if (v.dependsOn) continue; // дополнения
    out.push({ id: `gog-${id}`, src: 'gog', name: String(v.gameName).trim(), dir: v.path || path.dirname(v.exe), exe: v.exe, cwd: v.workingDir || v.path || path.dirname(v.exe), size: 0, played: 0, minutes: 0, ready: true });
  }
  return out;
}
async function ubiGames() {
  const reg = await regExport('HKLM\\SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher\\Installs');
  const out = [];
  for (const [k, v] of Object.entries(reg)) {
    const id = lastPart(k);
    if (!/^\d+$/.test(id) || !v.InstallDir) continue;
    const dir = path.normalize(v.InstallDir);
    const name = path.basename(dir.replace(/[\\/]+$/, ''));
    if (!name) continue;
    out.push({ id: `ubi-${id}`, src: 'ubi', name, dir, size: 0, played: 0, minutes: 0, ready: true, launch: `uplay://launch/${id}/0` });
  }
  return out;
}

// ---------- Своё: добавленные игры, скрытые, свои обложки, когда запускали из Som ----------
function create({ userData, isPackaged, nativeImage, net, shell, getFileIcon }) {
  const FILE = path.join(userData, 'gamelib.json');
  const COVERS = path.join(userData, 'gamecovers');
  let cfg = { custom: [], hidden: [], names: {}, covers: {}, played: {} };
  try { cfg = { ...cfg, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; } catch { /* пусто */ }
  const save = () => { try { fs.mkdirSync(userData, { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(cfg)); } catch { /* не страшно */ } };
  let last = { at: 0, games: [], steamRoot: null };
  let scanning = null;

  async function scan() {
    if (scanning) return scanning;
    scanning = (async () => {
      const [st, epic, gog, ubi] = await Promise.all([
        steamGames(isPackaged).catch(() => ({ root: null, games: [] })),
        epicGames(isPackaged).catch(() => []),
        gogGames().catch(() => []),
        ubiGames().catch(() => []),
      ]);
      const custom = cfg.custom.filter((c) => c && c.id && c.name && (c.exe || c.url)).map((c) => ({
        id: c.id, src: 'my', name: c.name, exe: c.exe || '', url: c.url || '', dir: c.exe ? path.dirname(c.exe) : '', size: 0, played: 0, minutes: 0,
        ready: c.url ? true : fs.existsSync(c.exe),
      }));
      const all = [...st.games, ...epic, ...gog, ...ubi, ...custom].map((g) => ({
        ...g,
        name: cfg.names[g.id] || g.name,
        played: Math.max(g.played || 0, cfg.played[g.id] || 0),
      }));
      last = { at: Date.now(), games: all, steamRoot: st.root };
      return last;
    })().finally(() => { scanning = null; });
    return scanning;
  }
  /** Что отдать окну: без путей к exe и команд — запускает только главный процесс по id. */
  function view(list, includeHidden) {
    const hidden = new Set(cfg.hidden);
    return list.filter((g) => includeHidden || !hidden.has(g.id)).map((g) => ({
      id: g.id, src: g.src, name: g.name, appid: g.appid || null, size: g.size, played: g.played, minutes: g.minutes, ready: g.ready,
      hidden: hidden.has(g.id), hasDir: Boolean(g.dir), custom: g.src === 'my', cover: `somlib://cover/${g.id}.jpg?v=${encodeURIComponent(cfg.covers[g.id] || '1')}`,
    }));
  }
  async function list({ refresh = false, hidden = false } = {}) {
    const r = refresh || !last.at || Date.now() - last.at > 60_000 ? await scan() : last;
    return { games: view(r.games, hidden), sources: [...new Set(r.games.map((g) => g.src))], hiddenCount: r.games.filter((g) => cfg.hidden.includes(g.id)).length };
  }
  const byId = (id) => last.games.find((g) => g.id === id) || null;

  async function launch(id) {
    if (!last.at) await scan();
    const g = byId(id);
    if (!g) return { ok: false, error: 'Игра не найдена — обновите список' };
    cfg.played[id] = Date.now();
    save();
    try {
      if (g.src === 'steam') await shell.openExternal(`steam://rungameid/${g.appid}`);
      else if (g.launch) await shell.openExternal(g.launch);
      else if (g.url) await shell.openExternal(g.url);
      else if (g.exe) {
        if (!fs.existsSync(g.exe)) return { ok: false, error: 'Файл игры не найден — её удалили или перенесли?' };
        if (/\.(lnk)$/i.test(g.exe)) { const err = await shell.openPath(g.exe); if (err) return { ok: false, error: err }; } else {
          const p = spawn(g.exe, [], { cwd: g.cwd || path.dirname(g.exe), detached: true, stdio: 'ignore', windowsHide: false });
          p.on('error', () => {});
          p.unref();
        }
      } else return { ok: false, error: 'Непонятно, как запустить эту игру' };
    } catch (err) { return { ok: false, error: err.message }; }
    return { ok: true, name: g.name };
  }
  function openDir(id) {
    const g = byId(id);
    if (!g?.dir || !fs.existsSync(g.dir)) return false;
    shell.openPath(g.dir).catch(() => {});
    return true;
  }

  /** Добавить свою игру: .exe, ярлык (.lnk) или интернет-ярлык (.url — Battle.net, EA, Riot и т. п.). */
  function addFile(file) {
    if (typeof file !== 'string' || !file) return { ok: false };
    const ext = path.extname(file).toLowerCase();
    let exe = '';
    let url = '';
    if (ext === '.exe') exe = file;
    else if (ext === '.lnk') {
      try { const t = shell.readShortcutLink(file).target; exe = t && /\.exe$/i.test(t) ? t : file; } catch { exe = file; }
    } else if (ext === '.url') {
      try { url = (/^URL=(.+)$/mi.exec(fs.readFileSync(file, 'utf8')) || [])[1]?.trim() || ''; } catch { url = ''; }
      if (!/^[a-z][a-z0-9+.-]{1,30}:/i.test(url) || /^(file|javascript|data|vbscript):/i.test(url)) return { ok: false, error: 'В ярлыке нет ссылки для запуска' };
    } else return { ok: false, error: 'Нужен .exe или ярлык игры' };
    const name = path.basename(file, path.extname(file)).replace(/[_.]+/g, ' ').trim().slice(0, 60) || 'Игра';
    const id = `my-${crypto.randomBytes(6).toString('hex')}`;
    cfg.custom.push({ id, name, exe, url });
    save();
    last.at = 0;
    return { ok: true, id, name };
  }
  function setName(id, name) {
    const n = String(name || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 60);
    if (!n) return false;
    const c = cfg.custom.find((x) => x.id === id);
    if (c) c.name = n; else cfg.names[id] = n;
    save();
    const g = byId(id);
    if (g) g.name = n;
    return true;
  }
  function setHidden(id, on) {
    const c = cfg.custom.findIndex((x) => x.id === id);
    if (c >= 0 && on) { cfg.custom.splice(c, 1); delete cfg.names[id]; } // свою игру — убираем совсем
    else cfg.hidden = on ? [...new Set([...cfg.hidden, id])] : cfg.hidden.filter((x) => x !== id);
    save();
    if (c >= 0 && on) last.games = last.games.filter((g) => g.id !== id);
    return true;
  }
  async function setCover(id, file) {
    if (!/^[a-z]+-[a-z0-9]{1,24}$/.test(id) || typeof file !== 'string') return false;
    const im = nativeImage.createFromPath(file);
    if (im.isEmpty()) return false;
    await fsp.mkdir(COVERS, { recursive: true });
    await fsp.writeFile(path.join(COVERS, `${id}.own.jpg`), fit(im).toJPEG(85));
    cfg.covers[id] = `own-${Date.now()}`;
    save();
    return true;
  }
  const fit = (im) => {
    const { width, height } = im.getSize();
    // Плитка 2:3; шире — обрезаем по центру, чтобы не было полос.
    const want = 2 / 3;
    let crop = { x: 0, y: 0, width, height };
    if (width / height > want * 1.15) { const w = Math.round(height * want); crop = { x: Math.round((width - w) / 2), y: 0, width: w, height }; }
    const c = crop.width === width ? im : im.crop(crop);
    return c.getSize().width > 360 ? c.resize({ width: 360, quality: 'good' }) : c;
  };

  /** somlib://cover/<id>.jpg — обложка: своя, из кэша Steam, с CDN Steam или значок exe. */
  async function cover(name) {
    const id = String(name || '').replace(/\.jpg$/, '');
    if (!/^[a-z]+-[a-z0-9]{1,24}$/.test(id)) return null;
    const own = path.join(COVERS, `${id}.own.jpg`);
    if (fs.existsSync(own)) return { body: await fsp.readFile(own), type: 'image/jpeg' };
    const cached = path.join(COVERS, `${id}.jpg`);
    if (fs.existsSync(cached)) return { body: await fsp.readFile(cached), type: 'image/jpeg' };
    if (!last.at) await scan();
    const g = byId(id);
    if (!g) return null;
    let im = null;
    let wide = false;
    if (g.src === 'steam') {
      const local = steamCover(last.steamRoot, g.appid);
      if (local) { im = nativeImage.createFromPath(local); wide = /header/i.test(path.basename(local)); }
      if (!im || im.isEmpty()) {
        for (const u of [`https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${g.appid}/library_600x900.jpg`, `https://cdn.akamai.steamstatic.com/steam/apps/${g.appid}/library_600x900.jpg`]) {
          try {
            const res = await net.fetch(u);
            if (res.ok && /^image\//.test(res.headers.get('content-type') || '')) { im = nativeImage.createFromBuffer(Buffer.from(await res.arrayBuffer())); if (!im.isEmpty()) break; }
          } catch { /* дальше */ }
        }
      }
    }
    if (im && !im.isEmpty()) {
      const out = (wide ? im : fit(im)).toJPEG(82);
      await fsp.mkdir(COVERS, { recursive: true });
      await fsp.writeFile(cached, out).catch(() => {});
      return { body: out, type: 'image/jpeg' };
    }
    // Нет обложки — значок программы (окно нарисует плитку с ним).
    if (g.exe && /\.exe$/i.test(g.exe) && fs.existsSync(g.exe)) {
      try { const ic = await getFileIcon(g.exe, { size: 'large' }); if (!ic.isEmpty()) return { body: ic.toPNG(), type: 'image/png', icon: true }; } catch { /* без значка */ }
    }
    return null;
  }

  return { list, launch, openDir, addFile, setName, setHidden, setCover, cover, scan, steamCoverFor: (appid) => steamCover(last.steamRoot, appid) };
}

module.exports = { create, parseVdf, parseReg, ci };
