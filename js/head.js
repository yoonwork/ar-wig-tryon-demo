// 머리 모양(두상) — MediaPipe 표준 얼굴 좌표계(cm, y 위, +z 얼굴 앞)에 맞춘 근사 모델이에요.
// 얼굴 메시(468점) + 두개골 타원체 + 목 원기둥으로 '보이지 않는 가림막'을 만들고,
// 같은 두상을 기준으로 가발의 머리카락을 심어요.
import * as THREE from 'three';
import { CANON_V, CANON_F } from './canonical.js';

export const HEAD = {
  // 표준 얼굴 좌표는 실제 cm보다 약 1.1배 커요(광대 폭 15.3). 두상도 같은 비율로 잡았어요.
  c: new THREE.Vector3(0, 2.6, -5.1),   // 두개골 타원체 중심
  r: new THREE.Vector3(8.4, 12.3, 10.7) // 반지름 (좌우 16.8, 위아래, 앞뒤 21.4)
};

// 헤어라인: 정면에서 잰 방위각 |φ|(도) → 그 방향의 헤어라인 높이(y, cm)
// 0 = 이마 가운데, 70 전후 = 구레나룻, 74~102 = 귀, 180 = 뒷목
const HAIRLINE = [[0, 10.4], [18, 10.2], [34, 9.6], [48, 8.4], [58, 7.0], [64, 4.4], [68, 2.0], [71, 1.7], [74, 4.4], [80, 5.4], [98, 5.4], [106, 3.2], [116, -0.6], [134, -3.8], [158, -5.4], [180, -5.8]];
export function azimuth(p) { return Math.atan2(p.x, p.z - HEAD.c.z) * 180 / Math.PI; }
export function hairlineY(phiDeg) {
  const a = Math.min(180, Math.abs(phiDeg));
  for (let i = 1; i < HAIRLINE.length; i++) {
    const [a1, y1] = HAIRLINE[i];
    if (a <= a1) { const [a0, y0] = HAIRLINE[i - 1]; const k = (a - a0) / (a1 - a0); return y0 + (y1 - y0) * k; }
  }
  return HAIRLINE[HAIRLINE.length - 1][1];
}
// 귀 영역(헤어라인이 귀 위로 올라가는 곳)인지
export const isEarZone = phiDeg => { const a = Math.abs(phiDeg); return a > 70 && a < 104; };

// ── 타원체 도우미 ──────────────────────────────────────────
const _q = new THREE.Vector3();
// 타원체(반지름 + off)에서 점 p의 정규화 거리 (1이면 표면)
export function ellRho(p, off = 0, c = HEAD.c, r = HEAD.r) {
  return Math.hypot((p.x - c.x) / (r.x + off), (p.y - c.y) / (r.y + off), (p.z - c.z) / (r.z + off));
}
// 중심에서 뻗은 방향으로 표면(반지름 + off)에 올려놓기
export function ellProject(p, off = 0, out = p, c = HEAD.c, r = HEAD.r) {
  const rho = ellRho(p, off, c, r) || 1;
  out.set(c.x + (p.x - c.x) / rho, c.y + (p.y - c.y) / rho, c.z + (p.z - c.z) / rho);
  return out;
}
// 안으로 들어갔으면 밖으로 밀어내기
export function ellPush(p, off = 0, c = HEAD.c, r = HEAD.r) {
  if (ellRho(p, off, c, r) < 1) { ellProject(p, off, p, c, r); return true; }
  return false;
}
export function ellNormal(p, out = new THREE.Vector3(), c = HEAD.c, r = HEAD.r) {
  return out.set((p.x - c.x) / (r.x * r.x), (p.y - c.y) / (r.y * r.y), (p.z - c.z) / (r.z * r.z)).normalize();
}

// 얼굴 아래쪽(턱·뺨), 귀, 목 — 긴 머리가 뚫고 들어가지 않게 밀어내는 몸체들
export const BODIES = [
  { c: new THREE.Vector3(0, -3.6, -0.4), r: new THREE.Vector3(7.3, 7.6, 7.4) },   // 턱·뺨
  { c: new THREE.Vector3(8.2, 1.0, -4.0), r: new THREE.Vector3(1.6, 3.4, 2.4) },  // 왼쪽 귀
  { c: new THREE.Vector3(-8.2, 1.0, -4.0), r: new THREE.Vector3(1.6, 3.4, 2.4) }, // 오른쪽 귀
];
export const NECK = { x: 0, z: -3.8, r: 5.6, top: -5 };
export function pushBodies(p, off = 0.2) {
  for (const b of BODIES) ellPush(p, off, b.c, b.r);
  if (p.y < NECK.top) {
    const dx = p.x - NECK.x, dz = p.z - NECK.z, d = Math.hypot(dx, dz), rr = NECK.r + off;
    if (d < rr && d > 1e-4) { p.x = NECK.x + dx / d * rr; p.z = NECK.z + dz / d * rr; }
  }
}

// ── 가림막(occluder): 색은 안 칠하고 깊이만 써요 ─────────────────
export function buildOccluder() {
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide });
  // 1) 표준 얼굴 메시
  const fg = new THREE.BufferGeometry();
  fg.setAttribute('position', new THREE.BufferAttribute(CANON_V, 3));
  fg.setIndex(new THREE.BufferAttribute(CANON_F, 1));
  const face = new THREE.Mesh(fg, mat); face.renderOrder = 1; group.add(face);
  // 2) 두개골 (살짝 작게: 앞머리·옆머리가 피부 바로 위에서도 보이도록)
  const skull = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 28), mat);
  skull.scale.set(HEAD.r.x - 0.45, HEAD.r.y - 0.45, HEAD.r.z - 0.45); skull.position.copy(HEAD.c);
  skull.renderOrder = 1; group.add(skull);
  // 3) 목
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(NECK.r - 0.3, NECK.r + 0.6, 26, 28, 1, true), mat);
  neck.position.set(NECK.x, NECK.top - 11, NECK.z); neck.renderOrder = 1; group.add(neck);
  // 4) 턱 아래·목 앞(수염 자리) — 옆으로 돌렸을 때 반대쪽 긴 머리가 턱 앞에 보이지 않게
  const chin = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), mat);
  chin.scale.set(5.2, 3.8, 4.8); chin.position.set(0, -10.6, 1.2); chin.renderOrder = 1; group.add(chin);
  // 5) 턱·뺨 (얼굴 메시 바깥 가장자리 보강)
  const jaw = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 20), mat);
  jaw.scale.set(BODIES[0].r.x - 0.6, BODIES[0].r.y - 0.6, BODIES[0].r.z - 0.9); jaw.position.copy(BODIES[0].c);
  jaw.renderOrder = 1; group.add(jaw);
  group.userData.faceGeometry = fg;
  return group;
}

export function canonicalPoint(i, out = new THREE.Vector3()) {
  return out.set(CANON_V[i * 3], CANON_V[i * 3 + 1], CANON_V[i * 3 + 2]);
}
