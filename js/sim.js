// sim.js — чистая логика правил без DOM (покрывается node --test)
(function () {
  const KG = (typeof window !== 'undefined') ? (window.KG = window.KG || {}) : (globalThis.KG = globalThis.KG || {});

  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const lerp = (a, b, t) => a + (b - a) * t;

  // Пигмент как ценность (A2). sat^0.85 · (0.35 + 0.65·mid), пик на средней светлоте.
  // Чёрный/белый/любой серый → ~0 → НЕ еда. Это эстетическая плата: скучно = безопасно.
  function pigmentValue(r, g, b) {
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const sat = (max - min) / 255;
    const lum = (max + min) / 2 / 255;
    const mid = 1 - Math.min(1, Math.abs(lum - 0.55) / 0.45);
    return Math.pow(sat, 0.85) * (0.35 + 0.65 * mid);
  }

  // Честная досягаемость (A5, дизайн-док §3.5).
  // В доке ось y направлена вверх: needed = targetY − (standY − reach). В canvas y вниз,
  // поэтому эквивалент: shortfall = (standY − reach) − targetY.
  // shortfall > 0 → допрыгнуть честно НЕЛЬЗЯ. Никаких «может, сможет».
  function reachTotal(cfg, desperation, opts) {
    let r = cfg.jumpH * desperation + cfg.pawReach;
    if (opts && opts.doubleJump) r += cfg.jump2Bonus;
    if (opts && opts.sizeMul && opts.sizeMul > 1) r *= 1 + (opts.sizeMul - 1); // великан
    return r;
  }
  function shortfall(standY, targetY, reach) { return (standY - reach) - targetY; }

  const sim = { clamp, lerp, pigmentValue, reachTotal, shortfall };
  KG.sim = sim;
  if (typeof module !== 'undefined' && module.exports) module.exports = sim;
})();
