// kagabotik.js — физика, конечный автомат, мутации. Без DOM: рисование в main.js.
// FSM: IDLE →(голод>seekAt) SEEK →(цель в зубах) EAT →(сыт) SLEEP →(проснулся) IDLE
//                    └─цель выше досягаемости→ STANDOFF (JUMP×N) → SULK ─(ступенька?)→ SEEK
(function () {
  const KG = (typeof window !== 'undefined') ? (window.KG = window.KG || {}) : (globalThis.KG = globalThis.KG || {});
  const C = () => KG.config;
  const S = () => KG.sim;

  class Creature {
    constructor(x, y) {
      this.x = x; this.y = y;             // y — «ступни» (низ тела)
      this.vy = 0; this.grounded = true;
      this.facing = 1;
      this.state = 'IDLE'; this.stateTime = 0;
      this.hunger = 0.6; this.belly = 0; this.meals = 0;
      this.mutationSet = new Set();
      this.target = null;
      this.attemptIdx = 0; this.lastAttemptAt = -9;
      this.wanderDir = 1; this.wanderTimer = 0;
      this.fearTimer = 0; this.fleeTimer = 0; this.fearCooldown = 0; this.fleeDir = 1;
      this.biteTimer = 0; this.sulkChecked = 0;
      this.debugReach = null;             // для линейки «нужно/хватает» (A7)
      this.jarred = false;                // «Усыпить» — спит в банке
      this.blink = 2;
      this.walkPhase = 0;
      this.lost = false;
    }

    mods() { // мутации → механические модификаторы (A10)
      const m = { speed: 1, jump: 0, chew: 1, absorb: 1, sight: 1, size: 1, maneuver: 1, doubleJump: false, neverLost: false };
      for (const mut of C().mutations) {
        if (!this.mutationSet.has(mut.id)) continue;
        if (mut.speed) m.speed *= mut.speed;
        if (mut.jump) m.jump += mut.jump;
        if (mut.chew) m.chew *= mut.chew;
        if (mut.absorb) m.absorb *= mut.absorb;
        if (mut.sight) m.sight *= mut.sight;
        if (mut.size) { m.size *= mut.size; m.maneuver *= mut.maneuver || 1; }
        if (mut.doubleJump) m.doubleJump = true;
        if (mut.neverLost) m.neverLost = true;
      }
      return m;
    }

    applyMutations(world) {
      for (const mut of C().mutations) {
        if (this.meals >= mut.meals && !this.mutationSet.has(mut.id)) {
          this.mutationSet.add(mut.id);
          if (world && world.onMutation) world.onMutation(mut);
        }
      }
    }

    reachOf(m, desperation) {
      return S().reachTotal(C(), desperation, { doubleJump: m.doubleJump, sizeMul: m.size }) + m.jump;
    }

    retarget(world) {
      this.debugReach = null;
      const m = this.mods();
      if (world.bait && world.bait.alive) { this.target = { x: world.bait.x, y: world.bait.y, v: 1, isBait: true }; return; }
      this.target = world.grid.bestTarget(this.x, C().sight * m.sight);
      this.lost = !this.target && !m.neverLost;
    }

    targetStillValid(world) { // цель жива, если жива верхушка её колонки
      if (!this.target) return false;
      if (this.target.isBait) return !!(world.bait && world.bait.alive);
      const g = world.grid, c = C();
      const cx = S().clamp(Math.round(this.target.x / c.cell), 0, c.cols - 1);
      const cy = S().clamp(Math.round(g.surfY[cx] / c.cell), 0, c.rows - 1);
      return g.value[cy * c.cols + cx] > 0.04;
    }

    applyGravity(world, dt) {
      const c = C();
      this.x = S().clamp(this.x, 16, c.W - 16);
      const sup = world.grid.supportAt(this.x);
      if (!this.grounded || sup > this.y) { // в воздухе или под ногами провал
        this.vy += c.gravity * dt;
        this.y += this.vy * dt;
        if (this.y >= sup && this.vy >= 0) {
          this.y = sup; this.vy = 0; this.grounded = true;
          if (world.onLand) world.onLand(this);
        }
      } else if (this.y - sup < c.stepUp) {
        this.y = sup; // микро-ступенька в пределах stepUp
      }
    }

    wander(world, dt, mul, m) {
      const c = C();
      this.wanderTimer -= dt;
      if (this.wanderTimer <= 0) { this.wanderTimer = 1.5 + Math.random() * 2.5; this.wanderDir = Math.random() < 0.5 ? -1 : 1; }
      const nx = this.x + this.wanderDir * c.speed * m.speed * mul * dt;
      if (nx < 20 || nx > c.W - 20) this.wanderDir *= -1;
      else {
        const sup = world.grid.supportAt(nx);
        if (sup < this.y - c.stepUp) this.wanderDir *= -1; // стена — разворачиваемся
        else { this.x = nx; this.walkPhase += dt * 9; }
      }
      this.applyGravity(world, dt);
    }

    update(dt, world) {
      const c = C(), s = S(), m = this.mods();
      this.stateTime += dt;
      this.applyMutations(world);
      if (this.fearCooldown > 0) this.fearCooldown -= dt;
      this.blink -= dt; if (this.blink < -0.12) this.blink = 2 + Math.random() * 3;

      // RUST: боимся ластика — замираем, потом бежим (A12)
      if (!this.jarred && this.state !== 'SLEEP' && this.state !== 'FEAR' && this.state !== 'FLEE' && world.eraserPos) {
        const d = Math.hypot(world.eraserPos.x - this.x, world.eraserPos.y - (this.y - 30 * m.size));
        if (d < c.fearRadius && this.fearCooldown <= 0) {
          this.state = 'FEAR'; this.stateTime = 0; this.fearTimer = c.fearFreeze;
          this.fleeDir = this.x < world.eraserPos.x ? -1 : 1;
          if (world.onFear) world.onFear();
        }
      }

      switch (this.state) {
        case 'IDLE': {
          this.hunger = Math.min(1, this.hunger + c.hunger.rate * dt);
          this.wander(world, dt, 0.35, m);
          if (this.hunger > c.hunger.seekAt) { this.state = 'SEEK'; this.stateTime = 0; this.retarget(world); }
          break;
        }
        case 'SEEK': {
          this.hunger = Math.min(1, this.hunger + c.hunger.rate * dt * 0.5);
          if (!this.target || !this.targetStillValid(world)) this.retarget(world);
          if (!this.target) { this.wander(world, dt, 0.5, m); break; }
          const dx = this.target.x - this.x;
          if (Math.abs(dx) > 2) this.facing = dx > 0 ? 1 : -1;
          const nx = this.x + this.facing * c.speed * m.speed * m.maneuver * dt;
          const sup = world.grid.supportAt(nx);
          if (sup < this.y - c.stepUp) { // стена краски
            const reach = this.reachOf(m, 1);
            if (s.shortfall(this.y, this.target.y, reach) <= 0) {
              // дотягиваемся честно — запрыгиваем (лесенка работает, A4/A8)
              const h = Math.max(10, this.y - sup + 6);
              this.vy = -Math.sqrt(2 * c.gravity * h);
              this.grounded = false;
            } else {
              this.state = 'STANDOFF'; this.stateTime = 0; this.attemptIdx = 0; this.lastAttemptAt = -9;
            }
          } else {
            this.x = nx; this.walkPhase += dt * 9;
          }
          this.applyGravity(world, dt);
          if (this.state === 'SEEK' && Math.abs(this.target.x - this.x) < 14 * m.size) {
            const reach = this.reachOf(m, 1);
            const short = s.shortfall(this.y, this.target.y, reach);
            this.debugReach = { short: Math.round(Math.max(0, short)), need: Math.round(this.y - this.target.y), can: Math.round(reach) };
            if (short <= 0) { this.state = 'EAT'; this.stateTime = 0; this.biteTimer = 0.1; }
            else { this.state = 'STANDOFF'; this.stateTime = 0; this.attemptIdx = 0; this.lastAttemptAt = -9; }
          }
          break;
        }
        case 'STANDOFF': { // честно недосягаемо: пытаемся с эскалацией, потом обижаемся (A5/A6)
          if (!this.target || !this.targetStillValid(world)) { this.state = 'SEEK'; this.stateTime = 0; break; }
          const dx = this.target.x - this.x;
          if (Math.abs(dx) > 2) this.facing = dx > 0 ? 1 : -1;
          const mult = c.attemptV[Math.min(this.attemptIdx, c.attemptV.length - 1)];
          const reach = this.reachOf(m, mult);
          const short = s.shortfall(this.y, this.target.y, reach);
          this.debugReach = { short: Math.round(Math.max(0, short)), need: Math.round(this.y - this.target.y), can: Math.round(reach) };
          if (short <= 0) { this.state = 'SEEK'; this.stateTime = 0; break; } // игрок помог — бросается есть
          if (this.grounded && this.stateTime - this.lastAttemptAt > c.attemptDelay) {
            const maxAtt = c.maxAttempts + (this.hunger > 0.8 ? 1 : 0);
            if (this.attemptIdx >= maxAtt) { this.state = 'SULK'; this.stateTime = 0; this.sulkChecked = 0; break; }
            this.lastAttemptAt = this.stateTime;
            let h = c.jumpH * mult + m.jump;
            if (m.doubleJump && this.attemptIdx >= 2) h += c.jump2Bonus;
            this.vy = -Math.sqrt(2 * c.gravity * h);
            this.grounded = false;
            if (world.onAttempt) world.onAttempt(this.x, this.y, this.attemptIdx);
            this.attemptIdx++;
          }
          this.applyGravity(world, dt);
          break;
        }
        case 'EAT': {
          if (!this.target) { this.state = 'SEEK'; this.stateTime = 0; break; }
          const t = this.target;
          const dx = t.x - this.x;
          if (Math.abs(dx) > 2) this.facing = dx > 0 ? 1 : -1;
          const sup = world.grid.supportAt(this.x);
          if (sup < this.y && this.y - sup < c.stepUp * 2) this.y = sup; // поднимаемся к еде
          this.applyGravity(world, dt);
          this.biteTimer -= dt;
          if (this.biteTimer <= 0) {
            this.biteTimer = c.biteInterval / m.chew;
            t.y = world.grid.supportAt(t.x); // грызём открытую (верхнюю) ячейку колонки
            const v = world.bite(t.x, t.y + 2);
            if (world.onBite) world.onBite(t.x, t.y);
            if (t.isBait) world.consumeBait();
            this.belly = Math.min(1.4, this.belly + c.bellyPerUnit * m.absorb * (t.isBait ? 2 : 1));
            this.hunger = Math.max(0, this.hunger - 0.25 * (t.isBait ? 2.5 : Math.max(0.35, Math.min(1, v * 3))));
            if (this.belly >= 1) {
              this.meals++; this.target = null;
              this.state = 'SLEEP'; this.stateTime = 0;
              if (world.onMeal) world.onMeal(this.meals);
            } else if (!t.isBait && v <= 0.04 && !this.targetStillValid(world)) {
              this.target = null; this.state = 'SEEK'; this.stateTime = 0;
            }
          }
          break;
        }
        case 'SLEEP': { // сытый спит — окно безопасности для шедевра (A9, A13)
          this.belly -= c.bellyDrain * dt;
          if (world.onSnore && Math.floor(this.stateTime * 0.8) !== Math.floor((this.stateTime - dt) * 0.8)) world.onSnore(this);
          if (this.belly <= 0 && !this.jarred) {
            this.belly = 0; this.hunger = 0.05; this.state = 'IDLE'; this.stateTime = 0;
          }
          break;
        }
        case 'SULK': { // обида: слёзы, переоценка мира каждые 0.5 с (награда за помощь)
          if (world.onSulkTear && Math.random() < dt * 1.5) world.onSulkTear(this);
          this.sulkChecked -= dt;
          if (this.sulkChecked <= 0 && this.target) {
            this.sulkChecked = c.sulkRecheck;
            if (this.targetStillValid(world) && s.shortfall(this.y, this.target.y, this.reachOf(m, 1)) <= 0) {
              this.state = 'SEEK'; this.stateTime = 0; // ступенька появилась — ест немедленно
            }
          }
          if (this.stateTime > c.sulkTime) { this.target = null; this.state = 'SEEK'; this.stateTime = 0; }
          break;
        }
        case 'FEAR': {
          this.fearTimer -= dt;
          if (this.fearTimer <= 0) { this.state = 'FLEE'; this.stateTime = 0; this.fleeTimer = 0.9; }
          break;
        }
        case 'FLEE': {
          this.fleeTimer -= dt;
          const nx = this.x + this.fleeDir * c.speed * m.speed * 2.2 * dt;
          const sup = world.grid.supportAt(nx);
          if (!(sup < this.y - c.stepUp)) { this.x = nx; this.walkPhase += dt * 16; }
          this.applyGravity(world, dt);
          if (this.fleeTimer <= 0) { this.state = 'IDLE'; this.stateTime = 0; this.fearCooldown = 3; }
          break;
        }
      }
    }
  }

  KG.Creature = Creature;
})();
