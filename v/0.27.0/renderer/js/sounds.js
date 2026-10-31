// Звуки событий. Всё синтезируется на месте — никаких звуковых файлов.

export const SOUND_KINDS = {
  message: 'Новое сообщение',
  online: 'Друг появился в сети',
  call: 'Вход и выход из звонка, начало демки',
  mute: 'Микрофон вкл/выкл и push-to-talk',
};

function pref(key, fallback) {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function setPref(key, value) {
  try { localStorage.setItem(key, value); } catch { /* без памяти — не страшно */ }
}

export const soundPrefs = {
  on(kind) { return pref(`som.snd.${kind}`, kind === 'mute' ? '0' : '1') === '1'; },
  set(kind, v) { setPref(`som.snd.${kind}`, v ? '1' : '0'); },
  get volume() { const v = Number(pref('som.snd.vol', 60)); return Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 60; },
  set volume(v) { setPref('som.snd.vol', String(v)); },
};

let ctx = null;
let sinkId = '';
let idle = 0;
// Между звуками звук не держим открытым: иначе Windows без конца гоняет тишину через колонки.
function sleepSoon(ms) {
  clearTimeout(idle);
  idle = setTimeout(() => { if (ctx && ctx.state === 'running') ctx.suspend().catch(() => {}); }, ms);
}
function audio(out) {
  if (!ctx || ctx.state === 'closed') ctx = new AudioContext({ latencyHint: 'interactive' });
  const want = out && out !== 'default' ? out : '';
  if (want !== sinkId && typeof ctx.setSinkId === 'function') { sinkId = want; ctx.setSinkId(want).catch(() => {}); }
  if (ctx.state !== 'running') ctx.resume().catch(() => {});
  return ctx;
}

// Мягкий тон: синус с обертоном и быстрым затуханием.
function note(c, out, t, f, len, vel) {
  const g = c.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vel, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  g.connect(out);
  for (const [mul, amp] of [[1, 1], [2, 0.18], [3, 0.05]]) {
    const o = c.createOscillator();
    const og = c.createGain();
    o.type = 'sine';
    o.frequency.value = f * mul;
    og.gain.value = amp;
    o.connect(og);
    og.connect(g);
    o.start(t);
    o.stop(t + len + 0.05);
  }
}

const SHAPES = {
  message: [[0, 1318.5, 0.25, 0.5], [0.09, 1760, 0.35, 0.4]],
  online: [[0, 659.3, 0.3, 0.35], [0.11, 987.8, 0.4, 0.35]],
  join: [[0, 523.3, 0.25, 0.35], [0.08, 659.3, 0.25, 0.35], [0.16, 784, 0.45, 0.35]],
  leave: [[0, 784, 0.25, 0.35], [0.08, 659.3, 0.25, 0.35], [0.16, 523.3, 0.45, 0.35]],
  streamOn: [[0, 880, 0.2, 0.3], [0.07, 1174.7, 0.35, 0.3]],
  streamOff: [[0, 1174.7, 0.2, 0.3], [0.07, 880, 0.35, 0.3]],
  muteOn: [[0, 392, 0.12, 0.35]],
  muteOff: [[0, 587.3, 0.12, 0.35]],
  pttOn: [[0, 1046.5, 0.05, 0.18]],
  pttOff: [[0, 784, 0.05, 0.14]],
};
const KIND_OF = {
  message: 'message', online: 'online', join: 'call', leave: 'call', streamOn: 'call', streamOff: 'call',
  muteOn: 'mute', muteOff: 'mute', pttOn: 'mute', pttOff: 'mute',
};

/** Сыграть звук события. name — ключ из SHAPES; out — колонки из настроек; force — даже если выключен. */
export function play(name, out, force = false) {
  const shape = SHAPES[name];
  if (!shape) return;
  if (!force && !soundPrefs.on(KIND_OF[name])) return;
  const vol = soundPrefs.volume / 100;
  if (vol <= 0) return;
  try {
    const c = audio(out);
    const master = c.createGain();
    master.gain.value = vol * 0.6;
    master.connect(c.destination);
    const t = c.currentTime + 0.02;
    for (const [dt, f, len, vel] of shape) note(c, master, t + dt, f, len, vel);
    setTimeout(() => master.disconnect(), 1500);
    sleepSoon(2500);
  } catch { /* звук не обязателен */ }
}

// ---------- Push-to-talk: клавиши ----------
// KeyboardEvent.code → код клавиши Windows (для опроса в ядре).
const VK = {
  Space: 0x20, Tab: 0x09, CapsLock: 0x14, Backquote: 0xc0, Minus: 0xbd, Equal: 0xbb, BracketLeft: 0xdb, BracketRight: 0xdd,
  Backslash: 0xdc, Semicolon: 0xba, Quote: 0xde, Comma: 0xbc, Period: 0xbe, Slash: 0xbf, Enter: 0x0d, Backspace: 0x08,
  ShiftLeft: 0xa0, ShiftRight: 0xa1, ControlLeft: 0xa2, ControlRight: 0xa3, AltLeft: 0xa4, AltRight: 0xa5,
  Insert: 0x2d, Delete: 0x2e, Home: 0x24, End: 0x23, PageUp: 0x21, PageDown: 0x22,
  ArrowLeft: 0x25, ArrowUp: 0x26, ArrowRight: 0x27, ArrowDown: 0x28, Pause: 0x13, ScrollLock: 0x91,
  NumpadMultiply: 0x6a, NumpadAdd: 0x6b, NumpadSubtract: 0x6d, NumpadDecimal: 0x6e, NumpadDivide: 0x6f,
};
for (let i = 0; i < 26; i += 1) VK[`Key${String.fromCharCode(65 + i)}`] = 0x41 + i;
for (let i = 0; i < 10; i += 1) { VK[`Digit${i}`] = 0x30 + i; VK[`Numpad${i}`] = 0x60 + i; }
for (let i = 1; i <= 24; i += 1) VK[`F${i}`] = 0x6f + i;
// Кнопки мыши: средняя и боковые (MouseEvent.button 1, 3, 4).
const MOUSE = { 1: { code: 'Mouse3', vk: 0x04, label: 'Колёсико мыши' }, 3: { code: 'Mouse4', vk: 0x05, label: 'Боковая кнопка мыши 1' }, 4: { code: 'Mouse5', vk: 0x06, label: 'Боковая кнопка мыши 2' } };

const NAMES = {
  Space: 'Пробел', CapsLock: 'Caps Lock', Backquote: '` (Ё)', ShiftLeft: 'Левый Shift', ShiftRight: 'Правый Shift',
  ControlLeft: 'Левый Ctrl', ControlRight: 'Правый Ctrl', AltLeft: 'Левый Alt', AltRight: 'Правый Alt', Tab: 'Tab',
};
export function keyFromEvent(e) {
  if (e instanceof MouseEvent && !(e instanceof KeyboardEvent)) return MOUSE[e.button] || null;
  const vk = VK[e.code];
  if (!vk) return null;
  const label = NAMES[e.code] || e.code.replace(/^Key|^Digit/, '').replace(/^Numpad/, 'Num ');
  return { code: e.code, vk, label };
}
export const mouseCode = (button) => MOUSE[button]?.code || '';
