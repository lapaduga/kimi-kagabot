// main.js — холст, инструменты, рендер, звук, UI, игровой цикл
(function () {
  const KG = window.KG, C = KG.config, S = KG.sim;

  // ---------- холсты ----------
  const stage = document.getElementById('stage');
  const paper = document.getElementById('paper'), paint = document.getElementById('paint'), fx = document.getElementById('fx');
  const eatenC = document.createElement('canvas'), probe = document.createElement('canvas');
  const pctx = paper.getContext('2d'), actx = paint.getContext('2d'), fctx = fx.getContext('2d');
  const ectx = eatenC.getContext('2d'), prctx = probe.getContext('2d', { willReadFrequently: true });

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  paper.width = C.W * dpr; paper.height = C.H * dpr; pctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  fx.width = C.W * dpr; fx.height = C.H * dpr; fctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  paint.width = C.W; paint.height = C.H;          // 1:1 логические пиксели — getImageData без сюрпризов
  eatenC.width = C.W; eatenC.height = C.H;
  probe.width = C.cols; probe.height = C.rows;

  (function drawPaper() { // бумага в линейку (пре-рендер)
    pctx.fillStyle = '#fffdf6'; pctx.fillRect(0, 0, C.W, C.H);
    pctx.strokeStyle = 'rgba(110,155,215,0.35)'; pctx.lineWidth = 1;
    for (let y = 26; y < C.H; y += 26) { pctx.beginPath(); pctx.moveTo(0, y); pctx.lineTo(C.W, y); pctx.stroke(); }
    pctx.strokeStyle = 'rgba(230,120,120,0.45)';
    pctx.beginPath(); pctx.moveTo(84, 0); pctx.lineTo(84, C.H); pctx.stroke();
  })();

  // ---------- состояние ----------
  const grid = new KG.FoodGrid();
  let strokes = [], dirty = true, eatenTotal = 0, paintedTotal = 0;
  let tool = 'brush', color = '#e0342f', size = 8, alpha = 0.9;
  let bait = null, baitCharges = C.bait.charges, baitRegen = 0, baitArm = false;
  let cur = null, eraserPos = null, mousePos = { x: C.W / 2, y: 0 };
  const particles = [];
  const creature = new KG.Creature(C.W / 2, C.H);
  let records = { preserved: 0, meals: 0 };
  try { records = Object.assign(records, JSON.parse(localStorage.getItem('kg_records') || '{}')); } catch (e) {}

  // ---------- звук (только процедурный WebAudio, с выключателем) ----------
  const Audio2 = {
    ctx: null, on: true, master: null,
    ensure() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) { this.on = false; return; }
        this.ctx = new AC(); this.master = this.ctx.createGain();
        this.master.gain.value = 0.12; this.master.connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    },
    tone(f0, f1, dur, type, vol) {
      if (!this.on || !this.ctx) return;
      type = type || 'sine'; vol = vol || 1;
      const t = this.ctx.currentTime, o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
    },
    eat() { this.tone(300, 520, 0.09, 'square', 0.5); },
    jump() { this.tone(250, 620, 0.12, 'sine'); },
    thump() { this.tone(150, 60, 0.1, 'triangle'); },
    fear() { this.tone(900, 240, 0.25, 'sawtooth', 0.4); },
    bait() { this.tone(600, 920, 0.09, 'sine'); },
    meal() { this.tone(420, 640, 0.1, 'triangle'); this.tone(640, 860, 0.12, 'triangle'); },
    mutation() { const self = this; [440, 554, 659, 880].forEach((f, i) => setTimeout(() => self.tone(f, f, 0.14, 'triangle'), i * 95)); },
    snore() { this.tone(95, 70, 0.4, 'sine', 0.5); },
  };

  // ---------- инструменты ----------
  function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }

  function floodFill(ctx, x, y, rgb) { // заливка с tolerance, воспроизводима при перерисовке
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= C.W || y >= C.H) return;
    const img = ctx.getImageData(0, 0, C.W, C.H), d = img.data, W = C.W, H = C.H;
    const si = (y * W + x) * 4;
    const tr = d[si], tg = d[si + 1], tb = d[si + 2];
    const [fr, fg, fb] = rgb;
    if (Math.abs(tr - fr) < 6 && Math.abs(tg - fg) < 6 && Math.abs(tb - fb) < 6 && d[si + 3] > 250) return;
    const tol2 = 42 * 42;
    const match = (i) => { const dr = d[i] - tr, dg = d[i + 1] - tg, db = d[i + 2] - tb; return dr * dr + dg * dg + db * db < tol2; };
    const stack = [x, y];
    while (stack.length) {
      let cy = stack.pop(), cx = stack.pop();
      while (cx >= 0 && match((cy * W + cx) * 4)) cx--;
      cx++;
      let spanUp = false, spanDown = false;
      while (cx < W && match((cy * W + cx) * 4)) {
        const i = (cy * W + cx) * 4;
        d[i] = fr; d[i + 1] = fg; d[i + 2] = fb; d[i + 3] = 255;
        if (cy > 0) { const u = ((cy - 1) * W + cx) * 4; if (match(u)) { if (!spanUp) { stack.push(cx, cy - 1); spanUp = true; } } else spanUp = false; }
        if (cy < H - 1) { const dn = ((cy + 1) * W + cx) * 4; if (match(dn)) { if (!spanDown) { stack.push(cx, cy + 1); spanDown = true; } } else spanDown = false; }
        cx++;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  function drawSegment(ctx, st, a, b) {
    const [x0, y0] = a, [x1, y1] = b;
    if (st.tool === 'spray') {
      const steps = Math.max(1, Math.hypot(x1 - x0, y1 - y0) / 3 | 0);
      for (let i = 0; i <= steps; i++) {
        const x = x0 + (x1 - x0) * i / steps, y = y0 + (y1 - y0) * i / steps;
        for (let n = 0; n < 6; n++) {
          const ang = Math.random() * 6.283, rr = Math.random() * st.size * 0.6;
          ctx.fillStyle = st.color; ctx.globalAlpha = st.alpha * 0.35;
          ctx.beginPath(); ctx.arc(x + Math.cos(ang) * rr, y + Math.sin(ang) * rr, Math.max(0.6, st.size * 0.08), 0, 6.283); ctx.fill();
        }
      }
      ctx.globalAlpha = 1; return;
    }
    ctx.save();
    if (st.tool === 'eraser') ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = st.color;
    ctx.lineWidth = st.tool === 'marker' ? st.size * 1.8 : st.size;
    ctx.globalAlpha = st.tool === 'eraser' ? 1 : (st.tool === 'marker' ? Math.min(1, st.alpha + 0.15) : st.alpha);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.restore();
  }

  function applyStroke(ctx, st) { // детерминированное воспроизведение штриха (живое рисование = реплей)
    if (st.tool === 'fill') { floodFill(ctx, st.pts[0][0], st.pts[0][1], hexToRgb(st.color)); return; }
    if (st.tool === 'bait') {
      const [x, y] = st.pts[0];
      ctx.save(); ctx.fillStyle = '#d21f2c';
      ctx.beginPath(); ctx.arc(x, y, 15, 0, 6.283); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.beginPath(); ctx.arc(x - 4, y - 5, 4, 0, 6.283); ctx.fill();
      ctx.restore(); return;
    }
    for (let i = 1; i < st.pts.length; i++) drawSegment(ctx, st, st.pts[i - 1], st.pts[i]);
    if (st.pts.length === 1) drawSegment(ctx, st, st.pts[0], [st.pts[0][0] + 0.1, st.pts[0][1]]);
  }

  function repaintAll() { // Undo = отрезать штрих и перерисовать; съеденное бьётся маской поверх
    actx.clearRect(0, 0, C.W, C.H);
    for (const st of strokes) applyStroke(actx, st);
    actx.save(); actx.globalCompositeOperation = 'destination-out'; actx.drawImage(eatenC, 0, 0); actx.restore();
  }

  function resample() { // пробник 167×107 — дёшево, только при dirty
    prctx.clearRect(0, 0, C.cols, C.rows);
    prctx.drawImage(paint, 0, 0, C.cols, C.rows);
    grid.sampleFromImageData(prctx.getImageData(0, 0, C.cols, C.rows));
    paintedTotal = grid.painted;
  }

  // ---------- мир для существа ----------
  const world = {
    grid,
    get bait() { return bait; },
    get eraserPos() { return (cur && cur.tool === 'eraser') ? eraserPos : null; },
    bite(x, y) { // укус: дыра в маске eaten (НЕ откатывается Undo — он уже съел)
      const r = C.biteRadius * creature.mods().size;
      const before = grid.countPaintedAround(x, y, r);
      ectx.fillStyle = '#000'; ectx.beginPath(); ectx.arc(x, y, r, 0, 6.283); ectx.fill();
      repaintAll(); resample();
      const after = grid.countPaintedAround(x, y, r);
      eatenTotal += Math.max(0, before - after); // честная дельта (A14)
      const cx = Math.round(x / C.cell), cy = Math.round(y / C.cell);
      return (cx >= 0 && cy >= 0 && cx < C.cols && cy < C.rows) ? grid.value[cy * C.cols + cx] : 0;
    },
    consumeBait() {
      if (!bait) return;
      const i = strokes.indexOf(bait.stroke); if (i >= 0) strokes.splice(i, 1);
      bait.alive = false; bait = null;
      repaintAll(); dirty = true;
    },
    onBite(x, y) {
      Audio2.ensure(); Audio2.eat();
      for (let i = 0; i < 4; i++) particles.push({ type: 'crumb', x, y, vx: (Math.random() - .5) * 60, vy: -Math.random() * 60, life: 0.7 });
    },
    onAttempt(x, y, idx) {
      Audio2.jump();
      for (let i = 0; i < 5; i++) particles.push({ type: 'dust', x: x + (Math.random() - .5) * 20, y, vx: (Math.random() - .5) * 40, vy: -Math.random() * 30, life: 0.5 });
      if (creature.mods().doubleJump && idx >= 2) particles.push({ type: 'puff', x, y: y - 20, life: 0.4 });
    },
    onLand(c) {
      if (c.state === 'STANDOFF') { Audio2.thump(); particles.push({ type: 'star', x: c.x + c.facing * 12, y: c.y - 74 * c.mods().size, life: 0.7 }); }
      else particles.push({ type: 'dust', x: c.x, y: c.y, vx: 0, vy: -10, life: 0.3 });
    },
    onFear() { Audio2.fear(); },
    onMeal() { Audio2.meal(); },
    onMutation(m) { Audio2.mutation(); particles.push({ type: 'note', x: creature.x, y: creature.y - 90, vy: -20, life: 1.8, text: '✨ ' + m.name }); },
    onSnore(c) { Audio2.snore(); particles.push({ type: 'zzz', x: c.x + 20, y: c.y - 84 * c.mods().size, vy: -25, life: 1.6 }); },
    onSulkTear(c) { particles.push({ type: 'tear', x: c.x + c.facing * 16 * c.mods().size, y: c.y - 40 * c.mods().size, vx: c.facing * 10, vy: 20, life: 1 }); },
  };

  // ---------- ввод ----------
  function toWorld(e) { const r = stage.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * C.W, (e.clientY - r.top) / r.height * C.H]; }

  function placeBait(x, y) {
    if (baitCharges <= 0) return;
    baitArm = false; document.getElementById('bait').classList.remove('on');
    baitCharges--;
    const st = { tool: 'bait', color: '#d21f2c', size: 0, alpha: 1, pts: [[x, y]] };
    strokes.push(st); applyStroke(actx, st);
    bait = { x, y, alive: true, stroke: st };
    dirty = true; Audio2.ensure(); Audio2.bait();
  }

  paint.addEventListener('pointerdown', (e) => {
    e.preventDefault(); Audio2.ensure();
    try { paint.setPointerCapture(e.pointerId); } catch (err) {}
    const [x, y] = toWorld(e);
    if (baitArm) { placeBait(x, y); return; }
    if (tool === 'fill') {
      const st = { tool: 'fill', color, size: 0, alpha: 1, pts: [[x, y]] };
      applyStroke(actx, st); strokes.push(st); dirty = true; return;
    }
    cur = { tool, color, size, alpha, pts: [[x, y]] };
    applyStroke(actx, cur);
  });
  paint.addEventListener('pointermove', (e) => {
    const [x, y] = toWorld(e);
    mousePos = { x, y };
    if (cur && cur.tool === 'eraser') eraserPos = { x, y };
    if (!cur) return;
    const last = cur.pts[cur.pts.length - 1];
    if (Math.hypot(x - last[0], y - last[1]) < 1.5) return;
    cur.pts.push([x, y]); drawSegment(actx, cur, last, [x, y]);
  });
  function endStroke() { if (cur) { strokes.push(cur); cur = null; eraserPos = null; dirty = true; } }
  paint.addEventListener('pointerup', endStroke);
  paint.addEventListener('pointercancel', () => { cur = null; eraserPos = null; });
  stage.addEventListener('pointermove', (e) => { const [x, y] = toWorld(e); mousePos = { x, y }; });

  function undo() {
    const st = strokes.pop(); if (!st) return;
    if (bait && st === bait.stroke) { bait.alive = false; bait = null; }
    repaintAll(); dirty = true;
  }

  // ---------- частицы ----------
  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      p.x += (p.vx || 0) * dt; p.y += (p.vy || 0) * dt;
      if (p.type === 'tear' || p.type === 'crumb') p.vy = (p.vy || 0) + 500 * dt;
    }
  }
  function drawParticles() {
    for (const p of particles) {
      const a = Math.min(1, p.life * 2);
      if (p.type === 'dust') { fctx.fillStyle = 'rgba(120,110,100,' + a * 0.5 + ')'; fctx.beginPath(); fctx.arc(p.x, p.y, 3, 0, 6.283); fctx.fill(); }
      else if (p.type === 'puff') { fctx.fillStyle = 'rgba(255,255,255,' + a * 0.6 + ')'; fctx.beginPath(); fctx.arc(p.x, p.y, 8 + (0.4 - p.life) * 40, 0, 6.283); fctx.fill(); }
      else if (p.type === 'star') { fctx.fillStyle = 'rgba(255,210,60,' + a + ')'; fctx.font = '22px serif'; fctx.fillText('✶', p.x, p.y); }
      else if (p.type === 'zzz') { fctx.fillStyle = 'rgba(90,90,160,' + a + ')'; fctx.font = 'bold 18px serif'; fctx.fillText('z', p.x + Math.sin(p.life * 5) * 4, p.y); }
      else if (p.type === 'tear') { fctx.fillStyle = 'rgba(90,140,230,' + a + ')'; fctx.beginPath(); fctx.ellipse(p.x, p.y, 2.5, 4, 0, 0, 6.283); fctx.fill(); }
      else if (p.type === 'crumb') { fctx.fillStyle = 'rgba(140,130,120,' + a + ')'; fctx.fillRect(p.x, p.y, 3, 3); }
      else if (p.type === 'note') { fctx.fillStyle = 'rgba(60,60,80,' + a + ')'; fctx.font = 'bold 15px system-ui'; fctx.textAlign = 'center'; fctx.fillText(p.text, p.x, p.y); fctx.textAlign = 'left'; }
    }
  }

  // ---------- отрисовка Кагаботика (кипение линии 7 fps, конвенция doodle: всегда поверх краски) ----------
  const jit = { x: 0, y: 0, t: 0 };
  function drawCreature(t, dt) {
    jit.t -= dt;
    if (jit.t <= 0) { jit.t = 1 / 7; jit.x = (Math.random() - .5) * 2.4; jit.y = (Math.random() - .5) * 2.4; }
    const m = creature.mods(), s = m.size, r = 20 * s;
    const legH = (creature.mutationSet.has('longlegs') ? 24 : 13) * s;
    const x = creature.x, feetY = creature.y;
    const cy = feetY - legH - r * 0.9 + jit.y;
    const walking = (creature.state === 'SEEK' && creature.target) || creature.state === 'FLEE';
    const look = creature.target ? creature.target : mousePos;

    fctx.fillStyle = 'rgba(0,0,0,0.12)';
    fctx.beginPath(); fctx.ellipse(x, feetY + 3, r * 0.9, 4 * s, 0, 0, 6.283); fctx.fill();

    fctx.save();
    fctx.translate(x + jit.x, jit.y);
    if (creature.facing < 0) fctx.scale(-1, 1);

    if (creature.mutationSet.has('glow')) {
      const g = fctx.createRadialGradient(0, cy, r * 0.5, 0, cy, r * 2.6);
      g.addColorStop(0, 'rgba(255,240,150,0.35)'); g.addColorStop(1, 'rgba(255,240,150,0)');
      fctx.fillStyle = g; fctx.beginPath(); fctx.arc(0, cy, r * 2.6, 0, 6.283); fctx.fill();
    }

    fctx.strokeStyle = '#26221f'; fctx.lineWidth = 3.2 * s; fctx.lineCap = 'round';
    const ph = walking ? Math.sin(creature.walkPhase) * 5 * s : 0;
    fctx.beginPath();
    fctx.moveTo(-5 * s, cy + r * 0.55); fctx.lineTo(-7 * s + ph, feetY - jit.y);
    fctx.moveTo(6 * s, cy + r * 0.55); fctx.lineTo(8 * s - ph, feetY - jit.y);
    fctx.stroke();

    fctx.fillStyle = '#fffefa'; fctx.strokeStyle = '#211d1a'; fctx.lineWidth = 2.4;
    fctx.beginPath(); fctx.ellipse(0, cy, r * 1.05, r * 0.82, -0.12, 0, 6.283); fctx.fill(); fctx.stroke();
    fctx.beginPath(); fctx.moveTo(-r * 1.0, cy + r * 0.1); // хвостик
    fctx.quadraticCurveTo(-r * 1.55, cy - r * 0.2, -r * 1.4, cy - r * 0.75); fctx.stroke();

    if (creature.mutationSet.has('spots')) {
      fctx.fillStyle = 'rgba(60,55,50,0.5)';
      [[-0.4, -0.2, 0.22], [0.1, 0.25, 0.16], [-0.15, 0.35, 0.13]].forEach((q) => {
        fctx.beginPath(); fctx.ellipse(q[0] * r, cy + q[1] * r, q[2] * r, q[2] * r * 0.8, 0.5, 0, 6.283); fctx.fill();
      });
    }
    if (creature.mutationSet.has('horns')) {
      fctx.strokeStyle = '#211d1a'; fctx.lineWidth = 3 * s;
      fctx.beginPath(); fctx.moveTo(r * 0.35, cy - r * 0.72); fctx.lineTo(r * 0.5, cy - r * 1.35); fctx.stroke();
      fctx.beginPath(); fctx.moveTo(r * 0.7, cy - r * 0.58); fctx.lineTo(r * 0.98, cy - r * 1.12); fctx.stroke();
    }

    // глаза (голова = +x)
    const eyeR = (creature.state === 'FEAR' ? 8.5 : 6.5) * s;
    const eyes = [[r * 0.42, cy - r * 0.32], [r * 0.72, cy - r * 0.05]];
    const asleep = creature.state === 'SLEEP';
    const la = Math.atan2(look.y - cy, (look.x - creature.x) * creature.facing);
    for (const e of eyes) {
      const ex = e[0], ey = e[1];
      if (asleep) {
        fctx.strokeStyle = '#211d1a'; fctx.lineWidth = 2;
        fctx.beginPath(); fctx.arc(ex, ey, eyeR * 0.8, 0.15 * Math.PI, 0.85 * Math.PI); fctx.stroke();
        continue;
      }
      fctx.fillStyle = '#fff'; fctx.beginPath(); fctx.arc(ex, ey, eyeR, 0, 6.283); fctx.fill();
      fctx.strokeStyle = '#211d1a'; fctx.lineWidth = 1.6; fctx.stroke();
      if (creature.blink <= 0 && creature.state !== 'FEAR') {
        fctx.beginPath(); fctx.moveTo(ex - eyeR, ey); fctx.lineTo(ex + eyeR, ey); fctx.stroke();
      } else {
        const pr = (creature.state === 'FEAR' ? 0.28 : 0.45) * eyeR;
        fctx.fillStyle = '#1a1714';
        fctx.beginPath(); fctx.arc(ex + Math.cos(la) * eyeR * 0.42, ey + Math.sin(la) * eyeR * 0.42, pr, 0, 6.283); fctx.fill();
      }
    }

    // рот
    const mx = r * 0.5, my = cy + r * 0.4;
    fctx.strokeStyle = '#211d1a'; fctx.lineWidth = 2;
    if (creature.state === 'EAT') {
      fctx.fillStyle = '#5a2a2a';
      fctx.beginPath(); fctx.ellipse(mx, my, 5 * s, (3 + Math.sin(t * 22) * 1.6) * s, 0, 0, 6.283); fctx.fill();
    } else if (creature.state === 'SULK') {
      fctx.beginPath(); fctx.arc(mx, my + 4 * s, 5 * s, 1.15 * Math.PI, 1.85 * Math.PI); fctx.stroke();
    } else if (creature.state === 'STANDOFF') {
      fctx.beginPath(); fctx.moveTo(mx - 5 * s, my); fctx.lineTo(mx + 5 * s, my); fctx.stroke();
    } else if (asleep) {
      fctx.beginPath(); fctx.arc(mx, my, 2.4 * s, 0, 6.283); fctx.stroke();
    } else {
      fctx.beginPath(); fctx.arc(mx - 2 * s, my - 2 * s, 5 * s, 0.2 * Math.PI, 0.85 * Math.PI); fctx.stroke();
    }

    // мысле-пузырь «!» при стендовере
    if (creature.state === 'STANDOFF') {
      const bx = r * 1.7, by = cy - r * 1.5;
      fctx.fillStyle = '#fff'; fctx.strokeStyle = '#211d1a'; fctx.lineWidth = 1.6;
      roundRect(fctx, bx - 9, by - 13, 26, 24, 7); fctx.fill(); fctx.stroke();
      fctx.beginPath(); fctx.moveTo(bx - 2, by + 11); fctx.lineTo(bx - 8, by + 18); fctx.stroke();
      fctx.fillStyle = '#211d1a'; fctx.font = 'bold 15px system-ui';
      fctx.fillText('!', bx - 2, by + 5);
    }
    fctx.restore();

    // линейка досягаемости (A7): пунктир + честные числа + подсказка
    if (creature.state === 'STANDOFF' && creature.debugReach && creature.target) {
      const dr = creature.debugReach;
      const headY = cy - r * 1.1;
      const ty = Math.max(10, creature.target.y);
      const lx = x + creature.facing * (r * 1.4 + 16);
      fctx.save();
      fctx.setLineDash([5, 5]); fctx.strokeStyle = 'rgba(40,40,60,0.7)'; fctx.lineWidth = 1.5;
      fctx.beginPath(); fctx.moveTo(lx, headY); fctx.lineTo(lx, ty); fctx.stroke();
      fctx.beginPath(); fctx.moveTo(lx, ty); fctx.lineTo(creature.target.x, ty); fctx.stroke();
      fctx.setLineDash([]);
      const ly = Math.max(24, (headY + ty) / 2);
      fctx.fillStyle = 'rgba(40,40,60,0.92)'; fctx.font = '12px system-ui';
      fctx.fillText('нужно ' + dr.need + ' / хватает ' + dr.can + (dr.short > 0 ? ' · не хватает ' + dr.short : ''), lx + 6, ly);
      fctx.font = '11px system-ui'; fctx.fillStyle = 'rgba(140,60,60,0.9)';
      fctx.fillText('нарисуй ступеньку ⤴', lx + 6, ly + 14);
      fctx.restore();
    }

    // банка для «Усыпить» (A13)
    if (creature.jarred) {
      const jw = r * 2.1, jh = legH + r * 2.1, jx = x - jw, jy = feetY - jh;
      fctx.save();
      fctx.fillStyle = 'rgba(180,210,255,0.18)'; fctx.strokeStyle = 'rgba(90,120,170,0.8)'; fctx.lineWidth = 2.5;
      roundRect(fctx, jx, jy, jw * 2, jh, 10); fctx.fill(); fctx.stroke();
      fctx.fillStyle = 'rgba(120,120,130,0.9)';
      roundRect(fctx, jx - 5, jy - 9, jw * 2 + 10, 10, 4); fctx.fill();
      fctx.restore();
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawScene(t, dt) {
    fctx.clearRect(0, 0, C.W, C.H);
    if (bait && bait.alive) {
      fctx.strokeStyle = 'rgba(210,31,44,0.7)'; fctx.lineWidth = 2; fctx.setLineDash([4, 4]);
      fctx.beginPath(); fctx.arc(bait.x, bait.y, 18 + Math.sin(t * 5) * 4, 0, 6.283); fctx.stroke();
      fctx.setLineDash([]);
    }
    drawCreature(t, dt);
    drawParticles();
  }

  // ---------- панель ----------
  const metEl = document.getElementById('metrics');
  const STATE_NAMES = { IDLE: 'бродит', SEEK: 'охотится 🎯', EAT: 'ест!', SLEEP: 'спит 💤', STANDOFF: 'планирует прыжок', SULK: 'обижается', FEAR: 'в ужасе!', FLEE: 'убегает!' };
  function preserved() { return paintedTotal > 0 ? Math.max(0, Math.round((paintedTotal - eatenTotal) / paintedTotal * 100)) : 100; }
  function updatePanel() {
    const p = preserved();
    if (p > records.preserved || creature.meals > records.meals) {
      records.preserved = Math.max(records.preserved, p);
      records.meals = Math.max(records.meals, creature.meals);
      try { localStorage.setItem('kg_records', JSON.stringify(records)); } catch (e) {}
    }
    const muts = C.mutations.filter((mm) => creature.mutationSet.has(mm.id)).map((mm) => mm.name).join(', ') || '—';
    metEl.innerHTML =
      'Сохранность красок: <b>' + p + '%</b> (рекорд ' + records.preserved + '%)<br>' +
      'Обедов: <b>' + creature.meals + '</b> (рекорд ' + records.meals + ')<br>' +
      'Мутации: ' + muts + '<br>' +
      'Кагаботик: ' + (STATE_NAMES[creature.state] || creature.state);
    document.getElementById('baitN').textContent = baitCharges;
  }

  // ---------- UI ----------
  const PALETTE = [
    ['#e0342f', 'красный — очень вкусно'], ['#d63384', 'маджента — вкусно'], ['#a3e635', 'лайм — вкусно'],
    ['#2563eb', 'синий — съедобно'], ['#f59e0b', 'оранжевый — съедобно'], ['#10b981', 'зелёный — съедобно'],
    ['#8b5a2b', 'коричневый — так себе'], ['#808080', 'графит — НЕ еда (безопасно!)'],
    ['#202020', 'чёрный — не еда'], ['#ffffff', 'белый — не еда'],
  ];
  const colorsEl = document.getElementById('colors');
  PALETTE.forEach((p, i) => {
    const d = document.createElement('div');
    d.className = 'sw' + (i === 0 ? ' on' : '');
    d.style.background = p[0]; d.title = p[1];
    d.onclick = () => {
      color = p[0];
      colorsEl.querySelectorAll('.sw').forEach((el) => el.classList.remove('on'));
      d.classList.add('on');
    };
    colorsEl.appendChild(d);
  });

  document.querySelectorAll('[data-tool]').forEach((b) => {
    b.onclick = () => {
      tool = b.dataset.tool; eraserPos = null; baitArm = false;
      document.getElementById('bait').classList.remove('on');
      document.querySelectorAll('[data-tool]').forEach((el) => el.classList.toggle('on', el === b));
    };
  });
  document.getElementById('size').oninput = (e) => size = +e.target.value;
  document.getElementById('alpha').oninput = (e) => alpha = +e.target.value / 100;
  document.getElementById('undo').onclick = undo;

  const baitBtn = document.getElementById('bait');
  baitBtn.onclick = () => {
    if (baitCharges <= 0) return;
    baitArm = !baitArm; baitBtn.classList.toggle('on', baitArm);
  };

  const sleepBtn = document.getElementById('sleep');
  sleepBtn.onclick = () => {
    if (creature.jarred) {
      creature.jarred = false;
      if (creature.state === 'SLEEP') { creature.belly = 0; creature.hunger = 0.05; creature.state = 'IDLE'; creature.stateTime = 0; }
      sleepBtn.textContent = '😴 Усыпить';
    } else {
      creature.jarred = true; creature.state = 'SLEEP'; creature.stateTime = 0;
      creature.belly = Math.max(creature.belly, 0.6); creature.target = null;
      sleepBtn.textContent = '🔔 Разбудить';
    }
  };

  const soundBtn = document.getElementById('sound');
  soundBtn.onclick = () => {
    Audio2.on = !Audio2.on;
    if (Audio2.on) Audio2.ensure();
    soundBtn.textContent = Audio2.on ? '🔊 Звук' : '🔇 Звук';
  };

  document.getElementById('save').onclick = () => {
    const tmp = document.createElement('canvas'); tmp.width = C.W; tmp.height = C.H;
    const tctx = tmp.getContext('2d');
    tctx.drawImage(paper, 0, 0, C.W, C.H);
    tctx.drawImage(paint, 0, 0);
    tctx.drawImage(fx, 0, 0, C.W, C.H);
    const a = document.createElement('a');
    a.download = 'kagabotik.png'; a.href = tmp.toDataURL('image/png'); a.click();
  };

  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
    else if (e.key.toLowerCase() === 'b') baitBtn.onclick();
    else if (e.key.toLowerCase() === 's') sleepBtn.onclick();
  });

  // ---------- цикл ----------
  let last = performance.now(), panelT = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    creature.update(dt, world);
    if (dirty) { resample(); dirty = false; }
    if (baitCharges < C.bait.charges) { baitRegen += dt; if (baitRegen >= C.bait.regen) { baitRegen = 0; baitCharges++; } }
    updateParticles(dt);
    drawScene(now / 1000, dt);
    panelT += dt; if (panelT > 0.25) { panelT = 0; updatePanel(); }
    requestAnimationFrame(frame);
  }
  resample(); updatePanel();
  requestAnimationFrame(frame);
})();
