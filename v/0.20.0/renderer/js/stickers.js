// Стикеры: свои наборы из картинок и GIF, отправка в чат, «добавить к себе» и набор целиком одним файлом.
// Файлы лежат на этом ПК (library.cjs), в окно приходят адресами somlib://sticker/<набор>/<файл>.
import { showPanel, closePopup, showMenu } from './msgtools.js';

const $ = (id) => document.getElementById(id);
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
  return el;
}

const MAX = 2 * 1024 * 1024;
const SIDE = 320; // неподвижные стикеры приводим к 320 px
let X = { toast: () => {}, chat: () => null, canSend: () => false, fullUrl: () => Promise.reject(new Error('нет')) };
let LIB = { packs: [], recent: [] };
let curPack = null;

export const stickerUrl = (packId, file) => `somlib://sticker/${packId}/${file}`;
async function reload() {
  const r = await window.som.lib.stickers().catch(() => null);
  if (r?.ok) LIB = r.result;
  return LIB;
}

// ---------- Картинка → стикер ----------
async function isAnimated(file) {
  if (file.type === 'image/gif' || file.type === 'image/apng') return true;
  if (file.type === 'image/webp' && 'ImageDecoder' in window) {
    try {
      const dec = new ImageDecoder({ data: await file.arrayBuffer(), type: 'image/webp' });
      await dec.tracks.ready;
      const n = dec.tracks.selectedTrack?.frameCount || 1;
      dec.close();
      return n > 1;
    } catch { return false; }
  }
  return false;
}
/** Файл → { bytes, mime, w, h }. Анимацию берём как есть (до 2 МБ), картинку сжимаем в WebP 320 px с прозрачностью. */
export async function stickerize(file) {
  const type = file.type || '';
  if (type === 'video/webm') {
    if (file.size > MAX) throw new Error(`«${file.name}» больше 2 МБ`);
    return { bytes: new Uint8Array(await file.arrayBuffer()), mime: 'video/webm', w: 0, h: 0 };
  }
  if (!type.startsWith('image/')) throw new Error(`«${file.name}» — не картинка`);
  const bmp = await createImageBitmap(file);
  const { width: w0, height: h0 } = bmp;
  if (await isAnimated(file)) {
    bmp.close();
    if (file.size > MAX) throw new Error(`анимация «${file.name}» больше 2 МБ — уменьшите GIF`);
    return { bytes: new Uint8Array(await file.arrayBuffer()), mime: type === 'image/apng' ? 'image/png' : type, w: w0, h: h0 };
  }
  const k = Math.min(1, SIDE / Math.max(w0, h0));
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(w0 * k));
  cv.height = Math.max(1, Math.round(h0 * k));
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, cv.width, cv.height);
  bmp.close();
  const blob = await new Promise((r) => cv.toBlob(r, 'image/webp', 0.9));
  if (!blob || blob.size > MAX) throw new Error(`«${file.name}» не сжимается`);
  return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: 'image/webp', w: cv.width, h: cv.height };
}
function pickFiles(multiple = true) {
  return new Promise((resolve) => {
    const inp = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif,image/apng,image/bmp,video/webm', hidden: true });
    if (multiple) inp.multiple = true;
    inp.addEventListener('change', () => { resolve([...(inp.files || [])]); inp.remove(); });
    document.body.append(inp);
    inp.click();
  });
}
async function addFiles(packId, packName, files) {
  const items = [];
  const bad = [];
  for (const f of files.slice(0, 120)) {
    try { items.push(await stickerize(f)); } catch (err) { bad.push(err.message); }
  }
  if (bad.length) X.toast(`Не добавлено: ${bad.slice(0, 3).join('; ')}${bad.length > 3 ? '…' : ''}`, 'bad');
  if (!items.length) return null;
  const r = await window.som.lib.addStickers(packId, packName, items);
  if (!r?.ok) { X.toast(r?.error || 'не получилось', 'bad'); return null; }
  await reload();
  return r.result;
}

// ---------- Окно стикеров у поля сообщения ----------
function mediaEl(src, mime, cls) {
  if (mime === 'video/webm') {
    const v = h('video', { class: cls, muted: true, loop: true, autoplay: true, playsinline: true, 'aria-hidden': 'true' });
    v.muted = true;
    v.src = src;
    return v;
  }
  return h('img', { class: cls, src, alt: '', draggable: 'false', loading: 'lazy' });
}
export async function openStickerPicker(anchor) {
  await reload();
  if (!curPack || !LIB.packs.some((p) => p.id === curPack)) curPack = LIB.packs[0]?.id || null;
  const r = anchor.getBoundingClientRect();
  const node = h('div', { class: 'pop-stickers', role: 'dialog', 'aria-label': 'Стикеры' });
  const render = () => {
    const recent = (LIB.recent || []).map((k) => { const [p, id] = k.split('/'); const pk = LIB.packs.find((x) => x.id === p); const it = pk?.items.find((x) => x.id === id); return it ? { p, it } : null; }).filter(Boolean);
    const tabs = h('div', { class: 'stk-tabs' },
      recent.length ? h('button', { type: 'button', class: 'stk-tab', 'aria-pressed': String(curPack === 'recent'), title: 'Недавние', onclick: () => { curPack = 'recent'; render(); } }, '🕘') : null,
      LIB.packs.map((p) => h('button', {
        type: 'button', class: 'stk-tab', 'aria-pressed': String(curPack === p.id), title: p.name,
        onclick: () => { curPack = p.id; render(); },
      }, p.items[0] ? mediaEl(stickerUrl(p.id, p.items[0].file), p.items[0].mime, 'stk-tab-img') : h('span', { text: p.name.slice(0, 2) }))),
      h('button', { type: 'button', class: 'stk-tab add', title: 'Новый набор', 'aria-label': 'Новый набор', onclick: () => newPackFlow(render) }, '＋'));
    const pack = LIB.packs.find((p) => p.id === curPack);
    const list = curPack === 'recent' ? recent : (pack?.items || []).map((it) => ({ p: pack.id, it }));
    let body;
    if (!LIB.packs.length) {
      body = h('div', { class: 'stk-empty' },
        h('p', { text: 'Своих стикеров пока нет.' }),
        h('p', { class: 'hint', text: 'Выберите картинки или GIF — из них получится набор. Его можно отправить другу целиком.' }),
        h('button', { type: 'button', class: 'btn primary', text: 'Создать набор…', onclick: () => newPackFlow(render) }));
    } else {
      body = h('div', { class: 'stk-grid' }, list.map(({ p, it }) => {
        const b = h('button', { type: 'button', class: 'stk-cell', title: 'Отправить', onclick: () => send(p, it.id) }, mediaEl(stickerUrl(p, it.file), it.mime, 'stk-img'));
        b.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation();
          showMenu(e.clientX, e.clientY, [
            { label: 'Отправить', onclick: () => send(p, it.id) },
            { label: 'Удалить из набора', danger: true, onclick: async () => { await window.som.lib.removeSticker(p, it.id); await reload(); openStickerPicker(anchor); } },
          ]);
        });
        return b;
      }), curPack !== 'recent' ? h('button', { type: 'button', class: 'stk-cell add', title: 'Добавить картинки или GIF', onclick: async () => { const files = await pickFiles(); if (files.length) { await addFiles(curPack, null, files); render(); } } }, '＋') : null);
    }
    const foot = pack && curPack !== 'recent' ? h('div', { class: 'stk-foot' },
      h('span', { class: 'stk-name', text: `${pack.name} · ${pack.items.length}` }),
      h('button', { type: 'button', class: 'btn small', text: 'Отправить набор', disabled: !X.canSend() || !pack.items.length, title: 'Друг получит все стикеры набора одним файлом', onclick: () => sendPack(pack.id) }),
      h('button', { type: 'button', class: 'icon-btn', title: 'Ещё', 'aria-label': 'Ещё', onclick: (e) => {
        const rr = e.currentTarget.getBoundingClientRect();
        showMenu(rr.left, rr.bottom, [
          { label: 'Переименовать набор', onclick: () => renameFlow(pack, () => openStickerPicker(anchor)) },
          { label: 'Удалить набор', danger: true, onclick: async () => { await window.som.lib.deletePack(pack.id); curPack = null; await reload(); openStickerPicker(anchor); } },
        ]);
      } }, '⋯')) : null;
    node.replaceChildren(...[tabs, body, foot].filter(Boolean));
  };
  render();
  showPanel(Math.max(8, r.right - 380), r.top - 8, node);
  // Окно над кнопкой, а не под ней.
  requestAnimationFrame(() => { const nr = node.getBoundingClientRect(); node.style.top = `${Math.max(8, r.top - nr.height - 6)}px`; });
}
function inlineForm(title, value, onOk, render) {
  const inp = h('input', { type: 'text', class: 'stk-input', maxlength: '40', value, placeholder: 'Название набора' });
  const node = document.querySelector('.pop-stickers');
  if (!node) return;
  const ok = () => onOk(inp.value.trim());
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ok(); } if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); render(); } });
  node.replaceChildren(h('div', { class: 'stk-empty' }, h('p', { text: title }), inp,
    h('div', { class: 'inline' }, h('button', { type: 'button', class: 'btn primary', text: 'Дальше', onclick: ok }), h('button', { type: 'button', class: 'btn', text: 'Отмена', onclick: () => render() }))));
  inp.focus();
  inp.select();
}
function newPackFlow(render) {
  inlineForm('Новый набор стикеров', 'Мои стикеры', async (name) => {
    const files = await pickFiles();
    if (!files.length) { render(); return; }
    const r = await addFiles(null, name || 'Мои стикеры', files);
    if (r) curPack = r.pack;
    render();
  }, render);
}
function renameFlow(pack, done) {
  inlineForm('Название набора', pack.name, async (name) => { if (name) await window.som.lib.renamePack(pack.id, name); await reload(); done(); }, done);
}
async function send(packId, id) {
  const chat = X.chat();
  if (!chat || !X.canSend()) { X.toast('Откройте чат с другом или группу, чтобы отправить стикер.', 'bad'); return; }
  closePopup();
  const r = await window.som.lib.sendSticker(chat, packId, id);
  if (!r?.ok) X.toast(`Стикер: ${r?.error || 'не отправился'}`, 'bad');
  else X.sent?.(chat, r.result);
}
async function sendPack(packId) {
  const chat = X.chat();
  if (!chat) return;
  closePopup();
  const r = await window.som.lib.sendPack(chat, packId);
  if (!r?.ok) X.toast(`Набор: ${r?.error || 'не отправился'}`, 'bad');
  else X.sent?.(chat, r.result);
}

// ---------- В переписке ----------
/** Стикер в сообщении: без пузыря, до 180 px. */
export function stickerMsgEl(m, ready, urlOf) {
  const f = m.file;
  const box = h('div', { class: 'stk-msg', title: 'Стикер · правый щелчок — добавить к себе' });
  const k = f.w && f.h ? Math.min(1, 180 / Math.max(f.w, f.h)) : 1;
  box.style.width = `${f.w && f.h ? Math.max(64, Math.round(f.w * k)) : 160}px`;
  box.style.height = `${f.w && f.h ? Math.max(64, Math.round(f.h * k)) : 160}px`;
  if (ready) urlOf().then((u) => { if (u) box.replaceChildren(mediaEl(u, f.mime, 'stk-msg-img')); }).catch(() => {});
  else box.classList.add('loading');
  return box;
}
/** «Добавить к себе» — в набор «Сохранённые». */
export async function saveSticker(m, urlOf) {
  try {
    const blob = await (await fetch(await urlOf())).blob();
    const file = new File([blob], m.file.name, { type: m.file.mime });
    const item = await stickerize(file);
    await reload();
    const saved = LIB.packs.find((p) => p.name === 'Сохранённые');
    const r = await window.som.lib.addStickers(saved?.id || null, 'Сохранённые', [item]);
    if (!r?.ok) throw new Error(r?.error || 'не получилось');
    X.toast('Стикер добавлен в набор «Сохранённые».', 'ok');
  } catch (err) { X.toast(`Стикер: ${err.message}`, 'bad'); }
}
/** Карточка набора, который прислали файлом .sompack. */
export function packCardEl(m, ready, urlOf, actionsEl) {
  const name = m.file.name.replace(/\.sompack$/i, '');
  const btn = h('button', { type: 'button', class: 'btn small primary', text: 'Добавить к себе', disabled: !ready });
  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    btn.disabled = true;
    try {
      const bytes = new Uint8Array(await (await fetch(await urlOf())).arrayBuffer());
      const r = await window.som.lib.importPack(bytes);
      if (!r?.ok) throw new Error(r?.error || 'не получилось');
      X.toast(`Набор «${name}» добавлен: ${r.result.added} стикеров. Они — в окне стикеров у поля сообщения.`, 'ok');
      btn.textContent = 'Добавлен';
      sub.textContent = `${r.result.added} шт. — уже в ваших стикерах`;
    } catch (err) { btn.disabled = false; X.toast(`Набор: ${err.message}`, 'bad'); }
  });
  const sub = h('span', { class: 'att-sub', text: !ready ? 'загружается…' : m.dir === 'in' ? 'Добавьте — и он появится в окне стикеров' : 'Друг может добавить его к себе' });
  return h('div', { class: 'bubble stk-pack' },
    h('div', { class: 'stk-pack-ico', 'aria-hidden': 'true', text: '🗂️' }),
    h('div', { class: 'stk-pack-main' }, h('b', { text: `Набор стикеров «${name}»` }), sub),
    m.dir === 'in' ? btn : h('span', { class: 'att-sub', text: 'отправлен' }), actionsEl);
}

export function initStickers(deps) {
  X = { ...X, ...deps };
}
