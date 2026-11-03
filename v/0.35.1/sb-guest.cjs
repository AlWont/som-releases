// Предзагрузка для страниц в общем браузере. Работает в песочнице, со страницей общается только
// через sendToHost — читает прокрутку и видео и применяет то, что пришло от друзей. Ничего на странице
// не меняет, кроме позиции прокрутки и воспроизведения видео, и наружу отдаёт только эти события.
'use strict';
const { ipcRenderer } = require('electron');

let apply = 0; // пока применяем чужое — своё не рассылаем (эхо)
const quiet = (fn) => { apply = Date.now(); try { fn(); } finally { setTimeout(() => { apply = 0; }, 400); } };
const fromRemote = () => Date.now() - apply < 400;

// ---------- Прокрутка ----------
let last = 0;
let pending = false;
function reportScroll() {
  if (fromRemote()) return;
  const now = Date.now();
  if (now - last < 120) { if (!pending) { pending = true; setTimeout(() => { pending = false; reportScroll(); }, 120); } return; }
  last = now;
  const el = document.scrollingElement || document.documentElement;
  ipcRenderer.sendToHost('sb', { kind: 'scroll', x: window.scrollX, y: window.scrollY, h: el ? el.scrollHeight : 0 });
}
window.addEventListener('scroll', reportScroll, { passive: true });

// ---------- Видео и аудио ----------
function mediaState() {
  const v = document.querySelector('video, audio');
  if (!v) return null;
  return { playing: !v.paused, time: v.currentTime || 0, rate: v.playbackRate || 1, dur: v.duration || 0 };
}
function reportMedia() {
  if (fromRemote()) return;
  const m = mediaState();
  if (m) ipcRenderer.sendToHost('sb', { kind: 'media', ...m });
}
for (const ev of ['play', 'pause', 'seeked', 'ratechange']) document.addEventListener(ev, reportMedia, true);

// ---------- Приём от друзей ----------
ipcRenderer.on('sb-apply', (_e, msg) => {
  if (!msg || typeof msg !== 'object') return;
  if (msg.kind === 'scroll') {
    quiet(() => window.scrollTo(msg.x || 0, msg.y || 0));
  } else if (msg.kind === 'media') {
    const v = document.querySelector('video, audio');
    if (!v) return;
    quiet(() => {
      if (typeof msg.time === 'number' && Math.abs((v.currentTime || 0) - msg.time) > 1.2) v.currentTime = msg.time;
      if (typeof msg.rate === 'number' && v.playbackRate !== msg.rate) v.playbackRate = msg.rate;
      if (msg.playing && v.paused) v.play().catch(() => {});
      if (!msg.playing && !v.paused) v.pause();
    });
  } else if (msg.kind === 'ask') {
    // Новый участник просит текущее состояние — отдаём, что видим у себя.
    const el = document.scrollingElement || document.documentElement;
    ipcRenderer.sendToHost('sb', { kind: 'scroll', x: window.scrollX, y: window.scrollY, h: el ? el.scrollHeight : 0 });
    const m = mediaState();
    if (m) ipcRenderer.sendToHost('sb', { kind: 'media', ...m });
  }
});

// Сообщаем хосту, что страница готова (можно применять отложенное состояние).
window.addEventListener('DOMContentLoaded', () => ipcRenderer.sendToHost('sb', { kind: 'ready' }));
window.addEventListener('load', () => ipcRenderer.sendToHost('sb', { kind: 'ready' }));
