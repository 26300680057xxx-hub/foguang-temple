import { loadChunkedGltf } from './chunked-model-loader.js';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const sceneHost = $('#scene');
const scene = new THREE.Scene();
// The transparent canvas lets the exhibition backdrop continue behind the model.
scene.background = null;
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 500);
camera.position.set(44, 31, 61);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
const compactDevice = matchMedia('(max-width: 720px)').matches;
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, compactDevice ? 1.5 : 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.setClearColor(0x000000, 0);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// The architecture is static: reuse its shadow map while orbiting.
renderer.shadowMap.autoUpdate = false;
sceneHost.appendChild(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = .07;
controls.target.set(0, 6.5, 0);
controls.minDistance = 2;
controls.maxDistance = 250;
controls.maxPolarAngle = Math.PI * .49;

const skyLight = new THREE.HemisphereLight(0xfff7e8, 0x847568, 1.35);
scene.add(skyLight);
const key = new THREE.DirectionalLight(0xffeed7, 2.6);
key.position.set(-30, 45, 28);
key.target.position.set(0, 6, 0);
key.castShadow = true;
key.shadow.mapSize.set(compactDevice ? 2048 : 4096, compactDevice ? 2048 : 4096);
Object.assign(key.shadow.camera, { left: -34, right: 34, top: 30, bottom: -30, near: 1, far: 130 });
key.shadow.bias = -.00015;
key.shadow.normalBias = .035;
key.shadow.camera.updateProjectionMatrix();
scene.add(key);
scene.add(key.target);
const fill = new THREE.DirectionalLight(0xd9e5ee, .9);
fill.position.set(35, 24, -25);
scene.add(fill);
const rim = new THREE.DirectionalLight(0xffe3b5, 1.15);
rim.position.set(12, 24, -30);
scene.add(rim);
const interior = new THREE.PointLight(0xffe0b3, 28, 24, 2);
interior.position.set(0, 5.5, 2);
scene.add(interior);

// A local studio environment gives rough wood and stone soft reflected light.
// It requires no remote HDR image and never replaces the supplied textures.
const studio = new THREE.Scene();
studio.background = new THREE.Color(0x9b9487);
const studioBox = new THREE.Mesh(new THREE.BoxGeometry(100, 80, 100), new THREE.MeshBasicMaterial({ color: 0xc7c1b4, side: THREE.BackSide }));
studio.add(studioBox);
const softboxes = [
  [[-20, 30, 15], [35, 25, 1], 0xfff4de, 3],
  [[30, 15, -20], [22, 35, 1], 0xd9e5ef, 1.5]
];
softboxes.forEach(([position, scale, color, intensity]) => {
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }));
  panel.position.set(...position); panel.scale.set(...scale); panel.lookAt(0, 0, 0); studio.add(panel);
});
const pmrem = new THREE.PMREMGenerator(renderer);
const environment = pmrem.fromScene(studio, .08, .1, 150);
scene.environment = environment.texture;
scene.environmentIntensity = .32;
studio.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
pmrem.dispose();

const ground = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), new THREE.ShadowMaterial({ color: 0x453b2e, opacity: .22 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
const contactCanvas = document.createElement('canvas');
contactCanvas.width = contactCanvas.height = 128;
const contactContext = contactCanvas.getContext('2d');
const contactGradient = contactContext.createRadialGradient(64, 64, 18, 64, 64, 64);
contactGradient.addColorStop(0, 'rgba(61,49,34,0.20)');
contactGradient.addColorStop(.65, 'rgba(61,49,34,0.10)');
contactGradient.addColorStop(1, 'rgba(61,49,34,0)');
contactContext.fillStyle = contactGradient; contactContext.fillRect(0, 0, 128, 128);
const contact = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(contactCanvas), transparent: true, depthWrite: false, toneMapped: false }));
contact.rotation.x = -Math.PI / 2;
scene.add(contact);

let model = null;
let pickMode = false;
let selected = null;
let selectedMaterial = null;
let frameRequested = true;
let mode = 'orbit';
let chapter = 0;
let doorOpen = false;
let doorParts = [];
const keys = new Set();
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const focus = { object: null, from: null, to: null, targetFrom: null, targetTo: null, t: 1 };

const loading = $('#loading');
const loadingText = $('#loading-text');
const loadingFill = $('#loading-fill');
const toast = $('#toast');
function showToast(message) {
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('visible'), 2400);
}
function requestRender() { frameRequested = true; }
function updateShadows() { renderer.shadowMap.needsUpdate = true; requestRender(); }
function fitRenderer() {
  const w = sceneHost.clientWidth || innerWidth, h = sceneHost.clientHeight || innerHeight;
  camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h, false); requestRender();
}
addEventListener('resize', fitRenderer); fitRenderer();
camera.position.sub(controls.target).multiplyScalar(Math.max(1, 1.05 / camera.aspect)).add(controls.target);
controls.addEventListener('change', requestRender);
controls.addEventListener('start', () => { focus.t = 1; });

function allNamed(name) {
  const keyName = String(name).toLowerCase();
  const result = [];
  if (!model) return result;
  model.traverse(o => { if ((o.name || '').toLowerCase().includes(keyName)) result.push(o); });
  return result;
}
function findLayer(layer) {
  const terms = {
    roof: ['FGS_RealTiles_','FGS_AI_ExteriorRoof_ROOT','FGS_Roof_Details_ROOT','FGS_LJ_Tiles_','FGS_LJ_RidgeTiles_','FGS_LJ_Boards_'],
    enclosure: ['FGS_Enclosure_'],
    columns: ['FGS_EastHall_柱网层_ROOT'],
    brackets: ['FGS_PuzuoLayer_'],
    frame: ['FGS_LiangjiaLayer_'],
    buddha: ['FGS_Buddha_佛像总组_ROOT']
  }[layer] || [];
  const found = [];
  if (!model) return found;
  model.traverse(o => {
    const n = (o.name || '').toLowerCase();
    if (terms.some(t => n.includes(t.toLowerCase()))) found.push(o);
  });
  return found;
}
function setLayer(layer, visible) {
  findLayer(layer).forEach(o => { o.visible = visible; });
  if (layer === 'roof') allNamed('FGS_Pingan_').forEach(o => { o.visible = visible; });
  updateShadows();
}

function loadModel() {
  loading.classList.remove('loaded');
  loading.removeAttribute('aria-hidden');
  const loader = new GLTFLoader();
  loadChunkedGltf(loader, new URL('./model/manifest.json', import.meta.url), gltf => {
    model = gltf.scene;
    model.name = '佛光寺东大殿 · 可探索模型';
    scene.add(model);
    model.traverse(o => {
      if (o.name && (o.name.includes('HINGE') || o.userData?.component_role === 'door_leaf_hinge')) {
        o.parent?.updateWorldMatrix(true, false);
        const parentQ = o.parent ? o.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion();
        const axis = new THREE.Vector3(0,1,0).applyQuaternion(parentQ.invert()).normalize();
        doorParts.push({ object: o, base: o.quaternion.clone(), axis, angle: 0, goal: 0, side: o.name.includes('右') || o.name.toLowerCase().includes('right') ? -1 : 1 });
      }
      if (o.isMesh) {
        // Roof boards cast the roof silhouette; thousands of tiny tiles need
        // not be rendered again in the shadow pass. Transparent photo cutouts
        // keep their original alpha and do not cast rectangular shadows.
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        const name = o.name || '';
        o.castShadow = !name.startsWith('FGS_RT_') && !mats.some(m => m.transparent);
        o.receiveShadow = true;
        mats.forEach(m => {
          [m.map, m.normalMap, m.roughnessMap].filter(Boolean).forEach(t => { t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy()); });
        });
      }
    });
    const bounds = new THREE.Box3().setFromObject(model);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    ground.position.set(center.x, bounds.min.y - .035, center.z);
    contact.position.set(center.x, bounds.min.y - .025, center.z);
    contact.scale.set(size.x * 1.65, size.z * 1.8, 1);
    updateShadows();
    loadingText.textContent = '殿堂与彩塑已就位'; loadingFill.style.width = '100%';
    setTimeout(() => { loading.classList.add('loaded'); loading.setAttribute('aria-hidden', 'true'); }, 500);
    requestRender();
  }, xhr => {
    const p = xhr.total ? xhr.loaded / xhr.total * 100 : 0;
    loadingText.textContent = p ? `正在展开殿堂… ${Math.round(p)}%` : '正在载入殿堂与彩塑…';
    loadingFill.style.width = `${Math.max(4, p)}%`;
  }, () => {
    loadingText.textContent = '载入暂未完成，点击此处重试'; loadingText.style.cursor = 'pointer'; loadingText.onclick = () => { loadingText.onclick = null; loadingText.style.cursor = ''; loadModel(); }; loadingFill.style.width = '20%';
    showToast('模型暂时不可用');
  });
}
loadModel();

const lightingLooks = {
  daylight: { sky: 1.35, key: 2.6, fill: .9, rim: 1.15, exposure: 1.08, color: 0xffeed7, environment: .32 },
  sunset: { sky: 1.1, key: 2.8, fill: .8, rim: 1.5, exposure: 1.05, color: 0xffd2a2, environment: .28 }
};
$$('[data-lighting]').forEach(button => button.addEventListener('click', () => {
  const look = lightingLooks[button.dataset.lighting];
  skyLight.intensity = look.sky; key.intensity = look.key; key.color.setHex(look.color);
  fill.intensity = look.fill; rim.intensity = look.rim;
  renderer.toneMappingExposure = look.exposure; scene.environmentIntensity = look.environment;
  $$('[data-lighting]').forEach(b => { b.classList.toggle('selected', b === button); b.setAttribute('aria-pressed', String(b === button)); });
  document.body.dataset.lighting = button.dataset.lighting;
  requestRender();
}));
$('#render-quality').addEventListener('change', e => {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, e.target.value === 'fine' ? 2 : 1));
  fitRenderer();
});

function view(position, target, label) {
  focus.object = null; focus.from = camera.position.clone(); focus.to = new THREE.Vector3(...position);
  focus.targetFrom = controls.target.clone(); focus.targetTo = new THREE.Vector3(...target); focus.t = 0;
  $('#view-label').textContent = label || '东大殿 · 自由观察'; requestRender();
}
function preset(name) {
  const presets = {
    home: [[44, 31, 61], [0, 6.5, 0], '东大殿 · 整体环绕'],
    front: [[0, 11, 61], [0, 7, 0], '东大殿 · 七开间立面'],
    roof: [[22, 42, 33], [0, 10, 0], '东大殿 · 屋顶俯瞰'],
    side: [[-47, 18, 22], [0, 7, 0], '东大殿 · 深远出檐'],
    bracket: [[-15, 8.5, 16], [-12.5, 7.5, 8.7], '东大殿 · 斗拱近景'],
    interior: [[0, 2.8, 7], [0, 3.3, -3], '东大殿 · 殿内彩塑']
  };
  const p = presets[name] || presets.home;
  // Pull back the overall views on tall screens so the eaves remain in frame.
  const position = new THREE.Vector3(...p[0]);
  const target = new THREE.Vector3(...p[1]);
  if (!['bracket', 'interior'].includes(name)) {
    position.sub(target).multiplyScalar(Math.max(1, 1.05 / camera.aspect)).add(target);
  }
  view(position.toArray(), p[1], p[2]);
}
function tickFocus() {
  if (focus.t >= 1) return false;
  focus.t = Math.min(1, focus.t + .045);
  const e = focus.t < .5 ? 2 * focus.t * focus.t : 1 - Math.pow(-2 * focus.t + 2, 2) / 2;
  camera.position.lerpVectors(focus.from, focus.to, e);
  controls.target.lerpVectors(focus.targetFrom, focus.targetTo, e);
  camera.lookAt(controls.target);
  return true;
}

function setWalkMode(next) {
  mode = next;
  const walk = mode === 'walk';
  controls.enabled = !walk;
  $('#orbit-mode').classList.toggle('selected', !walk); $('#orbit-mode').setAttribute('aria-pressed', String(!walk));
  $('#walk-mode').classList.toggle('selected', walk); $('#walk-mode').setAttribute('aria-pressed', String(walk));
  $('#walk-pad').hidden = !walk;
  $('#gesture-hint').textContent = walk ? '拖动转头 · WASD 行走 · Q/E 升降' : '拖动环绕 · 滚轮缩放 · 右键平移';
  requestRender();
}
$('#orbit-mode').addEventListener('click', () => setWalkMode('orbit'));
$('#walk-mode').addEventListener('click', () => setWalkMode('walk'));

function animateDoor(open) {
  doorOpen = open;
  $('#door-toggle').setAttribute('aria-checked', String(open)); $('#door-label').textContent = open ? '开启' : '闭合';
  doorParts.forEach(d => { d.goal = open ? d.side * Math.PI / 2 : 0; });
  requestRender();
}
$('#door-toggle').addEventListener('click', () => animateDoor(!doorOpen));

function selectObject(obj) {
  if (selected && selectedMaterial) { const mats = Array.isArray(selected.material) ? selected.material : [selected.material]; mats.forEach(m => m.dispose()); selected.material = selectedMaterial; selectedMaterial = null; }
  selected = obj;
  if (!obj) { $('#part-card').hidden = true; requestRender(); return; }
  if (obj.material) {
    selectedMaterial = obj.material; obj.material = Array.isArray(obj.material) ? obj.material.map(m => m.clone()) : obj.material.clone();
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    mats.forEach(m => { if (m.emissive) { m.emissive.set('#A34535'); m.emissiveIntensity = .65; } else if (m.color) m.color.offsetHSL(0, .05, .12); });
  }
  let label = obj.name || '木构构件';
  const names = [['column','柱网构件'],['puzuo','铺作层构件'],['bracket','斗拱构件'],['beam','梁架构件'],['rafter','椽檩构件'],['tile','屋面瓦件'],['buddha','殿内彩塑'],['door','殿门构件']];
  const hit = names.find(([k]) => label.toLowerCase().includes(k));
  if (hit) label = hit[1];
  $('#part-title').textContent = label;
  $('#part-description').textContent = '这是东大殿木构体系中的一件构件。拖动环绕，可从不同角度观察它与整体的关系。';
  $('#part-card').hidden = false; requestRender();
}
$('#close-part').addEventListener('click', () => selectObject(null));
$('#focus-part').addEventListener('click', () => {
  if (!selected) return;
  const box = new THREE.Box3().setFromObject(selected), c = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3()).length();
  const dir = camera.position.clone().sub(c).normalize();
  view(c.clone().add(dir.multiplyScalar(Math.max(2, size * 2.5))).toArray(), c.toArray(), '东大殿 · 构件细看');
});
$('#pick-toggle').addEventListener('click', e => { pickMode = !pickMode; e.currentTarget.setAttribute('aria-pressed', String(pickMode)); e.currentTarget.classList.toggle('selected', pickMode); showToast(pickMode ? '点击木构件查看说明' : '已关闭构件选择'); });
renderer.domElement.addEventListener('pointerdown', e => {
  if (!pickMode || e.button !== 0 || !model) return;
  const r = renderer.domElement.getBoundingClientRect(); pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1; pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const visible = o => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
  const hit = raycaster.intersectObject(model, true).find(h => h.object.isMesh && visible(h.object));
  selectObject(hit ? hit.object : null);
});

function updateWalk(dt) {
  if (mode !== 'walk') return false;
  const forward = new THREE.Vector3(); camera.getWorldDirection(forward); forward.y = 0; forward.normalize();
  const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
  const speed = keys.has('shift') ? 12 : 5;
  const move = new THREE.Vector3();
  if (keys.has('w') || keys.has('arrowup')) move.add(forward);
  if (keys.has('s') || keys.has('arrowdown')) move.sub(forward);
  if (keys.has('d') || keys.has('arrowright')) move.add(right);
  if (keys.has('a') || keys.has('arrowleft')) move.sub(right);
  if (keys.has('e')) move.y += 1;
  if (keys.has('q')) move.y -= 1;
  if (!move.lengthSq()) return false;
  camera.position.addScaledVector(move.normalize(), speed * dt); controls.target.addScaledVector(move.normalize(), speed * dt); return true;
}
addEventListener('keydown', e => { if (/INPUT|TEXTAREA|BUTTON|DIALOG/.test(e.target.tagName)) return; const k = e.key.toLowerCase(); if (['w','a','s','d','q','e','shift','arrowup','arrowdown','arrowleft','arrowright'].includes(k)) { keys.add(k); if (mode === 'walk') e.preventDefault(); } });
addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());
let lookDrag = null;
const lookEuler = new THREE.Euler(0,0,0,'YXZ');
renderer.domElement.addEventListener('pointerdown', e => { if (mode !== 'walk' || pickMode || e.button !== 0) return; lookDrag = { id:e.pointerId, x:e.clientX, y:e.clientY }; renderer.domElement.setPointerCapture(e.pointerId); focus.t = 1; });
renderer.domElement.addEventListener('pointermove', e => {
  if (!lookDrag || mode !== 'walk') return;
  const dx = e.clientX - lookDrag.x, dy = e.clientY - lookDrag.y; lookDrag.x = e.clientX; lookDrag.y = e.clientY;
  lookEuler.setFromQuaternion(camera.quaternion); lookEuler.y -= dx * .003; lookEuler.x = THREE.MathUtils.clamp(lookEuler.x - dy * .003, -Math.PI * .48, Math.PI * .48);
  camera.quaternion.setFromEuler(lookEuler); const dir = new THREE.Vector3(); camera.getWorldDirection(dir); controls.target.copy(camera.position).addScaledVector(dir, 10); requestRender();
});
['pointerup','pointercancel'].forEach(t => renderer.domElement.addEventListener(t, () => { lookDrag = null; }));
$$('[data-move]').forEach(b => { const k = { forward:'w', back:'s', left:'a', right:'d' }[b.dataset.move]; b.addEventListener('pointerdown', () => keys.add(k)); ['pointerup','pointerleave','pointercancel'].forEach(t => b.addEventListener(t, () => keys.delete(k))); });

$$('[data-view]').forEach(b => b.addEventListener('click', () => preset(b.dataset.view)));
$$('[data-action]').forEach(b => b.addEventListener('click', () => {
  const a = b.dataset.action;
  if (a === 'explore') { document.body.classList.add('immersive'); fitRenderer(); preset('home'); }
  else if (a === 'reset') { setWalkMode('orbit'); preset('home'); }
  else if (a === 'structure') { ['roof','enclosure','buddha'].forEach(k => { $(`input[data-layer="${k}"]`).checked = false; setLayer(k,false); }); preset('home'); $('#chapter-3').scrollIntoView({ behavior:'smooth' }); }
  else if (a === 'bracket') preset('bracket');
  else if (a === 'interior') { animateDoor(true); setWalkMode('walk'); preset('interior'); }
  else if (a === 'pick') { pickMode = true; $('#pick-toggle').setAttribute('aria-pressed', 'true'); $('#pick-toggle').classList.add('selected'); showToast('点击木构件查看说明'); }
}));
$$('[data-layer-view]').forEach(b => b.addEventListener('click', () => {
  const type = b.dataset.layerView; const sets = { columns:['columns'], brackets:['columns','brackets'], frame:['columns','brackets','frame'] };
  ['roof','enclosure','columns','brackets','frame','buddha'].forEach(k => { const el = $(`input[data-layer="${k}"]`); const yes = sets[type]?.includes(k) || false; el.checked = yes; setLayer(k, yes); });
}));
$$('input[data-layer]').forEach(i => i.addEventListener('change', () => setLayer(i.dataset.layer, i.checked)));
$('#reset-view').addEventListener('click', () => { $$('input[data-layer]').forEach(i => { i.checked = true; setLayer(i.dataset.layer,true); }); selectObject(null); animateDoor(false); preset('home'); setWalkMode('orbit'); });
$('#expand-scene').addEventListener('click', () => { document.body.classList.toggle('immersive'); fitRenderer(); });
$('#fullscreen').addEventListener('click', () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.());
$('#collapse-tools').addEventListener('click', e => { const body = $('#tools-body'); const hidden = body.hidden; body.hidden = !hidden; e.currentTarget.textContent = hidden ? '−' : '+'; e.currentTarget.setAttribute('aria-expanded', String(hidden)); });
if (compactDevice) {
  $('#tools-body').hidden = true;
  $('#collapse-tools').textContent = '+';
  $('#collapse-tools').setAttribute('aria-expanded', 'false');
}

const chapters = $$('.chapter');
const observer = new IntersectionObserver(entries => entries.forEach(entry => { if (!entry.isIntersecting) return; const next = Number(entry.target.dataset.chapter) || 0; if (next !== chapter && !document.body.classList.contains('immersive')) preset(['home','front','side','bracket','front','home'][next]); chapter = next; $$('nav a').forEach((a, i) => a.classList.toggle('active', i === chapter)); $('#chapter-number').textContent = String(chapter + 1).padStart(2, '0'); $$('#progress-segments b').forEach((b, i) => b.classList.toggle('active', i === chapter)); }), { threshold: .55 });
chapters.forEach(c => observer.observe(c));
$('#next-chapter').addEventListener('click', () => chapters[Math.min(chapter + 1, 5)]?.scrollIntoView({ behavior:'smooth' }));

const help = $('#help'); $('#toggle-help').addEventListener('click', () => help.showModal()); $('#close-help').addEventListener('click', () => help.close()); $('#help-done').addEventListener('click', () => help.close());

let last = performance.now();
function renderLoop(now) {
  const dt = Math.min(.05, (now - last) / 1000); last = now;
  let active = tickFocus() || updateWalk(dt);
  let doorsMoving = false;
  doorParts.forEach(d => { if (Math.abs(d.angle - d.goal) > .001) { d.angle = THREE.MathUtils.lerp(d.angle, d.goal, .18); d.object.quaternion.copy(d.base).premultiply(new THREE.Quaternion().setFromAxisAngle(d.axis,d.angle)); active = true; doorsMoving = true; } });
  // Refresh once when a door comes to rest, rather than on every animation frame.
  if (renderLoop.doorsMoving && !doorsMoving) updateShadows();
  renderLoop.doorsMoving = doorsMoving;
  if (controls.enabled) controls.update();
  if (active || frameRequested) { renderer.render(scene, camera); frameRequested = false; }
  requestAnimationFrame(renderLoop);
}
requestAnimationFrame(renderLoop);
