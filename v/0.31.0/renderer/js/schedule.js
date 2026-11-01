// Отложенные сообщения: «Отправить позже» у кнопки «Отправить» и полоска запланированных над полем ввода.
// Хранит и отправляет их ядро (в зашифрованном профиле); уйдут, пока Som запущен — хоть свёрнутым в трее.

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

let X = { call: async () => null, toast: () => {}, chat: () => null, canSend: () => false, menu: () => {}, panel: () => {}, closePopup: () => {}, beforeSend: async () => ({}), afterSchedule: () => {}, toComposer: () => {} };
let items = [];
let open = false;

const fmtT = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });
const fmtD = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });
const fmtWd = new Intl.DateTimeFormat('ru-RU', { weekday: 'long' });
const day0 = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
/** «сегодня в 21:00», «завтра в 9:00», «в пятницу в 18:30», «12 ноября в 10:00». */
export function whenText(at) {
  const d = Math.round((day0(at) - day0(Date.now())) / 86400000);
  const t = fmtT.format(new Date(at));
  if (d === 0) return `сегодня в ${t}`;
  if (d === 1) return `завтра в ${t}`;
  if (d === -1) return `вчера в ${t}`;
  if (d > 1 && d < 7) { const w = fmtWd.format(new Date(at)); return `${/^(вт)/.test(w) ? 'во' : 'в'} ${w.replace(/а$/, 'у')} в ${t}`; }
  return `${fmtD.format(new Date(at))} в ${t}`;
}

// ---------- Выбор времени ----------
function at(h, m, plusDays = 0) { const d = new Date(); d.setDate(d.getDate() + plusDays); d.setHours(h, m, 0, 0); return d.getTime(); }
function presets() {
  const now = Date.now();
  const list = [
    { label: 'Через 30 минут', at: now + 30 * 60000 },
    { label: 'Через 1 час', at: now + 60 * 60000 },
    { label: 'Через 3 часа', at: now + 3 * 60 * 60000 },
  ];
  if (at(20, 30) > now) list.push({ label: 'Сегодня вечером', at: at(21, 0) });
  list.push({ label: 'Завтра утром', at: at(9, 0, 1) });
  list.push({ label: 'Завтра вечером', at: at(21, 0, 1) });
  return list;
}
const localInput = (t) => { const d = new Date(t - new Date(t).getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };

/** Окошко «Отправить позже». pick(at) — что делать с выбранным временем. */
function picker(anchor, title, pick, initial = 0) {
  const node = h('div', { class: 'pop-sched', role: 'dialog', 'aria-label': title });
  const custom = h('input', { type: 'datetime-local', class: 'sc-dt', 'aria-label': 'Дата и время', value: localInput(initial || Math.ceil((Date.now() + 2 * 3600000) / 900000) * 900000), min: localInput(Date.now() + 60000) });
  const go = h('button', { type: 'button', class: 'btn primary small', text: 'Запланировать' });
  const choose = async (t) => { if (!t || t < Date.now() + 10000) { X.toast('Это время уже прошло — выберите позже.', 'bad'); return; } X.closePopup(); await pick(t); };
  go.addEventListener('click', () => choose(new Date(custom.value).getTime()));
  custom.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go.click(); } });
  node.append(
    h('b', { class: 'ps-title', text: title }),
    h('div', { class: 'ps-list' }, presets().map((p) => h('button', { type: 'button', onclick: () => choose(p.at) }, h('span', { text: p.label }), h('small', { text: whenText(p.at) })))),
    h('div', { class: 'ps-custom' }, custom, go),
    h('p', { class: 'hint ps-note', text: 'Сообщение уйдёт само, если Som в это время запущен — можно свёрнутым в трее. Если ПК был выключен, Som спросит, отправлять ли.' }),
  );
  const r = anchor.getBoundingClientRect();
  X.panel(r.left, r.top, node);
  requestAnimationFrame(() => {
    const nr = node.getBoundingClientRect();
    node.style.top = `${Math.max(8, r.top - nr.height - 8)}px`;
    // Прижимаем к правому краю кнопки — справа окно Som кончается, вылезать нельзя.
    node.style.left = 'auto';
    node.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
    node.querySelector('.ps-list button')?.focus();
  });
}

/** «Отправить позже» для текста в поле ввода. */
export async function sendLater(anchor) {
  const chat = X.chat();
  const text = $('composerInput').value.trim();
  if (X.editing?.()) { X.toast('Сначала закончите правку сообщения — отложить можно только новое.', 'bad'); return; }
  if (!chat || !X.canSend()) { X.toast('Откройте чат, чтобы запланировать сообщение.', 'bad'); return; }
  if (!text) { X.toast('Сначала напишите сообщение — потом выберите, когда его отправить.', 'bad'); $('composerInput').focus(); return; }
  picker(anchor, 'Отправить позже', async (t) => {
    const extra = await X.beforeSend(text).catch(() => ({}));
    try {
      await X.call('schedule_add', { chat, text, at: t, ...extra });
      X.afterSchedule();
      X.toast(`Отправится ${whenText(t)}.`, 'ok');
      await refresh();
    } catch (err) { X.toast(`Не запланировано: ${err.message}`, 'bad'); }
  });
}

// ---------- Полоска запланированных ----------
function row(s) {
  const when = s.missed ? `не отправлено (${whenText(s.at)})` : whenText(s.at);
  const more = h('button', { type: 'button', class: 'icon-btn sb-more', text: '⋯', title: 'Ещё', 'aria-label': 'Действия' });
  more.addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    X.menu(r.left, r.top - 4, [
      { label: 'Отправить сейчас', onclick: () => act('schedule_now', s) },
      { label: 'Изменить время…', onclick: () => picker(more, 'Новое время', async (t) => { try { await X.call('schedule_update', { sid: s.id, at: t }); X.toast(`Отправится ${whenText(t)}.`, 'ok'); } catch (err) { X.toast(err.message, 'bad'); } refresh(); }, s.at) },
      { label: 'Вернуть в поле ввода', sub: 'чтобы исправить текст', onclick: async () => { if (await act('schedule_cancel', s, true)) X.toComposer(s.text); } },
      { label: 'Удалить', danger: true, onclick: () => act('schedule_cancel', s) },
    ]);
  });
  return h('div', { class: `sch-row${s.missed ? ' missed' : ''}`, dataset: { sid: s.id } },
    h('span', { class: 'sch-when', title: new Date(s.at).toLocaleString('ru-RU'), text: when }),
    h('span', { class: 'sch-text', text: s.text.replace(/\s+/g, ' ') }),
    s.missed ? h('button', { type: 'button', class: 'btn small primary', text: 'Отправить', onclick: () => act('schedule_now', s) }) : null,
    more);
}
async function act(cmd, s, quiet = false) {
  try {
    await X.call(cmd, { sid: s.id });
    if (!quiet && cmd === 'schedule_cancel') X.toast('Отложенное сообщение удалено.');
    await refresh();
    return true;
  } catch (err) { X.toast(err.message, 'bad'); await refresh(); return false; }
}
function render() {
  const bar = $('schedBar');
  bar.hidden = !items.length;
  if (!items.length) return;
  const missed = items.filter((s) => s.missed).length;
  const head = h('button', { type: 'button', class: 'sch-head', 'aria-expanded': String(open || items.length === 1), onclick: () => { open = !open; render(); } },
    h('span', { class: 'sch-ic', 'aria-hidden': 'true', text: '🕓' }),
    h('span', { text: missed ? `Не отправлено: ${missed}${items.length > missed ? ` · отложено: ${items.length - missed}` : ''}` : `Отложено: ${items.length} · ближайшее ${whenText(items.find((s) => !s.missed)?.at || items[0].at)}` }),
    items.length > 1 ? h('span', { class: 'sch-caret', text: open ? '▾' : '▸' }) : null);
  bar.classList.toggle('has-missed', Boolean(missed));
  bar.replaceChildren(...(items.length === 1 ? [row(items[0])] : [head, ...(open ? items.map(row) : [])]));
}
export async function refresh() {
  const chat = X.chat();
  if (!chat) { items = []; render(); return; }
  try { items = (await X.call('schedule_list', { chat })) || []; } catch { items = []; }
  if (X.chat() !== chat) return;
  render();
}
/** Событие ядра «scheduled»: ушло, пропущено, не отправилось — обновить полоску. */
export function onScheduled(ev) {
  if (ev.chat === X.chat()) refresh();
  if (ev.failed) X.toast(`Отложенное сообщение не отправилось: ${ev.error || 'ошибка'}. Оно ждёт в полоске над полем ввода.`, 'bad', 8000);
  if (ev.missed && ev.chat !== X.chat()) X.toast('Som был выключен, когда пора было отправить отложенное сообщение. Откройте этот чат — там можно отправить его или удалить.', 'bad', 9000);
}

export function initSchedule(deps) {
  X = { ...X, ...deps };
  $('sendLaterBtn').addEventListener('click', (e) => sendLater(e.currentTarget));
  $('sendBtn').addEventListener('contextmenu', (e) => { e.preventDefault(); sendLater($('sendLaterBtn')); });
}
