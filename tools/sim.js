#!/usr/bin/env node
'use strict';
// Fast headless simulation: steps the game loop directly with an autopilot
// and checks that waves progress, enemies reach the player, and nothing
// produces NaN or console errors. Usage: node tools/sim.js [seconds]
const path = require('path');
const fs = require('fs');
const http = require('http');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const SECONDS = +(process.argv[2] || 240);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.woff2': 'font/woff2' };
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});

srv.listen(0, '127.0.0.1', async () => {
  const base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const problems = [];
  page.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  await page.goto(`${base}/?nolock&desktop`);
  await new Promise(r => setTimeout(r, 1200));

  const report = await page.evaluate(async (SECONDS) => {
    startGame();
    P.god = true;
    const log = [], issues = [];
    const stuck = new Map();
    let kills = 0, shots = 0, yanks = 0, slashes = 0, maxWave = 0, farthestEnemy = 0;
    const origKill = ENEMY_HOOKS.kill;
    ENEMY_HOOKS.kill = function (e, cause, part) { kills++; return origKill.call(this, e, cause, part); };
    const nearest = () => {
      let best = null, bd = 1e9;
      for (const e of ENEMIES.list) { if (e.dead || e.state === 'spawn') continue; const d = Math.hypot(e.pos.x - P.pos.x, e.pos.y - P.pos.y, e.pos.z - P.pos.z); if (d < bd) { bd = d; best = e; } }
      return best ? { e: best, d: bd } : null;
    };
    let lastKillT = 0, lastKills = 0;
    const aimAt = (e) => {
      const hx = e.pos.x, hy = e.pos.y + 1.58 * e.s, hz = e.pos.z;
      const dx = hx - P.pos.x, dy = hy - P.eyeY, dz = hz - P.pos.z;
      P.yaw = Math.atan2(-dx, -dz);
      P.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    };
    let weaponTimer = 0;
    for (let f = 0; f < 60 * SECONDS; f++) {
      const inp = P.input;
      inp.fire = false; inp.fwd = 0; inp.side = 0;
      const n = nearest();
      if (kills !== lastKills) { lastKills = kills; lastKillT = f; }
      if (f - lastKillT > 60 * 25 && ENEMIES.list.length) { const s = LEVEL.playerStart; P.pos.x = s.x; P.pos.y = s.y; P.pos.z = s.z; P.vel.x = P.vel.y = P.vel.z = 0; P.grapple.active = false; P.rope.visible = false; lastKillT = f; issues.push(`autopilot reset at t=${(f / 60).toFixed(0)} (no kill for 25s, enemies=${ENEMIES.list.length}, wave=${GAME.wave})`); }
      if (n && f % 3 === 0) {
        aimAt(n.e);
        const w = P.weapon();
        if (n.e.onLedge && f % 60 === 0 && P.pitch < 0.6) { inp.grapplePressed = true; yanks++; }
        else if (n.d < 3 && !w.melee && f % 30 === 0) P.switchTo(4);
        else if (n.d > 4 && w.melee && f % 30 === 0) P.switchTo(0);
        if (w.melee) { if (n.d < 3.2) { inp.firePressed = true; slashes++; } }
        else if (P.ammo[P.wi].mag > 0) { inp.fire = true; inp.firePressed = true; shots++; }
        else if (P.ammo[P.wi].reserve === 0) { const alt = P.ammo.findIndex((a, i) => i < 4 && (a.mag > 0 || a.reserve > 0)); P.switchTo(alt >= 0 ? alt : 4); }
        if (n.d > 6 && !n.e.onLedge) inp.fwd = 1;
        if (Math.abs(n.e.pos.y - P.pos.y) > 2 && !n.e.onLedge) { inp.fwd = 1; if (f % 90 === 0) inp.jump = true; }
        if (P.slashReady && n.d < 8) inp.dash = true;
      }
      step(1 / 60);
      // health checks
      for (const e of ENEMIES.list) {
        if (!Number.isFinite(e.pos.x) || !Number.isFinite(e.pos.y) || !Number.isFinite(e.pos.z)) { issues.push(`NaN enemy pos ${e.type} at t=${(f / 60).toFixed(1)}`); e.remove(); }
        else if (Math.abs(e.pos.x) > 72 || Math.abs(e.pos.z) > 72 || e.pos.y < -3) issues.push(`enemy out of bounds ${e.type} ${e.pos.x.toFixed(1)},${e.pos.y.toFixed(1)},${e.pos.z.toFixed(1)} t=${(f / 60).toFixed(1)}`);
        const d = Math.hypot(e.pos.x - P.pos.x, e.pos.z - P.pos.z);
        farthestEnemy = Math.max(farthestEnemy, d);
        if (!e.t.ledge && e.state === 'active') {
          const s = stuck.get(e.id) || { t: 0, d, x: e.pos.x, z: e.pos.z };
          if (Math.hypot(e.pos.x - s.x, e.pos.z - s.z) < 1.5 && d > 12) s.t += 1 / 60; else { s.t = 0; s.x = e.pos.x; s.z = e.pos.z; }
          stuck.set(e.id, s);
          if (s.t > 20 && !s.reported) { s.reported = true; issues.push(`enemy ${e.type}#${e.id} stuck ${s.t.toFixed(0)}s at ${e.pos.x.toFixed(1)},${e.pos.z.toFixed(1)} dist ${d.toFixed(1)} t=${(f / 60).toFixed(1)}`); }
        }
      }
      if (!Number.isFinite(P.pos.x) || !Number.isFinite(P.pos.y)) { issues.push('NaN player pos'); break; }
      maxWave = Math.max(maxWave, GAME.wave);
      if (f % 600 === 0) log.push({ t: f / 60, wave: GAME.wave, enemies: ENEMIES.list.length, queue: GAME.spawnQueue.length, score: GAME.score, hp: Math.round(P.hp), pos: [P.pos.x.toFixed(1), P.pos.y.toFixed(1), P.pos.z.toFixed(1)], w: P.weapon().id, ammo: P.ammo.map(a => a.mag + '/' + a.reserve).join(' ') });
    }
    return { log, issues: issues.slice(0, 30), kills, shots, yanks, slashes, maxWave, farthestEnemy, state: GAME.state, decalsUsed: FX.decals.filter(d => d.visible).length, dropsActive: FX.drops.filter(d => d.life > 0).length };
  }, SECONDS);

  for (const l of report.log) console.log(JSON.stringify(l));
  console.log('kills', report.kills, 'shots', report.shots, 'slashes', report.slashes, 'yanks', report.yanks, 'maxWave', report.maxWave, 'state', report.state, 'farthestEnemy', report.farthestEnemy.toFixed(1));
  console.log('issues:', report.issues.length ? report.issues : 'none');
  if (problems.length) console.log('console problems:', [...new Set(problems)]);
  await browser.close();
  srv.close();
});
