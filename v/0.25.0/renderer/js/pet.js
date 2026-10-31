// Живой 3D-персонаж в углу переписки (видите только вы).
// Модель — ваш .glb. Без скелета персонаж живёт «целиком»: дышит, покачивается, смотрит на курсор,
// подпрыгивает на новое сообщение, танцует под радио, слушает в звонке, засыпает, если вас долго нет.
// Если в модели есть анимации (например, из Mixamo), они включаются сами: idle, wave, dance, jump, sleep…
// Всё считается только когда окно видно, не чаще 30 кадров в секунду.

const $ = (id) => document.getElementById(id);
function pref(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } }
function setPref(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* не страшно */ } }

export const petPrefs = {
  get on() { return pref('som.pet', '0') === '1' && Boolean(this.file); },
  set on(v) { setPref('som.pet', v ? '1' : '0'); },
  get file() { return pref('som.pet.file', ''); },
  set file(v) { setPref('som.pet.file', v || null); },
  get name() { return pref('som.pet.name', ''); },
  set name(v) { setPref('som.pet.name', v || null); },
  get credit() { return pref('som.pet.credit', ''); },
  set credit(v) { setPref('som.pet.credit', v || null); },
  get size() { const v = Number(pref('som.pet.size', '260')); return Number.isFinite(v) ? Math.min(480, Math.max(140, v)) : 260; },
  set size(v) { setPref('som.pet.size', String(v)); },
  get react() { return pref('som.pet.react', '1') !== '0'; },
  set react(v) { setPref('som.pet.react', v ? '1' : '0'); },
  get pos() { try { const p = JSON.parse(pref('som.pet.pos', 'null')); return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : { x: 1, y: 1 }; } catch { return { x: 1, y: 1 }; } },
  set pos(v) { setPref('som.pet.pos', JSON.stringify(v)); },
};

const PHRASES = ['Привет!', 'Что делаем?', 'Погнали в игру?', 'Я тут, если что 👀', 'Скучно…', 'Включи музыку!', 'Ты сегодня молодец', 'Пиши, я подожду', 'Хи-хи', 'Только не щекотать!'];
let X = { status: () => ({}) };
let T = null; // three.js, грузится только когда персонаж включён
let P = null; // { box, hit, bubble, canvas, renderer, scene, camera, root, model, mixer, clips, ... }

async function three() {
  if (!T) {
    const [core, loader] = await Promise.all([import('../vendor/three/three.module.min.js'), import('../vendor/three/GLTFLoader.js')]);
    T = { ...core, GLTFLoader: loader.GLTFLoader };
  }
  return T;
}

// ---------- Слой ----------
function host() { return $('messages')?.parentElement || null; }
function ensureBox() {
  if (P?.box?.isConnected) return P;
  const h = host();
  if (!h) return null;
  const box = document.createElement('div');
  box.className = 'pet-box';
  box.setAttribute('aria-hidden', 'true');
  const canvas = document.createElement('canvas');
  canvas.className = 'pet-canvas';
  const hit = document.createElement('div');
  hit.className = 'pet-hit';
  hit.title = 'Щелчок — поздороваться · перетащите, чтобы подвинуть';
  const bubble = document.createElement('div');
  bubble.className = 'pet-bubble';
  bubble.hidden = true;
  const zzz = document.createElement('div');
  zzz.className = 'pet-zzz';
  zzz.hidden = true;
  zzz.textContent = 'z z Z';
  box.append(canvas, hit, bubble, zzz);
  h.append(box);
  P = { ...(P || {}), box, canvas, hit, bubble, zzz };
  wireHit();
  return P;
}

// ---------- Загрузка модели ----------
/** Проверить .glb и узнать, что внутри (для подписи автора по лицензии CC BY). */
export async function inspectModel(bytes) {
  const { GLTFLoader } = await three();
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  const ex = gltf.asset?.extras || {};
  const credit = [ex.title, ex.author ? `автор ${String(ex.author).replace(/\s*\(https?:[^)]*\)/, '')}` : '', ex.license ? String(ex.license).replace(/\s*\(https?:[^)]*\)/, '') : ''].filter(Boolean).join(' · ');
  let tris = 0;
  gltf.scene.traverse((o) => { if (o.isMesh) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
  dispose(gltf.scene);
  return { title: ex.title || '', credit, clips: gltf.animations.map((a) => a.name), tris: Math.round(tris), rigged: gltf.animations.length > 0 };
}

async function loadModel() {
  const t = await three();
  const p = ensureBox();
  if (!p) return;
  if (!p.renderer) {
    p.renderer = new t.WebGLRenderer({ canvas: p.canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
    p.renderer.outputColorSpace = t.SRGBColorSpace;
    p.scene = new t.Scene();
    p.scene.add(new t.HemisphereLight(0xffffff, 0x404050, 2.2));
    const sun = new t.DirectionalLight(0xffffff, 1.4);
    sun.position.set(1, 2, 2);
    p.scene.add(sun);
    p.camera = new t.PerspectiveCamera(26, 0.72, 0.05, 50);
    p.root = new t.Group();
    p.scene.add(p.root);
  }
  const file = petPrefs.file;
  if (p.loaded === file) return;
  if (p.model) { p.root.remove(p.model); dispose(p.model); p.model = null; p.mixer = null; }
  const gltf = await new t.GLTFLoader().loadAsync(`somlib://pet/${encodeURIComponent(file)}`);
  const model = gltf.scene;
  // Ставим на пол и приводим к росту 1: любая модель — одного размера.
  const box = new t.Box3().setFromObject(model);
  const size = box.getSize(new t.Vector3());
  const k = 1 / Math.max(0.0001, size.y);
  model.scale.setScalar(k);
  const c = box.getCenter(new t.Vector3());
  model.position.set(-c.x * k, -box.min.y * k, -c.z * k);
  const pivot = new t.Group(); // вращаем вокруг ступней
  p.rig = null;
  if (!gltf.animations.length) {
    const holder = new t.Group();
    holder.add(model);
    const r = autoRig(t, holder);
    // Старую геометрию освобождаем; материалы и текстуры остаются — их носит новая «скелетная» модель.
    if (r) { pivot.add(r.rig); p.rig = r.bones; model.traverse((n) => n.geometry?.dispose()); } else pivot.add(model);
  } else pivot.add(model);
  p.root.add(pivot);
  p.model = pivot;
  p.width = (size.x * k);
  p.loaded = file;
  p.mixer = null;
  p.clips = {};
  if (gltf.animations.length) {
    p.mixer = new t.AnimationMixer(model);
    const find = (...words) => gltf.animations.find((a) => words.some((w) => a.name.toLowerCase().includes(w)));
    p.clips = {
      idle: find('idle', 'breath', 'stand') || gltf.animations[0],
      wave: find('wave', 'hello', 'greet'),
      dance: find('dance', 'samba', 'hiphop', 'twerk'),
      jump: find('jump', 'happy', 'cheer'),
      sleep: find('sleep', 'lay', 'lying'),
      talk: find('talk', 'listen', 'nod'),
    };
    p.action = null;
    playClip('idle');
  }
  layout();
}
// ---------- Свой скелет для модели в T-позе ----------
// В модели нет костей — делаем свои: плечо и локоть с каждой стороны и голову. Вес вершин считаем по их
// месту (руки — всё, что дальше плеча по ширине на высоте рук; голова — всё, что выше шеи).
// Так даже «статуэтка» в T-позе опускает руки, машет, танцует и крутит головой.
function autoRig(t, model) {
  model.updateMatrixWorld(true);
  const meshes = [];
  model.traverse((o) => { if (o.isMesh && !o.isSkinnedMesh) meshes.push(o); });
  if (!meshes.length) return null;
  const pts = [];
  for (const m of meshes) {
    const pos = m.geometry.attributes.position;
    const v = new t.Vector3();
    const step = Math.max(1, Math.floor(pos.count / 20000));
    for (let i = 0; i < pos.count; i += step) { v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld); pts.push([v.x, v.y, v.z]); }
  }
  let maxX = 0;
  for (const p of pts) maxX = Math.max(maxX, Math.abs(p[0]));
  // T-поза: ширина размаха рук — больше 0,55 роста, а кисти — на одной высоте.
  if (maxX * 2 < 0.55) return null;
  const hands = pts.filter((p) => Math.abs(p[0]) > maxX * 0.8);
  const hy = hands.map((p) => p[1]).sort((a, b) => a - b);
  if (!hy.length || hy[hy.length - 1] - hy[0] > 0.2) return null;
  const armY = hy[Math.floor(hy.length / 2)];
  if (armY < 0.45 || armY > 0.92) return null;
  // Плечо: самая широкая точка груди чуть ниже линии рук (там, где рук ещё нет).
  const chest = pts.filter((p) => p[1] > armY - 0.15 && p[1] < armY - 0.045).map((p) => Math.abs(p[0])).sort((a, b) => a - b);
  if (chest.length < 50) return null;
  const xs = chest[Math.floor(chest.length * 0.97)] + 0.012;
  if (xs > maxX * 0.6) return null;
  const xe = xs + (maxX - xs) * 0.45;
  const arm = pts.filter((p) => Math.abs(p[0]) > xs + 0.03);
  const zc = arm.reduce((a, p) => a + p[2], 0) / Math.max(1, arm.length);
  const neckY = armY + 0.035;
  const head = pts.filter((p) => p[1] > neckY + 0.06);
  const zh = head.reduce((a, p) => a + p[2], 0) / Math.max(1, head.length);
  // Кости: корень → (плечо → локоть) ×2, голова.
  const root = new t.Bone();
  const mk = (parent, x, y, z) => { const b = new t.Bone(); b.position.set(x, y, z); parent.add(b); return b; };
  const upA = mk(root, xs, armY, zc); const foA = mk(upA, xe - xs, 0, 0);
  const upB = mk(root, -xs, armY, zc); const foB = mk(upB, -(xe - xs), 0, 0);
  const headB = mk(root, 0, neckY, zh);
  const bones = [root, upA, foA, upB, foB, headB];
  const rig = new t.Group();
  rig.add(root);
  rig.updateMatrixWorld(true); // обратные матрицы костей считаются от их места — сначала его посчитать
  const skeleton = new t.Skeleton(bones);
  const sm = (a, b, x) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
  for (const m of meshes) {
    const g = m.geometry.clone();
    g.applyMatrix4(m.matrixWorld);
    const pos = g.attributes.position;
    const si = new Uint16Array(pos.count * 4);
    const sw = new Float32Array(pos.count * 4);
    for (let i = 0; i < pos.count; i += 1) {
      const x = pos.getX(i); const y = pos.getY(i);
      const ax = Math.abs(x);
      // Толщина руки: вверх от линии рук — немного (над плечом уже волосы), вниз — больше (подмышка, кисть).
      const band = y >= armY ? 1 - sm(0.05, 0.075, y - armY) : 1 - sm(0.08, 0.12, armY - y);
      const wArm = sm(xs - 0.015, xs + 0.035, ax) * band;
      const wFore = wArm * sm(xe - 0.03, xe + 0.03, ax);
      // Голова — всё выше шеи; сбоку на высоте плеч (там руки) — только до ширины плеч, выше — целиком (волосы, уши).
      const inner = 1 - sm(xs, xs + 0.03, ax);
      const wHead = (1 - wArm) * sm(neckY - 0.005, neckY + 0.045, y) * (inner + (1 - inner) * sm(armY + 0.08, armY + 0.14, y));
      const side = x >= 0 ? 0 : 1;
      si[i * 4] = 0; si[i * 4 + 1] = side ? 3 : 1; si[i * 4 + 2] = side ? 4 : 2; si[i * 4 + 3] = 5;
      const wu = wArm - wFore;
      sw[i * 4] = Math.max(0, 1 - wArm - wHead); sw[i * 4 + 1] = wu; sw[i * 4 + 2] = wFore; sw[i * 4 + 3] = wHead;
    }
    g.setAttribute('skinIndex', new t.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new t.Float32BufferAttribute(sw, 4));
    const s2 = new t.SkinnedMesh(g, m.material);
    s2.frustumCulled = false;
    rig.add(s2);
    s2.updateMatrixWorld(true);
    s2.bind(skeleton);
  }
  return { rig, bones: { upA, foA, upB, foB, head: headB }, armY };
}

function dispose(o) {
  o.traverse((n) => {
    if (n.geometry) n.geometry.dispose();
    for (const m of [].concat(n.material || [])) { for (const v of Object.values(m)) if (v?.isTexture) v.dispose(); m.dispose(); }
  });
}
function playClip(name, once = false) {
  const p = P;
  const clip = p?.clips?.[name];
  if (!p?.mixer || !clip) return false;
  const a = p.mixer.clipAction(clip);
  if (p.action === a && !once) return true;
  a.reset();
  a.setLoop(once ? T.LoopOnce : T.LoopRepeat, once ? 1 : Infinity);
  a.clampWhenFinished = once;
  a.fadeIn(0.25).play();
  if (p.action && p.action !== a) p.action.fadeOut(0.25);
  p.action = a;
  if (once) {
    const back = () => { p.mixer.removeEventListener('finished', back); if (p.action === a) { p.action = null; playClip(state.mode === 'dance' ? 'dance' : state.mode === 'sleep' ? 'sleep' : 'idle'); } };
    p.mixer.addEventListener('finished', back);
  }
  return true;
}

// ---------- Размер и место ----------
function layout() {
  const p = P;
  const h = host();
  if (!p?.box || !h) return;
  const msgs = $('messages');
  const H = petPrefs.size;
  const W = Math.round(H * 0.72);
  const area = { left: msgs.offsetLeft, top: msgs.offsetTop, w: msgs.offsetWidth, h: msgs.offsetHeight };
  const pos = petPrefs.pos;
  const x = area.left + Math.max(0, area.w - W) * Math.min(1, Math.max(0, pos.x));
  const y = area.top + Math.max(0, area.h - H) * Math.min(1, Math.max(0, pos.y));
  Object.assign(p.box.style, { left: `${Math.round(x)}px`, top: `${Math.round(y)}px`, width: `${W}px`, height: `${H}px` });
  p.box.hidden = msgs.hidden || area.h < 120 || !petPrefs.on;
  if (p.renderer) {
    p.renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
    p.renderer.setSize(W, H, false);
    p.camera.aspect = W / H;
    // Камера: весь рост с небольшим запасом сверху (для прыжков).
    const dist = 1.32 / (2 * Math.tan((p.camera.fov * Math.PI) / 360));
    p.camera.position.set(0, 0.6, dist);
    p.camera.lookAt(0, 0.56, 0);
    p.camera.updateProjectionMatrix();
  }
}

// ---------- Поведение ----------
const state = {
  mode: 'idle', // idle | dance | sleep
  t: 0, last: 0, raf: 0,
  yaw: 0, pitch: 0, lookX: 0, lookY: 0, lastPointer: performance.now(), lastInput: performance.now(),
  hop: null, spin: null, wave: null, typing: 0, listen: 0,
  pose: { aZ: -1.2, bZ: 1.2, aX: 0, bX: 0, faZ: 0, fbZ: 0, hX: 0, hY: 0, hZ: 0 },
  sleepK: 0,
};
const ease = (x) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);
function say(text, ms = 3500) {
  const b = P?.bubble;
  if (!b || !text) return;
  b.textContent = text;
  b.hidden = false;
  b.classList.remove('show');
  void b.offsetWidth;
  b.classList.add('show');
  clearTimeout(b._t);
  b._t = setTimeout(() => { b.classList.remove('show'); setTimeout(() => { b.hidden = true; }, 250); }, ms);
}
function wake() {
  if (state.mode === 'sleep') { state.mode = 'idle'; P.zzz.hidden = true; say('Ой, я задремала 😳', 2500); playClip('idle'); }
}
/** События из Som: новое сообщение, печатаете, праздник. */
export function petEvent(kind, info = {}) {
  if (!petPrefs.on || !P?.model || !petPrefs.react) return;
  const now = performance.now();
  if (kind === 'message') { wake(); state.hop = { t0: now, n: 1 }; if (!playClip('jump', true)) { /* прыжок сам по себе */ } say(info.name ? `Тебе пишет ${info.name}!` : 'Новое сообщение!'); }
  else if (kind === 'typing') { wake(); state.typing = now; }
  else if (kind === 'celebrate') { wake(); state.hop = { t0: now, n: 3 }; playClip('jump', true) || playClip('dance', true); say('Ура-а! 🎉', 2500); }
  else if (kind === 'call') { wake(); say(info.text || 'Звонок!', 3000); state.hop = { t0: now, n: 2 }; }
}

/** Поза своего скелета: руки, локти, голова — плавно к цели. */
function poseRig(b, t, dt, now, headYaw) {
  const g = { aZ: -1.22 + Math.sin(t * 1.1) * 0.03, bZ: 1.22 - Math.sin(t * 1.1 + 0.6) * 0.03, aX: Math.sin(t * 0.9) * 0.05, bX: -Math.sin(t * 0.9) * 0.05, faZ: -0.12, fbZ: 0.12, hX: state.pitch * 0.8, hY: headYaw, hZ: Math.sin(t * 0.7) * 0.03 };
  if (state.mode === 'dance') {
    const beat = t * Math.PI * 2 * 1.05;
    g.aZ = -0.2 + Math.sin(beat) * 0.9; g.bZ = 0.2 + Math.sin(beat + Math.PI) * 0.9;
    g.faZ = -0.5 - Math.max(0, Math.sin(beat)) * 0.6; g.fbZ = 0.5 + Math.max(0, Math.sin(beat + Math.PI)) * 0.6;
    g.hX = Math.sin(beat * 2) * 0.12; g.hZ = Math.sin(beat) * 0.12;
  }
  if (state.typing && now - state.typing < 2500) { g.hX = 0.22; g.hY *= 0.3; g.faZ = -0.5; g.fbZ = 0.5; g.aX = -0.35; g.bX = -0.35; }
  g.hZ += state.listen * 0.18;
  if (state.hop) { g.aZ = 0.5; g.bZ = -0.5; g.faZ = -0.4; g.fbZ = 0.4; }
  if (state.wave) {
    const k = (now - state.wave.t0) / 1800;
    if (k >= 1) state.wave = null;
    else { g.aZ = 1.15; g.faZ = 0.55 + Math.sin(k * Math.PI * 7) * 0.45; g.hZ = -0.12; }
  }
  if (state.sleepK > 0.01) {
    const k = state.sleepK;
    g.hX = g.hX * (1 - k) + 0.5 * k; g.hY *= 1 - k; g.hZ = g.hZ * (1 - k) + 0.12 * k;
    g.aZ = g.aZ * (1 - k) - 1.35 * k; g.bZ = g.bZ * (1 - k) + 1.35 * k;
  }
  const c = state.pose;
  const f = Math.min(1, dt * (state.wave || state.hop ? 14 : 7));
  for (const k of Object.keys(g)) c[k] += (g[k] - c[k]) * f;
  b.upA.rotation.set(c.aX, 0, c.aZ);
  b.upB.rotation.set(c.bX, 0, c.bZ);
  b.foA.rotation.set(0, 0, c.faZ);
  b.foB.rotation.set(0, 0, c.fbZ);
  b.head.rotation.set(Math.max(-0.35, Math.min(0.55, c.hX)), Math.max(-0.6, Math.min(0.6, c.hY)), c.hZ, 'YXZ');
}

function tick(now) {
  state.raf = requestAnimationFrame(tick);
  const p = P;
  if (!p?.model || p.box.hidden || document.hidden || document.documentElement.dataset.bg === '1') { state.last = now; return; }
  if (now - state.last < 33) return; // 30 к/с
  const dt = Math.min(0.1, (now - state.last) / 1000);
  state.last = now;
  state.t += dt;
  const t = state.t;
  const st = X.status() || {};
  // Режим: музыка → танец; давно нет вас → сон.
  const away = now - state.lastInput > 3 * 60 * 1000;
  if (petPrefs.react && away && state.mode !== 'sleep' && !st.call) { state.mode = 'sleep'; p.zzz.hidden = false; playClip('sleep'); }
  else if (state.mode !== 'sleep') {
    const want = petPrefs.react && st.music ? 'dance' : 'idle';
    if (want !== state.mode) { state.mode = want; playClip(want === 'dance' ? 'dance' : 'idle'); if (want === 'dance') say('Обожаю эту песню! 💃', 2500); }
  }
  state.sleepK += ((state.mode === 'sleep' ? 1 : 0) - state.sleepK) * Math.min(1, dt * 2);
  state.listen += (((petPrefs.react && st.peerTalking) ? 1 : 0) - state.listen) * Math.min(1, dt * 4);
  // Взгляд на курсор (если давно не двигали мышь — смотрит прямо, иногда по сторонам).
  const idleLook = now - state.lastPointer > 6000;
  const tx = idleLook ? Math.sin(t * 0.37) * 0.35 : state.lookX;
  const ty = idleLook ? 0 : state.lookY;
  state.yaw += (tx * 0.65 - state.yaw) * Math.min(1, dt * 5);
  state.pitch += (ty * 0.18 - state.pitch) * Math.min(1, dt * 5);
  const m = p.model;
  let y = 0; let rx = state.pitch; let rz = Math.sin(t * 0.9) * 0.02; let ry = state.yaw; let sx = 1; let sy = 1 + Math.sin(t * 2.2) * 0.012;
  if (!p.mixer && state.mode === 'dance') {
    const beat = t * Math.PI * 2 * 1.05; // ~126 ударов в минуту
    y += Math.abs(Math.sin(beat)) * 0.045;
    ry += Math.sin(beat / 2) * 0.45;
    rz += Math.sin(beat / 2) * 0.08;
    sy *= 1 - Math.max(0, -Math.cos(beat * 2)) * 0.02;
  }
  if (state.typing && now - state.typing < 2500) { rx += 0.1; ry += (0 - ry) * 0.5; }
  rz += state.listen * 0.09;
  if (state.hop) {
    const k = (now - state.hop.t0) / 420;
    if (k >= state.hop.n) state.hop = null;
    else {
      const f = k % 1;
      y += Math.sin(f * Math.PI) * 0.12;
      if (f < 0.12) sy *= 1 - (0.12 - f) * 0.6; // присела перед прыжком
      if (f > 0.88) sy *= 1 - (f - 0.88) * 0.5; // приземлилась
    }
  }
  if (state.spin) {
    const k = (now - state.spin.t0) / 800;
    if (k >= 1) state.spin = null; else ry += ease(k) * Math.PI * 2;
  }
  // Сон: клюёт носом — наклоняется вперёд и медленно дышит (если в модели нет своей анимации сна).
  if (!p.clips?.sleep && state.sleepK > 0.001) {
    const k = state.sleepK;
    rx = rx * (1 - k) + k * ((p.rig ? 0.08 : 0.32) + Math.sin(t * 0.8) * 0.03);
    ry *= 1 - k;
    rz = rz * (1 - k) + k * 0.06;
    sy = sy * (1 - k) + k * (0.97 + Math.sin(t * 1.2) * 0.012);
  }
  if (p.rig) {
    // Свой скелет: голова смотрит на курсор, тело поворачивается меньше.
    const headYaw = state.yaw * 0.45;
    ry -= state.yaw * 0.45; // остальное повернёт голова
    poseRig(p.rig, t, dt, now, headYaw);
  }
  sx = 1 / Math.sqrt(sy);
  m.position.y = y;
  m.rotation.set(rx, ry, rz, 'YXZ');
  m.scale.set(sx, sy, sx);
  p.mixer?.update(dt);
  p.renderer.render(p.scene, p.camera);
  placeHit();
}
/** Зона щелчка — по силуэту модели на экране (примерно), а не весь квадрат. */
function placeHit() {
  const p = P;
  const w = p.box.clientWidth;
  const h = p.box.clientHeight;
  const hw = Math.min(w * 0.95, (p.width / 1.32) * h * 0.85);
  const hh = h * 0.86;
  Object.assign(p.hit.style, { width: `${Math.round(hw)}px`, height: `${Math.round(hh)}px`, left: `${Math.round((w - hw) / 2)}px`, top: `${Math.round(h - hh - h * 0.04)}px` });
}

function wireHit() {
  const p = P;
  let drag = null;
  p.hit.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    p.hit.setPointerCapture(e.pointerId);
    drag = { x0: e.clientX, y0: e.clientY, l: p.box.offsetLeft, t: p.box.offsetTop, moved: false };
  });
  p.hit.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x0;
    const dy = e.clientY - drag.y0;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    drag.moved = true;
    p.box.classList.add('drag');
    const msgs = $('messages');
    const W = p.box.offsetWidth; const H = p.box.offsetHeight;
    const fx = (drag.l + dx - msgs.offsetLeft) / Math.max(1, msgs.offsetWidth - W);
    const fy = (drag.t + dy - msgs.offsetTop) / Math.max(1, msgs.offsetHeight - H);
    petPrefs.pos = { x: Math.min(1, Math.max(0, fx)), y: Math.min(1, Math.max(0, fy)) };
    layout();
  });
  const up = () => {
    if (!drag) return;
    const was = drag;
    drag = null;
    p.box.classList.remove('drag');
    if (!was.moved) {
      wake();
      if (P.rig) state.wave = { t0: performance.now() };
      else state.spin = { t0: performance.now() };
      if (!P.rig && !playClip('wave', true)) playClip('jump', true);
      say(PHRASES[Math.floor(Math.random() * PHRASES.length)], 2600);
    }
  };
  p.hit.addEventListener('pointerup', up);
  p.hit.addEventListener('pointercancel', up);
}

function onPointer(e) {
  state.lastPointer = performance.now();
  state.lastInput = state.lastPointer;
  if (!P?.box || P.box.hidden) return;
  const r = P.box.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height * 0.25;
  state.lookX = Math.max(-1, Math.min(1, (e.clientX - cx) / 500));
  state.lookY = Math.max(-1, Math.min(1, (e.clientY - cy) / 400));
  if (state.mode === 'sleep' && Math.abs(e.movementX) + Math.abs(e.movementY) > 30) wake();
}

/** Включить/выключить и применить настройки. */
export async function applyPet() {
  if (!petPrefs.on) { if (P?.box) P.box.hidden = true; return; }
  ensureBox();
  try { await loadModel(); } catch (err) {
    X.toast?.(`3D-персонаж не загрузился: ${err.message}`, 'bad');
    petPrefs.on = false;
    if (P?.box) P.box.hidden = true;
    return;
  }
  layout();
  if (!state.raf) state.raf = requestAnimationFrame(tick);
}

export function initPet(deps) {
  X = { ...X, ...deps };
  window.addEventListener('pointermove', onPointer, { passive: true });
  window.addEventListener('keydown', () => { state.lastInput = performance.now(); wake(); }, { passive: true });
  window.addEventListener('resize', () => layout());
  window.addEventListener('som:burst', () => petEvent('celebrate'));
  const msgs = $('messages');
  if (msgs) new ResizeObserver(() => layout()).observe(msgs);
  applyPet();
}
export { layout as petLayout };
