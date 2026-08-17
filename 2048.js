(() => {
  "use strict";

  const SIZE = 4;
  const BEST_KEY = "2048-best";
  const WIN_VALUE = 2048;

  // ====== DOM ======
  const boardEl = document.getElementById("board");
  const scoreEl = document.getElementById("score");
  const bestEl = document.getElementById("best");
  const overlay = document.getElementById("overlay");
  const overlayTitle = document.getElementById("overlayTitle");
  const overlayMessage = document.getElementById("overlayMessage");
  const restartBtn = document.getElementById("restartBtn");
  const retryBtn = document.getElementById("retryBtn");

  // ====== 状态 ======
  let grid, score, best, over, won, keptPlaying;

  function loadBest() {
    best = Number(localStorage.getItem(BEST_KEY)) || 0;
    bestEl.textContent = best;
  }

  function emptyGrid() {
    return Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
  }

  function resetGame() {
    grid = emptyGrid();
    score = 0;
    over = false;
    won = false;
    keptPlaying = false;
    overlay.classList.add("hidden");
    addRandomTile();
    addRandomTile();
    render();
  }

  // ====== 随机方块 ======
  function addRandomTile() {
    const empty = [];
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (grid[r][c] === 0) empty.push({ r, c });
      }
    }
    if (empty.length === 0) return;
    const { r, c } = empty[Math.floor(Math.random() * empty.length)];
    grid[r][c] = Math.random() < 0.9 ? 2 : 4;
  }

  // ====== 移动逻辑 ======
  function slideRow(row) {
    const filtered = row.filter((v) => v !== 0);
    const result = [];
    let gained = 0;
    for (let i = 0; i < filtered.length; i++) {
      if (i + 1 < filtered.length && filtered[i] === filtered[i + 1]) {
        const merged = filtered[i] * 2;
        result.push(merged);
        gained += merged;
        i++;
      } else {
        result.push(filtered[i]);
      }
    }
    while (result.length < SIZE) result.push(0);
    return { row: result, gained };
  }

  function move(direction) {
    if (over) return;
    let moved = false;
    let gained = 0;
    const before = JSON.stringify(grid);

    const getLine = (i) => {
      const line = [];
      for (let j = 0; j < SIZE; j++) {
        if (direction === "left") line.push(grid[i][j]);
        else if (direction === "right") line.push(grid[i][SIZE - 1 - j]);
        else if (direction === "up") line.push(grid[j][i]);
        else if (direction === "down") line.push(grid[SIZE - 1 - j][i]);
      }
      return line;
    };

    const setLine = (i, line) => {
      for (let j = 0; j < SIZE; j++) {
        if (direction === "left") grid[i][j] = line[j];
        else if (direction === "right") grid[i][SIZE - 1 - j] = line[j];
        else if (direction === "up") grid[j][i] = line[j];
        else if (direction === "down") grid[SIZE - 1 - j][i] = line[j];
      }
    };

    for (let i = 0; i < SIZE; i++) {
      const { row, gained: g } = slideRow(getLine(i));
      gained += g;
      setLine(i, row);
    }

    moved = before !== JSON.stringify(grid);
    if (!moved) return;

    score += gained;
    if (score > best) {
      best = score;
      localStorage.setItem(BEST_KEY, String(best));
      bestEl.textContent = best;
    }

    // 胜利检测（仅第一次达成 2048 时提示）
    if (!won && !keptPlaying && grid.flat().includes(WIN_VALUE)) {
      won = true;
    }

    addRandomTile();
    render();

    if (won && !keptPlaying) {
      showOverlay("恭喜！", "你达到了 2048！", "继续游戏");
    } else if (isGameOver()) {
      over = true;
      showOverlay("游戏结束", "没有可移动的方块了", "再来一局");
    }
  }

  function isGameOver() {
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (grid[r][c] === 0) return false;
        if (c + 1 < SIZE && grid[r][c] === grid[r][c + 1]) return false;
        if (r + 1 < SIZE && grid[r][c] === grid[r + 1][c]) return false;
      }
    }
    return true;
  }

  // ====== 渲染 ======
  function render() {
    scoreEl.textContent = score;
    boardEl.querySelectorAll(".tile").forEach((t) => t.remove());

    const gap = 12;
    const padding = 12;
    const boardSize = boardEl.clientWidth || 360;
    const cellSize = (boardSize - padding * 2 - gap * (SIZE - 1)) / SIZE;

    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const value = grid[r][c];
        if (value === 0) continue;

        const tile = document.createElement("div");
        tile.className = "tile tile-" + (value > 2048 ? "super" : value);
        tile.textContent = value;

        const x = padding + c * (cellSize + gap);
        const y = padding + r * (cellSize + gap);
        tile.style.left = x + "px";
        tile.style.top = y + "px";
        tile.style.width = cellSize + "px";
        tile.style.height = cellSize + "px";
        tile.style.fontSize = cellSize * 0.45 + "px";

        boardEl.appendChild(tile);
      }
    }
  }

  function showOverlay(title, message, btnText) {
    overlayTitle.textContent = title;
    overlayMessage.textContent = message;
    retryBtn.textContent = btnText;
    overlay.classList.remove("hidden");
  }

  // ====== 事件 ======
  function onKey(e) {
    const map = {
      ArrowLeft: "left", a: "left", A: "left",
      ArrowRight: "right", d: "right", D: "right",
      ArrowUp: "up", w: "up", W: "up",
      ArrowDown: "down", s: "down", S: "down",
    };
    const dir = map[e.key];
    if (dir) {
      e.preventDefault();
      move(dir);
    }
  }

  document.addEventListener("keydown", onKey);

  // 触屏滑动
  let touchStartX = 0, touchStartY = 0;
  boardEl.addEventListener("touchstart", (e) => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, { passive: true });

  boardEl.addEventListener("touchend", (e) => {
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    if (Math.abs(dx) < 20 && Math.abs(dy) < 20) return;
    if (Math.abs(dx) > Math.abs(dy)) {
      move(dx > 0 ? "right" : "left");
    } else {
      move(dy > 0 ? "down" : "up");
    }
  }, { passive: true });

  function restart() {
    loadBest();
    resetGame();
  }

  restartBtn.addEventListener("click", restart);
  retryBtn.addEventListener("click", () => {
    if (won && !keptPlaying) {
      keptPlaying = true;
      overlay.classList.add("hidden");
    } else {
      restart();
    }
  });

  // ====== 初始化 ======
  loadBest();
  resetGame();
  window.addEventListener("resize", render);
})();
