// Выбор кодека демки — с пояснениями и с тем, что умеет этот ПК (кодирует видеокарта или процессор).
import { screenPrefs } from './call.js';

const $ = (id) => document.getElementById(id);
const CODECS = [
  { id: 'auto', name: 'Авто', tag: 'рекомендуется',
    text: 'Som сам берёт лучшее из того, что кодирует видеокарта: сначала H.265, потом H.264. Если видеокарта не умеет ни того, ни другого — VP9, AV1 или VP8. Подходит почти всем.' },
  { id: 'H264', name: 'H.264', tag: 'самый совместимый',
    text: 'Показывает и смотрит любой ПК, почти любая видеокарта кодирует его сама — игра почти не теряет FPS. Картинка при том же канале чуть хуже, чем у H.265 и AV1: в динамичных сценах больше «квадратиков». Берите, если у друга старый или слабый ПК.' },
  { id: 'H265', name: 'H.265 (HEVC)', tag: 'чище при том же канале',
    text: 'Та же картинка, что у H.264, примерно при вдвое меньшем канале — или заметно чище при том же. Кодирует видеокарта: NVIDIA GTX 950 и новее, AMD RX 400 и новее, Intel с 6-го поколения. Смотреть может тот, чья видеокарта его понимает, — иначе Som перейдёт на H.264.' },
  { id: 'AV1', name: 'AV1', tag: 'лучшее качество',
    text: 'Самая чёткая картинка на тот же канал — особенно мелкие детали и текст в игре. Видеокартой кодируют только новые: NVIDIA RTX 40 и 50, AMD RX 7000 и новее, Intel Arc. На остальных — процессором, и это ощутимо отнимет FPS. Смотреть тоже лучше на новом ПК.' },
  { id: 'VP9', name: 'VP9', tag: 'для рабочего стола',
    text: 'Хорошая картинка и чёткий текст даже при слабом канале, смотрит любой ПК. Но кодирует его почти всегда процессор: в тяжёлой игре упадут FPS. Хорош для показа рабочего стола, кода, документов.' },
  { id: 'VP8', name: 'VP8', tag: 'запасной',
    text: 'Старый и простой: смотрит любой ПК, но картинка хуже всех, а кодирует процессор. Пригодится, если с другими кодеками демка рвётся или идёт с зелёными артефактами.' },
];

let probe = null;
/** Что умеет этот ПК: показать (кодировать) и смотреть (декодировать) — видеокартой, процессором или никак. */
function detect() {
  if (probe) return probe;
  probe = (async () => {
    const out = {};
    const send = RTCRtpSender.getCapabilities?.('video')?.codecs || [];
    const recv = RTCRtpReceiver.getCapabilities?.('video')?.codecs || [];
    const mc = navigator.mediaCapabilities;
    const ask = async (fn, caps, mime) => {
      const cap = caps.find((c) => c.mimeType === mime);
      if (!cap) return 'no';
      const video = { width: 1920, height: 1080, bitrate: 8_000_000, framerate: 60 };
      for (const contentType of [cap.sdpFmtpLine ? `${mime};${cap.sdpFmtpLine}` : mime, mime]) {
        try {
          const r = await mc[fn]({ type: 'webrtc', video: { ...video, contentType } });
          if (!r.supported) return 'no';
          return r.powerEfficient ? 'gpu' : 'cpu';
        } catch { /* попробуем без параметров */ }
      }
      return 'yes'; // поддерживается, но кто считает — неизвестно
    };
    for (const c of CODECS.slice(1)) {
      const mime = `video/${c.id}`;
      out[c.id] = { enc: await ask('encodingInfo', send, mime), dec: await ask('decodingInfo', recv, mime) };
    }
    return out;
  })();
  return probe;
}
const WHO = { gpu: 'видеокарта', cpu: 'процессор', yes: 'есть', no: 'нет' };
function badge(label, v) {
  const b = document.createElement('span');
  b.className = 'cd-badge';
  b.dataset.v = v;
  b.textContent = `${label}: ${WHO[v] || '…'}`;
  b.title = v === 'gpu' ? 'Считает видеокарта — игре почти не мешает' : v === 'cpu' ? 'Считает процессор — в тяжёлой игре упадут FPS' : v === 'no' ? 'Этот ПК так не умеет' : '';
  return b;
}

export async function renderCodecs() {
  const box = $('codecList');
  if (!box) return;
  const cur = screenPrefs.codec;
  const caps = await detect().catch(() => ({}));
  box.replaceChildren(...CODECS.map((c) => {
    const k = caps[c.id];
    const label = document.createElement('label');
    label.className = 'codec-card';
    label.dataset.on = String(c.id === cur);
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'screenCodec';
    input.value = c.id;
    input.checked = c.id === cur;
    input.disabled = Boolean(k && k.enc === 'no');
    input.addEventListener('change', () => { screenPrefs.codec = c.id; renderCodecs(); });
    const head = document.createElement('span');
    head.className = 'cd-head';
    const name = document.createElement('b');
    name.textContent = c.name;
    const tag = document.createElement('span');
    tag.className = 'cd-tag';
    tag.textContent = c.tag;
    head.append(name, tag);
    if (k) head.append(badge('показ', k.enc), badge('просмотр', k.dec));
    const text = document.createElement('span');
    text.className = 'cd-text';
    text.textContent = k?.enc === 'no' ? `${c.text} На этом ПК показывать в нём нельзя.` : c.text;
    label.append(input, head, text);
    return label;
  }));
}
