// Общий браузер: у каждого своя страница, но они синхронизируются — адрес, прокрутка, пауза и
// перемотка видео. Хозяина нет: кто угодно листает и открывает ссылки, вышел один — у остальных
// работает дальше. Внутри не видно, кто что открыл: вместо имён — случайная метка на один сеанс.
//
// Синхронизация без сервера: у адреса есть счётчик (seq) и метка (by); выигрывает больший seq,
// при равенстве — большая метка. Так два одновременных перехода у всех сходятся к одному.

let X = null;
let CFG = null;
let SB = null; // открытый у меня браузер { id, wv, ... }
const SEEN = new Map(); // chatId → Map(by → at): кто держит браузер открытым (для значка и счётчика)
const PRESENCE_MS = 9000;
const STALE_MS = 24000;
const $ = (id) => document.getElementById(id);
const rid = () => [...crypto.getRandomValues(new Uint8Array(6))].map((x) => x.toString(16).padStart(2, '0')).join('');

const QUICK = [
  { name: 'DuckDuckGo', url: 'https://duckduckgo.com/' },
  { name: 'Википедия', url: 'https://ru.wikipedia.org/' },
  { name: 'YouTube', url: 'https://www.youtube.com/' },
  { name: 'Twitch', url: 'https://www.twitch.tv/' },
];

export async function initSharedBrowser(deps) {
  X = deps;
  try { CFG = await window.som.sbConfig(); } catch { CFG = null; }
  $('sbBtn').addEventListener('click', () => { const f = X.currentFriend(); if (sbAllowed(f)) (SB && SB.id === f.id ? close() : open(f.id)); });
  $('sbClose').addEventListener('click', () => close());
  $('sbExpand').addEventListener('click', () => setExpanded(!(SB && SB.expanded)));
  $('sbReload').addEventListener('click', () => { if (SB?.wv) SB.wv.reload(); });
  $('sbBack').addEventListener('click', () => { if (SB?.wv?.canGoBack()) SB.wv.goBack(); });
  $('sbFwd').addEventListener('click', () => { if (SB?.wv?.canGoForward()) SB.wv.goForward(); });
  $('sbForm').addEventListener('submit', (e) => { e.preventDefault(); go($('sbUrl').value); });
  $('sbJoinBtn').addEventListener('click', () => { const f = X.currentFriend(); if (sbAllowed(f)) open(f.id); });
  const quick = $('sbQuick');
  for (const q of QUICK) quick.append(el('button', { type: 'button', class: 'sb-quick-btn', text: q.name, onclick: () => go(q.url) }));
  // Устаревшие метки присутствия гаснут сами — обновляем значок.
  setInterval(() => { let ch = false; for (const [cid, m] of SEEN) { for (const [by, at] of m) if (Date.now() - at > STALE_MS) { m.delete(by); ch = true; } if (!m.size) SEEN.delete(cid); } if (ch) renderButton(); }, 5000);
  window.addEventListener('beforeunload', () => { if (SB) sig({ kind: 'bye', by: SB.by }); });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && SB?.expanded && !document.querySelector('dialog[open]')) { e.preventDefault(); setExpanded(false); }
  });
}

function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) e.append(kid);
  return e;
}

const sbAllowed = (f) => Boolean(f) && (f.state === 'friend' || (f.state === 'group' && !f.groupState));
export const active = () => Boolean(SB);
export const current = () => SB;

function sig(data) {
  if (!SB) return;
  X.call('sb_signal', { id: SB.id, data: { ...data, room: SB.room } }).catch(() => {});
}

// ---------- Открыть / закрыть ----------
function room(cid) {
  const m = SEEN.get(cid);
  if (!m) return null;
  const now = Date.now();
  for (const [by, at] of m) if (now - at > STALE_MS) m.delete(by);
  if (!m.size) { SEEN.delete(cid); return null; }
  return m;
}

async function open(cid) {
  if (!CFG) { X.toast('Общий браузер недоступен в этой сборке.', 'bad'); return; }
  if (SB) close();
  const r = room(cid);
  SB = {
    id: cid, by: rid(), room: r ? '' : rid(), wv: null, ready: false, expanded: false,
    navSeq: 0, navBy: '', clock: 0, url: '', applyingNav: false, hbTimer: 0,
  };
  $('sbPanel').hidden = false;
  $('chatView').classList.add('sb-open');
  X.onSbOpen?.();
  buildWebview();
  // Поздороваться: кто уже здесь — пришлёт текущий адрес, его и откроем.
  sig({ kind: 'hello', by: SB.by });
  sig({ kind: 'here', by: SB.by });
  SB.hbTimer = setInterval(() => sig({ kind: 'here', by: SB.by }), PRESENCE_MS);
  // Если через 1,5 с никто не ответил — показываем стартовую страницу.
  setTimeout(() => { if (SB && !SB.url) showHome(true); }, 1500);
  render();
  X.sound?.('streamOn');
}

export function close(quiet = false) {
  if (!SB) return;
  const sb = SB;
  if (!quiet) sig({ kind: 'bye', by: sb.by });
  SB = null;
  clearInterval(sb.hbTimer);
  if (sb.wv) { try { sb.wv.stop(); } catch { /* уже */ } sb.wv.remove(); }
  $('sbWrap').replaceChildren();
  $('sbPanel').hidden = true;
  $('chatView').classList.remove('sb-expanded', 'sb-open');
  window.som.sbClear?.().catch?.(() => {});
  SEEN.get(sb.id)?.delete(sb.by);
  X.onSbOpen?.();
  renderButton();
  if (!quiet) X.sound?.('streamOff');
}

function buildWebview() {
  const wv = document.createElement('webview');
  wv.className = 'sb-webview';
  wv.setAttribute('partition', CFG.partition);
  wv.setAttribute('preload', CFG.preload);
  wv.setAttribute('useragent', CFG.ua);
  wv.setAttribute('src', 'about:blank');
  $('sbWrap').replaceChildren(wv);
  SB.wv = wv;
  wv.addEventListener('dom-ready', () => { SB.ready = true; render(); });
  wv.addEventListener('did-start-loading', () => { $('sbLoading').hidden = false; });
  wv.addEventListener('did-stop-loading', () => { $('sbLoading').hidden = true; render(); });
  wv.addEventListener('did-navigate', (e) => onNavigated(e.url));
  wv.addEventListener('did-navigate-in-page', (e) => { if (e.isMainFrame) onNavigated(e.url); });
  wv.addEventListener('did-fail-load', (e) => { if (e.isMainFrame && e.errorCode !== -3) X.toast(`Страница не открылась: ${e.errorDescription || e.errorCode}`, 'bad'); });
  wv.addEventListener('ipc-message', (e) => { if (e.channel === 'sb') onGuest(e.args[0]); });
}

function showHome(on) {
  $('sbHome').hidden = !on;
  $('sbWrap').hidden = on;
}

// ---------- Переходы ----------
function normalize(input) {
  const t = String(input || '').trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) return t;
  if (/^[^\s.]+\.[^\s]{2,}(\/.*)?$/.test(t) && !t.includes(' ')) return `https://${t}`;
  return `https://duckduckgo.com/?q=${encodeURIComponent(t)}`;
}
function go(input) {
  const url = normalize(input);
  if (!url || !SB?.wv) return;
  showHome(false);
  navLocal(url);
  SB.wv.loadURL(url).catch(() => {});
}
/** Локальный переход: поднимаем счётчик и рассылаем всем. */
function navLocal(url) {
  SB.clock += 1;
  SB.navSeq = SB.clock;
  SB.navBy = SB.by;
  SB.url = url;
  sig({ kind: 'nav', seq: SB.navSeq, by: SB.by, url });
}
function onNavigated(url) {
  if (!SB) return;
  if (url && url !== 'about:blank') showHome(false);
  $('sbUrl').value = url === 'about:blank' ? '' : url;
  if (SB.applyingNav) { SB.applyingNav = false; SB.url = url; render(); return; }
  if (url && url !== 'about:blank' && url !== SB.url) navLocal(url);
  render();
}

// ---------- От страницы (preload) ----------
function onGuest(msg) {
  if (!SB || !msg) return;
  if (msg.kind === 'scroll' || msg.kind === 'media') sig(msg); // свои прокрутка/видео — друзьям
}

// ---------- От друзей ----------
export function onSignal(id, data) {
  if (!data || typeof data !== 'object') return;
  const by = typeof data.by === 'string' ? data.by.slice(0, 16) : '';
  // Присутствие — для значка и счётчика, даже когда браузер не открыт.
  if (by && (data.kind === 'here' || data.kind === 'hello' || data.kind === 'nav')) {
    let m = SEEN.get(id); if (!m) { m = new Map(); SEEN.set(id, m); }
    m.set(by, Date.now());
  }
  if (data.kind === 'bye' && by) { SEEN.get(id)?.delete(by); if (!SEEN.get(id)?.size) SEEN.delete(id); }
  if (!SB || SB.id !== id) { renderButton(); return; }
  if (by === SB.by) return;
  switch (data.kind) {
    case 'hello':
      // Новичок поздоровался — шлём ему текущий адрес (если он у нас есть).
      if (SB.url) sig({ kind: 'cur', by: SB.by, seq: SB.navSeq, navBy: SB.navBy, url: SB.url });
      break;
    case 'cur':
      if (!SB.url) adoptNav(data);
      break;
    case 'nav':
      adoptNav(data);
      break;
    case 'scroll':
    case 'media':
      SB.wv?.send('sb-apply', data);
      break;
    case 'bye':
      break;
    default:
  }
  render();
}

/** Принять чужой адрес, если он «новее»: больше seq, при равенстве — больше метки. */
function adoptNav(data) {
  const seq = Number(data.seq) || 0;
  const nb = String(data.navBy || data.by || '');
  const url = typeof data.url === 'string' && /^https?:\/\//i.test(data.url) && data.url.length < 4000 ? data.url : null;
  if (!url || !SB.wv) return;
  const newer = seq > SB.navSeq || (seq === SB.navSeq && nb > SB.navBy);
  if (!newer && SB.url) return;
  SB.navSeq = seq;
  SB.navBy = nb;
  SB.clock = Math.max(SB.clock, seq);
  if (url !== SB.url) {
    SB.url = url;
    SB.applyingNav = true;
    showHome(false);
    SB.wv.loadURL(url).catch(() => {});
  }
}

// ---------- Отрисовка ----------
function setExpanded(on) {
  if (!SB) return;
  SB.expanded = on;
  $('chatView').classList.toggle('sb-expanded', on);
  $('sbExpand').setAttribute('aria-pressed', String(on));
}
function render() {
  if (!SB) return;
  const wv = SB.wv;
  $('sbBack').disabled = !(wv && SB.ready && wv.canGoBack());
  $('sbFwd').disabled = !(wv && SB.ready && wv.canGoForward());
  const r = room(SB.id);
  const n = (r ? r.size : 0) + 1;
  $('sbPresence').textContent = n > 1 ? `${n} смотрят · анонимно` : 'только вы';
  renderButton();
}
function renderButton() {
  const f = X.currentFriend();
  const btn = $('sbBtn');
  const bar = $('sbJoin');
  if (!sbAllowed(f)) { btn.hidden = true; bar.hidden = true; return; }
  btn.hidden = false;
  const open = SB && SB.id === f.id;
  const r = !open && room(f.id);
  btn.setAttribute('aria-pressed', String(Boolean(open)));
  btn.classList.toggle('live', Boolean(r));
  btn.title = open ? 'Закрыть общий браузер' : r ? `Друзья открыли общий браузер (${r.size}) — присоединиться` : 'Общий браузер — смотреть вместе';
  // Кто-то уже смотрит — плашка над перепиской (без имён: просто сколько человек).
  bar.hidden = Boolean(open) || !r;
  if (r) $('sbJoinText').textContent = f.state === 'group' ? `Общий браузер открыт · смотрят: ${r.size}` : 'Друг открыл общий браузер';
}

/** Текущий чат сменился — кнопку перерисовать; браузер остаётся привязан к своему чату. */
export function onChatChange() {
  renderButton();
  if (!SB) return;
  const here = SB.id === X.currentFriend()?.id;
  $('sbPanel').hidden = !here;
  if ($('chatView').classList.contains('sb-open') !== here) {
    $('chatView').classList.toggle('sb-open', here);
    if (!here) $('chatView').classList.remove('sb-expanded');
    else if (SB.expanded) $('chatView').classList.add('sb-expanded');
    X.onSbOpen?.();
  }
}
