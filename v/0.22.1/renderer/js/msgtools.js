// Мелкие инструменты переписки: всплывающее меню, выбор реакции, запись и проигрывание голосовых.

export const QUICK = ['👍', '❤️', '😂', '😮', '😢', '🔥'];

function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) e.append(kid);
  return e;
}

// ---------- Всплывающее меню и выбор реакции ----------
let popup = null;
export function closePopup() {
  if (!popup) return;
  popup.remove();
  popup = null;
  document.removeEventListener('pointerdown', onOutside, true);
  document.removeEventListener('keydown', onKey, true);
  window.removeEventListener('blur', closePopup);
}
function onOutside(e) { if (popup && !popup.contains(e.target)) closePopup(); }
function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); closePopup(); } }

function place(node, x, y) {
  closePopup();
  popup = node;
  // Внутри открытого окна (диалога или всплывающей карточки) меню должно быть в нём же, иначе окно его перекроет.
  const host = [...document.querySelectorAll('dialog[open], [popover]:popover-open')].pop() || document.body;
  host.append(node);
  const r = node.getBoundingClientRect();
  const left = Math.max(8, Math.min(x, window.innerWidth - r.width - 8));
  const top = y + r.height > window.innerHeight - 8 ? Math.max(8, y - r.height) : y;
  node.style.left = `${left}px`;
  node.style.top = `${top}px`;
  setTimeout(() => {
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', closePopup);
  }, 0);
  node.querySelector('button')?.focus();
}

/** Меню действий. items: [{ label, onclick, danger?, hint?, sub? } | null]; sub — пояснение второй строкой. */
export function showMenu(x, y, items) {
  const node = el('div', { class: 'pop-menu', role: 'menu' },
    items.filter(Boolean).map((it) => el('button', {
      type: 'button', role: 'menuitem', class: `${it.danger ? 'danger' : ''}${it.sub ? ' two' : ''}`.trim(),
      onclick: () => { closePopup(); it.onclick(); },
    }, it.sub ? el('span', { class: 'mi' }, el('span', { text: it.label }), el('small', { text: it.sub })) : el('span', { text: it.label }), it.hint ? el('kbd', { text: it.hint }) : null)));
  place(node, x, y);
}

/** Произвольная всплывающая панель (закрывается щелчком мимо или Esc). */
export function showPanel(x, y, node) {
  place(node, x, y);
}

/** Выбор реакции рядом с кнопкой. current — уже поставленная мной (её щелчок снимает). */
export function showPicker(anchor, current, onPick) {
  const r = anchor.getBoundingClientRect();
  const node = el('div', { class: 'pop-react', role: 'menu', 'aria-label': 'Реакция' },
    [...new Set([...QUICK, ...(current && !QUICK.includes(current) ? [current] : [])])].map((e) => el('button', {
      type: 'button', role: 'menuitemradio', 'aria-checked': String(e === current), title: e === current ? 'Убрать' : 'Поставить',
      onclick: () => { closePopup(); onPick(e, e !== current); },
    }, e)),
    el('button', {
      type: 'button', class: 'more', role: 'menuitem', title: 'Все смайлики', 'aria-label': 'Все смайлики',
      onclick: () => showEmojiPicker(anchor, { onPick: (e) => { if (e) onPick(e, e !== current); }, first: QUICK, max: 8, label: 'Реакция' }),
    }, '＋'));
  place(node, r.left, r.bottom + 4);
}

/** Выбор значка для статуса. onPick('') — без значка. */
export const STATUS_EMOJI = ['🙂', '😎', '🤓', '😴', '🤒', '🥳', '😤', '🫠', '🎮', '🎧', '📚', '💻', '🏃', '🍕', '☕', '🚗',
  '✈️', '🏠', '🛠️', '🎬', '🎵', '🔥', '❤️', '⭐', '🌙', '☀️', '🌧️', '❄️', '⚽', '🏋️', '🧘', '💤'];
export function showEmoji(anchor, onPick) {
  showEmojiPicker(anchor, { onPick, none: 'Без значка', label: 'Значок статуса', first: STATUS_EMOJI });
}

// ---------- Все смайлики: категории, поиск по-русски, недавние ----------
const RECENT_KEY = 'som.emoji.recent';
function recentEmoji() { try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } }
function rememberEmoji(e) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([e, ...recentEmoji().filter((x) => x !== e)].slice(0, 32))); } catch { /* не страшно */ }
}
let emojiData = null;
const scalars = (s) => [...s].length;
/**
 * Выбор смайлика. opts: onPick(e), none — подпись кнопки «без значка» (onPick('')),
 * first — свои быстрые в начале, max — не длиннее стольких символов (для реакций), label — для читалок.
 */
export async function showEmojiPicker(anchor, { onPick, none = '', first = null, max = 0, label = 'Смайлики' } = {}) {
  const r = anchor.getBoundingClientRect();
  const pick = (e) => { closePopup(); if (e) rememberEmoji(e); onPick(e); };
  const search = el('input', { class: 'ep-search', type: 'search', placeholder: 'Найти: кот, огонь, сердце, смех…', 'aria-label': 'Поиск смайлика', spellcheck: 'false' });
  const tabs = el('div', { class: 'ep-tabs', role: 'tablist' });
  const grid = el('div', { class: 'ep-grid' });
  const name = el('span', { class: 'ep-name', text: ' ' });
  const node = el('div', { class: 'pop-emoji2', role: 'dialog', 'aria-label': label },
    search, tabs, grid,
    el('div', { class: 'ep-foot' }, name, none ? el('button', { type: 'button', class: 'btn small', text: none, onclick: () => pick('') }) : null));
  place(node, r.left, r.bottom + 4);
  search.focus();
  if (!emojiData) {
    grid.append(el('p', { class: 'ep-empty', text: 'Загружаю…' }));
    emojiData = (await import('./emoji-data.js')).EMOJI_GROUPS;
    if (!node.isConnected) return;
  }
  const ok = (e) => !max || scalars(e) <= max;
  const byEmoji = new Map();
  for (const g of emojiData) for (const it of g.items) byEmoji.set(it[0], it);
  const cell = (e) => {
    const it = byEmoji.get(e);
    const b = el('button', { type: 'button', class: 'ep-e', title: it ? it[1] : e, 'aria-label': it ? it[1] : e, onclick: () => pick(e) }, e);
    b.addEventListener('mouseenter', () => { name.textContent = it ? `${e}  ${it[1]}` : e; });
    return b;
  };
  const sections = [];
  const recent = recentEmoji().filter(ok);
  const quick = [...new Set([...(first || []), ...recent])].filter(ok).slice(0, 40);
  if (quick.length) sections.push({ id: 'recent', name: first ? 'Частые и недавние' : 'Недавние', icon: '🕘', items: quick });
  for (const g of emojiData) sections.push({ id: g.id, name: g.name, icon: g.icon, items: g.items.map((x) => x[0]).filter(ok) });
  const heads = new Map();
  const renderAll = () => {
    grid.replaceChildren();
    for (const sec of sections) {
      const h5 = el('h5', { text: sec.name });
      heads.set(sec.id, h5);
      grid.append(h5, el('div', { class: 'ep-cells' }, sec.items.map(cell)));
    }
  };
  tabs.replaceChildren(...sections.map((sec) => el('button', {
    type: 'button', class: 'ep-tab', role: 'tab', title: sec.name, 'aria-label': sec.name,
    onclick: () => { if (search.value) { search.value = ''; renderAll(); } heads.get(sec.id)?.scrollIntoView({ block: 'start' }); },
  }, sec.icon)));
  renderAll();
  // Поиск: по названию и словам; «кот» найдёт и 🐈, и 😺.
  let t = 0;
  search.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => {
      const q = search.value.trim().toLowerCase().replace(/ё/g, 'е');
      if (!q) { renderAll(); return; }
      const words = q.split(/\s+/);
      const norm = (x) => x.toLowerCase().replace(/ё/g, 'е');
      const found = [];
      let n = 0;
      for (const g of emojiData) {
        for (const [e, lbl, tags] of g.items) {
          n += 1;
          if (!ok(e)) continue;
          const label = norm(lbl);
          const lw = label.split(/[\s:,«»"-]+/);
          const tw = norm(tags).split(/\s+/);
          // Каждое слово запроса — начало какого-то слова в названии или метках («кот» ≠ «скот»).
          if (!words.every((w) => lw.some((x) => x.startsWith(w)) || tw.some((x) => x.startsWith(w)))) continue;
          // Выше — точное название, потом название с этого слова, потом совпадение в названии, потом в метках.
          const score = label === q ? 0 : label.startsWith(q) ? 1 : lw.some((x) => x === words[0]) ? 2 : words.every((w) => lw.some((x) => x.startsWith(w))) ? 3 : 4;
          found.push([score, n, e]);
        }
      }
      found.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      grid.replaceChildren(found.length ? el('div', { class: 'ep-cells' }, found.slice(0, 300).map((x) => cell(x[2]))) : el('p', { class: 'ep-empty', text: 'Ничего не нашлось' }));
    }, 120);
  });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); grid.querySelector('.ep-e')?.click(); }
  });
}

// ---------- Голосовые: запись ----------
/**
 * Запись голоса через тот же путь, что и в звонке (шумодав, эхоподавление).
 * onLevel(db, seconds) — для индикатора. Возвращает { stop() → {blob, dur, wave}, cancel() }.
 */
export async function recordVoice(openMic, levelDb, onLevel, maxSec = 600) {
  const mic = await openMic();
  const type = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
  const rec = new MediaRecorder(mic.stream, { mimeType: type, audioBitsPerSecond: 32000 });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  rec.start(250);
  const levels = [];
  const buf = new Float32Array(1024);
  const t0 = performance.now();
  let done = false;
  let raf = 0;
  let resolveAuto;
  const auto = new Promise((r) => { resolveAuto = r; });
  const loop = () => {
    if (done) return;
    const sec = (performance.now() - t0) / 1000;
    const db = levelDb(mic.analyser, buf);
    levels.push(db);
    onLevel?.(db, sec);
    if (sec >= maxSec) { resolveAuto(); return; }
    raf = requestAnimationFrame(loop);
  };
  loop();
  const finish = () => new Promise((resolve) => {
    done = true;
    cancelAnimationFrame(raf);
    rec.onstop = () => { mic.close(); resolve(); };
    if (rec.state !== 'inactive') rec.stop(); else { mic.close(); resolve(); }
  });
  return {
    note: mic.note,
    auto,
    async stop() {
      const dur = (performance.now() - t0) / 1000;
      await finish();
      return { blob: new Blob(chunks, { type }), dur, wave: makeWave(levels, 48) };
    },
    async cancel() { await finish(); },
  };
}

/** Волна из уровней громкости: n столбиков 0–255. */
export function makeWave(levels, n) {
  if (!levels.length) return new Array(n).fill(0);
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const a = Math.floor((i * levels.length) / n);
    const b = Math.max(a + 1, Math.floor(((i + 1) * levels.length) / n));
    let peak = -100;
    for (let j = a; j < b && j < levels.length; j += 1) peak = Math.max(peak, levels[j]);
    out.push(Math.round(Math.max(0, Math.min(1, (peak + 55) / 50)) * 255));
  }
  return out;
}

// ---------- Голосовые: проигрывание ----------
let playing = null; // { audio, node }
export function fmtSec(s) {
  const t = Math.max(0, Math.round(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

/**
 * Пузырь голосового: кнопка, волна, длительность. getUrl() → Promise<url> (расшифровка через ядро).
 * ready — скачан ли файл; пока нет — кнопка неактивна.
 */
export function voiceEl(voice, ready, getUrl) {
  const wave = Array.isArray(voice?.wave) && voice.wave.length ? voice.wave : new Array(48).fill(40);
  const bars = wave.map((v) => { const b = el('span'); b.style.height = `${Math.max(12, Math.round((v / 255) * 100))}%`; return b; });
  const waveBox = el('div', { class: 'vw' }, bars);
  const time = el('span', { class: 'vt', text: fmtSec(voice?.dur || 0) });
  const btn = el('button', { type: 'button', class: 'vbtn', 'aria-label': 'Слушать', disabled: !ready }, el('span', { class: 'tri' }));
  const speedOf = () => { try { const v = Number(localStorage.getItem('som.vspeed')); return [1, 1.5, 2].includes(v) ? v : 1; } catch { return 1; } };
  const spd = el('button', { type: 'button', class: 'vspeed', title: 'Скорость', text: `${String(speedOf()).replace('.', ',')}×` });
  spd.addEventListener('click', () => {
    const next = [1, 1.5, 2][([1, 1.5, 2].indexOf(speedOf()) + 1) % 3];
    try { localStorage.setItem('som.vspeed', String(next)); } catch { /* не страшно */ }
    spd.textContent = `${String(next).replace('.', ',')}×`;
    if (playing?.node === node) playing.audio.playbackRate = next;
  });
  const node = el('div', { class: 'voice' }, btn, waveBox, time, spd);
  const paint = (frac) => bars.forEach((b, i) => b.classList.toggle('on', i / bars.length < frac));
  const toggle = async () => {
    if (playing?.node === node) {
      if (playing.audio.paused) playing.audio.play(); else playing.audio.pause();
      return;
    }
    if (playing) { playing.audio.pause(); playing.reset(); }
    btn.disabled = true;
    try {
      const audio = new Audio(await getUrl());
      audio.playbackRate = speedOf();
      const reset = () => { node.classList.remove('playing'); paint(0); time.textContent = fmtSec(voice?.dur || 0); };
      playing = { audio, node, reset };
      audio.ontimeupdate = () => {
        const d = audio.duration && Number.isFinite(audio.duration) ? audio.duration : voice?.dur || 1;
        paint(audio.currentTime / d);
        time.textContent = fmtSec(audio.currentTime);
      };
      audio.onplay = () => node.classList.add('playing');
      audio.onpause = () => node.classList.remove('playing');
      audio.onended = () => { reset(); if (playing?.node === node) playing = null; };
      await audio.play();
    } finally {
      btn.disabled = false;
    }
  };
  btn.addEventListener('click', toggle);
  // Щелчок по волне — перемотка.
  waveBox.addEventListener('click', (e) => {
    if (playing?.node !== node) return;
    const r = waveBox.getBoundingClientRect();
    const d = playing.audio.duration && Number.isFinite(playing.audio.duration) ? playing.audio.duration : voice?.dur || 0;
    playing.audio.currentTime = ((e.clientX - r.left) / r.width) * d;
  });
  return node;
}
