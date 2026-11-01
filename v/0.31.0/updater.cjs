// Обновления Som через GitHub (публичный репозиторий с готовыми сборками).
//
// Раз в 2 часа (и по кнопке) читаем latest.json. Если там версия новее — скачиваем её файлы
// в %APPDATA%\Som-updates\<версия>.tmp, сверяем SHA-256 каждого, переименовываем в <версия>
// и кладём ready.json. Запустит новую версию загрузчик boot.js при следующем старте Som.
// Если новой версии нужна другая Electron (рантайм), сама она не поставится — Som скажет
// скачать полную сборку.
'use strict';

const { app, net } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');

// SOM_UPDATE_URL — только для проверки обновлений на тестовом сервере.
const REPO = 'AlWont/som-releases';
const REPO_RAW = process.env.SOM_UPDATE_URL || `https://raw.githubusercontent.com/${REPO}/main`;
const CHECK_EVERY = 2 * 60 * 60 * 1000;
const boot = global.somBoot || { base: path.join(app.getPath('appData'), 'Som-updates'), running: null };
const BASE = boot.base;
const STATE = path.join(BASE, 'state.json');

let running = '0.0.0';
let listener = () => {};
const S = { status: 'idle', latest: null, ready: null, error: null, checkedAt: 0, progress: 0, notes: '' };

function cmp(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i += 1) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}
function emit() { listener({ ...S, running }); }
function readState() { try { return JSON.parse(fsSync.readFileSync(STATE, 'utf8')); } catch { return {}; } }
function writeState(s) { try { fsSync.mkdirSync(BASE, { recursive: true }); fsSync.writeFileSync(STATE, JSON.stringify(s)); } catch { /* не страшно */ } }

async function fetchBuf(url) {
  const res = await net.fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText || ''}`.trim());
  return Buffer.from(await res.arrayBuffer());
}

// raw.githubusercontent.com держит копию «main» до 5 минут (и не смотрит на ?t=), поэтому свежий выпуск
// мог быть не виден. Спрашиваем у GitHub последний коммит и берём файлы по нему: такой адрес не устаревает.
// Не ответил GitHub API (лимит, сеть) — берём как раньше, через «main».
async function freshBase() {
  if (process.env.SOM_UPDATE_URL) return REPO_RAW;
  try {
    const res = await net.fetch(`https://api.github.com/repos/${REPO}/commits/main`, {
      headers: { Accept: 'application/vnd.github.sha', 'User-Agent': 'Som-updater' },
      cache: 'no-store',
    });
    if (res.ok) {
      const sha = (await res.text()).trim();
      if (/^[0-9a-f]{40}$/.test(sha)) return `https://raw.githubusercontent.com/${REPO}/${sha}`;
    }
  } catch { /* как раньше */ }
  return REPO_RAW;
}

// Путь файла из манифеста не должен выходить за папку версии.
function safeRel(p) {
  if (typeof p !== 'string' || !p || p.includes('\\') || p.startsWith('/') || p.split('/').some((x) => x === '..' || x === '')) return null;
  return p;
}

async function check(manual = false) {
  if (S.status === 'downloading') return { ...S, running };
  S.status = 'checking';
  S.error = null;
  emit();
  try {
    const base = await freshBase();
    const manifest = JSON.parse((await fetchBuf(`${base}/latest.json`)).toString('utf8'));
    S.checkedAt = Date.now();
    S.latest = manifest.version;
    S.notes = String(manifest.notes || '').slice(0, 2000);
    if (!/^\d+\.\d+\.\d+$/.test(manifest.version || '') || cmp(manifest.version, running) <= 0) {
      S.status = 'uptodate';
      emit();
      return { ...S, running };
    }
    if (manifest.electron && manifest.electron !== process.versions.electron) {
      S.status = 'manual';
      emit();
      return { ...S, running };
    }
    const dir = path.join(BASE, manifest.version);
    if (fsSync.existsSync(path.join(dir, 'ready.json'))) {
      S.status = 'ready';
      S.ready = manifest.version;
      emit();
      return { ...S, running };
    }
    await download(manifest, base);
  } catch (err) {
    S.status = 'error';
    S.error = err.message;
    emit();
    if (manual) return { ...S, running };
  }
  return { ...S, running };
}

async function download(manifest, base = REPO_RAW) {
  S.status = 'downloading';
  S.progress = 0;
  emit();
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  if (!files.length || !files.some((f) => f.path === 'main.js')) throw new Error('в обновлении нет файлов');
  const total = files.reduce((n, f) => n + (Number(f.size) || 0), 0);
  const tmp = path.join(BASE, `${manifest.version}.tmp`);
  await fs.rm(tmp, { recursive: true, force: true });
  let done = 0;
  for (const f of files) {
    const rel = safeRel(f.path);
    if (!rel || !/^[0-9a-f]{64}$/.test(f.sha256 || '')) throw new Error(`плохая запись в манифесте: ${f.path}`);
    const buf = await fetchBuf(`${base}/v/${manifest.version}/${rel.split('/').map(encodeURIComponent).join('/')}`);
    const sum = crypto.createHash('sha256').update(buf).digest('hex');
    if (sum !== f.sha256) throw new Error(`файл ${rel} повреждён при загрузке`);
    const out = path.join(tmp, ...rel.split('/'));
    await fs.mkdir(path.dirname(out), { recursive: true });
    await fs.writeFile(out, buf, { mode: rel.startsWith('core/bin/') ? 0o755 : 0o644 });
    done += buf.length;
    S.progress = total ? done / total : 0;
    emit();
  }
  // Опись файлов версии — по ней выданная под ключ копия проверяет, что программу не меняли.
  await fs.writeFile(path.join(tmp, 'files.json'), JSON.stringify(files.map((f) => ({ path: f.path, sha256: f.sha256 }))));
  await fs.writeFile(path.join(tmp, 'ready.json'), JSON.stringify({ version: manifest.version, at: Date.now() }));
  const dir = path.join(BASE, manifest.version);
  await fs.rm(dir, { recursive: true, force: true });
  await fs.rename(tmp, dir);
  S.status = 'ready';
  S.ready = manifest.version;
  emit();
}

/** Эта версия запустилась и работает — больше не откатывать её. Заодно убираем старые версии. */
function markGood() {
  const st = readState();
  if (st.good === running && !st.trying) return;
  writeState({ ...st, good: running, trying: null, attempts: 0 });
  // Оставляем текущую и одну предыдущую версию.
  try {
    const versions = fsSync.readdirSync(BASE).filter((d) => /^\d+\.\d+\.\d+$/.test(d)).sort(cmp);
    const keep = new Set([running, versions.filter((v) => cmp(v, running) < 0).pop()].filter(Boolean));
    for (const v of versions) if (!keep.has(v) && cmp(v, running) < 0) fsSync.rmSync(path.join(BASE, v), { recursive: true, force: true });
  } catch { /* не страшно */ }
}

function start(version, onState) {
  running = version;
  listener = onState;
  setTimeout(() => check(), 20_000);
  setInterval(() => check(), CHECK_EVERY).unref?.();
}

function restart() {
  app.relaunch();
  app.quit();
}

module.exports = { start, check, markGood, restart, state: () => ({ ...S, running }) };
