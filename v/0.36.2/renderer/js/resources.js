// Настройки «Ресурсы ПК»: спидометры процессора и памяти с ползунками «сколько выделить Som»,
// приоритет у Windows, режим игры, память, видеокарта.
// Сами настройки и действия — в главном процессе (window.som.res); здесь только экран и «режим игры» в окне.
import { makeGauge, ZONES } from './gauge.js';

const $ = (id) => document.getElementById(id);
let X = { toast: () => {} };
let R = null;
let timer = 0;
let G = null; // спидометры
let U = null; // последний замер
const EMA = { cpu: null, sys: null };

const PRIO_HINT = {
  normal: 'Som работает наравне с остальными программами. Сам по себе он почти не нагружает ПК, так что обычно этого достаточно.',
  game: 'Пока идёт игра, Windows отдаёт процессор игре в первую очередь, а Som — когда освободится. В звонке Som на это время возвращает обычный приоритет, чтобы голос не заикался.',
  low: 'Som всегда уступает процессор другим программам. Подойдёт для слабого ПК. В звонке — обычный приоритет, чтобы голос не заикался.',
};

/** Пока игра: решает, замирают ли анимации и молчат ли сообщения. Окно Som в фокусе — анимации живые. */
export const gameQuiet = () => Boolean(R?.gaming && R?.gameQuiet);
function applyGaming() {
  const on = Boolean(R?.gaming && R?.gameFx && !document.hasFocus());
  document.documentElement.dataset.gaming = on ? '1' : '0';
}

function render() {
  if (!R) return;
  // Без видеокарты фон «Графона» не двигается: иначе всё окно перерисовывает процессор.
  document.documentElement.dataset.gpu = R.gpuNow === false || R.gpuComp === false ? '0' : '1';
  for (const b of document.querySelectorAll('#resPrio button')) b.setAttribute('aria-pressed', String(b.dataset.v === R.prio));
  $('resPrioHint').textContent = PRIO_HINT[R.prio] || '';
  $('resGameFx').checked = R.gameFx;
  $('resGameQuiet').checked = R.gameQuiet;
  $('resUpCap').value = String(R.upCap);
  $('resUpCapGame').checked = R.upCapGame;
  $('resUpCapGame').disabled = !R.upCap;
  $('resTrim').checked = R.trim;
  $('resTrim').disabled = !R.trimSupported;
  $('resTrimNow').disabled = !R.trimSupported;
  $('resGpu').checked = R.gpu;
  $('resCallFree').checked = R.callFree;
  renderSliders();
  $('resGpuRestart').hidden = R.gpu === R.gpuNow;
  $('resGameNow').textContent = R.gaming
    ? `Сейчас идёт игра: ${R.gaming}. ${[R.gameFx && 'анимации стоят', R.gameQuiet && 'сообщения без звука', R.upCap && `отдача файлов до ${R.upCap} МБ/с`, R.prio !== 'normal' && !R.inCall && 'приоритет ниже'].filter(Boolean).join(', ') || 'Ничего не меняем — всё выключено'}.`
    : 'Сейчас игра не запущена. Som узнаёт игру так же, как статус «Играет в…».';
  applyGaming();
}
const fmt = (n, d = 1) => n.toLocaleString('ru-RU', { maximumFractionDigits: d });
function plural(n, [one, few, many]) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}
const cores = (n) => `${n} ${plural(n, ['ядро', 'ядра', 'ядер'])}`;
/** «из 1 ядра», «из 2 ядер», «из 21 ядра». */
const coresGen = (n) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'ядра' : 'ядер'}`;
function mbText(mb) {
  if (mb >= 1024) return { n: fmt(mb / 1024, mb >= 10240 ? 0 : 1), u: 'ГБ' };
  return { n: fmt(mb, 0), u: 'МБ' };
}
const mbStr = (mb) => { const t = mbText(mb); return `${t.n} ${t.u}`; };
const smooth = (key, v, a = 0.5) => { if (v == null) return EMA[key]; EMA[key] = EMA[key] == null ? v : EMA[key] + a * (v - EMA[key]); return EMA[key]; };
const worst = (...s) => (s.includes('tight') ? 'tight' : s.includes('busy') ? 'busy' : 'ok');

// ---------- Ползунки ----------
const memSteps = () => (R?.memSteps || [0, 200, 300, 400, 500, 600, 800, 1000, 1200, 1500, 2000, 3000]).filter((x) => x > 0);
/** Позиция ползунка памяти: слева мало, справа край — «сколько нужно» (без предела). */
const memIndex = (lim) => { const st = memSteps(); const i = st.indexOf(lim); return i < 0 ? st.length : i; };
const memAt = (i) => memSteps()[i] || 0;
function paintRange(input) {
  const min = Number(input.min);
  const max = Number(input.max);
  input.style.setProperty('--p', `${max > min ? ((Number(input.value) - min) / (max - min)) * 100 : 100}%`);
}
function cpuLabel(n, all) { return n >= all ? `все ${cores(all)}` : `${cores(n)} из ${all}`; }
function memLabel(lim) { return lim ? `до ${mbStr(lim)}` : 'сколько нужно'; }
function renderSliders() {
  const all = R.cores || 1;
  const c = $('resCpuCores');
  c.max = String(all);
  c.disabled = all < 2;
  if (document.activeElement !== c) c.value = String(R.cpuCores > 0 ? Math.min(R.cpuCores, all) : all);
  $('resCpuOut').textContent = cpuLabel(Number(c.value), all);
  $('resCpuMax').textContent = `все ${all}`;
  paintRange(c);
  const m = $('resMemLimit');
  m.max = String(memSteps().length);
  if (document.activeElement !== m) m.value = String(memIndex(R.memLimit));
  $('resMemOut').textContent = memLabel(memAt(Number(m.value)));
  $('resMemMin').textContent = mbStr(memSteps()[0]);
  paintRange(m);
  allocHint();
}
/** Предупреждения про слишком тесные рамки. */
function allocHint() {
  const notes = [];
  const n = R.cpuCores > 0 ? R.cpuCores : R.cores;
  if (n === 1) notes.push(R.callFree ? 'С одним ядром Som может подтормаживать при переключении чатов и открытии фото. На звонок ограничение снимется.' : 'С одним ядром Som может подтормаживать, а в звонке — заикаться голос и дёргаться демка.');
  if (R.memLimit && U && U.mb > R.memLimit * 1.25) notes.push(`Сейчас Som занимает ${mbStr(U.mb)} — с пределом ${mbStr(R.memLimit)} он будет постоянно ужиматься, и окно станет отзываться медленнее. Если заметите — сдвиньте ползунок правее.`);
  if (!R.trimSupported && R.memLimit) notes.push('Предел памяти работает только в Windows.');
  const el = $('resAllocHint');
  el.textContent = notes.join(' ');
  el.hidden = !notes.length;
}

// ---------- Спидометры ----------
function initGauges() {
  if (G) return;
  G = {
    cpu: makeGauge($('gCpuDial'), { labels: (i, n) => `${Math.round((i / (n - 1)) * 100)}` }),
    mem: makeGauge($('gMemDial'), { labels: () => '' }),
  };
}
let memScale = 0;
function cpuView(u) {
  const alloc = Math.max(1, u.allocCores || u.cores);
  const limited = alloc < u.cores;
  const share = smooth('cpu', u.cpu / (alloc * 100)); // доля выделенного
  const sys = smooth('sys', u.sysCpu == null ? null : u.sysCpu / 100);
  const somSt = share >= ZONES.TIGHT ? 'tight' : share >= ZONES.BUSY ? 'busy' : 'ok';
  const pcSt = sys == null ? 'ok' : sys >= 0.9 ? 'tight' : sys >= 0.75 ? 'busy' : 'ok';
  const why = [];
  if (somSt === 'tight') why.push(limited ? `Som упёрся в ${cores(alloc)}: ему тесно — дайте ещё ядро ползунком.` : 'Som сейчас загружает процессор почти целиком.');
  else if (somSt === 'busy') why.push(limited ? 'Som заметно занят — выделенные ядра почти заполнены.' : 'Som сейчас заметно занят.');
  if (pcSt === 'tight') why.push(`Процессор ПК загружен на ${fmt(sys * 100, 0)}% — тесно всем программам.`);
  else if (pcSt === 'busy') why.push(`ПК загружен на ${fmt(sys * 100, 0)}%.`);
  const pct = share * 100;
  return {
    g: { value: share, pc: sys, state: worst(somSt, pcSt), pcState: pcSt, text: fmt(pct, pct < 10 ? 1 : 0), unitText: '%', subText: limited ? `из ${coresGen(alloc)}` : `из всех ${coresGen(alloc)}` },
    pcText: sys == null ? 'ПК: —' : `ПК: ${fmt(sys * 100, 0)}%`,
    why: why.length ? why.join(' ') : (u.inCall && u.callFree && u.cpuCores ? 'Звонок — на это время Som работает на всех ядрах.' : 'Свободно.'),
    aria: `Som занимает ${fmt(pct, 1)}% от ${limited ? `выделенных ${coresGen(alloc)}` : 'всего процессора'}${sys == null ? '' : `, весь ПК — ${fmt(sys * 100, 0)}%`}`,
    pct,
  };
}
function niceMax(mb) { for (const s of [400, 800, 1200, 1600, 2000, 3200, 4000, 6000, 8000]) if (mb <= s) return s; return Math.ceil(mb / 4000) * 4000; }
function memView(u) {
  const lim = u.memLimit || 0;
  // Шкала: предел, если он задан; без предела — с запасом над тем, сколько Som занимает (и не скачет туда-сюда).
  const want = lim || niceMax(Math.max(u.mb * 1.6, 500));
  if (!memScale || lim || want > memScale || want < memScale / 2) memScale = want;
  const scale = memScale;
  const share = u.mb / scale;
  const used = u.sysMemTotal - u.sysMemFree;
  const pcShare = used / u.sysMemTotal;
  const somSt = !lim ? 'ok' : share >= 0.98 ? 'tight' : share >= 0.8 ? 'busy' : 'ok';
  const pcSt = u.sysMemFree < 800 || pcShare >= 0.92 ? 'tight' : u.sysMemFree < 1500 || pcShare >= 0.85 ? 'busy' : 'ok';
  const why = [];
  if (somSt === 'tight') why.push(`Som упёрся в предел ${mbStr(lim)} — отдаёт лишнее Windows. Если окно стало отзываться медленнее, сдвиньте ползунок правее.`);
  else if (somSt === 'busy') why.push(`Som близко к пределу ${mbStr(lim)}.`);
  if (pcSt === 'tight') why.push(`В ПК свободно всего ${mbStr(u.sysMemFree)} — тесно всем программам, Windows начнёт сбрасывать память на диск.`);
  else if (pcSt === 'busy') why.push(`В ПК свободно ${mbStr(u.sysMemFree)}.`);
  const t = mbText(u.mb);
  return {
    g: { value: share, pc: pcShare, state: worst(somSt, pcSt), pcState: pcSt, text: t.n, unitText: t.u, subText: lim ? `из ${mbStr(lim)}` : 'предел не задан' },
    pcText: `ПК: ${mbStr(used)} из ${mbStr(u.sysMemTotal)}`,
    why: why.length ? why.join(' ') : (u.inCall && u.callFree && u.memLimitSet ? 'Звонок — на это время предел памяти снят.' : 'Свободно.'),
    aria: `Som занимает ${mbStr(u.mb)}${lim ? ` из ${mbStr(lim)}` : ''}, в ПК занято ${mbStr(used)} из ${mbStr(u.sysMemTotal)}`,
    scale,
    lim,
  };
}
let memLabelsFor = '';
function paint(u) {
  initGauges();
  const c = cpuView(u);
  G.cpu.set(c.g);
  $('gCpuPc').textContent = c.pcText;
  $('gCpuWhy').textContent = c.why;
  $('gCpu').setAttribute('aria-valuenow', String(Math.round(c.pct)));
  $('gCpu').setAttribute('aria-valuetext', c.aria);
  const m = memView(u);
  const key = `${m.scale}`;
  if (memLabelsFor !== key) {
    memLabelsFor = key;
    G.mem.setLabels((i, n) => String(Math.round((m.scale * i) / (n - 1))));
  }
  G.mem.set(m.g);
  $('gMemPc').textContent = m.pcText;
  $('gMemWhy').textContent = m.why;
  $('gMem').setAttribute('aria-valuenow', String(Math.round(u.mb)));
  $('gMem').setAttribute('aria-valuemax', String(Math.round(m.scale)));
  $('gMem').setAttribute('aria-valuetext', m.aria);
}

async function tick() {
  const u = await window.som.res.usage().catch(() => null);
  if (!u) return;
  U = u;
  paint(u);
  $('resCores').textContent = String(u.cores);
  $('resModeLine').textContent = `Режим: ${u.inCall ? 'звонок' : u.gaming ? `игра (${u.gaming})` : 'обычный'} · приоритет ${u.prio === 'low' ? 'ниже обычного' : 'обычный'}${u.memTrims ? ` · по пределу памяти Som ужимался ${u.memTrims} ${plural(u.memTrims, ['раз', 'раза', 'раз'])}` : ''}.`;
  if (R) allocHint();
  $('resParts').replaceChildren(...u.parts.filter((p) => p.mb >= 1).map((p) => {
    const row = document.createElement('div');
    row.className = 'res-part';
    const bar = document.createElement('span');
    bar.className = 'res-bar';
    bar.style.setProperty('--w', `${Math.min(100, (p.mb / Math.max(1, u.mb)) * 100)}%`);
    const name = document.createElement('span'); name.textContent = p.name;
    const val = document.createElement('span'); val.className = 'res-val'; val.textContent = `${fmt(p.cpu)}% · ${fmt(p.mb, 0)} МБ`;
    row.append(name, bar, val);
    return row;
  }));
}
export function startResUsage() { clearInterval(timer); tick(); timer = setInterval(tick, 2000); }
export function stopResUsage() { clearInterval(timer); timer = 0; }
export async function renderRes() { R = await window.som.res.get().catch(() => R); render(); }

async function set(patch) {
  const r = await window.som.res.set(patch).catch(() => null);
  if (r) { R = r; render(); } else X.toast('Не сохранилось', 'bad');
}

export function initResources(deps) {
  X = { ...X, ...deps };
  window.som.res.onState((st) => { R = st; render(); });
  renderRes();
  window.addEventListener('focus', applyGaming);
  window.addEventListener('blur', applyGaming);
  for (const b of document.querySelectorAll('#resPrio button')) b.addEventListener('click', () => set({ prio: b.dataset.v }));
  $('resGameFx').addEventListener('change', (e) => set({ gameFx: e.target.checked }));
  $('resGameQuiet').addEventListener('change', (e) => set({ gameQuiet: e.target.checked }));
  $('resUpCap').addEventListener('change', (e) => set({ upCap: Number(e.target.value) }));
  $('resUpCapGame').addEventListener('change', (e) => set({ upCapGame: e.target.checked }));
  $('resTrim').addEventListener('change', (e) => set({ trim: e.target.checked }));
  $('resGpu').addEventListener('change', (e) => set({ gpu: e.target.checked }));
  $('resCallFree').addEventListener('change', (e) => set({ callFree: e.target.checked }));
  const cpu = $('resCpuCores');
  cpu.addEventListener('input', () => { $('resCpuOut').textContent = cpuLabel(Number(cpu.value), R?.cores || 1); paintRange(cpu); });
  cpu.addEventListener('change', async () => { const n = Number(cpu.value); await set({ cpuCores: n >= (R?.cores || 1) ? 0 : n }); EMA.cpu = null; tick(); });
  const mem = $('resMemLimit');
  mem.addEventListener('input', () => { $('resMemOut').textContent = memLabel(memAt(Number(mem.value))); paintRange(mem); });
  mem.addEventListener('change', async () => { await set({ memLimit: memAt(Number(mem.value)) }); memScale = 0; setTimeout(tick, 600); });
  $('resRelaunch').addEventListener('click', () => window.som.res.relaunch());
  $('resTrimNow').addEventListener('click', async () => {
    $('resTrimNow').disabled = true;
    const r = await window.som.res.trim().catch(() => null);
    $('resTrimNow').disabled = false;
    $('resTrimNote').textContent = r ? `Было ${fmt(r.before / 1024, 0)} МБ, стало ${fmt(r.after / 1024, 0)} МБ. Освобождённое Windows отдаст тем, кому нужно.` : 'Не получилось.';
    tick();
  });
}
