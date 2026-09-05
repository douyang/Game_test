'use strict';
// ---------------------------------------------------------------------------
// fx.js — blood, ink, debris, decals, score popups, screen feedback, sound.
// Everything is pooled; nothing allocates per frame.
// ---------------------------------------------------------------------------

const FX = {
  scene: null, camera: null,
  decals: [], decalIdx: 0,
  drops: [], debris: [],
  arcs: [],
  hitMarker: 0, tint: 0, shake: 0, hitDir: null,
  popupStack: 0, popupT: 0,
  tex: {},
  time: 0,
};

FX.init = function (scene, camera) {
  FX.scene = scene; FX.camera = camera;
  FX.tex.blood = [0, 1, 2, 3].map(i => splatTexture(11 + i * 7, INK.red));
  FX.tex.ink = [0, 1].map(i => splatTexture(41 + i * 5, '#1f2454'));
  FX.tex.dotRed = dotTexture(INK.red);
  FX.tex.dotInk = dotTexture('#1f2454');
  FX.tex.dotOrange = dotTexture(INK.orange);

  // decal pool: flat planes stuck onto surfaces
  const dg = new THREE.PlaneGeometry(1, 1);
  for (let i = 0; i < 220; i++) {
    const m = new THREE.Mesh(dg, new THREE.MeshBasicMaterial({ map: FX.tex.blood[i % 4], transparent: true, depthWrite: false, opacity: 0.95 }));
    m.visible = false; m.renderOrder = 2;
    scene.add(m);
    FX.decals.push(m);
  }
  // droplet pool
  for (let i = 0; i < 260; i++) {
    const s = makeSprite(FX.tex.dotRed, 0.18, 0.18);
    s.visible = false;
    scene.add(s);
    FX.drops.push({ s, vx: 0, vy: 0, vz: 0, life: 0, kind: 'blood' });
  }
  // debris pool: little hatched chunks
  const bg = new THREE.BoxGeometry(1, 1, 1);
  FX.debrisMats = {
    orange: makeInk({ ink: INK.orange, scale: 3, opacity: 0.9 }),
    blue: makeInk({ ink: INK.blue, scale: 3 }),
    red: makeInk({ ink: INK.red, solid: 0.85 }),
    darkred: makeInk({ ink: INK.darkred, solid: 0.9 }),
    green: makeInk({ ink: INK.green, scale: 3 }),
    black: makeInk({ ink: INK.black, solid: 0.9 }),
  };
  FX.debrisPens = {
    orange: makePenMaterial({ ink: INK.orange }), blue: makePenMaterial({ ink: INK.blue }),
    red: makePenMaterial({ ink: INK.darkred }), darkred: makePenMaterial({ ink: INK.darkred }), green: makePenMaterial({ ink: INK.green }),
    black: makePenMaterial({ ink: INK.black }),
  };
  for (let i = 0; i < 90; i++) {
    const g = new THREE.Group();
    const mesh = new THREE.Mesh(bg, FX.debrisMats.orange);
    const pen = penLinesFor(bg, { material: FX.debrisPens.orange });
    g.add(mesh); g.add(pen);
    g.visible = false;
    scene.add(g);
    FX.debris.push({ g, mesh, pen, vx: 0, vy: 0, vz: 0, ax: 0, ay: 0, az: 0, life: 0 });
  }
  FX.popups = document.getElementById('popups');
  FX.tintEl = document.getElementById('tint');
};

// ---------------------------------------------------------------- decals
const _dn = new THREE.Vector3();
FX.decal = function (x, y, z, nx, ny, nz, size, kind = 'blood') {
  const m = FX.decals[FX.decalIdx];
  FX.decalIdx = (FX.decalIdx + 1) % FX.decals.length;
  const texs = kind === 'blood' ? FX.tex.blood : FX.tex.ink;
  m.material.map = texs[(Math.random() * texs.length) | 0];
  m.material.opacity = kind === 'blood' ? 0.95 : 0.85;
  m.material.needsUpdate = true;
  m.position.set(x + nx * 0.02, y + ny * 0.02, z + nz * 0.02);
  _dn.set(x + nx, y + ny, z + nz);
  m.lookAt(_dn);
  m.rotateZ(Math.random() * Math.PI * 2);
  m.scale.set(size, size, 1);
  m.visible = true;
};

// blood pool under a dead body: raycast down, stamp on the ground
FX.pool = function (x, y, z, size, kind = 'blood') {
  const h = rayLevel(x, y + 0.5, z, 0, -1, 0, 12);
  if (h) FX.decal(x, y + 0.5 - h.t, z, 0, 1, 0, size, kind);
};

// ---------------------------------------------------------------- droplets
FX.burst = function (x, y, z, n, kind = 'blood', speed = 5, dirx = 0, diry = 0, dirz = 0) {
  const tex = kind === 'blood' ? FX.tex.dotRed : kind === 'ink' ? FX.tex.dotInk : FX.tex.dotOrange;
  let made = 0;
  for (let i = 0; i < FX.drops.length && made < n; i++) {
    const d = FX.drops[i];
    if (d.life > 0) continue;
    made++;
    d.kind = kind;
    d.s.material.map = tex; d.s.material.needsUpdate = true;
    const sz = 0.05 + Math.random() * 0.14;
    d.s.scale.set(sz, sz, 1);
    d.s.position.set(x, y, z);
    d.s.visible = true;
    const a = Math.random() * Math.PI * 2, b = (Math.random() - 0.3) * Math.PI;
    const sp = speed * (0.4 + Math.random());
    d.vx = Math.cos(a) * Math.cos(b) * sp + dirx * speed * 0.6;
    d.vy = Math.sin(b) * sp + 2 + diry * speed * 0.6;
    d.vz = Math.sin(a) * Math.cos(b) * sp + dirz * speed * 0.6;
    d.life = 1.2 + Math.random() * 0.8;
  }
};

// ---------------------------------------------------------------- debris
FX.chunks = function (x, y, z, n, color = 'orange', size = 0.5, speed = 6) {
  let made = 0;
  for (let i = 0; i < FX.debris.length && made < n; i++) {
    const d = FX.debris[i];
    if (d.life > 0) continue;
    made++;
    d.mesh.material = FX.debrisMats[color] || FX.debrisMats.orange;
    d.pen.material = FX.debrisPens[color] || FX.debrisPens.orange;
    d.g.position.set(x, y, z);
    d.g.scale.set(size * (0.4 + Math.random() * 0.9), size * (0.2 + Math.random() * 0.5), size * (0.3 + Math.random() * 0.8));
    d.g.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    d.g.visible = true;
    const a = Math.random() * Math.PI * 2;
    d.vx = Math.cos(a) * speed * Math.random(); d.vz = Math.sin(a) * speed * Math.random();
    d.vy = speed * (0.5 + Math.random() * 0.8);
    d.ax = (Math.random() - 0.5) * 12; d.ay = (Math.random() - 0.5) * 12; d.az = (Math.random() - 0.5) * 12;
    d.life = 3 + Math.random() * 2;
  }
};

FX.update = function (dt) {
  FX.time += dt;
  // droplets
  for (const d of FX.drops) {
    if (d.life <= 0) continue;
    d.life -= dt;
    d.vy -= 22 * dt;
    const p = d.s.position;
    p.x += d.vx * dt; p.y += d.vy * dt; p.z += d.vz * dt;
    if (d.vy < 0) {
      const gy = groundHeightAt(p.x, p.z, p.y + 0.3);
      if (p.y <= gy + 0.02) {
        if (Math.random() < 0.55) FX.decal(p.x, gy, p.z, 0, 1, 0, 0.25 + Math.random() * 0.5, d.kind === 'blood' ? 'blood' : 'ink');
        d.life = 0;
      }
    }
    if (d.life <= 0) d.s.visible = false;
    else { const c = FX.camera.position; d.s.visible = (p.x - c.x) * (p.x - c.x) + (p.y - c.y) * (p.y - c.y) + (p.z - c.z) * (p.z - c.z) > 0.8; }
  }
  // chunks
  for (const d of FX.debris) {
    if (d.life <= 0) continue;
    d.life -= dt;
    d.vy -= 24 * dt;
    const p = d.g.position;
    p.x += d.vx * dt; p.y += d.vy * dt; p.z += d.vz * dt;
    d.g.rotation.x += d.ax * dt; d.g.rotation.y += d.ay * dt; d.g.rotation.z += d.az * dt;
    const gy = groundHeightAt(p.x, p.z, p.y + 0.3);
    const r = d.g.scale.y * 0.5;
    if (p.y - r < gy) {
      p.y = gy + r;
      if (d.vy < -1) { d.vy *= -0.35; d.vx *= 0.6; d.vz *= 0.6; d.ax *= 0.5; d.ay *= 0.5; d.az *= 0.5; }
      else { d.vy = 0; d.vx *= 0.9; d.vz *= 0.9; d.ax = d.ay = d.az = 0; }
    }
    if (d.life <= 0) d.g.visible = false;
    else { const c = FX.camera.position; d.g.visible = (p.x - c.x) * (p.x - c.x) + (p.y - c.y) * (p.y - c.y) + (p.z - c.z) * (p.z - c.z) > 0.5; }
  }
  // screen feedback decay
  if (FX.hitMarker > 0) FX.hitMarker -= dt;
  if (FX.tint > 0) { FX.tint = Math.max(0, FX.tint - dt * 1.6); FX.tintEl.style.opacity = FX.tint.toFixed(3); }
  if (FX.shake > 0) FX.shake = Math.max(0, FX.shake - dt * 3);
  for (let i = FX.arcs.length - 1; i >= 0; i--) { FX.arcs[i].t += dt; if (FX.arcs[i].t > FX.arcs[i].dur) FX.arcs.splice(i, 1); }
  if (FX.popupT > 0) FX.popupT -= dt; else FX.popupStack = 0;
};

// ---------------------------------------------------------------- screen
FX.hurt = function (amount) {
  FX.tint = Math.min(0.75, FX.tint + 0.22 + amount * 0.01);
  FX.tintEl.style.opacity = FX.tint.toFixed(3);
  FX.shake = Math.min(1, FX.shake + 0.3 + amount * 0.01);
  SFX.play('hurt');
};

FX.popup = function (text, cls = '') {
  if (!FX.popups) return;
  const el = document.createElement('div');
  el.className = 'popup ' + cls;
  const m = /^(.*?)(\s*[+\-]\d+)?$/.exec(text);
  const label = document.createElement('span'); label.className = 'lbl'; label.textContent = m ? m[1] : text;
  el.appendChild(label);
  if (m && m[2]) { const pts = document.createElement('span'); pts.className = 'pts'; pts.textContent = m[2]; el.appendChild(pts); }
  FX.popups.appendChild(el);
  el.addEventListener('animationend', () => el.remove());
  while (FX.popups.children.length > 7) FX.popups.firstChild.remove();
};

// katana swing trail drawn on the 2D overlay: dir +1 = right-to-left
FX.slashArc = function (dir, big = false) {
  FX.arcs.push({ t: 0, dur: big ? 0.35 : 0.24, dir, big });
};

// per-frame 2D overlay: crosshair, hit marker, slash arcs, block guard
FX.draw2D = function (ctx, W, H, state) {
  ctx.clearRect(0, 0, W, H);
  const cx = W / 2, cy = H / 2;
  ctx.lineCap = 'round';
  if (state.scoped) return; // the scope overlay carries its own reticle
  if (state.dead) return;
  // crosshair
  ctx.strokeStyle = state.onEnemy ? 'rgba(212,35,43,0.95)' : 'rgba(43,52,180,0.85)';
  ctx.lineWidth = 2;
  if (state.ads) {
    // holo sight carries the reticle; just a faint ring
    ctx.strokeStyle = 'rgba(212,35,43,0.9)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, 1.5, 0, Math.PI * 2); ctx.fillStyle = 'rgba(212,35,43,0.9)'; ctx.fill();
  } else if (state.weapon === 'katana') {
    ctx.setLineDash([5, 5]);
    ctx.beginPath(); ctx.arc(cx, cy, 13, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(cx, cy, 2, 0, Math.PI * 2); ctx.stroke();
  } else {
    const gap = 7 + state.spread * 14, len = 9;
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(cx - gap - len, cy); ctx.lineTo(cx - gap, cy);
    ctx.moveTo(cx + gap, cy); ctx.lineTo(cx + gap + len, cy);
    ctx.moveTo(cx, cy - gap - len); ctx.lineTo(cx, cy - gap);
    ctx.moveTo(cx, cy + gap); ctx.lineTo(cx, cy + gap + len);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, 1.6, 0, Math.PI * 2); ctx.stroke();
  }
  // hit marker
  if (FX.hitMarker > 0) {
    const a = Math.min(1, FX.hitMarker * 5);
    ctx.strokeStyle = `rgba(212,35,43,${a})`; ctx.lineWidth = 3;
    const r = 12 + (0.25 - Math.min(0.25, FX.hitMarker)) * 30;
    ctx.beginPath();
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { ctx.moveTo(cx + sx * r * 0.45, cy + sy * r * 0.45); ctx.lineTo(cx + sx * r, cy + sy * r); }
    ctx.stroke();
  }
  // grapple prompt: small hook glyph when aiming at something within reach
  if (state.grappleable) {
    ctx.strokeStyle = 'rgba(43,52,180,0.8)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx + 22, cy - 18, 5, Math.PI * 0.2, Math.PI * 1.5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx + 22, cy - 23); ctx.lineTo(cx + 22, cy - 31); ctx.stroke();
  }
  // block guard
  if (state.blocking) {
    ctx.strokeStyle = 'rgba(43,52,180,0.9)'; ctx.lineWidth = 4;
    ctx.setLineDash([12, 10]);
    ctx.beginPath(); ctx.arc(cx, cy, H * 0.22, -Math.PI * 0.35, Math.PI * 0.35); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, H * 0.22, Math.PI * 0.65, Math.PI * 1.35); ctx.stroke();
    ctx.setLineDash([]);
  }
  // slash arcs
  for (const a of FX.arcs) {
    const p = a.t / a.dur;
    const alpha = 1 - p;
    ctx.strokeStyle = `rgba(43,52,180,${alpha * 0.95})`;
    ctx.lineWidth = a.big ? 16 : 11;
    ctx.setLineDash(a.big ? [34, 22] : [26, 18]);
    ctx.lineDashOffset = -p * 120 * a.dir;
    const rx = W * (a.big ? 0.34 : 0.26), ry = H * (a.big ? 0.42 : 0.3);
    const ox = cx + a.dir * W * 0.06, oy = cy + H * 0.12;
    const start = a.dir > 0 ? Math.PI * 0.42 : Math.PI * 0.58;
    const sweep = (a.dir > 0 ? 1 : -1) * Math.PI * 0.95 * Math.min(1, p * 1.6);
    ctx.beginPath();
    ctx.ellipse(ox, oy, rx, ry, -a.dir * 0.35, start, start + sweep, a.dir > 0);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // damage direction hint
  if (FX.tint > 0.05 && FX.hitDir != null) {
    ctx.strokeStyle = `rgba(212,35,43,${Math.min(0.8, FX.tint)})`; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(cx, cy, H * 0.3, FX.hitDir - 0.4, FX.hitDir + 0.4); ctx.stroke();
  }
};

// ---------------------------------------------------------------- sound
const SFX = {
  ctx: null, master: null, muted: false, noise: null,
  init() {
    if (SFX.ctx) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      SFX.ctx = new AC();
      SFX.master = SFX.ctx.createGain();
      SFX.master.gain.value = 0.35;
      SFX.master.connect(SFX.ctx.destination);
      const len = SFX.ctx.sampleRate * 1.5;
      const buf = SFX.ctx.createBuffer(1, len, SFX.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      SFX.noise = buf;
    } catch (e) { SFX.ctx = null; }
  },
  resume() { if (SFX.ctx && SFX.ctx.state === 'suspended') SFX.ctx.resume(); },
  toggle() { SFX.muted = !SFX.muted; if (SFX.master) SFX.master.gain.value = SFX.muted ? 0 : 0.35; return SFX.muted; },
  _noise(dur, freq, q, gain, type = 'bandpass', decay = true) {
    const c = SFX.ctx; if (!c) return;
    const src = c.createBufferSource(); src.buffer = SFX.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain();
    const t = c.currentTime;
    g.gain.setValueAtTime(gain, t);
    if (decay) g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(SFX.master);
    src.start(t); src.stop(t + dur + 0.05);
  },
  _tone(dur, f0, f1, gain, type = 'sine') {
    const c = SFX.ctx; if (!c) return;
    const o = c.createOscillator(); o.type = type;
    const t = c.currentTime;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(SFX.master);
    o.start(t); o.stop(t + dur + 0.05);
  },
  play(name) {
    if (!SFX.ctx || SFX.muted) return;
    switch (name) {
      case 'rifle': SFX._noise(0.12, 1800, 0.8, 0.5, 'bandpass'); SFX._tone(0.08, 220, 60, 0.35, 'square'); break;
      case 'shotgun': SFX._noise(0.3, 700, 0.6, 0.9, 'lowpass'); SFX._tone(0.18, 140, 40, 0.6, 'sawtooth'); break;
      case 'revolver': SFX._noise(0.22, 1200, 0.7, 0.8, 'bandpass'); SFX._tone(0.14, 200, 50, 0.5, 'square'); break;
      case 'sniper': SFX._noise(0.45, 900, 0.5, 1.0, 'lowpass'); SFX._tone(0.3, 160, 30, 0.6, 'sawtooth'); break;
      case 'slash': SFX._noise(0.18, 2400, 1.5, 0.45, 'bandpass'); break;
      case 'block': SFX._tone(0.12, 1800, 900, 0.3, 'triangle'); SFX._noise(0.08, 3000, 2, 0.3); break;
      case 'parry': SFX._tone(0.25, 1200, 2400, 0.4, 'triangle'); SFX._noise(0.12, 4000, 2, 0.4); break;
      case 'hit': SFX._noise(0.06, 2600, 1.2, 0.3); break;
      case 'kill': SFX._noise(0.25, 500, 0.5, 0.6, 'lowpass'); SFX._tone(0.2, 300, 80, 0.3, 'triangle'); break;
      case 'splat': SFX._noise(0.3, 400, 0.4, 0.7, 'lowpass'); break;
      case 'grapple': SFX._tone(0.25, 400, 1400, 0.25, 'triangle'); SFX._noise(0.2, 3000, 1, 0.2); break;
      case 'yank': SFX._tone(0.2, 900, 200, 0.35, 'sawtooth'); break;
      case 'reload': SFX._noise(0.08, 1600, 3, 0.25); setTimeout(() => SFX._noise(0.08, 1200, 3, 0.25), 220); break;
      case 'pickup': SFX._tone(0.15, 600, 1200, 0.3, 'triangle'); break;
      case 'hurt': SFX._noise(0.2, 300, 0.7, 0.5, 'lowpass'); SFX._tone(0.15, 120, 60, 0.3); break;
      case 'explode': SFX._noise(0.7, 250, 0.3, 1.2, 'lowpass'); SFX._tone(0.4, 90, 30, 0.7, 'sawtooth'); break;
      case 'wave': SFX._noise(0.6, 1800, 4, 0.35, 'bandpass', true); SFX._tone(0.5, 330, 660, 0.25, 'triangle'); break;
      case 'clear': SFX._tone(0.35, 440, 880, 0.3, 'triangle'); setTimeout(() => SFX._tone(0.5, 660, 1320, 0.3, 'triangle'), 160); break;
      case 'dash': SFX._noise(0.35, 1500, 0.8, 0.7, 'bandpass'); SFX._tone(0.3, 200, 900, 0.3, 'sawtooth'); break;
      case 'ready': SFX._tone(0.3, 880, 1760, 0.3, 'square'); break;
      case 'crate': SFX._noise(0.25, 900, 0.8, 0.6, 'lowpass'); break;
      case 'jump': SFX._noise(0.08, 800, 1, 0.15); break;
      case 'dead': SFX._tone(1.2, 300, 40, 0.5, 'sawtooth'); SFX._noise(0.8, 200, 0.4, 0.8, 'lowpass'); break;
      case 'shoot_enemy': SFX._noise(0.1, 1000, 1.5, 0.18); break;
      case 'boss': SFX._tone(0.8, 110, 55, 0.6, 'sawtooth'); SFX._noise(0.6, 150, 0.4, 0.6, 'lowpass'); break;
    }
  },
};
