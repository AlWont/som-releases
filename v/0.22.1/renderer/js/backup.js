// Перенос профиля на другой ПК: сохранить всё в файл .sombackup под паролем и открыть его на новом ПК.
// Сам архив собирает и разбирает ядро (там ключи); окно только спрашивает пароль и показывает ход.

const $ = (id) => document.getElementById(id);
let X = { toast: () => {}, call: async () => null, me: () => null, onRestored: () => {} };
let job = null; // 'export' | 'import'
let pendingPrefs = null;

// Что из настроек окна не переносим: устройства этого ПК и служебное.
const SKIP = /^som\.(mic|out|cam|diag|setTab|updNotes|voiceDraft|screen\.hint)$/;
function prefsNow() {
  const out = {};
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k && k.startsWith('som.') && !SKIP.test(k)) out[k] = localStorage.getItem(k);
    }
  } catch { /* без настроек — не страшно */ }
  return out;
}
function applyPrefs(p) {
  if (!p || typeof p !== 'object') return;
  try {
    for (const [k, v] of Object.entries(p)) if (typeof k === 'string' && k.startsWith('som.') && !SKIP.test(k) && typeof v === 'string' && v.length < 200000) localStorage.setItem(k, v);
  } catch { /* не страшно */ }
}

function size(n) {
  const u = ['Б', 'КБ', 'МБ', 'ГБ'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i += 1; }
  return `${v < 10 && i ? v.toFixed(1).replace('.', ',') : Math.round(v)} ${u[i]}`;
}
function progress(prefix, done, total) {
  const box = $(`${prefix}Progress`);
  box.hidden = false;
  const pct = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
  $(`${prefix}Bar`).style.width = `${pct}%`;
  $(`${prefix}ProgText`).textContent = total ? `${size(done)} из ${size(total)}` : 'Шифрую…';
}
function note(prefix, text, kind = '') {
  const n = $(`${prefix}Note`);
  n.textContent = text;
  n.dataset.kind = kind;
  n.hidden = !text;
}

// ---------- Сохранить (старый ПК) ----------
export async function openBackup() {
  const dlg = $('backupDlg');
  $('bkPass').value = '';
  $('bkPass2').value = '';
  $('bkProgress').hidden = true;
  $('bkShow').hidden = true;
  note('bk', '');
  $('bkGo').disabled = false;
  $('bkGo').hidden = false;
  $('bkFilesText').textContent = 'С файлами из переписок';
  dlg.showModal();
  $('bkPass').focus();
  const s = await X.call('backup_size').catch(() => null);
  $('bkFiles').closest('label').hidden = false;
  if (s) {
    const has = s.files > 0;
    $('bkFiles').closest('label').hidden = !has;
    $('bkFiles').checked = true;
    $('bkFilesText').textContent = `С файлами из переписок (${size(s.files)})`;
    $('bkSize').textContent = has
      ? `Без файлов — около ${size(Math.max(0, s.total - s.files))}, с файлами — ${size(s.total)}. Без них переписка переедет, а фото и файлы нужно будет попросить прислать заново.`
      : `Размер — около ${size(s.total)}.`;
  }
}
async function save() {
  const p = $('bkPass').value;
  if (p.length < 6) { note('bk', 'Пароль — не короче 6 символов.', 'bad'); $('bkPass').focus(); return; }
  if (p !== $('bkPass2').value) { note('bk', 'Пароли не совпадают.', 'bad'); $('bkPass2').focus(); return; }
  note('bk', '');
  $('bkGo').disabled = true;
  job = 'export';
  const r = await window.som.backup.save({ password: p, files: $('bkFiles').checked, name: X.me()?.name || '', prefs: prefsNow() }).catch((err) => ({ ok: false, error: err.message }));
  if (!r?.ok) {
    job = null;
    $('bkGo').disabled = false;
    if (!r?.canceled) note('bk', `Не получилось: ${r?.error || 'ошибка'}`, 'bad');
    return;
  }
  $('bkPass').value = '';
  $('bkPass2').value = '';
  $('bkSaveName').textContent = r.file;
  progress('bk', 0, 0);
}

// ---------- Открыть (новый ПК) ----------
export function openRestore() {
  $('rsPass').value = '';
  $('rsFile').textContent = 'файл не выбран';
  $('rsGo').disabled = true;
  $('rsProgress').hidden = true;
  note('rs', '');
  $('restoreDlg').showModal();
}
async function pick() {
  const f = await window.som.backup.pick().catch(() => null);
  if (!f) return;
  $('rsFile').textContent = `${f.name} · ${size(f.size)}`;
  $('rsGo').disabled = false;
  $('rsPass').focus();
}
async function restore() {
  const p = $('rsPass').value;
  if (!p) { $('rsPass').focus(); return; }
  note('rs', 'Проверяю пароль…');
  $('rsGo').disabled = true;
  $('rsPick').disabled = true;
  job = 'import';
  const r = await window.som.backup.restore(p).catch((err) => ({ ok: false, error: err.message }));
  if (!r?.ok) {
    job = null;
    $('rsGo').disabled = false;
    $('rsPick').disabled = false;
    note('rs', r?.error === 'неверный пароль' ? 'Неверный пароль. Это пароль, который вы задали, когда сохраняли файл на старом ПК.' : `Не получилось: ${r?.error || 'ошибка'}`, 'bad');
    if (r?.error === 'неверный пароль') { $('rsPass').select(); $('rsPass').focus(); }
    return;
  }
  const meta = r.result?.meta || {};
  pendingPrefs = meta.prefs || null;
  note('rs', `Переношу профиль «${meta.name || '?'}»: друзей — ${meta.friends ?? '?'}, групп — ${meta.groups ?? '?'}${meta.files ? ', с файлами' : ''}.`);
  progress('rs', 0, 0);
}

/** События ядра о ходе переноса. */
export function onBackupEvent(ev) {
  if (ev.stage === 'export') {
    if (ev.ok === true) {
      job = null;
      $('bkProgress').hidden = true;
      $('bkGo').hidden = true;
      $('bkShow').hidden = false;
      note('bk', `Готово: «${$('bkSaveName').textContent}», ${size(ev.size || 0)}. Перенесите файл на новый ПК (флешка, облако — как удобно), установите там Som и на первом экране нажмите «Перенести профиль с другого ПК».`, 'ok');
    } else if (ev.ok === false) {
      job = null;
      $('bkProgress').hidden = true;
      $('bkGo').disabled = false;
      note('bk', `Не получилось: ${ev.error}`, 'bad');
    } else progress('bk', ev.done, ev.total);
    return;
  }
  if (ev.stage === 'import') {
    if (ev.ok === true) {
      job = null;
      applyPrefs(pendingPrefs);
      pendingPrefs = null;
      $('restoreDlg').close();
      X.onRestored(ev.me);
    } else if (ev.ok === false) {
      job = null;
      $('rsProgress').hidden = true;
      $('rsGo').disabled = false;
      $('rsPick').disabled = false;
      note('rs', `Не получилось: ${ev.error}`, 'bad');
    } else progress('rs', ev.done, ev.total);
  }
}

export function initBackup(deps) {
  X = { ...X, ...deps };
  $('bkGo').addEventListener('click', save);
  $('bkShow').addEventListener('click', () => window.som.backup.show());
  for (const id of ['bkPass', 'bkPass2']) $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
  $('rsPick').addEventListener('click', pick);
  $('rsGo').addEventListener('click', restore);
  $('rsPass').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (!$('rsGo').disabled) restore(); } });
  // Пока идёт перенос, окно не закрываем — иначе непонятно, чем кончилось.
  for (const id of ['backupDlg', 'restoreDlg']) $(id).addEventListener('cancel', (e) => { if (job) e.preventDefault(); });
  $('backupOpen')?.addEventListener('click', openBackup);
  $('welcomeRestore').addEventListener('click', openRestore);
}
