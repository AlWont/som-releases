// Живое радио в мини-плеере: пластинка у станций без логотипа и визуализатор звука под плеером.
// Звук радио никуда не перенаправляем: снимаем с <audio> копию (captureStream) в отдельный AudioContext
// без выхода на колонки и только смотрим на неё. Громкость, выбор колонок и сам звук от этого не меняются.
// Всё стоит, когда окно спрятано или идёт игра; выключается в «Внешний вид → Анимация».

const root = document.documentElement;
const STEP = 5; // px от начала одной полосы до начала следующей
const BAR = 3; // ширина полосы, px
const LO = 40; // Гц — у центра (басы)
const HI = 14000; // Гц — по краям (верха)

const V = {
  audio: null, cv: null, g: null, logo: null,
  state: 'off',
  ctx: null, an: null, src: null, stream: null, bins: null,
  n: 0, edges: [], lv: new Float32Array(0), pk: new Float32Array(0), hold: new Float32Array(0),
  raf: 0, last: 0, t: 0, dpr: 1, col: null, w: 0, h: 0,
};
const S = { anim: null, disc: null, rate: 0, target: 0, raf: 0, t: 0, turn: 0 }; // пластинка

const still = () => root.dataset.radioFx === '0' || root.dataset.gaming === '1';
const away = () => document.hidden || root.dataset.bg === '1';

// ---------- Звук ----------
function ensureCtx() {
  if (V.ctx) return true;
  try {
    // Без устройства вывода: контекст только считает, в Windows не занимает колонки.
    try { V.ctx = new AudioContext({ sinkId: { type: 'none' }, latencyHint: 'playback' }); } catch { V.ctx = new AudioContext({ latencyHint: 'playback' }); }
    V.an = V.ctx.createAnalyser();
    V.an.fftSize = 2048;
    V.an.smoothingTimeConstant = 0.5;
    V.an.minDecibels = -86;
    V.an.maxDecibels = -27;
    V.bins = new Uint8Array(V.an.frequencyBinCount);
    bands();
    return true;
  } catch {
    V.ctx = null;
    return false;
  }
}
function attach() {
  if (!wanted() || !ensureCtx()) return;
  let s;
  try { s = V.audio.captureStream(); } catch { return; } // поток без CORS — просто без визуализатора
  if (!s.getAudioTracks().length) { for (const t of s.getTracks()) t.stop(); return; }
  detach();
  try {
    V.src = V.ctx.createMediaStreamSource(s);
    V.src.connect(V.an);
    V.stream = s;
  } catch { for (const t of s.getTracks()) t.stop(); }
  update();
}
function detach() {
  try { V.src?.disconnect(); } catch { /* уже */ }
  V.src = null;
  if (V.stream) for (const t of V.stream.getTracks()) t.stop();
  V.stream = null;
}
function listen(on) {
  const c = V.ctx;
  if (!c) return;
  if (on && c.state === 'suspended') c.resume().catch(() => {});
  else if (!on && c.state === 'running') c.suspend().catch(() => {});
}

// ---------- Полосы ----------
/** Частоты полос: от басов в центре к верхам по краям, равными шагами по слуху (логарифм). */
function bands() {
  const n = V.n;
  if (!n || !V.bins) return;
  const per = (V.ctx?.sampleRate || 48000) / 2 / V.bins.length;
  const e = [];
  let prev = -1;
  for (let i = 0; i <= n; i += 1) {
    let b = Math.round((LO * (HI / LO) ** (i / n)) / per);
    if (b <= prev) b = prev + 1;
    e.push(Math.min(b, V.bins.length - 1));
    prev = b;
  }
  V.edges = e;
}
function resize() {
  const cv = V.cv;
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth;
  const h = cv.clientHeight;
  if (!w || !h) return;
  V.dpr = dpr;
  V.w = Math.round(w * dpr);
  V.h = Math.round(h * dpr);
  if (cv.width !== V.w) cv.width = V.w;
  if (cv.height !== V.h) cv.height = V.h;
  const n = Math.max(4, Math.floor((w / 2 - 1) / STEP));
  if (n !== V.n) {
    const grow = (a) => { const b = new Float32Array(n); b.set(a.subarray(0, n)); return b; };
    V.lv = grow(V.lv);
    V.pk = grow(V.pk);
    V.hold = grow(V.hold);
    V.n = n;
    bands();
  }
  colors();
  draw();
}

// ---------- Цвета темы ----------
function rgb(c) {
  const m = /rgba?\(([^)]+)\)/.exec(c);
  if (!m) return [216, 199, 163];
  return m[1].split(/[\s,/]+/).slice(0, 3).map(Number);
}
const mix = (a, b, k) => a.map((x, i) => Math.round(x + (b[i] - x) * k));
const css = (c, a = 1) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;
function colors() {
  if (!V.g || !V.h) return;
  const cv = V.cv;
  const read = (v) => { cv.style.color = `var(${v})`; return rgb(getComputedStyle(cv).color); };
  const acc = read('--accent');
  const text = read('--text');
  cv.style.color = '';
  const g = V.g;
  const H = V.h;
  const d = V.dpr;
  const cy = Math.round(H * 0.66);
  const top = cy - Math.round(3 * d);
  const tip = mix(acc, text, 0.4);
  const gTop = g.createLinearGradient(0, cy - top, 0, cy);
  gTop.addColorStop(0, css(tip));
  gTop.addColorStop(1, css(acc));
  const gRef = g.createLinearGradient(0, cy, 0, H);
  gRef.addColorStop(0, css(acc, 0.42));
  gRef.addColorStop(1, css(acc, 0));
  const fade = g.createLinearGradient(0, 0, V.w, 0);
  fade.addColorStop(0, 'rgba(0,0,0,0.35)');
  fade.addColorStop(0.5, 'rgba(0,0,0,1)');
  fade.addColorStop(1, 'rgba(0,0,0,0.35)');
  V.col = { gTop, gRef, fade, cap: css(tip, 0.95), cy, top, ref: H - cy - Math.round(1 * d) };
}

// ---------- Кадр ----------
function wanted() { return V.state !== 'off' && Boolean(V.cv?.offsetParent) && !away() && !still(); }
function update() {
  const run = wanted();
  listen(run && V.state === 'playing' && Boolean(V.src));
  if (run && !V.raf) { V.last = 0; V.raf = requestAnimationFrame(frame); }
  if (!run && V.raf) { cancelAnimationFrame(V.raf); V.raf = 0; }
}
function levels(dt) {
  const n = V.n;
  const live = V.state === 'playing' && V.src && V.ctx?.state === 'running';
  if (live) V.an.getByteFrequencyData(V.bins);
  let any = false;
  for (let i = 0; i < n; i += 1) {
    let v = 0;
    if (live) {
      let m = 0;
      for (let b = V.edges[i]; b < V.edges[i + 1]; b += 1) if (V.bins[b] > m) m = V.bins[b];
      v = Math.min(1, (m / 255) * (0.9 + (0.5 * i) / (n - 1))); // верха тише басов — чуть поднимаем
      v **= 1.3;
    } else if (V.state === 'connecting') {
      v = 0.05 + 0.06 * (0.5 + 0.5 * Math.sin(V.t * 4.2 - i * 0.5)); // ждём звук — по полосам бежит лёгкая волна
    }
    const cur = V.lv[i];
    V.lv[i] = v > cur ? cur + (v - cur) * Math.min(1, dt * 28) : Math.max(v, cur - dt * 1.7);
    // Пики: держатся мгновение и медленно опускаются.
    if (V.lv[i] >= V.pk[i]) { V.pk[i] = V.lv[i]; V.hold[i] = 0.32; } else if ((V.hold[i] -= dt) < 0) V.pk[i] = Math.max(0, V.pk[i] - dt * 0.75);
    if (V.lv[i] > 0.002 || V.pk[i] > 0.002) any = true;
  }
  return any;
}
function draw() {
  const { g, col } = V;
  if (!g || !col) return;
  const W = V.w;
  const H = V.h;
  const d = V.dpr;
  g.globalCompositeOperation = 'source-over';
  g.clearRect(0, 0, W, H);
  const cx = W / 2;
  const bw = BAR * d;
  const step = STEP * d;
  const gap = step - bw;
  const r = bw / 2;
  const top = new Path2D();
  const ref = new Path2D();
  const caps = new Path2D();
  let caps0 = false;
  for (let i = 0; i < V.n; i += 1) {
    const v = V.lv[i];
    const ht = Math.max(1.2 * d, v * col.top);
    const hr = Math.max(0.8 * d, v * col.ref);
    const p = V.pk[i];
    for (const x of [cx + gap / 2 + i * step, cx - gap / 2 - i * step - bw]) {
      top.roundRect(x, col.cy - ht, bw, ht, [r, r, 0, 0]);
      ref.roundRect(x, col.cy + d, bw, hr, [0, 0, r, r]);
      if (p > 0.05) { caps.rect(x, Math.round(col.cy - p * col.top - 2.4 * d), bw, Math.max(1, Math.round(1.3 * d))); caps0 = true; }
    }
  }
  g.fillStyle = col.gTop;
  g.fill(top);
  g.fillStyle = col.gRef;
  g.fill(ref);
  if (caps0) { g.fillStyle = col.cap; g.fill(caps); }
  // К краям полосы мягко гаснут.
  g.globalCompositeOperation = 'destination-in';
  g.fillStyle = col.fade;
  g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'source-over';
}
function frame(now) {
  V.raf = 0;
  if (!wanted()) { update(); return; }
  // С видеокартой: в фокусе — 60 кадров, без фокуса — 30. Без видеокарты — 24, это дешевле всего окна.
  const fps = soft() ? 24 : document.hasFocus() ? 60 : 30;
  if (V.last && now - V.last < 1000 / fps - 3) { V.raf = requestAnimationFrame(frame); return; }
  const dt = V.last ? Math.min(0.1, (now - V.last) / 1000) : 1 / fps;
  V.last = now;
  V.t += dt;
  if ((window.devicePixelRatio || 1) !== V.dpr) resize();
  const any = levels(dt);
  draw();
  const turning = soft() && spinSoft(dt);
  // Пауза: полосы опустились и пластинка встала — рисовать больше нечего, ждём следующего включения.
  if (!any && !turning && V.state !== 'playing' && V.state !== 'connecting') { listen(false); return; }
  V.raf = requestAnimationFrame(frame);
}

/** Окно снова видно (или кончилась игра): если радио играет, а звук ещё не подключён — подключить. */
function wake() {
  if (V.state === 'playing' && !V.src && wanted() && !V.audio.paused) attach();
  else update();
}

// ---------- Пластинка ----------
// С видеокартой пластинку крутит сама видеокарта (анимация без участия страницы).
// Без неё каждое движение — перерисовка всего окна, поэтому крутим её сами, в тех же кадрах, что и полосы, и реже.
const soft = () => root.dataset.gpu === '0';
/** Пластинка раскручивается за полсекунды и останавливается с выбегом, как проигрыватель. */
function spin(target) {
  const disc = V.logo?.querySelector('.v-disc') || null;
  if (S.disc !== disc) { S.anim?.cancel(); S.anim = null; S.disc = disc; S.rate = 0; S.turn = 0; }
  if (!disc) return;
  if (still()) target = 0;
  S.target = target;
  if (soft()) {
    if (S.anim) { S.turn = ((S.anim.currentTime || 0) / 1800) % 1; S.anim.cancel(); S.anim = null; }
    disc.style.transform = `rotate(${S.turn.toFixed(4)}turn)`;
    if (still() || away()) S.rate = target;
    update();
    return;
  }
  if (!S.anim) {
    disc.style.transform = '';
    S.anim = disc.animate([{ transform: 'rotate(0turn)' }, { transform: 'rotate(1turn)' }], { duration: 1800, iterations: Infinity });
    S.anim.currentTime = S.turn * 1800;
    S.anim.pause();
    if (S.rate) { S.anim.playbackRate = S.rate; S.anim.play(); }
  }
  if (still() || away()) {
    // Движения не видно (или оно не нужно) — сразу встаём, без выбега.
    S.rate = target;
    if (!target) S.anim.pause(); else { S.anim.playbackRate = target; S.anim.play(); }
    return;
  }
  if (!S.raf && S.rate !== target) { S.t = performance.now(); S.raf = requestAnimationFrame(spinStep); }
}
const ease = (dt) => {
  const d = S.target - S.rate;
  const k = d > 0 ? dt / 0.5 : dt / 1.3;
  S.rate = Math.abs(d) <= k ? S.target : S.rate + Math.sign(d) * k;
  if (S.rate < 0.002) S.rate = 0;
};
function spinStep(now) {
  S.raf = 0;
  const a = S.anim;
  if (!a) return;
  ease(Math.min(0.1, (now - S.t) / 1000));
  S.t = now;
  if (!S.rate) { a.pause(); return; }
  a.playbackRate = S.rate;
  if (a.playState !== 'running') a.play();
  if (S.rate !== S.target) S.raf = requestAnimationFrame(spinStep);
}
/** Без видеокарты: повернуть пластинку в кадре визуализатора. true — она ещё крутится. */
function spinSoft(dt) {
  if (!S.disc || S.anim) return false;
  ease(dt);
  if (S.rate) {
    S.turn = (S.turn + (S.rate * dt) / 1.8) % 1;
    S.disc.style.transform = `rotate(${S.turn.toFixed(4)}turn)`;
  }
  return S.rate > 0 || S.target > 0;
}
const spinFor = (state) => (state === 'playing' ? 1 : state === 'connecting' ? 0.22 : 0);

// ---------- Снаружи ----------
/** Состояние радио поменялось (или станция): обновить пластинку и визуализатор. */
export function radioFx(state) {
  V.state = state;
  spin(spinFor(state));
  if (state === 'off') { detach(); V.lv.fill(0); V.pk.fill(0); draw(); }
  update();
}
/** Отчёт: работает ли визуализатор. */
export const radioFxInfo = () => (V.ctx ? `визуализатор: ${V.src ? 'слушает' : 'ждёт'} · ${V.ctx.state}` : 'визуализатор: не запускался');

export function initRadioFx({ audio, canvas, logo }) {
  V.audio = audio;
  V.cv = canvas;
  V.logo = logo;
  V.g = canvas.getContext('2d');
  audio.addEventListener('playing', attach);
  audio.addEventListener('emptied', detach);
  new ResizeObserver(() => resize()).observe(canvas);
  // Тема, фон окна, игра, выключатель в настройках — пересчитать цвета и решить, рисовать ли.
  new MutationObserver((list) => {
    if (list.some((m) => /^data-(theme|scheme|ui)$/.test(m.attributeName))) requestAnimationFrame(() => { colors(); draw(); });
    spin(spinFor(V.state));
    wake();
  }).observe(root, { attributes: true, attributeFilter: ['data-theme', 'data-scheme', 'data-ui', 'data-bg', 'data-gaming', 'data-radio-fx', 'data-gpu'] });
  document.addEventListener('visibilitychange', wake);
  resize();
}
