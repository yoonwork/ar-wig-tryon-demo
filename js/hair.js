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
    guides: 1400, children: 8, P: 12, step: 0.35, width: 0.08, clumpR: 0.34, tight: 0.62, frizz: 0.04, lumpy: 0.25, stray: 0.3,
    colors: ['#241b16', '#3a2a20', '#564a43'],
    jitter: 0.2,
    length(p, phi, rng) {
      const a = Math.abs(phi), top = smooth(6, 12, p.y);
      let L = mix(1.9, 6.6, top);
      if (a > 110) L = mix(1.2, 4.4, smooth(-3, 10, p.y));
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
    guides: 1400, children: 7, P: 12, step: 0.35, width: 0.075, clumpR: 0.36, tight: 0.75, frizz: 0.12, lumpy: 0.45, jitter: 0.25,
    colors: ['#1d1613', '#3a2a20', '#564a43'],
    partX: 2.4,
    length(p, phi, rng) {
      const a = Math.abs(phi), top = smooth(6.5, 11, p.y);
      let L = mix(1.6, 7.2, top);
      if (a > 110) L = mix(1.4, 3.6, smooth(-4, 9, p.y));
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
    guides: 820, children: 9, P: 28, step: 0.5, width: 0.07, clumpR: 0.5, tight: 0.72, frizz: 0.16,
    colors: ['#21170f', '#3b2619', '#564a43'],
    fall: true, fallNy: 0.32, flare: 0.07, inward: 0.12,
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
    guides: 900, children: 8, P: 18, step: 0.4, width: 0.072, clumpR: 0.42, tight: 0.7, frizz: 0.12,
    colors: ['#2a1c14', '#4a3123', '#564a43'],
    fall: true, fallNy: 0.35, flare: 0.14, inward: 0.0, curl: 2.8,
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
    bangs: { count: 70, children: 7, depth: 2.2, maxPhi: 34, stopY: 5.0, len: 6.5 },
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
  const ja = (rng() - 0.5) * 2 * (opts.jitter ?? style.jitter ?? 0.15), cja = Math.cos(ja), sja = Math.sin(ja);
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
export function buildWig(style) {
  const t0 = performance.now();
  const rng = rngOf(style.seed);
  const strands = []; // {pts, nrm, u, edge, seed}
  const guidePts = []; // 그림자 계산용

  const addFamily = (root, u, edge, g, childCount, clumpR, extraFrizz = 0, tight = style.tight) => {
    const rs = resample(g, style.P);
    for (const p of rs.pts) guidePts.push(p);
    const n0 = ellNormal(root);
    const t1 = V(-n0.z, 0, n0.x).normalize(); if (t1.lengthSq() < 0.1) t1.set(1, 0, 0);
    const t2 = n0.clone().cross(t1).normalize();
    for (let c = 0; c < childCount; c++) {
      const ang = rng() * Math.PI * 2, rad = clumpR * Math.sqrt(rng());
      const off = t1.clone().multiplyScalar(Math.cos(ang) * rad).addScaledVector(t2, Math.sin(ang) * rad);
      const fz = style.frizz + extraFrizz, ph = [rng() * 6.28, rng() * 6.28, rng() * 6.28], fq = 1 + rng() * 2.2;
      const stray = rng() < 0.025 ? 1 + (0.8 + rng() * 2) * (style.stray ?? 1) : 1; // 가끔 삐져나온 잔머리
      const lenK = 0.82 + rng() * 0.18;                    // 끝 길이 들쭉날쭉
      const pts = [], nrm = [];
      for (let i = 0; i < style.P; i++) {
        const t = i / (style.P - 1) * lenK;
        const fi = t * (style.P - 1), i0 = Math.min(style.P - 2, Math.floor(fi)), ff = fi - i0;
        const q = rs.pts[i0].clone().lerp(rs.pts[i0 + 1], ff);
        q.addScaledVector(off, 1 - tight * Math.pow(t, 0.8));
        const amp = fz * t * stray;
        q.x += Math.sin(ph[0] + t * fq * 3.1) * amp; q.y += Math.sin(ph[1] + t * fq * 2.3) * amp * 0.6; q.z += Math.sin(ph[2] + t * fq * 2.7) * amp;
        ellPush(q, 0.1);
        pts.push(q);
        nrm.push(rs.nrm[i0].clone().lerp(rs.nrm[i0 + 1], ff).normalize());
      }
      strands.push({ pts, nrm, u, edge, seed: rng() });
    }
  };

  // 1) 본 머리
  for (let gi = 0; gi < style.guides; gi++) {
    const r = sampleRoot(rng, style.rootOk);
    if (!r) continue;
    const root = ellProject(r.p.clone(), 0.08);
    const u = Math.pow(rng(), 0.8);
    const front = Math.abs(r.phi) < 80 ? 1 : 0.5;
    const edge = front * (1 - smooth(0, 1.6, r.p.y - r.hy));
    const g = growGuide(style, root, rng, u);
    if (g.pts.length < 3) continue;
    addFamily(root, u, edge, g, style.children, style.clumpR);
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
        stop: (p, gr) => p.y < b.stopY + gr * 1.3 && p.z > 2, jitter: 0.35,
      });
      if (g.pts.length < 3) continue;
      addFamily(root, u, 0.9, g, b.children, 0.16, 0.05, 0.92);
    }
  }

  const geo = strandGeometry(strands, style.P);
  const ms = performance.now() - t0;
  return { style, geo, strandCount: strands.length, guidePts, ms };
}

// ── 띠 메시 만들기 (점마다 꼭짓점 2개) ───────────────────────
function strandGeometry(strands, P) {
  const nv = strands.length * P * 2;
  const pos = new Float32Array(nv * 3);
  const tan = new Int8Array(nv * 4);
  const nor = new Int8Array(nv * 4);
  const aux = new Uint8Array(nv * 4);
  const idx = new Uint32Array(strands.length * (P - 1) * 6);
  let v = 0, ii = 0;
  const T = V();
  for (const s of strands) {
    const base = v;
    for (let i = 0; i < P; i++) {
      const a = s.pts[Math.max(0, i - 1)], b = s.pts[Math.min(P - 1, i + 1)];
      T.subVectors(b, a).normalize();
      const t = i / (P - 1);
      const ao = mix(0.3, 1.0, Math.pow(s.u, 0.6));
      for (let side = 0; side < 2; side++) {
        pos[v * 3] = s.pts[i].x; pos[v * 3 + 1] = s.pts[i].y; pos[v * 3 + 2] = s.pts[i].z;
        tan[v * 4] = T.x * 127; tan[v * 4 + 1] = T.y * 127; tan[v * 4 + 2] = T.z * 127; tan[v * 4 + 3] = s.edge * 127;
        nor[v * 4] = s.nrm[i].x * 127; nor[v * 4 + 1] = s.nrm[i].y * 127; nor[v * 4 + 2] = s.nrm[i].z * 127; nor[v * 4 + 3] = s.u * 127;
        aux[v * 4] = t * 255; aux[v * 4 + 1] = side * 255; aux[v * 4 + 2] = s.seed * 255; aux[v * 4 + 3] = ao * 255;
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
attribute vec4 htan; attribute vec4 hnrm; attribute vec4 haux;
uniform vec2 uRes; uniform float uWidth;
varying vec3 vT; varying vec3 vN; varying vec3 vV; varying vec4 vAux; varying float vCov; varying float vEdge; varying float vLayer;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec3 T = normalize((modelViewMatrix * vec4(htan.xyz, 0.0)).xyz);
  vec4 c1 = projectionMatrix * mv;
  vec4 c2 = projectionMatrix * (mv + vec4(T, 0.0));
  vec2 s1 = c1.xy / c1.w, s2 = c2.xy / c2.w;
  vec2 dir = (s2 - s1) * uRes; float l = length(dir); dir = l > 1e-5 ? dir / l : vec2(1.0, 0.0);
  vec2 nS = vec2(-dir.y, dir.x);
  float t = haux.x;
  float wcm = uWidth * mix(1.0, 0.35, t) * (0.7 + 0.6 * haux.z);
  float pxPerCm = projectionMatrix[1][1] * uRes.y * 0.5 / max(1.0, -mv.z);
  float wpx = wcm * pxPerCm;
  // 아주 가는 가닥도 최소 0.8px 폭으로 그려 MSAA 샘플에 걸리게 해요.
  // (alpha-to-coverage는 같은 알파면 같은 샘플만 덮어서 겹쳐도 진해지지 않으므로, 몸통 알파는 1로 둬요)
  float drawPx = max(wpx, 0.8);
  vCov = clamp(wpx / drawPx * 1.6, 0.0, 1.0);
  float side = haux.y * 2.0 - 1.0;
  c1.xy += nS * side * drawPx / uRes * c1.w;
  gl_Position = c1;
  vT = T; vN = normalize(normalMatrix * hnrm.xyz); vV = normalize(-mv.xyz);
  vAux = haux; vEdge = htan.w; vLayer = hnrm.w;
}`;
const STRAND_FS = /* glsl */`
uniform vec3 uColor; uniform vec3 uLightDir; uniform float uExposure; uniform float uAmb; uniform float uOpacity;
varying vec3 vT; varying vec3 vN; varying vec3 vV; varying vec4 vAux; varying float vCov; varying float vEdge; varying float vLayer;
float kk(vec3 T, vec3 H, float e){ float d = dot(T, H); return pow(sqrt(max(0.0, 1.0 - d * d)), e); }
void main(){
  float t = vAux.x, seed = vAux.z, ao = vAux.w;
  vec3 T = normalize(vT), N = normalize(vN), V = normalize(vV), L = normalize(uLightDir);
  vec3 H = normalize(L + V);
  float sh = (seed - 0.5) * 0.24;
  float s1 = kk(normalize(T + N * (0.12 + sh)), H, 220.0);          // 1차 반사: 좁고 하얀 윤기
  float s2 = kk(normalize(T + N * (-0.10 + sh)), H, 34.0);          // 2차 반사: 머리색이 섞인 넓은 반사
  float ndl = dot(N, L);
  float wrap = clamp(ndl * 0.55 + 0.45, 0.0, 1.0);
  float tl = dot(T, L); float kd = sqrt(max(0.0, 1.0 - tl * tl));
  float diff = wrap * mix(0.55, 1.0, kd);
  vec3 base = uColor * (0.72 + 0.56 * seed);
  base *= mix(0.42, 1.0, smoothstep(0.0, 0.38, t));                 // 뿌리는 어둡게
  base *= mix(1.0, 1.35, t * t);                                     // 끝은 옅게
  float self = ao * mix(0.5, 1.0, smoothstep(-0.35, 0.45, ndl));      // 안쪽 층·아랫면 그림자
  vec3 col = base * (uAmb + diff) * self;
  float glint = 0.65 + 0.35 * sin(seed * 157.0 + t * 37.0);
  vec3 warm = min(uColor * 5.0, vec3(0.35)) + vec3(0.025, 0.02, 0.016); // 밝은 색일수록 과하게 붉어지지 않게
  col += (s1 * 0.13 + s2 * 0.55 * glint * warm) * self * smoothstep(0.02, 0.2, t);
  col *= uExposure;
  float a = vCov * uOpacity;
  a *= 1.0 - smoothstep(0.8, 1.0, t) * 0.9;                           // 끝은 가늘고 투명하게
  a *= mix(1.0, smoothstep(0.0, 0.22, t) * 0.85 + 0.15, vEdge);       // 헤어라인 뿌리는 옅게 → 이마와 섞임
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
  float contact = (1.0 - smoothstep(0.0, 1.2, -dy)) * step(dy, 0.0) * 0.35;
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
    side: THREE.FrontSide, transparent: true, depthWrite: true,
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
