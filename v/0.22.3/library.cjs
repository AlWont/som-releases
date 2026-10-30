// Свои стикеры и звуки звуковой панели. Хранятся на этом ПК в папке профиля, окну отдаются через somlib://.
//
// Стикеры — наборами: stickers/<набор>/<файл>, список — stickers/index.json.
// Набор можно отправить другу одним файлом .sompack: «SOMSTK1\n», длина заголовка (4 байта), JSON-заголовок, данные подряд.
'use strict';

const { app } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const SCHEME = 'somlib';
const MAX_STICKER = 2 * 1024 * 1024;
const MAX_SOUND = 1024 * 1024;
const MAX_PACK_ITEMS = 120;
const STICKER_TYPES = { 'image/webp': 'webp', 'image/png': 'png', 'image/gif': 'gif', 'image/jpeg': 'jpg', 'image/apng': 'png', 'video/webm': 'webm' };
const SOUND_TYPES = { 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/flac': 'flac' };
const MAGIC = Buffer.from('SOMSTK1\n');

const root = () => app.getPath('userData');
const sdir = () => path.join(root(), 'stickers');
const adir = () => path.join(root(), 'sounds');
const newId = () => crypto.randomBytes(6).toString('hex');
const okId = (s) => typeof s === 'string' && /^[0-9a-f]{12}$/.test(s);
const cleanName = (s, def) => String(s || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 40) || def;

function readJson(file, def) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return def; } }
async function writeJson(file, data) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(data));
  await fsp.rename(tmp, file);
}

// ---------- Стикеры ----------
let ST = null;
function stickers() {
  if (!ST) {
    ST = readJson(path.join(sdir(), 'index.json'), null);
    if (!ST || !Array.isArray(ST.packs)) ST = { packs: [], recent: [] };
  }
  return ST;
}
const saveStickers = () => writeJson(path.join(sdir(), 'index.json'), ST);
const packById = (id) => stickers().packs.find((p) => p.id === id) || null;

function newPack(name) {
  const p = { id: newId(), name: cleanName(name, 'Мои стикеры'), items: [] };
  stickers().packs.push(p);
  return p;
}
/** Добавить стикеры: items — [{ bytes, mime, w, h }]. Набор создаётся, если его нет. */
async function addStickers(packId, packName, items) {
  let pack = packById(packId) || newPack(packName);
  const added = [];
  for (const it of (Array.isArray(items) ? items : []).slice(0, MAX_PACK_ITEMS)) {
    const ext = STICKER_TYPES[it?.mime];
    if (!ext || !(it.bytes instanceof Uint8Array) || !it.bytes.length || it.bytes.length > MAX_STICKER) continue;
    if (pack.items.length >= MAX_PACK_ITEMS) pack = newPack(`${pack.name} (2)`);
    const id = newId();
    const file = `${id}.${ext}`;
    await fsp.mkdir(path.join(sdir(), pack.id), { recursive: true });
    await fsp.writeFile(path.join(sdir(), pack.id, file), it.bytes);
    pack.items.push({ id, file, mime: it.mime, w: Math.min(4096, Number(it.w) || 0), h: Math.min(4096, Number(it.h) || 0) });
    added.push(id);
  }
  await saveStickers();
  return { pack: pack.id, added: added.length };
}
async function removeSticker(packId, id) {
  const p = packById(packId);
  if (!p) return;
  const it = p.items.find((x) => x.id === id);
  if (!it) return;
  p.items = p.items.filter((x) => x.id !== id);
  ST.recent = (ST.recent || []).filter((r) => r !== `${packId}/${id}`);
  await fsp.rm(path.join(sdir(), p.id, it.file), { force: true });
  await saveStickers();
}
async function renamePack(packId, name) {
  const p = packById(packId);
  if (p) { p.name = cleanName(name, p.name); await saveStickers(); }
}
async function deletePack(packId) {
  const p = packById(packId);
  if (!p) return;
  ST.packs = ST.packs.filter((x) => x !== p);
  ST.recent = (ST.recent || []).filter((r) => !r.startsWith(`${packId}/`));
  await fsp.rm(path.join(sdir(), p.id), { recursive: true, force: true });
  await saveStickers();
}
function stickerFile(packId, id) {
  const p = packById(packId);
  const it = p?.items.find((x) => x.id === id);
  return it ? { ...it, file: path.join(sdir(), p.id, it.file) } : null;
}
async function touchRecent(packId, id) {
  const key = `${packId}/${id}`;
  stickers().recent = [key, ...(ST.recent || []).filter((r) => r !== key)].slice(0, 24);
  await saveStickers();
}
/** Набор одним файлом — чтобы отправить другу. */
async function packFile(packId, dir) {
  const p = packById(packId);
  if (!p || !p.items.length) throw new Error('набор пустой');
  const blobs = [];
  const items = [];
  for (const it of p.items) {
    const b = await fsp.readFile(path.join(sdir(), p.id, it.file)).catch(() => null);
    if (!b) continue;
    blobs.push(b);
    items.push({ mime: it.mime, w: it.w, h: it.h, size: b.length });
  }
  const head = Buffer.from(JSON.stringify({ v: 1, name: p.name, items }));
  const len = Buffer.alloc(4);
  len.writeUInt32LE(head.length);
  const safe = p.name.replace(/[\\/:*?"<>|]/g, '_');
  const out = path.join(dir, `${safe}.sompack`);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(out, Buffer.concat([MAGIC, len, head, ...blobs]));
  return { file: out, name: `${safe}.sompack`, count: items.length };
}
/** Принять набор из файла .sompack (байты). */
async function importPack(bytes) {
  const b = Buffer.from(bytes);
  if (b.length < 16 || !b.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('это не набор стикеров Som');
  const hl = b.readUInt32LE(MAGIC.length);
  if (hl > 200_000 || MAGIC.length + 4 + hl > b.length) throw new Error('набор повреждён');
  const head = JSON.parse(b.subarray(MAGIC.length + 4, MAGIC.length + 4 + hl).toString('utf8'));
  let off = MAGIC.length + 4 + hl;
  const items = [];
  for (const it of (Array.isArray(head.items) ? head.items : []).slice(0, MAX_PACK_ITEMS)) {
    const size = Number(it.size) || 0;
    if (size <= 0 || size > MAX_STICKER || off + size > b.length) break;
    items.push({ bytes: new Uint8Array(b.subarray(off, off + size)), mime: it.mime, w: it.w, h: it.h });
    off += size;
  }
  if (!items.length) throw new Error('в наборе нет стикеров');
  return addStickers(null, head.name, items);
}

// ---------- Звуки ----------
let SN = null;
function sounds() {
  if (!SN) {
    SN = readJson(path.join(adir(), 'index.json'), null);
    if (!SN || !Array.isArray(SN.items)) SN = { items: [] };
  }
  return SN;
}
const saveSounds = () => writeJson(path.join(adir(), 'index.json'), SN);
async function addSound({ bytes, mime, name, emoji }) {
  const ext = SOUND_TYPES[mime];
  if (!ext) throw new Error('такой звук Som не понимает — нужен mp3, ogg, wav или m4a');
  if (!(bytes instanceof Uint8Array) || !bytes.length) throw new Error('пустой файл');
  if (bytes.length > MAX_SOUND) throw new Error('звук больше 1 МБ — обрежьте его до 10 секунд');
  if (sounds().items.length >= 60) throw new Error('звуков уже 60 — удалите лишние');
  const id = newId();
  await fsp.mkdir(adir(), { recursive: true });
  await fsp.writeFile(path.join(adir(), `${id}.${ext}`), bytes);
  SN.items.push({ id, file: `${id}.${ext}`, mime, name: cleanName(name, 'Звук'), emoji: String(emoji || '🔊').slice(0, 8) });
  await saveSounds();
  return id;
}
async function editSound(id, patch) {
  const s = sounds().items.find((x) => x.id === id);
  if (!s) return;
  if (patch?.name != null) s.name = cleanName(patch.name, s.name);
  if (patch?.emoji != null) s.emoji = String(patch.emoji).slice(0, 8) || s.emoji;
  if (patch?.remove) {
    SN.items = SN.items.filter((x) => x !== s);
    await fsp.rm(path.join(adir(), s.file), { force: true });
  }
  await saveSounds();
}

// ---------- somlib:// ----------
const MIME_OF = { webp: 'image/webp', png: 'image/png', gif: 'image/gif', jpg: 'image/jpeg', webm: 'video/webm', mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac' };
async function serve(request) {
  const u = new URL(request.url);
  const parts = u.pathname.split('/').filter(Boolean);
  let file = null;
  if (u.host === 'sticker' && parts.length === 2 && okId(parts[0]) && /^[0-9a-f]{12}\.[a-z0-9]{2,4}$/.test(parts[1])) file = path.join(sdir(), parts[0], parts[1]);
  if (u.host === 'sound' && parts.length === 1 && /^[0-9a-f]{12}\.[a-z0-9]{2,4}$/.test(parts[0])) file = path.join(adir(), parts[0]);
  if (!file) return new Response('', { status: 404 });
  try {
    const body = await fsp.readFile(file);
    return new Response(body, { status: 200, headers: { 'content-type': MIME_OF[path.extname(file).slice(1)] || 'application/octet-stream', 'cache-control': 'max-age=31536000, immutable', 'access-control-allow-origin': 'som://app' } });
  } catch { return new Response('', { status: 404 }); }
}

/** После переноса профиля файлы стикеров и звуков новые — перечитать списки. */
function reset() { ST = null; SN = null; }

module.exports = {
  reset,
  SCHEME, serve,
  stickers: () => stickers(), addStickers, removeSticker, renamePack, deletePack, stickerFile, touchRecent, packFile, importPack, newPack: async (name) => { const p = newPack(name); await saveStickers(); return p.id; },
  sounds: () => sounds(), addSound, editSound,
};
