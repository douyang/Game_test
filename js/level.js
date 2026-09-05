'use strict';
// ---------------------------------------------------------------------------
// level.js — the arena. Every static piece is an axis-aligned box; boxes are
// merged into one hatched mesh + one pen-line mesh, and kept as AABBs for
// collision, bullets, grapple and the enemy flow field.
// ---------------------------------------------------------------------------

const LEVEL = {
  aabbs: [],            // {minX,minY,minZ,maxX,maxY,maxZ,solid,tag}
  spawns: { ground: [], ledge: [] },
  crateSpots: [],
  healthSpots: [],
  playerStart: { x: 0, y: 0, z: 34, yaw: 0 },
  bounds: 70,
  group: null,
  sky: null,
  planes: [],
  // flow field (ground level) for enemy navigation
  grid: { cell: 2, n: 70, blocked: null, dist: null, target: -1 },
};

const _acc = { pos: [], nrm: [], ink: [], shade: [], segs: [], segInk: [] };
const _tmpColor = new THREE.Color();

function _inkRGB(name) {
  _tmpColor.set(INK[name] || name);
  return [_tmpColor.r, _tmpColor.g, _tmpColor.b];
}

// centre x/z, bottom y, size w/h/d
function addBox(cx, by, cz, w, h, d, o = {}) {
  const rgb = _inkRGB(o.ink || 'blue');
  const shade = o.shade || 0;
  const geo = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  geo.translate(cx, by + h / 2, cz);
  const p = geo.attributes.position.array, n = geo.attributes.normal.array;
  for (let i = 0; i < p.length; i += 3) {
    _acc.pos.push(p[i], p[i + 1], p[i + 2]);
    _acc.nrm.push(n[i], n[i + 1], n[i + 2]);
    _acc.ink.push(rgb[0], rgb[1], rgb[2]);
    _acc.shade.push(shade);
  }
  geo.dispose();
  if (!o.noLines) {
    const m = new THREE.Matrix4().makeTranslation(cx, by + h / 2, cz);
    const segs = edgeSegments(new THREE.BoxGeometry(w, h, d), m);
    for (let i = 0; i < segs.length; i += 6) {
      _acc.segs.push(segs[i], segs[i + 1], segs[i + 2], segs[i + 3], segs[i + 4], segs[i + 5]);
      _acc.segInk.push(rgb[0], rgb[1], rgb[2]);
    }
  }
  if (!o.noCollide) {
    LEVEL.aabbs.push({
      minX: cx - w / 2, minY: by, minZ: cz - d / 2,
      maxX: cx + w / 2, maxY: by + h, maxZ: cz + d / 2,
      tag: o.tag || 'level',
    });
  }
}

// hatched window panel flush on a wall face. face: 'n','s','e','w'
function addWindow(cx, by, cz, w, h, face) {
  const t = 0.12;
  if (face === 'n' || face === 's') addBox(cx, by, cz + (face === 's' ? t / 2 : -t / 2), w, h, t, { shade: 0.75, noCollide: true });
  else addBox(cx + (face === 'e' ? t / 2 : -t / 2), by, cz, t, h, w, { shade: 0.75, noCollide: true });
}

// stairs climbing from (x0,z0) in direction (dx,dz); width across the run
function addStairs(x0, z0, dx, dz, width, steps, stepH, stepD, baseY = 0, o = {}) {
  // treads are thin drawn slabs; a coarse unlined mass underneath makes the
  // flight solid without a comb of vertical pen lines on its side
  for (let i = 0; i < steps; i++) {
    const cx = x0 + dx * (i + 0.5) * stepD, cz = z0 + dz * (i + 0.5) * stepD;
    const w = dx !== 0 ? stepD : width, d = dz !== 0 ? stepD : width;
    addBox(cx, baseY + stepH * i, cz, w + 0.02, stepH, d + 0.02, o);
  }
  const chunk = 4;
  for (let k = 0; k * chunk < steps; k++) {
    const i0 = k * chunk, i1 = Math.min(steps, i0 + chunk);
    const cx = x0 + dx * (i0 + i1) / 2 * stepD, cz = z0 + dz * (i0 + i1) / 2 * stepD;
    const w = dx !== 0 ? (i1 - i0) * stepD : width, d = dz !== 0 ? (i1 - i0) * stepD : width;
    addBox(cx, baseY, cz, w, stepH * i0 + 0.01, d, Object.assign({ noLines: true }, o));
  }
}

function buildArena() {
  const B = LEVEL.bounds;
  // ground + perimeter
  addBox(0, -1, 0, 2 * B + 40, 1, 2 * B + 40, { ink: 'blue', noLines: true });
  addBox(0, 0, -B - 1, 2 * B + 4, 9, 2);
  addBox(0, 0, B + 1, 2 * B + 4, 9, 2);
  addBox(-B - 1, 0, 0, 2, 9, 2 * B);
  addBox(B + 1, 0, 0, 2, 9, 2 * B);
  // skyline beyond the walls
  const sky = [[-92, -96, 20, 30, 18], [96, -84, 16, 22, 16], [104, 58, 24, 18, 24], [-104, 66, 18, 26, 18], [0, -108, 44, 14, 20], [-40, 104, 30, 12, 16], [60, 102, 20, 20, 14]];
  for (const [x, z, w, h, d] of sky) addBox(x, 0, z, w, h, d);

  // --- the frame building (under construction) ---------------------------
  // footprint x[-32,-7] z[-36,-20]; a stairwell gap x[-11,-7] z[-28,-20] on
  // every floor, and an extra opening on the top floor over the last stair
  for (const y of [4, 8]) {
    addBox(-21.5, y, -28, 21, 0.4, 16);
    addBox(-9, y, -32, 4, 0.4, 8);
  }
  addBox(-21.5, 12, -26.3, 21, 0.4, 12.6);
  addBox(-26, 12, -34.3, 12, 0.4, 3.4);
  addBox(-9, 12, -32, 4, 0.4, 8);
  for (const y of [4, 8, 12]) addBox(-19.5, y + 0.4, -35.9, 25, 1.0, 0.15); // north railings
  for (const x of [-31.6, -26, -20, -14.5, -7.4]) {
    for (const z of [-35.6, -28, -20.4]) addBox(x, 0, z, 0.7, 12.4, 0.7);
  }
  // ground -> floor 1: external stair along the south face, landing joins the slab
  addStairs(-6, -17.8, -1, 0, 3, 16, 0.25, 0.6, 0, {});
  addBox(-16.5, 0, -19, 3, 4.4, 2.6);
  // floor 1 -> 2 inside the stairwell, floor 2 -> 3 along the north edge
  addStairs(-9.5, -20.4, 0, -1, 3, 16, 0.25, 0.5, 4.4, {});
  addStairs(-11.2, -34.1, -1, 0, 3, 16, 0.25, 0.5, 8.4, {});
  // a few things left lying on the floors
  addBox(-24, 4.4, -30, 2, 1.2, 2, { ink: 'orange' });
  addBox(-16, 8.4, -26, 1.6, 1.0, 1.6, { ink: 'green', shade: -0.1 });

  // --- the overhang (car-port slab on columns) ---------------------------
  addBox(28, 6.5, -8, 30, 1.2, 14);
  for (const x of [14, 28, 42]) for (const z of [-14, -2]) addBox(x, 0, z, 0.9, 6.5, 0.9);
  addBox(28, 7.7, -14.5, 30, 0.9, 0.15);

  // --- houses ------------------------------------------------------------
  addBox(30, 0, 26, 12, 6, 9);
  addWindow(27, 2.5, 21.5, 2.2, 1.6, 'n'); addWindow(33, 2.5, 21.5, 2.2, 1.6, 'n');
  addWindow(24, 2.2, 26, 3, 1.8, 'w'); addWindow(30, 0.2, 30.5, 1.6, 3.2, 's');
  addBox(30, 6, 26, 12.6, 0.5, 9.6, { shade: 0.15 });
  addStairs(22.2, 31.5, 0, -1, 3, 24, 0.27, 0.45, 0, {});

  addBox(-38, 0, 30, 9, 5, 9);
  addWindow(-38, 2.2, 25.5, 2.4, 1.6, 'n'); addWindow(-33.5, 2.2, 30, 2.4, 1.6, 'e');
  addBox(-38, 5, 30, 9.6, 0.4, 9.6, { shade: 0.15 });

  addBox(4, 0, 44, 14, 5, 7);
  addWindow(0, 2.2, 40.5, 2.6, 1.6, 'n'); addWindow(8, 2.2, 40.5, 2.6, 1.6, 'n');
  addWindow(11, 0.2, 44, 1.6, 3, 'e');

  addBox(-50, 0, -50, 10, 7, 10);
  addWindow(-50, 3, -45, 3, 2, 's'); addWindow(-45, 3, -50, 3, 2, 'e');
  addBox(-50, 7, -50, 10.6, 0.4, 10.6, { shade: 0.15 });

  // --- mezzanine with a wide stair ---------------------------------------
  addBox(-54, 3.6, 2, 16, 0.5, 16);
  for (const x of [-61, -47]) for (const z of [-5, 9]) addBox(x, 0, z, 0.9, 3.6, 0.9);
  addStairs(-36.4, 2, -1, 0, 12, 16, 0.25, 0.6, 0, {});
  addBox(-54, 4.1, -5.9, 16, 1, 0.15);

  // --- crane -------------------------------------------------------------
  addBox(44, 0, -46, 1.3, 24, 1.3);
  addBox(44, 22, -46, 2.2, 2.2, 2.2, { shade: 0.2 });
  addBox(33, 24, -46, 26, 1.0, 1.0, { ink: 'orange' });
  addBox(50, 24, -46, 8, 1.0, 1.0, { ink: 'orange' });
  addBox(21.5, 14.5, -46, 0.1, 9.5, 0.1, { noCollide: true });
  addBox(21.5, 13.5, -46, 0.9, 1.0, 0.9, { ink: 'orange' });

  // --- sniper perches (grapple only) -------------------------------------
  const perches = [[0, -58, 6], [52, 12, 7], [-56, 48, 5.5], [58, -30, 5]];
  for (const [x, z, h] of perches) {
    addBox(x, 0, z, 2, h, 2);
    addBox(x, h, z, 6, 0.5, 6);
    LEVEL.spawns.ledge.push({ x, y: h + 0.5, z });
  }
  LEVEL.spawns.ledge.push({ x: -20, y: 12.4, z: -30 }, { x: -14, y: 12.4, z: -26 }, { x: 28, y: 7.7, z: -8 }, { x: 36, y: 7.7, z: -5 });

  // --- cover ------------------------------------------------------------
  const cover = [[-6, 10, 4, 0.9, 1], [10, 6, 1, 0.9, 5], [-20, 18, 5, 1.1, 1], [18, -30, 1, 1.0, 6], [-8, -4, 2, 2, 2], [14, 30, 2, 2, 2], [-30, -8, 3, 0.9, 1], [46, 40, 5, 1.0, 1], [-40, 52, 1, 1.0, 5], [40, -56, 1, 1.0, 5]];
  for (const [x, z, w, h, d] of cover) addBox(x, 0, z, w, h, d);
  // lamp posts
  for (const [x, z] of [[8, -20], [-4, 24], [20, 14], [-30, 44], [48, -22], [-58, 24]]) {
    addBox(x, 0, z, 0.3, 4.5, 0.3);
    addBox(x, 4.5, z, 1.2, 0.3, 0.6);
  }

  // --- spawn / pickup spots ---------------------------------------------
  LEVEL.spawns.ground.push(
    { x: -60, z: -60 }, { x: 60, z: -62 }, { x: 62, z: 58 }, { x: -62, z: 60 },
    { x: 0, z: -66 }, { x: 66, z: -4 }, { x: -66, z: 30 }, { x: 24, z: 66 },
    { x: -30, z: 66 }, { x: 34, z: -66 }, { x: -66, z: -28 }, { x: 66, z: 34 },
  );
  LEVEL.crateSpots.push([-14, 4], [12, 12], [22, -20], [-40, 16], [8, -44], [40, 8], [-24, -46], [-8, 30], [50, -40], [-60, -16], [36, 50], [-48, 34]);
  LEVEL.healthSpots.push([-4, -12], [26, 36], [-44, -30], [44, -14]);

  LEVEL.playerStart = { x: 0, y: 0, z: 34, yaw: 0 };
}

function finishArena(scene) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(_acc.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(_acc.nrm, 3));
  g.setAttribute('aInk', new THREE.Float32BufferAttribute(_acc.ink, 3));
  g.setAttribute('aShade', new THREE.Float32BufferAttribute(_acc.shade, 1));
  const mesh = new THREE.Mesh(g, makeInk({ attrs: true }));
  mesh.frustumCulled = false;
  const lines = new THREE.Mesh(penGeometry(new Float32Array(_acc.segs), new Float32Array(_acc.segInk)), makePenMaterial({ attrs: true, width: 1.5 }));
  lines.frustumCulled = false;
  const group = new THREE.Group();
  group.add(mesh); group.add(lines);
  scene.add(group);
  LEVEL.group = group;
  LEVEL.mesh = mesh;
  for (const k in _acc) _acc[k] = [];
  buildFlowGrid();
}

// ---------------------------------------------------------------- queries
// highest solid top under (x,z) at or below y
function groundHeightAt(x, z, y) {
  let best = -Infinity;
  const a = LEVEL.aabbs;
  for (let i = 0; i < a.length; i++) {
    const b = a[i];
    if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ && b.maxY <= y + 0.05 && b.maxY > best) best = b.maxY;
  }
  return best === -Infinity ? 0 : best;
}

// ray vs all AABBs; returns {t, nx, ny, nz, box} or null
const _hit = { t: 0, nx: 0, ny: 0, nz: 0, box: null };
function rayLevel(ox, oy, oz, dx, dy, dz, maxT = 1000) {
  let bestT = maxT, bestBox = null, bn = 0;
  const idx = 1 / dx, idy = 1 / dy, idz = 1 / dz;
  const a = LEVEL.aabbs;
  for (let i = 0; i < a.length; i++) {
    const b = a[i];
    let t1 = (b.minX - ox) * idx, t2 = (b.maxX - ox) * idx;
    let tmin = Math.min(t1, t2), tmax = Math.max(t1, t2);
    let axis = 0;
    t1 = (b.minY - oy) * idy; t2 = (b.maxY - oy) * idy;
    const tymin = Math.min(t1, t2), tymax = Math.max(t1, t2);
    if (tymin > tmin) { tmin = tymin; axis = 1; }
    tmax = Math.min(tmax, tymax);
    t1 = (b.minZ - oz) * idz; t2 = (b.maxZ - oz) * idz;
    const tzmin = Math.min(t1, t2), tzmax = Math.max(t1, t2);
    if (tzmin > tmin) { tmin = tzmin; axis = 2; }
    tmax = Math.min(tmax, tzmax);
    if (tmax >= Math.max(tmin, 0) && tmin < bestT && tmin > 0) { bestT = tmin; bestBox = b; bn = axis; }
  }
  if (!bestBox) return null;
  _hit.t = bestT; _hit.box = bestBox;
  _hit.nx = 0; _hit.ny = 0; _hit.nz = 0;
  if (bn === 0) _hit.nx = dx > 0 ? -1 : 1;
  else if (bn === 1) _hit.ny = dy > 0 ? -1 : 1;
  else _hit.nz = dz > 0 ? -1 : 1;
  return _hit;
}

// straight-line visibility between two points against the level
function lineClear(ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-4) return true;
  const h = rayLevel(ax, ay, az, dx / len, dy / len, dz / len, len);
  return !h;
}

// AABB overlap test for a moving body (half-width hw, height h, feet at y)
function bodyOverlaps(x, y, z, hw, h, skipTag) {
  const a = LEVEL.aabbs;
  const minX = x - hw, maxX = x + hw, minZ = z - hw, maxZ = z + hw, minY = y, maxY = y + h;
  for (let i = 0; i < a.length; i++) {
    const b = a[i];
    if (maxX > b.minX && minX < b.maxX && maxY > b.minY && minY < b.maxY && maxZ > b.minZ && minZ < b.maxZ) return b;
  }
  return null;
}

// move a body with per-axis sliding, gravity handled by the caller.
// body: {pos:{x,y,z}, vel:{x,y,z}, hw, h, grounded}
function moveBody(body, dt, stepUp = 0.55) {
  const p = body.pos, v = body.vel;
  body.grounded = false;
  // X
  if (v.x !== 0) {
    const nx = p.x + v.x * dt;
    let hitb = bodyOverlaps(nx, p.y + 0.01, p.z, body.hw, body.h - 0.02);
    if (hitb && stepUp > 0) {
      // try stepping up onto low obstacles
      const top = hitb.maxY;
      if (top - p.y <= stepUp && top - p.y > 0 && !bodyOverlaps(nx, top + 0.01, p.z, body.hw, body.h - 0.02)) { p.y = top + 0.001; hitb = null; }
    }
    if (hitb) { p.x = v.x > 0 ? hitb.minX - body.hw - 0.001 : hitb.maxX + body.hw + 0.001; v.x = 0; }
    else p.x = nx;
  }
  // Z
  if (v.z !== 0) {
    const nz = p.z + v.z * dt;
    let hitb = bodyOverlaps(p.x, p.y + 0.01, nz, body.hw, body.h - 0.02);
    if (hitb && stepUp > 0) {
      const top = hitb.maxY;
      if (top - p.y <= stepUp && top - p.y > 0 && !bodyOverlaps(p.x, top + 0.01, nz, body.hw, body.h - 0.02)) { p.y = top + 0.001; hitb = null; }
    }
    if (hitb) { p.z = v.z > 0 ? hitb.minZ - body.hw - 0.001 : hitb.maxZ + body.hw + 0.001; v.z = 0; }
    else p.z = nz;
  }
  // Y
  const ny = p.y + v.y * dt;
  const hitb = bodyOverlaps(p.x, ny, p.z, body.hw, body.h);
  if (hitb) {
    if (v.y <= 0) { p.y = hitb.maxY + 0.0005; body.grounded = true; }
    else p.y = hitb.minY - body.h - 0.0005;
    v.y = 0;
  } else p.y = ny;
  // resting check: a hair below the feet
  if (!body.grounded && v.y <= 0 && bodyOverlaps(p.x, p.y - 0.03, p.z, body.hw, 0.03)) body.grounded = true;
}

// ---------------------------------------------------------------- flow field
function buildFlowGrid() {
  const g = LEVEL.grid;
  const n = g.n, half = n * g.cell / 2;
  g.blocked = new Uint8Array(n * n);
  g.dist = new Int32Array(n * n);
  for (const b of LEVEL.aabbs) {
    if (b.maxY <= 0.35 || b.minY > 1.5) continue;
    const i0 = Math.max(0, Math.floor((b.minX - 0.45 + half) / g.cell));
    const i1 = Math.min(n - 1, Math.floor((b.maxX + 0.45 + half) / g.cell));
    const j0 = Math.max(0, Math.floor((b.minZ - 0.45 + half) / g.cell));
    const j1 = Math.min(n - 1, Math.floor((b.maxZ + 0.45 + half) / g.cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) g.blocked[j * n + i] = 1;
  }
}

function cellOf(x, z) {
  const g = LEVEL.grid, half = g.n * g.cell / 2;
  const i = Math.max(0, Math.min(g.n - 1, Math.floor((x + half) / g.cell)));
  const j = Math.max(0, Math.min(g.n - 1, Math.floor((z + half) / g.cell)));
  return j * g.n + i;
}

const _queue = new Int32Array(70 * 70);
function updateFlowField(tx, tz) {
  const g = LEVEL.grid, n = g.n;
  let target = cellOf(tx, tz);
  // if the target cell is blocked (player on a box), search nearest free cell
  if (g.blocked[target]) {
    let best = -1, bd = 1e9;
    const ti = target % n, tj = (target / n) | 0;
    for (let r = 1; r < 4 && best < 0; r++) {
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        const i = ti + di, j = tj + dj;
        if (i < 0 || j < 0 || i >= n || j >= n) continue;
        const c = j * n + i;
        if (!g.blocked[c] && di * di + dj * dj < bd) { bd = di * di + dj * dj; best = c; }
      }
    }
    if (best >= 0) target = best;
  }
  g.target = target;
  g.dist.fill(-1);
  let qh = 0, qt = 0;
  _queue[qt++] = target; g.dist[target] = 0;
  while (qh < qt) {
    const c = _queue[qh++];
    const ci = c % n, cj = (c / n) | 0, d = g.dist[c] + 1;
    for (let k = 0; k < 4; k++) {
      const i = ci + (k === 0 ? 1 : k === 1 ? -1 : 0), j = cj + (k === 2 ? 1 : k === 3 ? -1 : 0);
      if (i < 0 || j < 0 || i >= n || j >= n) continue;
      const nc = j * n + i;
      if (g.blocked[nc] || g.dist[nc] >= 0) continue;
      g.dist[nc] = d; _queue[qt++] = nc;
    }
  }
}

// direction (x,z) to descend the field from (x,z); null if unreachable
const _flowDir = { x: 0, z: 0 };
function flowDirAt(x, z) {
  const g = LEVEL.grid, n = g.n, half = n * g.cell / 2;
  const c = cellOf(x, z);
  const ci = c % n, cj = (c / n) | 0;
  let best = -1, bd = g.dist[c] >= 0 ? g.dist[c] : 1e9;
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
    if (!di && !dj) continue;
    const i = ci + di, j = cj + dj;
    if (i < 0 || j < 0 || i >= n || j >= n) continue;
    const nc = j * n + i;
    if (g.blocked[nc] || g.dist[nc] < 0) continue;
    if (di && dj && (g.blocked[cj * n + i] || g.blocked[j * n + ci])) continue; // no corner cutting
    if (g.dist[nc] < bd) { bd = g.dist[nc]; best = nc; }
  }
  if (best < 0) return null;
  const bx = (best % n + 0.5) * g.cell - half, bz = (((best / n) | 0) + 0.5) * g.cell - half;
  const dx = bx - x, dz = bz - z, l = Math.hypot(dx, dz) || 1;
  _flowDir.x = dx / l; _flowDir.z = dz / l;
  return _flowDir;
}

// ---------------------------------------------------------------- sky
function buildSky(scene) {
  const sky = new THREE.Group();
  const sun = makeSprite(sunTexture(), 120, 120, { depthTest: false });
  sun.position.set(-220, 170, -330);
  sky.add(sun);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + 0.4;
    const cl = makeSprite(cloudTexture(i + 1), 90 + (i % 3) * 30, 45 + (i % 3) * 15, { depthTest: false });
    cl.position.set(Math.cos(a) * 380, 110 + (i % 4) * 30, Math.sin(a) * 380);
    cl.userData.drift = 0.4 + (i % 3) * 0.2;
    sky.add(cl);
  }
  sky.renderOrder = -10;
  scene.add(sky);
  LEVEL.sky = sky;

  // paper planes circling the arena
  const planeGeo = paperPlaneGeometry();
  const inkMat = makeInk({ ink: INK.blue, side: THREE.DoubleSide, opacity: 0.6, scale: 3 });
  const penMat = makePenMaterial({ width: 1.4 });
  for (let i = 0; i < 4; i++) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(planeGeo, inkMat));
    g.add(penLinesFor(planeGeo, { material: penMat, threshold: 1 }));
    g.scale.setScalar(2.2);
    g.userData = { r: 40 + i * 14, y: 24 + i * 5, a: i * 1.7, s: 0.12 + i * 0.03 };
    scene.add(g);
    LEVEL.planes.push(g);
  }
}

function paperPlaneGeometry() {
  const v = [
    // top wing (two triangles)
    0, 0, -1.2, -0.7, 0.05, 0.8, 0, 0.02, 0.5,
    0, 0, -1.2, 0, 0.02, 0.5, 0.7, 0.05, 0.8,
    // keel
    0, 0, -1.2, 0, -0.35, 0.7, 0, 0.02, 0.5,
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}

function updateSky(camPos, t, dt) {
  if (LEVEL.sky) {
    LEVEL.sky.position.copy(camPos);
    for (const c of LEVEL.sky.children) if (c.userData.drift) c.position.x += c.userData.drift * dt;
  }
  for (const p of LEVEL.planes) {
    const u = p.userData;
    u.a += u.s * dt;
    const x = Math.cos(u.a) * u.r, z = Math.sin(u.a) * u.r;
    p.position.set(x, u.y + Math.sin(t * 0.7 + u.r) * 1.5, z);
    p.rotation.set(0.12 * Math.sin(t + u.r), -u.a - Math.PI / 2, 0.3);
  }
}
