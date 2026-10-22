// AR 가발 체험 데모 — 화면 흐름, 카메라·사진 입력, MediaPipe 추적, three.js 렌더링을 묶어요.
import * as THREE from 'three';
import { FilesetResolver, FaceLandmarker, ImageSegmenter } from 'tasks-vision';
import { OneEuro } from './filter.js';
import { buildOccluder, HEAD } from './head.js';
import { STYLES, buildWig, buildCapAndShadow, strandMaterial, capMaterial, faceShadowMaterial, LIGHT } from './hair.js';

const MP_VER = '0.10.35';
const WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VER}/wasm`;
const FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const HAIR_MODEL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/hair_segmenter/float32/1/hair_segmenter.tflite';

export const PHOTOS = [
  { label: '정면', who: 'Imansyah Muhamad Putera', page: 'https://unsplash.com/photos/n4KewLKFOZw', src: 'https://images.unsplash.com/photo-1542909168-82c3e7fdca5c?w=1080&q=80&fm=jpg&fit=max' },
  { label: '옆 58°', who: 'Blake Wisz', page: 'https://unsplash.com/photos/NBRaVN4Py_A', src: 'https://images.unsplash.com/photo-1761426822041-c4a801baffc6?w=1080&q=80&fm=jpg&fit=max' },
  { label: '옆 30°', who: 'OSPAN ALI', page: 'https://unsplash.com/photos/6xv4A1VA1rU', src: 'https://images.unsplash.com/photo-1601412436009-d964bd02edbc?w=1080&q=80&fm=jpg&fit=max' },
];

const $ = s => document.querySelector(s);
const params = new URLSearchParams(location.search);
const state = {
  mode: null, styleIdx: 0, colorIdx: 0, gender: 'm', dim: params.get('dim') !== '0', compare: false,
  debug: params.get('debug') !== '0', mesh: params.get('mesh') === '1', mirror: false,
  photoIdx: 2, fov: 63, fit: 1, faceSeen: 0, lastFaceT: 0, yaw: 0, ready: false,
};
window.__state = state;

// ── 렌더러와 장면 ─────────────────────────────────────────
const stage = $('#stage');
const canvas = $('#gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
renderer.setPixelRatio(Math.min(2, Math.max(window.devicePixelRatio || 1, 1.5))); // PC(1배)도 1.5배로 그려 가닥이 덜 깨지게
renderer.autoClear = false;
renderer.setClearColor(0x111418, 1);

const camera = new THREE.PerspectiveCamera(63, 1, 1, 4000);
// MediaPipe는 세로 화각 63°를 가정하고 머리 위치를 계산해요. 실제 렌즈가 더 좁으면(웹캠·인물 사진)
// 뒤통수가 너무 작게 보이므로, 얼굴 크기·위치는 그대로 두고 거리(z)만 늘려 원근을 렌즈에 맞춰요.
const MP_FOV = 63;
function lensFov() {
  if (params.get('fov')) return +params.get('fov');
  if (state.mode === 'photo') return 26;             // 인물 사진은 대개 망원 렌즈
  return src && src.h > src.w ? 63 : 45;             // 휴대폰 세로 전면 카메라 ≈ 63°, 가로 웹캠 ≈ 45°
}
const scene = new THREE.Scene();
const head = new THREE.Group(); head.matrixAutoUpdate = false; head.visible = false; scene.add(head);

// 배경(영상 + 내 머리 흐림)
const bgScene = new THREE.Scene(); const bgCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
let maskTex = new THREE.DataTexture(new Uint8Array(4), 2, 2, THREE.RedFormat); maskTex.needsUpdate = true;
const bgMat = new THREE.ShaderMaterial({
  uniforms: { tSrc: { value: null }, tMask: { value: maskTex }, uRect: { value: new THREE.Vector4(0, 0, 1, 1) }, uDim: { value: 0 }, uAspect: { value: new THREE.Vector2(1, 1) }, uFace: { value: new THREE.Vector4(0.5, 0.5, 0.01, 0.01) }, uJaw: { value: new THREE.Vector4(0.5, 0.5, 0.001, 0.001) }, uHead: { value: new THREE.Vector4(0.5, 0.5, 0.001, 0.001) } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tSrc; uniform sampler2D tMask; uniform vec4 uRect; uniform float uDim; uniform vec2 uAspect; uniform vec4 uFace; uniform vec4 uJaw; uniform vec4 uHead; varying vec2 vUv;
    float maskAt(vec2 uv){ return texture2D(tMask, vec2(uv.x, 1.0 - uv.y)).r; }
    void main(){
      vec2 uv = uRect.xy + vUv * uRect.zw;
      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { gl_FragColor = vec4(0.067, 0.078, 0.094, 1.0); return; }
      vec3 c = texture2D(tSrc, uv).rgb;
      if (uDim > 0.001) {
        // 마스크를 두 겹으로 넓혀서(팽창) 잔머리·가장자리의 옅은 윤곽까지 덮어요.
        float fdp = length((uv - uFace.xy) / uFace.zw);
        float faceOK = 1.0 - smoothstep(0.95, 1.25, fdp);
        float hdp = length((uv - uHead.xy) / uHead.zw);          // 가발 두상의 화면 윤곽(타원) 기준 거리
        float headOut = smoothstep(0.98, 1.08, hdp);              // 두상 윤곽 밖(원래 머리가 더 부풀었던 곳)
        float md = maskAt(uv), mo = 0.0;
        for (int k = 0; k < 8; k++) {
          float a = float(k) * 0.7854; vec2 d = vec2(cos(a), sin(a)) * uAspect;
          md = max(md, maskAt(uv + d * 0.01));
          mo = max(mo, maskAt(uv + d * 0.026));
        }
        md = max(md, mo * 0.85 * max(1.0 - faceOK, headOut)); // 넓은 팽창은 얼굴 밖(머리 윗부분·뒤·두상 밖)에서만
        float m = smoothstep(0.06, 0.5, md);
        m *= smoothstep(0.85, 1.15, length((uv - uJaw.xy) / uJaw.zw)); // 수염·턱은 머리카락으로 보지 않아요
        if (m > 0.002) {
          // 주변의 '머리카락이 아닌' 색을 넓게 모아 채워요(간단한 인페인팅).
          // 얼굴 가까운 곳(관자놀이·구레나룻)은 피부색도 쓰고, 먼 곳은 배경·옷 색만 써요.
          // 두상 윤곽 밖은 두상에서 더 먼 쪽(배경) 색만 써서, 이마 피부색이 번진 밝은 테두리가 안 생겨요.
          // 머리카락 가장자리(역광에 밝게 빛나는 잔머리, 마스크 0.01~0.14)도 채울 색에서 빼요 → 흰 윤곽 방지.
          vec3 acc = vec3(0.0); float ws = 0.0;
          for (int ring = 1; ring <= 4; ring++) {
            float r = 0.006 + float(ring * ring) * 0.0072; // 0.013·0.035·0.071·0.121 — 바로 옆 색을 주로 써서 경계에 밝은 띠·후광이 안 생기게
            for (int k = 0; k < 10; k++) {
              float a = (float(k) + float(ring) * 0.37) * 0.6283;
              vec2 o = clamp(uv + vec2(cos(a), sin(a)) * r * uAspect, 0.0, 1.0);
              float fd = length((o - uFace.xy) / uFace.zw);
              float inFace = 1.0 - smoothstep(0.95, 1.2, fd);
              // 두상 밖에서는 바깥쪽 샘플만, 그리고 얼굴·귀(밝은 피부) 근처 샘플은 빼요 → 귀 위 흰 얼룩 방지
              float outward = smoothstep(0.0, 0.1, length((o - uHead.xy) / uHead.zw) - hdp) * smoothstep(1.15, 1.45, fd);
              float inward = smoothstep(0.0, 0.1, fdp - fd);   // 얼굴 가운데 쪽 샘플(피부)
              float w = (1.0 - smoothstep(0.01, 0.14, maskAt(o))) * mix(1.0, faceOK, inFace)
                      * mix(mix(1.0, inward, faceOK * 0.85), outward, headOut) / float(ring);
              acc += texture2D(tSrc, o).rgb * w; ws += w;
            }
          }
          vec3 bl = vec3(0.0);
          for (int k = 0; k < 8; k++) { float a = float(k) * 0.7854; bl += texture2D(tSrc, uv + vec2(cos(a), sin(a)) * 0.014 * uAspect).rgb; }
          bl /= 8.0;
          vec3 fill = mix(bl * 0.6, acc / max(ws, 1e-3), smoothstep(0.1, 0.6, ws));
          // 두상 안이지만 얼굴 밖(관자놀이·귀 위·옆머리 자리)은 빛이 덜 닿는 옆면이라 조금 어둡게 → 흰 테두리 대신 그늘
          fill *= 1.0 - 0.3 * (1.0 - faceOK) * (1.0 - headOut);
          fill *= 1.0 - 0.12 * headOut * (1.0 - smoothstep(1.0, 1.3, hdp)); // 두상 바로 바깥은 살짝 어둡게(뒤에서 비친 밝은 후광 줄이기)
          c = mix(c, fill, m * uDim * 0.95);
        }
      }
      gl_FragColor = vec4(c, 1.0);
    }`,
  depthTest: false, depthWrite: false,
});
bgScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bgMat));

// 가림막·그림자·머리카락
const occluder = buildOccluder(); occluder.children.forEach(m => m.renderOrder = 2); head.add(occluder);
// 가발 크기 맞춤: 얼굴 가림막은 그대로 두고, 가발·두개골·목만 두개골 중심 기준으로 키우거나 줄여요.
const wigGroup = new THREE.Group(); head.add(wigGroup);
const [, skullOcc, neckOcc] = occluder.children; wigGroup.add(skullOcc, neckOcc);
function setFit(f) { state.fit = f; wigGroup.scale.setScalar(f); wigGroup.position.copy(HEAD.c).multiplyScalar(1 - f); dirty = true; }
const strandMat = strandMaterial(), capMat = capMaterial(), shadowMat = faceShadowMaterial();
const capMesh = new THREE.Mesh(new THREE.BufferGeometry(), capMat); capMesh.renderOrder = 1; wigGroup.add(capMesh);
const shadowMesh = new THREE.Mesh(new THREE.BufferGeometry(), shadowMat); shadowMesh.renderOrder = 3; head.add(shadowMesh);
const hairMesh = new THREE.Mesh(new THREE.BufferGeometry(), strandMat); hairMesh.renderOrder = 4; hairMesh.frustumCulled = false; wigGroup.add(hairMesh);
const meshLines = new THREE.LineSegments(new THREE.WireframeGeometry(occluder.userData.faceGeometry), new THREE.LineBasicMaterial({ color: 0x4f8bff, transparent: true, opacity: 0.55, depthTest: false }));
meshLines.renderOrder = 9; meshLines.visible = state.mesh; head.add(meshLines);
// 확인용: ?hide=cap,hair,shadow,occ / ?skull=1
const hide = (params.get('hide') || '').split(',');
if (hide.includes('cap')) capMesh.visible = false;
if (params.get('capdebug')) { capMat.defines = { CAP_DEBUG: 1 }; capMat.needsUpdate = true; }
if (params.get('capside')) capMat.side = params.get('capside') === 'back' ? THREE.BackSide : THREE.DoubleSide;
if (hide.includes('hair')) hairMesh.visible = false;
if (hide.includes('shadow')) shadowMesh.visible = false;
if (hide.includes('occ')) occluder.visible = false;
if (params.get('skull') === '1') { const sk = skullOcc; const w = new THREE.LineSegments(new THREE.WireframeGeometry(sk.geometry), new THREE.LineBasicMaterial({ color: 0xff5050, transparent: true, opacity: 0.5, depthTest: false })); w.scale.copy(sk.scale); w.position.copy(sk.position); w.renderOrder = 9; wigGroup.add(w); }

const wigCache = new Map();
function wigFor(style) {
  if (!wigCache.has(style.id)) {
    const t0 = performance.now();
    const wig = buildWig(style);
    const { capGeo, faceShadowGeo } = buildCapAndShadow(wig);
    wig.ms = performance.now() - t0;
    wigCache.set(style.id, { wig, capGeo, faceShadowGeo });
  }
  return wigCache.get(style.id);
}
function applyStyle() {
  const style = STYLES[state.styleIdx];
  const w = wigFor(style);
  hairMesh.geometry = w.wig.geo; capMesh.geometry = w.capGeo; shadowMesh.geometry = w.faceShadowGeo;
  const col = new THREE.Color(style.colors[state.colorIdx] || style.colors[0]);
  strandMat.uniforms.uColor.value.copy(col); capMat.uniforms.uColor.value.copy(col);
  strandMat.uniforms.uWidth.value = style.width;
  state.strands = w.wig.strandCount; state.buildMs = Math.round(w.wig.ms);
  renderUI(); dirty = true;
}

// ── 화면 크기·자르기 ──────────────────────────────────────
let src = null; // { el, w, h, tex, kind }
let view = { offX: 0, offY: 0, visW: 1, visH: 1 };
let focus = null; // 사진 모드: 얼굴 중심(정규화)과 크기
function layout() {
  const vw = stage.clientWidth, vh = stage.clientHeight;
  renderer.setSize(vw, vh, false);
  if (!src) return;
  const W = src.w, H = src.h;
  const cover = Math.max(vw / W, vh / H), contain = Math.min(vw / W, vh / H);
  let s = cover;
  // 가로 웹캠을 세로 화면에 꽉 채우면 너무 확대돼요 → 위아래에 여백을 조금 두고 덜 확대
  if (state.mode === 'camera' && W > H) s = Math.max(contain, cover * 0.62);
  // 사진은 얼굴 폭이 화면 폭의 절반쯤 되게 맞춰요(사진 밖은 어두운 바탕).
  if (focus) s = Math.min(cover * 2.2, (vw * 0.5) / (focus.w * W));
  const visW = vw / s, visH = vh / s;
  let offX = (W - visW) / 2, offY = (H - visH) / 2;
  if (focus) {
    const sheetH = ($('#sheet')?.offsetHeight || 0) + 60;
    const targetY = Math.max(0.3, (vh - sheetH) / vh * 0.5); // 얼굴을 아래 목록 위 공간의 가운데에
    offX = focus.cx * W - visW / 2;
    offY = focus.cy * H - visH * targetY;
    if (visW <= W) offX = Math.min(W - visW, Math.max(0, offX));
    if (visH <= H) offY = Math.min(H - visH, Math.max(0, offY));
  }
  view = { offX, offY, visW, visH };
  camera.aspect = W / H; camera.fov = state.fov = lensFov();
  camera.setViewOffset(W, H, offX, offY, visW, visH);
  camera.updateProjectionMatrix();
  bgMat.uniforms.uRect.value.set(offX / W, 1 - (offY + visH) / H, visW / W, visH / H);
  bgMat.uniforms.uAspect.value.set(H / W, 1);
  const db = renderer.getDrawingBufferSize(new THREE.Vector2());
  strandMat.uniforms.uRes.value.copy(db);
  canvas.classList.toggle('mirror', state.mirror);
  dirty = true;
}
new ResizeObserver(() => layout()).observe(stage);
new ResizeObserver(() => { $('#scr-try').style.setProperty('--sheet-h', $('#sheet').offsetHeight + 'px'); }).observe($('#sheet'));

// ── MediaPipe ─────────────────────────────────────────────
let landmarker = null, segmenter = null, mpMode = null, mpLoading = null;
async function loadModels() {
  if (mpLoading) return mpLoading;
  mpLoading = (async () => {
    setLoading(true, 'AI 모델을 불러오고 있어요', '처음 한 번만 받아요 (약 16MB)');
    const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
    const make = async (delegate) => {
      const lm = await FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: FACE_MODEL, delegate }, runningMode: 'VIDEO', numFaces: 1,
        outputFacialTransformationMatrixes: true, outputFaceBlendshapes: false,
        minFaceDetectionConfidence: 0.5, minFacePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
      });
      const sg = await ImageSegmenter.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: HAIR_MODEL, delegate }, runningMode: 'IMAGE', outputCategoryMask: false, outputConfidenceMasks: true,
      });
      return [lm, sg];
    };
    try { [landmarker, segmenter] = await make('GPU'); state.delegate = 'GPU'; }
    catch (e) { console.warn('GPU 위임 실패, CPU로 전환', e); [landmarker, segmenter] = await make('CPU'); state.delegate = 'CPU'; }
    mpMode = 'VIDEO';
  })();
  mpLoading.catch(() => { mpLoading = null; }); // 받기에 실패하면 다음에 다시 시도
  return mpLoading;
}
async function setMpMode(m) { if (mpMode !== m) { await landmarker.setOptions({ runningMode: m }); mpMode = m; } }

// ── 자세(pose) 필터 ───────────────────────────────────────
const posF = new OneEuro(3, { minCutoff: 1.2, beta: 0.06, dCutoff: 1.0 });
const rotF = new OneEuro(4, { minCutoff: 1.6, beta: 1.2, dCutoff: 1.0 });
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _prevQ = new THREE.Quaternion();
const _e = new THREE.Euler();
function applyPose(data, tSec, smooth) {
  _m.fromArray(data); _m.decompose(_p, _q, _s);
  const k = Math.tan(THREE.MathUtils.degToRad(state.fov / 2)) / Math.tan(THREE.MathUtils.degToRad(MP_FOV / 2));
  _p.z /= k;
  if (smooth) {
    if (_q.dot(_prevQ) < 0) { _q.x *= -1; _q.y *= -1; _q.z *= -1; _q.w *= -1; }
    const p = posF.filter([_p.x, _p.y, _p.z], tSec), q = rotF.filter([_q.x, _q.y, _q.z, _q.w], tSec);
    _p.set(p[0], p[1], p[2]); _q.set(q[0], q[1], q[2], q[3]).normalize();
  } else { posF.reset(); rotF.reset(); }
  _prevQ.copy(_q);
  head.matrix.compose(_p, _q, _s.set(1, 1, 1));
  head.matrixWorldNeedsUpdate = true;
  _e.setFromQuaternion(_q, 'YXZ');
  state.yaw = THREE.MathUtils.radToDeg(_e.y); state.pitch = THREE.MathUtils.radToDeg(_e.x);
}

// 얼굴 영역(텍스처 좌표) — 머리 흐림이 피부색을 끌어오지 않게
function setFaceRegion(lm) {
  let x0 = 1, x1 = 0, y0 = 1, y1 = 0;
  for (let i = 0; i < lm.length; i += 3) { const p = lm[i]; if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y; }
  bgMat.uniforms.uFace.value.set((x0 + x1) / 2, 1 - (y0 + y1) / 2, (x1 - x0) / 2 * 1.08, (y1 - y0) / 2 * 1.12);
  // 코끝 아래 ~ 턱 아래까지(수염 자리)
  const nose = lm[1], chin = lm[152], h = chin.y - nose.y;
  bgMat.uniforms.uJaw.value.set((x0 + x1) / 2, 1 - (nose.y + h * 0.8), Math.max(0.02, (x1 - x0) * 0.62), Math.max(0.02, h * 1.1));
}
// 얼굴 밝기·빛 방향 추정 (가발 밝기를 장면에 맞춰요)
const probe = document.createElement('canvas'); probe.width = probe.height = 24;
const probeCtx = probe.getContext('2d', { willReadFrequently: true });
function estimateLight(lm) {
  let x0 = 1, x1 = 0, y0 = 1, y1 = 0;
  for (const i of [10, 234, 454, 152, 67, 297]) { const p = lm[i]; x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
  const W = src.w, H = src.h;
  const bx = x0 * W, by = (y0 + (y1 - y0) * 0.15) * H, bw = (x1 - x0) * W, bh = (y1 - y0) * 0.55 * H;
  if (bw < 8 || bh < 8) return;
  try { probeCtx.drawImage(src.el, bx, by, bw, bh, 0, 0, 24, 24); } catch { return; }
  const d = probeCtx.getImageData(0, 0, 24, 24).data;
  let L = 0, Lr = 0, Ll = 0;
  for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) {
    const i = (y * 24 + x) * 4, l = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
    L += l; if (x < 12) Ll += l; else Lr += l;
  }
  L /= 576; Ll /= 288; Lr /= 288;
  const ex = Math.min(1.3, Math.max(0.62, 0.45 + 0.95 * L));
  const lx = Math.max(-0.55, Math.min(0.55, (Lr - Ll) / Math.max(0.05, L) * 1.2));
  LIGHT.uExposure.value += (ex - LIGHT.uExposure.value) * (state.mode === 'photo' ? 1 : 0.2);
  const dir = new THREE.Vector3(lx, 0.78, 0.55).normalize();
  LIGHT.uLightDir.value.lerp(dir, state.mode === 'photo' ? 1 : 0.2).normalize();
  state.light = { L: +L.toFixed(2), lx: +lx.toFixed(2), ex: +ex.toFixed(2) };
}

// 머리카락 분할 마스크
const segCanvas = document.createElement('canvas');
const segCtx = segCanvas.getContext('2d', { willReadFrequently: false });
let maskData = null;
let blurTmp = null;
// 마스크를 가로·세로로 한 번씩 부드럽게(상자 흐림) → 가장자리 계단 무늬가 안 생겨요.
function boxBlur(f, w, h, r) {
  if (!blurTmp || blurTmp.length !== f.length) blurTmp = new Float32Array(f.length);
  const t = blurTmp, k = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    const o = y * w; let acc = 0;
    for (let x = -r; x <= r; x++) acc += f[o + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) { t[o + x] = acc * k; acc += f[o + Math.min(w - 1, x + r + 1)] - f[o + Math.max(0, x - r)]; }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += t[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) { f[y * w + x] = acc * k; acc += t[Math.min(h - 1, y + r + 1) * w + x] - t[Math.max(0, y - r) * w + x]; }
  }
}
function runSegmentation(blend) {
  const t0 = performance.now();
  const w = state.mode === 'photo' ? 512 : 320, h = Math.max(4, Math.round(w * src.h / src.w));
  if (segCanvas.width !== w || segCanvas.height !== h) { segCanvas.width = w; segCanvas.height = h; }
  segCtx.drawImage(src.el, 0, 0, w, h);
  segmenter.segment(segCanvas, res => {
    const m = res.confidenceMasks[res.confidenceMasks.length - 1];
    const f = m.getAsFloat32Array().slice();
    boxBlur(f, w, h, Math.round(w / 160));
    if (!maskData || maskData.length !== w * h || maskTex.image.width !== w) {
      maskData = new Uint8Array(w * h);
      maskTex.dispose();
      maskTex = new THREE.DataTexture(maskData, w, h, THREE.RedFormat, THREE.UnsignedByteType);
      maskTex.minFilter = maskTex.magFilter = THREE.LinearFilter; maskTex.flipY = false;
      bgMat.uniforms.tMask.value = maskTex; blend = false;
    }
    for (let i = 0; i < f.length; i++) { const v = f[i] * 255; maskData[i] = blend ? (maskData[i] + v) * 0.5 : v; }
    maskTex.needsUpdate = true;
  });
  state.segMs = Math.round(performance.now() - t0);
}

// ── 입력: 카메라 ─────────────────────────────────────────
let stream = null;
const video = document.createElement('video'); video.playsInline = true; video.muted = true; video.setAttribute('playsinline', '');
async function startCamera() {
  state.mode = 'camera'; state.mirror = true; focus = null; renderUI();
  showError(null);
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('이 브라우저는 카메라를 지원하지 않아요.'), { name: 'NotSupported' });
    const camP = navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    const [s] = await Promise.all([camP, loadModels()]);
    stream = s; video.srcObject = s; await video.play();
    await setMpMode('VIDEO');
    const tex = new THREE.VideoTexture(video); tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = false;
    setSource({ el: video, w: video.videoWidth, h: video.videoHeight, tex, kind: 'video' });
    setLoading(false);
  } catch (e) {
    setLoading(false);
    const msg = e.name === 'NotAllowedError' ? '카메라 권한이 꺼져 있어요. 브라우저 주소창의 카메라 설정에서 허용해 주세요.'
      : e.name === 'NotFoundError' ? '이 기기에서 카메라를 찾지 못했어요.'
      : e.name === 'NotSupported' ? e.message : '카메라를 켜지 못했어요. (' + (e.message || e.name) + ')';
    showError(msg);
  }
}
function stopCamera() { if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; } }

// ── 입력: 사진 ───────────────────────────────────────────
async function startPhoto(i = state.photoIdx, file = null) {
  stopCamera();
  state.mode = 'photo'; state.mirror = false; state.photoIdx = i; renderUI();
  showError(null);
  try {
    const img = new Image(); img.crossOrigin = 'anonymous';
    const testSrc = params.get('src'); // 확인용: images.unsplash.com 주소만 허용
    img.src = file ? URL.createObjectURL(file) : (testSrc && /^https:\/\/images\.unsplash\.com\//.test(testSrc) && i === -2) ? testSrc : PHOTOS[i].src;
    setLoading(true, '사진을 불러오고 있어요');
    await Promise.all([img.decode(), loadModels()]);
    setLoading(true, '얼굴과 머리카락을 찾고 있어요');
    await setMpMode('IMAGE');
    const tex = new THREE.Texture(img); tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = false; tex.needsUpdate = true;
    const t0 = performance.now();
    const r = landmarker.detect(img);
    state.faceMs = Math.round(performance.now() - t0);
    setSource({ el: img, w: img.naturalWidth, h: img.naturalHeight, tex, kind: 'image' }, true);
    state.credit = file || i < 0 ? null : PHOTOS[i];
    if (r.faceLandmarks.length) {
      const lm = r.faceLandmarks[0];
      let x0 = 1, x1 = 0, y0 = 1, y1 = 0; for (const p of lm) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
      focus = { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 - (y1 - y0) * 0.12, w: x1 - x0 };
      applyPose(r.facialTransformationMatrixes[0].data, 0, false);
      estimateLight(lm); setFaceRegion(lm);
      head.visible = true; state.faceSeen++; state.lastFaceT = performance.now();
    } else { focus = null; head.visible = false; }
    runSegmentation(false);
    layout(); renderUI();
    setLoading(false);
    dirty = true; state.ready = true;
  } catch (e) {
    console.error(e); setLoading(false);
    showError('사진을 불러오지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요.');
  }
}

function setSource(s, isPhoto = false) {
  if (src && src.tex) src.tex.dispose();
  src = s; bgMat.uniforms.tSrc.value = s.tex;
  if (!isPhoto) focus = null;
  maskData = null;
  layout();
}

// ── 메인 루프 ─────────────────────────────────────────────
let dirty = true, frames = 0, fpsT = performance.now(), lastVideoT = -1, segTick = 0, lightTick = 0, slowSec = 0;
function loop(now) {
  requestAnimationFrame(loop);
  frames++;
  if (now - fpsT > 1000) {
    state.fps = Math.round(frames * 1000 / (now - fpsT)); frames = 0; fpsT = now; renderDebug();
    // 느린 휴대폰: 3초 연속 22fps 아래면 해상도를 낮춰요.
    if (state.mode === 'camera' && state.fps < 22 && renderer.getPixelRatio() > 1) { if (++slowSec >= 3) { renderer.setPixelRatio(Math.max(1, renderer.getPixelRatio() - 0.5)); layout(); slowSec = 0; } }
    else slowSec = 0;
  }
  if (!src) return;
  if (state.mode === 'camera' && landmarker && mpMode === 'VIDEO' && video.readyState >= 2 && video.currentTime !== lastVideoT) {
    lastVideoT = video.currentTime;
    const t0 = performance.now();
    const r = landmarker.detectForVideo(video, now);
    state.faceMs = Math.round(performance.now() - t0);
    if (r.faceLandmarks.length) {
      applyPose(r.facialTransformationMatrixes[0].data, now / 1000, true);
      if (!head.visible) state.faceSeen++;
      head.visible = true; state.lastFaceT = now;
      if (++lightTick % 15 === 1) estimateLight(r.faceLandmarks[0]);
      setFaceRegion(r.faceLandmarks[0]);
    } else if (now - state.lastFaceT > 350) { head.visible = false; posF.reset(); rotF.reset(); }
    if (state.dim && segmenter && ++segTick % 3 === 0) runSegmentation(true);
    dirty = true;
  }
  if (!dirty) return;
  dirty = false;
  draw();
  renderYaw();
}
// 가발 두상(타원체)이 화면(영상 텍스처 좌표)에서 차지하는 타원 — 내 머리 흐림이 두상 밖에서는 배경색만 쓰게
const SKULL_PTS = Array.from({ length: 160 }, (_, i) => {
  const z = 1 - 2 * (i + 0.5) / 160, r = Math.sqrt(1 - z * z), a = i * 2.39996;
  return new THREE.Vector3(HEAD.c.x + HEAD.r.x * r * Math.cos(a), HEAD.c.y + HEAD.r.y * z, HEAD.c.z + HEAD.r.z * r * Math.sin(a));
});
const _hv = new THREE.Vector3();
function setHeadRegion() {
  if (!head.visible) return;
  head.updateMatrixWorld(true); camera.updateMatrixWorld();
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (const p of SKULL_PTS) {
    _hv.copy(p).applyMatrix4(wigGroup.matrixWorld).project(camera);
    x0 = Math.min(x0, _hv.x); x1 = Math.max(x1, _hv.x); y0 = Math.min(y0, _hv.y); y1 = Math.max(y1, _hv.y);
  }
  const R = bgMat.uniforms.uRect.value, U = v => (v * 0.5 + 0.5);
  const u0 = R.x + U(x0) * R.z, u1 = R.x + U(x1) * R.z, v0 = R.y + U(y0) * R.w, v1 = R.y + U(y1) * R.w;
  bgMat.uniforms.uHead.value.set((u0 + u1) / 2, (v0 + v1) / 2, Math.max(0.001, (u1 - u0) / 2), Math.max(0.001, (v1 - v0) / 2));
}
function draw() {
  bgMat.uniforms.uDim.value = state.dim && !state.compare && maskData ? 1 : 0;
  if (bgMat.uniforms.uDim.value) setHeadRegion();
  head.visible = head.visible && !!src;
  const show = head.visible && !state.compare;
  renderer.clear();
  renderer.render(bgScene, bgCam);
  if (show) {
    const vis = head.visible; meshLines.visible = state.mesh;
    renderer.render(scene, camera);
    head.visible = vis;
  }
}
requestAnimationFrame(loop);

// ── 촬영 ─────────────────────────────────────────────────
let lastShot = null;
function capture() {
  draw();
  const out = document.createElement('canvas'); out.width = canvas.width; out.height = canvas.height;
  const g = out.getContext('2d');
  if (state.mirror) { g.translate(out.width, 0); g.scale(-1, 1); }
  g.drawImage(canvas, 0, 0);
  g.setTransform(1, 0, 0, 1, 0, 0);
  const k = out.width / 390;
  g.font = `600 ${Math.round(12 * k)}px Pretendard, system-ui, sans-serif`;
  g.fillStyle = 'rgba(255,255,255,0.9)'; g.shadowColor = 'rgba(0,0,0,0.45)'; g.shadowBlur = 4 * k;
  g.fillText('제안용 데모 · 예시', 14 * k, out.height - 14 * k);
  lastShot = out.toDataURL('image/jpeg', 0.92);
  $('#shot-img').src = lastShot;
  go('result');
}
async function saveShot() {
  if (!lastShot) return;
  const name = `가발체험_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.jpg`;
  try {
    const blob = await (await fetch(lastShot)).blob();
    const file = new File([blob], name, { type: 'image/jpeg' });
    if (navigator.canShare && navigator.canShare({ files: [file] }) && /iPhone|iPad|Android/i.test(navigator.userAgent)) { await navigator.share({ files: [file] }); toast('공유 창에서 "이미지 저장"을 눌러 주세요'); return; }
  } catch (e) { if (e.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = lastShot; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  toast('사진을 저장했어요');
}

// ── 화면 전환과 UI ────────────────────────────────────────
function go(name) {
  document.querySelectorAll('.screen').forEach(s => s.hidden = s.id !== 'scr-' + name);
  if (name === 'try') requestAnimationFrame(layout);
}
function setLoading(on, title = '', sub = '') {
  const el = $('#loading'); el.hidden = !on;
  if (on) { $('#loading-title').textContent = title; $('#loading-sub').textContent = sub; }
}
function showError(msg) {
  const el = $('#error'); el.hidden = !msg; if (msg) $('#error-msg').textContent = msg;
}
let toastT = 0;
function toast(msg) { const el = $('#toast'); el.textContent = msg; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => el.hidden = true, 2200); }

function renderUI() {
  // 성별 탭
  document.querySelectorAll('[data-gender]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.gender === state.gender)));
  // 가발 목록
  const list = $('#wig-list');
  list.innerHTML = '';
  STYLES.forEach((s, i) => {
    if (s.gender !== state.gender) return;
    const b = document.createElement('button');
    b.className = 'wig'; b.type = 'button'; b.setAttribute('aria-pressed', String(i === state.styleIdx));
    b.innerHTML = `<span class="wig-thumb">${THUMBS[s.id]}</span><span class="wig-name">${s.name}</span>`;
    b.onclick = () => { state.styleIdx = i; applyStyle(); };
    list.appendChild(b);
  });
  // 색
  const style = STYLES[state.styleIdx];
  document.querySelectorAll('.swatch').forEach((b, i) => {
    b.style.setProperty('--c', style.colors[i]); b.setAttribute('aria-pressed', String(i === state.colorIdx));
  });
  // 사진 목록
  $('#photo-row').hidden = state.mode !== 'photo';
  document.querySelectorAll('.photo-pick').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.i === state.photoIdx && state.mode === 'photo' && !!state.credit)));
  // 스위치들
  $('#btn-dim').setAttribute('aria-pressed', String(state.dim));
  $('#sw-debug').checked = state.debug; $('#sw-mesh').checked = state.mesh;
  $('#debug').hidden = !state.debug;
  const c = $('#credit');
  if (state.mode === 'photo' && state.credit) { c.hidden = false; c.innerHTML = `사진 출처: <a href="${state.credit.page}" target="_blank" rel="noopener">${state.credit.who}</a> · Unsplash`; }
  else c.hidden = true;
  dirty = true;
}
function renderYaw() {
  const el = $('#yaw'); const has = head.visible;
  const y = state.yaw || 0, a = Math.round(Math.abs(y));
  // 카메라: 사용자 본인 기준 왼쪽/오른쪽 (yaw > 0 = 본인 기준 왼쪽으로 돌림). 사진: 각도만.
  const dir = state.mode === 'camera' ? (y > 0 ? '왼쪽 ' : '오른쪽 ') : '고개 ';
  $('#yaw-text').textContent = !has ? '얼굴 찾는 중' : a < 4 ? '정면 0°' : `${dir}${a}°`;
  // 점은 화면에서 얼굴이 향한 쪽으로 움직여요(셀카는 거울처럼 뒤집혀 보이므로 부호를 바꿔요).
  const k = Math.max(-1.1, Math.min(1.1, y / 60)) * (state.mirror ? -1 : 1); // 눈금: ±60° = 7%·93%
  $('#yaw-dot').style.left = `${50 + k * 43}%`;
  el.classList.toggle('side', has && a >= 40);
  const loading = !$('#loading').hidden || !$('#error').hidden;
  const hint = src && !has && !loading ? (state.mode === 'photo' ? '이 사진에서는 얼굴을 찾지 못했어요' : '얼굴을 화면 가운데에 맞춰 주세요') : '';
  $('#hint').hidden = !hint; $('#hint').textContent = hint;
}
function renderDebug() {
  if (!state.debug) return;
  const l2 = [];
  if (state.faceMs != null) l2.push(`얼굴 ${state.faceMs}ms`);
  if (state.dim && state.segMs != null) l2.push(`머리 ${state.segMs}ms`);
  const l3 = [];
  if (state.strands) l3.push(`${(state.strands / 1000).toFixed(1)}천 가닥`);
  if (state.delegate) l3.push(state.delegate);
  $('#debug').innerHTML = [`${state.fps ?? '-'} fps`, l2.join(' · '), l3.join(' · ')].filter(Boolean).join('<br>');
}

// 가발 미리보기 아이콘 (선 1.8px 한 세트)
const HEAD_SVG = '<circle cx="28" cy="31" r="12" fill="#fff" stroke="#9AA3AE" stroke-width="1.8"/>';
const THUMBS = {
  dandy: `<svg viewBox="0 0 56 56" aria-hidden="true">${HEAD_SVG}<path d="M15.5 30c-1-9 5-16 12.5-16s13.5 6 12.5 16c-2-4-5-5.5-8-5.5-3.5 0-6.5 1.6-9.5 1.6-3 0-5.5-.8-7.5 3.9z" fill="var(--hair)"/></svg>`,
  part: `<svg viewBox="0 0 56 56" aria-hidden="true">${HEAD_SVG}<path d="M15.6 31c-1.4-10 5-17.5 12.4-17.5 7.6 0 13.6 6.5 12.4 17.5-1-3-2.2-5-3.6-6.4.4-2.6-.6-4.6-2-5.6-2.4 4.6-9 6.6-15 6.2-1.8.8-3.2 2.8-4.2 5.8z" fill="var(--hair)"/></svg>`,
  long: `<svg viewBox="0 0 56 56" aria-hidden="true"><path d="M14 52c0-6 .6-14 .8-22C15.2 19 21 13 28 13s12.8 6 13.2 17c.2 8 .8 16 .8 22-3.4 1-6.6 1-9.2.4V40c-1.5 1-3.2 1.4-4.8 1.4s-3.3-.4-4.8-1.4v12.4c-2.6.6-5.8.6-9.2-.4z" fill="var(--hair)"/>${HEAD_SVG}<path d="M16 31c0-10 5.4-15.6 12-15.6S40 21 40 31c-2.2-6-6.4-10-12-10.6-5.6.6-9.8 4.6-12 10.6z" fill="var(--hair)"/></svg>`,
  bob: `<svg viewBox="0 0 56 56" aria-hidden="true"><path d="M13.5 40c-.4-4 .2-8 1-12C16 19.6 21.4 14 28 14s12 5.6 13.5 14c.8 4 1.4 8 1 12-2 1.8-4.6 2.4-7 1.6 1.6-2 2-4.4 1.6-7H18.9c-.4 2.6 0 5 1.6 7-2.4.8-5 .2-7-1.6z" fill="var(--hair)"/>${HEAD_SVG}<path d="M16 30c.4-9.4 5.4-14.4 12-14.4S39.6 20.6 40 30c-1.6-3.6-3.8-6-6.6-7.2-1.4 2-4 3-6.4 3s-5-.6-6.6-2.4C18.6 24.6 17 27 16 30z" fill="var(--hair)"/></svg>`,
};

// ── 이벤트 ───────────────────────────────────────────────
$('#btn-camera').onclick = () => { go('try'); startCamera(); };
$('#btn-photo').onclick = () => { go('try'); startPhoto(state.photoIdx >= 0 ? state.photoIdx : 2); };
$('#btn-back').onclick = () => { stopCamera(); src = null; head.visible = false; state.mode = null; go('start'); };
$('#btn-error-photo').onclick = () => startPhoto(2);
$('#btn-error-retry').onclick = () => startCamera();
document.querySelectorAll('[data-gender]').forEach(b => b.onclick = () => {
  state.gender = b.dataset.gender;
  if (STYLES[state.styleIdx].gender !== state.gender) { state.styleIdx = STYLES.findIndex(s => s.gender === state.gender); applyStyle(); }
  else renderUI();
});
document.querySelectorAll('.swatch').forEach((b, i) => b.onclick = () => { state.colorIdx = i; applyStyle(); });
document.querySelectorAll('.photo-pick').forEach(b => b.onclick = () => startPhoto(+b.dataset.i));
$('#file').onchange = e => { const f = e.target.files?.[0]; if (f) { state.photoIdx = -1; startPhoto(-1, f); } e.target.value = ''; };
$('#btn-dim').onclick = () => {
  state.dim = !state.dim;
  if (state.dim && src && segmenter) runSegmentation(false);
  toast(state.dim ? '내 머리카락을 흐리게 했어요' : '내 머리 흐림을 껐어요');
  renderUI();
};
const cmp = $('#btn-compare');
const cmpOn = e => { e.preventDefault(); state.compare = true; cmp.setAttribute('aria-pressed', 'true'); dirty = true; };
const cmpOff = () => { state.compare = false; cmp.setAttribute('aria-pressed', 'false'); dirty = true; };
cmp.addEventListener('pointerdown', cmpOn); ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => cmp.addEventListener(ev, cmpOff));
cmp.addEventListener('keydown', e => { if (e.key === ' ' || e.key === 'Enter') cmpOn(e); }); cmp.addEventListener('keyup', cmpOff);
$('#shutter').onclick = () => { if (!src) return; capture(); };
$('#btn-save').onclick = saveShot;
$('#btn-retake').onclick = () => go('try');
$('#btn-result-back').onclick = () => go('try');
const openSheet = id => { $(id).hidden = false; $(id).querySelector('.modal-sheet').focus(); };
const closeSheets = () => document.querySelectorAll('.modal').forEach(m => m.hidden = true);
document.querySelectorAll('[data-open]').forEach(b => b.onclick = () => openSheet(b.dataset.open));
document.querySelectorAll('.modal').forEach(m => m.addEventListener('click', e => { if (e.target === m || e.target.closest('[data-close]')) closeSheets(); }));
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheets(); });
$('#sw-debug').onchange = e => { state.debug = e.target.checked; renderUI(); renderDebug(); };
$('#sw-mesh').onchange = e => { state.mesh = e.target.checked; renderUI(); };
$('#fit').oninput = e => {
  setFit(+e.target.value / 100); $('#fit-val').textContent = e.target.value + '%'; // 슬라이더가 실제 가발 크기에 반영되게
};
document.querySelectorAll('[data-info]').forEach(b => b.onclick = () => toast(b.dataset.info));

// 처음 상태
state.styleIdx = Math.max(0, STYLES.findIndex(s => s.id === (params.get('wig') || 'long')));
state.gender = STYLES[state.styleIdx].gender;
state.colorIdx = Math.min(2, +(params.get('color') || 0));
if (params.get('fit')) { setFit(+params.get('fit') / 100); $('#fit').value = params.get('fit'); $('#fit-val').textContent = params.get('fit') + '%'; }
applyStyle();
go('start');
if (params.get('mode') === 'photo') { go('try'); startPhoto(params.get('src') ? -2 : +(params.get('photo') ?? 2)); }
if (params.get('mode') === 'camera') { go('try'); startCamera(); }

// 헤드리스 확인용
window.__app = { renderer, camera, strandMat, canvas, state, startPhoto, applyStyle, STYLES, capture, setDim: v => { state.dim = v; if (v && src) runSegmentation(false); renderUI(); }, redraw: () => { dirty = true; }, bench };
// 렌더 시간 재기(헤드리스 확인용): n번 그리고 1px 읽기로 GPU가 끝날 때까지 기다려 프레임당 ms를 돌려줘요.
function bench(n = 30) {
  const gl = renderer.getContext(), px = new Uint8Array(4);
  draw(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const t0 = performance.now();
  for (let i = 0; i < n; i++) { draw(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
  return +((performance.now() - t0) / n).toFixed(2);
}
