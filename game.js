(() => {
  "use strict";

  // ====== 常量 ======
  const GRID_SIZE = 20;       // 20 x 20 网格
  const CELL_SIZE = 20;       // 每格像素
  const BASE_SPEED = 140;     // 初始间隔 (ms)
  const MIN_SPEED = 60;       // 最快间隔 (ms)
  const SPEED_STEP = 4;       // 每吃一个食物加快的毫秒数
  const HIGH_SCORE_KEY = "snake-high-score";

  // ====== DOM ======
  const canvas = document.getElementById("gameCanvas");
  const ctx = canvas.getContext("2d");
  const scoreEl = document.getElementById("score");
  const highScoreEl = document.getElementById("highScore");
  const overlay = document.getElementById("overlay");
  const overlayTitle = document.getElementById("overlayTitle");
  const overlayMessage = document.getElementById("overlayMessage");
  const startBtn = document.getElementById("startBtn");

  // ====== 游戏状态 ======
  let snake, direction, nextDirection, food, score, highScore;
  let gameInterval, running, paused;

  // ====== 工具函数 ======
  const randomInt = (min, max) =>
    Math.floor(Math.random() * (max - min + 1)) + min;

  const isSamePoint = (a, b) => a.x === b.x && a.y === b.y;

  function initState() {
    snake = [
      { x: 10, y: 10 },
      { x: 9, y: 10 },
      { x: 8, y: 10 },
    ];
    direction = { x: 1, y: 0 };
    nextDirection = { x: 1, y: 0 };
    score = 0;
    highScore = Number(localStorage.getItem(HIGH_SCORE_KEY)) || 0;
    spawnFood();
    updateScoreUI();
  }

  function spawnFood() {
    let pos;
    do {
      pos = {
        x: randomInt(0, GRID_SIZE - 1),
        y: randomInt(0, GRID_SIZE - 1),
      };
    } while (snake.some((s) => isSamePoint(s, pos)));
    food = pos;
  }

  function updateScoreUI() {
    scoreEl.textContent = score;
    highScoreEl.textContent = highScore;
  }

  // ====== 绘制 ======
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 网格线（浅色）
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 1;
    for (let i = 1; i < GRID_SIZE; i++) {
      ctx.beginPath();
      ctx.moveTo(i * CELL_SIZE, 0);
      ctx.lineTo(i * CELL_SIZE, canvas.height);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i * CELL_SIZE);
      ctx.lineTo(canvas.width, i * CELL_SIZE);
      ctx.stroke();
    }

    // 食物（圆点 + 光晕）
    const fx = food.x * CELL_SIZE + CELL_SIZE / 2;
    const fy = food.y * CELL_SIZE + CELL_SIZE / 2;
    ctx.shadowColor = "#f87171";
    ctx.shadowBlur = 10;
    ctx.fillStyle = "#ef4444";
    ctx.beginPath();
    ctx.arc(fx, fy, CELL_SIZE / 2 - 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // 蛇身
    snake.forEach((segment, i) => {
      const isHead = i === snake.length - 1;
      const pad = isHead ? 1 : 2;
      const x = segment.x * CELL_SIZE;
      const y = segment.y * CELL_SIZE;
      ctx.fillStyle = isHead ? "#4ade80" : "#16a34a";
      ctx.beginPath();
      ctx.roundRect(
        x + pad,
        y + pad,
        CELL_SIZE - pad * 2,
        CELL_SIZE - pad * 2,
        isHead ? 6 : 4
      );
      ctx.fill();
    });
  }

  // ====== 游戏循环 ======
  function step() {
    direction = nextDirection;
    const head = snake[snake.length - 1];
    const newHead = {
      x: head.x + direction.x,
      y: head.y + direction.y,
    };

    // 撞墙
    if (
      newHead.x < 0 || newHead.x >= GRID_SIZE ||
      newHead.y < 0 || newHead.y >= GRID_SIZE
    ) {
      return gameOver("撞墙啦！");
    }

    // 撞到自己
    if (snake.some((s) => isSamePoint(s, newHead))) {
      return gameOver("咬到自己啦！");
    }

    snake.push(newHead);

    if (isSamePoint(newHead, food)) {
      score += 10;
      if (score > highScore) {
        highScore = score;
        localStorage.setItem(HIGH_SCORE_KEY, String(highScore));
      }
      updateScoreUI();
      spawnFood();
      speedUp();
    } else {
      snake.shift();
    }

    draw();
  }

  function currentDelay() {
    return Math.max(MIN_SPEED, BASE_SPEED - score / 10 * SPEED_STEP);
  }

  function speedUp() {
    clearInterval(gameInterval);
    gameInterval = setInterval(step, currentDelay());
  }

  // ====== 流程控制 ======
  function start() {
    initState();
    running = true;
    paused = false;
    overlay.classList.add("hidden");
    startBtn.textContent = "重新开始";
    draw();
    clearInterval(gameInterval);
    gameInterval = setInterval(step, BASE_SPEED);
  }

  function togglePause() {
    if (!running || paused) return;
    paused = true;
    clearInterval(gameInterval);
    overlayTitle.textContent = "已暂停";
    overlayMessage.textContent = "按 空格键 或点击按钮继续";
    startBtn.textContent = "继续游戏";
    overlay.classList.remove("hidden");
  }

  function resume() {
    if (!running || !paused) return;
    paused = false;
    overlay.classList.add("hidden");
    gameInterval = setInterval(step, currentDelay());
  }

  function gameOver(reason) {
    running = false;
    clearInterval(gameInterval);
    overlayTitle.textContent = "游戏结束";
    overlayMessage.textContent = reason + "  得分：" + score;
    startBtn.textContent = "再来一局";
    overlay.classList.remove("hidden");
  }

  // ====== 输入 ======
  const DIRECTION_MAP = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
  };

  function changeDirection(dir) {
    if (!running || paused) return;
    const newDir = DIRECTION_MAP[dir];
    if (!newDir) return;
    // 不允许直接掉头
    if (
      (newDir.x === -direction.x && newDir.y === -direction.y) ||
      (newDir.x === direction.x && newDir.y === direction.y)
    ) {
      return;
    }
    nextDirection = newDir;
  }

  const KEY_MAP = {
    ArrowUp: "up",
    w: "up",
    W: "up",
    ArrowDown: "down",
    s: "down",
    S: "down",
    ArrowLeft: "left",
    a: "left",
    A: "left",
    ArrowRight: "right",
    d: "right",
    D: "right",
  };

  document.addEventListener("keydown", (e) => {
    if (e.key === " ") {
      e.preventDefault();
      if (!running) {
        start();
      } else if (paused) {
        resume();
      } else {
        togglePause();
      }
      return;
    }

    const dir = KEY_MAP[e.key];
    if (dir) {
      e.preventDefault();
      changeDirection(dir);
    }
  });

  // 方向按钮（触屏/点击）
  document.querySelectorAll(".dpad-btn").forEach((btn) => {
    btn.addEventListener("click", () => changeDirection(btn.dataset.dir));
  });

  // 开始 / 重新开始 / 继续
  startBtn.addEventListener("click", () => {
    if (!running || paused) {
      start();
    }
  });

  // ====== 初始化 ======
  initState();
  draw();
  overlayTitle.textContent = "准备开始";
  overlayMessage.textContent = "按 空格键 或点击按钮开始游戏";
})();
