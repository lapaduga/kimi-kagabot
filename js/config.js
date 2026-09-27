// config.js — все ручки баланса в одном месте (см. дизайн-док, §4)
(function () {
  const KG = (typeof window !== 'undefined') ? (window.KG = window.KG || {}) : (globalThis.KG = globalThis.KG || {});
  KG.config = {
    W: 1000, H: 640,
    cell: 6, cols: 167, rows: 107,       // логический мир 1000×640, пробник 6px/ячейка
    hunger: { rate: 0.016, seekAt: 0.22 }, // ~62 с до полного голода, охота через ~14 с после еды
    bellyPerUnit: 0.16,                    // 6–7 укусов насыщают
    bellyDrain: 0.055,                     // сон ~15–18 с
    jumpH: 96, pawReach: 26, jump2Bonus: 26, gravity: 2000,
    attemptV: [1, 1.06, 1.12, 1.19],       // эскалация отчаянности (без обмана игрока)
    attemptDelay: 0.75, maxAttempts: 4,    // +1 попытка при голоде > 0.8
    stepUp: 22,                            // максимальный «шаг» вверх по краске
    speed: 60,                             // px/с
    sight: 340,
    biteInterval: 0.5, biteRadius: 9,
    bait: { charges: 3, regen: 5 },        // приманка: 3 заряда, +1 / 5 с
    fearRadius: 90, fearFreeze: 0.9,       // RUST-реакция на ластик
    sulkTime: 2.6, sulkRecheck: 0.5,       // SULK: переоценка мира каждые 0.5 с
    mutationEvery: 5,
    mutations: [
      { id: 'longlegs', name: 'Длинноногий', meals: 5,  speed: 1.22, jump: 14 },
      { id: 'horns',    name: 'Рогатый',     meals: 10, chew: 1.25 },
      { id: 'jumper',   name: 'Прыг-скок',   meals: 15, doubleJump: true },
      { id: 'spots',    name: 'Пятнистый',   meals: 20, absorb: 1.18 },
      { id: 'glow',     name: 'Светящийся',  meals: 25, sight: 1.35, neverLost: true },
      { id: 'giant',    name: 'Великан',     meals: 30, size: 1.22, maneuver: 0.85 },
    ],
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = KG.config;
})();
