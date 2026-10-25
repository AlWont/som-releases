// Радио: станции из открытого каталога Radio Browser, звук — через свой протокол somradio://.
//
// Зачем поток идёт через главный процесс: многие станции отдают звук по http, а окно Som — «защищённая»
// страница, которой браузер не даст играть http-звук. Заодно вырезаем из потока ICY-метаданные
// (Shoutcast/Icecast вставляют их каждые N байт) и достаём «что сейчас играет».
// Звук и картинки станций качаются напрямую с их серверов — станции видят IP, как обычный сайт.
'use strict';

const { net } = require('electron');
const crypto = require('node:crypto');

// SOM_RADIO_API — только для автотестов (свой каталог и станции на этом ПК).
const TEST_API = process.env.SOM_RADIO_API || '';
const HOSTS = TEST_API ? [TEST_API] : ['de1', 'de2', 'fi1', 'nl1'].map((h) => `https://${h}.api.radio-browser.info`);
const OK_CODECS = new Set(['MP3', 'AAC', 'AAC+', 'OGG', 'OPUS', 'FLAC', 'UNKNOWN', '']);
const ORDERS = new Set(['clickcount', 'votes', 'name', 'random']);

let UA = 'Som';
let good = 0; // индекс зеркала, которое ответило последним
let onMeta = () => {};

const str = (v, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');
function httpUrl(v) {
  try {
    const u = new URL(String(v));
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    // Не ходим «радио» на этот же компьютер (кроме автотестов).
    if (!TEST_API && /^(localhost|127\.|0\.0\.0\.0|\[::1\])/i.test(u.host)) return '';
    return u.href.slice(0, 2000);
  } catch { return ''; }
}

async function api(pathq, timeout = 8000) {
  let lastErr = null;
  for (let k = 0; k < HOSTS.length; k += 1) {
    const i = (good + k) % HOSTS.length;
    try {
      const res = await net.fetch(`${HOSTS[i]}${pathq}`, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(timeout), cache: 'no-store' });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      good = i;
      return data;
    } catch (err) { lastErr = err; }
  }
  throw new Error(`каталог станций не ответил${lastErr ? ` (${lastErr.message})` : ''}`);
}

/** Станция из каталога → только то, что нужно окну. */
function clean(s) {
  const url = httpUrl(s.url_resolved) || httpUrl(s.url);
  const codec = str(s.codec, 20).toUpperCase();
  if (!url || Number(s.hls) === 1 || !OK_CODECS.has(codec)) return null;
  return {
    id: str(s.stationuuid, 64),
    name: str(s.name, 120).trim() || 'Без названия',
    url,
    home: httpUrl(s.homepage),
    logo: httpUrl(s.favicon),
    tags: str(s.tags, 300).split(',').map((t) => t.trim()).filter(Boolean).slice(0, 4),
    country: str(s.country, 60),
    cc: str(s.countrycode, 4).toUpperCase(),
    codec,
    bitrate: Number(s.bitrate) || 0,
    votes: Number(s.votes) || 0,
  };
}

/** Поиск: q — название, tag — жанр, cc — страна. */
async function search({ q = '', tag = '', cc = '', order = 'clickcount', limit = 40, offset = 0 } = {}) {
  const p = new URLSearchParams({ hidebroken: 'true', limit: String(Math.max(1, Math.min(60, Number(limit) || 40)) + 10), offset: String(Math.max(0, Number(offset) || 0)) });
  if (q) p.set('name', str(q, 80));
  if (tag) p.set('tag', str(tag, 40));
  if (cc && /^[A-Za-z]{2}$/.test(cc)) p.set('countrycode', cc.toUpperCase());
  const ord = ORDERS.has(order) ? order : 'clickcount';
  p.set('order', ord);
  if (ord !== 'name') p.set('reverse', 'true');
  const list = await api(`/json/stations/search?${p}`);
  const out = [];
  const seen = new Set();
  for (const s of Array.isArray(list) ? list : []) {
    const st = clean(s);
    if (!st || !st.id) continue;
    const key = `${st.name.toLowerCase()}|${st.url}`;
    if (seen.has(key)) continue; // в каталоге бывают дубли
    seen.add(key);
    out.push(st);
  }
  return out.slice(0, Math.max(1, Math.min(60, Number(limit) || 40)));
}

/** Сказать каталогу, что станцию включили (по этому считается популярность). */
function click(id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) return;
  api(`/json/url/${id}`, 5000).catch(() => {});
}

// ---------- Логотипы ----------
const logos = new Map(); // url → Promise<data: URL | null>
async function fetchLogo(url) {
  const res = await net.fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(6000) });
  if (!res.ok) return null;
  const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!/^image\/(png|jpeg|jpg|gif|webp|x-icon|vnd\.microsoft\.icon|svg\+xml)$/.test(type)) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length || buf.length > 300 * 1024) return null;
  return `data:${type};base64,${buf.toString('base64')}`;
}
function logo(url) {
  const u = httpUrl(url);
  if (!u) return Promise.resolve(null);
  if (!logos.has(u)) {
    if (logos.size > 400) logos.delete(logos.keys().next().value);
    logos.set(u, fetchLogo(u).catch(() => null));
  }
  return logos.get(u);
}

// ---------- Поток ----------
const tokens = new Map(); // token → { id, url }
let live = null; // { token, abort }

/** Запомнить станцию и вернуть адрес для <audio>. */
function prepare(st) {
  const url = httpUrl(st?.url);
  if (!url) throw new Error('у станции нет адреса потока');
  const token = crypto.randomBytes(12).toString('hex');
  tokens.clear(); // играет только одна станция
  tokens.set(token, { id: str(st.id, 64), url });
  return `somradio://play/${token}`;
}
function stop() {
  if (live) { try { live.abort.abort(); } catch { /* уже */ } live = null; }
}

// «StreamTitle='Исполнитель - Песня';» — русские станции часто шлют в windows-1251.
function metaTitle(bytes) {
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { text = new TextDecoder('windows-1251').decode(bytes); }
  const m = /StreamTitle='([\s\S]*?)';/.exec(text.replace(/\0+$/, ''));
  return m ? m[1].trim().slice(0, 200) : null;
}
/** Вырезать ICY-метаданные из потока: звук идёт дальше, названия песен — в onTitle. */
function icyStrip(metaint, onTitle) {
  let left = metaint;
  let need = -1; // сколько байт метаданных ждём (-1 — ждём байт длины)
  let meta = null;
  let pos = 0;
  return new TransformStream({
    transform(chunk, ctrl) {
      const c = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
      let i = 0;
      while (i < c.length) {
        if (left > 0) {
          const n = Math.min(left, c.length - i);
          ctrl.enqueue(c.subarray(i, i + n));
          i += n;
          left -= n;
        } else if (need < 0) {
          need = c[i] * 16;
          i += 1;
          if (need === 0) { need = -1; left = metaint; } else { meta = new Uint8Array(need); pos = 0; }
        } else {
          const n = Math.min(need - pos, c.length - i);
          meta.set(c.subarray(i, i + n), pos);
          pos += n;
          i += n;
          if (pos === need) {
            const t = metaTitle(meta);
            if (t != null) onTitle(t);
            need = -1;
            left = metaint;
            meta = null;
          }
        }
      }
    },
  });
}

// Плейлист вместо звука (.pls / .m3u) — берём первую ссылку.
async function fromPlaylist(res) {
  const text = (await res.text()).slice(0, 20000);
  if (/#EXT-X-/i.test(text)) throw new Error('hls');
  const m = /^(?:File\d+=)?\s*(https?:\/\/\S+)/im.exec(text);
  return m ? httpUrl(m[1]) : '';
}

async function serve(request) {
  const u = new URL(request.url);
  const st = tokens.get(u.pathname.replace(/^\//, ''));
  if (u.host !== 'play' || !st) return new Response('', { status: 404 });
  stop();
  const abort = new AbortController();
  live = { abort };
  let url = st.url;
  try {
    for (let hop = 0; hop < 3; hop += 1) {
      const res = await net.fetch(url, { headers: { 'Icy-MetaData': '1', 'User-Agent': UA }, signal: abort.signal, cache: 'no-store' });
      if (!res.ok || !res.body) return new Response('', { status: 502 });
      const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (/mpegurl|x-scpls|pls\+xml|^text\//.test(type)) {
        const next = await fromPlaylist(res);
        if (!next) return new Response('', { status: 415 });
        url = next;
        continue;
      }
      const metaint = Number(res.headers.get('icy-metaint')) || 0;
      const name = res.headers.get('icy-name');
      if (name) onMeta({ id: st.id, station: str(name, 120) });
      const body = metaint > 0 && metaint < 1_000_000 ? res.body.pipeThrough(icyStrip(metaint, (title) => onMeta({ id: st.id, title }))) : res.body;
      return new Response(body, { status: 200, headers: { 'content-type': type.startsWith('audio/') || type === 'application/ogg' ? type : 'audio/mpeg', 'cache-control': 'no-store' } });
    }
    return new Response('', { status: 508 });
  } catch {
    return new Response('', { status: 502 });
  }
}

function init({ version, meta }) {
  UA = `Som/${version} (radio; +https://github.com/AlWont/som-releases)`;
  onMeta = meta;
}

module.exports = { init, search, click, logo, prepare, stop, serve, SCHEME: 'somradio' };
