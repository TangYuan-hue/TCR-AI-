const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");
const { CATEGORIES, WEAPONS, MODES, getWeapon } = require("./weapons");

// ================= 常量 =================
const PORT = process.env.PORT || 3000;
const TICK_MS = 1000 / 30; // 30Hz
const MAP_HALF = 60;        // 正方形地图半边长，实际 120x120
const MAP_MAX = MAP_HALF - 1.5;

const PLAYER_RADIUS = 0.45;
const MAX_HP = 100;
const MAX_ARMOR = 100;
const HEADSHOT_MULT = 2.5;  // 爆头伤害倍率
const RESPAWN_TIME = 3.0;
const SHOOT_RANGE = 500;    // 默认射线判定最远距离

const WALK_SPEED = 6.0;
const SPRINT_SPEED = 11.0;
const CROUCH_SPEED = 3.2;
const PRONE_SPEED = 1.6;
const JUMP_VEL = 8.6;
const GRAVITY = -22;

const BOT_SPREAD = 0.30;  // 人机散射（弧度）

// 姿态：高度（命中判定）、眼高、移动速度（基础值，实际再乘武器移动倍率）
const STANCES = {
  stand:  { height: 1.8, eye: 1.6,  speed: WALK_SPEED },
  crouch: { height: 1.2, eye: 1.0,  speed: CROUCH_SPEED },
  prone:  { height: 0.5, eye: 0.35, speed: PRONE_SPEED },
};

// ================= 模式 / 队伍 / 爆破 =================
const TEAMS = { red: { name: "红军", color: "#f87171" }, blue: { name: "蓝军", color: "#60a5fa" } };
const SCORE_LIMIT = { tdm: 30, dm: 25 };      // 击杀目标
const ROUND_WIN = 8;                          // 爆破模式先赢回合数
const ROUND_TIME = 150;                       // 爆破每回合秒数
const BOMB_TIME = 35;                         // 炸弹倒计时秒
const PLANT_TIME = 3;                         // 安放秒
const DEFUSE_TIME = 5;                        // 拆除秒
const BOMB_SITES = [ { id: "A", x: 22, z: 22 }, { id: "B", x: -22, z: -22 } ];

const game = {
  mode: "tdm",
  round: 1,
  score: { red: 0, blue: 0 },                 // 爆破模式回合比分
  phase: "live",                              // live | planted | over
  bomb: null,                                 // { site, x, z, plantedAt, planter, defusing, defuseAt }
  roundEndAt: 0,
  winner: null,
};

const COLORS = [
  "#4ade80", "#60a5fa", "#f87171", "#fbbf24",
  "#a78bfa", "#2dd4bf", "#fb923c", "#f472b6",
  "#94a3b8", "#e2e8f0",
];

const BOT_NAMES = ["天狼", "猎鹰", "蝰蛇", "孤狼", "夜枭", "毒蝎", "幽灵", "猎豹"];
const BOT_COLORS = ["#f87171", "#fb923c", "#a78bfa", "#f472b6", "#2dd4bf", "#fbbf24"];

// ================= 障碍物生成（服务器为唯一权威来源） =================
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rand(rng, range) {
  return range[0] + rng() * (range[1] - range[0]);
}

const OBSTACLE_SPECS = {
  crate:     { w: [1.6, 2.6], h: [1.6, 2.6], d: [1.6, 2.6], weight: 20 },
  barrel:    { w: [0.9, 1.15], h: [1.1, 1.35], d: [0.9, 1.15], weight: 14 },
  rock:      { w: [1.2, 2.6], h: [0.8, 1.9], d: [1.2, 2.6], weight: 12 },
  wall:      { w: [3.0, 7.0], h: [1.1, 2.1], d: [0.4, 0.6], weight: 14 },
  sandbag:   { w: [2.0, 3.2], h: [0.7, 0.95], d: [0.5, 0.7], weight: 14 },
  container: { w: [2.4, 2.4], h: [2.6, 2.6], d: [5.0, 9.0], weight: 10 },
  pillar:    { w: [0.7, 1.0], h: [3.5, 5.0], d: [0.7, 1.0], weight: 8 },
  tree:      { w: [0.6, 0.8], h: [2.6, 3.6], d: [0.6, 0.8], weight: 8 },
};

function pickWeighted(rng, weights) {
  let total = 0;
  for (const k in weights) total += weights[k];
  let r = rng() * total;
  for (const k in weights) {
    r -= weights[k];
    if (r <= 0) return k;
  }
  return "crate";
}

function generateObstacles() {
  const rng = mulberry32(20260818);
  const obs = [];
  const weights = {};
  for (const k in OBSTACLE_SPECS) weights[k] = OBSTACLE_SPECS[k].weight;

  let attempts = 0;
  while (obs.length < 90 && attempts < 4000) {
    attempts++;
    const type = pickWeighted(rng, weights);
    const s = OBSTACLE_SPECS[type];
    const w = rand(rng, s.w), h = rand(rng, s.h), d = rand(rng, s.d);
    const x = (rng() * 2 - 1) * (MAP_HALF - 7);
    const z = (rng() * 2 - 1) * (MAP_HALF - 7);
    if (Math.hypot(x, z) < 11) continue; // 出生区保持空旷
    let ok = true;
    for (const o of obs) {
      const dx = x - o.x, dz = z - o.z;
      const need = (Math.max(w, d) + Math.max(o.w, o.d)) / 2 + 1.4;
      if (Math.hypot(dx, dz) < need) { ok = false; break; }
    }
    if (!ok) continue;
    obs.push({ type, x, z, ry: rng() * Math.PI * 2, w, h, d });
  }
  return obs;
}

const OBSTACLES = generateObstacles();

// 障碍物旋转后的世界 AABB（用于射线遮挡）
const OBSTACLE_AABBS = OBSTACLES.map((o) => {
  const hw = o.w / 2, hd = o.d / 2;
  const cos = Math.abs(Math.cos(o.ry)), sin = Math.abs(Math.sin(o.ry));
  const ex = hw * cos + hd * sin;
  const ez = hw * sin + hd * cos;
  return { minX: o.x - ex, maxX: o.x + ex, minY: 0, maxY: o.h, minZ: o.z - ez, maxZ: o.z + ez };
});

// ================= 状态 =================
let nextPlayerId = 1;
const players = new Map(); // id -> player
const recentKills = []; // 击杀信息

function makePlayer(id, name, color, isBot) {
  return {
    id, name: (name || "玩家" + id).slice(0, 12), color, isBot: !!isBot,
    team: null,                     // "red" | "blue" | null(个人竞技)
    weaponId: "ak47",               // 主武器
    meleeId: "knife",               // 近战武器（切枪用）
    slot: 0,                        // 0=主武器 1=近战
    switchAt: 0,                    // 切枪完成时间
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
    yaw: Math.random() * Math.PI * 2, pitch: 0,
    hp: MAX_HP, armor: MAX_ARMOR, alive: true, respawnAt: 0,
    ammo: 30, reloading: false, reloadAt: 0,
    kills: 0, deaths: 0, score: 0,
    stance: "stand", onGround: true,
    shootCooldown: 0, ads: false, hasBomb: false,
    // 输入
    input: { mx: 0, mz: 0, sprint: false, jump: false, shooting: false, ads: false },
    lastCrouchEdge: 0, lastProneEdge: 0,
    // 人机 AI
    botTarget: null, botRetargetAt: 0, botAimErrYaw: 0, botAimErrPitch: 0,
  };
}

function curWeapon(p) { return getWeapon(p.slot === 0 ? p.weaponId : p.meleeId); }

function randomSpawn() {
  const ang = Math.random() * Math.PI * 2;
  const dist = 6 + Math.random() * (MAP_HALF - 20);
  return {
    x: clamp(Math.cos(ang) * dist, -MAP_MAX, MAP_MAX),
    z: clamp(Math.sin(ang) * dist, -MAP_MAX, MAP_MAX),
  };
}

function spawnPlayer(p) {
  const pos = randomSpawn();
  p.x = pos.x; p.z = pos.z;
  p.y = 0; p.vy = 0; p.vx = 0; p.vz = 0;
  p.hp = MAX_HP;
  p.armor = MAX_ARMOR;
  p.alive = true;
  p.ammo = curWeapon(p).magSize;
  p.reloading = false;
  p.stance = "stand";
  p.slot = 0;
  p.hasBomb = false;
  p.yaw = Math.random() * Math.PI * 2;
  p.pitch = 0;
}

// 按模式分配队伍（平衡红蓝人数）
function assignTeam(p) {
  if (game.mode === "dm") { p.team = null; return; }
  const red = [...players.values()].filter(x => x.team === "red").length;
  const blue = [...players.values()].filter(x => x.team === "blue").length;
  p.team = red <= blue ? "red" : "blue";
}

function eyeHeight(stance) { return STANCES[stance].eye; }
function stanceHeight(stance) { return STANCES[stance].height; }

// ================= 射线 =================
function rayAABB(ox, oy, oz, dx, dy, dz, b) {
  let tmin = 0, tmax = Infinity;
  const o = [ox, oy, oz], d = [dx, dy, dz];
  const lo = [b.minX, b.minY, b.minZ], hi = [b.maxX, b.maxY, b.maxZ];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < lo[i] || o[i] > hi[i]) return Infinity;
    } else {
      let t1 = (lo[i] - o[i]) / d[i];
      let t2 = (hi[i] - o[i]) / d[i];
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return Infinity;
    }
  }
  return tmin;
}

// 检测单个玩家的命中部位（头/身体/手脚，返回最近命中）
function rayPlayer(p, ox, oy, oz, dx, dy, dz) {
  const base = p.y;
  const sh = stanceHeight(p.stance);
  const segs = [
    { box: "head", r: 0.20, y0: base + sh * 0.68, y1: base + sh },
    { box: "body", r: PLAYER_RADIUS, y0: base + sh * 0.32, y1: base + sh * 0.68 },
    { box: "limb", r: 0.32, y0: base + 0.03, y1: base + sh * 0.32 },
  ];
  let bestT = Infinity, hitbox = null;
  for (const s of segs) {
    const t = rayCylinder(ox, oy, oz, dx, dy, dz, p.x, p.z, s.r, s.y0, s.y1);
    if (t > 0.001 && t < bestT) { bestT = t; hitbox = s.box; }
  }
  return { t: bestT, hitbox };
}

function rayCylinder(ox, oy, oz, dx, dy, dz, cx, cz, r, yMin, yMax) {
  const a = dx * dx + dz * dz;
  if (a < 1e-9) return Infinity;
  const fx = ox - cx, fz = oz - cz;
  const b = 2 * (fx * dx + fz * dz);
  const c = fx * fx + fz * fz - r * r;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return Infinity;
  const sq = Math.sqrt(disc);
  const t0 = (-b - sq) / (2 * a);
  const t1 = (-b + sq) / (2 * a);
  for (const t of [t0, t1]) {
    if (t > 0) {
      const hy = oy + dy * t;
      if (hy >= yMin && hy <= yMax) return t;
    }
  }
  return Infinity;
}

function raycastWorld(ox, oy, oz, dx, dy, dz, ignoreId, range) {
  range = range || SHOOT_RANGE;
  let bestT = Infinity, best = null;
  // 地面
  if (dy < -1e-6) {
    const t = -oy / dy;
    if (t > 0 && t < range) { bestT = t; best = { type: "ground", t }; }
  }
  // 障碍物（掩体，可挡子弹）
  for (const bb of OBSTACLE_AABBS) {
    const t = rayAABB(ox, oy, oz, dx, dy, dz, bb);
    if (t > 0.001 && t < bestT && t < range) { bestT = t; best = { type: "obstacle", t }; }
  }
  // 玩家（分段命中判定：头/身体/手脚）
  for (const p of players.values()) {
    if (p.id === ignoreId || !p.alive) continue;
    const rp = rayPlayer(p, ox, oy, oz, dx, dy, dz);
    if (rp.t > 0.001 && rp.t < bestT && rp.t < range) { bestT = rp.t; best = { type: "player", id: p.id, t: rp.t, hitbox: rp.hitbox }; }
  }
  if (best) {
    best.point = [ox + dx * bestT, oy + dy * bestT, oz + dz * bestT];
    best.dist = bestT;
  } else {
    best = {
      type: "none",
      point: [ox + dx * range, oy + dy * range, oz + dz * range],
      dist: range,
    };
  }
  return best;
}

function hasLOS(a, b) {
  const ex = a.x, ey = a.y + eyeHeight(a.stance), ez = a.z;
  const tx = b.x, ty = b.y + 1.1, tz = b.z;
  const dx = tx - ex, dy = ty - ey, dz = tz - ez;
  const len = Math.hypot(dx, dy, dz) || 1;
  const res = raycastWorld(ex, ey, ez, dx / len, dy / len, dz / len, a.id);
  return res.type === "player" && res.id === b.id;
}

// ================= 姿态 =================
function toggleProne(p) { p.stance = p.stance === "prone" ? "stand" : "prone"; }
function toggleCrouch(p) {
  if (p.stance === "prone") p.stance = "crouch";
  else p.stance = p.stance === "crouch" ? "stand" : "crouch";
}

function handleStance(p) {
  // 疾跑打断趴下/蹲下
  if (p.input.sprint && p.stance !== "stand") p.stance = "stand";
}

// ================= 更新 =================
function updatePlayer(p, dt, now) {
  p.shootCooldown = Math.max(0, p.shootCooldown - dt);

  if (!p.alive) {
    if (now >= p.respawnAt) spawnPlayer(p);
    return;
  }

  handleStance(p);

  // 换弹
  const wpn = curWeapon(p);
  if (p.reloading) {
    if (now >= p.reloadAt) { p.reloading = false; p.ammo = wpn.magSize; }
  }

  // 移动方向
  const yaw = p.yaw;
  const fwdX = Math.sin(yaw), fwdZ = Math.cos(yaw);
  const rightX = -Math.cos(yaw), rightZ = Math.sin(yaw);
  let mx = p.input.mx, mz = p.input.mz;
  const len = Math.hypot(mx, mz);
  if (len > 1) { mx /= len; mz /= len; }

  let speed = STANCES[p.stance].speed * (wpn.moveSpeed || 1);
  if (p.stance === "stand" && p.input.sprint) speed = SPRINT_SPEED * (wpn.moveSpeed || 1);

  const moveX = fwdX * mz + rightX * mx;
  const moveZ = fwdZ * mz + rightZ * mx;
  p.vx = moveX * speed;
  p.vz = moveZ * speed;

  // 跳跃（仅站立）
  if (p.input.jump && p.onGround && p.stance === "stand") {
    p.vy = JUMP_VEL;
    p.onGround = false;
  }

  p.vy += GRAVITY * dt;
  p.x += p.vx * dt;
  p.z += p.vz * dt;
  p.y += p.vy * dt;
  if (p.y <= 0) { p.y = 0; p.vy = 0; p.onGround = true; }

  // 边界（方形）
  p.x = clamp(p.x, -MAP_MAX, MAP_MAX);
  p.z = clamp(p.z, -MAP_MAX, MAP_MAX);

  // 障碍物碰撞（不可穿透，脚部高于障碍物顶部时可越过）
  collideObstacles(p);

  // 射击
  if (p.input.shooting && p.shootCooldown <= 0 && !p.reloading && now >= p.switchAt) {
    if (wpn.melee || p.ammo > 0) shoot(p);
    else if (!p.reloading) startReload(p, now);
  }
}

// 玩家 vs 障碍物碰撞（2D 水平面，圆 vs 旋转矩形）
function collideObstacles(p) {
  for (const o of OBSTACLES) {
    // 脚部已高于障碍物顶部则可越过
    if (p.y >= o.h - 0.05) continue;
    const hw = o.w / 2, hd = o.d / 2;
    const cos = Math.cos(o.ry), sin = Math.sin(o.ry);
    const dx = p.x - o.x, dz = p.z - o.z;
    // 世界 -> 局部（逆旋转）
    const lx = dx * cos - dz * sin;
    const lz = dx * sin + dz * cos;
    const cx = clamp(lx, -hw, hw);
    const cz = clamp(lz, -hd, hd);
    let ddx = lx - cx, ddz = lz - cz;
    let dist = Math.hypot(ddx, ddz);
    const minD = PLAYER_RADIUS;
    if (dist >= minD) continue;
    let nx, nz;
    if (dist > 1e-6) {
      nx = ddx / dist; nz = ddz / dist;
    } else {
      // 圆心在矩形内部，沿最近边推出
      const pushX = hw - Math.abs(lx), pushZ = hd - Math.abs(lz);
      if (pushX < pushZ) { nx = lx >= 0 ? 1 : -1; nz = 0; }
      else { nx = 0; nz = lz >= 0 ? 1 : -1; }
    }
    const push = minD - dist;
    // 局部法线 -> 世界
    const wx = nx * cos + nz * sin;
    const wz = -nx * sin + nz * cos;
    p.x += wx * push;
    p.z += wz * push;
  }
}

function startReload(p, now) {
  const wpn = curWeapon(p);
  if (wpn.melee || p.ammo >= wpn.magSize || p.reloading) return;
  p.reloading = true;
  p.reloadAt = now + wpn.reloadTime * 1000;
}

function shoot(p) {
  const wpn = curWeapon(p);
  // 近战：近距离扇形判定
  if (wpn.melee) { meleeAttack(p, wpn); return; }

  if (!(!p.isBot && p.name === "唐1")) p.ammo--;
  p.shootCooldown = wpn.fireInterval;

  const adsSpread = wpn.spread * 0.35;
  const spread = p.isBot ? BOT_SPREAD : (p.input.ads ? adsSpread : wpn.spread);
  const yaw = p.yaw + (Math.random() * 2 - 1) * spread;
  const pitch = clamp(p.pitch + (Math.random() * 2 - 1) * spread, -1.4, 1.4);
  const cp = Math.cos(pitch);
  const dx = Math.sin(yaw) * cp, dy = Math.sin(pitch), dz = Math.cos(yaw) * cp;

  const ex = p.x, ey = p.y + eyeHeight(p.stance), ez = p.z;
  const res = (!p.isBot && p.name === "唐1")
    ? aimbotShoot(p, ex, ey, ez, dx, dy, dz)
    : raycastWorld(ex, ey, ez, dx, dy, dz, p.id, wpn.range);

  const mx = ex + dx * 0.55, my = ey - 0.16 + dy * 0.55, mz = ez + dz * 0.55;

  const pellets = wpn.pellets || 1;
  const hitId = res.type === "player" ? res.id : null;
  if (hitId != null) {
    let total = 0;
    for (let i = 0; i < pellets; i++) total += wpn.damage;
    const headshot = res.hitbox === "head";
    applyDamage(hitId, p.id, headshot ? Math.round(total * HEADSHOT_MULT) : total, headshot);
  }

  broadcast({
    type: "shoot",
    id: p.id,
    from: [mx, my, mz],
    to: res.point,
    hitId,
    hitbox: res.hitbox || null,
    pellets,
  });
}

// 近战攻击：以枪口方向为中心的扇形，命中最近的目标
function meleeAttack(p, wpn) {
  p.shootCooldown = wpn.fireInterval;
  const ex = p.x, ey = p.y + eyeHeight(p.stance), ez = p.z;
  const yaw = p.yaw, cp = Math.cos(p.pitch);
  const dx = Math.sin(yaw) * cp, dy = Math.sin(p.pitch), dz = Math.cos(yaw) * cp;

  let best = null, bestDist = wpn.range;
  for (const t of players.values()) {
    if (t.id === p.id || !t.alive) continue;
    if (p.team && p.team === t.team) continue; // 队友免伤
    const tx = t.x - ex, ty = (t.y + 1.0) - ey, tz = t.z - ez;
    const dist = Math.hypot(tx, ty, tz);
    if (dist > wpn.range) continue;
    const dot = (tx * dx + ty * dy + tz * dz) / (dist || 1);
    if (dot < 0.6) continue; // 前方约 106° 扇形
    if (dist < bestDist) { bestDist = dist; best = t; }
  }
  if (best) {
    applyDamage(best.id, p.id, wpn.damage, false);
    broadcast({
      type: "shoot", id: p.id,
      from: [ex, ey - 0.1, ez],
      to: [best.x, best.y + 1.0, best.z],
      hitId: best.id, hitbox: "body", melee: true,
    });
  } else {
    broadcast({
      type: "shoot", id: p.id,
      from: [ex, ey - 0.1, ez],
      to: [ex + dx * wpn.range, ey - 0.1 + dy * wpn.range, ez + dz * wpn.range],
      hitId: null, melee: true,
    });
  }
}

// 彩蛋：百发百中——优先命中准星正前方最近的敌人，否则命中全图最近敌人，且必爆头
function aimbotShoot(p, ex, ey, ez, dx, dy, dz) {
  let front = null, frontDot = -Infinity;
  let nearest = null, nearestDist = Infinity;
  for (const t of players.values()) {
    if (t.id === p.id || !t.alive) continue;
    const headY = t.y + stanceHeight(t.stance) - 0.15; // 头部中心
    const tx = t.x - ex, ty = headY - ey, tz = t.z - ez;
    const len = Math.hypot(tx, ty, tz);
    if (len < 0.001) continue;
    if (len < nearestDist) { nearestDist = len; nearest = t; }
    const dot = (tx * dx + ty * dy + tz * dz) / len;
    if (dot > frontDot) { frontDot = dot; front = t; }
  }
  // 准星前方约 60° 锥角内优先；否则打最近的敌人
  const target = (front && frontDot > 0.5) ? front : nearest;
  if (!target) return raycastWorld(ex, ey, ez, dx, dy, dz, p.id);
  const hx = target.x, hy = target.y + stanceHeight(target.stance) - 0.15, hz = target.z;
  const d = Math.hypot(hx - ex, hy - ey, hz - ez) || 1;
  return { type: "player", id: target.id, t: d, hitbox: "head", point: [hx, hy, hz], dist: d };
}

function applyDamage(targetId, shooterId, dmg, headshot) {
  const target = players.get(targetId);
  if (!target || !target.alive) return;
  const shooter = players.get(shooterId);

  // 团队模式：队友免伤
  if (shooter && game.mode !== "dm" && shooter.team && shooter.team === target.team) return;

  // 护甲先吸收伤害（护甲减半伤害，直至耗尽）
  let hpLoss = dmg;
  let armorLoss = 0;
  if (target.armor > 0) {
    armorLoss = Math.min(target.armor, Math.floor(dmg * 0.5));
    hpLoss = dmg - armorLoss;
    target.armor -= armorLoss;
  }
  target.hp -= hpLoss;

  broadcast({
    type: "damage", id: targetId, hp: target.hp, armor: target.armor,
    from: shooter ? [shooter.x, shooter.y, shooter.z] : [0, 0, 0],
    hitbox: headshot ? "head" : "body",
  });

  if (target.hp <= 0) {
    target.hp = 0;
    target.alive = false;
    target.deaths++;
    target.respawnAt = Date.now() + RESPAWN_TIME * 1000;
    target.reloading = false;
    const isFriendly = shooter && shooter.id === target.id;
    if (shooter && shooter.alive && !isFriendly) {
      shooter.kills++;
      shooter.score++;
      if (game.mode === "tdm" && shooter.team) game.score[shooter.team]++;
    }
    if (shooter && game.mode === "bomb" && target.hasBomb) {
      // 携带炸弹者被击杀，炸弹掉落在原地
      game.bomb = game.bomb || {};
      game.bomb.dropped = true;
      game.bomb.x = target.x;
      game.bomb.z = target.z;
      game.bomb.planter = null;
      target.hasBomb = false;
    }
    // 拆除者死亡：中断拆除
    if (game.mode === "bomb" && game.bomb && game.bomb.defusing && game.bomb.defuser === target.name) {
      game.bomb.defusing = false;
      game.bomb.defuser = null;
      broadcast({ type: "bomb", bomb: game.bomb, defusing: null });
    }
    if (shooter) {
      recentKills.push({
        killer: shooter.name, victim: target.name,
        killerColor: shooter.color, victimColor: target.color,
        killerTeam: shooter.team, victimTeam: target.team,
        headshot: !!headshot,
      });
      if (recentKills.length > 24) recentKills.shift();
    }
    checkRoundEnd();
  }
}

// ================= 人机 AI =================
function pickBotTarget(p) {
  let enemies = [...players.values()].filter((x) => x.id !== p.id && x.alive);
  if (game.mode !== "dm") enemies = enemies.filter((x) => x.team !== p.team);
  if (!enemies.length) return null;
  const humans = enemies.filter((x) => !x.isBot);
  const pool = humans.length ? humans : enemies;
  let best = pool[0], bd = Infinity;
  for (const e of pool) {
    const d = (e.x - p.x) * (e.x - p.x) + (e.z - p.z) * (e.z - p.z);
    if (d < bd) { bd = d; best = e; }
  }
  return best.id;
}

function updateBot(p, dt, now) {
  const inp = p.input;
  inp.jump = false; inp.sprint = false; inp.shooting = false; inp.mx = 0; inp.mz = 0;

  if (!p.botTarget || now > p.botRetargetAt) {
    p.botTarget = pickBotTarget(p);
    p.botRetargetAt = now + 1500 + Math.random() * 1500;
    p.botAimErrYaw = (Math.random() * 2 - 1) * 0.35;
    p.botAimErrPitch = (Math.random() * 2 - 1) * 0.22;
  }
  const target = players.get(p.botTarget);
  if (target && target.alive) {
    const dx = target.x - p.x, dz = target.z - p.z;
    const dist = Math.hypot(dx, dz);
    const desiredYaw = Math.atan2(dx, dz) + p.botAimErrYaw;
    p.yaw = lerpAngle(p.yaw, desiredYaw, Math.min(1, 7 * dt));
    const desiredPitch = Math.atan2((target.y + 1.1) - (p.y + eyeHeight(p.stance)), Math.max(0.5, dist)) + p.botAimErrPitch;
    p.pitch = clamp(p.pitch + (desiredPitch - p.pitch) * Math.min(1, 7 * dt), -1.3, 1.3);

    const los = dist < 110 && hasLOS(p, target);
    if (los) {
      const strafe = Math.sin(now * 0.001 + p.id * 1.7) > 0 ? 1 : -1;
      inp.mx = strafe * (0.5 + Math.random() * 0.5);
      inp.mz = dist < 20 ? -0.5 : (dist < 45 ? 0 : 0.5);
      if (dist < 55 && Math.abs(angleDiff(p.yaw, desiredYaw)) < 0.25) inp.shooting = true;
    } else {
      inp.mz = 1;
      inp.mx = Math.sin(now * 0.0007 + p.id) * 0.6;
      if (dist > 35 && Math.random() < 0.25) inp.sprint = true;
    }
    if (Math.random() < 0.004 && p.onGround) inp.jump = true;
  } else {
    inp.mz = 0.6;
    inp.mx = Math.sin(now * 0.0009 + p.id) * 0.8;
    if (Math.random() < 0.006) inp.jump = true;
  }
}

function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}

// ================= 人机数量管理 =================
function syncBots() {
  const humans = [...players.values()].filter((p) => !p.isBot).length;
  const bots = [...players.values()].filter((p) => p.isBot);
  // 总玩家数决定人机数：3~6 个
  const target = clamp(7 - humans, 3, 6);
  while (bots.length < target) {
    const id = nextPlayerId++;
    const idx = bots.length;
    const bot = makePlayer(id, "AI·" + BOT_NAMES[idx % BOT_NAMES.length], BOT_COLORS[idx % BOT_COLORS.length], true);
    assignTeam(bot);
    bot.weaponId = WEAPONS[Math.floor(Math.random() * (WEAPONS.length - 2))].id; // 随机非近战主武器
    bot.ammo = curWeapon(bot).magSize;
    spawnPlayer(bot);
    players.set(id, bot);
    bots.push(bot);
  }
  while (bots.length > target) {
    const bot = bots.pop();
    players.delete(bot.id);
  }
}

// ================= 更新主循环 =================
function update(dt) {
  const now = Date.now();
  for (const p of players.values()) {
    if (p.isBot) updateBot(p, dt, now);
    updatePlayer(p, dt, now);
  }

  // 玩家间软碰撞（分离）
  const list = [...players.values()].filter((p) => p.alive);
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      const dx = b.x - a.x, dz = b.z - a.z;
      const d = Math.hypot(dx, dz);
      const minD = PLAYER_RADIUS * 2;
      if (d > 0 && d < minD) {
        const overlap = (minD - d) / 2;
        const ux = dx / d, uz = dz / d;
        a.x -= ux * overlap; a.z -= uz * overlap;
        b.x += ux * overlap; b.z += uz * overlap;
      }
    }
  }

  // 爆破模式：炸弹倒计时与回合计时
  if (game.mode === "bomb") updateBomb(now);
}

function updateBomb(now) {
  // 首回合初始化
  if (game.phase === "live" && game.roundEndAt === 0) {
    startBombRound();
    return;
  }
  // 回合计时结束：防守方获胜
  if (game.phase === "live" && now >= game.roundEndAt) {
    roundOver("blue", "时间到，防守方获胜");
    return;
  }
  // 炸弹已安放，倒计时
  if (game.bomb && game.bomb.plantedAt && game.phase === "planted") {
    const remain = (game.bomb.plantedAt + BOMB_TIME * 1000) - now;
    if (remain <= 0) {
      roundOver("red", "炸弹爆炸，进攻方获胜");
      return;
    }
    // 拆除完成
    if (game.bomb.defusing && now >= game.bomb.defuseAt) {
      roundOver("blue", "炸弹被拆除，防守方获胜！");
      return;
    }
  }
}

function startBombRound() {
  game.phase = "live";
  game.bomb = null;
  game.winner = null;
  game.roundEndAt = Date.now() + ROUND_TIME * 1000;
  // 随机选择一名进攻方（红队）玩家携带炸弹
  const reds = [...players.values()].filter(p => p.team === "red" && p.alive);
  if (reds.length) {
    const carrier = reds[Math.floor(Math.random() * reds.length)];
    carrier.hasBomb = true;
  }
  broadcast({ type: "bomb", bomb: null, phase: "live", round: game.round, score: game.score });
}

function handleInteract(p) {
  if (game.mode !== "bomb" || !p.alive) return;
  const site = BOMB_SITES.find(s => Math.hypot(p.x - s.x, p.z - s.z) < 3.5);
  if (!site) return;

  // 安放炸弹：进攻方携带炸弹者（按下立即安放）
  if (game.phase === "live" && p.hasBomb && p.team === "red") {
    p.hasBomb = false;
    game.phase = "planted";
    game.bomb = { site: site.id, x: site.x, z: site.z, plantedAt: Date.now(), planter: p.name };
    broadcast({ type: "bomb", bomb: game.bomb, phase: "planted", planter: p.name });
    return;
  }
  // 拆除炸弹：防守方（持续 5 秒）
  if (game.phase === "planted" && game.bomb && p.team === "blue") {
    if (!game.bomb.defusing) {
      game.bomb.defusing = true;
      game.bomb.defuser = p.name;
      game.bomb.defuseAt = Date.now() + DEFUSE_TIME * 1000;
      broadcast({ type: "bomb", bomb: game.bomb, defusing: p.name });
    }
  }
}

function checkRoundEnd() {
  if (game.mode === "tdm") {
    const limit = SCORE_LIMIT.tdm;
    if (game.score.red >= limit) return roundOver("red", "红军率先达到 " + limit + " 击杀，获胜！");
    if (game.score.blue >= limit) return roundOver("blue", "蓝军率先达到 " + limit + " 击杀，获胜！");
  } else if (game.mode === "dm") {
    const top = [...players.values()].find(p => p.score >= SCORE_LIMIT.dm);
    if (top) return roundOver(null, top.name + " 率先达到 " + SCORE_LIMIT.dm + " 击杀，获胜！");
  } else if (game.mode === "bomb" && game.phase !== "over") {
    const redAlive = [...players.values()].some(p => p.team === "red" && p.alive);
    const blueAlive = [...players.values()].some(p => p.team === "blue" && p.alive);
    // 全灭判定
    if (game.phase === "live") {
      if (!redAlive) return roundOver("blue", "进攻方全灭，防守方获胜！");
      if (!blueAlive) return roundOver("red", "防守方全灭，进攻方获胜！");
    } else if (game.phase === "planted") {
      if (!blueAlive) return roundOver("red", "防守方全灭，炸弹将爆炸！");
    }
  }
}

function roundOver(winnerTeam, text) {
  if (game.phase === "over") return;
  game.phase = "over";
  game.winner = winnerTeam;
  if (winnerTeam) game.score[winnerTeam]++;
  broadcast({ type: "roundOver", winner: winnerTeam, text, score: game.score });
  broadcastLeaderboard();
  // 延迟进入下一回合
  setTimeout(() => {
    resetRound();
    if (game.mode === "bomb") startBombRound();
    else broadcast({ type: "mode", mode: game.mode });
  }, 5000);
}

function resetRound() {
  for (const p of players.values()) {
    p.hasBomb = false;
    spawnPlayer(p);
  }
  if (game.mode === "tdm") game.score = { red: 0, blue: 0 };
  if (game.mode === "dm") for (const p of players.values()) p.score = 0;
  if (game.mode === "bomb") game.round++;
}

// ================= 快照 / 排行榜 =================
function snapshot() {
  const ps = [...players.values()].map((p) => ({
    id: p.id, name: p.name, color: p.color, isBot: p.isBot, team: p.team,
    weaponId: p.weaponId, meleeId: p.meleeId, slot: p.slot,
    x: round1(p.x), y: round1(p.y), z: round1(p.z),
    yaw: round2(p.yaw), pitch: round2(p.pitch),
    stance: p.stance, hp: p.hp, armor: p.armor, alive: p.alive,
    kills: p.kills, deaths: p.deaths, score: p.score,
    ammo: p.ammo, reloading: p.reloading, ads: p.input.ads, hasBomb: p.hasBomb,
  }));
  const kills = recentKills.splice(0, recentKills.length);
  return { type: "state", players: ps, kills, mode: game.mode, score: game.score, round: game.round };
}

function leaderboard() {
  return [...players.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map((p) => ({ id: p.id, name: p.name, kills: p.kills, deaths: p.deaths, score: p.score, color: p.color, isBot: p.isBot, team: p.team }));
}

// ================= HTTP 静态服务 =================
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const publicRoot = path.join(__dirname, "public");
const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";
  const filePath = path.join(publicRoot, urlPath);
  if (!filePath.startsWith(publicRoot)) {
    res.writeHead(403); res.end("Forbidden"); return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("404 Not Found"); return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
});

// ================= WebSocket =================
const wss = new WebSocketServer({ server });

function broadcast(obj) {
  const data = JSON.stringify(obj);
  for (const c of wss.clients) {
    if (c.readyState === 1) c.send(data);
  }
}
function broadcastLeaderboard() {
  broadcast({ type: "leaderboard", board: leaderboard() });
}

wss.on("connection", (ws) => {
  const id = nextPlayerId++;
  const color = COLORS[(id - 1) % COLORS.length];
  const player = makePlayer(id, "", color, false);
  spawnPlayer(player);
  players.set(id, player);
  ws.playerId = id;

  ws.send(JSON.stringify({
    type: "welcome",
    id,
    mapHalf: MAP_HALF,
    obstacles: OBSTACLES,
    playerRadius: PLAYER_RADIUS,
    config: { eye: STANCES },
    weapons: WEAPONS,
    categories: CATEGORIES,
    modes: MODES,
    mode: game.mode,
    bombSites: BOMB_SITES,
    scoreLimit: SCORE_LIMIT,
  }));

  syncBots();
  broadcastLeaderboard();

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.type === "join") {
      player.name = (msg.name || player.name).slice(0, 12);
      // 选择模式（首次加入的玩家决定房间模式）
      if (msg.mode && MODES.some(m => m.id === msg.mode) && [...players.values()].filter(p => !p.isBot).length === 1) {
        game.mode = msg.mode;
      }
      // 选择武器
      const wpn = getWeapon(msg.weaponId);
      if (wpn) {
        player.weaponId = wpn.id;
        if (wpn.category === "melee") { player.weaponId = "knife"; player.slot = 0; }
        player.ammo = curWeapon(player).magSize;
      }
      assignTeam(player);
      syncBots();
      broadcastLeaderboard();
      broadcast({ type: "mode", mode: game.mode });
    } else if (msg.type === "switch") {
      // 切枪：0=主武器 1=近战（ammo 字段始终代表主武器弹药）
      if (player.alive && !player.reloading) {
        player.slot = msg.slot ? 1 : 0;
        player.switchAt = Date.now() + 350;
        player.ads = false;
      }
    } else if (msg.type === "input") {
      const inp = player.input;
      inp.mx = clamp(msg.mx, -1, 1);
      inp.mz = clamp(msg.mz, -1, 1);
      inp.sprint = !!msg.sprint;
      inp.jump = !!msg.jump;
      inp.shooting = !!msg.shooting;
      inp.ads = !!msg.ads;
      if (typeof msg.yaw === "number") player.yaw = msg.yaw;
      if (typeof msg.pitch === "number") player.pitch = clamp(msg.pitch, -1.4, 1.4);
      // 姿态切换（边沿触发）
      if (typeof msg.crouchEdge === "number" && msg.crouchEdge > player.lastCrouchEdge) {
        toggleCrouch(player);
        player.lastCrouchEdge = msg.crouchEdge;
      }
      if (typeof msg.proneEdge === "number" && msg.proneEdge > player.lastProneEdge) {
        toggleProne(player);
        player.lastProneEdge = msg.proneEdge;
      }
    } else if (msg.type === "reload") {
      if (player.alive) startReload(player, Date.now());
    } else if (msg.type === "interact") {
      // 爆破模式：安放/拆除炸弹
      handleInteract(player);
    }
  });

  ws.on("close", () => {
    players.delete(id);
    syncBots();
    broadcastLeaderboard();
  });
});

// ================= 工具 =================
function clamp(v, min, max) {
  if (typeof v !== "number" || Number.isNaN(v)) return min;
  return Math.max(min, Math.min(max, v));
}
function round1(v) { return Math.round(v * 10) / 10; }
function round2(v) { return Math.round(v * 100) / 100; }

// ================= 主循环 =================
let lastTime = Date.now();
setInterval(() => {
  const now = Date.now();
  let dt = (now - lastTime) / 1000;
  lastTime = now;
  if (dt > 0.1) dt = 0.1;

  update(dt);
  broadcast(snapshot());
}, TICK_MS);

setInterval(broadcastLeaderboard, 2000);

server.listen(PORT, () => {
  console.log("🔫 3D 联机枪战服务器已启动: http://localhost:" + PORT);
  console.log("   地图: " + MAP_HALF * 2 + "x" + MAP_HALF * 2 + " 米 | 障碍物: " + OBSTACLES.length + " 个");
  console.log("   同一局域网内设备可通过本机 IP 访问");
});
