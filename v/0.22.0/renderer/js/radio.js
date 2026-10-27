// Радио: окно выбора станций (поиск, жанры, Россия и мир, избранное, недавние) и мини-плеер слева внизу.
// Каталог и поток — в главном процессе (radio.cjs); здесь только интерфейс и <audio>.
// В звонке радио само приглушается, на время записи голосового — на паузе.

const $ = (id) => document.getElementById(id);
function pref(key, def) { try { return localStorage.getItem(key) ?? def; } catch { return def; } }
function setPref(key, v) { try { localStorage.setItem(key, v); } catch { /* без памяти — не страшно */ } }
function readList(key) { try { const v = JSON.parse(pref(key, '[]')); return Array.isArray(v) ? v : []; } catch { return []; } }

function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
  return el;
}

// Подборки. Жанры ищем по меткам каталога: сначала русские станции, потом остальные.
const CHIPS = [
  { id: 'fav', label: '★ Избранное' },
  { id: 'recent', label: 'Недавние' },
  { id: 'ru', label: 'Россия', q: { cc: 'RU' } },
  { id: 'world', label: 'Весь мир', q: {} },
  { id: 'pop', label: 'Поп', tag: 'pop', g: 'pop' },
  { id: 'rock', label: 'Рок', tag: 'rock', g: 'rock' },
  { id: 'electronic', label: 'Электроника', tag: 'electronic', g: 'electronic' },
  { id: 'dance', label: 'Танцевальная', tag: 'dance', g: 'dance' },
  { id: 'hiphop', label: 'Хип-хоп', tag: 'hip hop', g: 'hiphop' },
  { id: 'chill', label: 'Чилаут', tag: 'chillout', g: 'chill' },
  { id: 'lofi', label: 'Лоу-фай', tag: 'lofi', g: 'lofi' },
  { id: 'jazz', label: 'Джаз', tag: 'jazz', g: 'jazz' },
  { id: 'classical', label: 'Классика', tag: 'classical', g: 'classical' },
  { id: 'retro', label: 'Ретро', tag: '80s', g: 'retro' },
  { id: 'metal', label: 'Метал', tag: 'metal', g: 'metal' },
  { id: 'chanson', label: 'Шансон', tag: 'chanson', g: 'chanson' },
  { id: 'news', label: 'Новости и разговоры', tag: 'news', g: 'news', g2: 'talk' },
];
const DUCK = 0.25; // громкость радио во время звонка
const DUCK_SHARED = 0.6; // общее радио в звонке — его слушают все, глушим меньше
const COUNTRY = { RU: 'Россия', UA: 'Украина', BY: 'Беларусь', KZ: 'Казахстан', US: 'США', GB: 'Великобритания', DE: 'Германия', FR: 'Франция', NL: 'Нидерланды', IT: 'Италия', ES: 'Испания', PL: 'Польша', CA: 'Канада', JP: 'Япония', CH: 'Швейцария', AT: 'Австрия', BE: 'Бельгия', GR: 'Греция', TR: 'Турция', BR: 'Бразилия' };

const R = {
  st: null, // станция в плеере
  state: 'off', // off | connecting | playing | paused
  now: '', // что сейчас играет
  chip: '',
  q: '',
  seq: 0,
  ducked: false,
  pausedFor: null, // 'rec' — поставили на паузу ради записи голосового
  broken: new Set(),
  retry: 0,
  list: [],
  shared: null, // радио вместе: { dj: 'me' | id участника } — пока идёт звонок
  forAll: false, // в окне выбрано «для всех в звонке»
  optOut: null, // у себя выключили общее радио этого человека — сами больше не включаем
  offer: null, // { dj, st } — общее радио, которое у вас выключено (можно присоединиться)
};
let X = { toast: () => {}, out: () => 'default', inCall: () => null, sendTogether: () => Promise.resolve(false), name: () => 'Друг' };
const logoCache = new Map();
let io = null;

const audio = () => $('radioAudio');
const volume = () => Math.max(0, Math.min(100, Number(pref('som.radio.vol', '60')) || 0));
const favs = () => readList('som.radio.fav');
const isFav = (id) => favs().some((s) => s.id === id);
const slim = (s) => ({
  id: s.id, name: s.name, url: s.url, urls: (Array.isArray(s.urls) && s.urls.length ? s.urls : [s.url]).slice(0, 6), logo: s.logo || '',
  tags: (s.tags || []).slice(0, 4), g: (s.g || []).slice(0, 4), country: s.country || '', cc: s.cc || '', codec: s.codec || '', bitrate: s.bitrate || 0,
  ...(s.local ? { local: true } : {}), ...(s.mine ? { mine: true } : {}),
});

function applyVolume() {
  const a = audio();
  a.volume = (volume() / 100) * (R.ducked ? (R.shared ? DUCK_SHARED : DUCK) : 1);
}

// ---------- Логотипы ----------
function initials(name) {
  const w = String(name || '?').replace(/^(радио|radio)\s+/i, '').trim();
  return (w[0] || '?').toUpperCase();
}
function hue(s) { let x = 0; for (const ch of String(s)) x = (x * 31 + ch.charCodeAt(0)) >>> 0; return x % 360; }
function logoEl(st, size) {
  const box = h('span', { class: 'r-logo', 'aria-hidden': 'true' });
  box.style.width = `${size}px`;
  box.style.height = `${size}px`;
  box.style.background = `hsl(${hue(st.name)} 22% 32%)`;
  box.append(h('span', { class: 'r-ini', text: initials(st.name) }));
  if (st.logo) {
    box.dataset.logo = st.logo;
    if (logoCache.get(st.logo)) putLogo(box, logoCache.get(st.logo));
    else if (!logoCache.has(st.logo)) io?.observe(box);
  }
  return box;
}
function putLogo(box, data) {
  if (!data) return;
  const img = h('img', { alt: '', src: data, draggable: 'false' });
  img.addEventListener('error', () => img.remove());
  box.replaceChildren(img);
  box.classList.add('has-img');
}
async function loadLogo(box) {
  const url = box.dataset.logo;
  if (!url || logoCache.has(url)) { if (logoCache.get(url)) putLogo(box, logoCache.get(url)); return; }
  logoCache.set(url, null);
  const data = await window.som.radio.logo(url).catch(() => null);
  logoCache.set(url, data);
  for (const b of document.querySelectorAll('.r-logo')) if (b.dataset.logo === url) putLogo(b, data);
  if (R.st?.logo === url) mediaSession();
}

// ---------- Плеер ----------
async function play(st, { shared = false } = {}) {
  if (!st?.url) return;
  const a = audio();
  R.now = '';
  if (R.st?.id !== st.id || R.state !== 'connecting') { R.retry = 0; R.wasPlaying = false; }
  R.st = slim(st);
  R.state = 'connecting';
  R.pausedFor = null;
  // Станцию, которую включил друг, в «недавние» и «последнюю» не кладём — это не ваш выбор.
  if (!shared) {
    setPref('som.radio.last', JSON.stringify(R.st));
    const rec = readList('som.radio.recent').filter((s) => s.id !== st.id);
    rec.unshift(R.st);
    setPref('som.radio.recent', JSON.stringify(rec.slice(0, 20)));
  }
  applyVolume();
  render();
  try {
    const src = await window.som.radio.play(shared ? { ...R.st, shared: true } : R.st);
    if (R.st?.id !== st.id) return; // успели выбрать другую
    if (!src) throw new Error('станцию не открыть');
    const out = X.out();
    if (typeof a.setSinkId === 'function') a.setSinkId(out && out !== 'default' ? out : '').catch(() => {});
    applyVolume();
    a.src = src;
    await a.play();
  } catch (err) {
    if (R.st?.id === st.id && R.state === 'connecting' && err?.name !== 'AbortError') failed();
  }
}
/** Пауза у живого радио — это «отключиться»: поток не качаем, станция остаётся в плеере. */
function pause() {
  const a = audio();
  a.pause();
  a.removeAttribute('src');
  a.load();
  window.som.radio.stop().catch(() => {});
  if (R.st) R.state = 'paused';
  render();
}
function toggle() {
  if (!R.st) { open(); return; }
  if (R.state === 'playing' || R.state === 'connecting') { leaveShared(); pause(); } else play(R.st);
}
/** Выключить радио совсем: плеер слева пропадает. */
function off() {
  leaveShared();
  pause();
  R.st = null;
  R.state = 'off';
  R.now = '';
  setPref('som.radio.last', '');
  render();
}
function failed() {
  const name = R.st?.name || 'Станция';
  if (R.st) R.broken.add(R.st.id);
  pause();
  X.toast(`«${name}» сейчас не отвечает. Попробуйте другую станцию.`, 'bad');
  renderList();
}

function wireAudio() {
  const a = audio();
  a.addEventListener('playing', () => { if (R.st) { R.state = 'playing'; R.wasPlaying = true; render(); } });
  a.addEventListener('waiting', () => { if (R.state === 'playing') { R.state = 'connecting'; render(); } });
  // Связь со станцией оборвалась уже во время эфира — переподключаемся пару раз; не включилась вовсе — другая станция.
  const reconnect = () => {
    if (!R.st || R.state === 'paused' || R.state === 'off') return;
    if (!R.wasPlaying || R.retry >= 2) { failed(); return; }
    const n = R.retry + 1;
    R.state = 'connecting';
    render();
    setTimeout(() => { if (R.st && R.state === 'connecting') { const st = R.st; play(st).then(() => { R.retry = n; }); R.retry = n; } }, 1500);
  };
  a.addEventListener('error', () => { if (a.getAttribute('src') && R.st) reconnect(); });
  a.addEventListener('ended', reconnect);
  // Включили голосовое, видео или песню из чата — радио замолкает (живые звонки не в счёт).
  document.addEventListener('play', (e) => {
    const m = e.target;
    if (!(m instanceof HTMLMediaElement) || m === a || m.srcObject || m.muted) return;
    if (R.state === 'playing' || R.state === 'connecting') pause();
  }, true);
  window.som.radio.onMeta((m) => {
    if (!R.st || m.id !== R.st.id) return;
    if (m.title != null) { R.now = m.title; render(); }
  });
}

function mediaSession() {
  const ms = navigator.mediaSession;
  if (!ms || typeof MediaMetadata === 'undefined') return;
  if (!R.st) { ms.metadata = null; ms.playbackState = 'none'; return; }
  const art = logoCache.get(R.st.logo);
  ms.metadata = new MediaMetadata({ title: R.now || R.st.name, artist: R.now ? R.st.name : 'Радио в Som', album: 'Som', artwork: art ? [{ src: art, sizes: '128x128' }] : [] });
  ms.playbackState = R.state === 'playing' || R.state === 'connecting' ? 'playing' : 'paused';
}
function wireMediaKeys() {
  const ms = navigator.mediaSession;
  if (!ms) return;
  const step = (d) => {
    const list = favs().length ? favs() : readList('som.radio.recent');
    if (!list.length) return;
    const i = list.findIndex((s) => s.id === R.st?.id);
    play(list[(i + d + list.length) % list.length]);
  };
  const set = (k, fn) => { try { ms.setActionHandler(k, fn); } catch { /* не поддерживается */ } };
  set('play', () => { if (R.st) play(R.st); });
  set('pause', () => pause());
  set('stop', () => pause());
  set('nexttrack', () => step(1));
  set('previoustrack', () => step(-1));
}

// ---------- Мини-плеер ----------
/** Строка «что играет»: не помещается — медленно ездит туда-обратно. */
function setRunning(box, text) {
  let run = box.firstElementChild;
  if (!run) { run = h('span', { class: 'rd-run' }); box.replaceChildren(run); }
  if (run.textContent === text) return;
  run.textContent = text;
  box.classList.remove('marquee');
  requestAnimationFrame(() => {
    const over = run.scrollWidth - box.clientWidth;
    if (over <= 2) return;
    box.style.setProperty('--run', `${-over - 8}px`);
    box.style.setProperty('--run-time', `${Math.max(5, over / 28 + 3)}s`);
    box.classList.add('marquee');
  });
}
const PLAY_ICON = '<polygon points="7 4 20 12 7 20 7 4"/>';
const PAUSE_ICON = '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>';
function render() {
  const dock = $('radioDock');
  const st = R.st;
  dock.hidden = !st;
  $('radioBtn').classList.toggle('on', R.state === 'playing' || R.state === 'connecting');
  if (st) {
    const logo = $('radioLogo');
    if (logo.dataset.for !== st.id) { logo.dataset.for = st.id; logo.replaceChildren(logoEl(st, 32)); }
    $('radioName').textContent = st.name;
    const now = R.state === 'connecting' ? 'Подключаюсь…' : R.state === 'paused' ? 'На паузе' : (R.now || (R.ducked && !R.shared ? 'Тише — идёт звонок' : 'В эфире'));
    const who = $('radioWho');
    who.hidden = !R.shared;
    if (R.shared) who.textContent = R.shared.dj === 'me' ? '👥 Вы включили для всех в звонке' : `👥 Вместе · включил(а) ${X.name(R.shared.dj)}`;
    $('radioClose').title = R.shared && R.shared.dj !== 'me' ? 'Выключить у себя' : R.shared ? 'Выключить у всех' : 'Выключить радио';
    $('radioClose').setAttribute('aria-label', $('radioClose').title);
    dock.classList.toggle('shared', Boolean(R.shared));
    setRunning($('radioNow'), now);
    $('radioNow').title = R.now || '';
    dock.dataset.state = R.state;
    const playing = R.state === 'playing' || R.state === 'connecting';
    $('radioPlay').querySelector('svg').innerHTML = playing ? PAUSE_ICON : PLAY_ICON;
    $('radioPlay').setAttribute('aria-label', playing ? 'Пауза' : 'Играть');
    $('radioPlay').title = playing ? 'Пауза' : 'Играть';
  }
  mediaSession();
  if ($('radioDlg').open) { markRows(); renderFor(); }
}

// ---------- Радио вместе ----------
/** Станция для друга: только то, что нужно, чтобы её включить. */
const wire = (st) => ({ id: String(st.id).slice(0, 120), name: String(st.name).slice(0, 120), url: st.url, urls: (st.urls || [st.url]).slice(0, 6), logo: st.logo || '', codec: st.codec || '', bitrate: Number(st.bitrate) || 0, cc: st.cc || '', tags: (st.tags || []).slice(0, 3) });
const okUrl = (u) => { try { const x = new URL(String(u)); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch { return ''; } };
/** Выбрали станцию в окне: для себя или для всех в звонке. */
function pick(st) {
  if (X.inCall() && R.forAll) {
    R.shared = { dj: 'me' };
    play(st);
    X.sendTogether({ kind: 'radio', on: true, st: wire(st) });
    return;
  }
  leaveShared();
  play(st);
}
/** Перестать слушать вместе: ведущий выключает у всех, слушатель — только у себя. */
function leaveShared() {
  if (!R.shared) return;
  if (R.shared.dj === 'me') X.sendTogether({ kind: 'radio', on: false });
  else { R.optOut = R.shared.dj; R.offer = { dj: R.shared.dj, st: R.st }; }
  R.shared = null;
  applyVolume();
}
function joinOffer() {
  const o = R.offer;
  if (!o) return;
  R.optOut = null;
  R.offer = null;
  R.forAll = false;
  R.shared = { dj: o.dj };
  play(o.st, { shared: true });
  renderFor();
}
/** Сигнал от участника звонка. */
export function onTogether(from, data) {
  if (data?.kind !== 'radio') return false;
  const name = X.name(from);
  if (!data.on) {
    if (R.offer?.dj === from) { R.offer = null; renderFor(); }
    if (R.shared?.dj === from) {
      R.shared = null;
      pause();
      X.toast(`${name} выключил(а) общее радио.`);
    }
    return true;
  }
  const s = data.st || {};
  const url = okUrl(s.url);
  if (!url || typeof s.name !== 'string') return true;
  const st = { ...wire({ ...s, url, urls: (Array.isArray(s.urls) ? s.urls : [url]).map(okUrl).filter(Boolean) }), shared: true };
  // Вы выключили у себя радио этого человека — не включаем снова сами, только предлагаем.
  if (R.optOut === from) {
    const changed = R.offer?.st?.id !== st.id;
    R.offer = { dj: from, st };
    if (changed) X.toast(`${name} включил(а) для всех «${st.name}». У вас общее радио выключено — присоединиться можно в окне радио.`, '', 6000);
    renderFor();
    return true;
  }
  const same = R.shared?.dj === from && R.st?.id === st.id && (R.state === 'playing' || R.state === 'connecting');
  R.offer = null;
  R.shared = { dj: from };
  if (!same) {
    play(st, { shared: true });
    X.toast(`${name} включил(а) радио для всех: «${st.name}». Выключить у себя — ✕ в плеере слева.`, 'ok', 7000);
  }
  return true;
}
/** В звонок вошёл новый человек — если общее радио включили вы, оно включится и у него. */
export function radioPeerJoined(id) {
  if (R.shared?.dj === 'me' && R.st && (R.state === 'playing' || R.state === 'connecting')) X.sendTogether({ kind: 'radio', on: true, st: wire(R.st) }, id);
}
/** Ушёл тот, кто включил общее радио. */
export function radioPeerLeft(id) {
  if (R.offer?.dj === id) R.offer = null;
  if (R.optOut === id) R.optOut = null;
  if (R.shared?.dj !== id) return;
  R.shared = null;
  pause();
  X.toast(`${X.name(id)} вышел(а) — общее радио выключено.`);
}
/** Звонок кончился: своё радио играет дальше, чужое — выключаем. */
export function radioCallEnded() {
  R.offer = null;
  R.optOut = null;
  if (!R.shared) return;
  const dj = R.shared.dj;
  R.shared = null;
  R.forAll = false;
  if (dj !== 'me') { pause(); X.toast('Звонок закончился — общее радио у вас выключено.'); } else render();
}
/** Переключатель «для себя / для всех» в окне радио — только в звонке. */
function renderFor() {
  const box = $('radioFor');
  const call = X.inCall();
  box.hidden = !call;
  if (!call) return;
  if (R.shared?.dj === 'me') R.forAll = true;
  for (const b of box.querySelectorAll('.rf-seg button')) b.setAttribute('aria-checked', String((b.dataset.for === 'all') === R.forAll));
  const join = $('radioJoin');
  join.hidden = !R.offer || Boolean(R.shared);
  if (R.offer) join.textContent = `👥 Слушать вместе «${R.offer.st.name}» — включил(а) ${X.name(R.offer.dj)}`;
  $('radioForHint').textContent = R.forAll
    ? 'Выбранная станция включится у всех в звонке — каждый слушает у себя, со своей громкостью.'
    : R.shared && R.shared.dj !== 'me' ? `Сейчас играет общее радио от ${X.name(R.shared.dj)}. Выберете станцию — она будет только у вас.` : 'Станцию слышите только вы.';
}

// ---------- Окно выбора ----------
function metaLine(st) {
  const parts = [];
  if (st.cc && COUNTRY[st.cc]) parts.push(COUNTRY[st.cc]); else if (st.country) parts.push(st.country);
  if (st.tags?.length) parts.push(st.tags.slice(0, 3).join(', '));
  if (st.mine) parts.push(hostOf(st.url));
  const q = [st.codec && st.codec !== 'UNKNOWN' ? st.codec : '', st.bitrate ? `${st.bitrate}` : ''].filter(Boolean).join(' ');
  if (q) parts.push(q);
  return parts.join(' · ');
}
function row(st) {
  const fav = isFav(st.id);
  const el = h('div', { class: `r-row${R.broken.has(st.id) ? ' broken' : ''}`, role: 'listitem', dataset: { id: st.id } },
    h('button', { class: 'r-main', type: 'button', title: `Слушать «${st.name}»`, onclick: () => { if (R.st?.id === st.id && R.state !== 'paused') { leaveShared(); pause(); } else pick(st); } },
      logoEl(st, 40),
      h('span', { class: 'r-text' },
        h('span', { class: 'r-name', text: st.name }),
        h('span', { class: 'r-meta', text: R.broken.has(st.id) ? 'не отвечает' : metaLine(st) })),
      h('span', { class: 'r-eq', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'))),
    h('button', {
      class: 'icon-btn r-fav', type: 'button', 'aria-pressed': String(fav), title: fav ? 'Убрать из избранного' : 'В избранное', 'aria-label': fav ? 'Убрать из избранного' : 'В избранное',
      onclick: (e) => toggleFav(st, e.currentTarget),
    }, '★'));
  return el;
}
function toggleFav(st, btn) {
  const list = favs();
  const i = list.findIndex((s) => s.id === st.id);
  if (i >= 0) list.splice(i, 1); else list.unshift(slim(st));
  setPref('som.radio.fav', JSON.stringify(list.slice(0, 100)));
  const on = i < 0;
  btn.setAttribute('aria-pressed', String(on));
  btn.title = on ? 'Убрать из избранного' : 'В избранное';
  btn.setAttribute('aria-label', btn.title);
  if (R.chip === 'fav' && !on) renderList();
}
function markRows() {
  for (const r of document.querySelectorAll('#radioList .r-row')) {
    const cur = R.st && r.dataset.id === R.st.id;
    r.classList.toggle('on', Boolean(cur) && R.state !== 'paused');
    r.classList.toggle('connecting', Boolean(cur) && R.state === 'connecting');
  }
}
function note(text, retry) {
  const kids = [h('p', { text })];
  if (retry) kids.push(h('button', { class: 'btn small', type: 'button', text: 'Ещё раз', onclick: retry }));
  $('radioList').replaceChildren(h('div', { class: 'r-note' }, kids));
}
function renderList() {
  const list = R.list;
  if (!list.length) {
    if (R.chip === 'fav') note('Здесь будут станции, которым вы поставите ★.');
    else if (R.chip === 'recent') note('Здесь будут станции, которые вы слушали.');
    else note(R.q ? `По запросу «${R.q}» ничего не нашлось.` : 'Ничего не нашлось.');
    return;
  }
  $('radioList').replaceChildren(...list.map(row), ...(R.worldNote ? [h('p', { class: 'r-world', text: R.worldNote })] : []));
  markRows();
}
// Свой каталог русских станций (встроен в Som, свежая копия — с GitHub).
let LOCAL = null;
async function local() {
  if (!LOCAL) LOCAL = await window.som.radio.catalog().catch(() => []);
  return LOCAL;
}
const norm = (x) => String(x || '').toLowerCase().replace(/ё/g, 'е').replace(/^(радио|radio)\s+/, '').replace(/[^a-zа-я0-9]+/g, '');
/** Склеить списки: одна станция — один раз (по id и по похожему названию), свои — первыми. */
function merge(...lists) {
  const ids = new Set();
  const names = new Set();
  const out = [];
  for (const s of lists.flat()) {
    const n = norm(s.name);
    if (ids.has(s.id) || (n && names.has(n))) continue;
    ids.add(s.id);
    if (n) names.add(n);
    out.push(s);
  }
  return out;
}
const world = (q) => window.som.radio.search(q).catch(() => null); // null — каталог мира недоступен
async function load() {
  const seq = ++R.seq;
  const chip = CHIPS.find((c) => c.id === R.chip);
  R.worldNote = '';
  if (!R.q && chip.id === 'fav') { R.list = favs(); renderList(); return; }
  if (!R.q && chip.id === 'recent') { R.list = readList('som.radio.recent'); renderList(); return; }
  note(R.q ? 'Ищу станции…' : 'Загружаю станции…');
  const mine = await local();
  if (seq !== R.seq) return;
  if (chip.id === 'world' && !R.q) {
    const all = await world({ limit: 50 });
    if (seq !== R.seq) return;
    if (!all) {
      const why = await window.som.radio.worldDown().catch(() => '');
      note(`Каталог станций со всего мира сейчас недоступен${why ? ` (${why})` : ''}. Русские станции — во вкладке «Россия», они работают без него.`, load);
      return;
    }
    R.list = all;
    renderList();
    return;
  }
  // Свои станции — сразу, станции из мирового каталога — следом, когда (и если) он ответит.
  let first;
  let more;
  if (R.q) {
    const q = norm(R.q);
    first = mine.filter((s) => norm(s.name).includes(q) || (s.tags || []).some((t) => norm(t).includes(q)));
    more = [world({ q: R.q, limit: 40 }), world({ tag: R.q.toLowerCase(), limit: 20 })];
  } else if (chip.id === 'ru') {
    first = mine;
    more = [world({ cc: 'RU', limit: 50 })];
  } else {
    first = mine.filter((s) => (s.g || []).includes(chip.g) || (chip.g2 && (s.g || []).includes(chip.g2)));
    more = [world({ tag: chip.tag, cc: 'RU', limit: 15 }), world({ tag: chip.tag, limit: 40 })];
  }
  if (first.length) {
    R.list = first;
    R.worldNote = 'Ищу ещё станции в мировом каталоге…';
    renderList();
  }
  const got = await Promise.all(more);
  if (seq !== R.seq) return;
  R.worldNote = got.every((x) => x === null) ? 'Станции со всего мира сейчас не загрузились — показаны станции из каталога Som.' : '';
  const box = $('radioList');
  const top = box.scrollTop;
  R.list = merge(first, ...got.map((x) => x || []));
  renderList();
  box.scrollTop = top;
}
function dedupe(list) {
  const seen = new Set();
  return list.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)));
}
// ---------- Своя станция по ссылке ----------
function hostOf(u) { try { return new URL(u).host; } catch { return ''; } }
function addOwnForm() {
  const name = h('input', { type: 'text', class: 'radio-q', placeholder: 'Название, например «Моя станция»', maxlength: '80', 'aria-label': 'Название станции' });
  const url = h('input', { type: 'url', class: 'radio-q', placeholder: 'Ссылка на поток: https://…/stream.mp3, .aac, .m3u8 или .pls', spellcheck: 'false', 'aria-label': 'Ссылка на поток' });
  const err = h('p', { class: 'r-err', hidden: true });
  const save = () => {
    let u;
    try { u = new URL(url.value.trim()); } catch { u = null; }
    if (!u || !/^https?:$/.test(u.protocol)) { err.hidden = false; err.textContent = 'Нужна ссылка на поток, которая начинается с http:// или https://'; url.focus(); return; }
    const st = { id: `my:${hue(u.href)}-${u.href.length}`, name: name.value.trim() || u.host, url: u.href, urls: [u.href], tags: ['своя станция'], mine: true };
    const list = favs().filter((x) => x.id !== st.id);
    list.unshift(slim(st));
    setPref('som.radio.fav', JSON.stringify(list.slice(0, 100)));
    selectChip('fav');
    play(st);
  };
  for (const inp of [name, url]) inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
  const box = h('div', { class: 'r-own' },
    h('p', { class: 'r-own-title', text: 'Своя станция по ссылке' }),
    h('p', { class: 'r-own-hint', text: 'Ссылку на поток обычно можно найти на сайте станции («слушать в плеере», .m3u/.pls) или в описании на сайтах-каталогах.' }),
    name, url, err,
    h('div', { class: 'r-own-btns' },
      h('button', { class: 'btn small primary', type: 'button', text: 'Добавить и слушать', onclick: save }),
      h('button', { class: 'btn small', type: 'button', text: 'Отмена', onclick: () => load() })));
  $('radioList').replaceChildren(box);
  name.focus();
}

function selectChip(id) {
  R.chip = id;
  R.q = '';
  $('radioQ').value = '';
  setPref('som.radio.chip', id);
  for (const b of document.querySelectorAll('#radioChips .chip')) b.setAttribute('aria-selected', String(b.dataset.chip === id));
  load();
}

export function open() {
  const dlg = $('radioDlg');
  if (!dlg.open) dlg.showModal();
  renderFor();
  const saved = pref('som.radio.chip', '');
  selectChip(CHIPS.some((c) => c.id === saved) ? saved : (favs().length ? 'fav' : 'ru'));
  $('radioQ').focus();
}

/** Звонок начался/кончился — радио тише/громче. */
export function duck(on) {
  if (R.ducked === Boolean(on)) return;
  R.ducked = Boolean(on);
  applyVolume();
  render();
}
/** Запись голосового или кружка: радио на паузу, после — снова играет. */
export function holdForRecording(on) {
  if (on) {
    if (R.state === 'playing' || R.state === 'connecting') { pause(); R.pausedFor = 'rec'; }
  } else if (R.pausedFor === 'rec') {
    R.pausedFor = null;
    if (R.st) play(R.st);
  }
}
/** Сменили колонки в настройках. */
export function applyOutput() {
  const a = audio();
  const out = X.out();
  if (typeof a.setSinkId === 'function') a.setSinkId(out && out !== 'default' ? out : '').catch(() => {});
}
/** Для «Скопировать отчёт»: что с радио в этом запуске. */
export async function radioReport() {
  const L = [];
  const why = await window.som.radio.worldDown().catch(() => '');
  L.push(`Каталог Som: ${LOCAL ? `${LOCAL.length} станций` : 'не открывали'} · каталог мира: ${why ? `недоступен (${why})` : 'в порядке или не открывали'}`);
  if (R.st) L.push(`Сейчас: ${R.st.name} · ${R.state}${R.now ? ` · «${R.now}»` : ''}`);
  const bad = [...R.broken].map((id) => [...(LOCAL || []), ...favs(), ...readList('som.radio.recent'), ...R.list].find((s) => s.id === id)).filter(Boolean);
  L.push(bad.length ? `Не заиграли: ${[...new Set(bad.map((s) => `${s.name} (${s.id})`))].join(', ')}` : 'Не заиграли: —');
  return L;
}
export const radioPlaying = () => R.state === 'playing' || R.state === 'connecting';

export function initRadio(deps) {
  X = { ...X, ...deps };
  io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { io.unobserve(e.target); loadLogo(e.target); }
  }, { root: $('radioList'), rootMargin: '200px' });
  $('radioChips').replaceChildren(...CHIPS.map((c) => h('button', {
    class: 'chip', type: 'button', role: 'tab', 'aria-selected': 'false', dataset: { chip: c.id }, text: c.label, onclick: () => selectChip(c.id),
  })), h('button', { class: 'chip chip-add', type: 'button', id: 'radioAddOwn', text: '＋ Своя станция', onclick: () => { for (const b of document.querySelectorAll('#radioChips .chip')) b.setAttribute('aria-selected', 'false'); addOwnForm(); } }));
  let t = 0;
  $('radioQ').addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => {
      R.q = $('radioQ').value.trim();
      for (const b of document.querySelectorAll('#radioChips .chip')) b.setAttribute('aria-selected', String(!R.q && b.dataset.chip === R.chip));
      if (R.q || R.chip) load();
    }, 350);
  });
  $('radioQ').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(t); R.q = $('radioQ').value.trim(); load(); } });
  $('radioBtn').addEventListener('click', open);
  $('radioOpen').addEventListener('click', open);
  $('radioDlgClose').addEventListener('click', () => $('radioDlg').close());
  $('radioDlg').addEventListener('click', (e) => { if (e.target === $('radioDlg')) $('radioDlg').close(); });
  $('radioPlay').addEventListener('click', toggle);
  $('radioJoin').addEventListener('click', joinOffer);
  for (const b of $('radioFor').querySelectorAll('.rf-seg button')) {
    b.addEventListener('click', () => {
      const all = b.dataset.for === 'all';
      if (R.forAll === all) return;
      R.forAll = all;
      // Ведущий передумал: «для себя» — у остальных выключится, станция останется у вас.
      if (!all && R.shared?.dj === 'me') leaveShared();
      // «Для всех» при уже играющей своей станции — сразу включить её у всех.
      else if (all && !R.shared && R.st && (R.state === 'playing' || R.state === 'connecting')) { R.shared = { dj: 'me' }; X.sendTogether({ kind: 'radio', on: true, st: wire(R.st) }); applyVolume(); }
      render();
      renderFor();
    });
  }
  $('radioClose').addEventListener('click', off);
  const vol = $('radioVol');
  vol.value = String(volume());
  vol.addEventListener('input', () => { setPref('som.radio.vol', vol.value); applyVolume(); });
  $('radioDock').addEventListener('wheel', (e) => {
    e.preventDefault();
    const v = Math.max(0, Math.min(100, volume() + (e.deltaY < 0 ? 5 : -5)));
    setPref('som.radio.vol', String(v));
    vol.value = String(v);
    applyVolume();
  }, { passive: false });
  applyVolume();
  wireAudio();
  wireMediaKeys();
  // Слушали раньше — станция ждёт в плеере на паузе, включить можно одной кнопкой.
  try { const last = JSON.parse(pref('som.radio.last', '') || 'null'); if (last?.url) { R.st = last; R.state = 'paused'; } } catch { /* нет */ }
  render();
}
