import * as THREE from "three";

// ================= 常量 =================
const MAP_HALF = 60;
const PLAYER_RADIUS = 0.45;
const MAX_HP = 100;
const SHOOT_RANGE = 500;
const EYE = { stand: 1.6, crouch: 1.0, prone: 0.35 };
const STANCE_LABEL = { stand: "站立", crouch: "蹲下", prone: "趴下" };
const POSE = {
  stand:  { scaleY: 1.0,  rotX: 0,    yOff: 0 },
  crouch: { scaleY: 0.62, rotX: 0.16, yOff: 0.02 },
  prone:  { scaleY: 0.30, rotX: 1.12, yOff: 0.14 },
};
const SENSITIVITY = 0.0022;
const FOV_BASE = 75, FOV_ADS = 52;

// ================= 武器/模式数据（welcome 时填充） =================
let WEAPONS = [];
let CATEGORIES = [];
let MODES = [];
let currentMode = "tdm";
let bombSites = [];
let scoreLimit = { tdm: 30, dm: 25 };
const MODE_NAME = { tdm: "团队竞技", dm: "个人竞技", bomb: "爆破模式" };

// ================= DOM =================
const $ = (id) => document.getElementById(id);
const dom = {
  startScreen: $("startScreen"), nameInput: $("nameInput"), startBtn: $("startBtn"),
  loadoutScreen: $("loadoutScreen"), modeList: $("modeList"), categoryList: $("categoryList"),
  weaponList: $("weaponList"), weaponStats: $("weaponStats"),
  confirmLoadout: $("confirmLoadout"), backToMode: $("backToMode"), backToCat: $("backToCat"),
  stepMode: $("stepMode"), stepCategory: $("stepCategory"), stepWeapon: $("stepWeapon"),
  hud: $("hud"), hpFill: $("hpFill"), hpText: $("hpText"),
  armorFill: $("armorFill"), armorText: $("armorText"),
  ammo: $("ammo"), ammoMax: $("ammoMax"), reloadText: $("reloadText"),
  reloadHint: $("reloadHint"), reloadFill: $("reloadFill"), reloadCount: $("reloadCount"),
  scoreText: $("scoreText"), botsText: $("botsText"), stanceText: $("stanceText"),
  modeText: $("modeText"), teamScore: $("teamScore"), weaponName: $("weaponName"), slotHint: $("slotHint"),
  bombStatus: $("bombStatus"), roundResult: $("roundResult"), roundResultText: $("roundResultText"),
  chLines: document.querySelectorAll(".ch-line"), adsDot: $("adsDot"), hitmarker: $("hitmarker"),
  damageIndicator: $("damageIndicator"), damageFlash: $("damageFlash"),
  shotIndicator: $("shotIndicator"),
  scopeVignette: $("scopeVignette"), killfeed: $("killfeed"),
  deathScreen: $("deathScreen"), respawnText: $("respawnText"),
  leaderboard: $("leaderboard"), boardTable: $("boardTable"), toast: $("toast"),
};

// ================= 选枪状态 =================
const loadout = { mode: "tdm", category: "rifle", weaponId: "ak47", name: "" };

// ================= 渲染器 / 场景 =================
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0e1621);
scene.fog = new THREE.Fog(0x0e1621, 40, 170);
const camera = new THREE.PerspectiveCamera(FOV_BASE, innerWidth / innerHeight, 0.05, 600);
camera.rotation.order = "YXZ";

scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x3a2f22, 0.9));
const sun = new THREE.DirectionalLight(0xfff2d8, 1.6);
sun.position.set(60, 90, 30);
scene.add(sun);
scene.add(new THREE.AmbientLight(0x8899aa, 0.5));

// ================= 地面 =================
function makeGroundTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 512;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#2c3a2a"; ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 4000; i++) {
    const g = 40 + Math.random() * 40;
    ctx.fillStyle = `rgba(${g},${g + 14},${g - 12},${0.15 + Math.random() * 0.2})`;
    ctx.fillRect(Math.random() * 512, Math.random() * 512, 2, 2);
  }
  ctx.strokeStyle = "rgba(0,0,0,0.16)"; ctx.lineWidth = 2;
  for (let i = 0; i <= 512; i += 64) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 512); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(512, i); ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(30, 30);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const ground = new THREE.Mesh(new THREE.PlaneGeometry(MAP_HALF * 2, MAP_HALF * 2), new THREE.MeshLambertMaterial({ map: makeGroundTexture() }));
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

const borderMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.8 });
function addBorder(w, h, d, x, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), borderMat);
  m.position.set(x, 3, z); scene.add(m);
}
const BW = MAP_HALF * 2 + 2;
addBorder(BW, 6, 1, 0, -MAP_HALF); addBorder(BW, 6, 1, 0, MAP_HALF);
addBorder(1, 6, BW, -MAP_HALF, 0); addBorder(1, 6, BW, MAP_HALF, 0);

// ================= 障碍物 =================
const colliders = [ground];
const OBSTACLE_MATS = {
  crate:   new THREE.MeshStandardMaterial({ color: 0x8a6a3c, roughness: 0.9 }),
  barrel:  new THREE.MeshStandardMaterial({ color: 0xb23a2a, roughness: 0.5, metalness: 0.4 }),
  rock:    new THREE.MeshStandardMaterial({ color: 0x7d8286, roughness: 0.95 }),
  wall:    new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.85 }),
  sandbag: new THREE.MeshStandardMaterial({ color: 0xc2a878, roughness: 0.95 }),
  pillar:  new THREE.MeshStandardMaterial({ color: 0x4b5563, roughness: 0.7 }),
  tree:    new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 0.95 }),
};
const CONTAINER_COLORS = [0x3b82f6, 0xef4444, 0x22c55e, 0xf59e0b];

function buildObstacle(o) {
  const g = new THREE.Group();
  g.position.set(o.x, 0, o.z); g.rotation.y = o.ry;
  const halfH = o.h / 2, meshes = [];
  if (o.type === "barrel") {
    const r = o.w / 2;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.86, r, o.h, 14), OBSTACLE_MATS.barrel);
    body.position.y = halfH;
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.86, r * 0.86, 0.06, 14), OBSTACLE_MATS.barrel);
    lid.position.y = o.h + 0.03;
    meshes.push(body, lid);
  } else if (o.type === "rock") {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(Math.max(o.w, o.d) / 2, 1), OBSTACLE_MATS.rock);
    m.position.y = halfH * 0.7; m.scale.y = 0.72;
    m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    meshes.push(m);
  } else if (o.type === "tree") {
    const r = o.w / 2;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.2, o.h, 8), OBSTACLE_MATS.tree);
    trunk.position.y = halfH;
    const canopy = new THREE.Mesh(new THREE.IcosahedronGeometry(2.0, 0), new THREE.MeshStandardMaterial({ color: 0x2f6b34, roughness: 1 }));
    canopy.position.y = o.h + 1.4;
    meshes.push(trunk, canopy);
  } else {
    const mat = o.type === "container"
      ? new THREE.MeshStandardMaterial({ color: CONTAINER_COLORS[((o.x * 7 + o.z * 13) % 4 + 4) % 4 | 0], roughness: 0.6, metalness: 0.3 })
      : OBSTACLE_MATS[o.type];
    const box = new THREE.Mesh(new THREE.BoxGeometry(o.w, o.h, o.d), mat);
    box.position.y = halfH;
    meshes.push(box);
    if (o.type === "crate" || o.type === "container") {
      const edge = new THREE.LineSegments(new THREE.EdgesGeometry(box.geometry), new THREE.LineBasicMaterial({ color: 0x1f2937 }));
      edge.position.copy(box.position);
      meshes.push(edge);
    }
  }
  meshes.forEach((m) => { g.add(m); if (!m.isLineSegments) colliders.push(m); });
  scene.add(g);
}

function buildWorld(obs) { obs.forEach(buildObstacle); }

// 山体剪影
for (let i = 0; i < 14; i++) {
  const ang = (i / 14) * Math.PI * 2, r = MAP_HALF + 18, h = 10 + Math.random() * 26;
  const m = new THREE.Mesh(new THREE.ConeGeometry(18 + Math.random() * 22, h, 5), new THREE.MeshStandardMaterial({ color: 0x16202c, roughness: 1 }));
  m.position.set(Math.cos(ang) * r, h / 2 - 3, Math.sin(ang) * r);
  scene.add(m);
}

// ================= 精灵文字 =================
function makeTextSprite(text, color) {
  const c = document.createElement("canvas"); c.width = 256; c.height = 64;
  const ctx = c.getContext("2d");
  ctx.font = "bold 34px 'Microsoft YaHei', sans-serif"; ctx.textAlign = "center";
  ctx.lineWidth = 6; ctx.strokeStyle = "rgba(0,0,0,0.8)"; ctx.strokeText(text, 128, 42);
  ctx.fillStyle = color; ctx.fillText(text, 128, 42);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false }));
  sp.scale.set(2.2, 0.55, 1);
  return sp;
}
function makeHpSprite() {
  const c = document.createElement("canvas"); c.width = 64; c.height = 8;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#22c55e"; ctx.fillRect(0, 0, 64, 8);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false }));
  sp.scale.set(1.1, 0.14, 1);
  return sp;
}

// ================= 角色模型（远程玩家 + 人机） =================
function buildSoldier() {
  const bodyMat = new THREE.MeshStandardMaterial({ roughness: 0.8 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x2a3240, roughness: 0.9 });
  const body = new THREE.Group();
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.7, 0.18), darkMat); legL.position.set(-0.13, 0.35, 0);
  const legR = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.7, 0.18), darkMat); legR.position.set(0.13, 0.35, 0);
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.62, 0.3), bodyMat); torso.position.y = 1.0;
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.52, 0.16), bodyMat); armL.position.set(-0.33, 0.95, 0.02);
  const armR = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.52, 0.16), bodyMat); armR.position.set(0.33, 0.95, 0.02);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), bodyMat); head.position.y = 1.52;
  const helm = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.12, 0.32), darkMat); helm.position.y = 1.68;
  // 敌人枪械（更明显：金属枪身 + 棕色护木/枪托 + 枪管/弹匣）
  const gunMetal = new THREE.MeshStandardMaterial({ color: 0x2f353d, roughness: 0.35, metalness: 0.85 });
  const gunWood = new THREE.MeshStandardMaterial({ color: 0x8a5a2a, roughness: 0.7 });
  const gun = new THREE.Group();
  const gReceiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.52), gunMetal);
  const gBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.34, 8), gunMetal);
  gBarrel.rotation.x = Math.PI / 2; gBarrel.position.set(0, 0.02, 0.42);
  const gGuard = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.09, 0.26), gunWood); gGuard.position.set(0, -0.01, 0.18);
  const gMag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.09), gunMetal); gMag.position.set(0, -0.13, 0.02);
  const gStock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.11, 0.24), gunWood); gStock.position.set(0, -0.01, -0.26);
  const gSight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.02), gunMetal); gSight.position.set(0, 0.1, -0.05);
  gun.add(gReceiver, gBarrel, gGuard, gMag, gStock, gSight);
  gun.position.set(0.26, 1.05, 0.42);
  body.add(legL, legR, torso, armL, armR, head, helm, gun);
  return { body, bodyMat };
}

function createCharacter(id, name, color, isBot) {
  const g = new THREE.Group();
  const s = buildSoldier();
  s.bodyMat.color = new THREE.Color(color);
  g.add(s.body);
  const label = makeTextSprite(name, isBot ? "#fca5a5" : color);
  label.position.y = 2.15;
  const hpSprite = makeHpSprite();
  hpSprite.position.y = 2.05;
  g.add(label, hpSprite);
  scene.add(g);
  return { id, group: g, body: s.body, label, hpSprite, hp: 100, name, color, isBot,
    team: null, yaw: 0, pitch: 0, stance: "stand", alive: true, x: 0, y: 0, z: 0 };
}

const remotePlayers = new Map();
function getOrCreatePlayer(p) {
  let r = remotePlayers.get(p.id);
  if (!r) { r = createCharacter(p.id, p.name, p.color, p.isBot); remotePlayers.set(p.id, r); }
  return r;
}

// 根据队伍关系更新远程角色名字标签（队友绿 / 敌人红 / 无队伍原色）
function setRemoteTeam(r, team) {
  if (r.team === team) return;
  r.team = team;
  let color = r.isBot ? "#fca5a5" : r.color;
  let prefix = "";
  if (team === "red") prefix = "红";
  else if (team === "blue") prefix = "蓝";
  if (team && team === player.team) color = "#4ade80";
  else if (team) color = "#f87171";
  const text = prefix ? `[${prefix}] ${r.name}` : r.name;
  const c = document.createElement("canvas"); c.width = 256; c.height = 64;
  const ctx = c.getContext("2d");
  ctx.font = "bold 34px 'Microsoft YaHei', sans-serif"; ctx.textAlign = "center";
  ctx.lineWidth = 6; ctx.strokeStyle = "rgba(0,0,0,0.8)"; ctx.strokeText(text, 128, 42);
  ctx.fillStyle = color; ctx.fillText(text, 128, 42);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  r.label.material.map = t;
  r.label.material.needsUpdate = true;
}

// ================= 第一人称武器 =================
const fpGun = new THREE.Group();
let fpMag;
{
  const gunMat = new THREE.MeshStandardMaterial({ color: 0x1c2229, roughness: 0.5, metalness: 0.6 });
  const gripMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.9 });
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.52), gunMat);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.34, 10), new THREE.MeshStandardMaterial({ color: 0x0a0d10, roughness: 0.4, metalness: 0.8 }));
  barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.03, -0.42);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.22), gripMat); stock.position.set(0, -0.02, 0.32);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, 0.06), gripMat); grip.position.set(0, -0.09, 0.12);
  fpMag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.08), gunMat); fpMag.position.set(0, -0.13, 0.04);
  const frontSight = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.05, 0.015), gunMat); frontSight.position.set(0, 0.07, -0.55);
  const rearL = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.04, 0.015), gunMat); rearL.position.set(-0.02, 0.06, 0.18);
  const rearR = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.04, 0.015), gunMat); rearR.position.set(0.02, 0.06, 0.18);
  fpGun.add(receiver, barrel, stock, grip, fpMag, frontSight, rearL, rearR);
  fpGun.position.set(0.32, -0.28, -0.5);
  camera.add(fpGun);
  scene.add(camera);
}
const MAG_BASE = new THREE.Vector3(0, -0.13, 0.04);   // 弹夹原位
const MAG_OUT = new THREE.Vector3(0.02, -0.30, 0.14); // 拆下位置（向下、微向外）
const muzzle = new THREE.Object3D();
muzzle.position.set(0, 0.03, -0.6);
fpGun.add(muzzle);

const GUN_HIP = { pos: new THREE.Vector3(0.32, -0.28, -0.5), rot: new THREE.Euler(0, 0, 0) };
const GUN_ADS = { pos: new THREE.Vector3(0, -0.16, -0.34), rot: new THREE.Euler(0, 0, 0) };
let recoilKick = 0;      // 后坐力踢动（0~1）
let switchAnimT = -1;    // 切枪动画计时（<0 表示未在切枪）

// ================= 粒子 =================
const tracerMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
const tracerGeo = new THREE.CylinderGeometry(0.012, 0.012, 1, 6);
const particles = [];
function spawnTracer(from, to) {
  const dir = new THREE.Vector3().subVectors(to, from);
  const len = dir.length();
  if (len < 0.01) return;
  const m = new THREE.Mesh(tracerGeo, tracerMat.clone());
  m.position.copy(from).add(to).multiplyScalar(0.5);
  m.scale.set(1, len, 1);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  scene.add(m);
  particles.push({ mesh: m, life: 0.06, type: "fade" });
}
function spawnBurst(pos, color, count, speed) {
  for (let i = 0; i < count; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.05), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 }));
    m.position.copy(pos);
    m.userData.v = new THREE.Vector3((Math.random() - 0.5) * speed, Math.random() * speed * 0.7, (Math.random() - 0.5) * speed);
    scene.add(m);
    particles.push({ mesh: m, life: 0.35 + Math.random() * 0.2, type: "gravity" });
  }
}
function spawnMuzzleFlash(pos) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 6), new THREE.MeshBasicMaterial({ color: 0xffcf7a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  m.position.copy(pos);
  m.scale.set(1, 1, 1.5);
  scene.add(m);
  particles.push({ mesh: m, life: 0.05, type: "fade" });
}

// ================= 音频 =================
let audioCtx = null;
function initAudio() { if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
function playNoise(dur, freq, vol) {
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  const buf = audioCtx.createBuffer(1, audioCtx.sampleRate * dur, audioCtx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
  const src = audioCtx.createBufferSource(); src.buffer = buf;
  const f = audioCtx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = freq;
  const g = audioCtx.createGain(); g.gain.value = vol;
  src.connect(f); f.connect(g); g.connect(audioCtx.destination);
  src.start(t);
}
const playShot = () => playNoise(0.09, 1800, 0.45);
const playHit = () => playNoise(0.05, 900, 0.5);
const playHurt = () => playNoise(0.12, 500, 0.6);

// 3D 空间枪声：rel = 相对玩家朝向的水平方位角（rad），dist = 距离（米）
function playShotAt(rel, dist) {
  if (!audioCtx) return;
  const dur = 0.09;
  const t = audioCtx.currentTime;
  const buf = audioCtx.createBuffer(1, audioCtx.sampleRate * dur, audioCtx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
  const src = audioCtx.createBufferSource(); src.buffer = buf;
  const f = audioCtx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 1800;
  const g = audioCtx.createGain();
  g.gain.value = Math.max(0.04, Math.min(0.45, 0.5 * (1 - dist / 75)));
  src.connect(f); f.connect(g);
  if (audioCtx.createStereoPanner) {
    const p = audioCtx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, Math.sin(rel)));
    g.connect(p); p.connect(audioCtx.destination);
  } else {
    g.connect(audioCtx.destination);
  }
  src.start(t);
}

// ================= 输入 =================
const keys = {};
let crouchEdge = 0, proneEdge = 0, locked = false, shooting = false, ads = false;
let lastFire = 0, hitmarkerTime = 0, damageTime = 0, shotDirTime = 0;
let reloadAnimT = -1;      // 换弹动画计时（-1 = 未换弹）
let reloadHintT = 0;       // 换弹提示显示计时

window.addEventListener("keydown", (e) => {
  if (e.code === "Tab") { e.preventDefault(); toggleBoard(); return; }
  if (!locked) return;
  keys[e.code] = true;
  if (e.code === "KeyX") crouchEdge++;
  if (e.code === "KeyZ") proneEdge++;
  if (e.code === "KeyR") send({ type: "reload" });
  if (e.code === "Digit1") switchSlot(0);
  if (e.code === "Digit2") switchSlot(1);
  if (e.code === "KeyE") send({ type: "interact" });
});
window.addEventListener("keyup", (e) => { keys[e.code] = false; });

document.addEventListener("mousemove", (e) => {
  if (!locked) return;
  player.yaw -= e.movementX * SENSITIVITY;
  player.pitch -= e.movementY * SENSITIVITY;
  player.pitch = Math.max(-1.4, Math.min(1.4, player.pitch));
});
document.addEventListener("mousedown", (e) => {
  if (!locked) return;
  initAudio();
  if (e.button === 0) shooting = true;
  if (e.button === 2) ads = true;
});
document.addEventListener("mouseup", (e) => {
  if (e.button === 0) shooting = false;
  if (e.button === 2) ads = false;
});
document.addEventListener("contextmenu", (e) => e.preventDefault());

document.addEventListener("pointerlockchange", () => {
  locked = document.pointerLockElement === renderer.domElement;
  if (!locked) { shooting = false; ads = false; for (const k in keys) keys[k] = false; }
  if (!locked && started && player.alive) showToast("点击画面恢复鼠标控制");
});
renderer.domElement.addEventListener("click", () => {
  if (!locked && started) renderer.domElement.requestPointerLock();
});

// ================= 网络 =================
let ws, myId = -1, started = false;
let pendingName = "";
let playerName = "";
const player = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, stance: "stand", hp: 100, armor: 100, alive: true, ammo: 30, reloading: false, kills: 0, deaths: 0, score: 0, ads: false, team: null, slot: 0, weaponId: "ak47", hasBomb: false };
let respawnLeft = 0;
const leaderboardData = [];
let myWeapon = null;   // 当前主武器数据对象

function send(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }

function connect() {
  ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`);
  ws.onopen = () => { /* 等待选枪完成后 join */ };
  ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } handleMessage(m); };
  ws.onclose = () => { showToast("连接断开，正在重连…"); setTimeout(connect, 1500); };
}

function handleMessage(m) {
  if (m.type === "welcome") {
    myId = m.id;
    buildWorld(m.obstacles);
    if (m.weapons) WEAPONS = m.weapons;
    if (m.categories) CATEGORIES = m.categories;
    if (m.modes) MODES = m.modes;
    if (m.mode) { currentMode = m.mode; loadout.mode = m.mode; }
    if (m.bombSites) bombSites = m.bombSites;
    if (m.scoreLimit) scoreLimit = m.scoreLimit;
    showLoadout();
  } else if (m.type === "state") {
    applyState(m.players, m.kills, m);
  } else if (m.type === "mode") {
    currentMode = m.mode;
    updateModeHUD();
  } else if (m.type === "bomb") {
    updateBombHUD(m);
  } else if (m.type === "roundOver") {
    showRoundResult(m);
  } else if (m.type === "shoot") {
    if (m.id !== myId) {
      spawnTracer(new THREE.Vector3(...m.from), new THREE.Vector3(...m.to));
      // 枪声方位：计算相对玩家朝向的水平方位角与距离
      const sf = new THREE.Vector3(...m.from);
      const dx = sf.x - player.x, dz = sf.z - player.z;
      const sdist = Math.hypot(dx, dz);
      if (sdist <= 75) {
        const ang = Math.atan2(dx, dz);
        let rel = ang - player.yaw;
        while (rel > Math.PI) rel -= Math.PI * 2;
        while (rel < -Math.PI) rel += Math.PI * 2;
        playShotAt(rel, sdist);
        dom.shotIndicator.style.transform = `rotate(${rel}rad) translateY(-120px)`;
        dom.shotIndicator.classList.remove("hidden");
        shotDirTime = 0.8;
      }
    }
    if (m.id === myId) {
      if (m.hitId != null) {
        hitmarkerTime = 0.12; playHit();
        dom.hitmarker.classList.toggle("head", m.hitbox === "head");
        if (remotePlayers.has(m.hitId)) spawnBurst(new THREE.Vector3(...m.to), m.hitbox === "head" ? 0xff2222 : 0xff4444, 6, 3);
      }
    }
  } else if (m.type === "damage") {
    if (m.id === myId) {
      damageTime = 0.25; playHurt();
      const f = new THREE.Vector3(...m.from);
      const ang = Math.atan2(f.x - player.x, f.z - player.z);
      dom.damageIndicator.style.transform = `rotate(${ang}rad)`;
      dom.damageIndicator.classList.remove("hidden");
      dom.damageFlash.classList.remove("hidden");
    }
  } else if (m.type === "leaderboard") {
    renderBoard(m.board);
  }
}

function applyState(players, kills, m) {
  const meAliveBefore = player.alive;
  const seen = new Set();
  for (const p of players) {
    seen.add(p.id);
    if (p.id === myId) {
      player.x = p.x; player.y = p.y; player.z = p.z;
      player.stance = p.stance; player.hp = p.hp; player.armor = p.armor ?? 100; player.alive = p.alive;
      player.ammo = p.ammo; player.reloading = p.reloading;
      player.kills = p.kills; player.deaths = p.deaths; player.score = p.score ?? 0;
      player.team = p.team; player.slot = p.slot; player.weaponId = p.weaponId;
      player.hasBomb = p.hasBomb;
      if (p.weaponId) myWeapon = WEAPONS.find(w => w.id === p.weaponId) || null;
      if (!p.alive && meAliveBefore) respawnLeft = 3;
      if (p.alive && !meAliveBefore) dom.deathScreen.classList.add("hidden");
    } else {
      const r = getOrCreatePlayer(p);
      r.x = p.x; r.y = p.y; r.z = p.z; r.yaw = p.yaw; r.pitch = p.pitch;
      r.stance = p.stance; r.alive = p.alive; r.hp = p.hp; r.armor = p.armor ?? 100;
      r.name = p.name; r.color = p.color;
      setRemoteTeam(r, p.team);
    }
  }
  for (const [id, r] of remotePlayers) if (!seen.has(id)) { scene.remove(r.group); remotePlayers.delete(id); }
  if (m && m.mode) { currentMode = m.mode; }
  if (m && m.score) { currentScore = m.score; }
  // 击杀信息
  if (kills && kills.length) for (const k of kills) addKillFeed(k);
  updateHUD();
  updateModeHUD();
}

// ================= HUD =================
function updateHUD() {
  const hpPct = Math.max(0, Math.min(100, player.hp));
  dom.hpFill.style.width = hpPct + "%";
  dom.hpFill.style.background = hpPct > 50 ? "linear-gradient(90deg,#22c55e,#4ade80)" : hpPct > 25 ? "linear-gradient(90deg,#f59e0b,#fbbf24)" : "linear-gradient(90deg,#dc2626,#ef4444)";
  dom.hpText.textContent = Math.ceil(hpPct);
  const arPct = Math.max(0, Math.min(100, player.armor));
  dom.armorFill.style.width = arPct + "%";
  dom.armorText.textContent = Math.ceil(arPct);
  dom.armorBarVisible = arPct > 0;
  if (playerName === "唐1") {
    dom.ammo.textContent = "∞";
    dom.ammoMax.textContent = "/ ∞";
  } else {
    dom.ammo.textContent = player.ammo;
    const mag = myWeapon && !myWeapon.melee ? myWeapon.magSize : (player.slot === 1 ? "∞" : 30);
    dom.ammoMax.textContent = "/ " + mag;
  }
  dom.reloadText.classList.toggle("hidden", !player.reloading);
  dom.scoreText.textContent = `${player.kills} 杀 / ${player.deaths} 死`;
  dom.stanceText.textContent = STANCE_LABEL[player.stance] || "站立";
  let bots = 0; for (const r of remotePlayers.values()) if (r.isBot) bots++;
  const total = remotePlayers.size + 1;
  dom.botsText.textContent = `在线 ${total} 人 · 人机 ${bots}`;
  dom.deathScreen.classList.toggle("hidden", player.alive);
  // 武器名与切枪提示
  const slotWpn = player.slot === 1 ? WEAPONS.find(w => w.id === "knife") : myWeapon;
  dom.weaponName.textContent = slotWpn ? slotWpn.name : "AK-47";
  dom.slotHint.textContent = player.slot === 1 ? "近战 [按 1 切换主武器]" : "主武器 [按 2 切换近战]";
}

function addKillFeed(k) {
  const d = document.createElement("div");
  d.className = "kill-entry";
  if (k.headshot) d.classList.add("headshot");
  d.innerHTML = k.headshot
    ? `<span class="k" style="color:${k.killerColor}">${escapeHtml(k.killer)}</span> 精确打击击杀 <span class="k" style="color:${k.victimColor}">${escapeHtml(k.victim)}</span>`
    : `<span class="k" style="color:${k.killerColor}">${escapeHtml(k.killer)}</span> 击杀 <span class="k" style="color:${k.victimColor}">${escapeHtml(k.victim)}</span>`;
  dom.killfeed.appendChild(d);
  while (dom.killfeed.children.length > 6) dom.killfeed.firstChild.remove();
  setTimeout(() => d.remove(), 5000);
}
function escapeHtml(s) { return (s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

let boardOpen = false;
function toggleBoard() {
  boardOpen = !boardOpen;
  dom.leaderboard.classList.toggle("hidden", !boardOpen);
}
function renderBoard(board) {
  if (!board) return;
  const tbody = dom.boardTable.querySelector("tbody");
  tbody.innerHTML = "";
  board.forEach((p, i) => {
    const tr = document.createElement("tr");
    if (p.id === myId) tr.className = "me";
    const teamTag = p.team ? `<span style="color:${p.team === "red" ? "#f87171" : "#60a5fa"}">[${p.team === "red" ? "红" : "蓝"}]</span> ` : "";
    tr.innerHTML = `<td>${i + 1}</td><td style="color:${p.color}">${teamTag}${escapeHtml(p.name)}${p.isBot ? " 🤖" : ""}</td><td>${p.kills}</td><td>${p.deaths}</td><td>${p.score}</td>`;
    tbody.appendChild(tr);
  });
}
function showToast(text) { dom.toast.textContent = text; dom.toast.classList.remove("hidden"); setTimeout(() => dom.toast.classList.add("hidden"), 2000); }

// 模式 / 比分 HUD
let currentScore = { red: 0, blue: 0 };
function updateModeHUD() {
  dom.modeText.textContent = MODE_NAME[currentMode] || "团队竞技";
  if (currentMode === "tdm") {
    dom.teamScore.textContent = `红军 ${currentScore.red} : ${currentScore.blue} 蓝军`;
  } else if (currentMode === "bomb") {
    dom.teamScore.textContent = `红军 ${currentScore.red} : ${currentScore.blue} 蓝军`;
  } else {
    dom.teamScore.textContent = "";
  }
}
function updateBombHUD(m) {
  if (m && m.score) currentScore = m.score;
  updateModeHUD();
  const b = dom.bombStatus;
  if (!m || m.phase === "live") {
    if (m && !m.bomb) { b.classList.add("hidden"); }
    else { b.classList.remove("hidden"); b.textContent = m && m.planting ? "⚡ 正在安放炸弹…" : "🔹 炸弹已就绪"; }
    return;
  }
  b.classList.remove("hidden");
  if (m.defusing) b.textContent = `🔧 ${m.defusing} 正在拆除炸弹…`;
  else if (m.phase === "planted") b.textContent = `💣 炸弹已安放！`;
}
function showRoundResult(m) {
  dom.roundResult.classList.remove("hidden");
  const myTeam = player.team;
  const win = (m.winner === null) ? false : (m.winner === myTeam);
  dom.roundResultText.textContent = m.text || "回合结束";
  dom.roundResultText.className = win ? "win" : "lose";
  if (m.score) currentScore = m.score;
  updateModeHUD();
  setTimeout(() => dom.roundResult.classList.add("hidden"), 4000);
}

// ================= 切枪 =================
function switchSlot(slot) {
  if (!started || !player.alive || player.reloading) return;
  if (player.slot === slot) return;
  player.slot = slot;
  send({ type: "switch", slot });
  switchAnimT = 0.35;
}

// ================= 选枪界面 =================
let loadoutReady = false;
function showLoadout() {
  dom.startScreen.classList.add("hidden");
  dom.loadoutScreen.classList.remove("hidden");
  dom.hud.classList.add("hidden");
  renderModes();
  renderCategories();
  renderWeapons();
  updateLoadoutNav();
  updateWeaponStats();
}
function renderModes() {
  dom.modeList.innerHTML = "";
  for (const m of MODES) {
    const el = document.createElement("div");
    el.className = "mode-card" + (loadout.mode === m.id ? " sel" : "");
    el.innerHTML = `<div class="m-name">${m.name}</div><div class="m-desc">${m.desc}</div>`;
    el.onclick = () => { loadout.mode = m.id; renderModes(); };
    dom.modeList.appendChild(el);
  }
}
function renderCategories() {
  dom.categoryList.innerHTML = "";
  for (const c of CATEGORIES) {
    const el = document.createElement("div");
    el.className = "cat-card" + (loadout.category === c.id ? " sel" : "");
    el.innerHTML = `<div class="c-name">${c.name}</div><div class="c-desc">${c.desc}</div>`;
    el.onclick = () => {
      loadout.category = c.id;
      const first = WEAPONS.find(w => w.category === c.id);
      if (first) loadout.weaponId = first.id;
      renderCategories(); renderWeapons(); updateWeaponStats();
    };
    dom.categoryList.appendChild(el);
  }
}
function renderWeapons() {
  dom.weaponList.innerHTML = "";
  const list = WEAPONS.filter(w => w.category === loadout.category);
  for (const w of list) {
    const el = document.createElement("div");
    el.className = "weapon-card" + (loadout.weaponId === w.id ? " sel" : "");
    const cat = CATEGORIES.find(c => c.id === w.category);
    el.innerHTML = `<div class="w-name">${w.name}</div><div class="w-cat">${cat ? cat.name : ""}</div>`;
    el.onclick = () => { loadout.weaponId = w.id; renderWeapons(); updateWeaponStats(); };
    dom.weaponList.appendChild(el);
  }
}
function updateLoadoutNav() {
  dom.stepCategory.classList.toggle("hidden", loadout.category === null);
  dom.stepWeapon.classList.toggle("hidden", loadout.category === null);
  dom.confirmLoadout.classList.toggle("hidden", !loadout.weaponId);
}
function updateWeaponStats() {
  const w = WEAPONS.find(x => x.id === loadout.weaponId);
  if (!w) { dom.weaponStats.innerHTML = ""; return; }
  const bars = [
    ["伤害", Math.min(100, w.damage * (w.melee ? 1 : (w.pellets ? w.pellets : 1)) / 1.3)],
    ["射速", Math.max(5, Math.min(100, (1 - w.fireInterval) * 100))],
    ["弹匣", Math.min(100, (w.magSize === Infinity ? 100 : w.magSize))],
    ["精度", Math.max(5, 100 - w.spread * 1600)],
    ["射程", Math.min(100, w.range / 4.5)],
    ["后坐", Math.min(100, 100 - w.recoil * 2000)],
    ["机动", Math.min(100, (w.moveSpeed - 0.8) * 500)],
  ];
  const rows = bars.map(b => `
    <div class="stat-row"><span class="s-label">${b[0]}</span>
      <span class="stat-bar"><i style="width:${Math.round(b[1])}%"></i></span>
      <span class="s-val">${b[0] === "弹匣" && w.magSize === Infinity ? "∞" : (b[0] === "伤害" && w.pellets ? w.damage + "×" + w.pellets : (b[0] === "射速" ? (1 / w.fireInterval).toFixed(0) + "/s" : b[0] === "射程" ? w.range + "m" : b[0] === "后坐" ? (w.recoil * 1000).toFixed(0) : ""))}</span>
    </div>`).join("");
  dom.weaponStats.innerHTML = `<div class="s-title">${w.name} · 属性</div>${rows}` +
    (w.scope > 1 ? `<div class="stat-row"><span class="s-label">开镜</span><span class="s-val" style="width:auto">${w.scope}×</span></div>` : "") +
    (w.reloadTime ? `<div class="stat-row"><span class="s-label">换弹</span><span class="s-val" style="width:auto">${w.reloadTime}s</span></div>` : "");
}
dom.backToMode.addEventListener("click", () => { loadout.category = null; updateLoadoutNav(); });
dom.backToCat.addEventListener("click", () => { loadout.category = null; updateLoadoutNav(); });
dom.confirmLoadout.addEventListener("click", enterBattle);
function enterBattle() {
  if (!loadout.weaponId) return;
  pendingName = loadout.name;
  playerName = loadout.name;
  dom.loadoutScreen.classList.add("hidden");
  dom.hud.classList.remove("hidden");
  started = true;
  connect();
  if (ws.readyState === 1) {
    send({ type: "join", name: loadout.name, mode: loadout.mode, weaponId: loadout.weaponId });
  } else {
    ws.onopen = () => send({ type: "join", name: loadout.name, mode: loadout.mode, weaponId: loadout.weaponId });
  }
  renderer.domElement.requestPointerLock();
}

// ================= 发送输入 =================
let lastSend = 0;
function sendInput() {
  const mx = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  const mz = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
  send({
    type: "input", mx, mz,
    sprint: !!(keys.ShiftLeft || keys.ShiftRight),
    jump: !!keys.Space,
    shooting: shooting && player.alive,
    ads,
    yaw: player.yaw, pitch: player.pitch,
    crouchEdge, proneEdge,
  });
}

// ================= 射击（本地预测视觉） =================
const ray = new THREE.Raycaster();
const tmpV = new THREE.Vector3();
function tryLocalFire() {
  if (!shooting || !player.alive || player.reloading) return;
  const w = player.slot === 1 ? null : myWeapon;
  if (w && w.melee) return;          // 近战由服务器判定，本地不做射线
  if (player.slot === 1) return;     // 近战槽位
  if (!w) return;
  if (player.ammo <= 0) return;
  const now = performance.now();
  if (now - lastFire < w.fireInterval * 1000) return;
  lastFire = now;
  recoilKick = Math.min(1, recoilKick + (w.recoil * 30 + 0.25));

  const spread = w.spread * 0.4; // 本地视觉散射
  const sy = player.yaw + (Math.random() * 2 - 1) * spread;
  const sp = player.pitch + (Math.random() * 2 - 1) * spread;
  const cp = Math.cos(sp);
  const dir = new THREE.Vector3(Math.sin(sy) * cp, Math.sin(sp), Math.cos(sy) * cp);

  muzzle.getWorldPosition(tmpV);
  ray.set(tmpV, dir);
  ray.far = w.range;
  const hits = ray.intersectObjects(colliders, false);
  const end = hits.length ? hits[0].point : tmpV.clone().addScaledVector(dir, w.range);

  spawnTracer(tmpV.clone(), end);
  spawnMuzzleFlash(tmpV.clone());
  spawnBurst(end, hits.length && hits[0].object === ground ? 0x6b6b5a : 0xc9c9c9, w.pellets ? w.pellets : 4, 2.5);
  playShot();
}

// ================= 更新 =================
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1);

  // 相机
  const eyeH = EYE[player.stance];
  const cp = Math.cos(player.pitch), sp = Math.sin(player.pitch);
  camera.position.set(player.x, player.y + eyeH, player.z);
  camera.lookAt(camera.position.x + Math.sin(player.yaw) * cp, camera.position.y + sp, camera.position.z + Math.cos(player.yaw) * cp);

  // 武器：开镜动画
  const gunTarget = ads ? GUN_ADS : GUN_HIP;
  const gk = 1 - Math.exp(-14 * dt);
  fpGun.position.lerp(gunTarget.pos, gk);
  fpGun.rotation.x += (gunTarget.rot.x - fpGun.rotation.x) * gk;
  fpGun.rotation.y += (gunTarget.rot.y - fpGun.rotation.y) * gk;
  fpGun.rotation.z += (gunTarget.rot.z - fpGun.rotation.z) * gk;

  // 射击后坐力动画（枪身上跳并快速回落）
  if (recoilKick > 0.001) {
    fpGun.position.z += recoilKick * 0.12;
    fpGun.rotation.x -= recoilKick * 0.12;
    recoilKick *= Math.exp(-9 * dt);
  }

  // 切枪动画（枪身下沉再抬起）
  if (switchAnimT > 0) {
    switchAnimT -= dt;
    const s = Math.sin((1 - Math.max(0, switchAnimT) / 0.35) * Math.PI);
    fpGun.position.y -= s * 0.28;
    fpGun.rotation.x -= s * 0.4;
  }

  // 换弹动画（拆弹夹 → 装弹夹）
  const reloadDur = (myWeapon && myWeapon.reloadTime) ? myWeapon.reloadTime : 2.0;
  if (player.reloading) {
    if (reloadAnimT < 0) reloadAnimT = 0;
    reloadAnimT += dt;
    const pr = Math.min(1, reloadAnimT / reloadDur);
    // 前半段拆下弹夹，后半段装上新弹夹
    let k;
    if (pr < 0.5) k = pr / 0.5;         // 0 -> 1 拆下
    else k = 1 - (pr - 0.5) / 0.5;      // 1 -> 0 装上
    fpMag.position.copy(MAG_BASE).lerp(MAG_OUT, k);
    // 枪身随换弹节奏轻微下压
    const wave = Math.sin(pr * Math.PI);
    fpGun.position.y -= wave * 0.05;
    fpGun.rotation.x -= wave * 0.10;
    // 换弹时间提示
    const remain = Math.max(0, reloadDur - reloadAnimT);
    dom.reloadHint.classList.remove("hidden");
    dom.reloadFill.style.transform = `scaleX(${pr})`;
    dom.reloadCount.textContent = remain.toFixed(1) + "s";
  } else {
    if (reloadAnimT >= 0) {
      reloadAnimT = -1;
      fpMag.position.copy(MAG_BASE);
      dom.reloadHint.classList.add("hidden");
    }
  }

  // FOV（开镜倍率影响：倍率越高 FOV 越小）
  const scope = (myWeapon && myWeapon.scope > 1) ? myWeapon.scope : 1;
  const adsFov = FOV_BASE / scope;
  const targetFov = ads ? adsFov : FOV_BASE;
  camera.fov += (targetFov - camera.fov) * gk;
  camera.updateProjectionMatrix();

  // 开镜 UI
  dom.adsDot.classList.toggle("hidden", !ads);
  dom.scopeVignette.classList.toggle("hidden", !ads);

  // 准心扩散
  const moving = Math.abs(keys.KeyW || keys.KeyA || keys.KeyS || keys.KeyD || 0);
  let spreadPx = ads ? 0 : (moving ? 3 : 0) + (shooting ? 4 : 0);
  if (!locked) spreadPx = 0;
  const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
  dom.chLines.forEach((el, i) => { el.style.transform = `translate(${dirs[i][0] * spreadPx}px,${dirs[i][1] * spreadPx}px)`; });

  // 命中标记
  if (hitmarkerTime > 0) { hitmarkerTime -= dt; dom.hitmarker.classList.remove("hidden"); }
  else dom.hitmarker.classList.add("hidden");
  if (damageTime > 0) { damageTime -= dt; }
  else { dom.damageFlash.classList.add("hidden"); dom.damageIndicator.classList.add("hidden"); }
  if (shotDirTime > 0) { shotDirTime -= dt; }
  else dom.shotIndicator.classList.add("hidden");

  // 死亡倒计时
  if (!player.alive) {
    respawnLeft -= dt;
    dom.respawnText.textContent = Math.max(0, Math.ceil(respawnLeft)) + " 秒后重生…";
    dom.deathScreen.classList.remove("hidden");
  }

  // 本地射击
  tryLocalFire();

  // 远程角色插值
  updateRemotes(dt);

  // 粒子
  updateParticles(dt);

  // 发送输入（30Hz）
  const now = performance.now();
  if (now - lastSend > 33) { sendInput(); lastSend = now; }

  renderer.render(scene, camera);
}

function updateRemotes(dt) {
  const k = 1 - Math.exp(-14 * dt);
  for (const r of remotePlayers.values()) {
    if (!r.alive) { r.group.visible = false; continue; }
    r.group.visible = true;
    r.group.position.x += (r.x - r.group.position.x) * k;
    r.group.position.y += (r.y - r.group.position.y) * k;
    r.group.position.z += (r.z - r.group.position.z) * k;
    // 朝向
    let dy = r.yaw - r.body.rotation.y;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    r.body.rotation.y += dy * k;
    // 姿态
    const pose = POSE[r.stance] || POSE.stand;
    r.body.scale.y += (pose.scaleY - r.body.scale.y) * k;
    r.body.rotation.x += (pose.rotX - r.body.rotation.x) * k;
    r.body.position.y += (pose.yOff - r.body.position.y) * k;
    const tagH = r.stance === "prone" ? 0.9 : 2.15;
    r.label.position.y += (tagH - r.label.position.y) * k;
    r.hpSprite.position.y += ((tagH - 0.1) - r.hpSprite.position.y) * k;
    r.hpSprite.scale.x = 1.1 * Math.max(0, r.hp / 100);
    r.hpSprite.material.color.setHSL(r.hp > 50 ? 0.36 : r.hp > 25 ? 0.11 : 0, 0.8, 0.5);
  }
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) { scene.remove(p.mesh); p.mesh.material.dispose(); particles.splice(i, 1); continue; }
    if (p.type === "gravity") { p.mesh.userData.v.y -= 9 * dt; p.mesh.position.addScaledVector(p.mesh.userData.v, dt); }
    else if (p.type === "fade") { p.mesh.material.opacity = Math.max(0, p.life / 0.06); }
  }
}

// ================= 启动 =================
dom.startBtn.addEventListener("click", start);
dom.nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") start(); });
try { const saved = localStorage.getItem("gunfight_name"); if (saved) dom.nameInput.value = saved; } catch {}
dom.nameInput.focus();
function start() {
  initAudio();
  const name = dom.nameInput.value.trim() || ("玩家" + Math.floor(Math.random() * 999));
  try { localStorage.setItem("gunfight_name", name); } catch {}
  loadout.name = name;
  connect();
}

window.addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

showToast("正在加载…");
animate();

