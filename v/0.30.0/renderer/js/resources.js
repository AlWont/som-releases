// Настройки «Ресурсы ПК»: сколько Som ест сейчас, приоритет у Windows, режим игры, память, видеокарта.
// Сами настройки и действия — в главном процессе (window.som.res); здесь только экран и «режим игры» в окне.

const $ = (id) => document.getElementById(id);
let X = { toast: () => {} };
let R = null;
let timer = 0;

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
  $('resGpuRestart').hidden = R.gpu === R.gpuNow;
  $('resGameNow').textContent = R.gaming
    ? `Сейчас идёт игра: ${R.gaming}. ${[R.gameFx && 'анимации стоят', R.gameQuiet && 'сообщения без звука', R.upCap && `отдача файлов до ${R.upCap} МБ/с`, R.prio !== 'normal' && !R.inCall && 'приоритет ниже'].filter(Boolean).join(', ') || 'Ничего не меняем — всё выключено'}.`
    : 'Сейчас игра не запущена. Som узнаёт игру так же, как статус «Играет в…».';
  applyGaming();
}
const fmt = (n, d = 1) => n.toLocaleString('ru-RU', { maximumFractionDigits: d });
async function tick() {
  const u = await window.som.res.usage().catch(() => null);
  if (!u) return;
  $('resCpu').textContent = `${fmt(u.cpu)}%`;
  $('resMem').textContent = `${fmt(u.mb, 0)} МБ`;
  $('resCores').textContent = String(u.cores);
  $('resMode').textContent = u.inCall ? 'звонок' : u.gaming ? 'игра' : 'обычный';
  $('resModeSub').textContent = u.prio === 'low' ? 'приоритет ниже обычного' : 'приоритет обычный';
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
  $('resRelaunch').addEventListener('click', () => window.som.res.relaunch());
  $('resTrimNow').addEventListener('click', async () => {
    $('resTrimNow').disabled = true;
    const r = await window.som.res.trim().catch(() => null);
    $('resTrimNow').disabled = false;
    $('resTrimNote').textContent = r ? `Было ${fmt(r.before / 1024, 0)} МБ, стало ${fmt(r.after / 1024, 0)} МБ. Освобождённое Windows отдаст тем, кому нужно.` : 'Не получилось.';
    tick();
  });
}
