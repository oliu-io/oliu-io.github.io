/* ============================================
   Fig. 1 — a live grid-world.

   Dots are states; dot size is the value V(s) = γ^d(s, goal). When a goal appears,
   its values ripple outward one cell per tick, like
   value iteration.

   The agent (orange) carries its own sense of the
   world around it:
     · whiskers — Q(s, a) for each of its four moves,
       longest for the action it is about to take
     · aura — intrinsic reward 1/√(1 + N(s)) for nearby
       states, a count-based curiosity bonus that fades
       where it has already been

   With no goal, or before the value reaches it, the
   agent wanders by curiosity. Once value arrives it
   follows Q to the goal, rests, and wanders again.
   Hovering (or tapping) sets the goal.
   ============================================ */

(function () {
  "use strict";

  var canvas = document.getElementById("gridworld");
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext("2d");

  var CELL = 19;          // target spacing between dots, px
  var PAD = 10;           // margin around the outer dots, px
  var GAMMA = 0.9;        // discount: how fast value falls off with distance
  var STEP_MS = 165;      // time for the agent to move one cell
  var WAVE_MS = 24;       // time for value to propagate one cell
  var WALL_DENSITY = 0.07;
  var CURIOSITY = 0.05;   // weight of intrinsic reward once value has arrived
  var VISIT_DECAY = 0.995; // visit counts fade, so novelty slowly returns
  var AURA_RADIUS = 3.2;  // how far the agent "senses", in cells
  var EXPLORE_STEPS = [10, 18]; // wandering time between goals, in steps

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var W, H, cols, rows, sx, sy;
  var open;     // Uint8Array: 1 = open cell, 0 = wall
  var dist;     // Int16Array: BFS distance to goal, -1 if unreachable
  var shown;    // Float32Array: value currently drawn (eases toward target)
  var visits;   // Float32Array: decaying visit counts N(s)
  var goal = -1, agent, prev, stepStart, waveStart, restUntil = 0, exploreLeft = 0;
  var trail = [];
  var pointerActive = false;
  var colors = {};
  var running = false, visible = true;

  // The aura: one pixel per cell, smoothed as it is scaled up
  var auraLayer = makeLayer();

  function makeLayer() {
    var c = document.createElement("canvas");
    return { canvas: c, ctx: c.getContext("2d"), img: null };
  }

  /* ---------- Grid ---------- */

  function idx(c, r) { return r * cols + c; }
  function cx(i) { return PAD + (i % cols) * sx; }
  function cy(i) { return PAD + Math.floor(i / cols) * sy; }

  function neighbors(i) {
    var c = i % cols, r = Math.floor(i / cols), out = [];
    if (c > 0) out.push(i - 1);
    if (c < cols - 1) out.push(i + 1);
    if (r > 0) out.push(i - cols);
    if (r < rows - 1) out.push(i + cols);
    return out;
  }

  function moves(i) {
    return neighbors(i).filter(function (j) { return open[j]; });
  }

  function bfs(from) {
    var d = new Int16Array(cols * rows).fill(-1);
    var queue = [from], head = 0;
    d[from] = 0;
    while (head < queue.length) {
      var i = queue[head++];
      neighbors(i).forEach(function (j) {
        if (open[j] && d[j] === -1) {
          d[j] = d[i] + 1;
          queue.push(j);
        }
      });
    }
    return d;
  }

  function randomOpen(filter) {
    var candidates = [];
    for (var i = 0; i < open.length; i++) {
      if (open[i] && (!filter || filter(i))) candidates.push(i);
    }
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  function farFromAgent() {
    var d = bfs(agent);
    return randomOpen(function (i) { return d[i] > Math.max(6, cols * 0.3); }) || randomOpen();
  }

  /** Random short wall segments; sealed-off pockets are filled in. */
  function buildWalls() {
    open = new Uint8Array(cols * rows).fill(1);
    var target = Math.floor(cols * rows * WALL_DENSITY);
    var placed = 0, guard = 0;
    while (placed < target && guard++ < 500) {
      var vertical = Math.random() < 0.6;
      var len = 2 + Math.floor(Math.random() * 3);
      var c = Math.floor(Math.random() * cols);
      var r = Math.floor(Math.random() * rows);
      for (var k = 0; k < len; k++) {
        var cc = vertical ? c : c + k, rr = vertical ? r + k : r;
        if (cc >= cols || rr >= rows) break;
        if (open[idx(cc, rr)]) { open[idx(cc, rr)] = 0; placed++; }
      }
    }
    // Keep only the largest connected region open
    var best = null;
    var seen = new Uint8Array(cols * rows);
    for (var i = 0; i < open.length; i++) {
      if (!open[i] || seen[i]) continue;
      var d = bfs(i), region = [];
      for (var j = 0; j < d.length; j++) if (d[j] >= 0) { seen[j] = 1; region.push(j); }
      if (!best || region.length > best.length) best = region;
    }
    var keep = new Uint8Array(cols * rows);
    best.forEach(function (j) { keep[j] = 1; });
    open = keep;
  }

  /* ---------- Values ---------- */

  function setGoal(i) {
    goal = i;
    dist = bfs(goal);
    waveStart = performance.now();
    restUntil = 0;
    if (reduceMotion) {
      for (var k = 0; k < shown.length; k++) shown[k] = value(k);
      trail = pathFrom(agent);
      draw(performance.now());
    }
  }

  /** Extrinsic value V(s) = γ^d(s, goal); zero when there is no goal. */
  function value(i) {
    return goal >= 0 && dist[i] >= 0 ? Math.pow(GAMMA, dist[i]) : 0;
  }

  /** Intrinsic reward: a count-based novelty bonus. */
  function curiosity(i) {
    return 1 / Math.sqrt(1 + visits[i]);
  }

  /** Has the value wave reached cell i yet? */
  function reached(i, t) {
    return goal >= 0 && dist[i] >= 0 && t - waveStart >= dist[i] * WAVE_MS;
  }

  /**
   * Q(s, a) for each move from s. Once value has arrived, Q is the
   * discounted value of the next state plus a small curiosity bonus
   * (which only breaks ties between equally short paths). Before
   * that, the agent has nothing to go on but curiosity.
   */
  function qValues(s, t) {
    var informed = reached(s, t);
    return moves(s).map(function (to) {
      var q = informed
        ? value(to) + CURIOSITY * value(s) * curiosity(to)
        : curiosity(to);
      return { to: to, q: q };
    });
  }

  function chooseMove(s, t) {
    var qs = qValues(s, t);
    if (!qs.length) return s;
    var exploring = !reached(s, t);
    var best = null, bestScore = -Infinity;
    qs.forEach(function (a) {
      // A little noise keeps wandering from looking mechanical
      var score = a.q + (exploring ? 0.25 : 1e-6) * Math.random();
      if (score > bestScore) { bestScore = score; best = a.to; }
    });
    return best;
  }

  /** Shortest path to the goal (used for the static, reduced-motion frame). */
  function pathFrom(i) {
    var path = [i];
    while (dist[i] > 0) {
      var next = moves(i).filter(function (j) { return dist[j] === dist[i] - 1; })[0];
      if (next === undefined) break;
      path.push(i = next);
    }
    return path;
  }

  function setup() {
    var rect = canvas.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    W = rect.width;
    H = rect.height;
    // Bail on empty or runaway sizes (e.g. the stylesheet failed to load)
    if (!W || !H || W > 4096 || H > 1024) return;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    var nextCols = Math.max(4, Math.round((W - 2 * PAD) / CELL) + 1);
    var nextRows = Math.max(3, Math.round((H - 2 * PAD) / CELL) + 1);
    sx = (W - 2 * PAD) / (nextCols - 1);
    sy = (H - 2 * PAD) / (nextRows - 1);

    // Only rebuild the world when the grid shape changes
    if (nextCols !== cols || nextRows !== rows) {
      cols = nextCols;
      rows = nextRows;
      buildWalls();
      shown = new Float32Array(cols * rows);
      visits = new Float32Array(cols * rows);
      auraLayer.canvas.width = cols;
      auraLayer.canvas.height = rows;
      auraLayer.img = auraLayer.ctx.createImageData(cols, rows);
      agent = prev = randomOpen(function (i) { return i % cols < cols * 0.25; });
      trail = [agent];
      stepStart = performance.now();
      goal = -1;
      exploreLeft = 8;   // wander briefly before the first goal appears
      if (reduceMotion) setGoal(farFromAgent());
    }
    if (!running) draw(performance.now());
  }

  /* ---------- Simulation ---------- */

  function update(t) {
    if (!shown) return;
    for (var i = 0; i < shown.length; i++) {
      if (goal < 0) shown[i] *= 0.965;   // no goal: value fades out
      else if (reached(i, t)) shown[i] += (value(i) - shown[i]) * 0.16;
    }

    if (t - stepStart < STEP_MS) return;
    prev = agent;
    stepStart = t;

    for (var k = 0; k < visits.length; k++) visits[k] *= VISIT_DECAY;
    visits[agent] += 1;

    if (goal >= 0 && agent === goal) {
      if (pointerActive) return;
      if (!restUntil) restUntil = t + 700;
      if (t < restUntil) return;
      // Goal reached: let go of it and wander for a while
      goal = -1;
      restUntil = 0;
      exploreLeft = EXPLORE_STEPS[0] +
        Math.floor(Math.random() * (EXPLORE_STEPS[1] - EXPLORE_STEPS[0]));
    }
    if (goal < 0 && exploreLeft-- <= 0) setGoal(farFromAgent());

    agent = chooseMove(agent, t);
    if (agent !== prev) {
      trail.push(agent);
      if (trail.length > 16) trail.shift();
    }
  }

  /* ---------- Drawing ---------- */

  function readColors() {
    var s = getComputedStyle(document.documentElement);
    colors.ink = s.getPropertyValue("--ink").trim() || "#161615";
    colors.faint = s.getPropertyValue("--ink-3").trim() || "#8f8d86";
    colors.accent = s.getPropertyValue("--accent").trim() || "#ff4f00";
    colors.accentRgb = hexToRgb(colors.accent) || [255, 79, 0];
  }

  function hexToRgb(hex) {
    var m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
    return m && [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
  }

  function dot(x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  /** Fill a one-pixel-per-cell layer with alpha(i), then draw it smoothed. */
  function paintLayer(layer, rgb, alpha) {
    var px = layer.img.data;
    for (var i = 0; i < open.length; i++) {
      px[i * 4] = rgb[0];
      px[i * 4 + 1] = rgb[1];
      px[i * 4 + 2] = rgb[2];
      px[i * 4 + 3] = open[i] ? Math.round(255 * Math.min(1, alpha(i))) : 0;
    }
    layer.ctx.putImageData(layer.img, 0, 0);
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(layer.canvas, PAD - sx / 2, PAD - sy / 2, cols * sx, rows * sy);
  }

  /** Soften the aura where it meets the canvas edge (dots are drawn after). */
  function fadeEdges() {
    var e = PAD + 4;
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.globalAlpha = 1;
    [[0, 0, e, 0, 0, 0, e, H], [W, 0, W - e, 0, W - e, 0, e, H],
     [0, 0, 0, e, 0, 0, W, e], [0, H, 0, H - e, 0, H - e, W, e]].forEach(function (g) {
      var grad = ctx.createLinearGradient(g[0], g[1], g[2], g[3]);
      grad.addColorStop(0, "rgba(0,0,0,1)");
      grad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(g[4], g[5], g[6], g[7]);
    });
    ctx.restore();
  }

  function draw(t) {
    if (!shown) return;
    ctx.clearRect(0, 0, W, H);

    // Agent position, eased between cells
    var p = reduceMotion ? 1 : Math.min(1, (t - stepStart) / STEP_MS);
    p = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
    var ax = cx(prev) + (cx(agent) - cx(prev)) * p;
    var ay = cy(prev) + (cy(agent) - cy(prev)) * p;
    var ac = (ax - PAD) / sx, ar = (ay - PAD) / sy;   // in cell units

    // Intrinsic reward the agent senses nearby: an orange aura
    paintLayer(auraLayer, colors.accentRgb, function (i) {
      var d = Math.hypot(i % cols - ac, Math.floor(i / cols) - ar);
      var f = Math.max(0, 1 - d / AURA_RADIUS);
      return 0.5 * curiosity(i) * Math.pow(f, 1.3);
    });
    fadeEdges();

    // Walls: short strokes joining neighboring wall cells
    ctx.strokeStyle = colors.faint;
    ctx.fillStyle = colors.faint;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    for (var i = 0; i < open.length; i++) {
      if (open[i]) continue;
      var c = i % cols, r = Math.floor(i / cols);
      ctx.moveTo(cx(i) + 1.5, cy(i));
      ctx.arc(cx(i), cy(i), 1.5, 0, Math.PI * 2);
      if (c < cols - 1 && !open[i + 1]) { ctx.moveTo(cx(i), cy(i)); ctx.lineTo(cx(i + 1), cy(i + 1)); }
      if (r < rows - 1 && !open[i + cols]) { ctx.moveTo(cx(i), cy(i)); ctx.lineTo(cx(i + cols), cy(i + cols)); }
    }
    ctx.stroke();

    // Value field
    ctx.fillStyle = colors.ink;
    for (var j = 0; j < open.length; j++) {
      if (!open[j]) continue;
      var v = shown[j];
      ctx.globalAlpha = 0.2 + 0.8 * v;
      dot(cx(j), cy(j), 0.85 + 3.15 * v);
    }

    // Wavefront: a brief flash as new values arrive
    if (goal >= 0 && !reduceMotion) {
      ctx.fillStyle = colors.ink;
      for (var k = 0; k < open.length; k++) {
        if (dist[k] < 0) continue;
        var e = t - waveStart - dist[k] * WAVE_MS;
        if (e < 0 || e > 280) continue;
        ctx.globalAlpha = 0.35 * (1 - e / 280);
        dot(cx(k), cy(k), 1.2 + 3.15 * value(k));
      }
    }

    // Trail
    ctx.strokeStyle = colors.accent;
    ctx.lineWidth = 1.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (reduceMotion) ctx.setLineDash([2, 4]);
    var pts = trail.slice(0, reduceMotion ? trail.length : -1).map(function (i) { return [cx(i), cy(i)]; });
    if (!reduceMotion) pts.push([ax, ay]);
    for (var s = 1; s < pts.length; s++) {
      ctx.globalAlpha = reduceMotion ? 0.8 : 0.85 * (s / pts.length);
      ctx.beginPath();
      ctx.moveTo(pts[s - 1][0], pts[s - 1][1]);
      ctx.lineTo(pts[s][0], pts[s][1]);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Goal ring
    if (goal >= 0) {
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx(goal), cy(goal), 7.5 + (reduceMotion ? 0 : Math.sin(t / 380) * 0.8), 0, Math.PI * 2);
      ctx.stroke();
    }

    // Q whiskers: one per move, longer and bolder for higher Q
    var qs = qValues(agent, t);
    var qMin = Infinity, qMax = -Infinity;
    qs.forEach(function (a) { qMin = Math.min(qMin, a.q); qMax = Math.max(qMax, a.q); });
    qs.forEach(function (a) {
      var n = qMax - qMin > 1e-9 ? (a.q - qMin) / (qMax - qMin) : 0.5;
      var dx = Math.sign(cx(a.to) - cx(agent)), dy = Math.sign(cy(a.to) - cy(agent));
      var r0 = 7.5, r1 = r0 + 2.5 + 6.5 * n;
      ctx.globalAlpha = 0.3 + 0.7 * n;
      ctx.lineWidth = n === 1 ? 2 : 1.5;
      ctx.beginPath();
      ctx.moveTo(ax + dx * r0, ay + dy * r0);
      ctx.lineTo(ax + dx * r1, ay + dy * r1);
      ctx.stroke();
    });

    // Agent
    ctx.globalAlpha = 1;
    ctx.fillStyle = colors.accent;
    dot(ax, ay, 4.75);
  }

  /* ---------- Loop & events ---------- */

  function frame(t) {
    if (!running) return;
    update(t);
    draw(t);
    requestAnimationFrame(frame);
  }

  function syncRunning() {
    var should = !reduceMotion && visible && !document.hidden;
    if (should && !running) {
      running = true;
      requestAnimationFrame(frame);
    } else if (!should) {
      running = false;
    }
  }

  function cellAt(evt) {
    var rect = canvas.getBoundingClientRect();
    var c = Math.round((evt.clientX - rect.left - PAD) / sx);
    var r = Math.round((evt.clientY - rect.top - PAD) / sy);
    if (c < 0 || r < 0 || c >= cols || r >= rows) return -1;
    return idx(c, r);
  }

  function moveGoal(evt) {
    var i = cellAt(evt);
    if (i >= 0 && open[i] && i !== goal) setGoal(i);
  }

  canvas.addEventListener("pointermove", function (evt) {
    if (evt.pointerType !== "mouse") return;
    pointerActive = true;
    moveGoal(evt);
  });
  canvas.addEventListener("pointerleave", function () { pointerActive = false; });
  canvas.addEventListener("pointerdown", moveGoal);

  readColors();
  new MutationObserver(function () {
    readColors();
    if (!running) draw(performance.now());
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () {
    readColors();
    if (!running) draw(performance.now());
  });

  if ("ResizeObserver" in window) new ResizeObserver(setup).observe(canvas);
  else window.addEventListener("resize", setup);
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (entries) {
      visible = entries[0].isIntersecting;
      syncRunning();
    }).observe(canvas);
  }
  document.addEventListener("visibilitychange", syncRunning);

  setup();
  syncRunning();
})();
