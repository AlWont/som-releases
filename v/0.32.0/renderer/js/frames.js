// Рамки аватара. Каждая нарисована в SVG и состоит из двух слоёв: ::before и ::after у .avatar.
// Двигаются слои только поворотом, масштабом и прозрачностью — это считает видеокарта, без перерисовки,
// а когда окно скрыто, идёт игра или анимации выключены, всё стоит.
//
// Система координат: квадрат 140×140, аватар — круг с центром (70, 70) и радиусом 50,
// то есть 1 единица = 1% размера аватара. Рамка может выходить за квадрат (ext: сверху, справа, снизу, слева).

const C = 70;
const R = (n) => Math.round(n * 100) / 100;
const rad = (a) => (a * Math.PI) / 180;
const X = (r, a) => R(C + r * Math.sin(rad(a)));
const Y = (r, a) => R(C - r * Math.cos(rad(a)));
const P = (r, a) => `${X(r, a)} ${Y(r, a)}`;
const circ = (r) => `M${R(C - r)} ${C}a${r} ${r} 0 1 0 ${R(2 * r)} 0a${r} ${r} 0 1 0 ${R(-2 * r)} 0Z`;
/** Кольцо между радиусами (рисовать с fill-rule="evenodd"). */
const ring = (r1, r2) => circ(r2) + circ(r1);
const large = (a0, a1) => (a1 - a0 > 180 ? 1 : 0);
const arc = (r, a0, a1) => `M${P(r, a0)}A${r} ${r} 0 ${large(a0, a1)} 1 ${P(r, a1)}`;
const sector = (r1, r2, a0, a1) => `M${P(r2, a0)}A${r2} ${r2} 0 ${large(a0, a1)} 1 ${P(r2, a1)}L${P(r1, a1)}A${r1} ${r1} 0 ${large(a0, a1)} 0 ${P(r1, a0)}Z`;
/** Волнистая окружность r(a) = r0 + amp·sin(k·a + ph). */
function wave(r0, amp, k, ph = 0, n = 150) {
  let d = '';
  for (let i = 0; i <= n; i += 1) { const a = (i * 360) / n; d += `${i ? 'L' : 'M'}${P(r0 + amp * Math.sin(rad(k * a + ph)), a)}`; }
  return `${d}Z`;
}
/** Поставить фигуру (нарисованную вокруг 0,0 «вверх») на окружность r под углом a. */
const at = (r, a, inner, rot = a, s = 1) => `<g transform="translate(${P(r, a)}) rotate(${R(rot)})${s === 1 ? '' : ` scale(${R(s)})`}">${inner}</g>`;
/** Где окажется точка (lx, ly) фигуры, поставленной at(r, a, …, rot, s). */
function place(r, a, rot, lx, ly, s = 1) {
  const c = Math.cos(rad(rot)); const sn = Math.sin(rad(rot));
  return [X(r, a) + s * (lx * c - ly * sn), Y(r, a) + s * (lx * sn + ly * c)];
}
function rng(seed) { let s = seed; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }
const stops = (cs) => cs.map((c, i) => `<stop offset="${R(i / (cs.length - 1))}" stop-color="${c}"/>`).join('');
const shadow = (id = 's', dy = 1.2, sd = 1.2, op = 0.45) => `<filter id="${id}" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="${dy}" stdDeviation="${sd}" flood-color="#000" flood-opacity="${op}"/></filter>`;
const blur = (id, sd) => `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${sd}"/></filter>`;
/** Четырёхлучевая искра. */
const spark = (s) => `M0 ${-s}Q${R(s * 0.12)} ${R(-s * 0.12)} ${s} 0Q${R(s * 0.12)} ${R(s * 0.12)} 0 ${s}Q${R(-s * 0.12)} ${R(s * 0.12)} ${-s} 0Q${R(-s * 0.12)} ${R(-s * 0.12)} 0 ${-s}Z`;
/** Сердечко с острием вниз, высота ≈ 2s. */
const heart = (s) => `M0 ${R(s * 0.95)}C${R(-s * 1.5)} ${R(-s * 0.1)} ${R(-s * 0.85)} ${R(-s * 1.25)} 0 ${R(-s * 0.45)}C${R(s * 0.85)} ${R(-s * 1.25)} ${R(s * 1.5)} ${R(-s * 0.1)} 0 ${R(s * 0.95)}Z`;

/** Камень-кабошон с бликом. */
function stone(id, cx, cy, rx, ry, [a, b, c]) {
  return {
    defs: `<radialGradient id="${id}" cx=".36" cy=".3" r=".8"><stop offset="0" stop-color="${a}"/><stop offset=".45" stop-color="${b}"/><stop offset="1" stop-color="${c}"/></radialGradient>`,
    body: `<ellipse cx="${R(cx)}" cy="${R(cy)}" rx="${rx}" ry="${ry}" fill="url(#${id})" stroke="#000" stroke-opacity=".35" stroke-width=".4"/><ellipse cx="${R(cx - rx * 0.33)}" cy="${R(cy - ry * 0.38)}" rx="${R(rx * 0.3)}" ry="${R(ry * 0.2)}" fill="#fff" fill-opacity=".85"/>`,
  };
}
const RUBY = ['#ffc2c2', '#e3173f', '#5c0014'];
const SAPPHIRE = ['#cfe3ff', '#2667e8', '#0a1f5c'];
const EMERALD = ['#c8ffe2', '#13a75c', '#04381d'];

// ---------- Слои ----------
// Слой: { svg, ext: [t, r, b, l], anim: 'имя длительность …', origin: [x, y] (точка вида), hide: true — без анимации не виден }
function layer(body, { defs = '', ext = [0, 0, 0, 0], anim = '', origin = null, hide = false, extra = '' } = {}) {
  return { body, defs, ext, anim, origin, hide, extra };
}

// ---------- Золото, серебро ----------
const GOLD = ['#fff6c9', '#f3cd5e', '#b07a1c', '#f8de8a', '#c08a2a', '#6e4709'];
const SILVER = ['#ffffff', '#dfe5ea', '#808b95', '#f4f7f9', '#a7b1ba', '#4d5760'];
function metalDefs(pal) {
  return `<linearGradient id="m" x1="0" y1="0" x2="1" y2="1">${stops(pal)}</linearGradient>`
    + `<radialGradient id="bd" cx=".35" cy=".3" r=".75"><stop offset="0" stop-color="#fffdf0"/><stop offset=".5" stop-color="${pal[1]}"/><stop offset="1" stop-color="${pal[5]}"/></radialGradient>`
    + shadow();
}
function metalBand(r1, r2, dark) {
  return `<path d="${ring(r1, r2)}" fill-rule="evenodd" fill="url(#m)" filter="url(#s)"/>`
    + `<circle cx="70" cy="70" r="${R(r1 + 1.9)}" fill="none" stroke="${dark}" stroke-opacity=".5" stroke-width=".8"/>`
    + `<circle cx="70" cy="70" r="${R(r2 - 1.8)}" fill="none" stroke="${dark}" stroke-opacity=".42" stroke-width=".7"/>`
    + `<circle cx="70" cy="70" r="${R(r2 - 0.4)}" fill="none" stroke="#fff" stroke-opacity=".38" stroke-width=".7"/>`
    + `<circle cx="70" cy="70" r="${R(r1 + 0.5)}" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width=".5"/>`;
}
function beads(r, n, size, skip = []) {
  let out = '';
  for (let i = 0; i < n; i += 1) {
    const a = (i * 360) / n;
    if (skip.some((s) => Math.abs(((a - s + 540) % 360) - 180) < 9)) continue;
    out += `<circle cx="${X(r, a)}" cy="${Y(r, a)}" r="${size}" fill="url(#bd)"/>`;
  }
  return out;
}
function setting(cx, cy, rx, ry, dark) {
  return `<ellipse cx="${R(cx)}" cy="${R(cy)}" rx="${R(rx + 1.7)}" ry="${R(ry + 1.5)}" fill="url(#m)" stroke="${dark}" stroke-opacity=".7" stroke-width=".5" filter="url(#s)"/>`;
}
/** Блик, который раз в несколько секунд пробегает по металлу. */
function shine(r, w) {
  const defs = `<linearGradient id="h" gradientUnits="userSpaceOnUse" x1="${X(r, -26)}" y1="${Y(r, -26)}" x2="${X(r, 26)}" y2="${Y(r, 26)}"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".8"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>`;
  return layer(`<path d="${arc(r, -26, 26)}" fill="none" stroke="url(#h)" stroke-width="${w}"/>`, { defs, anim: 'fr-shine 6.5s ease-in-out infinite', hide: true });
}
function gold() {
  const dark = '#5a3a06';
  const ruby = stone('ru', 70, 125.2, 4.4, 3.5, RUBY);
  const d1 = stone('d1', X(55.2, 120), Y(55.2, 120), 2, 2, ['#ffffff', '#d8f1ff', '#7aa8c8']);
  const d2 = stone('d2', X(55.2, 240), Y(55.2, 240), 2, 2, ['#ffffff', '#d8f1ff', '#7aa8c8']);
  return {
    before: layer(metalBand(47.5, 57.5, dark) + beads(52.55, 40, 1.22, [180, 120, 240])
      + setting(70, 125.2, 4.4, 3.5, dark) + ruby.body
      + setting(X(55.2, 120), Y(55.2, 120), 2, 2, dark) + d1.body + setting(X(55.2, 240), Y(55.2, 240), 2, 2, dark) + d2.body,
    { defs: metalDefs(GOLD) + ruby.defs + d1.defs + d2.defs }),
    after: shine(52.5, 10),
  };
}
function silver() {
  const dark = '#39424a';
  const sap = stone('sa', 70, 125.2, 4.4, 3.5, SAPPHIRE);
  let ticks = '';
  for (let i = 0; i < 90; i += 1) {
    const a = i * 4;
    ticks += `M${P(48.3, a)}L${P(49.9, a)}M${P(55.9, a)}L${P(57.1, a)}`;
  }
  return {
    before: layer(metalBand(47.5, 57.5, dark)
      + `<path d="${ticks}" stroke="${dark}" stroke-opacity=".45" stroke-width=".55"/>`
      + `<path d="${wave(52.7, 1.45, 15)}" fill="none" stroke="${dark}" stroke-opacity=".35" stroke-width=".7" transform="translate(0 .45)"/>`
      + `<path d="${wave(52.7, 1.45, 15)}" fill="none" stroke="#fff" stroke-opacity=".8" stroke-width=".65"/>`
      + `<path d="${wave(52.7, 1.45, 15, 180)}" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width=".45"/>`
      + setting(70, 125.2, 4.4, 3.5, dark) + sap.body,
    { defs: metalDefs(SILVER) + sap.defs }),
    after: shine(52.5, 10),
  };
}

// ---------- Корона ----------
function crown() {
  const dark = '#6e4709';
  const A = -20; const RR = 53.4;
  const ru = stone('cr', 0, -3.6, 2.9, 2.2, RUBY);
  const s1 = stone('c1', -9.6, -3.6, 1.7, 1.7, SAPPHIRE);
  const s2 = stone('c2', 9.6, -3.6, 1.7, 1.7, SAPPHIRE);
  const em = stone('ce', 0, -14, 1.9, 2.4, EMERALD);
  const defs = metalDefs(GOLD) + ru.defs + s1.defs + s2.defs + em.defs
    + `<linearGradient id="cg" x1="0" y1="0" x2=".35" y2="1">${stops(['#fff4b8', '#f3cb52', '#c58b1f', '#8a5a10'])}</linearGradient>`
    + `<linearGradient id="cb" x1="0" y1="0" x2="0" y2="1">${stops(['#fbe6a0', '#d39a2c', '#7a4f0c'])}</linearGradient>`;
  const body = '<g filter="url(#s)">'
    + `<path d="M-16 -6.5L-18.6 -21.2L-9 -12.6L0 -26.4L9 -12.6L18.6 -21.2L16 -6.5Z" fill="url(#cg)" stroke="${dark}" stroke-width=".7" stroke-linejoin="round"/>`
    + `<rect x="-16.8" y="-7.8" width="33.6" height="8.4" rx="1.8" fill="url(#cb)" stroke="${dark}" stroke-width=".7"/>`
    + `<circle cx="-18.6" cy="-21.4" r="2.2" fill="url(#bd)" stroke="${dark}" stroke-width=".5"/><circle cx="0" cy="-26.8" r="2.6" fill="url(#bd)" stroke="${dark}" stroke-width=".5"/><circle cx="18.6" cy="-21.4" r="2.2" fill="url(#bd)" stroke="${dark}" stroke-width=".5"/>`
    + `</g>${ru.body}${s1.body}${s2.body}${em.body}`
    + '<path d="M-15.4 -8L-17.4 -19.4M-1.3 -24.2L-7.8 -13.6" stroke="#fff" stroke-opacity=".6" stroke-width=".6" stroke-linecap="round"/>'
    + '<path d="M-15.6 -1.2H15.6" stroke="#fff" stroke-opacity=".35" stroke-width=".5"/>';
  const tip = place(RR, A, A, 0, -27.5);
  const side = place(RR, A, A, 18.6, -22);
  return {
    before: layer(metalBand(48.5, 55.8, dark) + beads(52.15, 36, 1.05) + at(RR, A, body), { defs, ext: [14, 2, 0, 6] }),
    after: layer(`<g fill="#fff" filter="url(#g)"><path transform="translate(${R(tip[0] + 4.5)} ${R(tip[1] - 1.5)})" d="${spark(4.2)}"/><path transform="translate(${R(side[0] + 3)} ${R(side[1] - 2.5)})" d="${spark(2.8)}"/></g>`
      + `<g fill="#fff"><path transform="translate(${R(tip[0] + 4.5)} ${R(tip[1] - 1.5)})" d="${spark(4.2)}"/><path transform="translate(${R(side[0] + 3)} ${R(side[1] - 2.5)})" d="${spark(2.8)}"/></g>`,
    { defs: blur('g', 1.2), ext: [14, 2, 0, 6], anim: 'fr-twinkle 2.4s ease-in-out infinite', origin: [tip[0] + 4.5, tip[1] - 1.5] }),
  };
}

// ---------- Неон ----------
function neon() {
  const defs = blur('b', 1.8) + blur('w', 3.2);
  const before = `<path d="${ring(47.6, 57.4)}" fill-rule="evenodd" fill="#0b0c18" fill-opacity=".92"/>`
    + `<circle cx="70" cy="70" r="57.6" fill="none" stroke="#ff4bf0" stroke-width="3" stroke-opacity=".55" filter="url(#w)"/>`
    + `<g fill="none" filter="url(#b)"><circle cx="70" cy="70" r="50.6" stroke="#29e6ff" stroke-width="3.6"/><circle cx="70" cy="70" r="54.7" stroke="#ff4bf0" stroke-width="3.6"/></g>`
    + '<circle cx="70" cy="70" r="50.6" fill="none" stroke="#7ff3ff" stroke-width="1.7"/><circle cx="70" cy="70" r="54.7" fill="none" stroke="#ff8af6" stroke-width="1.7"/>'
    + '<circle cx="70" cy="70" r="50.6" fill="none" stroke="#f2feff" stroke-width=".55"/><circle cx="70" cy="70" r="54.7" fill="none" stroke="#fff0fe" stroke-width=".55"/>';
  // Бегущая искра по трубкам и мерцание, как у настоящего неона.
  const after = `<g fill="none" stroke-linecap="round"><path d="${arc(50.6, -30, 8)}" stroke="#bff9ff" stroke-width="3.4" filter="url(#b)"/><path d="${arc(50.6, -18, 6)}" stroke="#fff" stroke-width="1.5"/>`
    + `<path d="${arc(54.7, 150, 188)}" stroke="#ffc6fa" stroke-width="3.4" filter="url(#b)"/><path d="${arc(54.7, 162, 186)}" stroke="#fff" stroke-width="1.5"/></g>`;
  return { before: layer(before, { defs }), after: layer(after, { defs, anim: 'fr-spin 3.2s linear infinite, fr-buzz 5s steps(1) infinite' }) };
}

// ---------- Радуга ----------
function rainbow() {
  let segs = '';
  const n = 72;
  for (let i = 0; i < n; i += 1) {
    const a0 = (i * 360) / n; const a1 = ((i + 1) * 360) / n + 0.6;
    segs += `<path d="${sector(47.8, 57.2, a0, a1)}" fill="hsl(${R((i * 360) / n)} 92% 62%)"/>`;
  }
  const cloud = '<g fill="#fff" stroke="#c9dcf2" stroke-width=".6"><path d="M-9 3.5a4 4 0 0 1 .6-7.9a5.4 5.4 0 0 1 10.1-1.6a4.4 4.4 0 0 1 7.6 3.3a3.2 3.2 0 0 1 -.6 6.2Z"/></g><path d="M-7.4 -3a3.4 3.4 0 0 1 4.3-2.6" fill="none" stroke="#fff" stroke-width="1" opacity=".9"/>';
  const after = `<path d="${arc(55.6, -110, 30)}" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="1.5" stroke-linecap="round"/>`
    + `<path d="${arc(49, 100, 230)}" fill="none" stroke="#000" stroke-opacity=".16" stroke-width="1.6" stroke-linecap="round"/>`
    + `<g filter="url(#s)">${at(59, 224, cloud, 0, 1.15)}${at(59, 98, cloud, 0, 0.75)}</g>`
    + `<path transform="translate(${P(61, 38)})" d="${spark(4.6)}" fill="#fff"/><path transform="translate(${P(64, 52)})" d="${spark(2.4)}" fill="#fff" fill-opacity=".85"/>`;
  return {
    before: layer(`<g filter="url(#s)">${segs}</g>`, { defs: shadow(), anim: 'fr-spin 12s linear infinite' }),
    after: layer(after, { defs: shadow('s', 0.8, 0.8, 0.3) }),
  };
}

// ---------- Геймер ----------
function gamer() {
  let light = '';
  const n = 60;
  for (let i = 0; i < n; i += 1) {
    const a0 = (i * 360) / n; const a1 = ((i + 1) * 360) / n + 0.6;
    light += `<path d="${sector(53.4, 56.6, a0, a1)}" fill="hsl(${R((i * 360) / n)} 100% 58%)"/><path d="${sector(48.8, 50.6, a0, a1)}" fill="hsl(${R(((i * 360) / n + 180) % 360)} 100% 60%)"/>`;
  }
  const before = '<use href="#L" filter="url(#b)" opacity=".9"/><use href="#L"/>';
  let dividers = '';
  for (let i = 0; i < 24; i += 1) dividers += `<path d="${sector(48.6, 56.8, i * 15 - 0.9, i * 15 + 0.9)}"/>`;
  const pad = '<path d="M-6.6 -3.4h13.2a3.6 3.6 0 0 1 3.4 4.6l-1.5 4a2.4 2.4 0 0 1-4 .7l-1.7-2h-5.6l-1.7 2a2.4 2.4 0 0 1-4-.7l-1.5-4a3.6 3.6 0 0 1 3.4-4.6z" fill="#e9eef5"/><path d="M-5.6 0.4h3.4M-3.9 -1.3v3.4" stroke="#14171c" stroke-width="1.1" stroke-linecap="round"/><circle cx="3.4" cy="-0.4" r=".95" fill="#ff3b6b"/><circle cx="5.6" cy="1.5" r=".95" fill="#29d4ff"/>';
  const badge = `<circle r="9.4" fill="#14171c" stroke="#3a414d" stroke-width="1"/><circle r="9.4" fill="none" stroke="url(#rgb)" stroke-width="1.2" stroke-opacity=".9"/>${pad}`;
  const after = `<g fill="#13161b"><path d="${ring(47.4, 48.8)}" fill-rule="evenodd"/><path d="${ring(50.6, 53.4)}" fill-rule="evenodd"/><path d="${ring(56.6, 58)}" fill-rule="evenodd"/>${dividers}</g>`
    + `<path d="${ring(50.6, 53.4)}" fill-rule="evenodd" fill="url(#sh)"/>`
    + `<circle cx="70" cy="70" r="57.7" fill="none" stroke="#4a5262" stroke-width=".6"/>`
    + `<g fill="none" stroke="#9aa7ba" stroke-width="1.1" stroke-linecap="round">${[45, 315].map((a) => `<path d="${arc(61.5, a - 7, a + 7)}"/>`).join('')}</g>`
    + `<g filter="url(#s)">${at(57.5, 225, badge, 0)}</g>`;
  return {
    before: layer(before, { defs: `${blur('b', 1.6)}<g id="L">${light}</g>`, anim: 'fr-spin 3s linear infinite' }),
    after: layer(after, { defs: `${shadow()}<linearGradient id="sh" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3a4252"/><stop offset=".5" stop-color="#1a1e25"/><stop offset="1" stop-color="#0c0e12"/></linearGradient><linearGradient id="rgb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff3b6b"/><stop offset=".5" stop-color="#7c4dff"/><stop offset="1" stop-color="#29d4ff"/></linearGradient>` }),
  };
}

// ---------- Огонь ----------
function tongue(a, base, h, w, curl) {
  // Язык пламени: растёт от кольца наружу и загибается вверх (огонь тянется вверх).
  const ox = Math.sin(rad(a)); const oy = -Math.cos(rad(a));
  let dx = ox; let dy = oy - 0.85;
  const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
  const bx = X(base, a); const by = Y(base, a);
  const tx = bx + dx * h + curl * -dy * h * 0.25; const ty = by + dy * h + curl * dx * h * 0.25;
  const lx = X(base, a - w); const ly = Y(base, a - w);
  const rx = X(base, a + w); const ry = Y(base, a + w);
  const px = -dy; const py = dx; // поперёк
  const c1x = lx + dx * h * 0.55 - px * h * 0.18; const c1y = ly + dy * h * 0.55 - py * h * 0.18;
  const c2x = rx + dx * h * 0.45 + px * h * 0.12; const c2y = ry + dy * h * 0.45 + py * h * 0.12;
  return `M${R(lx)} ${R(ly)}Q${R(c1x)} ${R(c1y)} ${R(tx)} ${R(ty)}Q${R(c2x)} ${R(c2y)} ${R(rx)} ${R(ry)}Z`;
}
function flames(seed, phase) {
  const r = rng(seed);
  const tall = (a) => 3.5 + 13.5 * ((1 + Math.cos(rad(a))) / 2) ** 1.3;
  let red = ''; let orange = ''; let yellow = '';
  const n = 22;
  for (let i = 0; i < n; i += 1) {
    const a = (i * 360) / n + phase + (r() - 0.5) * 6;
    const h = tall(a) * (0.75 + r() * 0.45);
    const curl = (r() - 0.5) * 1.6;
    red += tongue(a, 54, h, 8.5, curl);
    orange += tongue(a + 1, 54, h * 0.72, 6, curl * 0.8);
    yellow += tongue(a + 1.5, 53.5, h * 0.42, 3.8, curl * 0.6);
  }
  return `<path d="${red}" fill="#e8360c"/><path d="${orange}" fill="#ff8a00"/><path d="${yellow}" fill="#ffd34a"/>`;
}
function fire() {
  const defs = `<radialGradient id="e" gradientUnits="userSpaceOnUse" cx="70" cy="70" r="58"><stop offset=".8" stop-color="#fff3b0"/><stop offset=".86" stop-color="#ffb43a"/><stop offset=".92" stop-color="#ff6a00"/><stop offset="1" stop-color="#b81d00"/></radialGradient>${blur('g', 2.6)}${blur('f', 0.35)}`;
  const before = `<circle cx="70" cy="70" r="57" fill="none" stroke="#ff5a00" stroke-width="6" stroke-opacity=".55" filter="url(#g)"/>`
    + `<g filter="url(#f)">${flames(11, 0)}</g>`
    + `<path d="${ring(47.6, 55.6)}" fill-rule="evenodd" fill="url(#e)"/>`
    + `<path d="${wave(51.6, 1.1, 11)}" fill="none" stroke="#fff6c8" stroke-opacity=".6" stroke-width=".8"/>`;
  const embers = (() => { const r = rng(5); let o = ''; for (let i = 0; i < 7; i += 1) { const a = -60 + r() * 120; o += `<circle cx="${X(66 + r() * 8, a)}" cy="${Y(66 + r() * 8, a)}" r="${R(0.6 + r() * 0.7)}" fill="#ffd34a"/>`; } return o; })();
  const after = `<g filter="url(#f)">${flames(29, 360 / 44)}</g><path d="${ring(47.6, 55.6)}" fill-rule="evenodd" fill="url(#e)"/>${embers}`;
  return {
    before: layer(before, { defs, ext: [8, 0, 0, 0] }),
    after: layer(after, { defs, ext: [8, 0, 0, 0], anim: 'fr-flicker .9s ease-in-out infinite alternate', origin: [70, 70] }),
  };
}

// ---------- Лёд ----------
function shard(len, w) {
  return `<path d="M${-w} 2L${R(-w * 0.9)} ${R(-len * 0.62)}L0 ${-len}L${R(w * 0.9)} ${R(-len * 0.62)}L${w} 2Z" fill="url(#ic)" stroke="#fff" stroke-opacity=".9" stroke-width=".5" stroke-linejoin="round"/><path d="M0 1V${-len}" stroke="#fff" stroke-opacity=".75" stroke-width=".5"/><path d="M${R(-w * 0.9)} ${R(-len * 0.62)}L0 ${R(-len * 0.45)}L${R(w * 0.9)} ${R(-len * 0.62)}" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width=".4"/>`;
}
const flake = (s) => {
  let d = '';
  for (let i = 0; i < 6; i += 1) {
    const a = i * 60;
    d += `M0 0L${R(s * Math.sin(rad(a)))} ${R(-s * Math.cos(rad(a)))}`;
    for (const k of [0.45, 0.72]) {
      const bx = s * k * Math.sin(rad(a)); const by = -s * k * Math.cos(rad(a)); const b = s * (k === 0.45 ? 0.32 : 0.22);
      d += `M${R(bx)} ${R(by)}L${R(bx + b * Math.sin(rad(a - 45)))} ${R(by - b * Math.cos(rad(a - 45)))}M${R(bx)} ${R(by)}L${R(bx + b * Math.sin(rad(a + 45)))} ${R(by - b * Math.cos(rad(a + 45)))}`;
    }
  }
  return d;
};
function ice() {
  const r = rng(7);
  let specks = '';
  for (let i = 0; i < 46; i += 1) { const a = r() * 360; const rr = 48.5 + r() * 7; specks += `<circle cx="${X(rr, a)}" cy="${Y(rr, a)}" r="${R(0.3 + r() * 0.55)}"/>`; }
  const shards = [[-58, 13, 3.4], [-44, 18, 4], [-30, 11, 3], [-18, 7, 2.2], [126, 9, 2.6], [140, 15, 3.6], [154, 10, 2.8], [62, 7, 2.2], [238, 8, 2.4]];
  const defs = `<linearGradient id="ib" x1="0" y1="0" x2="1" y2="1">${stops(['#f6fdff', '#bfeaff', '#6fc0ec', '#e6f7ff', '#4f9fd2'])}</linearGradient>`
    + `<linearGradient id="ic" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#9edcff" stop-opacity=".95"/><stop offset="1" stop-color="#f4fcff" stop-opacity=".95"/></linearGradient>${shadow('s', 0.8, 1, 0.35)}${blur('g', 1.4)}`;
  const before = `<g filter="url(#s)">${shards.map(([a, l, w]) => at(54.5, a, shard(l, w), a + (a > 90 ? -8 : 6))).join('')}`
    + `<path d="${ring(47.5, 56.2)}" fill-rule="evenodd" fill="url(#ib)"/></g>`
    + `<g fill="#fff" fill-opacity=".75">${specks}</g>`
    + '<circle cx="70" cy="70" r="48.2" fill="none" stroke="#fff" stroke-opacity=".8" stroke-width=".8"/>'
    + `<path d="${arc(55.4, -120, -10)}" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width=".9" stroke-linecap="round"/>`
    + `<path d="M${P(49, 200)}l2.6 -1.4l1.2 1.8l2.4-.6M${P(49.5, 95)}l-1.8 2l1.6 1.2" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width=".45"/>`
    + `<g transform="translate(${P(61.5, 36)})"><path d="${flake(6.6)}" stroke="#bfe9ff" stroke-width="2.2" stroke-linecap="round" filter="url(#g)"/><path d="${flake(6.6)}" stroke="#fff" stroke-width="1.05" stroke-linecap="round"/></g>`;
  const tips = [place(54.5, -44, -38, 0, -18), place(54.5, 140, 132, 0, -15), place(54.5, -58, -52, 0, -13), place(54.5, 62, 68, 0, -7)];
  const after = `<g fill="#fff">${tips.map(([x, y], i) => `<path transform="translate(${R(x)} ${R(y)})" d="${spark([3.2, 2.6, 2, 1.8][i])}"/>`).join('')}</g>`;
  return {
    before: layer(before, { defs, ext: [2, 0, 0, 2] }),
    after: layer(after, { defs, ext: [2, 0, 0, 2], anim: 'fr-glint 2.8s ease-in-out infinite' }),
  };
}

// ---------- Листва ----------
const GREENS = ['#6fae3a', '#4f8a25', '#8cc04f', '#3d7020', '#a3cf5f'];
const LEAF_DEFS = GREENS.map((c, i) => `<g id="l${i}"><path d="M0 0C2.6 -2.9 8 -3.8 12.4 -0.3C8 3.4 2.8 2.9 0 0Z" fill="${c}"/><path d="M0.4 0C4 -0.4 8 -0.6 11.8 -0.3" fill="none" stroke="#1e3d12" stroke-opacity=".55" stroke-width=".45"/><path d="M2 -1.1C5 -2.3 8.4 -2.4 10.8 -1" fill="none" stroke="#fff" stroke-opacity=".25" stroke-width=".4"/></g>`).join('');
const LEAF = (i, s = 1) => `<use href="#l${i}" transform="scale(${R(s)})"/>`;
function vineSide(from, to, seed) {
  // Ветка растёт от низа вверх по одной стороне; листья — по обе стороны, к концу мельче.
  const r = rng(seed);
  const grow = (a) => (to > from ? a : a + 180); // направление роста вдоль круга
  let out = '';
  const steps = Math.round(Math.abs(to - from) / 10);
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const a = from + (to - from) * t;
    const s = 1.05 - t * 0.45;
    for (const side of [-1, 1]) out += at(54.6 + side * 0.7, a, LEAF(Math.floor(r() * GREENS.length), s * (0.85 + r() * 0.3)), grow(a) + side * (36 + r() * 16));
  }
  return out;
}
function berries(a, rr) {
  const [x, y] = [X(rr, a), Y(rr, a)];
  return [[-1.6, 0.6], [1.5, 0.9], [0, -1.4]].map(([dx, dy]) => `<circle cx="${R(x + dx)}" cy="${R(y + dy)}" r="1.75" fill="url(#br)"/><circle cx="${R(x + dx - 0.55)}" cy="${R(y + dy - 0.6)}" r=".5" fill="#fff" fill-opacity=".8"/>`).join('');
}
function leaves() {
  const defs = `${shadow('s', 0.8, 0.9, 0.4)}${LEAF_DEFS}<radialGradient id="br" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#ff8a80"/><stop offset=".55" stop-color="#d32f2f"/><stop offset="1" stop-color="#6b0b0b"/></radialGradient>`;
  const twig = `<path d="${arc(54.6, 182, 345)}" fill="none" stroke="#6d4c2f" stroke-width="1.7" stroke-linecap="round"/><path d="${arc(54.6, 15, 178)}" fill="none" stroke="#6d4c2f" stroke-width="1.7" stroke-linecap="round"/>`;
  const before = `<g filter="url(#s)">${twig}${vineSide(186, 300, 3)}${vineSide(174, 60, 9)}${berries(180, 56.5)}${berries(250, 58.5)}${berries(112, 58.5)}</g>`;
  // Верхние кончики венка чуть качаются.
  const after = `<g filter="url(#s)">${vineSide(306, 340, 21)}${vineSide(54, 20, 23)}</g>`;
  return {
    before: layer(before, { defs }),
    after: layer(after, { defs, anim: 'fr-sway 4s ease-in-out infinite alternate', origin: [70, 70] }),
  };
}

// ---------- Сакура ----------
function blossom(s, rot = 0) {
  let petals = '';
  for (let i = 0; i < 5; i += 1) petals += `<path transform="rotate(${i * 72 + rot})" d="M0 0C-3.4 -2 -3.8 -7.2 -1.4 -9.2L0 -8L1.4 -9.2C3.8 -7.2 3.4 -2 0 0Z" fill="url(#pt)" stroke="#e8789c" stroke-opacity=".5" stroke-width=".35"/>`;
  let st = '';
  for (let i = 0; i < 6; i += 1) { const a = i * 60 + 30 + rot; st += `<path d="M0 0L${R(3 * Math.sin(rad(a)))} ${R(-3 * Math.cos(rad(a)))}" stroke="#c2185b" stroke-width=".35"/><circle cx="${R(3.3 * Math.sin(rad(a)))}" cy="${R(-3.3 * Math.cos(rad(a)))}" r=".5" fill="#ffd166"/>`; }
  return `<g transform="scale(${s})">${petals}<circle r="1.6" fill="#d9466f"/>${st}</g>`;
}
const PETAL = '<path d="M0 -3.2C2.2 -2 2.2 1.4 0 3.2C-2.2 1.4 -2.2 -2 0 -3.2Z" fill="#ffc1d6" stroke="#e8789c" stroke-opacity=".5" stroke-width=".3"/>';
function sakura() {
  const defs = `${shadow('s', 0.8, 0.9, 0.35)}<radialGradient id="pt" cx=".5" cy=".9" r="1"><stop offset="0" stop-color="#ff8fb4"/><stop offset=".35" stop-color="#ffc6d8"/><stop offset="1" stop-color="#fff4f8"/></radialGradient>`;
  const branch = '<g fill="none" stroke="#4a2c2a" stroke-linecap="round">'
    + `<path d="M${P(63, 206)}Q${P(66, 250)} ${P(58.5, 278)}T${P(55.5, 335)}" stroke-width="2.6"/>`
    + `<path d="M${P(60, 262)}Q${P(66, 262)} ${P(67, 248)}" stroke-width="1.4"/>`
    + `<path d="M${P(56.5, 305)}Q${P(63, 312)} ${P(64.5, 300)}" stroke-width="1.2"/>`
    + `<path d="M${P(62, 92)}Q${P(60, 118)} ${P(56, 152)}" stroke-width="2"/><path d="M${P(60, 120)}Q${P(66, 124)} ${P(66.5, 112)}" stroke-width="1.1"/></g>`;
  const flowers = [[60.5, 286, 1.15, 10], [57.5, 322, 0.95, 40], [62, 240, 0.9, 0], [66.5, 254, 0.6, 20], [57, 140, 0.95, 15], [66, 112, 0.65, 50]]
    .map(([rr, a, s, rot]) => at(rr, a, blossom(s, rot), 0)).join('');
  const buds = [[64.8, 300, 20], [56, 340, -10], [61.5, 100, 60], [63.5, 222, 200]]
    .map(([rr, a, rot]) => at(rr, a, '<ellipse rx="1.7" ry="2.5" fill="#ff9fbf" stroke="#d9466f" stroke-opacity=".5" stroke-width=".3"/><path d="M0 2.4L0 3.6" stroke="#4a2c2a" stroke-width=".6"/>', rot)).join('');
  const thin = `<circle cx="70" cy="70" r="51.5" fill="none" stroke="#ffd6e4" stroke-opacity=".9" stroke-width="2.2"/><circle cx="70" cy="70" r="51.5" fill="none" stroke="#e8789c" stroke-opacity=".5" stroke-width=".5"/>`;
  const after = [[64, 30, 30], [66, 62, 110], [60, 172, 60], [67, 200, 150]].map(([rr, a, rot]) => at(rr, a, PETAL, rot)).join('');
  return {
    before: layer(`${thin}<g filter="url(#s)">${branch}${buds}${flowers}</g>`, { defs, ext: [2, 2, 2, 2] }),
    after: layer(after, { defs, ext: [2, 2, 2, 2], anim: 'fr-fall 5.5s ease-in-out infinite' }),
  };
}

// ---------- Звёзды ----------
function star5(s) {
  let d = '';
  for (let i = 0; i < 10; i += 1) { const rr = i % 2 ? s * 0.45 : s; const a = i * 36; d += `${i ? 'L' : 'M'}${R(rr * Math.sin(rad(a)))} ${R(-rr * Math.cos(rad(a)))}`; }
  return `${d}Z`;
}
function stars() {
  const r = rng(17);
  let dots = '';
  for (let i = 0; i < 44; i += 1) { const a = r() * 360; const rr = 48.6 + r() * 7.8; dots += `<circle cx="${X(rr, a)}" cy="${Y(rr, a)}" r="${R(0.25 + r() * 0.6)}" fill-opacity="${R(0.45 + r() * 0.55)}"/>`; }
  const defs = `<linearGradient id="sk" x1="0" y1="0" x2=".4" y2="1">${stops(['#3a2a8f', '#1b1f63', '#0a1034', '#141a52'])}</linearGradient>`
    + `<clipPath id="cp"><path d="${ring(47.5, 57)}" clip-rule="evenodd"/></clipPath>${blur('g', 1.6)}${blur('n', 4)}${shadow('s', 0.8, 1, 0.4)}`
    + '<mask id="mo"><circle cx="0" cy="0" r="8.2" fill="#fff"/><circle cx="3.6" cy="-2.6" r="7.2" fill="#000"/></mask>';
  const before = `<path d="${ring(47.5, 57)}" fill-rule="evenodd" fill="url(#sk)" filter="url(#s)"/>`
    + `<g clip-path="url(#cp)" filter="url(#n)"><circle cx="30" cy="38" r="13" fill="#ff5fa2" fill-opacity=".5"/><circle cx="112" cy="104" r="14" fill="#3fa9ff" fill-opacity=".45"/><circle cx="104" cy="22" r="9" fill="#9d6bff" fill-opacity=".5"/></g>`
    + `<g fill="#fff">${dots}</g>`
    + `<circle cx="70" cy="70" r="56.6" fill="none" stroke="#a9b8ff" stroke-opacity=".35" stroke-width=".6"/>`
    + `<g transform="translate(${P(59, 312)}) rotate(-20)"><circle r="8.4" fill="#fff3c4" fill-opacity=".55" filter="url(#g)" mask="url(#mo)"/><circle r="8.2" fill="#fff3c4" mask="url(#mo)"/><circle cx="-4.2" cy="2.4" r="1" fill="#e6d79c" mask="url(#mo)"/><circle cx="-5.6" cy="-1.6" r=".7" fill="#e6d79c" mask="url(#mo)"/></g>`
    + `<g transform="translate(${P(59.5, 140)})"><path d="${spark(6.5)}" fill="#fff6d6" filter="url(#g)"/><path d="${spark(5.6)}" fill="#fff"/></g>`;
  const after = `<g fill="#ffe9a8">${[[57.5, 30, 3], [58, 165, 2.4], [57.5, 255, 2.7]].map(([rr, a, s]) => `<g transform="translate(${P(rr, a)})"><path d="${star5(s * 1.5)}" filter="url(#g)" fill-opacity=".8"/><path d="${star5(s)}" fill="#fff8de"/></g>`).join('')}</g>`;
  return { before: layer(before, { defs }), after: layer(after, { defs, anim: 'fr-spin 20s linear infinite' }) };
}

// ---------- Сердечки ----------
function hearts() {
  let small = '';
  const n = 18;
  for (let i = 0; i < n; i += 1) {
    const a = (i * 360) / n;
    if (a > 25 && a < 75) continue;
    small += at(51.75, a, `<path d="${heart(1.45)}" fill="${i % 2 ? '#ffffff' : '#e8335f'}" fill-opacity="${i % 2 ? '.9' : '1'}"/>`, a);
  }
  const defs = `<linearGradient id="hb" x1="0" y1="0" x2="1" y2="1">${stops(['#ffe0e8', '#ff9fb6', '#ff5c8a', '#ffb3c6', '#e8335f'])}</linearGradient>`
    + `<linearGradient id="hg" x1=".2" y1="0" x2=".8" y2="1">${stops(['#ff8aa8', '#f2295b', '#b3002f'])}</linearGradient>${shadow('s', 1, 1.1, 0.4)}`;
  const before = `<path d="${ring(48, 55.6)}" fill-rule="evenodd" fill="url(#hb)" filter="url(#s)"/>`
    + `<circle cx="70" cy="70" r="48.6" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width=".6"/>${small}`;
  const big = (s) => `<path d="${heart(s)}" fill="url(#hg)" stroke="#8f0026" stroke-opacity=".4" stroke-width=".5"/><path d="M${R(-s * 0.85)} ${R(-s * 0.4)}C${R(-s * 0.8)} ${R(-s * 0.85)} ${R(-s * 0.35)} ${R(-s * 0.95)} ${R(-s * 0.15)} ${R(-s * 0.62)}" fill="none" stroke="#fff" stroke-opacity=".85" stroke-width="${R(s * 0.16)}" stroke-linecap="round"/>`;
  const c = [X(59.5, 42), Y(59.5, 42)];
  const after = `<g filter="url(#s)"><g transform="translate(${R(c[0])} ${R(c[1])}) rotate(14)">${big(8.6)}</g><g transform="translate(${P(65, 66)}) rotate(28)">${big(3.2)}</g><g transform="translate(${P(63.5, 24)}) rotate(-8)">${big(2.4)}</g></g>`;
  return { before: layer(before, { defs }), after: layer(after, { defs, anim: 'fr-beat 1.6s ease-in-out infinite', origin: c }) };
}

// ---------- Сом ----------
function catfish() {
  const r = rng(31);
  let bubbles = '';
  for (const [a0, a1, k] of [[34, 72, 4], [196, 236, 3], [118, 140, 2]]) {
    for (let i = 0; i < k; i += 1) {
      const a = a0 + r() * (a1 - a0); const rr = 59 + r() * 5.5; const s = R(0.9 + r() * 1.6);
      bubbles += `<circle cx="${X(rr, a)}" cy="${Y(rr, a)}" r="${s}" fill="#e8fbff" fill-opacity=".18" stroke="#e8fbff" stroke-opacity=".8" stroke-width=".45"/><circle cx="${R(X(rr, a) - s * 0.35)}" cy="${R(Y(rr, a) - s * 0.35)}" r="${R(s * 0.25)}" fill="#fff"/>`;
    }
  }
  const defs = `<radialGradient id="w" gradientUnits="userSpaceOnUse" cx="70" cy="70" r="57.5"><stop offset=".82" stop-color="#bff3ff"/><stop offset=".87" stop-color="#47bfe3"/><stop offset=".94" stop-color="#1c7fb0"/><stop offset="1" stop-color="#0d4e7a"/></radialGradient>`
    + `<linearGradient id="fb" x1="0" y1="0" x2="0" y2="1">${stops(['#a3ad8c', '#76805f', '#545c44'])}</linearGradient>${shadow('s', 0.9, 1, 0.4)}`;
  const before = `<path d="${ring(47.5, 57.2)}" fill-rule="evenodd" fill="url(#w)" filter="url(#s)"/>`
    + `<path d="${wave(54.8, 0.9, 18)}" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width=".8"/>`
    + `<path d="${wave(51.2, 0.6, 24, 90)}" fill="none" stroke="#fff" stroke-opacity=".3" stroke-width=".5"/>`
    + `<circle cx="70" cy="70" r="48.3" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width=".6"/>${bubbles}`;
  // Сомик плывёт по кругу по часовой стрелке: наверху — вправо.
  const fish = '<g transform="scale(1.02)">'
    + '<path d="M-12.5 0L-19 -4.6Q-17 0 -19 4.6Z" fill="#6b7558" stroke="#2a3125" stroke-width=".4"/>'
    + '<path d="M-13 0C-9 -4.8 2 -5.8 8 -3.4C11 -2.2 13 -0.8 13.6 0.4C12 2.5 8 3.7 2 3.9C-5 4.1 -10 2.4 -13 0Z" fill="url(#fb)" stroke="#2a3125" stroke-width=".5"/>'
    + '<path d="M-10 1.4C-5 3.2 3 3.6 9.5 2.3C7 3.4 2 3.9 -3 3.7C-6 3.5 -8.6 2.6 -10 1.4Z" fill="#d6d9bf" fill-opacity=".9"/>'
    + '<path d="M-2.5 -4.7Q0 -8.3 3.4 -4.9" fill="#4a5640" stroke="#2a3125" stroke-width=".4"/>'
    + '<path d="M1 3.6Q2.4 6.2 4.6 3.6" fill="#4a5640"/>'
    + '<circle cx="8.8" cy="-1.3" r="1" fill="#141810"/><circle cx="9.1" cy="-1.6" r=".35" fill="#fff"/>'
    + '<g fill="none" stroke="#2a3125" stroke-width=".55" stroke-linecap="round"><path d="M13 0.9Q17.4 2.4 19.6 6.4"/><path d="M13.1 0.2Q18 -1.2 20.4 -4.6"/><path d="M12.2 1.8Q13.8 4.4 14.2 6.6"/></g>'
    + '</g>';
  return {
    before: layer(before, { defs, ext: [0, 0, 0, 0] }),
    after: layer(`<g filter="url(#s)" transform="translate(70 16.6)">${fish}</g>`, { defs, anim: 'fr-spin 16s linear infinite' }),
  };
}

// ---------- Гирлянда ----------
const BULBS = ['#ff4d5e', '#ffd23f', '#3ddc84', '#3fb5ff'];
function garlandLayer(litOdd) {
  let wire = `<path d="${wave(55.2, 1.3, 32)}" fill="none" stroke="#1f3b26" stroke-width="1.15"/><path d="${wave(55.2, 1.3, 32, 180)}" fill="none" stroke="#2f5a38" stroke-width=".9"/>`;
  const n = 16;
  let glow = ''; let bulbs = '';
  for (let i = 0; i < n; i += 1) {
    const a = (i * 360) / n + 11.25;
    const lit = (i % 2 === 1) === litOdd;
    const c = BULBS[i % BULBS.length];
    const glass = `<path d="M-2.4 -1.2C-2.6 -4.4 -1.6 -6.6 0 -7.4C1.6 -6.6 2.6 -4.4 2.4 -1.2Z" fill="${c}" ${lit ? '' : 'fill-opacity=".35"'} stroke="#000" stroke-opacity=".25" stroke-width=".3"/>`
      + (lit ? '<path d="M-1.2 -2C-1.4 -4 -0.9 -5.3 0 -5.9" fill="none" stroke="#fff" stroke-opacity=".8" stroke-width=".55" stroke-linecap="round"/>' : '')
      + '<rect x="-1.7" y="-1.4" width="3.4" height="2.4" rx=".5" fill="#2d3530"/>';
    bulbs += at(55.6, a, glass, a);
    if (lit) glow += `<circle cx="${X(61.5, a)}" cy="${Y(61.5, a)}" r="4.8" fill="${c}"/>`;
  }
  wire += `<g filter="url(#g)" opacity=".75">${glow}</g>`;
  return wire + bulbs;
}
function garland() {
  const defs = blur('g', 2.2);
  return {
    before: layer(garlandLayer(false), { defs, ext: [2, 2, 2, 2], anim: 'fr-blink-a 1.5s steps(1, end) infinite' }),
    after: layer(garlandLayer(true), { defs, ext: [2, 2, 2, 2], anim: 'fr-blink-b 1.5s steps(1, end) infinite', hide: true }),
  };
}

// ---------- Наушники ----------
function cup(dir) {
  // dir = -1 слева, 1 справа; чашка вокруг (70 ± 56, 70).
  const cx = 70 + dir * 56;
  return `<rect x="${R(cx - 8)}" y="54" width="16" height="32" rx="7.6" fill="url(#cu)" stroke="#4b5363" stroke-width=".7"/>`
    + `<rect x="${R(dir < 0 ? cx + 3.4 : cx - 8)}" y="57" width="4.6" height="26" rx="2.3" fill="#2c313b"/>`
    + `<rect x="${R(dir < 0 ? cx - 7.6 : cx + 3.6)}" y="59" width="4" height="22" rx="2" fill="#3a404c"/>`
    + `<rect x="${R(cx + (dir < 0 ? -6.9 : 4.3) )}" y="62" width="2.6" height="16" rx="1.3" fill="#2fe0ff" fill-opacity=".35"/>`;
}
function headset() {
  const defs = `<linearGradient id="cu" x1="0" y1="0" x2="1" y2="1">${stops(['#3c4350', '#1f232b', '#121419'])}</linearGradient>${shadow('s', 1.2, 1.3, 0.5)}${blur('g', 1.6)}`;
  const band = `<path d="${arc(61.2, 256, 360)}${arc(61.2, 0, 104).replace('M', 'L')}" fill="none" stroke="#1d2027" stroke-width="5.6" stroke-linecap="round"/>`
    + `<path d="${arc(58.4, 262, 360)}${arc(58.4, 0, 98).replace('M', 'L')}" fill="none" stroke="#3a404c" stroke-width="2.4" stroke-linecap="round"/>`
    + `<path d="${arc(63.2, 300, 360)}${arc(63.2, 0, 40).replace('M', 'L')}" fill="none" stroke="#6b7487" stroke-width=".8" stroke-linecap="round"/>`
    + `<path d="${arc(61.2, 330, 360)}${arc(61.2, 0, 30).replace('M', 'L')}" fill="none" stroke="#2fe0ff" stroke-opacity=".5" stroke-width=".9"/>`;
  const sliders = `<rect x="${R(X(60.5, 258) - 2.2)}" y="${R(Y(60.5, 258) - 1)}" width="4.4" height="7" rx="1" fill="#9aa3b2"/><rect x="${R(X(60.5, 102) - 2.2)}" y="${R(Y(60.5, 102) - 1)}" width="4.4" height="7" rx="1" fill="#9aa3b2"/>`;
  const mic = '<path d="M14 85C13.6 99 23 112 40 117.6" fill="none" stroke="#2a2f38" stroke-width="2.6" stroke-linecap="round"/>'
    + '<path d="M14.6 86C14.4 98.6 23 110 38.6 115.6" fill="none" stroke="#7a8496" stroke-width=".7" stroke-linecap="round"/>'
    + '<g transform="translate(43 118.6) rotate(18)"><rect x="-4.6" y="-3" width="9.2" height="6" rx="3" fill="#2c313b" stroke="#4b5363" stroke-width=".6"/><rect x="-3.2" y="-1.9" width="6.4" height="3.8" rx="1.9" fill="#3a404c"/></g>';
  const before = `<g filter="url(#s)">${band}${sliders}${mic}${cup(-1)}${cup(1)}</g>`;
  const glow = `<g fill="#2fe0ff"><rect x="${R(70 - 56 - 6.9)}" y="62" width="2.6" height="16" rx="1.3"/><rect x="${R(70 + 56 + 4.3)}" y="62" width="2.6" height="16" rx="1.3"/></g>`;
  const after = `<g filter="url(#g)">${glow}</g>${glow}<circle cx="46.4" cy="117" r=".9" fill="#ff3b5c"/><circle cx="46.4" cy="117" r="2.2" fill="#ff3b5c" fill-opacity=".45" filter="url(#g)"/>`;
  return { before: layer(before, { defs }), after: layer(after, { defs, anim: 'fr-breathe 2.6s ease-in-out infinite' }) };
}

// ---------- Ушки ----------
const EAR = '<path d="M-14 5C-13.4 -5 -10 -14.6 -4.4 -19.8Q0 -23.4 4.4 -19.8C10 -14.6 13.4 -5 14 5Z" fill="url(#fu)" stroke="#16161a" stroke-width=".6"/>'
  + '<path d="M-8.4 4C-7.8 -3.4 -5.6 -10.2 -2.2 -13.8Q0 -15.6 2.2 -13.8C5.6 -10.2 7.8 -3.4 8.4 4Z" fill="url(#in)"/>'
  + '<g fill="none" stroke="#fff" stroke-opacity=".75" stroke-width=".5" stroke-linecap="round"><path d="M-3 2Q-3.6 -4 -2 -8"/><path d="M0 2Q0 -4 0 -9"/><path d="M3 2Q3.6 -4 2 -8"/></g>'
  + '<path d="M-12.2 0C-11.4 -7.6 -8.4 -14.4 -4 -18.4" fill="none" stroke="#6a6a78" stroke-width=".8" stroke-linecap="round"/>';
function catears() {
  const defs = `<linearGradient id="fu" x1="0" y1="0" x2="0" y2="1">${stops(['#46464f', '#2a2a30', '#1d1d22'])}</linearGradient>`
    + `<linearGradient id="in" x1="0" y1="0" x2="0" y2="1">${stops(['#ffc9d8', '#ff9fb9', '#f27a9c'])}</linearGradient>`
    + `<clipPath id="out"><path d="M-40 -40H180V180H-40Z${circ(48.6)}" clip-rule="evenodd"/></clipPath>${shadow('s', 1, 1, 0.4)}`;
  const ear = (a) => `<g clip-path="url(#out)" filter="url(#s)">${at(46.5, a, EAR, a)}</g>`;
  const base = place(46.5, 38, 38, 0, 4);
  return {
    before: layer(ear(-38), { defs, ext: [8, 4, 0, 4] }),
    after: layer(ear(38), { defs, ext: [8, 4, 0, 4], anim: 'fr-twitch 5s ease-in-out infinite', origin: base }),
  };
}

// ---------- Молния ----------
function bolt(a0, len, seed) {
  const r = rng(seed);
  let d = `M${P(52.2, a0)}`;
  const n = 9;
  let fork = '';
  for (let i = 1; i <= n; i += 1) {
    const a = a0 + (len * i) / n;
    const rr = 52.2 + (i === n ? 0 : (r() - 0.5) * 7.5);
    d += `L${P(rr, a)}`;
    if (i === 4) fork = `M${P(rr, a)}L${P(rr + 4 + r() * 2, a + 3)}L${P(rr + 7 + r() * 3, a + 2)}`;
  }
  return d + fork;
}
function lightning() {
  const defs = `${blur('g', 1.5)}${blur('h', 3)}`;
  const before = `<path d="${ring(48.4, 56.2)}" fill-rule="evenodd" fill="#0a1430" fill-opacity=".92"/>`
    + `<circle cx="70" cy="70" r="52.3" fill="none" stroke="#2a7dff" stroke-width="4.5" stroke-opacity=".9" filter="url(#h)"/>`
    + '<circle cx="70" cy="70" r="52.3" fill="none" stroke="#5fb8ff" stroke-width="1.6"/>'
    + '<circle cx="70" cy="70" r="52.3" fill="none" stroke="#e8f6ff" stroke-width=".55"/>'
    + '<circle cx="70" cy="70" r="56.6" fill="none" stroke="#5fb8ff" stroke-opacity=".5" stroke-width=".6"/>'
    + '<circle cx="70" cy="70" r="48" fill="none" stroke="#5fb8ff" stroke-opacity=".5" stroke-width=".6"/>';
  const bolts = bolt(-20, 46, 3) + bolt(110, 38, 8) + bolt(215, 52, 13);
  const after = `<g fill="none" stroke-linejoin="round" stroke-linecap="round"><path d="${bolts}" stroke="#4aa8ff" stroke-width="3.2" filter="url(#g)"/><path d="${bolts}" stroke="#f2fbff" stroke-width="1.1"/></g>`;
  return { before: layer(before, { defs }), after: layer(after, { defs, anim: 'fr-crackle 2.2s steps(1, end) infinite' }) };
}

// ---------- 8 бит ----------
function pixel() {
  const u = 4;
  const OUT = '#16121f';
  const px = {};
  for (let i = 0; i < 35; i += 1) {
    for (let j = 0; j < 35; j += 1) {
      const x = i * u + u / 2; const y = j * u + u / 2;
      const d = Math.hypot(x - C, y - C);
      let c = '';
      if (d > 47.2 && d <= 50.4) c = OUT;
      else if (d > 50.4 && d <= 57) {
        const lt = (x - C) + (y - C); // свет слева сверху
        c = lt < -46 ? '#fff4a3' : lt < -10 ? '#ffd23f' : lt < 36 ? '#f5a623' : '#c46b12';
        if (d > 55.2 && lt > 10) c = '#a3530c';
      } else if (d > 57 && d <= 60.4) c = OUT;
      if (c) px[c] = `${px[c] || ''}M${i * u} ${j * u}h${u}v${u}h-${u}z`;
    }
  }
  const pat = (rows, map, s, ox, oy) => rows.map((row, j) => [...row].map((ch, i) => (map[ch] ? `<rect x="${R(ox + i * s)}" y="${R(oy + j * s)}" width="${s}" height="${s}" fill="${map[ch]}"/>` : '')).join('')).join('');
  const heartRows = ['.oo.oo.', 'orrorro', 'orwrrro', 'orrrrro', '.orrro.', '..oro..', '...o...'];
  const heartPx = pat(heartRows, { o: OUT, r: '#ff3355', w: '#ffffff' }, 2.6, X(60, 228) - 9.1, Y(60, 228) - 9.1);
  const coinRows = ['.oooo.', 'oyyyyo', 'oywyyo', 'oywydo', 'oywydo', 'oyyddo', '.oooo.'];
  const cx = X(62, 40); const cy = Y(62, 40);
  const coin = pat(coinRows, { o: OUT, y: '#ffd23f', w: '#fff7c2', d: '#d4880c' }, 3.2, cx - 9.6, cy - 11.2);
  return {
    before: layer(`<g shape-rendering="crispEdges">${Object.entries(px).map(([c, d]) => `<path d="${d}" fill="${c}"/>`).join('')}${heartPx}</g>`, { ext: [0, 2, 2, 2] }),
    after: layer(`<g shape-rendering="crispEdges">${coin}</g>`, { ext: [0, 2, 2, 2], anim: 'fr-coin 1.4s ease-in-out infinite', origin: [cx, cy] }),
  };
}

// ---------- Список ----------
const ART = {
  gold, silver, crown, neon, gamer, headset, pixel, bolt: lightning, fire, ice, garland, leaves, sakura, stars, rainbow, hearts, catears, catfish,
};
export const FRAMES = [
  { id: '', name: 'Без рамки' },
  { id: 'gold', name: 'Золото' },
  { id: 'silver', name: 'Серебро' },
  { id: 'crown', name: 'Корона' },
  { id: 'neon', name: 'Неон' },
  { id: 'gamer', name: 'Геймер' },
  { id: 'headset', name: 'Наушники' },
  { id: 'pixel', name: '8 бит' },
  { id: 'bolt', name: 'Молния' },
  { id: 'fire', name: 'Огонь' },
  { id: 'ice', name: 'Лёд' },
  { id: 'garland', name: 'Гирлянда' },
  { id: 'leaves', name: 'Листва' },
  { id: 'sakura', name: 'Сакура' },
  { id: 'stars', name: 'Звёзды' },
  { id: 'rainbow', name: 'Радуга' },
  { id: 'hearts', name: 'Сердечки' },
  { id: 'catears', name: 'Ушки' },
  { id: 'catfish', name: 'Сом' },
  { id: 'tar', name: 'Нефть' }, // рисунок — в styles.css
];
const FRAME_IDS = new Set(FRAMES.map((f) => f.id));
/** Повесить рамку на элемент аватара (неизвестную — не вешаем: пришла из более новой версии). */
export function putFrame(el, frame) {
  if (frame && FRAME_IDS.has(frame)) el.dataset.frame = frame;
  else delete el.dataset.frame;
  return el;
}

// ---------- CSS ----------
const KEYFRAMES = `
@keyframes fr-spin { to { transform: rotate(1turn); } }
@keyframes fr-shine { 0% { transform: rotate(-70deg); opacity: 0; } 6% { opacity: 1; } 24% { opacity: 1; } 30%, 100% { transform: rotate(150deg); opacity: 0; } }
@keyframes fr-twinkle { 0%, 100% { opacity: .15; transform: scale(.7) rotate(0deg); } 50% { opacity: 1; transform: scale(1) rotate(25deg); } }
@keyframes fr-glint { 0%, 100% { opacity: .1; } 45% { opacity: 1; } 60% { opacity: .85; } }
@keyframes fr-buzz { 0% { opacity: 1; } 61% { opacity: .35; } 62% { opacity: 1; } 64% { opacity: .5; } 65% { opacity: 1; } 88% { opacity: .6; } 89% { opacity: 1; } }
@keyframes fr-flicker { 0% { opacity: .35; transform: scale(.985); } 100% { opacity: 1; transform: scale(1.02); } }
@keyframes fr-sway { 0% { transform: rotate(-3deg); } 100% { transform: rotate(3deg); } }
@keyframes fr-fall { 0% { opacity: 0; transform: translate(-2%, -4%) rotate(-8deg); } 20% { opacity: 1; } 75% { opacity: .9; } 100% { opacity: 0; transform: translate(3%, 10%) rotate(14deg); } }
@keyframes fr-beat { 0%, 100% { transform: scale(1); } 14% { transform: scale(1.14); } 28% { transform: scale(1); } 42% { transform: scale(1.1); } 70% { transform: scale(1); } }
@keyframes fr-blink-a { 0% { opacity: 1; } 50% { opacity: 0; } }
@keyframes fr-blink-b { 0% { opacity: 0; } 50% { opacity: 1; } }
@keyframes fr-breathe { 0%, 100% { opacity: .35; } 50% { opacity: 1; } }
@keyframes fr-twitch { 0%, 84%, 100% { transform: rotate(0deg); } 87% { transform: rotate(13deg); } 90% { transform: rotate(-2deg); } 93% { transform: rotate(9deg); } 96% { transform: rotate(0deg); } }
@keyframes fr-crackle { 0% { transform: rotate(0deg); opacity: 1; } 9% { opacity: .15; } 14% { transform: rotate(132deg); opacity: 1; } 22% { opacity: 0; } 34% { transform: rotate(250deg); opacity: .95; } 41% { opacity: .2; } 47% { transform: rotate(40deg); opacity: 1; } 55% { opacity: 0; } 70% { transform: rotate(190deg); opacity: 1; } 78% { opacity: .25; } 84% { transform: rotate(300deg); opacity: 1; } 92% { opacity: 0; } }
@keyframes fr-coin { 0%, 100% { transform: scaleX(1); } 50% { transform: scaleX(.12); } }
`;
function svgUrl(l) {
  const [t, r, b, le] = l.ext;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-le} ${-t} ${140 + le + r} ${140 + t + b}"><defs>${l.defs}</defs>${l.body}</svg>`;
  // Кодируем только то, что мешает: так картинка в CSS вдвое короче, чем через encodeURIComponent.
  const enc = svg.replace(/"/g, "'").replace(/%/g, '%25').replace(/#/g, '%23').replace(/</g, '%3C').replace(/>/g, '%3E').replace(/\s+/g, ' ');
  return `url("data:image/svg+xml,${enc}")`;
}
function layerCss(sel, l) {
  const [t, r, b, le] = l.ext;
  const w = 140 + le + r; const h = 140 + t + b;
  let css = `${sel} { inset: -${20 + t}% -${20 + r}% -${20 + b}% -${20 + le}%; background-image: ${svgUrl(l)};`;
  if (l.anim) css += ` animation: ${l.anim};`;
  if (l.origin) css += ` transform-origin: ${R(((l.origin[0] + le) / w) * 100)}% ${R(((l.origin[1] + t) / h) * 100)}%;`;
  if (l.hide) css += ' opacity: 0;';
  return `${css} }\n`;
}
let cssCache = '';
/** Весь CSS рамок (рисунки как data:-картинки). */
export function framesCss() {
  if (cssCache) return cssCache;
  let css = KEYFRAMES;
  for (const [id, make] of Object.entries(ART)) {
    const f = make();
    css += layerCss(`.avatar[data-frame="${id}"]::before`, f.before);
    if (f.after) css += layerCss(`.avatar[data-frame="${id}"]::after`, f.after);
  }
  cssCache = css;
  return css;
}
/** Подключить стили рамок к документу (один раз). */
export function installFrames(doc = document) {
  if (doc.somFrames) return;
  const sheet = new doc.defaultView.CSSStyleSheet();
  sheet.replaceSync(framesCss());
  doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
  doc.somFrames = sheet;
}
