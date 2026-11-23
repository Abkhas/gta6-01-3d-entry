// dev/self-test-3d.mjs — pure-logic checks for Palma Verde 3D.
//
// Two halves. Part A imports the ES-module systems directly (they are
// pure logic: no WebGL, no DOM) and checks missions, police dispatch,
// crew cooldowns, weapons, progress, garage, radio and day/night
// against each other. Part B loads the three classic scripts
// (hud3d, screens3d, shots3d) into a stubbed browser and checks the
// HUD layout (zero overlaps), the systems screen and all four shot
// stagings. Each check prints PASS or FAIL; any failure exits
// non-zero. Run: node dev/self-test-3d.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import { CFG3D, districtAt, gradeForHour } from '../game/src/config3d.js';
import * as Missions3d from '../game/src/missions3d.js';
import { createPoliceSystem } from '../game/src/police3d.js';
import * as Crew3d from '../game/src/crew3d.js';
import * as Weapons3d from '../game/src/weapons3d.js';
import * as Progress3d from '../game/src/progress3d.js';
import * as Garage3d from '../game/src/garage3d.js';
import { createRadio, RADIO } from '../game/src/radio3d.js';
import { createDayNight } from '../game/src/daynight3d.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log('PASS ' + name); }
  else { failed++; console.log('FAIL ' + name + (detail ? ' — ' + detail : '')); }
}
function near(a, b, eps) { return Math.abs(a - b) <= (eps === undefined ? 0.01 : eps); }

// ---- shared fixtures ----------------------------------------------------
function freshTestState() {
  return {
    player: {
      x: -800, z: 600, angle: 0, aim: 0, aiming: false,
      health: 100, armour: 0, money: 0, weapon: 'pistol', vehicle: null,
      ammo: { pistol: 12, pistol_reserve: 60 },
      meleeT: 0, lastFireT: -99
    },
    wanted: 0, rp: 0, rank: 0, respect: 10,
    missions: Missions3d.createMissionState(),
    crew: Crew3d.createCrewState(),
    garage: { owned: ['Cometa GT'], upgrades: {} },
    properties: { owned: [] },
    collectibles: { found: [] },
    completion: 0, activitiesDone: 0, racesWon: 0, playMinutes: 0,
    weapons: { owned: ['fists', 'pistol'] },
    standing: { Marina: 0, 'Old Town': 0, 'Citrus Lane': 0, Boardwalk: 0, 'The Docks': 0, 'Palm Heights': 0, Northgate: 0 },
    career: { carsStolen: 0, copsEscaped: 0, distanceDrivenKm: 0, longestJumpM: 0, crewAbilitiesUsed: 0, highestWanted: 0 },
    clockMinutes: 570, weather: { haze: 0.12 },
    cars: [], peds: [], radioStation: 0, radioTrack: '',
    screen: 'playing', weaponWheel: false,
    cam: { x: -800, z: 600 }, shotCamera: null, district: null,
    missionTarget: null, waypoint: null, dialogue: null, banner: null,
    police: null, gull: null, mouseWorld: null, lastCrime: null,
    time: 0, seed: 20261124, missionKills: 0, raceDeadline: 0, titleSlot: 0
  };
}
const testHooks = {
  onEvent: function () {},
  atTarget: function () { return true; },
  foesDown: function () { return true; },
  raceWon: function () { return true; },
  parcelHanded: function () { return true; },
  setWanted: function (st, level) { if (typeof level === 'number') st.wanted = level; }
};

// ---- Part A: config ------------------------------------------------------
check('config: 7 districts', CFG3D.DISTRICTS.length === 7, 'got ' + CFG3D.DISTRICTS.length);
check('config: districtAt finds Marina at Hotel Miramar', (districtAt(-1100, -900) || {}).name === 'Marina', JSON.stringify(districtAt(-1100, -900)));
check('config: gradeForHour morning is morning', gradeForHour(9.5).label === 'Morning', String(gradeForHour(9.5).label));
check('config: gradeForHour 21 is night', gradeForHour(21).label === 'Night', String(gradeForHour(21).label));
check('config: gradeForHour noon is Midday', gradeForHour(12).label === 'Midday', String(gradeForHour(12).label));

// ---- Part A: missions ----------------------------------------------------
{
  const list = Missions3d.missionList();
  check('missions: 10 missions in the catalogue', list.length === 10, 'got ' + list.length);
  const s = freshTestState();
  const started = Missions3d.startMission(s, 'the-debt', testHooks);
  check('missions: startMission the-debt ok', started && started.ok === true, JSON.stringify(started));
  check('missions: currentMission is the-debt', (Missions3d.currentMission(s) || {}).id === 'the-debt');
  const stage = Missions3d.currentStage(s);
  check('missions: stage 0 is a drive-to', stage && stage.type === 'drive-to', stage ? stage.type : 'none');
  check('missions: nextObjective is a non-empty string', typeof Missions3d.nextObjective(s) === 'string' && Missions3d.nextObjective(s).length > 0);
  const arrived = Missions3d.reportArrival(s, testHooks);
  check('missions: reportArrival advances the stage', arrived && arrived.ok === true && s.missions.stage === 1, JSON.stringify(arrived));
  const moneyBefore = s.player.money;
  const rpBefore = s.rp;
  // Finish every remaining stage of the-debt by reporting the right kind.
  let guard = 0;
  while (Missions3d.currentMission(s) && guard++ < 12) {
    const st = Missions3d.currentStage(s);
    if (!st) break;
    if (st.type === 'drive-to' || st.type === 'pickup' || st.type === 'escort') Missions3d.reportArrival(s, testHooks);
    else if (st.type === 'shoot') Missions3d.reportCombat(s, testHooks);
    else if (st.type === 'deliver') Missions3d.reportDelivery(s, testHooks);
    else if (st.type === 'race') Missions3d.reportRace(s, testHooks, true);
    else break;
  }
  check('missions: the-debt completes and pays out', s.missions.completed.indexOf('the-debt') !== -1 && s.player.money > moneyBefore && s.rp > rpBefore,
    'completed=' + JSON.stringify(s.missions.completed) + ' money=' + s.player.money + ' rp=' + s.rp);
  const hud = Missions3d.missionHud(s);
  check('missions: missionHud reports no active mission after completion', hud && hud.active === false, JSON.stringify(hud));
}

// ---- Part A: police ------------------------------------------------------
function fakeBody() {
  return {
    position: { x: 0, y: 0, z: 0, set: function (x, y, z) { this.x = x; this.y = y; this.z = z; } },
    rotation: { y: 0 },
    userData: {},
    x: 0, z: 0, angle: 0
  };
}
const worldStub = {
  nearestRoadPoint: function (x, z) { return { x: x, z: z }; },
  isSolid: function () { return false; },
  roads: [-1400, -1200, -1000, -800, -600, -400, -200, 0, 200, 400, 600, 800, 1000, 1200, 1400]
};
const vehiclesStub = {
  spawn: function (model, x, z, angle) { const b = fakeBody(); b.position.set(x, 0, z); b.rotation.y = -angle; return b; },
  createTrafficCar: function () { return fakeBody(); },
  createHeli: function () { return fakeBody(); },
  despawn: function () {}
};
{
  const s = freshTestState();
  const sys = createPoliceSystem(worldStub, vehiclesStub);
  check('police: system starts clean', sys.wanted === 0 && sys.units.length === 0, 'wanted=' + sys.wanted);
  sys.setWanted(2, s.player);
  check('police: setWanted(2) sticks', sys.wanted === 2, 'wanted=' + sys.wanted);
  sys.stageChase(2, s.player);
  const rows = sys.dispatchRows(s.player);
  check('police: dispatchRows at 2 stars has units with tactics + distances',
    rows.length >= 2 && rows.every(function (r) { return r.callsign && r.tactic && typeof r.distM === 'number'; }),
    JSON.stringify(rows).slice(0, 200));
  const staged = sys.stageChase(4, s.player);
  check('police: stageChase(4) fields 7+ ground units', staged.units.length >= 7, 'units=' + staged.units.length);
  check('police: stageChase(4) brings the heli (AIR-1)', !!staged.heli && staged.heli.callsign === 'AIR-1', staged.heli ? staged.heli.callsign : 'no heli');
  const staged1 = sys.stageChase(1, s.player);
  check('police: stageChase(1) has no heli', !staged1.heli, staged1.heli ? 'heli present' : 'ok');
  const heatBefore = sys.heat.shots;
  sys.reportGunfire({ hit: true, target: { police: false } }, s.player);
  check('police: gunfire raises heat', sys.heat.shots === heatBefore + 1, 'shots=' + sys.heat.shots);
  sys.setWanted(0, s.player);
  sys.reportGunfire({ hit: true, target: null }, s.player);
  let updateErr = null;
  try {
    sys.update(1.2, s.player, { time: 1.2, missionId: null });
  } catch (e) { updateErr = e; }
  check('police: update runs without throwing', updateErr === null, updateErr && updateErr.message);
  check('police: gunfire at 0 stars promotes pending wanted to 1', sys.wanted === 1, 'wanted=' + sys.wanted + ' pending=' + JSON.stringify(sys.pendingWanted));
  try {
    sys.update(0.5, s.player, { time: 1.7, missionId: null });
  } catch (e) { updateErr = e; }
  check('police: second update runs without throwing', updateErr === null, updateErr && updateErr.message);
}

// ---- Part A: crew --------------------------------------------------------
{
  const s = freshTestState();
  s.wanted = 2;
  s.rp = 100; // Swap Plates costs 25 RP
  const used = Crew3d.useAbility(s, 'tuck', 1000, function () {});
  check('crew: Tuck Swap Plates drops a star at wanted 2', used && used.ok === true && s.wanted === 1, JSON.stringify(used) + ' wanted=' + s.wanted);
  const rows = Crew3d.cooldownDisplay(s, 1000);
  check('crew: cooldownDisplay has 3 rows, Tuck cooling down',
    rows && rows.length === 3 && rows[0].cooldownLeft > 0 && rows[0].ready === false,
    JSON.stringify(rows && rows.map(function (r) { return r.id + ':' + r.cooldownLeft; })));
  const again = Crew3d.useAbility(s, 'tuck', 1000, function () {});
  check('crew: Tuck on cooldown refuses a second use', again && again.ok === false, JSON.stringify(again));
  Crew3d.tickCrew(s, 95, 96000);
  const rows2 = Crew3d.cooldownDisplay(s, 96000);
  check('crew: tickCrew counts the cooldown down', rows2[0].cooldownLeft < rows[0].cooldownLeft, 'before=' + rows[0].cooldownLeft + ' after=' + rows2[0].cooldownLeft);
  const s2 = freshTestState();
  const denied = Crew3d.useAbility(s2, 'tuck', 1000, function () {});
  check('crew: Tuck at wanted 0 is refused', denied && denied.ok === false, JSON.stringify(denied));
}

// ---- Part A: weapons -----------------------------------------------------
{
  check('weapons: 8 weapons in the roster', Weapons3d.WEAPONS.length === 8, 'got ' + Weapons3d.WEAPONS.length);
  check('weapons: SLOT_ORDER has 8 slots', Weapons3d.SLOT_ORDER.length === 8);
  check('weapons: pistol def is the P9', (Weapons3d.weaponDef('pistol') || {}).name === 'P9 Pistol', JSON.stringify(Weapons3d.weaponDef('pistol')));
  const s = freshTestState();
  s.player.aim = 0;
  s.player.angle = 0;
  let shot = null;
  const target = { x: s.player.x + 10, z: s.player.z, health: 100, police: false };
  const w = Weapons3d.createWeapons(s.player, {
    getTargets: function () { return [target]; },
    onShot: function (r) { shot = r; },
    onCrime: function () {},
    onEmpty: function () {},
    flash: function () {},
    shake: function () {}
  });
  const switched = w.switchTo('smg');
  check('weapons: switchTo smg', switched === true || (switched && switched.ok), JSON.stringify(switched));
  s.weapons.owned.push('smg');
  s.player.ammo.smg = 30; s.player.ammo.smg_reserve = 120;
  w.switchTo('smg');
  const fired = w.fire();
  check('weapons: fire at a target dead ahead hits', fired && fired.hit === true, JSON.stringify(fired));
  check('weapons: onShot saw the hit', shot && shot.hit === true, JSON.stringify(shot));
  check('weapons: target took damage', target.health < 100, 'health=' + target.health);
  const magBefore = w.snapshot().mag;
  w.reload();
  check('weapons: reload refills the mag', w.snapshot().mag > magBefore, 'before=' + magBefore + ' after=' + w.snapshot().mag);
  s.player.health = 100; s.player.armour = 50;
  w.takeDamage(20);
  check('weapons: armour absorbs 60% of damage', s.player.health === 92 && s.player.armour < 50,
    'health=' + s.player.health + ' armour=' + s.player.armour);
}

// ---- Part A: progress ----------------------------------------------------
{
  check('progress: rankForRp(0) is Runner', Progress3d.rankForRp(0).id === 'runner', JSON.stringify(Progress3d.rankForRp(0)));
  check('progress: rankForRp(1500) is Fixer', Progress3d.rankForRp(1500).id === 'fixer', JSON.stringify(Progress3d.rankForRp(1500)));
  const bareApi = Progress3d.createProgress({});
  const bare = bareApi.state;
  check('progress: bare createProgress seeds the staged 48% profile',
    bare.rp === 1500 && bare.missions.current === 'old-town-score' && bare.missions.completed.length === 5 && near(bare.completion, 48.1, 0.6),
    'rp=' + bare.rp + ' current=' + bare.missions.current + ' completed=' + bare.missions.completed.length + ' completion=' + bare.completion);
  const clean = freshTestState();
  Progress3d.createProgress(clean);
  check('progress: zeroed fresh state stays a clean new game', clean.rp === 0 && clean.player.money === 0 && clean.career.carsStolen === 0,
    'rp=' + clean.rp + ' money=' + clean.player.money + ' carsStolen=' + clean.career.carsStolen);
  const mem = new Map();
  const storage = {
    getItem: function (k) { return mem.has(k) ? mem.get(k) : null; },
    setItem: function (k, v) { mem.set(k, String(v)); },
    removeItem: function (k) { mem.delete(k); }
  };
  const slots = Progress3d.listSaveSlots(storage);
  check('progress: listSaveSlots returns 3 slots, slot 1 staged at 48%',
    slots.length === 3 && slots[0] && slots[0].completion === 48 && slots[0].empty === false,
    JSON.stringify(slots.map(function (x) { return x && x.completion; })));
  const s = freshTestState();
  s.player.money = 5000; s.rp = 800; s.playMinutes = 65;
  const saved = Progress3d.saveGame(s, 2, storage);
  check('progress: saveGame to slot 3 ok', saved && saved.ok === true, JSON.stringify(saved && saved.reason));
  const loaded = Progress3d.loadGame(2, storage);
  check('progress: loadGame round-trips money + rp', loaded && loaded.ok === true && loaded.state.player.money === 5000 && loaded.state.rp === 800,
    JSON.stringify(loaded && loaded.ok));
  const pct = Progress3d.completionPercent(bare);
  check('progress: staged profile completion is 48.1%', near(pct, 48.1, 0.6), 'pct=' + pct);
}

// ---- Part A: garage + radio + daynight ----------------------------------
{
  check('garage: 5 cars in the roster', Garage3d.GARAGE_CARS.length === 5, 'got ' + Garage3d.GARAGE_CARS.length);
  const s = freshTestState();
  s.player.money = 20000;
  Garage3d.ensureGarage(s);
  const bought = Garage3d.buyCar(s, 'Marina Runabout');
  check('garage: buyCar Marina Runabout with $20,000 ok', bought && bought.ok === true, JSON.stringify(bought));
  check('garage: garageStrip counts the new car', Garage3d.garageStrip(s).carsOwned >= 2, JSON.stringify(Garage3d.garageStrip(s)));
  const r = createRadio();
  check('radio: first station is Onda 98.4', r.station().name === 'Onda 98.4', JSON.stringify(r.station()));
  check('radio: nowPlaying is a non-empty string', typeof r.nowPlaying() === 'string' && r.nowPlaying().length > 5, r.nowPlaying());
  r.nextStation();
  check('radio: nextStation moves to Sol FM', r.station().name === 'Sol FM', JSON.stringify(r.station()));
  const dn = createDayNight({ setTimeOfDay: function () {} }, { world: {}, startHour: 9.5 });
  check('daynight: starts at 09:30 morning', near(dn.hour, 9.5, 0.01) && dn.gradeName === 'Morning', 'hour=' + dn.hour + ' grade=' + dn.gradeName);
  dn.update(60);
  check('daynight: 60 s advances ~3 game hours', near(dn.hour, 12.5, 0.05), 'hour=' + dn.hour);
  dn.setTime(21);
  check('daynight: setTime(21) is night with the moon up', dn.gradeName === 'Night' && dn.moonUp === true, 'grade=' + dn.gradeName + ' moon=' + dn.moonUp);
  check('radio: 3 stations', RADIO.length === 3, 'got ' + RADIO.length);
}

// ---- Part B: classic scripts in a stubbed browser -----------------------
// Absorbing 2d context (same shape as the 2D tests): every method
// returns the proxy, measureText returns a zero width.
function makeCtx(el) {
  const fn = function () { return proxy; };
  const proxy = new Proxy(fn, {
    get(t, prop) {
      if (prop === 'canvas') return el;
      if (prop === 'measureText') return function () { return { width: 0 }; };
      return proxy;
    },
    set() { return true; },
    apply() { return proxy; }
  });
  return proxy;
}
function makeEl(tag) {
  const el = {
    tagName: (tag || 'div').toUpperCase(),
    children: [], style: {}, dataset: {},
    classList: { add: function () {}, remove: function () {}, contains: function () { return false; }, toggle: function () {} },
    _html: '', textContent: '', id: '',
    appendChild: function (c) { this.children.push(c); c.parentNode = this; return c; },
    removeChild: function (c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; },
    addEventListener: function () {}, removeEventListener: function () {},
    setAttribute: function () {}, getAttribute: function () { return null; },
    getContext: function () { return makeCtx(el); },
    getBoundingClientRect: function () { return { left: 0, top: 0, width: 1280, height: 720 }; },
    clientWidth: 1280, clientHeight: 720, offsetWidth: 1280, offsetHeight: 720,
    width: 230, height: 172,
    querySelector: function () { return null; }, querySelectorAll: function () { return []; },
    parentNode: null
  };
  Object.defineProperty(el, 'innerHTML', {
    get: function () { return this._html; },
    set: function (v) { this._html = v; }
  });
  return el;
}
const elements = {};
const store = new Map();
const sandbox = {
  document: {
    createElement: function (tag) { return makeEl(tag); },
    createElementNS: function (ns, tag) { return makeEl(tag); },
    getElementById: function (id) { return elements[id] || null; },
    head: makeEl('head'),
    body: makeEl('body')
  },
  location: { search: '' },
  localStorage: {
    getItem: function (k) { return store.has(k) ? store.get(k) : null; },
    setItem: function (k, v) { store.set(k, String(v)); },
    removeItem: function (k) { store.delete(k); }
  },
  innerWidth: 1280, innerHeight: 720,
  console: console
};
sandbox.window = sandbox;
sandbox.window.innerWidth = 1280;
sandbox.window.innerHeight = 720;
sandbox.addEventListener = function () {};
elements['hud3d'] = makeEl('div');
elements['hud3d'].id = 'hud3d';

const context = vm.createContext(sandbox);
for (const name of ['hud3d.js', 'screens3d.js', 'shots3d.js']) {
  const code = fs.readFileSync(path.join(ROOT, 'game', 'src', name), 'utf8');
  vm.runInContext(code, context, { filename: name });
}
const Hud3d = sandbox.window.PalmaHud3d;
const Screens3d = sandbox.window.PalmaScreens3d;
const Shots3d = sandbox.window.PalmaShots3d;

check('classic: PalmaHud3d / PalmaScreens3d / PalmaShots3d all loaded',
  !!Hud3d && !!Screens3d && !!Shots3d,
  [!!Hud3d, !!Screens3d, !!Shots3d].join(','));

// Bridges: the real 3D modules, so the classic scripts read live data.
sandbox.window.PalmaConfig3d = CFG3D;
sandbox.window.PalmaConfig = { RANKS: Progress3d.RANKS, WEAPONS: Weapons3d.WEAPONS, RADIO: RADIO };
sandbox.window.PalmaMissions3d = Missions3d;
sandbox.window.PalmaCrew3d = Crew3d;
sandbox.window.PalmaProgress3d = Progress3d;
sandbox.window.PalmaGarage3d = Garage3d;
const policeSys = createPoliceSystem(worldStub, vehiclesStub);
sandbox.window.PalmaPolice3d = {
  dispatchRows: function (st) { return policeSys.dispatchRows(st.player); },
  // The shots stager expects the bridge to write the staged police
  // onto state.police (it returns state.police afterwards).
  stageChase: function (st, c, stars) { const staged = policeSys.stageChase(stars, st.player); st.police = staged; st.wanted = stars; return staged; }
};
sandbox.window.PalmaVehicles3d = {
  spawnGull: function (c, opts) {
    const o = opts || {};
    return { kind: 'heli', name: 'Gull', x: o.x !== undefined ? o.x : -1500, z: o.z !== undefined ? o.z : 890, angle: o.angle || 0, altitude: o.altitude || 0, speed: 0, landed: true, occupied: false, body: null };
  },
  condition: function (car) { return typeof car.condition === 'number' ? car.condition : 100; },
  gullAltitude: function (h) { return h.altitude || 0; },
  createTrafficCar: function () { return fakeBody(); },
  createHeli: function () { return fakeBody(); }
};
sandbox.window.PalmaScreens3d.setWaypoint = function () {};

// City fixture built from the real 3D config.
const roads = [];
for (let v = -1400; v <= 1400; v += 200) roads.push(v);
const cityFixture = {
  width: 3750, height: 2800,
  mapX0: CFG3D.OCEAN_X, mapX1: CFG3D.CITY_HALF, mapZ0: -CFG3D.CITY_HALF, mapZ1: CFG3D.CITY_HALF,
  avenues: roads.slice(), streets: roads.slice(),
  districts: CFG3D.DISTRICTS, beachRoadX: CFG3D.BEACH_X - 30,
  landmarks: [
    { kind: 'pier', name: 'Venn Pier', x: -1400, z: CFG3D.PIER_Z, length: CFG3D.PIER_LENGTH },
    { kind: 'wheel', name: 'Palma Wheel', x: CFG3D.BEACH_X - CFG3D.PIER_LENGTH + 90, z: CFG3D.PIER_Z },
    { kind: 'tower', name: 'Torre Brisa', x: 900, z: -900 },
    { kind: 'tower', name: 'Hotel Miramar', x: -1100, z: -900 }
  ],
  spawns: {
    player: { x: -800, z: 600 }, cometa: { x: 0, z: -900 },
    pier: { x: -1450, z: CFG3D.PIER_Z }, wheel: { x: CFG3D.BEACH_X - CFG3D.PIER_LENGTH + 90, z: CFG3D.PIER_Z },
    gull: { x: -1500, z: CFG3D.PIER_Z - 60 }
  },
  buildings: [], props: []
};
function stagedState(overrides) {
  const s = freshTestState();
  s.city = cityFixture;
  return Object.assign(s, overrides || {});
}

// ---- Part B: HUD layout --------------------------------------------------
{
  const zones = Hud3d.layoutZones();
  check('hud: layoutZones has all 10 zones', Object.keys(zones).length >= 10, Object.keys(zones).join(','));
  // zonesOverlap is a pairwise rect test; the layout proves itself
  // by checking every pair.
  let overlapFound = null;
  const zoneNames = Object.keys(zones);
  for (let i = 0; i < zoneNames.length; i++) {
    for (let j = i + 1; j < zoneNames.length; j++) {
      if (Hud3d.zonesOverlap(zones[zoneNames[i]], zones[zoneNames[j]])) overlapFound = zoneNames[i] + ' x ' + zoneNames[j];
    }
  }
  check('hud: zero overlaps between zones', overlapFound === null, overlapFound);
  const s = stagedState();
  Missions3d.startMission(s, 'the-debt', testHooks);
  s.wanted = 4;
  s.player.money = 18200;
  s.rp = 1500; s.rank = 2;
  s.crew = Crew3d.createCrewState();
  const slots = Hud3d.weaponSlots(s);
  check('hud: weapon bar has 8 slots', slots.length === 8, 'got ' + slots.length);
  const info = Hud3d.missionInfo(s);
  check('hud: missionInfo names The Debt + stage number', info && /The Debt/i.test(info.title || '') && typeof info.stage === 'number',
    JSON.stringify(info));
  const host = elements['hud3d'];
  const hud = Hud3d.createHUD(host);
  let threw = null;
  try { hud.update(s, cityFixture); } catch (e) { threw = e; }
  check('hud: update(state, city) runs without throwing', threw === null, threw && threw.message);
  check('hud: update populates the host DOM', host.children.length > 0, 'children=' + host.children.length);
  check('hud: money formats with a comma', Hud3d.moneyStr(18200) === '$18,200', Hud3d.moneyStr(18200));
  check('hud: clock formats 09:30', Hud3d.clockStr(570) === '09:30', Hud3d.clockStr(570));
}

// ---- Part B: screens -----------------------------------------------------
{
  check('screens: catalogue counts 10 missions', Screens3d.CATALOGUE.missions === 10, JSON.stringify(Screens3d.CATALOGUE));
  const s = stagedState();
  s.completion = 48;
  const storage = sandbox.localStorage;
  let threw = null;
  try { Screens3d.showSystems(s, cityFixture, { slots: Progress3d.listSaveSlots(storage) }); } catch (e) { threw = e; }
  check('screens: showSystems runs without throwing', threw === null, threw && threw.message);
  check('screens: systemsVisible after showSystems', Screens3d.systemsVisible() === true);
  Screens3d.hideSystems();
  check('screens: hideSystems hides it again', Screens3d.systemsVisible() === false);
  threw = null;
  try { Screens3d.showTitle(s, cityFixture, { selected: 0 }); } catch (e) { threw = e; }
  check('screens: showTitle runs without throwing', threw === null, threw && threw.message);
  check('screens: titleVisible after showTitle', Screens3d.titleVisible() === true);
  Screens3d.hideTitle();
}

// ---- Part B: shots -------------------------------------------------------
{
  const q = Shots3d.parseQuery('?shot=night&seed=2');
  check('shots: parseQuery reads shot + seed', q.shot === 'night' && q.seed === 2, JSON.stringify(q));
  const chase = Shots3d.applyShot('chase', 1, cityFixture);
  check('shots: chase stages ok at wanted 4', chase.ok === true && chase.wanted === 4, JSON.stringify({ ok: chase.ok, wanted: chase.wanted }));
  check('shots: chase runs Old Town Score', chase.mission === 'old-town-score', String(chase.mission));
  check('shots: chase fields cars + peds', chase.cars >= 1 && chase.peds >= 1, 'cars=' + chase.cars + ' peds=' + chase.peds);
  check('shots: chase camera has pos + lookAt', chase.camera && chase.camera.pos && chase.camera.lookAt, JSON.stringify(chase.camera));
  check('shots: chase footer names the query', /shot=chase&seed=1/.test(chase.footer), chase.footer);
  const night = Shots3d.applyShot('night', 2, cityFixture);
  check('shots: night stages ok at wanted 2', night.ok === true && night.wanted === 2, JSON.stringify({ ok: night.ok, wanted: night.wanted }));
  const nightKinds = (night.extras || []).map(function (e) { return e.kind; });
  check('shots: night extras carry flash + hits + down + neon',
    nightKinds.indexOf('flash') !== -1 && nightKinds.filter(function (k) { return k === 'hit'; }).length === 2 &&
    nightKinds.indexOf('down') !== -1 && nightKinds.filter(function (k) { return k === 'neon'; }).length === 2,
    JSON.stringify(nightKinds));
  const systems = Shots3d.applyShot('systems', 3, cityFixture);
  check('shots: systems stages ok at 48% complete', systems.ok === true && near(systems.completion, 48, 1), 'completion=' + systems.completion);
  const heli = Shots3d.applyShot('heli', 4, cityFixture);
  check('shots: heli stages ok at wanted 2 with the Gull', heli.ok === true && heli.wanted === 2 && (heli.heliUsedGull === true || heli.gullFallback === true),
    JSON.stringify({ ok: heli.ok, wanted: heli.wanted, gull: heli.heliUsedGull, fallback: heli.gullFallback }));
  sandbox.location.search = '?shot=heli&seed=4';
  const viaQuery = Shots3d.renderFromQuery(cityFixture);
  check('shots: renderFromQuery stages the heli shot', viaQuery && viaQuery.ok === true && viaQuery.shot === 'heli', JSON.stringify(viaQuery && viaQuery.shot));
  sandbox.location.search = '';
  check('shots: renderFromQuery with no query returns null', Shots3d.renderFromQuery(cityFixture) === null);
}

console.log('\nself-test-3d: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
