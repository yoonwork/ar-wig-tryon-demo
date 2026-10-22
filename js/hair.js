// 코드로 만드는 3D 가발: 두피에 뿌리를 심고, 빗질 방향·중력·충돌을 따라 머리카락 가닥을 길러요.
// 가닥은 화면을 향하는 얇은 띠(ribbon)로 그리고, Kajiya-Kay 이방성 반사로 결 방향 윤기를 넣어요.
import * as THREE from 'three';
import { HEAD, azimuth, hairlineY, isEarZone, ellProject, ellPush, ellNormal, pushBodies, NECK } from './head.js';
import { CANON_V, CANON_F } from './canonical.js';

// ── 작은 도우미 ───────────────────────────────────────────
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const G = V(0, -1, 0);
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
function rngOf(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const tangentOf = (v, n) => v.clone().addScaledVector(n, -v.dot(n));
const CROWN = V(0, 12.4, -11.5);
// 부드러운 3D 값 노이즈(0~1): 볼륨을 덩어리지게 만들 때 써요.
function hash3(x, y, z) { let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1274126177); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
export function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const l = (a, b, t) => a + (b - a) * t;
  const c = (i, j, k) => hash3(xi + i, yi + j, zi + k);
  return l(l(l(c(0, 0, 0), c(1, 0, 0), u), l(c(0, 1, 0), c(1, 1, 0), u), v), l(l(c(0, 0, 1), c(1, 0, 1), u), l(c(0, 1, 1), c(1, 1, 1), u), v), w);
}

// ── 가발 스타일 정의 ───────────────────────────────────────
// comb: 빗질 방향, length: 최대 길이, lift: 볼륨(두피에서 뜨는 높이), stop: 자른 선(커트 라인)
export const STYLES = [
  {
    id: 'dandy', name: '댄디 컷', gender: 'm', seed: 11,
    rootOk: (p, phi, hy) => p.y > Math.max(hy, -3.0),
    guides: 1400, children: 10, P: 12, step: 0.35, width: 0.06, clumpR: 0.34, tight: 0.62, frizz: 0.04, lumpy: 0.25, fly: 0.012, flyAmp: 0.3,
    colors: ['#241b16', '#3a2a20', '#564a43'],
    jitter: 0.2,
    length(p, phi, rng) {
      const a = Math.abs(phi), top = smooth(6, 12, p.y);
      let L = mix(1.9, 6.6, top);
      if (a > 110) L = mix(1.2, 4.4, smooth(-3, 10, p.y));
      if (a > 50 && a < 82) L *= mix(1, 0.75, smooth(50, 64, a) * (1 - smooth(74, 82, a))); // 관자놀이·구레나룻은 조금 짧게(긴 잔머리처럼 늘어지지 않게)
      return L * (0.8 + 0.4 * rng());
    },
    comb(p) {
      const top = smooth(7, 11, p.y), a = Math.abs(azimuth(p));
      const radial = p.clone().sub(CROWN); radial.y *= 0.25; radial.normalize();
      const down = V(0, -1, a < 100 ? 0.15 : -0.1).normalize();
      const d = down.lerp(radial, top);
      if (p.z > -3) d.x -= 0.5 * smooth(-3, 4, p.z) * (1 + p.x * 0.05); // 앞머리를 한쪽으로 쓸어 넘김
      return d.normalize();
    },
    lift(p, u) { const top = smooth(4, 11, p.y); return 0.3 + u * mix(0.75, 1.1, top); },
    liftRamp: 3.2, gHug: 0.22, // 정수리는 뿌리에서 천천히 떠서 눌린 볼륨으로
    stop(p, phi, s, gr) {
      const a = Math.abs(phi);
      if (a < 58 && p.z > 1.5) return p.y < 6.4 + gr * 2.0 + Math.max(0, p.x) * 0.12;  // 앞머리: 눈썹 위, 끝을 들쭉날쭉하게
      if (isEarZone(phi) || (a > 60 && a < 72)) return p.y < hairlineY(phi) - 0.2 - gr * 0.4; // 귀·구레나룻은 짧게
      return p.y < Math.max(hairlineY(phi), -3.0) - 0.5 - gr * 0.6;                         // 뒷목은 짧게 정리
    },
  },
  {
    id: 'part', name: '가르마 컷', gender: 'm', seed: 23,
    rootOk: (p, phi, hy) => p.y > Math.max(hy, -3.0),
    guides: 1400, children: 9, P: 12, step: 0.35, width: 0.057, clumpR: 0.36, tight: 0.75, frizz: 0.12, lumpy: 0.45, jitter: 0.25, fly: 0.015, flyAmp: 0.45,
    colors: ['#1d1613', '#3a2a20', '#564a43'],
    partX: 2.4,
    length(p, phi, rng) {
      const a = Math.abs(phi), top = smooth(6.5, 11, p.y);
      let L = mix(1.6, 7.2, top);
      if (a > 110) L = mix(1.4, 3.6, smooth(-4, 9, p.y));
      if (a > 50 && a < 82) L *= mix(1, 0.78, smooth(50, 64, a) * (1 - smooth(74, 82, a)));
      return L * (0.88 + 0.24 * rng());
    },
    comb(p) {
      const top = smooth(7, 10.5, p.y), a = Math.abs(azimuth(p));
      const down = V(0, -1, a < 100 ? 0.1 : -0.15).normalize();
      // 가르마 오른쪽(큰 쪽)은 이마 위로 넘기고, 왼쪽(작은 쪽)은 옆으로 내려요.
      const big = p.x < this.partX;
      const sweep = big ? V(-0.75, 0.12, 0.65) : V(0.9, -0.2, 0.05);
      if (p.z < -6) sweep.set(big ? -0.3 : 0.3, -0.4, -1);
      return down.lerp(sweep.normalize(), top).normalize();
    },
    lift(p, u) { const top = smooth(7, 11, p.y); return 0.28 + u * mix(0.6, 2.0, top); },
    liftRamp: 1.2, gHug: 0.08,
    stop(p, phi, s, gr) {
      const a = Math.abs(phi);
      if (a < 60 && p.z > 1.0) return p.y < 6.6 + gr * 1.2 - (p.x < -2 ? 0.9 : 0);
      if (isEarZone(phi) || (a > 60 && a < 72)) return p.y < hairlineY(phi) - 0.2 - gr * 0.3;
      return p.y < Math.max(hairlineY(phi), -3.0) - 0.4 - gr * 0.5;
    },
  },
  {
    id: 'long', name: '긴 생머리', gender: 'f', seed: 37,
    guides: 820, children: 10, P: 22, step: 0.5, width: 0.055, clumpR: 0.5, tight: 0.72, frizz: 0.16, fly: 0.025, flyAmp: 1.2,
    colors: ['#21170f', '#3b2619', '#564a43'],
    fall: true, fallNy: 0.32, flare: 0.07, inward: 0.12, base: 2.8, sway: 0.35, swayL: 16,
    length(p, phi, rng) { return 46; },
    comb(p) {
      const side = p.x >= 0 ? 1 : -1;
      if (p.z < -10.2) { const r = p.clone().sub(CROWN); r.y = Math.min(r.y, 0) - 2; return r.normalize(); }
      const d = V(side, -0.12, -0.3);
      if (p.z < -6.5) d.lerp(V(side * 0.4, -0.5, -1), smooth(-6.5, -10.2, p.z));
      return d.normalize();
    },
    lift(p, u) { return 0.22 + u * 1.15; },
    liftRamp: 2.0, gHug: 0.04,
    hem(phi, rng) { const a = Math.abs(phi); return mix(-19.5, -23.5, smooth(40, 160, a)) + (rng() - 0.5) * 2.2 + (a < 80 ? rng() * 3.5 : 0); },
  },
  {
    id: 'bob', name: '단발 C컬', gender: 'f', seed: 53,
    guides: 900, children: 9, P: 18, step: 0.4, width: 0.056, clumpR: 0.42, tight: 0.7, frizz: 0.12, fly: 0.02, flyAmp: 0.7,
    colors: ['#2a1c14', '#4a3123', '#564a43'],
    fall: true, fallNy: 0.35, flare: 0.14, inward: 0.0, curl: 2.8, base: 2.6, sway: 0.15, swayL: 12,
    partX: -1.4,
    length(p, phi, rng) { return 30; },
    comb(p) {
      const side = p.x >= this.partX ? 1 : -1;
      if (p.z < -10.2) { const r = p.clone().sub(CROWN); r.y = Math.min(r.y, 0) - 2; return r.normalize(); }
      const d = V(side, -0.15, -0.22);
      if (p.z < -6.5) d.lerp(V(side * 0.4, -0.5, -1), smooth(-6.5, -10.2, p.z));
      return d.normalize();
    },
    lift(p, u) { return 0.3 + u * 1.35; },
    liftRamp: 1.6, gHug: 0.05,
    hem(phi, rng) { const a = Math.abs(phi); return mix(-8.4, -6.2, smooth(70, 170, a)) + (rng() - 0.5) * 0.7; },
    bangs: { count: 70, children: 9, depth: 2.2, maxPhi: 34, stopY: 5.0, len: 6.5 },
  },
];

// ── 가닥 하나(가이드) 기르기 ────────────────────────────────
function growGuide(style, root, rng, u, opts = {}) {
  const step = style.step;
  const phi0 = azimuth(root);
  const Lmax = opts.len ?? style.length(root, phi0, rng);
  const lump = style.lumpy ? 1 - style.lumpy + 2 * style.lumpy * noise3(root.x * 0.32 + style.seed, root.y * 0.32, root.z * 0.32) : 1;
  const liftMax = (opts.lift ?? style.lift(root, u)) * lump;
  const hem = style.hem ? style.hem(phi0, rng) : -99;
  const gr = rng();
  // 빗질 방향 흔들림: 이웃 묶음끼리 비슷하게(공간 노이즈) + 묶음마다 조금(무작위) → 결이 덩어리로 흘러요
  const J = opts.jitter ?? style.jitter ?? 0.15;
  const nz = noise3(root.x * 0.21 + style.seed * 3.1, root.y * 0.21, root.z * 0.21) * 2 - 1;
  const ja = nz * J * 1.1 + (rng() - 0.5) * J * 0.9, cja = Math.cos(ja), sja = Math.sin(ja);
  const pts = [root.clone()], nrm = [ellNormal(root)], fallen = [0];
  const p = root.clone();
  let n = ellNormal(p);
  let d = tangentOf(opts.comb ? opts.comb(p) : style.comb(p), n).normalize();
  let phase = 0, s = 0;
  const steps = Math.ceil(Lmax / step);
  for (let i = 1; i <= steps; i++) {
    s += step;
    n = ellNormal(p, n);
    if (phase === 0) {
      const want = (opts.comb ? opts.comb(p) : style.comb(p)).addScaledVector(G, opts.gHug ?? style.gHug ?? 0.1);
      const wt = tangentOf(want, n).normalize();
      const nx = n.clone().cross(wt); wt.multiplyScalar(cja).addScaledVector(nx, sja); // 가닥 묶음마다 방향을 조금씩 다르게
      d.lerp(wt, 0.5); d.copy(tangentOf(d, n)).normalize();
      p.addScaledVector(d, step);
      const lift = liftMax * smooth(0, style.liftRamp ?? 1.6, s);
      ellProject(p, lift + 0.12);
      if (style.fall && !opts.noFall && (n.y < style.fallNy || p.y < 4.5)) phase = 1;
    } else {
      const out = V(p.x, 0, p.z - HEAD.c.z); const ol = out.length() || 1; out.multiplyScalar(1 / ol);
      const want = G.clone().addScaledVector(out, style.flare ?? 0.05);
      if (style.inward && p.y < -3) want.addScaledVector(out, -style.inward * smooth(-3, -12, p.y));
      if (style.curl && p.y - hem < style.curl) {
        const k = 1 - (p.y - hem) / style.curl; // 0→1 끝으로 갈수록 안으로 말려요
        want.lerp(out.clone().multiplyScalar(-1).add(V(0, 0.35, 0)), Math.min(1, k * 1.25));
      }
      d.lerp(want.normalize(), 0.3).normalize();
      p.addScaledVector(d, step);
      ellPush(p, liftMax * 0.85 + 0.15);
      pushBodies(p, 0.25 + u * 0.9);
    }
    pts.push(p.clone());
    nrm.push(phase === 0 ? ellNormal(p) : V(p.x, 0.25, p.z - HEAD.c.z).normalize());
    fallen.push(phase);
    if (style.fall && phase === 1 && p.y < hem) break;
    if (opts.stop ? opts.stop(p, gr) : (style.stop && style.stop(p, azimuth(p), s, gr))) break;
  }
  return { pts, nrm, fallen };
}

// 같은 개수(P)의 점으로 다시 나누기
function resample(src, P) {
  const n = src.pts.length;
  const cum = [0];
  for (let i = 1; i < n; i++) cum.push(cum[i - 1] + src.pts[i].distanceTo(src.pts[i - 1]));
  const L = cum[n - 1];
  const pts = [], nrm = [];
  let j = 0;
  for (let k = 0; k < P; k++) {
    const target = L * k / (P - 1);
    while (j < n - 2 && cum[j + 1] < target) j++;
    const seg = cum[j + 1] - cum[j] || 1;
    const f = Math.min(1, Math.max(0, (target - cum[j]) / seg));
    pts.push(src.pts[j].clone().lerp(src.pts[Math.min(n - 1, j + 1)], f));
    nrm.push(src.nrm[j].clone().lerp(src.nrm[Math.min(n - 1, j + 1)], f).normalize());
  }
  return { pts, nrm, L };
}

// ── 뿌리 뽑기 (두피 위 무작위 점) ────────────────────────────
function sampleRoot(rng, accept) {
  for (let k = 0; k < 200; k++) {
    const z = rng() * 2 - 1, a = rng() * Math.PI * 2, r = Math.sqrt(1 - z * z);
    const dir = V(r * Math.cos(a), z, r * Math.sin(a));
    const p = V(HEAD.c.x + HEAD.r.x * dir.x, HEAD.c.y + HEAD.r.y * dir.y, HEAD.c.z + HEAD.r.z * dir.z);
    const phi = azimuth(p), hy = hairlineY(phi);
    if (p.y < hy) continue;
    if (accept && !accept(p, phi, hy)) continue;
    return { p, phi, hy };
  }
  return null;
}

// ── 가발 하나 만들기 ──────────────────────────────────────
// ── 머리 숱 깊이(간이 자기 그림자) ─────────────────────────────
// deep opacity map을 미리 굽는 근사: 두상 중심에서 본 방향(4°칸)마다 가장 바깥 머리카락 반지름(겉면)을 구하고,
// 각 점이 겉면에서 얼마나 안쪽에 묻혀 있는지(cm)로 빛이 덜 닿는 정도를 정해요. 계산은 점 수에 비례해서 가벼워요.
function depthField(points) {
  const NA = 90, NE = 45, env = new Float32Array(NA * NE);
  const bin = p => {
    const dx = (p.x - HEAD.c.x) / HEAD.r.x, dy = (p.y - HEAD.c.y) / HEAD.r.y, dz = (p.z - HEAD.c.z) / HEAD.r.z;
    const r = Math.hypot(dx, dy, dz) || 1;
    const ia = Math.min(NA - 1, Math.floor((Math.atan2(dx, dz) + Math.PI) / (2 * Math.PI) * NA));
    const ie = Math.min(NE - 1, Math.max(0, Math.floor((Math.asin(Math.max(-1, Math.min(1, dy / r))) + Math.PI / 2) / Math.PI * NE)));
    return [ia, ie, r];
  };
  for (const p of points) { const [ia, ie, r] = bin(p); const k = ia * NE + ie; if (r > env[k]) env[k] = r; }
  // 빈칸·들쭉날쭉을 줄이려고 이웃 칸 최댓값으로 한 번 넓혀요
  const env2 = new Float32Array(NA * NE);
  for (let a = 0; a < NA; a++) for (let e = 0; e < NE; e++) {
    let m = 0;
    for (let da = -1; da <= 1; da++) for (let de = -1; de <= 1; de++) {
      const ee = e + de; if (ee < 0 || ee >= NE) continue;
      m = Math.max(m, env[((a + da + NA) % NA) * NE + ee]);
    }
    env2[a * NE + e] = m;
  }
  return p => { const [ia, ie, r] = bin(p); return Math.max(0, env2[ia * NE + ie] - r) * 10.5; }; // 정규화 반지름 → 약 cm
}

// ── 가발 하나 만들기 ──────────────────────────────────────
export function buildWig(style) {
  const t0 = performance.now();
  const rng = rngOf(style.seed);
  const strands = []; // {pts, nrm, ao[], edge, seed, cb, wf, cs, am}
  const bases = [];   // 바탕 띠(맨 나중에 그림)
  const guidePts = []; // 그림자 계산용
  const families = [];

  const queueFamily = (root, u, edge, g, childCount, clumpR, extraFrizz = 0, tight = style.tight) => {
    const rs = resample(g, style.P);
    for (const p of rs.pts) guidePts.push(p);
    families.push({ root, u, edge, rs, childCount, clumpR, extraFrizz, tight });
  };

  // 묶음(clump) 하나에서 가닥 여러 개 만들기
  const addFamily = (F, depthAt) => {
    const { root, u, edge, rs, childCount, extraFrizz } = F;
    const P = style.P;
    const n0 = ellNormal(root);
    const t1 = V(-n0.z, 0, n0.x).normalize(); if (t1.lengthSq() < 0.1) t1.set(1, 0, 0);
    const t2 = n0.clone().cross(t1).normalize();
    // 묶음마다 다르게: 밝기(햇빛·염색 얼룩), 모이는 정도, 크기, 윤기 위치
    const lowF = noise3(root.x * 0.17 + 7.3, root.y * 0.17, root.z * 0.17 + style.seed);
    const cb = 0.8 + 0.28 * lowF + 0.16 * rng();
    const tight = Math.min(0.95, F.tight * (0.55 + 0.62 * rng()));
    const clumpR = F.clumpR * (0.7 + 0.6 * rng());
    const cs = rng();
    // 2차 묶음: 한 묶음 안에서 끝이 2~3갈래로 갈라져 모여요
    const nSub = 1 + Math.floor(rng() * 3);
    const subs = [];
    for (let k = 0; k < nSub; k++) { const a = rng() * 6.28, r = clumpR * (nSub > 1 ? 0.45 + 0.35 * rng() : 0); subs.push(t1.clone().multiplyScalar(Math.cos(a) * r).addScaledVector(t2, Math.sin(a) * r)); }
    // 깊이(겉면에서 묻힌 정도)는 가이드 점마다 한 번만 계산해서 가닥들이 나눠 써요
    const gDepth = rs.pts.map(p => depthAt(p));
    // 묶음 전체가 같이 살짝 S자로 흔들려요(긴 머리일수록) → 자로 그은 듯한 평행선이 줄어요
    const sideV = rs.pts.map((p, i) => rs.pts[Math.min(P - 1, i + 1)].clone().sub(rs.pts[Math.max(0, i - 1)]).cross(rs.nrm[i]).normalize());
    const swA = (style.sway ?? 0) * (0.4 + 0.9 * rng()), swP = rng() * 6.28, swF = rs.L / (style.swayL ?? 14) * 6.28;
    const swayAt = (t, i0) => swA ? sideV[i0].clone().multiplyScalar(Math.sin(swP + t * swF) * swA * smooth(0.05, 0.4, t)) : null;
    for (let c = 0; c < childCount; c++) {
      const ang = rng() * Math.PI * 2, rad = clumpR * Math.sqrt(rng());
      const off = t1.clone().multiplyScalar(Math.cos(ang) * rad).addScaledVector(t2, Math.sin(ang) * rad);
      const sub = subs[c % nSub];
      const fz = style.frizz + extraFrizz, ph = [rng() * 6.28, rng() * 6.28, rng() * 6.28], fq = 1 + rng() * 2.2;
      const isFly = rng() < (style.fly ?? 0.02);           // 잔머리(flyaway): 가늘고 옅고 겉으로 살짝 뜸
      const flyAmp = isFly ? (0.35 + rng() * 0.9) * (style.flyAmp ?? 1) : 0;
      const flyDir = t1.clone().multiplyScalar(rng() - 0.5).addScaledVector(t2, rng() - 0.5);
      const lenK = isFly ? 0.75 + rng() * 0.25 : 0.8 + rng() * 0.2; // 끝 길이 들쭉날쭉
      const r0 = rng();
      const wf = isFly ? 0.35 + 0.2 * rng() : r0 < 0.18 ? 0.4 + 0.15 * rng() : 0.7 + 0.6 * rng(); // 가는 가닥 섞기
      const pts = [], nrm = [], ao = [];
      const n = V();
      for (let i = 0; i < P; i++) {
        const t = i / (P - 1) * lenK;
        const fi = t * (P - 1), i0 = Math.min(P - 2, Math.floor(fi)), ff = fi - i0;
        const q = rs.pts[i0].clone().lerp(rs.pts[i0 + 1], ff);
        const k = tight * Math.pow(t, 0.8);
        q.addScaledVector(off, 1 - k).addScaledVector(sub, k);
        const sw = swayAt(t, i0); if (sw) q.add(sw);
        const amp = fz * t;
        q.x += Math.sin(ph[0] + t * fq * 3.1) * amp; q.y += Math.sin(ph[1] + t * fq * 2.3) * amp * 0.6; q.z += Math.sin(ph[2] + t * fq * 2.7) * amp;
        n.copy(rs.nrm[i0]).lerp(rs.nrm[i0 + 1], ff).normalize();
        if (isFly) { const w = Math.pow(t, 1.6) * flyAmp; q.addScaledVector(n, w * 0.8).addScaledVector(flyDir, w); }
        ellPush(q, 0.1);
        pts.push(q);
        nrm.push(n.clone());
        const d = mix(gDepth[i0], gDepth[i0 + 1], ff);
        ao.push(Math.exp(-Math.max(0, d) * (style.aoK ?? 0.9)));
      }
      strands.push({ pts, nrm, ao, edge, seed: rng(), cb, wf, cs, am: isFly ? 0.7 : 1 });
    }
    // 바탕 띠(긴 머리·단발): 묶음 바로 아래에 넓고 어두운 띠를 하나 깔아 가닥 사이 빈틈으로 뒤(피부·배경)가 비치지 않게.
    // 게임의 헤어 카드처럼 아래층은 넓게, 위층은 가는 가닥으로. 나중에 그려서 가닥에 가린 곳은 깊이 검사로 건너뛰어요.
    // 얼굴 옆으로 내려오는 앞쪽 묶음은 띠가 드러나 굵은 선처럼 보이므로 옆·뒤쪽(|방위각| > 55°)에만 깔아요.
    if (style.base && edge < 0.3 && Math.abs(azimuth(root)) > 55) {
      const pts = [], nrm = [], ao = [];
      for (let i = 0; i < P; i++) {
        const t = i / (P - 1) * 0.9;
        const fi = t * (P - 1), i0 = Math.min(P - 2, Math.floor(fi)), ff = fi - i0;
        const n = rs.nrm[i0].clone().lerp(rs.nrm[i0 + 1], ff).normalize();
        const q = rs.pts[i0].clone().lerp(rs.pts[i0 + 1], ff).addScaledVector(n, -0.12);
        const sw = swayAt(t, i0); if (sw) q.add(sw);
        ellPush(q, 0.1);
        pts.push(q); nrm.push(n);
        ao.push(Math.exp(-(mix(gDepth[i0], gDepth[i0 + 1], ff) + 0.9) * (style.aoK ?? 0.9)));
      }
      bases.push({ pts, nrm, ao, edge: 0, seed: rng(), cb: cb * 0.9, wf: style.base, cs, am: 1, base: 1 });
    }
  };

  // 1) 본 머리
  for (let gi = 0; gi < style.guides; gi++) {
    const r = sampleRoot(rng, style.rootOk);
    if (!r) continue;
    const dy = r.p.y - r.hy, front = Math.abs(r.phi) < 80 ? 1 : 0.5;
    // 헤어라인 가장자리는 숱이 점점 줄어요(앞쪽은 0.4cm 안쪽에서 약 절반)
    if (rng() > mix(0.45, 1, smooth(0, 1.3, dy)) + (1 - front) * 0.3) continue;
    const root = ellProject(r.p.clone(), 0.08);
    const u = Math.pow(rng(), 0.8);
    const edge = front * (1 - smooth(0, 1.6, dy));
    const g = growGuide(style, root, rng, u);
    if (g.pts.length < 3) continue;
    queueFamily(root, u, edge, g, Math.max(3, Math.round(style.children * mix(0.6, 1, smooth(0, 1.2, dy)))), style.clumpR);
  }
  // 2) 시스루 앞머리 (단발)
  if (style.bangs) {
    const b = style.bangs;
    for (let k = 0; k < b.count; k++) {
      const r = sampleRoot(rng, (p, phi, hy) => Math.abs(phi) < b.maxPhi && p.y < hy + b.depth && p.z > 0);
      if (!r) continue;
      const root = ellProject(r.p.clone(), 0.08);
      const u = 0.55 + rng() * 0.45;
      const g = growGuide(style, root, rng, u, {
        len: b.len * (0.9 + rng() * 0.2), lift: 0.35 + rng() * 0.3, noFall: true, gHug: 0.35,
        comb: p => V(p.x * 0.12, -0.7, 1).normalize(),
        stop: (p, gr) => p.y < b.stopY + gr * 2.0 && p.z > 2, jitter: 0.5, // 끝 높이·방향을 더 들쭉날쭉하게(빗처럼 고른 느낌 줄이기)
      });
      if (g.pts.length < 3) continue;
      queueFamily(root, u, 0.9, g, b.children, 0.16, 0.05, 0.92);
    }
  }
  const depthAt = depthField(guidePts);
  for (const F of families) addFamily(F, depthAt);
  const strandCount = strands.length;
  for (const b of bases) strands.push(b);

  const geo = strandGeometry(strands, style.P);
  const ms = performance.now() - t0;
  return { style, geo, strandCount, baseCount: bases.length, guidePts, ms };
}

// ── 띠 메시 만들기 (점마다 꼭짓점 2개) ───────────────────────
function strandGeometry(strands, P) {
  const nv = strands.length * P * 2;
  const pos = new Float32Array(nv * 3);
  const tan = new Int8Array(nv * 4);
  const nor = new Int8Array(nv * 4);
  const aux = new Uint8Array(nv * 4);
  const ext = new Uint8Array(nv * 4);
  const idx = new Uint32Array(strands.length * (P - 1) * 6);
  let v = 0, ii = 0;
  const T = V();
  for (const s of strands) {
    const base = v;
    for (let i = 0; i < P; i++) {
      const a = s.pts[Math.max(0, i - 1)], b = s.pts[Math.min(P - 1, i + 1)];
      T.subVectors(b, a).normalize();
      const t = i / (P - 1);
      for (let side = 0; side < 2; side++) {
        pos[v * 3] = s.pts[i].x; pos[v * 3 + 1] = s.pts[i].y; pos[v * 3 + 2] = s.pts[i].z;
        tan[v * 4] = T.x * 127; tan[v * 4 + 1] = T.y * 127; tan[v * 4 + 2] = T.z * 127; tan[v * 4 + 3] = s.edge * 127;
        nor[v * 4] = s.nrm[i].x * 127; nor[v * 4 + 1] = s.nrm[i].y * 127; nor[v * 4 + 2] = s.nrm[i].z * 127; nor[v * 4 + 3] = Math.min(1, s.cb / 1.6) * 127;
        aux[v * 4] = t * 255; aux[v * 4 + 1] = side * 255; aux[v * 4 + 2] = s.seed * 255; aux[v * 4 + 3] = s.ao[i] * 255;
        ext[v * 4] = Math.min(1, s.wf / 4) * 255; ext[v * 4 + 1] = s.cs * 255; ext[v * 4 + 2] = s.am * 255; ext[v * 4 + 3] = (s.base || 0) * 255;
        v++;
      }
    }
    for (let i = 0; i < P - 1; i++) {
      const a = base + i * 2;
      idx[ii++] = a; idx[ii++] = a + 1; idx[ii++] = a + 2;
      idx[ii++] = a + 1; idx[ii++] = a + 3; idx[ii++] = a + 2;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('htan', new THREE.BufferAttribute(tan, 4, true));
  g.setAttribute('hnrm', new THREE.BufferAttribute(nor, 4, true));
  g.setAttribute('haux', new THREE.BufferAttribute(aux, 4, true));
  g.setAttribute('hext', new THREE.BufferAttribute(ext, 4, true));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.boundingSphere = new THREE.Sphere(V(0, -2, -4), 40);
  return g;
}

// ── 공용 조명 값 ────────────────────────────────────────────
export const LIGHT = {
  uLightDir: { value: V(-0.35, 0.75, 0.55).normalize() }, // 카메라 공간(위·앞에서 오는 빛)
  uExposure: { value: 1.0 },
  uAmb: { value: 0.32 },
};

// ── 머리카락 셰이더 ──────────────────────────────────────────
const STRAND_VS = /* glsl */`
attribute vec4 htan; attribute vec4 hnrm; attribute vec4 haux; attribute vec4 hext;
uniform vec2 uRes; uniform float uWidth;
varying vec3 vT; varying vec3 vN; varying vec3 vV; varying vec4 vAux; varying float vCov; varying float vEdge; varying float vCb; varying vec3 vExt; varying float vSide; varying float vPx;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec3 T = normalize((modelViewMatrix * vec4(htan.xyz, 0.0)).xyz);
  vec4 c1 = projectionMatrix * mv;
  vec4 c2 = projectionMatrix * (mv + vec4(T, 0.0));
  vec2 s1 = c1.xy / c1.w, s2 = c2.xy / c2.w;
  vec2 dir = (s2 - s1) * uRes; float l = length(dir); dir = l > 1e-5 ? dir / l : vec2(1.0, 0.0);
  vec2 nS = vec2(-dir.y, dir.x);
  float t = haux.x, edge = htan.w;
  // 굵기: 뿌리→끝으로 점점 가늘게(뒤 55%에서 30%까지), 가닥마다 굵기가 달라요(hext.x).
  // 헤어라인에서 나는 가닥은 뿌리가 아주 가늘게 시작해요(잔털 → 이마와 자연스럽게 섞임).
  float taper = mix(1.0, 0.3, smoothstep(0.45, 1.0, t));
  float rootIn = mix(1.0, 0.25 + 0.75 * smoothstep(0.0, 0.3, t), edge);
  // 숱 안쪽(겉에서 묻힌) 가닥은 조금 굵게 → 어두운 바탕이 빈틈을 메우고, 겉 가닥만 가늘게 결을 보여요
  float inner = mix(1.7, 1.0, smoothstep(0.15, 0.7, haux.w));
  float wcm = uWidth * hext.x * 4.0 * taper * rootIn * inner;
  float pxPerCm = projectionMatrix[1][1] * uRes.y * 0.5 / max(1.0, -mv.z);
  float wpx = wcm * pxPerCm;
  // 아주 가는 끝도 0.45px까지는 실제 폭으로 그려 MSAA가 겹침을 섞게 하고(점무늬 없음), 그보다 가늘 때만 알파로 옅게 해요.
  float drawPx = max(wpx, 0.45);
  vCov = sqrt(clamp(wpx / drawPx, 0.0, 1.0));
  float side = haux.y * 2.0 - 1.0;
  c1.xy += nS * side * drawPx / uRes * c1.w;
  gl_Position = c1;
  vT = T; vN = normalize(normalMatrix * hnrm.xyz); vV = normalize(-mv.xyz);
  vAux = haux; vEdge = edge; vCb = hnrm.w * 1.6; vExt = hext.yzw; vSide = side; vPx = drawPx;
}`;
const STRAND_FS = /* glsl */`
uniform vec3 uColor; uniform vec3 uLightDir; uniform float uExposure; uniform float uAmb; uniform float uOpacity;
varying vec3 vT; varying vec3 vN; varying vec3 vV; varying vec4 vAux; varying float vCov; varying float vEdge; varying float vCb; varying vec3 vExt; varying float vSide; varying float vPx;
float kk(vec3 T, vec3 H, float e){ float d = dot(T, H); return pow(sqrt(max(0.0, 1.0 - d * d)), e); }
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main(){
  float t = vAux.x, seed = vAux.z, ao = vAux.w, cs = vExt.x, am = vExt.y;
  vec3 T = normalize(vT), N = normalize(vN), V = normalize(vV), L = normalize(uLightDir);
  vec3 H = normalize(L + V);
  // 윤기 위치는 묶음끼리 같이 움직이고(cs), 가닥마다 조금씩 어긋나요(seed)
  float sh = (cs - 0.5) * 0.08 + (seed - 0.5) * 0.1;
  float s1 = kk(normalize(T + N * (0.12 + sh)), H, 220.0);          // 1차 반사: 좁고 하얀 윤기(끝 쪽)
  float s2 = kk(normalize(T + N * (-0.10 + sh)), H, 44.0);          // 2차 반사: 머리색이 섞인 넓은 반사(뿌리 쪽)
  float ndl = dot(N, L);
  float wrap = clamp(ndl * 0.55 + 0.45, 0.0, 1.0);
  float tl = dot(T, L); float kd = sqrt(max(0.0, 1.0 - tl * tl));
  float diff = wrap * mix(0.55, 1.0, kd);
  // 색: 묶음 밝기(vCb) × 가닥 밝기(±12%) × 몇몇 가닥은 살짝 따뜻하게
  vec3 base = uColor * vCb * (0.88 + 0.24 * seed);
  base *= mix(vec3(1.0), vec3(1.07, 1.0, 0.92), step(0.7, fract(seed * 7.13)));
  base *= mix(0.6, 1.0, smoothstep(0.0, 0.35, t));                  // 뿌리는 어둡게
  base *= mix(1.0, 1.3, t * t);                                       // 끝은 옅게
  // 단면이 둥근 느낌: 굵게 그려지는 가닥만 띠 가장자리를 살짝 어둡게
  float rim = sqrt(max(0.0, 1.0 - vSide * vSide));
  float rnd = mix(1.0, mix(0.84, 1.0, rim), smoothstep(2.2, 4.0, vPx));
  // 숱 깊이(겉면에서 묻힌 정도로 미리 구운 자기 그림자) + 빛 반대쪽 아랫면 그림자
  float occ = mix(0.26, 1.0, ao) * mix(0.55, 1.0, smoothstep(-0.35, 0.45, ndl));
  vec3 col = base * (uAmb + diff) * occ * rnd;
  float glint = 0.7 + 0.3 * sin(seed * 157.0 + t * 9.0 + cs * 20.0);
  vec3 warm = min(uColor * 5.0, vec3(0.35)) + vec3(0.025, 0.02, 0.016); // 밝은 색일수록 과하게 붉어지지 않게
  col += (s1 * 0.15 + s2 * 0.5 * glint * warm) * occ * occ * rnd * smoothstep(0.02, 0.2, t);
  col *= uExposure;
  float a = vCov * am * uOpacity;
  a *= 1.0 - smoothstep(0.45, 1.0, abs(vSide)) * vExt.z;              // 바탕 띠는 가장자리를 흐리게
  a *= mix(1.0, 1.0 - 0.5 * smoothstep(0.55, 1.0, abs(vSide)), smoothstep(1.6, 3.2, vPx)); // 굵게 보이는 가닥은 가장자리를 부드럽게(선 느낌 줄이기)
  a *= mix(1.0, smoothstep(0.0, 0.18, t) * 0.8 + 0.2, vEdge);         // 헤어라인 뿌리는 옅게 → 이마와 섞임
  // 알파 투 커버리지의 규칙적인 점무늬 대신 화면 위치마다 문턱을 흔들어요(hashed alpha)
  if (a < 0.995) a = clamp(a + (hash12(gl_FragCoord.xy + seed * 91.7) - 0.5) * 0.08, 0.0, 1.0);
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}`;

export function strandMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color('#241b16') }, uRes: { value: new THREE.Vector2(1, 1) }, uWidth: { value: 0.075 }, uOpacity: { value: 1 }, ...LIGHT },
    vertexShader: STRAND_VS, fragmentShader: STRAND_FS,
    side: THREE.DoubleSide, transparent: true, blending: THREE.NoBlending, alphaToCoverage: true, depthWrite: true,
  });
}

// ── 두피 덮개 + 헤어라인 아래 부드러운 그림자 ───────────────────
const CAP_VS = /* glsl */`
attribute float inside; attribute float shade; attribute float edge;
varying float vIn; varying float vShade; varying vec3 vN; varying vec3 vP; varying float vEdge;
void main(){
  vIn = inside; vShade = shade; vEdge = edge; vP = position;
  vN = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const CAP_FS = /* glsl */`
uniform vec3 uColor; uniform vec3 uLightDir; uniform float uExposure; uniform float uAmb; uniform float uOpacity; uniform float uShadow;
uniform float uHL[91]; uniform vec3 uC; uniform float uSkirt;
varying float vIn; varying float vShade; varying vec3 vN; varying vec3 vP; varying float vEdge;
float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
// 헤어라인 높이를 픽셀마다 계산(2° 간격 표를 선형 보간) → 격자 계단 무늬가 안 생겨요
float hairline(vec3 p){
  float a = abs(degrees(atan(p.x, p.z - uC.z))) * 0.5;
  int i = int(min(floor(a), 89.0)); float t = clamp(a - float(i), 0.0, 1.0);
  return mix(uHL[i], uHL[i + 1], t);
}
void main(){
  vec3 N = normalize(vN);
  float dy = vP.y - hairline(vP);
  float diff = clamp(dot(N, normalize(uLightDir)) * 0.5 + 0.5, 0.0, 1.0);
  // 헤어라인 접촉 그림자: 헤어라인 위(덮개가 막 진해지는 구간)까지 이어지게 → 덮개와 그림자 사이에 밝은 띠가 안 생겨요
  float contact = smoothstep(-1.2, 0.0, dy) * 0.35;
  float shade = min(0.85, vShade + contact) * smoothstep(-uSkirt, -uSkirt + 1.4, dy);
  vec3 col = uColor * 0.5 * (uAmb + diff * 0.8) * (1.0 - shade * 0.5) * uExposure;
  float n = hash(floor(vP * 24.0));
  float inside = smoothstep(-0.2, 0.9, dy);
  inside = smoothstep(0.15, 1.0, inside) * mix(1.0, 0.55 + 0.45 * n, vEdge * (1.0 - smoothstep(0.7, 1.0, inside)));
  float a = mix(shade * uShadow, 0.97, inside) * uOpacity;
  gl_FragColor = vec4(col * inside, a);
  #ifdef CAP_DEBUG
  gl_FragColor = vec4(inside, shade, vEdge, 1.0);
  #endif
  #include <colorspace_fragment>
}`;
const SHADOW_VS = /* glsl */`
attribute float shade; varying float vShade;
void main(){ vShade = shade; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const SHADOW_FS = /* glsl */`
uniform float uStrength; uniform float uOpacity; varying float vShade;
void main(){ gl_FragColor = vec4(vec3(1.0 - vShade * uStrength * uOpacity), 1.0); }`;

// 공간 격자: 근처 머리카락 점을 빨리 찾기
function gridOf(points, cell) {
  const m = new Map();
  const key = (x, y, z) => x + ',' + y + ',' + z;
  for (const p of points) { const k = key(Math.floor(p.x / cell), Math.floor(p.y / cell), Math.floor(p.z / cell)); let a = m.get(k); if (!a) m.set(k, a = []); a.push(p); }
  return { near(p, cb) { const cx = Math.floor(p.x / cell), cy = Math.floor(p.y / cell), cz = Math.floor(p.z / cell); for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) { const a = m.get(key(cx + x, cy + y, cz + z)); if (a) for (const q of a) cb(q); } } };
}
function occlusion(grid, p, n, R = 2.4) {
  let occ = 0; const d = V();
  grid.near(p, q => {
    d.subVectors(q, p); const dist = d.length(); if (dist > R || dist < 1e-4) return;
    if (d.dot(n) / dist < -0.15) return;
    occ += Math.pow(1 - dist / R, 2) * (0.55 + 0.45 * Math.max(0, d.y / dist + 0.3));
  });
  return Math.min(0.85, 1 - Math.exp(-occ * 0.035));
}

export function buildCapAndShadow(wig) {
  const grid = gridOf(wig.guidePts, 2.4);
  // 1) 두피 덮개: 타원체 격자에서 헤어라인 2.4cm 아래까지만 남겨요.
  const NU = 128, NV = 72, SKIRT = 2.4;
  const verts = [], ins = [], shd = [], edg = [], nrms = [], keep = [];
  const n = V();
  for (let j = 0; j <= NV; j++) {
    const th = j / NV * Math.PI; // 0 = 정수리
    for (let i = 0; i <= NU; i++) {
      const ph = (i / NU) * Math.PI * 2 - Math.PI;
      const dir = V(Math.sin(th) * Math.sin(ph), Math.cos(th), Math.sin(th) * Math.cos(ph));
      const p = V(HEAD.c.x + (HEAD.r.x + 0.1) * dir.x, HEAD.c.y + (HEAD.r.y + 0.1) * dir.y, HEAD.c.z + (HEAD.r.z + 0.1) * dir.z);
      const phi = azimuth(p), hy = hairlineY(phi);
      const dy = p.y - hy;
      ellNormal(p, n);
      verts.push(p.x, p.y, p.z); nrms.push(n.x, n.y, n.z);
      ins.push(smooth(-0.2, 0.9, dy));
      // 접촉 그림자·아래 끝 페이드는 셰이더에서 픽셀마다 계산해요(여기선 머리카락 가림 정도만)
      shd.push(dy < 0.5 ? Math.min(0.85, occlusion(grid, p, n) * 0.8) : 0.6);
      edg.push(Math.abs(phi) < 80 ? 1 : 0.4);
      keep.push(dy > -SKIRT - 0.6);
    }
  }
  const index = [];
  const id = (i, j) => j * (NU + 1) + i;
  for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
    const a = id(i, j), b = id(i + 1, j), c = id(i, j + 1), d = id(i + 1, j + 1);
    if (keep[a] && keep[b] && keep[c]) index.push(a, c, b);
    if (keep[b] && keep[c] && keep[d]) index.push(b, c, d);
  }
  const cg = new THREE.BufferGeometry();
  cg.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  cg.setAttribute('normal', new THREE.Float32BufferAttribute(nrms, 3));
  cg.setAttribute('inside', new THREE.Float32BufferAttribute(ins, 1));
  cg.setAttribute('shade', new THREE.Float32BufferAttribute(shd, 1));
  cg.setAttribute('edge', new THREE.Float32BufferAttribute(edg, 1));
  cg.setIndex(index);
  // 2) 얼굴 그림자: 표준 얼굴 메시 꼭짓점마다 머리카락이 얼마나 덮는지 계산
  const fg = new THREE.BufferGeometry();
  fg.setAttribute('position', new THREE.BufferAttribute(CANON_V, 3));
  fg.setIndex(new THREE.BufferAttribute(CANON_F, 1));
  fg.computeVertexNormals();
  const fn = fg.attributes.normal, fshade = new Float32Array(CANON_V.length / 3);
  // 메시 가장자리(한 삼각형에만 쓰인 변) 꼭짓점을 찾아, 가장자리에 가까울수록 그림자를 0으로
  const edgeCount = new Map();
  for (let t = 0; t < CANON_F.length; t += 3) for (let e = 0; e < 3; e++) {
    const a = CANON_F[t + e], b = CANON_F[t + (e + 1) % 3], k = a < b ? a + '_' + b : b + '_' + a;
    edgeCount.set(k, (edgeCount.get(k) || 0) + 1);
  }
  const border = [];
  for (const [k, c] of edgeCount) if (c === 1) for (const i of k.split('_')) border.push(+i);
  const bpts = [...new Set(border)].map(i => V().fromArray(CANON_V, i * 3));
  const fp = V(), fnn = V();
  for (let i = 0; i < fshade.length; i++) {
    fp.fromArray(CANON_V, i * 3); fnn.fromBufferAttribute(fn, i);
    if (fnn.dot(V(fp.x, fp.y, fp.z + 2)) < 0) fnn.negate();
    let db = 1e9; for (const b of bpts) db = Math.min(db, b.distanceTo(fp));
    fshade[i] = occlusion(grid, fp, fnn, 2.6) * smooth(0.2, 2.2, db) * (1 - smooth(7.0, 8.2, fp.y));
  }
  fg.setAttribute('shade', new THREE.BufferAttribute(fshade, 1));
  return { capGeo: cg, faceShadowGeo: fg };
}

export function capMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color('#241b16') }, uOpacity: { value: 1 }, uShadow: { value: 0.55 }, ...LIGHT,
      uHL: { value: Array.from({ length: 91 }, (_, i) => hairlineY(i * 2)) }, uC: { value: HEAD.c.clone() }, uSkirt: { value: 2.4 },
    },
    vertexShader: CAP_VS, fragmentShader: CAP_FS,
    side: THREE.FrontSide, transparent: true, depthWrite: false, // 헤어라인에서 투명한 덮개가 깊이를 써서 가닥 뿌리를 가리던 문제(밝은 띠) 방지
  });
}
export function faceShadowMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uStrength: { value: 0.38 }, uOpacity: { value: 1 } },
    vertexShader: SHADOW_VS, fragmentShader: SHADOW_FS,
    transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.DstColorFactor, blendDst: THREE.ZeroFactor,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8,
  });
}
