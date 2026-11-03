// Заставка при запуске: в глубокой воде справа налево проплывает сом, за его хвостом проявляется «Som», всплывает значок.
// Всё рисуется на <canvas> (сом — тот же, что на значке, js/catfish.js), звук синтезируется на месте.
// Щелчок или любая клавиша — пропустить. Выключается в настройках («Внешний вид → Заставка»).
import { soundPrefs } from './sounds.js';
import { drawCatfish, drawBubble } from './catfish.js';

function pref(key, def) { try { return localStorage.getItem(key) ?? def; } catch { return def; } }
function setPref(key, v) { try { localStorage.setItem(key, v); } catch { /* без памяти — не страшно */ } }
export const introPrefs = {
  get on() { return pref('som.intro', '1') === '1'; },
  set on(v) { setPref('som.intro', v ? '1' : '0'); },
  get sound() { return pref('som.intro.sound', '1') === '1'; },
  set sound(v) { setPref('som.intro.sound', v ? '1' : '0'); },
};

// Цвета значка Som.
const COL = { teal: '150, 196, 205', word: '#F1E9D6', glow: '216, 199, 163' };
// Время, с: сом плывёт SWIM_FROM…SWIM_FROM+SWIM_FOR, потом заставка тает.
const SWIM_FROM = 0.15;
const SWIM_FOR = 2.3;
// Надпись проявляется к ~1,75 с; дальше она держится, чтобы её успели рассмотреть.
const FADE_AT = 4.3;
const FADE_FOR = 0.6;
// Скорость: быстро вплывает, посередине замедляется (видно сома), быстро уплывает.
const EASE = 0.55;
const swimF = (u) => u + EASE * Math.sin(2 * Math.PI * u) / (2 * Math.PI);
const swimV = (u) => 1 + EASE * Math.cos(2 * Math.PI * u);
const clamp01 = (x) => Math.max(0, Math.min(1, x));
// Пузырьки: [время, сколько].
const SPAWNS = [[0.5, 2], [0.78, 1], [1.05, 2], [1.32, 1], [1.58, 3], [1.9, 1], [2.1, 4]];
// Пока держится надпись — редкие пузырьки со дна: [время, где по ширине].
const AMBIENT = [[2.6, 0.3], [3.05, 0.71], [3.5, 0.44]];
// Удары хвостом (звук «флап»).
const FLICKS = [0.3, 0.46, 1.98, 2.12, 2.25];

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

// ---------- Геометрия ----------
function geometry(W, H) {
  const L = Math.max(200, Math.min(560, W * 0.34, H * 0.62)); // длина тела без хвоста
  return {
    W, H, L,
    from: W + L * 0.28, // голова (и усы) за правым краем
    to: -L * 1.32, // хвост ушёл за левый край
    pathY: (x) => H * 0.47 + H * 0.045 * Math.sin((x / W) * Math.PI * 1.6 + 0.5),
  };
}
const progress = (t) => clamp01((t - SWIM_FROM) / SWIM_FOR);
const headX = (g, t) => g.from + (g.to - g.from) * swimF(progress(t));
const speedNorm = (t) => { const u = (t - SWIM_FROM) / SWIM_FOR; return u <= 0 || u >= 1 ? 0.6 : swimV(u) / (1 + EASE); };
/** Когда хвост сома пройдёт точку x (для звука под проявление надписи). */
function timeTailAt(g, x) {
  let a = SWIM_FROM;
  let b = SWIM_FROM + SWIM_FOR;
  for (let i = 0; i < 30; i += 1) { const m = (a + b) / 2; if (headX(g, m) + g.L * 1.2 > x) a = m; else b = m; }
  return (a + b) / 2;
}

// ---------- Сом ----------
/** Позвоночник плывущего сома: волна бежит от головы к хвосту, к хвосту — сильнее. */
function drawFish(c, g, F) {
  const { L } = g;
  const N = 34;
  const S = [];
  for (let i = 0; i <= N; i += 1) {
    const u = i / N;
    const x = F.hx + u * L;
    const amp = L * (0.006 + 0.05 * u * u);
    S.push({ u, x, y: g.pathY(x) + amp * Math.sin(F.phase - u * Math.PI * 1.8) });
  }
  // Тень на дне — мягкое пятно под сомом.
  if (SHADOW) {
    const mid = S[Math.round(N * 0.4)];
    const w = L * 1.15;
    c.globalAlpha = 0.5;
    c.drawImage(SHADOW, mid.x - w / 2, mid.y + L * 0.2, w, L * 0.3);
    c.globalAlpha = 1;
  }
  return drawCatfish(c, S, L, {
    t: F.t, phase: F.phase, sn: F.sn, blink: F.blink, girth: 1.32,
    tailAngle: 0.32 * Math.sin(F.phase - Math.PI * 1.8 - 0.7), flap: 0.78 + 0.22 * Math.cos(F.phase - 2),
    caustic: WARM ? { img: WARM, x: F.hx - L * 0.2 + Math.sin(F.t * 0.7) * L * 0.1 + F.t * L * 0.05, y: g.pathY(F.hx) - L * 0.35, size: L * 0.9, alpha: 0.3 } : null,
  });
}

// Картинки: каустика (та же, что в оформлении «Графон»), значок, пятно тени и мягкие частицы.
let CAUSTIC = null;
let WARM = null;
let SHADOW = null;
let BOKEH = null;
let EMBLEM = null;
function loadImg(src) {
  return new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src; });
}
function tint(im, color) {
  const cv = document.createElement('canvas');
  cv.width = im.naturalWidth; cv.height = im.naturalHeight;
  const x = cv.getContext('2d');
  x.drawImage(im, 0, 0);
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = color;
  x.fillRect(0, 0, cv.width, cv.height);
  return cv;
}
function sprite(size, stops) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const x = cv.getContext('2d');
  const gr = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) gr.addColorStop(o, col);
  x.fillStyle = gr;
  x.fillRect(0, 0, size, size);
  return cv;
}
let assets = null;
function loadAssets() {
  assets ||= (async () => {
    const [ca, em] = await Promise.all([loadImg('img/caustics-a.png'), loadImg('assets/icon-512.png')]);
    if (ca) { CAUSTIC = tint(ca, 'rgb(205, 240, 246)'); WARM = tint(ca, 'rgb(255, 240, 205)'); }
    EMBLEM = em;
    SHADOW = sprite(128, [[0, 'rgba(0, 0, 0, 0.55)'], [1, 'rgba(0, 0, 0, 0)']]);
    BOKEH = sprite(64, [[0, 'rgba(205, 235, 240, 0.9)'], [0.55, 'rgba(205, 235, 240, 0.35)'], [1, 'rgba(205, 235, 240, 0)']]);
    // Шрифт надписи — тот же, что у заголовков. Не успел за полсекунды — будет Segoe UI.
    await Promise.race([document.fonts?.load('600 96px Unbounded').catch(() => {}), new Promise((r) => setTimeout(r, 500))]);
  })();
  return assets;
}

// ---------- Фон ----------
function makeBackground(W, H, dpr) {
  const cv = document.createElement('canvas');
  cv.width = Math.round(W * dpr);
  cv.height = Math.round(H * dpr);
  const c = cv.getContext('2d');
  c.scale(dpr, dpr);
  // Те же цвета, что у значка: светлее у поверхности, темнее в глубине.
  const g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#356471');
  g.addColorStop(0.42, '#1b3841');
  g.addColorStop(1, '#081317');
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
  const sg = c.createRadialGradient(W * 0.42, -H * 0.2, 0, W * 0.42, -H * 0.2, Math.max(W, H) * 0.9);
  sg.addColorStop(0, 'rgba(185, 228, 234, 0.3)');
  sg.addColorStop(1, 'rgba(185, 228, 234, 0)');
  c.fillStyle = sg;
  c.fillRect(0, 0, W, H);
  const v = c.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.3, W / 2, H * 0.5, Math.max(W, H) * 0.78);
  v.addColorStop(0, 'rgba(0, 0, 0, 0)');
  v.addColorStop(1, 'rgba(0, 0, 0, 0.5)');
  c.fillStyle = v;
  c.fillRect(0, 0, W, H);
  return cv;
}
/** Блики солнца у поверхности: полоса каустики, гаснущая книзу (собирается один раз, в кадре только сдвигается). */
function makeCaustics(W, H, dpr) {
  if (!CAUSTIC) return null;
  const w = Math.round(W * 1.4);
  const h = Math.round(H * 0.6);
  const cv = document.createElement('canvas');
  cv.width = Math.round(w * dpr);
  cv.height = Math.round(h * dpr);
  const c = cv.getContext('2d');
  c.scale(dpr, dpr);
  const tile = Math.max(380, Math.min(W, H) * 0.75);
  for (let y = 0; y < h; y += tile) for (let x = 0; x < w; x += tile) c.drawImage(CAUSTIC, x, y, tile, tile);
  c.globalCompositeOperation = 'destination-in';
  const m = c.createLinearGradient(0, 0, 0, h);
  m.addColorStop(0, 'rgba(0,0,0,0.5)');
  m.addColorStop(0.5, 'rgba(0,0,0,0.18)');
  m.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = m;
  c.fillRect(0, 0, w, h);
  return { cv, w, h };
}
function drawCaustics(c, ca, W, t) {
  if (!ca) return;
  c.save();
  c.globalCompositeOperation = 'lighter';
  c.globalAlpha = 0.22;
  c.drawImage(ca.cv, -W * 0.2 + Math.sin(t * 0.35) * W * 0.04 - t * 6, 0, ca.w, ca.h);
  c.globalAlpha = 0.14;
  c.drawImage(ca.cv, -W * 0.05 - Math.sin(t * 0.27 + 1) * W * 0.05 + t * 4, -ca.h * 0.06, ca.w * 1.08, ca.h * 1.08);
  c.restore();
}
const RAYS = [[0.18, 0.05, 0.6, 0.05, 0.2], [0.36, 0.08, 0.45, 0.04, 2.1], [0.55, 0.04, 0.7, 0.05, 4], [0.72, 0.07, 0.5, 0.035, 1.2], [0.88, 0.05, 0.55, 0.04, 3.3]];
function drawRays(c, W, H, t) {
  c.save();
  c.globalCompositeOperation = 'lighter';
  for (const [x, w, s, a, p] of RAYS) {
    const x0 = W * x + Math.sin(t * s + p) * W * 0.015;
    const wt = W * w;
    const skew = -W * 0.08;
    const spread = W * 0.05;
    const g = c.createLinearGradient(0, 0, 0, H * 0.85);
    g.addColorStop(0, `rgba(190, 230, 238, ${a * (0.85 + 0.3 * Math.sin(t * 1.3 + p))})`);
    g.addColorStop(1, 'rgba(190, 230, 238, 0)');
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(x0 - wt / 2, 0);
    c.lineTo(x0 + wt / 2, 0);
    c.lineTo(x0 + wt / 2 + skew + spread, H * 0.85);
    c.lineTo(x0 - wt / 2 + skew - spread, H * 0.85);
    c.closePath();
    c.fill();
  }
  c.restore();
}
const R = rng(7);
const DUST = Array.from({ length: 70 }, () => ({ x: R(), y: R(), r: 0.5 + R() * 1.4, a: 0.12 + R() * 0.25, v: 0.008 + R() * 0.02 }));
// Крупные размытые частицы у самого «объектива» — глубина, как в кадре под водой.
const NEAR = Array.from({ length: 9 }, () => ({ x: R(), y: R(), r: 10 + R() * 26, a: 0.05 + R() * 0.08, v: 0.012 + R() * 0.02, s: R() * 6 }));
function drawDust(c, W, H, t) {
  c.fillStyle = 'rgb(190, 220, 228)';
  for (const d of DUST) {
    const x = (((d.x - t * 0.006 + Math.sin(t + d.y * 9) * 0.003) % 1) + 1) % 1;
    const y = (((d.y - t * d.v) % 1) + 1) % 1;
    c.globalAlpha = d.a;
    c.beginPath();
    c.arc(x * W, y * H, d.r, 0, Math.PI * 2);
    c.fill();
  }
  c.globalAlpha = 1;
}
function drawNear(c, W, H, t) {
  if (!BOKEH) return;
  for (const d of NEAR) {
    const x = (((d.x + t * 0.01 + Math.sin(t * 0.6 + d.s) * 0.01) % 1) + 1) % 1;
    const y = (((d.y - t * d.v) % 1) + 1) % 1;
    c.globalAlpha = d.a;
    c.drawImage(BOKEH, x * W - d.r, y * H - d.r, d.r * 2, d.r * 2);
  }
  c.globalAlpha = 1;
}

// ---------- Надпись и значок ----------
const FONT = '"Unbounded", "Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif';
function makeWord(W, H, dpr) {
  const size = Math.round(Math.max(48, Math.min(W * 0.085, H * 0.15, 120)));
  const w = Math.ceil(size * 3.6);
  const h = Math.ceil(size * 1.7);
  const cv = document.createElement('canvas');
  cv.width = Math.round(w * dpr);
  cv.height = Math.round(h * dpr);
  const c = cv.getContext('2d');
  c.scale(dpr, dpr);
  c.textAlign = 'center';
  c.font = `600 ${size}px ${FONT}`;
  if ('letterSpacing' in c) c.letterSpacing = `${Math.round(size * 0.02)}px`;
  c.shadowColor = `rgba(${COL.glow}, 0.4)`;
  c.shadowBlur = size * 0.4;
  // Буквы — с лёгким перепадом сверху вниз, как металл под водой.
  const g = c.createLinearGradient(0, size * 0.2, 0, size * 1.1);
  g.addColorStop(0, '#fbf5e6');
  g.addColorStop(0.55, COL.word);
  g.addColorStop(1, '#cdbb92');
  c.fillStyle = g;
  c.fillText('Som', w / 2, size * 1.05);
  const scratch = document.createElement('canvas');
  scratch.width = cv.width;
  scratch.height = cv.height;
  return { cv, scratch, w, h, size, base: size * 1.05 };
}
/** Где стоят значок и надпись: значок над серединой, «Som» под ним. */
function layout(W, H, word) {
  const E = Math.round(Math.max(84, Math.min(H * 0.22, W * 0.16, 170)));
  const top = H * 0.5 - (E + word.size * 1.55) / 2;
  return { E, ex: W / 2, ey: top + E / 2, wordTop: top + E + word.size * 0.18 - (word.base - word.size * 0.92) };
}

// ---------- Звук ----------
function noise(ac, sec, brown) {
  const n = Math.floor(ac.sampleRate * sec);
  const b = ac.createBuffer(1, n, ac.sampleRate);
  const d = b.getChannelData(0);
  let last = 0;
  for (let i = 0; i < n; i += 1) {
    const w = Math.random() * 2 - 1;
    if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
  }
  return b;
}
function impulse(ac, sec) {
  const n = Math.floor(ac.sampleRate * sec);
  const b = ac.createBuffer(2, n, ac.sampleRate);
  for (let ch = 0; ch < 2; ch += 1) {
    const d = b.getChannelData(ch);
    for (let i = 0; i < n; i += 1) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.8);
  }
  return b;
}
function env(gain, t, peak, attack, release) {
  gain.setValueAtTime(0.0001, t);
  gain.exponentialRampToValueAtTime(peak, t + attack);
  gain.exponentialRampToValueAtTime(0.0001, t + attack + release);
}
/** Расписать весь звук заставки разом: t0 — момент «0» картинки по часам звука. */
function scoreSound(ac, g, t0, plan) {
  const vol = (soundPrefs.volume / 100) * 0.55;
  const master = ac.createGain();
  master.gain.value = vol;
  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.ratio.value = 4;
  master.connect(comp).connect(ac.destination);
  const bus = ac.createGain();
  bus.connect(master);
  const verb = ac.createConvolver();
  verb.buffer = impulse(ac, 2.2);
  const wet = ac.createGain();
  wet.gain.value = 0.3;
  bus.connect(verb).connect(wet).connect(master);
  const white = noise(ac, 2, false);
  const brown = noise(ac, 3, true);
  const end = t0 + FADE_AT + FADE_FOR;
  const panAt = (x) => Math.max(-0.9, Math.min(0.9, (x / g.W) * 2 - 1));

  // Толща воды: низкий гул, который медленно «дышит».
  {
    const src = ac.createBufferSource();
    src.buffer = brown;
    src.loop = true;
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 360;
    lp.Q.value = 0.4;
    const lfo = ac.createOscillator();
    lfo.frequency.value = 0.35;
    const lg = ac.createGain();
    lg.gain.value = 110;
    lfo.connect(lg).connect(lp.frequency);
    const gg = ac.createGain();
    gg.gain.setValueAtTime(0.0001, t0);
    gg.gain.exponentialRampToValueAtTime(0.2, t0 + 0.45);
    gg.gain.setValueAtTime(0.2, end - 0.55);
    gg.gain.exponentialRampToValueAtTime(0.0001, end);
    src.connect(lp).connect(gg).connect(master);
    src.start(t0); src.stop(end + 0.1);
    lfo.start(t0); lfo.stop(end + 0.1);
  }
  // Сом вошёл в воду рядом — мягкий низкий «вумм» справа.
  {
    const t = t0 + SWIM_FROM;
    const o = ac.createOscillator();
    o.frequency.setValueAtTime(96, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.6);
    const gg = ac.createGain();
    env(gg.gain, t, 0.55, 0.05, 0.7);
    const p = ac.createStereoPanner();
    p.pan.value = 0.7;
    o.connect(gg).connect(p).connect(bus);
    o.start(t); o.stop(t + 0.85);
  }
  // Шелест воды вдоль тела: громче рядом, звук едет справа налево вместе с сомом.
  {
    const src = ac.createBufferSource();
    src.buffer = white;
    src.loop = true;
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.1;
    const gg = ac.createGain();
    const p = ac.createStereoPanner();
    src.connect(bp).connect(gg).connect(p).connect(bus);
    const a = t0 + SWIM_FROM;
    gg.gain.setValueAtTime(0.0001, a);
    for (let t = SWIM_FROM; t <= SWIM_FROM + SWIM_FOR + 0.001; t += 0.05) {
      const xc = headX(g, t) + g.L * 0.6;
      const prox = Math.exp(-(((xc - g.W / 2) / (g.W * 0.42)) ** 2));
      const sn = speedNorm(t);
      const at = t0 + t;
      gg.gain.linearRampToValueAtTime(0.03 + 0.34 * prox + 0.12 * sn * prox, at);
      bp.frequency.linearRampToValueAtTime(240 + 520 * prox + 380 * sn, at);
      p.pan.linearRampToValueAtTime(panAt(xc), at);
    }
    const z = t0 + SWIM_FROM + SWIM_FOR;
    gg.gain.exponentialRampToValueAtTime(0.0001, z + 0.3);
    src.start(a); src.stop(z + 0.35);
  }
  // Удары хвостом.
  for (const ft of FLICKS) {
    const t = t0 + ft;
    const src = ac.createBufferSource();
    src.buffer = white;
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 170;
    bp.Q.value = 1.4;
    const gg = ac.createGain();
    env(gg.gain, t, 0.55, 0.012, 0.12);
    const p = ac.createStereoPanner();
    p.pan.value = panAt(headX(g, ft) + g.L * 1.1);
    src.connect(bp).connect(gg).connect(p).connect(bus);
    src.start(t, Math.random()); src.stop(t + 0.2);
    const o = ac.createOscillator();
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.12);
    const og = ac.createGain();
    env(og.gain, t, 0.22, 0.01, 0.12);
    o.connect(og).connect(p);
    o.start(t); o.stop(t + 0.16);
  }
  // Пузырьки: «бульк» — синус, который быстро уходит вверх.
  for (const b of plan.bubbles) {
    const t = t0 + b.t;
    const o = ac.createOscillator();
    const f0 = 880 - 480 * b.s;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f0 * 2.5, t + 0.06 + 0.03 * b.s);
    const gg = ac.createGain();
    env(gg.gain, t, b.quiet ? 0.09 : 0.2, 0.004, 0.1);
    const p = ac.createStereoPanner();
    p.pan.value = panAt(b.x);
    o.connect(gg).connect(p).connect(bus);
    o.start(t); o.stop(t + 0.16);
  }
  // «Som» проявился — мягкий колокольчик: ми, си, ми октавой выше.
  for (const [dt, f, vel] of [[0, 659.25, 0.5], [0.13, 987.77, 0.42], [0.26, 1318.51, 0.3]]) {
    const t = t0 + plan.chime + dt;
    for (const [mul, amp, len] of [[1, 1, 1.5], [2.76, 0.26, 0.55], [5.4, 0.09, 0.28]]) {
      const o = ac.createOscillator();
      o.frequency.value = f * mul;
      const gg = ac.createGain();
      env(gg.gain, t, amp * vel * 0.8, 0.004, len);
      o.connect(gg).connect(bus);
      o.start(t); o.stop(t + len + 0.05);
    }
  }
  return master;
}

/** План звука под размер окна (общая часть для заставки и проверки). */
function soundPlan(g, rnd) {
  const bubbles = [];
  for (const [st, n] of SPAWNS) for (let k = 0; k < Math.min(n, 2); k += 1) bubbles.push({ t: st + k * 0.06 + 0.02, x: headX(g, st), s: rnd() });
  for (const [st, fx] of AMBIENT) bubbles.push({ t: st + 0.02, x: g.W * fx, s: 0.2 + rnd() * 0.3, quiet: true });
  return { bubbles, chime: timeTailAt(g, g.W / 2) + 0.05 };
}
/** Для проверки: расписать звук заставки в любой AudioContext (например, OfflineAudioContext). */
export function scoreIntroSound(ac, W, H, t0 = 0) {
  const g = geometry(W, H);
  return scoreSound(ac, g, t0, soundPlan(g, rng(1)));
}

// ---------- Запуск ----------
let running = null;

/** Окно уже на экране? Ждём показа, но не дольше 1,5 с. */
async function shown() {
  if (!window.som?.isShown) return true;
  const later = new Promise((resolve) => {
    window.som.onShown?.((on) => { if (on) resolve(true); });
    setTimeout(() => resolve(false), 1500);
  });
  if (await window.som.isShown().catch(() => true)) return true;
  return later;
}

/** Показать заставку. out — колонки из настроек. Возвращает обещание: заставка закончилась. */
export function playIntro({ out = 'default' } = {}) {
  const el = document.getElementById('intro');
  const cv = document.getElementById('introCanvas');
  if (!el || !cv) return Promise.resolve();
  if (running) return running;
  document.documentElement.dataset.intro = '1';
  el.classList.remove('out');
  el.style.transitionDuration = '';
  running = new Promise((resolve) => {
    const c = cv.getContext('2d');
    let W = 0;
    let H = 0;
    let dpr = 1;
    let g = null;
    let bg = null;
    let word = null;
    let ca = null;
    let chimeT = 2;
    let raf = 0;
    let start = 0;
    let last = 0;
    let phase = 0;
    let spawned = 0;
    let ambient = 0;
    let done = false;
    let ac = null;
    let master = null;
    const bubbles = [];
    const rnd = rng(Date.now());
    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = el.clientWidth || window.innerWidth;
      H = el.clientHeight || window.innerHeight;
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
      g = geometry(W, H);
      bg = makeBackground(W, H, dpr);
      word = makeWord(W, H, dpr);
      ca = makeCaustics(W, H, dpr);
      chimeT = timeTailAt(g, W / 2);
    };
    resize();
    const onResize = () => resize();
    window.addEventListener('resize', onResize);

    const finish = (fast) => {
      if (done) return;
      done = true;
      el.style.transitionDuration = fast ? '0.22s' : `${FADE_FOR}s`;
      el.classList.add('out');
      if (master && ac) { try { master.gain.setTargetAtTime(0, ac.currentTime, fast ? 0.04 : 0.12); } catch { /* уже */ } }
      el.removeEventListener('pointerdown', skip);
      window.removeEventListener('keydown', skip, true);
      setTimeout(() => {
        cancelAnimationFrame(raf);
        window.removeEventListener('resize', onResize);
        delete document.documentElement.dataset.intro;
        el.classList.remove('out');
        ac?.close().catch(() => {});
        running = null;
        resolve();
      }, (fast ? 220 : FADE_FOR * 1000) + 60);
    };
    const skip = () => finish(true);
    el.addEventListener('pointerdown', skip);
    window.addEventListener('keydown', skip, true);

    const frame = (now) => {
      if (done && !el.classList.contains('out')) return;
      const t = Math.max(0, (now - start) / 1000);
      const dt = Math.min(0.05, Math.max(0, t - last));
      last = t;
      const sn = speedNorm(t);
      phase += dt * 2 * Math.PI * (1.4 + 2.3 * sn);
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.drawImage(bg, 0, 0, W, H);
      drawCaustics(c, ca, W, t);
      drawRays(c, W, H, t);
      drawDust(c, W, H, t);

      // Значок и надпись — за сомом. Всё вместе едва заметно приближается.
      const P = layout(W, H, word);
      const zoom = 1 + 0.035 * (1 - (1 - clamp01((t - 1.7) / (FADE_AT + FADE_FOR - 1.7))) ** 2);
      c.save();
      c.translate(W / 2, H * 0.5);
      c.scale(zoom, zoom);
      c.translate(-W / 2, -H * 0.5);
      // Значок всплывает, когда хвост проходит середину: свечение, круг по воде, блик по стеклу.
      const ea = 1 - (1 - clamp01((t - (chimeT - 0.1)) / 0.85)) ** 3;
      if (ea > 0 && EMBLEM) {
        const E = P.E * (0.86 + 0.14 * ea);
        const ey = P.ey + (1 - ea) * P.E * 0.22;
        const gl = c.createRadialGradient(P.ex, ey, 0, P.ex, ey, P.E * 1.5);
        gl.addColorStop(0, `rgba(${COL.glow}, ${0.3 * ea})`);
        gl.addColorStop(1, `rgba(${COL.glow}, 0)`);
        c.fillStyle = gl;
        c.fillRect(P.ex - P.E * 1.5, ey - P.E * 1.5, P.E * 3, P.E * 3);
        const k = clamp01((t - chimeT + 0.1) / 1.4);
        if (k > 0 && k < 1) {
          c.strokeStyle = `rgba(${COL.teal}, ${0.32 * (1 - k) ** 1.5})`;
          c.lineWidth = Math.max(1, P.E * 0.02 * (1 - k));
          c.beginPath(); c.ellipse(P.ex, ey, P.E * (0.62 + 1.1 * k), P.E * (0.62 + 1.1 * k) * 0.92, 0, 0, Math.PI * 2); c.stroke();
        }
        c.save();
        c.globalAlpha = ea;
        c.shadowColor = 'rgba(0, 8, 12, 0.5)';
        c.shadowBlur = E * 0.22;
        c.shadowOffsetY = E * 0.07;
        c.drawImage(EMBLEM, P.ex - E / 2, ey - E / 2, E, E);
        c.restore();
        const sw = clamp01((t - chimeT - 0.25) / 0.9);
        if (sw > 0 && sw < 1) {
          c.save();
          c.beginPath(); c.roundRect(P.ex - E / 2, ey - E / 2, E, E, E * 0.225); c.clip();
          const x = P.ex - E + sw * E * 2;
          const sg = c.createLinearGradient(x - E * 0.3, ey - E / 2, x + E * 0.3, ey + E / 2);
          sg.addColorStop(0, 'rgba(255, 255, 255, 0)');
          sg.addColorStop(0.5, `rgba(255, 250, 235, ${0.28 * Math.sin(sw * Math.PI)})`);
          sg.addColorStop(1, 'rgba(255, 255, 255, 0)');
          c.fillStyle = sg;
          c.fillRect(P.ex - E / 2, ey - E / 2, E, E);
          c.restore();
        }
      }
      // «Som» проявляется в кильватере сома.
      const wl = W / 2 - word.w / 2;
      const wt = P.wordTop;
      const reveal = headX(g, t) + g.L * 1.2;
      const soft = g.L * 0.3;
      if (reveal + soft <= wl) {
        c.drawImage(word.cv, wl, wt, word.w, word.h);
      } else if (reveal < wl + word.w) {
        const sc = word.scratch.getContext('2d');
        sc.setTransform(1, 0, 0, 1, 0, 0);
        sc.globalCompositeOperation = 'source-over';
        sc.clearRect(0, 0, word.scratch.width, word.scratch.height);
        sc.drawImage(word.cv, 0, 0);
        sc.globalCompositeOperation = 'destination-in';
        const ex = (reveal - wl) * dpr;
        const gr = sc.createLinearGradient(ex, 0, ex + soft * dpr, 0);
        gr.addColorStop(0, 'rgba(0,0,0,0)');
        gr.addColorStop(1, 'rgba(0,0,0,1)');
        sc.fillStyle = gr;
        sc.fillRect(0, 0, word.scratch.width, word.scratch.height);
        c.drawImage(word.scratch, wl, wt, word.w, word.h);
      }
      const tagA = clamp01((t - chimeT - 0.15) / 0.55);
      if (tagA > 0) {
        c.fillStyle = `rgba(${COL.teal}, ${0.85 * tagA})`;
        c.textAlign = 'center';
        c.font = `500 ${Math.round(word.size * 0.17)}px "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif`;
        if ('letterSpacing' in c) c.letterSpacing = `${Math.round(word.size * 0.04)}px`;
        c.fillText('мессенджер для своих', W / 2, wt + word.base + word.size * 0.42 + (1 - tagA) * 6);
        if ('letterSpacing' in c) c.letterSpacing = '0px';
      }
      c.restore();

      // Сом и пузырьки.
      const hx = headX(g, t);
      const blink = t > 1.12 && t < 1.27 ? 0.12 : 1;
      const parts = hx < W + g.L * 0.3 && hx > -g.L * 1.5 ? drawFish(c, g, { hx, phase, sn, t, blink }) : null;
      while (spawned < SPAWNS.length && t >= SPAWNS[spawned][0]) {
        const [, n] = SPAWNS[spawned];
        spawned += 1;
        const from = parts ? (spawned % 2 ? parts.mouth : parts.gill) : { x: hx, y: g.pathY(hx) };
        for (let k = 0; k < n; k += 1) {
          const r = (2.5 + rnd() * 7) * (g.L / 380);
          bubbles.push({ x: from.x + (rnd() - 0.5) * 10, y: from.y + (rnd() - 0.5) * 8, r, vy: 38 + r * 8 + rnd() * 20, ph: rnd() * 6, age: -k * 0.06 });
        }
      }
      while (ambient < AMBIENT.length && t >= AMBIENT[ambient][0]) {
        const [, fx] = AMBIENT[ambient];
        ambient += 1;
        for (let k = 0; k < 2; k += 1) {
          const r = (2 + rnd() * 4) * (g.L / 380);
          bubbles.push({ x: W * fx + (rnd() - 0.5) * 14, y: H * 0.95, r, vy: 70 + r * 8 + rnd() * 20, ph: rnd() * 6, age: -k * 0.09 });
        }
      }
      for (const b of bubbles) {
        b.age += dt;
        if (b.age < 0) continue;
        b.y -= b.vy * dt;
        b.x += Math.sin(b.ph + b.age * 6) * 0.6 - 6 * dt;
        b.r *= 1 + 0.08 * dt;
        const a = Math.min(1, b.age * 6) * (1 - clamp01((b.age - 1.6) / 0.6));
        if (a > 0) drawBubble(c, b.x, b.y, b.r, a);
      }
      drawNear(c, W, H, t);
      if (!done && t >= FADE_AT) finish(false);
      raf = requestAnimationFrame(frame);
    };

    // Первый кадр — сразу (вода), сам заплыв — когда окно на экране и звук готов.
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.drawImage(bg, 0, 0, W, H);
    (async () => {
      if (!(await shown())) { finish(true); return; }
      await loadAssets();
      if (done) return;
      resize(); // надпись — уже нужным шрифтом, блики — из загруженной картинки
      let lead = 0;
      if (introPrefs.sound && soundPrefs.volume > 0) {
        try {
          ac = new AudioContext({ latencyHint: 'interactive' });
          if (out && out !== 'default' && typeof ac.setSinkId === 'function') await Promise.race([ac.setSinkId(out).catch(() => {}), new Promise((r) => setTimeout(r, 300))]);
          await Promise.race([ac.resume(), new Promise((r) => setTimeout(r, 300))]);
          if (ac.state === 'running' && !done) {
            lead = 0.06;
            master = scoreSound(ac, g, ac.currentTime + lead, soundPlan(g, rnd));
          }
        } catch { master = null; }
      }
      if (done) return;
      start = performance.now() + lead * 1000;
      last = 0;
      raf = requestAnimationFrame(frame);
    })();
  });
  return running;
}
