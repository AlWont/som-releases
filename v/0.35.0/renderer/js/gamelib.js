// «Мои игры»: библиотека всего, что установлено на ПК, — с обложками, поиском и запуском в один щелчок.
// Список собирает главный процесс (gamelib.cjs); окно знает только id и название — запускает по id главный процесс.

const $ = (id) => document.getElementById(id);
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style') el.style.cssText = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
  return el;
}

const SRC = { steam: 'Steam', epic: 'Epic Games', gog: 'GOG', ubi: 'Ubisoft', my: 'Свои' };
let X = { toast: () => {}, menu: () => {}, invite: null, canInvite: () => false };
const L = { games: [], sources: [], hiddenCount: 0, tab: 'all', sort: 'recent', q: '', showHidden: false, loading: false };

function pref(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } }
function setPref(k, v) { try { localStorage.setItem(k, v); } catch { /* не страшно */ } }

const plural = (n, one, few, many) => { const a = n % 10; const b = n % 100; return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many; };
function playtime(min) {
  if (!min) return '';
  if (min < 60) return `${min} мин`;
  const hrs = Math.round(min / 6) / 10;
  return `${hrs >= 10 ? Math.round(hrs) : hrs.toLocaleString('ru-RU')} ч`;
}
function ago(ts) {
  if (!ts) return '';
  const d = Math.floor((startOfDay(Date.now()) - startOfDay(ts)) / 86400000);
  if (d <= 0) return 'сегодня';
  if (d === 1) return 'вчера';
  if (d < 7) return `${d} ${plural(d, 'день', 'дня', 'дней')} назад`;
  if (d < 60) { const w = Math.round(d / 7); return `${w} ${plural(w, 'неделю', 'недели', 'недель')} назад`; }
  return new Date(ts).toLocaleDateString('ru-RU', { month: 'short', year: 'numeric' });
}
function startOfDay(ts) { const x = new Date(ts); x.setHours(0, 0, 0, 0); return x.getTime(); }
function gb(bytes) { return bytes ? `${(bytes / 1024 ** 3).toLocaleString('ru-RU', { maximumFractionDigits: bytes > 10 * 1024 ** 3 ? 0 : 1 })} ГБ` : ''; }
function hue(s) { let x = 0; for (const c of s) x = (x * 31 + c.codePointAt(0)) % 360; return x; }
function initials(name) { return name.replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '🎮'; }

function sorted(list) {
  const by = {
    recent: (a, b) => (b.played || 0) - (a.played || 0) || a.name.localeCompare(b.name, 'ru'),
    name: (a, b) => a.name.localeCompare(b.name, 'ru'),
    time: (a, b) => (b.minutes || 0) - (a.minutes || 0) || a.name.localeCompare(b.name, 'ru'),
    size: (a, b) => (b.size || 0) - (a.size || 0) || a.name.localeCompare(b.name, 'ru'),
  }[L.sort] || ((a, b) => a.name.localeCompare(b.name, 'ru'));
  return [...list].sort(by);
}
function visible() {
  const q = L.q.trim().toLowerCase();
  return sorted(L.games.filter((g) => (L.showHidden ? g.hidden : !g.hidden) && (L.tab === 'all' || g.src === L.tab) && (!q || g.name.toLowerCase().includes(q))));
}

// ---------- Плитка ----------
function art(g) {
  const fb = h('div', { class: 'gl-fb', style: `--h:${hue(g.name)}` }, h('b', { text: initials(g.name) }), h('span', { text: g.name }));
  const img = h('img', { alt: '', loading: 'lazy', decoding: 'async', src: g.cover, draggable: 'false' });
  const box = h('div', { class: 'gl-art' }, fb, img);
  img.addEventListener('load', () => {
    // Значок программы вместо обложки — маленький: рисуем его поверх цветной плитки.
    if (img.naturalWidth <= 96) { box.classList.add('icon'); fb.prepend(img); return; }
    box.classList.add('ok');
    // Широкая шапка вместо вертикальной обложки: целиком посередине, а за ней — она же, размытая.
    if (img.naturalWidth / img.naturalHeight > 1.2) { box.classList.add('wide'); box.prepend(h('img', { class: 'gl-blur', alt: '', src: img.src, draggable: 'false' })); }
  });
  img.addEventListener('error', () => img.remove());
  return box;
}
function sub(g) {
  return [playtime(g.minutes), g.played ? ago(g.played) : '', L.sort === 'size' ? gb(g.size) : ''].filter(Boolean).join(' · ') || (g.ready ? SRC[g.src] : 'не установлена до конца');
}
function playBadge() {
  const b = h('span', { class: 'gl-play', 'aria-hidden': 'true' });
  b.innerHTML = '<svg class="ic fill" viewBox="0 0 24 24" aria-hidden="true"><polygon points="7 4 20 12 7 20 7 4"/></svg>Играть';
  return b;
}
function tile(g) {
  const t = h('div', { class: 'gl-tile', role: 'listitem', tabindex: '0', dataset: { id: g.id, src: g.src }, title: g.ready ? `Играть в «${g.name}»` : `«${g.name}» ещё качается или обновляется`, 'aria-label': g.name },
    h('div', { class: 'gl-cover' },
      art(g),
      h('span', { class: 'gl-badge', text: SRC[g.src] }),
      playBadge()),
    h('div', { class: 'gl-meta' },
      h('span', { class: 'gl-name', text: g.name }),
      h('span', { class: 'gl-sub', text: sub(g) })),
    h('button', { type: 'button', class: 'gl-more icon-btn', title: 'Ещё', 'aria-label': `Действия с «${g.name}»`, text: '⋯', onclick: (e) => { e.stopPropagation(); menu(g, e.currentTarget); } }));
  t.addEventListener('click', () => launch(g));
  t.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); launch(g); } if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); menu(g, t); } });
  t.addEventListener('contextmenu', (e) => { e.preventDefault(); X.menu(e.clientX, e.clientY, items(g)); });
  return t;
}

async function launch(g) {
  if (L.showHidden) return;
  const t = document.querySelector(`.gl-tile[data-id="${g.id}"]`);
  t?.classList.add('starting');
  const r = await window.som.gamelib.launch(g.id).catch((err) => ({ ok: false, error: err.message }));
  setTimeout(() => t?.classList.remove('starting'), 1800);
  if (!r?.ok) { X.toast(`Не запустилось: ${r?.error || 'неизвестная ошибка'}`, 'bad'); return; }
  X.toast(`Запускаю «${r.name || g.name}»…`, 'ok', 3000);
  g.played = Date.now();
  if (pref('som.gl.close', '1') === '1') $('gameLibDlg').close();
}

function items(g) {
  return [
    !L.showHidden ? { label: 'Играть', onclick: () => launch(g) } : null,
    X.canInvite() && !L.showHidden ? { label: 'Позвать друга в эту игру', sub: 'приглашение в открытый чат', onclick: () => { $('gameLibDlg').close(); X.invite?.({ name: g.name, steam: g.appid || undefined }); } } : null,
    g.src === 'steam' ? { label: 'Страница в Steam', onclick: () => window.som.games.steamStore(g.appid) } : null,
    g.hasDir ? { label: 'Открыть папку игры', onclick: async () => { if (!(await window.som.gamelib.openDir(g.id))) X.toast('Папка не найдена.', 'bad'); } } : null,
    { label: 'Переименовать', onclick: () => rename(g) },
    { label: 'Сменить обложку…', onclick: async () => { if (await window.som.gamelib.cover(g.id)) await load(false); } },
    g.custom ? { label: 'Убрать из библиотеки', danger: true, onclick: () => hide(g, true) }
      : g.hidden ? { label: 'Вернуть в список', onclick: () => hide(g, false) }
        : { label: 'Скрыть из списка', sub: 'игра останется на ПК', onclick: () => hide(g, true) },
  ];
}
function menu(g, anchor) {
  const r = anchor.getBoundingClientRect();
  X.menu(r.left, r.bottom + 4, items(g));
}
async function hide(g, on) {
  await window.som.gamelib.hide(g.id, on);
  if (g.custom && on) L.games = L.games.filter((x) => x.id !== g.id);
  else { g.hidden = on; L.hiddenCount += on ? 1 : -1; }
  if (!L.hiddenCount) L.showHidden = false;
  render();
}
function rename(g) {
  const t = document.querySelector(`.gl-tile[data-id="${g.id}"] .gl-name`);
  if (!t) return;
  const input = h('input', { type: 'text', class: 'gl-rename', maxlength: '60', value: g.name, 'aria-label': 'Название игры' });
  t.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = async (ok) => {
    if (done) return;
    done = true;
    const name = input.value.trim();
    if (ok && name && name !== g.name && await window.som.gamelib.rename(g.id, name)) g.name = name;
    render();
  };
  input.addEventListener('click', (e) => e.stopPropagation());
  input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') finish(true); if (e.key === 'Escape') { e.preventDefault(); finish(false); } });
  input.addEventListener('blur', () => finish(true));
}

// ---------- Окно ----------
function renderTabs() {
  const tabs = ['all', ...['steam', 'epic', 'gog', 'ubi', 'my'].filter((s) => L.sources.includes(s))];
  if (!tabs.includes(L.tab)) L.tab = 'all';
  const count = (s) => L.games.filter((g) => !g.hidden && (s === 'all' || g.src === s)).length;
  $('glTabs').replaceChildren(...(tabs.length > 2 ? tabs : ['all']).map((s) => h('button', {
    type: 'button', role: 'tab', 'aria-selected': String(L.tab === s && !L.showHidden),
    onclick: () => { L.tab = s; L.showHidden = false; render(); },
  }, s === 'all' ? 'Все' : SRC[s], h('span', { class: 'gl-n', text: String(count(s)) }))));
}
function render() {
  renderTabs();
  const list = visible();
  const total = L.games.filter((g) => !g.hidden).length;
  $('glCount').textContent = L.loading && !L.games.length ? '' : String(total);
  $('glGrid').replaceChildren(...list.map(tile));
  const empty = $('glEmpty');
  empty.hidden = Boolean(list.length) || L.loading;
  if (!list.length) {
    empty.textContent = L.q ? `Ничего не нашлось по «${L.q}».`
      : L.showHidden ? 'Скрытых игр нет.'
        : 'Игр не нашлось. Som сам находит игры Steam, Epic Games, GOG Galaxy и Ubisoft Connect. Остальные добавьте кнопкой «Добавить игру…» — подойдёт .exe игры или её ярлык (например, с рабочего стола).';
  }
  $('glLoading').hidden = !L.loading || Boolean(L.games.length);
  const hb = $('glShowHidden');
  hb.hidden = !L.hiddenCount;
  hb.textContent = L.showHidden ? '← Ко всем играм' : `Скрытые (${L.hiddenCount})`;
}
async function load(refresh) {
  L.loading = true;
  render();
  const r = await window.som.gamelib.list({ refresh, hidden: true }).catch(() => null);
  L.loading = false;
  if (r) { L.games = r.games; L.sources = r.sources; L.hiddenCount = r.hiddenCount; }
  render();
}

/** Открыть «Мои игры». */
export function openGameLib() {
  const dlg = $('gameLibDlg');
  if (!dlg.open) dlg.showModal();
  $('glSearch').value = L.q;
  $('glSort').value = L.sort;
  render();
  load(false);
  setTimeout(() => $('glSearch').focus(), 30);
}
/** Для главной: игры, в которые играли последними (или просто первые из библиотеки). */
export async function recentGames(n = 4) {
  if (!L.games.length) { const r = await window.som.gamelib.list({}).catch(() => null); if (r) { L.games = r.games; L.sources = r.sources; L.hiddenCount = r.hiddenCount; } }
  const list = L.games.filter((g) => !g.hidden && g.ready !== false);
  const played = list.filter((g) => g.played).sort((a, b) => b.played - a.played);
  const rest = list.filter((g) => !g.played).sort((a, b) => (b.minutes || 0) - (a.minutes || 0) || a.name.localeCompare(b.name, 'ru'));
  return { games: [...played, ...rest].slice(0, n), recent: played.length > 0, total: list.length };
}
export const gameArt = (g) => art(g);
export const gameSub = (g) => (g.played ? ago(g.played) : playtime(g.minutes));
export const playGame = (g) => launch(g);

/** Названия установленных игр — подсказки в «Позвать в игру». */
export async function installedNames() {
  if (!L.games.length) { const r = await window.som.gamelib.list({}).catch(() => null); if (r) { L.games = r.games; L.sources = r.sources; L.hiddenCount = r.hiddenCount; } }
  return L.games.filter((g) => !g.hidden).map((g) => ({ name: g.name, steam: g.appid || null }));
}

export function initGameLib(deps) {
  X = { ...X, ...deps };
  L.sort = pref('som.gl.sort', 'recent');
  $('gameLibBtn').addEventListener('click', openGameLib);
  $('glSearch').addEventListener('input', (e) => { L.q = e.target.value; render(); });
  $('glSearch').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const first = visible()[0]; if (first) { e.preventDefault(); launch(first); } }
    if (e.key === 'Escape' && L.q) { e.preventDefault(); e.stopPropagation(); L.q = ''; e.target.value = ''; render(); }
  });
  $('glSort').addEventListener('change', (e) => { L.sort = e.target.value; setPref('som.gl.sort', L.sort); render(); });
  $('glRefresh').addEventListener('click', () => load(true));
  $('glShowHidden').addEventListener('click', () => { L.showHidden = !L.showHidden; render(); });
  $('glAdd').addEventListener('click', async () => {
    const r = await window.som.gamelib.add().catch((err) => ({ ok: false, error: err.message }));
    if (r?.canceled) return;
    if (!r?.ok) { X.toast(r?.error || 'Не добавилось', 'bad'); return; }
    L.tab = 'all';
    await load(true);
    X.toast(`«${r.name}» в библиотеке. Название и обложку можно поменять в меню игры (⋯).`, 'ok', 5000);
    document.querySelector(`.gl-tile[data-id="${r.id}"]`)?.scrollIntoView({ block: 'nearest' });
  });
}
