// Радио: станции из открытого каталога Radio Browser, звук — через свой протокол somradio://.
//
// Зачем поток идёт через главный процесс: многие станции отдают звук по http, а окно Som — «защищённая»
// страница, которой браузер не даст играть http-звук. Заодно вырезаем из потока ICY-метаданные
// (Shoutcast/Icecast вставляют их каждые N байт) и достаём «что сейчас играет».
// Звук и картинки станций качаются напрямую с их серверов — станции видят IP, как обычный сайт.
'use strict';

const { app, net } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// SOM_RADIO_API — только для автотестов (свой каталог и станции на этом ПК).
const TEST_API = process.env.SOM_RADIO_API || '';
const HOSTS = TEST_API ? [TEST_API] : ['all', 'de1', 'de2', 'fi1', 'nl1', 'at1'].map((h) => `https://${h}.api.radio-browser.info`);
// Свой каталог русских станций: встроенный файл, свежая копия — с GitHub (её можно поправить без выпуска Som).
const REPO = 'AlWont/som-releases';
const TEST_CATALOG = process.env.SOM_RADIO_CATALOG || '';
const GENRE_RU = { pop: 'поп', rock: 'рок', electronic: 'электроника', dance: 'танцевальная', hiphop: 'хип-хоп', chill: 'чилаут', lofi: 'лоу-фай', jazz: 'джаз', classical: 'классика', retro: 'ретро', metal: 'метал', chanson: 'шансон', news: 'новости', talk: 'разговорное' };
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

let downUntil = 0; // Radio Browser не отвечал — какое-то время не ждём его зря
let downWhy = '';
async function one(host, pathq, timeout) {
  const res = await net.fetch(`${host}${pathq}`, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(timeout), cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
async function api(pathq, timeout = 7000) {
  if (Date.now() < downUntil) throw new Error(`каталог со всего мира недоступен (${downWhy})`);
  // Все зеркала разом — кто первый ответит.
  try {
    return await Promise.any(HOSTS.map((h, i) => one(h, pathq, timeout).then((d) => { good = i; return d; })));
  } catch (err) {
    const first = err?.errors?.[0];
    downWhy = String(first?.name === 'TimeoutError' ? 'не ответил вовремя' : (first?.cause?.code || first?.message || 'нет связи')).slice(0, 80);
    downUntil = Date.now() + 3 * 60_000;
    throw new Error(`каталог со всего мира недоступен (${downWhy})`);
  }
}
const worldDown = () => (Date.now() < downUntil ? downWhy : '');

// ---------- Свой каталог ----------
const BUILTIN = path.join(__dirname, 'radio-ru.json');
const cacheFile = () => path.join(app.getPath('userData'), 'radio-ru.json');
let CAT = null;
let refreshed = false;
function readCat(file) {
  try {
    const d = JSON.parse(fs.readFileSync(file, 'utf8'));
    return d && Array.isArray(d.stations) && d.stations.length ? d : null;
  } catch { return null; }
}
function localStation(s) {
  const urls = (Array.isArray(s.urls) ? s.urls : []).map(httpUrl).filter(Boolean).slice(0, 6);
  if (!urls.length || typeof s.id !== 'string') return null;
  const g = (Array.isArray(s.g) ? s.g : []).filter((x) => GENRE_RU[x]).slice(0, 4);
  return { id: str(s.id, 64), name: str(s.name, 120) || 'Без названия', url: urls[0], urls, logo: httpUrl(s.logo), g, tags: g.map((x) => GENRE_RU[x]), country: 'Россия', cc: 'RU', codec: '', bitrate: 0, local: true };
}
async function freshCatalog() {
  let base = TEST_CATALOG;
  if (!base) {
    base = `https://raw.githubusercontent.com/${REPO}/main`;
    try {
      const r = await net.fetch(`https://api.github.com/repos/${REPO}/commits/main`, { headers: { Accept: 'application/vnd.github.sha', 'User-Agent': UA }, signal: AbortSignal.timeout(4000), cache: 'no-store' });
      const sha = r.ok ? (await r.text()).trim() : '';
      if (/^[0-9a-f]{40}$/.test(sha)) base = `https://raw.githubusercontent.com/${REPO}/${sha}`;
    } catch { /* через main */ }
  }
  const res = await net.fetch(`${base}/radio/ru.json`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(5000), cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const d = await res.json();
  if (!d || !Array.isArray(d.stations) || !d.stations.length) throw new Error('пустой каталог');
  return d;
}
/** Русские станции: с GitHub (раз за запуск), иначе последняя скачанная копия, иначе встроенная. */
async function catalog() {
  if (!CAT) CAT = readCat(cacheFile()) || readCat(BUILTIN) || { stations: [] };
  if (!refreshed) {
    refreshed = true;
    try {
      const d = await freshCatalog();
      CAT = d;
      try { fs.writeFileSync(cacheFile(), JSON.stringify(d)); } catch { /* не страшно */ }
    } catch { /* остаёмся на своей копии */ }
  }
  return CAT.stations.map(localStation).filter(Boolean);
}

/** Станция из каталога → только то, что нужно окну. */
function clean(s) {
  const url = httpUrl(s.url_resolved) || httpUrl(s.url);
  const codec = str(s.codec, 20).toUpperCase();
  if (!url || !OK_CODECS.has(codec)) return null;
  return {
    id: str(s.stationuuid, 64),
    name: str(s.name, 120).trim() || 'Без названия',
    url,
    urls: [url],
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
const tokens = new Map(); // token → { id, urls }
let live = null; // { token, abort }

/** Запомнить станцию и вернуть адрес для <audio>. */
function prepare(st) {
  const urls = (Array.isArray(st?.urls) && st.urls.length ? st.urls : [st?.url]).map(httpUrl).filter(Boolean).slice(0, 6);
  if (!urls.length) throw new Error('у станции нет адреса потока');
  const token = crypto.randomBytes(12).toString('hex');
  tokens.clear(); // играет только одна станция
  tokens.set(token, { id: str(st.id, 64), urls });
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

// Станции называют свой звук как попало («audio/aacp», «application/octet-stream»…) — приводим к тому, что понимает Chromium.
function audioType(type, url) {
  if (/aacp|aac\+|x-aac|audio\/aac/.test(type)) return 'audio/aac';
  if (/mpeg|mp3/.test(type)) return 'audio/mpeg';
  if (/ogg|opus/.test(type)) return 'audio/ogg';
  if (/flac/.test(type)) return 'audio/flac';
  if (/mp4|m4a/.test(type)) return 'audio/mp4';
  if (/\.aacp?(\?|$)/i.test(url)) return 'audio/aac';
  if (/\.ogg(\?|$)/i.test(url)) return 'audio/ogg';
  return 'audio/mpeg';
}
const isList = (type, url) => /mpegurl|x-scpls|pls\+xml|^text\//.test(type) || /\.(m3u8?|pls)(\?|$)/i.test(url);

// HLS (.m3u8): плейлист и его куски тоже идут через somradio://hls/… — иначе окно не даст их загрузить.
const b64 = (u) => Buffer.from(u).toString('base64url');
function hlsRewrite(text, base, token) {
  const wrap = (ref) => { try { const abs = httpUrl(new URL(ref, base).href); return abs ? `somradio://hls/${token}/${b64(abs)}` : ref; } catch { return ref; } };
  return text.split(/\r?\n/).map((line) => {
    const t = line.trim();
    if (!t) return line;
    if (t.startsWith('#')) return line.replace(/URI="([^"]+)"/g, (_m, ref) => `URI="${wrap(ref)}"`);
    return wrap(t);
  }).join('\n');
}
const LIST_TYPE = 'application/vnd.apple.mpegurl';

/** Открыть адрес станции; плейлист .pls/.m3u — пройти по первой ссылке; HLS — отдать переписанный плейлист. */
async function open(url, token, signal, onMeta) {
  for (let hop = 0; hop < 3; hop += 1) {
    const ctl = new AbortController();
    const kill = () => ctl.abort();
    signal.addEventListener('abort', kill, { once: true });
    const timer = setTimeout(kill, 9000); // станция молчит дольше 9 с — пробуем следующий адрес
    let res;
    try {
      res = await net.fetch(url, { headers: { 'Icy-MetaData': '1', 'User-Agent': UA }, signal: ctl.signal, cache: 'no-store' });
    } finally { clearTimeout(timer); }
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (isList(type, url)) {
      const text = (await res.text()).slice(0, 200_000);
      if (/#EXT-X-/i.test(text)) return new Response(hlsRewrite(text, res.url || url, token), { status: 200, headers: { 'content-type': LIST_TYPE, 'cache-control': 'no-store' } });
      const m = /^(?:File\d+=)?\s*(https?:\/\/\S+)/im.exec(text);
      const next = m && httpUrl(m[1]);
      if (!next) throw new Error('пустой плейлист');
      url = next;
      continue;
    }
    const metaint = Number(res.headers.get('icy-metaint')) || 0;
    const body = metaint > 0 && metaint < 1_000_000 ? res.body.pipeThrough(icyStrip(metaint, onMeta)) : res.body;
    return new Response(body, { status: 200, headers: { 'content-type': audioType(type, url), 'cache-control': 'no-store' } });
  }
  throw new Error('слишком много перенаправлений');
}

async function serve(request) {
  const u = new URL(request.url);
  const [, token = '', ref = ''] = u.pathname.split('/');
  const st = tokens.get(token);
  if (!st || (u.host !== 'play' && u.host !== 'hls')) return new Response('', { status: 404 });
  if (u.host === 'hls') {
    // Кусок или вложенный плейлист HLS текущей станции.
    if (!live) return new Response('', { status: 410 });
    let url = '';
    try { url = httpUrl(Buffer.from(ref, 'base64url').toString('utf8')); } catch { url = ''; }
    if (!url) return new Response('', { status: 400 });
    try {
      const res = await net.fetch(url, { headers: { 'User-Agent': UA }, signal: live.abort.signal, cache: 'no-store' });
      if (!res.ok) return new Response('', { status: res.status });
      const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (/mpegurl/.test(type) || /\.m3u8(\?|$)/i.test(url)) return new Response(hlsRewrite(await res.text(), res.url || url, token), { status: 200, headers: { 'content-type': LIST_TYPE, 'cache-control': 'no-store' } });
      return new Response(res.body, { status: 200, headers: { 'content-type': type || 'application/octet-stream', 'cache-control': 'no-store' } });
    } catch { return new Response('', { status: 502 }); }
  }
  stop();
  const abort = new AbortController();
  live = { abort };
  // Адреса по порядку: первый ответивший и играет.
  for (const url of st.urls) {
    if (abort.signal.aborted) break;
    try {
      return await open(url, token, abort.signal, (title) => onMeta({ id: st.id, title }));
    } catch { /* следующий адрес */ }
  }
  return new Response('', { status: 502 });
}

function init({ version, meta }) {
  UA = `Som/${version} (radio; +https://github.com/AlWont/som-releases)`;
  onMeta = meta;
}

module.exports = { init, search, catalog, worldDown, click, logo, prepare, stop, serve, SCHEME: 'somradio' };
