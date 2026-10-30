// Видео-кружок: камера, обрезанная в квадрат 480×480, звук через тот же шумодав, что и голос.
// Записывается в WebM (VP9 + Opus) около 1 Мбит/с, до 60 секунд.

export const CIRCLE_MAX = 60;
// Та же камера, что выбрана в настройках для звонков.
function camDevice() {
  let id = 'default';
  try { id = localStorage.getItem('som.cam') || 'default'; } catch { /* по умолчанию */ }
  return id !== 'default' ? { deviceId: { ideal: id } } : {};
}
const SIDE = 480;

export function cameraError(err) {
  const name = err?.name || '';
  if (name === 'NotAllowedError') return 'Нет доступа к камере. Параметры Windows → Конфиденциальность → Камера: разрешите доступ приложениям для компьютеров.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'Камера не найдена.';
  if (name === 'NotReadableError') return 'Камера занята другой программой.';
  return `Камера не включилась: ${err?.message || err}`;
}

/**
 * Начать запись кружка. openMic — микрофон с шумодавом (может не открыться — тогда без звука).
 * Возвращает { preview, seconds, paused, pause(), resume(), stop() → {blob, dur, wave}, cancel(), full }.
 */
export async function startCircle(openMic, levelDb) {
  const cam = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30, max: 30 }, ...camDevice() },
    audio: false,
  });
  let mic = null;
  try { mic = await openMic(); } catch { mic = null; }
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = cam;
  await video.play().catch(() => {});
  const cv = document.createElement('canvas');
  cv.width = SIDE;
  cv.height = SIDE;
  const ctx = cv.getContext('2d');
  const out = cv.captureStream(30);
  const preview = new MediaStream(out.getVideoTracks());
  if (mic) out.addTrack(mic.track);
  const type = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t));
  const rec = new MediaRecorder(out, { mimeType: type, videoBitsPerSecond: 1_000_000, audioBitsPerSecond: 32000 });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const levels = [];
  const buf = new Float32Array(1024);
  let raf = 0;
  let done = false;
  let paused = false;
  let acc = 0; // секунды записи без пауз
  let since = performance.now();
  let resolveFull;
  const full = new Promise((r) => { resolveFull = r; });
  const draw = () => {
    if (done) return;
    const w = video.videoWidth;
    const hh = video.videoHeight;
    if (w && hh) {
      const s = Math.min(w, hh);
      ctx.drawImage(video, (w - s) / 2, (hh - s) / 2, s, s, 0, 0, SIDE, SIDE);
    }
    if (!paused) {
      if (mic) levels.push(levelDb(mic.analyser, buf));
      if (seconds() >= CIRCLE_MAX) resolveFull();
    }
    raf = requestAnimationFrame(draw);
  };
  const seconds = () => acc + (paused ? 0 : (performance.now() - since) / 1000);
  draw();
  rec.start(500);
  since = performance.now();
  const close = () => {
    done = true;
    cancelAnimationFrame(raf);
    for (const t of cam.getTracks()) t.stop();
    for (const t of out.getTracks()) t.stop();
    mic?.close();
  };
  return {
    preview,
    full,
    hasSound: Boolean(mic),
    note: mic ? mic.note : 'Микрофон не включился — кружок будет без звука.',
    get seconds() { return seconds(); },
    get paused() { return paused; },
    pause() { if (paused) return; acc = seconds(); paused = true; if (rec.state === 'recording') rec.pause(); },
    resume() { if (!paused) return; paused = false; since = performance.now(); if (rec.state === 'paused') rec.resume(); },
    stop() {
      const dur = seconds();
      return new Promise((resolve) => {
        rec.onstop = () => { close(); resolve({ blob: new Blob(chunks, { type: 'video/webm' }), dur, levels }); };
        if (rec.state !== 'inactive') rec.stop(); else rec.onstop();
      });
    },
    cancel() {
      rec.onstop = null;
      if (rec.state !== 'inactive') rec.stop();
      close();
    },
  };
}
