// Звуковая панель в звонке: короткий звук по кнопке слышат все в звонке (даже при выключенном микрофоне).
// Встроенные звуки синтезируются на месте; свои — файлы до 10 секунд (library.cjs, somlib://sound/…).
import { showPanel, closePopup, showMenu, showEmojiPicker } from './msgtools.js';

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
const pref = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const setPref = (k, v) => { try { localStorage.setItem(k, v); } catch { /* не страшно */ } };
const vol = () => Math.max(0, Math.min(100, Number(pref('som.sb.vol', '70')) || 0)) / 100;

let X = { activeMic: () => null, deafened: () => false, out: () => 'default', toast: () => {}, onPlay: null };
const SR = 48000;

// ---------- Встроенные звуки (синтез) ----------
function noise(ctx, sec) {
  const b = ctx.createBuffer(1, Math.floor(SR * sec), SR);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i += 1) d[i] = Math.random() * 2 - 1;
  return b;
}
function env(g, t, peak, a, d) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
}
function tone(ctx, out, t, f, len, { type = 'sine', peak = 0.5, a = 0.005, to = 0, lp = 0, vib = 0 } = {}) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + len);
  if (vib) {
    const l = ctx.createOscillator();
    l.frequency.value = 6;
    const lg = ctx.createGain();
    lg.gain.setValueAtTime(0, t);
    lg.gain.linearRampToValueAtTime(f * vib, t + len * 0.6);
    l.connect(lg).connect(o.frequency);
    l.start(t); l.stop(t + len + 0.05);
  }
  const g = ctx.createGain();
  env(g, t, peak, a, len);
  let node = o;
  if (lp) { const f2 = ctx.createBiquadFilter(); f2.type = 'lowpass'; f2.frequency.value = lp; o.connect(f2); node = f2; }
  node.connect(g).connect(out);
  o.start(t); o.stop(t + a + len + 0.05);
}
function hit(ctx, out, t, { f = 2000, q = 0.8, len = 0.15, peak = 0.6, type = 'bandpass', nb }) {
  const s = ctx.createBufferSource();
  s.buffer = nb;
  const bp = ctx.createBiquadFilter();
  bp.type = type;
  bp.frequency.value = f;
  bp.Q.value = q;
  const g = ctx.createGain();
  env(g, t, peak, 0.002, len);
  s.connect(bp).connect(g).connect(out);
  s.start(t, Math.random() * 0.5); s.stop(t + len + 0.05);
}
const NOTE = (n) => 440 * 2 ** ((n - 69) / 12);
const BUILTIN = [
  { id: 'b:rimshot', emoji: '🥁', name: 'Ба-дум-тсс', len: 1.8, make(ctx, out, nb) {
    tone(ctx, out, 0.02, 190, 0.22, { to: 95, peak: 0.9 });
    tone(ctx, out, 0.24, 140, 0.25, { to: 75, peak: 0.9 });
    hit(ctx, out, 0.48, { f: 7000, type: 'highpass', len: 1.2, peak: 0.55, nb });
    for (const m of [1, 1.48, 2.2]) tone(ctx, out, 0.48, 520 * m, 0.9, { type: 'square', peak: 0.04, lp: 6000 });
  } },
  { id: 'b:fanfare', emoji: '🎺', name: 'Фанфары', len: 1.6, make(ctx, out) {
    const ch = [67, 72, 76];
    for (const t of [0, 0.15, 0.3]) for (const n of ch) tone(ctx, out, t, NOTE(n), 0.1, { type: 'sawtooth', peak: 0.12, lp: 2600, a: 0.01 });
    for (const n of [67, 72, 76, 79]) tone(ctx, out, 0.46, NOTE(n), 1.0, { type: 'sawtooth', peak: 0.11, lp: 2600, a: 0.02, vib: 0.006 });
  } },
  { id: 'b:roll', emoji: '🪘', name: 'Барабанная дробь', len: 2.6, make(ctx, out, nb) {
    for (let t = 0; t < 1.6; t += 0.045) hit(ctx, out, t, { f: 1900, q: 0.7, len: 0.05, peak: 0.12 + (t / 1.6) * 0.45, nb });
    tone(ctx, out, 1.62, 160, 0.3, { to: 80, peak: 0.9 });
    hit(ctx, out, 1.62, { f: 6500, type: 'highpass', len: 1.0, peak: 0.5, nb });
  } },
  { id: 'b:trombone', emoji: '😞', name: 'Грустный тромбон', len: 2.4, make(ctx, out) {
    [[62, 0, 0.34], [61, 0.38, 0.34], [60, 0.76, 0.34], [59, 1.14, 1.1]].forEach(([n, t, l], i) => tone(ctx, out, t, NOTE(n), l, { type: 'sawtooth', peak: 0.22, lp: 1100, a: 0.04, vib: i === 3 ? 0.02 : 0 }));
  } },
  { id: 'b:ding', emoji: '🔔', name: 'Дзынь', len: 1.8, make(ctx, out) {
    for (const [m, a, l] of [[1, 0.5, 1.6], [2.76, 0.2, 0.6], [5.4, 0.08, 0.3]]) tone(ctx, out, 0.01, 1318.5 * m, l, { peak: a, a: 0.003 });
  } },
  { id: 'b:applause', emoji: '👏', name: 'Аплодисменты', len: 2.6, make(ctx, out, nb) {
    for (let i = 0; i < 160; i += 1) {
      const t = Math.random() * 2.2;
      const swell = Math.sin(Math.PI * Math.min(1, t / 2.2));
      hit(ctx, out, t, { f: 1200 + Math.random() * 2000, q: 1.2, len: 0.03 + Math.random() * 0.03, peak: 0.08 + swell * 0.18, nb });
    }
  } },
  { id: 'b:crickets', emoji: '🦗', name: 'Сверчки', len: 2.4, make(ctx, out) {
    for (const [base, pan] of [[4300, -0.5], [4700, 0.5]]) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      p.connect(out);
      for (let t = pan < 0 ? 0 : 0.17; t < 2.1; t += 0.36) for (let k = 0; k < 3; k += 1) tone(ctx, p, t + k * 0.045, base, 0.03, { peak: 0.12, a: 0.004 });
    }
  } },
  { id: 'b:horn', emoji: '📯', name: 'Гудок', len: 1.5, make(ctx, out) {
    for (const f of [466, 470, 587, 591]) tone(ctx, out, 0.01, f * 0.97, 1.1, { type: 'sawtooth', peak: 0.1, lp: 3200, a: 0.03, to: f });
  } },
  { id: 'b:correct', emoji: '✅', name: 'Верно!', len: 1.2, make(ctx, out) {
    tone(ctx, out, 0.01, NOTE(88), 0.35, { peak: 0.35 });
    tone(ctx, out, 0.16, NOTE(93), 0.8, { peak: 0.35 });
  } },
  { id: 'b:wrong', emoji: '❌', name: 'Мимо', len: 0.9, make(ctx, out) {
    tone(ctx, out, 0.01, 150, 0.6, { type: 'square', peak: 0.16, lp: 1800 });
    tone(ctx, out, 0.01, 156, 0.6, { type: 'square', peak: 0.16, lp: 1800 });
  } },
];
const buffers = new Map(); // id → Promise<AudioBuffer>
function builtinBuffer(def) {
  if (!buffers.has(def.id)) {
    const ctx = new OfflineAudioContext(2, Math.floor(SR * def.len), SR);
    const out = ctx.createGain();
    out.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    out.connect(comp).connect(ctx.destination);
    def.make(ctx, out, noise(ctx, 2));
    buffers.set(def.id, ctx.startRendering());
  }
  return buffers.get(def.id);
}
let decodeCtx = null;
function userBuffer(s) {
  const key = `u:${s.id}`;
  if (!buffers.has(key)) {
    decodeCtx ||= new AudioContext({ sampleRate: SR });
    buffers.set(key, fetch(`somlib://sound/${s.file}`).then((r) => r.arrayBuffer()).then((b) => decodeCtx.decodeAudioData(b)));
  }
  return buffers.get(key);
}

// ---------- Проигрывание ----------
let mine = []; // свои звуки из библиотеки
let playing = null; // { id, nodes: [] }
let monitor = null;
function stop() {
  for (const n of playing?.nodes || []) { try { n.stop(); } catch { /* уже */ } }
  playing = null;
  for (const b of document.querySelectorAll('.sb-tile.on')) b.classList.remove('on');
}
export async function play(id) {
  const def = BUILTIN.find((b) => b.id === id);
  const own = def ? null : mine.find((s) => s.id === id);
  if (!def && !own) return;
  const buf = await (def ? builtinBuffer(def) : userBuffer(own)).catch(() => null);
  if (!buf) { X.toast('Звук не читается — удалите его и добавьте заново.', 'bad'); return; }
  stop();
  const nodes = [];
  // Всем в звонке — через микрофон, мимо выключателя голоса.
  const mic = X.activeMic();
  if (mic?.fx) {
    const s = mic.ctx.createBufferSource();
    s.buffer = buf;
    const g = mic.ctx.createGain();
    g.gain.value = vol();
    s.connect(g).connect(mic.fx);
    s.start();
    nodes.push(s);
  }
  // Себе — в свои колонки (если звук не выключен).
  if (!X.deafened()) {
    monitor ||= new AudioContext({ latencyHint: 'interactive' });
    const out = X.out();
    if (typeof monitor.setSinkId === 'function') monitor.setSinkId(out && out !== 'default' ? out : '').catch(() => {});
    if (monitor.state !== 'running') monitor.resume().catch(() => {});
    const s = monitor.createBufferSource();
    s.buffer = buf;
    const g = monitor.createGain();
    g.gain.value = vol() * 0.8;
    s.connect(g).connect(monitor.destination);
    s.start();
    nodes.push(s);
  }
  playing = { id, nodes };
  nodes[0].onended = () => { if (playing?.id === id) stop(); };
  for (const b of document.querySelectorAll(`.sb-tile[data-id="${CSS.escape(id)}"]`)) b.classList.add('on');
  X.onPlay?.(def ? def : own);
}

// ---------- Свой звук ----------
function pickAudio() {
  return new Promise((resolve) => {
    const inp = h('input', { type: 'file', accept: 'audio/*,.mp3,.ogg,.wav,.m4a,.aac,.flac,.webm', hidden: true });
    inp.addEventListener('change', () => { resolve(inp.files?.[0] || null); inp.remove(); });
    inp.addEventListener('cancel', () => { resolve(null); inp.remove(); });
    document.body.append(inp);
    inp.click();
  });
}
/** Длиннее 10 секунд или больше 1 МБ — берём первые 10 секунд и сохраняем в WAV. */
function wav(buf) {
  const ch = buf.numberOfChannels > 1 ? 2 : 1;
  const n = buf.length;
  const out = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const w = (o, s) => { for (let i = 0; i < s.length; i += 1) out.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); out.setUint32(4, 36 + n * ch * 2, true); w(8, 'WAVEfmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, ch, true);
  out.setUint32(24, buf.sampleRate, true); out.setUint32(28, buf.sampleRate * ch * 2, true); out.setUint16(32, ch * 2, true); out.setUint16(34, 16, true); w(36, 'data'); out.setUint32(40, n * ch * 2, true);
  const data = [...Array(ch)].map((_, c) => buf.getChannelData(c));
  for (let i = 0; i < n; i += 1) for (let c = 0; c < ch; c += 1) out.setInt16(44 + (i * ch + c) * 2, Math.max(-1, Math.min(1, data[c][i])) * 32767, true);
  return new Uint8Array(out.buffer);
}
async function addOwn(rerender) {
  const file = await pickAudio();
  if (!file) return;
  try {
    let bytes = new Uint8Array(await file.arrayBuffer());
    let mime = file.type || ({ mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', webm: 'audio/webm' })[file.name.split('.').pop().toLowerCase()] || '';
    decodeCtx ||= new AudioContext({ sampleRate: SR });
    const buf = await decodeCtx.decodeAudioData(bytes.slice().buffer).catch(() => null);
    if (!buf) throw new Error('файл не читается как звук');
    if (buf.duration > 10.2 || bytes.length > 1024 * 1024 || !mime) {
      const sec = Math.min(10, buf.duration);
      const off = new OfflineAudioContext(1, Math.ceil(32000 * sec), 32000);
      const s = off.createBufferSource();
      s.buffer = buf;
      const g = off.createGain();
      g.gain.setValueAtTime(1, 0);
      g.gain.setValueAtTime(1, Math.max(0, sec - 0.15));
      g.gain.linearRampToValueAtTime(0, sec);
      s.connect(g).connect(off.destination);
      s.start();
      bytes = wav(await off.startRendering());
      mime = 'audio/wav';
      if (buf.duration > 10.2) X.toast(`Звук длиннее 10 секунд — взяты первые 10.`, 'ok');
    }
    const r = await window.som.lib.addSound({ bytes, mime, name: file.name.replace(/\.[^.]+$/, '').slice(0, 40), emoji: '🔊' });
    if (!r?.ok) throw new Error(r?.error || 'не получилось');
    await reload();
    rerender();
  } catch (err) { X.toast(`Звук: ${err.message}`, 'bad'); }
}
async function reload() {
  const r = await window.som.lib.sounds().catch(() => null);
  mine = r?.ok ? r.result.items : [];
}

// ---------- Окно панели ----------
export async function openSoundboard(anchor) {
  await reload();
  const node = h('div', { class: 'pop-sounds', role: 'dialog', 'aria-label': 'Звуковая панель' });
  const render = () => {
    const tile = (s, own) => {
      const b = h('button', { type: 'button', class: `sb-tile${playing?.id === s.id ? ' on' : ''}`, dataset: { id: s.id }, title: own ? `${s.name} — правый щелчок: изменить` : s.name, onclick: () => (playing?.id === s.id ? stop() : play(s.id)) },
        h('span', { class: 'sb-emoji', 'aria-hidden': 'true', text: s.emoji }), h('span', { class: 'sb-name', text: s.name }));
      if (own) {
        b.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation();
          showMenu(e.clientX, e.clientY, [
            { label: 'Сменить значок', onclick: () => showEmojiPicker(b, { onPick: async (em) => { if (em) { await window.som.lib.editSound(s.id, { emoji: em }); await reload(); openSoundboard(anchor); } } }) },
            { label: 'Переименовать', onclick: () => rename(s) },
            { label: 'Удалить', danger: true, onclick: async () => { await window.som.lib.editSound(s.id, { remove: true }); buffers.delete(`u:${s.id}`); await reload(); openSoundboard(anchor); } },
          ]);
        });
      }
      return b;
    };
    const rename = (s) => {
      const inp = h('input', { type: 'text', class: 'stk-input', maxlength: '40', value: s.name });
      const ok = async () => { await window.som.lib.editSound(s.id, { name: inp.value }); await reload(); openSoundboard(anchor); };
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ok(); } });
      node.replaceChildren(h('div', { class: 'stk-empty' }, h('p', { text: 'Название звука' }), inp, h('div', { class: 'inline' }, h('button', { type: 'button', class: 'btn primary', text: 'Сохранить', onclick: ok }), h('button', { type: 'button', class: 'btn', text: 'Отмена', onclick: render }))));
      inp.focus();
      inp.select();
    };
    const slider = h('input', { type: 'range', min: '0', max: '100', step: '5', value: String(Math.round(vol() * 100)), 'aria-label': 'Громкость звуков для всех' });
    const pct = h('span', { class: 'sb-pct', text: `${Math.round(vol() * 100)}%` });
    slider.addEventListener('input', () => { setPref('som.sb.vol', slider.value); pct.textContent = `${slider.value}%`; });
    node.replaceChildren(
      h('div', { class: 'sb-head' }, h('b', { text: 'Звуковая панель' }), h('span', { class: 'hint', text: 'слышат все в звонке' })),
      h('div', { class: 'sb-grid' }, BUILTIN.map((s) => tile(s, false)), mine.map((s) => tile(s, true)),
        h('button', { type: 'button', class: 'sb-tile add', title: 'Свой звук: mp3, ogg, wav, m4a — до 10 секунд', onclick: () => addOwn(render) }, h('span', { class: 'sb-emoji', text: '＋' }), h('span', { class: 'sb-name', text: 'Свой звук' }))),
      h('label', { class: 'sb-vol' }, h('span', { text: 'Громкость для всех' }), slider, pct));
  };
  render();
  const r = anchor.getBoundingClientRect();
  showPanel(r.left, r.top, node);
  requestAnimationFrame(() => {
    const nr = node.getBoundingClientRect();
    node.style.top = `${Math.max(8, r.top - nr.height - 8)}px`;
    node.style.left = `${Math.max(8, Math.min(window.innerWidth - nr.width - 8, r.left + r.width / 2 - nr.width / 2))}px`;
  });
}

export function initSoundboard(deps) {
  X = { ...X, ...deps };
}
export const BUILTIN_SOUNDS = BUILTIN.map(({ id, emoji, name }) => ({ id, emoji, name }));
export { stop as stopSound, closePopup };
