'use strict';
// ---------------------------------------------------------------------------
// player.js — first-person body, weapons, grapple, katana, view models.
// ---------------------------------------------------------------------------

const WEAPONS = [
  { id: 'rifle',    name: 'RIFLE',    desc: 'auto · aim for the holo sight',                mag: 30, reserve: 150, dmg: 14,  headMul: 2.5, rpm: 600, auto: true,  spread: 0.012, reload: 1.6, kick: 0.05, sfx: 'rifle' },
  { id: 'shotgun',  name: 'SHOTGUN',  desc: 'pump · devastating up close',                  mag: 6,  reserve: 30,  dmg: 13,  headMul: 1.6, rpm: 72,  pellets: 8,  spread: 0.075, reload: 2.2, kick: 0.14, range: 26, pump: true, sfx: 'shotgun' },
  { id: 'revolver', name: 'REVOLVER', desc: 'hand cannon · headshots erase',                mag: 6,  reserve: 36,  dmg: 55,  headMul: 30,  rpm: 150, spread: 0.004, reload: 2.0, kick: 0.12, sfx: 'revolver' },
  { id: 'sniper',   name: 'SNIPER',   desc: 'scoped bolt action · one shot, one erasure',   mag: 5,  reserve: 25,  dmg: 220, headMul: 3,   rpm: 48,  spread: 0.02,  reload: 2.4, kick: 0.2,  scope: true, bolt: true, sfx: 'sniper' },
  { id: 'katana',   name: 'KATANA',   desc: 'slash · hold aim to block & return bullets',   melee: true, dmg: 95, rpm: 165, range: 3.0, cone: 0.5, sfx: 'slash' },
];

const P = {
  pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, hw: 0.35, h: 1.75, grounded: false,
  yaw: 0, pitch: 0, coyote: 0,
  hp: 100, maxHp: 100, regenT: 0, dead: false,
  wi: 0, ammo: [], fireT: 0, reloadT: 0, reloadTotal: 1, reloading: false, swapT: 0, pendingWi: -1,
  scoped: false, scopeK: 0, ads: false, adsK: 0, bloodT: 0, blocking: false, blockAge: 0,
  grapple: { active: false, x: 0, y: 0, z: 0, t: 0, nx: 0, ny: 0, nz: 0 },
  dash: { t: 0, dx: 0, dy: 0, dz: 0, hit: null },
  slashMeter: 0, slashReady: false,
  combo: 0, comboT: 0,
  view: { bob: 0, bobT: 0, recoil: 0, swayX: 0, swayY: 0, slashAnim: 0, slashDir: 1, pumpAnim: 0, boltAnim: 0, flash: 0 },
  input: { fwd: 0, side: 0, jump: false, fire: false, firePressed: false, aim: false, grapplePressed: false, reload: false, dash: false, mdx: 0, mdy: 0 },
  onEnemy: false, grappleable: false,
  camera: null, vm: null, models: {}, rope: null, hooks: null, muzzleObj: null,
};
Object.defineProperty(P, 'eyeY', { get() { return P.pos.y + 1.6; } });
Object.defineProperty(P, 'x', { get() { return P.pos.x; } });
Object.defineProperty(P, 'y', { get() { return P.pos.y; } });
Object.defineProperty(P, 'z', { get() { return P.pos.z; } });

const _dir = new THREE.Vector3(), _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3();

P.init = function (camera, scene, hooks) {
  P.camera = camera; P.hooks = hooks;
  P.reset();
  // view models
  P.vm = new THREE.Group();
  camera.add(P.vm);
  buildWeaponModels();
  for (const id in P.models) P.vm.add(P.models[id].g);
  // rope
  P.rope = new THREE.Mesh(penGeometry(new Float32Array(6)), makePenMaterial({ width: 3.2, ink: INK.blue, alpha: 0.95 }));
  P.rope.frustumCulled = false; P.rope.visible = false;
  scene.add(P.rope);
  P.muzzleFlash = makeSprite(dotTexture('#ffd36b'), 0.12, 0.12, { depthTest: false });
  P.muzzleFlash.visible = false;
  P.vm.add(P.muzzleFlash);
};

P.reset = function () {
  const s = LEVEL.playerStart;
  P.pos.x = s.x; P.pos.y = s.y; P.pos.z = s.z; P.vel.x = P.vel.y = P.vel.z = 0;
  P.yaw = s.yaw; P.pitch = 0;
  P.hp = P.maxHp; P.dead = false; P.regenT = 0;
  P.ammo = WEAPONS.map(w => ({ mag: w.mag || 0, reserve: w.reserve || 0 }));
  P.wi = 0; P.pendingWi = -1; P.fireT = 0; P.reloading = false; P.swapT = 0;
  P.scoped = false; P.scopeK = 0; P.ads = false; P.adsK = 0; P.bloodT = 0; P.blocking = false; P.blockAge = 0;
  P.grapple.active = false; P.dash.t = 0; P.slashMeter = 0; P.slashReady = false;
  P.combo = 0; P.comboT = 0;
  P.view.recoil = 0; P.view.slashAnim = 0; P.view.pumpAnim = 0; P.view.boltAnim = 0;
  if (P.rope) P.rope.visible = false;
};

P.weapon = function () { return WEAPONS[P.wi]; };

// view direction with optional spread
P.viewDir = function (out, spread = 0) {
  const cp = Math.cos(P.pitch), sp = Math.sin(P.pitch), cy = Math.cos(P.yaw), sy = Math.sin(P.yaw);
  out.set(-sy * cp, sp, -cy * cp);
  if (spread > 0) {
    out.x += (Math.random() - 0.5) * spread * 2; out.y += (Math.random() - 0.5) * spread * 2; out.z += (Math.random() - 0.5) * spread * 2;
    out.normalize();
  }
  return out;
};

// ---------------------------------------------------------------- damage
P.hurt = function (amount, sx, sz, kind) {
  if (P.dead || P.god) return;
  if (P.dash.t > 0) amount *= 0.3;
  P.hp -= amount;
  P.regenT = 4;
  FX.hurt(amount);
  // screen-space direction of the attacker (0 = up) for the hit arc
  if (sx != null) {
    const dx = sx - P.pos.x, dz = sz - P.pos.z;
    const ang = Math.atan2(dx, -dz) - P.yaw;
    FX.hitDir = ang - Math.PI / 2;
  }
  if (P.hp <= 0) { P.hp = 0; P.dead = true; P.scoped = false; P.blocking = false; P.grapple.active = false; P.rope.visible = false; SFX.play('dead'); P.hooks.died(); }
};

P.heal = function (n) { P.hp = Math.min(P.maxHp, P.hp + n); };

P.addAmmo = function (frac) {
  for (let i = 0; i < WEAPONS.length; i++) {
    const w = WEAPONS[i]; if (!w.reserve) continue;
    P.ammo[i].reserve = Math.min(w.reserve * 2, P.ammo[i].reserve + Math.ceil(w.reserve * frac));
  }
};

P.addCombo = function () {
  P.combo = P.combo + 1; P.comboT = 3.2;
};
P.multiplier = function () { return 1 + 0.25 * Math.min(8, Math.max(0, P.combo - 1)); };

P.addSlash = function (n) {
  if (P.slashReady) return;
  P.slashMeter = Math.min(100, P.slashMeter + n);
  if (P.slashMeter >= 100) { P.slashReady = true; SFX.play('ready'); }
};

// is a projectile at (x,y,z) inside the katana guard?
P.blockDot = function (x, y, z) {
  const dx = x - P.pos.x, dy = y - P.eyeY, dz = z - P.pos.z;
  const l = Math.hypot(dx, dy, dz) || 1;
  if (l > 3.4) return false;
  P.viewDir(_dir);
  return (dx * _dir.x + dy * _dir.y + dz * _dir.z) / l > 0.3;
};

// ---------------------------------------------------------------- update
P.update = function (dt) {
  const inp = P.input, w = P.weapon();
  if (P.dead) { P.vel.y -= 24 * dt; moveBody(P, dt, 0); P.updateCamera(dt); return; }

  // look
  const sens = 0.0022 * (P.scoped ? 0.28 : 1);
  P.yaw -= inp.mdx * sens; P.pitch -= inp.mdy * sens;
  P.pitch = Math.max(-1.45, Math.min(1.45, P.pitch));
  P.view.swayX += (-inp.mdx * 0.0008 - P.view.swayX) * Math.min(1, dt * 12);
  P.view.swayY += (-inp.mdy * 0.0008 - P.view.swayY) * Math.min(1, dt * 12);
  inp.mdx = 0; inp.mdy = 0;

  // stances: sniper scopes while aim is held; other guns shoulder the sight
  P.scoped = !!(w.scope && inp.aim && P.view.boltAnim <= 0 && !P.reloading && P.swapT <= 0);
  P.ads = !!(!w.scope && !w.melee && inp.aim && !P.reloading && P.swapT <= 0 && P.dash.t <= 0);
  P.adsK += ((P.ads ? 1 : 0) - P.adsK) * Math.min(1, dt * 14);
  inp.aimPressed = false;
  const wasBlocking = P.blocking;
  P.blocking = !!(w.melee && inp.aim && P.dash.t <= 0);
  if (P.blocking) { if (!wasBlocking) P.blockAge = 0; else P.blockAge += dt; }
  P.scopeK += ((P.scoped ? 1 : 0) - P.scopeK) * Math.min(1, dt * 10);

  // movement
  const cy = Math.cos(P.yaw), sy = Math.sin(P.yaw);
  let fx = -sy * inp.fwd + cy * inp.side, fz = -cy * inp.fwd - sy * inp.side;
  const fl = Math.hypot(fx, fz);
  if (fl > 1) { fx /= fl; fz /= fl; }
  let speed = 7.6;
  if (P.blocking) speed *= 0.6;
  if (P.scoped) speed *= 0.45;
  if (P.ads) speed *= 0.7;
  if (P.grounded) P.coyote = 0.12; else P.coyote -= dt;

  if (P.dash.t > 0) {
    P.dash.t -= dt;
    P.vel.x = P.dash.dx * 38; P.vel.y = P.dash.dy * 38; P.vel.z = P.dash.dz * 38;
    moveBody(P, dt, 0.55);
    P.dashSlice();
    if (P.dash.t <= 0) { P.vel.x *= 0.25; P.vel.z *= 0.25; P.vel.y = Math.min(P.vel.y, 4); P.dashEnd(); }
  } else if (P.grapple.active) {
    const g = P.grapple;
    g.t += dt;
    let gx = g.x - P.pos.x, gy = g.y - P.eyeY, gz = g.z - P.pos.z;
    const gl = Math.hypot(gx, gy, gz) || 1;
    gx /= gl; gy /= gl; gz /= gl;
    const pull = 70;
    P.vel.x += (gx * pull + fx * 12) * dt; P.vel.y += (gy * pull - 6) * dt; P.vel.z += (gz * pull + fz * 12) * dt;
    const sp = Math.hypot(P.vel.x, P.vel.y, P.vel.z);
    if (sp > 28) { P.vel.x *= 28 / sp; P.vel.y *= 28 / sp; P.vel.z *= 28 / sp; }
    moveBody(P, dt, 0.55);
    const done = gl < 2.2 || g.t > 3.5 || inp.grapplePressed || (inp.jump && g.t > 0.15);
    if (done) {
      P.grapple.active = false; P.rope.visible = false;
      // a little lift so you land on the ledge you aimed at
      if (gl < 3 && g.ny > 0.5) P.vel.y = Math.max(P.vel.y, 6);
      else if (gl < 3) { P.vel.y = Math.max(P.vel.y, 5); }
      inp.grapplePressed = false;
    }
  } else {
    const accel = P.grounded ? 60 : 14;
    const tx = fx * speed, tz = fz * speed;
    if (P.grounded) {
      P.vel.x += (tx - P.vel.x) * Math.min(1, accel * dt / speed);
      P.vel.z += (tz - P.vel.z) * Math.min(1, accel * dt / speed);
    } else {
      P.vel.x += tx * accel * dt / speed; P.vel.z += tz * accel * dt / speed;
      const hs = Math.hypot(P.vel.x, P.vel.z);
      if (hs > speed * 1.4) { P.vel.x *= speed * 1.4 / hs; P.vel.z *= speed * 1.4 / hs; }
    }
    if (inp.jump && P.coyote > 0) { P.vel.y = 8.6; P.coyote = 0; inp.jump = false; SFX.play('jump'); }
    P.vel.y -= 24 * dt;
    moveBody(P, dt, 0.55);
  }
  inp.jump = false;
  if (P.pos.y < -20) { const s = LEVEL.playerStart; P.pos.x = s.x; P.pos.y = s.y + 1; P.pos.z = s.z; P.vel.x = P.vel.y = P.vel.z = 0; P.hurt(25, null); }
  // clamp inside the walls in case of tunnelling
  const B = LEVEL.bounds - 0.5;
  P.pos.x = Math.max(-B, Math.min(B, P.pos.x)); P.pos.z = Math.max(-B, Math.min(B, P.pos.z));

  // health regen
  if (P.regenT > 0) P.regenT -= dt; else if (P.hp < P.maxHp) P.hp = Math.min(P.maxHp, P.hp + 7 * dt);
  // combo decay
  if (P.comboT > 0) { P.comboT -= dt; if (P.comboT <= 0) P.combo = 0; }

  // grapple fire
  if (inp.grapplePressed) { inp.grapplePressed = false; if (!P.grapple.active && P.dash.t <= 0) P.fireGrapple(); }
  // dash
  if (inp.dash) { inp.dash = false; if (w.melee && P.slashReady && P.dash.t <= 0) P.startDash(); }

  // weapons
  if (P.swapT > 0) {
    P.swapT -= dt;
    if (P.swapT <= 0.15 && P.pendingWi >= 0) { P.wi = P.pendingWi; P.pendingWi = -1; P.hooks.weaponChanged(); }
  }
  P.fireT -= dt;
  if (P.reloading) {
    P.reloadT -= dt;
    if (P.reloadT <= 0) {
      const a = P.ammo[P.wi], ww = P.weapon();
      const need = ww.mag - a.mag, take = Math.min(need, a.reserve);
      a.mag += take; a.reserve -= take; P.reloading = false;
      P.hooks.ammoChanged();
    }
  }
  if (inp.reload) { inp.reload = false; P.tryReload(); }
  if (!w.melee && !P.reloading && P.swapT <= 0 && P.ammo[P.wi].mag === 0 && P.ammo[P.wi].reserve > 0 && P.fireT <= 0) P.tryReload();

  const wantFire = w.auto ? inp.fire : inp.firePressed;
  if (wantFire && P.fireT <= 0 && !P.reloading && P.swapT <= 0 && P.dash.t <= 0 && !P.blocking) {
    if (w.melee) P.slash();
    else if (P.ammo[P.wi].mag > 0) P.shoot();
  }
  inp.firePressed = false;
  if (P.blocking && inp.firePressed) inp.firePressed = false;

  // what is under the crosshair (for the crosshair colour / grapple glyph)
  P.viewDir(_dir);
  const eh = ENEMIES.rayHit(P.pos.x, P.eyeY, P.pos.z, _dir.x, _dir.y, _dir.z, 120);
  P.onEnemy = !!eh;
  if (!P.grapple.active) {
    const lv = rayLevel(P.pos.x, P.eyeY, P.pos.z, _dir.x, _dir.y, _dir.z, 70);
    P.grappleable = !!(lv || (eh && eh.t < 70));
  } else P.grappleable = false;

  P.updateCamera(dt);
};

P.tryReload = function () {
  const w = P.weapon(), a = P.ammo[P.wi];
  if (w.melee || P.reloading || a.mag >= w.mag || a.reserve <= 0 || P.swapT > 0) return;
  P.reloading = true; P.reloadT = w.reload; P.reloadTotal = w.reload; P.scoped = false;
  SFX.play('reload');
  P.hooks.ammoChanged();
};

P.switchTo = function (i) {
  if (i === P.wi || i < 0 || i >= WEAPONS.length || P.pendingWi === i) return;
  P.pendingWi = i; P.swapT = 0.32; P.reloading = false; P.scoped = false; P.blocking = false;
};

// ---------------------------------------------------------------- shooting
const _hp = new THREE.Vector3();
P.shoot = function () {
  const w = P.weapon(), a = P.ammo[P.wi];
  a.mag--; P.fireT = 60 / w.rpm;
  const pellets = w.pellets || 1;
  const spread = P.scoped ? 0.001 : w.spread * (P.grounded ? 1 : 1.8) * (P.ads ? 0.45 : 1);
  const ox = P.pos.x, oy = P.eyeY, oz = P.pos.z;
  let hitAny = false, killed = false;
  for (let i = 0; i < pellets; i++) {
    P.viewDir(_dir, spread);
    const maxT = w.range || 300;
    const lv = rayLevel(ox, oy, oz, _dir.x, _dir.y, _dir.z, maxT);
    let tl = lv ? lv.t : maxT;
    const cr = P.hooks.rayCrate(ox, oy, oz, _dir.x, _dir.y, _dir.z, tl);
    if (cr) tl = cr.t;
    const eh = ENEMIES.rayHit(ox, oy, oz, _dir.x, _dir.y, _dir.z, tl);
    if (eh) {
      let dmg = w.dmg;
      if (eh.part === 'head') dmg *= w.headMul;
      if (w.pellets && eh.t > 10) dmg *= Math.max(0.25, 1 - (eh.t - 10) / 16);
      const e = eh.e;
      e.damage(dmg, eh.part, { x: _dir.x, y: _dir.y, z: _dir.z }, w.id);
      hitAny = true;
      if (e.dead) killed = true;
    } else if (cr) {
      P.hooks.hitCrate(cr.crate, w.dmg * 1.5, ox + _dir.x * cr.t, oy + _dir.y * cr.t, oz + _dir.z * cr.t);
    } else if (lv) {
      const hx = ox + _dir.x * lv.t, hy = oy + _dir.y * lv.t, hz = oz + _dir.z * lv.t;
      FX.decal(hx, hy, hz, lv.nx, lv.ny, lv.nz, 0.12 + Math.random() * 0.15, 'ink');
      if (i === 0) FX.burst(hx, hy, hz, 3, 'ink', 2.5, lv.nx, lv.ny, lv.nz);
    }
  }
  if (hitAny) { FX.hitMarker = 0.25; SFX.play(killed ? 'splat' : 'hit'); }
  P.view.recoil = Math.min(0.35, P.view.recoil + w.kick);
  P.pitch += w.kick * (P.scoped ? 0.15 : 0.5);
  P.view.flash = 0.05;
  if (w.pump) P.view.pumpAnim = 0.5;
  if (w.id === 'rifle' && P.models.rifle.muzzle) { P.models.rifle.muzzle.getWorldPosition(_v1); FX.chunks(_v1.x, _v1.y, _v1.z, 1, 'orange', 0.05, 2); }
  if (w.bolt) { P.view.boltAnim = 0.7; P.scoped = false; }
  SFX.play(w.sfx);
  P.hooks.ammoChanged();
};

// katana swing: cone in front, big damage, slices crates too
P.slash = function () {
  const w = P.weapon();
  P.fireT = 60 / w.rpm;
  P.view.slashAnim = 0.26; P.view.slashDir *= -1;
  FX.slashArc(P.view.slashDir);
  SFX.play('slash');
  P.viewDir(_dir);
  let hit = false;
  for (const e of ENEMIES.list.slice()) {
    if (e.dead || e.state === 'spawn') continue;
    e.bodyPos(_hp);
    const dx = _hp.x - P.pos.x, dy = _hp.y - P.eyeY, dz = _hp.z - P.pos.z;
    const l = Math.hypot(dx, dy, dz);
    if (l > w.range * (0.7 + 0.3 * e.s) + 0.4) continue;
    const dot = (dx * _dir.x + dy * _dir.y + dz * _dir.z) / (l || 1);
    if (dot < w.cone) continue;
    const kd = { x: dx / (l || 1), y: 0.1, z: dz / (l || 1) };
    e.damage(w.dmg, 'body', kd, 'melee');
    hit = true;
    if (e.dead) { P.bloodT = 0.6; P.hooks.sliced(e); }
  }
  P.hooks.slashCrates(P.pos.x, P.eyeY, P.pos.z, _dir, w.range + 0.8);
  if (hit) { FX.hitMarker = 0.2; SFX.play('splat'); }
};

// ---------------------------------------------------------------- grapple
P.fireGrapple = function () {
  P.viewDir(_dir);
  const ox = P.pos.x, oy = P.eyeY, oz = P.pos.z;
  const maxT = 70;
  const lv = rayLevel(ox, oy, oz, _dir.x, _dir.y, _dir.z, maxT);
  const tl = lv ? lv.t : maxT;
  const eh = ENEMIES.rayHit(ox, oy, oz, _dir.x, _dir.y, _dir.z, tl);
  if (eh) {
    // yank the enemy toward us
    const e = eh.e;
    const yankFromLedge = e.onLedge || (e.pos.y - P.pos.y > 2.5);
    e.yank(-_dir.x, 0.35, -_dir.z, 14 + eh.t * 0.4);
    P.hooks.yanked(e, yankFromLedge);
    P.rope.visible = true;
    P.grapple.flashT = 0.25; P.grapple.fx = e.pos.x; P.grapple.fy = e.pos.y + 1 * e.s; P.grapple.fz = e.pos.z;
    SFX.play('grapple');
    return;
  }
  if (lv) {
    const g = P.grapple;
    g.active = true; g.t = 0;
    g.x = ox + _dir.x * lv.t; g.y = oy + _dir.y * lv.t; g.z = oz + _dir.z * lv.t;
    g.nx = lv.nx; g.ny = lv.ny; g.nz = lv.nz;
    P.rope.visible = true; P.scoped = false;
    P.vel.y = Math.max(P.vel.y, 3);
    SFX.play('grapple');
  }
};

// ---------------------------------------------------------------- dash
P.startDash = function () {
  P.viewDir(_dir);
  P.dash.t = 0.3; P.dash.dx = _dir.x; P.dash.dy = Math.max(_dir.y, -0.1); P.dash.dz = _dir.z;
  P.dash.hits = 0; P.dash.airborne = !P.grounded;
  P.slashReady = false; P.slashMeter = 0;
  P.view.slashAnim = 0.3; P.view.slashDir = 1;
  FX.slashArc(1, true);
  SFX.play('dash');
  P.hooks.dashStarted();
};
P.dashSlice = function () {
  for (const e of ENEMIES.list.slice()) {
    if (e.dead || e.state === 'spawn') continue;
    const dx = e.pos.x - P.pos.x, dz = e.pos.z - P.pos.z, dy = (e.pos.y + 1 * e.s) - P.eyeY;
    if (Math.hypot(dx, dz) < 2.2 * e.s && Math.abs(dy) < 2.6 * e.s) {
      e.lastHitDir = { x: P.dash.dx, y: 0.5, z: P.dash.dz };
      e.damage(400, 'body', { x: P.dash.dx, y: 0.4, z: P.dash.dz }, 'execute');
      P.dash.hits++;
      if (!P.grounded) P.dash.airborne = true;
      P.bloodT = 0.8;
      P.hooks.executed(e, P.dash.airborne);
    }
  }
};
P.dashEnd = function () { P.dash.t = 0; };

// ---------------------------------------------------------------- camera + view model
P.updateCamera = function (dt) {
  const cam = P.camera, v = P.view;
  const moving = P.grounded && Math.hypot(P.vel.x, P.vel.z) > 1;
  if (moving) v.bobT += dt * 11;
  const bob = moving ? Math.sin(v.bobT) * 0.035 : 0;
  v.recoil = Math.max(0, v.recoil - dt * 1.6);
  const shake = FX.shake;
  cam.position.set(
    P.pos.x + (Math.random() - 0.5) * shake * 0.12,
    P.eyeY + bob * 0.5 + (Math.random() - 0.5) * shake * 0.12 + (P.dead ? -0.9 : 0),
    P.pos.z + (Math.random() - 0.5) * shake * 0.12,
  );
  // lateral velocity in view space rolls the horizon a little, more on the rope
  const cy = Math.cos(P.yaw), sy = Math.sin(P.yaw);
  const lat = P.vel.x * cy + P.vel.z * sy;
  const rollTarget = P.dead ? 0.4 : -lat * (P.grapple.active ? 0.02 : 0.006) + (moving ? Math.sin(v.bobT * 0.5) * 0.006 : 0);
  v.roll = (v.roll || 0) + (rollTarget - (v.roll || 0)) * Math.min(1, dt * 6);
  cam.rotation.set(P.pitch + v.recoil * 0.25, P.yaw, v.roll, 'YXZ');
  const fov = 74 - 60 * P.scopeK - 10 * P.adsK;
  if (Math.abs(cam.fov - fov) > 0.05) { cam.fov = fov; cam.updateProjectionMatrix(); }
  P.pitch -= v.recoil * dt * 0.8;
  // view models
  const w = P.weapon();
  for (const id in P.models) P.models[id].g.visible = id === w.id && !P.dead && P.scopeK < 0.7;
  const m = P.models[w.id];
  if (!m) return;
  const g = m.g;
  const b = m.base;
  let x = b.x + Math.cos(v.bobT * 0.5) * (moving ? 0.012 : 0) + v.swayX * 6;
  let y = b.y + bob * 0.4 + v.swayY * 4;
  let z = b.z + v.recoil * 0.5;
  let rx = b.rx + v.recoil * 1.2 + v.swayY * 2, ry = b.ry + v.swayX * 2, rz = b.rz;
  if (m.ads && P.adsK > 0.001) { const k = P.adsK; x += (m.ads.x - b.x) * k; y += (m.ads.y - b.y) * k; z += (m.ads.z - b.z) * k; rx += (0 - b.rx) * k; ry += (0 - b.ry) * k; rz += (0 - b.rz) * k; }
  if (P.swapT > 0) { const k = P.swapT > 0.15 ? (P.swapT - 0.15) / 0.17 : 1 - P.swapT / 0.15; y -= 0.45 * k; rx += 0.6 * k; }
  if (P.reloading) { const k = Math.sin(Math.PI * (1 - P.reloadT / P.reloadTotal)); y -= 0.22 * k; rx += 0.55 * k; rz += 0.3 * k; }
  if (v.slashAnim > 0) {
    v.slashAnim -= dt;
    const k = 1 - v.slashAnim / 0.26;
    const sweep = Math.sin(k * Math.PI);
    if (P.dash.t > 0) { x = 0.2; y = -0.24; z = -0.62; rx = 0.05; ry = 0.15; rz = 0.35; }
    else { rz += v.slashDir * (-1.3 + 2.4 * k); x += v.slashDir * (0.3 - 0.6 * k); y += sweep * 0.15; ry += v.slashDir * 0.5 * sweep; rx -= sweep * 0.5; }
  } else if (P.blocking) { x = 0.14; y = -0.26; z = -0.6; rx = 0.2; ry = 0.35; rz = 1.45; }
  if (v.pumpAnim > 0) { v.pumpAnim -= dt; const k = Math.sin(Math.min(1, (0.5 - v.pumpAnim) / 0.5) * Math.PI); if (m.forend) m.forend.position.z = m.forendZ + k * 0.14; }
  if (v.boltAnim > 0) { v.boltAnim -= dt; const k = Math.sin(Math.min(1, (0.7 - v.boltAnim) / 0.7) * Math.PI); if (m.bolt) { m.bolt.rotation.z = -k * 1.3; m.bolt.position.z = m.boltZ + k * 0.08; } rx += k * 0.12; ry -= k * 0.25; }
  g.position.set(x, y, z);
  g.rotation.set(rx, ry, rz);
  if (m.blade) {
    if (P.bloodT > 0) P.bloodT -= dt;
    const bm = m.blade.userData.mesh.material;
    bm.uniforms.uInk.value.set(P.bloodT > 0 ? INK.red : INK.blue);
    bm.uniforms.uOpacity.value = P.bloodT > 0 ? 0.8 : 0.55;
  }
  if (v.flash > 0) { v.flash -= dt; P.muzzleFlash.visible = true; if (m.muzzle) { m.muzzle.getWorldPosition(_v1); P.muzzleFlash.position.copy(P.vm.worldToLocal(_v1)); } P.muzzleFlash.scale.setScalar(0.1 + Math.random() * 0.12); }
  else P.muzzleFlash.visible = false;
  // rope
  if (P.rope.visible) {
    const g2 = P.grapple;
    // the hook launcher is the off-hand: bottom-left of the view
    _v1.set(-0.32, -0.28, -0.45);
    cam.localToWorld(_v1);
    const ax = _v1.x, ay = _v1.y, az = _v1.z;
    let bx = g2.x, by = g2.y, bz = g2.z;
    if (!g2.active) {
      g2.flashT -= dt; bx = g2.fx; by = g2.fy; bz = g2.fz;
      if (g2.flashT <= 0) P.rope.visible = false;
    }
    setRope(P.rope.geometry, ax, ay, az, bx, by, bz);
  }
};

function setRope(geo, ax, ay, az, bx, by, bz) {
  const s = geo.attributes.aStart.array, e = geo.attributes.aEnd.array, p = geo.attributes.position.array;
  for (let k = 0; k < 4; k++) { s[k * 3] = ax; s[k * 3 + 1] = ay; s[k * 3 + 2] = az; e[k * 3] = bx; e[k * 3 + 1] = by; e[k * 3 + 2] = bz; p[k * 3] = ax; p[k * 3 + 1] = ay; p[k * 3 + 2] = az; }
  geo.attributes.aStart.needsUpdate = true; geo.attributes.aEnd.needsUpdate = true; geo.attributes.position.needsUpdate = true;
}

// ---------------------------------------------------------------- view models
function buildWeaponModels() {
  const ink = makeInk({ ink: INK.blue, scale: 30, opacity: 0.9 });
  const inkDark = makeInk({ ink: INK.blue, scale: 30, shade: 0.25 });
  const skin = makeInk({ ink: INK.blue, scale: 34, opacity: 0.55, shade: -0.15 });
  const pen = makePenMaterial({ ink: INK.blue, width: 1.6 });
  const hull = makeHullMaterial({ ink: INK.blue, width: 1.6 });
  const box = (w, h, d, mat = ink) => boxPart(w, h, d, mat, pen);
  const cyl = (r, len, seg = 10, mat = ink) => { const geo = new THREE.CylinderGeometry(r, r, len, seg); const p = roundPart(geo, mat, hull); return p; };
  const arm = (g, ox = 0) => {
    // forearm coming in from the bottom right + hand on the grip
    const a = box(0.11, 0.55, 0.11, skin); a.position.set(0.06 + ox, -0.38, 0.12); a.rotation.set(0.35, 0, -0.2); g.add(a);
    const h = box(0.13, 0.12, 0.13, skin); h.position.set(0.02 + ox, -0.09, 0.05); g.add(h);
  };
  const models = P.models;

  // rifle
  {
    const g = new THREE.Group();
    const body = box(0.08, 0.11, 0.55); body.position.set(0, 0, -0.05); g.add(body);
    const barrel = cyl(0.018, 0.5); barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.02, -0.55); g.add(barrel);
    const stock = box(0.07, 0.09, 0.28, inkDark); stock.position.set(0, -0.02, 0.36); g.add(stock);
    const magz = box(0.06, 0.16, 0.09, inkDark); magz.position.set(0, -0.12, -0.02); magz.rotation.x = 0.15; g.add(magz);
    const fore = box(0.09, 0.07, 0.24, inkDark); fore.position.set(0, -0.03, -0.32); g.add(fore);
    // holo sight: square frame + red dot
    const sight = new THREE.Group(); sight.position.set(0, 0.095, -0.02);
    for (const [w, h, x, y] of [[0.06, 0.008, 0, 0.03], [0.06, 0.008, 0, -0.03], [0.008, 0.066, 0.03, 0], [0.008, 0.066, -0.03, 0]]) {
      const bar = box(w, h, 0.01); bar.position.set(x, y, 0); sight.add(bar);
    }
    const dot = makeSprite(dotTexture(INK.red), 0.014, 0.014, { depthTest: false }); sight.add(dot);
    g.add(sight);
    const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.02, -0.82); g.add(muzzle);
    arm(g);
    const hand2 = box(0.12, 0.11, 0.12, skin); hand2.position.set(-0.03, -0.05, -0.3); g.add(hand2);
    models.rifle = { g, muzzle, base: { x: 0.32, y: -0.31, z: -0.52, rx: 0.02, ry: -0.06, rz: 0.02 }, ads: { x: 0, y: -0.1, z: -0.56 } };
  }
  // shotgun
  {
    const g = new THREE.Group();
    const barrel = cyl(0.028, 0.85); barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.03, -0.42); g.add(barrel);
    const tube = cyl(0.022, 0.6); tube.rotation.x = Math.PI / 2; tube.position.set(0, -0.02, -0.4); g.add(tube);
    const receiver = box(0.08, 0.11, 0.3); receiver.position.set(0, 0, 0.05); g.add(receiver);
    const stock = box(0.07, 0.1, 0.3, inkDark); stock.position.set(0, -0.03, 0.33); stock.rotation.x = 0.1; g.add(stock);
    const forend = box(0.09, 0.08, 0.22, inkDark); forend.position.set(0, -0.02, -0.38); g.add(forend);
    const hand2 = box(0.12, 0.11, 0.12, skin); hand2.position.set(-0.02, -0.06, -0.38); forend.add(hand2);
    const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.03, -0.86); g.add(muzzle);
    arm(g);
    models.shotgun = { g, muzzle, forend, forendZ: -0.38, base: { x: 0.34, y: -0.32, z: -0.48, rx: 0.02, ry: -0.05, rz: 0.02 }, ads: { x: 0, y: -0.1, z: -0.58 } };
  }
  // revolver
  {
    const g = new THREE.Group();
    const frame = box(0.05, 0.08, 0.2); frame.position.set(0, 0.02, -0.02); g.add(frame);
    const cylr = cyl(0.045, 0.1, 12); cylr.rotation.x = Math.PI / 2; cylr.position.set(0, 0.02, -0.03); g.add(cylr);
    const barrel = cyl(0.02, 0.3); barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.035, -0.25); g.add(barrel);
    const grip = box(0.05, 0.14, 0.07, inkDark); grip.position.set(0, -0.08, 0.06); grip.rotation.x = 0.35; g.add(grip);
    const hammer = box(0.02, 0.05, 0.03, inkDark); hammer.position.set(0, 0.07, 0.07); g.add(hammer);
    const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.035, -0.42); g.add(muzzle);
    arm(g, 0.0);
    models.revolver = { g, muzzle, base: { x: 0.3, y: -0.28, z: -0.46, rx: 0.05, ry: -0.08, rz: 0.03 }, ads: { x: 0, y: -0.11, z: -0.5 } };
  }
  // sniper
  {
    const g = new THREE.Group();
    const barrel = cyl(0.022, 1.0); barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.03, -0.55); g.add(barrel);
    const receiver = box(0.08, 0.1, 0.36); receiver.position.set(0, 0, 0); g.add(receiver);
    const stock = box(0.07, 0.11, 0.3, inkDark); stock.position.set(0, -0.03, 0.32); g.add(stock);
    const scope = cyl(0.045, 0.3, 8); scope.rotation.x = Math.PI / 2; scope.position.set(0, 0.1, -0.05); g.add(scope);
    const scopeCap = cyl(0.055, 0.06, 8); scopeCap.rotation.x = Math.PI / 2; scopeCap.position.set(0, 0.1, -0.22); g.add(scopeCap);
    const mount = box(0.03, 0.06, 0.08); mount.position.set(0, 0.06, -0.05); g.add(mount);
    const bolt = cyl(0.012, 0.09, 6, inkDark); bolt.rotation.z = 0; bolt.position.set(0.07, 0.03, 0.06); g.add(bolt);
    const knob = cyl(0.02, 0.03, 6, inkDark); knob.position.set(0, 0.05, 0); bolt.add(knob);
    const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.03, -1.06); g.add(muzzle);
    arm(g);
    const hand2 = box(0.12, 0.11, 0.12, skin); hand2.position.set(-0.02, -0.06, -0.42); g.add(hand2);
    models.sniper = { g, muzzle, bolt, boltZ: 0.06, base: { x: 0.34, y: -0.3, z: -0.5, rx: 0.02, ry: -0.05, rz: 0.02 } };
  }
  // katana
  {
    const g = new THREE.Group();
    const blade = box(0.012, 0.024, 1.0, makeInk({ ink: INK.blue, scale: 30, opacity: 0.55, shade: -0.35 })); blade.position.set(0, 0, -0.64); g.add(blade);
    const edge = box(0.005, 0.012, 0.96, makeInk({ ink: INK.blue, solid: 0.15 })); edge.position.set(0, -0.018, -0.64); g.add(edge);
    const guard = box(0.08, 0.014, 0.08, inkDark); guard.position.set(0, 0, -0.13); g.add(guard);
    const grip = box(0.026, 0.036, 0.22, inkDark); grip.position.set(0, 0, 0.0); g.add(grip);
    const hand = box(0.085, 0.08, 0.085, skin); hand.position.set(0, 0, -0.04); g.add(hand);
    const hand2 = box(0.08, 0.075, 0.08, skin); hand2.position.set(0, 0, 0.06); g.add(hand2);
    const forearm = box(0.08, 0.4, 0.08, skin); forearm.position.set(0.04, -0.24, 0.16); forearm.rotation.set(0.5, 0, -0.25); g.add(forearm);
    const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0, -1.0); g.add(muzzle);
    models.katana = { g, muzzle, blade, base: { x: 0.3, y: -0.3, z: -0.5, rx: 0.45, ry: -0.35, rz: -0.35 } };
  }
}
