// Оверлей поверх игры: кто говорит, своё состояние, уведомления. Только показывает — ввода нет.
const $ = (id) => document.getElementById(id);
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function renderPeople(st) {
  const box = $('people');
  const root = $('root');
  const cfg = st?.cfg || {};
  root.dataset.corner = cfg.corner || 'tl';
  root.style.setProperty('--o', String(cfg.opacity ?? 0.85));
  root.style.setProperty('--z', String({ s: 0.85, m: 1, l: 1.25 }[cfg.size] || 1));
  root.classList.toggle('compact', Boolean(cfg.compact));
  const call = st?.call;
  if (!call) { box.replaceChildren(); return; }
  box.replaceChildren(...call.people.map((p) => {
    const row = el('div', 'p');
    row.dataset.talk = p.talking ? '1' : '0';
    const av = el('div', 'av', p.initials || '?');
    av.style.background = p.color || '#c9b38a';
    if (p.img) { const im = el('img'); im.alt = ''; im.src = p.img; av.append(im); }
    row.append(av, el('span', 'name', p.name));
    if (p.flag) row.append(el('span', `flag${p.flagKind ? ` ${p.flagKind}` : ''}`, p.flag));
    return row;
  }));
}

const shown = new Map();
function toast(t) {
  if (!t?.id || shown.has(t.id)) return;
  const node = el('div', `t${t.kind ? ` ${t.kind}` : ''}`);
  node.append(el('b', '', t.title || ''), el('span', '', t.text || ''));
  $('toasts').prepend(node);
  shown.set(t.id, node);
  while ($('toasts').children.length > 3) $('toasts').lastElementChild.remove();
  setTimeout(() => { node.classList.add('out'); setTimeout(() => { node.remove(); shown.delete(t.id); }, 320); }, Math.max(2000, t.ms || 5000));
}

window.overlay.onState(renderPeople);
window.overlay.onToast(toast);
