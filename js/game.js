'use strict';
// ---------------------------------------------------------------------------
// game.js — waves, score, HUD, crates, pickups, input, main loop.
// ---------------------------------------------------------------------------

const GAME = {
  state: 'title', // title | playing | paused | dead
  score: 0, wave: 0, best: { score: 0, wave: 0 },
  spawnQueue: [], spawnT: 0, intermission: 0, waveActive: false, aliveTarget: 0, bossAlive: null,
  tipT: 0, tipI: 0, time: 0, acc: 0, last: 0,
  renderer: null, scene: null, camera: null, fx: null, fxCtx: null,
  W: 1, H: 1, dpr: 1,
  crates: [], pickups: [], crateMats: null,
  touch: false, nolock: false, gamepad: { lastButtons: [] }, slow: 0,
  keys: {},
};

const TIPS = [
  'grapple an enemy to yank them off a ledge',
  'press 1-5 to swap weapons · the shotgun ends heavies',
  'hold right click with the katana to block & return bullets',
  'a full slash meter lets you dash-execute with shift',
  'headshots erase in one shot with the revolver',
  'E fires the grapple · it pulls you to any surface',
  'ink bombs walk up and pop · shoot them from range',
  'kills in quick succession raise the combo',
];
const WAVE_SUBS = ['sharpen your pencil', 'the ink is flowing', "they're drawing more", 'keep scribbling', 'THE DOODLER IS COMING', "don't get erased", 'the margin is closing in', 'page turn', 'ink runs deep', 'THE DOODLER IS COMING'];

// ---------------------------------------------------------------- boot
function boot() {
  THREE.ColorManagement.enabled = false;
  const params = new URLSearchParams(location.search);
  GAME.nolock = params.has('nolock');
  GAME.touch = ('ontouchstart' in window) && !params.has('desktop') || params.has('touch');
  const canvas = document.getElementById('gl');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  GAME.renderer = renderer;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(74, 1, 0.05, 700);
  scene.add(camera);
  GAME.scene = scene; GAME.camera = camera;
  GAME.fx = document.getElementById('fx');
  GAME.fxCtx = GAME.fx.getContext('2d');

  buildArena();
  finishArena(scene);
  buildSky(scene);
  FX.init(scene, camera);
  ENEMIES.init(scene, ENEMY_HOOKS);
  P.init(camera, scene, PLAYER_HOOKS);
  initCrates();
  buildHud();
  loadBest();
  bindInput();
  if (GAME.touch) document.body.classList.add('touch');
  resize();
  window.addEventListener('resize', resize);
  showTitle();
  GAME.last = performance.now();
  requestAnimationFrame(frame);
  window.GAME = GAME; window.P = P; window.ENEMIES = ENEMIES;
}

function resize() {
  const W = window.innerWidth, H = window.innerHeight;
  GAME.W = W; GAME.H = H;
  GAME.dpr = Math.min(window.devicePixelRatio || 1, 2);
  GAME.renderer.setPixelRatio(GAME.dpr);
  GAME.renderer.setSize(W, H, false);
  GAME.camera.aspect = W / H; GAME.camera.updateProjectionMatrix();
  HALF_RES.set(W / 2, H / 2);
  GAME.fx.width = W * GAME.dpr; GAME.fx.height = H * GAME.dpr;
  GAME.fx.style.width = W + 'px'; GAME.fx.style.height = H + 'px';
  GAME.fxCtx.setTransform(GAME.dpr, 0, 0, GAME.dpr, 0, 0);
}

// ---------------------------------------------------------------- crates + pickups
function initCrates() {
  GAME.crateMats = { ink: makeInk({ ink: INK.orange, scale: 2, opacity: 0.85 }), pen: makePenMaterial({ ink: '#c46f1a', width: 1.6 }) };
  for (const [x, z] of LEVEL.crateSpots) {
    const size = 1.3;
    const g = boxPart(size, size, size, GAME.crateMats.ink, GAME.crateMats.pen);
    g.position.set(x, size / 2, z);
    g.rotation.y = Math.random() * 0.5;
    GAME.scene.add(g);
    GAME.crates.push({ g, x, z, size, hp: 40, alive: true, aabb: { minX: x - size / 2, minY: 0, minZ: z - size / 2, maxX: x + size / 2, maxY: size, maxZ: z + size / 2 } });
  }
  GAME.pickupMats = {
    healthInk: makeInk({ ink: INK.green, scale: 2.5, opacity: 0.85 }), healthPen: makePenMaterial({ ink: '#2a7d40', width: 1.6 }),
    ammoInk: makeInk({ ink: INK.blue, scale: 3, opacity: 0.85 }), ammoPen: makePenMaterial({ ink: INK.blue, width: 1.5 }),
  };
  GAME.plusTex = plusTexture('#2a7d40');
  GAME.ammoTex = textTexture('AMMO', INK.blue, 'bold 40px "Patrick Hand", "Comic Sans MS", cursive', 128, 64);
}

function spawnPickup(kind, x, y, z) {
  const M = GAME.pickupMats;
  const size = kind === 'health' ? 0.7 : 0.55;
  const g = boxPart(size, size, size, kind === 'health' ? M.healthInk : M.ammoInk, kind === 'health' ? M.healthPen : M.ammoPen);
  const label = makeSprite(kind === 'health' ? GAME.plusTex : GAME.ammoTex, kind === 'health' ? 0.5 : 0.7, kind === 'health' ? 0.5 : 0.35);
  label.position.y = size * 0.5 + 0.35;
  g.add(label);
  g.position.set(x, y + size / 2, z);
  GAME.scene.add(g);
  GAME.pickups.push({ kind, g, x, z, y, size, t: Math.random() * 6 });
}

function resetCrates() {
  for (const c of GAME.crates) { if (!c.alive) { c.alive = true; c.hp = 40; c.g.visible = true; } }
}

function refreshHealthCubes() {
  for (const [x, z] of LEVEL.healthSpots) {
    if (!GAME.pickups.some(p => p.kind === 'health' && Math.abs(p.x - x) < 0.1 && Math.abs(p.z - z) < 0.1)) spawnPickup('health', x, 0, z);
  }
}

function rayCrate(ox, oy, oz, dx, dy, dz, maxT) {
  let best = maxT, bc = null;
  const idx = 1 / dx, idy = 1 / dy, idz = 1 / dz;
  for (const c of GAME.crates) {
    if (!c.alive) continue;
    const b = c.aabb;
    let t1 = (b.minX - ox) * idx, t2 = (b.maxX - ox) * idx;
    let tmin = Math.min(t1, t2), tmax = Math.max(t1, t2);
    t1 = (b.minY - oy) * idy; t2 = (b.maxY - oy) * idy;
    tmin = Math.max(tmin, Math.min(t1, t2)); tmax = Math.min(tmax, Math.max(t1, t2));
    t1 = (b.minZ - oz) * idz; t2 = (b.maxZ - oz) * idz;
    tmin = Math.max(tmin, Math.min(t1, t2)); tmax = Math.min(tmax, Math.max(t1, t2));
    if (tmax >= Math.max(tmin, 0) && tmin > 0 && tmin < best) { best = tmin; bc = c; }
  }
  return bc ? { t: best, crate: bc } : null;
}

function hitCrate(c, dmg, x, y, z) {
  c.hp -= dmg;
  FX.burst(x, y, z, 4, 'orange', 3);
  if (c.hp <= 0) breakCrate(c);
  else { c.g.scale.setScalar(0.94); setTimeout(() => c.g.scale.setScalar(1), 60); }
}

function breakCrate(c) {
  c.alive = false; c.g.visible = false;
  FX.chunks(c.x, c.size / 2, c.z, 9, 'orange', 0.6, 5);
  FX.burst(c.x, c.size / 2, c.z, 10, 'orange', 4);
  SFX.play('crate');
  const r = Math.random();
  if (r < 0.45) spawnPickup('ammo', c.x, 0, c.z);
  else if (r < 0.6) spawnPickup('health', c.x, 0, c.z);
}

function slashCrates(ox, oy, oz, dir, range) {
  for (const c of GAME.crates) {
    if (!c.alive) continue;
    const dx = c.x - ox, dy = c.size / 2 - oy, dz = c.z - oz;
    const l = Math.hypot(dx, dy, dz);
    if (l < range + c.size * 0.5 && (dx * dir.x + dy * dir.y + dz * dir.z) / (l || 1) > 0.4) breakCrate(c);
  }
}

function updatePickups(dt) {
  for (let i = GAME.pickups.length - 1; i >= 0; i--) {
    const p = GAME.pickups[i];
    p.t += dt;
    p.g.position.y = p.y + p.size / 2 + Math.sin(p.t * 2.2) * 0.08;
    p.g.rotation.y += dt * 0.8;
    const dx = p.x - P.pos.x, dz = p.z - P.pos.z, dy = p.y - P.pos.y;
    if (Math.hypot(dx, dz) < 1.4 && Math.abs(dy) < 1.8 && !P.dead) {
      if (p.kind === 'health') { P.heal(35); FX.popup('+35 HP', 'green'); }
      else { P.addAmmo(0.3); FX.popup('+AMMO', 'small'); }
      SFX.play('pickup');
      GAME.scene.remove(p.g);
      GAME.pickups.splice(i, 1);
      HUD.ammo();
    }
  }
}

function clearPickups() { for (const p of GAME.pickups) GAME.scene.remove(p.g); GAME.pickups.length = 0; }

// ---------------------------------------------------------------- scoring hooks
function addScore(pts) { GAME.score += pts; HUD.score(); }

const ENEMY_HOOKS = {
  kill(e, cause, part) {
    if (cause === 'self') { HUD.left(); return; }
    const mult = P.multiplier();
    let base = e.t.score, label = e.t.label;
    const gun = cause === 'rifle' || cause === 'shotgun' || cause === 'revolver' || cause === 'sniper';
    if (part === 'head' && gun) { base = e.t.score * 2; label = 'HEADSHOT'; }
    else if (cause === 'melee') { base = e.t.score * 1.5; label = 'SLICED'; }
    else if (cause === 'fall') { base = e.t.score * 1.2; label = 'SPLAT'; }
    else if (cause === 'blast') { base = e.t.score; label = 'CHAIN INK'; }
    else if (cause === 'execute') { base = 0; label = ''; }
    else if (cause === 'returned') { base = e.t.score * 1.3; label = 'RETURNED'; }
    if (e.t.boss) { label = 'THE DOODLER ERASED'; base = e.t.score; }
    P.addCombo();
    P.addSlash(cause === 'melee' ? 22 : cause === 'execute' ? 0 : 7);
    if (base > 0) { const pts = Math.round(base * mult); addScore(pts); FX.popup(`${label} +${pts}`, e.t.boss ? 'big' : ''); }
    if (P.combo >= 2) HUD.combo();
    // drops
    const r = Math.random();
    if (e.t.boss) { spawnPickup('health', e.pos.x + 1, e.pos.y, e.pos.z); spawnPickup('ammo', e.pos.x - 1, e.pos.y, e.pos.z); }
    else if (r < 0.22) spawnPickup('ammo', e.pos.x, groundHeightAt(e.pos.x, e.pos.z, e.pos.y + 0.5), e.pos.z);
    else if (r < 0.3) spawnPickup('health', e.pos.x, groundHeightAt(e.pos.x, e.pos.z, e.pos.y + 0.5), e.pos.z);
    if (e.t.boss) { GAME.bossAlive = null; HUD.boss(); SFX.play('clear'); }
    HUD.left();
  },
  hurt(amount, sx, sz, kind) { P.hurt(amount, sx, sz, kind); HUD.hp(); },
  blast(x, y, z, r, dmg, source) {
    const dx = P.pos.x - x, dy = P.eyeY - 0.6 - y, dz = P.pos.z - z;
    const d = Math.hypot(dx, dy, dz);
    if (d < r) { P.hurt(dmg * (1 - d / r * 0.7), x, z, 'blast'); HUD.hp(); }
    for (const e of ENEMIES.list.slice()) {
      if (e === source || e.dead) continue;
      const ex = e.pos.x - x, ey = e.pos.y + 0.9 * e.s - y, ez = e.pos.z - z;
      const ed = Math.hypot(ex, ey, ez);
      if (ed < r + e.s * 0.5) e.damage(dmg * 1.5, 'body', { x: ex / (ed || 1), y: 0.3, z: ez / (ed || 1) }, 'blast');
    }
  },
  blocked(perfect) {
    const pts = perfect ? 75 : 19;
    addScore(pts);
    FX.popup(perfect ? `PERFECT PARRY +${pts}` : `BLOCKED +${pts}`, perfect ? '' : 'small');
    P.addSlash(perfect ? 15 : 6);
    FX.hitMarker = 0.2;
    SFX.play(perfect ? 'parry' : 'block');
  },
  returnedHit(e, part) { if (!e.dead) { addScore(40); FX.popup('RETURNED +40', 'small'); } },
};

const PLAYER_HOOKS = {
  rayCrate, hitCrate, slashCrates,
  weaponChanged() { HUD.weapon(); if (P.weapon().melee) HUD.tip(2, true); },
  ammoChanged() { HUD.ammo(); },
  yanked(e, fromLedge) {
    const pts = fromLedge ? 30 : 15;
    addScore(pts); FX.popup(`YANKED +${pts}`, 'small');
    HUD.score();
  },
  sliced(e) {},
  executed(e, airborne) {
    const pts = airborne ? 700 : 500;
    addScore(Math.round(pts * P.multiplier()));
    FX.popup(airborne ? `EXECUTED · AIRBORNE +${Math.round(pts * P.multiplier())}` : `EXECUTED +${Math.round(pts * P.multiplier())}`, 'big');
    if (airborne) { P.addAmmo(0.35); FX.popup('+AMMO (all guns)', 'small'); HUD.ammo(); }
    P.heal(6);
    FX.shake = Math.min(1, FX.shake + 0.4);
  },
  dashStarted() { HUD.slash(); GAME.slow = 0.75; },
  died() { onDeath(); },
};

// ---------------------------------------------------------------- waves
function waveComposition(n) {
  const list = [];
  const add = (t, k) => { for (let i = 0; i < k; i++) list.push(t); };
  add('gunner', 3 + Math.ceil(n / 2));
  if (n >= 2) add('rusher', Math.floor(n * 0.7));
  if (n >= 3) add('inkbomb', Math.floor((n - 1) / 2));
  if (n >= 4) add('sniper', Math.min(4, Math.floor(n / 2)));
  if (n >= 4) add('heavy', Math.floor((n - 2) / 2));
  // shuffle, then put snipers first so ledges fill early and the boss last
  for (let i = list.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [list[i], list[j]] = [list[j], list[i]]; }
  list.sort((a, b) => (a === 'sniper' ? -1 : 0) - (b === 'sniper' ? -1 : 0));
  if (n % 5 === 0) list.push('doodler');
  return list;
}

function startWave(n) {
  GAME.wave = n;
  GAME.spawnQueue = waveComposition(n);
  GAME.aliveTarget = GAME.spawnQueue.length;
  GAME.spawnT = 0.6; GAME.waveActive = true; GAME.intermission = 0;
  resetCrates(); refreshHealthCubes();
  const boss = n % 5 === 0;
  HUD.banner(`WAVE ${n}`, boss ? 'THE DOODLER IS COMING' : WAVE_SUBS[(n - 1) % WAVE_SUBS.length], 3.2);
  HUD.wave(); HUD.left();
  SFX.play('wave');
  if (n === 1) HUD.tip(0, true);
  else if (n === 4) HUD.tip(0, true);
  else if (n === 5) HUD.tip(1, true);
}

function spawnNext() {
  const type = GAME.spawnQueue.shift();
  if (!type) return;
  const t = ETYPES[type];
  let spot;
  if (t.ledge) {
    const free = LEVEL.spawns.ledge.filter(s => !ENEMIES.list.some(e => e.t.ledge && Math.abs(e.pos.x - s.x) < 1 && Math.abs(e.pos.z - s.z) < 1));
    spot = free.length ? free[(Math.random() * free.length) | 0] : null;
    if (!spot) { GAME.spawnQueue.unshift('gunner'); return spawnNext(); }
  } else {
    const far = LEVEL.spawns.ground.filter(s => Math.hypot(s.x - P.pos.x, s.z - P.pos.z) > 28);
    const pool = far.length ? far : LEVEL.spawns.ground;
    spot = pool[(Math.random() * pool.length) | 0];
    if (t.boss) { spot = pool.reduce((a, b) => Math.hypot(a.x - P.pos.x, a.z - P.pos.z) > Math.hypot(b.x - P.pos.x, b.z - P.pos.z) ? a : b); }
    spot = { x: spot.x + (Math.random() - 0.5) * 3, y: 0, z: spot.z + (Math.random() - 0.5) * 3 };
  }
  const e = ENEMIES.spawn(type, spot.x, spot.y || 0, spot.z);
  FX.burst(spot.x, (spot.y || 0) + 1, spot.z, 8, 'blood', 3);
  if (t.boss) { GAME.bossAlive = e; HUD.boss(); SFX.play('boss'); }
  HUD.left();
}

function updateWaves(dt) {
  if (!GAME.waveActive) {
    if (GAME.intermission > 0) {
      const before = Math.ceil(GAME.intermission);
      GAME.intermission -= dt;
      const after = Math.ceil(GAME.intermission);
      if (after !== before) HUD.next(after);
      if (GAME.intermission <= 0) startWave(GAME.wave + 1);
    }
    return;
  }
  if (GAME.spawnQueue.length) {
    GAME.spawnT -= dt;
    if (GAME.spawnT <= 0) { spawnNext(); GAME.spawnT = GAME.spawnQueue.length && ETYPES[GAME.spawnQueue[0]].boss ? 2.5 : 0.75; }
  } else if (ENEMIES.list.length === 0) {
    GAME.waveActive = false; GAME.intermission = 8;
    addScore(800);
    P.hp = P.maxHp; HUD.hp();
    P.addAmmo(0.2); HUD.ammo();
    HUD.banner(`WAVE ${GAME.wave} CLEARED`, 'catch your breath  +800', 4);
    HUD.next(8); HUD.left();
    SFX.play('clear');
    saveBest();
  }
}

// ---------------------------------------------------------------- state
function showTitle() {
  GAME.state = 'title';
  const ov = document.getElementById('overlay');
  ov.classList.remove('hidden');
  document.getElementById('ov-title').hidden = false;
  document.getElementById('ov-pause').hidden = true;
  document.getElementById('ov-dead').hidden = true;
  HUD.best();
}

function startGame() {
  GAME.state = 'playing';
  GAME.score = 0; GAME.wave = 0; GAME.bossAlive = null; GAME.waveActive = false; GAME.intermission = 0;
  ENEMIES.clear(); clearPickups(); resetCrates();
  for (const d of FX.decals) d.visible = false;
  P.reset();
  document.getElementById('overlay').classList.add('hidden');
  HUD.score(); HUD.hp(); HUD.weapon(); HUD.ammo(); HUD.combo(); HUD.boss(); HUD.next(0); HUD.slash();
  SFX.init(); SFX.resume();
  startWave(1);
  lockPointer();
}

function pauseGame() {
  if (GAME.state !== 'playing') return;
  GAME.state = 'paused';
  const ov = document.getElementById('overlay');
  ov.classList.remove('hidden');
  document.getElementById('ov-title').hidden = true;
  document.getElementById('ov-pause').hidden = false;
  document.getElementById('ov-dead').hidden = true;
}

function resumeGame() {
  if (GAME.state !== 'paused') return;
  GAME.state = 'playing';
  document.getElementById('overlay').classList.add('hidden');
  SFX.resume();
  lockPointer();
}

function onDeath() {
  GAME.state = 'dead';
  saveBest();
  setTimeout(() => {
    if (GAME.state !== 'dead') return;
    const ov = document.getElementById('overlay');
    ov.classList.remove('hidden');
    document.getElementById('ov-title').hidden = true;
    document.getElementById('ov-pause').hidden = true;
    document.getElementById('ov-dead').hidden = false;
    document.getElementById('dead-score').textContent = `SCORE ${GAME.score} · WAVE ${GAME.wave}`;
    HUD.best();
    if (document.pointerLockElement) document.exitPointerLock();
  }, 1400);
}

function loadBest() {
  try { const b = JSON.parse(localStorage.getItem('scribble.best') || 'null'); if (b) GAME.best = b; } catch (e) {}
}
function saveBest() {
  if (GAME.score > GAME.best.score || (GAME.score === GAME.best.score && GAME.wave > GAME.best.wave)) {
    GAME.best = { score: GAME.score, wave: GAME.wave };
    try { localStorage.setItem('scribble.best', JSON.stringify(GAME.best)); } catch (e) {}
  }
}

function lockPointer() {
  if (GAME.nolock || GAME.touch) return;
  const c = document.getElementById('gl');
  if (document.pointerLockElement !== c) { try { const r = c.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (e) {} }
}

// ---------------------------------------------------------------- HUD
const HUD = { el: {}, bannerT: 0 };
function buildHud() {
  const ids = ['score', 'combo', 'wave', 'left', 'next', 'boss', 'boss-fill', 'banner', 'banner-big', 'banner-sub', 'tip', 'hp-fill', 'hp-num', 'ammo-mag', 'ammo-res', 'ammo-state', 'tally', 'weapons', 'wname', 'wdesc', 'slash', 'slash-fill', 'slash-ready', 'best', 'scope', 'tint'];
  for (const id of ids) HUD.el[id] = document.getElementById(id);
  const rows = WEAPONS.map((w, i) => `<div class="wrow" data-i="${i}"><span class="slot">${i + 1}</span><span class="wn">${w.name}</span><span class="wa" id="wa-${i}"></span></div>`).join('');
  HUD.el.weapons.innerHTML = rows;
  HUD.tallyCtx = HUD.el.tally.getContext('2d');
  HUD.lastHp = -1; HUD.lastCombo = -1; HUD.lastSlash = -1; HUD.lastReady = null; HUD.lastReloading = null;
  HUD.el.slow = document.getElementById('slow');
}
HUD.score = function () { HUD.el.score.textContent = `SCORE ${GAME.score}`; };
HUD.combo = function () { const c = P.combo; HUD.el.combo.textContent = c >= 2 ? `combo x${c}` : ''; };
HUD.wave = function () { HUD.el.wave.textContent = `WAVE ${GAME.wave}`; };
HUD.left = function () {
  const n = ENEMIES.list.length + GAME.spawnQueue.length;
  HUD.el.left.textContent = `${n} ${n === 1 ? 'enemy' : 'enemies'} left`;
};
HUD.next = function (n) { HUD.el.next.textContent = n > 0 ? `next wave in ${n}` : ''; };
HUD.boss = function () {
  const b = GAME.bossAlive;
  HUD.el.boss.hidden = !b;
  if (b) HUD.el['boss-fill'].style.width = Math.max(0, 100 * b.hp / b.maxHp).toFixed(1) + '%';
};
HUD.hp = function () {
  const k = Math.max(0, P.hp / P.maxHp);
  HUD.el['hp-fill'].style.width = (k * 100).toFixed(1) + '%';
  HUD.el['hp-num'].textContent = Math.round(P.hp);
};
HUD.weapon = function () {
  const w = P.weapon();
  HUD.el.wname.textContent = w.name;
  HUD.el.wdesc.textContent = w.desc;
  for (const r of HUD.el.weapons.children) r.classList.toggle('on', +r.dataset.i === P.wi);
  HUD.el.slash.hidden = !w.melee;
  HUD.ammo();
};
HUD.ammo = function () {
  const w = P.weapon(), a = P.ammo[P.wi];
  for (let i = 0; i < WEAPONS.length; i++) {
    const el = document.getElementById('wa-' + i);
    el.textContent = WEAPONS[i].melee ? '∞' : `${P.ammo[i].mag}/${P.ammo[i].reserve}`;
  }
  if (w.melee) { HUD.el['ammo-mag'].textContent = '∞'; HUD.el['ammo-res'].textContent = ''; HUD.el['ammo-state'].textContent = ''; HUD.tally(0); return; }
  HUD.el['ammo-mag'].textContent = a.mag;
  HUD.el['ammo-res'].textContent = `/${a.reserve}`;
  HUD.el['ammo-state'].textContent = P.reloading ? 'reloading…' : (a.mag === 0 && a.reserve === 0 ? 'empty' : '');
  HUD.tally(a.mag);
};
HUD.tally = function (n) {
  const c = HUD.el.tally, ctx = HUD.tallyCtx;
  const groups = Math.ceil(n / 5);
  const W = Math.max(40, groups * 34 + 10), H = 22;
  if (c.width !== W * 2 || c.height !== H * 2) { c.width = W * 2; c.height = H * 2; c.style.width = W + 'px'; c.style.height = H + 'px'; }
  ctx.setTransform(2, 0, 0, 2, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.strokeStyle = '#2b34b4'; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
  let left = n;
  for (let g = 0; g < groups; g++) {
    const x0 = 4 + g * 34;
    const k = Math.min(5, left); left -= k;
    for (let i = 0; i < Math.min(4, k); i++) {
      ctx.beginPath(); ctx.moveTo(x0 + i * 6 + 1, 3 + (i % 2)); ctx.lineTo(x0 + i * 6, 18); ctx.stroke();
    }
    if (k === 5) { ctx.beginPath(); ctx.moveTo(x0 - 3, 15); ctx.lineTo(x0 + 22, 5); ctx.stroke(); }
  }
};
HUD.slash = function () {
  HUD.el['slash-fill'].style.height = P.slashMeter.toFixed(0) + '%';
  HUD.el['slash-ready'].textContent = P.slashReady ? 'SLASH READY' : '';
  HUD.el.slash.classList.toggle('ready', P.slashReady);
  if (P.slashReady && !HUD.readyShown) { HUD.readyShown = true; HUD.tipText('SLASH READY · shift to dash', 8); }
  if (!P.slashReady) HUD.readyShown = false;
};
HUD.tipText = function (text, dur) {
  HUD.el.tip.textContent = text;
  HUD.el.tip.classList.add('show');
  GAME.tipT = dur;
};
HUD.banner = function (big, sub, dur) {
  HUD.el['banner-big'].textContent = big;
  HUD.el['banner-sub'].textContent = sub;
  HUD.el.banner.classList.add('show');
  HUD.bannerT = dur;
};
HUD.tip = function (i, force) {
  if (i != null) GAME.tipI = i; else GAME.tipI = (GAME.tipI + 1) % TIPS.length;
  HUD.el.tip.textContent = TIPS[GAME.tipI];
  HUD.el.tip.classList.add('show');
  GAME.tipT = force ? 16 : 14;
};
HUD.best = function () {
  HUD.el.best.textContent = GAME.best.score > 0 ? `BEST ${GAME.best.score} · WAVE ${GAME.best.wave}` : '';
};
HUD.update = function (dt) {
  if (HUD.bannerT > 0) { HUD.bannerT -= dt; if (HUD.bannerT <= 0) HUD.el.banner.classList.remove('show'); }
  if (GAME.tipT > 0) { GAME.tipT -= dt; if (GAME.tipT <= 0) { HUD.el.tip.classList.remove('show'); GAME.tipT = -8; } }
  else if (GAME.tipT < 0 && GAME.state === 'playing') { GAME.tipT += dt; if (GAME.tipT >= 0) HUD.tip(null); }
  HUD.el.scope.hidden = P.scopeK < 0.6;
  if (GAME.bossAlive) HUD.boss();
};

// ---------------------------------------------------------------- input
function bindInput() {
  const keys = GAME.keys, inp = P.input;
  window.addEventListener('keydown', e => {
    if (e.repeat) return;
    keys[e.code] = true;
    if (GAME.state === 'playing') {
      if (e.code === 'Space') { inp.jump = true; e.preventDefault(); }
      if (e.code === 'KeyE' || e.code === 'KeyF') inp.grapplePressed = true;
      if (e.code === 'KeyR') inp.reload = true;
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') inp.dash = true;
      if (e.code === 'KeyQ') P.switchTo(P.wi === 4 ? 0 : 4);
      if (e.code.startsWith('Digit')) { const i = +e.code.slice(5) - 1; if (i >= 0 && i < 5) P.switchTo(i); }
      if (e.code === 'KeyM') SFX.toggle();
      if (e.code === 'KeyP') pauseGame();
    } else if (e.code === 'Enter' || e.code === 'Space') {
      if (GAME.state === 'title' || GAME.state === 'dead') startGame();
      else if (GAME.state === 'paused') resumeGame();
    }
    if (e.code === 'Escape' && GAME.state === 'playing' && GAME.nolock) pauseGame();
  });
  window.addEventListener('keyup', e => { keys[e.code] = false; });
  const gl = document.getElementById('gl');
  const ov = document.getElementById('overlay');
  ov.addEventListener('click', () => {
    if (GAME.state === 'title' || GAME.state === 'dead') startGame();
    else if (GAME.state === 'paused') resumeGame();
  });
  window.addEventListener('mousedown', e => {
    if (GAME.state !== 'playing') return;
    if (e.button === 0) { inp.fire = true; inp.firePressed = true; }
    if (e.button === 2) { inp.aim = true; inp.aimPressed = true; }
    if (e.button === 1 || e.button === 3 || e.button === 4) { inp.grapplePressed = true; e.preventDefault(); }
  });
  window.addEventListener('mouseup', e => {
    if (e.button === 0) inp.fire = false;
    if (e.button === 2) inp.aim = false;
  });
  window.addEventListener('contextmenu', e => e.preventDefault());
  window.addEventListener('mousemove', e => {
    if (GAME.state !== 'playing') return;
    if (document.pointerLockElement === gl || GAME.nolock) { inp.mdx += e.movementX; inp.mdy += e.movementY; }
  });
  window.addEventListener('wheel', e => {
    if (GAME.state !== 'playing') return;
    const d = e.deltaY > 0 ? 1 : -1;
    P.switchTo((P.wi + d + WEAPONS.length) % WEAPONS.length);
  }, { passive: true });
  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement !== gl && GAME.state === 'playing' && !GAME.nolock && !GAME.touch) pauseGame();
  });
  window.addEventListener('blur', () => { if (GAME.state === 'playing') pauseGame(); });
  if (GAME.touch) bindTouch();
}

function readKeyboard() {
  const k = GAME.keys, inp = P.input;
  let f = 0, s = 0;
  if (k.KeyW || k.ArrowUp) f += 1;
  if (k.KeyS || k.ArrowDown) f -= 1;
  if (k.KeyD || k.ArrowRight) s += 1;
  if (k.KeyA || k.ArrowLeft) s -= 1;
  inp.fwd = f; inp.side = s;
}

function readGamepad() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  let gp = null;
  for (const p of pads) if (p && p.connected) { gp = p; break; }
  if (!gp) return;
  const inp = P.input, dz = v => Math.abs(v) < 0.15 ? 0 : v;
  const lx = dz(gp.axes[0] || 0), ly = dz(gp.axes[1] || 0), rx = dz(gp.axes[2] || 0), ry = dz(gp.axes[3] || 0);
  if (lx || ly) { inp.side = lx; inp.fwd = -ly; }
  inp.mdx += rx * 14; inp.mdy += ry * 14;
  const b = i => !!(gp.buttons[i] && (gp.buttons[i].pressed || gp.buttons[i].value > 0.5));
  const was = GAME.gamepad.lastButtons;
  const pressed = i => b(i) && !was[i];
  if (GAME.state === 'playing') {
    inp.fire = inp.fire || b(7); if (pressed(7)) inp.firePressed = true;
    inp.aim = inp.aim || b(6); if (pressed(6)) inp.aimPressed = true;
    if (pressed(0)) inp.jump = true;
    if (pressed(2)) inp.reload = true;
    if (pressed(4)) inp.grapplePressed = true;
    if (pressed(5)) inp.dash = true;
    if (pressed(3) || pressed(12)) P.switchTo((P.wi + 1) % WEAPONS.length);
    if (pressed(13)) P.switchTo((P.wi + WEAPONS.length - 1) % WEAPONS.length);
    if (pressed(9)) pauseGame();
  } else if (pressed(0) || pressed(9)) {
    if (GAME.state === 'title' || GAME.state === 'dead') startGame(); else if (GAME.state === 'paused') resumeGame();
  }
  GAME.gamepad.lastButtons = gp.buttons.map(x => x.pressed || x.value > 0.5);
}

// touch: left half = move stick, right half = look; buttons on the right
function bindTouch() {
  const inp = P.input;
  const root = document.getElementById('touch');
  root.hidden = false;
  const stick = document.getElementById('stick'), nub = stick.querySelector('.nub');
  let moveId = null, lookId = null, moveOrigin = null, lookLast = null;
  const fireBtn = document.getElementById('t-fire');
  const btn = (id, down, up) => {
    const el = document.getElementById(id);
    el.addEventListener('touchstart', e => { e.preventDefault(); down(); }, { passive: false });
    el.addEventListener('touchend', e => { e.preventDefault(); if (up) up(); }, { passive: false });
  };
  btn('t-fire', () => { inp.fire = true; inp.firePressed = true; }, () => { inp.fire = false; });
  btn('t-aim', () => { inp.aim = !inp.aim; inp.aimPressed = true; });
  btn('t-jump', () => { inp.jump = true; });
  btn('t-grapple', () => { inp.grapplePressed = true; });
  btn('t-reload', () => { inp.reload = true; });
  btn('t-dash', () => { inp.dash = true; });
  btn('t-swap', () => { P.switchTo((P.wi + 1) % WEAPONS.length); });
  const zone = document.getElementById('touch-zone');
  zone.addEventListener('touchstart', e => {
    e.preventDefault();
    if (GAME.state !== 'playing') { if (GAME.state === 'title' || GAME.state === 'dead') startGame(); else if (GAME.state === 'paused') resumeGame(); return; }
    for (const t of e.changedTouches) {
      if (t.clientX < GAME.W * 0.42 && moveId === null) {
        moveId = t.identifier; moveOrigin = { x: t.clientX, y: t.clientY };
        stick.style.left = (t.clientX - 60) + 'px'; stick.style.top = (t.clientY - 60) + 'px'; stick.classList.add('on');
      } else if (lookId === null) { lookId = t.identifier; lookLast = { x: t.clientX, y: t.clientY }; }
    }
  }, { passive: false });
  zone.addEventListener('touchmove', e => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === moveId) {
        const dx = t.clientX - moveOrigin.x, dy = t.clientY - moveOrigin.y;
        const l = Math.hypot(dx, dy), m = Math.min(1, l / 50);
        inp.side = l ? dx / l * m : 0; inp.fwd = l ? -dy / l * m : 0;
        nub.style.transform = `translate(${dx * Math.min(1, 50 / (l || 1))}px, ${dy * Math.min(1, 50 / (l || 1))}px)`;
      } else if (t.identifier === lookId) {
        inp.mdx += (t.clientX - lookLast.x) * 2.2; inp.mdy += (t.clientY - lookLast.y) * 2.2;
        lookLast = { x: t.clientX, y: t.clientY };
      }
    }
  }, { passive: false });
  const end = e => {
    for (const t of e.changedTouches) {
      if (t.identifier === moveId) { moveId = null; inp.side = 0; inp.fwd = 0; nub.style.transform = ''; stick.classList.remove('on'); }
      if (t.identifier === lookId) lookId = null;
    }
  };
  zone.addEventListener('touchend', end); zone.addEventListener('touchcancel', end);
  document.getElementById('overlay').addEventListener('touchstart', e => {
    e.preventDefault();
    if (GAME.state === 'title' || GAME.state === 'dead') startGame(); else if (GAME.state === 'paused') resumeGame();
  }, { passive: false });
  GAME.touchMoveActive = () => moveId !== null;
}

// ---------------------------------------------------------------- loop
const FIXED = 1 / 60;
function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.1, (now - GAME.last) / 1000);
  GAME.last = now;
  if (GAME.state === 'playing' || GAME.state === 'dead') {
    if (!GAME.touch || !GAME.touchMoveActive || !GAME.touchMoveActive()) readKeyboard();
    readGamepad();
    if (GAME.slow > 0) { GAME.slow -= dt; HUD.el.slow.style.opacity = Math.min(1, GAME.slow * 2).toFixed(2); dt *= 0.42; }
    else if (HUD.el.slow.style.opacity !== '0') HUD.el.slow.style.opacity = '0';
    GAME.acc += dt;
    let steps = 0;
    while (GAME.acc >= FIXED && steps < 4) {
      step(FIXED);
      GAME.acc -= FIXED; steps++;
    }
    if (steps === 4) GAME.acc = 0;
  } else {
    readGamepad();
    // idle: keep the scene alive on the title screen
    updateSky(GAME.camera.position, GAME.time, dt);
    GAME.time += dt;
    P.updateCamera(dt);
    if (GAME.state === 'title') { P.yaw += dt * 0.05; }
  }
  render(dt);
}

function step(dt) {
  GAME.time += dt;
  P.update(dt);
  ENEMIES.update(dt, P);
  FX.update(dt);
  updatePickups(dt);
  updateWaves(dt);
  HUD.update(dt);
  updateSky(GAME.camera.position, GAME.time, dt);
  if (GAME.state === 'playing') {
    if (Math.abs(P.hp - HUD.lastHp) > 0.4) { HUD.lastHp = P.hp; HUD.hp(); }
    if (P.combo !== HUD.lastCombo) { HUD.lastCombo = P.combo; HUD.combo(); }
    if (P.slashMeter !== HUD.lastSlash || P.slashReady !== HUD.lastReady) { HUD.lastSlash = P.slashMeter; HUD.lastReady = P.slashReady; HUD.slash(); }
    if (P.reloading !== HUD.lastReloading) { HUD.lastReloading = P.reloading; HUD.ammo(); }
  }
}

function render(dt) {
  GAME.renderer.render(GAME.scene, GAME.camera);
  FX.draw2D(GAME.fxCtx, GAME.W, GAME.H, {
    weapon: P.weapon().id, scoped: P.scopeK > 0.6, ads: P.adsK > 0.7, onEnemy: P.onEnemy, blocking: P.blocking,
    spread: P.view.recoil + (Math.hypot(P.vel.x, P.vel.z) > 1 ? 0.25 : 0) + (P.grounded ? 0 : 0.4) - P.adsK * 0.3,
    grappleable: P.grappleable && GAME.state === 'playing', dead: P.dead || GAME.state !== 'playing',
  });
}

window.addEventListener('DOMContentLoaded', boot);
