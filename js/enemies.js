'use strict';
// ---------------------------------------------------------------------------
// enemies.js — red-ink stick figures. Rigs are spheres + boxes wearing the
// ink materials; AI runs on the level flow field; projectiles live here too.
// ---------------------------------------------------------------------------

const ETYPES = {
  gunner:  { hp: 60,  speed: 3.6, scale: 1.0,  score: 100,  label: 'GUNNER',  face: 'plain', cap: true,  gun: true, range: 18, keep: 11, fireRate: 2.4, burst: 3, bulletSpeed: 26, bulletDmg: 8,  spread: 0.05 },
  rusher:  { hp: 45,  speed: 7.2, scale: 0.95, score: 150,  label: 'RUSHER',  face: 'angry', knife: true, melee: 15, meleeRange: 1.8 },
  inkbomb: { hp: 30,  speed: 4.8, scale: 1.1,  score: 125,  label: 'INK BOMB', face: 'wide', fuse: true, fat: true, blastR: 4.5, blastDmg: 35 },
  heavy:   { hp: 320, speed: 2.3, scale: 1.55, score: 250,  label: 'HEAVY',   face: 'frown', solid: true, gun: true, range: 22, keep: 13, fireRate: 1.5, burst: 1, bulletSpeed: 20, bulletDmg: 14, spread: 0.03, mass: 3 },
  sniper:  { hp: 50,  speed: 0,   scale: 1.0,  score: 175,  label: 'SNIPER',  face: 'plain', gun: true, longgun: true, ledge: true, aimTime: 1.7, fireRate: 3.2, bulletSpeed: 70, bulletDmg: 22, spread: 0.004, range: 90 },
  doodler: { hp: 1600, speed: 3.4, scale: 2.1, score: 2500, label: 'THE DOODLER', boss: true, face: 'boss', pencil: true, paper: true, melee: 30, meleeRange: 3.4, mass: 6 },
};

const ENEMIES = { list: [], scene: null, hooks: null, mats: null, geos: null, heads: [], time: 0, flowTimer: 0, nextId: 1 };

ENEMIES.init = function (scene, hooks) {
  ENEMIES.scene = scene;
  ENEMIES.hooks = hooks;
  const M = ENEMIES.mats = {
    red: makeInk({ ink: INK.red, scale: 2.6, opacity: 0.8 }),
    redSolid: makeInk({ ink: INK.red, solid: 0.9 }),
    darkSolid: makeInk({ ink: INK.darkred, solid: 0.92 }),
    paper: makeInk({ ink: INK.black, scale: 2.6, opacity: 0.35 }),
    blackSolid: makeInk({ ink: INK.black, solid: 0.95 }),
    gun: makeInk({ ink: '#2a2a3a', solid: 0.82 }),
    pencil: makeInk({ ink: '#e2b53a', scale: 3, opacity: 0.7 }),
    pencilTip: makeInk({ ink: '#e8a0a8', solid: 0.85 }),
    lead: makeInk({ ink: INK.black, solid: 0.95 }),
    plank: makeInk({ ink: INK.orange, scale: 3, opacity: 0.9 }),
    penRed: makePenMaterial({ ink: INK.darkred, width: 1.7 }),
    penBlack: makePenMaterial({ ink: INK.black, width: 1.9 }),
    penGun: makePenMaterial({ ink: '#1c1c24', width: 1.4 }),
    penPencil: makePenMaterial({ ink: '#8a6a1a', width: 1.5 }),
    hullRed: makeHullMaterial({ ink: INK.darkred, width: 1.7 }),
    hullBlack: makeHullMaterial({ ink: INK.black, width: 2.0 }),
    hullPencil: makeHullMaterial({ ink: '#8a6a1a', width: 1.5 }),
  };
  ENEMIES.geos = {
    torso: new THREE.SphereGeometry(0.32, 14, 10),
    head: new THREE.SphereGeometry(0.27, 14, 10),
    cap: new THREE.CylinderGeometry(0.29, 0.29, 0.12, 12),
    spike: new THREE.ConeGeometry(0.07, 0.36, 6),
    pencil: new THREE.CylinderGeometry(0.075, 0.075, 1.4, 6),
    pencilTip: new THREE.ConeGeometry(0.075, 0.24, 6),
    lead: new THREE.ConeGeometry(0.025, 0.08, 6),
    plank: new THREE.BoxGeometry(0.16, 0.16, 1.2),
    alert: null,
    bullet: new THREE.SphereGeometry(0.09, 8, 6),
  };
  ENEMIES.alertTex = (() => {
    const c = makeCanvas(64, 64), ctx = c.getContext('2d');
    ctx.fillStyle = INK.red; ctx.beginPath(); ctx.moveTo(32, 8); ctx.lineTo(58, 56); ctx.lineTo(6, 56); ctx.closePath(); ctx.fill();
    return canvasTexture(c);
  })();
  ENEMIES.faces = {
    plain: faceTexture('plain', INK.darkred), angry: faceTexture('angry', INK.darkred), wide: faceTexture('wide', INK.darkred),
    frown: faceTexture('frown', INK.darkred), boss: faceTexture('boss', INK.red), dead: faceTexture('dead', INK.darkred),
  };
  // detached heads that roll around after a kill
  for (let i = 0; i < 10; i++) {
    const g = roundPart(ENEMIES.geos.head, M.red, M.hullRed);
    const face = makeSprite(ENEMIES.faces.dead, 0.55, 0.55);
    g.add(face);
    g.userData.face = face;
    g.visible = false;
    scene.add(g);
    ENEMIES.heads.push({ g, vx: 0, vy: 0, vz: 0, life: 0, r: 0.27 });
  }
  PROJ.init(scene);
};

// ---------------------------------------------------------------- rig
function buildRig(t) {
  const M = ENEMIES.mats, Gm = ENEMIES.geos;
  const ink = t.paper ? M.paper : t.solid ? M.redSolid : M.red;
  const pen = t.paper ? M.penBlack : M.penRed;
  const hull = t.paper ? M.hullBlack : M.hullRed;
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);

  const torso = roundPart(Gm.torso, ink, hull);
  torso.position.y = 0.98;
  torso.scale.set(t.fat ? 1.3 : 1, t.fat ? 1.15 : 1.2, t.fat ? 1.15 : 0.85);
  body.add(torso);

  const head = roundPart(Gm.head, ink, hull);
  head.position.y = 1.58;
  body.add(head);
  const face = makeSprite(ENEMIES.faces[t.face] || ENEMIES.faces.plain, 0.56, 0.56);
  body.add(face);

  if (t.cap) {
    const cap = new THREE.Mesh(Gm.cap, M.darkSolid); cap.position.set(0, 1.83, 0); body.add(cap);
    const brim = boxPart(0.5, 0.05, 0.32, M.darkSolid, pen); brim.position.set(0, 1.78, 0.28); body.add(brim);
  }
  if (t.fuse) {
    const fuse = boxPart(0.05, 0.3, 0.05, M.blackSolid, M.penGun); fuse.position.set(0.05, 1.98, 0); fuse.rotation.z = 0.3; body.add(fuse);
    const flame = makeSprite(dotTexture(INK.orange), 0.22, 0.22); flame.position.set(0.12, 2.16, 0); body.add(flame);
    root.userData.flame = flame;
  }
  if (t.boss) {
    for (let i = 0; i < 6; i++) {
      const s = new THREE.Mesh(Gm.spike, M.blackSolid);
      const a = (i / 6) * Math.PI * 2;
      s.position.set(Math.cos(a) * 0.14, 1.9, Math.sin(a) * 0.14);
      s.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
      body.add(s);
    }
  }
  // limbs
  const mk = (w, h, d) => boxPart(w, h, d, ink, pen);
  const armL = new THREE.Group(); armL.position.set(-0.36, 1.24, 0);
  const armR = new THREE.Group(); armR.position.set(0.36, 1.24, 0);
  const al = mk(0.11, 0.56, 0.11); al.position.y = -0.28; armL.add(al);
  const ar = mk(0.11, 0.56, 0.11); ar.position.y = -0.28; armR.add(ar);
  const handL = mk(0.14, 0.12, 0.14); handL.position.y = -0.6; armL.add(handL);
  const handR = mk(0.14, 0.12, 0.14); handR.position.y = -0.6; armR.add(handR);
  body.add(armL); body.add(armR);
  const legL = new THREE.Group(); legL.position.set(-0.15, 0.64, 0);
  const legR = new THREE.Group(); legR.position.set(0.15, 0.64, 0);
  const ll = mk(0.12, 0.62, 0.12); ll.position.y = -0.31; legL.add(ll);
  const lr = mk(0.12, 0.62, 0.12); lr.position.y = -0.31; legR.add(lr);
  const fl = mk(0.16, 0.09, 0.3); fl.position.set(0, -0.64, 0.07); legL.add(fl);
  const fr = mk(0.16, 0.09, 0.3); fr.position.set(0, -0.64, 0.07); legR.add(fr);
  body.add(legL); body.add(legR);

  let muzzle = null;
  if (t.gun) {
    const len = t.longgun ? 1.05 : 0.62;
    const gun = boxPart(0.07, len, 0.09, M.gun, M.penGun);
    gun.position.set(0.02, -0.62 - len / 2 + 0.2, 0.06);
    armR.add(gun);
    if (t.longgun) { const scope = boxPart(0.06, 0.2, 0.06, M.gun, M.penGun); scope.position.set(0.02, -0.75, 0.13); armR.add(scope); }
    muzzle = new THREE.Object3D(); muzzle.position.set(0.02, -0.62 - len + 0.2, 0.06); armR.add(muzzle);
    armR.rotation.x = -Math.PI / 2;
    armL.rotation.x = -Math.PI / 2 + 0.3; armL.rotation.y = -0.5;
  }
  if (t.knife) {
    const k = boxPart(0.05, 0.34, 0.03, M.gun, M.penGun); k.position.set(0, -0.78, 0.04); armR.add(k);
  }
  if (t.pencil) {
    // a giant pencil held like a bat: hex shaft, pink tip, black lead
    const shaft = roundPart(Gm.pencil, M.pencil, M.hullPencil); shaft.position.set(0.08, -1.1, 0.05); armR.add(shaft);
    const tip = new THREE.Mesh(Gm.pencilTip, M.pencilTip); tip.position.set(0.08, -1.92, 0.05); tip.rotation.x = Math.PI; armR.add(tip);
    const lead = new THREE.Mesh(Gm.lead, M.lead); lead.position.set(0.08, -2.08, 0.05); lead.rotation.x = Math.PI; armR.add(lead);
    const band = boxPart(0.18, 0.08, 0.18, M.gun, M.penGun); band.position.set(0.08, -0.42, 0.05); armR.add(band);
  }
  // red alert triangle shown over a melee attacker's head
  const alert = makeSprite(ENEMIES.alertTex, 0.5, 0.45, { depthTest: false });
  alert.position.set(0, 2.25, 0); alert.visible = false; body.add(alert);
  root.userData.parts = { body, torso, head, face, armL, armR, legL, legR, muzzle, alert };
  return root;
}

// ---------------------------------------------------------------- enemy
class Enemy {
  constructor(type, x, y, z) {
    this.id = ENEMIES.nextId++;
    this.type = type; this.t = ETYPES[type];
    this.hp = this.t.hp; this.maxHp = this.t.hp;
    this.pos = { x, y, z }; this.vel = { x: 0, y: 0, z: 0 };
    this.hw = 0.34 * this.t.scale; this.h = 1.9 * this.t.scale;
    this.grounded = false;
    this.state = 'spawn'; this.stateT = 0;
    this.yaw = Math.random() * Math.PI * 2;
    this.phase = Math.random() * 6;
    this.fireT = 1 + Math.random() * 1.5; this.burstLeft = 0; this.burstT = 0;
    this.aimT = 0;
    this.meleeT = 0; this.strafeSeed = Math.random() * 10; this.detourT = 0; this.detourDir = 1;
    this.flinch = 0; this.stun = 0; this.fallFrom = y; this.onLedge = !!this.t.ledge;
    this.chargeT = 5 + Math.random() * 3; this.charging = 0; this.spitT = 4; this.swingT = 0;
    this.dead = false; this.lastHitDir = { x: 0, y: 0, z: 1 };
    this.rig = buildRig(this.t);
    this.rig.scale.setScalar(0.01);
    this.rig.position.set(x, y, z);
    ENEMIES.scene.add(this.rig);
    if (this.t.ledge) {
      // sniper aim line
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 1], 3));
      this.laser = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xd4232b, transparent: true, opacity: 0.55 }));
      this.laser.visible = false; this.laser.frustumCulled = false;
      ENEMIES.scene.add(this.laser);
    }
  }
  get s() { return this.t.scale; }
  headPos(out) { out.x = this.pos.x; out.y = this.pos.y + 1.58 * this.s; out.z = this.pos.z; return out; }
  bodyPos(out) { out.x = this.pos.x; out.y = this.pos.y + 0.98 * this.s; out.z = this.pos.z; return out; }

  damage(amount, part, dir, cause) {
    if (this.dead) return;
    if (this.state === 'spawn') return;
    this.hp -= amount;
    this.flinch = 0.18;
    if (dir) { this.lastHitDir.x = dir.x; this.lastHitDir.y = dir.y; this.lastHitDir.z = dir.z; }
    const s = this.s;
    const hy = part === 'head' ? 1.58 * s : part === 'legs' ? 0.45 * s : 0.98 * s;
    FX.burst(this.pos.x, this.pos.y + hy, this.pos.z, part === 'head' ? 14 : 8, 'blood', 5, dir ? dir.x : 0, 0.3, dir ? dir.z : 0);
    // stamp the wall behind if it is close
    if (dir) {
      const h = rayLevel(this.pos.x, this.pos.y + hy, this.pos.z, dir.x, dir.y, dir.z, 3.5);
      if (h) FX.decal(this.pos.x + dir.x * h.t, this.pos.y + hy + dir.y * h.t, this.pos.z + dir.z * h.t, h.nx, h.ny, h.nz, 0.6 + Math.random() * 0.8, 'blood');
    }
    if (this.hp <= 0) this.die(cause, part);
    else if (this.t.mass == null && cause !== 'melee' && dir) { this.vel.x += dir.x * 1.5; this.vel.z += dir.z * 1.5; }
  }

  yank(dirx, diry, dirz, strength) {
    if (this.dead) return;
    const m = this.t.mass || 1;
    this.vel.x = dirx * strength / m; this.vel.y = 5 + diry * strength * 0.5 / m; this.vel.z = dirz * strength / m;
    this.state = 'yanked'; this.stateT = 0; this.fallFrom = this.pos.y;
    this.onLedge = false;
    if (this.laser) this.laser.visible = false;
    SFX.play('yank');
  }

  explode() {
    if (this.exploded) return;
    this.exploded = true;
    const t = this.t;
    const px = this.pos.x, py = this.pos.y + 0.9 * this.s, pz = this.pos.z;
    FX.burst(px, py, pz, 40, 'ink', 9);
    FX.chunks(px, py, pz, 5, 'darkred', 0.4, 6);
    FX.pool(px, py, pz, 4.5, 'ink');
    for (let i = 0; i < 5; i++) {
      const a = Math.random() * Math.PI * 2, r = 1 + Math.random() * 3;
      const h = rayLevel(px, py, pz, Math.cos(a) * 0.7, (Math.random() - 0.5) * 0.4, Math.sin(a) * 0.7, r + 2);
      if (h) FX.decal(px + Math.cos(a) * 0.7 * h.t, py + (Math.random() - 0.5) * 0.4 * h.t, pz + Math.sin(a) * 0.7 * h.t, h.nx, h.ny, h.nz, 1 + Math.random() * 1.5, 'ink');
    }
    SFX.play('explode');
    FX.shake = Math.min(1, FX.shake + 0.5);
    ENEMIES.hooks.blast(px, py, pz, t.blastR, t.blastDmg, this);
    this.remove();
  }

  die(cause, part) {
    if (this.dead) return;
    this.dead = true;
    if (this.type === 'inkbomb' && cause !== 'blast') { this.explode(); ENEMIES.hooks.kill(this, cause, part); return; }
    const s = this.s, px = this.pos.x, pz = this.pos.z, py = this.pos.y;
    const d = this.lastHitDir;
    FX.burst(px, py + 1.0 * s, pz, 26, 'blood', 6, d.x, 0.4, d.z);
    FX.chunks(px, py + 1.0 * s, pz, this.t.boss ? 18 : 6, 'darkred', 0.28 * s, 4 + s * 2);
    FX.pool(px, py, pz, 1.6 * s + Math.random() * 1.2, 'blood');
    if (this.t.gun || this.t.knife) FX.chunks(px, py + 1.2 * s, pz, 1, 'black', 0.5, 3);
    if (this.t.boss) { FX.chunks(px, py + 1.5 * s, pz, 3, 'black', 0.5, 5); FX.chunks(px, py + 1.5 * s, pz, 4, 'orange', 1.4, 6); FX.burst(px, py + 1.2 * s, pz, 30, 'ink', 8); FX.pool(px, py, pz, 5, 'ink'); }
    // roll a head
    if (!this.t.paper) {
      for (const hd of ENEMIES.heads) {
        if (hd.life > 0) continue;
        hd.life = 8; hd.r = 0.27 * s;
        hd.g.scale.setScalar(s); hd.g.visible = true;
        hd.g.position.set(px, py + 1.58 * s, pz);
        hd.vx = d.x * 4 + (Math.random() - 0.5) * 3; hd.vy = 4 + Math.random() * 3; hd.vz = d.z * 4 + (Math.random() - 0.5) * 3;
        break;
      }
    }
    SFX.play(this.t.boss ? 'boss' : 'kill');
    this.remove();
    ENEMIES.hooks.kill(this, cause, part);
  }

  remove() {
    this.dead = true;
    ENEMIES.scene.remove(this.rig);
    if (this.laser) ENEMIES.scene.remove(this.laser);
    const i = ENEMIES.list.indexOf(this);
    if (i >= 0) ENEMIES.list.splice(i, 1);
  }

  update(dt, P) {
    const t = this.t, s = this.s;
    this.stateT += dt;
    if (this.state === 'spawn') {
      const k = Math.min(1, this.stateT / 0.45);
      this.rig.scale.setScalar(s * (k < 0.8 ? k * 1.25 : 1 + (1 - k) * 0.25 * 5 * 0.2));
      if (k >= 1) { this.state = 'active'; this.rig.scale.setScalar(s); }
      this.rig.position.set(this.pos.x, this.pos.y, this.pos.z);
      return;
    }
    const dx = P.x - this.pos.x, dz = P.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    const dy = P.eyeY - (this.pos.y + 1.5 * s);
    const dist3 = Math.hypot(dist, dy);
    const near = dist3 < 60;
    const lookX = dx / (dist || 1), lookZ = dz / (dist || 1);
    // --- movement --------------------------------------------------------
    let mvx = 0, mvz = 0, speed = t.speed;
    const grounded = this.grounded;
    if (this.stun > 0) this.stun -= dt;
    if (this.state === 'yanked') {
      // ballistic until we land
      this.vel.y -= 22 * dt;
      moveBody(this, dt, 0);
      if (this.grounded) {
        const fell = this.fallFrom - this.pos.y;
        this.state = 'active'; this.stun = 0.8;
        if (fell > 3.5) { this.lastHitDir = { x: 0, y: -1, z: 0 }; FX.burst(this.pos.x, this.pos.y + 0.3, this.pos.z, 12, 'blood', 4); this.damage(70 + fell * 8, 'body', null, 'fall'); if (this.dead) return; }
        this.vel.x *= 0.2; this.vel.z *= 0.2;
      }
      this.yaw = Math.atan2(lookX, lookZ);
    } else if (!this.onLedge && this.stun <= 0 && !this.t.ledge) {
      let want = true;
      if (t.keep && dist < t.keep && ENEMIES.losToPlayer(this, P)) want = false;
      if (this.charging > 0) { this.charging -= dt; speed *= 3.6; mvx = this.chargeX; mvz = this.chargeZ; }
      else if (want) {
        let fd = null;
        if (dist < 14 && Math.abs(dy) < 2.5 && lineClear(this.pos.x, this.pos.y + 1, this.pos.z, P.x, P.y + 1, P.z)) { fd = { x: lookX, z: lookZ }; }
        else fd = flowDirAt(this.pos.x, this.pos.z);
        if (fd) { mvx = fd.x; mvz = fd.z; }
        else { mvx = lookX; mvz = lookZ; }
      } else if (t.gun) {
        // strafe while holding range
        const st = Math.sin(ENEMIES.time * 1.1 + this.strafeSeed);
        mvx = -lookZ * st; mvz = lookX * st; speed *= 0.55;
      }
      // detour if stuck against something
      if (this.detourT > 0) { this.detourT -= dt; const px = -mvz * this.detourDir, pz = mvx * this.detourDir; mvx = px; mvz = pz; }
      this.vel.x = mvx * speed; this.vel.z = mvz * speed;
      const ox = this.pos.x, oz = this.pos.z;
      this.vel.y -= 22 * dt;
      moveBody(this, dt, 0.55);
      const moved = Math.hypot(this.pos.x - ox, this.pos.z - oz);
      if (want && speed > 0 && moved < speed * dt * 0.25 && this.detourT <= 0) { this.detourT = 0.7 + Math.random() * 0.6; this.detourDir = Math.random() < 0.5 ? -1 : 1; }
      const faceMove = (mvx || mvz) && !(t.gun && near);
      const ty = faceMove ? Math.atan2(mvx, mvz) : Math.atan2(lookX, lookZ);
      let d = ty - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * Math.min(1, dt * 8);
    } else {
      // ledge / stunned: stand still, keep gravity honest
      this.vel.x = 0; this.vel.z = 0; this.vel.y -= 22 * dt;
      moveBody(this, dt, 0);
      if (near) { const ty = Math.atan2(lookX, lookZ); let d = ty - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); this.yaw += d * Math.min(1, dt * 6); }
    }
    if (this.pos.y < -5) { this.remove(); ENEMIES.hooks.kill(this, 'fall', 'body'); return; }
    // --- attacks ---------------------------------------------------------
    if (this.state === 'active' && this.stun <= 0) {
      if (t.gun && !t.ledge) {
        this.fireT -= dt;
        if (this.burstLeft > 0) {
          this.burstT -= dt;
          if (this.burstT <= 0) { this.shoot(P); this.burstLeft--; this.burstT = 0.13; }
        } else if (this.fireT <= 0 && dist3 < t.range && ENEMIES.losToPlayer(this, P)) {
          this.burstLeft = t.burst; this.burstT = 0; this.fireT = t.fireRate * (0.8 + Math.random() * 0.5);
        }
      }
      if (t.ledge) {
        const los = dist3 < t.range && ENEMIES.losToPlayer(this, P);
        if (los) {
          this.aimT += dt;
          this.laser.visible = true;
          const arr = this.laser.geometry.attributes.position.array;
          const mp = ENEMIES.muzzleWorld(this);
          arr[0] = mp.x; arr[1] = mp.y; arr[2] = mp.z; arr[3] = P.x; arr[4] = P.eyeY - 0.2; arr[5] = P.z;
          this.laser.geometry.attributes.position.needsUpdate = true;
          this.laser.material.opacity = 0.25 + 0.5 * Math.min(1, this.aimT / t.aimTime);
          if (this.aimT >= t.aimTime) { this.shoot(P); this.aimT = -t.fireRate; }
        } else { this.aimT = Math.max(0, this.aimT - dt * 2); this.laser.visible = false; }
      }
      if (t.melee) {
        this.meleeT -= dt;
        if (dist < t.meleeRange * s * 0.6 + 1 && Math.abs(dy) < 2.2 && this.meleeT <= 0) {
          this.meleeT = t.boss ? 1.3 : 0.9; this.swingT = 0.35;
          ENEMIES.hooks.hurt(t.melee, this.pos.x, this.pos.z, t.boss ? 'bat' : 'knife');
        }
      }
      if (t.blastR && dist < 2.6 && Math.abs(dy) < 2.5) { this.explode(); ENEMIES.hooks.kill(this, 'self', 'body'); return; }
      if (t.boss) {
        this.chargeT -= dt; this.spitT -= dt;
        if (this.chargeT <= 0 && dist > 6) { this.chargeT = 6 + Math.random() * 3; this.charging = 1.2; this.chargeX = lookX; this.chargeZ = lookZ; SFX.play('dash'); }
        if (this.spitT <= 0 && dist < 40 && ENEMIES.losToPlayer(this, P)) {
          this.spitT = 5;
          const mp = ENEMIES.muzzleWorld(this);
          for (let i = -2; i <= 2; i++) {
            const a = Math.atan2(lookX, lookZ) + i * 0.12;
            const vx = Math.sin(a), vz = Math.cos(a);
            const vy = (P.eyeY - mp.y) / (dist || 1) + 0.28;
            PROJ.spawn(mp.x, mp.y, mp.z, vx * 17, vy * 17, vz * 17, 14, 'enemy', this, i % 2 === 0 ? 'plank' : 'ink');
          }
          this.swingT = 0.35;
          SFX.play('crate');
        }
      }
    }
    // --- animation -------------------------------------------------------
    const moving = Math.hypot(this.vel.x, this.vel.z) > 0.3 && this.state !== 'yanked';
    if (moving) this.phase += dt * (t.speed > 5 ? 14 : t.speed > 3 ? 9 : 6);
    const P_ = this.rig.userData.parts;
    const sw = moving ? Math.sin(this.phase) * (t.speed > 5 ? 0.95 : 0.6) : 0;
    P_.legL.rotation.x = sw; P_.legR.rotation.x = -sw;
    if (!t.gun && !t.pencil) { P_.armL.rotation.x = -sw * 0.8; P_.armR.rotation.x = t.knife ? -1.4 + sw * 0.3 : sw * 0.8; }
    if (t.pencil) { P_.armR.rotation.x = this.swingT > 0 ? -2.6 + (0.35 - this.swingT) * 8 : -0.9; P_.armL.rotation.x = -sw * 0.6; }
    P_.alert.visible = !!(t.melee && dist < 5.5 && this.state === 'active');
    if (P_.alert.visible) P_.alert.position.y = 2.2 + Math.sin(ENEMIES.time * 9) * 0.08;
    if (this.swingT > 0) this.swingT -= dt;
    if (t.knife && this.meleeT > 0.6) P_.armR.rotation.x = -2.2 + (0.9 - this.meleeT) * 6;
    P_.body.position.y = moving ? Math.abs(Math.sin(this.phase)) * 0.05 : 0;
    P_.body.rotation.x = this.state === 'yanked' ? -0.6 : (t.speed > 5 && moving ? 0.25 : 0);
    if (this.flinch > 0) { this.flinch -= dt; const k = 1 + this.flinch * 1.2; this.rig.scale.set(s / k, s * k, s / k); }
    else this.rig.scale.setScalar(s);
    if (this.rig.userData.flame) this.rig.userData.flame.scale.setScalar(0.18 + 0.1 * Math.sin(ENEMIES.time * 30 + this.id));
    this.rig.position.set(this.pos.x, this.pos.y, this.pos.z);
    this.rig.rotation.y = this.yaw;
    // face sprite floats just in front of the head, toward the camera
    const cam = FX.camera.position;
    const hx = this.pos.x, hy = this.pos.y + 1.58 * s, hz = this.pos.z;
    let fx = cam.x - hx, fy = cam.y - hy, fz = cam.z - hz;
    const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
    // convert world offset to rig-local (rig only rotates about y and scales uniformly)
    const c = Math.cos(-this.yaw), sn = Math.sin(-this.yaw);
    const lx = fx * c - fz * sn, lz = fx * sn + fz * c;
    const r = 0.27 * 0.92;
    P_.face.position.set(lx * r / this.rig.scale.x, 1.58 + fy * r / this.rig.scale.y, lz * r / this.rig.scale.z);
  }

  shoot(P) {
    const t = this.t;
    const mp = ENEMIES.muzzleWorld(this);
    let dx = P.x - mp.x, dy = (P.eyeY - 0.35) - mp.y, dz = P.z - mp.z;
    const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
    const sp = t.spread || 0.04;
    dx += (Math.random() - 0.5) * sp * 2; dy += (Math.random() - 0.5) * sp * 2; dz += (Math.random() - 0.5) * sp * 2;
    const l2 = Math.hypot(dx, dy, dz) || 1;
    PROJ.spawn(mp.x, mp.y, mp.z, dx / l2 * t.bulletSpeed, dy / l2 * t.bulletSpeed, dz / l2 * t.bulletSpeed, t.bulletDmg, 'enemy', this, 'ink');
    if (t.ledge) this.laser.visible = false;
    SFX.play('shoot_enemy');
  }
}

const _mv = new THREE.Vector3();
const _q = new THREE.Quaternion();
ENEMIES.muzzleWorld = function (e) {
  const m = e.rig.userData.parts.muzzle;
  if (m) { e.rig.updateMatrixWorld(true); m.getWorldPosition(_mv); return _mv; }
  _mv.set(e.pos.x, e.pos.y + 1.3 * e.s, e.pos.z);
  return _mv;
};

ENEMIES.losToPlayer = function (e, P) {
  return lineClear(e.pos.x, e.pos.y + 1.5 * e.s, e.pos.z, P.x, P.eyeY, P.z);
};

ENEMIES.spawn = function (type, x, y, z) {
  const e = new Enemy(type, x, y, z);
  ENEMIES.list.push(e);
  return e;
};

ENEMIES.clear = function () {
  for (const e of ENEMIES.list.slice()) e.remove();
  ENEMIES.list.length = 0;
  for (const h of ENEMIES.heads) { h.life = 0; h.g.visible = false; }
  PROJ.clear();
};

ENEMIES.update = function (dt, P) {
  ENEMIES.time += dt;
  ENEMIES.flowTimer -= dt;
  if (ENEMIES.flowTimer <= 0) { ENEMIES.flowTimer = 0.35; updateFlowField(P.x, P.z); }
  const list = ENEMIES.list;
  // keep bodies apart
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j];
      const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
      const d = Math.hypot(dx, dz), min = (a.hw + b.hw) * 1.6;
      if (d < min && d > 1e-3 && Math.abs(a.pos.y - b.pos.y) < 1.5) {
        const push = (min - d) * 0.5, nx = dx / d, nz = dz / d;
        const ma = a.t.mass || 1, mb = b.t.mass || 1;
        if (!a.onLedge) { a.pos.x -= nx * push * mb / (ma + mb); a.pos.z -= nz * push * mb / (ma + mb); }
        if (!b.onLedge) { b.pos.x += nx * push * ma / (ma + mb); b.pos.z += nz * push * ma / (ma + mb); }
      }
    }
  }
  for (const e of list.slice()) if (!e.dead) e.update(dt, P);
  // rolling heads
  for (const h of ENEMIES.heads) {
    if (h.life <= 0) continue;
    h.life -= dt;
    h.vy -= 22 * dt;
    const p = h.g.position;
    p.x += h.vx * dt; p.y += h.vy * dt; p.z += h.vz * dt;
    const gy = groundHeightAt(p.x, p.z, p.y + 0.3);
    if (p.y - h.r < gy) { p.y = gy + h.r; if (h.vy < -1) { h.vy *= -0.4; h.vx *= 0.7; h.vz *= 0.7; FX.burst(p.x, p.y, p.z, 3, 'blood', 2); } else { h.vy = 0; h.vx *= 0.92; h.vz *= 0.92; } }
    h.g.rotation.x += h.vz * dt * 2; h.g.rotation.z -= h.vx * dt * 2;
    const cam = FX.camera.position;
    // face sprite sits on the camera side of the head, in the head's local frame
    const f = h.g.userData.face;
    _q.copy(h.g.quaternion).invert();
    f.position.set(cam.x - p.x, cam.y - p.y, cam.z - p.z).normalize().multiplyScalar(0.25).applyQuaternion(_q).divideScalar(h.g.scale.x || 1);
    if (h.life <= 0) h.g.visible = false;
  }
  PROJ.update(dt, P);
};

// nearest enemy along a ray. returns {e, part, t} or null
const _rh = { e: null, part: '', t: 0 };
function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = cx - ox, ly = cy - oy, lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  if (tca < 0) return -1;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  if (d2 > r * r) return -1;
  return tca - Math.sqrt(r * r - d2);
}
ENEMIES.rayHit = function (ox, oy, oz, dx, dy, dz, maxT) {
  let best = maxT, be = null, bp = '';
  for (const e of ENEMIES.list) {
    if (e.dead || e.state === 'spawn') continue;
    const s = e.s, px = e.pos.x, py = e.pos.y, pz = e.pos.z;
    const th = raySphere(ox, oy, oz, dx, dy, dz, px, py + 1.58 * s, pz, 0.3 * s);
    if (th >= 0 && th < best) { best = th; be = e; bp = 'head'; }
    const tb = raySphere(ox, oy, oz, dx, dy, dz, px, py + 0.98 * s, pz, (e.t.fat ? 0.52 : 0.46) * s);
    if (tb >= 0 && tb < best) { best = tb; be = e; bp = 'body'; }
    const tl = raySphere(ox, oy, oz, dx, dy, dz, px, py + 0.4 * s, pz, 0.36 * s);
    if (tl >= 0 && tl < best) { best = tl; be = e; bp = 'legs'; }
  }
  if (!be) return null;
  _rh.e = be; _rh.part = bp; _rh.t = best;
  return _rh;
};

// ---------------------------------------------------------------- projectiles
const PROJ = { pool: [], scene: null };
PROJ.init = function (scene) {
  PROJ.scene = scene;
  const mat = new THREE.MeshBasicMaterial({ color: 0xd4232b });
  const matInk = new THREE.MeshBasicMaterial({ color: 0x2b34b4 });
  for (let i = 0; i < 80; i++) {
    const m = new THREE.Mesh(ENEMIES.geos.bullet, mat);
    m.visible = false;
    scene.add(m);
    const plank = boxPart(0.16, 0.16, 1.2, ENEMIES.mats.plank, ENEMIES.mats.penPencil);
    plank.visible = false;
    scene.add(plank);
    PROJ.pool.push({ m, plank, mat, matInk, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, dmg: 0, owner: null, side: 'enemy', life: 0, kind: 'ink', age: 0 });
  }
};
PROJ.spawn = function (x, y, z, vx, vy, vz, dmg, side, owner, kind) {
  for (const p of PROJ.pool) {
    if (p.life > 0) continue;
    p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz; p.dmg = dmg; p.side = side; p.owner = owner; p.kind = kind; p.life = 4; p.age = 0;
    const isPlank = kind === 'plank';
    p.m.visible = !isPlank; p.plank.visible = isPlank;
    p.m.position.set(x, y, z); p.plank.position.set(x, y, z);
    p.m.material = side === 'player' ? p.matInk : p.mat;
    const big = kind === 'ink' && side === 'enemy' && owner && owner.t.boss;
    if (big) p.m.scale.set(2.2, 2.2, 2.2); else p.m.scale.set(0.55, 0.55, 2.6);
    _pv.set(x + vx, y + vy, z + vz); p.m.lookAt(_pv);
    return p;
  }
  return null;
};
const _pv = new THREE.Vector3();
PROJ.clear = function () { for (const p of PROJ.pool) { p.life = 0; p.m.visible = false; p.plank.visible = false; } };
PROJ.update = function (dt, P) {
  for (const p of PROJ.pool) {
    if (p.life <= 0) continue;
    p.life -= dt; p.age += dt;
    if (p.kind === 'plank' || (p.owner && p.owner.t && p.owner.t.boss && p.side === 'enemy')) p.vy -= 9 * dt;
    const nx = p.x + p.vx * dt, ny = p.y + p.vy * dt, nz = p.z + p.vz * dt;
    const dx = nx - p.x, dy = ny - p.y, dz = nz - p.z;
    const len = Math.hypot(dx, dy, dz) || 1e-6;
    // level
    const h = rayLevel(p.x, p.y, p.z, dx / len, dy / len, dz / len, len);
    if (h) {
      if (p.kind === 'plank') FX.chunks(p.x + dx / len * h.t, p.y + dy / len * h.t, p.z + dz / len * h.t, 2, 'orange', 0.7, 3);
      else FX.decal(p.x + dx / len * h.t, p.y + dy / len * h.t, p.z + dz / len * h.t, h.nx, h.ny, h.nz, 0.2 + Math.random() * 0.25, 'ink');
      FX.burst(p.x + dx / len * h.t, p.y + dy / len * h.t, p.z + dz / len * h.t, 3, p.kind === 'plank' ? 'orange' : 'ink', 2);
      p.life = 0; p.m.visible = false; p.plank.visible = false; continue;
    }
    if (p.side === 'enemy') {
      // player: sphere around the chest
      const cx = P.x, cy = P.eyeY - 0.5, cz = P.z;
      const t = raySphere(p.x, p.y, p.z, dx / len, dy / len, dz / len, cx, cy, cz, 0.62);
      if (t >= 0 && t <= len) {
        // katana block?
        if (P.blocking && P.blockDot(p.x, p.y, p.z)) {
          const perfect = P.blockAge < 0.28;
          const o = p.owner && !p.owner.dead ? p.owner : null;
          let bx, by, bz;
          if (o) { bx = o.pos.x - p.x; by = (o.pos.y + 1.2 * o.s) - p.y; bz = o.pos.z - p.z; }
          else { bx = -p.vx; by = -p.vy; bz = -p.vz; }
          const bl = Math.hypot(bx, by, bz) || 1;
          const sp = Math.hypot(p.vx, p.vy, p.vz) * 1.4;
          p.vx = bx / bl * sp; p.vy = by / bl * sp; p.vz = bz / bl * sp;
          p.side = 'player'; p.dmg = perfect ? p.dmg * 5 : p.dmg * 2.5; p.life = 4;
          p.m.material = p.matInk;
          p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
          p.m.position.set(p.x, p.y, p.z);
          ENEMIES.hooks.blocked(perfect);
          continue;
        }
        ENEMIES.hooks.hurt(p.dmg, p.owner ? p.owner.pos.x : p.x, p.owner ? p.owner.pos.z : p.z, 'bullet');
        p.life = 0; p.m.visible = false; p.plank.visible = false; continue;
      }
    } else {
      const hit = ENEMIES.rayHit(p.x, p.y, p.z, dx / len, dy / len, dz / len, len);
      if (hit) {
        hit.e.damage(p.dmg, hit.part, { x: dx / len, y: dy / len, z: dz / len }, 'returned');
        ENEMIES.hooks.returnedHit(hit.e, hit.part);
        p.life = 0; p.m.visible = false; p.plank.visible = false; continue;
      }
    }
    p.x = nx; p.y = ny; p.z = nz;
    p.m.position.set(nx, ny, nz);
    if (p.kind !== 'plank' && p.m.scale.z > 1) { _pv.set(nx + p.vx, ny + p.vy, nz + p.vz); p.m.lookAt(_pv); }
    if (p.kind === 'plank') { p.plank.position.set(nx, ny, nz); _pv.set(nx + p.vx, ny + p.vy, nz + p.vz); p.plank.lookAt(_pv); p.plank.rotation.z += p.age * 6; }
    if (p.life <= 0) { p.m.visible = false; p.plank.visible = false; }
  }
};
