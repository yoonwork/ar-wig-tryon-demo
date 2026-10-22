// 시작 화면 3D 미리보기: 마네킹 두상에 체험 화면과 같은 가닥 가발을 씌워 좌우 60°로 천천히 돌려요.
// 카메라 권한이나 AI 모델 없이 바로 보여서, 처음 연 사람이 가발 질감·측면부터 볼 수 있어요. 손가락으로 끌면 돌아가요.
import * as THREE from 'three';
import { HEAD, NECK } from './head.js';
import { strandMaterial, capMaterial, hairShade } from './hair.js';

const MANNEQUIN_VS = /* glsl */`
attribute float ao; attribute float shade;
varying vec3 vN; varying vec3 vV; varying float vY; varying float vAo; varying float vShade;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); vY = position.y; vAo = ao; vShade = shade;
  gl_Position = projectionMatrix * mv;
}`;
const MANNEQUIN_FS = /* glsl */`
uniform vec3 uBase; uniform vec3 uBg; uniform vec3 uKey; uniform vec2 uFade; uniform float uShade;
varying vec3 vN; varying vec3 vV; varying float vY; varying float vAo; varying float vShade;
void main(){
  vec3 N = normalize(vN), V = normalize(vV);
  float key = max(0.0, dot(N, normalize(uKey)));
  float sky = 0.5 + 0.5 * N.y;                                  // 위에서 오는 부드러운 빛
  float rim = pow(1.0 - max(0.0, dot(N, V)), 3.0);
  vec3 col = uBase * (0.34 + 0.5 * key + 0.22 * sky) * mix(0.62, 1.0, vAo);
  col *= 1.0 - vShade * uShade;                                   // 머리카락이 드리운 그림자(이마·목)
  col += vec3(rim * 0.05);
  col = mix(col, uBg, smoothstep(uFade.x, uFade.y, -vY));         // 목 아래는 바탕색으로 사라져요
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

// ── 마네킹 두상(얼굴 없는 매끈한 가발 스탠드 모양) ──────────────────────
// 두개골 타원체(가발을 기른 그 두상) + 턱 + 코 + 목을 부드럽게 합친 거리 함수(SDF)를 만들고,
// 구 격자의 꼭짓점을 중심에서 바깥으로 밀어 표면에 올려요. 법선은 SDF 기울기로 구해 이음매가 없어요.
const smin = (a, b, k) => { const h = Math.max(0, Math.min(1, 0.5 + 0.5 * (b - a) / k)); return b + (a - b) * h - k * h * (1 - h); };
const ell = (x, y, z, cx, cy, cz, rx, ry, rz) => { const qx = (x - cx) / rx, qy = (y - cy) / ry, qz = (z - cz) / rz; return (Math.hypot(qx, qy, qz) - 1) * Math.min(rx, ry, rz); };
function sdf(x, y, z) {
  let d = ell(x, y, z, HEAD.c.x, HEAD.c.y, HEAD.c.z, HEAD.r.x - 0.55, HEAD.r.y - 0.55, HEAD.r.z - 0.55);
  d = smin(d, ell(x, y, z, 0, -3.0, -0.5, 6.3, 7.1, 6.0), 2.4);          // 턱·뺨
  d = smin(d, ell(x, y, z, 0, -0.4, 5.5, 0.9, 2.0, 1.2), 0.8);           // 콧날(아주 살짝)
  const neck = Math.max(Math.hypot(x - NECK.x, (z - NECK.z - 0.4) * 1.1) - 4.3, y + 6.5, -(y + 34));
  return smin(d, neck, 1.8);
}
function buildMannequin() {
  const g = new THREE.SphereGeometry(1, 150, 120);
  const pos = g.attributes.position, nrm = g.attributes.normal, n = pos.count;
  const C = [0, -2, -3.8], ao = new Float32Array(n), e = 0.05;
  for (let i = 0; i < n; i++) {
    const dx = pos.getX(i), dy = pos.getY(i), dz = pos.getZ(i);
    let t0 = 0, t1 = 0.5;
    while (t1 < 60 && sdf(C[0] + dx * t1, C[1] + dy * t1, C[2] + dz * t1) < 0) { t0 = t1; t1 += 0.5; }
    for (let k = 0; k < 14; k++) { const tm = (t0 + t1) / 2; if (sdf(C[0] + dx * tm, C[1] + dy * tm, C[2] + dz * tm) < 0) t0 = tm; else t1 = tm; }
    const x = C[0] + dx * t1, y = C[1] + dy * t1, z = C[2] + dz * t1;
    pos.setXYZ(i, x, y, z);
    const gx = sdf(x + e, y, z) - sdf(x - e, y, z), gy = sdf(x, y + e, z) - sdf(x, y - e, z), gz = sdf(x, y, z + e) - sdf(x, y, z - e);
    const gl = Math.hypot(gx, gy, gz) || 1; nrm.setXYZ(i, gx / gl, gy / gl, gz / gl);
    // 오목한 곳(턱 아래·목 이음새)은 살짝 어둡게: 법선 방향으로 조금 나가서 표면까지 거리 재기
    let occ = 0;
    for (const h of [0.6, 1.4, 2.6]) occ += Math.max(0, h - sdf(x + gx / gl * h, y + gy / gl * h, z + gz / gl * h)) / h;
    ao[i] = Math.max(0, 1 - occ * 0.55);
  }
  g.setAttribute('ao', new THREE.BufferAttribute(ao, 1));
  g.setAttribute('shade', new THREE.BufferAttribute(new Float32Array(n), 1));
  return g;
}

// 스타일별 화면 구도(세로 중심 y, 보여 줄 높이·너비 cm)
const FRAME = { long: { y: -4.5, h: 47, w: 34 }, bob: { y: -1, h: 37, w: 32 }, dandy: { y: 1.5, h: 32, w: 30 }, part: { y: 1.5, h: 32, w: 30 } };
const ease = k => 1 - Math.pow(1 - Math.min(1, Math.max(0, k)), 3);

export function createHero({ canvas, getWig, onYaw, bg = '#ECEFF3' }) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  } catch (e) { console.warn('3D 미리보기를 켤 수 없어요', e); return null; }
  const bgColor = new THREE.Color(bg);
  renderer.setClearColor(bgColor, 1);
  let pr = Math.min(2, Math.max(window.devicePixelRatio || 1, 1.5));
  renderer.setPixelRatio(pr);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(22, 1, 10, 600);
  const pivot = new THREE.Group(); scene.add(pivot);         // 목 축(머리 중심 조금 뒤)을 기준으로 돌려요
  const headG = new THREE.Group(); headG.position.set(0, 0, 4.4); pivot.add(headG);

  // 마네킹(얼굴 없는 가발 스탠드). 가발이 바뀌면 그 가발이 드리우는 그림자를 꼭짓점마다 다시 구워요.
  const mat = new THREE.ShaderMaterial({
    uniforms: { uBase: { value: new THREE.Color('#E6E0D9') }, uBg: { value: bgColor.clone() }, uKey: { value: new THREE.Vector3(-0.45, 0.55, 0.7).normalize() }, uFade: { value: new THREE.Vector2(12, 24) }, uShade: { value: 0.75 } },
    vertexShader: MANNEQUIN_VS, fragmentShader: MANNEQUIN_FS,
  });
  const manGeo = buildMannequin();
  const mannequin = new THREE.Mesh(manGeo, mat); mannequin.renderOrder = 0; headG.add(mannequin);
  const shadeCache = new Map();

  // 가발(체험 화면과 같은 가닥 셰이더). 빛은 체험 화면의 사진 밝기 추정과 따로 써요.
  const ownLight = m => { m.uniforms.uLightDir = { value: new THREE.Vector3(-0.4, 0.72, 0.58).normalize() }; m.uniforms.uExposure = { value: 1.08 }; m.uniforms.uAmb = { value: 0.34 }; };
  const strandMat = strandMaterial(), capMat = capMaterial();
  ownLight(strandMat); ownLight(capMat);
  const capMesh = new THREE.Mesh(new THREE.BufferGeometry(), capMat); capMesh.renderOrder = 1;
  const hairMesh = new THREE.Mesh(new THREE.BufferGeometry(), strandMat); hairMesh.renderOrder = 4; hairMesh.frustumCulled = false;
  headG.add(capMesh, hairMesh);

  // ── 구도·크기 ──
  let frame = { ...FRAME.long }, frameTo = { ...FRAME.long };
  function placeCamera() {
    const a = camera.aspect, vt = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const D = Math.max(frame.h / 2 / vt, frame.w / 2 / (vt * a));
    camera.position.set(0, frame.y + D * 0.07, D);
    camera.lookAt(0, frame.y, 0);
  }
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    strandMat.uniforms.uRes.value.copy(renderer.getDrawingBufferSize(new THREE.Vector2()));
    placeCamera(); dirty = true;
  }
  new ResizeObserver(resize).observe(canvas);

  // ── 가발 바꾸기 (뿌리에서 끝으로 흘러내리며 나타나요) ──
  let growT0 = -1, styleId = null;
  function setStyle(style, color) {
    const w = getWig(style);
    hairMesh.geometry = w.wig.geo; capMesh.geometry = w.capGeo;
    if (!shadeCache.has(style.id)) shadeCache.set(style.id, hairShade(w.wig, manGeo.attributes.position.array, manGeo.attributes.normal.array));
    manGeo.attributes.shade.array.set(shadeCache.get(style.id)); manGeo.attributes.shade.needsUpdate = true;
    strandMat.uniforms.uColor.value.set(color); capMat.uniforms.uColor.value.set(color);
    strandMat.uniforms.uWidth.value = style.width;
    if (style.id !== styleId) { growT0 = performance.now(); styleId = style.id; }
    frameTo = { ...(FRAME[style.id] || FRAME.long) };
    dirty = true;
    return w.wig.strandCount;
  }

  // ── 돌리기: 자동으로 ±60° 왕복, 끌면 손가락을 따라가요 ──
  const AMP = 60, PERIOD = 11;
  let held = false; // 확인용(스크린샷): 각도를 고정
  let phase = 0.35, yaw = 0, target = 0, dragging = false, dragX = 0, dragYaw = 0, lastX = 0, lastT = 0, vel = 0, interacted = false;
  canvas.addEventListener('pointerdown', e => {
    dragging = true; dragX = lastX = e.clientX; lastT = performance.now(); dragYaw = yaw; vel = 0;
    try { canvas.setPointerCapture(e.pointerId); } catch { /* 캔버스 밖으로 나가도 계속 끌리게(안 되면 그냥 진행) */ }
    canvas.classList.add('grabbing');
    if (!interacted) { interacted = true; canvas.dispatchEvent(new CustomEvent('hero-interact', { bubbles: true })); }
  });
  canvas.addEventListener('pointermove', e => {
    if (!dragging) return;
    const now = performance.now();
    target = Math.max(-80, Math.min(80, dragYaw + (e.clientX - dragX) * 0.45));
    if (now > lastT) vel = (e.clientX - lastX) / (now - lastT); lastX = e.clientX; lastT = now;
  });
  const release = () => {
    if (!dragging) return;
    dragging = false; canvas.classList.remove('grabbing');
    // 놓은 자리에서 자동 왕복을 이어 가요(움직이던 방향 그대로)
    const s = Math.max(-1, Math.min(1, target / AMP));
    phase = vel >= 0 ? Math.asin(s) : Math.PI - Math.asin(s);
  };
  canvas.addEventListener('pointerup', release); canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('lostpointercapture', release);

  // ── 그리기 ──
  let running = false, raf = 0, last = 0, dirty = true, slow = 0, fpsN = 0, fpsT = 0;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  function tick(now) {
    if (!running) return;
    raf = requestAnimationFrame(tick);
    const dt = Math.min(0.05, (now - (last || now)) / 1000); last = now;
    if (!dragging && !reduce && !held) { phase += dt * Math.PI * 2 / PERIOD; target = AMP * Math.sin(phase); }
    yaw += (target - yaw) * (1 - Math.exp(-(dragging ? 20 : 6) * dt));
    pivot.rotation.set(0.05, THREE.MathUtils.degToRad(yaw), 0);
    // 구도는 스타일에 맞춰 부드럽게
    let moved = false;
    for (const k of ['y', 'h', 'w']) { const d = frameTo[k] - frame[k]; if (Math.abs(d) > 0.01) { frame[k] += d * (1 - Math.exp(-5 * dt)); moved = true; } }
    if (moved) placeCamera();
    if (growT0 >= 0) {
      const k = Math.max(0, (performance.now() - growT0) / 900);
      strandMat.uniforms.uGrow.value = 0.02 + ease(k) * 1.15;
      capMat.uniforms.uOpacity.value = ease(k * 2.2);
      mat.uniforms.uShade.value = 0.75 * ease(k * 1.4);
      if (k >= 1) { growT0 = -1; strandMat.uniforms.uGrow.value = 2; }
    }
    renderer.render(scene, camera);
    onYaw?.(yaw);
    // 느린 기기: 2초 연속 24fps 아래면 해상도를 낮춰요
    fpsN++; if (now - fpsT > 1000) { const fps = fpsN * 1000 / (now - fpsT); fpsN = 0; fpsT = now; if (fps < 24 && pr > 1) { if (++slow >= 2) { pr = Math.max(1, pr - 0.5); renderer.setPixelRatio(pr); resize(); slow = 0; } } else slow = 0; }
  }
  function start() { if (running) return; running = true; last = 0; fpsT = performance.now(); fpsN = 0; resize(); raf = requestAnimationFrame(tick); }
  function stop() { running = false; cancelAnimationFrame(raf); }
  const pose = deg => { held = deg != null; if (held) yaw = target = deg; };
  return { setStyle, start, stop, pose, renderer, get yaw() { return yaw; } };
}
