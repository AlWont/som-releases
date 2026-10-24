// Заставка при запуске: по тёмной воде справа налево проплывает сом, за его хвостом проявляется «Som».
// Всё рисуется на <canvas>, звук синтезируется на месте — без картинок и звуковых файлов.
// Щелчок или любая клавиша — пропустить. Выключается в настройках («Внешний вид → Заставка»).
import { soundPrefs } from './sounds.js';

function pref(key, def) { try { return localStorage.getItem(key) ?? def; } catch { return def; } }
function setPref(key, v) { try { localStorage.setItem(key, v); } catch { /* без памяти — не страшно */ } }
export const introPrefs = {
  get on() { return pref('som.intro', '1') === '1'; },
  set on(v) { setPref('som.intro', v ? '1' : '0'); },
  get sound() { return pref('som.intro.sound', '1') === '1'; },
  set sound(v) { setPref('som.intro.sound', v ? '1' : '0'); },
};

// Цвета значка Som.
const COL = { beige: '#D8C7A3', hi: '#E7DABE', lo: '#B8A680', fin: '#C5B28C', ink: '#1F2B33', teal: '127, 160, 168', word: '#EEE6D3' };
// Время, с: сом плывёт SWIM_FROM…SWIM_FROM+SWIM_FOR, потом заставка тает.
const SWIM_FROM = 0.15;
const SWIM_FOR = 2.3;
const FADE_AT = 2.85;
const FADE_FOR = 0.45;
// Скорость: быстро вплывает, посередине замедляется (видно сома), быстро уплывает.
const EASE = 0.55;
const swimF = (u) => u + EASE * Math.sin(2 * Math.PI * u) / (2 * Math.PI);
const swimV = (u) => 1 + EASE * Math.cos(2 * Math.PI * u);
const clamp01 = (x) => Math.max(0, Math.min(1, x));
// Пузырьки: [время, сколько].
const SPAWNS = [[0.5, 2], [0.78, 1], [1.05, 2], [1.32, 1], [1.58, 3], [1.9, 1], [2.1, 4]];
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

// Толщина тела (половина высоты) в долях длины: большая голова, сужение к хвосту.
function half(u) {
  const HM = 0.118;
  if (u < 0.22) { const k = (0.22 - u) / 0.24; return HM * Math.sqrt(Math.max(0, 1 - k * k)); }
  return HM * (1 - 0.72 * Math.pow((u - 0.22) / 0.78, 1.15));
}

/** Провести сглаженную линию через точки (текущая точка — pts[0]). */
function through(c, pts) {
  for (let i = 1; i < pts.length - 1; i += 1) {
    c.quadraticCurveTo(pts[i].x, pts[i].y, (pts[i].x + pts[i + 1].x) / 2, (pts[i].y + pts[i + 1].y) / 2);
  }
  const last = pts[pts.length - 1];
  c.lineTo(last.x, last.y);
}

// Усы: основание, изгиб, кончик — в долях длины от кончика носа (x — к хвосту, y — вниз); dir — куда их сносит водой.
// Длинные — из уголков рта, вода уносит их назад вдоль тела; короткие — на подбородке и над носом.
const WHISKERS = [
  { b: [0.05, 0.03], c: [-0.06, 0.13], e: [0.36, 0.2], w: 0.022, dir: -1, k: 0 },
  { b: [0.08, 0.07], c: [0.04, 0.2], e: [0.13, 0.27], w: 0.013, dir: -1, k: 1.9 },
  { b: [0.11, 0.08], c: [0.12, 0.16], e: [0.21, 0.2], w: 0.01, dir: -1, k: 3.4 },
  { b: [0.03, -0.035], c: [-0.035, -0.12], e: [0.06, -0.17], w: 0.012, dir: 1, k: 4.6 },
];

function drawFish(c, g, F) {
  const { L } = g;
  const N = 26;
  const S = [];
  for (let i = 0; i <= N; i += 1) {
    const u = i / N;
    const x = F.hx + u * L;
    const amp = L * (0.008 + 0.055 * u * u);
    S.push({ u, x, y: g.pathY(x) + amp * Math.sin(F.phase - u * Math.PI * 1.8) });
  }
  for (let i = 0; i <= N; i += 1) {
    const a = S[Math.max(0, i - 1)];
    const b = S[Math.min(N, i + 1)];
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    Object.assign(S[i], { dx, dy, nx: -dy, ny: dx, h: half(S[i].u) * L });
  }
  const top = S.map((p) => ({ x: p.x - p.nx * p.h * 1.04, y: p.y - p.ny * p.h * 1.04 }));
  const bot = S.map((p) => ({ x: p.x + p.nx * p.h * 0.96, y: p.y + p.ny * p.h * 0.96 }));
  const mid = S[Math.round(N * 0.4)];
  const body = c.createLinearGradient(mid.x - mid.nx * L * 0.12, mid.y - mid.ny * L * 0.12, mid.x + mid.nx * L * 0.12, mid.y + mid.ny * L * 0.12);
  body.addColorStop(0, COL.hi);
  body.addColorStop(0.45, COL.beige);
  body.addColorStop(1, COL.lo);

  // Усы — до тела, чтобы основания прятались под головой.
  const s0 = S[0];
  const nose = { x: s0.x - s0.dx * L * 0.03, y: s0.y - s0.dy * L * 0.03 };
  const W2 = (v) => ({ x: nose.x + (s0.dx * v[0] + s0.nx * v[1]) * L, y: nose.y + (s0.dy * v[0] + s0.ny * v[1]) * L });
  const rot = (v, base, a) => {
    const x = v[0] - base[0];
    const y = v[1] - base[1];
    return [base[0] + x * Math.cos(a) - y * Math.sin(a), base[1] + x * Math.sin(a) + y * Math.cos(a)];
  };
  c.strokeStyle = COL.beige;
  c.lineCap = 'round';
  for (const w of WHISKERS) {
    const trail = 0.12 + 0.32 * F.sn;
    const a = w.dir * trail + 0.11 * Math.sin(F.t * 2 * Math.PI * 1.3 + w.k);
    const p0 = W2(w.b);
    const p1 = W2(rot(w.c, w.b, a * 0.6));
    const p2 = W2(rot(w.e, w.b, a));
    let prev = p0;
    const SEG = 12;
    for (let j = 1; j <= SEG; j += 1) {
      const s = j / SEG;
      const q = { x: (1 - s) ** 2 * p0.x + 2 * (1 - s) * s * p1.x + s * s * p2.x, y: (1 - s) ** 2 * p0.y + 2 * (1 - s) * s * p1.y + s * s * p2.y };
      c.lineWidth = Math.max(1, w.w * L * (1 - 0.75 * s));
      c.beginPath(); c.moveTo(prev.x, prev.y); c.lineTo(q.x, q.y); c.stroke();
      prev = q;
    }
  }

  // Спинной плавник: маленький, острый, скошен назад (как на значке).
  const i1 = Math.round(N * 0.27);
  const iA = Math.round(N * 0.4);
  const i2 = Math.round(N * 0.44);
  const A = S[i1];
  const M = S[iA];
  const B = S[i2];
  const apex = { x: top[iA].x - M.nx * L * 0.085 + M.dx * L * 0.03, y: top[iA].y - M.ny * L * 0.085 + M.dy * L * 0.03 };
  c.fillStyle = body;
  c.beginPath();
  c.moveTo(top[i1].x + A.nx * L * 0.01, top[i1].y + A.ny * L * 0.01);
  c.quadraticCurveTo(top[i1].x - A.nx * L * 0.05 + A.dx * L * 0.05, top[i1].y - A.ny * L * 0.05 + A.dy * L * 0.05, apex.x, apex.y);
  c.quadraticCurveTo(top[i2].x - B.nx * L * 0.035, top[i2].y - B.ny * L * 0.035, top[i2].x + B.nx * L * 0.01, top[i2].y + B.ny * L * 0.01);
  c.closePath();
  c.fill();
  // Длинный плавник снизу — у сома он тянется почти до хвоста и колышется.
  const j1 = Math.round(N * 0.52);
  const j2 = N - 1;
  c.fillStyle = COL.fin;
  c.beginPath();
  c.moveTo(bot[j1].x - S[j1].nx * L * 0.01, bot[j1].y - S[j1].ny * L * 0.01);
  for (let j = j1; j <= j2; j += 1) {
    const q = (j - j1) / (j2 - j1);
    const hgt = L * (0.012 + 0.04 * Math.sin(Math.PI * Math.min(1, q * 1.15)) * (1 - 0.3 * q)) * (1 + 0.15 * Math.sin(F.phase * 1.3 - q * 5));
    c.lineTo(bot[j].x + S[j].nx * hgt - S[j].dx * L * 0.012, bot[j].y + S[j].ny * hgt - S[j].dy * L * 0.012);
  }
  c.lineTo(bot[j2].x - S[j2].nx * L * 0.01, bot[j2].y - S[j2].ny * L * 0.01);
  c.closePath();
  c.fill();

  // Тело с хвостом — одним контуром.
  const e = S[N];
  const ta = 0.32 * Math.sin(F.phase - Math.PI * 1.8 - 0.7);
  const tdx = e.dx * Math.cos(ta) - e.dy * Math.sin(ta);
  const tdy = e.dx * Math.sin(ta) + e.dy * Math.cos(ta);
  const flap = 0.72 + 0.28 * Math.cos(F.phase - 2);
  const P = (a, b) => ({ x: e.x + (tdx * a - tdy * b) * L, y: e.y + (tdy * a + tdx * b) * L });
  c.save();
  c.shadowColor = 'rgba(5, 10, 13, 0.45)';
  c.shadowBlur = L * 0.09;
  c.shadowOffsetY = L * 0.05;
  c.beginPath();
  c.moveTo(top[0].x, top[0].y);
  through(c, top);
  const tq1 = P(0.06, -0.065 * flap);
  const tTop = P(0.17, -0.2 * flap);
  const tb1 = P(0.215, -0.08 * flap);
  const tb2 = P(0.215, 0.08 * flap);
  const tBot = P(0.17, 0.2 * flap);
  const tq2 = P(0.06, 0.065 * flap);
  c.quadraticCurveTo(tq1.x, tq1.y, tTop.x, tTop.y);
  c.bezierCurveTo(tb1.x, tb1.y, tb2.x, tb2.y, tBot.x, tBot.y);
  c.quadraticCurveTo(tq2.x, tq2.y, bot[N].x, bot[N].y);
  through(c, bot.slice().reverse());
  const k = L * 0.07;
  c.bezierCurveTo(bot[0].x - s0.dx * k, bot[0].y - s0.dy * k, top[0].x - s0.dx * k, top[0].y - s0.dy * k, top[0].x, top[0].y);
  c.closePath();
  c.fillStyle = body;
  c.fill();
  c.restore();

  // Рот — широкая щель у кончика носа.
  const m1 = S[1];
  const m3 = S[Math.round(N * 0.07)];
  c.strokeStyle = 'rgba(31, 43, 51, 0.38)';
  c.lineWidth = Math.max(1.2, L * 0.009);
  c.beginPath();
  c.moveTo(nose.x + s0.nx * L * 0.012 - s0.dx * L * 0.005, nose.y + s0.ny * L * 0.012 - s0.dy * L * 0.005);
  c.quadraticCurveTo(m1.x + m1.nx * m1.h * 0.55, m1.y + m1.ny * m1.h * 0.55, m3.x + m3.nx * m3.h * 0.28, m3.y + m3.ny * m3.h * 0.28);
  c.stroke();

  // Жабра.
  const gi = S[Math.round(N * 0.21)];
  c.strokeStyle = 'rgba(31, 43, 51, 0.16)';
  c.lineWidth = Math.max(1, L * 0.008);
  c.beginPath();
  c.moveTo(gi.x - gi.nx * gi.h * 0.55, gi.y - gi.ny * gi.h * 0.55);
  c.quadraticCurveTo(gi.x + gi.dx * L * 0.03, gi.y + gi.dy * L * 0.03, gi.x + gi.nx * gi.h * 0.6, gi.y + gi.ny * gi.h * 0.6);
  c.stroke();

  // Грудной плавник — машет.
  const pi = S[Math.round(N * 0.22)];
  const pa = 0.28 * Math.sin(F.phase * 0.9 + 1);
  const fdx = pi.dx * Math.cos(pa) - pi.dy * Math.sin(pa);
  const fdy = pi.dx * Math.sin(pa) + pi.dy * Math.cos(pa);
  const b1 = { x: pi.x + pi.nx * pi.h * 0.35, y: pi.y + pi.ny * pi.h * 0.35 };
  const tip = { x: b1.x + (fdx * 0.11 - fdy * 0.075) * L, y: b1.y + (fdy * 0.11 + fdx * 0.075) * L };
  c.fillStyle = COL.fin;
  c.beginPath();
  c.moveTo(b1.x, b1.y);
  c.quadraticCurveTo(b1.x + (fdx * 0.02 - fdy * 0.07) * L, b1.y + (fdy * 0.02 + fdx * 0.07) * L, tip.x, tip.y);
  c.quadraticCurveTo(b1.x + fdx * 0.09 * L, b1.y + fdy * 0.09 * L, b1.x + pi.dx * L * 0.06, b1.y + pi.dy * L * 0.06);
  c.closePath();
  c.fill();

  // Глаз (посередине пути сом моргает).
  const ei = S[Math.round(N * 0.1)];
  const ex = ei.x - ei.nx * ei.h * 0.36;
  const ey = ei.y - ei.ny * ei.h * 0.36;
  const r = L * 0.03;
  c.save();
  c.translate(ex, ey);
  c.rotate(Math.atan2(ei.dy, ei.dx));
  c.scale(1, F.blink);
  c.fillStyle = COL.ink;
  c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.fill();
  if (F.blink > 0.5) {
    c.fillStyle = 'rgba(255, 255, 255, 0.75)';
    c.beginPath(); c.arc(-r * 0.32, -r * 0.34, r * 0.32, 0, Math.PI * 2); c.fill();
  }
  c.restore();
  return { mouth: { x: nose.x + s0.nx * L * 0.01, y: nose.y + s0.ny * L * 0.01 }, gill: { x: gi.x - gi.nx * gi.h * 0.6, y: gi.y - gi.ny * gi.h * 0.6 } };
}

// ---------- Фон ----------
function makeBackground(W, H, dpr) {
  const cv = document.createElement('canvas');
  cv.width = Math.round(W * dpr);
  cv.height = Math.round(H * dpr);
  const c = cv.getContext('2d');
  c.scale(dpr, dpr);
  const g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#294550');
  g.addColorStop(0.5, '#192930');
  g.addColorStop(1, '#0d1519');
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
  const v = c.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.25, W / 2, H * 0.5, Math.max(W, H) * 0.75);
  v.addColorStop(0, 'rgba(0, 0, 0, 0)');
  v.addColorStop(1, 'rgba(0, 0, 0, 0.45)');
  c.fillStyle = v;
  c.fillRect(0, 0, W, H);
  const s = c.createLinearGradient(0, 0, 0, H * 0.14);
  s.addColorStop(0, 'rgba(200, 232, 238, 0.10)');
  s.addColorStop(1, 'rgba(200, 232, 238, 0)');
  c.fillStyle = s;
  c.fillRect(0, 0, W, H * 0.14);
  return cv;
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
    g.addColorStop(0, `rgba(175, 215, 225, ${a})`);
    g.addColorStop(1, 'rgba(175, 215, 225, 0)');
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
function drawDust(c, W, H, t) {
  for (const d of DUST) {
    const x = (((d.x - t * 0.006 + Math.sin(t + d.y * 9) * 0.003) % 1) + 1) % 1;
    const y = (((d.y - t * d.v) % 1) + 1) % 1;
    c.fillStyle = `rgba(190, 220, 228, ${d.a})`;
    c.beginPath();
    c.arc(x * W, y * H, d.r, 0, Math.PI * 2);
    c.fill();
  }
}

// ---------- Надпись ----------
function makeWord(W, H, dpr) {
  const size = Math.round(Math.max(56, Math.min(W * 0.11, H * 0.19, 150)));
  const w = Math.ceil(size * 3.4);
  const h = Math.ceil(size * 1.7);
  const cv = document.createElement('canvas');
  cv.width = Math.round(w * dpr);
  cv.height = Math.round(h * dpr);
  const c = cv.getContext('2d');
  c.scale(dpr, dpr);
  c.textAlign = 'center';
  c.font = `600 ${size}px "Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif`;
  c.shadowColor = 'rgba(216, 199, 163, 0.38)';
  c.shadowBlur = size * 0.35;
  c.fillStyle = COL.word;
  c.fillText('Som', w / 2, size * 1.05);
  const scratch = document.createElement('canvas');
  scratch.width = cv.width;
  scratch.height = cv.height;
  return { cv, scratch, w, h, size, base: size * 1.05 };
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
    env(gg.gain, t, 0.2, 0.004, 0.1);
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
    let raf = 0;
    let start = 0;
    let last = 0;
    let phase = 0;
    let spawned = 0;
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
      drawRays(c, W, H, t);
      drawDust(c, W, H, t);

      // Надпись проявляется за хвостом.
      const wl = W / 2 - word.w / 2;
      const wt = H * 0.5 + word.size * 0.33 - word.base;
      const reveal = headX(g, t) + g.L * 1.2;
      const soft = g.L * 0.3;
      if (reveal + soft <= wl) {
        c.drawImage(word.cv, wl, wt, word.w, word.h);
      } else if (reveal < wl + word.w) {
        const s = word.scratch.getContext('2d');
        s.setTransform(1, 0, 0, 1, 0, 0);
        s.globalCompositeOperation = 'source-over';
        s.clearRect(0, 0, word.scratch.width, word.scratch.height);
        s.drawImage(word.cv, 0, 0);
        s.globalCompositeOperation = 'destination-in';
        const ex = (reveal - wl) * dpr;
        const gr = s.createLinearGradient(ex, 0, ex + soft * dpr, 0);
        gr.addColorStop(0, 'rgba(0,0,0,0)');
        gr.addColorStop(1, 'rgba(0,0,0,1)');
        s.fillStyle = gr;
        s.fillRect(0, 0, word.scratch.width, word.scratch.height);
        c.drawImage(word.scratch, wl, wt, word.w, word.h);
      }
      const tagA = clamp01((t - 2.05) / 0.4);
      if (tagA > 0) {
        c.fillStyle = `rgba(${COL.teal}, ${0.85 * tagA})`;
        c.textAlign = 'center';
        c.font = `500 ${Math.round(word.size * 0.16)}px "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif`;
        if ('letterSpacing' in c) c.letterSpacing = `${Math.round(word.size * 0.03)}px`;
        c.fillText('мессенджер для своих', W / 2, H * 0.5 + word.size * 0.33 + word.size * 0.5 + (1 - tagA) * 6);
        if ('letterSpacing' in c) c.letterSpacing = '0px';
      }

      // Пузырьки позади сома — сначала, остальные поверх.
      const hx = headX(g, t);
      const blink = t > 1.12 && t < 1.27 ? 0.12 : 1;
      const parts = hx < W + g.L * 0.3 && hx > -g.L * 1.4 ? drawFish(c, g, { hx, phase, sn, t, blink }) : null;
      while (spawned < SPAWNS.length && t >= SPAWNS[spawned][0]) {
        const [, n] = SPAWNS[spawned];
        spawned += 1;
        const at = parts ? (spawned % 2 ? parts.mouth : parts.gill) : { x: hx, y: g.pathY(hx) };
        for (let k = 0; k < n; k += 1) {
          const r = (2.5 + rnd() * 7) * (g.L / 380);
          bubbles.push({ x: at.x + (rnd() - 0.5) * 10, y: at.y + (rnd() - 0.5) * 8, r, vy: 38 + r * 8 + rnd() * 20, ph: rnd() * 6, age: -k * 0.06 });
        }
      }
      for (const b of bubbles) {
        b.age += dt;
        if (b.age < 0) continue;
        b.y -= b.vy * dt;
        b.x += Math.sin(b.ph + b.age * 6) * 0.6 - 6 * dt;
        b.r *= 1 + 0.08 * dt;
        const a = Math.min(1, b.age * 6) * (1 - clamp01((b.age - 1.6) / 0.6));
        if (a <= 0) continue;
        c.strokeStyle = `rgba(${COL.teal}, ${0.9 * a})`;
        c.lineWidth = Math.max(1.4, b.r * 0.28);
        c.beginPath(); c.arc(b.x, b.y, b.r, 0, Math.PI * 2); c.stroke();
        c.strokeStyle = `rgba(230, 245, 248, ${0.45 * a})`;
        c.lineWidth = Math.max(1, b.r * 0.16);
        c.beginPath(); c.arc(b.x, b.y, b.r * 0.55, Math.PI * 1.1, Math.PI * 1.5); c.stroke();
      }
      if (!done && t >= FADE_AT) finish(false);
      raf = requestAnimationFrame(frame);
    };

    // Первый кадр — сразу (вода), сам заплыв — когда окно на экране и звук готов.
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.drawImage(bg, 0, 0, W, H);
    (async () => {
      if (!(await shown())) { finish(true); return; }
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
