const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const ROOT = __dirname;
const PORT = 5173;

// ============ 静态文件服务 ============
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.wasm': 'application/wasm',
};

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(ROOT, urlPath);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404); res.end('Not Found'); return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
});

// ============ 游戏常量（与客户端保持一致） ============
const MAP_HALF = 30, WALL_H = 4;
const PLAYER_SPEED = 6.5, SPRINT_SPEED = 10.5;
const JUMP_VELOCITY = 7.5, GRAVITY = -20;
const EYE_HEIGHT = 1.6;
const SHOOT_RANGE = 200;
const FIRE_INTERVAL = 0.12;
const DAMAGE = 34;
const MAX_HP = 100;
const MAG_SIZE = 30;
const RELOAD_TIME = 1.6;
const RESPAWN_TIME = 3;
const PLAYER_RADIUS = 0.5;
const PLAYER_HEIGHT = 2.0; // 命中判定胶囊高度

// ============ 确定性随机（与客户端 mulberry32 一致） ============
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ============ 地图碰撞体（与客户端 buildWorld 完全一致） ============
const boxColliders = []; // 2D 移动碰撞
const worldAABBs = [];   // 3D 射线碰撞（含 y 范围）

function buildWorldColliders() {
  // 四面墙
  const wallDefs = [
    { x: 0, z: -MAP_HALF, rot: 0 },
    { x: 0, z: MAP_HALF, rot: 0 },
    { x: -MAP_HALF, z: 0, rot: Math.PI / 2 },
    { x: MAP_HALF, z: 0, rot: Math.PI / 2 },
  ];
  for (const w of wallDefs) {
    const isX = w.rot !== 0;
    const b = {
      minX: isX ? w.x - 0.5 : w.x - MAP_HALF, maxX: isX ? w.x + 0.5 : w.x + MAP_HALF,
      minZ: isX ? w.z - MAP_HALF : w.z - 0.5, maxZ: isX ? w.z + MAP_HALF : w.z + 0.5,
    };
    boxColliders.push(b);
    worldAABBs.push({ ...b, minY: 0, maxY: WALL_H });
  }

  // 箱子（与客户端相同的尺寸与随机序列）
  const crateGeos = [
    { w: 2, h: 2, d: 2 },
    { w: 3, h: 1.5, d: 1.8 },
    { w: 1.8, h: 1.8, d: 1.8 },
  ];
  const rng = mulberry32(12345);
  let placed = 0, guard = 0;
  while (placed < 22 && guard++ < 400) {
    const x = (rng() * 2 - 1) * (MAP_HALF - 4);
    const z = (rng() * 2 - 1) * (MAP_HALF - 4);
    if (Math.hypot(x, z) < 6) continue;
    const geo = crateGeos[Math.floor(rng() * crateGeos.length)];
    rng(); // 材质选择（消耗一次随机，保持序列一致）
    rng(); // rotation.y（消耗一次随机，保持序列一致）
    const hw = geo.w / 2, hd = geo.d / 2;
    boxColliders.push({ minX: x - hw, maxX: x + hw, minZ: z - hd, maxZ: z + hd });
    worldAABBs.push({ minX: x - hw, maxX: x + hw, minZ: z - hd, maxZ: z + hd, minY: 0, maxY: geo.h });
    placed++;
  }
}
buildWorldColliders();

// ============ 碰撞检测 ============
function collideCircle(pos, radius) {
  const lim = MAP_HALF - radius;
  if (pos.x < -lim) pos.x = -lim;
  if (pos.x > lim) pos.x = lim;
  if (pos.z < -lim) pos.z = lim;
  if (pos.z > lim) pos.z = lim;
  for (const b of boxColliders) {
    const cx = Math.max(b.minX, Math.min(pos.x, b.maxX));
    const cz = Math.max(b.minZ, Math.min(pos.z, b.maxZ));
    const dx = pos.x - cx, dz = pos.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 < radius * radius) {
      const d = Math.sqrt(d2) || 1e-4;
      const push = (radius - d);
      pos.x += (dx / d) * push;
      pos.z += (dz / d) * push;
    }
  }
}

// ============ 3D 射线检测 ============
function raycastAABB(ox, oy, oz, dx, dy, dz, b) {
  const o = [ox, oy, oz], d = [dx, dy, dz];
  const lo = [b.minX, b.minY, b.minZ], hi = [b.maxX, b.maxY, b.maxZ];
  let tmin = 0, tmax = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < lo[i] || o[i] > hi[i]) return Infinity;
    } else {
      let t1 = (lo[i] - o[i]) / d[i];
      let t2 = (hi[i] - o[i]) / d[i];
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return Infinity;
    }
  }
  return tmin >= 0 ? tmin : Infinity;
}

function raycastCylinder(ox, oy, oz, dx, dy, dz, cx, cz, r, y0, y1) {
  let best = Infinity;
  const a = dx * dx + dz * dz;
  if (a > 1e-9) {
    const b = 2 * ((ox - cx) * dx + (oz - cz) * dz);
    const c = (ox - cx) * (ox - cx) + (oz - cz) * (oz - cz) - r * r;
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      const t1 = (-b - sq) / (2 * a), t2 = (-b + sq) / (2 * a);
      for (const t of [t1, t2]) {
        if (t >= 0) {
          const y = oy + dy * t;
          if (y >= y0 && y <= y1 && t < best) best = t;
        }
      }
    }
  }
  for (const yc of [y0, y1]) {
    if (Math.abs(dy) > 1e-9) {
      const t = (yc - oy) / dy;
      if (t >= 0) {
        const px = ox + dx * t, pz = oz + dz * t;
        if ((px - cx) * (px - cx) + (pz - cz) * (pz - cz) <= r * r && t < best) best = t;
      }
    }
  }
  return best;
}

// 从眼睛位置发射，返回最近命中
function raycastWorld(ox, oy, oz, dx, dy, dz, selfId) {
  let bestT = Infinity, hit = null;
  for (const p of players.values()) {
    if (p.id === selfId || !p.alive) continue;
    const t = raycastCylinder(ox, oy, oz, dx, dy, dz, p.x, p.z, PLAYER_RADIUS, p.y, p.y + PLAYER_HEIGHT);
    if (t < bestT) { bestT = t; hit = { type: 'player', id: p.id }; }
  }
  for (const b of worldAABBs) {
    const t = raycastAABB(ox, oy, oz, dx, dy, dz, b);
    if (t < bestT) { bestT = t; hit = { type: 'world', id: null }; }
  }
  if (dy < 0) {
    const t = (0 - oy) / dy;
    if (t >= 0 && t < bestT) { bestT = t; hit = { type: 'world', id: null }; }
  }
  if (hit === null) { bestT = SHOOT_RANGE; hit = { type: 'none', id: null }; }
  return { t: bestT, type: hit.type, id: hit.id, point: [ox + dx * bestT, oy + dy * bestT, oz + dz * bestT] };
}

// ============ 游戏状态 ============
const players = new Map(); // id -> player
let nextId = 1;
let now = Date.now();

function findSpawn() {
  for (let i = 0; i < 200; i++) {
    const x = (Math.random() * 2 - 1) * (MAP_HALF - 6);
    const z = (Math.random() * 2 - 1) * (MAP_HALF - 6);
    let ok = true;
    for (const p of players.values()) {
      if (p.alive && Math.hypot(p.x - x, p.z - z) < 5) { ok = false; break; }
    }
    if (!ok) continue;
    let inside = false;
    for (const b of boxColliders) {
      if (x >= b.minX - 0.5 && x <= b.maxX + 0.5 && z >= b.minZ - 0.5 && z <= b.maxZ + 0.5) { inside = true; break; }
    }
    if (!inside) return { x, z };
  }
  return { x: 0, z: 6 };
}

function createPlayer(ws) {
  const id = nextId++;
  const spawn = findSpawn();
  const p = {
    id, ws,
    name: '玩家' + id,
    x: spawn.x, y: 0, z: spawn.z,
    yaw: Math.PI, pitch: 0,
    vx: 0, vy: 0, vz: 0,
    hp: MAX_HP,
    ammo: MAG_SIZE,
    reloading: false, reloadTime: 0,
    onGround: true,
    alive: true,
    kills: 0, deaths: 0,
    shootCooldown: 0,
    respawnAt: 0,
    input: { mx: 0, mz: 0, sprint: false, jump: false, yaw: Math.PI, pitch: 0, shooting: false },
  };
  players.set(id, p);
  return p;
}

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const p of players.values()) {
    if (p.ws.readyState === 1) p.ws.send(data);
  }
}

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

// ============ 射击 / 伤害 ============
function tryShoot(p) {
  if (!p.alive || p.reloading || p.ammo <= 0) return;
  p.ammo--;
  const yaw = p.input.yaw, pitch = p.input.pitch;
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const dx = Math.sin(yaw) * cp, dy = sp, dz = Math.cos(yaw) * cp;
  const ox = p.x, oy = p.y + EYE_HEIGHT, oz = p.z;
  const res = raycastWorld(ox, oy, oz, dx, dy, dz, p.id);
  // 视觉起点：眼睛前方偏下（模拟枪口，与客户端一致）
  const fx = ox + dx * 0.6, fy = oy - 0.35 + dy * 0.6, fz = oz + dz * 0.6;
  const hit = res.type === 'player' ? res.id : null;
  if (res.type === 'player') {
    applyDamage(res.id, DAMAGE, p);
  }
  broadcast({ type: 'shoot', id: p.id, from: [fx, fy, fz], to: res.point, hit });
}

function applyDamage(targetId, dmg, shooter) {
  const t = players.get(targetId);
  if (!t || !t.alive) return;
  t.hp -= dmg;
  const ddx = t.x - shooter.x, ddz = t.z - shooter.z;
  const dl = Math.hypot(ddx, ddz) || 1;
  broadcast({ type: 'hit', targetId, shooterId: shooter.id, dmg, dir: [ddx / dl, ddz / dl] });
  if (t.hp <= 0) {
    t.hp = 0;
    t.alive = false;
    t.deaths++;
    t.respawnAt = now + RESPAWN_TIME * 1000;
    shooter.kills++;
    broadcast({ type: 'kill', killerId: shooter.id, killerName: shooter.name, victimId: t.id, victimName: t.name });
  }
}

function respawn(p) {
  const spawn = findSpawn();
  p.x = spawn.x; p.y = 0; p.z = spawn.z;
  p.vx = 0; p.vy = 0; p.vz = 0;
  p.hp = MAX_HP;
  p.ammo = MAG_SIZE;
  p.reloading = false;
  p.alive = true;
  p.onGround = true;
}

// ============ 逻辑更新 ============
function updatePlayer(p, dt) {
  if (!p.alive) {
    if (now >= p.respawnAt) respawn(p);
    return;
  }
  const yaw = p.input.yaw;
  const forwardX = Math.sin(yaw), forwardZ = Math.cos(yaw);
  const rightX = -Math.cos(yaw), rightZ = Math.sin(yaw);

  let mx = p.input.mx, mz = p.input.mz;
  const len = Math.hypot(mx, mz);
  if (len > 1) { mx /= len; mz /= len; }

  const speed = p.input.sprint ? SPRINT_SPEED : PLAYER_SPEED;
  p.vx = (forwardX * mz + rightX * mx) * speed;
  p.vz = (forwardZ * mz + rightZ * mx) * speed;

  if (p.input.jump && p.onGround) {
    p.vy = JUMP_VELOCITY;
    p.onGround = false;
  }
  p.vy += GRAVITY * dt;

  p.x += p.vx * dt;
  p.z += p.vz * dt;
  p.y += p.vy * dt;
  if (p.y <= 0) {
    p.y = 0; p.vy = 0; p.onGround = true;
  }

  const cpos = { x: p.x, z: p.z };
  collideCircle(cpos, PLAYER_RADIUS);
  p.x = cpos.x; p.z = cpos.z;

  // 换弹
  if (p.reloading) {
    p.reloadTime -= dt;
    if (p.reloadTime <= 0) {
      p.reloading = false;
      p.ammo = MAG_SIZE;
    }
  }

  // 射击
  p.shootCooldown -= dt;
  if (p.input.shooting && p.shootCooldown <= 0) {
    p.shootCooldown = FIRE_INTERVAL;
    if (p.ammo <= 0 && !p.reloading) {
      // 弹匣打空自动换弹
      p.reloading = true;
      p.reloadTime = RELOAD_TIME;
    } else {
      tryShoot(p);
    }
  }
}

function tick() {
  const t = Date.now();
  const dt = Math.min((t - now) / 1000, 0.05);
  now = t;
  for (const p of players.values()) updatePlayer(p, dt);
}

function stateSnapshot() {
  const arr = [];
  for (const p of players.values()) {
    arr.push({
      id: p.id, name: p.name,
      x: p.x, y: p.y, z: p.z,
      yaw: p.yaw, pitch: p.pitch,
      hp: p.hp, ammo: p.ammo,
      reloading: p.reloading,
      alive: p.alive, kills: p.kills, deaths: p.deaths,
      respawnIn: p.alive ? 0 : Math.max(0, Math.ceil((p.respawnAt - now) / 1000)),
    });
  }
  return arr;
}

// ============ WebSocket ============
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  const p = createPlayer(ws);
  send(ws, { type: 'welcome', id: p.id });

  ws.on('message', (buf) => {
    let msg;
    try { msg = JSON.parse(buf.toString()); } catch { return; }
    if (msg.type === 'join') {
      if (msg.name && typeof msg.name === 'string' && msg.name.trim()) {
        p.name = msg.name.trim().slice(0, 12);
      }
      broadcast({ type: 'joined', id: p.id, name: p.name });
    } else if (msg.type === 'input') {
      const i = p.input;
      if (typeof msg.mx === 'number') i.mx = Math.max(-1, Math.min(1, msg.mx));
      if (typeof msg.mz === 'number') i.mz = Math.max(-1, Math.min(1, msg.mz));
      if (typeof msg.yaw === 'number') i.yaw = msg.yaw;
      if (typeof msg.pitch === 'number') i.pitch = Math.max(-0.55, Math.min(0.75, msg.pitch));
      i.sprint = !!msg.sprint;
      i.jump = !!msg.jump;
      i.shooting = !!msg.shooting;
      p.yaw = i.yaw; p.pitch = i.pitch;
    } else if (msg.type === 'reload') {
      if (p.alive && !p.reloading && p.ammo < MAG_SIZE) {
        p.reloading = true;
        p.reloadTime = RELOAD_TIME;
      }
    }
  });

  ws.on('close', () => {
    players.delete(p.id);
    broadcast({ type: 'left', id: p.id, name: p.name });
  });
});

// ============ 主循环 ============
setInterval(tick, 1000 / 60);
setInterval(() => {
  broadcast({ type: 'state', players: stateSnapshot() });
}, 1000 / 30);

server.listen(PORT, () => {
  console.log(`TPS 联机服务器已启动: http://localhost:${PORT}`);
  console.log('局域网内其他设备可通过本机 IP 访问（同一网络下）。');
});
