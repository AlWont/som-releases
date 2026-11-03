// Сом Som — один рисунок для значка и для заставки.
// Тело строится вдоль «позвоночника»: точки от кончика носа (u = 0) до основания хвоста (u = 1).
// Объём — без размытия (оно дорогое в каждом кадре): тело режется на узкие полоски поперёк,
// у каждой свой градиент от тёмной спины к светлому брюху; пятна, блики и тени — мягкими градиентами.

export const FISH = {
  back: '#5f4c31', // спина
  flank: '#bda57a', // бока
  light: '#e2d0a6',
  belly: '#f3e8cf', // брюхо
  under: '#a88f66', // тень под брюхом
  spot: '52, 38, 22', // пятна на спине
  fin: '196, 168, 122',
  finEdge: '122, 98, 64',
  ink: '#0e1518',
  iris: '#b38a45',
  rim: '255, 244, 220',
};

export function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/** Половина высоты тела в долях длины: широкая плоская голова, брюшко, тонкий хвостовой стебель. */
export function half(u, girth = 1) {
  const HM = 0.118 * girth;
  const H0 = 0.24; // самое широкое место — сразу за головой
  let v;
  if (u < H0) { const k = (H0 - u) / (H0 + 0.03); v = HM * Math.sqrt(Math.max(0, 1 - k * k)); } else v = HM * (1 - (1 - 0.26 / girth) * Math.pow((u - H0) / (1 - H0), 1.05 + 0.25 * (girth - 1)));
  return v;
}
const bellyBulge = (u) => 0.018 * Math.exp(-(((u - 0.34) / 0.13) ** 2));

/** Нормали, касательные и толщина в каждой точке позвоночника. */
export function frameSpine(S, L, girth = 1) {
  const N = S.length - 1;
  for (let i = 0; i <= N; i += 1) {
    const a = S[Math.max(0, i - 1)];
    const b = S[Math.min(N, i + 1)];
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    const u = S[i].u;
    Object.assign(S[i], { dx, dy, nx: -dy, ny: dx, ht: half(u, girth) * L * 0.95, hb: (half(u, girth) * 0.98 + bellyBulge(u) * girth) * L });
  }
  return S;
}
/** Точка на теле: v = −1 — край спины, 0 — середина, +1 — край брюха. */
const at = (p, v) => {
  const h = v < 0 ? p.ht : p.hb;
  return { x: p.x + p.nx * h * v, y: p.y + p.ny * h * v };
};
/** Точка позвоночника при любом u (между узлами — линейно). */
function spineAt(S, u) {
  const N = S.length - 1;
  const f = Math.max(0, Math.min(N, u * N));
  const i = Math.min(N - 1, Math.floor(f));
  const k = f - i;
  const a = S[i];
  const b = S[i + 1];
  const mix = (x, y) => x + (y - x) * k;
  return { u, x: mix(a.x, b.x), y: mix(a.y, b.y), dx: mix(a.dx, b.dx), dy: mix(a.dy, b.dy), nx: mix(a.nx, b.nx), ny: mix(a.ny, b.ny), ht: mix(a.ht, b.ht), hb: mix(a.hb, b.hb) };
}

function smooth(c, pts) {
  c.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length - 1; i += 1) c.quadraticCurveTo(pts[i].x, pts[i].y, (pts[i].x + pts[i + 1].x) / 2, (pts[i].y + pts[i + 1].y) / 2);
  const last = pts[pts.length - 1];
  c.lineTo(last.x, last.y);
}
function through(c, pts) {
  for (let i = 1; i < pts.length - 1; i += 1) c.quadraticCurveTo(pts[i].x, pts[i].y, (pts[i].x + pts[i + 1].x) / 2, (pts[i].y + pts[i + 1].y) / 2);
  const last = pts[pts.length - 1];
  c.lineTo(last.x, last.y);
}

/** Контур тела (без хвостового плавника): спина → тупой нос → брюхо. */
function bodyPath(c, S, L) {
  const top = S.map((p) => at(p, -1));
  const bot = S.map((p) => at(p, 1));
  const s0 = S[0];
  c.beginPath();
  c.moveTo(bot[bot.length - 1].x, bot[bot.length - 1].y);
  through(c, [bot[bot.length - 1], ...bot.slice(0, -1).reverse()]);
  const k = L * 0.075;
  c.bezierCurveTo(bot[0].x - s0.dx * k, bot[0].y - s0.dy * k, top[0].x - s0.dx * k * 1.1, top[0].y - s0.dy * k * 1.1, top[0].x, top[0].y);
  through(c, top);
  c.closePath();
}

// Пятна на спине и боках (в координатах тела: u — вдоль, v — поперёк).
const SPOTS = (() => {
  const r = rng(11);
  const out = [];
  for (let i = 0; i < 46; i += 1) out.push({ u: 0.1 + r() * 0.88, v: -0.15 - r() * 0.8, r: 0.012 + r() * 0.03, a: 0.22 + r() * 0.3 });
  for (let i = 0; i < 18; i += 1) out.push({ u: 0.2 + r() * 0.75, v: -0.1 + r() * 0.45, r: 0.006 + r() * 0.012, a: 0.12 + r() * 0.14, light: true });
  return out;
})();

// Усы: основание, изгиб, кончик — в долях длины от носа (x — к хвосту, y — к брюху).
// Два длинных — из уголков верхней челюсти, четыре коротких — на подбородке. far — с дальней стороны (за телом).
const WHISKERS = [
  { b: [0.03, 0.02], c: [-0.13, 0.1], c2: [0.06, 0.33], e: [0.52, 0.3], w: 0.022, k: 0, far: false },
  { b: [0.045, 0.0], c: [-0.1, 0.04], c2: [0.08, 0.2], e: [0.46, 0.2], w: 0.016, k: 1.3, far: true },
  { b: [0.075, 0.075], c: [0.05, 0.16], e: [0.14, 0.235], w: 0.011, k: 2.2, far: false },
  { b: [0.1, 0.085], c: [0.1, 0.15], e: [0.19, 0.2], w: 0.009, k: 3.1, far: false },
  { b: [0.085, 0.07], c: [0.08, 0.14], e: [0.16, 0.19], w: 0.008, k: 4.0, far: true },
];

function whisker(c, S, L, w, o) {
  const s0 = S[0];
  const nose = { x: s0.x - s0.dx * L * 0.028, y: s0.y - s0.dy * L * 0.028 };
  const W2 = (v) => ({ x: nose.x + (s0.dx * v[0] + s0.nx * v[1]) * L, y: nose.y + (s0.dy * v[0] + s0.ny * v[1]) * L });
  const rot = (v, base, a) => { const x = v[0] - base[0]; const y = v[1] - base[1]; return [base[0] + x * Math.cos(a) - y * Math.sin(a), base[1] + x * Math.sin(a) + y * Math.cos(a)]; };
  // Чем быстрее плывёт — тем сильнее усы сносит назад; плюс лёгкое колыхание.
  const a = -(0.1 + 0.3 * (o.sn ?? 0.5)) + 0.1 * Math.sin((o.t ?? 0) * 2 * Math.PI * 1.2 + w.k) + (o.whiskerTilt ?? 0);
  const p0 = W2(w.b);
  const p1 = W2(rot(w.c, w.b, a * 0.4));
  const pc = w.c2 ? W2(rot(w.c2, w.b, a * 0.75)) : null;
  const p2 = W2(rot(w.e, w.b, a));
  // Длинные усы — кубическая кривая (вперёд, вниз и плавно назад), короткие — квадратичная.
  const pt = (s) => (pc
    ? { x: (1 - s) ** 3 * p0.x + 3 * (1 - s) ** 2 * s * p1.x + 3 * (1 - s) * s * s * pc.x + s ** 3 * p2.x, y: (1 - s) ** 3 * p0.y + 3 * (1 - s) ** 2 * s * p1.y + 3 * (1 - s) * s * s * pc.y + s ** 3 * p2.y }
    : { x: (1 - s) ** 2 * p0.x + 2 * (1 - s) * s * p1.x + s * s * p2.x, y: (1 - s) ** 2 * p0.y + 2 * (1 - s) * s * p1.y + s * s * p2.y });
  const SEG = o.small ? 8 : pc ? 22 : 12;
  const base = w.w * L * (o.whiskerScale ?? (o.small ? 3.6 : 1));
  let prev = p0;
  for (let j = 1; j <= SEG; j += 1) {
    const s = j / SEG;
    const q = pt(s);
    c.lineWidth = Math.max(o.small ? 1.2 : 0.8, base * (1 - 0.8 * s));
    const al = w.far ? 0.7 * (1 - 0.5 * s) : 1 - (o.small ? 0.15 : 0.35) * s;
    c.strokeStyle = w.far ? `rgba(150, 128, 92, ${al})` : o.small ? `rgba(236, 222, 190, ${al})` : `rgba(222, 204, 165, ${al})`;
    c.beginPath(); c.moveTo(prev.x, prev.y); c.lineTo(q.x, q.y); c.stroke();
    prev = q;
  }
  if (!w.far && !o.small) {
    // Блик вдоль уса.
    c.lineWidth = Math.max(0.6, base * 0.3);
    c.strokeStyle = `rgba(${FISH.rim}, 0.45)`;
    c.beginPath();
    for (let j = 0; j <= 9; j += 1) {
      const s = j / 18;
      const q = pt(s);
      if (j === 0) c.moveTo(q.x - s0.nx * base * 0.2, q.y - s0.ny * base * 0.2); else c.lineTo(q.x - s0.nx * base * 0.2, q.y - s0.ny * base * 0.2);
    }
    c.stroke();
  }
}

/** Полупрозрачный плавник: заливка от основания к краю и лучи. */
function finFill(c, from, to, alpha) {
  const g = c.createLinearGradient(from.x, from.y, to.x, to.y);
  g.addColorStop(0, `rgba(${FISH.fin}, ${alpha})`);
  g.addColorStop(1, `rgba(${FISH.fin}, ${alpha * 0.45})`);
  return g;
}
function rays(c, base, tips, L, small) {
  if (small) return;
  c.strokeStyle = `rgba(${FISH.finEdge}, 0.35)`;
  c.lineWidth = Math.max(0.6, L * 0.003);
  c.beginPath();
  for (let i = 0; i < tips.length; i += 1) { c.moveTo(base[i].x, base[i].y); c.lineTo(tips[i].x, tips[i].y); }
  c.stroke();
}

/** Хвост: широкий закруглённый веер. Возвращает контур для лучей. */
function tail(c, S, L, o) {
  const e = S[S.length - 1];
  const ta = o.tailAngle ?? 0;
  const tdx = e.dx * Math.cos(ta) - e.dy * Math.sin(ta);
  const tdy = e.dx * Math.sin(ta) + e.dy * Math.cos(ta);
  const flap = o.flap ?? 1;
  const P = (a, b) => ({ x: e.x + (tdx * a - tdy * b) * L, y: e.y + (tdy * a + tdx * b) * L });
  const base1 = at(e, -1);
  const base2 = at(e, 1);
  const tipT = P(0.19, -0.135 * flap);
  const tipB = P(0.19, 0.135 * flap);
  c.beginPath();
  c.moveTo(base1.x - e.dx * L * 0.03, base1.y - e.dy * L * 0.03);
  const q1 = P(0.07, -0.07 * flap);
  c.quadraticCurveTo(q1.x, q1.y, tipT.x, tipT.y);
  const m1 = P(0.225, -0.06 * flap);
  const mid = P(0.2, 0);
  const m2 = P(0.225, 0.06 * flap);
  c.quadraticCurveTo(m1.x, m1.y, mid.x, mid.y);
  c.quadraticCurveTo(m2.x, m2.y, tipB.x, tipB.y);
  const q2 = P(0.07, 0.07 * flap);
  c.quadraticCurveTo(q2.x, q2.y, base2.x - e.dx * L * 0.03, base2.y - e.dy * L * 0.03);
  c.closePath();
  c.fillStyle = finFill(c, e, mid, 0.92);
  c.fill();
  if (!o.small) {
    const base = [];
    const tips = [];
    for (let i = 0; i <= 8; i += 1) {
      const s = i / 8 - 0.5;
      base.push(P(0.01, s * 0.05));
      tips.push(P(0.2 - Math.abs(s) * 0.02, s * 0.25 * flap));
    }
    rays(c, base, tips, L, o.small);
    c.strokeStyle = `rgba(${FISH.finEdge}, 0.4)`;
    c.lineWidth = Math.max(0.8, L * 0.004);
    c.beginPath(); c.moveTo(tipT.x, tipT.y); c.quadraticCurveTo(m1.x, m1.y, mid.x, mid.y); c.quadraticCurveTo(m2.x, m2.y, tipB.x, tipB.y); c.stroke();
  }
}

/** Длинный плавник снизу — тянется почти до хвоста и колышется волной. */
function analFin(c, S, L, o) {
  const N = S.length - 1;
  const j1 = Math.round(N * 0.46);
  const j2 = N;
  const edge = [];
  const base = [];
  for (let j = j1; j <= j2; j += 1) {
    const q = (j - j1) / (j2 - j1);
    const p = S[j];
    const hgt = L * (0.014 + 0.062 * Math.sin(Math.PI * Math.min(1, q * 1.1)) * (1 - 0.25 * q)) * (0.6 + 0.4 * (o.girth ?? 1)) * (1 + 0.16 * Math.sin((o.phase ?? 0) * 1.3 - q * 6));
    const b = at(p, 0.9);
    base.push(b);
    edge.push({ x: b.x + p.nx * hgt - p.dx * L * 0.014, y: b.y + p.ny * hgt - p.dy * L * 0.014 });
  }
  c.beginPath();
  c.moveTo(base[0].x, base[0].y);
  for (const p of edge) c.lineTo(p.x, p.y);
  for (let i = base.length - 1; i >= 0; i -= 1) c.lineTo(base[i].x, base[i].y);
  c.closePath();
  const m = Math.floor(base.length / 2);
  c.fillStyle = finFill(c, base[m], edge[m], 0.85);
  c.fill();
  rays(c, base.filter((_, i) => i % 2 === 0), edge.filter((_, i) => i % 2 === 0), L, o.small);
}
function dorsalFin(c, S, L) {
  const A = spineAt(S, 0.29);
  const M = spineAt(S, 0.35);
  const B = spineAt(S, 0.4);
  const a = at(A, -0.92);
  const b = at(B, -0.92);
  const apex = { x: at(M, -1).x - M.nx * L * 0.075 + M.dx * L * 0.045, y: at(M, -1).y - M.ny * L * 0.075 + M.dy * L * 0.045 };
  c.beginPath();
  c.moveTo(a.x, a.y);
  c.quadraticCurveTo(a.x - A.nx * L * 0.05 + A.dx * L * 0.03, a.y - A.ny * L * 0.05 + A.dy * L * 0.03, apex.x, apex.y);
  c.quadraticCurveTo(b.x - B.nx * L * 0.02, b.y - B.ny * L * 0.02, b.x, b.y);
  c.closePath();
  c.fillStyle = finFill(c, M, apex, 0.95);
  c.fill();
}
function pectoral(c, S, L, o) {
  const pi = spineAt(S, 0.215);
  const pa = 0.26 * Math.sin((o.phase ?? 0) * 0.9 + 1) + (o.pecTilt ?? 0);
  const fdx = pi.dx * Math.cos(pa) - pi.dy * Math.sin(pa);
  const fdy = pi.dx * Math.sin(pa) + pi.dy * Math.cos(pa);
  const b1 = at(pi, 0.42);
  const tip = { x: b1.x + (fdx * 0.12 - fdy * 0.07) * L, y: b1.y + (fdy * 0.12 + fdx * 0.07) * L };
  const c1 = { x: b1.x + (fdx * 0.02 - fdy * 0.075) * L, y: b1.y + (fdy * 0.02 + fdx * 0.075) * L };
  const back = { x: b1.x + fdx * 0.07 * L, y: b1.y + fdy * 0.07 * L };
  c.beginPath();
  c.moveTo(b1.x, b1.y);
  c.quadraticCurveTo(c1.x, c1.y, tip.x, tip.y);
  c.quadraticCurveTo(b1.x + fdx * 0.1 * L, b1.y + fdy * 0.1 * L, back.x, back.y);
  c.closePath();
  c.fillStyle = finFill(c, b1, tip, 0.9);
  c.fill();
  if (!o.small) {
    const base = [];
    const tips = [];
    for (let i = 0; i < 5; i += 1) {
      const s = i / 4;
      base.push({ x: b1.x + (back.x - b1.x) * s * 0.4, y: b1.y + (back.y - b1.y) * s * 0.4 });
      tips.push({ x: tip.x + (back.x - tip.x) * s * 0.7, y: tip.y + (back.y - tip.y) * s * 0.7 });
    }
    rays(c, base, tips, L, false);
  }
}

/** Тело: полоски поперёк с градиентом спина → бока → брюхо, пятна, боковая линия, блики. */
function body(c, S, L, o) {
  const N = S.length - 1;
  c.save();
  bodyPath(c, S, L);
  c.clip();
  // Полоски. Каждая чуть шире шага, чтобы между ними не было щелей.
  for (let i = 0; i < N; i += 1) {
    const a = S[i];
    const b = S[i + 1];
    const m = spineAt(S, (a.u + b.u) / 2);
    const g = c.createLinearGradient(at(m, -1).x, at(m, -1).y, at(m, 1).x, at(m, 1).y);
    g.addColorStop(0, o.small ? '#9a8158' : FISH.back);
    g.addColorStop(0.3, o.small ? '#c2a97c' : '#8d7550');
    g.addColorStop(0.5, FISH.flank);
    g.addColorStop(0.66, FISH.light);
    g.addColorStop(0.84, FISH.belly);
    g.addColorStop(1, FISH.under);
    c.fillStyle = g;
    const ext = 0.8;
    const a1 = { x: a.x - a.dx * ext, y: a.y - a.dy * ext };
    const b1 = { x: b.x + b.dx * ext, y: b.y + b.dy * ext };
    c.beginPath();
    c.moveTo(a1.x - a.nx * a.ht * 1.6, a1.y - a.ny * a.ht * 1.6);
    c.lineTo(b1.x - b.nx * b.ht * 1.6, b1.y - b.ny * b.ht * 1.6);
    c.lineTo(b1.x + b.nx * b.hb * 1.6, b1.y + b.ny * b.hb * 1.6);
    c.lineTo(a1.x + a.nx * a.hb * 1.6, a1.y + a.ny * a.hb * 1.6);
    c.closePath();
    c.fill();
  }
  // Нос — перед первой полоской.
  const s0 = S[0];
  const g0 = c.createLinearGradient(at(s0, -1).x, at(s0, -1).y, at(s0, 1).x, at(s0, 1).y);
  g0.addColorStop(0, FISH.back); g0.addColorStop(0.5, FISH.flank); g0.addColorStop(0.85, FISH.belly); g0.addColorStop(1, FISH.under);
  c.fillStyle = g0;
  c.fillRect(s0.x - L * 0.12, s0.y - L * 0.12, L * 0.13, L * 0.24);
  if (!o.small) {
    // Мраморные пятна.
    for (const s of SPOTS) {
      const p = spineAt(S, s.u);
      const q = at(p, s.v);
      const r = s.r * L * (0.55 + 0.45 * (half(s.u) / 0.118));
      const g = c.createRadialGradient(q.x, q.y, 0, q.x, q.y, r);
      g.addColorStop(0, s.light ? `rgba(${FISH.rim}, ${s.a})` : `rgba(${FISH.spot}, ${s.a})`);
      g.addColorStop(1, s.light ? `rgba(${FISH.rim}, 0)` : `rgba(${FISH.spot}, 0)`);
      c.fillStyle = g;
      c.fillRect(q.x - r, q.y - r, r * 2, r * 2);
    }
    // Боковая линия.
    c.strokeStyle = `rgba(${FISH.rim}, 0.16)`;
    c.lineWidth = Math.max(0.7, L * 0.004);
    c.beginPath();
    smooth(c, S.filter((p) => p.u > 0.24 && p.u < 0.97).map((p) => at(p, -0.12)));
    c.stroke();
  }
  // Солнечные блики сквозь воду пляшут по спине (картинка каустики, только в пределах тела).
  if (o.caustic?.img?.naturalWidth) {
    const k = o.caustic;
    c.save();
    c.globalCompositeOperation = 'lighter';
    c.globalAlpha = k.alpha ?? 0.14;
    c.drawImage(k.img, k.x, k.y, k.size, k.size);
    c.restore();
  }
  // Мягкий блик по спине: несколько полос всё уже и ярче — вместо дорогого размытия.
  const hl = S.filter((p) => p.u > 0.04 && p.u < 0.72).map((p) => at(p, -0.6));
  const passes = o.small ? [[0.06, 0.12]] : [[0.07, 0.05], [0.042, 0.07], [0.02, 0.1], [0.008, 0.16]];
  c.lineCap = 'round';
  for (const [w, al] of passes) {
    const gl = c.createLinearGradient(hl[0].x, hl[0].y, hl[hl.length - 1].x, hl[hl.length - 1].y);
    gl.addColorStop(0, `rgba(${FISH.rim}, ${al})`);
    gl.addColorStop(0.55, `rgba(${FISH.rim}, ${al * 0.8})`);
    gl.addColorStop(1, `rgba(${FISH.rim}, 0)`);
    c.strokeStyle = gl;
    c.lineWidth = Math.max(1, w * L);
    c.beginPath(); smooth(c, hl); c.stroke();
  }
  // Свет сверху на голове.
  const hp = at(spineAt(S, 0.11), -0.45);
  const hr = half(0.11, o.girth ?? 1) * L * 1.3;
  const hg = c.createRadialGradient(hp.x, hp.y, 0, hp.x, hp.y, hr);
  hg.addColorStop(0, `rgba(${FISH.rim}, ${o.small ? 0.25 : 0.2})`);
  hg.addColorStop(1, `rgba(${FISH.rim}, 0)`);
  c.fillStyle = hg;
  c.fillRect(hp.x - hr, hp.y - hr, hr * 2, hr * 2);
  // Тень по брюху — тело круглое.
  const sh = S.filter((p) => p.u > 0.02).map((p) => at(p, 1.02));
  for (const [w, al] of (o.small ? [[0.05, 0.25]] : [[0.06, 0.12], [0.03, 0.16], [0.012, 0.2]])) {
    c.strokeStyle = `rgba(40, 30, 18, ${al})`;
    c.lineWidth = Math.max(1, w * L);
    c.beginPath(); smooth(c, sh); c.stroke();
  }
  c.restore();
  // Ободок света по спине — свет с поверхности.
  if (!o.small) {
    const rim = S.filter((p) => p.u > 0.03 && p.u < 0.9).map((p) => at(p, -0.985));
    const rg = c.createLinearGradient(rim[0].x, rim[0].y, rim[rim.length - 1].x, rim[rim.length - 1].y);
    rg.addColorStop(0, `rgba(${FISH.rim}, 0.75)`);
    rg.addColorStop(0.5, `rgba(${FISH.rim}, 0.35)`);
    rg.addColorStop(1, `rgba(${FISH.rim}, 0)`);
    c.strokeStyle = rg;
    c.lineWidth = Math.max(0.7, L * 0.005);
    c.beginPath(); smooth(c, rim); c.stroke();
  }
}

function head(c, S, L, o) {
  const s0 = S[0];
  // Рот — широкая щель вдоль нижней челюсти.
  const m1 = spineAt(S, 0.03);
  const m3 = spineAt(S, 0.115);
  c.strokeStyle = 'rgba(38, 26, 14, 0.55)';
  c.lineWidth = Math.max(1, L * (o.small ? 0.014 : 0.008));
  c.lineCap = 'round';
  c.beginPath();
  const lip = at(s0, 0.3);
  c.moveTo(lip.x - s0.dx * L * 0.022, lip.y - s0.dy * L * 0.022);
  const q1 = at(m1, 0.5);
  const q3 = at(m3, 0.3);
  c.quadraticCurveTo(q1.x, q1.y, q3.x, q3.y);
  c.stroke();
  if (o.small) return;
  // Губа — светлая кромка над щелью.
  c.strokeStyle = `rgba(${FISH.rim}, 0.25)`;
  c.lineWidth = Math.max(0.6, L * 0.004);
  c.beginPath();
  c.moveTo(lip.x - s0.dx * L * 0.022 - s0.nx * L * 0.008, lip.y - s0.dy * L * 0.022 - s0.ny * L * 0.008);
  c.quadraticCurveTo(q1.x - s0.nx * L * 0.008, q1.y - s0.ny * L * 0.008, q3.x - s0.nx * L * 0.008, q3.y - s0.ny * L * 0.008);
  c.stroke();
  // Жаберная крышка.
  const gi = spineAt(S, 0.2);
  const g1 = at(gi, -0.62);
  const g2 = at(gi, 0.66);
  c.strokeStyle = 'rgba(48, 34, 20, 0.28)';
  c.lineWidth = Math.max(0.8, L * 0.007);
  c.beginPath();
  c.moveTo(g1.x, g1.y);
  c.quadraticCurveTo(gi.x + gi.dx * L * 0.035, gi.y + gi.dy * L * 0.035, g2.x, g2.y);
  c.stroke();
  c.strokeStyle = `rgba(${FISH.rim}, 0.18)`;
  c.beginPath();
  c.moveTo(g1.x + gi.dx * L * 0.008, g1.y + gi.dy * L * 0.008);
  c.quadraticCurveTo(gi.x + gi.dx * L * 0.045, gi.y + gi.dy * L * 0.045, g2.x + gi.dx * L * 0.008, g2.y + gi.dy * L * 0.008);
  c.stroke();
  // Ноздри.
  const nn = at(spineAt(S, 0.035), -0.55);
  c.fillStyle = 'rgba(38, 26, 14, 0.4)';
  c.beginPath(); c.arc(nn.x, nn.y, L * 0.0055, 0, Math.PI * 2); c.fill();
}

function eye(c, S, L, o) {
  const ei = spineAt(S, 0.09);
  const p = at(ei, -0.42);
  const r = L * (o.small ? 0.05 : 0.023);
  c.save();
  c.translate(p.x, p.y);
  c.rotate(Math.atan2(ei.dy, ei.dx));
  c.scale(1, o.blink ?? 1);
  if (!o.small) {
    // Светлая «оправа» вокруг глаза — он не тонет в тёмной спине.
    c.fillStyle = 'rgba(232, 214, 176, 0.45)';
    c.beginPath(); c.arc(0, 0, r * 1.45, 0, Math.PI * 2); c.fill();
    const ir = c.createRadialGradient(-r * 0.2, -r * 0.2, 0, 0, 0, r);
    ir.addColorStop(0, '#d8b46a');
    ir.addColorStop(1, FISH.iris);
    c.fillStyle = ir;
    c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.fill();
    c.fillStyle = FISH.ink;
    c.beginPath(); c.arc(r * 0.08, r * 0.05, r * 0.68, 0, Math.PI * 2); c.fill();
  } else {
    c.fillStyle = FISH.ink;
    c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.fill();
  }
  if ((o.blink ?? 1) > 0.5) {
    c.fillStyle = 'rgba(255, 255, 255, 0.85)';
    c.beginPath(); c.arc(-r * 0.3, -r * 0.32, r * (o.small ? 0.36 : 0.3), 0, Math.PI * 2); c.fill();
    if (!o.small) { c.fillStyle = 'rgba(255, 255, 255, 0.35)'; c.beginPath(); c.arc(r * 0.32, r * 0.3, r * 0.13, 0, Math.PI * 2); c.fill(); }
  }
  c.restore();
}

/**
 * Нарисовать сома.
 * S — точки позвоночника [{u, x, y}] от носа к хвосту (их меняет заставка, чтобы он плыл), L — длина тела.
 * o: { t, phase, sn — скорость 0…1, blink, tailAngle, flap, small — упрощённый для маленьких значков, shadow }
 */
export function drawCatfish(c, S, L, o = {}) {
  frameSpine(S, L, o.girth ?? 1);
  c.save();
  c.lineCap = 'round';
  c.lineJoin = 'round';
  // Дальние усы и плавники — за телом.
  for (const w of WHISKERS) if (w.far && !o.small) whisker(c, S, L, w, o);
  dorsalFin(c, S, L);
  analFin(c, S, L, o);
  tail(c, S, L, o);
  if (o.shadow) {
    c.save();
    c.shadowColor = o.shadow;
    c.shadowBlur = L * 0.08;
    c.shadowOffsetY = L * 0.045;
    bodyPath(c, S, L);
    c.fillStyle = FISH.flank;
    c.fill();
    c.restore();
  }
  body(c, S, L, o);
  head(c, S, L, o);
  pectoral(c, S, L, o);
  eye(c, S, L, o);
  for (const w of WHISKERS) if (!w.far && (!o.small || w.w > 0.012)) whisker(c, S, L, w, o);
  c.restore();
  const s0 = S[0];
  return { mouth: { x: s0.x - s0.dx * L * 0.03 + s0.nx * L * 0.02, y: s0.y - s0.dy * L * 0.03 + s0.ny * L * 0.02 }, gill: at(spineAt(S, 0.2), -0.6) };
}

/** Пузырёк: прозрачный, со светлым ободком и бликом. */
export function drawBubble(c, x, y, r, a = 1) {
  if (r <= 0.3) return;
  const g = c.createRadialGradient(x - r * 0.25, y - r * 0.3, r * 0.1, x, y, r);
  g.addColorStop(0, `rgba(210, 240, 245, ${0.04 * a})`);
  g.addColorStop(0.75, `rgba(200, 235, 242, ${0.1 * a})`);
  g.addColorStop(0.93, `rgba(215, 245, 250, ${0.55 * a})`);
  g.addColorStop(1, `rgba(215, 245, 250, ${0.1 * a})`);
  c.fillStyle = g;
  c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
  c.fillStyle = `rgba(255, 255, 255, ${0.8 * a})`;
  c.beginPath(); c.ellipse(x - r * 0.38, y - r * 0.4, r * 0.24, r * 0.15, -0.7, 0, Math.PI * 2); c.fill();
  if (r > 3) { c.fillStyle = `rgba(255, 255, 255, ${0.3 * a})`; c.beginPath(); c.arc(x + r * 0.35, y + r * 0.42, r * 0.09, 0, Math.PI * 2); c.fill(); }
}

/** Позвоночник для значка: лёгкий изгиб, как в момент гребка хвостом. */
export function logoSpine(x0, y0, L, n = 34, bend = 1, tilt = 0) {
  const S = [];
  const cs = Math.cos(tilt);
  const sn = Math.sin(tilt);
  for (let i = 0; i <= n; i += 1) {
    const u = i / n;
    const x = u * L;
    const y = L * bend * (0.045 * Math.sin(u * Math.PI * 1.15 + 0.15) - 0.03 * u * u);
    S.push({ u, x: x0 + x * cs - y * sn, y: y0 + x * sn + y * cs });
  }
  return S;
}
