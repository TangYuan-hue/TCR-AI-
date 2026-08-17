(function () {
  "use strict";

  // ---- 难度配置 ----
  const LEVELS = {
    beginner: { rows: 9, cols: 9, mines: 10 },
    intermediate: { rows: 16, cols: 16, mines: 40 },
    expert: { rows: 16, cols: 30, mines: 99 },
  };

  // ---- DOM ----
  const boardEl = document.getElementById("board");
  const mineCounterEl = document.getElementById("mineCounter");
  const timerEl = document.getElementById("timer");
  const faceBtn = document.getElementById("faceBtn");
  const digModeBtn = document.getElementById("digMode");
  const flagModeBtn = document.getElementById("flagMode");
  const customModal = document.getElementById("customModal");
  const customRows = document.getElementById("customRows");
  const customCols = document.getElementById("customCols");
  const customMines = document.getElementById("customMines");
  const customOk = document.getElementById("customOk");
  const customCancel = document.getElementById("customCancel");
  const diffBtns = document.querySelectorAll(".diff-btn");

  // ---- 状态 ----
  let rows, cols, mineCount;
  let grid = [];          // 每个格子: { mine, revealed, flagged, adjacent }
  let gameState = "ready"; // ready | playing | won | lost
  let firstClick = true;
  let timerId = null;
  let seconds = 0;
  let flagCount = 0;
  let currentLevel = "beginner";
  let mode = "dig"; // dig | flag
  let cellSize = 34;

  // ---- 音效 (Web Audio 合成，无外部文件) ----
  let audioCtx = null;
  function ensureAudio() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtx = new AC();
    }
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
  }
  function beep(freq, duration, type = "sine", vol = 0.15) {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.value = vol;
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
  }
  const sfx = {
    reveal() { beep(520, 0.06, "square", 0.08); },
    flag() { beep(720, 0.08, "triangle", 0.12); },
    boom() { beep(120, 0.5, "sawtooth", 0.25); beep(80, 0.6, "square", 0.2); },
    win() {
      [523, 659, 784, 1047].forEach((f, i) =>
        setTimeout(() => beep(f, 0.2, "sine", 0.18), i * 120)
      );
    },
  };

  // ---- 计算 cell-size ----
  function computeCellSize() {
    const maxBoardW = Math.min(window.innerWidth - 40, 900);
    const maxBoardH = Math.min(window.innerHeight - 260, 560);
    const byW = Math.floor((maxBoardW - 16) / cols) - 2;
    const byH = Math.floor((maxBoardH - 16) / rows) - 2;
    cellSize = Math.max(18, Math.min(44, byW, byH));
    boardEl.style.setProperty("--cell-size", cellSize + "px");
    boardEl.style.gridTemplateColumns = `repeat(${cols}, ${cellSize}px)`;
  }

  // ---- 初始化/重置 ----
  function reset(level) {
    if (level) currentLevel = level;
    const cfg = LEVELS[currentLevel];
    rows = cfg.rows;
    cols = cfg.cols;
    mineCount = cfg.mines;

    grid = [];
    for (let r = 0; r < rows; r++) {
      grid[r] = [];
      for (let c = 0; c < cols; c++) {
        grid[r][c] = { mine: false, revealed: false, flagged: false, adjacent: 0 };
      }
    }

    gameState = "ready";
    firstClick = true;
    flagCount = 0;
    seconds = 0;
    stopTimer();
    timerEl.textContent = "000";
    updateMineCounter();
    faceBtn.textContent = "😀";
    computeCellSize();
    renderBoard();
    updateDiffButtons();
  }

  function startCustom() {
    const r = parseInt(customRows.value, 10);
    const c = parseInt(customCols.value, 10);
    const m = parseInt(customMines.value, 10);
    if (isNaN(r) || isNaN(c) || isNaN(m) || r < 5 || c < 5 || m < 5) {
      alert("请输入有效的数值（行/列 ≥ 5，雷数 ≥ 5）");
      return;
    }
    if (m >= r * c) {
      alert("雷数过多，请减少雷数");
      return;
    }
    LEVELS.custom = { rows: r, cols: c, mines: m };
    customModal.classList.add("hidden");
    reset("custom");
  }

  // ---- 布雷（首次点击后，保证安全区） ----
  function placeMines(safeR, safeC) {
    const total = rows * cols;
    let toPlace = mineCount;
    // 收集安全区（首次点击及周围 8 格）
    const safeSet = new Set();
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const nr = safeR + dr, nc = safeC + dc;
        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
          safeSet.add(nr * cols + nc);
        }
      }
    }
    // 若雷数过多，缩减安全区范围保护中心
    while (toPlace > total - safeSet.size) {
      safeSet.delete(safeR * cols + safeC);
      break;
    }

    const candidates = [];
    for (let i = 0; i < total; i++) {
      if (!safeSet.has(i)) candidates.push(i);
    }
    // 洗牌
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    for (let k = 0; k < toPlace; k++) {
      const idx = candidates[k];
      const r = Math.floor(idx / cols), c = idx % cols;
      grid[r][c].mine = true;
    }
    // 计算相邻雷数
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (grid[r][c].mine) continue;
        grid[r][c].adjacent = countAdjacentMines(r, c);
      }
    }
  }

  function countAdjacentMines(r, c) {
    let n = 0;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = r + dr, nc = c + dc;
        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && grid[nr][nc].mine) n++;
      }
    }
    return n;
  }

  // ---- 渲染 ----
  function renderBoard() {
    boardEl.innerHTML = "";
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cell = document.createElement("div");
        cell.className = "cell";
        cell.dataset.r = r;
        cell.dataset.c = c;
        cell.addEventListener("click", () => onLeftClick(r, c));
        cell.addEventListener("contextmenu", (e) => { e.preventDefault(); onRightClick(r, c); });
        cell.addEventListener("dblclick", () => onChord(r, c));
        cell.addEventListener("mousedown", onMouseDown);
        cell.addEventListener("touchstart", onTouchStart, { passive: false });
        cell.addEventListener("touchend", onTouchEnd, { passive: false });
        boardEl.appendChild(cell);
      }
    }
  }

  function getCellEl(r, c) {
    return boardEl.children[r * cols + c];
  }

  function updateCell(r, c) {
    const cell = getCellEl(r, c);
    const data = grid[r][c];
    cell.className = "cell";
    if (data.revealed) {
      cell.classList.add("revealed");
      if (data.mine) {
        cell.textContent = "💣";
        if (cell.classList.contains("mine-exploded")) return;
        cell.classList.add("mine-shown");
      } else if (data.adjacent > 0) {
        cell.textContent = data.adjacent;
        cell.classList.add("n" + data.adjacent);
      } else {
        cell.textContent = "";
      }
    } else if (data.flagged) {
      cell.textContent = "🚩";
      cell.classList.add("flagged");
    } else {
      cell.textContent = "";
    }
  }

  function updateMineCounter() {
    const left = mineCount - flagCount;
    const val = left < 0 ? "-" + pad(Math.abs(left)) : pad(left);
    mineCounterEl.textContent = val;
  }

  function pad(n) {
    if (n < 0) n = -n;
    if (n >= 100) return String(n);
    if (n >= 10) return "0" + n;
    return "00" + n;
  }

  // ---- 计时器 ----
  function startTimer() {
    stopTimer();
    timerId = setInterval(() => {
      seconds++;
      if (seconds > 999) seconds = 999;
      timerEl.textContent = pad(seconds);
    }, 1000);
  }
  function stopTimer() {
    if (timerId) { clearInterval(timerId); timerId = null; }
  }

  // ---- 交互 ----
  function onMouseDown(e) {
    if (gameState === "won" || gameState === "lost") return;
    if (e.button === 0 && gameState === "playing") faceBtn.textContent = "😮";
  }

  function onLeftClick(r, c) {
    if (gameState === "won" || gameState === "lost") return;
    const data = grid[r][c];
    if (mode === "flag") {
      toggleFlag(r, c);
      return;
    }
    if (data.flagged || data.revealed) return;
    ensureAudio();
    if (firstClick) {
      placeMines(r, c);
      firstClick = false;
      gameState = "playing";
      startTimer();
    }
    if (data.mine) {
      lose(r, c);
    } else {
      reveal(r, c);
      sfx.reveal();
      checkWin();
    }
  }

  function onRightClick(r, c) {
    if (gameState === "won" || gameState === "lost") return;
    const data = grid[r][c];
    if (data.revealed) {
      onChord(r, c);
      return;
    }
    toggleFlag(r, c);
  }

  function toggleFlag(r, c) {
    if (gameState === "won" || gameState === "lost") return;
    const data = grid[r][c];
    if (data.revealed) return;
    ensureAudio();
    data.flagged = !data.flagged;
    flagCount += data.flagged ? 1 : -1;
    sfx.flag();
    updateCell(r, c);
    updateMineCounter();
  }

  function reveal(r, c) {
    const data = grid[r][c];
    if (data.revealed || data.flagged) return;
    data.revealed = true;
    updateCell(r, c);
    if (data.adjacent === 0 && !data.mine) {
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nr = r + dr, nc = c + dc;
          if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
            reveal(nr, nc);
          }
        }
      }
    }
  }

  // 双击/和弦：周围旗子数 == 数字时，快速展开
  function onChord(r, c) {
    if (gameState !== "playing") return;
    const data = grid[r][c];
    if (!data.revealed || data.adjacent === 0) return;
    const flags = countNeighborFlags(r, c);
    if (flags !== data.adjacent) return;
    ensureAudio();
    let hitMine = false;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = r + dr, nc = c + dc;
        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
          const nd = grid[nr][nc];
          if (!nd.revealed && !nd.flagged) {
            if (nd.mine) { hitMine = true; }
            else { reveal(nr, nc); }
          }
        }
      }
    }
    if (hitMine) {
      lose(r, c);
    } else {
      sfx.reveal();
      checkWin();
    }
  }

  function countNeighborFlags(r, c) {
    let n = 0;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = r + dr, nc = c + dc;
        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && grid[nr][nc].flagged) n++;
      }
    }
    return n;
  }

  // ---- 胜负 ----
  function lose(r, c) {
    gameState = "lost";
    stopTimer();
    faceBtn.textContent = "😵";
    sfx.boom();
    // 显示所有雷
    for (let rr = 0; rr < rows; rr++) {
      for (let cc = 0; cc < cols; cc++) {
        const d = grid[rr][cc];
        const el = getCellEl(rr, cc);
        if (d.mine && !d.flagged && !d.revealed) {
          d.revealed = true;
          updateCell(rr, cc);
        }
        if (d.flagged && !d.mine) {
          // 错误旗标
          el.textContent = "❌";
          el.classList.add("revealed", "wrong-flag");
        }
      }
    }
    // 爆炸的那颗
    const exploded = getCellEl(r, c);
    exploded.classList.add("mine-exploded");
    exploded.textContent = "💥";
  }

  function checkWin() {
    let revealed = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (grid[r][c].revealed && !grid[r][c].mine) revealed++;
      }
    }
    if (revealed === rows * cols - mineCount) {
      gameState = "won";
      stopTimer();
      faceBtn.textContent = "😎";
      sfx.win();
      // 自动插旗所有雷
      let idx = 0;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const d = grid[r][c];
          if (d.mine) {
            d.flagged = true;
            flagCount++;
            const el = getCellEl(r, c);
            el.textContent = "🚩";
            el.classList.add("flagged");
            setTimeout(() => el.classList.add("win-pop"), idx++ * 18);
          }
        }
      }
      updateMineCounter();
    }
  }

  // ---- 移动端触摸（长按插旗） ----
  let touchTimer = null;
  let touchStartPos = null;
  let longPressTriggered = false;

  function onTouchStart(e) {
    const touch = e.touches[0];
    touchStartPos = { x: touch.clientX, y: touch.clientY };
    longPressTriggered = false;
    const r = parseInt(this.dataset.r, 10);
    const c = parseInt(this.dataset.c, 10);
    if (mode === "dig" && !grid[r][c].revealed && !grid[r][c].flagged) {
      touchTimer = setTimeout(() => {
        longPressTriggered = true;
        e.preventDefault();
        onRightClick(r, c);
      }, 350);
    }
  }

  function onTouchEnd(e) {
    clearTimeout(touchTimer);
    if (longPressTriggered) {
      longPressTriggered = false;
      return;
    }
    const r = parseInt(this.dataset.r, 10);
    const c = parseInt(this.dataset.c, 10);
    // 只有轻微滑动内才视为点按
    if (e.changedTouches && e.changedTouches[0]) {
      const t = e.changedTouches[0];
      if (touchStartPos &&
        Math.abs(t.clientX - touchStartPos.x) < 12 &&
        Math.abs(t.clientY - touchStartPos.y) < 12) {
        onLeftClick(r, c);
      }
    }
  }

  // ---- 事件绑定 ----
  faceBtn.addEventListener("click", () => reset(currentLevel));

  diffBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.level === "custom") {
        customModal.classList.remove("hidden");
        return;
      }
      reset(btn.dataset.level);
    });
  });

  customOk.addEventListener("click", startCustom);
  customCancel.addEventListener("click", () => customModal.classList.add("hidden"));

  function setMode(m) {
    mode = m;
    digModeBtn.classList.toggle("active", m === "dig");
    flagModeBtn.classList.toggle("active", m === "flag");
  }
  digModeBtn.addEventListener("click", () => setMode("dig"));
  flagModeBtn.addEventListener("click", () => setMode("flag"));

  // 全局鼠标松开恢复笑脸
  document.addEventListener("mouseup", () => {
    if (gameState === "playing") faceBtn.textContent = "😀";
  });

  function updateDiffButtons() {
    diffBtns.forEach((b) => {
      b.classList.toggle("active", b.dataset.level === currentLevel);
    });
  }

  window.addEventListener("resize", () => {
    if (gameState === "ready") computeCellSize();
  });

  // ---- 启动 ----
  reset("beginner");
})();
