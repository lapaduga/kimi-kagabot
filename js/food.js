// food.js — краска как данные: сетка 167×107, ценность, поверхность (heightmap), выбор цели
(function () {
  const KG = (typeof window !== 'undefined') ? (window.KG = window.KG || {}) : (globalThis.KG = globalThis.KG || {});
  const C = () => KG.config;
  const S = () => KG.sim;

  class FoodGrid {
    constructor() { this.reset(); }
    reset() {
      const c = C();
      this.value = new Float32Array(c.cols * c.rows);   // ценность еды в ячейке
      this.covered = new Uint8Array(c.cols * c.rows);   // есть ли краска вообще (для рельефа и метрик)
      this.surfY = new Float32Array(c.cols);            // верхняя окрашенная ячейка колонки = платформа
      this.surfY.fill(c.H);                             // по умолчанию — пол листа
      this.painted = 0;                                 // честный «нарисовано»
    }
    idx(cx, cy) { return cy * C().cols + cx; }

    // img — ImageData пробника cols×rows (уже даунскейл с холста)
    sampleFromImageData(img) {
      const c = C(), d = img.data;
      this.reset();
      for (let cy = 0; cy < c.rows; cy++) {
        for (let cx = 0; cx < c.cols; cx++) {
          const i = (cy * c.cols + cx) * 4;
          const a = d[i + 3] / 255;
          if (a > 0.12) {
            const k = this.idx(cx, cy);
            this.value[k] = S().pigmentValue(d[i], d[i + 1], d[i + 2]) * a;
            this.covered[k] = 1;
            this.painted++;
            const y = cy * c.cell;
            if (y < this.surfY[cx]) this.surfY[cx] = y;
          }
        }
      }
    }

    supportAt(x) { // поверхность под точкой (y верхней окрашенной ячейки колонки, или пол)
      const c = C();
      const cx = S().clamp(Math.floor(x / c.cell), 0, c.cols - 1);
      return this.surfY[cx];
    }

    // честный подсчёт для метрики съеденного (A14): считаем дельту ячеек в радиусе укуса
    countPaintedAround(x, y, r) {
      const c = C(); let n = 0;
      const x0 = S().clamp(Math.floor((x - r) / c.cell), 0, c.cols - 1);
      const x1 = S().clamp(Math.ceil((x + r) / c.cell), 0, c.cols - 1);
      const y0 = S().clamp(Math.floor((y - r) / c.cell), 0, c.rows - 1);
      const y1 = S().clamp(Math.ceil((y + r) / c.cell), 0, c.rows - 1);
      for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
        const dx = cx * c.cell + c.cell / 2 - x, dy = cy * c.cell + c.cell / 2 - y;
        if (dx * dx + dy * dy <= r * r && this.covered[this.idx(cx, cy)]) n++;
      }
      return n;
    }

    // цель охоты: верхушка самой ценной/близкой колонки. value<0.05 (графит) — не цель.
    bestTarget(x, sight) {
      const c = C(); let best = null, bestScore = 0;
      for (let cx = 0; cx < c.cols; cx++) {
        const sy = this.surfY[cx];
        if (sy >= c.H) continue;
        const cy = S().clamp(Math.round(sy / c.cell), 0, c.rows - 1);
        const v = this.value[this.idx(cx, cy)];
        if (v < 0.05) continue; // графит — платформа, не еда
        const wx = cx * c.cell + c.cell / 2;
        const dist = Math.abs(wx - x);
        if (dist > sight) continue;
        const score = v * (1 - dist / sight);
        if (score > bestScore) { bestScore = score; best = { x: wx, y: cy * c.cell + c.cell / 2, v }; }
      }
      return best;
    }
  }

  KG.FoodGrid = FoodGrid;
  if (typeof module !== 'undefined' && module.exports) module.exports = FoodGrid;
})();
