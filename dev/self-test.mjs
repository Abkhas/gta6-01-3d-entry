// dev/self-test.mjs — unit-ish checks for Palma Verde.
//
// Loads every game script in index.html order into a stubbed browser
// and checks the systems against each other: minimap route, dispatch
// rows, save slots, completion math, the rank ladder, and the
// dashboard totals against the config roster. Each check prints PASS
// or FAIL; any failure exits non-zero. Run: node dev/self-test.mjs
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
const memStore = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k)
};
let nowMs = 1000;
let frameCb = null;
const sandbox = {
  document: {
    getElementById: () => canvas,
    createElement: () => makeCtx(),
    addEventListener() {}
  },
  location: { search: '' },
  localStorage: memStore,
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
  key('Enter', true);
  check('game starts and runs 10 frames', state.screen === 'playing' && frames(10));

  // Minimap: a mission target draws a dashed route, no throw.
  // B4's D6 grid made drawMinimap take the layout as a parameter;
  // the test builds it from the exported layoutGrid.
  state.missionTarget = { x: 900, y: 600 };
  try {
    W.PalmaHud.drawMinimap(ctx, state, city, canvas, W.PalmaHud.layoutGrid(canvas));
    check('minimap draws with a route target', !!state.missionTarget);
  } catch (e) { check('minimap draws with a route target', false, e.message); }
  const chase = W.PalmaShots.stageShot('chase', 1);
  check('staged chase shot carries a route target', !!chase.state.missionTarget);

  // Dispatch: exactly 8 rows at 4 stars (7 ground + AIR-1), AIR-1 last.
  W.PalmaPolice.stageChase(state, city, 4);
  const rows = W.PalmaPolice.dispatchRows(state);
  check('dispatch rows = 8 at 4 stars', rows.length === 8, 'got ' + rows.length);
  check('dispatch rows carry tactic and distance',
    rows.every((r) => typeof r.tactic === 'string' && typeof r.distM === 'number'));
  check('dispatch last row is AIR-1', rows[rows.length - 1] && rows[rows.length - 1].callsign === 'AIR-1');
  W.PalmaPolice.stageChase(state, city, 2);
  check('dispatch rows = 4 at 2 stars (no heli)',
    W.PalmaPolice.dispatchRows(state).length === 4);

  // Audio: distance helpers are pure, so they assert on fake states.
  const au = W.PalmaAudio;
  const fakePol = {
    player: { x: 0, y: 0 },
    police: {
      units: [
        { car: { x: 300, y: 400 } },
        { car: { x: 30, y: 40 } },
        { ped: { x: 1000, y: 0 } }
      ],
      heli: { x: 0, y: 800 }
    }
  };
  check('nearest police distance is the closest unit (50)',
    au.nearestPoliceDist(fakePol) === 50, 'got ' + au.nearestPoliceDist(fakePol));
  check('nearest police distance is Infinity with no police',
    au.nearestPoliceDist({ player: { x: 0, y: 0 }, police: null }) === Infinity);
  const fakeTraf = {
    player: { x: 0, y: 0 },
    cars: [
      { x: 500, y: 0, speed: 20 },
      { x: 60, y: 80, speed: 40, police: true },
      { x: 90, y: 0, speed: 30 }
    ]
  };
  const near = au.nearestTrafficCar(fakeTraf);
  check('nearest traffic car skips police and finds the 90-unit car',
    !!near && near.dist === 90 && near.car.speed === 30,
    near ? ('dist ' + near.dist) : 'null');
  check('nearest traffic car is null on an empty street',
    au.nearestTrafficCar({ player: { x: 0, y: 0 }, cars: [] }) === null);
  try {
    au.honk();
    check('honk is safe with no audio context', true);
  } catch (e) { check('honk is safe with no audio context', false, e.message); }
  try {
    const honkState = {
      player: { x: 0, y: 0, vehicle: null }, wanted: 0, radioStation: 0,
      cars: [{ x: 10, y: 0, honk: true, speed: 0 }]
    };
    au.tick(honkState, 0.016);
    check('tick consumes a honk flag without audio', honkState.cars[0].honk === false);
  } catch (e) { check('tick consumes a honk flag without audio', false, e.message); }

  // Save slots: write three, read them back, clear one.
  const s1 = W.PalmaProgress.saveGame(state, 0, memStore);
  const s2 = W.PalmaProgress.saveGame(state, 1, memStore);
  check('save slots write', s1.ok && s2.ok);
  const slots = W.PalmaProgress.listSaveSlots(memStore);
  check('slot 1 filled, slot 3 empty', !slots[0].empty && slots[2].empty);
  const loaded = W.PalmaProgress.loadGame(0, memStore);
  check('save slot reads back', loaded.ok && loaded.state.rp === state.rp);
  const cleared = W.PalmaProgress.clearSaveSlot(1, memStore);
  check('clear slot empties it',
    cleared.ok && W.PalmaProgress.listSaveSlots(memStore)[1].empty);
  check('main save/load round-trips money',
    api.saveGame(state, 1) && api.loadGame(1) && api.loadGame(1).player.money === state.player.money);

  // Completion math: 5 missions, 16 activities, 6 discs, 1 property.
  const probe = {
    missions: { completed: ['a', 'b', 'c', 'd', 'e'] },
    activitiesDone: 16,
    collectibles: { found: ['1', '2', '3', '4', '5', '6'] },
    properties: { owned: ['boardwalk-flat'] }
  };
  check('completion math is 48.1%',
    W.PalmaProgress.completionPercent(probe) === 48.1,
    'got ' + W.PalmaProgress.completionPercent(probe));

  // Rank ladder: config and progress agree, and 1,900 RP is Fixer.
  const cfgSteps = W.PalmaConfig.RANKS.map((r) => r.rp);
  const progSteps = W.PalmaProgress.RANKS.map((r) => r.rpNeeded);
  check('rank ladder matches progress.js', JSON.stringify(cfgSteps) === JSON.stringify(progSteps),
    'config ' + cfgSteps + ' vs progress ' + progSteps);
  check('1,900 RP is Rank 3 Fixer',
    W.PalmaProgress.rankForRp(1900).name === 'Fixer' &&
    W.PalmaConfig.RANKS[2].name === 'Fixer');
  check('1,900 RP bars against 2,600',
    W.PalmaProgress.rankProgress(1900).next.rpNeeded === 2600);
  check('ladder ends at Legend 5,200',
    W.PalmaProgress.rankForRp(5200).name === 'Legend' &&
    W.PalmaProgress.rankForRp(0).name === 'Runner');

  // Dashboard totals match the live config roster.
  const cat = W.PalmaScreens.CATALOGUE;
  check('dashboard vehicles = 18 car models',
    cat.vehicles === 18 && W.PalmaConfig.CARS.length === 18,
    'dashboard ' + cat.vehicles + ' vs config ' + W.PalmaConfig.CARS.length);
  check('dashboard weapons = 8 weapons',
    cat.weapons === 8 && W.PalmaConfig.WEAPONS.length === 8,
    'dashboard ' + cat.weapons + ' vs config ' + W.PalmaConfig.WEAPONS.length);
  check('dashboard districts / radio / missions',
    cat.districts === 7 && cat.radio === 3 && cat.missions === 10 &&
    W.PalmaConfig.DISTRICTS.length === 7 && W.PalmaConfig.RADIO.length === 3 &&
    W.PalmaMissions.MISSIONS.length === 10);
  const seen = new Set();
  const rng = W.PalmaWorld.makeRng(7);
  for (let i = 0; i < 4000; i++) seen.add(W.PalmaVehicles.pickModel(rng));
  const fresh = ['arena', 'costa', 'palmera', 'luna', 'estrella', 'norte', 'sierra', 'olas', 'duna'];
  check('new car models spawn from the roster',
    fresh.every((id) => seen.has(id)), 'missing: ' + fresh.filter((id) => !seen.has(id)).join(','));
  check('every config car resolves by id',
    W.PalmaConfig.CARS.every((m) => W.PalmaVehicles.modelById(m.id).id === m.id));

  // Shot 3 staged values stay correct after the ladder fix.
  const sys = W.PalmaShots.renderSync(canvas, 'systems', 3);
  check('shot 3 renders at 48.1% completion', sys.completion === 48.1, 'got ' + sys.completion);
  const staged = W.PalmaShots.stageSystemsShot(3);
  check('shot 3 stages RP 1,900 / Rank 3 Fixer',
    staged.state.rp === 1900 && staged.state.rank === 2 &&
    W.PalmaConfig.RANKS[staged.state.rank].name === 'Fixer');
  const heli = W.PalmaShots.renderSync(canvas, 'heli', 4);
  check('shot 4 uses the real Gull, no fallback',
    heli.heliUsedGull === true && heli.gullFallback === false);

  // Rank sync: addRp re-derives a NUMERIC rank index from the RP total
  // (the live loop calls it with zero after completeMission pays RP).
  const rankProbe = { rp: 250, rank: 0 };
  const bumped = W.PalmaProgress.addRp(rankProbe, 200);
  check('addRp maps 450 RP to rank index 1 Wheelman',
    rankProbe.rank === 1 && bumped.rankedUp && bumped.rankedUp.name === 'Wheelman',
    'rank ' + rankProbe.rank);
  const zeroProbe = { rp: 450, rank: 0 };
  W.PalmaProgress.addRp(zeroProbe, 0);
  check('addRp with zero still derives rank 1 from 450 RP', zeroProbe.rank === 1, 'rank ' + zeroProbe.rank);

  // Stage reporters the live loop depends on: a shoot stage clears
  // when its foes are down, a race stage passes on a win and fails
  // the mission on a loss.
  const fight = { missions: { current: 'the-drop', stage: 2, completed: ['the-debt', 'hot-wheels', 'boardwalk-heat'] }, player: { money: 0 }, rp: 0, respect: 0 };
  const clearedOut = W.PalmaMissions.reportCombat(fight, { foesDown: () => true });
  check('shoot stage clears when foes are down',
    clearedOut.ok && fight.missions.completed.includes('the-drop'),
    clearedOut.reason || '');
  const race = { missions: { current: 'street-kings', stage: 1, completed: ['the-debt', 'hot-wheels', 'boardwalk-heat', 'the-drop', 'sky-courier', 'old-town-score'] }, player: { money: 0 }, rp: 0, respect: 0 };
  const won = W.PalmaMissions.reportRace(race, {}, true);
  check('race stage advances on a win', won.ok && race.missions.stage === 2);
  const lost = { missions: { current: 'street-kings', stage: 1, completed: ['the-debt', 'hot-wheels', 'boardwalk-heat', 'the-drop', 'sky-courier', 'old-town-score'] }, player: { money: 0 }, rp: 0, respect: 0 };
  const lostRes = W.PalmaMissions.reportRace(lost, {}, false);
  check('race stage fails the mission on a loss',
    lostRes.ok && lostRes.failed && lost.missions.current === null,
    lostRes.reason || '');
} catch (e) {
  check('self-test runs without an unexpected throw', false, e.stack.split('\n')[0]);
}

console.log('SELF ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
