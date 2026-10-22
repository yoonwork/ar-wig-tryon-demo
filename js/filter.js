// One Euro filter (Casiez et al., CHI 2012) — 느릴 때는 떨림을 크게 줄이고, 빠를 때는 지연을 줄여요.
class LowPass {
  constructor() { this.y = null; }
  filter(x, a) { this.y = this.y === null ? x : a * x + (1 - a) * this.y; return this.y; }
}
const alpha = (cutoff, dt) => { const tau = 1 / (2 * Math.PI * cutoff); return 1 / (1 + tau / dt); };

export class OneEuro {
  constructor(dim, { minCutoff = 1.0, beta = 0.02, dCutoff = 1.0 } = {}) {
    this.dim = dim; this.minCutoff = minCutoff; this.beta = beta; this.dCutoff = dCutoff;
    this.reset();
  }
  reset() {
    this.x = Array.from({ length: this.dim }, () => new LowPass());
    this.dx = Array.from({ length: this.dim }, () => new LowPass());
    this.prev = null; this.t = null;
  }
  filter(v, tSec) {
    if (this.prev === null) { this.prev = v.slice(); this.t = tSec; v.forEach((x, i) => { this.x[i].filter(x, 1); this.dx[i].filter(0, 1); }); return v.slice(); }
    const dt = Math.max(1e-3, tSec - this.t); this.t = tSec;
    const out = new Array(this.dim);
    // 속도는 벡터 크기 하나로 계산해서 축마다 컷오프가 따로 놀지 않게 해요.
    let speed2 = 0; const d = new Array(this.dim);
    for (let i = 0; i < this.dim; i++) { d[i] = this.dx[i].filter((v[i] - this.prev[i]) / dt, alpha(this.dCutoff, dt)); speed2 += d[i] * d[i]; }
    const cutoff = this.minCutoff + this.beta * Math.sqrt(speed2);
    const a = alpha(cutoff, dt);
    for (let i = 0; i < this.dim; i++) out[i] = this.x[i].filter(v[i], a);
    this.prev = v.slice();
    return out;
  }
}
