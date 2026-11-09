// Музыка профиля: своя песня в карточке, друзья слышат её, когда открывают ваш профиль.
//
// Ядро не знает о музыке, поэтому она едет к друзьям внутри файла баннера: сначала обычный JPEG,
// за ним звук (Ogg Opus), описание и метка SOMMUSIC в самом конце. Картинки читаются только до конца JPEG,
// так что старые версии Som просто показывают баннер, а новые находят метку и достают музыку.
// Нет своего баннера — кладём «подложку»: картинку 3×1 цвета профиля, её новые версии не показывают.
//
// Хвост: [звук][описание JSON][u32 длина звука][u32 длина описания]["SOMMUSIC"], числа little-endian.

import { encodeOgg } from './voice.js';

const MAGIC = new TextEncoder().encode('SOMMUSIC');
const RATE = 48000;
export const MAX_SEC = 300; // до 5 минут
const MAX_INPUT = 80 * 1024 * 1024;
const LIMIT = 8 * 1024 * 1024; // столько ядро берёт за файл профиля

/** Упаковать картинку и музыку в один файл баннера. */
export function pack(jpeg, audio, meta) {
  const m = new TextEncoder().encode(JSON.stringify({ v: 1, ...meta }));
  const out = new Uint8Array(jpeg.length + audio.length + m.length + 16);
  out.set(jpeg, 0);
  out.set(audio, jpeg.length);
  out.set(m, jpeg.length + audio.length);
  const dv = new DataView(out.buffer);
  const t = jpeg.length + audio.length + m.length;
  dv.setUint32(t, audio.length, true);
  dv.setUint32(t + 4, m.length, true);
  out.set(MAGIC, t + 8);
  if (out.length > LIMIT) throw new Error(`баннер с музыкой больше 8 МБ (${(out.length / 1048576).toFixed(1).replace('.', ',')} МБ) — возьмите песню короче`);
  return out;
}

/** Разобрать файл баннера: { jpeg, audio, meta }; без музыки audio и meta — null. */
export function unpack(bytes) {
  const none = { jpeg: bytes, audio: null, meta: null };
  const n = bytes.length;
  if (n < 16) return none;
  for (let i = 0; i < 8; i += 1) if (bytes[n - 8 + i] !== MAGIC[i]) return none;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, n);
  const al = dv.getUint32(n - 16, true);
  const ml = dv.getUint32(n - 12, true);
  const start = n - 16 - ml - al;
  if (start < 0 || ml > 4096) return none;
  let meta = null;
  try { meta = JSON.parse(new TextDecoder().decode(bytes.subarray(n - 16 - ml, n - 16))); } catch { return none; }
  if (!meta || typeof meta !== 'object') return none;
  const clean = {
    name: String(meta.name || 'Музыка').replace(/[\u0000-\u001f]/g, '').slice(0, 80),
    dur: Math.max(0, Math.min(MAX_SEC + 5, Number(meta.dur) || 0)),
    carrier: meta.carrier === true,
  };
  return { jpeg: bytes.subarray(0, start), audio: bytes.subarray(start, start + al), meta: clean };
}

/** «Подложка» вместо баннера: картинка 3×1 цвета профиля (её покажут только старые версии). */
export async function carrierJpeg(color) {
  const cv = document.createElement('canvas');
  cv.width = 3;
  cv.height = 1;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = /^#[0-9a-f]{6}$/i.test(color || '') ? color : '#7fa0a8';
  ctx.fillRect(0, 0, 3, 1);
  const blob = await new Promise((res) => cv.toBlob(res, 'image/jpeg', 0.9));
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Песня с диска → Ogg Opus для профиля: до 5 минут (длиннее — обрезаем и плавно гасим конец),
 * стерео 96 кбит/с (моно — 64). Возвращает { audio, name, dur }.
 */
export async function prepareMusic(file) {
  if (!file) throw new Error('файл не выбран');
  if (file.size > MAX_INPUT) throw new Error('файл больше 80 МБ');
  let buf;
  try {
    buf = await new OfflineAudioContext(2, RATE, RATE).decodeAudioData(await file.arrayBuffer());
  } catch {
    throw new Error('не получилось прочитать звук — подойдут MP3, M4A, OGG, OPUS, WAV и FLAC');
  }
  const n = Math.min(buf.length, MAX_SEC * RATE);
  if (n < RATE) throw new Error('песня короче секунды');
  const ch = buf.numberOfChannels >= 2 ? 2 : 1;
  const chans = [];
  for (let c = 0; c < ch; c += 1) chans.push(buf.getChannelData(c).slice(0, n));
  if (buf.length > n) {
    const fade = Math.min(n, 3 * RATE); // обрезали — гасим последние 3 секунды
    for (const d of chans) for (let i = 0; i < fade; i += 1) d[n - fade + i] *= 1 - i / fade;
  }
  const blob = await encodeOgg(chans, RATE, { bitrate: ch === 2 ? 96000 : 64000, application: 'audio' });
  const name = String(file.name || 'Музыка').replace(/\.[a-z0-9]{1,5}$/i, '').replace(/[_]+/g, ' ').trim().slice(0, 80) || 'Музыка';
  return { audio: new Uint8Array(await blob.arrayBuffer()), name, dur: n / RATE };
}

export function fmtDur(sec) {
  const s = Math.round(sec || 0);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ---------- Плеер: одна песня за раз ----------
let X = { out: () => '', radioHold: () => {}, toast: () => {}, diag: () => {} };
// Звонок музыку профиля не трогает (хозяин решил 2026-11-08): и сама включается, и не затихает.
const P = { audio: null, url: '', row: null, held: false, auto: false };

/**
 * deps: out() — колонки, radioHold(on) — радио на паузу,
 * toast(text, kind) — подсказка, diag(text) — в «Отчёт для проверки».
 */
export function initProfileMusic(deps) {
  X = { ...X, ...deps };
}

function audioEl() {
  if (!P.audio) {
    P.audio = new Audio();
    P.audio.preload = 'auto';
    P.audio.volume = vol();
    P.audio.addEventListener('timeupdate', () => {
      // Карточку закрыли или начался звонок — музыка замолкает.
      if (P.row && (!P.row.isConnected || !P.row.checkVisibility?.())) { stopProfileMusic(); return; }
      paint();
    });
    P.audio.addEventListener('ended', () => stopProfileMusic());
    // Файл сломался уже во время игры — не молчим.
    P.audio.addEventListener('error', () => { if (P.row) { const why = reason(null, P.audio); X.diag(`музыка профиля: ${why}`); X.toast(`Песня не играет: ${why}`, 'bad'); stopProfileMusic(); } });
    P.audio.addEventListener('pause', paint);
    P.audio.addEventListener('play', paint);
  }
  return P.audio;
}

function vol() {
  try { const v = Number(localStorage.getItem('som.pmusic.vol')); return v > 0 && v <= 1 ? v : 0.6; } catch { return 0.6; }
}
/** Сама ли играет музыка в чужом профиле (по умолчанию да). */
export function autoMusic() {
  try { return localStorage.getItem('som.pmusic.auto') !== '0'; } catch { return true; }
}
function setAuto(on) {
  try { localStorage.setItem('som.pmusic.auto', on ? '1' : '0'); } catch { /* не страшно */ }
}

function release() {
  if (P.held) { P.held = false; X.radioHold(false); }
}

export function stopProfileMusic() {
  const a = P.audio;
  if (a) { a.pause(); a.removeAttribute('src'); a.load(); }
  P.url = '';
  const row = P.row;
  P.row = null;
  release();
  if (row) paintRow(row, false, 0);
}

/** Почему не играет — по-человечески. */
function reason(err, a) {
  const code = a?.error?.code;
  if (code) return { 1: 'загрузку прервали', 2: 'файл не загрузился', 3: 'файл песни повреждён', 4: 'этот формат здесь не играет' }[code] || `ошибка ${code}`;
  if (err?.name === 'NotAllowedError') return 'звук не разрешён — щёлкните ещё раз';
  if (err?.name === 'NotFoundError') return 'выбранные в настройках колонки не найдены';
  return `${err?.name || 'ошибка'}${err?.message ? `: ${err.message}` : ''}`.slice(0, 160);
}

/** manual — по кнопке: тогда при отказе объясняем, почему (автозапуск молчит, только пишет в отчёт). */
async function play(row, url, manual = false) {
  const a = audioEl();
  if (P.row && P.row !== row) stopProfileMusic();
  P.row = row;
  const out = X.out();
  const custom = Boolean(out && out !== 'default');
  if (P.url !== url) {
    P.url = url;
    a.src = url;
    if (typeof a.setSinkId === 'function') a.setSinkId(custom ? out : '').catch((e) => X.diag(`музыка профиля: колонки не выбрались (${reason(e)})`));
  }
  if (!P.held) { P.held = true; X.radioHold(true); }
  try {
    await a.play();
  } catch (err) {
    let why = reason(err, a);
    // Не вышло на выбранные колонки — ещё раз на колонки по умолчанию.
    if (manual && custom && !a.error && typeof a.setSinkId === 'function') {
      try { await a.setSinkId(''); await a.play(); X.diag(`музыка профиля: на выбранных колонках не играла (${why}), играет на колонках по умолчанию`); return; } catch (e2) { why = reason(e2, a); }
    }
    X.diag(`музыка профиля: ${why}`);
    if (manual) X.toast(`Песня не играет: ${why}`, 'bad');
    stopProfileMusic();
  }
}

const ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="5" width="4" height="14" rx="1"/><rect x="13.5" y="5" width="4" height="14" rx="1"/></svg>';

function paintRow(row, playing, t) {
  const btn = row.querySelector('.pm-play');
  if (btn) {
    if (btn.dataset.on !== String(playing)) { btn.innerHTML = playing ? ICON_PAUSE : ICON_PLAY; btn.dataset.on = String(playing); }
    btn.title = playing ? 'Пауза' : 'Слушать';
    btn.setAttribute('aria-label', btn.title);
  }
  const bar = row.querySelector('.pm-bar span');
  const dur = Number(row.dataset.dur) || 0;
  if (bar) bar.style.width = `${dur ? Math.min(100, (t / dur) * 100) : 0}%`;
  const time = row.querySelector('.pm-time');
  if (time) time.textContent = t > 0 ? `${fmtDur(t)} / ${fmtDur(dur)}` : fmtDur(dur);
}
function paint() {
  if (P.row) paintRow(P.row, Boolean(P.audio && !P.audio.paused), P.audio?.currentTime || 0);
}

/**
 * Строка с песней для карточки профиля. music — { url, name, dur }.
 * autoplay — включить сразу (для чужих карточек, если человек это не выключил кнопкой «авто»).
 * self — своя карточка: без переключателя «авто» (он про чужие профили).
 */
export function musicRow(music, { autoplay = false, self = false } = {}) {
  const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const row = mk('div', 'pc-music');
  row.dataset.dur = String(music.dur || 0);
  const btn = mk('button', 'pm-play');
  btn.type = 'button';
  const main = mk('div', 'pm-main');
  const top = mk('div', 'pm-top');
  top.append(mk('span', 'pm-note', '♪'), mk('span', 'pm-name', music.name), mk('span', 'pm-time', fmtDur(music.dur)));
  const bar = mk('div', 'pm-bar');
  bar.append(mk('span'));
  main.append(top, bar);
  const auto = mk('button', 'pm-auto', 'авто');
  auto.type = 'button';
  const paintAuto = () => {
    const on = autoMusic();
    auto.setAttribute('aria-pressed', String(on));
    auto.title = on ? 'Музыка в профилях друзей включается сама. Нажмите, чтобы только по кнопке' : 'Музыка в профилях друзей — только по кнопке. Нажмите, чтобы включалась сама';
    auto.setAttribute('aria-label', auto.title);
  };
  paintAuto();
  auto.addEventListener('click', () => { setAuto(!autoMusic()); paintAuto(); });
  row.append(btn, main);
  if (!self) row.append(auto);
  paintRow(row, false, 0);
  btn.addEventListener('click', () => {
    const a = P.audio;
    if (P.row === row && a && !a.paused) { a.pause(); return; }
    play(row, music.url, true);
  });
  // Перемотка щелчком по полоске.
  bar.addEventListener('click', (e) => {
    if (P.row !== row || !P.audio) return;
    const r = bar.getBoundingClientRect();
    P.audio.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * (music.dur || P.audio.duration || 0);
  });
  // Карточку перерисовали (друг сменил статус, вышел в сеть), а песня та же — играет дальше в новой строке.
  if (P.row && P.url === music.url) {
    P.row = row;
    paint();
    return row;
  }
  if (autoplay && autoMusic()) {
    // Ждём, пока карточка окажется на экране (диалог открывается сразу после отрисовки).
    requestAnimationFrame(() => { if (row.isConnected && row.checkVisibility?.()) play(row, music.url); });
  }
  return row;
}
