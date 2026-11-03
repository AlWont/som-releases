// Редактор фото для аватара и баннера: кадр, масштаб, поворот, цвет, фрагмент анимации.
// Всё считается на этом ПК, наружу уходит только готовый результат.

const AV_OUT = 192; // неподвижная аватарка (обложка), JPEG до 27 КБ
const AV_MAX = 27000;
const ANIM_OUT = 512; // анимация, WebM
const ANIM_TARGET = 2 * 1024 * 1024;
const BANNER_W = 900;
const BANNER_H = 300;
const MAX_SEC = 10;

function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'dataset') Object.assign(e.dataset, v);
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) e.append(kid);
  return e;
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmtKb = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} МБ` : `${Math.max(1, Math.round(n / 1024))} КБ`);
const fmtT = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0').replace('.', ',')}`;
const nextFrame = () => new Promise((r) => requestAnimationFrame(r));
const toBlob = (cv, type, q) => new Promise((r) => cv.toBlob(r, type, q));

// ---------- Источник: картинка, кадры анимации или видео ----------
const VIDEO_EXT = /\.(mp4|webm|mov|m4v|mkv)$/i;
const ANIM_TYPES = new Set(['image/gif', 'image/webp', 'image/png', 'image/apng']);

export function isVideoFile(file) {
  return (file.type || '').startsWith('video/') || VIDEO_EXT.test(file.name || '');
}

/** Возвращает { kind, w, h, duration, frameAt(t), seek(t), close() }. */
export async function loadSource(file) {
  const type = (file.type || '').toLowerCase();
  if (type === 'image/svg+xml' || /\.svg$/i.test(file.name || '')) throw new Error('SVG не подходит — сохраните картинку как PNG или JPEG');
  if (isVideoFile(file)) return loadVideo(file);
  if (ANIM_TYPES.has(type) && 'ImageDecoder' in window) {
    const frames = await loadFrames(file, type).catch(() => null);
    if (frames) return frames;
  }
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { throw new Error('не похоже на картинку'); }
  return { kind: 'image', w: bmp.width, h: bmp.height, duration: 0, frameAt: () => bmp, seek: async () => {}, close: () => bmp.close() };
}

async function loadFrames(file, type) {
  const dec = new ImageDecoder({ data: await file.arrayBuffer(), type: type === 'image/apng' ? 'image/png' : type });
  await dec.tracks.ready;
  await dec.completed;
  const track = dec.tracks.selectedTrack;
  if (!track || !track.animated || track.frameCount < 2) { dec.close(); return null; }
  const frames = [];
  let t = 0;
  let w = 0;
  let h = 0;
  const count = Math.min(track.frameCount, 900);
  for (let i = 0; i < count && t < 60; i += 1) {
    const { image } = await dec.decode({ frameIndex: i });
    w = image.displayWidth;
    h = image.displayHeight;
    const scale = Math.min(1, 640 / Math.max(w, h));
    const bmp = await createImageBitmap(image, { resizeWidth: Math.max(1, Math.round(w * scale)), resizeHeight: Math.max(1, Math.round(h * scale)), resizeQuality: 'high' });
    // Браузеры показывают кадры короче 20 мс как 100 мс — делаем так же.
    const dur = image.duration && image.duration >= 20000 ? image.duration / 1e6 : 0.1;
    image.close();
    frames.push({ bmp, t0: t, dur });
    t += dur;
  }
  dec.close();
  const duration = t;
  const frameAt = (time) => {
    const x = ((time % duration) + duration) % duration;
    let lo = 0;
    let hi = frames.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (frames[mid].t0 <= x) lo = mid; else hi = mid - 1; }
    return frames[lo].bmp;
  };
  return { kind: 'frames', w, h, duration, frameAt, seek: async () => {}, close: () => frames.forEach((f) => f.bmp.close()) };
}

async function loadVideo(file) {
  const url = URL.createObjectURL(file);
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.preload = 'auto';
  v.src = url;
  try {
    await new Promise((res, rej) => {
      v.onloadeddata = res;
      v.onerror = () => rej(new Error('это видео не открывается — попробуйте MP4 или WebM'));
      setTimeout(() => rej(new Error('видео долго открывается')), 15000);
    });
  } catch (err) { URL.revokeObjectURL(url); throw err; }
  if (!v.videoWidth) { URL.revokeObjectURL(url); throw new Error('в файле нет картинки'); }
  const seek = (t) => new Promise((res) => {
    const target = clamp(t, 0, Math.max(0, v.duration - 0.05));
    if (Math.abs(v.currentTime - target) < 0.01 && v.readyState >= 2) { res(); return; }
    const done = () => { v.removeEventListener('seeked', done); res(); };
    v.addEventListener('seeked', done);
    v.currentTime = target;
    setTimeout(done, 3000);
  });
  return {
    kind: 'video', w: v.videoWidth, h: v.videoHeight, duration: Number.isFinite(v.duration) ? v.duration : 0, video: v,
    frameAt: () => v, seek, close: () => { v.pause(); v.removeAttribute('src'); v.load(); URL.revokeObjectURL(url); },
  };
}

// ---------- Рисование ----------
export function defaults() {
  return { zoom: 1, rot90: 0, fine: 0, flip: false, ox: 0, oy: 0, bright: 0, contrast: 0, sat: 0, temp: 0 };
}

function geometry(src, st, W, H) {
  const th = ((st.rot90 * 90 + st.fine) * Math.PI) / 180;
  const c = Math.abs(Math.cos(th));
  const s = Math.abs(Math.sin(th));
  const base = Math.max((W * c + H * s) / src.w, (W * s + H * c) / src.h);
  return { th, c, s, k: base * st.zoom };
}

/** Не даём сдвинуть кадр за край картинки (с учётом поворота). */
export function clampState(src, st, W, H) {
  const { th, c, s, k } = geometry(src, st, W, H);
  const cs = Math.cos(th);
  const sn = Math.sin(th);
  const ox = st.ox * W;
  const oy = st.oy * H;
  let px = (-ox * cs - oy * sn) / k;
  let py = (ox * sn - oy * cs) / k;
  const mx = Math.max(0, src.w / 2 - (W * c + H * s) / (2 * k));
  const my = Math.max(0, src.h / 2 - (W * s + H * c) / (2 * k));
  px = clamp(px, -mx, mx);
  py = clamp(py, -my, my);
  st.ox = (-k * (px * cs - py * sn)) / W;
  st.oy = (-k * (px * sn + py * cs)) / H;
}

const filterOf = (st) => `brightness(${1 + st.bright / 100}) contrast(${1 + st.contrast / 100}) saturate(${1 + st.sat / 100})`;

/** Рисует кадр так, что рамка W×H попадает в прямоугольник r. */
export function drawFrame(ctx, src, frame, r, st, { filters = true } = {}) {
  const { th, k } = geometry(src, st, r.w, r.h);
  ctx.save();
  ctx.imageSmoothingQuality = 'high';
  if (filters) ctx.filter = filterOf(st);
  ctx.translate(r.x + r.w / 2 + st.ox * r.w, r.y + r.h / 2 + st.oy * r.h);
  ctx.rotate(th);
  ctx.scale(k * (st.flip ? -1 : 1), k);
  ctx.drawImage(frame, -src.w / 2, -src.h / 2, src.w, src.h);
  ctx.restore();
  if (filters && st.temp) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.clip();
    ctx.globalCompositeOperation = 'soft-light';
    const a = (Math.abs(st.temp) / 100) * 0.6;
    ctx.fillStyle = st.temp > 0 ? `rgba(255, 150, 40, ${a})` : `rgba(60, 140, 255, ${a})`;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.restore();
  }
}

/** «Авто»: подбираем яркость, контраст и баланс по средним значениям кадра. */
function autoColor(src, frame, st) {
  const cv = document.createElement('canvas');
  cv.width = 64;
  cv.height = 64;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  drawFrame(ctx, src, frame, { x: 0, y: 0, w: 64, h: 64 }, st, { filters: false });
  const d = ctx.getImageData(0, 0, 64, 64).data;
  let sum = 0;
  let sum2 = 0;
  let rs = 0;
  let bs = 0;
  let sat = 0;
  const n = d.length / 4;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i] / 255;
    const g = d[i + 1] / 255;
    const b = d[i + 2] / 255;
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    sum += l;
    sum2 += l * l;
    rs += r;
    bs += b;
    sat += Math.max(r, g, b) - Math.min(r, g, b);
  }
  const mean = sum / n;
  const sd = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
  return {
    bright: Math.round(clamp((0.5 - mean) * 90, -35, 35)),
    contrast: Math.round(clamp((0.21 / Math.max(sd, 0.05) - 1) * 40, -25, 35)),
    sat: Math.round(clamp((0.28 - sat / n) * 80, -10, 25)),
    temp: Math.round(clamp(((bs - rs) / n) * 120, -30, 30)),
  };
}

async function faceCenter(frame) {
  if (!('FaceDetector' in window)) return null;
  try {
    const faces = await new window.FaceDetector({ fastMode: false, maxDetectedFaces: 3 }).detect(frame);
    if (!faces.length) return null;
    return faces.map((f) => f.boundingBox).sort((a, b) => b.width * b.height - a.width * a.height)[0];
  } catch { return null; }
}

async function jpegUnder(cv, max) {
  for (const q of [0.9, 0.84, 0.76, 0.66, 0.56, 0.46, 0.36]) {
    const b = await toBlob(cv, 'image/jpeg', q);
    if (b && b.size <= max) return b;
  }
  return null;
}

function renderStill(src, frame, st, W, H) {
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#1f2428';
  ctx.fillRect(0, 0, W, H);
  drawFrame(ctx, src, frame, { x: 0, y: 0, w: W, h: H }, st);
  return cv;
}

/** Кодируем фрагмент в зацикленный WebM. Идёт в реальном времени — до 10 секунд. */
async function encodeAnim(src, st, start, len, onProgress, bps, W = ANIM_OUT, H = ANIM_OUT) {
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d');
  const r = { x: 0, y: 0, w: W, h: H };
  const paint = (frame) => { ctx.fillStyle = '#1f2428'; ctx.fillRect(0, 0, W, H); drawFrame(ctx, src, frame, r, st); };
  const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m));
  if (!mime) throw new Error('этот Som не умеет записывать WebM');
  const stream = cv.captureStream(30);
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bps });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const stopped = new Promise((res) => { rec.onstop = res; });
  const v = src.kind === 'video' ? src.video : null;
  if (v) { v.pause(); v.loop = false; await src.seek(start); }
  paint(src.frameAt(start));
  rec.start(500);
  const t0 = performance.now();
  if (v) await v.play().catch(() => {});
  for (;;) {
    await nextFrame();
    const t = v ? v.currentTime - start : (performance.now() - t0) / 1000;
    if (t >= len || (v && v.ended)) break;
    paint(src.frameAt(start + t));
    onProgress?.(t / len);
  }
  if (v) v.pause();
  rec.stop();
  await stopped;
  stream.getTracks().forEach((tr) => tr.stop());
  return new Blob(chunks, { type: 'video/webm' });
}

// ---------- Окно редактора ----------
/**
 * Открывает редактор. mode: 'avatar' (круг) или 'banner' (3:1); из GIF и видео у обоих выходит анимация.
 * Результат: avatar → { b64, url, anim: Uint8Array|null, animUrl, size }; banner → { banner: Uint8Array, url, anim, animUrl, size }; отмена → null.
 */
export async function openAvatarEditor(file, mode = 'avatar') {
  const src = await loadSource(file);
  const banner = mode === 'banner';
  const animated = src.duration > 0.15;
  const canAnim = animated;
  // Сцена: рамка в центре, вокруг затемнённый «запас» картинки.
  const SW = banner ? 600 : 420;
  const SH = banner ? 280 : 340;
  const FR = banner ? { w: 540, h: 180 } : { w: 280, h: 280 };
  FR.x = (SW - FR.w) / 2;
  FR.y = (SH - FR.h) / 2;
  const st = defaults();
  const tm = { start: 0, len: canAnim ? Math.min(MAX_SEC, src.duration) : 0, cover: 0, playing: canAnim, still: false };
  let grid = false;
  let closed = false; // окно закрыли — больше не рисуем (кадры анимации уже освобождены)

  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const stage = el('canvas', { class: 'ed-stage', 'aria-label': 'Кадр. Перетаскивайте мышью, колесо — масштаб' });
  stage.width = Math.round(SW * dpr);
  stage.height = Math.round(SH * dpr);
  stage.style.maxWidth = `${SW}px`;
  stage.style.aspectRatio = `${SW} / ${SH}`;
  const sctx = stage.getContext('2d');

  const range = (min, max, step, value, label) => el('input', { type: 'range', min, max, step, value, 'aria-label': label });
  const zoom = range(100, 400, 1, 100, 'Масштаб');
  const fine = range(-45, 45, 0.5, 0, 'Наклон');
  const sliders = {
    bright: range(-50, 50, 1, 0, 'Яркость'), contrast: range(-50, 50, 1, 0, 'Контраст'),
    sat: range(-100, 100, 1, 0, 'Насыщенность'), temp: range(-100, 100, 1, 0, 'Температура'),
  };
  const zoomVal = el('output', { text: '100%' });
  const fineVal = el('output', { text: '0°' });
  const vals = Object.fromEntries(Object.keys(sliders).map((k) => [k, el('output', { text: '0' })]));
  const btn = (text, title, onclick, cls = 'btn small') => el('button', { type: 'button', class: cls, title, text, onclick });
  const undoBtn = btn('↶', 'Отменить (Ctrl+Z)', () => undo(), 'btn small icon-btn');
  const redoBtn = btn('↷', 'Вернуть (Ctrl+Y)', () => redo(), 'btn small icon-btn');
  const gridBtn = el('button', { type: 'button', class: 'btn small', 'aria-pressed': 'false', text: 'Сетка', title: 'Сетка третей', onclick: () => { grid = !grid; gridBtn.setAttribute('aria-pressed', String(grid)); draw(); } });
  const faceBtn = 'FaceDetector' in window ? btn('По лицу', 'Поставить лицо в центр', () => centerFace()) : null;

  const sizeLine = el('p', { class: 'ed-size hint', text: ' ' });
  const note = el('p', { class: 'hint mic-note', hidden: true });
  const progress = el('progress', { class: 'ed-progress', max: 1, value: 0, hidden: true });

  // Предпросмотр: как будет выглядеть в списке, в чате и в карточке, на светлом и тёмном.
  const previews = [];
  const mkPrev = (w, h) => {
    const c = el('canvas', { class: `ed-prev ${banner ? 'banner' : 'round'}` });
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    c.style.width = `${w}px`;
    c.style.height = `${h}px`;
    previews.push({ c, w, h });
    return c;
  };
  const prevRow = el('div', { class: 'ed-previews' },
    ...['light', 'dark'].map((theme) => el('div', { class: 'ed-prev-set', dataset: { theme }, title: theme === 'light' ? 'На светлой теме' : 'На тёмной теме' },
      ...(banner ? [mkPrev(210, 70)] : [128, 64, 32].map((s) => mkPrev(s, s))))));

  // Фрагмент анимации.
  let tl = null;
  const startR = range(0, Math.max(0, src.duration - tm.len), 0.05, 0, 'Начало фрагмента');
  const lenR = range(Math.min(0.5, src.duration), Math.min(MAX_SEC, src.duration), 0.05, tm.len, 'Длина фрагмента');
  const coverR = range(0, tm.len, 0.05, 0, 'Кадр обложки');
  const startV = el('output');
  const lenV = el('output');
  const coverV = el('output');
  const playBtn = btn('Пауза', 'Проиграть или остановить', () => { tm.playing = !tm.playing; syncPlay(); });
  const stillBox = el('input', { type: 'checkbox' });
  if (animated) {
    tl = el('div', { class: 'ed-sec' },
      el('h4', { text: 'Анимация' }),
      el('label', { class: 'ed-row' }, el('span', { text: 'Начало' }), startR, startV),
      el('label', { class: 'ed-row' }, el('span', { text: 'Длина' }), lenR, lenV),
      el('label', { class: 'ed-row' }, el('span', { text: 'Обложка' }), coverR, coverV),
      el('div', { class: 'inline' }, playBtn, el('label', { class: 'check' }, stillBox, el('span', { text: 'Без анимации — только обложка' }))),
      el('p', { class: 'hint', text: banner
        ? `До ${MAX_SEC} секунд, по кругу — в карточке профиля. Обложку видят те, у кого анимация выключена, и друзья со старым Som.`
        : `До ${MAX_SEC} секунд, по кругу. Обложку видят, пока не наведут мышь, и те, у кого анимация выключена.` }));
  }

  const row = (label, input, out) => el('label', { class: 'ed-row' }, el('span', { text: label }), input, out);
  const panel = el('div', { class: 'ed-panel' },
    el('div', { class: 'ed-sec' },
      el('h4', { text: 'Кадр' }),
      row('Масштаб', zoom, zoomVal),
      row('Наклон', fine, fineVal),
      el('div', { class: 'inline wrap' },
        btn('⟲ 90°', 'Повернуть влево', () => { st.rot90 = (st.rot90 + 3) % 4; changed(); }),
        btn('⟳ 90°', 'Повернуть вправо', () => { st.rot90 = (st.rot90 + 1) % 4; changed(); }),
        btn('⇋', 'Отразить', () => { st.flip = !st.flip; changed(); }),
        gridBtn, faceBtn)),
    el('div', { class: 'ed-sec' },
      el('h4', {}, el('span', { text: 'Цвет' }), btn('Авто', 'Подобрать автоматически', () => { Object.assign(st, autoColor(src, currentFrame(), st)); changed(); }, 'btn small ghost')),
      row('Яркость', sliders.bright, vals.bright),
      row('Контраст', sliders.contrast, vals.contrast),
      row('Насыщенность', sliders.sat, vals.sat),
      row('Температура', sliders.temp, vals.temp)),
    tl);

  const dlg = el('dialog', { class: `editor-dlg ${banner ? 'is-banner' : ''}`, 'aria-label': banner ? 'Баннер' : 'Фото профиля' },
    el('div', { class: 'ed-head' },
      el('h2', { text: banner ? 'Баннер' : 'Фото профиля' }),
      el('div', { class: 'inline' }, undoBtn, redoBtn, btn('Сбросить', 'Вернуть как было', () => reset(), 'btn small ghost'))),
    el('div', { class: 'ed-body' },
      el('div', { class: 'ed-left' }, stage, el('p', { class: 'hint', text: 'Тяните мышью, колесо — масштаб.' }), prevRow, sizeLine),
      panel),
    note, progress,
    el('div', { class: 'dlg-actions' },
      btn('Отмена', '', () => finish(null), 'btn'),
      el('button', { type: 'button', class: 'btn primary', text: 'Готово', onclick: () => done() })));
  document.body.append(dlg);

  // ---------- Состояние и история ----------
  const hist = [JSON.stringify(st)];
  let hpos = 0;
  const syncInputs = () => {
    zoom.value = String(Math.round(st.zoom * 100));
    zoomVal.textContent = `${Math.round(st.zoom * 100)}%`;
    fine.value = String(st.fine);
    fineVal.textContent = `${st.fine > 0 ? '+' : ''}${st.fine}°`;
    for (const [k, s] of Object.entries(sliders)) { s.value = String(st[k]); vals[k].textContent = `${st[k] > 0 ? '+' : ''}${st[k]}`; }
    undoBtn.disabled = hpos === 0;
    redoBtn.disabled = hpos >= hist.length - 1;
  };
  const commit = () => {
    const j = JSON.stringify(st);
    if (j === hist[hpos]) return;
    hist.splice(hpos + 1);
    hist.push(j);
    if (hist.length > 100) hist.shift();
    hpos = hist.length - 1;
    syncInputs();
    scheduleSize();
  };
  const restore = () => { Object.assign(st, JSON.parse(hist[hpos])); syncInputs(); draw(); scheduleSize(); };
  const undo = () => { if (hpos > 0) { hpos -= 1; restore(); } };
  const redo = () => { if (hpos < hist.length - 1) { hpos += 1; restore(); } };
  const reset = () => { Object.assign(st, defaults()); changed(); };
  function changed() { clampState(src, st, FR.w, FR.h); syncInputs(); draw(); commit(); }

  zoom.addEventListener('input', () => { st.zoom = Number(zoom.value) / 100; clampState(src, st, FR.w, FR.h); syncInputs(); draw(); });
  fine.addEventListener('input', () => { st.fine = Number(fine.value); clampState(src, st, FR.w, FR.h); syncInputs(); draw(); });
  for (const [k, s] of Object.entries(sliders)) s.addEventListener('input', () => { st[k] = Number(s.value); syncInputs(); draw(); });
  for (const s of [zoom, fine, ...Object.values(sliders)]) s.addEventListener('change', commit);

  // ---------- Мышь ----------
  let drag = null;
  stage.addEventListener('pointerdown', (e) => {
    stage.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, ox: st.ox, oy: st.oy };
    stage.classList.add('dragging');
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const sc = SW / stage.getBoundingClientRect().width;
    st.ox = drag.ox + ((e.clientX - drag.x) * sc) / FR.w;
    st.oy = drag.oy + ((e.clientY - drag.y) * sc) / FR.h;
    clampState(src, st, FR.w, FR.h);
    draw();
  });
  const endDrag = () => { if (drag) { drag = null; stage.classList.remove('dragging'); commit(); } };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);
  let wheelTimer = 0;
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = stage.getBoundingClientRect();
    const sc = SW / rect.width;
    // Точка под курсором остаётся на месте.
    const qx = (e.clientX - rect.left) * sc - (FR.x + FR.w / 2);
    const qy = (e.clientY - rect.top) * sc - (FR.y + FR.h / 2);
    const z0 = st.zoom;
    const z1 = clamp(z0 * Math.exp(-e.deltaY * 0.0015), 1, 4);
    const ox = st.ox * FR.w;
    const oy = st.oy * FR.h;
    st.ox = (qx - (qx - ox) * (z1 / z0)) / FR.w;
    st.oy = (qy - (qy - oy) * (z1 / z0)) / FR.h;
    st.zoom = z1;
    clampState(src, st, FR.w, FR.h);
    syncInputs();
    draw();
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(commit, 300);
  }, { passive: false });
  stage.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 0.05 : 0.01;
    const map = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (map[e.key]) { e.preventDefault(); st.ox += map[e.key][0]; st.oy += map[e.key][1]; changed(); }
  });
  stage.tabIndex = 0;

  dlg.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    if ((k === 'z' || k === 'я') && !e.shiftKey) { e.preventDefault(); undo(); } else if (k === 'y' || k === 'н' || ((k === 'z' || k === 'я') && e.shiftKey)) { e.preventDefault(); redo(); }
  });

  async function centerFace() {
    faceBtn.disabled = true;
    try {
      const frame = currentFrame();
      const box = await faceCenter(frame);
      if (!box) { showNote('Лицо не нашлось — подвиньте кадр вручную.'); return; }
      // Координаты лица — в пикселях кадра; у уменьшенных кадров GIF свой масштаб.
      const fw = frame.width || frame.videoWidth || src.w;
      const scale = src.w / fw;
      const fx = (box.x + box.width / 2) * scale - src.w / 2;
      const fy = (box.y + box.height / 2) * scale - src.h / 2;
      st.zoom = clamp((Math.min(FR.w, FR.h) * 0.55) / (box.height * scale * geometry(src, { ...st, zoom: 1 }, FR.w, FR.h).k), 1, 4);
      const { th, k } = geometry(src, st, FR.w, FR.h);
      const x = (st.flip ? -fx : fx) * k;
      const y = fy * k;
      st.ox = -(x * Math.cos(th) - y * Math.sin(th)) / FR.w;
      st.oy = -(x * Math.sin(th) + y * Math.cos(th)) / FR.h;
      changed();
    } finally { faceBtn.disabled = false; }
  }

  // ---------- Время ----------
  let playT0 = performance.now();
  const coverTime = () => tm.start + tm.cover;
  function currentFrame() {
    if (!animated) return src.frameAt(0);
    if (src.kind === 'video') return src.video;
    if (tm.playing) return src.frameAt(tm.start + (((performance.now() - playT0) / 1000) % tm.len));
    return src.frameAt(coverTime());
  }
  const syncTime = () => {
    startR.max = String(Math.max(0, src.duration - tm.len));
    coverR.max = String(tm.len);
    tm.cover = Math.min(tm.cover, tm.len);
    startV.textContent = fmtT(tm.start);
    lenV.textContent = `${tm.len.toFixed(1).replace('.', ',')} с`;
    coverV.textContent = fmtT(coverTime());
    playBtn.textContent = tm.playing ? 'Пауза' : 'Проиграть';
    playBtn.disabled = tm.still;
  };
  async function syncPlay() {
    syncTime();
    if (src.kind === 'video') {
      if (tm.playing && !tm.still) { await src.seek(tm.start); src.video.play().catch(() => {}); } else { src.video.pause(); await src.seek(coverTime()); draw(); }
    }
    playT0 = performance.now();
    draw();
  }
  if (animated) {
    startR.addEventListener('input', () => { tm.start = Number(startR.value); tm.playing = false; syncPlay(); });
    lenR.addEventListener('input', () => { tm.len = Number(lenR.value); tm.start = Math.min(tm.start, Math.max(0, src.duration - tm.len)); tm.playing = false; syncPlay(); scheduleSize(); });
    coverR.addEventListener('input', () => { tm.cover = Number(coverR.value); tm.playing = false; syncPlay(); scheduleSize(); });
    stillBox.addEventListener('change', () => { tm.still = stillBox.checked; tm.playing = !tm.still; syncPlay(); scheduleSize(); });
  }

  // ---------- Отрисовка ----------
  let raf = 0;
  function paintStage(frame) {
    const c = sctx;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, SW, SH);
    c.fillStyle = '#0e1012';
    c.fillRect(0, 0, SW, SH);
    drawFrame(c, src, frame, FR, st);
    // Затемняем всё вне рамки.
    c.save();
    c.beginPath();
    c.rect(0, 0, SW, SH);
    if (banner) c.roundRect(FR.x, FR.y, FR.w, FR.h, 10);
    else c.arc(FR.x + FR.w / 2, FR.y + FR.h / 2, FR.w / 2, 0, Math.PI * 2);
    c.fillStyle = 'rgba(8, 10, 12, 0.62)';
    c.fill('evenodd');
    c.restore();
    c.save();
    c.strokeStyle = 'rgba(232, 227, 216, 0.85)';
    c.lineWidth = 1.5;
    c.strokeRect(FR.x + 0.5, FR.y + 0.5, FR.w - 1, FR.h - 1);
    if (grid) {
      c.strokeStyle = 'rgba(232, 227, 216, 0.45)';
      c.lineWidth = 1;
      c.beginPath();
      for (const f of [1 / 3, 2 / 3]) {
        c.moveTo(FR.x + FR.w * f, FR.y); c.lineTo(FR.x + FR.w * f, FR.y + FR.h);
        c.moveTo(FR.x, FR.y + FR.h * f); c.lineTo(FR.x + FR.w, FR.y + FR.h * f);
      }
      c.stroke();
    }
    c.restore();
    for (const p of previews) {
      const pc = p.c.getContext('2d');
      pc.setTransform(dpr, 0, 0, dpr, 0, 0);
      pc.clearRect(0, 0, p.w, p.h);
      pc.save();
      pc.beginPath();
      if (banner) pc.roundRect(0, 0, p.w, p.h, 8); else pc.arc(p.w / 2, p.h / 2, p.w / 2, 0, Math.PI * 2);
      pc.clip();
      pc.fillStyle = '#1f2428';
      pc.fillRect(0, 0, p.w, p.h);
      drawFrame(pc, src, frame, { x: 0, y: 0, w: p.w, h: p.h }, st);
      pc.restore();
    }
  }
  function draw() {
    if (raf || closed) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (closed) return;
      if (src.kind === 'video' && animated && tm.playing && !tm.still) {
        const v = src.video;
        if (v.currentTime >= tm.start + tm.len || v.ended || v.currentTime < tm.start - 0.2) { v.currentTime = tm.start; if (v.paused) v.play().catch(() => {}); }
      }
      paintStage(currentFrame());
      if (animated && tm.playing && !tm.still && dlg.open) draw();
    });
  }

  // ---------- Размер результата ----------
  let sizeTimer = 0;
  let sizeSeq = 0;
  function scheduleSize() {
    clearTimeout(sizeTimer);
    sizeTimer = setTimeout(async () => {
      if (closed) return;
      const seq = ++sizeSeq;
      const frame = animated ? src.frameAt(coverTime()) : src.frameAt(0);
      if (src.kind === 'video') return showSizeVideo();
      const cv = banner ? renderStill(src, frame, st, BANNER_W, BANNER_H) : renderStill(src, frame, st, AV_OUT, AV_OUT);
      const b = await jpegUnder(cv, banner ? 400000 : AV_MAX);
      if (seq !== sizeSeq) return;
      const still = b ? `${banner ? `${BANNER_W}×${BANNER_H}` : `${AV_OUT}×${AV_OUT}`} JPEG, ${fmtKb(b.size)}` : 'не сжимается';
      sizeLine.textContent = canAnim && !tm.still ? `Обложка: ${still} · анимация ≈ ${fmtKb(estimateAnim())}, WebM ${animSize()}` : `Итоговый файл: ${still}`;
    }, 250);
  }
  const estimateAnim = () => Math.min(ANIM_TARGET, Math.round((animBps() * tm.len) / 8));
  const animBps = () => clamp(Math.floor((ANIM_TARGET * 8 * 0.85) / Math.max(tm.len, 0.5)), 400000, 2500000);
  const animSize = () => (banner ? `${BANNER_W}×${BANNER_H}` : `${ANIM_OUT}×${ANIM_OUT}`);
  function showSizeVideo() {
    sizeLine.textContent = canAnim && !tm.still
      ? `Обложка: JPEG ${banner ? `${BANNER_W}×${BANNER_H}` : `${AV_OUT}×${AV_OUT}`} · анимация ≈ ${fmtKb(estimateAnim())}, WebM ${animSize()}`
      : `Итоговый файл: JPEG ${banner ? `${BANNER_W}×${BANNER_H}` : `${AV_OUT}×${AV_OUT}`}`;
  }

  function showNote(text, kind = '') {
    note.textContent = text;
    note.dataset.kind = kind;
    note.hidden = false;
  }

  // ---------- Готово ----------
  let resolveP;
  const result = new Promise((r) => { resolveP = r; });
  let busy = false;
  function finish(value) {
    if (busy && value === null) return;
    closed = true;
    cancelAnimationFrame(raf);
    clearTimeout(sizeTimer);
    clearTimeout(wheelTimer);
    raf = 0;
    try { dlg.close(); } catch { /* уже закрыт */ }
    dlg.remove();
    src.close();
    resolveP(value);
  }
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); if (!busy) finish(null); });

  async function done() {
    if (busy) return;
    busy = true;
    for (const b of dlg.querySelectorAll('button, input')) b.disabled = true;
    try {
      tm.playing = false;
      if (src.kind === 'video') { src.video.pause(); await src.seek(coverTime()); }
      const frame = animated ? src.frameAt(coverTime()) : src.frameAt(0);
      const cover = banner
        ? await jpegUnder(renderStill(src, frame, st, BANNER_W, BANNER_H), 400000)
        : await jpegUnder(renderStill(src, frame, st, AV_OUT, AV_OUT), AV_MAX);
      if (!cover) throw new Error(banner ? 'баннер не сжимается' : 'фото не сжимается');
      let anim = null;
      let animUrl = null;
      if (canAnim && !tm.still) {
        showNote('Записываю анимацию — это займёт столько же, сколько длится фрагмент…');
        progress.hidden = false;
        let bps = animBps();
        let blob = null;
        const [W, H] = banner ? [BANNER_W, BANNER_H] : [ANIM_OUT, ANIM_OUT];
        for (let attempt = 0; attempt < 3; attempt += 1) {
          blob = await encodeAnim(src, st, tm.start, tm.len, (f) => { progress.value = Math.min(1, (attempt + f) / (attempt + 1)); }, bps, W, H);
          if (blob.size <= ANIM_TARGET * 1.25) break;
          bps = Math.floor((bps * ANIM_TARGET) / blob.size * 0.85);
        }
        if (!blob || blob.size > 7 * 1024 * 1024) throw new Error('анимация получилась слишком большой — сократите фрагмент');
        anim = new Uint8Array(await blob.arrayBuffer());
        animUrl = URL.createObjectURL(blob);
      }
      if (banner) {
        finish({ banner: new Uint8Array(await cover.arrayBuffer()), url: URL.createObjectURL(cover), anim, animUrl, size: cover.size + (anim?.length || 0) });
        return;
      }
      const b64 = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(',')[1]); fr.readAsDataURL(cover); });
      finish({ b64, url: URL.createObjectURL(cover), anim, animUrl, size: cover.size + (anim?.length || 0) });
    } catch (err) {
      busy = false;
      for (const b of dlg.querySelectorAll('button, input')) b.disabled = false;
      progress.hidden = true;
      showNote(err.message, 'bad');
      syncInputs();
    }
  }

  // Старт: по центру, обложка — первый кадр.
  clampState(src, st, FR.w, FR.h);
  hist[0] = JSON.stringify(st);
  syncInputs();
  if (animated) await syncPlay();
  dlg.showModal();
  stage.focus();
  draw();
  scheduleSize();
  return result;
}
