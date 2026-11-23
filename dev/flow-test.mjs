// dev/flow-test.mjs — scripted playthrough of Palma Verde.
//
// Loads every game script in index.html order into a stubbed browser,
// then plays for real: drive a car, run mission 1 end to end, raise
// four stars with the police heli up, fly the Gull up and back down,
// and buy a garage car. Each check prints PASS or FAIL; any failure
// exits non-zero. Run: node dev/flow-test.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS = ['config.js', 'world.js', 'render.js', 'player.js', 'vehicles.js',
  'traffic.js', 'police.js', 'hud.js', 'audio.js', 'missions.js', 'crew.js',
  'progress.js', 'garage.js', 'screens.js', 'shots.js', 'main.js'];

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log('PASS ' + name); }
  else { failed++; console.log('FAIL ' + name + (detail ? ' — ' + detail : '')); }
}

// ---- stub browser: a canvas and 2d context that absorb all drawing ----
// measureText returns a zero-width TextMetrics stub: the HUD's
// fitText compares its width numerically, and the generic proxy
// would throw "Cannot convert object to primitive value" on that
// comparison (hud.js fitText is correct on a real canvas).
function makeCtx() {
  const fn = function () { return proxy; };
  const proxy = new Proxy(fn, {
    get(t, prop) {
      if (prop === 'canvas') return canvas;
      if (prop === 'measureText') return () => ({ width: 0 });
      return proxy;
    },
    set() { return true; },
    apply() { return proxy; }
  });
  return proxy;
}
const canvas = {
  width: 1280, height: 720, clientWidth: 1280, clientHeight: 720,
  getContext() { return ctx; },
  getBoundingClientRect() { return { left: 0, top: 0 }; },
  addEventListener() {}, style: {}
};
const ctx = makeCtx();
const listeners = {};
const store = new Map();
let nowMs = 1000;
let frameCb = null;
const sandbox = {
  document: {
    getElementById: () => canvas,
    createElement: () => makeCtx(),
    addEventListener() {}
  },
  location: { search: '' },
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k)
  },
  performance: { now: () => nowMs },
  requestAnimationFrame: (cb) => { frameCb = cb; return 1; },
  setTimeout: () => 0,
  clearTimeout: () => {},
  setInterval: () => 0,
  clearInterval: () => {},
  console
};
sandbox.window = sandbox;
sandbox.addEventListener = (type, fn) => {
  (listeners[type] = listeners[type] || []).push(fn);
};

const context = vm.createContext(sandbox);
for (const name of SCRIPTS) {
  const code = fs.readFileSync(path.join(ROOT, 'game', 'src', name), 'utf8');
  try {
    vm.runInContext(code, context, { filename: name });
    check('load ' + name, true);
  } catch (e) { check('load ' + name, false, e.message); }
}

function key(k, down) {
  const ev = { key: k, preventDefault() {} };
  for (const fn of (listeners[down ? 'keydown' : 'keyup'] || [])) fn(ev);
}
function frames(n) {
  for (let i = 0; i < n; i++) {
    const cb = frameCb; frameCb = null;
    if (!cb) return false;
    nowMs += 16.7;
    cb(nowMs);
  }
  return true;
}

const W = sandbox.window;
try {
  const api = W.PalmaMain.startGame(canvas);
  const state = api.state, city = api.city;
  check('startGame returns state and city', !!state && !!city);
  check('state.city wired', state.city === city);
  check('Gull parked on the pad', !!state.gull && state.gull.kind === 'heli' && state.gull.name === 'Gull');
  key('Enter', true);
  check('game starts and runs 10 frames', state.screen === 'playing' && frames(10));
  check('mission 1 auto-starts on leaving the title',
    state.missions.current === 'the-debt' && !!state.missionTarget,
    'current ' + state.missions.current);

  // Drive: step to the nearest parked car, board it, drive forward.
  let car = null, best = Infinity;
  for (const c of state.cars) {
    const d = Math.hypot(c.x - state.player.x, c.y - state.player.y);
    if (d < best) { best = d; car = c; }
  }
  state.player.x = car.x - 20; state.player.y = car.y;
  key('e', true);
  check('E enters the nearest car', state.player.vehicle === car);
  const sx = car.x, sy = car.y;
  key('w', true);
  frames(90);
  const moved = Math.hypot(car.x - sx, car.y - sy);
  check('car drives forward', moved > 5, 'moved ' + moved.toFixed(1) + ' units');
  key('w', false);
  key('e', true);
  check('E exits the car', state.player.vehicle === null);

  // Mission 1 end to end through the live loop: Rey is moved to each
  // stage marker (the test moves him; the arrival, handoff and rank
  // logic all run through the real per-frame path), E for the handoff.
  // RP is seeded at 300 so the 150 from mission 1 crosses the 400
  // Wheelman line and the rank mapping is exercised for real.
  const money0 = state.player.money;
  state.rp = 300;
  check('mission 1 already running from the title', state.missions.current === 'the-debt');
  let guard = 0;
  while (state.missions.current && guard++ < 10) {
    const stage = W.PalmaMissions.currentStage(state);
    if (!stage) break;
    state.player.x = state.missionTarget.x;
    state.player.y = state.missionTarget.y;
    if (stage.type === 'deliver') key('e', true);
    if (!frames(5)) break;
  }
  check('mission 1 completes by live play', state.missions.completed.includes('the-debt'));
  check('mission 1 pays $500 and 150 RP',
    state.player.money === money0 + 500 && state.rp === 450,
    'money ' + state.player.money + ' rp ' + state.rp);
  check('rank advances to Wheelman after mission 1',
    state.rank === 1 && W.PalmaConfig.RANKS[state.rank].name === 'Wheelman',
    'rank ' + state.rank);
  check('mission passed banner is up',
    !!(state.banner && state.banner.kind === 'MISSION PASSED'));
  key('Enter', true);
  check('Enter dismisses the banner', state.banner === null);
  // Crew: Z calls Tuck, who drops a star for 25 RP, then cools down.
  state.wanted = 2;
  key('z', true);
  check('Z calls Tuck, wanted drops a star',
    state.wanted === 1 && state.crew.tuck.cooldown > 0,
    'wanted ' + state.wanted);
  key('z', true);
  check('Z again while cooling down changes nothing', state.wanted === 1);

  // Wanted 4: dispatch board full, AIR-1 overhead, loop keeps running.
  // B3's composition: 7 ground units (foot, 4 cruisers, 2 bikes) + AIR-1.
  W.PalmaPolice.stageChase(state, city, 4);
  const rows = W.PalmaPolice.dispatchRows(state);
  check('dispatch rows = 8 at 4 stars', rows.length === 8, 'got ' + rows.length);
  check('AIR-1 spotlight row present',
    rows.some((r) => r.callsign === 'AIR-1' && r.tactic === 'SPOTLIGHT'));
  // AIR-1 wears a drawn body now, not just a cone: the overlay calls
  // the renderer's drawHeli once for the police helicopter.
  const renderer = W.PalmaRender.makeRenderer(canvas);
  check('renderer exposes drawHeli', typeof renderer.drawHeli === 'function');
  let heliDraws = 0;
  const realHeli = renderer.drawHeli;
  renderer.drawHeli = function () { heliDraws++; return realHeli.apply(renderer, arguments); };
  W.PalmaPolice.drawOverlay(state, city, canvas, renderer, 'golden');
  check('AIR-1 body drawn via drawHeli', heliDraws === 1, 'draws ' + heliDraws);
  check('30 frames at 4 stars without a throw', frames(30));
  check('dispatch still 8 rows after the loop',
    W.PalmaPolice.dispatchRows(state).length === 8);

  // The Gull: board, climb to about 15 m, fly, land, step out.
  const gull = state.gull;
  state.player.x = gull.x + 30; state.player.y = gull.y;
  key('e', true);
  check('E boards the Gull', state.player.vehicle === gull);
  key(' ', true); key('w', true);
  let maxAlt = 0, i = 0;
  while (i++ < 400) {
    frames(1);
    maxAlt = Math.max(maxAlt, gull.altitude);
    if (gull.altitude >= 14) break;
  }
  check('Gull climbs to ~15 m', maxAlt >= 10, 'max altitude ' + maxAlt.toFixed(1) + ' m');
  try {
    W.PalmaHud.draw(state, city, canvas, 'golden', W.PalmaRender.makeRenderer(canvas));
    check('HUD draws while flying (no model crash)', true);
  } catch (e) { check('HUD draws while flying (no model crash)', false, e.message); }
  key(' ', false); key('w', false); key('c', true);
  let landed = false; i = 0;
  while (i++ < 600) {
    frames(1);
    if (gull.landed) { landed = true; break; }
  }
  key('c', false);
  check('Gull lands', landed, 'altitude ' + gull.altitude.toFixed(1) + ' m');
  key('e', true);
  check('E exits the Gull on the ground', state.player.vehicle === null);

  // Garage: buy a car with real money and watch it land in owned.
  state.player.money = 50000;
  const bought = W.PalmaGarage.buyCar(state, 'Citrus Coupe');
  check('garage buy succeeds', bought.ok && state.garage.owned.includes('Citrus Coupe'),
    bought.reason || '');
  check('garage buy charges $9,000', state.player.money === 41000,
    'money ' + state.player.money);
} catch (e) {
  check('playthrough runs without an unexpected throw', false, e.stack.split('\n')[0]);
}

console.log('FLOW ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
