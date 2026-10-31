// Украшения: рамки аватара (их видят друзья), фон переписки (рисунок или своя картинка)
// и эффекты — тихие в фоне (пузырьки, снег…) и праздничные на сообщения (конфетти, сердечки, салют).
// Всё рисуется на этом ПК; фон и эффекты — только у вас.

const $ = (id) => document.getElementById(id);
function pref(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } }
function setPref(k, v) { try { localStorage.setItem(k, v); } catch { /* без памяти — не страшно */ } }

// ---------- Рамки ----------
export const FRAMES = [
  { id: '', name: 'Без рамки' },
  { id: 'gold', name: 'Золото' },
  { id: 'silver', name: 'Серебро' },
  { id: 'neon', name: 'Неон' },
  { id: 'rainbow', name: 'Радуга' },
  { id: 'gamer', name: 'Геймер' },
  { id: 'fire', name: 'Огонь' },
  { id: 'ice', name: 'Лёд' },
  { id: 'leaves', name: 'Листва' },
  { id: 'sakura', name: 'Сакура' },
  { id: 'crown', name: 'Корона' },
  { id: 'stars', name: 'Звёзды' },
  { id: 'hearts', name: 'Сердечки' },
  { id: 'catfish', name: 'Сом' },
  { id: 'tar', name: 'Нефть' },
];
const FRAME_IDS = new Set(FRAMES.map((f) => f.id));
/** Повесить рамку на элемент аватара (неизвестную — не вешаем: пришла из более новой версии). */
export function putFrame(el, frame) {
  if (frame && FRAME_IDS.has(frame)) el.dataset.frame = frame;
  else delete el.dataset.frame;
  return el;
}

// ---------- Рисунки для фона ----------
// Плитка 200×200: линии цветом текста темы, прозрачность — «Заметность».
function rng(seed) { let s = seed; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; }
const P = {
  fish: {
    name: 'Сомики',
    draw: (r) => {
      const fish = (x, y, a, k) => `<g transform="translate(${x} ${y}) rotate(${a}) scale(${k})"><path d="M0 8C8 0 24 0 32 6L40 1 38 8 40 15 32 10C24 16 8 16 0 8Z"/><path d="M3 9C-2 12-5 15-7 19M3 8C-2 6-6 6-9 7"/><circle cx="7" cy="6" r="1.1" fill="C"/></g>`;
      let out = '';
      for (const [x, y, a] of [[24, 30, -12], [118, 22, 8], [62, 92, 175], [146, 112, -20], [30, 158, 10], [120, 170, 190]]) out += fish(x, y, a, 0.8 + r() * 0.35);
      for (let i = 0; i < 9; i += 1) out += `<circle cx="${(20 + r() * 160).toFixed(0)}" cy="${(20 + r() * 160).toFixed(0)}" r="${(1.5 + r() * 3.5).toFixed(1)}"/>`;
      return out;
    },
  },
  bubbles: {
    name: 'Пузырьки',
    draw: (r) => {
      let out = '';
      for (let i = 0; i < 16; i += 1) {
        const x = 18 + r() * 164; const y = 18 + r() * 164; const rr = 3 + r() * 13;
        out += `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${rr.toFixed(1)}"/>`;
        if (rr > 8) out += `<path d="M${(x - rr * 0.5).toFixed(1)} ${(y - rr * 0.2).toFixed(1)}a${(rr * 0.55).toFixed(1)} ${(rr * 0.55).toFixed(1)} 0 0 1 ${(rr * 0.4).toFixed(1)} -${(rr * 0.35).toFixed(1)}"/>`;
      }
      return out;
    },
  },
  waves: {
    name: 'Волны',
    draw: () => [10, 60, 110, 160].map((y, i) => `<path d="M${-25 + (i % 2) * 25} ${y + 15}q25-15 50 0t50 0 50 0 50 0 50 0"/>`).join(''),
  },
  games: {
    name: 'Игры',
    draw: (r) => {
      const at = (x, y, a, inner) => `<g transform="translate(${x} ${y}) rotate(${a})">${inner}</g>`;
      const pad = '<path d="M-14 -6h28a8 8 0 0 1 7 11l-4 7a5 5 0 0 1-8 1l-3-4h-12l-3 4a5 5 0 0 1-8-1l-4-7a8 8 0 0 1 7-11z"/><path d="M-9 0h6M-6 -3v6"/><circle cx="6" cy="-1" r="1" fill="C"/><circle cx="10" cy="2" r="1" fill="C"/>';
      const shapes = ['<circle r="7"/>', '<path d="M0-8 7 5H-7z"/>', '<path d="M-6-6 6 6M6-6-6 6"/>', '<rect x="-6" y="-6" width="12" height="12" rx="1"/>', '<path d="M2-10-5 1h5l-2 9 7-11H0z"/>', '<path d="M0 6-7-1a4 4 0 0 1 7-5 4 4 0 0 1 7 5z"/>'];
      let out = at(46, 42, -14, pad) + at(150, 140, 12, pad);
      [[140, 36], [104, 86], [34, 112], [74, 162], [176, 92], [22, 180], [120, 190], [90, 22]].forEach(([x, y], i) => { out += at(x, y, (r() * 60 - 30).toFixed(0), shapes[i % shapes.length]); });
      return out;
    },
  },
  stars: {
    name: 'Звёзды',
    draw: (r) => {
      const star = (x, y, k, a) => `<path transform="translate(${x} ${y}) rotate(${a}) scale(${k})" d="M0-10 2.9-4 9.5-3.1 4.8 1.5 5.9 8.1 0 5 -5.9 8.1 -4.8 1.5 -9.5-3.1 -2.9-4z"/>`;
      const spark = (x, y, k) => `<path transform="translate(${x} ${y}) scale(${k})" d="M0-7C1-1 1-1 7 0 1 1 1 1 0 7-1 1-1 1-7 0-1-1-1-1 0-7z"/>`;
      let out = '';
      for (let i = 0; i < 6; i += 1) out += star((20 + r() * 160).toFixed(0), (20 + r() * 160).toFixed(0), (0.6 + r() * 0.7).toFixed(2), (r() * 70).toFixed(0));
      for (let i = 0; i < 6; i += 1) out += spark((15 + r() * 170).toFixed(0), (15 + r() * 170).toFixed(0), (0.6 + r() * 0.8).toFixed(2));
      for (let i = 0; i < 14; i += 1) out += `<circle cx="${(8 + r() * 184).toFixed(0)}" cy="${(8 + r() * 184).toFixed(0)}" r="1" fill="C"/>`;
      return out;
    },
  },
  leaves: {
    name: 'Листья',
    draw: (r) => {
      let out = '';
      for (let i = 0; i < 9; i += 1) {
        const x = 22 + r() * 156; const y = 22 + r() * 156; const a = r() * 360; const k = 0.6 + r() * 0.6;
        out += `<g transform="translate(${x.toFixed(0)} ${y.toFixed(0)}) rotate(${a.toFixed(0)}) scale(${k.toFixed(2)})"><path d="M-16 0C-8-10 8-10 16 0 8 10-8 10-16 0Z"/><path d="M-20 0H14M-6 0 0-5M2 0l6-4M-6 0l6 5M2 0l6 4"/></g>`;
      }
      return out;
    },
  },
  notes: {
    name: 'Ноты',
    draw: (r) => {
      const n1 = '<ellipse cx="-4" cy="8" rx="4.5" ry="3.2" transform="rotate(-20 -4 8)" fill="C"/><path d="M0 7V-12q6 3 9 8"/>';
      const n2 = '<ellipse cx="-6" cy="9" rx="4.5" ry="3.2" transform="rotate(-20 -6 9)" fill="C"/><ellipse cx="12" cy="5" rx="4.5" ry="3.2" transform="rotate(-20 12 5)" fill="C"/><path d="M-2 8V-11L16-15V4M-2-6 16-10"/>';
      let out = '';
      [[30, 34], [120, 28], [74, 92], [166, 98], [36, 150], [128, 166]].forEach(([x, y], i) => { out += `<g transform="translate(${x} ${y}) rotate(${(r() * 30 - 15).toFixed(0)})">${i % 2 ? n2 : n1}</g>`; });
      return out;
    },
  },
  hearts: {
    name: 'Сердечки',
    draw: (r) => {
      let out = '';
      for (let i = 0; i < 10; i += 1) {
        const k = 0.5 + r() * 0.8;
        out += `<path transform="translate(${(20 + r() * 160).toFixed(0)} ${(20 + r() * 160).toFixed(0)}) rotate(${(r() * 40 - 20).toFixed(0)}) scale(${k.toFixed(2)})" d="M0 9-10-1a6 6 0 0 1 10-8 6 6 0 0 1 10 8z"/>`;
      }
      return out;
    },
  },
  dots: {
    name: 'Точки',
    size: 28,
    draw: () => '<circle cx="14" cy="14" r="1.6" fill="C"/>',
  },
  grid: {
    name: 'Клетка',
    size: 32,
    draw: () => '<path d="M0 0.5H32M0.5 0V32"/>',
  },
};
export const PATTERNS = [{ id: 'none', name: 'Нет' }, ...Object.entries(P).map(([id, p]) => ({ id, name: p.name, size: p.size || 200 })), { id: 'image', name: 'Своя картинка' }];

function themeInk() {
  const cs = getComputedStyle(document.documentElement);
  return (cs.getPropertyValue('--text') || '#e8e3d8').trim() || '#e8e3d8';
}
/** Плитка рисунка как data:-адрес для CSS (цвет и прозрачность вшиты). */
export function patternUrl(id, opacity, ink = themeInk()) {
  const p = P[id];
  if (!p) return '';
  const size = p.size || 200;
  const body = p.draw(rng(id.length * 7919 + 13)).replaceAll('"C"', `"${ink}"`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><g fill="none" stroke="${ink}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}">${body}</g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

// ---------- Настройки ----------
export const decorPrefs = {
  get bg() { return pref('som.bg', 'none'); },
  set bg(v) { setPref('som.bg', v); },
  get bgOpacity() { const v = Number(pref('som.bg.op', '9')); return Number.isFinite(v) ? Math.min(30, Math.max(2, v)) : 9; },
  set bgOpacity(v) { setPref('som.bg.op', String(v)); },
  get bgDim() { const v = Number(pref('som.bg.dim', '55')); return Number.isFinite(v) ? Math.min(90, Math.max(0, v)) : 55; },
  set bgDim(v) { setPref('som.bg.dim', String(v)); },
  get bgImage() { return pref('som.bg.img', ''); },
  set bgImage(v) { setPref('som.bg.img', v); },
  get fx() { return pref('som.fx', 'none'); },
  set fx(v) { setPref('som.fx', v); },
  get fxDensity() { return ['low', 'mid', 'high'].includes(pref('som.fx.n', 'mid')) ? pref('som.fx.n', 'mid') : 'mid'; },
  set fxDensity(v) { setPref('som.fx.n', v); },
  get fxMsg() { return pref('som.fx.msg', '1') !== '0'; },
  set fxMsg(v) { setPref('som.fx.msg', v ? '1' : '0'); },
};

// ---------- Слой под перепиской ----------
let host = null; // родитель #messages
let layer = null; // фон + эффекты (под сообщениями)
let top = null; // праздничные эффекты (над сообщениями)
let fit = null;
function ensureLayers() {
  const msgs = $('messages');
  if (!msgs || layer) return;
  host = msgs.parentElement;
  host.classList.add('deco-host');
  msgs.classList.add('deco-msgs');
  layer = document.createElement('div');
  layer.className = 'deco-layer';
  layer.setAttribute('aria-hidden', 'true');
  const cv = document.createElement('canvas');
  cv.className = 'deco-fx';
  layer.append(cv);
  top = document.createElement('canvas');
  top.className = 'deco-burst';
  top.setAttribute('aria-hidden', 'true');
  host.insertBefore(layer, msgs);
  host.append(top);
  fit = () => {
    const r = { left: msgs.offsetLeft, top: msgs.offsetTop, width: msgs.offsetWidth, height: msgs.offsetHeight };
    for (const el of [layer, top]) Object.assign(el.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    const hide = msgs.hidden || !r.height;
    if (layer.hidden !== hide) layer.hidden = hide;
    resizeCanvas(cv);
  };
  const ro = new ResizeObserver(() => fit());
  ro.observe(msgs);
  ro.observe(host);
  // Над перепиской появилась или пропала панель (звонок, закреп) — подвинуть слой. Свои изменения не считаем.
  new MutationObserver((list) => { if (list.some((m) => m.target !== layer && m.target !== top)) fit(); })
    .observe(host, { childList: false, attributes: true, subtree: true, attributeFilter: ['hidden'] });
  fit();
}
function resizeCanvas(cv) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(cv.clientWidth * dpr));
  const h = Math.max(1, Math.round(cv.clientHeight * dpr));
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
}

/** Применить фон и тихий эффект (после смены темы — тоже: цвет рисунка берётся из темы). */
export function applyDecor() {
  ensureLayers();
  if (!layer) return;
  const bg = decorPrefs.bg;
  layer.style.backgroundImage = '';
  layer.style.backgroundSize = '';
  layer.dataset.bg = bg;
  if (bg === 'image' && decorPrefs.bgImage) {
    const dim = decorPrefs.bgDim / 100;
    const base = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#15181b';
    layer.style.backgroundImage = `linear-gradient(color-mix(in srgb, ${base} ${Math.round(dim * 100)}%, transparent), color-mix(in srgb, ${base} ${Math.round(dim * 100)}%, transparent)), url("somlib://bg/${encodeURIComponent(decorPrefs.bgImage)}")`;
    layer.style.backgroundSize = 'cover';
  } else if (P[bg]) {
    layer.style.backgroundImage = patternUrl(bg, (decorPrefs.bgOpacity / 100).toFixed(3));
  }
  startAmbient(decorPrefs.fx, decorPrefs.fxDensity);
}

// ---------- Тихие эффекты ----------
export const EFFECTS = [
  { id: 'none', name: 'Нет', emoji: '—' },
  { id: 'bubbles', name: 'Пузырьки', emoji: '🫧' },
  { id: 'snow', name: 'Снег', emoji: '❄️' },
  { id: 'fireflies', name: 'Светлячки', emoji: '✨' },
  { id: 'stars', name: 'Звёзды', emoji: '⭐' },
  { id: 'leaves', name: 'Листопад', emoji: '🍂' },
  { id: 'sakura', name: 'Сакура', emoji: '🌸' },
  { id: 'rain', name: 'Дождь', emoji: '🌧️' },
];
let amb = null; // { kind, parts, raf, last }
const light = () => document.documentElement.dataset.scheme === 'light';
const paused = () => document.hidden || document.documentElement.dataset.bg === '1';

function spawn(kind, w, h, fresh) {
  const r = Math.random;
  const p = { x: r() * w, y: fresh ? r() * h : (kind === 'bubbles' ? h + 10 : -10), s: r(), a: r() * Math.PI * 2, t: r() * 100 };
  if (kind === 'bubbles') { p.size = 2 + r() * 7; p.vy = -(12 + r() * 26); }
  else if (kind === 'snow') { p.size = 1 + r() * 2.6; p.vy = 14 + r() * 26; }
  else if (kind === 'leaves' || kind === 'sakura') { p.size = (kind === 'sakura' ? 4 : 6) + r() * 4; p.vy = 18 + r() * 22; p.spin = (r() - 0.5) * 2; p.hue = kind === 'sakura' ? 340 + r() * 15 : 15 + r() * 35; }
  else if (kind === 'rain') { p.size = 8 + r() * 12; p.vy = 380 + r() * 220; }
  else if (kind === 'fireflies') { p.size = 1.5 + r() * 1.5; p.vx = (r() - 0.5) * 16; p.vy = (r() - 0.5) * 16; }
  else if (kind === 'stars') { p.size = 0.6 + r() * 1.4; p.vy = 0; }
  return p;
}
function startAmbient(kind, density) {
  if (amb) { cancelAnimationFrame(amb.raf); amb = null; }
  const cv = layer?.querySelector('.deco-fx');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, cv.width, cv.height);
  if (!EFFECTS.some((e) => e.id === kind) || kind === 'none') return;
  const mul = { low: 0.5, mid: 1, high: 1.8 }[density] || 1;
  amb = { kind, parts: [], raf: 0, last: performance.now(), shoot: null };
  const loop = (now) => {
    if (!amb || amb.kind !== kind) return;
    amb.raf = requestAnimationFrame(loop);
    // 30 кадров в секунду и пауза, когда окна не видно: эффект не должен есть процессор.
    if (paused() || now - amb.last < 33) { if (paused()) amb.last = now; return; }
    const dt = Math.min(0.1, (now - amb.last) / 1000);
    amb.last = now;
    resizeCanvas(cv);
    const dpr = cv.width / Math.max(1, cv.clientWidth);
    const w = cv.clientWidth;
    const h = cv.clientHeight;
    const want = Math.round(Math.max(8, Math.min(140, (w * h) / 14000)) * mul * (kind === 'rain' ? 1.4 : kind === 'stars' ? 1.2 : 1));
    while (amb.parts.length < want) amb.parts.push(spawn(kind, w, h, amb.parts.length < want * 0.9 && amb.fresh !== false));
    amb.fresh = false;
    if (amb.parts.length > want) amb.parts.length = want;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    drawAmbient(ctx, kind, amb, w, h, dt, now / 1000);
  };
  amb.raf = requestAnimationFrame(loop);
}
function drawAmbient(ctx, kind, st, w, h, dt, time) {
  const L = light();
  for (let i = 0; i < st.parts.length; i += 1) {
    const p = st.parts[i];
    p.t += dt;
    if (kind === 'bubbles') {
      p.y += p.vy * dt; p.x += Math.sin(p.t * 1.6 + p.a) * 8 * dt;
      if (p.y < -12) st.parts[i] = spawn(kind, w, h, false);
      ctx.strokeStyle = L ? 'rgba(60,110,150,0.35)' : 'rgba(190,225,255,0.32)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = L ? 'rgba(60,110,150,0.25)' : 'rgba(220,240,255,0.35)';
      ctx.beginPath(); ctx.arc(p.x - p.size * 0.35, p.y - p.size * 0.35, p.size * 0.22, 0, Math.PI * 2); ctx.fill();
    } else if (kind === 'snow') {
      p.y += p.vy * dt; p.x += Math.sin(p.t + p.a) * 14 * dt;
      if (p.y > h + 6) st.parts[i] = spawn(kind, w, h, false);
      ctx.fillStyle = L ? `rgba(120,145,170,${0.35 + p.s * 0.35})` : `rgba(255,255,255,${0.4 + p.s * 0.45})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
    } else if (kind === 'leaves' || kind === 'sakura') {
      p.y += p.vy * dt; p.x += Math.sin(p.t * 0.9 + p.a) * 24 * dt; p.a += p.spin * dt;
      if (p.y > h + 12) st.parts[i] = spawn(kind, w, h, false);
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.scale(1, 0.55 + 0.45 * Math.abs(Math.sin(p.t * 2 + p.s * 6)));
      ctx.fillStyle = kind === 'sakura' ? `hsla(${p.hue},80%,${L ? 72 : 82}%,0.75)` : `hsla(${p.hue},70%,${L ? 45 : 52}%,0.7)`;
      ctx.beginPath(); ctx.ellipse(0, 0, p.size, p.size * 0.55, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    } else if (kind === 'rain') {
      p.y += p.vy * dt; p.x -= p.vy * 0.12 * dt;
      if (p.y > h + 20) st.parts[i] = spawn(kind, w, h, false);
      ctx.strokeStyle = L ? 'rgba(70,100,130,0.28)' : 'rgba(170,200,230,0.28)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + p.size * 0.12, p.y - p.size); ctx.stroke();
    } else if (kind === 'fireflies') {
      p.vx += (Math.random() - 0.5) * 30 * dt; p.vy += (Math.random() - 0.5) * 30 * dt;
      p.vx = Math.max(-18, Math.min(18, p.vx)); p.vy = Math.max(-18, Math.min(18, p.vy));
      p.x = (p.x + p.vx * dt + w) % w; p.y = (p.y + p.vy * dt + h) % h;
      const glow = 0.25 + 0.75 * Math.max(0, Math.sin(p.t * 1.3 + p.a));
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 6);
      g.addColorStop(0, L ? `rgba(190,150,20,${0.55 * glow})` : `rgba(230,255,140,${0.7 * glow})`);
      g.addColorStop(1, 'rgba(230,255,140,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size * 6, 0, Math.PI * 2); ctx.fill();
    } else if (kind === 'stars') {
      const tw = 0.35 + 0.65 * Math.abs(Math.sin(p.t * (0.6 + p.s) + p.a));
      ctx.fillStyle = L ? `rgba(90,100,140,${0.45 * tw})` : `rgba(255,250,225,${0.75 * tw})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
    }
  }
  // Звёзды: изредка падающая звезда.
  if (kind === 'stars') {
    if (!st.shoot && Math.random() < dt * 0.08) st.shoot = { x: Math.random() * w, y: Math.random() * h * 0.4, t: 0 };
    if (st.shoot) {
      const s = st.shoot;
      s.t += dt;
      const k = s.t / 0.9;
      const x = s.x + k * 220; const y = s.y + k * 110;
      const g = ctx.createLinearGradient(x - 60, y - 30, x, y);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(1, L ? 'rgba(80,90,130,0.6)' : 'rgba(255,255,255,0.85)');
      ctx.strokeStyle = g; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x - 60, y - 30); ctx.lineTo(x, y); ctx.stroke();
      if (k >= 1) st.shoot = null;
    }
  }
}

// ---------- Праздничные эффекты на сообщения ----------
const TRIGGERS = [
  { kind: 'confetti', re: /с\s*(днём|днем)\s*рождени|с\s*др\b|с\s*днюхой|🎂|🥳|🎉|поздравля|happy\s*birthday/i },
  { kind: 'fireworks', re: /с\s*новым\s*годом|🎆|🎇|🎄|салют|happy\s*new\s*year/i },
  { kind: 'hearts', re: /❤|♥|💖|💗|💕|😍|🥰|\bлюблю\b/i },
];
export function burstFor(text) {
  if (!decorPrefs.fxMsg || !text || paused()) return null;
  const t = TRIGGERS.find((x) => x.re.test(text));
  if (t) { burst(t.kind); window.dispatchEvent(new CustomEvent('som:burst', { detail: t.kind })); }
  return t?.kind || null;
}
let bst = null;
export function burst(kind) {
  ensureLayers();
  if (!top) return;
  top.classList.add('on'); // до замера: скрытый холст нулевого размера
  fit?.();
  resizeCanvas(top);
  const ctx = top.getContext('2d');
  const w = top.clientWidth;
  const h = top.clientHeight;
  const r = Math.random;
  const parts = [];
  if (kind === 'confetti') {
    const colors = ['#ff595e', '#ffca3a', '#8ac926', '#1982c4', '#6a4c93', '#ff8fab', '#f15bb5'];
    for (let i = 0; i < 140; i += 1) {
      const fromLeft = i % 2 === 0;
      parts.push({ x: fromLeft ? 0 : w, y: h * (0.55 + r() * 0.35), vx: (fromLeft ? 1 : -1) * (180 + r() * 360), vy: -(380 + r() * 420), g: 620, rot: r() * 6, vr: (r() - 0.5) * 14, w: 5 + r() * 5, h: 3 + r() * 4, c: colors[i % colors.length], life: 3.2 });
    }
  } else if (kind === 'hearts') {
    for (let i = 0; i < 26; i += 1) parts.push({ x: w * (0.1 + r() * 0.8), y: h + 20 + r() * 120, vx: 0, vy: -(90 + r() * 120), g: 0, size: 10 + r() * 14, a: r() * 6, life: 3.4, heart: true, c: `hsl(${340 + r() * 25},85%,${60 + r() * 12}%)` });
  } else if (kind === 'fireworks') {
    for (let k = 0; k < 4; k += 1) {
      const cx = w * (0.2 + r() * 0.6); const cy = h * (0.15 + r() * 0.4); const hue = r() * 360; const delay = k * 0.45;
      for (let i = 0; i < 46; i += 1) {
        const a = (i / 46) * Math.PI * 2; const sp = 110 + r() * 120;
        parts.push({ x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 90, delay, size: 2 + r() * 1.5, c: `hsl(${hue + r() * 30},95%,65%)`, life: 1.6 + delay, spark: true });
      }
    }
  }
  if (bst) cancelAnimationFrame(bst.raf);
  bst = { parts, raf: 0, last: performance.now(), t: 0 };
  top.classList.add('on');
  const loop = (now) => {
    const dt = Math.min(0.05, (now - bst.last) / 1000);
    bst.last = now;
    bst.t += dt;
    const dpr = top.width / Math.max(1, top.clientWidth);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    let alive = 0;
    for (const p of bst.parts) {
      if (p.delay && bst.t < p.delay) { alive += 1; continue; }
      const age = bst.t - (p.delay || 0);
      if (age > p.life - (p.delay || 0)) continue;
      alive += 1;
      p.vy += p.g * dt;
      if (p.spark) { p.vx *= 0.985; p.vy *= 0.985; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      const fade = Math.max(0, Math.min(1, (p.life - (p.delay || 0) - age) / 0.6));
      ctx.globalAlpha = fade;
      if (p.heart) {
        p.a += dt * 2;
        ctx.save(); ctx.translate(p.x + Math.sin(p.a) * 12, p.y); ctx.scale(p.size / 20, p.size / 20); ctx.fillStyle = p.c;
        ctx.beginPath(); ctx.moveTo(0, 9); ctx.bezierCurveTo(-14, 0, -10, -12, 0, -5); ctx.bezierCurveTo(10, -12, 14, 0, 0, 9); ctx.fill(); ctx.restore();
      } else if (p.spark) {
        ctx.fillStyle = p.c; ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
      } else {
        p.rot += p.vr * dt;
        p.vx *= 0.992;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.rot * 1.7))); ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
    if (alive && bst.t < 4.5) bst.raf = requestAnimationFrame(loop);
    else { ctx.clearRect(0, 0, w, h); top.classList.remove('on'); bst = null; }
  };
  bst.raf = requestAnimationFrame(loop);
}

/** Тема или видимость окна поменялась — перерисовать то, что зависит от цвета. */
export function initDecor() {
  ensureLayers();
  applyDecor();
  document.addEventListener('visibilitychange', () => { if (amb) amb.last = performance.now(); });
}
