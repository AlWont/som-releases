import { showMenu, showPicker, showEmoji, closePopup, voiceEl, fmtSec, makeWave, showPanel } from './msgtools.js';
import { startCircle, cameraError, CIRCLE_MAX } from './circle.js';
import { startCapture, encodeOgg, waveOf } from './voice.js';
import { openAvatarEditor } from './avatar-editor.js';
import { THEMES } from './themes.js';
import { initCall, onSignal, onPresence, render as renderCall, audioPrefs, openMic, levelDb, applyDevices, micError, sinkFor, RINGS, ringId, previewRing, setPtt, armPtt, holdMic, camPrefs, camConstraints, callState, pttIsDown, applyVolumes, screenPrefs } from './call.js';
import { play as playSound, soundPrefs, SOUND_KINDS, keyFromEvent } from './sounds.js';

// Som — окно. Ключей здесь нет: всё шифрование, сеть и хранение в ядре.
// Любой текст от друзей выводится только через textContent.

const $ = (id) => document.getElementById(id);

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

// ---------- Состояние ----------
const S = {
  compose: null, // { mode: 'reply' | 'edit', m }
  me: null,
  net: null,
  profile: 'main',
  friends: [],
  current: null,
  history: new Map(), // id друга → сообщения
  sending: false,
  typing: new Map(), // id друга → до какого времени показывать «печатает…»
  typingSent: 0,
};

// ---------- Вызовы ядра ----------
async function call(cmd, args) {
  const r = await window.som.call(cmd, args);
  if (!r || !r.ok) throw new Error(r?.error || 'ядро не ответило');
  return r.result;
}

// ---------- Тема ----------
function readTheme() {
  try { return localStorage.getItem('som.theme') || 'graphite'; } catch { return 'graphite'; }
}
function applyTheme(t) {
  const th = THEMES.find((x) => x.id === t) || THEMES[0];
  document.documentElement.dataset.theme = th.id;
  document.documentElement.dataset.scheme = th.scheme;
  try { localStorage.setItem('som.theme', th.id); } catch { /* без памяти — не страшно */ }
  for (const b of document.querySelectorAll('[data-theme-pick]')) b.setAttribute('aria-pressed', String(b.dataset.themePick === th.id));
}
function renderThemeGrid() {
  const cur = readTheme();
  $('themeGrid').replaceChildren(...THEMES.map((th) => {
    const prev = h('div', { class: 'theme-prev', 'aria-hidden': 'true' },
      h('i', { class: 'tp-side' }), h('i', { class: 'tp-main' }, h('i', { class: 'tp-b1' }), h('i', { class: 'tp-b2' }), h('i', { class: 'tp-acc' })));
    prev.style.background = th.bg;
    prev.querySelector('.tp-side').style.background = th.side;
    prev.querySelector('.tp-b1').style.background = th.theirs;
    prev.querySelector('.tp-b2').style.background = th.mine;
    prev.querySelector('.tp-acc').style.background = th.accent;
    return h('button', { type: 'button', class: 'theme-card', dataset: { themePick: th.id }, 'aria-pressed': String(th.id === cur), title: th.scheme === 'light' ? 'Светлая' : 'Тёмная', onclick: () => applyTheme(th.id) },
      prev, h('span', { text: th.name }));
  }));
}
// Масштаб интерфейса — для больших экранов (2K, 4K), где всё мелкое.
const ZOOMS = [80, 90, 100, 110, 125, 150];
function readZoom() {
  try { const z = Number(localStorage.getItem('som.zoom')); return ZOOMS.includes(z) ? z : 100; } catch { return 100; }
}
function applyZoom(z) {
  const v = ZOOMS.includes(z) ? z : 100;
  try { localStorage.setItem('som.zoom', String(v)); } catch { /* не страшно */ }
  window.som.setZoom?.(v / 100);
  for (const b of document.querySelectorAll('[data-zoom]')) b.setAttribute('aria-pressed', String(Number(b.dataset.zoom) === v));
}

// ---------- Мелочи ----------
const PALETTE = ['#c9b38a', '#9fb7a4', '#a9b6c8', '#c7a3a0', '#b7aacb', '#c4bd8e', '#9ec1c4', '#c8a98a'];
function colorFor(id) {
  let n = 0;
  for (const ch of String(id)) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[n % PALETTE.length];
}
function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
  const s = parts.length > 1 ? parts[0][0] + parts[1][0] : [...(parts[0] || '?')][0];
  return s.toUpperCase();
}
// Фото друзей и своё: грузим из ядра один раз на версию.
const avatarCache = new Map();
function avatarUrl(key, v) {
  const k = `${key}:${v}`;
  if (!avatarCache.has(k)) {
    avatarCache.set(k, call('avatar', { id: key }).then((r) => (r.data ? blobUrl(r.data, 'image/jpeg') : null)).catch(() => null));
  }
  return avatarCache.get(k);
}
// Анимация и баннер: тоже из ядра, ключ — id файла (меняется при каждой замене).
const mediaCache = new Map();
function mediaUrl(key, kind, fid) {
  const k = `${key}:${kind}:${fid}`;
  if (!mediaCache.has(k)) {
    mediaCache.set(k, call('media', { id: key, kind }).then((r) => (r.data ? blobUrl(r.data, r.mime || 'application/octet-stream') : null)).catch(() => null));
  }
  return mediaCache.get(k);
}
function noAnim() {
  try { return localStorage.getItem('som.noAnim') === '1'; } catch { return false; }
}
function startAnim(el) {
  const a = el?._anim;
  if (!a || el.querySelector('video')) return;
  const v = h('video', { 'aria-hidden': 'true' });
  v.muted = true;
  v.loop = true;
  v.playsInline = true;
  // У WebM из MediaRecorder нет длительности — подстрахуем повтор вручную.
  v.addEventListener('ended', () => { v.currentTime = 0; v.play().catch(() => {}); });
  const dot = el.querySelector('.dot');
  el.insertBefore(v, dot);
  (a.url ? Promise.resolve(a.url) : mediaUrl(a.key, 'anim', a.fid)).then((u) => {
    if (!u || !v.isConnected) { v.remove(); return; }
    v.src = u;
    v.play().catch(() => {});
  });
}
function stopAnim(el) {
  if (el?._anim && !el._anim.always) el.querySelector('video')?.remove();
}
/** Наведение на строку целиком тоже оживляет аватар. */
function hoverAnim(host, av) {
  if (!av._anim) return;
  host.addEventListener('mouseenter', () => startAnim(av));
  host.addEventListener('mouseleave', () => stopAnim(av));
}
function avatar(id, name, { size = '', online = null, presence, avatarV = 0, color = '', self = false, img = null, anim = null, animUrl = null, always = false } = {}) {
  const el = h('div', { class: `avatar ${size}`.trim(), 'aria-hidden': 'true', text: initials(name) });
  el.style.background = color || colorFor(id); // стили через CSSOM разрешены политикой
  const put = (u) => { if (u) { const im = h('img', { alt: '' }); im.src = u; el.insertBefore(im, el.querySelector('video, .dot')); } };
  if (img) put(img);
  else if (avatarV > 0) avatarUrl(self ? 'me' : id, avatarV).then(put);
  const p = presence ?? (online === null ? null : online ? 'online' : 'offline');
  if (p) el.append(h('span', { class: 'dot', dataset: { p } }));
  if ((anim || animUrl) && !noAnim()) {
    el._anim = { key: self ? 'me' : id, fid: anim, url: animUrl, always };
    el.dataset.anim = '1';
    if (always) startAnim(el);
    else { el.addEventListener('mouseenter', () => startAnim(el)); el.addEventListener('mouseleave', () => stopAnim(el)); }
  }
  return el;
}
function friendAvatar(f, size = '') {
  return avatar(f.id, f.name, { size, presence: f.state === 'friend' ? f.presence : null, avatarV: f.avatarV, color: f.color, anim: f.state === 'friend' ? f.anim : null });
}
function meAvatar(size = '', withDot = true) {
  const me = S.me || {};
  return avatar(me.id || 'me', me.name, { size, presence: withDot ? me.effective : null, avatarV: me.avatarV, color: me.color, self: true, anim: me.anim });
}
const PRESENCE = { online: 'в сети', away: 'не на месте', dnd: 'не беспокоить', invisible: 'невидимка', offline: 'не в сети' };

const fmtTime = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });
const fmtDay = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });
const fmtDayYear = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
function dayLabel(ms) {
  const d = new Date(ms);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const that = new Date(d); that.setHours(0, 0, 0, 0);
  const diff = Math.round((today - that) / 86400000);
  if (diff === 0) return 'Сегодня';
  if (diff === 1) return 'Вчера';
  return (d.getFullYear() === today.getFullYear() ? fmtDay : fmtDayYear).format(d);
}
function shortWhen(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  return dayLabel(ms) === 'Сегодня' ? fmtTime.format(d) : dayLabel(ms);
}
/** Свой статус со значком; истёкший не показываем. */
function statusOf(p) {
  if (p.statusUntil && p.statusUntil <= Date.now()) return '';
  return [p.statusEmoji, p.statusText].filter(Boolean).join(' ');
}
function fmtDur(ms) {
  const m = Math.max(0, Math.floor(ms / 60000));
  if (m < 1) return 'только начал';
  if (m < 60) return `${m} мин`;
  return `${Math.floor(m / 60)} ч ${m % 60} мин`;
}
const gameOf = (f) => (f.online && f.activity?.game ? f.activity.game : '');
/** «Был в сети» — с точностью до часа. */
function seenAgo(ms) {
  const d = Date.now() - ms;
  if (d < 3600000) return 'меньше часа назад';
  if (d < 12 * 3600000) return `${Math.floor(d / 3600000)} ч назад`;
  const day = dayLabel(ms);
  return day === 'Сегодня' ? `сегодня около ${new Date(ms).getHours()} ч` : day === 'Вчера' ? 'вчера' : day;
}
function seenText(f) {
  const st = statusOf(f);
  if (f.online) {
    const g = gameOf(f);
    const p = g ? `играет в ${g}` : PRESENCE[f.presence] || 'в сети';
    return st ? `${p} · ${st}` : p;
  }
  if (!f.lastSeen) return 'не в сети';
  return `последний раз в сети ${seenAgo(f.lastSeen)}`;
}
const STATUS = { queued: 'в очереди', sent: 'отправлено', delivered: 'доставлено', read: 'прочитано', failed: 'не отправлено' };
const STATUS_ORDER = { queued: 0, sent: 1, delivered: 2, read: 3 };
const isTyping = (id) => (S.typing.get(id) || 0) > Date.now();

function fmtSize(n) {
  if (n < 1024) return `${n} Б`;
  const units = ['КБ', 'МБ', 'ГБ'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v < 10 ? v.toFixed(1).replace('.', ',') : Math.round(v)} ${units[i]}`;
}
function msgPreview(m) {
  if (m.deleted) return 'Сообщение удалено';
  if (m.file?.voice?.circle) return 'Видеосообщение';
  if (m.file?.voice) return 'Голосовое сообщение';
  if (m.file) return m.file.mime.startsWith('image/') ? 'Фото' : `Файл: ${m.file.name}`;
  return m.text;
}

// ---------- Сведения для отчёта (на этом ПК; переписки и ключей здесь нет) ----------
const DIAG = (() => {
  try { const d = JSON.parse(localStorage.getItem('som.diag') || '{}'); return { calls: d.calls || [], ns: d.ns || null, errors: d.errors || [] }; } catch { return { calls: [], ns: null, errors: [] }; }
})();
function saveDiag() {
  try { localStorage.setItem('som.diag', JSON.stringify(DIAG)); } catch { /* без памяти — отчёт будет короче */ }
}
function diagError(text) {
  DIAG.errors.push({ at: Date.now(), text: String(text).slice(0, 300) });
  if (DIAG.errors.length > 30) DIAG.errors.splice(0, DIAG.errors.length - 30);
  saveDiag();
}
window.addEventListener('error', (e) => diagError(`окно: ${e.message} (${(e.filename || '').split('/').pop()}:${e.lineno})`));
window.addEventListener('unhandledrejection', (e) => diagError(`окно: ${e.reason?.message || e.reason}`));

function toast(text, kind = '') {
  if (kind === 'bad') diagError(text);
  const el = h('div', { class: 'toast', dataset: { kind }, text });
  $('toasts').append(el);
  setTimeout(() => el.remove(), kind === 'bad' ? 7000 : 4500);
}

function show(id) {
  for (const v of ['boot', 'welcome', 'shell']) $(v).hidden = v !== id;
}

// ---------- Знакомство ----------
function setupWelcome() {
  $('welcomeForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('welcomeName').value.trim();
    if (!name) return;
    $('welcomeGo').disabled = true;
    $('welcomeError').hidden = true;
    try {
      S.me = await call('create_profile', { name });
      $('welcomeCode').textContent = S.me.code;
      $('welcomeStart').hidden = true;
      $('welcomeDone').hidden = false;
      $('welcomeEnter').focus();
    } catch (err) {
      $('welcomeError').textContent = `Не получилось: ${err.message}`;
      $('welcomeError').hidden = false;
    } finally {
      $('welcomeGo').disabled = false;
    }
  });
  $('welcomeInvite').addEventListener('click', openInvite);
  $('welcomeEnter').addEventListener('click', enterShell);
}

// ---------- Основное окно ----------
async function enterShell() {
  show('shell');
  renderMe();
  renderBanner();
  S.friends = await call('friends').catch(() => []);
  S.history.set(SAVED.id, await call('saved').catch(() => []));
  renderFriends();
  renderChat();
  // Som открыли щелчком по ссылке som://add/… — сразу показываем, кого добавляем.
  const inv = S.pendingInvite || await window.som.takeInvite();
  S.pendingInvite = null;
  if (inv) openAdd(inv);
}

function renderMe() {
  const me = S.me;
  if (!me?.hasProfile) return;
  $('meAvatar').replaceChildren(meAvatar('small'));
  $('meName').textContent = me.name;
  const st = statusOf(me);
  $('meCode').textContent = st || (me.effective && me.effective !== 'online' ? PRESENCE[me.effective] : me.code);
  $('meCode').classList.toggle('code', !st && (!me.effective || me.effective === 'online'));
  const second = S.profile === 'main';
  $('emptySecond').hidden = !second;
  $('emptySecondHint').hidden = !second;
  $('setSecond').disabled = !second;
}

function renderBanner() {
  const b = $('banner');
  const n = S.net;
  let text = '';
  if (!n?.address) text = 'Нет сети: Som не нашёл ни Radmin VPN, ни домашней сети. Друзья не смогут до вас достучаться.';
  else if (!n.radmin) text = `Radmin VPN не найден. Som работает только внутри домашней сети (${n.address}). Чтобы друзья из других мест могли подключиться, включите Radmin VPN и перезапустите Som.`;
  else if (S.me && S.me.hasProfile && !S.me.listening) text = 'Som не может принимать подключения. Проверьте, разрешён ли он в брандмауэре Windows.';
  b.textContent = text;
  b.hidden = !text;
}

function friendRow(f) {
  const cur = S.current === f.id;
  const sub = f.state === 'outgoing' ? (f.requestDelivered ? 'заявка доставлена' : 'заявка ждёт отправки')
    : isTyping(f.id) ? 'печатает…'
    : f.last ? (f.last.dir === 'out' ? `Вы: ${f.last.text}` : f.last.text) : seenText(f);
  const side = h('div', { class: 'row-side' },
    f.last ? h('span', { class: 'row-time', text: shortWhen(f.last.at) }) : null,
    f.unread ? h('span', { class: 'badge', text: f.unread > 99 ? '99+' : String(f.unread) }) : null,
  );
  const av = friendAvatar(f);
  const row = h('button', { class: 'row', type: 'button', 'aria-current': cur ? 'true' : 'false', onclick: () => selectFriend(f.id), oncontextmenu: (e) => { e.preventDefault(); friendMenu(f, e.clientX, e.clientY); } },
    av,
    h('div', { class: 'row-main' }, h('div', { class: 'row-name', text: f.name }), h('div', { class: 'row-sub', text: sub })),
    side,
  );
  hoverAnim(row, av);
  return row;
}

function requestCard(f) {
  return h('div', { class: 'req' },
    h('div', { class: 'req-top' },
      avatar(f.id, f.name),
      h('div', { class: 'row-main' }, h('div', { class: 'row-name', text: f.name }), h('div', { class: 'row-sub code', text: f.code })),
    ),
    h('div', { class: 'req-actions' },
      h('button', { class: 'btn small primary', type: 'button', text: 'Принять', onclick: (e) => acceptRequest(f, e.currentTarget) }),
      h('button', { class: 'btn small', type: 'button', text: 'Отклонить', onclick: () => declineRequest(f) }),
    ),
  );
}

function renderFriends() {
  const list = $('friendList');
  const incoming = S.friends.filter((f) => f.state === 'incoming');
  const outgoing = S.friends.filter((f) => f.state === 'outgoing');
  const friends = S.friends.filter((f) => f.state === 'friend')
    .sort((a, b) => (b.last?.at || b.lastSeen || 0) - (a.last?.at || a.lastSeen || 0));
  renderFolders();
  const cur = FOLD.cur;
  const folder = FOLD.list.find((x) => x.id === cur);
  const inFolder = folder ? new Set(folder.members || []) : null;
  const archivedIds = new Set(FOLD.archived);
  const shown = friends.filter((f) => !inFolder || inFolder.has(f.id));
  const active = shown.filter((f) => !archivedIds.has(f.id));
  const archived = shown.filter((f) => archivedIds.has(f.id));
  const online = active.filter((f) => f.online);
  const offline = active.filter((f) => !f.online);
  const parts = [];
  if (!folder) parts.push(savedRow());
  if (incoming.length && !folder) parts.push(h('div', { class: 'group-title', text: `Заявки — ${incoming.length}` }), ...incoming.map(requestCard));
  if (online.length) parts.push(h('div', { class: 'group-title', text: `В сети — ${online.length}` }), ...online.map(friendRow));
  if (offline.length) parts.push(h('div', { class: 'group-title', text: `Не в сети — ${offline.length}` }), ...offline.map(friendRow));
  if (outgoing.length && !folder) parts.push(h('div', { class: 'group-title', text: 'Ждут ответа' }), ...outgoing.map(friendRow));
  if (archived.length) {
    const unreadA = archived.reduce((n, f) => n + (f.unread || 0), 0);
    const open = FOLD.archOpen;
    parts.push(h('button', { type: 'button', class: 'group-title arch-title', 'aria-expanded': String(open), onclick: () => { FOLD.archOpen = !open; renderFriends(); } },
      `${open ? '▾' : '▸'} Архив — ${archived.length}`, unreadA ? h('span', { class: 'badge', text: String(unreadA) }) : null));
    if (open) parts.push(...archived.map(friendRow));
  }
  if (folder && !shown.length) parts.push(h('div', { class: 'side-empty', text: 'В этой папке пока никого. Правый щелчок по другу → «Папка…», или правый щелчок по названию папки.' }));
  if (!friends.length && !incoming.length && !outgoing.length) parts.push(h('div', { class: 'side-empty', text: 'Друзей пока нет. Нажмите «+», чтобы добавить.' }));
  list.replaceChildren(...parts);
  const unread = friends.reduce((n, f) => n + (f.unread || 0), 0) + incoming.length;
  document.title = unread ? `(${unread}) Som` : (S.profile === 'main' ? 'Som' : `Som — профиль ${S.profile}`);
}

// «Избранное» — чат с самим собой: заметки и сохранённые сообщения, только на этом ПК.
const SAVED = { id: 'saved', name: 'Избранное', state: 'saved', color: '#7fa0a8' };
function currentFriend() {
  if (S.current === SAVED.id) return SAVED;
  return S.friends.find((f) => f.id === S.current) || null;
}
function savedAvatar(size = '') {
  const el = h('div', { class: `avatar ${size} saved-av`.trim(), 'aria-hidden': 'true' });
  el.innerHTML = '<svg class="ic" viewBox="0 0 24 24"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>';
  return el;
}

async function selectFriend(id) {
  if (S.current !== id) {
    if (S.compose) cancelCompose();
    closeSearch();
    closePopup();
    voiceLeaveChat();
  }
  S.current = id;
  renderFriends();
  const f = currentFriend();
  if (f?.state === 'friend') {
    try { S.history.set(id, await call('history', { id, limit: 500 })); } catch (err) { toast(`История: ${err.message}`, 'bad'); }
    if (f.unread) call('read', { id }).catch(() => {});
  } else if (f?.state === 'saved') {
    try { S.history.set(SAVED.id, await call('saved')); } catch (err) { toast(`Избранное: ${err.message}`, 'bad'); }
  }
  renderChat({ scroll: true });
  if (f?.state === 'friend' || f?.state === 'saved') $('composerInput').focus();
}

function renderChat({ scroll = false } = {}) {
  const f = currentFriend();
  if (!f) {
    S.current = null;
    $('chatView').hidden = true;
    $('chatEmpty').hidden = false;
    const has = S.friends.some((x) => x.state === 'friend');
    $('emptyTitle').textContent = has ? 'Выберите друга слева' : 'Здесь пока тихо';
    $('emptyText').textContent = has ? 'Переписка шифруется на вашем ПК и расшифровывается только у друга.' : 'Добавьте друга по его приглашению или отправьте ему своё.';
    renderCall();
    return;
  }
  $('chatEmpty').hidden = true;
  $('chatView').hidden = false;
  const isSaved = f.state === 'saved';
  $('chatView').classList.toggle('is-saved', isSaved);
  $('chatAvatar').replaceChildren(isSaved ? savedAvatar('big') : friendAvatar(f, 'big'));
  $('chatName').textContent = f.name;
  const status = $('chatStatus');
  status.dataset.on = f.online ? '1' : '0';
  status.textContent = isSaved ? 'Заметки себе и сохранённые сообщения. Хранятся только на этом компьютере.'
    : f.state === 'friend' ? (isTyping(f.id) ? 'печатает…' : seenText(f)) : f.state === 'outgoing' ? (f.requestDelivered ? 'заявка доставлена' : 'заявка ждёт отправки') : 'заявка в друзья';
  renderPinBar();
  const verify = $('chatVerify');
  verify.replaceChildren();
  if (f.groupCode) verify.append('Код чата', h('br'), h('b', { class: 'code', text: f.groupCode }));

  const isFriend = f.state === 'friend' || isSaved;
  $('messages').hidden = !isFriend;
  $('composer').hidden = !isFriend;
  showVoiceUi();
  $('composerNote').hidden = !isFriend;
  $('pendingPane').hidden = isFriend;
  if (isFriend) {
    // Ленту перерисовываем целиком только при смене чата: иначе прервётся играющая музыка или видео.
    if (scroll || S.renderedFor !== f.id) renderMessages(f, scroll);
    $('composerNote').textContent = isSaved ? 'Видно только вам — друзьям отсюда ничего не уходит. Enter — сохранить.'
      : f.online ? 'Шифрование MLS. Enter — отправить, Shift+Enter — новая строка.'
      : `${f.name} не в сети. Сообщения подождут и уйдут, как только ${f.name} появится в сети.`;
  } else {
    renderPending(f);
  }
  renderCall();
}

function renderPending(f) {
  const actions = $('pendingActions');
  if (f.state === 'outgoing') {
    $('pendingTitle').textContent = `Заявка для ${f.name}`;
    $('pendingText').textContent = f.requestDelivered
      ? `Заявка доставлена. Как только ${f.name} её примет, здесь откроется чат. Код друга: ${f.code}.`
      : `Som стучится по адресу ${f.addr}. Заявка уйдёт, как только ${f.name} появится в сети, — держите Som открытым. Код друга: ${f.code}.`;
    actions.replaceChildren(h('button', { class: 'btn', type: 'button', text: 'Отменить заявку', onclick: () => declineRequest(f) }));
  } else {
    $('pendingTitle').textContent = `Заявка в друзья: ${f.name}`;
    $('pendingText').textContent = `Код друга: ${f.code}. Если сомневаетесь — спросите у него этот код голосом или в другом мессенджере.`;
    actions.replaceChildren(
      h('button', { class: 'btn primary', type: 'button', text: 'Принять', onclick: (e) => acceptRequest(f, e.currentTarget) }),
      h('button', { class: 'btn', type: 'button', text: 'Отклонить', onclick: () => declineRequest(f) }),
    );
  }
}

// ---------- Ссылки, упоминания, превью ----------
const URL_RE = /\bhttps?:\/\/[^\s<>"'«»]+/gi;
const trimUrl = (u) => u.replace(/[.,!?;:)\]}»…]+$/, '');
const escRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function mentions(text, name) {
  return Boolean(text && name && text.toLowerCase().includes(`@${name.toLowerCase()}`));
}
/** Текст сообщения: ссылки — кликабельные (открываются в браузере), @имя — подсвечено. Только textContent, без HTML. */
function richText(text) {
  const out = [];
  const names = [S.me?.name, currentFriend()?.state === 'friend' ? currentFriend().name : null].filter(Boolean);
  const mentionRe = names.length ? new RegExp(`@(?:${names.map(escRe).join('|')})`, 'gi') : null;
  const plain = (t) => {
    if (!mentionRe || !t.includes('@')) { out.push(t); return; }
    let last = 0;
    for (const m of t.matchAll(mentionRe)) {
      if (m.index > last) out.push(t.slice(last, m.index));
      const me = S.me?.name && m[0].slice(1).toLowerCase() === S.me.name.toLowerCase();
      out.push(h('span', { class: `mention${me ? ' me' : ''}`, text: m[0] }));
      last = m.index + m[0].length;
    }
    if (last < t.length) out.push(t.slice(last));
  };
  let last = 0;
  for (const m of String(text || '').matchAll(URL_RE)) {
    const url = trimUrl(m[0]);
    if (m.index > last) plain(text.slice(last, m.index));
    out.push(h('a', { class: 'lnk', href: url, title: `${url}\nОткроется в браузере`, text: url, onclick: (e) => { e.preventDefault(); e.stopPropagation(); window.som.openLink(url); } }));
    last = m.index + url.length;
  }
  if (last < String(text || '').length) plain(text.slice(last));
  return out;
}
function linkCard(l) {
  const card = h('button', { type: 'button', class: 'link-card', title: `${l.url}\nОткроется в браузере`, onclick: (e) => { e.stopPropagation(); window.som.openLink(l.url); } },
    l.img ? h('img', { alt: '', src: `data:image/jpeg;base64,${l.img}` }) : null,
    h('div', { class: 'lc-text' },
      l.site ? h('span', { class: 'lc-site', text: l.site }) : null,
      l.title ? h('b', { text: l.title }) : null,
      l.desc ? h('span', { class: 'lc-desc', text: l.desc }) : null));
  return card;
}
function linkPreviewOn() {
  try { return localStorage.getItem('som.linkPreview') !== '0'; } catch { return true; }
}
const LINK = { url: '', data: null, dismissed: '', seq: 0, timer: 0 };
function clearLinkBar() {
  LINK.url = '';
  LINK.data = null;
  LINK.dismissed = '';
  LINK.seq += 1;
  $('linkBar').hidden = true;
}
function showLinkBar(title, sub) {
  $('lbTitle').textContent = title || '';
  $('lbSite').textContent = sub || '';
  $('linkBar').hidden = false;
}
async function checkLink() {
  const text = $('composerInput').value;
  const m = text.match(URL_RE);
  const url = m ? trimUrl(m[0]) : '';
  if (!url) { if (LINK.url) clearLinkBar(); return; }
  if (!linkPreviewOn() || url === LINK.dismissed || url === LINK.url) return;
  LINK.url = url;
  LINK.data = null;
  const seq = ++LINK.seq;
  showLinkBar('Загружаю превью…', url);
  const v = await window.som.linkPreview(url).catch(() => null);
  if (seq !== LINK.seq) return;
  LINK.data = v;
  if (v) showLinkBar(v.title || v.site, v.site && v.title ? v.site : url); else $('linkBar').hidden = true;
}
function linkForSend(text) {
  const d = LINK.data;
  return d && text.includes(d.url) && LINK.dismissed !== d.url ? d : undefined;
}

// @упоминания: подсказка имени, пока пишешь.
let mentionAt = -1;
function mentionCandidates() {
  const f = currentFriend();
  return f?.state === 'friend' ? [f.name] : [];
}
function checkMention() {
  const input = $('composerInput');
  const pop = $('mentionPop');
  const upto = input.value.slice(0, input.selectionStart);
  const m = /(^|\s)@([^\s@]{0,24})$/.exec(upto);
  const list = m ? mentionCandidates().filter((n) => n.toLowerCase().startsWith(m[2].toLowerCase())) : [];
  if (!list.length) { pop.hidden = true; mentionAt = -1; return; }
  mentionAt = upto.length - m[2].length - 1;
  pop.replaceChildren(...list.map((n, i) => h('button', { type: 'button', class: i === 0 ? 'on' : '', text: `@${n}`, onmousedown: (e) => { e.preventDefault(); pickMention(n); } })));
  pop.hidden = false;
}
function pickMention(name) {
  const input = $('composerInput');
  if (mentionAt < 0) return;
  const caret = input.selectionStart;
  input.value = `${input.value.slice(0, mentionAt)}@${name} ${input.value.slice(caret)}`;
  const pos = mentionAt + name.length + 2;
  input.setSelectionRange(pos, pos);
  $('mentionPop').hidden = true;
  mentionAt = -1;
  input.focus();
}

// ---------- Закреплённые и «Избранное» ----------
let pinIdx = 0;
function renderPinBar() {
  const f = currentFriend();
  const pins = f?.state === 'friend' ? f.pinned || [] : [];
  $('pinBar').hidden = !pins.length;
  if (!pins.length) return;
  if (pinIdx >= pins.length) pinIdx = 0;
  const p = pins[pinIdx];
  $('pinCount').textContent = pins.length > 1 ? `Закреплено · ${pinIdx + 1} из ${pins.length}` : 'Закреплено';
  $('pinText').textContent = p.text || '';
  $('pinBar').dataset.mid = p.id;
}
async function pinMsg(f, mid, on) {
  try {
    f.pinned = await call('pin', { id: f.id, mid, on });
    pinIdx = 0;
    renderPinBar();
    toast(on ? 'Закреплено — видно вам обоим.' : 'Откреплено.');
  } catch (err) { toast(err.message, 'bad'); }
}
function addSaved(m) {
  const list = S.history.get(SAVED.id) || [];
  S.history.set(SAVED.id, list);
  if (list.some((x) => x.id === m.id)) return;
  list.push(m);
  if (S.current === SAVED.id) appendMessage(SAVED, m);
  renderFriends();
}
async function saveToFavorites(f, m) {
  try {
    addSaved(await call('saved_add', { from: { id: f.id, mid: m.id } }));
    toast('Сохранено в «Избранное».', 'ok');
  } catch (err) { toast(err.message, 'bad'); }
}

// ---------- Громкость друга (правый щелчок по аватару) ----------
function volumePanel(f, x, y) {
  if (!f || f.state !== 'friend') return;
  const row = (label, get, set) => {
    const out = h('output', { text: `${get()}%` });
    const r = h('input', { type: 'range', min: '0', max: '200', step: '5', value: String(get()), 'aria-label': `${label}: ${f.name}` });
    r.addEventListener('input', () => { set(Number(r.value)); out.textContent = `${r.value}%`; applyVolumes(f.id); });
    return { node: h('label', { class: 'vp-row' }, h('span', { text: label }), r, out), r, out };
  };
  const voice = row('Голос', () => audioPrefs.vol(f.id), (v) => audioPrefs.setVol(f.id, v));
  const demo = row('Демка', () => screenPrefs.vol(f.id), (v) => screenPrefs.setVol(f.id, v));
  const reset = h('button', { type: 'button', class: 'btn small', text: 'Сбросить на 100%', onclick: () => {
    audioPrefs.setVol(f.id, 100); screenPrefs.setVol(f.id, 100);
    for (const x of [voice, demo]) { x.r.value = '100'; x.out.textContent = '100%'; }
    applyVolumes(f.id);
  } });
  const node = h('div', { class: 'pop-volume', role: 'dialog', 'aria-label': `Громкость ${f.name}` },
    h('b', { text: f.name }), voice.node, demo.node,
    h('div', { class: 'vp-foot' }, h('span', { class: 'hint', text: 'Слышите только вы. Запоминается для этого друга.' }), reset));
  showPanel(x, y, node);
  setTimeout(() => voice.r.focus(), 0);
}

// ---------- Папки и архив (только на этом ПК) ----------
function readJSON(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } }
function writeJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* не страшно */ } }
const FOLD = {
  get list() { const l = readJSON('som.folders', []); return Array.isArray(l) ? l : []; },
  set list(v) { writeJSON('som.folders', v); },
  get cur() { const c = readJSON('som.folder', 'all'); return c === 'all' || this.list.some((x) => x.id === c) ? c : 'all'; },
  set cur(v) { writeJSON('som.folder', v); },
  get archived() { const a = readJSON('som.archived', []); return Array.isArray(a) ? a : []; },
  set archived(v) { writeJSON('som.archived', v); },
  get archOpen() { return readJSON('som.archOpen', false) === true; },
  set archOpen(v) { writeJSON('som.archOpen', Boolean(v)); },
};
function renderFolders() {
  const list = FOLD.list;
  const cur = FOLD.cur;
  const friends = S.friends.filter((f) => f.state === 'friend');
  const unreadIn = (ids) => friends.filter((f) => ids.includes(f.id)).reduce((n, f) => n + (f.unread || 0), 0);
  const chip = (id, label, unread, onctx) => h('button', {
    type: 'button', class: 'folder-chip', 'aria-pressed': String(cur === id), title: id === 'all' ? 'Все чаты' : `Папка «${label}». Правый щелчок — изменить`,
    onclick: () => { FOLD.cur = id; renderFriends(); }, oncontextmenu: onctx,
  }, label, unread ? h('span', { class: 'badge', text: String(unread) }) : null);
  $('folderTabs').replaceChildren(
    chip('all', 'Все', 0, null),
    ...list.map((fo) => chip(fo.id, fo.name, unreadIn(fo.members || []), (e) => { e.preventDefault(); openFolderDlg(fo); })),
    h('button', { type: 'button', class: 'folder-chip add', title: 'Новая папка', 'aria-label': 'Новая папка', text: '+', onclick: () => openFolderDlg(null) }),
  );
}
function openFolderDlg(folder, preselect) {
  const dlg = $('folderDlg');
  dlg.dataset.id = folder?.id || '';
  $('fdlgTitle').textContent = folder ? 'Папка' : 'Новая папка';
  $('fdlgName').value = folder?.name || '';
  const members = new Set(folder?.members || (preselect ? [preselect] : []));
  const friends = S.friends.filter((f) => f.state === 'friend').sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  $('fdlgList').replaceChildren(...(friends.length ? friends.map((f) => {
    const box = h('input', { type: 'checkbox', value: f.id });
    box.checked = members.has(f.id);
    return h('label', { class: 'check fdlg-row' }, box, friendAvatar(f, 'small'), h('span', { text: f.name }));
  }) : [h('p', { class: 'hint', text: 'Друзей пока нет.' })]));
  $('fdlgDelete').hidden = !folder;
  dlg.showModal();
  $('fdlgName').focus();
}
function saveFolder() {
  const dlg = $('folderDlg');
  const name = $('fdlgName').value.trim().slice(0, 24);
  if (!name) { $('fdlgName').focus(); return; }
  const members = [...$('fdlgList').querySelectorAll('input:checked')].map((b) => b.value);
  const list = FOLD.list;
  const id = dlg.dataset.id || `f${Date.now().toString(36)}`;
  const i = list.findIndex((x) => x.id === id);
  const item = { id, name, members };
  if (i >= 0) list[i] = item; else list.push(item);
  FOLD.list = list;
  FOLD.cur = id;
  dlg.close();
  renderFriends();
}
function deleteFolder() {
  const id = $('folderDlg').dataset.id;
  FOLD.list = FOLD.list.filter((x) => x.id !== id);
  if (FOLD.cur === id) FOLD.cur = 'all';
  $('folderDlg').close();
  renderFriends();
}
function toggleInFolder(fid, folderId) {
  FOLD.list = FOLD.list.map((fo) => (fo.id !== folderId ? fo : { ...fo, members: (fo.members || []).includes(fid) ? fo.members.filter((x) => x !== fid) : [...(fo.members || []), fid] }));
  renderFriends();
}
function setArchived(fid, on) {
  const a = new Set(FOLD.archived);
  if (on) a.add(fid); else a.delete(fid);
  FOLD.archived = [...a];
  renderFriends();
  toast(on ? 'Чат в архиве — внизу списка. Сообщения продолжают приходить.' : 'Чат вернулся в список.');
}
function friendMenu(f, x, y) {
  if (f.state !== 'friend') return;
  const archived = FOLD.archived.includes(f.id);
  showMenu(x, y, [
    ...FOLD.list.map((fo) => ({ label: `${(fo.members || []).includes(f.id) ? '✓' : '\u2003'} Папка «${fo.name}»`, onclick: () => toggleInFolder(f.id, fo.id) })),
    { label: '\u2003Громкость…', onclick: () => volumePanel(f, x, y) },
    { label: '\u2003Новая папка…', onclick: () => openFolderDlg(null, f.id) },
    { label: archived ? '\u2003Вернуть из архива' : '\u2003В архив', onclick: () => setArchived(f.id, !archived) },
  ]);
}
function savedRow() {
  const list = S.history.get(SAVED.id) || [];
  const last = list[list.length - 1];
  return h('button', { class: 'row saved-row', type: 'button', 'aria-current': S.current === SAVED.id ? 'true' : 'false', onclick: () => selectFriend(SAVED.id) },
    savedAvatar(),
    h('div', { class: 'row-main' }, h('div', { class: 'row-name', text: 'Избранное' }), h('div', { class: 'row-sub', text: last ? msgPreview(last) : 'заметки себе' })));
}

// Что ядро убрало из отправленного фото — показываем отправителю под картинкой.
const CLEANED = new Map();
function cleanOn() {
  try { return localStorage.getItem('som.cleanMeta') !== '0'; } catch { return true; }
}
function cleanedEl(mid) {
  const r = CLEANED.get(mid);
  return r?.length ? h('div', { class: 'clean-note', title: 'Друг получит фото без этих данных', text: `Убрано из фото: ${r.join(', ')}` }) : null;
}
function messageEl(m, prev) {
  const same = prev && prev.dir === m.dir && m.at - prev.at < 5 * 60 * 1000;
  const meta = h('div', { class: 'meta' }, fmtTime.format(new Date(m.at)));
  if (m.edited && !m.deleted) meta.append(' · изменено');
  if (m.dir === 'out' && !m.deleted && m.status !== 'saved') meta.append(' · ', h('span', { class: 'st', dataset: { st: m.status }, text: STATUS[m.status] || m.status }));
  let body;
  if (m.deleted) body = h('div', { class: 'bubble deleted', text: 'Сообщение удалено' });
  else if (m.file) body = attachmentEl(m);
  else body = h('div', { class: 'bubble' }, m.reply ? quoteEl(m.reply) : null, h('span', { class: 'txt' }, richText(m.text)), m.link ? linkCard(m.link) : null);
  const origin = m.origin ? h('div', { class: 'origin', text: `${m.origin.name} · ${dayLabel(m.origin.at).toLowerCase()}, ${fmtTime.format(new Date(m.origin.at))}` }) : null;
  const mentionsMe = m.dir === 'in' && !m.deleted && mentions(m.text, S.me?.name);
  const wrap = h('div', { class: `msg ${m.dir}${same && !origin ? ' same' : ''}${mentionsMe ? ' mentions-me' : ''}`, dataset: { mid: m.id } },
    m.deleted ? null : actionsEl(m), origin, body, reactionsEl(m), cleanedEl(m.id), meta);
  wrap.addEventListener('contextmenu', (e) => { e.preventDefault(); msgMenu(m, e.clientX, e.clientY); });
  return wrap;
}

function quoteEl(r) {
  const who = r.mine ? 'Вы' : (currentFriend()?.name || 'Друг');
  return h('button', { class: 'quote', type: 'button', title: 'Перейти к сообщению', onclick: (e) => { e.stopPropagation(); jumpTo(r.id); } },
    h('b', { text: who }), h('span', { class: r.text ? '' : 'gone', text: r.text || 'Сообщение удалено' }));
}

function actionsEl(m) {
  const b = (label, title, fn) => h('button', { type: 'button', title, 'aria-label': title, text: label, onclick: (e) => { e.stopPropagation(); fn(e.currentTarget); } });
  const mine = m.dir === 'out';
  const myReact = (m.reactions || []).find((r) => r.by === 'me')?.e;
  if (S.current === SAVED.id) {
    return h('div', { class: 'msg-actions' }, b('⋯', 'Ещё', (btn) => { const r = btn.getBoundingClientRect(); msgMenu(m, r.left, r.bottom + 4); }));
  }
  return h('div', { class: 'msg-actions' },
    b('↩', 'Ответить', () => startReply(m)),
    b('☺', 'Реакция', (btn) => showPicker(btn, myReact, (e, on) => reactTo(m, e, on))),
    mine && !m.file ? b('✎', 'Изменить', () => startEdit(m)) : null,
    b('⋯', 'Ещё', (btn) => { const r = btn.getBoundingClientRect(); msgMenu(m, r.left, r.bottom + 4); }),
  );
}

function reactionsEl(m) {
  const list = m.reactions || [];
  if (!list.length || m.deleted) return null;
  const groups = new Map();
  for (const r of list) groups.set(r.e, [...(groups.get(r.e) || []), r.by]);
  return h('div', { class: 'reacts' }, [...groups].map(([e, by]) => {
    const mine = by.includes('me');
    return h('button', { type: 'button', class: mine ? 'mine' : '', title: mine ? 'Убрать свою реакцию' : 'Поставить такую же', onclick: () => reactTo(m, e, !mine) },
      e, by.length > 1 ? h('span', { text: String(by.length) }) : null);
  }));
}

function msgMenu(m, x, y) {
  const f = currentFriend();
  if (!f) return;
  const mine = m.dir === 'out';
  if (f.state === 'saved') {
    showMenu(x, y, [
      m.text ? { label: 'Копировать текст', onclick: () => window.som.copy(m.text).then(() => toast('Текст скопирован.')) } : null,
      { label: 'Удалить из избранного', danger: true, onclick: () => call('saved_delete', { sid: m.id }).then(() => { removeMsg(SAVED.id, m.id); renderFriends(); }).catch((err) => toast(err.message, 'bad')) },
    ]);
    return;
  }
  const isPinned = (f.pinned || []).some((p) => p.id === m.id);
  const confirmDelete = (everyone) => showMenu(x, y, [
    { label: everyone ? 'Да, удалить у обоих' : 'Да, удалить у меня', danger: true, onclick: () => deleteMsg(m, everyone) },
    { label: 'Отмена', onclick: () => {} },
  ]);
  showMenu(x, y, m.deleted ? [
    { label: 'Убрать у меня', onclick: () => deleteMsg(m, false) },
  ] : [
    { label: 'Ответить', onclick: () => startReply(m) },
    m.text ? { label: 'Копировать текст', onclick: () => window.som.copy(m.text).then(() => toast('Текст скопирован.')) } : null,
    { label: 'В избранное', onclick: () => saveToFavorites(f, m) },
    { label: isPinned ? 'Открепить' : 'Закрепить для обоих', onclick: () => pinMsg(f, m.id, !isPinned) },
    mine && !m.file ? { label: 'Изменить', hint: '↑', onclick: () => startEdit(m) } : null,
    { label: 'Удалить у меня…', onclick: () => confirmDelete(false) },
    mine ? { label: 'Удалить у обоих…', danger: true, onclick: () => confirmDelete(true) } : null,
  ]);
}

async function reactTo(m, e, on) {
  const f = currentFriend();
  if (!f) return;
  try { applyMsg(f.id, await call('react', { id: f.id, mid: m.id, e, on })); } catch (err) { toast(err.message, 'bad'); }
}

async function deleteMsg(m, everyone) {
  const f = currentFriend();
  if (!f) return;
  try {
    await call('delete', { id: f.id, mid: m.id, everyone });
    if (S.compose?.m?.id === m.id) cancelCompose();
  } catch (err) { toast(err.message, 'bad'); }
}

function removeMsg(friend, mid) {
  const list = S.history.get(friend);
  if (list) { const i = list.findIndex((x) => x.id === mid); if (i >= 0) list.splice(i, 1); }
  if (S.current === friend) { const f = currentFriend(); if (f) renderMessages(f, false); }
}

// ---------- Ответ и правка ----------
function startReply(m) {
  S.compose = { mode: 'reply', m };
  renderComposeBar();
  $('composerInput').focus();
}
function startEdit(m) {
  S.compose = { mode: 'edit', m };
  const input = $('composerInput');
  input.value = m.text;
  autosize();
  renderComposeBar();
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}
function cancelCompose() {
  if (S.compose?.mode === 'edit') { $('composerInput').value = ''; autosize(); }
  S.compose = null;
  renderComposeBar();
}
function renderComposeBar() {
  const c = S.compose;
  $('composeBar').hidden = !c;
  if (!c) return;
  const f = currentFriend();
  $('composeBar').dataset.mode = c.mode;
  $('cbTitle').textContent = c.mode === 'edit' ? 'Изменение сообщения' : `Ответ ${c.m.dir === 'out' ? 'себе' : `для ${f?.name || 'друга'}`}`;
  $('cbBody').textContent = msgPreview(c.m) || '';
}

async function jumpTo(mid) {
  const f = currentFriend();
  if (!f) return;
  let node = document.querySelector(`.msg[data-mid="${CSS.escape(mid)}"]`);
  if (!node) {
    try { S.history.set(f.id, await call('history', { id: f.id, limit: 5000 })); } catch { /* ниже скажем */ }
    renderMessages(f, false);
    node = document.querySelector(`.msg[data-mid="${CSS.escape(mid)}"]`);
  }
  if (!node) { toast('Этого сообщения уже нет в истории.'); return; }
  node.scrollIntoView({ block: 'center', behavior: 'smooth' });
  node.classList.remove('flash');
  void node.offsetWidth;
  node.classList.add('flash');
}

// ---------- Поиск ----------
let searchSeq = 0;
function openSearch() {
  if (currentFriend()?.state !== 'friend') return;
  $('searchBar').hidden = false;
  $('searchInput').focus();
  $('searchInput').select();
}
function closeSearch() {
  $('searchBar').hidden = true;
  $('searchResults').hidden = true;
  $('searchInput').value = '';
  $('searchCount').textContent = '';
}
async function runSearch() {
  const f = currentFriend();
  const q = $('searchInput').value.trim();
  const box = $('searchResults');
  const seq = ++searchSeq;
  if (!f || q.length < 2) { box.hidden = true; $('searchCount').textContent = ''; return; }
  let hits = [];
  try { hits = await call('search', { id: f.id, q, limit: 100 }); } catch { hits = []; }
  if (seq !== searchSeq) return;
  $('searchCount').textContent = hits.length ? `${hits.length}${hits.length >= 100 ? '+' : ''}` : 'ничего';
  const lower = q.toLowerCase();
  const mark = (text) => {
    const i = text.toLowerCase().indexOf(lower);
    if (i < 0) return [text.slice(0, 140)];
    const from = Math.max(0, i - 40);
    return [from ? '…' : '', text.slice(from, i), h('mark', { text: text.slice(i, i + q.length) }), text.slice(i + q.length, i + q.length + 90)];
  };
  box.replaceChildren(...hits.map((hit) => {
    const m = hit.msg;
    const text = m.file ? m.file.name : m.text;
    return h('button', { type: 'button', class: 'sr', onclick: () => { box.hidden = true; jumpTo(m.id); } },
      h('span', { class: 'sr-who', text: `${m.dir === 'out' ? 'Вы' : f.name} · ${dayLabel(m.at)}, ${fmtTime.format(new Date(m.at))}` }),
      h('span', { class: 'sr-text' }, mark(text)));
  }));
  box.hidden = !hits.length;
}

// ---------- Голосовые ----------
const DRAFTS = new Map(); // id друга → черновик { pcm, rate, a, b, pos } (a, b, pos — доли длины)
let REC = null; // { friend, mode: 'hold' | 'lock', cap, zone }
let VD = null; // открытый черновик и его проигрыватель
const alwaysDraft = () => { try { return localStorage.getItem('som.voiceDraft') === '1'; } catch { return false; } };
const SPEEDS = [1, 1.5, 2];
const voiceSpeed = () => { try { const v = Number(localStorage.getItem('som.vspeed')); return SPEEDS.includes(v) ? v : 1; } catch { return 1; } };
const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

/** Какая полоса видна: запись, черновик или обычное поле ввода. */
function showVoiceUi() {
  const f = currentFriend();
  const isFriend = f?.state === 'friend';
  const rec = Boolean(REC && REC.friend === f?.id);
  $('recBar').hidden = !rec;
  if (rec) {
    $('recBar').dataset.mode = REC.mode;
    $('recBar').dataset.zone = REC.zone || '';
    $('recBar').dataset.paused = REC.cap?.paused ? '1' : '0';
    $('recHint').textContent = REC.zone === 'cancel' ? 'Отпустите — запись удалится' : '← влево — отмена · ↑ вверх — на замок';
    $('recPause').textContent = REC.cap?.paused ? 'Продолжить' : 'Пауза';
  }
  const draft = isFriend && !rec && DRAFTS.has(f.id);
  $('voiceDraft').hidden = !draft;
  // Кружок
  const crec = Boolean(CREC && CREC.friend === f?.id);
  const cdraft = isFriend && !crec && CDRAFTS.has(f.id);
  const box = $('circleRec');
  box.hidden = !(crec || cdraft);
  const cv = $('circleVideo');
  if (crec) {
    box.dataset.mode = CREC.mode === 'hold' ? 'hold' : 'rec';
    box.dataset.zone = CREC.zone || '';
    box.dataset.paused = CREC.cap?.paused ? '1' : '0';
    $('circleHint').textContent = CREC.zone === 'cancel' ? 'Отпустите — запись удалится' : '← влево — отмена · ↑ вверх — на замок';
    $('circlePause').textContent = CREC.cap?.paused ? 'Продолжить' : 'Пауза';
    if (CREC.cap && cv.srcObject !== CREC.cap.preview) { cv.removeAttribute('src'); cv.srcObject = CREC.cap.preview; cv.muted = true; cv.loop = false; cv.play().catch(() => {}); }
  } else if (cdraft) {
    const d = CDRAFTS.get(f.id);
    box.dataset.mode = 'draft';
    $('circleTime').textContent = fmtSec(d.dur);
    $('circleLeft').textContent = 'щёлкните — звук';
    if (cv.dataset.url !== d.url) { cv.srcObject = null; cv.src = d.url; cv.dataset.url = d.url; cv.muted = true; cv.loop = true; cv.play().catch(() => {}); }
  } else if (cv.srcObject || cv.dataset.url) {
    cv.pause();
    cv.srcObject = null;
    cv.removeAttribute('src');
    delete cv.dataset.url;
  }
  if (isFriend) $('composer').hidden = (rec && REC.mode === 'lock') || draft || (crec && CREC.mode === 'lock') || cdraft;
  $('circleBtn').dataset.rec = crec ? '1' : '0';
  $('voiceBtn').dataset.rec = rec ? '1' : '0';
  if (draft) openDraft(f.id); else closeDraftPlayer();
}

function drawRecWave() {
  const cv = $('recWave');
  const lv = REC?.cap?.levels;
  if (!lv || cv.offsetParent === null) return;
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth;
  const hgt = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(hgt * dpr); }
  const c = cv.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, hgt);
  c.fillStyle = cssVar('--good');
  const n = Math.floor(w / 3);
  const from = Math.max(0, lv.length - n);
  for (let i = from; i < lv.length; i += 1) {
    const v = Math.max(0.08, Math.min(1, (lv[i] + 55) / 50));
    const bh = Math.max(2, v * hgt);
    c.fillRect((i - from) * 3, (hgt - bh) / 2, 2, bh);
  }
}

async function startRec(mode) {
  const f = currentFriend();
  if (!f || f.state !== 'friend' || REC) return;
  const me = { friend: f.id, mode, cap: null, zone: '' };
  REC = me;
  $('recTime').textContent = '0:00';
  showVoiceUi();
  try {
    const cap = await startCapture(openMic, (_db, sec) => {
      if (REC !== me) return;
      $('recTime').textContent = fmtSec(sec);
      drawRecWave();
    });
    if (REC !== me) { cap.cancel(); return; }
    me.cap = cap;
    holdMic(true);
    if (cap.note) toast(cap.note, 'bad');
    cap.full.then(() => { if (REC === me) stopRec(me.mode === 'hold' && !alwaysDraft() ? 'send' : 'draft'); });
    showVoiceUi();
    if (me.mode === 'lock') $('recStop').focus();
  } catch (err) {
    if (REC === me) REC = null;
    showVoiceUi();
    toast(micError(err), 'bad');
  }
}

/** action: 'send' — сразу отправить, 'draft' — в черновик, 'cancel' — выбросить. */
async function stopRec(action) {
  const r = REC;
  if (!r) return;
  REC = null;
  holdMic(false);
  if (!r.cap) { showVoiceUi(); return; } // микрофон ещё открывался — startRec сам его закроет
  if (action === 'cancel') { r.cap.cancel(); showVoiceUi(); return; }
  const { pcm, rate } = r.cap.stop();
  if (pcm.length < rate * 0.6) { showVoiceUi(); toast('Слишком короткое голосовое — не отправлено.'); return; }
  if (action === 'draft') DRAFTS.set(r.friend, { pcm, rate, a: 0, b: 1, pos: 0 });
  showVoiceUi();
  if (action === 'send') await sendPcm(r.friend, pcm, rate);
}

async function sendPcm(friend, pcm, rate) {
  try {
    const blob = await encodeOgg(pcm, rate);
    const res = await window.som.sendVoice(friend, new Uint8Array(await blob.arrayBuffer()), pcm.length / rate, waveOf(pcm, 48), { mime: 'audio/ogg' });
    sendFilesResult(friend, [res]);
  } catch (err) {
    toast(`Голосовое: ${err.message}`, 'bad');
  }
}

/** Ушли в другой чат: запись на замке становится черновиком, удержание — отменяется. */
function voiceLeaveChat() {
  if (REC) stopRec(REC.mode === 'lock' && REC.cap ? 'draft' : 'cancel');
  if (CREC) stopCircle(CREC.mode === 'lock' && CREC.cap ? 'draft' : 'cancel');
  closeDraftPlayer();
}

// ---------- Видео-кружки ----------
const CDRAFTS = new Map(); // id друга → { blob, url, dur, wave }
let CREC = null; // { friend, mode: 'hold' | 'lock', cap, zone, timer }

async function startCircleRec(mode) {
  const f = currentFriend();
  if (!f || f.state !== 'friend' || CREC || REC) return;
  const me = { friend: f.id, mode, cap: null, zone: '', timer: 0 };
  CREC = me;
  $('circleTime').textContent = '0:00';
  $('circleLeft').textContent = '';
  showVoiceUi();
  try {
    const cap = await startCircle(openMic, levelDb);
    if (CREC !== me) { cap.cancel(); return; }
    me.cap = cap;
    holdMic(true);
    if (cap.note) toast(cap.note, 'bad');
    cap.full.then(() => { if (CREC === me) stopCircle(me.mode === 'hold' ? 'send' : 'draft'); });
    me.timer = setInterval(() => {
      if (CREC !== me) return;
      $('circleTime').textContent = fmtSec(cap.seconds);
      $('circleLeft').textContent = `осталось ${fmtSec(Math.max(0, CIRCLE_MAX - cap.seconds))}`;
    }, 250);
    showVoiceUi();
  } catch (err) {
    if (CREC === me) CREC = null;
    showVoiceUi();
    toast(cameraError(err), 'bad');
  }
}

async function stopCircle(action) {
  const r = CREC;
  if (!r) return;
  CREC = null;
  clearInterval(r.timer);
  holdMic(false);
  if (!r.cap) { showVoiceUi(); return; }
  if (action === 'cancel') { r.cap.cancel(); showVoiceUi(); return; }
  const { blob, dur, levels } = await r.cap.stop();
  if (dur < 1) { showVoiceUi(); toast('Слишком короткий кружок — не отправлен.'); return; }
  const d = { blob, url: URL.createObjectURL(blob), dur, wave: makeWave(levels, 48) };
  if (action === 'draft') { CDRAFTS.set(r.friend, d); showVoiceUi(); return; }
  showVoiceUi();
  await sendCircle(r.friend, d);
}

async function sendCircle(friend, d) {
  try {
    const res = await window.som.sendVoice(friend, new Uint8Array(await d.blob.arrayBuffer()), d.dur, d.wave, { circle: true });
    sendFilesResult(friend, [res]);
  } catch (err) {
    toast(`Кружок: ${err.message}`, 'bad');
  }
}

function initCircle() {
  const btn = $('circleBtn');
  let press = null;
  btn.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || CREC) return;
    e.preventDefault();
    btn.setPointerCapture(e.pointerId);
    press = { x: e.clientX, y: e.clientY, t: Date.now() };
    startCircleRec('hold');
  });
  btn.addEventListener('pointermove', (e) => {
    if (!press || CREC?.mode !== 'hold') return;
    const dx = e.clientX - press.x;
    const dy = e.clientY - press.y;
    if (dy < -60) { CREC.mode = 'lock'; press = null; showVoiceUi(); $('circleStop').focus(); return; }
    const zone = dx < -90 ? 'cancel' : '';
    if (zone !== CREC.zone) { CREC.zone = zone; showVoiceUi(); }
  });
  btn.addEventListener('pointerup', () => {
    if (!press) return;
    const quick = Date.now() - press.t < 350;
    press = null;
    if (CREC?.mode !== 'hold') return;
    if (quick) { CREC.mode = 'lock'; showVoiceUi(); $('circleStop').focus(); return; }
    stopCircle(CREC.zone === 'cancel' ? 'cancel' : 'send');
  });
  btn.addEventListener('pointercancel', () => { press = null; if (CREC?.mode === 'hold') stopCircle('cancel'); });
  btn.addEventListener('click', (e) => { if (e.detail === 0) startCircleRec('lock'); });
  $('circlePause').addEventListener('click', () => {
    const cap = CREC?.cap;
    if (!cap) return;
    if (cap.paused) cap.resume(); else cap.pause();
    showVoiceUi();
  });
  $('circleCancel').addEventListener('click', () => stopCircle('cancel'));
  $('circleStop').addEventListener('click', () => stopCircle('draft'));
  const cur = () => { const f = currentFriend(); return f && CDRAFTS.get(f.id) ? f.id : null; };
  $('circleDelete').addEventListener('click', () => { const id = cur(); if (id) { URL.revokeObjectURL(CDRAFTS.get(id).url); CDRAFTS.delete(id); showVoiceUi(); } });
  $('circleRedo').addEventListener('click', () => { const id = cur(); if (id) { URL.revokeObjectURL(CDRAFTS.get(id).url); CDRAFTS.delete(id); showVoiceUi(); startCircleRec('lock'); } });
  $('circleSend').addEventListener('click', () => {
    const id = cur();
    if (!id) return;
    const d = CDRAFTS.get(id);
    CDRAFTS.delete(id);
    showVoiceUi();
    sendCircle(id, d).finally(() => URL.revokeObjectURL(d.url));
  });
  // В черновике щелчок по кружку — звук с начала, ещё щелчок — пауза.
  const v = $('circleVideo');
  v.addEventListener('click', () => {
    if ($('circleRec').dataset.mode !== 'draft') return;
    if (v.muted) { v.muted = false; v.currentTime = 0; v.play().catch(() => {}); } else if (v.paused) v.play().catch(() => {}); else v.pause();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && CREC && !document.querySelector('dialog[open]')) { e.preventDefault(); stopCircle('cancel'); }
  });
}

/** Кружок в переписке: играет сам без звука по кругу; щелчок — со звуком с начала, ещё — пауза. */
function circleEl(m) {
  const f = m.file;
  const v = h('video', { playsinline: '' });
  v.muted = true;
  v.loop = true;
  const snd = h('span', { class: 'circle-snd', 'aria-hidden': 'true' });
  snd.innerHTML = '<svg viewBox="0 0 24 24"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>';
  const box = h('div', { class: 'circle-box', title: 'Щёлкните — со звуком', role: 'button', tabindex: '0', 'aria-label': `Видеосообщение, ${fmtSec(f.voice.dur)}` },
    v, h('span', { class: 'circle-dur', text: fmtSec(f.voice.dur) }), snd);
  if (available(f)) {
    fullUrl(S.current, m).then((u) => { v.src = u; v.play().catch(() => {}); }).catch(() => {});
  } else {
    box.append(h('span', { class: 'circle-wait', text: fileStateText(m) || 'Загружается…' }));
  }
  // У WebM из MediaRecorder нет длительности — повтор подстрахуем вручную.
  v.addEventListener('ended', () => {
    if (!v.muted) { v.muted = true; box.classList.remove('sound'); }
    v.currentTime = 0;
    v.play().catch(() => {});
  });
  const toggle = () => {
    if (v.muted) { v.muted = false; v.loop = false; v.currentTime = 0; v.play().catch(() => {}); box.classList.add('sound'); } else if (v.paused) v.play().catch(() => {}); else v.pause();
  };
  box.addEventListener('click', toggle);
  box.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  // Вернулся в «без звука» после полного прослушивания — снова по кругу.
  v.addEventListener('play', () => { if (v.muted) v.loop = true; });
  return box;
}

// ---------- Черновик голосового ----------
function openDraft(friend) {
  if (VD?.friend === friend) { drawDraft(); return; }
  closeDraftPlayer();
  VD = { friend, d: DRAFTS.get(friend), playing: false, drag: null };
  $('vdSpeed').textContent = `${String(voiceSpeed()).replace('.', ',')}×`;
  drawDraft();
}
function closeDraftPlayer() {
  if (!VD) return;
  stopDraftPlay();
  VD.ctx?.close().catch(() => {});
  VD = null;
}
function draftBars(d, n) {
  if (d.bars?.length !== n) {
    const per = Math.max(1, Math.floor(d.pcm.length / n));
    d.bars = [];
    for (let i = 0; i < n; i += 1) {
      let peak = 0;
      for (let j = i * per, e = Math.min(d.pcm.length, j + per); j < e; j += 4) peak = Math.max(peak, Math.abs(d.pcm[j]));
      d.bars.push(Math.max(0.06, Math.min(1, (20 * Math.log10(Math.max(1e-5, peak)) + 55) / 50)));
    }
  }
  return d.bars;
}
function drawDraft() {
  if (!VD) return;
  const { d } = VD;
  const cv = $('vdWave');
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth;
  const hgt = cv.clientHeight;
  if (!w) return;
  if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(hgt * dpr); }
  const c = cv.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, hgt);
  const n = Math.floor(w / 3);
  const bars = draftBars(d, n);
  const accent = cssVar('--accent');
  const faint = cssVar('--faint');
  for (let i = 0; i < n; i += 1) {
    const f = i / n;
    const inside = f >= d.a && f <= d.b;
    c.globalAlpha = inside ? 1 : 0.3;
    c.fillStyle = inside && f <= d.pos ? accent : faint;
    const bh = bars[i] * (hgt - 8);
    c.fillRect(i * 3, (hgt - bh) / 2, 2, bh);
  }
  c.globalAlpha = 1;
  c.fillStyle = accent;
  for (const f of [d.a, d.b]) {
    const x = Math.min(w - 3, Math.max(0, f * w - 1.5));
    c.fillRect(x, 0, 3, hgt);
    c.fillRect(x - 3, 0, 9, 4);
    c.fillRect(x - 3, hgt - 4, 9, 4);
  }
  const dur = d.pcm.length / d.rate;
  const cut = (d.b - d.a) * dur;
  $('vdTime').textContent = VD.playing ? `${fmtSec((d.pos - d.a) * dur)} / ${fmtSec(cut)}` : (d.a > 0 || d.b < 1 ? `${fmtSec(cut)} из ${fmtSec(dur)}` : fmtSec(dur));
  $('voiceDraft').classList.toggle('playing', VD.playing);
  $('vdPlay').classList.toggle('playing', VD.playing);
}
function playDraft() {
  if (!VD) return;
  const { d } = VD;
  stopDraftPlay();
  if (!VD.ctx) {
    VD.ctx = new AudioContext({ sampleRate: d.rate });
    if (typeof VD.ctx.setSinkId === 'function') VD.ctx.setSinkId(sinkFor(audioPrefs.out)).catch(() => {});
    VD.buf = VD.ctx.createBuffer(1, d.pcm.length, d.rate);
    VD.buf.copyToChannel(d.pcm, 0);
  }
  const ctx = VD.ctx;
  if (ctx.state !== 'running') ctx.resume();
  const dur = d.pcm.length / d.rate;
  const from = d.pos < d.a || d.pos >= d.b - 0.002 ? d.a : d.pos;
  const speed = voiceSpeed();
  const src = ctx.createBufferSource();
  src.buffer = VD.buf;
  src.playbackRate.value = speed;
  src.connect(ctx.destination);
  src.start(0, from * dur, (d.b - from) * dur);
  const t0 = ctx.currentTime;
  const v = VD;
  v.src = src;
  v.playing = true;
  src.onended = () => { if (v.src === src) { v.playing = false; v.src = null; d.pos = d.a; drawDraft(); } };
  const tick = () => {
    if (v.src !== src || !v.playing) return;
    d.pos = Math.min(d.b, from + ((ctx.currentTime - t0) * speed) / dur);
    drawDraft();
    v.raf = requestAnimationFrame(tick);
  };
  tick();
}
function stopDraftPlay() {
  if (!VD?.src) return;
  const src = VD.src;
  VD.src = null;
  VD.playing = false;
  cancelAnimationFrame(VD.raf);
  try { src.stop(); } catch { /* уже */ }
  drawDraft();
}

function initVoice() {
  const vb = $('voiceBtn');
  let press = null;
  vb.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || REC) return;
    e.preventDefault();
    vb.setPointerCapture(e.pointerId);
    press = { x: e.clientX, y: e.clientY, t: Date.now() };
    startRec('hold');
  });
  vb.addEventListener('pointermove', (e) => {
    if (!press || REC?.mode !== 'hold') return;
    const dx = e.clientX - press.x;
    const dy = e.clientY - press.y;
    if (dy < -60) { REC.mode = 'lock'; press = null; showVoiceUi(); $('recStop').focus(); return; }
    const zone = dx < -90 ? 'cancel' : '';
    if (zone !== REC.zone) { REC.zone = zone; showVoiceUi(); }
  });
  vb.addEventListener('pointerup', () => {
    if (!press) return;
    const quick = Date.now() - press.t < 350;
    press = null;
    if (REC?.mode !== 'hold') return;
    // Короткий щелчок — запись «на замке»: говорите, сколько нужно, потом «Стоп».
    if (quick) { REC.mode = 'lock'; showVoiceUi(); $('recStop').focus(); return; }
    stopRec(REC.zone === 'cancel' ? 'cancel' : alwaysDraft() ? 'draft' : 'send');
  });
  vb.addEventListener('pointercancel', () => { press = null; if (REC?.mode === 'hold') stopRec('cancel'); });
  vb.addEventListener('click', (e) => { if (e.detail === 0) startRec('lock'); }); // с клавиатуры
  $('recPause').addEventListener('click', () => {
    const cap = REC?.cap;
    if (!cap) return;
    if (cap.paused) cap.resume(); else cap.pause();
    showVoiceUi();
  });
  $('recCancel').addEventListener('click', () => stopRec('cancel'));
  $('recStop').addEventListener('click', () => stopRec('draft'));
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.code === 'KeyR') {
      e.preventDefault();
      if (REC) stopRec(REC.mode === 'lock' ? 'draft' : 'cancel'); else if (!$('composer').hidden) startRec('lock');
    } else if (e.key === 'Escape' && REC && !document.querySelector('dialog[open]')) {
      e.preventDefault();
      stopRec('cancel');
    }
  });
  // Черновик
  $('vdPlay').addEventListener('click', () => { if (VD?.playing) stopDraftPlay(); else playDraft(); });
  $('vdSpeed').addEventListener('click', () => {
    const next = SPEEDS[(SPEEDS.indexOf(voiceSpeed()) + 1) % SPEEDS.length];
    try { localStorage.setItem('som.vspeed', String(next)); } catch { /* не страшно */ }
    $('vdSpeed').textContent = `${String(next).replace('.', ',')}×`;
    if (VD?.playing) playDraft();
  });
  $('vdDelete').addEventListener('click', () => { if (VD) { DRAFTS.delete(VD.friend); showVoiceUi(); $('composerInput').focus(); } });
  $('vdRedo').addEventListener('click', () => { if (VD) { DRAFTS.delete(VD.friend); showVoiceUi(); startRec('lock'); } });
  $('vdSend').addEventListener('click', () => {
    if (!VD) return;
    const { friend, d } = VD;
    const a = Math.floor(d.a * d.pcm.length);
    const b = Math.floor(d.b * d.pcm.length);
    DRAFTS.delete(friend);
    showVoiceUi();
    sendPcm(friend, d.pcm.slice(a, b), d.rate);
    $('composerInput').focus();
  });
  const wave = $('vdWave');
  const fracAt = (e) => { const r = wave.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); };
  wave.addEventListener('pointerdown', (e) => {
    if (!VD) return;
    const { d } = VD;
    const f = fracAt(e);
    const w = wave.clientWidth;
    wave.setPointerCapture(e.pointerId);
    if (Math.abs(f - d.a) * w < 10) VD.drag = 'a';
    else if (Math.abs(f - d.b) * w < 10) VD.drag = 'b';
    else {
      VD.drag = null;
      d.pos = Math.max(d.a, Math.min(d.b, f));
      if (VD.playing) playDraft(); else drawDraft();
      return;
    }
    stopDraftPlay();
  });
  wave.addEventListener('pointermove', (e) => {
    if (!VD?.drag) return;
    const { d } = VD;
    const min = (0.6 * d.rate) / d.pcm.length;
    const f = fracAt(e);
    if (VD.drag === 'a') d.a = Math.max(0, Math.min(d.b - min, f)); else d.b = Math.min(1, Math.max(d.a + min, f));
    d.pos = d.a;
    drawDraft();
  });
  wave.addEventListener('pointerup', () => { if (VD) VD.drag = null; });
  window.addEventListener('resize', () => { drawDraft(); drawRecWave(); });
  const box = $('setVoiceDraft');
  box.checked = alwaysDraft();
  box.addEventListener('change', () => { try { localStorage.setItem('som.voiceDraft', box.checked ? '1' : '0'); } catch { /* не страшно */ } });
}

// ---------- Вложения ----------
const thumbCache = new Map(); // fid → Promise<url|null>
const fullCache = new Map(); // fid → Promise<url|null>

function blobUrl(b64, mime) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: mime }));
}
function thumbUrl(fid) {
  if (!thumbCache.has(fid)) {
    thumbCache.set(fid, call('thumb', { fid }).then((r) => (r.data ? blobUrl(r.data, 'image/jpeg') : null)).catch(() => null));
  }
  return thumbCache.get(fid);
}
function fullUrl(friend, m) {
  const fid = m.file.fid;
  if (!fullCache.has(fid)) {
    const p = call('file_data', { id: friend, mid: m.id }).then((r) => blobUrl(r.data, m.file.mime)).catch((err) => { fullCache.delete(fid); throw err; });
    fullCache.set(fid, p);
  }
  return fullCache.get(fid);
}

// Программы и сценарии от друга не открываем одним щелчком — только сохранить (то же правило есть в главном процессе).
const RISKY_EXT = /\.(exe|com|bat|cmd|msi|msp|scr|pif|lnk|url|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|hta|jar|reg|cpl|dll|sys|appx|msix|application|gadget|inf|scf)$/i;
const PLAYABLE = /^(audio\/(mpeg|ogg|wav|flac|opus|mp4|aac|webm)|video\/(mp4|webm))$/;
const mediaEls = new Map(); // fid → <audio>/<video>, переживает перерисовку ленты
function mediaFor(m) {
  const f = m.file;
  if (mediaEls.has(f.fid)) return mediaEls.get(f.fid);
  const isVideo = f.mime.startsWith('video/');
  const el = h(isVideo ? 'video' : 'audio', { controls: true, preload: 'metadata', class: isVideo ? 'att-video' : 'att-audio' });
  el.dataset.friend = S.current;
  fullUrl(S.current, m).then((u) => { el.src = u; el.play().catch(() => {}); }).catch((err) => toast(err.message, 'bad'));
  mediaEls.set(f.fid, el);
  return el;
}
const available = (file) => file.state === 'local' || file.state === 'done';
const VIEWABLE = /^image\/(png|jpeg|gif|webp|bmp|svg\+xml)$/;

function fileStateText(m) {
  const f = m.file;
  const pct = f.total ? Math.floor((f.got / f.total) * 100) : 0;
  switch (f.state) {
    case 'preparing': return 'шифрую…';
    case 'waiting': return 'не скачан';
    case 'downloading': return `скачиваю: ${pct}%`;
    case 'failed': return m.dir === 'out' ? 'не отправлен' : 'не скачался';
    default: return '';
  }
}

function fileActions(m) {
  const f = m.file;
  const friend = S.current;
  const btn = (text, onclick, cls = 'btn small') => h('button', { class: cls, type: 'button', text, onclick: (e) => { e.stopPropagation(); onclick(e.currentTarget); } });
  if (available(f)) {
    const risky = m.dir === 'in' && RISKY_EXT.test(f.name);
    const playable = PLAYABLE.test(f.mime) && f.size <= 64 * 1024 * 1024 && !mediaEls.has(f.fid);
    return [
      playable ? btn(f.mime.startsWith('video/') ? 'Смотреть' : 'Слушать', (b) => {
        const card = b.closest('.att-file');
        card?.classList.add('has-media');
        card?.querySelector('.att-player')?.replaceChildren(mediaFor(m));
        b.remove();
      }, 'btn small primary') : null,
      risky ? null : btn('Открыть', async (b) => { b.disabled = true; const r = await window.som.openFile(friend, m.id, f.name); b.disabled = false; if (!r.ok && !r.canceled) toast(r.error || 'Не открылся', 'bad'); }),
      btn('Сохранить', async () => { const r = await window.som.saveFile(friend, m.id, f.name); if (!r.ok && !r.canceled) toast(r.error || 'Не сохранился', 'bad'); }),
    ];
  }
  if (m.dir === 'in' && (f.state === 'waiting' || f.state === 'failed')) {
    return [btn(f.state === 'failed' ? 'Скачать заново' : `Скачать · ${fmtSize(f.size)}`, async (b) => {
      b.disabled = true;
      try { applyMsg(friend, await call('file_download', { id: friend, mid: m.id })); } catch (err) { toast(err.message, 'bad'); b.disabled = false; }
    }, 'btn small primary')];
  }
  return [];
}

function progressEl(m) {
  const f = m.file;
  if (f.state !== 'downloading' && f.state !== 'preparing') return null;
  const bar = h('div', { class: 'prog' }, h('span'));
  const pct = f.state === 'preparing' ? 100 : (f.total ? (f.got / f.total) * 100 : 0);
  bar.firstChild.style.width = `${pct.toFixed(1)}%`;
  if (f.state === 'preparing') bar.classList.add('busy');
  return bar;
}

function attachmentEl(m) {
  const f = m.file;
  if (f.voice?.circle) return circleEl(m);
  if (f.voice) {
    const v = voiceEl(f.voice, available(f), () => fullUrl(S.current, m));
    const st = fileStateText(m);
    return h('div', { class: 'bubble voice-bubble' }, v, st && !available(f) ? h('span', { class: 'att-sub', text: st }) : null);
  }
  const isImage = VIEWABLE.test(f.mime);
  const inline = isImage && (f.thumb || (available(f) && f.size <= 15 * 1024 * 1024));
  if (inline) {
    const img = h('img', { alt: f.name, draggable: 'false' });
    if (f.w && f.h) {
      const scale = Math.min(1, 320 / f.w, 280 / f.h);
      img.width = Math.max(48, Math.round(f.w * scale));
      img.height = Math.max(48, Math.round(f.h * scale));
    }
    const src = f.thumb ? thumbUrl(f.fid) : fullUrl(S.current, m);
    src.then((u) => { if (u) img.src = u; }).catch(() => {});
    const state = fileStateText(m);
    return h('button', { class: 'att att-img', type: 'button', title: f.name, onclick: () => openViewer(m) },
      img,
      progressEl(m),
      state ? h('span', { class: 'att-badge', text: state }) : null,
    );
  }
  const ext = (f.name.includes('.') ? f.name.split('.').pop() : 'файл').slice(0, 4).toUpperCase();
  const state = fileStateText(m);
  return h('div', { class: `att att-file${mediaEls.has(f.fid) ? ' has-media' : ''}` },
    h('div', { class: 'att-icon', text: ext }),
    h('div', { class: 'att-main' },
      h('div', { class: 'att-name', text: f.name, title: f.name }),
      h('div', { class: 'att-sub', text: state ? `${fmtSize(f.size)} · ${state}` : fmtSize(f.size) }),
      progressEl(m),
      h('div', { class: 'att-player' }, mediaEls.has(f.fid) ? mediaEls.get(f.fid) : null),
      h('div', { class: 'att-actions' }, fileActions(m)),
    ),
  );
}

/** Новое состояние сообщения от ядра: обновляем историю и только его элемент. */
function applyMsg(friend, view) {
  const list = S.history.get(friend);
  if (!list) return;
  const i = list.findIndex((x) => x.id === view.id && x.dir === view.dir);
  if (i >= 0) {
    const old = list[i];
    if ((STATUS_ORDER[old.status] ?? -1) > (STATUS_ORDER[view.status] ?? -1)) view.status = old.status;
    list[i] = view;
  } else {
    list.push(view);
  }
  if (S.current !== friend) return;
  const el = document.querySelector(`.msg[data-mid="${CSS.escape(view.id)}"]`);
  if (!el || i < 0) { const f = currentFriend(); if (f) appendMessage(f, i < 0 ? list[list.length - 1] : view); return; }
  const prev = list[i - 1] && dayLabel(list[i - 1].at) === dayLabel(view.at) ? list[i - 1] : null;
  el.replaceWith(messageEl(view, prev));
  if (viewer.mid === view.id) refreshViewer(view);
}

// ---------- Просмотр картинки ----------
const viewer = { mid: null };
function openViewer(m) {
  const dlg = $('viewer');
  viewer.mid = m.id;
  $('viewerName').textContent = m.file.name;
  $('viewerImg').removeAttribute('src');
  refreshViewer(m);
  if (!dlg.open) dlg.showModal();
}
function refreshViewer(m) {
  const f = m.file;
  const friend = S.current;
  $('viewerInfo').textContent = [fmtSize(f.size), f.w && f.h ? `${f.w}×${f.h}` : '', fileStateText(m)].filter(Boolean).join(' · ');
  $('viewerActions').replaceChildren(...fileActions(m));
  const img = $('viewerImg');
  if (f.thumb && !img.src) thumbUrl(f.fid).then((u) => { if (u && viewer.mid === m.id && !img.dataset.full) img.src = u; });
  if (available(f) && f.size <= 64 * 1024 * 1024 && img.dataset.full !== f.fid) {
    fullUrl(friend, m).then((u) => { if (viewer.mid === m.id) { img.src = u; img.dataset.full = f.fid; } }).catch((err) => toast(err.message, 'bad'));
  }
}

async function sendFilesResult(friend, results) {
  for (const r of results || []) {
    if (!r) continue;
    if (r.ok) applyMsg(friend, r.result);
    else toast(`Файл не отправлен: ${r.error}`, 'bad');
  }
}

function renderMessages(f, scroll) {
  const box = $('messages');
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  const list = S.history.get(f.id) || [];
  const parts = [];
  let lastDay = '';
  let prev = null;
  for (const m of list) {
    const d = dayLabel(m.at);
    if (d !== lastDay) { parts.push(h('div', { class: 'day', text: d })); lastDay = d; prev = null; }
    parts.push(messageEl(m, prev));
    prev = m;
  }
  if (!list.length) {
    parts.push(h('div', { class: 'day', text: f.state === 'saved'
      ? 'Пока пусто. Пишите сюда заметки себе или сохраняйте сообщения из чатов: «⋯» у сообщения → «В избранное».'
      : `Это начало переписки с ${f.name}. Сверьте код чата — он должен совпасть у вас обоих.` }));
  }
  box.replaceChildren(...parts);
  S.renderedFor = f.id;
  if (scroll || nearBottom) box.scrollTop = box.scrollHeight;
}

/** Дописать одно новое сообщение в конец ленты, не трогая остальные. */
function appendMessage(f, m) {
  const list = S.history.get(f.id) || [];
  const idx = list.indexOf(m);
  if (S.renderedFor !== f.id || idx <= 0) { renderMessages(f, true); return; }
  const box = $('messages');
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
  const prev = list[idx - 1];
  const sameDay = dayLabel(prev.at) === dayLabel(m.at);
  if (!sameDay) box.append(h('div', { class: 'day', text: dayLabel(m.at) }));
  box.append(messageEl(m, sameDay ? prev : null));
  // Долгий разговор: не держим в ленте больше ~800 сообщений — старые убираем (история остаётся в ядре).
  if (list.length > 1000 && nearBottom) {
    list.splice(0, list.length - 800);
    const msgs = box.querySelectorAll(':scope > .msg');
    const extra = msgs.length - 800;
    if (extra > 0) {
      const stop = msgs[extra];
      while (box.firstChild && box.firstChild !== stop) box.firstChild.remove();
    }
  }
  if (nearBottom || m.dir === 'out') box.scrollTop = box.scrollHeight;
}

// ---------- Действия ----------
async function acceptRequest(f, btn) {
  if (btn) btn.disabled = true;
  try {
    await call('accept', { id: f.id });
    toast(`Вы с ${f.name} теперь друзья. Отправляю подтверждение.`, 'ok');
    S.current = f.id;
    S.friends = await call('friends');
    await selectFriend(f.id);
  } catch (err) {
    toast(`Не получилось принять: ${err.message}`, 'bad');
    if (btn) btn.disabled = false;
  }
}

async function declineRequest(f) {
  try {
    await call('decline', { id: f.id });
    if (S.current === f.id) S.current = null;
    S.history.delete(f.id);
  } catch (err) { toast(err.message, 'bad'); }
}

async function sendMessage() {
  const input = $('composerInput');
  const text = input.value.trim();
  const f = currentFriend();
  if (!text || !f || S.sending) return;
  S.sending = true;
  try {
    if (S.compose?.mode === 'edit') {
      applyMsg(f.id, await call('edit', { id: f.id, mid: S.compose.m.id, text }));
      input.value = '';
      cancelCompose();
      autosize();
      return;
    }
    const link = linkForSend(text);
    if (f.state === 'saved') {
      const m = await call('saved_add', { text, link });
      input.value = '';
      clearLinkBar();
      autosize();
      addSaved(m);
      return;
    }
    const args = { id: f.id, text, link };
    if (S.compose?.mode === 'reply') args.reply = S.compose.m.id;
    const m = await call('send', args);
    input.value = '';
    clearLinkBar();
    if (S.compose) cancelCompose();
    autosize();
    const list = S.history.get(f.id) || [];
    S.history.set(f.id, list);
    if (!list.some((x) => x.id === m.id)) { list.push(m); appendMessage(f, m); }
  } catch (err) {
    toast(`Не отправлено: ${err.message}`, 'bad');
  } finally {
    S.sending = false;
  }
}

function autosize() {
  const t = $('composerInput');
  t.style.height = 'auto';
  t.style.height = `${Math.min(t.scrollHeight + 2, 180)}px`;
}

// ---------- Диалоги ----------
function openInvite() {
  const me = S.me;
  if (!me?.hasProfile) return;
  $('invName').textContent = me.name;
  $('invCode').textContent = me.code;
  $('invAddr').textContent = me.addr || 'нет';
  $('invLink').value = me.invite;
  const warn = $('invWarn');
  if (!S.net?.address) { warn.textContent = 'У вас нет адреса в сети — друг не сможет подключиться по этой ссылке.'; warn.hidden = false; }
  else if (!S.net.radmin) { warn.textContent = 'В ссылке адрес домашней сети: она сработает только у тех, кто подключён к той же сети. Для друзей издалека включите Radmin VPN.'; warn.hidden = false; }
  else warn.hidden = true;
  $('inviteDlg').showModal();
  $('invLink').select();
}

let checkSeq = 0;
async function checkInvite() {
  const text = $('addInput').value.trim();
  const box = $('addPreview');
  const go = $('addGo');
  go.disabled = true;
  if (!text) { box.hidden = true; return; }
  const seq = ++checkSeq;
  try {
    const inv = await call('check_invite', { invite: text });
    if (seq !== checkSeq) return;
    box.replaceChildren(
      avatar(inv.code, inv.name),
      h('div', {}, h('div', { class: 'row-name', text: inv.name }), h('div', { class: 'row-sub' }, 'Код: ', h('b', { class: 'code', text: inv.code }), ` · ${inv.addr}`)),
    );
    go.disabled = false;
  } catch (err) {
    if (seq !== checkSeq) return;
    box.replaceChildren(h('div', { class: 'bad', text: `Приглашение не подходит: ${err.message}` }));
  }
  box.hidden = false;
}

function openAdd(prefill = '') {
  $('addInput').value = prefill;
  $('addPreview').hidden = true;
  $('addGo').disabled = true;
  $('addDlg').showModal();
  $('addInput').focus();
  if (prefill) checkInvite();
}

async function addFriend() {
  const go = $('addGo');
  go.disabled = true;
  try {
    const r = await call('add_friend', { invite: $('addInput').value.trim() });
    $('addDlg').close();
    toast(`Заявка для ${r.name} готова. Som отправит её, как только достучится.`, 'ok');
    S.friends = await call('friends');
    await selectFriend(r.id);
  } catch (err) {
    toast(err.message, 'bad');
    go.disabled = false;
  }
}

// ---------- Профили ----------
/** Карточка человека: полоса цвета, фото, имя, статус, «О себе». p — друг или я. */
function cardEl(p, { self = false, img = null, animUrl = null, bannerUrl = null } = {}) {
  const color = p.color || colorFor(p.id || 'me');
  const banner = h('div', { class: 'pc-banner' });
  banner.style.background = color;
  const putBanner = (u) => { if (!u) return; const im = h('img', { alt: '' }); im.src = u; banner.append(im); banner.classList.add('has-img'); };
  if (bannerUrl) putBanner(bannerUrl);
  else if (p.banner) { banner.classList.add('has-img'); mediaUrl(self ? 'me' : p.id, 'banner', p.banner).then((u) => { if (u) putBanner(u); else banner.classList.remove('has-img'); }); }
  const av = avatar(p.id || 'me', p.name, {
    size: 'huge', presence: self ? p.effective : (p.state === 'friend' ? p.presence : null), avatarV: img ? 0 : p.avatarV, color: p.color, self, img,
    anim: animUrl ? null : p.anim, animUrl, always: true,
  });
  const pres = self ? p.effective : p.presence;
  const line = [PRESENCE[pres] || '', statusOf(p)].filter(Boolean).join(' · ');
  const game = self ? (p.activity?.game && p.effective !== 'invisible' ? p.activity.game : '') : gameOf(p);
  return [
    banner,
    h('div', { class: 'pc-head' }, av),
    h('div', { class: 'pc-main' },
      h('div', { class: 'pc-name', text: p.name || '—' }),
      line ? h('div', { class: 'pc-status', dataset: { p: pres || '' }, text: line }) : null,
      game ? h('div', { class: 'pc-activity' }, h('span', { 'aria-hidden': 'true', text: '🎮' }),
        h('span', {}, 'Играет в ', h('b', { text: game })),
        p.activity?.since ? h('span', { class: 'muted', text: `· ${fmtDur(Date.now() - p.activity.since)}` }) : null) : null,
      p.about ? h('div', { class: 'pc-about' }, h('b', { text: 'О себе' }), h('p', { text: p.about })) : null),
  ];
}

let noteTimer = 0;
function openFriendInfo() {
  const f = currentFriend();
  if (!f) return;
  $('fdCard').replaceChildren(...cardEl(f));
  $('fdNote').value = f.note || '';
  $('fdCode').textContent = f.code;
  $('fdGroup').textContent = f.groupCode || '—';
  $('fdAddr').textContent = f.addr;
  $('fdSeen').textContent = f.online ? 'сейчас' : (f.lastSeen ? seenAgo(f.lastSeen) : (f.hideSeen ? 'скрыто' : 'ещё не встречались'));
  $('fdRemove').textContent = f.state === 'friend' ? 'Удалить из друзей' : 'Удалить заявку';
  $('fdCall').hidden = f.state !== 'friend';
  $('fdCall').disabled = !f.online;
  $('friendDlg').dataset.friend = f.id;
  $('friendDlg').showModal();
}

// Мой профиль: редактор с предпросмотром.
const COLORS = ['', '#c9b38a', '#c48a5a', '#c7a3a0', '#b7aacb', '#a9b6c8', '#7fa0a8', '#9fb7a4', '#5f7f6a'];
const PF = { avatar: 'keep', url: null, color: '', anim: 'keep', animUrl: null, banner: 'keep', bannerUrl: null, emoji: '', src: null, bannerSrc: null };
function pfValues() {
  const me = S.me || {};
  return {
    id: me.id, name: $('pfName').value.trim() || me.name, statusText: $('pfStatus').value.trim(), statusEmoji: PF.emoji, about: $('pfAbout').value.trim(),
    color: PF.color, effective: me.effective, avatarV: PF.avatar === null ? 0 : me.avatarV, activity: me.activity,
    anim: PF.anim === 'keep' ? me.anim : null, banner: PF.banner === 'keep' ? me.banner : null,
  };
}
function renderPf() {
  const v = pfValues();
  const img = typeof PF.avatar === 'string' && PF.avatar !== 'keep' ? PF.url : null;
  const animUrl = PF.anim instanceof Uint8Array ? PF.animUrl : null;
  const bannerUrl = PF.banner instanceof Uint8Array ? PF.bannerUrl : null;
  $('pfPreview').replaceChildren(...cardEl(v, { self: true, img, animUrl, bannerUrl }));
  $('pfAvatar').replaceChildren(avatar(v.id || 'me', v.name, { size: 'huge', avatarV: img ? 0 : v.avatarV, color: v.color, self: true, img, anim: animUrl ? null : v.anim, animUrl, always: true }));
  $('pfAboutCount').textContent = `${$('pfAbout').value.length}/190`;
  $('pfPhotoRemove').hidden = !(img || v.avatarV);
  $('pfPhotoRedo').hidden = !PF.src;
  $('pfBannerRemove').hidden = !(bannerUrl || v.banner);
  $('pfBanner').textContent = bannerUrl || v.banner ? 'Заменить…' : 'Выбрать картинку…';
  $('pfEmoji').textContent = PF.emoji || '🙂';
  $('pfEmoji').classList.toggle('empty', !PF.emoji);
  for (const b of $('pfColors').children) b.setAttribute('aria-pressed', String(b.dataset.c === PF.color));
}
function untilValue() {
  const v = $('pfUntil').value;
  if (v === 'keep') return S.me?.statusUntil || 0;
  if (v === 'today') { const d = new Date(); d.setHours(23, 59, 59, 0); return d.getTime(); }
  const m = Number(v) || 0;
  return m ? Date.now() + m * 60000 : 0;
}
async function editPhoto(file, mode) {
  try {
    $('pfNote').hidden = true;
    const r = await openAvatarEditor(file, mode);
    if (!r) return;
    if (mode === 'banner') { PF.banner = r.banner; PF.bannerUrl = r.url; PF.bannerSrc = file; } else {
      PF.avatar = r.b64;
      PF.url = r.url;
      PF.anim = r.anim || null;
      PF.animUrl = r.animUrl;
      PF.src = file;
    }
    renderPf();
  } catch (err) {
    $('pfNote').textContent = `${mode === 'banner' ? 'Баннер' : 'Фото'}: ${err.message}`;
    $('pfNote').dataset.kind = 'bad';
    $('pfNote').hidden = false;
  }
}
function openProfile(focus) {
  const me = S.me;
  if (!me) return;
  Object.assign(PF, { avatar: 'keep', url: null, anim: 'keep', animUrl: null, banner: 'keep', bannerUrl: null, src: null, bannerSrc: null });
  PF.color = me.color || '';
  PF.emoji = statusOf(me) ? me.statusEmoji || '' : '';
  $('pfName').value = me.name || '';
  $('pfStatus').value = statusOf(me) ? me.statusText || '' : '';
  const until = $('pfUntil');
  until.querySelector('option[value="keep"]')?.remove();
  if (me.statusUntil > Date.now() && statusOf(me)) {
    until.prepend(h('option', { value: 'keep', text: `До ${fmtTime.format(new Date(me.statusUntil))}` }));
    until.value = 'keep';
  } else until.value = '0';
  $('pfAbout').value = me.about || '';
  $('pfNote').hidden = true;
  $('pfColors').replaceChildren(...COLORS.map((c) => {
    const b = h('button', { type: 'button', class: c ? 'sw' : 'sw none', dataset: { c }, title: c ? c : 'Без цвета', 'aria-label': c ? `Цвет ${c}` : 'Без цвета', onclick: () => { PF.color = c; renderPf(); } });
    if (c) b.style.background = c;
    return b;
  }));
  renderPf();
  $('profileDlg').showModal();
  (focus === 'status' ? $('pfStatus') : $('pfName')).focus();
}

async function saveProfile() {
  const btn = $('pfSave');
  btn.disabled = true;
  try {
    const v = pfValues();
    if (!v.name) throw new Error('введите имя');
    const r = await window.som.saveProfile({
      name: v.name, status: v.statusText, emoji: PF.emoji, until: untilValue(), about: v.about, color: PF.color,
      avatar: PF.avatar, anim: PF.anim, banner: PF.banner,
    });
    if (!r || !r.ok) throw new Error(r?.error || 'ядро не ответило');
    S.me = { ...S.me, ...r.result };
    renderMe();
    $('profileDlg').close();
    toast('Профиль сохранён. Друзья в сети увидят его сразу, остальные — когда появятся.', 'ok');
  } catch (err) {
    $('pfNote').textContent = err.message;
    $('pfNote').dataset.kind = 'bad';
    $('pfNote').hidden = false;
  } finally {
    btn.disabled = false;
  }
}

function meMenu() {
  const r = $('meBtn').getBoundingClientRect();
  const cur = S.me?.presence || 'online';
  const mark = (k, label) => `${cur === k ? '✓ ' : '\u2003'}${label}`;
  const set = async (chosen) => {
    try { S.me = { ...S.me, ...(await call('set_presence', { chosen })) }; renderMe(); } catch (err) { toast(err.message, 'bad'); }
  };
  showMenu(r.left, r.top, [
    { label: mark('online', 'В сети'), onclick: () => set('online') },
    { label: mark('dnd', 'Не беспокоить — без звуков'), onclick: () => set('dnd') },
    { label: mark('invisible', 'Невидимка — для друзей не в сети'), onclick: () => set('invisible') },
    { label: '\u2003Свой статус…', onclick: () => openProfile('status') },
    { label: '\u2003Изменить профиль…', onclick: () => openProfile() },
    { label: `\u2003Скопировать код друга (${S.me?.code || ''})`, onclick: () => window.som.copy(S.me.code).then(() => toast('Код друга скопирован.')) },
  ]);
}

// ---------- Оверлей поверх игры ----------
const OV_DEF = { mode: 'games', corner: 'tl', size: 'm', opacity: 0.85, compact: false, messages: true };
function ovCfg() {
  try { return { ...OV_DEF, ...JSON.parse(localStorage.getItem('som.overlay') || '{}') }; } catch { return { ...OV_DEF }; }
}
function setOvCfg(patch) {
  const next = { ...ovCfg(), ...patch };
  try { localStorage.setItem('som.overlay', JSON.stringify(next)); } catch { /* не страшно */ }
  renderOvSettings();
  ovPush(true);
}
// Фото для оверлея — data:-адресом: blob-ссылки этого окна в другом окне не откроются.
const ovImgs = new Map();
function ovImg(id, v) {
  if (!v) return null;
  const k = `${id}:${v}`;
  if (ovImgs.has(k)) return ovImgs.get(k);
  ovImgs.set(k, null);
  call('avatar', { id }).then((r) => { if (r.data) { ovImgs.set(k, `data:image/jpeg;base64,${r.data}`); ovPush(true); } }).catch(() => {});
  return null;
}
let ovLast = '';
let ovRang = '';
function ovPush(force = false) {
  const c = callState();
  const cfg = ovCfg();
  let callView = null;
  if (c && c.state === 'incoming' && ovRang !== c.callId) {
    ovRang = c.callId;
    const f = S.friends.find((x) => x.id === c.friend);
    window.som.overlayToast({ id: `call-${c.callId}`, kind: 'call', title: 'Входящий звонок', text: `${f?.name || 'Друг'} звонит — ответить можно в окне Som` }).catch(() => {});
  }
  if (c && c.state !== 'incoming') {
    const f = S.friends.find((x) => x.id === c.friend) || { id: c.friend, name: 'Друг' };
    const me = S.me || {};
    const ptt = audioPrefs.mode === 'ptt';
    const lv = c.levels || {};
    const myFlag = c.deafened ? ['звук выкл', ''] : c.muted ? ['микрофон выкл', ''] : ptt ? [pttIsDown() ? 'говорю' : `говорить: ${audioPrefs.pttKey.label}`, 'ptt'] : ['', ''];
    const peerFlag = c.state !== 'active' ? ['соединяю…', 'ptt'] : c.peerDeafened ? ['звук выкл', ''] : c.peerMuted ? ['микрофон выкл', ''] : ['', ''];
    callView = { people: [
      { name: f.name, initials: initials(f.name), color: f.color || colorFor(f.id), img: ovImg(f.id, f.avatarV), talking: (lv.peer ?? -100) > -45, flag: peerFlag[0], flagKind: peerFlag[1] },
      { name: me.name || 'Вы', initials: initials(me.name), color: me.color || colorFor(me.id || 'me'), img: ovImg('me', me.avatarV), talking: (lv.me ?? -100) > -45 && !c.muted, flag: myFlag[0], flagKind: myFlag[1] },
    ] };
  }
  const st = { cfg, call: callView };
  const j = JSON.stringify(st);
  if (j === ovLast && !force) return;
  ovLast = j;
  window.som.overlayState(st).catch(() => {});
}
function renderOvSettings() {
  const cfg = ovCfg();
  for (const [attr, key] of [['ovmode', 'mode'], ['ovcorner', 'corner'], ['ovsize', 'size']]) {
    for (const b of document.querySelectorAll(`[data-${attr}]`)) b.setAttribute('aria-pressed', String(b.dataset[attr] === cfg[key]));
  }
  $('ovOpacity').value = String(Math.round(cfg.opacity * 100));
  $('ovOpacityText').textContent = `${Math.round(cfg.opacity * 100)}%`;
  $('ovCompact').checked = cfg.compact;
  $('ovMessages').checked = cfg.messages;
  $('ovOpts').hidden = cfg.mode === 'off';
}
function initOverlay() {
  for (const [attr, key] of [['ovmode', 'mode'], ['ovcorner', 'corner'], ['ovsize', 'size']]) {
    for (const b of document.querySelectorAll(`[data-${attr}]`)) b.addEventListener('click', () => setOvCfg({ [key]: b.dataset[attr] }));
  }
  $('ovOpacity').addEventListener('input', (e) => setOvCfg({ opacity: Number(e.target.value) / 100 }));
  $('ovCompact').addEventListener('change', (e) => setOvCfg({ compact: e.target.checked }));
  $('ovMessages').addEventListener('change', (e) => setOvCfg({ messages: e.target.checked }));
  $('ovTest').addEventListener('click', () => {
    window.som.overlayToast({ id: `test-${Date.now()}`, test: true, title: 'Так выглядит оверлей', text: 'Уведомление поверх игры. Клики проходят сквозь него.' }).catch(() => {});
  });
  renderOvSettings();
  ovPush(true);
}

// ---------- Игры ----------
let GAMES = null;
function renderGames() {
  const g = GAMES;
  if (!g) return;
  $('setGames').checked = g.enabled;
  const cur = g.current?.game;
  const invisible = S.me?.effective === 'invisible';
  $('gamesNow').textContent = g.platform !== 'win32' ? 'Игры Som узнаёт только в Windows.'
    : !g.enabled ? 'Друзья не видят, во что вы играете.'
    : cur ? `Сейчас: ${cur}${invisible ? ' — но вы невидимка, друзья этого не видят' : ' — друзья видят «Играет в …»'}.`
    : 'Сейчас игр не видно. Som проверяет запущенные программы раз в 20 секунд.';
  $('gamesHide').hidden = !cur;
  $('gamesCustom').replaceChildren(...g.custom.map((c) => h('div', { class: 'g' },
    h('span', {}, h('b', { text: c.name }), ` · ${c.exe}`),
    h('button', { type: 'button', class: 'btn small ghost', text: 'Убрать', onclick: () => setGames({ custom: g.custom.filter((x) => x !== c) }) }))));
  $('gamesHidden').replaceChildren(...g.hidden.map((name) => h('div', { class: 'g' },
    h('span', { text: `Скрыта: ${name}` }),
    h('button', { type: 'button', class: 'btn small ghost', text: 'Показывать', onclick: () => setGames({ hidden: g.hidden.filter((x) => x !== name) }) }))));
}
async function setGames(next) {
  GAMES = await window.som.games.set(next).catch(() => GAMES);
  renderGames();
}
async function showRunning() {
  const box = $('gamesRunning');
  box.hidden = false;
  box.replaceChildren(h('p', { class: 'hint', text: 'Смотрю, какие программы открыты…' }));
  const list = await window.som.games.running().catch(() => []);
  if (!list.length) { box.replaceChildren(h('p', { class: 'hint', text: 'Не нашёл открытых программ. Запустите игру и нажмите ещё раз.' })); return; }
  box.replaceChildren(h('p', { class: 'hint', text: 'Запустите игру, найдите её здесь и дайте ей имя:' }), ...list.slice(0, 20).map((w) => {
    const name = h('input', { type: 'text', maxlength: '60', value: w.title.slice(0, 60), 'aria-label': `Название для ${w.exe}` });
    return h('div', { class: 'g' }, h('span', { class: 'faint', text: w.exe }), name,
      h('button', { type: 'button', class: 'btn small', text: 'Это игра', onclick: () => {
        const n = name.value.trim();
        if (!n) { name.focus(); return; }
        setGames({ custom: [...GAMES.custom.filter((c) => c.exe !== w.exe), { exe: w.exe, name: n }] });
        box.hidden = true;
      } }));
  }));
}
function initGames() {
  window.som.games.get().then((g) => { GAMES = g; renderGames(); }).catch(() => {});
  window.som.games.onState((g) => { GAMES = g; renderGames(); });
  $('setGames').addEventListener('change', (e) => setGames({ enabled: e.target.checked }));
  $('gamesHide').addEventListener('click', () => { const cur = GAMES?.current?.game; if (cur) setGames({ hidden: [...GAMES.hidden, cur] }); });
  $('gamesAdd').addEventListener('click', showRunning);
}

/** Звук события; в «Не беспокоить» молчим. */
function sound(name) {
  if (S.me?.effective === 'dnd' && name !== 'muteOn' && name !== 'muteOff' && name !== 'pttOn' && name !== 'pttOff') return;
  playSound(name, audioPrefs.out);
}

function renderMicMode() {
  const mode = audioPrefs.mode;
  for (const b of document.querySelectorAll('[data-mm]')) b.setAttribute('aria-pressed', String(b.dataset.mm === mode));
  $('pttRow').hidden = mode !== 'ptt';
  $('pttKeyBtn').textContent = `Клавиша: ${audioPrefs.pttKey.label}`;
  $('pttHint').textContent = window.som.platform === 'win32'
    ? 'Работает и поверх игры, и когда Som свёрнут. Отпускание — с задержкой 0,2 с.'
    : 'В этой системе клавиша работает, только когда окно Som в фокусе.';
}
function initSoundsAndPtt() {
  for (const b of document.querySelectorAll('[data-mm]')) {
    b.addEventListener('click', () => { audioPrefs.mode = b.dataset.mm; renderMicMode(); armPtt(); });
  }
  const btn = $('pttKeyBtn');
  btn.addEventListener('click', () => {
    if (btn.dataset.listening === '1') return;
    btn.dataset.listening = '1';
    btn.textContent = 'Нажмите клавишу или кнопку мыши… (Esc — отмена)';
    const stop = () => {
      btn.dataset.listening = '0';
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onMouse, true);
      renderMicMode();
    };
    const take = (k) => { if (k) { audioPrefs.pttKey = k; armPtt(); } stop(); };
    const onKey = (e) => { e.preventDefault(); e.stopPropagation(); if (e.key === 'Escape') { stop(); return; } take(keyFromEvent(e)); };
    // Левую и правую кнопки не берём — ими пользуются всё время.
    const onMouse = (e) => { if (e.button === 0 || e.button === 2) return; e.preventDefault(); e.stopPropagation(); take(keyFromEvent(e)); };
    setTimeout(() => { window.addEventListener('keydown', onKey, true); window.addEventListener('mousedown', onMouse, true); }, 0);
  });
  $('soundList').replaceChildren(...Object.entries(SOUND_KINDS).map(([kind, label]) => {
    const box = h('input', { type: 'checkbox' });
    box.checked = soundPrefs.on(kind);
    box.addEventListener('change', () => { soundPrefs.set(kind, box.checked); if (box.checked) playSound(SAMPLE[kind], audioPrefs.out, true); });
    return h('div', { class: 'snd' }, h('label', { class: 'check' }, box, h('span', { text: label })),
      h('button', { type: 'button', class: 'btn small ghost', text: '▶', title: 'Послушать', 'aria-label': `Послушать: ${label}`, onclick: () => playSound(SAMPLE[kind], audioPrefs.out, true) }));
  }));
  const vol = $('soundVol');
  vol.value = String(soundPrefs.volume);
  $('soundVolText').textContent = `${soundPrefs.volume}%`;
  vol.addEventListener('input', () => { soundPrefs.volume = Number(vol.value); $('soundVolText').textContent = `${vol.value}%`; });
  vol.addEventListener('change', () => playSound('message', audioPrefs.out, true));
}
const SAMPLE = { message: 'message', online: 'online', call: 'join', mute: 'muteOn' };

async function openSettings() {
  $('setName').value = S.me?.name || '';
  renderThemeGrid();
  renderMicMode();
  $('setShowSeen').checked = !S.me?.hideSeen;
  $('setNoAnim').checked = noAnim();
  $('setCleanMeta').checked = cleanOn();
  $('setAutoWatch').checked = screenPrefs.autoWatch;
  $('setLinkPreview').checked = linkPreviewOn();
  $('gamesRunning').hidden = true;
  renderGames();
  applyTheme(readTheme());
  const about = $('aboutList');
  about.replaceChildren();
  const add = (k, v) => about.append(h('dt', { text: k }), h('dd', { text: v }));
  add('Som', (await window.som.appInfo().catch(() => ({}))).version || '?');
  try {
    const v = await call('version');
    add('Ядро', `${v.core} · OpenMLS ${v.openmls}`);
    add('Сеть', v.noise);
  } catch { add('Ядро', 'не отвечает'); }
  add('Адрес', S.me?.addr || 'нет');
  add('Профиль', S.profile === 'main' ? 'основной' : S.profile);
  add('Ключи', S.me?.protection || '—');
  fillDevices();
  markNs();
  window.som.updateState().then((st) => st && renderUpdate(st)).catch(() => {});
  $('settingsDlg').showModal();
}

async function fillDevices() {
  let devices = [];
  try { devices = await navigator.mediaDevices.enumerateDevices(); } catch { /* нет доступа */ }
  const fill = (select, kind, current) => {
    const list = devices.filter((d) => d.kind === kind && d.deviceId !== 'communications');
    const opts = list.length ? list : [{ deviceId: 'default', label: '' }];
    select.replaceChildren(...opts.map((d, i) => {
      let label = d.label || (kind === 'audioinput' ? `Микрофон ${i + 1}` : `Устройство ${i + 1}`);
      if (d.deviceId === 'default') label = `По умолчанию${d.label ? ` — ${d.label.replace(/^(Default|По умолчанию)\s*-\s*/i, '')}` : ''}`;
      return h('option', { value: d.deviceId, text: label });
    }));
    select.value = opts.some((d) => d.deviceId === current) ? current : opts[0].deviceId;
  };
  fill($('setMic'), 'audioinput', audioPrefs.mic);
  fill($('setOut'), 'audiooutput', audioPrefs.out);
  const cams = devices.filter((d) => d.kind === 'videoinput');
  $('setCam').replaceChildren(h('option', { value: 'default', text: 'По умолчанию' }),
    ...cams.map((d, i) => h('option', { value: d.deviceId, text: d.label || `Камера ${i + 1}` })));
  $('setCam').value = cams.some((d) => d.deviceId === camPrefs.cam) ? camPrefs.cam : 'default';
  $('setCamNote').textContent = cams.length ? '' : 'Камер не найдено. Подключите камеру и откройте настройки заново.';
  for (const b of document.querySelectorAll('[data-camq]')) b.setAttribute('aria-pressed', String(b.dataset.camq === camPrefs.quality));
}

let camTest = null;
function stopCamTest() {
  camTest?.getTracks().forEach((t) => t.stop());
  camTest = null;
  $('camPreview').srcObject = null;
  $('camPreview').hidden = true;
  $('camTest').textContent = 'Проверить камеру';
}
async function toggleCamTest() {
  if (camTest) { stopCamTest(); return; }
  try {
    camTest = await navigator.mediaDevices.getUserMedia({ video: camConstraints(), audio: false });
    $('camPreview').srcObject = camTest;
    $('camPreview').hidden = false;
    $('camPreview').play().catch(() => {});
    $('camTest').textContent = 'Выключить';
    const s = camTest.getVideoTracks()[0].getSettings();
    $('setCamNote').textContent = s.width ? `Камера даёт ${s.width}×${s.height}${s.frameRate ? `, ${Math.round(s.frameRate)} к/с` : ''}.` : '';
  } catch (err) { $('setCamNote').textContent = cameraError(err); }
}

function markNs() {
  for (const b of document.querySelectorAll('[data-ns]')) b.setAttribute('aria-pressed', String(b.dataset.ns === audioPrefs.ns));
}

// ---------- Проверка шумодава: запись 6 с двумя дорожками — «как есть» и «с шумодавом» ----------
const NS_NAMES = { rnnoise: 'RNNoise', speex: 'Speex', chromium: 'стандартным', off: 'без шумодава' };
const micTestState = { mic: null, raf: 0, recs: [], urls: [], player: null, timer: 0 };

function stopPlayer() {
  if (micTestState.player) { micTestState.player.pause(); micTestState.player = null; }
}
function stopMicTest() {
  cancelAnimationFrame(micTestState.raf);
  clearTimeout(micTestState.timer);
  for (const r of micTestState.recs) { try { if (r.state !== 'inactive') r.stop(); } catch { /* уже */ } }
  micTestState.recs = [];
  micTestState.mic?.close();
  micTestState.mic = null;
  stopPlayer();
  $('micMeter').style.width = '0';
  $('micTest').textContent = 'Проверить шумодав';
  $('micTest').disabled = false;
}

function pct(list, q) {
  if (!list.length) return -100;
  const a = [...list].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor(q * a.length))];
}
const fmtDbv = (v) => `${Math.round(v)} дБ`.replace('-', '−');

function nsVerdict(mic, raw, proc) {
  const floorRaw = pct(raw, 0.1);
  const floorProc = pct(proc, 0.1);
  const voice = pct(raw, 0.95);
  const cut = Math.round(floorRaw - floorProc); // сравниваем то же число, что показываем
  const nums = `фон без голоса: как есть ${fmtDbv(floorRaw)}, после ${fmtDbv(floorProc)}`;
  if (voice < -50) return { kind: 'bad', text: `Голоса почти не слышно (${fmtDbv(voice)}). Проверьте, тот ли микрофон выбран и не выключен ли он.` };
  if (mic.mode === 'off') return { kind: '', text: `Шумодав выключен — обе записи одинаковые (${nums}).` };
  if (mic.mode === 'chromium') return { kind: '', text: 'Стандартный шумодав работает внутри Chromium ещё до этой проверки, поэтому «как есть» тоже уже очищено. Чтобы услышать разницу, выберите RNNoise или Speex.' };
  if (!mic.nsActive) return { kind: 'bad', text: mic.note || 'Шумодав не загрузился — голос идёт без него.' };
  if (cut >= 10) return { kind: 'ok', text: `${NS_NAMES[mic.mode]} работает: фон тише на ${Math.round(cut)} дБ (${nums}).` };
  if (floorRaw < -58) return { kind: '', text: `В комнате и так тихо (${nums}) — шумодаву почти нечего убирать. Разница будет слышна при вентиляторе, клавиатуре или улице.` };
  if (cut >= 3) return { kind: '', text: `${NS_NAMES[mic.mode]} убирает немного: фон тише на ${Math.round(cut)} дБ (${nums}).` };
  return { kind: '', text: `Разницы почти нет (${nums}). Похоже, шум уже убирает драйвер микрофона, гарнитура или программа вроде NVIDIA Broadcast — тогда шумодав Som можно выключить.` };
}

async function toggleMicTest() {
  if (micTestState.mic) { stopMicTest(); return; }
  const note = $('micTestNote');
  const play = $('micPlay');
  play.hidden = true;
  stopPlayer();
  for (const u of micTestState.urls) URL.revokeObjectURL(u);
  micTestState.urls = [];
  note.hidden = false;
  note.dataset.kind = '';
  try {
    const mic = await openMic();
    micTestState.mic = mic;
    note.textContent = `${mic.label}. Запись 6 секунд: скажите пару фраз, а последние 2 секунды помолчите — так видно фон.`;
    $('micTest').textContent = 'Остановить';
    const type = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '';
    const chunks = { raw: [], proc: [] };
    const mk = (stream, key) => {
      const r = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      r.ondataavailable = (e) => { if (e.data.size) chunks[key].push(e.data); };
      r.start();
      return r;
    };
    const recs = [mk(mic.rawStream, 'raw'), mk(mic.stream, 'proc')];
    micTestState.recs = recs;
    const levels = { raw: [], proc: [] };
    const buf = new Float32Array(1024);
    const t0 = performance.now();
    let last = 0;
    const loop = () => {
      if (micTestState.mic !== mic) return;
      const now = performance.now();
      const db = levelDb(mic.analyser, buf);
      if (now - last >= 50) { last = now; levels.raw.push(levelDb(mic.rawAnalyser, buf)); levels.proc.push(db); }
      $('micMeter').style.width = `${Math.max(0, Math.min(100, ((db + 60) / 60) * 100)).toFixed(0)}%`;
      if (now - t0 < 6000) micTestState.raf = requestAnimationFrame(loop);
    };
    loop();
    await new Promise((resolve) => { micTestState.timer = setTimeout(resolve, 6000); });
    if (micTestState.mic !== mic) return;
    await Promise.all(recs.map((r) => new Promise((res) => { r.onstop = res; r.stop(); })));
    micTestState.recs = [];
    const verdict = nsVerdict(mic, levels.raw.slice(4), levels.proc.slice(4));
    DIAG.ns = {
      at: Date.now(), mode: mic.mode, active: mic.nsActive, mic: mic.label,
      floorRaw: pct(levels.raw.slice(4), 0.1), floorProc: pct(levels.proc.slice(4), 0.1), voice: pct(levels.raw.slice(4), 0.95),
      settings: mic.settings, text: verdict.text,
    };
    saveDiag();
    micTestState.mic = null;
    mic.close();
    $('micMeter').style.width = '0';
    $('micTest').textContent = 'Проверить ещё раз';
    note.textContent = verdict.text;
    note.dataset.kind = verdict.kind;
    const raw = URL.createObjectURL(new Blob(chunks.raw, { type: type || 'audio/webm' }));
    const proc = URL.createObjectURL(new Blob(chunks.proc, { type: type || 'audio/webm' }));
    micTestState.urls = [raw, proc];
    $('micPlayProc').textContent = `▶ С шумодавом (${NS_NAMES[mic.mode]})`;
    $('micPlayRaw').onclick = () => playTest(raw);
    $('micPlayProc').onclick = () => playTest(proc);
    play.hidden = false;
    fillDevices(); // после разрешения появятся названия устройств
  } catch (err) {
    stopMicTest();
    note.textContent = micError(err);
    note.dataset.kind = 'bad';
  }
}

function playTest(url) {
  stopPlayer();
  const a = new Audio(url);
  if (typeof a.setSinkId === 'function') a.setSinkId(sinkFor(audioPrefs.out)).catch(() => {});
  a.play().catch(() => {});
  micTestState.player = a;
}

// ---------- События ядра ----------
function onCoreEvent(ev) {
  switch (ev.event) {
    case 'friends':
      S.friends = ev.friends || [];
      if (S.current && !currentFriend()) S.current = null;
      if (!$('shell').hidden) { renderFriends(); renderChat(); }
      break;
    case 'message': {
      const list = S.history.get(ev.friend);
      if (list && !list.some((m) => m.id === ev.msg.id && m.dir === 'in')) list.push(ev.msg);
      S.typing.delete(ev.friend);
      const f = S.friends.find((x) => x.id === ev.friend);
      if (S.current === ev.friend && document.hasFocus()) call('read', { id: ev.friend }).catch(() => {});
      else if (f) {
        // Упоминание пробивается и через «Не беспокоить» — но без звука.
        const ment = mentions(ev.msg.text, S.me?.name);
        const dnd = S.me?.effective === 'dnd';
        if (!dnd || ment) {
          toast(`${f.name}${ment ? ' упоминает вас' : ''}: ${msgPreview(ev.msg).slice(0, 120)}`);
          if (!dnd) sound('message');
          if (!document.hasFocus()) window.som.overlayToast({ id: ev.msg.id, title: ment ? `${f.name} · упоминание` : f.name, text: msgPreview(ev.msg).slice(0, 140) }).catch(() => {});
        }
      }
      if (S.current === ev.friend && f) $('chatStatus').textContent = seenText(f);
      if (S.current === ev.friend && f && list) appendMessage(f, list.find((m) => m.id === ev.msg.id && m.dir === 'in'));
      break;
    }
    case 'msgstatus': {
      const m = S.history.get(ev.friend)?.find((x) => x.id === ev.id);
      if (m) {
        if (ev.status === 'failed' || (STATUS_ORDER[ev.status] ?? 0) >= (STATUS_ORDER[m.status] ?? 0)) m.status = ev.status;
      }
      const st = document.querySelector(`.msg[data-mid="${CSS.escape(ev.id)}"] .st`);
      if (st && m) { st.dataset.st = m.status; st.textContent = STATUS[m.status] || m.status; }
      break;
    }
    case 'file':
    case 'msgupdate':
      applyMsg(ev.friend, ev.msg);
      if (S.compose?.m?.id === ev.msg.id && ev.msg.deleted) cancelCompose();
      break;
    case 'msgremoved':
      removeMsg(ev.friend, ev.id);
      break;
    case 'saved':
      addSaved(ev.msg);
      break;
    case 'pins': {
      const f = S.friends.find((x) => x.id === ev.friend);
      if (f) f.pinned = ev.pinned || [];
      if (S.current === ev.friend) renderPinBar();
      break;
    }
    case 'cleaned': {
      CLEANED.set(ev.mid, ev.removed || []);
      const node = document.querySelector(`.msg[data-mid="${CSS.escape(ev.mid)}"]`);
      const note = cleanedEl(ev.mid);
      if (node && note && !node.querySelector('.clean-note')) node.querySelector('.meta')?.before(note);
      break;
    }
    case 'typing': {
      S.typing.set(ev.friend, Date.now() + 6000);
      const redraw = () => {
        if ($('shell').hidden) return;
        renderFriends();
        const f = currentFriend();
        if (f?.id === ev.friend && f.state === 'friend') $('chatStatus').textContent = isTyping(f.id) ? 'печатает…' : seenText(f);
      };
      redraw();
      setTimeout(redraw, 6100);
      break;
    }
    case 'request':
      toast(`Заявка в друзья: ${ev.name} (код ${ev.code}).`, 'ok');
      break;
    case 'presence':
      if (typeof ev.online === 'boolean') {
        const was = S.friends.find((x) => x.id === ev.friend);
        if (ev.online && was && was.state === 'friend' && !was.online) sound('online');
        onPresence(ev.friend, ev.online); // список обновится событием friends
      }
      break;
    case 'ptt':
      setPtt(Boolean(ev.down));
      break;
    case 'call':
      onSignal(ev.friend, ev.data);
      break;
    case 'toast':
      toast(ev.text, ev.kind);
      break;
    case 'me':
      S.me = { ...S.me, ...ev };
      renderMe();
      renderBanner();
      break;
    case 'core-exit': {
      const b = $('banner');
      b.replaceChildren('Ядро Som остановилось. ', h('button', { class: 'btn small', type: 'button', text: 'Перезапустить', onclick: () => location.reload() }));
      b.hidden = false;
      break;
    }
    default:
  }
}

// ---------- Старт ----------
function wire() {
  setupWelcome();
  $('addFriendBtn').addEventListener('click', () => openAdd());
  $('emptyAdd').addEventListener('click', () => openAdd());
  $('inviteBtn').addEventListener('click', openInvite);
  $('emptyInvite').addEventListener('click', openInvite);
  $('settingsBtn').addEventListener('click', openSettings);
  $('chatMenu').addEventListener('click', openFriendInfo);
  $('chatAvatar').addEventListener('click', openFriendInfo);
  $('chatAvatar').addEventListener('contextmenu', (e) => { e.preventDefault(); volumePanel(currentFriend(), e.clientX, e.clientY); });
  for (const id of ['tilePeer', 'tilePeerScreen']) {
    $(id).addEventListener('contextmenu', (e) => { e.preventDefault(); const c = callState(); volumePanel(c && S.friends.find((x) => x.id === c.friend), e.clientX, e.clientY); });
  }
  $('chatName').addEventListener('click', openFriendInfo);
  $('meBtn').addEventListener('click', meMenu);
  $('fdNote').addEventListener('input', () => {
    clearTimeout(noteTimer);
    const id = $('friendDlg').dataset.friend;
    const note = $('fdNote').value;
    noteTimer = setTimeout(() => call('set_note', { id, note }).catch(() => {}), 400);
  });
  $('fdCall').addEventListener('click', () => { $('friendDlg').close(); $('callBtn').click(); });
  for (const id of ['pfName', 'pfStatus', 'pfAbout']) $(id).addEventListener('input', renderPf);
  $('pfPhoto').addEventListener('click', () => $('pfFile').click());
  $('pfPhotoRedo').addEventListener('click', () => { if (PF.src) editPhoto(PF.src, 'avatar'); });
  $('pfPhotoRemove').addEventListener('click', () => { PF.avatar = null; PF.url = null; PF.anim = null; PF.animUrl = null; PF.src = null; renderPf(); });
  $('pfFile').addEventListener('change', () => {
    const file = $('pfFile').files[0];
    $('pfFile').value = '';
    if (file) editPhoto(file, 'avatar');
  });
  $('pfBanner').addEventListener('click', () => $('pfBannerFile').click());
  $('pfBannerRemove').addEventListener('click', () => { PF.banner = null; PF.bannerUrl = null; PF.bannerSrc = null; renderPf(); });
  $('pfBannerFile').addEventListener('change', () => {
    const file = $('pfBannerFile').files[0];
    $('pfBannerFile').value = '';
    if (file) editPhoto(file, 'banner');
  });
  $('pfEmoji').addEventListener('click', (e) => showEmoji(e.currentTarget, (em) => { PF.emoji = em; renderPf(); }));
  $('setShowSeen').addEventListener('change', async (e) => {
    try { S.me = { ...S.me, ...(await call('set_privacy', { hideSeen: !e.target.checked })) }; } catch (err) { toast(err.message, 'bad'); }
  });
  $('setNoAnim').addEventListener('change', (e) => {
    try { localStorage.setItem('som.noAnim', e.target.checked ? '1' : '0'); } catch { /* не страшно */ }
    renderMe(); renderFriends(); renderChat();
  });
  initGames();
  window.som.setCleanMeta(cleanOn()).catch(() => {});
  $('setAutoWatch').addEventListener('change', (e) => { screenPrefs.autoWatch = e.target.checked; });
  $('setCleanMeta').addEventListener('change', (e) => {
    try { localStorage.setItem('som.cleanMeta', e.target.checked ? '1' : '0'); } catch { /* не страшно */ }
    window.som.setCleanMeta(e.target.checked).catch(() => {});
  });
  $('pfSave').addEventListener('click', saveProfile);
  // «Не на месте»: 10 минут без мыши и клавиатуры или заблокирован экран.
  let wasAway = false;
  let locked = false;
  const checkAway = async () => {
    if (!S.me?.hasProfile) return;
    const idle = locked ? 0 : await window.som.idleTime().catch(() => 0);
    const away = locked || idle >= 600;
    if (away !== wasAway) {
      wasAway = away;
      try { S.me = { ...S.me, ...(await call('set_presence', { away })) }; renderMe(); } catch { /* не страшно */ }
    }
  };
  setInterval(checkAway, 30000);
  window.som.onLock((on) => { locked = !!on; checkAway(); });
  const second = async () => {
    if (await window.som.secondProfile()) toast('Открываю второй профиль — это отдельное окно со своим именем и ключами.', 'ok');
  };
  $('emptySecond').addEventListener('click', second);
  $('setSecond').addEventListener('click', second);

  $('addInput').addEventListener('input', () => { clearTimeout(checkInvite.t); checkInvite.t = setTimeout(checkInvite, 150); });
  $('addPaste').addEventListener('click', async () => { $('addInput').value = (await window.som.paste()).trim(); checkInvite(); });
  $('addGo').addEventListener('click', addFriend);
  $('invCopy').addEventListener('click', async () => {
    await window.som.copy(S.me.invite);
    $('invCopy').textContent = 'Скопировано';
    setTimeout(() => { $('invCopy').textContent = 'Скопировать ссылку'; }, 1500);
  });
  $('fdRemove').addEventListener('click', async () => {
    const f = currentFriend();
    if (!f) return;
    $('friendDlg').close();
    await declineRequest(f);
    toast(`${f.name} удалён из списка.`);
  });
  $('setNameGo').addEventListener('click', async () => {
    try { S.me = { ...S.me, ...(await call('set_name', { name: $('setName').value })) }; renderMe(); toast('Имя сохранено. Друзья в сети увидят его сразу.', 'ok'); } catch (err) { toast(err.message, 'bad'); }
  });
  for (const b of document.querySelectorAll('[data-zoom]')) b.addEventListener('click', () => applyZoom(Number(b.dataset.zoom)));
  applyZoom(readZoom());
  // Ctrl+колесо и Ctrl +/−/0 — тоже масштаб.
  window.addEventListener('keydown', (e) => {
    if (!e.ctrlKey || e.altKey) return;
    const i = ZOOMS.indexOf(readZoom());
    if (e.key === '=' || e.key === '+') { e.preventDefault(); applyZoom(ZOOMS[Math.min(ZOOMS.length - 1, i + 1)]); }
    else if (e.key === '-') { e.preventDefault(); applyZoom(ZOOMS[Math.max(0, i - 1)]); }
    else if (e.key === '0') { e.preventDefault(); applyZoom(100); }
  });
  $('setMic').addEventListener('change', (e) => { audioPrefs.mic = e.target.value; stopMicTest(); applyDevices(); });
  $('setOut').addEventListener('change', (e) => { audioPrefs.out = e.target.value; applyDevices(); });
  $('setCam').addEventListener('change', (e) => { camPrefs.cam = e.target.value; if (camTest) { stopCamTest(); toggleCamTest(); } });
  for (const b of document.querySelectorAll('[data-camq]')) b.addEventListener('click', () => { camPrefs.quality = b.dataset.camq; fillDevices(); });
  $('camTest').addEventListener('click', toggleCamTest);
  $('settingsDlg').addEventListener('close', stopCamTest);
  for (const b of document.querySelectorAll('[data-ns]')) {
    b.addEventListener('click', () => {
      audioPrefs.ns = b.dataset.ns;
      markNs();
      stopMicTest();
      $('micPlay').hidden = true;
      $('micTestNote').hidden = true;
      applyDevices();
    });
  }
  $('micTest').addEventListener('click', toggleMicTest);
  initSoundsAndPtt();
  // Мелодия входящего звонка: щелчок выбирает и сразу проигрывает.
  let stopRing = null;
  const markRing = () => { for (const b of document.querySelectorAll('[data-ring]')) b.setAttribute('aria-pressed', String(b.dataset.ring === ringId())); };
  $('ringPick').replaceChildren(...Object.entries(RINGS).map(([id, r]) => h('button', { type: 'button', dataset: { ring: id }, text: r.name, onclick: () => {
    audioPrefs.ring = id;
    markRing();
    stopRing?.();
    stopRing = previewRing(id);
  } })));
  markRing();
  $('settingsDlg').addEventListener('close', () => { stopRing?.(); stopRing = null; });
  $('settingsDlg').addEventListener('close', stopMicTest);
  $('reportCopy').addEventListener('click', async () => {
    const btn = $('reportCopy');
    btn.disabled = true;
    try {
      const text = await buildReport();
      await window.som.copy(text);
      btn.textContent = 'Скопировано';
      $('reportNote').textContent = `Отчёт в буфере обмена (${text.split('\n').length} строк). Вставьте его в чат с Claude.`;
    } catch (err) {
      $('reportNote').textContent = `Не получилось: ${err.message}`;
    } finally {
      setTimeout(() => { btn.textContent = 'Скопировать отчёт'; btn.disabled = false; }, 1500);
    }
  });
  initCall({
    avatarFor: (id, size) => (id === 'me' ? meAvatar(size, false) : friendAvatar(S.friends.find((f) => f.id === id) || { id, name: '?' }, size)),
    onCallEnd: (sum) => { DIAG.calls.push(sum); if (DIAG.calls.length > 10) DIAG.calls.shift(); saveDiag(); },
    call, toast, avatar, selectFriend, currentFriend,
    friendById: (id) => S.friends.find((f) => f.id === id) || null,
    me: () => S.me,
    sound,
    cameraError,
    diagError,
    colorFor,
    onLive: () => ovPush(),
  });
  initOverlay();

  const input = $('composerInput');
  input.addEventListener('input', () => {
    autosize();
    const f = currentFriend();
    if (f?.online && input.value.trim() && Date.now() - S.typingSent > 3000) {
      S.typingSent = Date.now();
      call('typing', { id: f.id }).catch(() => {});
    }
  });
  $('cbClose').addEventListener('click', cancelCompose);
  $('searchBtn').addEventListener('click', () => ($('searchBar').hidden ? openSearch() : closeSearch()));
  $('searchClose').addEventListener('click', closeSearch);
  $('searchInput').addEventListener('input', () => { clearTimeout(runSearch.t); runSearch.t = setTimeout(runSearch, 180); });
  $('searchInput').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closeSearch(); $('composerInput').focus(); }
    if (e.key === 'Enter') { e.preventDefault(); $('searchResults').querySelector('.sr')?.click(); }
  });
  $('searchInput').addEventListener('focus', () => { if ($('searchResults').childElementCount) $('searchResults').hidden = false; });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'а' || e.code === 'KeyF') && !$('shell').hidden && !document.querySelector('dialog[open]')) {
      e.preventDefault();
      openSearch();
    }
  });
  initVoice();
  initCircle();
  $('attachBtn').addEventListener('click', async () => {
    const f = currentFriend();
    if (f?.state === 'friend') sendFilesResult(f.id, await window.som.pickFiles(f.id));
  });
  // Ctrl+V: файлы из проводника — как файлы, картинка из буфера (снимок экрана) — как PNG.
  input.addEventListener('paste', async (e) => {
    const f = currentFriend();
    if (f?.state !== 'friend') return;
    const dt = e.clipboardData;
    if (dt.files.length) {
      e.preventDefault();
      const res = await window.som.sendFiles(f.id, dt.files);
      if (res.length) sendFilesResult(f.id, res);
      else sendFilesResult(f.id, [await window.som.pasteImage(f.id)]);
    }
  });
  const view = $('chatView');
  let dragDepth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  view.addEventListener('dragenter', (e) => { if (!hasFiles(e) || currentFriend()?.state !== 'friend') return; dragDepth += 1; view.classList.add('dropping'); });
  view.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) view.classList.remove('dropping'); });
  view.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  view.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragDepth = 0;
    view.classList.remove('dropping');
    const f = currentFriend();
    if (f?.state === 'friend' && e.dataTransfer.files.length) sendFilesResult(f.id, await window.som.sendFiles(f.id, e.dataTransfer.files));
  });
  // Файл, брошенный мимо чата, не должен открываться вместо окна Som.
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());
  $('viewer').addEventListener('close', () => { viewer.mid = null; delete $('viewerImg').dataset.full; });
  $('viewer').addEventListener('click', (e) => { if (e.target === $('viewer') || e.target.classList.contains('viewer-stage')) $('viewer').close(); });
  input.addEventListener('input', () => {
    checkMention();
    clearTimeout(LINK.timer);
    LINK.timer = setTimeout(checkLink, 600);
  });
  input.addEventListener('blur', () => setTimeout(() => { $('mentionPop').hidden = true; }, 150));
  $('lbClose').addEventListener('click', () => { LINK.dismissed = LINK.url; LINK.data = null; LINK.seq += 1; $('linkBar').hidden = true; input.focus(); });
  $('pinMain').addEventListener('click', () => {
    const f = currentFriend();
    const pins = f?.pinned || [];
    if (!pins.length) return;
    jumpTo(pins[pinIdx % pins.length].id);
    pinIdx = (pinIdx + 1) % pins.length;
    renderPinBar();
  });
  $('pinClose').addEventListener('click', () => { const f = currentFriend(); const mid = $('pinBar').dataset.mid; if (f && mid) pinMsg(f, mid, false); });
  $('fdlgSave').addEventListener('click', saveFolder);
  $('fdlgDelete').addEventListener('click', deleteFolder);
  $('fdlgName').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); saveFolder(); } });
  $('setLinkPreview').addEventListener('change', (e) => {
    try { localStorage.setItem('som.linkPreview', e.target.checked ? '1' : '0'); } catch { /* не страшно */ }
    if (!e.target.checked) clearLinkBar();
  });
  input.addEventListener('keydown', (e) => {
    if (!$('mentionPop').hidden && (e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey) {
      e.preventDefault();
      const first = $('mentionPop').querySelector('button');
      if (first) pickMention(first.textContent.slice(1));
      return;
    }
    if (e.key === 'Escape' && !$('mentionPop').hidden) { e.preventDefault(); $('mentionPop').hidden = true; return; }
    if (e.key === 'Escape' && S.compose) { e.preventDefault(); cancelCompose(); return; }
    if (e.key === 'ArrowUp' && !input.value && !S.compose) {
      const f = currentFriend();
      const last = [...(S.history.get(f?.id) || [])].reverse().find((m) => m.dir === 'out' && !m.deleted && !m.file);
      if (last) { e.preventDefault(); startEdit(last); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendMessage(); }
  });
  $('composer').addEventListener('submit', (e) => { e.preventDefault(); sendMessage(); });
  window.addEventListener('focus', () => {
    const f = currentFriend();
    if (f?.unread) call('read', { id: f.id }).catch(() => {});
  });
  // Обновляем «был в сети» и подписи времени раз в минуту.
  setInterval(() => { if (!$('shell').hidden) { renderFriends(); if (currentFriend()?.state !== 'friend') renderChat(); else $('chatStatus').textContent = seenText(currentFriend()); } }, 60000);
}

// ---------- Обновления ----------
let UPD = null;
function renderUpdate(st) {
  if (st) UPD = st;
  const u = UPD;
  if (!u) return;
  const bar = $('updateBar');
  const go = $('updateGo');
  if (u.status === 'ready') {
    $('updateText').textContent = `Обновление ${u.ready} готово`;
    go.hidden = false;
    bar.hidden = false;
  } else if (u.status === 'manual') {
    $('updateText').textContent = `Вышла ${u.latest}: её нужно скачать полной сборкой`;
    go.hidden = true;
    bar.hidden = false;
  } else if (u.status === 'downloading') {
    $('updateText').textContent = `Скачиваю ${u.latest}: ${Math.round((u.progress || 0) * 100)}%`;
    go.hidden = true;
    bar.hidden = false;
  } else {
    bar.hidden = true;
  }
  const when = u.checkedAt ? new Date(u.checkedAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'ещё не проверял';
  const TEXT = {
    idle: 'проверю через минуту после запуска',
    checking: 'проверяю…',
    uptodate: 'это последняя версия',
    downloading: `скачиваю ${u.latest} (${Math.round((u.progress || 0) * 100)}%)`,
    ready: `версия ${u.ready} скачана — перезапустите Som`,
    manual: `вышла ${u.latest}, но ей нужна новая основа Electron — скачайте полную сборку`,
    error: `не получилось: ${u.error}`,
  };
  $('updInfo').textContent = `Сейчас ${u.running}. ${TEXT[u.status] || u.status}. Проверка: ${when}.${u.notes && u.status === 'ready' ? ` Что нового: ${u.notes}` : ''}`;
}

// ---------- Отчёт ----------
async function buildReport() {
  const pad = (n) => String(n).padStart(2, '0');
  const ts = (ms) => { const d = new Date(ms); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const num = (v, digits = 0) => (v == null || Number.isNaN(v) ? '—' : Number(v).toFixed(digits).replace('.', ','));
  const mb = (b) => `${num(b / 1048576, b < 10485760 ? 1 : 0)} МБ`;
  const dur = (s) => `${Math.floor(s / 60)}:${pad(s % 60)}`;
  const L = [];
  const info = await window.som.appInfo().catch(() => ({}));
  const d = await call('diag').catch((e) => ({ error: e.message }));
  L.push(`SOM — ОТЧЁТ ${info.version || ''} · ${ts(Date.now())}`);
  L.push(`Профиль: ${S.me?.name || '—'} (${S.me?.code || '—'}) · ${S.profile === 'main' ? 'основной' : `профиль ${S.profile}`}`);
  L.push(`Система: ${info.platform || '?'} ${info.os || '?'} ${info.arch || ''} · ${info.cpu || '?'} · ОЗУ ${info.ramGb || '?'} ГБ · Electron ${info.electron || '?'}`);
  L.push(`Сеть: адрес ${d.bind || 'нет'} · Radmin ${S.net?.radmin ? 'да' : 'НЕТ'} · приём подключений ${d.listening ? 'да' : 'НЕТ'} · соединений ${d.conns ?? '—'}`);
  if (info.addrs) L.push(`Интерфейсы: ${info.addrs}`);
  L.push(`Ядро: ${d.core || '?'} · работает ${d.uptime != null ? dur(d.uptime) : '—'} · ключи: ${d.protection || '—'}`);
  if (d.error) L.push(`Ядро не ответило: ${d.error}`);

  L.push('', 'ДРУЗЬЯ');
  const STATE = { friend: 'друг', incoming: 'заявка ко мне', outgoing: 'моя заявка' };
  for (const f of d.friends || []) {
    const conn = f.conn ? `соединение ${f.conn.initiator ? 'исходящее к' : 'входящее от'} ${f.conn.peer}` : `не в сети${f.lastSeen ? ` (был(а) ${ts(f.lastSeen)})` : ''}`;
    L.push(`- ${f.name} · ${STATE[f.state] || f.state} · адрес ${f.addr} · ${conn} · пинг канала ${f.rtt != null ? `${f.rtt} мс` : '—'}`);
    L.push(`  сообщений ${f.history} (файлов ${f.files}) · в очереди ${f.queued} (всего кадров ${f.outbox}) · качается ${f.downloading} · код чата ${f.groupCode || '—'} · эпоха ${f.epoch ?? '—'}`);
  }
  if (!(d.friends || []).length) L.push('- нет');

  L.push('', 'ПЕРЕДАЧИ ФАЙЛОВ (за этот запуск)');
  for (const t of d.transfers || []) {
    const bytes = Math.max(0, t.size - (t.from || 0) * 49152);
    const speed = t.ms > 0 ? `${num(bytes / 1048576 / (t.ms / 1000), 1)} МБ/с` : '—';
    L.push(`- ${ts(t.at)} ${t.dir === 'in' ? '← получен' : '→ отдан'} «${t.name}» ${mb(t.size)} · ${num(t.ms / 1000, 1)} с · ${speed}${t.from ? ` · докачка с куска ${t.from}` : ''}${t.error ? ` · ОШИБКА: ${t.error}` : ''}`);
  }
  if (!(d.transfers || []).length) L.push('- не было');

  L.push('', 'ЗВОНКИ (последние)');
  for (const c of DIAG.calls.slice(-5)) {
    if (!c.connected) { L.push(`- ${ts(c.at)} · ${c.friend} · ${c.role} · не соединился: ${c.result}`); continue; }
    L.push(`- ${ts(c.at)} · ${c.friend} · ${c.role} · ${dur(c.durS)} · соединение за ${num(c.connectMs)} мс · ${c.result}${c.endedBy ? ` (положил ${c.endedBy})` : ''}`);
    L.push(`  путь ${c.path || '—'} · ${c.codec || '—'} · пинг ср ${num(c.rttAvg)} / макс ${num(c.rttMax)} мс · джиттер ${num(c.jitterAvg, 1)} мс`);
    L.push(`  потери ${num(c.lossPct, 2)}% · заплатки ${num(c.concealedPct, 2)}% · приём ${num(c.kbpsIn)} кбит/с · отдача ${num(c.kbpsOut)} кбит/с · восстановлений ${c.restarts ?? 0} · притормаживал файлы ${c.slowed ?? 0} раз`);
    const ms = c.micSettings || {};
    L.push(`  микрофон «${c.mic || '—'}» · шумодав ${c.ns}${c.nsActive === false && c.ns !== 'off' && c.ns !== 'chromium' ? ' (НЕ ЗАГРУЗИЛСЯ)' : ''} · эхоподавление ${ms.echoCancellation ?? '—'} · автоусиление ${ms.autoGainControl ?? '—'} · ${ms.sampleRate || '—'} Гц`);
  }
  if (!DIAG.calls.length) L.push('- не было');

  L.push('', 'ШУМОДАВ (проверка в настройках)');
  if (DIAG.ns) {
    const n = DIAG.ns;
    L.push(`- ${ts(n.at)} · ${n.mode}${!n.active && (n.mode === 'rnnoise' || n.mode === 'speex') ? ' (НЕ ЗАГРУЗИЛСЯ)' : ''} · фон ${num(n.floorRaw)} → ${num(n.floorProc)} дБ · голос ${num(n.voice)} дБ · «${n.mic}»`);
  } else L.push('- не проверялся');
  L.push(`Сейчас выбрано: микрофон ${audioPrefs.mic === 'default' ? 'по умолчанию' : 'выбранный'}, вывод ${audioPrefs.out === 'default' ? 'по умолчанию' : 'выбранный'}, шумодав ${audioPrefs.ns}`);

  L.push('', 'ОШИБКИ');
  const errs = [...(d.errors || []).map((e) => ({ ...e, src: 'ядро' })), ...DIAG.errors.map((e) => ({ ...e, src: 'окно' }))]
    .sort((a, b) => a.at - b.at).slice(-15);
  for (const e of errs) L.push(`- ${ts(e.at)} [${e.src}] ${e.text}`);
  if (!errs.length) L.push('- нет');
  return L.join('\n');
}

async function start() {
  applyTheme(readTheme());
  wire();
  window.som.onEvent(onCoreEvent);
  window.som.onUpdate((st) => {
    const was = UPD?.status;
    renderUpdate(st);
    if (st.status === 'ready' && was !== 'ready') toast(`Скачано обновление Som ${st.ready}. Нажмите «Перезапустить» внизу слева, когда будет удобно.`, 'ok');
  });
  window.som.updateState().then((st) => st && renderUpdate(st)).catch(() => {});
  $('updateGo').addEventListener('click', () => window.som.updateRestart());
  $('updCheck').addEventListener('click', async () => {
    $('updCheck').disabled = true;
    try { renderUpdate(await window.som.updateCheck()); } finally { $('updCheck').disabled = false; }
  });
  window.som.onInvite((inv) => {
    if ($('shell').hidden) { S.pendingInvite = inv; return; } // профиля ещё нет — откроем после знакомства
    if ($('addDlg').open) $('addDlg').close();
    openAdd(inv);
  });
  const r = await window.som.init();
  S.net = r.net;
  S.profile = r.profile || 'main';
  if (!r.ok) {
    $('boot').textContent = `Ядро не запустилось: ${r.error || 'неизвестная ошибка'}`;
    return;
  }
  S.me = r.result;
  if (S.me.hasProfile) await enterShell();
  else { show('welcome'); $('welcomeName').focus(); }
}

start();
