// Звуки из «Лаборатории звуков Som»: тот же синтез, что в лаборатории, — звучит один в один.
// Звук описан данными: инструмент, ноты [шаг, midi, длина в шагах, сила 0/1/2, (Гц)], эхо, пространство.

const INSTR = {
  drop: { wave: 'sine', parts: [[1, 1, 1], [2, 0.18, 1], [3, 0.05, 1]], a: 0.008, d: 0.35 },
  marimba: { wave: 'sine', parts: [[1, 1, 1], [4, 0.22, 0.25], [10, 0.05, 0.08]], a: 0.004, d: 0.7 },
  bell: { wave: 'sine', parts: [[1, 1, 1], [2.76, 0.45, 0.55], [5.4, 0.25, 0.3], [8.93, 0.12, 0.18]], a: 0.003, d: 1.6 },
  soft: { wave: 'sine', parts: [[1, 1, 1]], a: 0.03, hold: true, r: 0.06 },
  epiano: { wave: 'sine', parts: [[1, 1, 1], [2, 0.12, 0.5]], a: 0.004, d: 1.3, fm: [1, 1.6] },
  glass: { wave: 'sine', parts: [[1, 1, 1], [2.4, 0.35, 0.45], [6.1, 0.12, 0.2]], a: 0.002, d: 1.2 },
  pluck: { wave: 'triangle', parts: [[1, 1, 1], [2, 0.3, 0.6]], a: 0.002, d: 0.5, sweep: [7000, 900, 0.25] },
  chip: { wave: 'square', parts: [[1, 0.5, 1]], a: 0.002, hold: true, r: 0.04, sweep: [4200, 4200, 0], gain: 0.5 },
  pad: { wave: 'sawtooth', parts: [[1, 0.5, 1], [1.007, 0.4, 1], [0.993, 0.4, 1]], a: 0.15, hold: true, r: 0.8, sweep: [1700, 900, 1.2], gain: 0.45 },
};
const VEL = [1, 0.65, 0.35];
const mtof = (m) => 440 * 2 ** ((m - 69) / 12);

function playNote(ctx, out, t, hz, len, vel, ins, decayMul) {
  let dest = out;
  let last = t;
  if (ins.sweep) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 0.7;
    f.frequency.setValueAtTime(ins.sweep[0], t);
    if (ins.sweep[2] > 0) f.frequency.exponentialRampToValueAtTime(Math.max(40, ins.sweep[1]), t + ins.sweep[2]);
    f.connect(out);
    dest = f;
  }
  for (const [mul, amp, df] of ins.parts) {
    const o = ctx.createOscillator();
    o.type = ins.wave;
    o.frequency.value = hz * mul;
    const g = ctx.createGain();
    const peak = Math.max(0.0002, amp * vel * (ins.gain ?? 1));
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + ins.a);
    let stop;
    if (ins.hold) {
      const hEnd = Math.max(t + ins.a + 0.01, t + len);
      const rel = Math.max(0.02, ins.r * decayMul);
      g.gain.setValueAtTime(peak, hEnd);
      g.gain.exponentialRampToValueAtTime(0.0001, hEnd + rel);
      stop = hEnd + rel;
    } else {
      const dd = Math.max(0.03, ins.d * decayMul * df);
      g.gain.exponentialRampToValueAtTime(0.0001, t + ins.a + dd);
      stop = t + ins.a + dd;
    }
    if (ins.fm && mul === 1) {
      const m = ctx.createOscillator();
      m.frequency.value = hz * ins.fm[0];
      const mg = ctx.createGain();
      mg.gain.setValueAtTime(hz * ins.fm[1] * vel, t);
      mg.gain.exponentialRampToValueAtTime(Math.max(1, hz * 0.02), stop);
      m.connect(mg).connect(o.frequency);
      m.start(t);
      m.stop(stop + 0.05);
    }
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(stop + 0.05);
    last = Math.max(last, stop);
  }
  return last;
}

const irCache = new Map();
function impulse(ctx, sec) {
  const k = `${ctx.sampleRate}:${sec}`;
  if (irCache.has(k)) return irCache.get(k);
  const n = Math.floor(ctx.sampleRate * sec);
  const b = ctx.createBuffer(2, n, ctx.sampleRate);
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let ch = 0; ch < 2; ch += 1) {
    const d = b.getChannelData(ch);
    for (let i = 0; i < n; i += 1) d[i] = (rnd() * 2 - 1) * (1 - i / n) ** 2.6;
  }
  irCache.set(k, b);
  return b;
}

/** Цепочка звука: яркость → сухой сигнал + эхо + пространство → громкость → dest. */
function chain(ctx, s, dest) {
  const input = ctx.createGain();
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = s.bright;
  lp.Q.value = 0.3;
  const out = ctx.createGain();
  out.gain.value = s.vol * 0.5;
  input.connect(lp);
  lp.connect(out);
  if (s.echo[2] > 0) {
    const d = ctx.createDelay(1.5);
    d.delayTime.value = s.echo[0];
    const fb = ctx.createGain();
    fb.gain.value = s.echo[1];
    const wet = ctx.createGain();
    wet.gain.value = s.echo[2];
    lp.connect(d); d.connect(fb); fb.connect(d); d.connect(wet); wet.connect(out);
  }
  if (s.space > 0) {
    const cv = ctx.createConvolver();
    cv.buffer = impulse(ctx, 1.8);
    const wet = ctx.createGain();
    wet.gain.value = s.space;
    lp.connect(cv); cv.connect(wet); wet.connect(out);
  }
  out.connect(dest);
  return input;
}

const patternEnd = (s) => s.notes.reduce((m, n) => Math.max(m, ((n[0] + n[2]) * s.step) / 1000), 0);

/**
 * Мелодия звонка из лаборатории — в том же виде, что и остальные в call.js:
 * { name, period, level, play(ctx, out, t) }. Громкость уже внутри (как в лаборатории), level = 1.
 */
export function labRing(name, s) {
  const chains = new WeakMap();
  return {
    name,
    period: Math.max(patternEnd(s) + 0.3, s.loop || 2.5),
    level: 1,
    play(ctx, out, t0) {
      let input = chains.get(ctx);
      if (!input) { input = chain(ctx, s, out); chains.set(ctx, input); }
      for (const n of s.notes) {
        playNote(ctx, input, t0 + (n[0] * s.step) / 1000, n[4] || mtof(n[1]), (n[2] * s.step) / 1000, VEL[n[3]] ?? 1, INSTR[s.inst], s.decay);
      }
    },
  };
}
