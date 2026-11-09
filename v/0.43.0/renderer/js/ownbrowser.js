// Мой браузер: вкладки, адресная строка, «Мои сайты». Видите только вы — Som никому о нём не сообщает.
// Страницы — в <webview> со своим разделом (главный процесс: «запоминать» — на диске, иначе только в памяти),
// без preload, в песочнице. «Мои сайты» и вкладки хранит ядро: зашифровано, переезжает с профилем.
// Плитки сайтов — буквой, без значков с сайтов: иначе стартовая страница сама ходила бы на эти сайты.

import { showMenu } from './msgtools.js';

let X = null; // { call, toast, onShow(on) }
let CFG = null; // { keep, temp, ua }
let B = null; // из ядра: { sites, tabs, active, remember }
const TABS = []; // { id, url, title, wv, ready, loading, part }
let ACTIVE = 0;
let EDIT = -1; // какой сайт правим в форме (-1 — новый)
let saveTimer = 0;
const TABS_MAX = 12;
const $ = (id) => document.getElementById(id);
const rid = () => Math.random().toString(36).slice(2, 10);
const cur = () => TABS[ACTIVE];

function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) e.append(kid);
  return e;
}

export async function initOwnBrowser(deps) {
  X = deps;
  try { CFG = await window.som.obConfig(); } catch { CFG = null; }
  $('obBtn').addEventListener('click', () => (isOwnBrowserOn() ? hideOwnBrowser() : showOwnBrowser()));
  $('obBack').addEventListener('click', back);
  $('obFwd').addEventListener('click', () => { const t = cur(); if (t?.ready && t.wv.canGoForward()) t.wv.goForward(); });
  $('obReload').addEventListener('click', () => { const t = cur(); if (t?.ready) t.wv.reload(); });
  $('obHome').addEventListener('click', () => navTab(cur(), ''));
  $('obForm').addEventListener('submit', (e) => { e.preventDefault(); go($('obUrl').value); });
  $('obUrl').addEventListener('focus', () => $('obUrl').select());
  $('obStar').addEventListener('click', toggleStar);
  $('obMore').addEventListener('click', (e) => { const r = e.currentTarget.getBoundingClientRect(); moreMenu(r.right - 240, r.bottom + 4); });
  $('obAdd').addEventListener('submit', (e) => { e.preventDefault(); saveForm(); });
  $('obAddCancel').addEventListener('click', closeForm);
  window.som.onObOpen?.((url) => { if (B && isWeb(url)) newTab(url); });
  window.addEventListener('keydown', onKey);
}

export const isOwnBrowserOn = () => $('obView').classList.contains('on');

export async function showOwnBrowser() {
  if (!CFG) { X.toast('Браузер недоступен в этой сборке.', 'bad'); return; }
  if (!B) await load();
  $('obView').classList.add('on');
  $('obBtn').setAttribute('aria-current', 'true');
  X.onShow?.(true);
  showTab(ACTIVE);
  if (!cur().url) setTimeout(() => $('obUrl').focus(), 0);
}

/** Спрятать (страницы живут дальше: видео и музыка не прерываются). */
export function hideOwnBrowser() {
  if (!isOwnBrowserOn()) return;
  $('obView').classList.remove('on');
  $('obBtn').removeAttribute('aria-current');
  X.onShow?.(false);
}

async function load() {
  try { B = await X.call('browser'); } catch (err) { B = { sites: [], tabs: [], active: 0, remember: true, block_ads: true }; X.toast(`Браузер: ${err.message}`, 'bad'); }
  // Сообщаем главному процессу, блокировать ли рекламу, до того как откроются страницы.
  window.som.obSetBlock?.(adsOn());
  const urls = B.remember && B.tabs.length ? B.tabs : [''];
  for (const u of urls) TABS.push(mkTab(u));
  ACTIVE = Math.min(B.active || 0, TABS.length - 1);
}

const adsOn = () => B?.block_ads !== false;

const mkTab = (url) => ({ id: rid(), url: url || '', title: '', wv: null, ready: false, loading: false, part: '' });
const isWeb = (u) => typeof u === 'string' && /^https?:\/\//i.test(u) && u.length <= 2048 && !/\s/.test(u);
function host(u) { try { return new URL(u).host; } catch { return ''; } }

/** Что набрали — адрес или поиск. Чужие схемы (javascript:, file:…) — только как поиск. */
function normalize(input) {
  const t = String(input || '').trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) return isWeb(t) ? t : null;
  if (/^(localhost|\d{1,3}(\.\d{1,3}){3})(:\d{1,5})?(\/\S*)?$/i.test(t)) return `http://${t}`;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(t) && /^[^\s/]+\.[^\s/.]{2,}(:\d{1,5})?(\/\S*)?$/.test(t)) return `https://${t}`;
  return `https://duckduckgo.com/?q=${encodeURIComponent(t)}`;
}
const partition = () => (B.remember ? CFG.keep : CFG.temp);

// ---------- Вкладки ----------
function ensureWv(t) {
  if (t.wv) return t.wv;
  const wv = document.createElement('webview');
  wv.className = 'ob-webview';
  t.part = partition();
  wv.setAttribute('partition', t.part);
  wv.setAttribute('useragent', CFG.ua);
  wv.setAttribute('allowpopups', '');
  wv.setAttribute('src', t.url || 'about:blank');
  t.wv = wv;
  t.ready = false;
  wv.addEventListener('dom-ready', () => { t.ready = true; if (t === cur()) renderBar(); });
  wv.addEventListener('did-start-loading', () => { t.loading = true; renderTabs(); if (t === cur()) $('obLoading').hidden = false; });
  wv.addEventListener('did-stop-loading', () => { t.loading = false; renderTabs(); if (t === cur()) { $('obLoading').hidden = true; renderBar(); } });
  wv.addEventListener('did-navigate', (e) => onNav(t, e.url));
  wv.addEventListener('did-navigate-in-page', (e) => { if (e.isMainFrame) onNav(t, e.url); });
  wv.addEventListener('page-title-updated', (e) => { t.title = String(e.title || '').slice(0, 200); renderTabs(); });
  wv.addEventListener('did-fail-load', (e) => {
    if (e.isMainFrame && e.errorCode !== -3 && t === cur()) X.toast(`Страница не открылась: ${e.errorDescription || e.errorCode}`, 'bad');
  });
  $('obWrap').append(wv);
  return wv;
}

function dropWv(t) {
  if (!t.wv) return;
  try { t.wv.stop(); } catch { /* ещё не готов */ }
  t.wv.remove();
  t.wv = null;
  t.ready = false;
  t.loading = false;
}

function onNav(t, url) {
  if (!isWeb(url)) return;
  t.url = url;
  if (t === cur()) renderBar();
  renderTabs();
  scheduleSave();
}

function showTab(i) {
  ACTIVE = Math.max(0, Math.min(i, TABS.length - 1));
  const t = cur();
  if (t.url) ensureWv(t);
  for (const x of TABS) x.wv?.classList.toggle('on', x === t && Boolean(x.url));
  $('obStart').hidden = Boolean(t.url);
  $('obLoading').hidden = !(t.url && t.loading);
  if (!t.url) renderSites();
  renderTabs();
  renderBar();
  scheduleSave();
}

function navTab(t, url) {
  if (!t) return;
  closeForm();
  if (!url) {
    // Домой: страница вкладки больше не нужна.
    dropWv(t);
    t.url = '';
    t.title = '';
  } else {
    t.url = url;
    t.title = '';
    if (t.wv) t.wv.src = url; else ensureWv(t);
  }
  showTab(TABS.indexOf(t));
}

function go(input) {
  const url = normalize(input);
  if (!url) { X.toast('Такой адрес не открыть.', 'bad'); return; }
  navTab(cur(), url);
  cur().wv?.focus();
}

function back() {
  const t = cur();
  if (!t?.url) return;
  if (t.ready && t.wv.canGoBack()) t.wv.goBack(); else navTab(t, ''); // с первой страницы — к «Моим сайтам»
}

function newTab(url = '') {
  if (TABS.length >= TABS_MAX) { X.toast(`Не больше ${TABS_MAX} вкладок — закройте лишние.`, 'bad'); return; }
  TABS.push(mkTab(url));
  showTab(TABS.length - 1);
  if (!url) setTimeout(() => $('obUrl').focus(), 0);
}

function closeTab(i) {
  const t = TABS[i];
  if (!t) return;
  dropWv(t);
  TABS.splice(i, 1);
  if (!TABS.length) TABS.push(mkTab(''));
  showTab(i < ACTIVE ? ACTIVE - 1 : Math.min(ACTIVE, TABS.length - 1));
}

function renderTabs() {
  const box = $('obTabs');
  const kids = TABS.map((t, i) => {
    const title = t.title || (t.url ? host(t.url) : '') || 'Мои сайты';
    const x = el('button', { type: 'button', class: 'x', title: 'Закрыть вкладку (Ctrl+W)', 'aria-label': 'Закрыть вкладку', text: '✕', onclick: (e) => { e.stopPropagation(); closeTab(i); } });
    return el('div', {
      class: 'ob-tab', role: 'tab', tabindex: '0', 'aria-selected': String(i === ACTIVE), title: t.url || 'Мои сайты',
      onclick: () => showTab(i),
      onauxclick: (e) => { if (e.button === 1) { e.preventDefault(); closeTab(i); } },
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showTab(i); } },
    }, t.loading ? el('span', { class: 'dot' }) : null, el('span', { class: 't', text: title }), x);
  });
  kids.push(el('button', { type: 'button', class: 'ob-new', title: 'Новая вкладка (Ctrl+T)', 'aria-label': 'Новая вкладка', text: '+', onclick: () => newTab() }));
  box.replaceChildren(...kids);
}

function renderBar() {
  const t = cur();
  if (!t) return;
  if (document.activeElement !== $('obUrl')) $('obUrl').value = t.url;
  $('obBack').disabled = !t.url;
  $('obFwd').disabled = !(t.ready && t.wv?.canGoForward());
  $('obReload').disabled = !t.url;
  const saved = Boolean(t.url) && B.sites.some((s) => s.url === t.url);
  $('obStar').disabled = !t.url;
  $('obStar').setAttribute('aria-pressed', String(saved));
  $('obStar').title = saved ? 'Убрать из «Моих сайтов»' : 'Добавить в «Мои сайты»';
}

function scheduleSave() {
  if (!B?.remember) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { X.call('browser_set', { tabs: TABS.map((t) => t.url), active: ACTIVE }).catch(() => {}); }, 1200);
}

// ---------- Мои сайты ----------
function tint(s) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.codePointAt(0)) % 360;
  return `hsl(${h} 38% 42%)`;
}

function renderSites() {
  const box = $('obSites');
  const tiles = B.sites.map((s, i) => {
    const letter = ([...s.name.trim()][0] || '?').toUpperCase();
    const more = el('button', { type: 'button', class: 'more', title: 'Ещё', 'aria-label': `Ещё: ${s.name}`, text: '⋯', onclick: (e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); siteMenu(i, r.left, r.bottom + 4); } });
    const ava = el('span', { class: 'ava', text: letter });
    ava.style.background = tint(host(s.url) || s.name);
    return el('div', {
      class: 'ob-site', role: 'button', tabindex: '0', title: s.url,
      onclick: () => navTab(cur(), s.url),
      onauxclick: (e) => { if (e.button === 1) { e.preventDefault(); newTab(s.url); } },
      onkeydown: (e) => { if (e.key === 'Enter') navTab(cur(), s.url); },
      oncontextmenu: (e) => { e.preventDefault(); siteMenu(i, e.clientX, e.clientY); },
    }, more, ava, el('span', { class: 'n', text: s.name }), el('span', { class: 'h', text: host(s.url) }));
  });
  tiles.push(el('button', { type: 'button', class: 'ob-site add', onclick: () => openForm(-1) }, el('span', { class: 'ava', text: '+' }), el('span', { class: 'n', text: 'Добавить сайт' })));
  box.replaceChildren(...tiles);
}

function siteMenu(i, x, y) {
  const s = B.sites[i];
  if (!s) return;
  showMenu(x, y, [
    { label: 'Открыть в новой вкладке', onclick: () => newTab(s.url) },
    { label: 'Изменить', onclick: () => openForm(i) },
    i > 0 ? { label: 'Переставить левее', onclick: () => moveSite(i, -1) } : null,
    i < B.sites.length - 1 ? { label: 'Переставить правее', onclick: () => moveSite(i, 1) } : null,
    { label: 'Удалить', danger: true, onclick: () => { B.sites.splice(i, 1); saveSites(); } },
  ]);
}

function moveSite(i, d) {
  const [s] = B.sites.splice(i, 1);
  B.sites.splice(i + d, 0, s);
  saveSites();
}

function openForm(i, preset = null) {
  EDIT = i;
  const s = i >= 0 ? B.sites[i] : preset || { name: '', url: '' };
  $('obAddName').value = s.name;
  $('obAddUrl').value = s.url;
  $('obAddErr').hidden = true;
  $('obAddGo').textContent = i >= 0 ? 'Сохранить' : 'Добавить';
  $('obAdd').hidden = false;
  (s.url ? $('obAddName') : $('obAddUrl')).focus();
}

function closeForm() {
  $('obAdd').hidden = true;
  EDIT = -1;
}

function saveForm() {
  const raw = $('obAddUrl').value.trim();
  const url = normalize(raw);
  const err = (t) => { $('obAddErr').textContent = t; $('obAddErr').hidden = false; };
  if (!raw) { err('Впишите адрес сайта.'); return; }
  if (!url || url.startsWith('https://duckduckgo.com/?q=') && !/duckduckgo/i.test(raw)) { err('Это не похоже на адрес сайта. Пример: forum.ru или https://forum.ru/раздел'); return; }
  const name = $('obAddName').value.trim().slice(0, 60) || host(url);
  if (EDIT >= 0 && B.sites[EDIT]) B.sites[EDIT] = { name, url }; else B.sites.push({ name, url });
  closeForm();
  saveSites();
}

function saveSites() {
  X.call('browser_set', { sites: B.sites })
    .then((b) => { B.sites = b.sites; })
    .catch((err) => X.toast(err.message, 'bad'))
    .finally(() => { if (!cur()?.url) renderSites(); renderBar(); });
}

function toggleStar() {
  const t = cur();
  if (!t?.url) return;
  const i = B.sites.findIndex((s) => s.url === t.url);
  if (i >= 0) { B.sites.splice(i, 1); X.toast('Убрано из «Моих сайтов».'); } else { B.sites.push({ name: (t.title || host(t.url)).slice(0, 60), url: t.url }); X.toast('Добавлено в «Мои сайты».'); }
  saveSites();
}

// ---------- Ещё ----------
async function moreMenu(x, y) {
  const t = cur();
  let n = 0;
  try { n = (await window.som.obBlocked?.()) || 0; } catch { /* не важно */ }
  showMenu(x, y, [
    {
      label: `${adsOn() ? '✓ ' : ''}Блокировать рекламу`,
      sub: adsOn() ? (n ? `с запуска Som закрыто: ${n}` : 'реклама и следящие домены отсекаются') : 'сейчас реклама не блокируется',
      onclick: toggleAds,
    },
    {
      label: `${B.remember ? '✓ ' : ''}Запоминать вход и вкладки`,
      sub: B.remember ? 'вход на сайтах и вкладки хранятся на этом ПК' : 'сейчас всё забывается при выходе из Som',
      onclick: toggleRemember,
    },
    t?.url ? { label: 'Копировать адрес', onclick: () => navigator.clipboard.writeText(t.url).then(() => X.toast('Адрес скопирован.')).catch(() => {}) } : null,
    t?.url ? { label: 'Открыть в обычном браузере', onclick: () => window.som.openLink(t.url) } : null,
    { label: 'Стереть данные браузера', sub: 'вход на сайтах, куки, кэш и вкладки', danger: true, onclick: clearAll },
  ]);
}

/** Включили/выключили блокировку рекламы: сохраняем в ядре, сообщаем главному процессу, перезагружаем страницу. */
async function toggleAds() {
  const on = !adsOn();
  try {
    await window.som.obSetBlock?.(on);
    B = { ...B, ...(await X.call('browser_set', { block_ads: on })) };
  } catch (err) { X.toast(err.message, 'bad'); return; }
  const t = cur();
  if (t?.ready) t.wv.reload();
  X.toast(on ? 'Реклама блокируется. Перезагрузите страницу, если нужно.' : 'Блокировка рекламы выключена.');
}

/** Сменили «запоминать»: страницы открываем заново в другом разделе. Выключили — стираем запомненное. */
async function toggleRemember() {
  const on = !B.remember;
  try {
    if (!on) await window.som.obClear();
    B = { ...B, ...(await X.call('browser_set', { remember: on, tabs: TABS.map((t) => t.url), active: ACTIVE })) };
  } catch (err) { X.toast(err.message, 'bad'); return; }
  for (const t of TABS) dropWv(t);
  showTab(ACTIVE);
  X.toast(on ? 'Запоминаю вход на сайтах и вкладки на этом ПК.' : 'Больше не запоминаю: вход на сайтах стёрт, вкладки забудутся при выходе из Som.');
}

async function clearAll() {
  try { await window.som.obClear(); } catch { /* стираем, что можем */ }
  for (const t of TABS) dropWv(t);
  TABS.splice(0, TABS.length, mkTab(''));
  showTab(0);
  X.call('browser_set', { tabs: [''], active: 0 }).catch(() => {});
  X.toast('Данные браузера стёрты: вход на сайтах, куки, кэш и вкладки.');
}

function onKey(e) {
  if (!isOwnBrowserOn() || document.querySelector('dialog[open]')) return;
  const k = e.key.toLowerCase();
  if (e.ctrlKey && !e.shiftKey && (k === 't' || k === 'е')) { e.preventDefault(); newTab(); }
  else if (e.ctrlKey && (k === 'w' || k === 'ц')) { e.preventDefault(); closeTab(ACTIVE); }
  else if (e.ctrlKey && (k === 'l' || k === 'д')) { e.preventDefault(); $('obUrl').focus(); }
  else if (e.key === 'F5') { e.preventDefault(); const t = cur(); if (t?.ready) t.wv.reload(); }
  else if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); back(); }
  else if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); const t = cur(); if (t?.ready && t.wv.canGoForward()) t.wv.goForward(); }
}
