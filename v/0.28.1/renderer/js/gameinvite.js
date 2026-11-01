// «Позвать в игру»: карточка-приглашение в чате и ответы на неё.
// Ответ — это реакция (у каждого одна): ✅ иду, ⏳ позже, ❌ не смогу. Старые версии Som видят
// обычный текст приглашения и обычные реакции.
import { showPanel, closePopup } from './msgtools.js';

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

export const ANSWERS = [
  { e: '✅', label: 'Иду!', one: '{} идёт', many: 'Идут: {}', me: 'Вы идёте' },
  { e: '⏳', label: 'Чуть позже', one: '{} — чуть позже', many: 'Чуть позже: {}', me: 'Вы — чуть позже' },
  { e: '❌', label: 'Не смогу', one: '{} не сможет', many: 'Не смогут: {}', me: 'Вы не сможете' },
];
const ANSWER_OF = new Map(ANSWERS.map((a) => [a.e, a]));
export const isAnswer = (e) => ANSWER_OF.has(e);
const STALE_MS = 4 * 3600 * 1000;
const WHEN = [
  { label: 'Сейчас', min: 0 },
  { label: '15 мин', min: 15 },
  { label: '30 мин', min: 30 },
  { label: '1 час', min: 60 },
];
const fmtTime = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });

let X = {
  toast: () => {}, chat: () => null, canSend: () => false, myGame: () => '', send: async () => null,
  isGroup: () => false, peerName: () => 'Друг', memberName: (id) => id, react: () => {}, richText: (t) => t,
};
let KNOWN = null;

function recent() {
  try { return JSON.parse(localStorage.getItem('som.gi.recent') || '[]').filter((x) => typeof x === 'string').slice(0, 6); } catch { return []; }
}
function remember(name) {
  try { localStorage.setItem('som.gi.recent', JSON.stringify([name, ...recent().filter((x) => x !== name)].slice(0, 6))); } catch { /* не страшно */ }
}
async function known() {
  if (!KNOWN) KNOWN = await window.som.games.known().catch(() => []);
  return KNOWN;
}
const steamOf = (name) => KNOWN?.find((g) => g.name.toLowerCase() === name.toLowerCase())?.steam || null;

/** Окно «Позвать в игру» над кнопкой. */
export async function openGameInvite(anchor) {
  const chat = X.chat();
  if (!chat || !X.canSend()) { X.toast('Откройте чат с другом или группу, чтобы позвать в игру.', 'bad'); return; }
  await known();
  const playing = X.myGame();
  const names = [...new Set([playing, ...recent()].filter(Boolean))];
  const node = h('div', { class: 'pop-game', role: 'dialog', 'aria-label': 'Позвать в игру' });
  const listId = 'giKnown';
  const input = h('input', { type: 'text', class: 'gi-name', maxlength: '60', list: listId, placeholder: 'Во что играем?', value: names[0] || '', 'aria-label': 'Игра' });
  const data = h('datalist', { id: listId }, (KNOWN || []).map((g) => h('option', { value: g.name })));
  let when = 0;
  const whenBox = h('div', { class: 'gi-when', role: 'radiogroup', 'aria-label': 'Когда' }, WHEN.map((w, i) => h('button', {
    type: 'button', role: 'radio', 'aria-checked': String(i === 0), text: w.label, title: w.min ? `Через ${w.label}` : 'Прямо сейчас',
    onclick: (e) => { when = w.min; for (const b of whenBox.children) b.setAttribute('aria-checked', String(b === e.currentTarget)); },
  })));
  const note = h('textarea', { class: 'gi-note', rows: '2', maxlength: '300', placeholder: 'Сервер, пароль, режим — по желанию', 'aria-label': 'Подробности' });
  const go = h('button', { type: 'button', class: 'btn primary', text: X.isGroup() ? 'Позвать всех' : 'Позвать' });
  const send = async () => {
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    go.disabled = true;
    const at = when ? Date.now() + when * 60000 : 0;
    const extra = note.value.trim();
    const text = `🎮 Зову в ${name}${at ? ` — в ${fmtTime.format(new Date(at))}` : ' — прямо сейчас'}${extra ? `\n${extra}` : ''}`;
    const game = { name, note: extra || undefined, steam: steamOf(name) || undefined, at: at || undefined };
    try {
      await X.send(chat, text, game);
      remember(name);
      closePopup();
    } catch (err) { go.disabled = false; X.toast(`Не отправлено: ${err.message}`, 'bad'); }
  };
  go.addEventListener('click', send);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } });
  node.append(...[
    h('div', { class: 'gi-head' }, h('b', { text: 'Позвать в игру' }), h('span', { class: 'hint', text: X.isGroup() ? 'всех в группе' : X.peerName() })),
    input, data,
    names.length ? h('div', { class: 'gi-chips' }, names.map((n) => h('button', {
      type: 'button', class: 'chip', text: n === playing ? `🎮 ${n}` : n, title: n === playing ? 'Вы сейчас в этой игре' : 'Звали недавно',
      onclick: () => { input.value = n; input.focus(); },
    }))) : null,
    h('div', { class: 'gi-row' }, h('span', { class: 'gi-lbl', text: 'Когда' }), whenBox), note,
    h('div', { class: 'gi-foot' }, go)].filter(Boolean));
  const r = anchor.getBoundingClientRect();
  showPanel(r.left, r.top, node);
  requestAnimationFrame(() => {
    const nr = node.getBoundingClientRect();
    node.style.top = `${Math.max(8, r.top - nr.height - 8)}px`;
    node.style.left = `${Math.max(8, Math.min(window.innerWidth - nr.width - 8, r.left - 8))}px`;
    input.focus();
    input.select();
  });
}

/** Ответы на приглашение: [{ a, by: [...] }] — только те, на которые кто-то ответил. */
function answersOf(m) {
  const by = new Map(ANSWERS.map((a) => [a.e, []]));
  for (const r of m.reactions || []) if (by.has(r.e)) by.get(r.e).push(r.by);
  return ANSWERS.map((a) => ({ a, by: by.get(a.e) })).filter((x) => x.by.length);
}
const nameOf = (by) => (by === 'me' ? 'вы' : by === 'peer' ? X.peerName() : X.memberName(by));

/** Карточка приглашения в переписке. */
export function gameCardEl(m, author) {
  const g = m.game;
  const now = Date.now();
  const start = g.at || m.at;
  const stale = now - start > STALE_MS;
  const mine = (m.reactions || []).find((r) => r.by === 'me' && isAnswer(r.e))?.e || '';
  const whenText = !g.at ? (stale ? `было ${new Date(m.at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}` : 'прямо сейчас')
    : g.at > now ? `в ${fmtTime.format(new Date(g.at))} · через ${Math.max(1, Math.round((g.at - now) / 60000))} мин`
      : `в ${fmtTime.format(new Date(g.at))}`;
  const ans = answersOf(m);
  const group = X.isGroup();
  const answersEl = ans.length ? h('div', { class: 'gi-answers' }, ans.map(({ a, by }) => {
    const who = by.map(nameOf);
    const text = by.length === 1 ? (by[0] === 'me' ? a.me : a.one.replace('{}', who[0])) : a.many.replace('{}', who.join(', '));
    return h('div', { class: 'gi-ans', dataset: { e: a.e } }, h('span', { 'aria-hidden': 'true', text: a.e }), h('span', { text }));
  })) : h('div', { class: 'gi-answers muted', text: m.dir === 'out' ? (group ? 'Пока никто не ответил' : `${X.peerName()} пока не ответил(а)`) : '' });
  const buttons = !stale && m.dir === 'in' ? h('div', { class: 'gi-btns' }, ANSWERS.map((a) => h('button', {
    type: 'button', class: `btn small${a.e === '✅' ? ' primary' : ''}`, 'aria-pressed': String(mine === a.e), title: mine === a.e ? 'Убрать ответ' : a.label,
    onclick: (e) => { e.stopPropagation(); X.react(m, a.e, mine !== a.e); },
  }, h('span', { 'aria-hidden': 'true', text: `${a.e} ` }), a.label))) : null;
  const steam = g.steam && !stale ? h('button', {
    type: 'button', class: 'btn small gi-steam', title: 'Откроет игру в Steam, если она у вас есть',
    onclick: (e) => { e.stopPropagation(); window.som.games.steamRun(g.steam); },
  }, '▶ Запустить через Steam') : null;
  return h('div', { class: `bubble gi-card${stale ? ' stale' : ''}` },
    h('div', { class: 'gi-top' },
      h('div', { class: 'gi-ico', 'aria-hidden': 'true', text: '🎮' }),
      h('div', { class: 'gi-main' },
        h('div', { class: 'gi-who', text: m.dir === 'out' ? 'Вы зовёте в игру' : `${author} зовёт в игру` }),
        h('div', { class: 'gi-game', text: g.name }),
        h('div', { class: 'gi-time', text: whenText }))),
    g.note ? h('div', { class: 'gi-text' }, X.richText(g.note)) : null,
    answersEl, buttons, steam);
}

/** Кто и как ответил нового — для уведомления автору приглашения. */
export function newAnswers(before, after, name = nameOf) {
  const was = new Map((before?.reactions || []).filter((r) => isAnswer(r.e)).map((r) => [r.by, r.e]));
  return (after.reactions || []).filter((r) => r.by !== 'me' && isAnswer(r.e) && was.get(r.by) !== r.e)
    .map((r) => ({ by: r.by, name: name(r.by), a: ANSWER_OF.get(r.e) }));
}

export function initGameInvite(deps) {
  X = { ...X, ...deps };
}
export { closePopup };
