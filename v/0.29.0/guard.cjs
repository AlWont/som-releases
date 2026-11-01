// Копии Som, выданные под ключ («Som Ключ»), и удаление всего, что связано с Som.
//
// Файл выдачи som-provision.json лежит в папке resources рядом с Som.exe (обновления его не трогают):
// кто выдал, кому, сколько неверных ключей можно до удаления, удалять ли при вмешательстве в файлы,
// и проверочный хэш ключа (scrypt) — им ключ проверяется при первом запуске, пока хранилища ещё нет.
// Дальше ключ закрывает ключ хранилища в ядре: удалить или подменить файлы, чтобы обойти ключ, нельзя —
// без ключа переписку не расшифровать.
//
// «Вмешательство в файлы» — то, что можно заметить при следующем запуске: изменённые или лишние файлы
// программы (сверяем SHA-256 с описью som-files.json из сборки), удалённый ключ хранилища, подменённый
// или удалённый файл выдачи. Просто прочитать файлы незаметно — но и бесполезно: всё зашифровано.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PROV_FILE = 'som-provision.json';
const FILES_FILE = 'som-files.json';

/** Ключ, как его ни введи: без пробелов и дефисов, заглавными. Так же нормализует «Som Ключ». */
const normKey = (s) => String(s || '').replace(/[\s-]+/g, '').toUpperCase();

/** Прочитать файл выдачи. null — копия обычная; { broken: true } — файл есть, но испорчен. */
function loadProvision(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return null; }
  try {
    const p = JSON.parse(raw);
    const kdf = p.kdf || {};
    const ok = p.som === 'provision' && p.v === 1 && /^[0-9a-f]{32}$/.test(p.id || '')
      && Number.isInteger(p.attempts) && p.attempts >= 0 && p.attempts <= 20 && typeof p.tamper === 'boolean'
      && kdf.alg === 'scrypt' && kdf.log_n === 15 && kdf.r === 8 && kdf.p === 1
      && typeof kdf.salt === 'string' && Buffer.from(kdf.salt, 'base64').length >= 16
      && typeof p.check === 'string' && Buffer.from(p.check, 'base64').length === 32;
    if (!ok) return { broken: true };
    const clip = (x) => String(x || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 40);
    return { id: p.id, by: clip(p.by), for: clip(p.for), attempts: p.attempts, tamper: p.tamper, salt: kdf.salt, check: p.check, created: clip(p.created) };
  } catch { return { broken: true }; }
}

/** Ключ подходит к файлу выдачи? */
function checkProvKey(prov, key) {
  if (!prov || prov.broken) return false;
  const got = crypto.scryptSync(normKey(key), Buffer.from(prov.salt, 'base64'), 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const want = Buffer.from(prov.check, 'base64');
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

function walk(dir, rel = '', out = []) {
  let list = [];
  try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of list) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) walk(path.join(dir, e.name), r, out);
    else out.push(r);
  }
  return out;
}
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/** Сверить папку с описью { путь: sha256 }: изменённые, пропавшие и лишние файлы. skip — служебные файлы папки. */
function verifyDir(dir, list, skip = []) {
  const bad = [];
  if (!list || typeof list !== 'object') return { ok: false, bad: ['нет описи файлов'] };
  const want = new Map(Object.entries(list));
  for (const rel of walk(dir)) {
    if (skip.includes(rel)) continue;
    const h = want.get(rel);
    if (!h) { bad.push(`лишний файл ${rel}`); continue; }
    want.delete(rel);
    try { if (sha(path.join(dir, ...rel.split('/'))) !== h) bad.push(`изменён ${rel}`); } catch { bad.push(`не читается ${rel}`); }
  }
  for (const rel of want.keys()) bad.push(`пропал ${rel}`);
  return { ok: !bad.length, bad };
}

/**
 * Файлы программы не меняли? Встроенная версия (resources/app — оттуда всегда стартует загрузчик)
 * и, если Som запущен из обновления, папка обновления (опись files.json пишет updater).
 */
function verifyProgram({ resources, boot }) {
  let manifest = null;
  try { manifest = JSON.parse(fs.readFileSync(path.join(resources, FILES_FILE), 'utf8')); } catch { return { ok: false, bad: ['пропала опись файлов программы'] }; }
  const base = verifyDir(path.join(resources, 'app'), manifest.app);
  if (!base.ok) return base;
  if (boot?.fromUpdate && boot.base && boot.running) {
    const dir = path.join(boot.base, boot.running);
    let files = null;
    try { files = JSON.parse(fs.readFileSync(path.join(dir, 'files.json'), 'utf8')); } catch { return { ok: false, bad: [`нет описи обновления ${boot.running}`] }; }
    const list = Object.fromEntries((Array.isArray(files) ? files : []).map((f) => [f.path, f.sha256]));
    return verifyDir(dir, list, ['ready.json', 'files.json']);
  }
  return { ok: true, bad: [] };
}

/** Папки данных Som на этом ПК: все профили и обновления. Берём только то, что точно наше. */
function dataDirs(appData) {
  const out = [];
  let names = [];
  try { names = fs.readdirSync(appData); } catch { return out; }
  for (const n of names) {
    const dir = path.join(appData, n);
    if (n === 'Som-updates') { out.push(dir); continue; }
    if (n !== 'Som' && !/^Som-[a-z0-9]{1,16}$/.test(n)) continue;
    // Профиль Som: есть папка ядра или настройки окна Som.
    if (['core', 'lock.json', 'window.json'].some((m) => fs.existsSync(path.join(dir, m)))) out.push(dir);
  }
  return out;
}

const psq = (s) => `'${String(s).replace(/'/g, "''")}'`;
/**
 * Скрипт, который после выхода Som удалит папки данных и саму программу (только файлы из описи сборки;
 * папка программы удаляется, только если в ней больше ничего нет). PowerShell с -EncodedCommand:
 * пути с русскими буквами доходят без искажений.
 */
function cleanupScript({ pid, dirs, installDir, top, shortcut }) {
  const L = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    `Wait-Process -Id ${Number(pid)} -Timeout 60`,
    'Start-Sleep -Milliseconds 800',
    `$dirs = @(${dirs.map(psq).join(', ')})`,
    `$inst = ${installDir ? psq(installDir) : '$null'}`,
    `$top = @(${(top || []).filter((n) => typeof n === 'string' && n && !/[\\/:]|^\.\.?$/.test(n)).map(psq).join(', ')})`,
    'for ($i = 0; $i -lt 6; $i++) {',
    '  foreach ($d in $dirs) { if (Test-Path -LiteralPath $d) { Remove-Item -LiteralPath $d -Recurse -Force } }',
    '  if ($inst) { foreach ($n in $top) { $p = Join-Path $inst $n; if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Recurse -Force } } }',
    '  $left = @($dirs | Where-Object { Test-Path -LiteralPath $_ })',
    '  if ($inst) { $left += @($top | Where-Object { Test-Path -LiteralPath (Join-Path $inst $_) }) }',
    '  if ($left.Count -eq 0) { break }',
    '  Start-Sleep -Seconds 2',
    '}',
    'if ($inst -and (Test-Path -LiteralPath $inst) -and -not (Get-ChildItem -LiteralPath $inst -Force)) { Remove-Item -LiteralPath $inst -Force }',
    shortcut ? `Remove-Item -LiteralPath ${psq(shortcut)} -Force` : '',
  ];
  return L.filter(Boolean).join('\n');
}

module.exports = { PROV_FILE, FILES_FILE, normKey, loadProvision, checkProvKey, verifyDir, verifyProgram, dataDirs, cleanupScript, walk };
