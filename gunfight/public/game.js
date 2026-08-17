import * as THREE from "three";

(function () {
  "use strict";

  // ================= DOM =================
  const canvas = document.getElementById("game");
  const joinModal = document.getElementById("joinModal");
  const nameInput = document.getElementById("nameInput");
  const joinBtn = document.getElementById("joinBtn");
  const joinHint = document.getElementById("joinHint");
  const pointerHint = document.getElementById("pointerHint");
  const connectionBar = document.getElementById("connectionBar");
  const hpFill = document.getElementById("hpFill");
  const hpText = document.getElementById("hpText");
  const killsEl = document.getElementById("kills");
  const deathsEl = document.getElementById("deaths");
  const leaderboardEl = document.getElementById("leaderboard");
  const killFeedEl = document.getElementById("killFeed");
  const deathOverlay = document.getElementById("deathOverlay");
  const respawnCountdown = document.getElementById("respawnCountdown");
  const crosshair = document.getElementById("crosshair");
  const joystick = document.getElementById("joystick");
  const joystickKnob = document.getElementById("joystickKnob");
  const fireBtn = document.getElementById("fireBtn");

  // ================= 状态 =================
  let ws = null;
  let myId = null;
  let worldRadius = 1200;
  let obstacles = [];
  let playerRadius = 18;
  let bulletRadius = 6;
  let bulletSpeed = 620;
  let players = [];
  let bullets = [];
  let myPlayer = null;
  let connected = false;
  let isTouch = "ontouchstart" in window;

  // ================= 输入 =================
  const keys = {};
  let mouse = { down: false };
  let joy = { active: false, baseX: 0, baseY: 0, dx: 0, dy: 0 };
  let touchShooting = false;
  let autoAim = false;
  let aimAngle = 0;
  let aimPitch = 0; // 俯仰角（弧度），正值抬头，负值低头看地面
  const PITCH_MIN = -0.9; // 向下最大约 -51°
  const PITCH_MAX = 0.3;  // 向上最大约 +17°
  let pointerLocked = false;
  const MOUSE_SENS = 0.0024; // 鼠标灵敏度

  // ================= Three.js 场景 =================
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0f16);
  scene.fog = new THREE.Fog(0x0a0f16, 700, 2600);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 4000);

  // 光照
  const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x1a1a24, 0.8);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff4e0, 1.8);
  sun.position.set(700, 1100, 500);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -1800;
  sun.shadow.camera.right = 1800;
  sun.shadow.camera.top = 1800;
  sun.shadow.camera.bottom = -1800;
  sun.shadow.camera.near = 50;
  sun.shadow.camera.far = 3500;
  sun.shadow.bias = -0.0004;
  scene.add(sun);
  scene.add(new THREE.AmbientLight(0x2a3a4a, 0.6));

  // 世界容器
  const world = new THREE.Group();
  scene.add(world);

  // 场景对象引用
  let groundMesh = null;
  let wallMesh = null;
  let obstacleGroup = new THREE.Group();
  world.add(obstacleGroup);

  // 玩家 / 子弹 mesh 池
  const playerMeshes = new Map(); // id -> mesh data
  const bulletMeshes = new Map(); // id -> mesh data

  // 相机目标
  const camTarget = new THREE.Vector3();
  const camLook = new THREE.Vector3();
  const tmpVec = new THREE.Vector3();

  const EYE_HEIGHT = 42; // 第一人称眼睛/枪口高度，子弹从此高度飞出

  // 第一人称持枪模型（挂在相机上）
  const fpgun = new THREE.Group();
  {
    const gunMat = new THREE.MeshStandardMaterial({ color: 0x14181f, roughness: 0.35, metalness: 0.7 });
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xe8c39a, roughness: 0.6, metalness: 0.05 });

    // 枪身
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.2, 0.7), gunMat);
    body.position.set(0.3, -0.3, -0.55);
    fpgun.add(body);

    // 枪管
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 16), gunMat);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0.3, -0.28, -1.1);
    fpgun.add(barrel);

    // 准星（机瞄）
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.12, 0.04), gunMat);
    sight.position.set(0.3, -0.18, -0.35);
    fpgun.add(sight);

    // 手
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.2), skinMat);
    hand.position.set(0.26, -0.38, -0.3);
    fpgun.add(hand);

    camera.add(fpgun);
  }

  // ================= 画布尺寸 =================
  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize);
  resize();

  // ================= 世界构建 =================
  function makeGroundTexture() {
    const size = 1024;
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const g = c.getContext("2d");
    const cx = size / 2, cy = size / 2;
    const R = size / 2 - 6;

    // 底
    g.fillStyle = "#131c28";
    g.fillRect(0, 0, size, size);

    // 同心圆网格
    g.strokeStyle = "rgba(255,255,255,0.06)";
    g.lineWidth = 1;
    const rings = 24;
    for (let i = 1; i <= rings; i++) {
      g.beginPath();
      g.arc(cx, cy, (R / rings) * i, 0, Math.PI * 2);
      g.stroke();
    }
    // 放射线
    const spokes = 32;
    for (let k = 0; k < spokes; k++) {
      const a = (k / spokes) * Math.PI * 2;
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
      g.stroke();
    }

    // 边界环
    g.strokeStyle = "rgba(248,113,113,0.9)";
    g.lineWidth = 6;
    g.beginPath();
    g.arc(cx, cy, R, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = "rgba(248,113,113,0.25)";
    g.lineWidth = 14;
    g.beginPath();
    g.arc(cx, cy, R, 0, Math.PI * 2);
    g.stroke();

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

  function buildWorld() {
    // 地面
    if (groundMesh) world.remove(groundMesh);
    const groundGeo = new THREE.CircleGeometry(worldRadius, 96);
    const groundMat = new THREE.MeshStandardMaterial({
      map: makeGroundTexture(),
      roughness: 0.9,
      metalness: 0.05,
    });
    groundMesh = new THREE.Mesh(groundGeo, groundMat);
    groundMesh.rotation.x = -Math.PI / 2;
    groundMesh.receiveShadow = true;
    world.add(groundMesh);

    // 边界墙（发光半透明圆柱）
    if (wallMesh) world.remove(wallMesh);
    const wallH = 60;
    const wallGeo = new THREE.CylinderGeometry(worldRadius, worldRadius, wallH, 96, 1, true);
    const wallMat = new THREE.MeshBasicMaterial({
      color: 0xf87171,
      transparent: true,
      opacity: 0.16,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    wallMesh = new THREE.Mesh(wallGeo, wallMat);
    wallMesh.position.y = wallH / 2;
    world.add(wallMesh);

    // 边界顶部亮环
    const ringGeo = new THREE.TorusGeometry(worldRadius, 2.5, 8, 120);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xff5f5f });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = wallH + 2;
    ring.name = "wallRing";
    const oldRing = world.getObjectByName("wallRing");
    if (oldRing) world.remove(oldRing);
    world.add(ring);

    // 障碍物
    while (obstacleGroup.children.length) obstacleGroup.remove(obstacleGroup.children[0]);
    const obH = 90;
    for (const ob of obstacles) {
      const g = new THREE.Group();
      const bodyGeo = new THREE.CylinderGeometry(ob.r, ob.r * 0.85, obH, 40);
      const bodyMat = new THREE.MeshStandardMaterial({
        color: 0x2b3a4d,
        roughness: 0.65,
        metalness: 0.25,
      });
      const body = new THREE.Mesh(bodyGeo, bodyMat);
      body.position.y = obH / 2;
      body.castShadow = true;
      body.receiveShadow = true;
      g.add(body);

      // 顶部高亮环
      const topGeo = new THREE.TorusGeometry(ob.r + 0.5, 2, 8, 40);
      const topMat = new THREE.MeshStandardMaterial({
        color: 0x4a6fa5, roughness: 0.4, metalness: 0.5,
      });
      const top = new THREE.Mesh(topGeo, topMat);
      top.rotation.x = Math.PI / 2;
      top.position.y = obH + 1;
      g.add(top);

      g.position.set(ob.x, 0, ob.y);
      obstacleGroup.add(g);
    }
  }

  // ================= 玩家模型 =================
  function makeTextSprite(text, color) {
    const c = document.createElement("canvas");
    c.width = 256; c.height = 64;
    const g = c.getContext("2d");
    g.clearRect(0, 0, 256, 64);
    g.font = "bold 30px 'Segoe UI', 'PingFang SC', sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.shadowColor = "rgba(0,0,0,0.8)";
    g.shadowBlur = 6;
    g.fillStyle = color;
    g.fillText(text, 128, 32);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(70, 17.5, 1);
    return sprite;
  }

  function makeOverheadSprite() {
    const c = document.createElement("canvas");
    c.width = 256; c.height = 72;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(84, 23, 1);
    return { sprite, canvas: c, ctx: c.getContext("2d"), texture: tex };
  }

  function drawOverhead(overhead, p) {
    const { canvas: c, ctx: g, texture } = overhead;
    g.clearRect(0, 0, c.width, c.height);

    // 名字
    g.font = "bold 30px 'Segoe UI', 'PingFang SC', sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.shadowColor = "rgba(0,0,0,0.85)";
    g.shadowBlur = 6;
    g.fillStyle = "#ffffff";
    g.fillText(p.name, 128, 22);

    // 血条背景
    const bx = 34, bw = 188, by = 44, bh = 16;
    g.shadowBlur = 0;
    g.fillStyle = "rgba(0,0,0,0.65)";
    g.beginPath();
    g.roundRect(bx, by, bw, bh, 8);
    g.fill();
    const pct = Math.max(0, Math.min(1, p.hp / 100));
    const col = pct > 0.5 ? "#4ade80" : pct > 0.25 ? "#fbbf24" : "#ef4444";
    if (pct > 0) {
      g.fillStyle = col;
      g.beginPath();
      g.roundRect(bx + 2, by + 2, (bw - 4) * pct, bh - 4, 6);
      g.fill();
    }
    texture.needsUpdate = true;
  }

  function createPlayerMesh(p) {
    const group = new THREE.Group();

    const bodyR = playerRadius * 0.58;
    const bodyLen = playerRadius * 1.05;
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(bodyR, bodyLen, 6, 14),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(p.color), roughness: 0.5, metalness: 0.2 })
    );
    body.position.y = bodyLen / 2 + bodyR;
    body.castShadow = true;
    group.add(body);

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(playerRadius * 0.5, 24, 20),
      new THREE.MeshStandardMaterial({ color: 0xf1e3c8, roughness: 0.55, metalness: 0.05 })
    );
    head.position.y = bodyLen + bodyR * 2 - 2;
    head.castShadow = true;
    group.add(head);

    // 枪管（沿 +X 方向）
    const gun = new THREE.Mesh(
      new THREE.BoxGeometry(playerRadius * 1.7, 5.5, 5.5),
      new THREE.MeshStandardMaterial({ color: 0x11151c, roughness: 0.35, metalness: 0.6 })
    );
    gun.position.set(playerRadius * 0.85, bodyLen / 2 + bodyR * 0.8, 0);
    gun.castShadow = true;
    group.add(gun);

    // 枪口
    const muzzle = new THREE.Mesh(
      new THREE.CylinderGeometry(2.5, 2.5, 6, 10),
      new THREE.MeshStandardMaterial({ color: 0x333a44, roughness: 0.3, metalness: 0.7 })
    );
    muzzle.rotation.z = Math.PI / 2;
    muzzle.position.set(playerRadius * 1.7, bodyLen / 2 + bodyR * 0.8, 0);
    group.add(muzzle);

    // 名字 / 血条
    const overhead = makeOverheadSprite();
    overhead.sprite.position.y = bodyLen + bodyR * 2 + 22;
    group.add(overhead.sprite);

    // 底部指示圈
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(playerRadius * 0.7, playerRadius * 1.05, 32),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(p.color), transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.5;
    group.add(ring);

    world.add(group);
    return { group, overhead, color: p.color };
  }

  // ================= 子弹模型 =================
  function createBulletMesh() {
    const group = new THREE.Group();
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(bulletRadius, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0xffe95c })
    );
    group.add(core);

    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        color: 0xffd700, transparent: true, opacity: 0.6, depthWrite: false,
      })
    );
    glow.scale.set(bulletRadius * 4, bulletRadius * 4, 1);
    group.add(glow);

    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
    const trail = new THREE.Line(
      trailGeo,
      new THREE.LineBasicMaterial({ color: 0xffd700, transparent: true, opacity: 0.5 })
    );
    group.add(trail);

    world.add(group);
    return { group, trail };
  }

  function updateBulletMesh(m, b) {
    // 子弹严格沿发射时的视线方向（发射原点 + 发射俯仰角）渲染，
    // 使弹道投影在屏幕上始终贴合准心。
    const pitch = b.pitch || 0;
    const tanP = Math.tan(pitch);
    // 子弹到发射原点（玩家眼睛位置）的水平距离
    const d = Math.hypot(b.x - b.originX, b.y - b.originY);
    const h = EYE_HEIGHT + d * tanP;

    m.group.position.set(b.x, h, b.y);
    const vl = Math.hypot(b.vx, b.vy) || 1;
    const ux = b.vx / vl, uy = b.vy / vl;
    const len = bulletSpeed * 0.09;
    // 拖尾起点（沿速度反方向回溯）
    const d0 = Math.max(0, d - len);
    const h0 = EYE_HEIGHT + d0 * tanP;
    const pos = m.trail.geometry.attributes.position.array;
    pos[0] = b.x - ux * len; pos[1] = h0; pos[2] = b.y - uy * len;
    pos[3] = b.x; pos[4] = h; pos[5] = b.y;
    m.trail.geometry.attributes.position.needsUpdate = true;
  }

  // ================= 网络 =================
  function connect() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${location.host}`);

    ws.onopen = () => {
      connected = true;
      connectionBar.classList.add("hidden");
      joinHint.textContent = "已连接服务器";
    };

    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      handleMessage(msg);
    };

    ws.onclose = () => {
      connected = false;
      connectionBar.textContent = "连接已断开，正在重连...";
      connectionBar.classList.remove("hidden");
      setTimeout(connect, 1500);
    };
  }

  function handleMessage(msg) {
    if (msg.type === "init") {
      myId = msg.id;
      worldRadius = msg.worldRadius;
      obstacles = msg.obstacles;
      playerRadius = msg.playerRadius;
      bulletRadius = msg.bulletRadius;
      bulletSpeed = msg.bulletSpeed || bulletSpeed;
      buildWorld();
    } else if (msg.type === "state") {
      players = msg.players;
      bullets = msg.bullets;
      myPlayer = players.find((p) => p.id === myId) || null;
      updateHUD();
      handleKillEvents(msg.kills || []);
    } else if (msg.type === "leaderboard") {
      renderLeaderboard(msg.board);
    }
  }

  // ================= 击杀信息 =================
  function handleKillEvents(kills) {
    for (const k of kills) addKillFeed(k);
  }
  function addKillFeed(k) {
    const div = document.createElement("div");
    div.className = "kill-item";
    div.innerHTML =
      `<span class="k" style="color:${k.killerColor}">${escapeHtml(k.killer)}</span>` +
      ` 🔫 ` +
      `<span class="v" style="color:${k.victimColor}">${escapeHtml(k.victim)}</span>`;
    killFeedEl.appendChild(div);
    while (killFeedEl.children.length > 5) killFeedEl.firstChild.remove();
    setTimeout(() => div.remove(), 3000);
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (m) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[m]));
  }

  // ================= HUD =================
  function updateHUD() {
    if (!myPlayer) return;
    const hpPct = Math.max(0, myPlayer.hp);
    hpFill.style.width = hpPct + "%";
    hpFill.style.background = hpPct > 50 ? "linear-gradient(90deg,#22c55e,#4ade80)"
      : hpPct > 25 ? "linear-gradient(90deg,#f59e0b,#fbbf24)"
      : "linear-gradient(90deg,#ef4444,#f87171)";
    hpText.textContent = Math.round(hpPct);
    killsEl.textContent = myPlayer.kills;
    deathsEl.textContent = myPlayer.deaths;

    // 准心显隐：存活时显示
    crosshair.classList.toggle("hidden", !myPlayer.alive);

    if (!myPlayer.alive) {
      deathOverlay.classList.remove("hidden");
      if (!deathOverlay._started) {
        deathOverlay._started = Date.now();
        deathOverlay._countdown = 3;
        respawnCountdown.textContent = "3 秒后复活...";
        deathOverlay._timer = setInterval(() => {
          deathOverlay._countdown--;
          if (deathOverlay._countdown <= 0) {
            clearInterval(deathOverlay._timer);
            deathOverlay._started = false;
            deathOverlay.classList.add("hidden");
          } else {
            respawnCountdown.textContent = deathOverlay._countdown + " 秒后复活...";
          }
        }, 1000);
      }
    } else {
      if (deathOverlay._timer) { clearInterval(deathOverlay._timer); deathOverlay._timer = null; }
      deathOverlay._started = false;
      deathOverlay.classList.add("hidden");
    }
  }

  function renderLeaderboard(board) {
    if (!board || !board.length) {
      leaderboardEl.innerHTML = "<h3>🏆 排行榜</h3><div style='text-align:center;opacity:.6'>等待玩家加入...</div>";
      return;
    }
    let html = "<h3>🏆 排行榜</h3>";
    for (const p of board) {
      const me = p.id === myId ? " me" : "";
      html += `<div class="lb-row${me}">
        <span class="dot" style="background:${p.color}"></span>
        <span class="name">${escapeHtml(p.name)}</span>
        <span class="score">${p.kills}</span>
      </div>`;
    }
    leaderboardEl.innerHTML = html;
  }

  // ================= 输入事件 =================
  window.addEventListener("keydown", (e) => {
    keys[e.key.toLowerCase()] = true;
    if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(e.key.toLowerCase())) {
      e.preventDefault();
    }
  });
  window.addEventListener("keyup", (e) => {
    keys[e.key.toLowerCase()] = false;
  });

  // 鼠标移动控制视角旋转（Pointer Lock 下按移动增量转向）
  canvas.addEventListener("mousemove", (e) => {
    if (pointerLocked) {
      aimAngle += e.movementX * MOUSE_SENS;
      aimPitch -= e.movementY * MOUSE_SENS;
      aimPitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, aimPitch));
    }
  });
  canvas.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    if (!pointerLocked && myId != null && !isTouch) {
      canvas.requestPointerLock();
    }
    mouse.down = true;
  });
  window.addEventListener("mouseup", () => { mouse.down = false; });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  document.addEventListener("pointerlockchange", () => {
    pointerLocked = document.pointerLockElement === canvas;
    if (!pointerLocked) mouse.down = false;
    updatePointerHint();
  });

  function updatePointerHint() {
    const inGame = myId != null && joinModal.classList.contains("hidden");
    if (!isTouch && inGame && !pointerLocked) {
      pointerHint.classList.remove("hidden");
    } else {
      pointerHint.classList.add("hidden");
    }
  }

  if (isTouch) {
    joystick.classList.remove("hidden");
    fireBtn.classList.remove("hidden");
    autoAim = true;

    joystick.addEventListener("touchstart", (e) => {
      e.preventDefault();
      const t = e.touches[0];
      joy.active = true;
      joy.baseX = t.clientX;
      joy.baseY = t.clientY;
    }, { passive: false });
    joystick.addEventListener("touchmove", (e) => {
      e.preventDefault();
      if (!joy.active) return;
      const t = e.touches[0];
      let dx = t.clientX - joy.baseX;
      let dy = t.clientY - joy.baseY;
      const max = 50;
      const len = Math.hypot(dx, dy);
      if (len > max) { dx = dx / len * max; dy = dy / len * max; }
      joy.dx = dx / max;
      joy.dy = dy / max;
      joystickKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    }, { passive: false });
    joystick.addEventListener("touchend", () => {
      joy.active = false;
      joy.dx = 0; joy.dy = 0;
      joystickKnob.style.transform = "translate(-50%, -50%)";
    });

    fireBtn.addEventListener("touchstart", (e) => {
      e.preventDefault();
      touchShooting = true;
      fireBtn.classList.add("active");
    }, { passive: false });
    fireBtn.addEventListener("touchend", (e) => {
      e.preventDefault();
      touchShooting = false;
      fireBtn.classList.remove("active");
    }, { passive: false });
  }

  function findNearestEnemy() {
    if (!myPlayer) return null;
    let best = null, bestD = Infinity;
    for (const p of players) {
      if (p.id === myId || !p.alive) continue;
      const d = (p.x - myPlayer.x) ** 2 + (p.y - myPlayer.y) ** 2;
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  }

  // ================= 发送输入 =================
  let lastSend = 0;
  function sendInput() {
    if (!connected || myId == null) return;
    const now = performance.now();
    if (now - lastSend < 33) return;
    lastSend = now;

    let moveForward = 0, moveRight = 0;
    if (keys["w"] || keys["arrowup"]) moveForward += 1;
    if (keys["s"] || keys["arrowdown"]) moveForward -= 1;
    if (keys["d"] || keys["arrowright"]) moveRight += 1;
    if (keys["a"] || keys["arrowleft"]) moveRight -= 1;
    if (joy.active) { moveForward = -joy.dy; moveRight = joy.dx; }

    const mlen = Math.hypot(moveForward, moveRight);
    if (mlen > 1) { moveForward /= mlen; moveRight /= mlen; }

    let angle = aimAngle;
    let shooting = mouse.down || touchShooting;

    if (autoAim) {
      // 触屏：自动瞄准最近敌人，并同步视角朝向
      const target = findNearestEnemy();
      if (target) {
        angle = Math.atan2(target.y - myPlayer.y, target.x - myPlayer.x);
        aimAngle = angle;
      }
    }
    // 键鼠：angle 由鼠标移动增量（aimAngle）决定，无需换算

    // 将“相对瞄准方向”的移动转换为世界坐标 (mx, my)
    const cosA = Math.cos(angle), sinA = Math.sin(angle);
    const mx = moveForward * cosA - moveRight * sinA;
    const my = moveForward * sinA + moveRight * cosA;

    ws.send(JSON.stringify({
      type: "input",
      mx, my,
      angle,
      pitch: aimPitch,
      shooting,
    }));
  }

  // ================= 渲染 =================
  function syncScene() {
    // 玩家
    const seen = new Set();
    for (const p of players) {
      seen.add(p.id);
      if (!p.alive) continue;
      let m = playerMeshes.get(p.id);
      if (!m) { m = createPlayerMesh(p); playerMeshes.set(p.id, m); }
      // 自己的角色第一人称下隐藏身体，其他玩家完整保留
      m.group.visible = p.id !== myId;
      m.group.position.set(p.x, 0, p.y);
      m.group.rotation.y = -p.angle;
      drawOverhead(m.overhead, p);
    }
    for (const [id, m] of playerMeshes) {
      if (!seen.has(id)) {
        world.remove(m.group);
        playerMeshes.delete(id);
      } else if (!players.find((q) => q.id === id)?.alive) {
        m.group.visible = false;
      }
    }

    // 子弹
    const bSeen = new Set();
    for (const b of bullets) {
      bSeen.add(b.id);
      let m = bulletMeshes.get(b.id);
      if (!m) { m = createBulletMesh(); bulletMeshes.set(b.id, m); }
      m.group.visible = true;
      updateBulletMesh(m, b);
    }
    for (const [id, m] of bulletMeshes) {
      if (!bSeen.has(id)) {
        world.remove(m.group);
        bulletMeshes.delete(id);
      }
    }
  }

  function updateCamera(dt) {
    fpgun.visible = !!(myPlayer && myPlayer.alive);
    if (myPlayer && myPlayer.alive) {
      const px = myPlayer.x, pz = myPlayer.y;

      // 第一人称：相机位于角色眼睛高度，视线随水平角+俯仰角旋转
      const cosP = Math.cos(aimPitch), sinP = Math.sin(aimPitch);
      const forwardX = Math.cos(aimAngle) * cosP;
      const forwardY = sinP;
      const forwardZ = Math.sin(aimAngle) * cosP;

      const desired = tmpVec.set(px, EYE_HEIGHT, pz);
      camTarget.lerp(desired, Math.min(1, dt * 16));

      camera.position.copy(camTarget);
      camLook.set(px + forwardX * 300, EYE_HEIGHT + forwardY * 300, pz + forwardZ * 300);
      camera.lookAt(camLook);
    } else if (myPlayer) {
      // 死亡：缓慢环绕观察
      const t = performance.now() * 0.0001;
      camera.position.set(
        myPlayer.x + Math.cos(t) * 220,
        130,
        myPlayer.y + Math.sin(t) * 220
      );
      camera.lookAt(myPlayer.x, 20, myPlayer.y);
    } else {
      // 未加入：俯视全景
      camera.position.set(0, 1600, 1400);
      camera.lookAt(0, 0, 0);
    }
  }

  // ================= 主循环 =================
  let lastTime = performance.now();
  function loop(now) {
    const dt = Math.min(0.1, (now - lastTime) / 1000);
    lastTime = now;

    sendInput();
    updateCamera(dt);
    syncScene();
    renderer.render(scene, camera);

    requestAnimationFrame(loop);
  }

  // ================= 加入 =================
  joinBtn.addEventListener("click", () => {
    const name = nameInput.value.trim();
    if (!name) { joinHint.textContent = "请输入昵称"; return; }
    if (!connected) { joinHint.textContent = "服务器未连接，请稍候..."; return; }
    ws.send(JSON.stringify({ type: "join", name }));
    joinModal.classList.add("hidden");
    if (!isTouch) canvas.requestPointerLock();
    updatePointerHint();
  });
  nameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") joinBtn.click();
  });

  // ================= 启动 =================
  connect();
  requestAnimationFrame(loop);
})();
