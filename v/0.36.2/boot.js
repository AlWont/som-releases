// Загрузчик Som: выбирает, какую версию программы запустить.
//
// Обновления лежат в %APPDATA%\Som-updates\<версия>\ — это копия папки resources\app новой версии.
// Если там есть проверенная версия новее встроенной, запускаем её main.js; иначе встроенную.
// Защита от поломки: перед запуском новой версии отмечаем попытку; если она дважды подряд
// не дошла до «всё работает» (окно открылось, ядро ответило) — версия помечается плохой
// и Som снова запускает предыдущую.
'use strict';

const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const BASE = path.join(app.getPath('appData'), 'Som-updates');
const STATE = path.join(BASE, 'state.json');
const bundled = require('./package.json').version;

function cmp(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return {}; }
}
function writeState(s) {
  try { fs.mkdirSync(BASE, { recursive: true }); fs.writeFileSync(STATE, JSON.stringify(s)); } catch { /* без записи — просто без защиты */ }
}

function pick() {
  const state = readState();
  const bad = new Set(state.bad || []);
  let best = null;
  let dirs = [];
  try { dirs = fs.readdirSync(BASE); } catch { return null; }
  for (const d of dirs) {
    if (!/^\d+\.\d+\.\d+$/.test(d) || bad.has(d) || cmp(d, bundled) <= 0) continue;
    const dir = path.join(BASE, d);
    if (!fs.existsSync(path.join(dir, 'ready.json')) || !fs.existsSync(path.join(dir, 'main.js'))) continue;
    if (!best || cmp(d, best) > 0) best = d;
  }
  if (!best) return null;
  // Вторая неудачная попытка подряд — откат.
  if (state.trying === best && (state.attempts || 0) >= 2 && state.good !== best) {
    bad.add(best);
    writeState({ ...state, bad: [...bad], trying: null, attempts: 0 });
    return pick();
  }
  writeState({ ...state, trying: best, attempts: state.trying === best ? (state.attempts || 0) + 1 : 1 });
  return best;
}

// Запускаем самую новую рабочую версию. Если она падает прямо при загрузке — помечаем плохой
// и пробуем следующую (предыдущее обновление, а в конце — встроенную).
for (;;) {
  let chosen = null;
  try { chosen = pick(); } catch { chosen = null; }
  global.somBoot = { base: BASE, bundled, running: chosen || bundled, fromUpdate: Boolean(chosen) };
  if (!chosen) { require('./main.js'); break; }
  try {
    require(path.join(BASE, chosen, 'main.js'));
    break;
  } catch (err) {
    const st = readState();
    writeState({ ...st, bad: [...new Set([...(st.bad || []), chosen])], trying: null, attempts: 0, lastError: String((err && err.message) || err).slice(0, 300) });
  }
}
