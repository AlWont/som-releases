// Спидометр на SVG: шкала 240°, стрелка, «красная зона» как у тахометра и тонкая внешняя дуга — загрузка всего ПК.
// Состояние ok / busy / tight красит стрелку, заливку и цифры (цвета — из темы: --good, --warn, --bad).

const NS = 'http://www.w3.org/2000/svg';
const A0 = -120;
const A1 = 120;
const CX = 100;
const CY = 96;
const R_PC = 92;
const R_TRACK = 79;
const R_ZONE = 69.5;
const BUSY = 0.6;
const TIGHT = 0.85;

const clamp01 = (f) => Math.max(0, Math.min(1, Number.isFinite(f) ? f : 0));
const ang = (f) => A0 + (A1 - A0) * clamp01(f);
function pt(r, a) {
  const t = (a * Math.PI) / 180;
  return [CX + r * Math.sin(t), CY - r * Math.cos(t)];
}
function arc(r, f0, f1) {
  const a = ang(f0);
  const b = ang(Math.max(f0, f1));
  const [x0, y0] = pt(r, a);
  const [x1, y1] = pt(r, b === a ? a + 0.01 : b);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${b - a > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}
function el(tag, attrs = {}, parent = null) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  if (parent) parent.append(n);
  return n;
}

/**
 * Спидометр в узле host. labels(i, n) — подпись i-го из n крупных делений (или '' — без подписи).
 * Возвращает { set({ value, pc, state, text, unit, sub, aria }), setLabels(fn) }.
 */
export function makeGauge(host, { labels = (i, n) => String(Math.round((i / (n - 1)) * 100)), majors = 5 } = {}) {
  const svg = el('svg', { viewBox: '0 0 200 166', class: 'g-svg', 'aria-hidden': 'true', focusable: 'false' });
  el('path', { d: arc(R_PC, 0, 1), class: 'g-pc-track' }, svg);
  const pcArc = el('path', { d: arc(R_PC, 0, 0), class: 'g-pc' }, svg);
  el('path', { d: arc(R_TRACK, 0, 1), class: 'g-track' }, svg);
  const fill = el('path', { d: arc(R_TRACK, 0, 0), class: 'g-fill' }, svg);
  el('path', { d: arc(R_ZONE, BUSY, TIGHT), class: 'g-zone g-zone-busy' }, svg);
  el('path', { d: arc(R_ZONE, TIGHT, 1), class: 'g-zone g-zone-tight' }, svg);
  const ticks = el('g', { class: 'g-ticks' }, svg);
  const minorPer = 4;
  const all = (majors - 1) * minorPer;
  for (let i = 0; i <= all; i += 1) {
    const f = i / all;
    const major = i % minorPer === 0;
    const [x0, y0] = pt(major ? 57 : 61, ang(f));
    const [x1, y1] = pt(65, ang(f));
    el('line', { x1: x0.toFixed(2), y1: y0.toFixed(2), x2: x1.toFixed(2), y2: y1.toFixed(2), class: major ? 'g-major' : 'g-minor' }, ticks);
  }
  const labG = el('g', { class: 'g-labels' }, svg);
  const needle = el('g', { class: 'g-needle' }, svg);
  el('path', { d: `M${CX - 4} ${CY + 9} L${CX - 1.4} ${CY - 70} Q${CX} ${CY - 74} ${CX + 1.4} ${CY - 70} L${CX + 4} ${CY + 9} Z` }, needle);
  el('circle', { cx: CX, cy: CY, r: 7.5, class: 'g-hub' }, svg);
  el('circle', { cx: CX, cy: CY, r: 2.6, class: 'g-hub-dot' }, svg);
  const val = el('text', { x: CX, y: CY + 46, class: 'g-val', 'text-anchor': 'middle' }, svg);
  const num = el('tspan', {}, val);
  const unit = el('tspan', { class: 'g-unit', dx: '2' }, val);
  const sub = el('text', { x: CX, y: CY + 61, class: 'g-sub', 'text-anchor': 'middle' }, svg);
  host.replaceChildren(svg);

  function setLabels(fn) {
    labG.replaceChildren();
    for (let i = 0; i < majors; i += 1) {
      const t = fn(i, majors);
      if (!t) continue;
      const [x, y] = pt(46, ang(i / (majors - 1)));
      const n = el('text', { x: x.toFixed(2), y: (y + 3.2).toFixed(2), 'text-anchor': i === 0 ? 'start' : i === majors - 1 ? 'end' : 'middle' }, labG);
      n.textContent = t;
    }
  }
  setLabels(labels);

  let shown = null;
  return {
    setLabels,
    /** value, pc — доли 0…1 (value может быть больше 1: стрелка упирается в конец шкалы). */
    set({ value = 0, pc = null, state = 'ok', pcState = 'ok', text = '—', unitText = '', subText = '' }) {
      const v = clamp01(value);
      needle.style.transform = `rotate(${ang(v).toFixed(2)}deg)`;
      fill.setAttribute('d', arc(R_TRACK, 0, v));
      fill.style.opacity = v > 0.004 ? '' : '0';
      if (pc == null) { pcArc.style.opacity = '0'; } else { pcArc.style.opacity = ''; pcArc.setAttribute('d', arc(R_PC, 0, clamp01(pc))); }
      pcArc.dataset.state = pcState;
      if (shown !== state) { host.closest('.gauge')?.setAttribute('data-state', state); shown = state; }
      num.textContent = text;
      unit.textContent = unitText;
      sub.textContent = subText;
      host.closest('.gauge')?.toggleAttribute('data-pegged', value >= 1);
    },
  };
}

export const ZONES = { BUSY, TIGHT };
