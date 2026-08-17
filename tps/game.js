import * as THREE from 'three';

// ============ 基础设置 ============
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87b8d9);
scene.fog = new THREE.Fog(0x87b8d9, 45, 130);
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 500);

scene.add(new THREE.HemisphereLight(0xbfd9ff, 0x5a6b4f, 0.9));
const sun = new THREE.DirectionalLight(0xfff3d6, 2.2);
sun.position.set(30, 45, 20);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -50; sun.shadow.camera.right = 50;
sun.shadow.camera.top = 50; sun.shadow.camera.bottom = -50;
sun.shadow.camera.far = 150;
sun.shadow.bias = -0.0004;
scene.add(sun);

// ============ 常量 ============
const MAP_HALF = 30, WALL_H = 4;
const EYE_HEIGHT = 1.6;
const SHOOT_RANGE = 200;
const FIRE_INTERVAL = 0.12;
const RELOAD_TIME = 1.6;   // 与服务端换弹时长一致，用于动画
const SNAP_DIST = 4.0;

const worldColliders = [];
const boxColliders = [];
const particles = [];

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ============ 材质 ============
const matGround = new THREE.MeshStandardMaterial({ color: 0x6f8f5f, roughness: 0.95 });
const matWall = new THREE.MeshStandardMaterial({ color: 0x8a8077, roughness: 0.9 });
const matCrate = new THREE.MeshStandardMaterial({ color: 0x9a6b3f, roughness: 0.8 });
const matCrateDark = new THREE.MeshStandardMaterial({ color: 0x6b4726, roughness: 0.85 });
const matPlayer = new THREE.MeshStandardMaterial({ color: 0x3b82f6, roughness: 0.5 });
const matPlayerHead = new THREE.MeshStandardMaterial({ color: 0xf0c8a0, roughness: 0.6 });
const matGun = new THREE.MeshStandardMaterial({ color: 0x2a3441, roughness: 0.35, metalness: 0.7 });
const matGunDark = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.45, metalness: 0.5 });
const matMag = new THREE.MeshStandardMaterial({ color: 0x1a1f26, roughness: 0.4, metalness: 0.6 });
const matGoggle = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.1, metalness: 0.8 });
const matRedDot = new THREE.MeshBasicMaterial({ color: 0xff3b30 });
const matLens = new THREE.MeshPhysicalMaterial({ color: 0xcfe4f2, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.15, depthWrite: false });
const playerPalette = [0xf43f5e, 0xf59e0b, 0x10b981, 0x8b5cf6, 0x06b6d4, 0xf97316, 0xec4899, 0x84cc16];

function remoteMaterials(color) {
  return {
    body: new THREE.MeshStandardMaterial({ color, roughness: 0.55 }),
    head: new THREE.MeshStandardMaterial({ color: 0xf0c8a0, roughness: 0.6 }),
    goggle: matGoggle,
    gun: new THREE.MeshStandardMaterial({ color: 0x2a3441, roughness: 0.35, metalness: 0.7 }),
    gunDark: matGunDark,
    mag: matMag,
    redDot: matRedDot,
  };
}

// ============ 地图 ============
function buildWorld() {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(MAP_HALF * 2, MAP_HALF * 2), matGround);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  worldColliders.push(ground);

  const grid = new THREE.GridHelper(MAP_HALF * 2, 60, 0x55774a, 0x55774a);
  grid.position.y = 0.01;
  grid.material.opacity = 0.35;
  grid.material.transparent = true;
  scene.add(grid);

  const wallGeo = new THREE.BoxGeometry(MAP_HALF * 2, WALL_H, 1);
  const wallDefs = [
    { x: 0, z: -MAP_HALF, rot: 0 }, { x: 0, z: MAP_HALF, rot: 0 },
    { x: -MAP_HALF, z: 0, rot: Math.PI / 2 }, { x: MAP_HALF, z: 0, rot: Math.PI / 2 },
  ];
  for (const w of wallDefs) {
    const mesh = new THREE.Mesh(wallGeo, matWall);
    mesh.position.set(w.x, WALL_H / 2, w.z);
    mesh.rotation.y = w.rot;
    mesh.castShadow = true; mesh.receiveShadow = true;
    scene.add(mesh);
    worldColliders.push(mesh);
    const isX = w.rot !== 0;
    boxColliders.push({
      minX: isX ? w.x - 0.5 : w.x - MAP_HALF, maxX: isX ? w.x + 0.5 : w.x + MAP_HALF,
      minZ: isX ? w.z - MAP_HALF : w.z - 0.5, maxZ: isX ? w.z + MAP_HALF : w.z + 0.5,
    });
  }

  const crateGeos = [
    new THREE.BoxGeometry(2, 2, 2),
    new THREE.BoxGeometry(3, 1.5, 1.8),
    new THREE.BoxGeometry(1.8, 1.8, 1.8),
  ];
  const rng = mulberry32(12345);
  let placed = 0, guard = 0;
  while (placed < 22 && guard++ < 400) {
    const x = (rng() * 2 - 1) * (MAP_HALF - 4);
    const z = (rng() * 2 - 1) * (MAP_HALF - 4);
    if (Math.hypot(x, z) < 6) continue;
    const geo = crateGeos[Math.floor(rng() * crateGeos.length)];
    const crate = new THREE.Mesh(geo, rng() > 0.5 ? matCrate : matCrateDark);
    crate.position.set(x, geo.parameters.height / 2, z);
    crate.rotation.y = rng() * Math.PI;
    crate.castShadow = true; crate.receiveShadow = true;
    scene.add(crate);
    worldColliders.push(crate);
    const hw = geo.parameters.width / 2, hd = geo.parameters.depth / 2;
    boxColliders.push({ minX: x - hw, maxX: x + hw, minZ: z - hd, maxZ: z + hd });
    placed++;
  }
}

// ============ 角色模型 ============
function createCharacter(mats) {
  const group = new THREE.Group();

  // 躯干
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.6, 6, 12), mats.body);
  body.position.y = 1.1; body.castShadow = true;
  group.add(body);

  // 头 + 护目镜
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 20, 20), mats.head);
  head.position.y = 1.92; head.castShadow = true;
  group.add(head);
  const goggle = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.14, 0.34), mats.goggle);
  goggle.position.set(0, 1.94, 0.13);
  group.add(goggle);

  // 双腿
  const legGeo = new THREE.CapsuleGeometry(0.13, 0.55, 4, 8);
  const legL = new THREE.Mesh(legGeo, mats.body);
  legL.position.set(-0.17, 0.5, 0); legL.castShadow = true;
  const legR = new THREE.Mesh(legGeo, mats.body);
  legR.position.set(0.17, 0.5, 0); legR.castShadow = true;
  group.add(legL, legR);

  // 双臂（持枪）
  const armGeo = new THREE.CapsuleGeometry(0.1, 0.42, 4, 8);
  const armL = new THREE.Mesh(armGeo, mats.body);
  armL.position.set(-0.38, 1.3, 0.4); armL.rotation.x = -1.1;
  const armR = new THREE.Mesh(armGeo, mats.body);
  armR.position.set(0.32, 1.18, 0.3); armR.rotation.x = -0.5;
  group.add(armL, armR);

  // 详细枪械
  const gun = buildRifle(mats);
  gun.position.set(0.12, 1.4, 0.42);
  group.add(gun);

  const hitMeshes = [body, head, goggle, legL, legR, armL, armR, ...gun.userData.hitMeshes];
  group.userData = { body, head, gun, hitMeshes };
  return group;
}

// 第三人称枪械（朝向 +Z，即角色前方）
function buildRifle(mats) {
  const g = new THREE.Group();
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.65, 10), mats.gun);
  barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0, 0.28);
  const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.032, 0.08, 8), mats.gunDark);
  muzzle.rotation.x = Math.PI / 2; muzzle.position.set(0, 0, 0.62);
  const handguard = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.32), mats.gunDark);
  handguard.position.set(0, -0.02, 0.25);
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.13, 0.38), mats.gun);
  receiver.position.set(0, -0.02, -0.02);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.3), mats.gunDark);
  stock.position.set(0, 0, -0.3);
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.2, 0.1), mats.mag);
  mag.position.set(0, -0.16, -0.06); mag.rotation.x = 0.3;
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 0.12), mats.gunDark);
  sight.position.set(0, 0.08, -0.05);
  const dot = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.005), mats.redDot);
  dot.position.set(0, 0.08, 0.012);
  g.add(barrel, muzzle, handguard, receiver, stock, mag, sight, dot);
  g.userData.hitMeshes = [barrel, muzzle, handguard, receiver, stock, mag, sight, dot];
  return g;
}

// ============ 本机玩家 ============
const player = {
  pos: new THREE.Vector3(0, 0, 6),
  yaw: Math.PI, pitch: 0,
  hp: 100, maxHp: 100, ammo: 30, magSize: 30,
  reloading: false, alive: true, kills: 0, deaths: 0,
};
const playerGroup = createCharacter({
  body: matPlayer, head: matPlayerHead, goggle: matGoggle,
  gun: matGun, gunDark: matGunDark, mag: matMag, redDot: matRedDot,
});
playerGroup.visible = false;
scene.add(playerGroup);

// 第一人称持枪（朝向 -Z，即屏幕前方）
const fpGun = new THREE.Group();

// 枪管 + 枪口制退器
const fpBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.75, 12), matGun);
fpBarrel.rotation.x = Math.PI / 2; fpBarrel.position.set(0, 0.02, -0.38);
const fpMuzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.038, 0.1, 10), matGunDark);
fpMuzzle.rotation.x = Math.PI / 2; fpMuzzle.position.set(0, 0.02, -0.78);

// 护木
const fpHandguard = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.34), matGunDark);
fpHandguard.position.set(0, 0, -0.4);

// 机匣
const fpBody = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.16, 0.5), matGun);
fpBody.position.set(0, -0.02, -0.05);

// 枪托
const fpStock = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.14, 0.32), matGunDark);
fpStock.position.set(0, -0.05, 0.3);

// 红点瞄准镜（底座 + 透明镜筒 + 前后镜圈 + 透明镜片 + 中心红点）
const fpSightMount = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.14), matGunDark);
fpSightMount.position.set(0, 0.1, -0.18);
const fpSightBody = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.16, 20), matLens);
fpSightBody.rotation.x = Math.PI / 2; fpSightBody.position.set(0, 0.14, -0.18);
const fpSightRingF = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.007, 8, 20), matGunDark);
fpSightRingF.position.set(0, 0.14, -0.1);
const fpSightRingB = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.007, 8, 20), matGunDark);
fpSightRingB.position.set(0, 0.14, -0.26);
const fpSightLens = new THREE.Mesh(new THREE.CircleGeometry(0.04, 20), matLens);
fpSightLens.position.set(0, 0.14, -0.098);
const fpSightDot = new THREE.Mesh(new THREE.SphereGeometry(0.000875, 8, 8), matRedDot);
fpSightDot.position.set(0, 0.14, -0.1);

// 弹夹（独立分组，用于换弹动画：取下/装上）
const fpMag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.22, 0.12), matMag);
fpMag.position.set(0, -0.2, -0.14); fpMag.rotation.x = 0.3;
const fpMagBase = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, 0.14), matMag);
fpMagBase.position.set(0, -0.31, -0.12); fpMagBase.rotation.x = 0.3;
const fpMagGroup = new THREE.Group();
fpMagGroup.add(fpMag, fpMagBase);

// 握把
const fpGrip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.3, 0.1), matGunDark);
fpGrip.position.set(0, -0.26, 0.12); fpGrip.rotation.x = 0.4;

// 扳机护圈
const fpTriggerGuard = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.012, 6, 12), matGunDark);
fpTriggerGuard.position.set(0, -0.13, 0.06); fpTriggerGuard.rotation.x = Math.PI / 2;

// 拉机柄
const fpCharging = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.03, 0.08), matGun);
fpCharging.position.set(0.07, 0, -0.1);

fpGun.add(fpBarrel, fpMuzzle, fpHandguard, fpBody, fpStock,
  fpSightMount, fpSightBody, fpSightRingF, fpSightRingB, fpSightLens, fpSightDot,
  fpMagGroup, fpGrip, fpTriggerGuard, fpCharging);
fpGun.position.set(0.32, -0.26, -0.55);
scene.add(camera);
camera.add(fpGun);

// ============ 远程玩家 ============
const remotePlayers = new Map();
const remoteHitMeshes = [];

function ensureRemote(id) {
  let r = remotePlayers.get(id);
  if (!r) {
    const color = playerPalette[remotePlayers.size % playerPalette.length];
    const group = createCharacter(remoteMaterials(color));
    group.visible = false;
    scene.add(group);
    r = { id, name: '玩家', group, target: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, alive: false } };
    for (const m of group.userData.hitMeshes) m.userData.remoteId = id;
    remoteHitMeshes.push(...group.userData.hitMeshes);
    remotePlayers.set(id, r);
  }
  return r;
}
function removeRemote(id) {
  const r = remotePlayers.get(id);
  if (!r) return;
  scene.remove(r.group);
  for (const m of r.group.userData.hitMeshes) {
    const i = remoteHitMeshes.indexOf(m);
    if (i >= 0) remoteHitMeshes.splice(i, 1);
  }
  remotePlayers.delete(id);
}

// ============ 粒子特效 ============
function spawnParticle(pos, color, velocity, life, size) {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(size || 0.06, 6, 6),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 })
  );
  mesh.position.copy(pos);
  scene.add(mesh);
  particles.push({ mesh, velocity: velocity.clone(), life, maxLife: life });
}
function spawnImpact(pos, normal) {
  for (let i = 0; i < 14; i++) {
    const v = new THREE.Vector3((Math.random() - 0.5) * 5, Math.random() * 4, (Math.random() - 0.5) * 5)
      .add(normal.clone().multiplyScalar(2));
    spawnParticle(pos, 0xffb347, v, 0.5 + Math.random() * 0.4, 0.05);
  }
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }));
  glow.position.copy(pos);
  scene.add(glow);
  particles.push({ mesh: glow, velocity: new THREE.Vector3(), life: 0.12, maxLife: 0.12 });
}
function spawnBlood(pos) {
  for (let i = 0; i < 10; i++) {
    const v = new THREE.Vector3((Math.random() - 0.5) * 4, Math.random() * 3 + 1, (Math.random() - 0.5) * 4);
    spawnParticle(pos, 0xdc2626, v, 0.4 + Math.random() * 0.3, 0.05);
  }
}
function spawnTracer(from, to) {
  const dir = to.clone().sub(from);
  const len = dir.length();
  if (len < 0.01) return;
  dir.normalize();
  const tracer = new THREE.Mesh(
    new THREE.CylinderGeometry(0.025, 0.025, len, 5),
    new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.95 })
  );
  tracer.position.copy(from).add(dir.clone().multiplyScalar(len / 2));
  tracer.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  scene.add(tracer);
  particles.push({ mesh: tracer, velocity: new THREE.Vector3(), life: 0.06, maxLife: 0.06 });
}
function spawnMuzzleFlash(pos) {
  // 开镜时枪口贴近眼前，缩小并淡化闪光避免遮挡视野
  const s = ads ? 0.55 : 1;
  const flash = new THREE.Mesh(new THREE.SphereGeometry(0.18 * s, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xfff7c0, transparent: true, opacity: ads ? 0.8 : 1 }));
  flash.position.copy(pos);
  scene.add(flash);
  particles.push({ mesh: flash, velocity: new THREE.Vector3(), life: 0.05, maxLife: 0.05 });
}

// ============ 音效 ============
const audio = (() => {
  let ctx = null;
  function ensure() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function burst(duration, freq, gain, type = 'lowpass') {
    const c = ensure();
    const n = Math.floor(c.sampleRate * duration);
    const buffer = c.createBuffer(1, n, c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = c.createBufferSource();
    src.buffer = buffer;
    const filter = c.createBiquadFilter();
    filter.type = type; filter.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration);
    src.connect(filter); filter.connect(g); g.connect(c.destination);
    src.start();
  }
  return {
    shoot() { burst(0.12, 1800, 0.5); },
    hit() { burst(0.05, 800, 0.25, 'highpass'); },
    hurt() { burst(0.15, 300, 0.3); },
    empty() { burst(0.03, 2000, 0.15, 'highpass'); },
    death() { burst(0.4, 200, 0.4); },
    // 换弹细节音效：弹夹取出 / 弹夹插入 / 拉机柄回位
    magOut() { burst(0.05, 450, 0.28); burst(0.03, 260, 0.18); },
    magIn() { burst(0.05, 1300, 0.3, 'bandpass'); burst(0.04, 700, 0.2); },
    bolt() { burst(0.04, 2600, 0.18, 'highpass'); burst(0.06, 850, 0.25); },
  };
})();

// ============ 输入 ============
const keys = {};
let mouseDown = false, locked = false, gameStarted = false;
let fireCooldown = 0, lastHp = 100;
let reloadAnim = 0;
let magDrop = 0;
let magOutPlayed = false, magInPlayed = false, boltPlayed = false;
let ads = false;          // 是否开镜
let curFov = 70;          // 当前视野（平滑过渡）
let adsAmount = 0;        // 开镜过渡进度 0~1

document.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'KeyR') sendReload();
  if (e.code === 'KeyE') toggleAds();
  if (e.code === 'Space') e.preventDefault();
});
document.addEventListener('keyup', (e) => { keys[e.code] = false; });
document.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  if (locked && gameStarted && player.alive) { mouseDown = true; fireCooldown = 0; }
  else if (!locked && gameStarted && player.alive) canvas.requestPointerLock();
});
document.addEventListener('mouseup', (e) => { if (e.button === 0) mouseDown = false; });
document.addEventListener('mousemove', (e) => {
  if (!locked || !gameStarted || !player.alive) return;
  const sens = ads ? 0.5 : 1;   // 开镜时灵敏度降低，便于精确瞄准
  player.yaw -= e.movementX * 0.0022 * sens;
  player.pitch -= e.movementY * 0.0022 * sens;
  player.pitch = Math.max(-0.55, Math.min(0.75, player.pitch));
});
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  if (!locked) setAds(false);
  document.getElementById('crosshair').classList.toggle('hidden', !(locked && gameStarted && player.alive));
  document.getElementById('pointerHint').classList.toggle('hidden', locked || !gameStarted);
});

// ============ 网络 ============
const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
let myId = null;

function send(msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }
function sendReload() { if (gameStarted && player.alive) send({ type: 'reload' }); }

// ============ 开镜（E 键切换） ============
function setAds(v) {
  ads = v;
  document.getElementById('crosshair').classList.toggle('ads', v);
  document.getElementById('scopeOverlay').classList.toggle('ads', v);
}
function toggleAds() {
  if (!gameStarted || !player.alive || player.reloading) return;
  setAds(!ads);
}
function sendInput() {
  if (!gameStarted || !player.alive) return;
  let mx = 0, mz = 0;
  if (keys['KeyW']) mz += 1;
  if (keys['KeyS']) mz -= 1;
  if (keys['KeyD']) mx += 1;
  if (keys['KeyA']) mx -= 1;
  const len = Math.hypot(mx, mz);
  if (len > 0) { mx /= len; mz /= len; }
  send({
    type: 'input', mx, mz,
    sprint: !!(keys['ShiftLeft'] || keys['ShiftRight']),
    jump: !!keys['Space'],
    yaw: player.yaw, pitch: player.pitch,
    shooting: mouseDown,
  });
}

ws.onopen = () => { setConnStatus('已连接'); };
ws.onclose = () => { setConnStatus('连接已断开'); };
ws.onerror = () => { setConnStatus('连接错误'); };
ws.onmessage = (e) => { try { handleMessage(JSON.parse(e.data)); } catch (err) {} };

function setConnStatus(text) {
  const el = document.getElementById('connStatus');
  el.textContent = text;
  el.style.display = text === '已连接' ? 'none' : 'block';
}

const myTarget = new THREE.Vector3(0, 0, 6);
function handleMessage(msg) {
  switch (msg.type) {
    case 'welcome':
      myId = msg.id;
      break;
    case 'joined':
      if (msg.id !== myId) pushKillFeed(msg.name + ' 加入了战斗');
      break;
    case 'left':
      removeRemote(msg.id);
      if (msg.id !== myId) pushKillFeed(msg.name + ' 离开了战斗');
      break;
    case 'state':
      applyState(msg.players);
      break;
    case 'shoot':
      if (msg.id !== myId) remoteShootVisual(msg);
      break;
    case 'hit':
      if (msg.targetId === myId) showDamageIndicator(msg.dir);
      break;
    case 'kill':
      pushKillFeed(msg.killerName + ' 击杀了 ' + msg.victimName);
      if (msg.victimId === myId) audio.death();
      break;
  }
}

function applyState(list) {
  let me = null;
  const seen = new Set();
  for (const s of list) {
    seen.add(s.id);
    if (s.id === myId) { me = s; continue; }
    const r = ensureRemote(s.id);
    r.name = s.name;
    r.target.x = s.x; r.target.y = s.y; r.target.z = s.z;
    r.target.yaw = s.yaw; r.target.pitch = s.pitch;
    r.target.alive = s.alive;
  }
  for (const id of [...remotePlayers.keys()]) if (!seen.has(id)) removeRemote(id);

  if (me) {
    myTarget.set(me.x, me.y, me.z);
    if (player.pos.distanceTo(myTarget) > SNAP_DIST) player.pos.copy(myTarget);
    if (me.hp < lastHp) { flashDamage(); audio.hurt(); }
    lastHp = me.hp;
    player.hp = me.hp;
    player.ammo = me.ammo;
    player.reloading = me.reloading;
    player.alive = me.alive;
    player.kills = me.kills;
    player.deaths = me.deaths;
    updateRespawnUI(me.respawnIn || 0);
  }
  updateHud();
  updateLeaderboard(list);
}

// ============ 射击（本地视觉预测） ============
const raycaster = new THREE.Raycaster();
const centerVec = new THREE.Vector2(0, 0);
const muzzleWorld = new THREE.Vector3();
let spreadKick = 0;

let emptySoundPlayed = false;

function localShoot() {
  if (!player.alive) return;
  if (player.reloading) return;
  if (player.ammo <= 0) {
    // 打空自动换弹，空仓声只播一次
    if (!emptySoundPlayed) { audio.empty(); emptySoundPlayed = true; }
    sendReload();
    return;
  }
  emptySoundPlayed = false;
  audio.shoot();
  spreadKick = 1;

  raycaster.setFromCamera(centerVec, camera);
  raycaster.far = SHOOT_RANGE;
  const remoteHits = raycaster.intersectObjects(remoteHitMeshes, false);
  const worldHits = raycaster.intersectObjects(worldColliders, false);
  const rd = remoteHits.length ? remoteHits[0].distance : Infinity;
  const wd = worldHits.length ? worldHits[0].distance : Infinity;

  let hitPoint;
  if (rd < wd) {
    hitPoint = remoteHits[0].point.clone();
    spawnBlood(hitPoint);
    showHitmarker();
  } else if (worldHits.length) {
    hitPoint = worldHits[0].point.clone();
    const n = worldHits[0].face ? worldHits[0].face.normal.clone() : new THREE.Vector3(0, 1, 0);
    spawnImpact(hitPoint, n);
  } else {
    hitPoint = raycaster.ray.origin.clone().add(raycaster.ray.direction.clone().multiplyScalar(SHOOT_RANGE));
  }

  // 子弹从枪口出发，沿准心方向打向瞄准点
  fpMuzzle.getWorldPosition(muzzleWorld);
  spawnTracer(muzzleWorld, hitPoint);
  spawnMuzzleFlash(muzzleWorld);
}

function remoteShootVisual(msg) {
  const from = new THREE.Vector3(msg.from[0], msg.from[1], msg.from[2]);
  const to = new THREE.Vector3(msg.to[0], msg.to[1], msg.to[2]);
  spawnTracer(from, to);
  spawnMuzzleFlash(from);
  if (msg.hit != null) spawnBlood(to);
}

// ============ HUD ============
const elHpFill = document.getElementById('hpFill');
const elHpText = document.getElementById('hpText');
const elKills = document.getElementById('kills');
const elDeaths = document.getElementById('deaths');
const elAmmo = document.getElementById('ammo');
const elKillFeed = document.getElementById('killFeed');
const elTargetHint = document.getElementById('targetHint');
const elPlayerList = document.getElementById('playerList');
const elHitmarker = document.getElementById('hitmarker');
const elDamageIndicator = document.getElementById('damageIndicator');
const elDamageFlash = document.getElementById('damageFlash');
const elDeathOverlay = document.getElementById('deathOverlay');
const elDeathInfo = document.getElementById('deathInfo');
const elRespawnTimer = document.getElementById('respawnTimer');
const elRespawnBtn = document.getElementById('respawnBtn');

function updateHud() {
  const hp = Math.max(0, Math.round(player.hp));
  elHpFill.style.width = (hp / player.maxHp) * 100 + '%';
  elHpText.textContent = hp;
  elKills.textContent = player.kills;
  elDeaths.textContent = player.deaths;
  elAmmo.textContent = player.reloading ? '…' : player.ammo;
}

function updateLeaderboard(list) {
  const sorted = [...list].sort((a, b) => (b.kills - a.kills) || (a.deaths - b.deaths));
  elPlayerList.innerHTML = sorted.map((p) => {
    const me = p.id === myId ? ' me' : '';
    const dead = p.alive ? '' : ' dead';
    return `<div class="pl-row${me}${dead}"><span class="pl-name">${escapeHtml(p.name)}</span><span class="pl-kd">${p.kills}/${p.deaths}</span></div>`;
  }).join('');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let hitmarkerTimer = null;
function showHitmarker() {
  const ch = document.getElementById('crosshair');
  ch.classList.add('hit');
  if (hitmarkerTimer) clearTimeout(hitmarkerTimer);
  hitmarkerTimer = setTimeout(() => ch.classList.remove('hit'), 120);
}

let damageTimer = null;
function showDamageIndicator(dir) {
  const sx = -dir[0], sz = -dir[1]; // 伤害来源方向（世界 XZ）
  const cy = Math.cos(player.yaw), sy = Math.sin(player.yaw);
  const projRight = sx * (-cy) + sz * sy; // 投影到屏幕右方向
  const projFwd = sx * sy + sz * cy;      // 投影到屏幕前方向
  const angle = Math.atan2(projRight, projFwd);
  const arrow = document.querySelector('#damageIndicator .di-arrow');
  if (!arrow) return;
  arrow.style.transform = `rotate(${angle}rad)`;
  elDamageIndicator.classList.remove('hidden');
  if (damageTimer) clearTimeout(damageTimer);
  damageTimer = setTimeout(() => elDamageIndicator.classList.add('hidden'), 600);
}

function flashDamage() {
  if (elDamageFlash) {
    elDamageFlash.classList.add('active');
    clearTimeout(flashDamage._t);
    flashDamage._t = setTimeout(() => elDamageFlash.classList.remove('active'), 150);
  }
}

function pushKillFeed(text) {
  const div = document.createElement('div');
  div.className = 'kill-item';
  div.textContent = text;
  elKillFeed.appendChild(div);
  while (elKillFeed.children.length > 5) elKillFeed.removeChild(elKillFeed.firstChild);
  setTimeout(() => { if (div.parentNode) div.remove(); }, 4000);
}

function applyCrosshairSpread() {
  const el = document.getElementById('crosshair');
  el.classList.add('spread');
  clearTimeout(applyCrosshairSpread._t);
  applyCrosshairSpread._t = setTimeout(() => el.classList.remove('spread'), 80);
}

// ============ 相机 / 远程渲染 ============
function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function updateCamera(dt) {
  const k = Math.min(1, dt * 18);
  player.pos.lerp(myTarget, k);
  const cp = Math.cos(player.pitch), sp = Math.sin(player.pitch);
  camera.position.set(player.pos.x, player.pos.y + EYE_HEIGHT, player.pos.z);
  camera.lookAt(
    camera.position.x + Math.sin(player.yaw) * cp,
    camera.position.y + sp,
    camera.position.z + Math.cos(player.yaw) * cp
  );
}

function updateRemotePlayers(dt) {
  const k = Math.min(1, dt * 18);
  for (const r of remotePlayers.values()) {
    r.group.visible = r.target.alive;
    if (!r.target.alive) continue;
    r.group.position.x += (r.target.x - r.group.position.x) * k;
    r.group.position.y += (r.target.y - r.group.position.y) * k;
    r.group.position.z += (r.target.z - r.group.position.z) * k;
    r.group.rotation.y = lerpAngle(r.group.rotation.y, r.target.yaw, k);
    r.group.userData.gun.rotation.x = -r.target.pitch;
  }
}

function updateTargetHint() {
  if (!gameStarted || !player.alive) { elTargetHint.textContent = ''; return; }
  raycaster.setFromCamera(centerVec, camera);
  const hits = raycaster.intersectObjects(remoteHitMeshes, false);
  if (hits.length) {
    const r = remotePlayers.get(hits[0].object.userData.remoteId);
    if (r && r.target.alive) { elTargetHint.textContent = '▼ ' + r.name; return; }
  }
  elTargetHint.textContent = '';
}

function updateRespawnUI(respawnIn) {
  if (!player.alive) {
    setAds(false);
    elDeathOverlay.classList.remove('hidden');
    elDeathInfo.textContent = `击杀 ${player.kills} · 死亡 ${player.deaths}`;
    elRespawnTimer.textContent = respawnIn > 0 ? `重生倒计时：${respawnIn} 秒` : '';
    elRespawnBtn.textContent = '等待重生…';
    document.getElementById('pointerHint').classList.add('hidden');
    if (locked) document.exitPointerLock();
  } else if (!elDeathOverlay.classList.contains('hidden')) {
    elRespawnTimer.textContent = '';
    elRespawnBtn.textContent = '继续战斗';
  }
}

// ============ 粒子更新 ============
function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) {
      scene.remove(p.mesh);
      p.mesh.geometry.dispose();
      p.mesh.material.dispose();
      particles.splice(i, 1);
      continue;
    }
    p.mesh.position.addScaledVector(p.velocity, dt);
    p.velocity.y -= 9.8 * dt;
    p.mesh.material.opacity = p.life / p.maxLife;
  }
}

// ============ 主循环 ============
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);

  // ===== 开镜（ADS）过渡：FOV 缩放 =====
  if (player.reloading) setAds(false);   // 换弹时自动退出开镜
  const adsTarget = ads ? 1 : 0;
  adsAmount += (adsTarget - adsAmount) * Math.min(1, dt * 14);
  if (Math.abs(adsTarget - adsAmount) < 0.005) adsAmount = adsTarget;
  curFov = 70 - adsAmount * 32;          // 视野 70 → 38（约 1.8 倍放大）
  camera.fov = curFov;
  camera.updateProjectionMatrix();

  updateCamera(dt);
  updateRemotePlayers(dt);

  if (gameStarted && player.alive) {
    sendInput();
    updateTargetHint();
    fireCooldown -= dt;
    if (mouseDown && fireCooldown <= 0) { fireCooldown = FIRE_INTERVAL; localShoot(); }
    const t = clock.elapsedTime;
    // ===== 换弹动画：下沉 → 取下弹夹 → 装上新弹夹 → 拉机柄回位 =====
    if (player.reloading) {
      reloadAnim = Math.min(reloadAnim + dt, RELOAD_TIME);
    } else {
      reloadAnim = Math.max(reloadAnim - dt * 3, 0);
      magOutPlayed = magInPlayed = boltPlayed = false;
      magDrop = 0;
    }
    const rp = reloadAnim / RELOAD_TIME;
    const dip = Math.sin(Math.min(rp, 1) * Math.PI);   // 枪身 0→1→0
    const sway = Math.sin(rp * Math.PI * 2);           // 左右摆动

    // 弹夹独立动画：取出（下移+隐藏）→ 装上（下移回位+显示）
    const MAG_DROP = 0.42;
    if (player.reloading) {
      if (rp < 0.3) { magDrop = 0; fpMagGroup.visible = true; }
      else if (rp < 0.5) { magDrop = ((rp - 0.3) / 0.2) * MAG_DROP; fpMagGroup.visible = true; }
      else if (rp < 0.8) { magDrop = MAG_DROP; fpMagGroup.visible = false; }
      else { magDrop = (1 - (rp - 0.8) / 0.2) * MAG_DROP; fpMagGroup.visible = true; }
      // 弹夹碰撞枪体音效
      if (!magOutPlayed && rp >= 0.28) { audio.magOut(); magOutPlayed = true; }
      if (!magInPlayed && rp >= 0.85) { audio.magIn(); magInPlayed = true; }
      if (!boltPlayed && rp >= 0.97) { audio.bolt(); boltPlayed = true; }
    } else {
      fpMagGroup.visible = true;
    }
    fpMagGroup.position.y = -magDrop;

    // 开镜时枪械移到眼前，瞄准镜对准眼睛（透过透明镜片看镜筒内）；移动时轻微抖动
    const moving = !!(keys['KeyW'] || keys['KeyS'] || keys['KeyA'] || keys['KeyD']);
    const breathe = 1 - adsAmount * 0.6;              // 开镜时呼吸摆动减弱
    const recoil = 1 - adsAmount * 0.7;               // 开镜时换弹/后坐力位移减弱
    const jitter = adsAmount * (moving ? 1 : 0);      // 开镜移动时抖动强度
    const jx = Math.sin(t * 30) * 0.006 * jitter;
    const jy = Math.cos(t * 26) * 0.005 * jitter;
    const jr = Math.sin(t * 24) * 0.018 * jitter;
    fpGun.position.set(
      0.32 * (1 - adsAmount) + Math.sin(t * 2) * 0.004 * breathe + jx,
      (-0.26 + Math.sin(t * 2.6) * 0.005 * breathe) * (1 - adsAmount)
        - 0.14 * adsAmount - dip * 0.42 * recoil + jy,
      -0.55 * (1 - adsAmount) - 0.02 * adsAmount - dip * 0.2 * recoil
    );
    fpGun.rotation.set(dip * 1.0 * recoil, sway * 0.08 * (1 - adsAmount), sway * 0.24 * (1 - adsAmount) + jr);
  }

  updateParticles(dt);
  renderer.render(scene, camera);
}

// ============ 启动 ============
const startBtn = document.getElementById('startBtn');
const nameInput = document.getElementById('nameInput');
const startModal = document.getElementById('startModal');

startBtn.addEventListener('click', () => {
  const name = nameInput.value.trim() || ('玩家' + Math.floor(Math.random() * 9000 + 1000));
  send({ type: 'join', name });
  gameStarted = true;
  startModal.classList.add('hidden');
  canvas.requestPointerLock();
});

elRespawnBtn.addEventListener('click', () => {
  if (player.alive) {
    elDeathOverlay.classList.add('hidden');
    canvas.requestPointerLock();
  }
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ============ 初始化 ============
buildWorld();
clock.start();
animate();
