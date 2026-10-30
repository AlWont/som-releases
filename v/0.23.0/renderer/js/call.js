// Голосовой звонок один на один.
//
// Сигнализация (вызов, SDP, кандидаты ICE) идёт через ядро по уже открытому каналу Noise с другом:
// он подтверждён ключом друга, поэтому отпечатки DTLS внутри SDP подменить нельзя, и голос между
// вами шифрует DTLS-SRTP напрямую, без серверов. Radmin и домашняя сеть — прямая видимость,
// внешние STUN/TURN не нужны (и никто снаружи не узнаёт, что вы созвонились).
//
// Голос: микрофон → моно → срез гула 80 Гц → шумодав (RNNoise по умолчанию) → отправка.
// Эхоподавление и автоусиление — встроенные Chromium. Звук друга — через Web Audio с громкостью 0–200%.

import { RnnoiseWorkletNode, SpeexWorkletNode, loadRnnoise, loadSpeex } from '../vendor/nsx/index.js';
import { labRing } from './labsound.js';

const RING_TIMEOUT_MS = 45000;
const DROP_AFTER_MS = 25000;
// Файлы во время звонка: начинаем с 2 МБ/с и подстраиваемся — растёт задержка голоса, уменьшаем вдвое.
const BULK_START = 2_000_000;
const BULK_MIN = 64_000;
const BULK_MAX = 12_000_000;
const NS_MODES = ['rnnoise', 'speex', 'chromium', 'off'];

let X = null; // зависимости из app.js
let C = null; // текущий звонок
let GH = null; // групповой звонок (gcall.js): кнопки и панель общие
/** Групповой звонок подключает сюда свои обработчики: пока он идёт, общие кнопки управляют им. */
export function setGroupHooks(h) { GH = h; }
const groupOn = () => Boolean(GH?.active());
let pttDown = false;
let pttTimer = 0;
let recHold = false; // пишется голосовое — в звонок микрофон не идёт
const wasm = {};

// ---------- Настройки звука (на этом ПК) ----------
function pref(key, fallback) {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function setPref(key, value) {
  try { localStorage.setItem(key, value); } catch { /* без памяти — не страшно */ }
}
export const audioPrefs = {
  get mic() { return pref('som.mic', 'default'); },
  set mic(v) { setPref('som.mic', v); },
  get out() { return pref('som.out', 'default'); },
  set out(v) { setPref('som.out', v); },
  get ns() { const v = pref('som.ns', 'rnnoise'); return NS_MODES.includes(v) ? v : 'rnnoise'; },
  get ring() {
    // Один раз при обновлении: старый звонок по умолчанию («Капли») меняем на новый «8-бит».
    if (pref('som.ring.v2', '') !== '1') { setPref('som.ring.v2', '1'); if (pref('som.ring', 'drops') === 'drops') setPref('som.ring', 'chip'); }
    return pref('som.ring', 'chip');
  },
  set ring(v) { setPref('som.ring', v); },
  set ns(v) { setPref('som.ns', v); },
  get mode() { return pref('som.micmode', 'open') === 'ptt' ? 'ptt' : 'open'; },
  set mode(v) { setPref('som.micmode', v === 'ptt' ? 'ptt' : 'open'); },
  get pttKey() {
    try { const k = JSON.parse(pref('som.pttkey', '')); if (k?.code && k.vk) return k; } catch { /* по умолчанию */ }
    return { code: 'KeyV', vk: 0x56, label: 'V' };
  },
  set pttKey(k) { setPref('som.pttkey', JSON.stringify(k)); },
  vol(id) { const v = Number(pref(`som.vol.${id}`, 100)); return Number.isFinite(v) ? Math.min(200, Math.max(0, v)) : 100; },
  setVol(id, v) { setPref(`som.vol.${id}`, String(v)); },
};

const sink = (id) => (id && id !== 'default' ? id : '');

// ---------- Камера ----------
export const CAM_PRESETS = { '480p': { w: 640, h: 480, kbps: 800, label: '480p' }, '720p': { w: 1280, h: 720, kbps: 1800, label: '720p' } };
export const camPrefs = {
  get cam() { return pref('som.cam', 'default'); },
  set cam(v) { setPref('som.cam', v); },
  get quality() { return CAM_PRESETS[pref('som.cam.q', '720p')] ? pref('som.cam.q', '720p') : '720p'; },
  set quality(v) { setPref('som.cam.q', v); },
};
export function camConstraints(q = camPrefs.quality) {
  const p = CAM_PRESETS[q] || CAM_PRESETS['720p'];
  const id = camPrefs.cam;
  return { width: { ideal: p.w }, height: { ideal: p.h }, frameRate: { ideal: 30, max: 30 }, ...(id && id !== 'default' ? { deviceId: { exact: id } } : {}) };
}

// ---------- Демонстрация экрана: настройки ----------
export const SCREEN_PRESETS = {
  '720p30': { w: 1280, h: 720, fps: 30, kbps: 2500, label: '720p · 30' },
  '1080p30': { w: 1920, h: 1080, fps: 30, kbps: 5000, label: '1080p · 30' },
  '1080p60': { w: 1920, h: 1080, fps: 60, kbps: 8000, label: '1080p · 60' },
  '1440p60': { w: 2560, h: 1440, fps: 60, kbps: 14000, label: '1440p · 60' },
};
// Видеокарта обычно кодирует H.265 и H.264; VP9 и AV1 — процессором (замеры Som Lab).
export const VIDEO_PREF = ['video/H265', 'video/H264', 'video/VP9', 'video/AV1', 'video/VP8'];
export const screenPrefs = {
  get preset() { const v = pref('som.screen.preset', '1080p60'); return SCREEN_PRESETS[v] ? v : '1080p60'; },
  set preset(v) { setPref('som.screen.preset', v); },
  get audio() { return pref('som.screen.audio', '1') === '1'; },
  set audio(v) { setPref('som.screen.audio', v ? '1' : '0'); },
  get hint() { return pref('som.screen.hint', 'motion') === 'detail' ? 'detail' : 'motion'; },
  set hint(v) { setPref('som.screen.hint', v); },
  get autoWatch() { return pref('som.screen.autowatch', '0') === '1'; },
  set autoWatch(v) { setPref('som.screen.autowatch', v ? '1' : '0'); },
  vol(id) { const v = Number(pref(`som.svol.${id}`, 100)); return Number.isFinite(v) ? Math.min(200, Math.max(0, v)) : 100; },
  setVol(id, v) { setPref(`som.svol.${id}`, String(v)); },
};

export function micError(err) {
  const name = err?.name || '';
  if (name === 'NotAllowedError') return 'Нет доступа к микрофону. Параметры Windows → Конфиденциальность → Микрофон: разрешите доступ приложениям для компьютеров.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'Микрофон не найден. Подключите его или выберите другой в настройках.';
  if (name === 'NotReadableError') return 'Микрофон занят другой программой или драйвер не отвечает.';
  return `Микрофон не включился: ${err?.message || err}`;
}

// ---------- Микрофон с шумодавом ----------
async function nsNode(ctx, mode) {
  if (mode === 'rnnoise') {
    wasm.rnnoise ||= await loadRnnoise({ url: 'vendor/nsx/rnnoise.wasm', simdUrl: 'vendor/nsx/rnnoise_simd.wasm' });
    await ctx.audioWorklet.addModule('vendor/nsx/rnnoise/workletProcessor.js');
    return new RnnoiseWorkletNode(ctx, { maxChannels: 1, wasmBinary: wasm.rnnoise });
  }
  if (mode === 'speex') {
    wasm.speex ||= await loadSpeex({ url: 'vendor/nsx/speex.wasm' });
    await ctx.audioWorklet.addModule('vendor/nsx/speex/workletProcessor.js');
    return new SpeexWorkletNode(ctx, { maxChannels: 1, wasmBinary: wasm.speex });
  }
  return null;
}

function mono(ctx, interp) {
  const g = ctx.createGain();
  g.channelCount = 1;
  g.channelCountMode = 'explicit';
  g.channelInterpretation = interp;
  return g;
}

/** Микрофон, готовый к отправке. Возвращает { track, analyser, close(), note }.
 *  raw — ещё и отвод «как есть» для сравнения в настройках; в звонке он не нужен и только тратит процессор. */
export async function openMic({ raw = false } = {}) {
  const mode = audioPrefs.ns;
  const micId = audioPrefs.mic;
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: micId !== 'default' ? { ideal: micId } : undefined,
      echoCancellation: true,
      autoGainControl: true,
      noiseSuppression: mode === 'chromium',
      channelCount: 1,
      sampleRate: 48000,
    },
  });
  const ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
  const src = ctx.createMediaStreamSource(stream);
  const inMono = mono(ctx, 'speakers');
  src.connect(inMono);
  const hpf = ctx.createBiquadFilter();
  hpf.type = 'highpass';
  hpf.frequency.value = 80;
  inMono.connect(hpf);
  let head = hpf;
  let ns = null;
  let note = '';
  try {
    // Шумодав грузится доли секунды; если завис — звоним без него, чем не звоним вовсе.
    ns = await Promise.race([nsNode(ctx, mode), new Promise((_, rej) => setTimeout(() => rej(new Error('не загрузился за 5 с')), 5000))]);
    if (ns) {
      // Шумодав пишет только в первый канал — берём его и дальше считаем звук моно.
      ns.channelCount = 1;
      ns.channelCountMode = 'explicit';
      ns.channelInterpretation = 'speakers';
      head.connect(ns);
      const outMono = mono(ctx, 'discrete');
      ns.connect(outMono);
      head = outMono;
    }
  } catch (e) {
    note = `Шумодав не загрузился (${e.message}) — голос идёт без него.`;
  }
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  head.connect(analyser);
  // Отвод «как есть» (до среза гула и шумодава) — для сравнения в настройках.
  let rawAnalyser = null;
  let rawDest = null;
  if (raw) {
    rawAnalyser = ctx.createAnalyser();
    rawAnalyser.fftSize = 1024;
    inMono.connect(rawAnalyser);
    rawDest = ctx.createMediaStreamDestination();
    rawDest.channelCount = 1;
    inMono.connect(rawDest);
  }
  const dest = ctx.createMediaStreamDestination();
  dest.channelCount = 1;
  // Голос идёт через «заслонку» (микрофон выкл, push-to-talk отпущен), звуковая панель — мимо неё:
  // её слышат и тогда, когда ваш микрофон выключен.
  const voice = ctx.createGain();
  head.connect(voice);
  voice.connect(dest);
  const fx = ctx.createGain();
  fx.connect(dest);
  if (ctx.state !== 'running') await ctx.resume();
  const track = dest.stream.getAudioTracks()[0];
  return {
    track,
    ctx,
    fx,
    /** Открыть или закрыть голос (без щелчка). */
    setOpen(on) { voice.gain.setTargetAtTime(on ? 1 : 0, ctx.currentTime, 0.004); },
    analyser,
    rawAnalyser,
    rawStream: rawDest?.stream || null,
    stream: dest.stream,
    mode,
    nsActive: Boolean(ns),
    label: stream.getAudioTracks()[0]?.label || 'микрофон',
    settings: stream.getAudioTracks()[0]?.getSettings?.() || {},
    note,
    close() {
      try { ns?.destroy?.(); } catch { /* уже */ }
      for (const t of stream.getTracks()) t.stop();
      track.stop();
      for (const t of rawDest?.stream.getTracks() || []) t.stop();
      ctx.close().catch(() => {});
    },
  };
}

export const sinkFor = sink;

export function levelDb(analyser, buf) {
  analyser.getFloatTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i += 1) sum += buf[i] * buf[i];
  const rms = Math.sqrt(sum / buf.length);
  return rms > 0 ? 20 * Math.log10(rms) : -100;
}

// ---------- Мелодии ----------
// Всё синтезируется на лету (без звуковых файлов). Входящий звонок — на выбор в настройках
// (мелодии из «Лаборатории звуков»); исходящий — длинный гудок 425 Гц, как в телефонной сети.

// Мягкий синус с плавным входом и выходом.
function soft(ctx, out, t, f, len = 0.5, vel = 1) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.frequency.value = f;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vel, t + 0.03);
  g.gain.setValueAtTime(vel, t + len - 0.06);
  g.gain.linearRampToValueAtTime(0.0001, t + len);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + len + 0.05);
}

// Мелодии из «Лаборатории звуков», сделанные для Som.
const lab = (o) => ({ scale: 'major', root: 0, oct: 5, steps: 16, decay: 1, bright: 12000, echo: [0.18, 0.25, 0], space: 0, ...o });
export const RINGS = {
  chip: labRing('8-бит', lab({
    inst: 'chip', root: 4, step: 220, vol: 0.31, loop: 3, space: 0.04,
    notes: [[0, 81, 1, 0], [3, 81, 1, 0], [4, 85, 1, 0], [6, 81, 1, 0], [7, 87, 1, 0], [8, 88, 1, 0], [1, 83, 1, 0]],
  })),
  glass: labRing('Капель', lab({
    inst: 'glass', scale: 'penta', root: 2, step: 140, vol: 0.35, loop: 2.2, space: 0.3,
    notes: [[0, 86, 1, 0], [1, 81, 1, 1], [2, 78, 1, 1], [4, 83, 1, 1], [5, 74, 1, 0]],
  })),
};
export const ringId = () => (RINGS[audioPrefs.ring] ? audioPrefs.ring : 'chip');

export function startTone(kind, ringOverride) {
  const ctx = new AudioContext({ latencyHint: 'interactive' });
  if (typeof ctx.setSinkId === 'function') ctx.setSinkId(sink(audioPrefs.out)).catch(() => {});
  const master = ctx.createGain();
  master.connect(ctx.destination);
  const ring = kind === 'incoming'
    ? RINGS[ringOverride || ringId()]
    : { period: 5, level: 0.08, play: (c, out, t) => soft(c, out, t, 425, 1, 1) };
  master.gain.value = ring.level;
  let stopped = false;
  const schedule = () => { if (!stopped) ring.play(ctx, master, ctx.currentTime + 0.05); };
  schedule();
  const timer = setInterval(schedule, ring.period * 1000);
  return () => {
    stopped = true;
    clearInterval(timer);
    master.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
    setTimeout(() => ctx.close().catch(() => {}), 150);
  };
}

/** Прослушать мелодию в настройках: один-два повтора, потом тишина. Возвращает функцию «стоп». */
export function previewRing(id) {
  const stop = startTone('incoming', id);
  const t = setTimeout(stop, (RINGS[id]?.period || 3) * 2000 - 200);
  return () => { clearTimeout(t); stop(); };
}

// ---------- Сигналы ----------
function rid() {
  const b = crypto.getRandomValues(new Uint8Array(8));
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

async function signal(friend, data) {
  try {
    const r = await X.call('call_signal', { id: friend, data });
    return Boolean(r.sent);
  } catch { return false; }
}
const send = (data) => (C ? signal(C.friend, { ...data, callId: C.callId }) : Promise.resolve(false));

// ---------- Жизненный цикл ----------
export function initCall(deps) {
  X = deps;
  $('callBtn').addEventListener('click', () => { const f = X.currentFriend(); if (f) startCall(f.id); });
  $('callHangup').addEventListener('click', () => (groupOn() ? GH.action('leave') : hangup()));
  $('dockHangup').addEventListener('click', () => (groupOn() ? GH.action('leave') : hangup()));
  $('callMute').addEventListener('click', () => (groupOn() ? GH.action('mute') : setMuted(!C?.muted)));
  $('dockMute').addEventListener('click', () => (groupOn() ? GH.action('mute') : setMuted(!C?.muted)));
  $('callDeafen').addEventListener('click', () => (groupOn() ? GH.action('deafen') : setDeafened(!C?.deafened)));
  $('dockOpen').addEventListener('click', () => { if (groupOn()) GH.action('open'); else if (C) X.selectFriend(C.friend); });
  $('inAccept').addEventListener('click', () => accept());
  $('inDecline').addEventListener('click', () => decline());
  // Push-to-talk, пока окно Som в фокусе (в Windows клавишу слышит и ядро — даже поверх игры).
  const typing = (e) => /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || '') || e.target?.isContentEditable;
  const isKey = (e) => (C || groupOn()) && audioPrefs.mode === 'ptt' && e.code === audioPrefs.pttKey.code;
  window.addEventListener('keydown', (e) => { if (isKey(e) && !e.repeat && !typing(e)) setPtt(true); });
  window.addEventListener('keyup', (e) => { if (isKey(e)) setPtt(false); });
  const mouseKey = { 1: 'Mouse3', 3: 'Mouse4', 4: 'Mouse5' };
  window.addEventListener('mousedown', (e) => { if ((C || groupOn()) && audioPrefs.mode === 'ptt' && mouseKey[e.button] === audioPrefs.pttKey.code) setPtt(true); });
  window.addEventListener('mouseup', (e) => { if ((C || groupOn()) && audioPrefs.mode === 'ptt' && mouseKey[e.button] === audioPrefs.pttKey.code) setPtt(false); });
  window.addEventListener('blur', () => { if (window.som.platform !== 'win32') setPtt(false); });
  $('callScreen').addEventListener('click', () => { if (groupOn()) GH.action('screen'); else if (C?.screen) stopScreen(); else pickScreen(); });
  $('callCam').addEventListener('click', () => { if (groupOn()) GH.action('cam'); else if (C?.cam) stopCam(); else startCam(); });
  $('screenStop').addEventListener('click', (e) => { e.stopPropagation(); stopScreen(); });
  $('screenMineAudio').addEventListener('click', (e) => {
    e.stopPropagation();
    const a = C?.screen?.stream.getAudioTracks()[0];
    if (!a) return;
    a.enabled = !a.enabled;
    render();
  });
  $('screenWatch').addEventListener('click', (e) => { e.stopPropagation(); watchScreen(true); });
  $('screenUnwatch').addEventListener('click', (e) => { e.stopPropagation(); watchScreen(false); });
  $('screenFull').addEventListener('click', (e) => { e.stopPropagation(); toggleFull($('tilePeerScreen')); });
  // Щелчок по плитке — крупно (ещё щелчок — обратно), двойной — во весь экран.
  for (const id of ['tileMe', 'tilePeer', 'tilePeerScreen', 'tileMyScreen']) {
    const t = $(id);
    t.addEventListener('click', () => { if (!C) return; if (id === 'tilePeerScreen' && !C.watch) return; C.focus = C.focus === id ? null : id; render(); });
    t.addEventListener('dblclick', () => { if (id === 'tilePeerScreen' && !C?.watch) return; toggleFull(t); });
  }
  $('callExpand').addEventListener('click', () => setExpanded(!expanded));
  // Окно поменяло размер — пересчитываем плитки (не чаще раза за кадр).
  let laying = 0;
  const relayout = () => { if (!laying) laying = requestAnimationFrame(() => { laying = 0; layoutStage(); }); };
  new ResizeObserver(relayout).observe($('callPanel'));
  window.addEventListener('resize', relayout);
  $('callFull').addEventListener('click', () => toggleFull($('callPanel')));
  document.addEventListener('fullscreenchange', () => { if (C || groupOn()) render(); });
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || document.fullscreenElement || document.querySelector('dialog[open]')) return;
    if (groupOn()) GH.action('unfocus');
    else if (C?.focus) { C.focus = null; render(); }
  });
  window.addEventListener('beforeunload', () => { if (C) send({ kind: 'hangup' }); });
}

export const callState = () => C;
/** Микрофон текущего звонка (личного или группового) — для звуковой панели. */
export const activeMic = () => C?.mic || GH?.mic?.() || null;
export const pttIsDown = () => pttDown;
/** Пишется голосовое — микрофон в звонок не идёт. */
export const micHeld = () => recHold;
/** Громкость друга поменяли вне панели звонка — применяем сразу, если сейчас с ним разговор. */
export function applyVolumes(id) {
  GH?.volumes?.(id);
  if (!C || C.friend !== id) return;
  if (C.out && !C.deafened) C.out.gain.gain.value = audioPrefs.vol(id) / 100;
  if (C.sout && !C.deafened && C.watch) C.sout.gain.gain.value = screenPrefs.vol(id) / 100;
  render();
}

export async function startCall(friend) {
  const f = X.friendById(friend);
  if (!f || f.state !== 'friend') return;
  if (groupOn()) { X.toast('Сначала выйдите из группового звонка.', 'bad'); return; }
  if (C) { X.toast(C.friend === friend ? 'Звонок уже идёт.' : 'Сначала завершите текущий звонок.', 'bad'); return; }
  if (!f.online) { X.toast(`${f.name} не в сети — позвонить не получится.`, 'bad'); return; }
  C = newCall(friend, rid(), 'caller', 'outgoing');
  render();
  try {
    await attachMic();
  } catch (err) {
    end(micError(err), 'bad', false);
    return;
  }
  if (!C) return;
  if (!await send({ kind: 'ring' })) { end(`${f.name} не в сети.`, 'bad', false); return; }
  C.tone = startTone('outgoing');
  C.ringTimer = setTimeout(() => { send({ kind: 'cancel' }); end(`${f.name}: нет ответа.`); }, RING_TIMEOUT_MS);
  render();
}

function newCall(friend, callId, role, state) {
  return {
    friend, callId, role, state, polite: role === 'callee',
    pc: null, mic: null, out: null, player: null, pending: [], makingOffer: false, ignoreOffer: false,
    muted: false, deafened: false, peerMuted: false, startedAt: 0, lossAt: 0, stats: null, code: '',
    screen: null, peerScreen: null, sout: null, screenTrack: null,
    // Смотрю ли я демку друга (без «Смотреть» картинка не идёт), какая плитка развёрнута, миниатюра эфира.
    watch: false, focus: null, peerThumb: null,
    tone: null, ringTimer: 0, tick: 0, levels: { me: -100, peer: -100 },
    // Для отчёта: замеры качества за весь звонок.
    log: { created: Date.now(), acceptedAt: 0, connectMs: null, rtts: [], jitters: [], path: '', codec: '', last: null, endedBy: '' },
  };
}

async function attachMic() {
  const mic = await openMic();
  if (!C) { mic.close(); return; }
  C.mic = mic;
  gate();
  armPtt();
  if (mic.note) X.toast(mic.note, 'bad');
}

async function accept() {
  if (!C || C.state !== 'incoming') return;
  stopRinging();
  C.state = 'connecting';
  render();
  try {
    await attachMic();
  } catch (err) {
    X.toast(micError(err), 'bad');
    send({ kind: 'decline', reason: 'mic' });
    end('', '', false);
    return;
  }
  if (!C) return;
  C.log.acceptedAt = Date.now();
  createPeer();
  await send({ kind: 'accept' });
  X.selectFriend(C.friend);
}

function decline() {
  if (!C || C.state !== 'incoming') return;
  send({ kind: 'decline' });
  end('', '', false);
}

export function hangup() {
  if (!C) return;
  C.log.endedBy = 'я';
  send({ kind: C.state === 'outgoing' ? 'cancel' : 'hangup' });
  end('Звонок завершён.');
}

function stopRinging() {
  if (!C) return;
  clearTimeout(C.ringTimer);
  C.ringTimer = 0;
  if (C.tone) { C.tone(); C.tone = null; }
  window.som.attention(false);
}

/** Завершить звонок у себя. text — что сказать, kind — оттенок уведомления. */
function end(text, kind = '', withDuration = true) {
  if (!C) return;
  const c = C;
  C = null;
  clearTimeout(c.ringTimer);
  clearInterval(c.tick);
  if (c.tone) c.tone();
  window.som.attention(false);
  if (c.pc) { try { c.pc.close(); } catch { /* уже */ } }
  c.mic?.close();
  if (c.screen) for (const t of c.screen.stream.getTracks()) t.stop();
  if (c.cam) for (const t of c.cam.stream.getTracks()) t.stop();
  $('callMeVideo').srcObject = null;
  $('callPeerVideo').srcObject = null;
  if (c.sout) { c.sout.player.srcObject = null; c.sout.src.disconnect(); }
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  $('screenVideo').srcObject = null;
  $('screenMineVideo').srcObject = null;
  $('screenThumb').removeAttribute('src');
  if (c.screen) clearInterval(c.screen.thumbTimer);
  setExpanded(false);
  if (c.player) { c.player.pause(); c.player.srcObject = null; }
  c.out?.ctx.close().catch(() => {});
  if (c.sentRate) X.call('bulk_rate', { rate: 0 }).catch(() => {});
  if (audioPrefs.mode === 'ptt') X.call('ptt', { vk: 0 }).catch(() => {});
  pttDown = false;
  if (c.startedAt) X.sound?.('leave');
  render();
  const dur = withDuration && c.startedAt ? ` Длительность ${fmtDur(Date.now() - c.startedAt)}.` : '';
  if (text) X.toast(`${text}${dur}`, kind);
  try { X.onCallEnd?.(callSummary(c, text)); } catch { /* отчёт не должен ломать звонок */ }
}

function callSummary(c, text) {
  const L = c.log;
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const last = L.last || {};
  const durS = c.startedAt ? (Date.now() - c.startedAt) / 1000 : 0;
  const recv = last.packetsReceived || 0;
  const lost = Math.max(0, last.packetsLost || 0);
  const samples = last.totalSamplesReceived || 0;
  const concealed = Math.max(0, (last.concealedSamples || 0) - (last.silentConcealedSamples || 0));
  return {
    at: L.created,
    friend: X.friendById(c.friend)?.name || 'друг',
    role: c.role === 'caller' ? 'исходящий' : 'входящий',
    connected: Boolean(c.startedAt),
    durS: Math.round(durS),
    connectMs: L.connectMs,
    result: text || (c.startedAt ? 'завершён' : 'не состоялся'),
    endedBy: L.endedBy,
    rttAvg: avg(L.rtts), rttMax: L.rtts.length ? Math.max(...L.rtts) : null,
    jitterAvg: avg(L.jitters),
    lossPct: recv + lost > 0 ? (lost / (recv + lost)) * 100 : null,
    concealedPct: samples > 0 ? (concealed / samples) * 100 : null,
    kbpsIn: durS > 2 && last.bytesReceived ? (last.bytesReceived * 8) / durS / 1000 : null,
    kbpsOut: durS > 2 && last.bytesSent ? (last.bytesSent * 8) / durS / 1000 : null,
    codec: L.codec, path: L.path,
    mic: c.mic?.label || L.micLabel || '',
    micSettings: L.micSettings || c.mic?.settings || null,
    ns: audioPrefs.ns, nsActive: L.nsActive ?? c.mic?.nsActive ?? null,
    restarts: L.restarts || 0, slowed: L.slowed || 0, rateEnd: c.bulkRate || null,
  };
}

// ---------- Входящие сигналы ----------
export async function onSignal(friend, data) {
  const kind = data?.kind;
  if (kind === 'ring') {
    if (C) {
      // Уже звоним этому же другу — встречный вызов: побеждает меньший id, второй становится принимающим.
      if (C.friend === friend && C.state === 'outgoing' && data.callId < C.callId) {
        const mic = C.mic;
        C.mic = null;
        stopRinging();
        C = newCall(friend, data.callId, 'callee', 'connecting');
        C.mic = mic;
        gate();
        createPeer();
        await send({ kind: 'accept' });
        render();
        return;
      }
      if (!(C.friend === friend && C.callId === data.callId)) signal(friend, { kind: 'busy', callId: data.callId });
      return;
    }
    // Идёт групповой звонок — для личного «занято».
    if (groupOn()) { signal(friend, { kind: 'busy', callId: data.callId }); return; }
    const f = X.friendById(friend);
    if (!f || typeof data.callId !== 'string') return;
    C = newCall(friend, data.callId, 'callee', 'incoming');
    // «Не беспокоить»: карточка звонка появится, но без мелодии и мигания.
    const quiet = X.me()?.effective === 'dnd';
    if (!quiet) { C.tone = startTone('incoming'); window.som.attention(true); X.onIncoming?.(f); }
    C.ringTimer = setTimeout(() => { end(`Пропущенный звонок от ${f.name}.`, '', false); }, RING_TIMEOUT_MS + 2000);
    send({ kind: 'ringing' });
    render();
    return;
  }
  if (!C || C.friend !== friend || data.callId !== C.callId) return;
  const name = X.friendById(friend)?.name || 'Друг';
  switch (kind) {
    case 'ringing': C.peerRinging = true; render(); break;
    case 'accept':
      if (C.state !== 'outgoing') break;
      stopRinging();
      C.state = 'connecting';
      C.log.acceptedAt = Date.now();
      createPeer();
      C.pc.addTrack(C.mic.track);
      render();
      break;
    case 'decline': end(data.reason === 'mic' ? `${name}: не включился микрофон, звонок отклонён.` : `${name}: звонок отклонён.`, '', false); break;
    case 'busy': end(`${name} сейчас в другом звонке.`, '', false); break;
    case 'cancel': end(C.state === 'incoming' ? `Пропущенный звонок от ${name}.` : '', '', false); break;
    case 'hangup': end(`${name}: звонок завершён.`); break;
    case 'state': C.peerMuted = Boolean(data.muted); C.peerDeafened = Boolean(data.deafened); render(); break;
    case 'screen':
      if (data.on) {
        C.peerScreen = { sid: String(data.sid || ''), name: String(data.name || '').slice(0, 120), audio: Boolean(data.audio) };
        C.watch = false;
        C.peerThumb = null;
        X.sound?.('streamOn');
        // Кто хочет сразу смотреть демки — включаем сами.
        if (screenPrefs.autoWatch) setTimeout(() => { if (C?.peerScreen && !C.watch) watchScreen(true); }, 300);
      } else {
        if (C.peerScreen) X.sound?.('streamOff');
        C.peerScreen = null;
        C.screenTrack = null;
        C.watch = false;
        C.peerThumb = null;
        C.vin = null;
        if (C.focus === 'tilePeerScreen') C.focus = null;
        if (C.sout) { C.sout.player.srcObject = null; C.sout.src.disconnect(); C.sout = null; }
        if (document.fullscreenElement === $('tilePeerScreen')) document.exitFullscreen().catch(() => {});
        $('screenVideo').srcObject = null;
      }
      render();
      break;
    case 'watch':
      // Друг нажал «Смотреть» или перестал смотреть — включаем или выключаем передачу картинки и звука демки.
      if (C.screen) {
        C.screen.watched = Boolean(data.on);
        applySenderParams(C);
        if (!C.screen.watched) setTimeout(() => sendThumb(C), 300);
        render();
      }
      break;
    case 'thumb':
      if (C.peerScreen && typeof data.d === 'string' && data.d.length < 60000 && /^[A-Za-z0-9+/=]+$/.test(data.d)) { C.peerThumb = data.d; render(); }
      break;
    case 'cam':
      if (data.on) C.peerCam = { sid: String(data.sid || '') };
      else { C.peerCam = null; C.camTrack = null; $('callPeerVideo').srcObject = null; }
      render();
      break;
    case 'sdp': await onDescription(data.description); break;
    case 'ice': await onCandidate(data.candidate); break;
    default: X.onData?.(friend, data); // радио вместе и прочее поверх звонка
  }
}
/** Своё поверх звонка (радио вместе): только когда разговор уже идёт. */
export function sendCallData(data) {
  if (!C || C.state !== 'active') return Promise.resolve(false);
  return send(data);
}

export function onPresence(friend, online) {
  if (!C || C.friend !== friend || online) return;
  // Пока звонок не соединился, без канала до друга продолжать нечего. Идущий разговор WebRTC держит сам.
  if (C.state === 'outgoing' || C.state === 'incoming') end(`${X.friendById(friend)?.name || 'Друг'}: нет связи, звонок прерван.`, 'bad', false);
}

// ---------- WebRTC ----------
function createPeer() {
  const pc = new RTCPeerConnection({ iceServers: [], bundlePolicy: 'max-bundle', rtcpMuxPolicy: 'require' });
  C.pc = pc;
  const c = C;
  pc.onnegotiationneeded = async () => {
    try {
      c.makingOffer = true;
      const offer = await pc.createOffer();
      if (pc.signalingState !== 'stable') return;
      await pc.setLocalDescription({ type: 'offer', sdp: tuneOpus(offer.sdp) });
      signal(c.friend, { kind: 'sdp', callId: c.callId, description: pc.localDescription.toJSON() });
    } catch (e) {
      X.toast(`Звонок: ошибка согласования (${e.message})`, 'bad');
    } finally {
      c.makingOffer = false;
    }
  };
  pc.onicecandidate = ({ candidate }) => { if (candidate) signal(c.friend, { kind: 'ice', callId: c.callId, candidate: candidate.toJSON() }); };
  pc.onconnectionstatechange = () => {
    if (C !== c) return;
    const st = pc.connectionState;
    if (st === 'connected') {
      c.lossAt = 0;
      if (c.state !== 'active') {
        c.state = 'active';
        c.startedAt = Date.now();
        setTimeout(() => X.onPeerJoin?.(c.friend), 0);
        if (c.log.acceptedAt) c.log.connectMs = c.startedAt - c.log.acceptedAt;
        clearInterval(c.tick);
        c.tick = setInterval(onTick, 250);
        makeCode();
        X.sound?.('join');
        c.bulkRate = BULK_START;
        c.sentRate = BULK_START;
        X.call('bulk_rate', { rate: BULK_START }).catch(() => {});
      }
    } else if (st === 'disconnected') {
      // Короткий обрыв часто проходит сам; если нет — через 3 с перезапускаем поиск пути (ICE restart).
      c.lossAt ||= Date.now();
      const at = c.lossAt;
      setTimeout(() => { if (C === c && c.lossAt === at && pc.connectionState !== 'connected') restartIce(c); }, 3000);
    } else if (st === 'failed') {
      if (!c.startedAt) {
        end('Не удалось соединиться напрямую. Обычно мешает брандмауэр Windows: разрешите Som в частных и общественных сетях у обоих.', 'bad');
        return;
      }
      // Разговор уже шёл — значит, брандмауэр ни при чём: сеть мигнула. Пробуем восстановить.
      c.lossAt ||= Date.now();
      restartIce(c);
    }
    render();
  };
  pc.oniceconnectionstatechange = () => { if (C === c && pc.iceConnectionState === 'connected') c.lossAt = 0; };
  pc.ontrack = (e) => {
    if (C !== c) return;
    const sid = e.streams[0]?.id;
    if (e.track.kind === 'video') {
      if (c.peerCam && sid && sid === c.peerCam.sid) showPeerCam(e.track); else showPeerScreen(e.track);
      return;
    }
    // Звук демки — отдельная дорожка в потоке экрана; голос — первая звуковая дорожка.
    if ((c.peerScreen && sid && sid === c.peerScreen.sid) || c.out) playScreenAudio(e.track);
    else playRemote(e.track);
  };
  // Если соединение не поднялось за 20 секунд — сдаёмся.
  setTimeout(() => { if (C === c && c.state === 'connecting') end('Соединение не установилось за 20 секунд. Проверьте брандмауэр Windows у обоих.', 'bad', false); }, 20000);
}

// Скорость отдачи файлов, пока идёт звонок: задержка выросла на 80+ мс от лучшей — режем вдвое, иначе понемногу прибавляем.
function pace(c, rttMs) {
  c.baseRtt = Math.min(c.baseRtt ?? rttMs, rttMs);
  const congested = rttMs > c.baseRtt + 80 || (c.stats?.loss ?? 0) > 0.03;
  const old = c.bulkRate || BULK_START;
  const next = congested ? Math.max(BULK_MIN, old / 2) : Math.min(BULK_MAX, old * 1.25);
  c.bulkRate = next;
  if (Math.abs(next - (c.sentRate || 0)) / next > 0.1) {
    c.sentRate = next;
    X.call('bulk_rate', { rate: Math.round(next) }).catch(() => {});
  }
  if (congested) c.log.slowed = (c.log.slowed || 0) + 1;
}

function restartIce(c) {
  if (C !== c || !c.pc || c.restarts >= 5) return;
  c.restarts = (c.restarts || 0) + 1;
  c.log.restarts = c.restarts;
  try { c.pc.restartIce(); } catch { /* старый Chromium — дождёмся сам */ }
  render();
}

// Opus: первая звуковая дорожка — голос (64 кбит/с, моно, защита от потерь);
// следующие — звук демки (128 кбит/с, стерео).
export function tuneOpus(sdp) {
  let audioN = 0;
  return sdp.split(/\r\n(?=m=)/).map((sec) => {
    if (sec.startsWith('m=video')) {
      // Демка: сразу с 2,5 Мбит/с, а не с 0,3 — иначе первые секунды картинка мыльная.
      return sec.split('\r\n').map((l) => (/^a=fmtp:\d+ /.test(l) && !/apt=/.test(l) && !l.includes('x-google-start-bitrate') ? `${l};x-google-start-bitrate=2500` : l)).join('\r\n');
    }
    if (!sec.startsWith('m=audio')) return sec;
    const music = audioN++ > 0;
    const lines = sec.split('\r\n');
    const pt = lines.map((l) => /^a=rtpmap:(\d+) opus\//i.exec(l)).find(Boolean)?.[1];
    if (!pt) return sec;
    return lines.map((l) => {
      if (!l.startsWith(`a=fmtp:${pt} `)) return l;
      const params = new Map(l.slice(`a=fmtp:${pt} `.length).split(';').map((kv) => kv.split('=')));
      params.set('useinbandfec', '1');
      params.set('maxaveragebitrate', music ? '128000' : '64000');
      params.set('stereo', music ? '1' : '0');
      if (music) params.set('sprop-stereo', '1');
      return `a=fmtp:${pt} ${[...params].map(([k, v]) => `${k}=${v}`).join(';')}`;
    }).join('\r\n');
  }).join('\r\n');
}

async function onDescription(d) {
  const c = C;
  const pc = c?.pc;
  if (!pc || !d) return;
  try {
    const collision = d.type === 'offer' && (c.makingOffer || pc.signalingState !== 'stable');
    c.ignoreOffer = !c.polite && collision;
    if (c.ignoreOffer) return;
    await pc.setRemoteDescription(d);
    for (const cand of c.pending.splice(0)) await pc.addIceCandidate(cand).catch(() => {});
    if (d.type === 'answer') applySenderParams(c);
    if (d.type === 'offer') {
      // Свой голос кладём в ту же дорожку, что предложил друг, — без повторного согласования.
      const tr = pc.getTransceivers().find((t) => t.receiver.track?.kind === 'audio');
      if (tr && c.mic && !tr.sender.track) {
        tr.direction = 'sendrecv';
        await tr.sender.replaceTrack(c.mic.track);
      }
      const answer = await pc.createAnswer();
      await pc.setLocalDescription({ type: 'answer', sdp: tuneOpus(answer.sdp) });
      signal(c.friend, { kind: 'sdp', callId: c.callId, description: pc.localDescription.toJSON() });
    }
  } catch (e) {
    X.toast(`Звонок: ошибка сигнализации (${e.message})`, 'bad');
  }
}

async function onCandidate(cand) {
  const c = C;
  if (!c?.pc || !cand) return;
  if (!c.pc.remoteDescription) { c.pending.push(cand); return; }
  try { await c.pc.addIceCandidate(cand); } catch (e) { if (!c.ignoreOffer) console.warn('ice', e.message); }
}

function playRemote(track) {
  const c = C;
  if (c.out) return;
  // Chromium отдаёт звук WebRTC в Web Audio, только если дорожку «проигрывает» элемент (без звука).
  const player = new Audio();
  player.muted = true;
  player.srcObject = new MediaStream([track]);
  player.play().catch(() => {});
  c.player = player;
  const ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
  if (typeof ctx.setSinkId === 'function') ctx.setSinkId(sink(audioPrefs.out)).catch(() => {});
  const src = ctx.createMediaStreamSource(new MediaStream([track]));
  const gain = ctx.createGain();
  gain.gain.value = c.deafened ? 0 : audioPrefs.vol(c.friend) / 100;
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  src.connect(analyser);
  src.connect(gain);
  gain.connect(ctx.destination);
  if (ctx.state !== 'running') ctx.resume();
  c.out = { ctx, gain, analyser };
}

// ---------- Демонстрация экрана ----------
function showPeerScreen(track) {
  const c = C;
  c.screenTrack = track;
  const v = $('screenVideo');
  v.srcObject = new MediaStream([track]);
  v.play().catch(() => {});
  track.onended = () => { if (C === c && c.screenTrack === track) { c.screenTrack = null; render(); } };
  // Картинка появляется только после «Смотреть»: прячем «Подключаюсь…», как только пришёл кадр.
  v.onresize = () => render();
  v.onloadeddata = () => render();
  track.onunmute = () => render();
  render();
}

function playScreenAudio(track) {
  const c = C;
  if (!c.out) { playRemote(track); return; }
  if (c.sout) { c.sout.player.srcObject = null; c.sout.src.disconnect(); }
  const player = new Audio();
  player.muted = true;
  player.srcObject = new MediaStream([track]);
  player.play().catch(() => {});
  const ctx = c.out.ctx;
  const src = ctx.createMediaStreamSource(new MediaStream([track]));
  const gain = ctx.createGain();
  gain.gain.value = c.deafened || !c.watch ? 0 : screenPrefs.vol(c.friend) / 100;
  src.connect(gain);
  gain.connect(ctx.destination);
  c.sout = { player, src, gain };
}

/** Окно выбора: что показывать, качество, звук. Возвращает выбор или null. */
export async function openScreenPicker() {
  const sources = await window.som.screenSources().catch(() => []);
  const el = (tag, props = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) e.append(kid);
    return e;
  };
  let chosen = sources[0]?.id || '';
  const tiles = sources.map((x) => {
    const b = el('button', { type: 'button', class: 'src', 'aria-pressed': String(x.id === chosen), title: x.name, onclick: () => { chosen = x.id; tiles.forEach((t) => t.setAttribute('aria-pressed', String(t === b))); }, ondblclick: () => go() },
      x.thumb ? el('img', { class: 'thumb', alt: '', src: x.thumb }) : el('div', { class: 'thumb' }),
      el('div', { class: 'src-name' }, x.icon ? el('img', { alt: '', src: x.icon }) : null, el('span', { text: x.name })));
    b.dataset.id = x.id;
    return b;
  });
  const screens = tiles.filter((_, i) => sources[i].screen);
  const windows = tiles.filter((_, i) => !sources[i].screen);
  const seg = (items, cur, onPick) => {
    const box = el('div', { class: 'seg', role: 'group' });
    for (const [k, label] of items) {
      box.append(el('button', { type: 'button', 'aria-pressed': String(k === cur), text: label, onclick: (e) => { for (const b of box.children) b.setAttribute('aria-pressed', String(b === e.currentTarget)); onPick(k); } }));
    }
    return box;
  };
  let preset = screenPrefs.preset;
  let hint = screenPrefs.hint;
  const win = window.som.platform === 'win32';
  const audioBox = el('input', { type: 'checkbox' });
  audioBox.checked = win && screenPrefs.audio;
  audioBox.disabled = !win;
  const film = el('div', { class: 'film-pick' },
    el('button', {
      type: 'button', class: 'btn', text: '🎬 Своё видео с компьютера…',
      onclick: async () => {
        const f = await pickVideoFile();
        if (f) done({ file: f, name: `🎬 ${f.name.replace(/\.[a-z0-9]{2,5}$/i, '')}`.slice(0, 120), preset, hint: 'film', audio: true });
      },
    }),
    el('span', { class: 'hint', text: 'Фильм или ролик — смотрите вместе: пауза и перемотка у вас, друзья видят и слышат то же.' }));
  const dlg = el('dialog', { class: 'screen-dlg', 'aria-label': 'Показать экран' },
    el('h2', { text: 'Показать экран' }),
    el('p', { class: 'hint', text: 'Картинка идёт другу напрямую и шифруется так же, как голос.' }),
    film,
    sources.length ? el('div', { class: 'src-grid' },
      screens.length ? el('div', { class: 'src-group', text: 'Экраны' }) : null, ...screens,
      windows.length ? el('div', { class: 'src-group', text: 'Окна' }) : null, ...windows)
      : el('p', { class: 'hint', text: 'Экраны и окна сейчас недоступны: Windows не отдала их список. Своё видео показать можно.' }),
    el('div', { class: 'screen-opts' },
      el('div', { class: 'field' }, el('span', { text: 'Качество' }), seg(Object.entries(SCREEN_PRESETS).map(([k, p]) => [k, `${p.label} к/с`]), preset, (k) => { preset = k; }),
        el('small', { class: 'hint', text: 'Разрешение держится, как выбрано. Не хватает интернета или процессора — становится меньше кадров в секунду, а не меньше картинка. Окно идёт в своём размере, но не больше выбранного.' })),
      el('div', { class: 'field' }, el('span', { text: 'Что показываете' }), seg([['motion', 'Игру или видео — плавно'], ['detail', 'Текст или код — чётко']], hint, (k) => { hint = k; })),
      el('label', { class: 'check' }, audioBox, el('span', { text: win ? 'Со звуком компьютера (голос друга в него не попадёт)' : 'Звук компьютера передаётся только в Windows' }))),
    el('div', { class: 'dlg-actions' },
      el('button', { type: 'button', class: 'btn', text: 'Отмена', onclick: () => done(null) }),
      el('button', { type: 'button', class: 'btn primary', text: 'Показать', disabled: !sources.length, onclick: () => go() })));
  // Сетка: подписи групп на всю ширину.
  for (const g of dlg.querySelectorAll('.src-group')) g.style.gridColumn = '1 / -1';
  document.body.append(dlg);
  let resolve;
  const result = new Promise((r) => { resolve = r; });
  function done(v) { try { dlg.close(); } catch { /* уже */ } dlg.remove(); resolve(v); }
  function go() {
    if (!chosen) return;
    screenPrefs.preset = preset;
    screenPrefs.hint = hint;
    if (win) screenPrefs.audio = audioBox.checked;
    const src = sources.find((x) => x.id === chosen);
    done({ sourceId: chosen, name: src?.name || 'экран', preset, hint, audio: win && audioBox.checked });
  }
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); done(null); });
  dlg.showModal();
  tiles.find((t) => t.dataset.id === chosen)?.focus();
  return result;
}

async function pickScreen() {
  if (!C || C.state !== 'active' || C.screen) return;
  const choice = await openScreenPicker();
  if (choice) await startScreen(choice);
}

// ---------- Своё видео вместе ----------
// Плеер работает на этом ПК, друзьям уходит его картинка и звук тем же путём, что и демка.
// Звук, который уходит друзьям, не зависит от громкости плеера: её можно крутить только себе.
function filmVol() { try { const v = Number(localStorage.getItem('som.film.vol')); return v >= 0 && v <= 1 && localStorage.getItem('som.film.vol') !== null ? v : 1; } catch { return 1; } }
function pickVideoFile() {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'video/*,.mkv,.mov,.m4v,.webm';
    // Поле — в документе, пока открыто окно выбора: иначе сборщик мусора может забрать его раньше ответа.
    inp.hidden = true;
    document.body.append(inp);
    const fin = (f) => { inp.remove(); resolve(f); };
    inp.addEventListener('change', () => fin(inp.files?.[0] || null), { once: true });
    inp.addEventListener('cancel', () => fin(null), { once: true });
    inp.click();
  });
}
async function captureFile(file) {
  const url = URL.createObjectURL(file);
  const v = document.createElement('video');
  v.className = 'tile-video file-player';
  v.controls = true;
  v.playsInline = true;
  v.preload = 'auto';
  v.disablePictureInPicture = true;
  v.setAttribute('controlslist', 'nodownload noremoteplayback');
  v.volume = filmVol();
  v.src = url;
  try {
    await new Promise((res, rej) => {
      v.addEventListener('loadedmetadata', res, { once: true });
      v.addEventListener('error', () => rej(new Error('format')), { once: true });
      setTimeout(() => rej(new Error('timeout')), 20000);
    });
    if (!v.videoWidth) throw new Error('novideo');
    await v.play();
    const stream = v.captureStream();
    for (let i = 0; i < 60 && !stream.getVideoTracks().length; i += 1) await new Promise((r) => setTimeout(r, 50));
    if (!stream.getVideoTracks().length) throw new Error('codec');
    v.addEventListener('volumechange', () => { try { localStorage.setItem('som.film.vol', String(v.volume)); } catch { /* не страшно */ } });
    // Щелчки по кнопкам плеера не должны разворачивать плитку.
    for (const ev of ['click', 'dblclick']) v.addEventListener(ev, (e) => e.stopPropagation());
    stream.player = { el: v, url };
    return stream;
  } catch (e) {
    v.removeAttribute('src');
    v.load();
    URL.revokeObjectURL(url);
    X.toast(e.message === 'novideo' ? 'В этом файле нет видео — только звук.'
      : e.message === 'codec' ? 'Звук у этого видео есть, а картинку Som показать не может: скорее всего, оно сжато H.265 (HEVC), а видеокарта его не разбирает. Пересохраните в MP4 (H.264).'
        : 'Это видео Som не открыл. Подойдут MP4, MKV и WebM с H.264, VP9 или AV1; AVI и старые форматы лучше пересохранить в MP4.', 'bad');
    X.diagError?.(`своё видео: ${e.message} · ${file.type || '?'} · ${Math.round(file.size / 1048576)} МБ`);
    return null;
  }
}
/** Убрать плеер своего видео (показ закончился). */
export function dropFilm(stream) {
  const p = stream?.player;
  if (!p) return;
  p.el.pause();
  p.el.remove();
  p.el.removeAttribute('src');
  p.el.load();
  URL.revokeObjectURL(p.url);
}

/** Захватить экран или окно (с причиной ошибки и запасным вариантом без звука). null — не вышло. */
export async function captureScreen({ sourceId, name, preset, audio, file }) {
  if (file) return captureFile(file);
  const p = SCREEN_PRESETS[preset] || SCREEN_PRESETS['1080p60'];
  let stream;
  const capture = async (withAudio) => {
    await window.som.screenPrepare({ sourceId, audio: withAudio, name });
    return navigator.mediaDevices.getDisplayMedia({
      video: { width: { ideal: p.w, max: p.w }, height: { ideal: p.h, max: p.h }, frameRate: { ideal: p.fps, max: p.fps } },
      audio: withAudio ? { restrictOwnAudio: true, suppressLocalAudioPlayback: false, echoCancellation: false, noiseSuppression: false, autoGainControl: false } : false,
    });
  };
  const why = () => (window.som.screenError ? window.som.screenError().catch(() => null) : Promise.resolve(null));
  const fail = (e, w) => {
    const what = sourceId.startsWith('screen:') ? 'экран' : `окно «${name}»`;
    const text = w?.reason === 'gone' ? `не нашёл ${what} — окно свёрнуто или закрыто. Разверните его или покажите весь экран.`
      : w?.reason === 'error' ? `Windows не дала захватить ${what}: ${w.detail}`
      : e?.name === 'NotAllowedError' ? `Windows не дала захватить ${what}. Если это игра с античитом или защищённое окно — попробуйте «Весь экран».`
      : e?.name === 'NotReadableError' ? 'захват экрана сейчас недоступен (занят другой программой или видеодрайвером). Попробуйте ещё раз.'
      : e?.message || String(e);
    X.toast(`Экран не показался: ${text}`, 'bad');
    X.diagError?.(`демка: ${e?.name || ''} ${e?.message || ''} | главный процесс: ${w ? `${w.reason} ${w.detail || ''}` : 'выдал источник'} | ${sourceId} «${name}» | звук ${audio ? 'да' : 'нет'} | ${p.label}`);
    return null;
  };
  try {
    stream = await capture(audio);
  } catch (e1) {
    const w1 = await why();
    // Чаще всего мешает захват звука компьютера — пробуем без него, чтобы картинка всё равно пошла.
    if (!audio || w1) return fail(e1, w1);
    try {
      stream = await capture(false);
      X.toast('Экран показывается без звука компьютера: Windows не дала захватить звук.', 'bad');
      X.diagError?.(`демка: звук не захватился (${e1?.name || ''} ${e1?.message || ''}), показ без звука`);
    } catch (e2) { return fail(e2, await why()); }
  }
  return stream;
}

export async function startScreen({ sourceId, name, preset, hint, audio, file }) {
  const c = C;
  if (!c || c.state !== 'active' || c.screen) return false;
  const p = SCREEN_PRESETS[preset] || SCREEN_PRESETS['1080p60'];
  const stream = await captureScreen({ sourceId, name, preset, audio, file });
  if (!stream) return false;
  if (C !== c) { stream.getTracks().forEach((t) => t.stop()); dropFilm(stream); return false; }
  const v = stream.getVideoTracks()[0];
  try { v.contentHint = hint === 'detail' ? 'detail' : 'motion'; } catch { /* не важно */ }
  c.screen = { stream, senders: [], preset: p, hint, name, watched: false, thumbTimer: 0 };
  setCaptureRate(stream, p, false);
  // Сначала говорим другу, какой поток — экран, потом добавляем дорожки (сигналы идут по порядку).
  await send({ kind: 'screen', on: true, sid: stream.id, name, audio: stream.getAudioTracks().length > 0 });
  // Как в Discord: пока друг не нажал «Смотреть», картинка и звук демки не передаются (дорожки выключены).
  const tr = c.pc.addTransceiver(v, { direction: 'sendonly', streams: [stream], sendEncodings: [{ active: false, maxBitrate: p.kbps * 1000, maxFramerate: p.fps }] });
  c.screen.senders.push(tr.sender);
  try {
    const caps = RTCRtpReceiver.getCapabilities('video')?.codecs || [];
    const rank = (x) => { const i = VIDEO_PREF.indexOf(x.mimeType); return i < 0 ? 99 : i; };
    tr.setCodecPreferences([...caps].sort((a, b) => rank(a) - rank(b)));
  } catch { /* оставим выбор Chromium */ }
  for (const a of stream.getAudioTracks()) c.screen.senders.push(c.pc.addTransceiver(a, { direction: 'sendonly', streams: [stream], sendEncodings: [{ active: false }] }).sender);
  // Миниатюра для тех, кто ещё не смотрит: маленький снимок раз в 8 секунд.
  setTimeout(() => sendThumb(c), 1500);
  c.screen.thumbTimer = setInterval(() => sendThumb(c), 8000);
  v.onended = () => { if (C === c && c.screen?.stream === stream) stopScreen(); };
  $('screenMineVideo').srcObject = new MediaStream([v]);
  $('screenMineVideo').play().catch(() => {});
  // Своё видео: вместо немого превью — сам плеер с кнопками.
  if (stream.player) {
    $('screenMineVideo').hidden = true;
    $('tileMyScreen').insertBefore(stream.player.el, $('screenMineVideo'));
    $('tileMyScreen').classList.add('has-film');
    c.screen.player = stream.player;
    c.focus = 'tileMyScreen';
  }
  X.sound?.('streamOn');
  render();
  return true;
}

// ---------- Камера в звонке ----------
function showPeerCam(track) {
  const c = C;
  c.camTrack = track;
  const v = $('callPeerVideo');
  v.srcObject = new MediaStream([track]);
  v.play().catch(() => {});
  track.onended = () => { if (C === c && c.camTrack === track) { c.camTrack = null; render(); } };
  render();
}

export async function startCam() {
  const c = C;
  if (!c || c.state !== 'active' || c.cam) return false;
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: camConstraints(), audio: false });
  } catch (e) {
    // Выбранной камеры нет (отключили) — пробуем любую.
    try { stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } }, audio: false }); } catch (e2) {
      X.toast(X.cameraError ? X.cameraError(e2) : `Камера не включилась: ${e2?.message || e2}`, 'bad');
      return false;
    }
    void e;
  }
  if (C !== c) { stream.getTracks().forEach((t) => t.stop()); return false; }
  const v = stream.getVideoTracks()[0];
  try { v.contentHint = 'motion'; } catch { /* не важно */ }
  c.cam = { stream, sender: null };
  await send({ kind: 'cam', on: true, sid: stream.id });
  c.cam.sender = c.pc.addTrack(v, stream);
  const tr = c.pc.getTransceivers().find((t) => t.sender === c.cam.sender);
  try {
    // Для камеры важнее, чтобы кодировалось везде: H.264 у всех видеокарт, VP8 как запас.
    const caps = RTCRtpReceiver.getCapabilities('video')?.codecs || [];
    const order = ['video/H264', 'video/VP8', 'video/VP9', 'video/H265', 'video/AV1'];
    const rank = (x) => { const i = order.indexOf(x.mimeType); return i < 0 ? 99 : i; };
    tr?.setCodecPreferences([...caps].sort((a, b) => rank(a) - rank(b)));
  } catch { /* оставим выбор Chromium */ }
  v.onended = () => { if (C === c && c.cam?.stream === stream) stopCam(); };
  const me = $('callMeVideo');
  me.srcObject = new MediaStream([v]);
  me.play().catch(() => {});
  render();
  setTimeout(async () => {
    try {
      const p = c.cam?.sender?.getParameters();
      if (!p?.encodings?.length) return;
      p.encodings[0].maxBitrate = (CAM_PRESETS[camPrefs.quality] || CAM_PRESETS['720p']).kbps * 1000;
      p.encodings[0].maxFramerate = 30;
      await c.cam.sender.setParameters(p);
    } catch { /* не критично */ }
  }, 1500);
  return true;
}

export function stopCam() {
  const c = C;
  const cam = c?.cam;
  if (!cam) return;
  c.cam = null;
  try { if (cam.sender) c.pc.removeTrack(cam.sender); } catch { /* закрыто */ }
  for (const t of cam.stream.getTracks()) t.stop();
  $('callMeVideo').srcObject = null;
  send({ kind: 'cam', on: false });
  render();
}

// Битрейт, частота и «идёт ли картинка» — когда у отправителя уже есть кодировщик.
/** Пока демку никто не смотрит, захватываем экран раз в секунду (хватает на миниатюру), а не 60 раз:
 *  захват игры в полном темпе отнимает у неё видеокарту и память. Смотрят — снова полный темп. */
export function setCaptureRate(stream, preset, full) {
  const v = stream?.getVideoTracks()[0];
  if (!v || v.readyState !== 'live') return;
  v.applyConstraints({ width: { max: preset.w }, height: { max: preset.h }, frameRate: { max: full ? preset.fps : 1 } }).catch(() => {});
}

async function applySenderParams(c) {
  const s = c.screen;
  if (!s) return;
  setCaptureRate(s.stream, s.preset, s.watched);
  const [vs, ...audio] = s.senders;
  try {
    const params = vs.getParameters();
    if (params.encodings?.length) {
      params.encodings[0].active = s.watched;
      params.encodings[0].maxBitrate = s.preset.kbps * 1000;
      params.encodings[0].maxFramerate = s.preset.fps;
      params.degradationPreference = 'maintain-resolution'; // выбранное разрешение держим; не хватает канала или процессора — реже кадры
      await vs.setParameters(params);
    }
  } catch { /* не критично */ }
  for (const a of audio) {
    try {
      const params = a.getParameters();
      if (params.encodings?.length) { params.encodings[0].active = s.watched; await a.setParameters(params); }
    } catch { /* не критично */ }
  }
}

/** Снимок своей демки для плитки друга, пока он её не смотрит (JPEG 320×180, шифруется каналом Som). */
export function makeThumb(v) {
  if (!v?.videoWidth) return null;
  const cv = document.createElement('canvas');
  cv.width = 320;
  cv.height = 180;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 320, 180);
  const k = Math.min(320 / v.videoWidth, 180 / v.videoHeight);
  const w = v.videoWidth * k;
  const h = v.videoHeight * k;
  ctx.drawImage(v, (320 - w) / 2, (180 - h) / 2, w, h);
  const d = cv.toDataURL('image/jpeg', 0.6).split(',')[1];
  return d && d.length < 55000 ? d : null;
}

function sendThumb(c) {
  const s = c?.screen;
  if (!s || C !== c || s.watched) return;
  const v = $('screenMineVideo');
  if (!v.videoWidth) { setTimeout(() => sendThumb(c), 1000); return; }
  const cv = document.createElement('canvas');
  cv.width = 320;
  cv.height = 180;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 320, 180);
  const k = Math.min(320 / v.videoWidth, 180 / v.videoHeight);
  const w = v.videoWidth * k;
  const h = v.videoHeight * k;
  ctx.drawImage(v, (320 - w) / 2, (180 - h) / 2, w, h);
  const d = cv.toDataURL('image/jpeg', 0.6).split(',')[1];
  if (d && d.length < 55000) send({ kind: 'thumb', d });
}

/** «Смотреть» / «Не смотреть» демку друга. */
export function watchScreen(on) {
  const c = C;
  if (!c?.peerScreen) return;
  c.watch = Boolean(on);
  send({ kind: 'watch', on: c.watch });
  if (c.sout) c.sout.gain.gain.value = c.deafened || !c.watch ? 0 : screenPrefs.vol(c.friend) / 100;
  if (c.watch) {
    c.focus = 'tilePeerScreen';
    $('screenVideo').play().catch(() => {});
  } else {
    if (c.focus === 'tilePeerScreen') c.focus = null;
    if (document.fullscreenElement === $('tilePeerScreen')) document.exitFullscreen().catch(() => {});
  }
  render();
}

let expanded = false;
export function setExpanded(on) {
  expanded = Boolean(on);
  $('chatView').classList.toggle('call-expanded', expanded && (Boolean(C) || groupOn()));
  requestAnimationFrame(layoutStage);
  const b = $('callExpand');
  b.setAttribute('aria-pressed', String(expanded));
  b.title = expanded ? 'Вернуть переписку' : 'Развернуть звонок на всё окно';
}
export function toggleFull(el) {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else el.requestFullscreen?.().catch(() => {});
}

export function stopScreen() {
  const c = C;
  const s = c?.screen;
  if (!s) return;
  c.screen = null;
  c.vout = null;
  clearInterval(s.thumbTimer);
  if (c.focus === 'tileMyScreen') c.focus = null;
  for (const snd of s.senders) { try { c.pc.removeTrack(snd); } catch { /* закрыто */ } }
  for (const t of s.stream.getTracks()) t.stop();
  dropFilm(s.stream);
  $('screenMineVideo').hidden = false;
  $('tileMyScreen').classList.remove('has-film');
  $('screenMineVideo').srcObject = null;
  send({ kind: 'screen', on: false });
  X.sound?.('streamOff');
  render();
}

// ---------- Push-to-talk ----------
const pttActive = () => audioPrefs.mode !== 'ptt' || pttDown;
function gate() {
  GH?.gate?.();
  if (C?.mic) C.mic.setOpen(!C.muted && pttActive() && !recHold);
}
/** Пока пишется голосовое, друзья в звонке его не слышат. */
export function holdMic(on) {
  recHold = Boolean(on);
  gate();
}
/** Попросить ядро следить за клавишей (Windows) — только пока идёт звонок в режиме push-to-talk. */
export function armPtt() {
  const on = (Boolean(C) || groupOn()) && audioPrefs.mode === 'ptt';
  X?.call('ptt', { vk: on ? audioPrefs.pttKey.vk : 0 }).catch(() => {});
  if (!on) { pttDown = false; clearTimeout(pttTimer); }
  gate();
  if (C || groupOn()) render();
}
/** Нажата или отпущена клавиша push-to-talk. Отпускание — с задержкой 200 мс, чтобы не съедать концы слов. */
export function setPtt(down) {
  if (audioPrefs.mode !== 'ptt') return;
  clearTimeout(pttTimer);
  if (down) {
    if (pttDown) return;
    pttDown = true;
    gate();
    if (C?.state === 'active' && !C.muted) X.sound?.('pttOn');
    if (groupOn() && !GH.muted?.()) X.sound?.('pttOn');
    if (C || groupOn()) render();
  } else if (pttDown) {
    pttTimer = setTimeout(() => {
      pttDown = false;
      gate();
      if (C?.state === 'active' && !C.muted) X.sound?.('pttOff');
      if (groupOn() && !GH.muted?.()) X.sound?.('pttOff');
      if (C || groupOn()) render();
    }, 200);
  }
}

// ---------- Управление ----------
function setMuted(on) {
  if (!C) return;
  C.muted = on;
  if (!on && C.deafened) setDeafened(false, false);
  gate();
  X.sound?.(on ? 'muteOn' : 'muteOff');
  send({ kind: 'state', muted: C.muted, deafened: C.deafened });
  render();
}

function setDeafened(on, notify = true) {
  if (!C) return;
  C.deafened = on;
  if (C.out) C.out.gain.gain.value = on ? 0 : audioPrefs.vol(C.friend) / 100;
  if (C.sout) C.sout.gain.gain.value = on || !C.watch ? 0 : screenPrefs.vol(C.friend) / 100;
  // Как в Discord: выключил звук — выключился и микрофон; включил обратно — микрофон тоже.
  C.muted = on;
  gate();
  if (notify) send({ kind: 'state', muted: C.muted, deafened: C.deafened });
  render();
}

/** Сменить микрофон или колонки прямо во время звонка (из настроек). */
export async function applyDevices() {
  if (groupOn()) { await GH.devices?.(); return; }
  if (!C) return;
  if (C.out?.ctx.setSinkId) C.out.ctx.setSinkId(sink(audioPrefs.out)).catch(() => {});
  if (!C.mic) return;
  try {
    const mic = await openMic();
    const old = C.mic;
    C.mic = mic;
    gate();
    const sender = C.pc?.getSenders().find((s) => s.track === old.track || s.track?.kind === 'audio');
    if (sender) await sender.replaceTrack(mic.track);
    old.close();
  } catch (err) {
    X.toast(micError(err), 'bad');
  }
}

// ---------- Код звонка и качество ----------
async function makeCode() {
  const c = C;
  const fp = (sdp) => /a=fingerprint:sha-256 ([0-9A-F:]+)/i.exec(sdp || '')?.[1].toUpperCase();
  const a = fp(c.pc.localDescription?.sdp);
  const b = fp(c.pc.remoteDescription?.sdp);
  if (!a || !b) return;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode([a, b].sort().join('|'))));
  let n = 0n;
  for (let i = 0; i < 4; i += 1) n = (n << 8n) | BigInt(digest[i]);
  c.code = (n % 100_000_000n).toString().padStart(8, '0').replace(/(\d{4})(\d{4})/, '$1 $2');
  render();
}

let statsAt = 0;
const buf = new Float32Array(1024);
function onTick() {
  const c = C;
  if (!c) return;
  if (c.lossAt && Date.now() - c.lossAt > DROP_AFTER_MS) { end('Связь прервалась и не восстановилась за 25 секунд — похоже на сбой сети или Radmin.', 'bad'); return; }
  c.levels.me = c.mic && !c.muted && pttActive() ? levelDb(c.mic.analyser, buf) : -100;
  c.levels.peer = c.out ? levelDb(c.out.analyser, buf) : -100;
  c.loud ||= new Map();
  c.talk = { me: holdTalk(c.loud, 'me', c.levels.me), peer: holdTalk(c.loud, 'peer', c.levels.peer) };
  if (Date.now() - statsAt > 2000) { statsAt = Date.now(); readStats(c); }
  renderLive();
}

async function readStats(c) {
  if (!c.pc) return;
  const rep = await c.pc.getStats().catch(() => null);
  if (!rep || C !== c) return;
  let rtt = null;
  let inbound = null;
  let outbound = null;
  let pair = null;
  rep.forEach((r) => {
    if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') { pair = r; if (r.currentRoundTripTime != null) rtt = r.currentRoundTripTime; }
    if (r.type === 'inbound-rtp' && r.kind === 'audio') inbound = r;
    if (r.type === 'outbound-rtp' && r.kind === 'audio') outbound = r;
    // Видео две — экран и камера; статистику экрана берём по его дорожке.
    if (r.type === 'inbound-rtp' && r.kind === 'video' && (!c.screenTrack || !r.trackIdentifier || r.trackIdentifier === c.screenTrack.id)) c.vin = r;
    const screenId = c.screen?.stream.getVideoTracks()[0]?.id;
    if (r.type === 'outbound-rtp' && r.kind === 'video' && r.bytesSent && (!r.mediaSourceId || rep.get(r.mediaSourceId)?.trackIdentifier === screenId)) {
      c.vout = { ...r, codec: rep.get(r.codecId)?.mimeType?.replace('video/', '') || '' };
    }
  });
  if (c.vin?.codecId) c.vinCodec = rep.get(c.vin.codecId)?.mimeType?.replace('video/', '') || '';
  // Для отчёта: путь, кодек и накопленные счётчики.
  const L = c.log;
  if (rtt != null) L.rtts.push(rtt * 1000);
  if (inbound?.jitter != null) L.jitters.push(inbound.jitter * 1000);
  if (pair) {
    const lc = rep.get(pair.localCandidateId);
    const rc = rep.get(pair.remoteCandidateId);
    if (lc && rc) L.path = `${lc.protocol || '?'} ${lc.candidateType || '?'} ${lc.address || lc.ip || '?'} → ${rc.candidateType || '?'} ${rc.address || rc.ip || '?'}`;
  }
  if (inbound?.codecId) L.codec = rep.get(inbound.codecId)?.mimeType || L.codec;
  L.last = {
    packetsReceived: inbound?.packetsReceived, packetsLost: inbound?.packetsLost, bytesReceived: inbound?.bytesReceived,
    totalSamplesReceived: inbound?.totalSamplesReceived, concealedSamples: inbound?.concealedSamples,
    silentConcealedSamples: inbound?.silentConcealedSamples, bytesSent: outbound?.bytesSent,
  };
  if (c.mic) { L.micLabel = c.mic.label; L.micSettings = c.mic.settings; L.nsActive = c.mic.nsActive; }
  if (rtt != null && c.state === 'active') pace(c, rtt * 1000);
  let loss = null;
  if (inbound) {
    const prev = c.prevIn;
    if (prev) {
      const got = inbound.packetsReceived - prev.packetsReceived;
      const lost = inbound.packetsLost - prev.packetsLost;
      loss = got + lost > 0 ? Math.max(0, lost) / (got + lost) : 0;
    }
    c.prevIn = { packetsReceived: inbound.packetsReceived, packetsLost: inbound.packetsLost };
  }
  c.stats = { rtt, loss };
}

// ---------- Отрисовка ----------
const $ = (id) => document.getElementById(id);
function fmtDur(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, '0');
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function statusText(c, name) {
  if (c.state === 'outgoing') return c.peerRinging ? 'Идёт вызов…' : 'Звоню…';
  if (c.state === 'incoming') return 'Входящий звонок';
  if (c.state === 'connecting') return 'Соединяюсь…';
  if (c.lossAt) return c.restarts ? 'Восстанавливаю связь…' : 'Связь прерывается…';
  return fmtDur(Date.now() - c.startedAt);
}

// Аватар в плитке пересоздаём только при смене фото — иначе мигает и заново грузится.
function setAv(id, who) {
  const el = $(id);
  const p = who === 'me' ? X.me() : X.friendById(who);
  const key = `${who}:${p?.avatarV || 0}:${p?.anim || ''}:${p?.color || ''}:${p?.name || ''}`;
  if (el.dataset.key === key) return;
  el.dataset.key = key;
  el.replaceChildren(X.avatarFor(who, 'huge'));
}
const ICONS = {
  mute: '<svg viewBox="0 0 24 24"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/><line x1="12" y1="19" x2="12" y2="23"/></svg>',
  deaf: '<svg viewBox="0 0 24 24"><line x1="1" y1="1" x2="23" y2="23"/><path d="M3 18v-6a9 9 0 0 1 14.5-7.1M21 12v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg>',
};
function setFlags(id, icon, text) {
  const el = $(id);
  const key = `${icon}|${text}`;
  if (el.dataset.key === key) return;
  el.dataset.key = key;
  el.replaceChildren();
  if (icon) {
    const i = document.createElement('span');
    i.className = 'flag-ic';
    i.title = icon === 'deaf' ? 'Звук выключен' : 'Микрофон выключен';
    i.innerHTML = ICONS[icon]; // постоянная разметка значка, без данных друга
    el.append(i);
  }
  if (text) el.append(text);
}

export function render() {
  const c = C;
  const cur = X.currentFriend();
  X.busy?.(Boolean(c) || groupOn());
  GH?.head?.();
  if (groupOn()) {
    $('callBtn').hidden = true;
    $('incoming').hidden = true;
    GH.render();
    return;
  }
  const f = c ? X.friendById(c.friend) : null;
  const name = f?.name || 'Друг';
  // Кнопка звонка в шапке чата
  const btn = $('callBtn');
  btn.hidden = !cur || cur.state !== 'friend';
  btn.disabled = !cur?.online || Boolean(c);
  btn.title = c ? 'Уже идёт звонок' : cur?.online ? 'Позвонить' : 'Друг не в сети';
  // Панель звонка в чате с этим другом
  const here = c && cur && cur.id === c.friend && c.state !== 'incoming';
  $('callPanel').hidden = !here;
  // Плашка внизу списка, если открыт другой чат
  $('callDock').hidden = !c || here || c.state === 'incoming';
  // Входящий звонок
  $('incoming').hidden = !c || c.state !== 'incoming';
  if (!c) { X.onLive?.(); return; }
  if (c.state === 'incoming') {
    $('inAvatar').replaceChildren(X.avatarFor(c.friend, 'big'));
    $('inName').textContent = name;
  }
  setAv('callMeAv', 'me');
  setAv('callPeerAv', c.friend);
  $('callPeerName').textContent = name;
  $('callMeName').textContent = X.me()?.name || 'Вы';
  for (const [id, on] of [['callMute', c.muted], ['dockMute', c.muted], ['callDeafen', c.deafened]]) {
    $(id).setAttribute('aria-pressed', String(on));
  }
  $('callMute').title = c.muted ? 'Включить микрофон' : 'Выключить микрофон';
  $('callDeafen').title = c.deafened ? 'Включить звук' : 'Выключить звук (и микрофон)';
  setFlags('callPeerFlags', c.peerDeafened ? 'deaf' : c.peerMuted ? 'mute' : '', '');
  setFlags('callMeFlags', c.deafened ? 'deaf' : c.muted ? 'mute' : '',
    audioPrefs.mode === 'ptt' && !c.muted ? (pttDown ? 'говорю' : `PTT: ${audioPrefs.pttKey.label}`) : '');
  // Плитки людей: фон — цвет профиля, камера закрывает аватар.
  const me = X.me() || {};
  const peerF = X.friendById(c.friend) || {};
  $('tileMe').style.setProperty('--tile-c', me.color || X.colorFor?.(me.id || 'me') || '#5f7f6a');
  $('tilePeer').style.setProperty('--tile-c', peerF.color || X.colorFor?.(c.friend) || '#7fa0a8');
  const cam = $('callCam');
  cam.disabled = c.state !== 'active';
  cam.setAttribute('aria-pressed', String(Boolean(c.cam)));
  cam.title = c.cam ? 'Выключить камеру' : c.state === 'active' ? 'Включить камеру' : 'Камера — когда звонок соединится';
  const peerCam = Boolean(c.peerCam && c.camTrack);
  $('callPeerVideo').hidden = !peerCam;
  $('callMeVideo').hidden = !c.cam;
  $('callPeerAv').hidden = peerCam;
  $('callMeAv').hidden = Boolean(c.cam);
  $('tilePeer').classList.toggle('has-cam', peerCam);
  $('tileMe').classList.toggle('has-cam', Boolean(c.cam));
  const scr = $('callScreen');
  scr.disabled = c.state !== 'active';
  scr.setAttribute('aria-pressed', String(Boolean(c.screen)));
  scr.title = c.screen ? 'Остановить показ экрана' : c.state === 'active' ? 'Показать экран' : 'Показ экрана — когда звонок соединится';
  // Плитка демки друга: до «Смотреть» — миниатюра и кнопка, после — видео.
  const ps = $('tilePeerScreen');
  ps.hidden = !c.peerScreen;
  if (c.peerScreen) {
    const v = $('screenVideo');
    const live = c.watch && Boolean(c.screenTrack) && v.videoWidth > 0;
    ps.classList.toggle('watching', c.watch);
    v.hidden = !live;
    $('screenWait').hidden = !c.watch || live;
    $('screenCover').hidden = c.watch;
    $('screenCoverTitle').textContent = `${name} показывает ${c.peerScreen.name ? `«${c.peerScreen.name}»` : 'экран'}`;
    const th = $('screenThumb');
    th.hidden = c.watch || !c.peerThumb;
    if (c.peerThumb && th.dataset.v !== c.peerThumb.slice(-40)) { th.src = `data:image/jpeg;base64,${c.peerThumb}`; th.dataset.v = c.peerThumb.slice(-40); }
    $('screenUnwatch').hidden = !c.watch;
    $('screenFull').hidden = !c.watch;
  }
  // Своя демка — тоже плитка: что показываете, кто смотрит.
  $('tileMyScreen').hidden = !c.screen;
  if (c.screen) {
    const a = c.screen.stream.getAudioTracks()[0];
    $('screenMineTitle').textContent = `Вы показываете: ${c.screen.name}`;
    if (c.screen.player) c.screen.player.el.muted = Boolean(c.deafened);
    $('screenMineAudio').hidden = !a;
    $('screenMineAudio').setAttribute('aria-pressed', String(Boolean(a?.enabled)));
    $('screenMineAudio').textContent = a?.enabled ? 'Звук: вкл' : 'Звук: выкл';
    $('screenWatchers').textContent = c.screen.watched ? `Смотрит ${name}` : 'Пока никто не смотрит — картинка не передаётся';
    $('screenWatchers').dataset.on = c.screen.watched ? '1' : '0';
  }
  // Сетка: сколько плиток видно и какая развёрнута.
  if (c.focus && $(c.focus)?.hidden) c.focus = null;
  const tiles = ['tileMe', 'tilePeer', 'tilePeerScreen', 'tileMyScreen'].filter((id) => !$(id).hidden);
  const stage = $('stage');
  stage.dataset.count = String(tiles.length);
  stage.classList.toggle('has-focus', Boolean(c.focus));
  for (const id of tiles) $(id).classList.toggle('focused', c.focus === id);
  $('callPanel').classList.toggle('is-full', document.fullscreenElement === $('callPanel'));
  $('dockName').textContent = name;
  layoutStage();
  renderLive();
}

const GAP = 8;
/** Плитки как в Discord: все 16:9 одного размера — столько колонок, чтобы плитки вышли крупнее всего;
 *  неполный ряд стоит по центру. Высота панели подстраивается под плитки, пустых полос нет. */
export function layoutStage() {
  const stage = $('stage');
  if (!stage || $('callPanel').hidden) return;
  const tiles = [...stage.children].filter((t) => t.classList.contains('tile') && t.getClientRects().length);
  const n = tiles.length;
  stage.dataset.count = String(n);
  const big = $('chatView').classList.contains('call-expanded') || document.fullscreenElement === $('callPanel');
  if (big || stage.classList.contains('has-focus')) stage.style.height = '';
  if (stage.classList.contains('has-focus') || !n) return;
  const W = stage.clientWidth;
  // Открыт общий браузер — звонок узкой полосой маленьких плиток, чтобы не отнимать место у страницы.
  const compact = !big && $('chatView').classList.contains('sb-open');
  const H = big ? stage.clientHeight : compact ? 118 : Number(stage.dataset.maxh) || Math.max(220, Math.min(620, innerHeight * 0.42));
  if (W < 50 || H < 50) return;
  let best = { w: 0, r: 1 };
  for (let c = 1; c <= n; c += 1) {
    const r = Math.ceil(n / c);
    const w = Math.min((W - (c - 1) * GAP) / c, ((H - (r - 1) * GAP) / r) * (16 / 9));
    if (w > best.w) best = { w, r };
  }
  const tw = Math.floor(best.w);
  const th = Math.floor((tw * 9) / 16);
  stage.style.setProperty('--tw', `${tw}px`);
  stage.style.setProperty('--th', `${th}px`);
  if (!big) stage.style.height = `${best.r * th + (best.r - 1) * GAP}px`;
}

/** «Говорит» держится ещё 350 мс после последнего громкого кусочка — подсветка не мигает на каждом слоге
 *  (и окно с оверлеем не перерисовываются по десять раз в секунду). */
export function holdTalk(map, key, db, now = performance.now()) {
  if (db > -45) map.set(key, now);
  return now - (map.get(key) ?? -1e9) < 350;
}

/** Окно свёрнуто или спрятано: звонок идёт, но перерисовывать его незачем. */
export const inBackground = () => document.documentElement.dataset.bg === '1';
/** Меняем текст и атрибуты, только если они правда изменились: иначе браузер перерисовывает их 4 раза в секунду. */
export function putText(el, text) { if (el && el.textContent !== text) el.textContent = text; }
export function putData(el, key, value) { if (el && el.dataset[key] !== value) el.dataset[key] = value; }

function renderLive() {
  const c = C;
  X.onLive?.();
  if (!c || inBackground()) return;
  const name = X.friendById(c.friend)?.name || 'Друг';
  const st = statusText(c, name);
  putText($('callStatus'), st);
  putData($('callStatus'), 'state', c.lossAt ? 'bad' : c.state);
  putText($('dockStatus'), c.state === 'active' && !c.lossAt ? `${c.peerScreen ? 'Показывает экран' : c.screen ? 'Вы показываете экран' : 'На связи'} · ${st}` : st);
  const parts = [];
  if (c.stats?.rtt != null) parts.push(`пинг ${Math.round(c.stats.rtt * 1000)} мс`);
  if (c.stats?.loss != null) parts.push(`потери ${(c.stats.loss * 100).toFixed(c.stats.loss < 0.1 ? 1 : 0).replace('.', ',')}%`);
  if (c.code) parts.push(`код звонка ${c.code}`);
  putText($('callInfo'), c.state === 'active' ? parts.join(' · ') : 'Голос шифруется DTLS-SRTP и идёт напрямую, без серверов.');
  if (c.peerScreen) {
    const v = c.vin;
    const q = c.watch && v?.frameWidth ? [`${v.frameWidth}×${v.frameHeight}`, v.framesPerSecond ? `${Math.round(v.framesPerSecond)} к/с` : '', c.vinCodec].filter(Boolean).join(' · ') : '';
    putText($('screenTitle'), `${name}${q ? ` · ${q}` : ''}`);
  }
  if (c.screen) {
    const o = c.vout;
    const hw = o?.powerEfficientEncoder === true ? 'видеокарта' : o?.powerEfficientEncoder === false ? 'процессор' : '';
    const lim = { bandwidth: 'мало канала', cpu: 'не хватает процессора' }[o?.qualityLimitationReason] || '';
    putText($('screenMineInfo'), o?.frameWidth && c.screen.watched
      ? [`${o.frameWidth}×${o.frameHeight}`, o.framesPerSecond ? `${Math.round(o.framesPerSecond)} к/с` : '', o.codec, hw, lim ? `снижено: ${lim}` : ''].filter(Boolean).join(' · ')
      : `${c.screen.preset.label} к/с${c.screen.watched ? ' · согласую…' : ' · пока никто не смотрит, захват 1 к/с'}`);
  }
  // Кто говорит — подсветка плитки.
  putData($('tileMe'), 'talk', c.talk?.me ? '1' : '0');
  putData($('tilePeer'), 'talk', c.talk?.peer ? '1' : '0');
}
