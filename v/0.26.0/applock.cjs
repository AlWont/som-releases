// Блокировка Som паролем или PIN-кодом.
// Пароль хранится только на этом ПК — как хэш scrypt с солью (lock.json рядом с настройками окна).
// Состояние «заблокировано» держит главный процесс: окно не может снять блокировку само, без пароля.
// Это защита от того, кто сядет за ваш ПК, пока вы отошли; сама переписка и так зашифрована ядром.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DEF = {
  onStart: true, // спрашивать пароль при запуске
  idleMin: 0, // блокировать, если вас нет N минут (0 — нет)
  onMinimize: false, // при сворачивании и в трей
  onSystem: true, // когда блокируете Windows или ПК засыпает
  hideOnLock: false, // прятать окно в трей при блокировке
  hotkey: 'Ctrl+L', // в окне Som
  globalHotkey: '', // из любой программы
  notif: 'noText', // уведомления, пока заблокировано: normal | noText | anon | none
  calls: 'name', // звонки, пока заблокировано: name | anon | mute
  showMe: true, // имя и аватар на экране блокировки
  showClock: true, // часы на экране блокировки
};
const IDLE = [0, 1, 5, 15, 30, 60];
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function create({ file, accel, onChange }) {
  let cfg = { ...DEF, hash: '', salt: '', kind: 'password', wasLocked: false, fails: 0, waitUntil: 0 };
  try { cfg = { ...cfg, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch { /* по умолчанию */ }
  const has = () => Boolean(cfg.hash && cfg.salt);
  // Был заблокирован, когда Som закрыли (или обновился), — остаётся заблокированным.
  let locked = has() && (cfg.onStart || cfg.wasLocked);

  function save() {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(cfg));
      fs.renameSync(tmp, file);
    } catch { /* без записи — до перезапуска */ }
  }
  const derive = (pw, salt) => crypto.scryptSync(String(pw).normalize('NFC'), Buffer.from(salt, 'base64'), 32, SCRYPT);
  function check(pw) {
    if (!has() || typeof pw !== 'string') return false;
    const want = Buffer.from(cfg.hash, 'base64');
    const got = derive(pw, cfg.salt);
    return want.length === got.length && crypto.timingSafeEqual(want, got);
  }
  const settings = () => Object.fromEntries(Object.keys(DEF).map((k) => [k, cfg[k]]));

  return {
    isLocked: () => locked,
    has,
    get: (k) => cfg[k],
    state: () => ({ has: has(), kind: cfg.kind, locked, settings: settings(), waitUntil: cfg.waitUntil > Date.now() ? cfg.waitUntil : 0 }),

    /** Задать, сменить или убрать пароль. Если пароль уже есть — нужен текущий. */
    setPassword({ current, next, kind } = {}) {
      if (locked) return { ok: false, error: 'Som заблокирован' };
      if (has() && !check(current)) return { ok: false, error: 'Текущий пароль не подходит' };
      if (!next) {
        cfg.hash = ''; cfg.salt = ''; cfg.wasLocked = false; cfg.fails = 0; cfg.waitUntil = 0;
        save();
        onChange?.('settings');
        return { ok: true };
      }
      const k = kind === 'pin' ? 'pin' : 'password';
      if (typeof next !== 'string' || next.length > 128) return { ok: false, error: 'Слишком длинный пароль' };
      if (k === 'pin' && !/^\d{4,12}$/.test(next)) return { ok: false, error: 'PIN-код — от 4 до 12 цифр' };
      if (k === 'password' && next.length < 4) return { ok: false, error: 'Пароль — не короче 4 символов' };
      const salt = crypto.randomBytes(16).toString('base64');
      cfg.salt = salt;
      cfg.hash = derive(next, salt).toString('base64');
      cfg.kind = k;
      cfg.fails = 0; cfg.waitUntil = 0;
      save();
      onChange?.('settings');
      return { ok: true };
    },

    setSettings(patch = {}) {
      if (locked) return { ok: false, error: 'Som заблокирован' };
      const p = patch && typeof patch === 'object' ? patch : {};
      for (const k of ['onStart', 'onMinimize', 'onSystem', 'hideOnLock', 'showMe', 'showClock']) if (typeof p[k] === 'boolean') cfg[k] = p[k];
      if (IDLE.includes(p.idleMin)) cfg.idleMin = p.idleMin;
      for (const k of ['hotkey', 'globalHotkey']) if (typeof p[k] === 'string' && (p[k] === '' || accel.test(p[k]))) cfg[k] = p[k];
      if (['normal', 'noText', 'anon', 'none'].includes(p.notif)) cfg.notif = p.notif;
      if (['name', 'anon', 'mute'].includes(p.calls)) cfg.calls = p.calls;
      save();
      onChange?.('settings');
      return { ok: true, state: this.state() };
    },

    lock(why = 'button') {
      if (!has() || locked) return locked;
      locked = true;
      cfg.wasLocked = true;
      save();
      onChange?.('locked', why);
      return true;
    },

    /** Снять блокировку. После 5 неверных попыток — пауза: 30 с, потом дольше (до 5 минут). */
    unlock(pw) {
      if (!locked) return { ok: true };
      const now = Date.now();
      if (cfg.waitUntil > now) return { ok: false, wait: cfg.waitUntil };
      if (!check(pw)) {
        cfg.fails = (cfg.fails || 0) + 1;
        if (cfg.fails >= 5) cfg.waitUntil = now + Math.min(300, 30 * 2 ** (cfg.fails - 5)) * 1000;
        save();
        return { ok: false, fails: cfg.fails, wait: cfg.waitUntil > now ? cfg.waitUntil : 0 };
      }
      locked = false;
      cfg.wasLocked = false; cfg.fails = 0; cfg.waitUntil = 0;
      save();
      onChange?.('unlocked');
      return { ok: true };
    },
  };
}

module.exports = { create, IDLE };
