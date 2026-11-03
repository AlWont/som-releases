// Блокировка Som: экран с паролем поверх всего окна, кнопка и клавиши, настройки.
// Проверяет пароль и помнит «заблокировано» главный процесс — отсюда снять блокировку без пароля нельзя.

const $ = (id) => document.getElementById(id);
let X = { toast: () => {}, me: () => null, avatar: () => null, closePopups: () => {}, incoming: () => null, decline: () => {}, accelFrom: () => null, openSettings: () => {} };
let ST = { has: false, locked: false, kind: 'password', settings: {}, waitUntil: 0, vault: { mode: 'none', wipe: 0, prov: null } };
let wiped = null;
let clockTimer = 0;
let waitTimer = 0;
let callTimer = 0;

export const isLocked = () => Boolean(ST.locked);
export const lockSettings = () => ST.settings || {};
/** Звонок при блокировке «без звонка» — не звенеть (будет пропущенный). */
export const quietRing = () => ST.locked && ST.settings?.calls === 'mute';

const fmtClock = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });
const fmtDate = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
const plural = (n, one, few, many) => { const a = n % 10; const b = n % 100; return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many; };
const vmode = () => ST.vault?.mode || 'none';
/** Сколько неверных попыток до удаления всего (0 — не удаляет). */
const wipeAfter = () => (vmode() === 'prov' ? ST.vault?.prov?.attempts ?? ST.vault?.wipe ?? 0 : vmode() === 'pass' ? ST.vault?.wipe || 0 : 0);
const wipeWarn = (n) => `После ${n} ${plural(n, 'неверной попытки', 'неверных попыток', 'неверных попыток')} подряд Som удалит все свои данные с этого компьютера.`;

// ---------- Экран блокировки ----------
function renderScreen() {
  const s = ST.settings || {};
  const me = X.me();
  $('lkMe').hidden = !s.showMe || !me?.name;
  if (s.showMe && me?.name) {
    const av = X.avatar();
    $('lkAvatar').replaceChildren(...(av ? [av] : []));
    $('lkName').textContent = me.name;
  } else if (s.showMe && ST.locked) {
    // Профиль ещё грузится (Som только запустился) — покажем имя, как появится.
    clearTimeout(renderScreen.t);
    renderScreen.t = setTimeout(() => { if (ST.locked && $('lockDlg').open) renderScreen(); }, 400);
  }
  $('lkClock').hidden = !s.showClock;
  const tick = () => {
    const d = new Date();
    $('lkTime').textContent = fmtClock.format(d);
    $('lkDate').textContent = fmtDate.format(d);
  };
  tick();
  clearInterval(clockTimer);
  if (s.showClock) clockTimer = setInterval(tick, 10000);
  const pin = ST.kind === 'pin';
  const key = ST.kind === 'key';
  const inp = $('lkPass');
  inp.inputMode = pin ? 'numeric' : 'text';
  inp.placeholder = key ? 'Ключ доступа' : pin ? 'PIN-код' : 'Пароль';
  inp.setAttribute('aria-label', inp.placeholder);
  inp.autocapitalize = key ? 'characters' : 'off';
  inp.type = key ? 'text' : 'password';
  inp.classList.toggle('lk-key', key);
  const prov = vmode() === 'prov' ? ST.vault?.prov : null;
  $('lkTitle').textContent = key ? 'Som открывается по ключу' : 'Som заблокирован';
  const who = prov?.by || prov?.for ? [prov.by && `Выдал(а): ${prov.by}`, prov.for && `кому: ${prov.for}`].filter(Boolean).join(' · ') : '';
  $('lkWho').textContent = who;
  $('lkWho').hidden = !who;
  const n = wipeAfter();
  $('lkWarn').textContent = n ? wipeWarn(n) : '';
  $('lkWarn').hidden = !n;
  // «Забыли?» — честно для каждого случая.
  const help = $('lkHelp');
  if (key) help.textContent = `Ключ знает тот, кто выдал копию${prov?.by ? ` — ${prov.by}` : ''}. Без ключа Som не откроется: переписка зашифрована им, удалить или поменять файлы не поможет.`;
  else if (vmode() === 'pass') help.textContent = 'Переписка зашифрована этим паролем, и восстановить его нельзя. Если он потерян, остаётся начать заново: удалить папку %APPDATA%\\Som (переписка пропадёт) и восстановить профиль из файла переноса, если он есть.';
  else help.replaceChildren('Пароль хранится только на этом ПК, и восстановить его нельзя. Чтобы снять блокировку, закройте Som (правой кнопкой по сому у часов → «Выйти из Som»), удалите файл ', Object.assign(document.createElement('code'), { textContent: '%APPDATA%\\Som\\lock.json' }), ' и запустите Som снова. Переписка и друзья останутся.');
  $('lkForgot').textContent = key ? 'Нет ключа?' : 'Забыли пароль?';
  if (wiped) renderWiped();
  else renderWait();
}
function renderWait() {
  clearInterval(waitTimer);
  const until = ST.waitUntil || 0;
  const note = $('lkNote');
  const set = () => {
    const left = Math.ceil((until - Date.now()) / 1000);
    if (left > 0) {
      note.textContent = `Слишком много неверных попыток. Подождите ${left} с.`;
      note.dataset.kind = 'bad';
      $('lkGo').disabled = true;
      $('lkPass').disabled = true;
    } else {
      clearInterval(waitTimer);
      ST.waitUntil = 0;
      $('lkGo').disabled = false;
      $('lkPass').disabled = false;
      if (note.dataset.kind === 'bad' && /Подождите/.test(note.textContent)) { note.textContent = ''; note.dataset.kind = ''; }
      $('lkPass').focus();
    }
  };
  set();
  if (until > Date.now()) waitTimer = setInterval(set, 1000);
}
/** Закрыть всё поверх переписки и сделать её недоступной — сразу, даже до экрана с паролем. */
function cover() {
  document.documentElement.dataset.locked = '1';
  $('shell').inert = true;
}
function showScreen() {
  const dlg = $('lockDlg');
  // Всё, что открыто поверх переписки, закрываем: окна, меню, всплывающие карточки.
  for (const d of document.querySelectorAll('dialog[open]')) if (d !== dlg) d.close();
  for (const p of document.querySelectorAll(':popover-open')) { try { p.hidePopover(); } catch { /* уже */ } }
  X.closePopups();
  cover();
  $('lkPass').value = '';
  $('lkNote').textContent = '';
  $('lkNote').dataset.kind = '';
  $('lkHelp').hidden = true;
  renderScreen();
  if (!dlg.open) dlg.showModal();
  $('lkPass').focus();
  watchCall();
}
function hideScreen() {
  clearInterval(clockTimer);
  clearInterval(waitTimer);
  clearInterval(callTimer);
  $('lkCall').hidden = true;
  delete document.documentElement.dataset.locked;
  $('shell').inert = false;
  const dlg = $('lockDlg');
  if (dlg.open) dlg.close();
}
function renderWiped() {
  clearInterval(waitTimer);
  $('lkTitle').textContent = 'Som удаляет свои данные';
  $('lkNote').textContent = `${wiped.reason ? `Причина: ${wiped.reason}. ` : ''}Переписка и ключи стёрты, Som закроется и удалит себя.`;
  $('lkNote').dataset.kind = 'bad';
  $('lkWarn').hidden = true;
  $('lkPass').disabled = true;
  $('lkGo').disabled = true;
  $('lkForgot').hidden = true;
  $('lkHelp').hidden = true;
}
async function tryUnlock() {
  if (wiped) return;
  const pw = $('lkPass').value;
  if (!pw) { $('lkPass').focus(); return; }
  $('lkGo').disabled = true;
  $('lkPass').disabled = true;
  $('lkNote').textContent = ST.kind === 'key' || vmode() !== 'none' ? 'Проверяю…' : '';
  $('lkNote').dataset.kind = '';
  const r = await window.som.lock.unlock(pw).catch(() => ({ ok: false }));
  $('lkGo').disabled = false;
  $('lkPass').disabled = false;
  if (r?.ok) { $('lkNote').textContent = ''; return; } // экран уберёт событие lock:changed
  if (r?.wiped) { wiped = wiped || { reason: '' }; renderWiped(); return; }
  $('lkPass').value = '';
  const box = $('lkForm');
  box.classList.remove('shake');
  void box.offsetWidth;
  box.classList.add('shake');
  if (r?.wait) { ST.waitUntil = r.wait; renderWait(); return; }
  const note = $('lkNote');
  note.dataset.kind = 'bad';
  if (r?.error) { note.textContent = `Не получилось: ${r.error}`; $('lkPass').focus(); return; }
  note.textContent = ST.kind === 'key' ? 'Неверный ключ.' : ST.kind === 'pin' ? 'Неверный PIN-код.' : 'Неверный пароль.';
  if (r?.left != null) {
    note.textContent += ` ${r.left === 1 ? 'Последняя попытка — дальше Som удалит все данные.' : `Осталось ${r.left} ${plural(r.left, 'попытка', 'попытки', 'попыток')}.`}`;
  } else {
    const left = 5 - (r?.fails || 0);
    if (left > 0 && left < 3) note.textContent += ` Ещё ${left} ${left === 1 ? 'попытка' : 'попытки'} — потом пауза.`;
  }
  $('lkPass').focus();
}

// Входящий звонок, пока заблокировано: кто звонит (если разрешено) и «Отклонить».
function watchCall() {
  clearInterval(callTimer);
  const upd = () => {
    const c = X.incoming();
    const card = $('lkCall');
    const calls = ST.settings?.calls || 'name';
    if (!c || calls === 'mute') { card.hidden = true; return; }
    card.hidden = false;
    $('lkCallWho').textContent = calls === 'name' ? `${c.name} звонит` : 'Входящий звонок';
  };
  upd();
  callTimer = setInterval(upd, 500);
}

// ---------- Клавиши ----------
function matches(e, acc) {
  if (!acc) return false;
  const r = X.accelFrom(e);
  return Boolean(r?.acc && r.acc === acc);
}
/** Заблокировать сейчас. Пароля нет — предложить задать. */
export async function lockNow() {
  if (!ST.has) {
    if (!$('settingsDlg').open) await X.openSettings('privacy');
    requestAnimationFrame(() => $('lockGroup').scrollIntoView({ block: 'center' }));
    openPassword('set');
    return;
  }
  await window.som.lock.lock();
}

// ---------- Настройки ----------
function renderSettings() {
  const s = ST.settings || {};
  const vm = vmode();
  const prov = vm === 'prov' ? ST.vault?.prov : null;
  const what = ST.kind === 'pin' ? 'PIN-код' : 'пароль';
  $('lkStatus').textContent = vm === 'prov' ? 'Som открывается по ключу, выданному вместе с копией.'
    : vm === 'pass' ? `Задан ${what}, переписка зашифрована им.`
    : ST.has ? `Задан ${what}.` : 'Пароль не задан — блокировка выключена.';
  $('lkSetPw').textContent = ST.has ? 'Сменить…' : 'Задать пароль…';
  $('lkSetPw').hidden = vm === 'prov';
  $('lkRemovePw').hidden = !ST.has || vm === 'prov';
  $('lkOpts').hidden = !ST.has;
  $('lkProv').hidden = vm !== 'prov';
  if (prov) {
    const rules = [prov.attempts ? `после ${prov.attempts} ${plural(prov.attempts, 'неверного ключа', 'неверных ключей', 'неверных ключей')} подряд Som удалит все свои данные` : 'неверные ключи ничего не удаляют'];
    if (prov.tamper) rules.push('при вмешательстве в его файлы — тоже');
    const who = [prov.by && `выдал(а) ${prov.by}`, prov.for && `кому: ${prov.for}`].filter(Boolean).join(', ');
    $('lkProv').textContent = `Эта копия выдана под ключ${who ? ` (${who})` : ''}. Ключ и правила заданы при выдаче и не меняются: ${rules.join(', ')}.`;
  }
  $('lkEncRow').hidden = vm === 'prov';
  $('lkEncrypt').checked = vm === 'pass';
  $('lkWipe').value = String(vm === 'pass' ? ST.vault?.wipe || 0 : 0);
  $('lkWipe').disabled = vm !== 'pass';
  $('lkWipeRow').classList.toggle('off', vm !== 'pass');
  $('lkOnStart').disabled = vm !== 'none';
  $('lkOnStart').checked = Boolean(s.onStart);
  $('lkIdle').value = String(s.idleMin || 0);
  $('lkOnMin').checked = Boolean(s.onMinimize);
  $('lkOnSys').checked = Boolean(s.onSystem);
  $('lkHide').checked = Boolean(s.hideOnLock);
  $('lkNotif').value = s.notif || 'noText';
  $('lkCalls').value = s.calls || 'name';
  $('lkShowMe').checked = s.showMe !== false;
  $('lkShowClock').checked = s.showClock !== false;
  for (const [id, k] of [['lkKey', 'hotkey'], ['lkGlobalKey', 'globalHotkey']]) {
    const b = $(id);
    if (b.dataset.capturing) continue;
    b.textContent = s[k] || 'Не задано';
    b.classList.toggle('bad', k === 'globalHotkey' && Boolean(ST.globalBad && s[k]));
    b.title = k === 'globalHotkey' && ST.globalBad && s[k] ? 'Это сочетание занято другой программой — выберите другое' : '';
  }
  for (const x of document.querySelectorAll('[data-lk-clear]')) x.hidden = !s[x.dataset.lkClear];
  $('lockBtn').title = ST.has ? `Заблокировать Som${s.hotkey ? ` (${s.hotkey})` : ''}` : 'Заблокировать Som — сначала задайте пароль';
}
async function refresh() {
  const st = await window.som.lock.state().catch(() => null);
  if (st) ST = { ...ST, ...st };
  renderSettings();
}
async function saveOpt(patch) {
  const r = await window.som.lock.settings(patch).catch(() => null);
  if (r?.ok && r.state) ST = { ...ST, ...r.state };
  else if (r && !r.ok) X.toast(r.error || 'Не сохранилось', 'bad');
  renderSettings();
}
function captureKey(btn, key) {
  btn.dataset.capturing = '1';
  btn.textContent = 'Нажмите сочетание… (Esc — отмена)';
  const done = () => { delete btn.dataset.capturing; window.removeEventListener('keydown', onKey, true); renderSettings(); };
  const onKey = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') { done(); return; }
    const r = X.accelFrom(e);
    if (!r) return;
    if (r.error) { $('lkKeyHint').textContent = r.error; $('lkKeyHint').dataset.kind = 'bad'; return; }
    $('lkKeyHint').textContent = '';
    $('lkKeyHint').dataset.kind = '';
    done();
    saveOpt({ [key]: r.acc });
  };
  window.addEventListener('keydown', onKey, true);
}

// Окно «пароль»: задать, сменить или убрать.
let pwMode = 'set';
function openPassword(mode) {
  pwMode = mode;
  const dlg = $('lockPwDlg');
  const only = mode === 'remove' || mode === 'encrypt' || mode === 'decrypt';
  $('lpTitle').textContent = { remove: 'Убрать пароль', encrypt: 'Шифровать переписку паролем', decrypt: 'Не шифровать переписку паролем' }[mode] || (ST.has ? 'Сменить пароль' : 'Пароль для Som');
  $('lpCurRow').hidden = !ST.has;
  $('lpNewRows').hidden = only;
  $('lpKindRow').hidden = only;
  $('lpEncNote').hidden = mode !== 'encrypt' && !(mode === 'remove' && vmode() === 'pass');
  $('lpEncNote').textContent = mode === 'encrypt'
    ? 'Ключ переписки закроется этим паролем: без него Som не откроет её даже на этом ПК, а удалить файл блокировки уже не поможет. Забудете пароль — переписку не вернуть, поэтому сначала сохраните профиль в файл («Перенос на другой компьютер»).'
    : 'Пароль уберётся вместе с шифрованием: переписка снова будет защищена только учётной записью Windows.';
  for (const id of ['lpCur', 'lpNew', 'lpNew2']) $(id).value = '';
  setKind(ST.has ? ST.kind : 'password');
  $('lpNote').hidden = true;
  $('lpGo').textContent = { remove: 'Убрать пароль', encrypt: 'Зашифровать', decrypt: 'Перестать шифровать' }[mode] || 'Сохранить';
  $('lpGo').classList.toggle('danger', mode === 'remove' || mode === 'decrypt');
  $('lpGo').classList.toggle('primary', mode !== 'remove' && mode !== 'decrypt');
  dlg.showModal();
  (ST.has ? $('lpCur') : $('lpNew')).focus();
}
let pwKind = 'password';
function setKind(k) {
  pwKind = k;
  for (const b of document.querySelectorAll('#lpKind button')) b.setAttribute('aria-pressed', String(b.dataset.kind === k));
  for (const id of ['lpNew', 'lpNew2']) { $(id).inputMode = k === 'pin' ? 'numeric' : 'text'; $(id).placeholder = k === 'pin' ? '4–12 цифр' : 'не короче 4 символов'; }
}
async function savePassword() {
  const note = (t) => { $('lpNote').textContent = t; $('lpNote').dataset.kind = 'bad'; $('lpNote').hidden = false; };
  const cur = $('lpCur').value;
  if (pwMode === 'encrypt' || pwMode === 'decrypt') {
    $('lpGo').disabled = true;
    const r = await window.som.lock.encrypt({ on: pwMode === 'encrypt', current: cur }).catch((err) => ({ ok: false, error: err.message }));
    $('lpGo').disabled = false;
    if (!r?.ok) { note(r?.error || 'Не получилось'); return; }
    $('lockPwDlg').close();
    if (r.state) ST = { ...ST, ...r.state };
    renderSettings();
    X.toast(pwMode === 'encrypt' ? 'Переписка зашифрована паролем. Без него Som её не откроет.' : 'Переписка больше не зашифрована паролем.', 'ok', 6000);
    return;
  }
  if (pwMode === 'remove') {
    const r = await window.som.lock.setPassword({ current: cur, next: '' });
    if (!r?.ok) { note(r?.error || 'Не получилось'); return; }
    $('lockPwDlg').close();
    X.toast('Пароль убран — блокировка выключена.', 'ok');
    refresh();
    return;
  }
  const a = $('lpNew').value;
  const b = $('lpNew2').value;
  if (pwKind === 'pin' && !/^\d{4,12}$/.test(a)) { note('PIN-код — от 4 до 12 цифр.'); $('lpNew').focus(); return; }
  if (pwKind === 'password' && a.length < 4) { note('Пароль — не короче 4 символов.'); $('lpNew').focus(); return; }
  if (a !== b) { note('Пароли не совпадают.'); $('lpNew2').focus(); return; }
  $('lpGo').disabled = true;
  const r = await window.som.lock.setPassword({ current: cur, next: a, kind: pwKind }).catch((err) => ({ ok: false, error: err.message }));
  $('lpGo').disabled = false;
  if (!r?.ok) { note(r?.error || 'Не получилось'); return; }
  const first = !ST.has;
  $('lockPwDlg').close();
  await refresh();
  X.toast(first ? `Готово. Заблокировать — кнопкой с замком внизу${ST.settings.hotkey ? ` или ${ST.settings.hotkey}` : ''}.` : 'Пароль сменён.', 'ok', 6000);
}

export function renderLockSettings() { refresh(); }

// Пока заблокировано, окна поверх экрана блокировки не открываются (приглашение по ссылке, обновление и т. п.) —
// они откроются сразу после того, как вы введёте пароль.
const deferred = new Set();
function guardDialogs() {
  const D = HTMLDialogElement.prototype;
  for (const m of ['showModal', 'show']) {
    const orig = D[m];
    D[m] = function guarded(...a) {
      if (ST.locked && this.id !== 'lockDlg') { deferred.add([this, m]); return undefined; }
      return orig.apply(this, a);
    };
  }
  const P = HTMLElement.prototype;
  const pop = P.showPopover;
  if (pop) P.showPopover = function guarded(...a) { if (ST.locked) return undefined; return pop.apply(this, a); };
}
function openDeferred() {
  const list = [...deferred];
  deferred.clear();
  const seen = new Set();
  for (const [d, m] of list) {
    if (seen.has(d) || d.open || !d.isConnected) continue;
    seen.add(d);
    try { d[m](); } catch { /* уже не нужно */ }
  }
}

export function initLock(deps) {
  X = { ...X, ...deps };
  guardDialogs();
  try { ST = { ...ST, ...window.som.lock.stateSync() }; } catch { /* нет — без блокировки */ }
  $('lkForm').addEventListener('submit', (e) => { e.preventDefault(); tryUnlock(); });
  $('lockDlg').addEventListener('cancel', (e) => e.preventDefault()); // Esc не снимает блокировку
  $('lkForgot').addEventListener('click', () => { $('lkHelp').hidden = !$('lkHelp').hidden; });
  $('lkDecline').addEventListener('click', () => X.decline());
  $('lockBtn').addEventListener('click', lockNow);
  window.som.lock.onWiped((e) => {
    wiped = { reason: e?.reason || '' };
    ST.locked = true;
    if (!$('lockDlg').open) showScreen();
    renderWiped();
  });
  window.som.lock.onChanged(async (e) => {
    const st = await window.som.lock.state().catch(() => null);
    if (st) ST = { ...ST, ...st };
    if (ST.locked) showScreen(); else { hideScreen(); openDeferred(); }
    renderSettings();
    X.onChange?.(ST.locked, e?.why);
  });
  // Клавиша «Заблокировать» в окне Som.
  window.addEventListener('keydown', (e) => {
    if (ST.locked || !ST.has || e.repeat || !ST.settings?.hotkey || document.querySelector('[data-capturing]')) return;
    if (matches(e, ST.settings.hotkey)) { e.preventDefault(); lockNow(); }
  }, true);
  // Настройки.
  $('lkSetPw').addEventListener('click', () => openPassword('set'));
  $('lkRemovePw').addEventListener('click', () => openPassword('remove'));
  $('lpGo').addEventListener('click', savePassword);
  for (const id of ['lpCur', 'lpNew', 'lpNew2']) $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); savePassword(); } });
  for (const b of document.querySelectorAll('#lpKind button')) b.addEventListener('click', () => setKind(b.dataset.kind));
  $('lkOnStart').addEventListener('change', (e) => saveOpt({ onStart: e.target.checked }));
  $('lkIdle').addEventListener('change', (e) => saveOpt({ idleMin: Number(e.target.value) }));
  $('lkOnMin').addEventListener('change', (e) => saveOpt({ onMinimize: e.target.checked }));
  $('lkOnSys').addEventListener('change', (e) => saveOpt({ onSystem: e.target.checked }));
  $('lkHide').addEventListener('change', (e) => saveOpt({ hideOnLock: e.target.checked }));
  $('lkNotif').addEventListener('change', (e) => saveOpt({ notif: e.target.value }));
  $('lkCalls').addEventListener('change', (e) => saveOpt({ calls: e.target.value }));
  $('lkShowMe').addEventListener('change', (e) => saveOpt({ showMe: e.target.checked }));
  $('lkShowClock').addEventListener('change', (e) => saveOpt({ showClock: e.target.checked }));
  $('lkEncrypt').addEventListener('change', (e) => {
    const on = e.target.checked;
    e.target.checked = !on; // включится, когда подтвердят паролем
    openPassword(on ? 'encrypt' : 'decrypt');
  });
  $('lkWipe').addEventListener('change', async (e) => {
    const r = await window.som.lock.wipe(Number(e.target.value)).catch((err) => ({ ok: false, error: err.message }));
    if (r?.ok && r.state) ST = { ...ST, ...r.state };
    else X.toast(r?.error || 'Не сохранилось', 'bad');
    renderSettings();
  });
  $('lkKey').addEventListener('click', (e) => captureKey(e.currentTarget, 'hotkey'));
  $('lkGlobalKey').addEventListener('click', (e) => captureKey(e.currentTarget, 'globalHotkey'));
  for (const x of document.querySelectorAll('[data-lk-clear]')) x.addEventListener('click', () => saveOpt({ [x.dataset.lkClear]: '' }));
  renderSettings();
  if (ST.locked) {
    // При запуске: заставка доиграет, потом экран с паролем. Переписка недоступна с первой секунды.
    cover();
    Promise.race([X.introDone || Promise.resolve(), new Promise((r) => { setTimeout(r, 12000); })]).then(() => { if (ST.locked) showScreen(); });
  }
}
