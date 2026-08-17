const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

// ================= 常量 =================
const PORT = process.env.PORT || 3000;
const TICK_MS = 1000 / 30; // 30Hz 更新
const WORLD_RADIUS = 1200; // 圆形竞技场半径
const PLAYER_RADIUS = 18;
const PLAYER_SPEED = 230; // px/s
const PLAYER_MAX_HP = 100;
const BULLET_SPEED = 620;
const BULLET_RADIUS = 6;
const BULLET_DAMAGE = 25;
const SHOOT_COOLDOWN = 180; // ms
const BULLET_LIFE = 1800; // ms
const RESPAWN_TIME = 3000; // ms
const OBSTACLES = [
  { x: 0, y: 0, r: 90 },
  { x: 500, y: -350, r: 70 },
  { x: -520, y: 380, r: 70 },
  { x: 420, y: 420, r: 60 },
  { x: -480, y: -420, r: 60 },
];

// ================= 状态 =================
let nextPlayerId = 1;
let nextBulletId = 1;
const players = new Map(); // id -> player
const bullets = new Map(); // id -> bullet
const recentKills = []; // { killer, victim, killerColor, victimColor }
const COLORS = [
  "#4ade80", "#60a5fa", "#f87171", "#fbbf24",
  "#a78bfa", "#2dd4bf", "#fb923c", "#f472b6",
  "#94a3b8", "#e2e8f0",
];

function makePlayer(id, name, color) {
  return {
    id,
    name: (name || "玩家" + id).slice(0, 12),
    color,
    x: 0,
    y: 0,
    angle: 0,
    pitch: 0,
    hp: PLAYER_MAX_HP,
    alive: true,
    respawnAt: 0,
    kills: 0,
    deaths: 0,
    shootCooldown: 0,
    // 输入
    moveX: 0,
    moveY: 0,
    shooting: false,
  };
}

function randomSpawn() {
  const ang = Math.random() * Math.PI * 2;
  const dist = Math.random() * (WORLD_RADIUS * 0.7);
  return { x: Math.cos(ang) * dist, y: Math.sin(ang) * dist };
}

// ================= 游戏逻辑 =================
function spawnPlayer(p) {
  const pos = randomSpawn();
  p.x = pos.x;
  p.y = pos.y;
  p.hp = PLAYER_MAX_HP;
  p.alive = true;
}

function update(dt) {
  const now = Date.now();

  // 更新玩家
  for (const p of players.values()) {
    p.shootCooldown = Math.max(0, p.shootCooldown - dt * 1000);

    if (!p.alive) {
      if (now >= p.respawnAt) spawnPlayer(p);
      continue;
    }

    // 移动（归一化）
    let mx = p.moveX, my = p.moveY;
    const len = Math.hypot(mx, my);
    if (len > 1) { mx /= len; my /= len; }
    else if (len > 0.001) { /* 已归一化 */ }
    if (len > 0.001) {
      p.x += mx * PLAYER_SPEED * dt;
      p.y += my * PLAYER_SPEED * dt;
    }

    // 世界边界
    const dist = Math.hypot(p.x, p.y);
    if (dist > WORLD_RADIUS - PLAYER_RADIUS) {
      const scale = (WORLD_RADIUS - PLAYER_RADIUS) / dist;
      p.x *= scale;
      p.y *= scale;
    }

    // 障碍物碰撞（推出去）
    for (const ob of OBSTACLES) {
      const dx = p.x - ob.x, dy = p.y - ob.y;
      const d = Math.hypot(dx, dy);
      const minD = ob.r + PLAYER_RADIUS;
      if (d > 0 && d < minD) {
        const push = (minD - d) / d;
        p.x += dx * push;
        p.y += dy * push;
      }
    }

    // 射击
    if (p.shooting && p.shootCooldown <= 0) {
      p.shootCooldown = SHOOT_COOLDOWN;
      const bx = p.x + Math.cos(p.angle) * (PLAYER_RADIUS + BULLET_RADIUS + 2);
      const by = p.y + Math.sin(p.angle) * (PLAYER_RADIUS + BULLET_RADIUS + 2);
      bullets.set(nextBulletId, {
        id: nextBulletId++,
        ownerId: p.id,
        x: bx,
        y: by,
        originX: p.x,
        originY: p.y,
        pitch: p.pitch,
        vx: Math.cos(p.angle) * BULLET_SPEED,
        vy: Math.sin(p.angle) * BULLET_SPEED,
        born: now,
      });
    }
  }

  // 玩家间软碰撞（分离）
  const list = [...players.values()].filter((p) => p.alive);
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      const minD = PLAYER_RADIUS * 2;
      if (d > 0 && d < minD) {
        const overlap = (minD - d) / 2;
        const ux = dx / d, uy = dy / d;
        a.x -= ux * overlap; a.y -= uy * overlap;
        b.x += ux * overlap; b.y += uy * overlap;
      }
    }
  }

  // 更新子弹
  for (const [id, b] of bullets) {
    b.x += b.vx * dt;
    b.y += b.vy * dt;

    let consumed = false;
    // 超时或出界
    if (now - b.born > BULLET_LIFE) consumed = true;
    if (Math.hypot(b.x, b.y) > WORLD_RADIUS) consumed = true;

    // 障碍物碰撞
    for (const ob of OBSTACLES) {
      const dx = b.x - ob.x, dy = b.y - ob.y;
      if (Math.hypot(dx, dy) < ob.r + BULLET_RADIUS) { consumed = true; break; }
    }

    // 玩家碰撞
    if (!consumed) {
      for (const p of list) {
        if (p.id === b.ownerId) continue;
        const dx = p.x - b.x, dy = p.y - b.y;
        if (Math.hypot(dx, dy) < PLAYER_RADIUS + BULLET_RADIUS) {
          hitPlayer(p, b.ownerId);
          consumed = true;
          break;
        }
      }
    }

    if (consumed) bullets.delete(id);
  }
}

function hitPlayer(target, shooterId) {
  if (!target.alive) return;
  target.hp -= BULLET_DAMAGE;
  if (target.hp <= 0) {
    target.hp = 0;
    target.alive = false;
    target.deaths++;
    target.respawnAt = Date.now() + RESPAWN_TIME;
    const shooter = players.get(shooterId);
    if (shooter && shooter.alive && shooter.id !== target.id) {
      shooter.kills++;
    }
    if (shooter) {
      recentKills.push({
        killer: shooter.name,
        victim: target.name,
        killerColor: shooter.color,
        victimColor: target.color,
      });
      if (recentKills.length > 20) recentKills.shift();
    }
  }
}

// ================= 快照 =================
function snapshot() {
  const ps = [...players.values()].map((p) => ({
    id: p.id, name: p.name, color: p.color,
    x: Math.round(p.x * 10) / 10,
    y: Math.round(p.y * 10) / 10,
    angle: Math.round(p.angle * 100) / 100,
    hp: p.hp, alive: p.alive,
    kills: p.kills, deaths: p.deaths,
  }));
  const bs = [...bullets.values()].map((b) => ({
    id: b.id,
    x: Math.round(b.x * 10) / 10,
    y: Math.round(b.y * 10) / 10,
    vx: Math.round(b.vx * 10) / 10,
    vy: Math.round(b.vy * 10) / 10,
    ownerId: b.ownerId,
    originX: Math.round(b.originX * 10) / 10,
    originY: Math.round(b.originY * 10) / 10,
    pitch: Math.round(b.pitch * 1000) / 1000,
  }));
  const kills = recentKills.splice(0, recentKills.length);
  return { type: "state", players: ps, bullets: bs, kills };
}

function leaderboard() {
  return [...players.values()]
    .sort((a, b) => b.kills - a.kills)
    .slice(0, 10)
    .map((p) => ({ id: p.id, name: p.name, kills: p.kills, deaths: p.deaths, color: p.color }));
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

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";
  const filePath = path.join(__dirname, "public", urlPath);
  if (!filePath.startsWith(path.join(__dirname, "public"))) {
    res.writeHead(403); res.end("Forbidden"); return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("404 Not Found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
});

// ================= WebSocket =================
const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  const id = nextPlayerId++;
  const color = COLORS[(id - 1) % COLORS.length];
  const player = makePlayer(id, "", color);
  spawnPlayer(player);
  players.set(id, player);
  ws.playerId = id;

  // 发送初始化信息
  ws.send(JSON.stringify({
    type: "init",
    id,
    worldRadius: WORLD_RADIUS,
    obstacles: OBSTACLES,
    playerRadius: PLAYER_RADIUS,
    bulletRadius: BULLET_RADIUS,
    bulletSpeed: BULLET_SPEED,
  }));

  broadcastLeaderboard();

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.type === "join") {
      player.name = (msg.name || player.name).slice(0, 12);
      broadcastLeaderboard();
    } else if (msg.type === "input") {
      player.moveX = clamp(msg.mx, -1, 1);
      player.moveY = clamp(msg.my, -1, 1);
      if (typeof msg.angle === "number") player.angle = msg.angle;
      if (typeof msg.pitch === "number") player.pitch = clamp(msg.pitch, -1.2, 1.2);
      player.shooting = !!msg.shooting;
    }
  });

  ws.on("close", () => {
    players.delete(id);
    broadcastLeaderboard();
  });
});

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, Number(v) || 0));
}

function broadcastLeaderboard() {
  const data = JSON.stringify({ type: "leaderboard", board: leaderboard() });
  for (const c of wss.clients) {
    if (c.readyState === 1) c.send(data);
  }
}

// ================= 主循环 =================
let lastTime = Date.now();
setInterval(() => {
  const now = Date.now();
  let dt = (now - lastTime) / 1000;
  lastTime = now;
  if (dt > 0.1) dt = 0.1; // 防止卡顿跳变

  update(dt);

  const data = JSON.stringify(snapshot());
  for (const c of wss.clients) {
    if (c.readyState === 1) c.send(data);
  }
}, TICK_MS);

// 定期广播排行榜
setInterval(broadcastLeaderboard, 2000);

server.listen(PORT, () => {
  console.log(`🔫 枪战服务器已启动: http://localhost:${PORT}`);
  console.log(`   同一局域网内的设备可通过本机 IP 访问`);
});
