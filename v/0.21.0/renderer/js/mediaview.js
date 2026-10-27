// Просмотр фото и видео и свой плеер для аудио/видео-файлов.
// Фото: вписывается в окно; колесо, кнопки и клавиши + − 0 1 — масштаб; приближенное можно таскать;
// двойной щелчок — «вписать» ↔ «приблизить»; стрелки ← → листают фото и видео этого чата.
// Видео открывается крупно, со своими кнопками. Одновременно играет только один файл.

let X = null;
const $ = (id) => document.getElementById(id);
const V = {
  mid: null, kind: '', list: [], idx: -1,
  s: 1, x: 0, y: 0, fit: 1, w: 0, h: 0, mode: 'fit', drag: null, moved: false, bar: null,
};
const PAD = 24;

// ---------- Значки ----------
const SVG = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const ICONS = {
  play: SVG('<polygon points="7 4 20 12 7 20 7 4" class="fill"/>'),
  pause: SVG('<rect x="6" y="4" width="4" height="16" rx="1" class="fill"/><rect x="14" y="4" width="4" height="16" rx="1" class="fill"/>'),
  vol: SVG('<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" class="fill"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/>'),
  mute: SVG('<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" class="fill"/><line x1="22" y1="9" x2="16" y2="15"/><line x1="16" y1="9" x2="22" y2="15"/>'),
  full: SVG('<path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>'),
};

function fmtTime(t) {
  if (!Number.isFinite(t) || t < 0) return '0:00';
  const s = Math.floor(t % 60);
  const m = Math.floor(t / 60) % 60;
  const hr = Math.floor(t / 3600);
  return hr ? `${hr}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
function pref(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } }
function setPref(k, v) { try { localStorage.setItem(k, v); } catch { /* не страшно */ } }

// ---------- Один файл за раз ----------
const MEDIA = new Set();
/** Зарегистрировать <audio>/<video> файла: начал играть он — остальные файлы встают на паузу. */
export function registerMedia(el) {
  MEDIA.add(el);
  el.volume = Math.max(0, Math.min(1, Number(pref('som.mediaVol', '1')) || 0));
  el.muted = pref('som.mediaMuted', '0') === '1';
  el.addEventListener('play', () => { for (const o of MEDIA) if (o !== el && !o.paused) o.pause(); });
  return el;
}

// ---------- Панель плеера ----------
const SPEEDS = [1, 1.25, 1.5, 2, 0.75];
/** Тёмная панель управления для аудио или видео: пауза, перемотка, время, скорость, звук, во весь экран. */
export function mediaBar(media, { full = null } = {}) {
  const mk = (tag, cls, label) => {
    const e = document.createElement(tag);
    e.className = cls;
    if (tag === 'button') { e.type = 'button'; e.title = label; e.setAttribute('aria-label', label); }
    return e;
  };
  const play = mk('button', 'mb-btn mb-play', 'Играть');
  const cur = mk('span', 'mb-time', '');
  const dur = mk('span', 'mb-time mb-dur', '');
  const seek = mk('input', 'mb-seek', '');
  seek.type = 'range'; seek.min = '0'; seek.max = '1000'; seek.step = '1'; seek.value = '0';
  seek.setAttribute('aria-label', 'Перемотка');
  const speed = mk('button', 'mb-btn mb-speed', 'Скорость');
  const volB = mk('button', 'mb-btn mb-vol', 'Звук');
  const vol = mk('input', 'mb-volr', '');
  vol.type = 'range'; vol.min = '0'; vol.max = '100'; vol.step = '5';
  vol.setAttribute('aria-label', 'Громкость');
  const fs = full ? mk('button', 'mb-btn mb-full', 'Во весь экран (F)') : null;
  if (fs) fs.innerHTML = ICONS.full; // постоянная разметка значка

  let dragging = false;
  const syncPlay = () => {
    play.innerHTML = media.paused ? ICONS.play : ICONS.pause; // постоянная разметка значка
    play.title = media.paused ? 'Играть (пробел)' : 'Пауза (пробел)';
    play.setAttribute('aria-label', play.title);
  };
  const syncTime = () => {
    const d = media.duration;
    cur.textContent = fmtTime(media.currentTime);
    dur.textContent = Number.isFinite(d) ? fmtTime(d) : '—:—';
    if (!dragging) seek.value = Number.isFinite(d) && d > 0 ? String(Math.round((media.currentTime / d) * 1000)) : '0';
  };
  const syncVol = () => {
    vol.value = String(media.muted ? 0 : Math.round(media.volume * 100));
    volB.innerHTML = media.muted || media.volume === 0 ? ICONS.mute : ICONS.vol; // постоянная разметка значка
  };
  const syncSpeed = () => { speed.textContent = `${String(media.playbackRate).replace('.', ',')}×`; };
  play.addEventListener('click', (e) => { e.stopPropagation(); if (media.paused) media.play().catch(() => {}); else media.pause(); });
  seek.addEventListener('input', () => {
    dragging = true;
    const d = media.duration;
    if (Number.isFinite(d)) cur.textContent = fmtTime((Number(seek.value) / 1000) * d);
  });
  seek.addEventListener('change', () => {
    const d = media.duration;
    if (Number.isFinite(d)) media.currentTime = (Number(seek.value) / 1000) * d;
    dragging = false;
  });
  speed.addEventListener('click', (e) => {
    e.stopPropagation();
    const i = SPEEDS.indexOf(media.playbackRate);
    media.playbackRate = SPEEDS[(i + 1) % SPEEDS.length];
  });
  volB.addEventListener('click', (e) => {
    e.stopPropagation();
    media.muted = !media.muted;
    if (!media.muted && media.volume === 0) media.volume = 0.6;
  });
  vol.addEventListener('input', () => {
    media.volume = Number(vol.value) / 100;
    media.muted = media.volume === 0;
  });
  media.addEventListener('volumechange', () => {
    syncVol();
    setPref('som.mediaVol', String(media.volume));
    setPref('som.mediaMuted', media.muted ? '1' : '0');
  });
  fs?.addEventListener('click', (e) => { e.stopPropagation(); toggleFull(full); });
  for (const ev of ['play', 'pause', 'ended']) media.addEventListener(ev, syncPlay);
  for (const ev of ['timeupdate', 'durationchange', 'loadedmetadata', 'seeked']) media.addEventListener(ev, syncTime);
  media.addEventListener('ratechange', syncSpeed);
  syncPlay(); syncTime(); syncVol(); syncSpeed();
  const bar = document.createElement('div');
  bar.className = 'media-bar';
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', 'Плеер');
  const volWrap = mk('span', 'mb-volwrap', '');
  volWrap.append(volB, vol);
  bar.append(play, cur, seek, dur, speed, volWrap, ...(fs ? [fs] : []));
  bar.addEventListener('click', (e) => e.stopPropagation());
  return bar;
}
function toggleFull(el) {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else el?.requestFullscreen?.().catch(() => {});
}

// ---------- Окно просмотра ----------
export function initMediaView(deps) {
  X = deps;
  const dlg = $('viewer');
  const stage = $('viewerStage');
  const img = $('viewerImg');
  const vid = registerMedia($('viewerVideo'));
  vid.addEventListener('click', () => { if (vid.paused) vid.play().catch(() => {}); else vid.pause(); });
  vid.addEventListener('dblclick', () => toggleFull(stage));
  stage.addEventListener('wheel', (e) => {
    if (V.kind !== 'image' || !V.w) return;
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    // Один щелчок колеса — примерно ×1,25; тачпад даёт мелкие шаги — масштаб меняется плавно.
    const k = Math.max(0.7, Math.min(1.45, Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.07 : 0.0022))));
    zoomAt(V.s * k, e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  img.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || V.kind !== 'image') return;
    e.preventDefault();
    V.drag = { px: e.clientX, py: e.clientY, x: V.x, y: V.y };
    V.moved = false;
    img.setPointerCapture(e.pointerId);
    stage.classList.add('dragging');
  });
  img.addEventListener('pointermove', (e) => {
    if (!V.drag) return;
    const dx = e.clientX - V.drag.px;
    const dy = e.clientY - V.drag.py;
    if (Math.abs(dx) + Math.abs(dy) > 3) V.moved = true;
    if (!pannable()) return;
    V.x = V.drag.x + dx;
    V.y = V.drag.y + dy;
    V.mode = 'free';
    clamp();
    apply();
  });
  const endDrag = () => { V.drag = null; stage.classList.remove('dragging'); };
  img.addEventListener('pointerup', endDrag);
  img.addEventListener('pointercancel', endDrag);
  img.addEventListener('dblclick', (e) => {
    const r = stage.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    if (Math.abs(V.s - V.fit) < 0.01) zoomAt(Math.max(1, V.fit * 2.5), px, py);
    else fitImage();
  });
  // Щелчок по пустому месту вокруг фото — закрыть, как в обычных просмотрщиках.
  stage.addEventListener('click', (e) => { if (e.target === stage && V.kind === 'image') dlg.close(); });
  img.addEventListener('load', () => {
    // Размер берём у полного фото (у миниатюры он меньше, а в сведениях о файле его может не быть
    // или он без учёта поворота) — и вписываем заново.
    const full = Boolean(img.dataset.full);
    if ((!full && V.w) || !img.naturalWidth) return;
    const changed = img.naturalWidth !== V.w || img.naturalHeight !== V.h;
    V.w = img.naturalWidth;
    V.h = img.naturalHeight;
    if (!changed) return;
    sizeImg();
    if (V.mode === 'fit') fitImage(); else { clamp(); apply(); }
  });
  $('vzIn').addEventListener('click', () => zoomCenter(V.s * 1.4));
  $('vzOut').addEventListener('click', () => zoomCenter(V.s / 1.4));
  $('vzPct').addEventListener('click', () => fitImage());
  $('vzOne').addEventListener('click', () => zoomCenter(1));
  $('viewerPrev').addEventListener('click', (e) => { e.stopPropagation(); step(-1); });
  $('viewerNext').addEventListener('click', (e) => { e.stopPropagation(); step(1); });
  // Клавиши слушаем на всём документе: фокус может уйти с кнопки, которая спряталась (масштаб у видео).
  document.addEventListener('keydown', (e) => {
    if (!dlg.open || e.defaultPrevented) return;
    if (e.target.closest?.('input, textarea, select')) return;
    const vid = $('viewerVideo');
    if (V.kind === 'video') {
      if (e.key === ' ' || e.key === 'k') { e.preventDefault(); if (vid.paused) vid.play().catch(() => {}); else vid.pause(); return; }
      if (e.key === 'ArrowLeft' && !e.shiftKey) { e.preventDefault(); vid.currentTime = Math.max(0, vid.currentTime - 5); return; }
      if (e.key === 'ArrowRight' && !e.shiftKey) { e.preventDefault(); vid.currentTime = Math.min(vid.duration || 0, vid.currentTime + 5); return; }
      if (e.key === 'f' || e.key === 'а') { e.preventDefault(); toggleFull(stage); return; }
    }
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); step(-1); return; }
    if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); step(1); return; }
    if (V.kind !== 'image') return;
    if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomCenter(V.s * 1.4); }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomCenter(V.s / 1.4); }
    else if (e.key === '0') { e.preventDefault(); fitImage(); }
    else if (e.key === '1') { e.preventDefault(); zoomCenter(1); }
  });
  dlg.addEventListener('close', () => {
    const vid = $('viewerVideo');
    vid.pause();
    vid.removeAttribute('src');
    vid.load();
    delete vid.dataset.fid; // видео выгружено — при следующем открытии загрузить заново
    V.mid = null;
    V.kind = '';
    delete img.dataset.full;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  });
  new ResizeObserver(() => { if (!V.w || V.kind !== 'image') return; if (V.mode === 'fit') fitImage(); else { clamp(); apply(); } }).observe(stage);
}

export const viewerMid = () => V.mid;

/** Фото и видео этого чата по порядку — чтобы листать стрелками. */
function gallery() {
  return (X.history() || []).filter((m) => m.file && !m.deleted && !m.file.voice && (
    (X.VIEWABLE.test(m.file.mime) && (m.file.thumb || X.available(m.file)))
    || (X.isVideo(m.file) && X.available(m.file))));
}

export function openMedia(m) {
  const dlg = $('viewer');
  V.list = gallery();
  V.idx = V.list.findIndex((x) => x.id === m.id);
  show(m);
  if (!dlg.open) dlg.showModal();
  dlg.focus();
}
function step(d) {
  if (V.idx < 0) return;
  const i = V.idx + d;
  if (i < 0 || i >= V.list.length) return;
  V.idx = i;
  show(V.list[i]);
}

function show(m) {
  const f = m.file;
  const img = $('viewerImg');
  const vid = $('viewerVideo');
  const video = X.isVideo(f);
  V.mid = m.id;
  V.kind = video ? 'video' : 'image';
  $('viewerName').textContent = f.name;
  $('viewer').dataset.kind = V.kind;
  $('viewerZoom').hidden = video;
  img.hidden = video;
  vid.hidden = !video;
  // Предыдущее видео — остановить.
  if (!video || vid.dataset.fid !== f.fid) { vid.pause(); vid.removeAttribute('src'); delete vid.dataset.fid; }
  if (video) {
    if (!V.bar) { V.bar = mediaBar(vid, { full: $('viewerStage') }); $('viewerControls').append(V.bar); }
    $('viewerControls').hidden = false;
  } else {
    $('viewerControls').hidden = true;
    img.removeAttribute('src');
    delete img.dataset.full;
    V.w = f.w || 0; V.h = f.h || 0;
    sizeImg();
    V.mode = 'fit';
    if (V.w) fitImage();
  }
  refreshMedia(m);
}

/** Сообщение обновилось (скачалось, сменилось состояние) — обновить окно, если оно показывает его. */
export function refreshMedia(m) {
  if (V.mid !== m.id) return;
  const f = m.file;
  const img = $('viewerImg');
  const vid = $('viewerVideo');
  const pos = V.list.length > 1 && V.idx >= 0 ? `${V.idx + 1} из ${V.list.length}` : '';
  $('viewerInfo').textContent = [X.fmtSize(f.size), f.w && f.h ? `${f.w}×${f.h}` : '', X.fileStateText(m), pos].filter(Boolean).join(' · ');
  $('viewerActions').replaceChildren(...X.fileActions(m, { inViewer: true }).filter(Boolean));
  $('viewerPrev').hidden = V.idx <= 0;
  $('viewerNext').hidden = V.idx < 0 || V.idx >= V.list.length - 1;
  if (V.kind === 'video') {
    $('viewerNote').hidden = true;
    if (!X.available(f)) { $('viewerNote').hidden = false; $('viewerNote').textContent = 'Видео ещё не скачано — нажмите «Скачать».'; return; }
    if (f.size > 64 * 1024 * 1024) { $('viewerNote').hidden = false; $('viewerNote').textContent = 'Видео больше 64 МБ — откройте его кнопкой «Открыть».'; return; }
    if (vid.dataset.fid === f.fid) return;
    vid.dataset.fid = f.fid;
    X.fullUrl(m).then((u) => {
      if (V.mid !== m.id) return;
      vid.src = u;
      vid.play().catch(() => {});
      // Кадр для карточки в переписке — чтобы было видно, что за видео.
      vid.addEventListener('timeupdate', function grab() {
        if (vid.currentTime < 0.3 || V.mid !== m.id) return;
        vid.removeEventListener('timeupdate', grab);
        X.savePoster?.(f.fid, vid);
      });
    }).catch((err) => X.toast(err.message, 'bad'));
    return;
  }
  $('viewerNote').hidden = true;
  if (f.thumb && !img.src) X.thumbUrl(f.fid).then((u) => { if (u && V.mid === m.id && !img.dataset.full) img.src = u; });
  if (X.available(f) && f.size <= 64 * 1024 * 1024 && img.dataset.full !== f.fid) {
    X.fullUrl(m).then((u) => { if (V.mid === m.id) { img.dataset.full = f.fid; img.src = u; } }).catch((err) => X.toast(err.message, 'bad'));
  }
}

// ---------- Масштаб ----------
function sizeImg() {
  const img = $('viewerImg');
  if (!V.w) { img.style.width = ''; img.style.height = ''; return; }
  img.style.width = `${V.w}px`;
  img.style.height = `${V.h}px`;
}
const pannable = () => V.w * V.s > $('viewerStage').clientWidth + 1 || V.h * V.s > $('viewerStage').clientHeight + 1;
function limits() { return { min: Math.min(V.fit, 1), max: Math.max(8, V.fit * 4) }; }
function fitImage() {
  const st = $('viewerStage');
  if (!V.w) return;
  V.fit = Math.min((st.clientWidth - PAD * 2) / V.w, (st.clientHeight - PAD * 2) / V.h, 1);
  if (!(V.fit > 0)) V.fit = 1;
  V.s = V.fit;
  V.mode = 'fit';
  V.x = (st.clientWidth - V.w * V.s) / 2;
  V.y = (st.clientHeight - V.h * V.s) / 2;
  apply();
}
function zoomAt(s, px, py) {
  if (!V.w) return;
  const { min, max } = limits();
  const ns = Math.max(min, Math.min(max, s));
  V.x = px - ((px - V.x) * ns) / V.s;
  V.y = py - ((py - V.y) * ns) / V.s;
  V.s = ns;
  V.mode = Math.abs(ns - V.fit) < 0.005 ? 'fit' : 'free';
  clamp();
  apply();
}
function zoomCenter(s) {
  const st = $('viewerStage');
  zoomAt(s, st.clientWidth / 2, st.clientHeight / 2);
}
function clamp() {
  const st = $('viewerStage');
  const w = V.w * V.s;
  const h = V.h * V.s;
  V.x = w <= st.clientWidth ? (st.clientWidth - w) / 2 : Math.min(0, Math.max(st.clientWidth - w, V.x));
  V.y = h <= st.clientHeight ? (st.clientHeight - h) / 2 : Math.min(0, Math.max(st.clientHeight - h, V.y));
}
function apply() {
  const img = $('viewerImg');
  img.style.transform = `translate(${V.x}px, ${V.y}px) scale(${V.s})`;
  $('vzPct').textContent = `${Math.round(V.s * 100)}%`;
  $('vzPct').title = V.mode === 'fit' ? 'Вписано в окно' : 'Вписать в окно (0)';
  $('viewerStage').classList.toggle('can-pan', pannable());
  const { min, max } = limits();
  $('vzOut').disabled = V.s <= min + 0.001;
  $('vzIn').disabled = V.s >= max - 0.001;
}
