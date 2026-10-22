import { showMenu, showPicker, closePopup, recordVoice, voiceEl, fmtSec } from './msgtools.js';
import { initCall, onSignal, onPresence, render as renderCall, audioPrefs, openMic, levelDb, applyDevices, micError, sinkFor, RINGS, ringId, previewRing } from './call.js';

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
  const theme = t === 'paper' ? 'paper' : 'graphite';
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('som.theme', theme); } catch { /* без памяти — не страшно */ }
  for (const b of document.querySelectorAll('[data-theme-pick]')) b.setAttribute('aria-pressed', String(b.dataset.themePick === theme));
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
function avatar(id, name, { size = '', online = null } = {}) {
  const el = h('div', { class: `avatar ${size}`.trim(), 'aria-hidden': 'true', text: initials(name) });
  el.style.background = colorFor(id); // стили через CSSOM разрешены политикой
  if (online !== null) el.append(h('span', { class: 'dot', dataset: { on: online ? '1' : '0' } }));
  return el;
}

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
function seenText(f) {
  if (f.online) return 'в сети';
  if (!f.lastSeen) return 'не в сети';
  return `последний раз в сети ${dayLabel(f.lastSeen).toLowerCase()} в ${fmtTime.format(new Date(f.lastSeen))}`;
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
  $('meAvatar').replaceChildren(avatar(me.id, me.name, { size: 'small' }));
  $('meName').textContent = me.name;
  $('meCode').textContent = me.code;
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
  return h('button', { class: 'row', type: 'button', 'aria-current': cur ? 'true' : 'false', onclick: () => selectFriend(f.id) },
    avatar(f.id, f.name, { online: f.online }),
    h('div', { class: 'row-main' }, h('div', { class: 'row-name', text: f.name }), h('div', { class: 'row-sub', text: sub })),
    side,
  );
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
  const online = friends.filter((f) => f.online);
  const offline = friends.filter((f) => !f.online);
  const parts = [];
  if (incoming.length) parts.push(h('div', { class: 'group-title', text: `Заявки — ${incoming.length}` }), ...incoming.map(requestCard));
  if (online.length) parts.push(h('div', { class: 'group-title', text: `В сети — ${online.length}` }), ...online.map(friendRow));
  if (offline.length) parts.push(h('div', { class: 'group-title', text: `Не в сети — ${offline.length}` }), ...offline.map(friendRow));
  if (outgoing.length) parts.push(h('div', { class: 'group-title', text: 'Ждут ответа' }), ...outgoing.map(friendRow));
  if (!parts.length) parts.push(h('div', { class: 'side-empty', text: 'Друзей пока нет. Нажмите «+», чтобы добавить.' }));
  list.replaceChildren(...parts);
  const unread = friends.reduce((n, f) => n + (f.unread || 0), 0) + incoming.length;
  document.title = unread ? `(${unread}) Som` : (S.profile === 'main' ? 'Som' : `Som — профиль ${S.profile}`);
}

function currentFriend() {
  return S.friends.find((f) => f.id === S.current) || null;
}

async function selectFriend(id) {
  if (S.current !== id) {
    if (S.compose) cancelCompose();
    closeSearch();
    closePopup();
    if (REC) finishVoice(false);
  }
  S.current = id;
  renderFriends();
  const f = currentFriend();
  if (f?.state === 'friend') {
    try { S.history.set(id, await call('history', { id, limit: 500 })); } catch (err) { toast(`История: ${err.message}`, 'bad'); }
    if (f.unread) call('read', { id }).catch(() => {});
  }
  renderChat({ scroll: true });
  if (f?.state === 'friend') $('composerInput').focus();
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
  $('chatAvatar').replaceChildren(avatar(f.id, f.name, { size: 'big', online: f.state === 'friend' ? f.online : null }));
  $('chatName').textContent = f.name;
  const status = $('chatStatus');
  status.dataset.on = f.online ? '1' : '0';
  status.textContent = f.state === 'friend' ? (isTyping(f.id) ? 'печатает…' : seenText(f)) : f.state === 'outgoing' ? (f.requestDelivered ? 'заявка доставлена' : 'заявка ждёт отправки') : 'заявка в друзья';
  const verify = $('chatVerify');
  verify.replaceChildren();
  if (f.groupCode) verify.append('Код чата', h('br'), h('b', { class: 'code', text: f.groupCode }));

  const isFriend = f.state === 'friend';
  $('messages').hidden = !isFriend;
  $('composer').hidden = !isFriend || Boolean(REC);
  $('composerNote').hidden = !isFriend;
  $('pendingPane').hidden = isFriend;
  if (isFriend) {
    // Ленту перерисовываем целиком только при смене чата: иначе прервётся играющая музыка или видео.
    if (scroll || S.renderedFor !== f.id) renderMessages(f, scroll);
    $('composerNote').textContent = f.online
      ? 'Шифрование MLS. Enter — отправить, Shift+Enter — новая строка.'
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

function messageEl(m, prev) {
  const same = prev && prev.dir === m.dir && m.at - prev.at < 5 * 60 * 1000;
  const meta = h('div', { class: 'meta' }, fmtTime.format(new Date(m.at)));
  if (m.edited && !m.deleted) meta.append(' · изменено');
  if (m.dir === 'out' && !m.deleted) meta.append(' · ', h('span', { class: 'st', dataset: { st: m.status }, text: STATUS[m.status] || m.status }));
  let body;
  if (m.deleted) body = h('div', { class: 'bubble deleted', text: 'Сообщение удалено' });
  else if (m.file) body = attachmentEl(m);
  else body = h('div', { class: 'bubble' }, m.reply ? quoteEl(m.reply) : null, h('span', { class: 'txt', text: m.text }));
  const wrap = h('div', { class: `msg ${m.dir}${same ? ' same' : ''}`, dataset: { mid: m.id } },
    m.deleted ? null : actionsEl(m), body, reactionsEl(m), meta);
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
  const confirmDelete = (everyone) => showMenu(x, y, [
    { label: everyone ? 'Да, удалить у обоих' : 'Да, удалить у меня', danger: true, onclick: () => deleteMsg(m, everyone) },
    { label: 'Отмена', onclick: () => {} },
  ]);
  showMenu(x, y, m.deleted ? [
    { label: 'Убрать у меня', onclick: () => deleteMsg(m, false) },
  ] : [
    { label: 'Ответить', onclick: () => startReply(m) },
    m.text ? { label: 'Копировать текст', onclick: () => window.som.copy(m.text).then(() => toast('Текст скопирован.')) } : null,
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
let REC = null;
async function startVoice() {
  const f = currentFriend();
  if (!f || f.state !== 'friend' || REC) return;
  try {
    const rec = await recordVoice(openMic, levelDb, (db, sec) => {
      $('recTime').textContent = fmtSec(sec);
      $('recLevel').style.width = `${Math.max(4, Math.min(100, ((db + 60) / 60) * 100)).toFixed(0)}%`;
    });
    REC = { ...rec, friend: f.id };
    if (rec.note) toast(rec.note, 'bad');
    rec.auto.then(() => { if (REC && REC.friend === f.id) finishVoice(true); });
  } catch (err) {
    toast(micError(err), 'bad');
    return;
  }
  $('recTime').textContent = '0:00';
  $('recBar').hidden = false;
  $('composer').hidden = true;
  $('recSend').focus();
}
async function finishVoice(send) {
  const r = REC;
  if (!r) return;
  REC = null;
  $('recBar').hidden = true;
  $('composer').hidden = currentFriend()?.state !== 'friend';
  if (!send) { await r.cancel(); return; }
  const { blob, dur, wave } = await r.stop();
  if (dur < 0.8) { toast('Слишком короткое голосовое — не отправлено.'); return; }
  const res = await window.som.sendVoice(r.friend, new Uint8Array(await blob.arrayBuffer()), dur, wave);
  sendFilesResult(r.friend, [res]);
  $('composerInput').focus();
}

// ---------- Вложения ----------// ---------- Вложения ----------
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
  if (!list.length) parts.push(h('div', { class: 'day', text: `Это начало переписки с ${f.name}. Сверьте код чата — он должен совпасть у вас обоих.` }));
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
    const args = { id: f.id, text };
    if (S.compose?.mode === 'reply') args.reply = S.compose.m.id;
    const m = await call('send', args);
    input.value = '';
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

function openFriendInfo() {
  const f = currentFriend();
  if (!f) return;
  $('fdName').textContent = f.name;
  $('fdCode').textContent = f.code;
  $('fdGroup').textContent = f.groupCode || '—';
  $('fdAddr').textContent = f.addr;
  $('fdSeen').textContent = f.online ? 'сейчас' : (f.lastSeen ? `${dayLabel(f.lastSeen)}, ${fmtTime.format(new Date(f.lastSeen))}` : 'ещё не встречались');
  $('fdRemove').textContent = f.state === 'friend' ? 'Удалить из друзей' : 'Удалить заявку';
  $('friendDlg').showModal();
}

async function openSettings() {
  $('setName').value = S.me?.name || '';
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
      else if (f) toast(`${f.name}: ${msgPreview(ev.msg).slice(0, 120)}`);
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
      onPresence(ev.friend, ev.online); // список обновится событием friends
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
  for (const b of document.querySelectorAll('[data-theme-pick]')) b.addEventListener('click', () => applyTheme(b.dataset.themePick));
  $('setMic').addEventListener('change', (e) => { audioPrefs.mic = e.target.value; stopMicTest(); applyDevices(); });
  $('setOut').addEventListener('change', (e) => { audioPrefs.out = e.target.value; applyDevices(); });
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
    onCallEnd: (sum) => { DIAG.calls.push(sum); if (DIAG.calls.length > 10) DIAG.calls.shift(); saveDiag(); },
    call, toast, avatar, selectFriend, currentFriend,
    friendById: (id) => S.friends.find((f) => f.id === id) || null,
    me: () => S.me,
  });

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
  $('voiceBtn').addEventListener('click', startVoice);
  $('recCancel').addEventListener('click', () => finishVoice(false));
  $('recSend').addEventListener('click', () => finishVoice(true));
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
  input.addEventListener('keydown', (e) => {
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
