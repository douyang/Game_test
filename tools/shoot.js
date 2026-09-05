#!/usr/bin/env node
'use strict';
// Drives the game headlessly and writes screenshots to ./screenshots.
// Usage: node tools/shoot.js [--out screenshots] [--keep]
// Needs playwright resolvable (npm i -g playwright, or NODE_PATH to a global install)
// and a Chromium it can launch.
const path = require('path');
const fs = require('fs');
const http = require('http');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.resolve(process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : path.join(ROOT, 'screenshots'));
fs.mkdirSync(OUT, { recursive: true });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.css': 'text/css' };
function serve() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/index.html';
      const f = path.join(ROOT, p);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nope'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const srv = await serve();
  let problems = [];
  process.on('exit', () => { if (problems.length) { console.log('\nPROBLEMS:'); for (const p of [...new Set(problems)]) console.log(' ', p); } });
  const base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--disable-gpu-sandbox', '--autoplay-policy=no-user-gesture-required'],
  });
  const shot = async (page, name) => { await page.screenshot({ path: path.join(OUT, name + '.jpg'), type: 'jpeg', quality: 86 }); console.log('shot', name); };

  // ---------------- desktop run
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') problems.push(`[console.${m.type()}] ${m.text()}`); });
  page.on('pageerror', e => problems.push(`[pageerror] ${e.message}`));
  await page.goto(`${base}/?nolock&desktop`);
  await sleep(1500);
  await shot(page, '01-title');
  await page.click('#overlay');
  await page.evaluate(() => { P.god = true; });
  await sleep(1200);
  await shot(page, '02-wave-start');

  // look around a bit + walk
  await page.mouse.move(640, 360);
  await page.mouse.move(700, 350, { steps: 12 });
  await page.keyboard.down('KeyW');
  await sleep(900);
  await page.keyboard.up('KeyW');
  await shot(page, '03-walking');

  // bring enemies close and shoot them
  await page.evaluate(() => {
    ENEMIES.clear();
    GAME.spawnQueue.length = 0;
    const spawn = (t, dx, dz) => { const e = ENEMIES.spawn(t, P.pos.x + dx, 0, P.pos.z + dz); e.state = 'active'; e.rig.scale.setScalar(e.s); return e; };
    spawn('gunner', -2, -9); spawn('gunner', 2, -8); spawn('rusher', 0, -12); spawn('inkbomb', 4, -14); spawn('heavy', -5, -16);
    P.pitch = 0; P.yaw = 0;
  });
  await sleep(700);
  await shot(page, '04-enemies');
  await page.mouse.down(); await sleep(600); await page.mouse.up();
  await sleep(500);
  await shot(page, '05-rifle-fire');
  // ADS
  await page.mouse.down({ button: 'right' }); await sleep(400);
  await shot(page, '06-rifle-ads');
  await page.mouse.up({ button: 'right' });

  // shotgun
  await page.keyboard.press('Digit2'); await sleep(500);
  await page.mouse.down(); await sleep(100); await page.mouse.up(); await sleep(400);
  await shot(page, '07-shotgun');

  // katana: slash + block
  await page.keyboard.press('Digit5'); await sleep(500);
  await page.evaluate(() => { const e = ENEMIES.spawn('rusher', P.pos.x + 0.6, 0, P.pos.z - 2.2); e.state = 'active'; e.rig.scale.setScalar(e.s); });
  await sleep(300);
  await page.mouse.down(); await sleep(60); await page.mouse.up();
  await sleep(120);
  await shot(page, '08-katana-slash');
  await page.mouse.down({ button: 'right' }); await sleep(400);
  await shot(page, '09-katana-block');
  await page.mouse.up({ button: 'right' });

  // sniper scope
  await page.keyboard.press('Digit4'); await sleep(600);
  await page.mouse.down({ button: 'right' }); await sleep(500);
  await shot(page, '10-sniper-scope');
  await page.mouse.down(); await sleep(50); await page.mouse.up(); await sleep(300);
  await page.mouse.up({ button: 'right' });
  await sleep(600);
  await shot(page, '11-sniper-bolt');

  // grapple toward the frame building
  await page.keyboard.press('Digit1');
  await page.evaluate(() => { P.pos.x = 0; P.pos.z = 8; P.yaw = 0.55; P.pitch = 0.35; });
  await sleep(200);
  await page.keyboard.press('KeyE');
  await sleep(500);
  await shot(page, '12-grapple');
  await sleep(1500);
  await shot(page, '13-after-grapple');

  // boss
  await page.evaluate(() => {
    ENEMIES.clear();
    P.pos.x = 0; P.pos.y = 0; P.pos.z = 10; P.yaw = 0; P.pitch = 0; P.vel.x = P.vel.y = P.vel.z = 0;
    const e = ENEMIES.spawn('doodler', 0, 0, -8); e.state = 'active'; e.rig.scale.setScalar(e.s);
    GAME.bossAlive = e; HUD.boss();
    const s = ENEMIES.spawn('sniper', 6, 0, -10); s.state = 'active'; s.rig.scale.setScalar(s.s);
  });
  await sleep(900);
  await shot(page, '14-boss');

  // wave banner + dash execute
  await page.evaluate(() => { HUD.banner('WAVE 4 CLEARED', 'catch your breath  +800', 4); P.switchTo(4); P.slashMeter = 100; P.slashReady = true; HUD.slash(); });
  await sleep(600);
  await page.keyboard.press('ShiftLeft');
  await sleep(250);
  await shot(page, '15-dash-execute');
  await sleep(1200);

  // hurt + death
  await page.evaluate(() => { P.hurt(60, P.pos.x + 3, P.pos.z - 3, 'test'); });
  await sleep(120);
  await shot(page, '16-hurt');
  await page.evaluate(() => { P.hurt(500, null); });
  await sleep(2000);
  await shot(page, '17-dead');

  // frame rate probe
  const fps = await page.evaluate(() => new Promise(res => { let n = 0; const t0 = performance.now(); const tick = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(tick); else res(n / 2); }; requestAnimationFrame(tick); }));
  console.log('approx fps (swiftshader):', fps.toFixed(1));

  const state = await page.evaluate(() => ({ state: GAME.state, score: GAME.score, wave: GAME.wave, enemies: ENEMIES.list.length, hp: P.hp, weapons: P.ammo, pos: P.pos }));
  console.log('state', JSON.stringify(state));
  await page.close();

  // ---------------- phone run
  const phone = await browser.newPage({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  phone.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') problems.push(`[phone console.${m.type()}] ${m.text()}`); });
  phone.on('pageerror', e => problems.push(`[phone pageerror] ${e.message}`));
  await phone.goto(`${base}/?nolock&touch`);
  await sleep(1500);
  await shot(phone, '18-phone-title');
  await phone.evaluate(() => startGame());
  await sleep(1200);
  await phone.evaluate(() => { const e = ENEMIES.spawn('gunner', P.pos.x + 1, 0, P.pos.z - 8); e.state = 'active'; e.rig.scale.setScalar(e.s); });
  await sleep(500);
  await shot(phone, '19-phone-play');
  await phone.close();

  await browser.close();
  srv.close();
  if (problems.length) { console.log('\nPROBLEMS:'); for (const p of [...new Set(problems)]) console.log(' ', p); process.exitCode = 1; }
  else console.log('\nno console errors');
}

main().catch(e => { console.error(e); process.exit(1); });
