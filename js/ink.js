'use strict';
// ---------------------------------------------------------------------------
// ink.js — the ballpoint-on-notebook look.
//   InkMaterial : hatched fill; density follows a fixed sun direction
//   PenLines    : screen-space fat lines for crisp geometry edges
//   Hull        : inverted-hull silhouette for round parts (heads, barrels)
//   Canvas art  : faces, sky doodles, blood splats
// Everything shares one paper colour and a few ink colours.
// ---------------------------------------------------------------------------

const INK = {
  paper: '#f4efe2',
  blue: '#2b34b4',
  red: '#d4232b',
  darkred: '#8e1a22',
  orange: '#e98a2c',
  green: '#3ea85a',
  black: '#23232c',
  white: '#fbf9f2',
};
const SUN_DIR = new THREE.Vector3(0.35, 0.9, 0.45).normalize();
// half resolution in pixels, shared by every pen shader (updated on resize)
const HALF_RES = new THREE.Vector2(400, 300);

// ---------------------------------------------------------------- hatch fill
const HATCH_VERT = /* glsl */ `
attribute vec3 aInk;
attribute float aShade;
uniform vec3 uInk;
uniform float uUseAttr;
varying vec3 vWPos;
varying vec3 vNormal;
varying vec3 vInk;
varying float vShade;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWPos = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vInk = mix(uInk, aInk, uUseAttr);
  vShade = aShade * uUseAttr;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const HATCH_FRAG = /* glsl */ `
uniform vec3 uPaper;
uniform vec3 uLight;
uniform float uSolid;
uniform float uOpacity;
uniform float uScale;
uniform float uShade;
uniform float uFlash;
uniform float uAlpha;
varying vec3 vWPos;
varying vec3 vNormal;
varying vec3 vInk;
varying float vShade;

// one family of parallel pen strokes; fades to its average tone when the
// strokes get thinner than a pixel so distant walls read as a flat wash
float lineSet(vec2 p, float ang, float spacing, float width) {
  float c = cos(ang), s = sin(ang);
  float x = p.x * c - p.y * s;
  float y = p.x * s + p.y * c;
  x += sin(y * 9.0) * spacing * 0.07;
  float d = abs(fract(x / spacing) - 0.5) * spacing;
  float fw = fwidth(x);
  float line = 1.0 - smoothstep(width - fw * 0.5, width + fw, d);
  float avg = clamp(2.0 * width / spacing, 0.0, 1.0);
  float crisp = smoothstep(spacing * 0.6, spacing * 0.2, fw);
  return mix(avg, line, crisp);
}

void main() {
  vec3 n = normalize(vNormal);
  vec3 an = abs(n);
  vec2 p;
  if (an.y >= an.x && an.y >= an.z) p = vWPos.xz;
  else if (an.x >= an.z) p = vWPos.zy;
  else p = vWPos.xy;
  p *= uScale;
  float ndl = dot(n, uLight);
  float shade = clamp(0.55 - 0.5 * ndl + uShade + vShade, 0.0, 1.0);
  float sp = 0.26, w = 0.022;
  float h1 = lineSet(p, 0.79, sp, w) * smoothstep(0.17, 0.34, shade);
  float h2 = lineSet(p, -0.79, sp, w) * smoothstep(0.42, 0.62, shade);
  float h3 = lineSet(p, 0.30, sp * 0.7, w) * smoothstep(0.74, 0.92, shade);
  float ink = 1.0 - (1.0 - h1 * 0.8) * (1.0 - h2 * 0.8) * (1.0 - h3 * 0.8);
  ink = max(ink * uOpacity, uSolid);
  vec3 col = mix(uPaper, vInk, ink);
  col = mix(col, vec3(1.0, 0.96, 0.9), uFlash);
  gl_FragColor = vec4(col, uAlpha);
}`;

function makeInk(o = {}) {
  const m = new THREE.ShaderMaterial({
    vertexShader: HATCH_VERT,
    fragmentShader: HATCH_FRAG,
    uniforms: {
      uInk: { value: new THREE.Color(o.ink || INK.blue) },
      uPaper: { value: new THREE.Color(o.paper || INK.paper) },
      uLight: { value: SUN_DIR },
      uSolid: { value: o.solid || 0 },
      uOpacity: { value: o.opacity == null ? 1 : o.opacity },
      uScale: { value: o.scale || 1 },
      uShade: { value: o.shade || 0 },
      uFlash: { value: 0 },
      uAlpha: { value: o.alpha == null ? 1 : o.alpha },
      uUseAttr: { value: o.attrs ? 1 : 0 },
    },
    transparent: o.alpha != null && o.alpha < 1,
    side: o.side || THREE.FrontSide,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 2,
  });
  if (m.extensions) m.extensions.derivatives = true;
  return m;
}

// ---------------------------------------------------------------- pen lines
const PEN_VERT = /* glsl */ `
attribute vec3 aStart;
attribute vec3 aEnd;
attribute vec2 aParam;
attribute float aSeed;
attribute vec3 aInk;
uniform vec2 uRes;
uniform float uWidth;
uniform vec3 uInk;
uniform float uUseAttr;
varying vec3 vInk;
void main() {
  vInk = mix(uInk, aInk, uUseAttr);
  mat4 mvp = projectionMatrix * modelViewMatrix;
  vec4 cs = mvp * vec4(aStart, 1.0);
  vec4 ce = mvp * vec4(aEnd, 1.0);
  float nw = 0.03;
  if (cs.w < nw && ce.w < nw) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  if (cs.w < nw) cs = mix(cs, ce, (nw - cs.w) / (ce.w - cs.w));
  if (ce.w < nw) ce = mix(ce, cs, (nw - ce.w) / (cs.w - ce.w));
  vec2 ss = cs.xy / cs.w * uRes;
  vec2 se = ce.xy / ce.w * uRes;
  vec2 d = se - ss;
  float len = length(d);
  d = len > 1e-4 ? d / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-d.y, d.x);
  float w = uWidth * (0.7 + 0.6 * aSeed);
  bool atEnd = aParam.x > 0.5;
  vec4 p = atEnd ? ce : cs;
  vec2 off = (nrm * aParam.y * w + d * (atEnd ? 1.0 : -1.0) * w * 0.5) / uRes;
  gl_Position = vec4(p.xy + off * p.w, p.z, p.w);
}`;

const PEN_FRAG = /* glsl */ `
uniform float uAlpha;
varying vec3 vInk;
void main() { gl_FragColor = vec4(vInk, uAlpha); }`;

function makePenMaterial(o = {}) {
  return new THREE.ShaderMaterial({
    vertexShader: PEN_VERT,
    fragmentShader: PEN_FRAG,
    uniforms: {
      uRes: { value: HALF_RES },
      uWidth: { value: o.width || 1.6 },
      uInk: { value: new THREE.Color(o.ink || INK.blue) },
      uAlpha: { value: o.alpha == null ? 0.92 : o.alpha },
      uUseAttr: { value: o.attrs ? 1 : 0 },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

// segs: Float32Array of xyz pairs. inks: optional Float32Array rgb per segment.
function penGeometry(segs, inks) {
  const n = segs.length / 6;
  const aStart = new Float32Array(n * 12);
  const aEnd = new Float32Array(n * 12);
  const aParam = new Float32Array(n * 8);
  const aSeed = new Float32Array(n * 4);
  const aInk = new Float32Array(n * 12);
  const index = new Uint32Array(n * 6);
  for (let i = 0; i < n; i++) {
    const s = i * 6;
    const seed = Math.random();
    for (let k = 0; k < 4; k++) {
      const v = i * 4 + k;
      aStart[v * 3] = segs[s]; aStart[v * 3 + 1] = segs[s + 1]; aStart[v * 3 + 2] = segs[s + 2];
      aEnd[v * 3] = segs[s + 3]; aEnd[v * 3 + 1] = segs[s + 4]; aEnd[v * 3 + 2] = segs[s + 5];
      aParam[v * 2] = k >> 1; aParam[v * 2 + 1] = (k & 1) ? 1 : -1;
      aSeed[v] = seed;
      if (inks) { aInk[v * 3] = inks[i * 3]; aInk[v * 3 + 1] = inks[i * 3 + 1]; aInk[v * 3 + 2] = inks[i * 3 + 2]; }
    }
    const b = i * 4, o = i * 6;
    index[o] = b; index[o + 1] = b + 1; index[o + 2] = b + 2;
    index[o + 3] = b + 2; index[o + 4] = b + 1; index[o + 5] = b + 3;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(aStart, 3));
  g.setAttribute('aStart', new THREE.BufferAttribute(aStart, 3));
  g.setAttribute('aEnd', new THREE.BufferAttribute(aEnd, 3));
  g.setAttribute('aParam', new THREE.BufferAttribute(aParam, 2));
  g.setAttribute('aSeed', new THREE.BufferAttribute(aSeed, 1));
  g.setAttribute('aInk', new THREE.BufferAttribute(aInk, 3));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  g.computeBoundingSphere();
  return g;
}

// edge segments of a geometry (optionally transformed), as a flat array
function edgeSegments(geometry, matrix, threshold = 12) {
  const e = new THREE.EdgesGeometry(geometry, threshold);
  if (matrix) e.applyMatrix4(matrix);
  const arr = Array.from(e.attributes.position.array);
  e.dispose();
  return arr;
}

// a pen-line mesh outlining one geometry (object space)
function penLinesFor(geometry, o = {}) {
  const segs = new Float32Array(edgeSegments(geometry, null, o.threshold));
  const mesh = new THREE.Mesh(penGeometry(segs), o.material || makePenMaterial(o));
  mesh.frustumCulled = false;
  return mesh;
}

// ---------------------------------------------------------------- hull outline
const HULL_VERT = /* glsl */ `
uniform vec2 uRes;
uniform float uWidth;
void main() {
  vec4 vp = modelViewMatrix * vec4(position, 1.0);
  vec3 vn = normalize(normalMatrix * normal);
  float w = max(-vp.z, 0.05);
  float k = uWidth * w / (uRes.y * projectionMatrix[1][1]);
  vp.xyz += vn * k;
  gl_Position = projectionMatrix * vp;
}`;
const HULL_FRAG = /* glsl */ `
uniform vec3 uInk;
uniform float uAlpha;
void main() { gl_FragColor = vec4(uInk, uAlpha); }`;

function makeHullMaterial(o = {}) {
  return new THREE.ShaderMaterial({
    vertexShader: HULL_VERT,
    fragmentShader: HULL_FRAG,
    uniforms: {
      uRes: { value: HALF_RES },
      uWidth: { value: o.width || 1.7 },
      uInk: { value: new THREE.Color(o.ink || INK.blue) },
      uAlpha: { value: o.alpha == null ? 0.95 : o.alpha },
    },
    side: THREE.BackSide,
    transparent: true,
  });
}

// mesh + hull outline in one group (for spheres / cylinders)
function roundPart(geometry, inkMat, hullMat) {
  const g = new THREE.Group();
  const m = new THREE.Mesh(geometry, inkMat);
  const h = new THREE.Mesh(geometry, hullMat);
  g.add(m); g.add(h);
  g.userData.mesh = m;
  return g;
}

// box mesh + pen lines in one group
function boxPart(w, h, d, inkMat, penMat) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const g = new THREE.Group();
  const m = new THREE.Mesh(geo, inkMat);
  g.add(m);
  g.add(penLinesFor(geo, { material: penMat }));
  g.userData.mesh = m;
  return g;
}

// ---------------------------------------------------------------- canvas art
function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function canvasTexture(c) {
  const t = new THREE.CanvasTexture(c);
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  return t;
}

function wobblyCircle(ctx, x, y, r, seed) {
  ctx.beginPath();
  for (let i = 0; i <= 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    const rr = r * (1 + 0.012 * Math.sin(a * 5 + seed) + 0.008 * Math.sin(a * 11 + seed * 2));
    const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

// enemy face: outline ring (so the round head reads as drawn), eyes, mouth
function faceTexture(kind, ink) {
  const S = 128;
  const c = makeCanvas(S, S), ctx = c.getContext('2d');
  ctx.lineCap = 'round';
  ctx.strokeStyle = ink; ctx.fillStyle = ink;
  ctx.lineWidth = 5;
  const cx = S / 2, cy = S / 2;
  if (kind === 'dead') {
    ctx.lineWidth = 6;
    for (const ex of [cx - 22, cx + 22]) {
      ctx.beginPath(); ctx.moveTo(ex - 9, cy - 16); ctx.lineTo(ex + 9, cy + 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ex + 9, cy - 16); ctx.lineTo(ex - 9, cy + 2); ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(cx - 16, cy + 26); ctx.lineTo(cx + 16, cy + 26); ctx.stroke();
    return canvasTexture(c);
  }
  // eyes
  const ey = cy - 8;
  if (kind === 'angry' || kind === 'boss') {
    ctx.beginPath(); ctx.arc(cx - 20, ey, 7, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + 20, ey, 7, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(cx - 34, ey - 22); ctx.lineTo(cx - 8, ey - 12); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx + 34, ey - 22); ctx.lineTo(cx + 8, ey - 12); ctx.stroke();
  } else if (kind === 'wide') {
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(cx - 20, ey, 11, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx + 20, ey, 11, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx - 18, ey + 2, 4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + 22, ey + 2, 4, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.beginPath(); ctx.arc(cx - 18, ey, 6, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + 18, ey, 6, 0, Math.PI * 2); ctx.fill();
  }
  // mouth
  ctx.lineWidth = 5;
  ctx.beginPath();
  if (kind === 'angry' || kind === 'boss' || kind === 'frown') {
    ctx.arc(cx, cy + 34, 16, Math.PI * 1.15, Math.PI * 1.85);
  } else if (kind === 'wide') {
    ctx.arc(cx, cy + 18, 12, 0, Math.PI * 2);
  } else {
    ctx.moveTo(cx - 14, cy + 20); ctx.lineTo(cx + 14, cy + 22);
  }
  ctx.stroke();
  return canvasTexture(c);
}

function sunTexture() {
  const S = 256;
  const c = makeCanvas(S, S), ctx = c.getContext('2d');
  ctx.strokeStyle = 'rgba(43,52,180,0.85)'; ctx.lineWidth = 3; ctx.lineCap = 'round';
  const cx = S / 2, cy = S / 2, r = 46;
  wobblyCircle(ctx, cx, cy, r, 1.3); ctx.stroke();
  // scribble shading inside
  ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(43,52,180,0.45)';
  for (let i = 0; i < 9; i++) {
    const y = cy - r + 10 + i * 9;
    const hw = Math.sqrt(Math.max(0, r * r - (y - cy) * (y - cy))) * 0.8;
    ctx.beginPath(); ctx.moveTo(cx - hw, y + 3); ctx.lineTo(cx + hw * 0.6, y - 4); ctx.stroke();
  }
  // rays
  ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(43,52,180,0.85)';
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + 0.2;
    const r1 = r + 12 + (i % 2) * 6, r2 = r1 + 22 + (i % 3) * 8;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
    ctx.lineTo(cx + Math.cos(a + 0.03) * r2, cy + Math.sin(a + 0.03) * r2);
    ctx.stroke();
  }
  return canvasTexture(c);
}

function cloudTexture(seed) {
  const W = 256, H = 128;
  const c = makeCanvas(W, H), ctx = c.getContext('2d');
  // a puffy cloud = a few overlapping circles; stroke them all, then paint the
  // union in paper colour so only the outer contour survives
  const rnd = mulberry(seed * 17 + 3);
  const puffs = [];
  const n = 5 + (seed % 3);
  for (let i = 0; i < n; i++) {
    const x = 50 + (i / (n - 1)) * 156, r = 22 + rnd() * 16;
    puffs.push([x, 78 - (i === 0 || i === n - 1 ? 0 : rnd() * 26) - r * 0.2, r]);
  }
  ctx.strokeStyle = 'rgba(43,52,180,0.85)'; ctx.lineWidth = 6;
  for (const [x, y, r] of puffs) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke(); }
  ctx.beginPath(); ctx.moveTo(30, 100); ctx.lineTo(226, 100); ctx.stroke();
  ctx.fillStyle = '#f4efe2';
  for (const [x, y, r] of puffs) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillRect(30, 60, 196, 40);
  // light scribble shading in the lower half
  ctx.strokeStyle = 'rgba(43,52,180,0.3)'; ctx.lineWidth = 1.5;
  for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(60 + i * 8, 92 - i * 5); ctx.lineTo(120 + i * 22, 84 - i * 6); ctx.stroke(); }
  return canvasTexture(c);
}

// irregular ink splat with satellite drops
function splatTexture(seed, color) {
  const S = 128;
  const c = makeCanvas(S, S), ctx = c.getContext('2d');
  ctx.fillStyle = color || INK.red;
  const cx = S / 2, cy = S / 2;
  const rnd = mulberry(seed);
  ctx.beginPath();
  const pts = 18;
  for (let i = 0; i <= pts; i++) {
    const a = (i / pts) * Math.PI * 2;
    const r = 28 + rnd() * 22;
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath(); ctx.fill();
  for (let i = 0; i < 9; i++) {
    const a = rnd() * Math.PI * 2, d = 36 + rnd() * 24, r = 2 + rnd() * 6;
    ctx.beginPath(); ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, r, 0, Math.PI * 2); ctx.fill();
  }
  return canvasTexture(c);
}

function dotTexture(color) {
  const S = 32;
  const c = makeCanvas(S, S), ctx = c.getContext('2d');
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(S / 2, S / 2, 12, 0, Math.PI * 2); ctx.fill();
  return canvasTexture(c);
}

function plusTexture(color) {
  const S = 64;
  const c = makeCanvas(S, S), ctx = c.getContext('2d');
  ctx.strokeStyle = color; ctx.lineWidth = 9; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(32, 12); ctx.lineTo(32, 52); ctx.moveTo(12, 32); ctx.lineTo(52, 32); ctx.stroke();
  return canvasTexture(c);
}

function textTexture(text, color, font, w = 256, h = 64) {
  const c = makeCanvas(w, h), ctx = c.getContext('2d');
  ctx.fillStyle = color; ctx.font = font || `bold ${Math.floor(h * 0.6)}px "Patrick Hand", "Comic Sans MS", cursive`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2);
  return canvasTexture(c);
}

function makeSprite(tex, w, h, o = {}) {
  const m = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: o.depthTest !== false, depthWrite: false, opacity: o.opacity == null ? 1 : o.opacity });
  const s = new THREE.Sprite(m);
  s.scale.set(w, h, 1);
  if (o.color) m.color.set(o.color);
  return s;
}

// tiny seeded PRNG so textures are stable between reloads
function mulberry(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
