// Голосовые: запись (удержание или «замок»), пауза, черновик с прослушиванием и обрезкой.
// Пишем чистый звук (PCM) и кодируем в Ogg Opus только при отправке — так обрезка ничего не портит,
// а отрезанное «эээ» вообще не уходит другу.

const RATE = 48000;
export const MAX_SEC = 600;

// ---------- Запись ----------
/**
 * Начать запись через тот же микрофон и шумодав, что в звонке.
 * onLevel(db, sec) — для индикатора. Возвращает управление записью.
 */
export async function startCapture(openMic, onLevel) {
  const mic = await openMic();
  const ctx = new AudioContext({ sampleRate: RATE, latencyHint: 'interactive' });
  const src = ctx.createMediaStreamSource(mic.stream);
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  const sink = ctx.createGain();
  sink.gain.value = 0;
  src.connect(proc);
  proc.connect(sink);
  sink.connect(ctx.destination);
  const chunks = [];
  const levels = [];
  let samples = 0;
  let paused = false;
  let stopped = false;
  let resolveFull;
  const full = new Promise((r) => { resolveFull = r; });
  proc.onaudioprocess = (e) => {
    if (paused || stopped) return;
    const x = e.inputBuffer.getChannelData(0);
    const room = MAX_SEC * RATE - samples;
    const n = Math.min(x.length, room);
    if (n <= 0) { resolveFull(); return; }
    const c = new Float32Array(n);
    c.set(x.subarray(0, n));
    chunks.push(c);
    samples += n;
    let peak = 0;
    for (let i = 0; i < n; i += 1) peak = Math.max(peak, Math.abs(c[i]));
    const db = peak > 0 ? 20 * Math.log10(peak) : -100;
    levels.push(db);
    onLevel?.(db, samples / RATE);
    if (samples >= MAX_SEC * RATE) resolveFull();
  };
  if (ctx.state !== 'running') await ctx.resume();
  const close = () => {
    stopped = true;
    proc.onaudioprocess = null;
    try { src.disconnect(); proc.disconnect(); } catch { /* уже */ }
    ctx.close().catch(() => {});
    mic.close();
  };
  return {
    note: mic.note,
    full,
    levels,
    get seconds() { return samples / RATE; },
    get paused() { return paused; },
    pause() { paused = true; },
    resume() { paused = false; },
    /** Остановить и получить звук целиком. */
    stop() {
      close();
      const pcm = new Float32Array(samples);
      let o = 0;
      for (const c of chunks) { pcm.set(c, o); o += c.length; }
      return { pcm, rate: RATE };
    },
    cancel: close,
  };
}

// ---------- Волна ----------
/** n столбиков 0–255 из звука (та же шкала, что у голосовых 0.5). */
export function waveOf(pcm, n = 48) {
  const out = [];
  const per = Math.max(1, Math.floor(pcm.length / n));
  for (let i = 0; i < n; i += 1) {
    let sum = 0;
    let peak = 0;
    const a = i * per;
    const b = Math.min(pcm.length, a + per);
    for (let j = a; j < b; j += 1) { const v = pcm[j]; sum += v * v; peak = Math.max(peak, Math.abs(v)); }
    const rms = b > a ? Math.sqrt(sum / (b - a)) : 0;
    const db = 20 * Math.log10(Math.max(1e-5, (rms + peak) / 2));
    out.push(Math.round(Math.max(0, Math.min(1, (db + 55) / 50)) * 255));
  }
  return out;
}

// ---------- Ogg Opus ----------
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let r = i << 24;
    for (let k = 0; k < 8; k += 1) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
    t[i] = r >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0;
  for (let i = 0; i < bytes.length; i += 1) c = ((c << 8) ^ CRC[((c >>> 24) ^ bytes[i]) & 0xff]) >>> 0;
  return c >>> 0;
}

function page(packets, { granule, serial, seq, flags }) {
  const seg = [];
  for (const p of packets) {
    let n = p.length;
    while (n >= 255) { seg.push(255); n -= 255; }
    seg.push(n);
  }
  const body = packets.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(27 + seg.length + body);
  const dv = new DataView(out.buffer);
  out.set([0x4f, 0x67, 0x67, 0x53], 0); // OggS
  out[4] = 0;
  out[5] = flags;
  dv.setBigInt64(6, BigInt(granule), true);
  dv.setUint32(14, serial, true);
  dv.setUint32(18, seq, true);
  out[26] = seg.length;
  out.set(seg, 27);
  let o = 27 + seg.length;
  for (const p of packets) { out.set(p, o); o += p.length; }
  dv.setUint32(22, crc32(out), true);
  return out;
}

const PRE_SKIP = 312;
function oggOpus(packets, totalSamples) {
  const serial = (Math.random() * 0xffffffff) >>> 0;
  const head = new Uint8Array(19);
  head.set(new TextEncoder().encode('OpusHead'), 0);
  const hv = new DataView(head.buffer);
  head[8] = 1;
  head[9] = 1; // моно
  hv.setUint16(10, PRE_SKIP, true);
  hv.setUint32(12, RATE, true);
  hv.setInt16(16, 0, true);
  head[18] = 0;
  const vendor = new TextEncoder().encode('Som');
  const tags = new Uint8Array(8 + 4 + vendor.length + 4);
  tags.set(new TextEncoder().encode('OpusTags'), 0);
  new DataView(tags.buffer).setUint32(8, vendor.length, true);
  tags.set(vendor, 12);
  const pages = [page([head], { granule: 0, serial, seq: 0, flags: 0x02 }), page([tags], { granule: 0, serial, seq: 1, flags: 0 })];
  let seq = 2;
  let gran = PRE_SKIP;
  for (let i = 0; i < packets.length; i += 50) {
    const group = packets.slice(i, i + 50);
    for (const p of group) gran += p.samples;
    const last = i + 50 >= packets.length;
    const g = last ? PRE_SKIP + totalSamples : gran;
    pages.push(page(group.map((p) => p.data), { granule: g, serial, seq: seq++, flags: last ? 0x04 : 0 }));
  }
  return new Blob(pages, { type: 'audio/ogg; codecs=opus' });
}

/** PCM → Ogg Opus 32 кбит/с. Быстрее реального времени, через WebCodecs. */
export async function encodeOgg(pcm, rate = RATE) {
  if (typeof AudioEncoder !== 'function') throw new Error('этот Som не умеет кодировать звук');
  const packets = [];
  let failed = null;
  const enc = new AudioEncoder({
    output: (chunk) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      packets.push({ data, samples: Math.round(((chunk.duration || 20000) / 1e6) * RATE) });
    },
    error: (e) => { failed = e; },
  });
  enc.configure({ codec: 'opus', sampleRate: rate, numberOfChannels: 1, bitrate: 32000, opus: { frameDuration: 20000, application: 'voip' } });
  const block = rate; // по секунде
  for (let o = 0; o < pcm.length; o += block) {
    const part = pcm.subarray(o, Math.min(pcm.length, o + block));
    const data = new AudioData({ format: 'f32', sampleRate: rate, numberOfFrames: part.length, numberOfChannels: 1, timestamp: Math.round((o / rate) * 1e6), data: part.slice() });
    enc.encode(data);
    data.close();
  }
  await enc.flush();
  enc.close();
  if (failed) throw failed;
  return oggOpus(packets, Math.round((pcm.length / rate) * RATE));
}
