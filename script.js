/**
 * QuickSort Biopunk Visualizer — script.js
 * ══════════════════════════════════════════
 *
 * Architecture overview:
 *  1. AUDIO ENGINE     — Web Audio API beep/tone sounds
 *  2. BACKGROUND       — Animated floating orb canvas
 *  3. PARTICLES        — Burst effects on swap events
 *  4. STEP COMPILER    — Converts QuickSort into a flat list of Steps
 *  5. RENDERER         — Applies Steps to the DOM
 *  6. ANIMATION LOOP   — rAF-based, speed-aware playback
 *  7. TREE PAINTER     — Draws recursion tree on <canvas>
 *  8. CONTROLS         — All UI event listeners
 *
 * Key design choice: ALL sort decisions are pre-computed into
 * a `steps[]` array before any animation begins.  This gives us
 * O(1) cost per frame, true pause/resume, and instant stepping.
 */

'use strict';

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   1. AUDIO ENGINE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
const SFX = (() => {
  let ctx = null;

  function getCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    return ctx;
  }

  /**
   * Play a short synthetic tone.
   * @param {number} freq  - Hz
   * @param {string} type  - OscillatorType
   * @param {number} dur   - seconds
   * @param {number} vol   - gain 0–1
   */
  function tone(freq, type = 'sine', dur = 0.07, vol = 0.09) {
    try {
      const c = getCtx();
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.connect(g);
      g.connect(c.destination);
      osc.type = type;
      osc.frequency.setValueAtTime(freq, c.currentTime);
      g.gain.setValueAtTime(vol, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
      osc.start(c.currentTime);
      osc.stop(c.currentTime + dur);
    } catch (_) { /* silently skip if audio context unavailable */ }
  }

  return {
    compare: (idx, max) => tone(300 + (idx / max) * 900, 'sine', 0.05, 0.07),
    swap:    (idx, max) => tone(200 + (idx / max) * 600, 'triangle', 0.1, 0.11),
    pivot:   ()         => tone(880, 'square', 0.06, 0.07),
    done:    ()         => {
      const freqs = [523, 659, 784, 1047, 1319];
      freqs.forEach((f, i) => setTimeout(() => tone(f, 'sine', 0.2, 0.13), i * 100));
    }
  };
})();


/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   2. ANIMATED BACKGROUND
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
(function initBackground() {
  const canvas = document.getElementById('bgCanvas');
  const ctx = canvas.getContext('2d');

  const orbs = Array.from({ length: 7 }, () => ({
    x: Math.random(), y: Math.random(),
    vx: (Math.random() - 0.5) * 0.0004,
    vy: (Math.random() - 0.5) * 0.0004,
    r: 0.08 + Math.random() * 0.16,
    hue: Math.random() < 0.5 ? 175 : 35,  // teal or amber
    alpha: 0.12 + Math.random() * 0.1,
  }));

  function resize() {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  function drawFrame() {
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    orbs.forEach(o => {
      o.x += o.vx; o.y += o.vy;
      if (o.x < -o.r) o.x = 1 + o.r;
      if (o.x > 1 + o.r) o.x = -o.r;
      if (o.y < -o.r) o.y = 1 + o.r;
      if (o.y > 1 + o.r) o.y = -o.r;
      const gx = o.x * W, gy = o.y * H, gr = o.r * Math.min(W, H);
      const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr);
      g.addColorStop(0, `hsla(${o.hue},90%,55%,${o.alpha})`);
      g.addColorStop(1, `hsla(${o.hue},90%,55%,0)`);
      ctx.beginPath();
      ctx.arc(gx, gy, gr, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
    });
    requestAnimationFrame(drawFrame);
  }
  drawFrame();
})();


/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   3. PARTICLE SYSTEM
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function spawnParticles(x, y, color, count = 10) {
  const container = document.getElementById('particleContainer');
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5;
    const dist  = 30 + Math.random() * 60;
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist;
    const size = 3 + Math.random() * 5;
    p.style.cssText = `
      left:${x}px; top:${y}px;
      width:${size}px; height:${size}px;
      background:${color};
      box-shadow: 0 0 6px ${color};
      --dx:${dx}px; --dy:${dy}px;
    `;
    container.appendChild(p);
    setTimeout(() => p.remove(), 700);
  }
}

function getBarCenter(barEl) {
  const r = barEl.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}


/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   4. STEP COMPILER
   Produces a flat array of step objects before
   any animation starts.  Step types:
     code    { line }
     desc    { text }
     pivot   { idx }
     range   { lo, hi }
     compare { i, j }
     swap    { i, j }
     sorted  { idx }
     push    { lo, hi, depth }
     pop     { lo, hi }
     done    {}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function compileSteps(array) {
  const steps = [];
  const arr   = [...array];  // working copy
  let maxDepth = 0;

  function emit(...ss) { ss.forEach(s => steps.push(s)); }

  function partition(lo, hi) {
    emit({ type: 'code', line: 1 });
    emit({ type: 'desc', text: `Partition [${lo}…${hi}]: pivot = arr[${hi}] = ${arr[hi]}` });
    emit({ type: 'pivot', idx: hi });
    SFX; // reference kept; actual call at apply-time

    let i = lo - 1;
    emit({ type: 'code', line: 2 });

    for (let j = lo; j < hi; j++) {
      emit({ type: 'code', line: 3 });
      emit({ type: 'code', line: 4 });
      emit({ type: 'compare', i: j, j: hi });
      emit({ type: 'desc', text: `Compare arr[${j}] = ${arr[j]} with pivot ${arr[hi]}` });

      if (arr[j] <= arr[hi]) {
        i++;
        emit({ type: 'code', line: 5 });
        emit({ type: 'code', line: 6 });
        if (i !== j) {
          emit({ type: 'desc', text: `arr[${j}] ≤ pivot → swap arr[${i}] ↔ arr[${j}]` });
          emit({ type: 'swap', i, j });
          [arr[i], arr[j]] = [arr[j], arr[i]];
        } else {
          emit({ type: 'desc', text: `arr[${j}] ≤ pivot → i advances (in place, no swap)` });
        }
      } else {
        emit({ type: 'desc', text: `arr[${j}] > pivot → leave in place` });
      }
    }

    const pivotFinal = i + 1;
    emit({ type: 'code', line: 7 });
    emit({ type: 'code', line: 8 });
    if (pivotFinal !== hi) {
      emit({ type: 'desc', text: `Place pivot: swap arr[${pivotFinal}] ↔ arr[${hi}]` });
      emit({ type: 'swap', i: pivotFinal, j: hi });
      [arr[pivotFinal], arr[hi]] = [arr[hi], arr[pivotFinal]];
    } else {
      emit({ type: 'desc', text: `Pivot already at final position ${pivotFinal}` });
    }
    emit({ type: 'sorted', idx: pivotFinal });
    return pivotFinal;
  }

  function quickSort(lo, hi, depth) {
    if (depth > maxDepth) maxDepth = depth;
    emit({ type: 'push', lo, hi, depth });
    emit({ type: 'code', line: 0 });

    if (lo < hi) {
      emit({ type: 'range', lo, hi });
      emit({ type: 'desc', text: `quickSort(${lo}, ${hi})  —  depth ${depth}` });
      emit({ type: 'code', line: 9 });
      const p = partition(lo, hi);
      emit({ type: 'code', line: 10 });
      quickSort(lo, p - 1, depth + 1);
      quickSort(p + 1, hi, depth + 1);
    } else {
      if (lo === hi) {
        emit({ type: 'sorted', idx: lo });
        emit({ type: 'desc', text: `Single element at index ${lo} — already sorted` });
      }
    }
    emit({ type: 'pop', lo, hi });
  }

  quickSort(0, arr.length - 1, 0);
  emit({ type: 'code', line: 11 });
  emit({ type: 'done' });
  steps._maxDepth = maxDepth;
  return steps;
}


/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   5. STATE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
const S = {
  array:       [],
  barStates:   [],   // per-index CSS class suffix
  steps:       [],
  stepIdx:     0,
  isRunning:   false,
  isPaused:    false,
  rafId:       null,
  lastTick:    0,
  comparisons: 0,
  swaps:       0,
  maxDepth:    0,
  callStack:   [],   // { lo, hi, depth, state }
  treeNodes:   [],   // for canvas tree
};


/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   6. RENDERER
   Applies a single Step to the DOM.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
const DOM = {
  bars:        document.getElementById('barsInner'),
  barsOuter:   document.getElementById('barsOuter'),
  status:      document.getElementById('statusBox'),
  stackFrames: document.getElementById('stackFrames'),
  statComp:    document.getElementById('statComparisons'),
  statSwap:    document.getElementById('statSwaps'),
  statDepth:   document.getElementById('statDepth'),
  statSize:    document.getElementById('statSize'),
  treeCanvas:  document.getElementById('treeCanvas'),
};

function getBarEls() { return Array.from(DOM.bars.children); }

/** Rebuild the bar elements from scratch */
function renderBars(arr, states) {
  const container = DOM.bars;
  const n = arr.length;
  const maxVal = Math.max(...arr, 1);

  // Add / remove bar elements to match array length
  while (container.children.length < n) {
    const bar = document.createElement('div');
    bar.className = 'bar s-default';
    container.appendChild(bar);
  }
  while (container.children.length > n) {
    container.removeChild(container.lastChild);
  }

  const els = container.children;
  for (let i = 0; i < n; i++) {
    const pct = (arr[i] / maxVal) * 100;
    els[i].style.height = `${Math.max(pct, 1)}%`;
    els[i].setAttribute('data-value', arr[i]);
    els[i].className = `bar s-${states[i] || 'default'}`;
  }
}

function bumpStat(el) {
  el.classList.remove('bump');
  void el.offsetWidth;  // force reflow
  el.classList.add('bump');
  setTimeout(() => el.classList.remove('bump'), 350);
}

function updateStats() {
  DOM.statComp.textContent  = S.comparisons;
  DOM.statSwap.textContent  = S.swaps;
  DOM.statDepth.textContent = S.maxDepth;
  DOM.statSize.textContent  = S.array.length;
}

function highlightCode(line) {
  document.querySelectorAll('.pseudo-line').forEach(el => el.classList.remove('active', 'flash-swap'));
  if (line < 0) return;
  const el = document.querySelector(`.pseudo-line[data-line="${line}"]`);
  if (el) {
    el.classList.add(line === 6 || line === 7 ? 'flash-swap' : 'active');
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

function updateCallStackDOM() {
  const container = DOM.stackFrames;
  // Keep max 30 frames visible
  const frames = S.callStack.slice(-30);
  container.innerHTML = '';
  frames.forEach(f => {
    const div = document.createElement('div');
    div.className = `frame ${f.state}`;
    div.innerHTML = `<span class="frame-depth">D${f.depth}</span> QS(${f.lo},${f.hi})`;
    container.appendChild(div);
  });
  container.scrollTop = container.scrollHeight;
}

/** Apply one step and mutate S */
function applyStep(step) {
  const states = S.barStates;

  switch (step.type) {

    case 'code':
      highlightCode(step.line);
      break;

    case 'desc':
      DOM.status.textContent = step.text;
      break;

    case 'range':
      for (let k = 0; k < states.length; k++) {
        if (states[k] !== 'sorted' && states[k] !== 'done') {
          states[k] = (k >= step.lo && k <= step.hi) ? 'range' : 'default';
        }
      }
      renderBars(S.array, states);
      break;

    case 'pivot': {
      // Clear old compare/swap highlights
      for (let k = 0; k < states.length; k++) {
        if (states[k] === 'compare' || states[k] === 'swap') states[k] = 'range';
      }
      states[step.idx] = 'pivot';
      SFX.pivot();
      renderBars(S.array, states);
      break;
    }

    case 'compare': {
      for (let k = 0; k < states.length; k++) {
        if (states[k] === 'compare' || states[k] === 'swap') states[k] = 'range';
      }
      if (states[step.i] !== 'pivot' && states[step.i] !== 'sorted') states[step.i] = 'compare';
      if (states[step.j] !== 'pivot' && states[step.j] !== 'sorted') states[step.j] = 'compare';
      S.comparisons++;
      bumpStat(DOM.statComp);
      SFX.compare(step.i, S.array.length);
      renderBars(S.array, states);
      updateStats();
      break;
    }

    case 'swap': {
      const { i, j } = step;
      states[i] = 'swap';
      states[j] = 'swap';
      [S.array[i], S.array[j]] = [S.array[j], S.array[i]];
      S.swaps++;
      bumpStat(DOM.statSwap);
      SFX.swap(i, S.array.length);

      // Particle burst at bar positions
      const els = getBarEls();
      if (els[i]) { const c = getBarCenter(els[i]); spawnParticles(c.x, c.y, '#ff4d6d', 8); }
      if (els[j]) { const c = getBarCenter(els[j]); spawnParticles(c.x, c.y, '#ff4d6d', 8); }

      renderBars(S.array, states);
      updateStats();
      break;
    }

    case 'sorted':
      states[step.idx] = 'sorted';
      renderBars(S.array, states);
      break;

    case 'push': {
      S.callStack.push({ lo: step.lo, hi: step.hi, depth: step.depth, state: 'active' });
      if (step.depth > S.maxDepth) S.maxDepth = step.depth;
      addTreeNode(step.lo, step.hi, step.depth);
      updateCallStackDOM();
      updateStats();
      break;
    }

    case 'pop': {
      // Mark matching active frame as done
      for (let k = S.callStack.length - 1; k >= 0; k--) {
        if (S.callStack[k].lo === step.lo && S.callStack[k].hi === step.hi && S.callStack[k].state === 'active') {
          S.callStack[k].state = 'done';
          break;
        }
      }
      updateCallStackDOM();
      break;
    }

    case 'done': {
      // Paint all bars green
      S.barStates = S.barStates.map(() => 'done');
      renderBars(S.array, S.barStates);
      DOM.barsOuter.classList.add('completed');
      DOM.status.textContent = `✓ Sort complete — ${S.comparisons} comparisons, ${S.swaps} swaps, max depth ${S.maxDepth}.`;
      highlightCode(-1);
      SFX.done();
      stopEngine();
      break;
    }
  }
}


/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   7. RECURSION TREE PAINTER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
const TREE = {
  nodes: [],   // { lo, hi, depth, x, y, parentIdx }
};

function addTreeNode(lo, hi, depth) {
  const canvas = DOM.treeCanvas;
  const ctx = canvas.getContext('2d');
  const W = canvas.parentElement.clientWidth || 600;
  const H = 120;
  canvas.width  = Math.max(W, 600);
  canvas.height = H;

  TREE.nodes.push({ lo, hi, depth });
  paintTree(ctx, canvas.width, H);
}

function paintTree(ctx, W, H) {
  ctx.clearRect(0, 0, W, H);

  const byDepth = {};
  TREE.nodes.forEach(n => {
    if (!byDepth[n.depth]) byDepth[n.depth] = [];
    byDepth[n.depth].push(n);
  });

  const maxDepth = Math.max(...Object.keys(byDepth).map(Number), 0);
  const rowH = H / (maxDepth + 2);

  // Assign x positions
  const positioned = [];
  TREE.nodes.forEach((n, idx) => {
    const siblings = byDepth[n.depth];
    const pos = siblings.indexOf(n);
    const count = siblings.length;
    const x = W * (pos + 0.5) / count;
    const y = (n.depth + 0.5) * rowH;
    positioned[idx] = { x, y, ...n };
  });

  // Draw edges (simple parent heuristic: nearest shallower node)
  ctx.strokeStyle = 'rgba(0,212,180,0.22)';
  ctx.lineWidth = 1;
  positioned.forEach((node, idx) => {
    if (node.depth === 0) return;
    // Find parent: same hi or lo neighbourhood one level up
    let bestDist = Infinity, bestIdx = -1;
    positioned.forEach((p, pi) => {
      if (p.depth !== node.depth - 1) return;
      const d = Math.abs(p.x - node.x);
      if (d < bestDist) { bestDist = d; bestIdx = pi; }
    });
    if (bestIdx >= 0) {
      ctx.beginPath();
      ctx.moveTo(positioned[bestIdx].x, positioned[bestIdx].y);
      ctx.lineTo(node.x, node.y);
      ctx.stroke();
    }
  });

  // Draw nodes
  positioned.forEach(node => {
    const r = Math.max(3, Math.min(14, 16 - node.depth * 1.5));
    // Node circle
    const grad = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, r);
    const hue = node.depth % 2 === 0 ? '35' : '175';
    grad.addColorStop(0, `hsla(${hue},90%,70%,0.9)`);
    grad.addColorStop(1, `hsla(${hue},90%,45%,0.3)`);
    ctx.beginPath();
    ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    // Label
    const label = `${node.lo}:${node.hi}`;
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = `${Math.max(7, 10 - node.depth)}px "Syne Mono", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (r > 7) ctx.fillText(label, node.x, node.y);
  });
}


/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   8. ANIMATION LOOP
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
/** Convert speed slider value [1–10] to ms delay between steps */
function speedToDelay(speed) {
  // speed=1 → ~900ms, speed=10 → ~12ms
  return Math.round(900 / (speed * speed * 0.09 + 0.3));
}

function tick(ts) {
  if (!S.isRunning || S.isPaused) return;

  const delay = speedToDelay(+document.getElementById('speedSlider').value);
  if (ts - S.lastTick >= delay) {
    S.lastTick = ts;

    if (S.stepIdx < S.steps.length) {
      applyStep(S.steps[S.stepIdx++]);
    } else {
      stopEngine();
      return;
    }
  }

  S.rafId = requestAnimationFrame(tick);
}

function startEngine() {
  if (S.isRunning && !S.isPaused) return;

  if (!S.isRunning) {
    // First-time compile
    S.steps       = compileSteps(S.array);
    S.stepIdx     = 0;
    S.comparisons = 0;
    S.swaps       = 0;
    S.maxDepth    = 0;
    S.callStack   = [];
    S.barStates   = new Array(S.array.length).fill('default');
    TREE.nodes    = [];
    DOM.barsOuter.classList.remove('completed');
    renderBars(S.array, S.barStates);
    updateStats();
  }

  S.isRunning = true;
  S.isPaused  = false;

  setButtonState({ start: false, pause: true, step: true, reset: true, random: false, load: false });
  document.getElementById('btnPause').textContent = '⏸ Pause';
  S.lastTick = 0;
  S.rafId = requestAnimationFrame(tick);
}

function pauseEngine() {
  if (!S.isRunning) return;
  S.isPaused = !S.isPaused;

  if (S.isPaused) {
    cancelAnimationFrame(S.rafId);
    document.getElementById('btnPause').textContent = '▶ Resume';
  } else {
    document.getElementById('btnPause').textContent = '⏸ Pause';
    S.lastTick = 0;
    S.rafId = requestAnimationFrame(tick);
  }
}

function stepEngine() {
  // If not started yet, compile and enter paused mode
  if (!S.isRunning) {
    S.steps       = compileSteps(S.array);
    S.stepIdx     = 0;
    S.comparisons = 0;
    S.swaps       = 0;
    S.maxDepth    = 0;
    S.callStack   = [];
    S.barStates   = new Array(S.array.length).fill('default');
    TREE.nodes    = [];
    DOM.barsOuter.classList.remove('completed');
    renderBars(S.array, S.barStates);
    updateStats();
    S.isRunning = true;
    S.isPaused  = true;
    setButtonState({ start: false, pause: true, step: true, reset: true, random: false, load: false });
    document.getElementById('btnPause').textContent = '▶ Resume';
  }

  // Ensure paused
  if (!S.isPaused) pauseEngine();

  if (S.stepIdx < S.steps.length) {
    applyStep(S.steps[S.stepIdx++]);
  }
}

function stopEngine() {
  S.isRunning = false;
  S.isPaused  = false;
  cancelAnimationFrame(S.rafId);
  setButtonState({ start: false, pause: false, step: false, reset: true, random: true, load: true });
  document.getElementById('btnPause').textContent = '⏸ Pause';
}

function resetAll() {
  stopEngine();
  S.isRunning   = false;
  S.steps       = [];
  S.stepIdx     = 0;
  S.comparisons = 0;
  S.swaps       = 0;
  S.maxDepth    = 0;
  S.callStack   = [];
  S.barStates   = new Array(S.array.length).fill('default');
  TREE.nodes    = [];

  // Clear tree canvas
  const tc = DOM.treeCanvas;
  tc.getContext('2d').clearRect(0, 0, tc.width, tc.height);

  DOM.barsOuter.classList.remove('completed');
  renderBars(S.array, S.barStates);
  updateStats();
  updateCallStackDOM();
  highlightCode(-1);
  DOM.status.textContent = 'Reset — ready to start.';

  setButtonState({ start: true, pause: false, step: true, reset: true, random: true, load: true });
  document.getElementById('btnPause').textContent = '⏸ Pause';
}


/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   HELPERS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function setButtonState({ start, pause, step, reset, random, load }) {
  document.getElementById('btnStart').disabled  = !start;
  document.getElementById('btnPause').disabled  = !pause;
  document.getElementById('btnStep').disabled   = !step;
  document.getElementById('btnReset').disabled  = !reset;
  document.getElementById('btnRandom').disabled = !random;
  document.getElementById('btnLoad').disabled   = !load;
}

function loadNewArray(arr) {
  S.array     = [...arr];
  S.barStates = new Array(arr.length).fill('default');
  S.steps     = [];
  S.stepIdx   = 0;
  S.comparisons = 0;
  S.swaps       = 0;
  S.maxDepth    = 0;
  S.callStack   = [];
  TREE.nodes    = [];

  const tc = DOM.treeCanvas;
  tc.getContext('2d').clearRect(0, 0, tc.width, tc.height);

  DOM.barsOuter.classList.remove('completed');
  renderBars(S.array, S.barStates);
  updateStats();
  updateCallStackDOM();
  highlightCode(-1);
  DOM.status.textContent = `Array loaded (${arr.length} elements). Press Start or Step.`;
  document.getElementById('statSize').textContent = arr.length;

  setButtonState({ start: true, pause: false, step: true, reset: true, random: true, load: true });
}

function generateRandom(n) {
  return Array.from({ length: n }, () => Math.floor(Math.random() * 95) + 5);
}


/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   9. EVENT LISTENERS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
document.getElementById('btnRandom').addEventListener('click', () => {
  const n = +document.getElementById('sizeSlider').value;
  loadNewArray(generateRandom(n));
});

document.getElementById('btnLoad').addEventListener('click', () => {
  const raw = document.getElementById('customInput').value.trim();
  if (!raw) return;
  const parsed = raw.split(/[\s,]+/)
    .map(Number)
    .filter(n => !isNaN(n) && n > 0 && n <= 999);
  if (parsed.length < 2) {
    DOM.status.textContent = '⚠ Please enter at least 2 positive numbers.';
    return;
  }
  loadNewArray(parsed.slice(0, 60));
});

document.getElementById('customInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('btnLoad').click();
});

document.getElementById('sizeSlider').addEventListener('input', function () {
  document.getElementById('sizeDisplay').textContent = this.value;
});

document.getElementById('speedSlider').addEventListener('input', function () {
  document.getElementById('speedDisplay').textContent = this.value;
});

document.getElementById('btnStart').addEventListener('click', startEngine);
document.getElementById('btnPause').addEventListener('click', pauseEngine);
document.getElementById('btnStep').addEventListener('click',  stepEngine);
document.getElementById('btnReset').addEventListener('click', resetAll);


/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   10. INIT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
(function init() {
  const n   = +document.getElementById('sizeSlider').value;
  const arr = generateRandom(n);
  S.array     = arr;
  S.barStates = new Array(n).fill('default');
  renderBars(arr, S.barStates);
  updateStats();
  setButtonState({ start: true, pause: false, step: true, reset: true, random: true, load: true });
})();
