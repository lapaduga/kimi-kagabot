// tests/sim.test.js — критерии приёмки, которые автоматизируются (A2, A5-математика, A4, A14)
const test = require('node:test');
const assert = require('node:assert');
require('../js/config.js');
const sim = require('../js/sim.js');
const FoodGrid = require('../js/food.js');

test('A2: pigmentValue — насыщенный цвет еда, серый/белый/чёрный нет', () => {
  assert.ok(sim.pigmentValue(255, 0, 0) > 0.6, 'красный — еда');
  assert.ok(sim.pigmentValue(200, 30, 200) > 0.5, 'маджента — еда');
  assert.ok(sim.pigmentValue(163, 230, 53) > 0.4, 'лайм — еда');
  assert.ok(sim.pigmentValue(128, 128, 128) < 0.01, 'графит — не еда');
  assert.ok(sim.pigmentValue(255, 255, 255) < 0.01, 'белый — не еда');
  assert.ok(sim.pigmentValue(0, 0, 0) < 0.01, 'чёрный — не еда');
  // средняя светлота вкуснее края гаммы при той же насыщенности
  const mid = sim.pigmentValue(200, 60, 60), dark = sim.pigmentValue(120, 20, 20);
  assert.ok(mid > dark, 'пик ценности на средней светлоте');
});

test('A5-математика: досягаемость честная, эскалация и мутации реально добавляют высоту', () => {
  const C = globalThis.KG.config;
  const reach = sim.reachTotal(C, 1, {});
  assert.ok(reach > C.jumpH && reach < C.jumpH + C.pawReach + 1);
  // цель высоко → shortfall > 0 (допрыгнуть нельзя)
  assert.ok(sim.shortfall(640, 200, reach) > 0);
  // цель у ног → reachable (shortfall <= 0)
  assert.ok(sim.shortfall(640, 640 - 40, reach) < 0);
  // эскалация отчаянности
  assert.ok(sim.reachTotal(C, C.attemptV[3], {}) > sim.reachTotal(C, C.attemptV[0], {}));
  // двойной прыжок и великан добавляют досягаемость
  assert.ok(sim.reachTotal(C, 1, { doubleJump: true }) > reach);
  assert.ok(sim.reachTotal(C, 1, { sizeMul: 1.22 }) > reach);
});

test('A4/A14: FoodGrid — поверхность (surfY), еда, честный подсчёт покрытия', () => {
  const C = globalThis.KG.config;
  const mkImg = () => ({ data: new Uint8ClampedArray(C.cols * C.rows * 4) });
  const g = new FoodGrid();
  const img = mkImg();
  // красная башня в колонке 50, строки 10..20
  for (let cy = 10; cy <= 20; cy++) { const i = (cy * C.cols + 50) * 4; img.data[i] = 255; img.data[i + 3] = 255; }
  g.sampleFromImageData(img);
  assert.strictEqual(g.supportAt(50 * C.cell + 3), 10 * C.cell, 'верхушка башни — платформа');
  assert.strictEqual(g.supportAt(10), C.H, 'пустая колонка — пол листа');
  assert.strictEqual(g.painted, 11, 'честный счётчик нарисованного');
  const t = g.bestTarget(50 * C.cell + 3, 100);
  assert.ok(t && Math.abs(t.x - (50 * C.cell + 3)) < 4, 'цель — верхушка башни');
  assert.ok(t.v > 0.5, 'красная верхушка — вкусная цель');
  assert.strictEqual(g.countPaintedAround(50 * C.cell + 3, 15 * C.cell, 12), 4); // r=12 px от центра ячейки

  // графитовая платформа — рельеф есть, но цели нет
  const img2 = mkImg();
  for (let cy = 30; cy < 35; cy++) { const i = (cy * C.cols + 60) * 4; img2.data[i] = img2.data[i + 1] = img2.data[i + 2] = 120; img2.data[i + 3] = 255; }
  const g2 = new FoodGrid();
  g2.sampleFromImageData(img2);
  assert.strictEqual(g2.supportAt(60 * C.cell), 30 * C.cell, 'графит — платформа');
  assert.strictEqual(g2.bestTarget(60 * C.cell, 200), null, 'графит — не еда');
});

test('A9-логика: сон дренит живот и будит с малым голодом', () => {
  // лёгкая интеграционная проверка FSM без DOM
  require('../js/kagabotik.js');
  const C = globalThis.KG.config;
  const c = new globalThis.KG.Creature(500, C.H);
  const world = {
    grid: new FoodGrid(), bait: null, eraserPos: null,
    bite() { return 0; },
  };
  // принудительно: сытый → сон; после дренажа живота → IDLE с голодом 0.05
  c.state = 'SLEEP'; c.belly = 0.1; c.jarred = false;
  let woke = null;
  for (let i = 0; i < 50; i++) {
    c.update(0.1, world);
    if (!woke && c.state === 'IDLE') woke = { hunger: c.hunger, t: i * 0.1 };
  }
  assert.ok(woke, 'проснулся после дренажа живота');
  assert.ok(Math.abs(woke.hunger - 0.05) < 1e-9, 'проснулся с малым голодом');
  assert.ok(woke.t > 1 && woke.t < 3, 'окно сна ~1.5–2 с при животе 0.1 (rate 0.055)');
});
