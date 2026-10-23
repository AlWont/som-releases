// Групповой звонок: каждый с каждым напрямую (mesh), до 6 человек. Без сервера.
//
// Сигнализация идёт через ядро по каналам Noise с участниками группы. Кто «в звонке», знают все
// участники группы: каждый, кто в звонке, раз в 8 секунд сообщает о себе (gc-here). Соединение между
// двумя участниками начинает тот, у кого id меньше, — так не бывает встречных предложений.
//
// Демка: как в Discord — картинка идёт только тем, кто нажал «Смотреть» (у каждого зрителя своя дорожка).

import {
  audioPrefs, screenPrefs, camConstraints, CAM_PRESETS, camPrefs, openMic, levelDb, sinkFor, SCREEN_PRESETS, VIDEO_PREF,
  tuneOpus, openScreenPicker, captureScreen, pttIsDown, micHeld, micError, setGroupHooks, startTone, setExpanded, toggleFull, makeThumb, armPtt,
} from './call.js';

const MAX_PEOPLE = 6;
const HEARTBEAT_MS = 8000;
const STALE_MS = 20000;
const DROP_AFTER_MS = 25000;

let X = null;
let G = null; // мой групповой звонок
const ROOMS = new Map(); // gid → { people: Map(id → { at, muted, sess }) }
let tick = 0;
let beat = 0;
const buf = new Float32Array(1024);
const $ = (id) => document.getElementById(id);

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
function rid() {
  return [...crypto.getRandomValues(new Uint8Array(8))].map((x) => x.toString(16).padStart(2, '0')).join('');
}
const myId = () => X.me()?.id || '';

// ---------- Сигналы ----------
async function sig(gid, to, data) {
  try { const r = await X.call('gcall_signal', { gid, to, data }); return Boolean(r.sent); } catch { return false; }
}
const sendTo = (id, data) => (G ? sig(G.gid, id, { ...data, sess: G.sess, to: G.peers.get(id)?.sess || undefined }) : Promise.resolve(false));
const sendAll = (data) => (G ? sig(G.gid, '*', { ...data, sess: G.sess }) : Promise.resolve(false));

/** Кто сейчас в звонке группы (по сигналам участников). */
export function roomOf(gid) {
  const r = ROOMS.get(gid);
  if (!r) return null;
  const now = Date.now();
  for (const [id, p] of r.people) if (now - p.at > STALE_MS) r.people.delete(id);
  if (!r.people.size) { ROOMS.delete(gid); return null; }
  return r;
}
export const active = () => Boolean(G);
export const current = () => G;

// ---------- Вход и выход ----------
export async function join(gid) {
  if (G) { if (G.gid !== gid) X.toast('Вы уже в другом звонке.', 'bad'); return; }
  if (X.oneToOneActive()) { X.toast('Сначала завершите личный звонок.', 'bad'); return; }
  const g = X.groupById(gid);
  if (!g || g.state) return;
  const room = roomOf(gid);
  if (room && room.people.size >= MAX_PEOPLE) { X.toast(`В звонке уже ${MAX_PEOPLE} человек — больше нельзя.`, 'bad'); return; }
  let mic;
  try { mic = await openMic(); } catch (err) { X.toast(micError(err), 'bad'); return; }
  if (G) { mic.close(); return; }
  const ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
  if (typeof ctx.setSinkId === 'function') ctx.setSinkId(sinkFor(audioPrefs.out)).catch(() => {});
  G = {
    gid, sess: rid(), joinedAt: Date.now(), mic, ctx,
    muted: false, deafened: false, cam: null, screen: null, peers: new Map(), focus: null, tiles: new Map(), levels: new Map(),
  };
  if (mic.note) X.toast(mic.note, 'bad');
  gate();
  armPtt();
  // Сообщаем всей группе: я в звонке. Тем, кто уже в звонке, — тоже (они ответят своим «я здесь»).
  await sendAll({ kind: 'gc-here', joined: true, muted: false });
  for (const [id, info] of room ? room.people : []) if (id !== myId()) ensurePeer(id, info.sess);
  clearInterval(tick);
  tick = setInterval(onTick, 250);
  clearInterval(beat);
  beat = setInterval(() => { if (G) sendAll({ kind: 'gc-here', muted: G.muted, deafened: G.deafened }); }, HEARTBEAT_MS);
  X.sound?.('join');
  X.selectFriend(`g:${gid}`);
  render();
}

export function leave(text = '') {
  if (!G) return;
  const g = G;
  G = null;
  sig(g.gid, '*', { kind: 'gc-leave', sess: g.sess });
  clearInterval(tick);
  clearInterval(beat);
  for (const p of g.peers.values()) closePeer(p);
  g.mic?.close();
  if (g.screen) { clearInterval(g.screen.thumbTimer); for (const t of g.screen.stream.getTracks()) t.stop(); }
  if (g.cam) for (const t of g.cam.stream.getTracks()) t.stop();
  g.ctx.close().catch(() => {});
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  for (const t of g.tiles.values()) t.root.remove();
  $('callPanel').classList.remove('is-group');
  setExpanded(false);
  armPtt();
  X.sound?.('leave');
  // Я ушёл — в комнате меня больше нет.
  ROOMS.get(g.gid)?.people.delete(myId());
  X.rerender();
  if (text) X.toast(text);
}

// ---------- Соединения ----------
function ensurePeer(id, sess = '') {
  if (!G || id === myId()) return null;
  let p = G.peers.get(id);
  // Участник перезашёл в звонок (новая сессия) — старое соединение уже мёртвое.
  if (p && sess && p.sess && p.sess !== sess) { dropPeer(id, false); p = null; }
  if (p) { if (sess && !p.sess) p.sess = sess; return p; }
  if (G.peers.size + 1 >= MAX_PEOPLE) return null;
  const pc = new RTCPeerConnection({ iceServers: [], bundlePolicy: 'max-bundle', rtcpMuxPolicy: 'require' });
  p = {
    id, sess, pc, polite: myId() > id, created: Date.now(), makingOffer: false, ignoreOffer: false, pending: [], state: 'connecting', lossAt: 0, startedAt: 0,
    out: null, player: null, sout: null, peerScreen: null, screenTrack: null, peerCam: null, camTrack: null, watch: false, thumb: null,
    watchesMe: false, screenSenders: [], camSender: null, muted: false, deafened: false, stats: null,
  };
  G.peers.set(id, p);
  const g = G;
  pc.onnegotiationneeded = async () => {
    try {
      p.makingOffer = true;
      const offer = await pc.createOffer();
      if (pc.signalingState !== 'stable') return;
      await pc.setLocalDescription({ type: 'offer', sdp: tuneOpus(offer.sdp) });
      sendTo(id, { kind: 'sdp', description: pc.localDescription.toJSON() });
    } catch (e) {
      X.diagError?.(`групповой звонок: согласование (${e.message})`);
    } finally { p.makingOffer = false; }
  };
  pc.onicecandidate = ({ candidate }) => { if (candidate) sendTo(id, { kind: 'ice', candidate: candidate.toJSON() }); };
  pc.onconnectionstatechange = () => {
    if (G !== g) return;
    const st = pc.connectionState;
    if (st === 'connected') { p.state = 'connected'; p.lossAt = 0; p.startedAt ||= Date.now(); }
    else if (st === 'disconnected' || st === 'failed') {
      p.lossAt ||= Date.now();
      if (st === 'failed' && p.startedAt) { try { pc.restartIce(); } catch { /* не вышло */ } }
    }
    render();
  };
  pc.ontrack = (e) => {
    if (G !== g) return;
    const sid = e.streams[0]?.id;
    if (e.track.kind === 'video') {
      if (p.peerCam && sid === p.peerCam.sid) showCam(p, e.track); else showScreen(p, e.track);
      return;
    }
    if (p.peerScreen && sid === p.peerScreen.sid) playScreenAudio(p, e.track);
    else playVoice(p, e.track);
  };
  // Начинает тот, у кого id меньше: добавляет свой голос (и камеру/демку, если уже включены).
  if (!p.polite) attachTracks(p);
  sendTo(id, { kind: 'gc-here', joined: true, muted: G.muted, deafened: G.deafened });
  render();
  return p;
}

async function attachTracks(p) {
  if (!G) return;
  const pc = p.pc;
  if (!pc.getSenders().some((s) => s.track === G.mic.track)) pc.addTrack(G.mic.track, new MediaStream([G.mic.track]));
  if (G.cam) await addCamTo(p);
  if (G.screen) await addScreenTo(p);
}

function closePeer(p) {
  try { p.pc.close(); } catch { /* уже */ }
  if (p.player) { p.player.pause(); p.player.srcObject = null; }
  if (p.sout) { p.sout.player.srcObject = null; p.sout.src.disconnect(); }
  try { p.out?.src.disconnect(); } catch { /* уже */ }
}

function dropPeer(id, why) {
  const p = G?.peers.get(id);
  if (!p) return;
  closePeer(p);
  G.peers.delete(id);
  const t = G.tiles.get(`p:${id}`);
  if (t) { t.root.remove(); G.tiles.delete(`p:${id}`); }
  const s = G.tiles.get(`s:${id}`);
  if (s) { s.root.remove(); G.tiles.delete(`s:${id}`); }
  if (G.focus === `s:${id}` || G.focus === `p:${id}`) G.focus = null;
  if (why) X.sound?.('leave');
  render();
}

async function onDescription(p, d) {
  const pc = p.pc;
  try {
    const collision = d.type === 'offer' && (p.makingOffer || pc.signalingState !== 'stable');
    p.ignoreOffer = !p.polite && collision;
    if (p.ignoreOffer) return;
    await pc.setRemoteDescription(d);
    for (const c of p.pending.splice(0)) await pc.addIceCandidate(c).catch(() => {});
    if (d.type === 'answer') applyParams(p);
    if (d.type === 'offer') {
      // Свой голос — в ту же дорожку, что предложил собеседник.
      const tr = pc.getTransceivers().find((t) => t.receiver.track?.kind === 'audio' && !t.sender.track && t.mid !== null);
      if (tr && G?.mic && !pc.getSenders().some((s) => s.track === G.mic.track)) {
        tr.direction = 'sendrecv';
        await tr.sender.replaceTrack(G.mic.track);
      }
      const answer = await pc.createAnswer();
      await pc.setLocalDescription({ type: 'answer', sdp: tuneOpus(answer.sdp) });
      sendTo(p.id, { kind: 'sdp', description: pc.localDescription.toJSON() });
      // Вежливая сторона: камера и демка — уже после первого обмена.
      if (p.polite && !p.attached) { p.attached = true; if (G.cam) addCamTo(p); if (G.screen) addScreenTo(p); }
    }
  } catch (e) {
    X.diagError?.(`групповой звонок: сигнализация (${e.message})`);
  }
}

// ---------- Входящие сигналы ----------
export async function onSignal(gid, from, data) {
  const kind = data?.kind;
  if (!kind || from === myId()) return;
  const sess = typeof data.sess === 'string' ? data.sess.slice(0, 32) : '';
  if (kind === 'gc-here' || kind === 'gc-leave') {
    const before = roomOf(gid)?.people.size || 0;
    let r = ROOMS.get(gid);
    if (kind === 'gc-here') {
      if (!r) { r = { people: new Map() }; ROOMS.set(gid, r); }
      const fresh = r.people.get(from)?.sess !== sess;
      r.people.set(from, { at: Date.now(), muted: Boolean(data.muted), sess });
      if (fresh && data.joined && !before && (!G || G.gid !== gid)) ringNotice(gid, from);
    } else if (r && (!sess || r.people.get(from)?.sess === sess)) {
      r.people.delete(from);
    }
    if (G && G.gid === gid) {
      if (kind === 'gc-leave') { if (!sess || G.peers.get(from)?.sess === sess) dropPeer(from, true); }
      else {
        const p = ensurePeer(from, sess);
        if (p) { p.muted = Boolean(data.muted); p.deafened = Boolean(data.deafened); }
      }
    }
    X.rerender();
    return;
  }
  if (!G || G.gid !== gid) return;
  if (data.to && data.to !== G.sess) return; // сигнал прошлому заходу в звонок
  const p = ensurePeer(from, sess);
  if (!p) return;
  switch (kind) {
    case 'sdp': await onDescription(p, data.description); break;
    case 'ice':
      if (!data.candidate) break;
      if (!p.pc.remoteDescription) p.pending.push(data.candidate);
      else p.pc.addIceCandidate(data.candidate).catch(() => {});
      break;
    case 'state': p.muted = Boolean(data.muted); p.deafened = Boolean(data.deafened); render(); break;
    case 'cam':
      if (data.on) p.peerCam = { sid: String(data.sid || '') };
      else { p.peerCam = null; p.camTrack = null; }
      render();
      break;
    case 'screen':
      if (data.on) { p.peerScreen = { sid: String(data.sid || ''), name: String(data.name || '').slice(0, 120), audio: Boolean(data.audio) }; p.watch = false; p.thumb = null; X.sound?.('streamOn'); if (screenPrefs.autoWatch) setTimeout(() => watch(from, true), 300); }
      else {
        if (p.peerScreen) X.sound?.('streamOff');
        p.peerScreen = null; p.screenTrack = null; p.watch = false; p.thumb = null;
        if (p.sout) { p.sout.player.srcObject = null; p.sout.src.disconnect(); p.sout = null; }
        if (G.focus === `s:${from}`) G.focus = null;
      }
      render();
      break;
    case 'watch':
      p.watchesMe = Boolean(data.on);
      applyParams(p);
      if (!p.watchesMe) setTimeout(() => sendThumbTo(p), 300);
      render();
      break;
    case 'thumb':
      if (p.peerScreen && typeof data.d === 'string' && data.d.length < 60000 && /^[A-Za-z0-9+/=]+$/.test(data.d)) { p.thumb = data.d; render(); }
      break;
    default:
  }
}

function ringNotice(gid, from) {
  const g = X.groupById(gid);
  if (!g || X.me()?.effective === 'dnd') return;
  const who = X.memberName(gid, from);
  X.toast(`${who} звонит в «${g.name}» — присоединиться можно в группе.`, 'ok');
  const stop = startTone('incoming');
  setTimeout(stop, 5200);
  window.som.overlayToast?.({ id: `gcall-${gid}-${Date.now()}`, kind: 'call', title: `Звонок в «${g.name}»`, text: `${who} начал(а) звонок` }).catch?.(() => {});
}

// ---------- Звук ----------
function playVoice(p, track) {
  if (p.out) return;
  const player = new Audio();
  player.muted = true;
  player.srcObject = new MediaStream([track]);
  player.play().catch(() => {});
  p.player = player;
  const src = G.ctx.createMediaStreamSource(new MediaStream([track]));
  const gain = G.ctx.createGain();
  gain.gain.value = G.deafened ? 0 : audioPrefs.vol(p.id) / 100;
  const analyser = G.ctx.createAnalyser();
  analyser.fftSize = 1024;
  src.connect(analyser);
  src.connect(gain);
  gain.connect(G.ctx.destination);
  if (G.ctx.state !== 'running') G.ctx.resume();
  p.out = { src, gain, analyser };
}
function playScreenAudio(p, track) {
  if (p.sout) { p.sout.player.srcObject = null; p.sout.src.disconnect(); }
  const player = new Audio();
  player.muted = true;
  player.srcObject = new MediaStream([track]);
  player.play().catch(() => {});
  const src = G.ctx.createMediaStreamSource(new MediaStream([track]));
  const gain = G.ctx.createGain();
  gain.gain.value = G.deafened || !p.watch ? 0 : screenPrefs.vol(p.id) / 100;
  src.connect(gain);
  gain.connect(G.ctx.destination);
  p.sout = { player, src, gain };
}
export function applyVolumes(id) {
  const p = G?.peers.get(id);
  if (!p) return;
  if (p.out) p.out.gain.gain.value = G.deafened ? 0 : audioPrefs.vol(id) / 100;
  if (p.sout) p.sout.gain.gain.value = G.deafened || !p.watch ? 0 : screenPrefs.vol(id) / 100;
}
function gate() {
  if (!G?.mic) return;
  G.mic.track.enabled = !G.muted && (audioPrefs.mode !== 'ptt' || pttIsDown()) && !micHeld();
}

// ---------- Камера ----------
function showCam(p, track) {
  p.camTrack = track;
  track.onended = () => { if (p.camTrack === track) { p.camTrack = null; render(); } };
  render();
}
async function addCamTo(p) {
  if (!G?.cam) return;
  const v = G.cam.stream.getVideoTracks()[0];
  if (p.camSender) return;
  await sendTo(p.id, { kind: 'cam', on: true, sid: G.cam.stream.id });
  const tr = p.pc.addTransceiver(v, { direction: 'sendonly', streams: [G.cam.stream], sendEncodings: [{ maxBitrate: (CAM_PRESETS[camPrefs.quality] || CAM_PRESETS['720p']).kbps * 1000, maxFramerate: 30 }] });
  p.camSender = tr.sender;
}
async function toggleCam() {
  if (!G) return;
  if (G.cam) {
    const cam = G.cam;
    G.cam = null;
    for (const p of G.peers.values()) {
      if (p.camSender) { try { p.pc.removeTrack(p.camSender); } catch { /* закрыто */ } p.camSender = null; }
      sendTo(p.id, { kind: 'cam', on: false });
    }
    for (const t of cam.stream.getTracks()) t.stop();
    render();
    return;
  }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ video: camConstraints(), audio: false }); } catch (e) {
    try { stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false }); } catch (e2) { X.toast(X.cameraError(e2), 'bad'); return; }
    void e;
  }
  if (!G) { stream.getTracks().forEach((t) => t.stop()); return; }
  G.cam = { stream };
  for (const p of G.peers.values()) await addCamTo(p);
  render();
}

// ---------- Демка ----------
function showScreen(p, track) {
  p.screenTrack = track;
  track.onended = () => { if (p.screenTrack === track) { p.screenTrack = null; render(); } };
  track.onunmute = () => render();
  render();
}
async function addScreenTo(p) {
  const s = G?.screen;
  if (!s || p.screenSenders.length) return;
  const v = s.stream.getVideoTracks()[0];
  await sendTo(p.id, { kind: 'screen', on: true, sid: s.stream.id, name: s.name, audio: s.stream.getAudioTracks().length > 0 });
  // Картинка идёт этому участнику, только когда он нажал «Смотреть».
  const tr = p.pc.addTransceiver(v, { direction: 'sendonly', streams: [s.stream], sendEncodings: [{ active: false, maxBitrate: s.preset.kbps * 1000, maxFramerate: s.preset.fps }] });
  try {
    const caps = RTCRtpReceiver.getCapabilities('video')?.codecs || [];
    const rank = (x) => { const i = VIDEO_PREF.indexOf(x.mimeType); return i < 0 ? 99 : i; };
    tr.setCodecPreferences([...caps].sort((a, b) => rank(a) - rank(b)));
  } catch { /* оставим выбор Chromium */ }
  p.screenSenders = [tr.sender];
  for (const a of s.stream.getAudioTracks()) p.screenSenders.push(p.pc.addTransceiver(a, { direction: 'sendonly', streams: [s.stream], sendEncodings: [{ active: false }] }).sender);
  setTimeout(() => sendThumbTo(p), 1500);
}
async function applyParams(p) {
  const s = G?.screen;
  if (!s || !p.screenSenders.length) return;
  const [vs, ...audio] = p.screenSenders;
  try {
    const params = vs.getParameters();
    if (params.encodings?.length) {
      params.encodings[0].active = p.watchesMe;
      params.encodings[0].maxBitrate = s.preset.kbps * 1000;
      params.encodings[0].maxFramerate = s.preset.fps;
      params.degradationPreference = s.hint === 'detail' ? 'maintain-resolution' : 'maintain-framerate';
      await vs.setParameters(params);
    }
  } catch { /* не критично */ }
  for (const a of audio) {
    try { const params = a.getParameters(); if (params.encodings?.length) { params.encodings[0].active = p.watchesMe; await a.setParameters(params); } } catch { /* не критично */ }
  }
}
function sendThumbTo(p) {
  if (!G?.screen || p.watchesMe) return;
  const d = makeThumb(G.tiles.get('ms')?.video);
  if (d) sendTo(p.id, { kind: 'thumb', d });
}
async function toggleScreen() {
  if (!G) return;
  if (G.screen) { stopScreen(); return; }
  const choice = await openScreenPicker();
  if (!choice || !G) return;
  const p = SCREEN_PRESETS[choice.preset] || SCREEN_PRESETS['1080p60'];
  const stream = await captureScreen(choice);
  if (!stream) return;
  if (!G) { stream.getTracks().forEach((t) => t.stop()); return; }
  const v = stream.getVideoTracks()[0];
  try { v.contentHint = choice.hint === 'detail' ? 'detail' : 'motion'; } catch { /* не важно */ }
  G.screen = { stream, name: choice.name, preset: p, hint: choice.hint, thumbTimer: 0 };
  v.onended = () => { if (G?.screen?.stream === stream) stopScreen(); };
  for (const peer of G.peers.values()) await addScreenTo(peer);
  G.screen.thumbTimer = setInterval(() => { for (const peer of G?.peers.values() || []) sendThumbTo(peer); }, 8000);
  X.sound?.('streamOn');
  render();
}
function stopScreen() {
  const s = G?.screen;
  if (!s) return;
  G.screen = null;
  clearInterval(s.thumbTimer);
  for (const p of G.peers.values()) {
    for (const snd of p.screenSenders) { try { p.pc.removeTrack(snd); } catch { /* закрыто */ } }
    p.screenSenders = [];
    p.watchesMe = false;
    sendTo(p.id, { kind: 'screen', on: false });
  }
  for (const t of s.stream.getTracks()) t.stop();
  if (G.focus === 'ms') G.focus = null;
  X.sound?.('streamOff');
  render();
}
export function watch(id, on) {
  const p = G?.peers.get(id);
  if (!p?.peerScreen) return;
  p.watch = Boolean(on);
  sendTo(id, { kind: 'watch', on: p.watch });
  if (p.sout) p.sout.gain.gain.value = G.deafened || !p.watch ? 0 : screenPrefs.vol(id) / 100;
  if (p.watch) G.focus = `s:${id}`;
  else if (G.focus === `s:${id}`) G.focus = null;
  render();
}

// ---------- Кнопки ----------
function setMuted(on) {
  if (!G) return;
  G.muted = on;
  if (!on && G.deafened) setDeafened(false, false);
  gate();
  X.sound?.(on ? 'muteOn' : 'muteOff');
  sendAll({ kind: 'state', muted: G.muted, deafened: G.deafened });
  render();
}
function setDeafened(on, notify = true) {
  if (!G) return;
  G.deafened = on;
  for (const p of G.peers.values()) applyVolumes(p.id);
  G.muted = on;
  gate();
  if (notify) sendAll({ kind: 'state', muted: G.muted, deafened: G.deafened });
  render();
}
function action(a) {
  if (!G) return;
  if (a === 'leave') leave();
  else if (a === 'mute') setMuted(!G.muted);
  else if (a === 'deafen') setDeafened(!G.deafened);
  else if (a === 'cam') toggleCam();
  else if (a === 'screen') toggleScreen();
  else if (a === 'open') X.selectFriend(`g:${G.gid}`);
  else if (a === 'unfocus' && G.focus) { G.focus = null; render(); }
}

/** Сменили микрофон или колонки в настройках — прямо во время звонка. */
async function devices() {
  if (!G) return;
  if (typeof G.ctx.setSinkId === 'function') G.ctx.setSinkId(sinkFor(audioPrefs.out)).catch(() => {});
  try {
    const mic = await openMic();
    if (!G) { mic.close(); return; }
    const old = G.mic;
    G.mic = mic;
    gate();
    for (const p of G.peers.values()) {
      const s = p.pc.getSenders().find((x) => x.track === old.track);
      if (s) await s.replaceTrack(mic.track).catch(() => {});
    }
    old.close();
  } catch (err) { X.toast(micError(err), 'bad'); }
}

// ---------- Отрисовка ----------
const ICON_MUTE = '<svg viewBox="0 0 24 24"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/><line x1="12" y1="19" x2="12" y2="23"/></svg>';
const ICON_DEAF = '<svg viewBox="0 0 24 24"><line x1="1" y1="1" x2="23" y2="23"/><path d="M3 18v-6a9 9 0 0 1 14.5-7.1M21 12v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg>';

function personTile(key, id, mine) {
  let t = G.tiles.get(key);
  if (t) return t;
  const video = el('video', { class: `tile-video${mine ? ' mine' : ''}`, autoplay: true, playsinline: true, muted: true, hidden: true });
  video.muted = true;
  const av = el('div', { class: 'tile-av' });
  const name = el('b');
  const flags = el('span', { class: 'tile-flags' });
  const root = el('div', { class: 'tile person dyn', dataset: { key }, title: mine ? '' : 'Правый щелчок — громкость' }, video, av, el('div', { class: 'tile-label' }, name, flags));
  root.addEventListener('click', () => { if (!G) return; if (!video.hidden) { G.focus = G.focus === key ? null : key; render(); } });
  root.addEventListener('dblclick', () => { if (!video.hidden) toggleFull(root); });
  if (!mine) root.addEventListener('contextmenu', (e) => { e.preventDefault(); X.volumePanel({ id, name: X.memberName(G.gid, id), state: 'friend' }, e.clientX, e.clientY); });
  t = { root, video, av, name, flags, avKey: '' };
  G.tiles.set(key, t);
  return t;
}
function streamTile(key, id, mine) {
  let t = G.tiles.get(key);
  if (t) return t;
  const video = el('video', { class: 'tile-video', autoplay: true, playsinline: true, muted: true, hidden: !mine });
  video.muted = true;
  const thumb = el('img', { class: 'tile-thumb', alt: '', hidden: true });
  const title = el('b');
  const btn = el('button', { type: 'button', class: 'btn primary', text: 'Смотреть', onclick: (e) => { e.stopPropagation(); watch(id, true); } });
  const cover = el('div', { class: 'tile-cover', hidden: mine }, title, btn);
  const wait = el('div', { class: 'tile-wait', hidden: true, text: 'Подключаюсь к эфиру…' });
  const label = el('span');
  const watchers = el('div', { class: 'tile-watchers', hidden: !mine });
  const tools = el('div', { class: 'tile-tools' });
  if (mine) {
    tools.append(el('button', { type: 'button', class: 'tool danger', text: 'Остановить', onclick: (e) => { e.stopPropagation(); stopScreen(); } }));
  } else {
    tools.append(
      el('button', { type: 'button', class: 'tool', text: 'Не смотреть', onclick: (e) => { e.stopPropagation(); watch(id, false); } }),
      el('button', { type: 'button', class: 'tool', text: '⛶', title: 'Во весь экран', onclick: (e) => { e.stopPropagation(); toggleFull(root); } }));
  }
  const root = el('div', { class: `tile stream dyn${mine ? ' mine' : ''}`, dataset: { key }, title: mine ? '' : 'Правый щелчок — громкость демки' },
    thumb, video, el('span', { class: 'live-badge', text: 'В эфире' }), cover, wait, watchers, el('div', { class: 'tile-label' }, label), tools);
  root.addEventListener('click', () => { if (!G) return; if (!mine && !G.peers.get(id)?.watch) return; G.focus = G.focus === key ? null : key; render(); });
  root.addEventListener('dblclick', () => { if (mine || G?.peers.get(id)?.watch) toggleFull(root); });
  if (!mine) root.addEventListener('contextmenu', (e) => { e.preventDefault(); X.volumePanel({ id, name: X.memberName(G.gid, id), state: 'friend' }, e.clientX, e.clientY); });
  t = { root, video, thumb, title, cover, wait, label, watchers, thumbKey: '' };
  G.tiles.set(key, t);
  return t;
}
function setFlags(node, muted, deafened, extra) {
  const key = `${muted}|${deafened}|${extra || ''}`;
  if (node.dataset.k === key) return;
  node.dataset.k = key;
  node.replaceChildren();
  if (deafened || muted) {
    const i = el('span', { class: 'flag-ic', title: deafened ? 'Звук выключен' : 'Микрофон выключен' });
    i.innerHTML = deafened ? ICON_DEAF : ICON_MUTE; // постоянная разметка значка
    node.append(i);
  }
  if (extra) node.append(extra);
}
function setAvatar(t, id) {
  const p = id === myId() ? X.me() : X.friendById(id);
  const key = `${id}:${p?.avatarV || 0}:${p?.name || X.memberName(G.gid, id)}`;
  if (t.avKey === key) return;
  t.avKey = key;
  t.av.replaceChildren(X.avatarForMember(id, X.memberName(G.gid, id)));
  t.root.style.setProperty('--tile-c', p?.color || X.colorFor(id));
}

/** Кнопка звонка в шапке группы и плашка «Идёт звонок». */
export function renderHead() {
  const cur = X.currentFriend();
  // Кнопка «звонок» в шапке группы.
  const gb = $('gcallBtn');
  if (cur?.state === 'group' && !cur.groupState) {
    const room = roomOf(cur.gid);
    gb.hidden = false;
    const inThis = G?.gid === cur.gid;
    gb.disabled = inThis || (Boolean(G) && !inThis);
    gb.classList.toggle('live', Boolean(room) && !inThis);
    gb.title = inThis ? 'Вы в звонке' : room ? `Идёт звонок: ${[...room.people.keys()].map((id) => X.memberName(cur.gid, id)).join(', ')} — присоединиться` : 'Начать звонок в группе';
    const bar = $('gcallBar');
    bar.hidden = !room || inThis;
    if (room && !inThis) $('gcallBarText').textContent = `Идёт звонок · ${[...room.people.keys()].map((id) => X.memberName(cur.gid, id)).join(', ')}`;
  } else {
    gb.hidden = true;
    $('gcallBar').hidden = true;
  }
}

export function render() {
  renderHead();
  if (!G) return;
  const cur = X.currentFriend();
  const here = cur?.id === `g:${G.gid}`;
  $('callPanel').hidden = !here;
  $('callPanel').classList.toggle('is-group', true);
  $('callDock').hidden = here;
  $('incoming').hidden = true;
  const g = X.groupById(G.gid);
  $('dockName').textContent = g?.name || 'Группа';
  for (const [id, on] of [['callMute', G.muted], ['dockMute', G.muted], ['callDeafen', G.deafened], ['callCam', Boolean(G.cam)], ['callScreen', Boolean(G.screen)]]) $(id).setAttribute('aria-pressed', String(on));
  for (const id of ['callCam', 'callScreen']) $(id).disabled = false;
  $('callMute').title = G.muted ? 'Включить микрофон' : 'Выключить микрофон';
  $('callDeafen').title = G.deafened ? 'Включить звук' : 'Выключить звук (и микрофон)';
  $('callScreen').title = G.screen ? 'Остановить показ экрана' : 'Показать экран';
  $('callCam').title = G.cam ? 'Выключить камеру' : 'Включить камеру';
  const stage = $('stage');
  const order = [];
  // Я
  const me = personTile('me', myId(), true);
  setAvatar(me, myId());
  me.name.textContent = X.me()?.name || 'Вы';
  setFlags(me.flags, G.muted, G.deafened, audioPrefs.mode === 'ptt' && !G.muted ? (pttIsDown() ? 'говорю' : `PTT: ${audioPrefs.pttKey.label}`) : '');
  if (G.cam && me.video.srcObject !== G.cam.stream) { me.video.srcObject = G.cam.stream; me.video.play().catch(() => {}); }
  me.video.hidden = !G.cam;
  me.av.hidden = Boolean(G.cam);
  order.push(['me', me]);
  if (G.screen) {
    const ms = streamTile('ms', myId(), true);
    if (ms.video.srcObject !== G.screen.stream) { ms.video.srcObject = new MediaStream(G.screen.stream.getVideoTracks()); ms.video.play().catch(() => {}); }
    ms.label.textContent = `Вы показываете: ${G.screen.name}`;
    const watchers = [...G.peers.values()].filter((p) => p.watchesMe).map((p) => X.memberName(G.gid, p.id));
    ms.watchers.textContent = watchers.length ? `Смотрят: ${watchers.join(', ')}` : 'Пока никто не смотрит — картинка не передаётся';
    ms.watchers.dataset.on = watchers.length ? '1' : '0';
    order.push(['ms', ms]);
  } else if (G.tiles.has('ms')) { G.tiles.get('ms').root.remove(); G.tiles.delete('ms'); }
  // Остальные
  for (const p of G.peers.values()) {
    const t = personTile(`p:${p.id}`, p.id, false);
    setAvatar(t, p.id);
    t.name.textContent = X.memberName(G.gid, p.id);
    setFlags(t.flags, p.muted, p.deafened, p.state !== 'connected' ? (p.lossAt ? 'связь прерывается…' : 'соединяюсь…') : '');
    const cam = Boolean(p.peerCam && p.camTrack);
    if (cam && t.video.srcObject?.getVideoTracks()[0] !== p.camTrack) { t.video.srcObject = new MediaStream([p.camTrack]); t.video.play().catch(() => {}); }
    t.video.hidden = !cam;
    t.av.hidden = cam;
    t.root.classList.toggle('has-cam', cam);
    order.push([`p:${p.id}`, t]);
    const skey = `s:${p.id}`;
    if (p.peerScreen) {
      const s = streamTile(skey, p.id, false);
      if (p.screenTrack && s.video.srcObject?.getVideoTracks()[0] !== p.screenTrack) { s.video.srcObject = new MediaStream([p.screenTrack]); s.video.onresize = () => render(); s.video.play().catch(() => {}); }
      const live = p.watch && Boolean(p.screenTrack) && s.video.videoWidth > 0;
      s.video.hidden = !live;
      s.wait.hidden = !p.watch || live;
      s.cover.hidden = p.watch;
      s.title.textContent = `${X.memberName(G.gid, p.id)} показывает ${p.peerScreen.name ? `«${p.peerScreen.name}»` : 'экран'}`;
      s.thumb.hidden = p.watch || !p.thumb;
      if (p.thumb && s.thumbKey !== p.thumb.slice(-40)) { s.thumb.src = `data:image/jpeg;base64,${p.thumb}`; s.thumbKey = p.thumb.slice(-40); }
      s.label.textContent = X.memberName(G.gid, p.id);
      s.root.classList.toggle('watching', p.watch);
      for (const b of s.root.querySelectorAll('.tile-tools .tool')) b.hidden = !p.watch;
      order.push([skey, s]);
    } else if (G.tiles.has(skey)) { G.tiles.get(skey).root.remove(); G.tiles.delete(skey); }
  }
  for (const [, t] of order) if (t.root.parentNode !== stage) stage.append(t.root);
  if (G.focus && !G.tiles.has(G.focus)) G.focus = null;
  // Сетка: 1–4 плитки — по две в ряд, до 9 — по три, дальше по четыре; неполный ряд — по центру.
  const n = order.length;
  const cols = n <= 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4;
  stage.style.setProperty('--cols', String(cols));
  stage.style.setProperty('--rows', String(Math.ceil(n / cols)));
  stage.dataset.count = String(n);
  stage.classList.toggle('has-focus', Boolean(G.focus));
  order.forEach(([k, t], i) => {
    t.root.style.order = G.focus === k ? '-1' : String(i);
    t.root.classList.toggle('focused', G.focus === k);
  });
  $('callPanel').classList.toggle('is-full', document.fullscreenElement === $('callPanel'));
  renderLive();
}

function renderLive() {
  if (!G) return;
  const sec = Math.floor((Date.now() - G.joinedAt) / 1000);
  const tm = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  const connected = [...G.peers.values()].filter((p) => p.state === 'connected').length;
  $('callStatus').textContent = tm;
  $('callStatus').dataset.state = 'active';
  const rtts = [...G.peers.values()].map((p) => p.stats?.rtt).filter((x) => x != null);
  $('callInfo').textContent = [`в звонке ${connected + 1} из ${G.peers.size + 1}`, rtts.length ? `пинг до ${Math.round(Math.max(...rtts) * 1000)} мс` : '', 'каждый с каждым напрямую'].filter(Boolean).join(' · ');
  $('dockStatus').textContent = `Группа · ${tm}`;
  const meT = G.tiles.get('me');
  if (meT) meT.root.dataset.talk = (G.levels.get('me') ?? -100) > -45 ? '1' : '0';
  for (const p of G.peers.values()) {
    const t = G.tiles.get(`p:${p.id}`);
    if (t) t.root.dataset.talk = (G.levels.get(p.id) ?? -100) > -45 ? '1' : '0';
  }
  X.onLive?.();
}

let statsAt = 0;
function onTick() {
  if (!G) return;
  const ptt = audioPrefs.mode !== 'ptt' || pttIsDown();
  G.levels.set('me', G.mic && !G.muted && ptt ? levelDb(G.mic.analyser, buf) : -100);
  for (const p of G.peers.values()) {
    G.levels.set(p.id, p.out ? levelDb(p.out.analyser, buf) : -100);
    if (p.lossAt && Date.now() - p.lossAt > DROP_AFTER_MS) dropPeer(p.id, true);
  }
  if (Date.now() - statsAt > 2000) {
    statsAt = Date.now();
    // Участник пропал без «ушёл» (выключился ПК, упало приложение): о себе он больше не сообщает.
    const room = roomOf(G.gid);
    for (const p of [...G.peers.values()]) if (Date.now() - p.created > STALE_MS && !room?.people.has(p.id)) dropPeer(p.id, true);
    for (const p of G.peers.values()) {
      p.pc.getStats().then((rep) => {
        rep.forEach((r) => { if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded' && r.currentRoundTripTime != null) p.stats = { rtt: r.currentRoundTripTime }; });
      }).catch(() => {});
    }
  }
  renderLive();
}

/** Для оверлея: кто в звонке и кто говорит. */
export function overlayPeople() {
  if (!G) return null;
  const list = [{ id: myId(), me: true, talking: (G.levels.get('me') ?? -100) > -45 && !G.muted, muted: G.muted, deafened: G.deafened }];
  for (const p of G.peers.values()) list.push({ id: p.id, talking: (G.levels.get(p.id) ?? -100) > -45, muted: p.muted, deafened: p.deafened, connecting: p.state !== 'connected' });
  return { gid: G.gid, people: list };
}

export function initGroupCall(deps) {
  X = deps;
  setGroupHooks({ active, action, render, head: renderHead, gate, devices, volumes: applyVolumes, muted: () => Boolean(G?.muted) });
  $('gcallBtn').addEventListener('click', () => { const f = X.currentFriend(); if (f?.state === 'group') join(f.gid); });
  $('gcallJoin').addEventListener('click', () => { const f = X.currentFriend(); if (f?.state === 'group') join(f.gid); });
  window.addEventListener('beforeunload', () => { if (G) sig(G.gid, '*', { kind: 'gc-leave', sess: G.sess }); });
  // Комнаты, где давно никого не слышно, гаснут сами.
  setInterval(() => { let changed = false; for (const gid of [...ROOMS.keys()]) { const before = ROOMS.has(gid); roomOf(gid); if (before !== ROOMS.has(gid)) changed = true; } if (changed) X.rerender(); }, 5000);
}
