// Главная: то, что видно, пока не открыта переписка (и сразу после запуска).
// Кто из друзей на связи и во что играет, что ждёт ответа, во что вы играли и что играло по радио.
// Данные и действия даёт app.js (initHome), здесь — только экран.

import { recentGames, gameArt, gameSub, playGame, openGameLib } from './gamelib.js';
import { radioInfo, radioToggle, radioPick, stationLogo, open as openRadio } from './radio.js';

const $ = (id) => document.getElementById(id);
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
  return el;
}
const plural = (n, one, few, many) => { const a = n % 10; const b = n % 100; return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many; };
function pref(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } }
function setPref(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* не страшно */ } }

const IC = {
  add: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>',
  invite: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>',
  radio: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="8" width="20" height="13" rx="2.5"/><path d="M7 8l10-5"/><circle cx="16" cy="14.5" r="3"/><line x1="5.5" y1="12.5" x2="10" y2="12.5"/><line x1="5.5" y1="16.5" x2="10" y2="16.5"/></svg>',
  games: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 11h4M8 9v4"/><circle cx="15.5" cy="10.5" r="0.6" fill="currentColor"/><circle cx="17.5" cy="13" r="0.6" fill="currentColor"/><path d="M7.5 6h9a5 5 0 0 1 4.9 6l-.8 4a2.6 2.6 0 0 1-4.6 1.1L14.5 15h-5l-1.5 2.1A2.6 2.6 0 0 1 3.4 16l-.8-4a5 5 0 0 1 4.9-6z"/></svg>',
  saved: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>',
  call: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',
  play: '<svg class="ic fill" viewBox="0 0 24 24" aria-hidden="true"><polygon points="7 4 20 12 7 20 7 4"/></svg>',
  pause: '<svg class="ic fill" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>',
};

let X = null; // зависимости из app.js
const H = { shown: false, sig: '', raf: 0, games: null, gamesAt: 0, timer: 0 };

// ---------- Слова ----------
function greeting(d = new Date()) {
  const hr = d.getHours();
  return hr < 5 ? 'Доброй ночи' : hr < 12 ? 'Доброе утро' : hr < 18 ? 'Добрый день' : 'Добрый вечер';
}
const fmtDate = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
const dateLine = () => { const s = fmtDate.format(new Date()); return s.charAt(0).toUpperCase() + s.slice(1); };
function names(list) {
  const n = list.map((f) => f.name);
  if (n.length === 1) return n[0];
  if (n.length <= 3) return `${n.slice(0, -1).join(', ')} и ${n[n.length - 1]}`;
  return `${n.length} ${plural(n.length, 'друг', 'друга', 'друзей')}`;
}
/** Одна-две фразы о том, что сейчас происходит. */
function summary(online, gamers, unread, hasFriends) {
  if (!hasFriends) return 'Som — мессенджер для своих: без сервера, телефона и почты. Начните с приглашения другу.';
  const parts = [];
  if (!online.length) parts.push('Из друзей сейчас никого нет в сети.');
  else {
    let s = `В сети ${names(online)}`;
    if (gamers.length === 1) s += online.length === 1 ? `, играет в ${gamers[0].game}` : `, ${gamers[0].f.name} играет в ${gamers[0].game}`;
    else if (gamers.length > 1) s += gamers.length === online.length ? ', все в играх' : `, ${gamers.length} из них в играх`;
    parts.push(`${s}.`);
  }
  if (unread) parts.push(`Ждут ответа ${unread} ${plural(unread, 'сообщение', 'сообщения', 'сообщений')}.`);
  return parts.join(' ');
}

// ---------- Части экрана ----------
function quick(hasFriends) {
  const b = (ic, text, onclick, primary) => h('button', { class: `hq${primary ? ' primary' : ''}`, type: 'button', onclick, html: `${IC[ic]}<span>${text}</span>` });
  return h('nav', { class: 'home-quick', 'aria-label': 'Быстрые действия' },
    hasFriends ? b('add', 'Добавить друга', () => X.addFriend()) : b('invite', 'Моё приглашение', () => X.invite(), true),
    hasFriends ? b('invite', 'Моё приглашение', () => X.invite()) : b('add', 'Добавить друга по приглашению', () => X.addFriend()),
    b('radio', 'Радио', () => openRadio()),
    b('games', 'Мои игры', () => openGameLib()),
    b('saved', 'Избранное', () => X.open('saved')));
}

function notes() {
  let n = null;
  try { n = JSON.parse(pref('som.newIn', 'null')); } catch { n = null; }
  if (!n?.v || !n.notes || Date.now() - (n.at || 0) > 4 * 86400000) return null;
  return h('section', { class: 'home-note news', 'aria-label': `Что нового в Som ${n.v}` },
    h('div', { class: 'hn-text' }, h('b', { text: `Что нового в ${n.v}` }), ...n.notes.split('\n').filter(Boolean).map((line) => h('p', { text: line }))),
    h('button', { class: 'btn small', type: 'button', text: 'Понятно', onclick: () => { setPref('som.newIn', null); render(true); } }));
}

function strips(requests, birthdays) {
  const out = [];
  for (const f of requests) {
    out.push(h('section', { class: 'home-note req-note' },
      X.avatar(f, 'small'),
      h('div', { class: 'hn-text' }, h('b', { text: f.name }), h('p', { text: 'хочет добавить вас в друзья' })),
      h('div', { class: 'hn-btns' },
        h('button', { class: 'btn small primary', type: 'button', text: 'Принять', onclick: (e) => X.accept(f, e.currentTarget) }),
        h('button', { class: 'btn small', type: 'button', text: 'Отклонить', onclick: () => X.decline(f) }))));
  }
  for (const f of birthdays) {
    out.push(h('section', { class: 'home-note bday' },
      h('span', { class: 'hn-emoji', 'aria-hidden': 'true', text: '🎂' }),
      h('div', { class: 'hn-text' }, h('b', { text: `Сегодня день рождения у ${f.name}` }), h('p', { text: 'Напишите «С днём рождения» — у вас обоих полетит конфетти.' })),
      h('button', { class: 'btn small primary', type: 'button', text: 'Поздравить', onclick: () => X.open(f.id, 'С днём рождения! 🎂') })));
  }
  return out;
}

/** Новому человеку: как появляется первый друг. */
function steps() {
  const st = (b, p) => h('li', {}, h('b', { text: b }), h('p', { text: p }));
  return h('section', { class: 'home-sec home-steps', 'aria-labelledby': 'homeStepsT' },
    h('h2', { id: 'homeStepsT', text: 'Как добавить первого друга' }),
    h('ol', { class: 'hs-list' },
      st('Отправьте приглашение', 'Кнопка «Моё приглашение» — скопируйте его и пришлите другу в любом мессенджере.'),
      st('Друг добавляет вас', 'Он вставляет приглашение в «Добавить друга» у себя в Som, а вы принимаете заявку здесь.'),
      st('Вы на связи', 'Если вы не в одной домашней сети — включите оба Radmin VPN и подключитесь к одной сети.')));
}

function people(online, offline) {
  const sec = h('section', { class: 'home-sec home-people', 'aria-labelledby': 'homePeopleT' },
    h('h2', { id: 'homePeopleT' }, 'На связи', online.length ? h('span', { class: 'n', text: String(online.length) }) : null));
  if (!online.length) {
    const last = offline.filter((f) => f.lastSeen).sort((a, b) => b.lastSeen - a.lastSeen)[0];
    sec.append(h('p', { class: 'home-empty', text: last ? `Сейчас никого нет в сети. ${last.name}: последний раз в сети ${X.seenAgo(last.lastSeen)}.` : 'Сейчас никого нет в сети.' }));
    return sec;
  }
  const list = h('div', { class: 'hp-list', role: 'list' });
  for (const f of online) {
    const game = X.gameOf(f);
    const status = X.statusOf(f);
    const act = game ? `🎮 ${game}${f.activity?.since ? ` · ${X.fmtDur(Date.now() - f.activity.since)}` : ''}` : status || X.presence(f);
    const av = X.avatar(f, '');
    const tile = h('div', { class: 'hp', role: 'listitem' },
      h('button', { class: 'hp-main', type: 'button', title: `Открыть переписку с ${f.name}`, onclick: () => X.open(f.id) },
        av,
        h('span', { class: 'hp-name', text: f.name }),
        h('span', { class: `hp-act${game ? ' game' : ''}`, text: act, title: act })),
      h('button', { class: 'icon-btn hp-call', type: 'button', title: `Позвонить: ${f.name}`, 'aria-label': `Позвонить: ${f.name}`, html: IC.call, onclick: () => X.call(f) }));
    X.hoverAnim(tile, av);
    list.append(tile);
  }
  sec.append(list);
  return sec;
}

function chats(friends, groups) {
  const all = [
    ...friends.map((f) => ({ id: f.id, name: f.name, last: f.last, unread: f.unread || 0, av: () => X.avatar(f, 'small') })),
    ...groups.map((g) => ({ id: `g:${g.id}`, name: g.name, last: g.last, unread: g.unread || 0, av: () => X.groupAvatar(g, 'small') })),
  ].filter((x) => x.last).sort((a, b) => (b.last.at || 0) - (a.last.at || 0));
  const unread = all.filter((x) => x.unread);
  const list = unread.length ? unread.slice(0, 6) : all.slice(0, 4);
  const sec = h('section', { class: 'home-sec home-chats', 'aria-labelledby': 'homeChatsT' },
    h('h2', { id: 'homeChatsT' }, unread.length ? 'Ждут ответа' : 'Последние переписки', unread.length ? h('span', { class: 'n', text: String(unread.length) }) : null));
  if (!list.length) { sec.append(h('p', { class: 'home-empty', text: 'Переписок пока нет. Напишите кому-нибудь из друзей — они слева.' })); return sec; }
  if (!unread.length) sec.append(h('p', { class: 'home-hint', text: 'Всё прочитано.' }));
  const box = h('div', { class: 'hu-list', role: 'list' });
  for (const x of list) {
    const text = x.last.dir === 'out' ? `Вы: ${x.last.text || ''}` : (x.last.text || '');
    box.append(h('button', { class: `hu${x.unread ? ' unread' : ''}`, type: 'button', role: 'listitem', onclick: () => X.open(x.id) },
      x.av(),
      h('span', { class: 'hu-main' }, h('span', { class: 'hu-name', text: x.name }), h('span', { class: 'hu-text', text })),
      h('span', { class: 'hu-side' }, h('span', { class: 'hu-time', text: X.when(x.last.at) }), x.unread ? h('span', { class: 'badge', text: x.unread > 99 ? '99+' : String(x.unread) }) : null)));
  }
  sec.append(box);
  return sec;
}

function games() {
  const r = H.games;
  if (!r?.games?.length) return null;
  const sec = h('section', { class: 'home-sec home-games', 'aria-labelledby': 'homeGamesT' },
    h('h2', { id: 'homeGamesT' }, r.recent ? 'Продолжить играть' : 'Мои игры',
      h('button', { class: 'link-btn hs-more', type: 'button', text: `Все игры (${r.total})`, onclick: () => openGameLib() })));
  const list = h('div', { class: 'hg-list', role: 'list' });
  for (const g of r.games) {
    const sub = gameSub(g);
    list.append(h('button', { class: 'hg', type: 'button', role: 'listitem', title: `Играть в «${g.name}»`, onclick: () => playGame(g).then(() => render(true)) },
      h('span', { class: 'hg-cover' }, gameArt(g), h('span', { class: 'hg-play', 'aria-hidden': 'true', html: IC.play })),
      h('span', { class: 'hg-name', text: g.name }),
      sub ? h('span', { class: 'hg-sub', text: sub }) : null));
  }
  sec.append(list);
  return sec;
}

function radio() {
  const R = radioInfo();
  const playing = R.state === 'playing' || R.state === 'connecting';
  const sec = h('section', { class: 'home-radio', 'aria-label': 'Радио', dataset: { state: R.state } });
  if (R.st) {
    sec.append(
      h('button', { class: 'hr-main', type: 'button', title: 'Выбрать станцию', onclick: () => openRadio() },
        stationLogo(R.st, 44),
        h('span', { class: 'hr-text' },
          h('span', { class: 'hr-name', text: R.st.name }),
          h('span', { class: 'hr-now', text: R.state === 'connecting' ? 'Подключаюсь…' : playing ? (R.now || 'В эфире') : 'Радио на паузе' }))),
      h('button', { class: 'icon-btn hr-play', type: 'button', title: playing ? 'Пауза' : 'Играть', 'aria-label': playing ? 'Пауза' : 'Играть', html: playing ? IC.pause : IC.play, onclick: () => radioToggle() }));
  } else {
    sec.append(h('button', { class: 'hr-main', type: 'button', onclick: () => openRadio() },
      h('span', { class: 'hr-ic', html: IC.radio }),
      h('span', { class: 'hr-text' }, h('span', { class: 'hr-name', text: 'Радио' }), h('span', { class: 'hr-now', text: 'Русские станции и весь мир: поп, рок, лоу-фай, джаз…' }))));
  }
  const more = (R.favs.length ? R.favs : R.recent).filter((s) => s.id !== R.st?.id).slice(0, 4);
  if (more.length) {
    sec.append(h('div', { class: 'hr-chips', role: 'group', 'aria-label': R.favs.length ? 'Избранные станции' : 'Недавние станции' },
      ...more.map((s) => h('button', { class: 'chip', type: 'button', title: `Слушать «${s.name}»`, onclick: () => radioPick(s) }, stationLogo(s, 20), h('span', { text: s.name })))));
  }
  return sec;
}

// ---------- Отрисовка ----------
function data() {
  const fr = X.friends();
  const friends = fr.filter((f) => f.state === 'friend');
  const online = friends.filter((f) => f.online).sort((a, b) => Number(Boolean(X.gameOf(b))) - Number(Boolean(X.gameOf(a))) || (b.last?.at || 0) - (a.last?.at || 0));
  const gamers = online.map((f) => ({ f, game: X.gameOf(f) })).filter((x) => x.game);
  const groups = X.groups();
  const unread = friends.reduce((n, f) => n + (f.unread || 0), 0) + groups.reduce((n, g) => n + (g.unread || 0), 0);
  return { me: X.me(), friends, online, offline: friends.filter((f) => !f.online), gamers, groups, unread, requests: fr.filter((f) => f.state === 'incoming'), birthdays: friends.filter((f) => X.isBirthday(f.birthday)) };
}
/** Подпись данных: перерисовываем, только когда на экране что-то поменялось (иначе слетит наведение). */
function signature(D) {
  const R = radioInfo();
  return JSON.stringify([
    D.me?.name, greeting(), dateLine(), D.unread,
    D.online.map((f) => [f.id, f.name, f.presence, f.avatarV, f.frame, X.gameOf(f), X.statusOf(f), f.activity?.since ? Math.floor((Date.now() - f.activity.since) / 60000) : 0]),
    D.offline.length, D.requests.map((f) => f.id), D.birthdays.map((f) => f.id),
    [...D.friends, ...D.groups].map((x) => [x.id, x.unread, x.last?.at, x.name]),
    [R.st?.id, R.state, R.now, R.favs.map((s) => s.id).join()],
    H.games?.games.map((g) => [g.id, g.played]), pref('som.newIn', ''),
  ]);
}
function render(force = false) {
  const box = $('home');
  if (!box || box.hidden || !X) return;
  const D = data();
  const sig = signature(D);
  if (!force && sig === H.sig) return;
  H.sig = sig;
  const hasFriends = D.friends.length > 0 || D.requests.length > 0;
  const name = D.me?.name || '';
  const hero = h('header', { class: 'home-hero' },
    h('div', { class: 'hh-text' },
      h('p', { class: 'hh-date', text: dateLine() }),
      h('h1', { class: 'hh-hi', text: hasFriends ? `${greeting()}${name ? `, ${name}` : ''}` : `Добро пожаловать${name ? `, ${name}` : ''}` }),
      h('p', { class: 'hh-sub', text: summary(D.online, D.gamers, D.unread, hasFriends) })),
    h('img', { class: 'hh-emblem', src: 'assets/icon.png', alt: '', draggable: 'false' }));
  const kids = [hero, quick(hasFriends), notes(), ...strips(D.requests, D.birthdays)];
  if (!hasFriends) kids.push(steps());
  if (D.friends.length) kids.push(people(D.online, D.offline));
  const cols = h('div', { class: 'home-cols' });
  if (D.friends.length || D.groups.length) cols.append(chats(D.friends, D.groups));
  const gs = games();
  if (gs) cols.append(gs);
  if (cols.children.length) { cols.classList.toggle('one', cols.children.length === 1); kids.push(cols); }
  kids.push(radio());
  $('homeIn').replaceChildren(...kids.filter(Boolean));
}
const later = () => { if (!H.raf) H.raf = requestAnimationFrame(() => { H.raf = 0; render(); }); };

async function loadGames() {
  if (H.gamesAt && Date.now() - H.gamesAt < 60_000) return;
  H.gamesAt = Date.now();
  H.games = await recentGames(4).catch(() => null);
  render();
}

/** Показать главную (вместо переписки) или спрятать её. */
export function showHome(on) {
  const box = $('home');
  if (!box) return;
  const was = !box.hidden;
  box.hidden = !on;
  if (!on) { clearInterval(H.timer); H.timer = 0; return; }
  render(!was);
  if (!was) {
    // Появление — один раз при входе на главную, не при каждом обновлении.
    box.classList.remove('enter');
    void box.offsetWidth;
    box.classList.add('enter');
    setTimeout(() => box.classList.remove('enter'), 900);
    box.scrollTop = 0;
  }
  // Игры — после первой отрисовки окна: список собирается с диска.
  setTimeout(loadGames, H.games ? 0 : 1200);
  // Раз в минуту — время в игре и приветствие по времени суток.
  if (!H.timer) H.timer = setInterval(() => render(), 60_000);
}
/** Что-то поменялось у друзей, в радио или профиле — обновить, если главная на экране. */
export const refreshHome = later;
/** После обновления Som — показать «Что нового» на главной пару дней. */
export function rememberNews(v, text) {
  if (v && text) setPref('som.newIn', JSON.stringify({ v, notes: text, at: Date.now() }));
}

export function initHome(deps) {
  X = deps;
}
