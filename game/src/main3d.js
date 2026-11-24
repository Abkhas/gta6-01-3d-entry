// Palma Verde 3D — integration: renderer, world, camera, systems,
// HUD, screens and shots wired into one running game.
//
// This file is the wiring layer, built on B1's skeleton: the
// renderer, the procedural city (world3d) and the sky (sky3d) below
// are B1's setup, kept as written. The marked integration points
// ([CHASE-CAM], [GAME-LOOP], [DAY-CYCLE], [HUD]) are filled in here:
// the chase camera follows the player, the game loop steps input,
// traffic, police, missions and the HUD, the day/night system drives
// the grades, and hud3d renders the full HUD.
//
// STATE OBJECT (the contract the HUD, screens and shots consume):
//   player: { x, z, angle, aim, aiming, health, armour, money,
//             weapon, ammo: { pistol, pistol_reserve, ... },
//             vehicle: car|heli|null, meleeT, lastFireT }
//   wanted, rp, rank, respect, completion, activitiesDone, racesWon
//   missions: { current, stage, completed: [], lastFailed }
//   crew: { tuck: { cooldown, cooldownTotal }, ines: {...}, kip: {...} }
//   garage: { owned: [], upgrades: [] }
//   properties: { owned: [] }, collectibles: { found: [] }
//   standing: { 'Marina': n, ... }, district: {...}|null
//   clockMinutes, radioStation, radioTrack, weather: { haze }
//   cars: [], peds: [], police: { units: [...], heli: {...}|null }|null
//   gull: heli|null, dialogue: { name, text, color }|null, banner
//   missionTarget: { x, z }|null, waypoint: { x, z, label }|null
//   screen: 'title'|'playing'|'paused'
//   weaponWheel: bool, cam: { x, z }, shotCamera: { pos, lookAt }|null
//   city, time, seed, missionKills, raceDeadline
// Positions are 3D metres: x east, z south, north is -z; a heli's
// height above the ground is vehicle.altitude. Heading is radians,
// forward = (cos heading, 0, sin heading) — the camera contract.

import * as THREE from 'three';
import { CFG3D, districtAt, gradeForHour } from './config3d.js';
import { buildWorld } from './world3d.js';
import { createSky, setTimeOfDay, updateSky } from './sky3d.js';
import { createChaseCamera, CAMERA_PRESETS } from './camera3d.js';
import { createHeroCar, createTrafficCar, createHeli } from './vehicles3d.js';
import { createPerson, pickProfession } from './people3d.js';
import * as Missions3d from './missions3d.js';
import { createPoliceSystem } from './police3d.js';
import * as Crew3d from './crew3d.js';
import * as Weapons3d from './weapons3d.js';
import * as Progress3d from './progress3d.js';
import { createTraffic, CAR_HIT_SPEED, carHitDamage, carHitKnockback } from './traffic3d.js';
import { createDayNight } from './daynight3d.js';
import * as Garage3d from './garage3d.js';
import { createRadio, RADIO } from './radio3d.js';

// ---------------------------------------------------------------------
// Error capture: every error lands in window.__pv3d.errors and in the
// #hud-err line, so the flow test can assert zero console errors.
// ---------------------------------------------------------------------
window.__pv3d = window.__pv3d || { errors: [], booted: false, shot: null, modules: {} };
function reportError(message) {
  window.__pv3d.errors.push(String(message));
  var box = document.getElementById('hud-err');
  if (box) box.textContent = String(message).slice(0, 300);
  // Once the HUD owns the screen the #hud box is hidden; the footer
  // strip is the last visible line an error can reach.
  if (box && box.parentElement && box.parentElement.style.display === 'none' && barEl) {
    barEl.textContent = 'ERROR: ' + String(message).slice(0, 200);
  }
}
window.addEventListener('error', function (e) { reportError(e.message || e.error); });
window.addEventListener('unhandledrejection', function (e) {
  reportError('unhandled rejection: ' + (e.reason && e.reason.message ? e.reason.message : e.reason));
});

const canvas = document.getElementById('world');
const hudLine = document.getElementById('hud-line');
const hudErr = document.getElementById('hud-err');
const barEl = document.getElementById('bar');

function setHudLine(text) {
  if (hudLine) hudLine.textContent = text;
}

// ---- renderer / scene (B1's setup) ------------------------------------
// preserveDrawingBuffer stays on: the flow test samples the canvas
// pixels to prove a shot rendered, and the capture page needs it too.
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
// r9 A1: anisotropy = device max. Written here, before buildWorld
// runs, so world3d.js / trafficlights3d.js can read the shared value
// as CFG3D.PERF.maxAnisotropy instead of hardcoding 4 (their texture
// sites are NOT this file's — coordinator to wire them to the constant).
CFG3D.PERF.maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
// r9 A2: live-play DPR floor is 1.25, never 1 (DPR 1 at 1280x720 is
// visibly pixelated); the r8 governor ladder in CFG3D.PERF matches.
renderer.setPixelRatio(Math.min(Math.max(window.devicePixelRatio || 1, CFG3D.PERF.DPR_MIN), 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// r8 B6 follow-up: the shadow map re-renders the whole city every
// frame; update it every other frame instead (autoUpdate off, the
// tick sets needsUpdate on alternate frames). Shot mode sets
// needsUpdate once before its single render, so shots keep shadows.
renderer.shadowMap.autoUpdate = false;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.5, 14000);

// ---- r9 C1: scene.environment via PMREM, zero downloads ----------------
// NOTE: the vendored three.js has NO RoomEnvironment addon and the
// import map has no `three/addons` entry, so importing
// 'three/addons/environments/RoomEnvironment.js' cannot work. Instead
// this builds the same thing in code: a small procedural "room" scene
// (grey shell + bright emissive panels for ceiling light, warm windows
// and cool sky) and bakes it through THREE.PMREMGenerator, which IS in
// the vendored core. Without an environment map every
// MeshStandardMaterial is pure diffuse — no specular at all — which is
// why paint/glass read as matte plastic. Per-material intensity is NOT
// scene.environmentIntensity (does not exist in r160): sky3d.js sets
// envMapIntensity per material (paint/glass 1.0, buildings/ground 0.3,
// dimmed at night) — see CFG3D.PERF.ENV_INTENSITY_*.
function buildEnvironmentMap() {
  const envScene = new THREE.Scene();
  const shell = new THREE.Mesh(
    new THREE.BoxGeometry(40, 20, 40),
    new THREE.MeshBasicMaterial({ side: THREE.BackSide }),
  );
  shell.material.color.setRGB(0.32, 0.35, 0.40);
  envScene.add(shell);
  function panel(w, h, x, y, z, rx, ry, r, g, b) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial(),
    );
    // Colour components above 1: the panels are light sources, not paint.
    m.material.color.setRGB(r, g, b);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, 0);
    envScene.add(m);
  }
  panel(16, 8, 0, 9.9, 0, Math.PI / 2, 0, 5.0, 5.0, 4.6);   // ceiling light
  panel(10, 5, -19.9, 4, 0, 0, Math.PI / 2, 3.2, 2.5, 1.6);  // warm west window
  panel(10, 5, 19.9, 4, 0, 0, -Math.PI / 2, 3.2, 2.5, 1.6);  // warm east window
  panel(14, 6, 0, 5, -19.9, 0, 0, 1.1, 1.5, 2.6);            // cool north sky
  panel(14, 6, 0, 5, 19.9, 0, Math.PI, 1.4, 1.2, 1.0);        // warm south sky
  panel(20, 12, 0, -9.9, 0, -Math.PI / 2, 0, 0.45, 0.40, 0.36); // floor bounce
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(envScene, 0.04).texture;
  pmrem.dispose();
  return tex;
}
try {
  scene.environment = buildEnvironmentMap();
} catch (e) {
  // The env map is a lighting upgrade, never a boot blocker: without
  // it the game renders exactly as r8 did (sun + hemisphere only).
  reportError('env map failed, continuing without it: ' + (e && e.message ? e.message : e));
}

const world = buildWorld(scene, CFG3D);
const sky = createSky(scene);

// The game opens mid-morning; the day/night system advances this.
let clockHours = CFG3D.DAY_START_HOUR;
let currentGrade = setTimeOfDay(scene, gradeForHour(clockHours), world);
// r9 A6: exposure is driven from the grade (golden hour 1.15, noon
// 1.05, deep night 0.90). setTimeOfDay re-applies it on every grade
// change once window.__palma3d exists; this line covers the first
// call, which runs before __palma3d is assigned below.
renderer.toneMappingExposure = currentGrade.exposure ?? 1.05;

function fitCanvas() {
  const w = window.innerWidth;
  const h = Math.max(200, window.innerHeight - 34); // 34px footer bar
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}
fitCanvas();
window.addEventListener('resize', fitCanvas);

// ---------------------------------------------------------------------
// City adapter: the plain-data city the HUD, screens and shots read.
// Avenues are north-south road x positions, streets are east-west
// road z positions, districts carry x0/z0/x1/z1. The grid runs on a
// 200 m block pitch from -1400 to +1400; the beach road runs
// north-south at x = -1430, just west of the grid on the sand edge.
// ---------------------------------------------------------------------
function buildCityAdapter() {
  const roads = world.roads || [];
  return {
    width: 3750, height: 2800,
    mapX0: CFG3D.OCEAN_X, mapX1: CFG3D.CITY_HALF,
    mapZ0: -CFG3D.CITY_HALF, mapZ1: CFG3D.CITY_HALF,
    avenues: roads.slice(), streets: roads.slice(),
    districts: CFG3D.DISTRICTS,
    beachRoadX: CFG3D.BEACH_X - 30,
    landmarks: [
      { kind: 'pier', name: 'Venn Pier', x: -1400, z: CFG3D.PIER_Z, length: CFG3D.PIER_LENGTH },
      { kind: 'wheel', name: 'Palma Wheel', x: CFG3D.BEACH_X - CFG3D.PIER_LENGTH + 90, z: CFG3D.PIER_Z },
      { kind: 'tower', name: 'Torre Brisa', x: 900, z: -900 },
      { kind: 'tower', name: 'Hotel Miramar', x: -1100, z: -900 },
      { kind: 'police', name: 'PVPD Headquarters', x: 700, z: -1100 }
    ],
    // r10 B6: the BUSTED respawn target (world.policeHQ).
    policeHQ: world.policeHQ || null,
    // r10: the player opens on a sidewalk in Marina — the safehouse
    // district ("Safehouse lane" in the missions) — not in traffic.
    // South sidewalk of the z=-600 street, mid-block (100 m from the
    // nearest junction), facing the 31 m Marina residential block
    // across the street (its face is 20.5 m ahead). Verified against
    // the real world build: on the 9 m sidewalk strip, outside every
    // collider, no lamp/palm/light within 6 m. There is no physical
    // safehouse/save building in the world (saves are menu slots, F9),
    // so the spawn is the safehouse district's residential frontage.
    // The old (-800, 600) sat dead-centre of a downtown intersection
    // (0 m from both road centrelines). Angle faces +z (the building).
    spawns: {
      player: { x: -900, z: -591, angle: Math.PI / 2 },
      cometa: { x: 0, z: -900 },
      pier: { x: -1450, z: CFG3D.PIER_Z },
      wheel: { x: CFG3D.BEACH_X - CFG3D.PIER_LENGTH + 90, z: CFG3D.PIER_Z },
      gull: { x: -1500, z: CFG3D.PIER_Z - 60 }
    },
    buildings: (world.buildings || []).map(function (b) {
      return { x0: b.x - b.w / 2, z0: b.z - b.d / 2, x1: b.x + b.w / 2, z1: b.z + b.d / 2, h: b.h, district: b.district ? b.district.id : '' };
    }),
    props: []
  };
}
const city = buildCityAdapter();

// ---------------------------------------------------------------------
// Vehicles adapter: the factory traffic + police build bodies with.
// spawn() hands back a THREE group (never added to the scene here —
// the sync step below adds bodies once); despawn() removes one.
// ---------------------------------------------------------------------
const vehiclesAdapter = {
  spawn: function (model, x, z, angle) {
    const g = model === 'heli' ? createHeli() : createTrafficCar();
    g.position.set(x, 0, z);
    g.rotation.y = -angle;
    return g;
  },
  createTrafficCar: createTrafficCar,
  createHeli: createHeli,
  despawn: function (body) {
    if (body && body.parent) body.parent.remove(body);
  }
};

// ---------------------------------------------------------------------
// Game state. Fresh values are pre-seeded BEFORE createProgress runs.
// createProgress (B3 2bc911b) no longer seeds the staged career into
// zeroed states: a fresh state stays a clean new game (0% / Runner /
// 0 career). The staged 48% profile lives only in the seeded save
// slots and in a bare createProgress({}).
// ---------------------------------------------------------------------
function freshState() {
  const spawn = city.spawns.player;
  const state = {
    player: {
      x: spawn.x, z: spawn.z, angle: spawn.angle || 0, aim: 0, aiming: false,
      y: 0, vy: 0, // r10 jump: height above the ground, 0 = on the ground
      health: 100, armour: 0, money: 0, weapon: 'pistol', vehicle: null,
      ammo: { pistol: 12, pistol_reserve: 60 },
      meleeT: 0, lastFireT: -99
    },
    wanted: 0,
    rp: 0, rank: 0, respect: 10,
    missions: Missions3d.createMissionState(),
    crew: Crew3d.createCrewState(),
    garage: { owned: ['Cometa GT'], upgrades: {} },
    properties: { owned: [] },
    collectibles: { found: [] },
    completion: 0,
    activitiesDone: 0,
    racesWon: 0,
    playMinutes: 0,
    weapons: { owned: ['fists', 'pistol'] },
    standing: {
      Marina: 0, 'Old Town': 0, 'Citrus Lane': 0, Boardwalk: 0,
      'The Docks': 0, 'Palm Heights': 0, Northgate: 0
    },
    career: { carsStolen: 0, copsEscaped: 0, distanceDrivenKm: 0, longestJumpM: 0, crewAbilitiesUsed: 0, highestWanted: 0 },
    clockMinutes: CFG3D.DAY_START_HOUR * 60,
    weather: { haze: 0.12 },
    cars: [], peds: [],
    radioStation: 0, radioTrack: '',
    screen: 'title',
    weaponWheel: false,
    cam: { x: spawn.x, z: spawn.z },
    shotCamera: null,
    district: null,
    missionTarget: null,
    waypoint: null,
    dialogue: null, banner: null,
    police: null,
    gull: null,
    mouseWorld: null,
    lastCrime: null,
    time: 0,
    seed: 20261124,
    missionKills: 0,
    raceDeadline: 0,
    titleSlot: 0,
    city: city
  };
  return state;
}

const state = freshState();
Garage3d.ensureGarage(state);
const progress = Progress3d.createProgress(state);

// ---------------------------------------------------------------------
// Systems. Traffic owns state.cars / state.peds (same references);
// police owns state.police; weapons owns the combat input hooks.
// ---------------------------------------------------------------------
const traffic = createTraffic(world, vehiclesAdapter);
const police = createPoliceSystem(world, vehiclesAdapter);
state.police = police;
state.cars = traffic.cars;
state.peds = traffic.peds;

const radio = createRadio();
const daynight = createDayNight(
  { setTimeOfDay: function (gradeName) { setTimeOfDay(scene, gradeName, world); } },
  { world: world, startHour: CFG3D.DAY_START_HOUR }
);
daynight.setTime(CFG3D.DAY_START_HOUR);

// r11-B4: bullet tracer renderer (thin yellow segmented line per shot).
const tracerFx = Weapons3d.createTracerRenderer(THREE, scene);

const weapons = Weapons3d.createWeapons(state.player, {
  getTargets: function () {
    const targets = [];
    for (const ped of state.peds) targets.push(ped);
    for (const u of (police.units || [])) {
      if (u.ped) targets.push(u.ped);
      else if (u.body) targets.push({ x: u.x, z: u.z, damage: 0, police: true, car: u.body });
    }
    if (police.heli) targets.push({ x: police.heli.x, z: police.heli.z, damage: 0, police: true });
    return targets;
  },
  onShot: function (result) {
    police.reportGunfire(result, state.player);
    traffic.reportGunfire(state.player.x, state.player.z);
    if (result && result.hit && result.target) {
      if (state.missions.current) {
        const stage = Missions3d.currentStage(state);
        if (stage && stage.type === 'shoot') state.missionKills++;
      }
    }
    flashMuzzle();
  },
  onCrime: function (kind) { police.reportCrime(kind, state.player); },
  onEmpty: function () { setHudLine('CLICK — MAGAZINE EMPTY, PRESS R TO RELOAD'); },
  flash: function (mx, mz) { flashMuzzleAt(mx, mz); },
  tracer: function (tr) { tracerFx.show(tr); }, // r11-B4: bullet tracer
  shake: function () { /* camera shake is the chase camera's lag; no-op */ }
});

// ---------------------------------------------------------------------
// Bridges: the classic-script HUD/screens/shots read these globals.
// The police bridge adapts B3's (stars, player) / (player) signatures
// to the (state, city, stars) / (state) shapes the HUD and shots use.
// ---------------------------------------------------------------------
window.PalmaConfig3d = CFG3D;
window.PalmaMissions3d = Missions3d;
window.PalmaCrew3d = Crew3d;
window.PalmaProgress3d = Progress3d;
window.PalmaGarage3d = Garage3d;
window.PalmaPolice3d = {
  dispatchRows: function (s) { return police.dispatchRows(s.player); },
  // The shots stager expects the bridge to WRITE the staged police
  // onto state.police (it returns state.police afterwards); the
  // police sys object IS the live state.police, so this is the same
  // reference either way.
  stageChase: function (s, c, stars) {
    const staged = police.stageChase(stars, s.player);
    s.police = staged;
    s.wanted = stars;
    return staged;
  },
  desiredComposition: null
};
window.PalmaVehicles3d = {
  spawnGull: function (c, opts) { return spawnGullRecord(opts); },
  condition: function (car) {
    if (typeof car.condition === 'number') return car.condition;
    if (typeof car.damage === 'number') return Math.max(0, 100 - car.damage);
    return 100;
  },
  gullAltitude: function (heli) { return heli.altitude || 0; },
  createTrafficCar: createTrafficCar,
  createHeli: createHeli
};
window.PalmaTraffic3d = traffic;
window.PalmaWorld3d = { city: city, world: world };

// ---------------------------------------------------------------------
// Hero car + the Gull. The Cometa GT waits in Old Town; the Gull
// sits on the pier pad until Rey boards her.
// ---------------------------------------------------------------------
function makeHeroCarRecord() {
  const spot = city.spawns.cometa;
  const body = createHeroCar();
  scene.add(body);
  body.position.set(spot.x, 0, spot.z);
  body.rotation.y = -(-Math.PI / 2);
  return {
    kind: 'car', model: 'Cometa GT', modelId: 'cometa', color: '#ff4f3d',
    x: spot.x, z: spot.z, angle: -Math.PI / 2, speed: 0,
    damage: 0, condition: 100, traffic: false, hero: true, body: body
  };
}
const heroCar = makeHeroCarRecord();

function spawnGullRecord(opts) {
  const o = opts || {};
  const spot = city.spawns.gull;
  const gull = {
    kind: 'heli', name: 'Gull',
    x: (o.x !== undefined ? o.x : spot.x),
    z: (o.z !== undefined ? o.z : spot.z),
    angle: (o.angle !== undefined ? o.angle : -Math.PI / 2),
    altitude: 0, speed: 0, landed: true, occupied: false,
    body: createHeli()
  };
  scene.add(gull.body);
  gull.body.position.set(gull.x, 0, gull.z);
  gull.body.rotation.y = -gull.angle;
  return gull;
}
const gull = spawnGullRecord();
state.gull = gull;

// ---------------------------------------------------------------------
// Meshes: the player figure, traffic pedestrians, police officers.
// Traffic/police car bodies are created by their systems; this step
// only adds a body to the scene the first time it appears, and keeps
// every pedestrian figure matched to its logic record.
// ---------------------------------------------------------------------
const playerMesh = createPerson({});
scene.add(playerMesh);
const pedMeshes = new Map(); // ped record -> THREE group
const policePedMeshes = new Map(); // unit -> THREE group

// Ped hair colours (shirt/skin already vary in traffic3d).
const PED_HAIRS = ['#2c2c34', '#4a2f1d', '#111111', '#6b6b6b', '#8a6a3b', '#3a2a1a'];

function personMeshFor(ped, opts) {
  let mesh = pedMeshes.get(ped);
  if (!mesh) {
    // r10 B6: a ped's profession is drawn once, when the figure is
    // built, and sticks to the record — mostly locals, sometimes a
    // uniformed officer or a doctor in a white coat.
    if (!ped.profession) ped.profession = pickProfession();
    mesh = createPerson(opts || {
      jacket: ped.shirt, skin: ped.color,
      profession: ped.profession,
      // Peds read as different people, not clones: heights 1.68–1.90 m
      // and a spread of hair colours.
      height: 1.68 + Math.random() * 0.22,
      hair: PED_HAIRS[Math.floor(Math.random() * PED_HAIRS.length)]
    });
    scene.add(mesh);
    pedMeshes.set(ped, mesh);
  }
  return mesh;
}

function syncPersonMesh(mesh, ped, dt) {
  mesh.position.set(ped.x, 0, ped.z);
  mesh.rotation.y = -ped.angle;
  let pose = 'idle';
  if (ped.down || ped.health <= 0) pose = 'down';
  else if (ped.aiming) pose = 'aim';
  else if (ped.fleeing || ped.mode === 'flee' || ped.fleeT > 0) pose = 'flee';
  else if (ped.duckT > 0) pose = 'duck';
  else if (Math.abs(ped.speed) > 0.15) pose = ped.speed > 3 ? 'run' : 'walk';
  if (mesh.userData.update) mesh.userData.update(dt, ped.speed || 0, pose);
}

function syncCarBodies() {
  const addBody = function (body) {
    if (body && !body.parent) scene.add(body);
  };
  for (const car of traffic.cars) addBody(car.body);
  for (const u of police.units) addBody(u.body);
  if (police.heli) addBody(police.heli.body);
}

function syncPedMeshes(dt) {
  // Reads the ACTIVE state (S), not the live one: in shot mode the
  // staged state's peds and police units are the ones on screen.
  const seen = new Set();
  for (const ped of S.peds) {
    seen.add(ped);
    syncPersonMesh(personMeshFor(ped), ped, dt);
  }
  for (const [ped, mesh] of pedMeshes) {
    if (!seen.has(ped)) {
      scene.remove(mesh);
      pedMeshes.delete(ped);
    }
  }
  // Police foot officers get their own uniformed figures.
  const seenUnits = new Set();
  const units = (S.police && S.police.units) || [];
  for (const u of units) {
    if (!u.ped) continue;
    seenUnits.add(u);
    let mesh = policePedMeshes.get(u);
    if (!mesh) {
      // r10 B6: officers on the street carry their pistol in hand,
      // so the standoff reads — pointed pistols, not empty hands.
      mesh = createPerson({ officer: true, armed: true, weapon: 'pistol' });
      scene.add(mesh);
      policePedMeshes.set(u, mesh);
    }
    syncPersonMesh(mesh, u.ped, dt);
    // The unit's x/z track its officer.
    u.x = u.ped.x;
    u.z = u.ped.z;
  }
  for (const [u, mesh] of policePedMeshes) {
    if (!seenUnits.has(u)) {
      scene.remove(mesh);
      policePedMeshes.delete(u);
    }
  }
}

// Muzzle flash: a small additive disc at the muzzle, gone in 60 ms.
const flashMat = new THREE.MeshBasicMaterial({
  color: 0xffdc78, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
  depthWrite: false, side: THREE.DoubleSide
});
const flashMesh = new THREE.Mesh(new THREE.CircleGeometry(0.9, 12), flashMat);
flashMesh.visible = false;
scene.add(flashMesh);
let flashUntil = 0;
function flashMuzzleAt(mx, mz) {
  flashMesh.position.set(mx, 1.3, mz);
  flashMesh.visible = true;
  flashMat.opacity = 0.95;
  flashUntil = state.time + 0.06;
}
function flashMuzzle() {
  const p = state.player;
  flashMuzzleAt(p.x + Math.cos(p.aim) * 1.3, p.z + Math.sin(p.aim) * 1.3);
}

// ---------------------------------------------------------------------
// PalmaConfig shim: the classic HUD/screens read window.PalmaConfig
// for ranks, weapons and radio when it exists. The 2D config.js is
// gone from this branch, so the shim is built fresh from the 3D
// modules — same tables the game itself uses, no 2D file re-added.
// ---------------------------------------------------------------------
window.PalmaConfig = {
  RANKS: Progress3d.RANKS,
  WEAPONS: Weapons3d.WEAPONS,
  RADIO: RADIO
};

// ---------------------------------------------------------------------
// HUD, screens, banner, shot extras. The HUD host #hud3d is a
// full-window layer created by index.html; hud3d scales its strict
// 1280x720 stage to fit. The banner is a centred mission-passed /
// busted card; #shot-extras holds the projected shot chips
// (muzzle flash, hit markers, neon signs, heli tag) in shot mode.
// ---------------------------------------------------------------------
const hud = (window.PalmaHud3d && window.PalmaHud3d.createHUD)
  ? window.PalmaHud3d.createHUD(document.getElementById('hud3d'))
  : null;
if (hud) window.__pv3d.modules.hud = true;
// The 34px footer bar sits below the canvas: shrink the HUD host to
// the canvas height so the 1280x720 stage scales to fit above the
// bar instead of drawing the weapon bar and speedo underneath it.
const hudHost = document.getElementById('hud3d');
if (hudHost) hudHost.style.height = 'calc(100vh - 34px)';

const bannerEl = document.createElement('div');
bannerEl.id = 'pv3d-banner';
bannerEl.style.cssText = 'position:fixed;left:50%;top:26%;transform:translateX(-50%);z-index:30;display:none;text-align:center;pointer-events:none;font-family:system-ui,sans-serif;color:#f2f6f8;text-shadow:0 2px 8px rgba(0,0,0,.8)';
document.body.appendChild(bannerEl);

// WASTED overlay (r8, B4 — owned by main3d.js, NOT screens3d.js).
// Greyscale is applied to the canvas itself; this layer carries the
// vignette, the WASTED card and the fade-to-black. pointer-events none
// so it can never trap input.
const wastedEl = document.createElement('div');
wastedEl.id = 'pv3d-wasted';
wastedEl.style.cssText = 'position:fixed;inset:0;z-index:50;display:none;pointer-events:none;text-align:center;font-family:system-ui,sans-serif';
wastedEl.innerHTML =
  '<div style="position:absolute;inset:0;background:radial-gradient(ellipse at center, rgba(0,0,0,0) 40%, rgba(0,0,0,.55) 100%)"></div>' +
  '<div style="position:absolute;left:0;right:0;top:36%;font-size:96px;font-weight:900;letter-spacing:.14em;color:#e8e8e8;text-shadow:0 4px 24px rgba(0,0,0,.9)">WASTED</div>' +
  '<div id="pv3d-wasted-sub" style="position:absolute;left:0;right:0;top:56%;font-size:16px;letter-spacing:.25em;color:#ffb3ab;text-shadow:0 2px 8px rgba(0,0,0,.9)"></div>';
document.body.appendChild(wastedEl);
const wastedFadeEl = document.createElement('div');
wastedFadeEl.id = 'pv3d-wasted-fade';
wastedFadeEl.style.cssText = 'position:fixed;inset:0;z-index:51;display:none;pointer-events:none;background:#000;opacity:0;transition:opacity .6s ease';
document.body.appendChild(wastedFadeEl);

// BUSTED overlay (r10, B6 — owned by main3d.js, like WASTED). Same
// beat as WASTED but a different ending: the card holds ~3 s, fades,
// and Rey respawns on foot in front of the PVPD HEADQUARTERS
// (world.policeHQ), NOT the hospital. No greyscale: an arrest is
// not a death.
const bustedEl = document.createElement('div');
bustedEl.id = 'pv3d-busted';
bustedEl.style.cssText = 'position:fixed;inset:0;z-index:50;display:none;pointer-events:none;text-align:center;font-family:system-ui,sans-serif';
bustedEl.innerHTML =
  '<div style="position:absolute;inset:0;background:radial-gradient(ellipse at center, rgba(0,0,0,0) 40%, rgba(0,0,0,.55) 100%)"></div>' +
  '<div style="position:absolute;left:0;right:0;top:36%;font-size:96px;font-weight:900;letter-spacing:.14em;color:#e8e8e8;text-shadow:0 4px 24px rgba(0,0,0,.9)">BUSTED</div>' +
  '<div id="pv3d-busted-sub" style="position:absolute;left:0;right:0;top:56%;font-size:16px;letter-spacing:.25em;color:#9ab8ff;text-shadow:0 2px 8px rgba(0,0,0,.9)"></div>';
document.body.appendChild(bustedEl);

const extrasEl = document.createElement('div');
extrasEl.id = 'shot-extras';
extrasEl.style.cssText = 'position:fixed;inset:0;z-index:25;pointer-events:none;overflow:hidden';
document.body.appendChild(extrasEl);

// Aim overlay (r10 — owned by main3d.js, NOT hud3d.js: the minimap
// functions inside hud3d.js are untouched).
// Crosshair: four white arms + a centre dot around a gap, each arm
// carrying a dark outline so it reads against bright sky AND dark
// ground. It sits exactly at the mouse position, only while aiming.
// Ped health bar: one reused element, shown above the head of the
// single ped the aim ray hits — never a bar over every ped.
const crosshairEl = document.createElement('div');
crosshairEl.id = 'pv3d-crosshair';
crosshairEl.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;z-index:45;display:none;pointer-events:none;transform:translate(-50%,-50%)';
crosshairEl.innerHTML =
  '<div style="position:absolute;left:-1px;top:-11px;width:2px;height:8px;background:#fff;box-shadow:0 0 0 1px rgba(0,0,0,.85)"></div>' +
  '<div style="position:absolute;left:-1px;top:3px;width:2px;height:8px;background:#fff;box-shadow:0 0 0 1px rgba(0,0,0,.85)"></div>' +
  '<div style="position:absolute;left:-11px;top:-1px;width:8px;height:2px;background:#fff;box-shadow:0 0 0 1px rgba(0,0,0,.85)"></div>' +
  '<div style="position:absolute;left:3px;top:-1px;width:8px;height:2px;background:#fff;box-shadow:0 0 0 1px rgba(0,0,0,.85)"></div>' +
  '<div style="position:absolute;left:-1.5px;top:-1.5px;width:3px;height:3px;border-radius:50%;background:#fff;box-shadow:0 0 0 1px rgba(0,0,0,.85)"></div>';
document.body.appendChild(crosshairEl);
const pedHealthEl = document.createElement('div');
pedHealthEl.id = 'pv3d-ped-health';
pedHealthEl.style.cssText = 'position:fixed;left:0;top:0;width:46px;height:6px;z-index:45;display:none;pointer-events:none;transform:translate(-50%,-50%);background:rgba(0,0,0,.65);border:1px solid rgba(0,0,0,.85);border-radius:3px;overflow:hidden';
const pedHealthFillEl = document.createElement('div');
pedHealthFillEl.style.cssText = 'height:100%;width:100%;background:#37d67a';
pedHealthEl.appendChild(pedHealthFillEl);
document.body.appendChild(pedHealthEl);

const statusEl = document.createElement('div');
statusEl.id = 'test-status';
statusEl.style.cssText = 'position:fixed;left:0;bottom:0;z-index:40;font:10px monospace;color:transparent;pointer-events:none';
document.body.appendChild(statusEl);

let S = state; // active state: the live game, or the staged shot state
let dialogueUntil = 0;
let bannerUntil = 0;
let hudMsgUntil = 0;

const SPEAKER_COLORS = { 'Nadia Venn': '#c94f3d', 'Ines Duarte': '#3d7ea6', 'Tuck Ibarra': '#e8c53a' };
function setDialogue(who, line) {
  if (!line) return;
  S.dialogue = { name: who || 'Nadia Venn', text: line, color: SPEAKER_COLORS[who] || '#e8e8e8' };
  dialogueUntil = S.time + 6;
}
function clearDialogue() { S.dialogue = null; }

function showBanner(payload) {
  if (!payload) return;
  const kind = (payload.kind || payload.title || '').toUpperCase();
  const title = payload.title || payload.kind || '';
  const name = payload.name || payload.subtitle || '';
  const extra = payload.payout ? ('+$' + payload.payout) : (payload.rp ? ('+' + payload.rp + ' RP') : (payload.reason || ''));
  bannerEl.innerHTML =
    '<div style="font-size:15px;letter-spacing:.35em;color:#ffd34d;font-weight:800">' + escapeHtml(kind) + '</div>' +
    '<div style="font-size:34px;font-weight:800;margin:6px 0 2px">' + escapeHtml(title) + '</div>' +
    (name ? '<div style="font-size:16px;opacity:.9">' + escapeHtml(name) + '</div>' : '') +
    (extra ? '<div style="font-size:16px;color:#8fe08f;margin-top:4px">' + escapeHtml(String(extra)) + '</div>' : '');
  bannerEl.style.display = 'block';
  S.banner = payload;
  bannerUntil = S.time + 3.5;
}
function hideBanner() { bannerEl.style.display = 'none'; S.banner = null; }
function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function setHudMsg(text, seconds) {
  setHudLine(text);
  hudMsgUntil = S.time + (seconds || 2.5);
}

// ---------------------------------------------------------------------
// Mission hooks + targets. stage targets are the district centre plus
// a per-stage offset, snapped to the nearest road so the minimap
// route and the waypoint marker sit on a real street.
// ---------------------------------------------------------------------
const STAGE_OFFSETS = [[0, 0], [320, -180], [-300, 240], [180, 300]];
function pointAtStage() {
  const stage = Missions3d.currentStage(S);
  if (!stage) { refreshFreeMarker(); return; }
  const idx = Math.min(Math.max(S.missions.stage || 0, 0), STAGE_OFFSETS.length - 1);
  const off = STAGE_OFFSETS[idx];
  const rect = CFG3D.DISTRICTS.find(function (d) { return d.name === stage.district; });
  const cx = rect ? (rect.x0 + rect.x1) / 2 : S.player.x;
  const cz = rect ? (rect.z0 + rect.z1) / 2 : S.player.z;
  const pt = world.nearestRoadPoint(cx + off[0], cz + off[1]);
  S.missionTarget = { x: pt.x, z: pt.z };
  S.waypoint = { x: pt.x, z: pt.z, label: stage.place || stage.district || '' };
}
function nextFreeMission() {
  const done = S.missions.completed || [];
  const list = Missions3d.missionList();
  for (const m of list) {
    if (done.indexOf(m.id) === -1 && Missions3d.isMissionUnlocked(S, m.id)) return m;
  }
  return null;
}
function refreshFreeMarker() {
  if (S.missions.current) return;
  const next = nextFreeMission();
  if (!next) { S.missionTarget = null; S.waypoint = null; return; }
  const first = next.stages && next.stages[0];
  if (!first) { S.missionTarget = null; S.waypoint = null; return; }
  const rect = CFG3D.DISTRICTS.find(function (d) { return d.name === first.district; });
  const cx = rect ? (rect.x0 + rect.x1) / 2 : S.player.x;
  const cz = rect ? (rect.z0 + rect.z1) / 2 : S.player.z;
  const pt = world.nearestRoadPoint(cx, cz);
  S.missionTarget = { x: pt.x, z: pt.z };
  S.waypoint = { x: pt.x, z: pt.z, label: first.place || first.district || next.title };
}

const missionHooks = {
  onEvent: function (st, kind, payload) {
    if (kind === 'dialogue' && payload) setDialogue(payload.who, payload.line);
    else if (kind === 'banner' && payload) {
      showBanner(payload);
      if (String(payload.kind || '').toUpperCase().indexOf('PASSED') !== -1) {
        Progress3d.refreshCompletion(S);
        refreshFreeMarker();
      }
    } else if (kind === 'mission-start' || kind === 'stage-start' || kind === 'stage-done') {
      const stage = Missions3d.currentStage(S);
      if (stage && stage.type === 'race') S.raceDeadline = S.time + 120;
      if (stage && stage.type === 'shoot') S.missionKills = 0;
      pointAtStage();
    }
  },
  // The reporters ask the hooks to CONFIRM the condition — a no-op
  // hook means 'not-there-yet' / 'foes-remain' forever. Each one
  // answers from the same distance/kill check the tick uses.
  atTarget: function () { return nearTarget(14); },
  foesDown: function () { return S.missionKills >= 3; },
  raceWon: function () { return nearTarget(14); },
  parcelHanded: function () { return nearTarget(12); },
  // B3 calls hooks.setWanted(state, level) — two arguments.
  setWanted: function (st, level) { police.setWanted(typeof level === 'number' ? level : st, S.player); }
};

// ---------------------------------------------------------------------
// Save / load. Progress3d.saveGame stringifies the whole state, and
// the live state holds THREE bodies (circular), so F9 saves a
// sanitised copy: plain vehicle ids, no bodies, no police/traffic
// systems. Loading copies whitelisted fields back onto the live
// state; vehicles and bodies are re-created by the sync step.
// ---------------------------------------------------------------------
function sanitisedSaveState() {
  const plainVehicle = function (v) {
    if (!v) return null;
    return { kind: v.kind || 'car', model: (v.model && v.model.id) || v.model || v.name || 'cometa', x: v.x, z: v.z, angle: v.angle, damage: v.damage || 0, condition: v.condition };
  };
  const plain = Object.assign({}, S, {
    player: Object.assign({}, S.player, { vehicle: plainVehicle(S.player.vehicle) }),
    cars: (S.cars || []).map(plainVehicle),
    peds: (S.peds || []).map(function (p) { return { x: p.x, z: p.z, angle: p.angle, health: p.health, mode: p.mode }; }),
    police: null,
    gull: plainVehicle(S.gull),
    city: undefined,
    missionTarget: S.missionTarget,
    waypoint: S.waypoint
  });
  delete plain.city;
  return plain;
}
function saveToSlot(slotIndex) {
  try {
    const res = Progress3d.saveGame(sanitisedSaveState(), slotIndex);
    if (res && res.ok) showBanner({ kind: 'GAME SAVED', title: 'GAME SAVED', name: 'Slot ' + (slotIndex + 1) });
    else setHudMsg('SAVE FAILED — ' + (res && res.reason ? res.reason : 'unknown'));
    return res;
  } catch (e) {
    reportError('save failed: ' + (e && e.message ? e.message : e));
    setHudMsg('SAVE FAILED');
    return { ok: false, reason: 'exception' };
  }
}
function applyLoadedSave(saved) {
  if (!saved) return false;
  const p = saved.player || {};
  S.player.x = (typeof p.x === 'number' ? p.x : S.player.x);
  S.player.z = (typeof p.z === 'number' ? p.z : S.player.z);
  S.player.health = p.health || 100;
  S.player.armour = p.armour || 0;
  S.player.money = p.money || 0;
  S.player.vehicle = null;
  S.player.y = 0; S.player.vy = 0; // a loaded save always starts on foot, on the ground
  if (typeof saved.rp === 'number') S.rp = saved.rp;
  if (typeof saved.rank === 'number') S.rank = saved.rank;
  if (saved.missions) S.missions = saved.missions;
  if (saved.crew) S.crew = saved.crew;
  if (saved.garage) S.garage = saved.garage;
  if (saved.properties) S.properties = saved.properties;
  if (saved.collectibles) S.collectibles = saved.collectibles;
  if (typeof saved.completion === 'number') S.completion = saved.completion;
  if (typeof saved.activitiesDone === 'number') S.activitiesDone = saved.activitiesDone;
  if (typeof saved.playMinutes === 'number') S.playMinutes = saved.playMinutes;
  if (saved.standing) S.standing = saved.standing;
  if (saved.career) S.career = saved.career;
  if (typeof saved.clockMinutes === 'number') {
    S.clockMinutes = saved.clockMinutes;
    daynight.setTime(saved.clockMinutes / 60);
    clockHours = saved.clockMinutes / 60;
  }
  heroCar.x = S.player.x + 6; heroCar.z = S.player.z;
  heroCar.body.position.set(heroCar.x, 0, heroCar.z);
  Progress3d.refreshCompletion(S);
  pointAtStage();
  return true;
}

// ---------------------------------------------------------------------
// Input. WASD drive/walk, E enter/exit + mission, Q radio, Z/X/V
// crew, Esc pause, F9 save, T retry, Space handbrake in a car and
// jump on foot. Hold the
// right mouse button to aim and the left one to fire while aiming;
// reload and the weapon wheel belong to weapons.bindInput —
// main3d only reads the mouse world point for the aim ray.
// ---------------------------------------------------------------------
const keys = new Set();
let mouseWorld = null;
let mouseHeld = false;
let rmbHeld = false;

const raycaster = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const mouseNdc = new THREE.Vector2();
let mouseClient = null; // { x, y } viewport px of the cursor, for the crosshair
function updateMouseWorld(e) {
  const rect = canvas.getBoundingClientRect();
  mouseClient = { x: e.clientX, y: e.clientY };
  mouseNdc.set(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    -((e.clientY - rect.top) / rect.height) * 2 + 1
  );
  raycaster.setFromCamera(mouseNdc, camera);
  const hit = new THREE.Vector3();
  if (raycaster.ray.intersectPlane(groundPlane, hit)) mouseWorld = { x: hit.x, z: hit.z };
  // The buttons bitmask is the ground truth for a held button: it
  // re-asserts rmbHeld on every mouse move, so a right-click whose
  // mouseup the page never sees (menu, lost focus) cannot leave
  // the player stuck aiming, and a contextmenu clear below cannot
  // kill a genuine hold the moment the mouse moves again.
  if (typeof e.buttons === 'number') rmbHeld = (e.buttons & 2) !== 0;
}
canvas.addEventListener('mousemove', function (e) { police.noteInput(); updateMouseWorld(e); }); // r11-B2: mouse move resets the BUSTED idle clock
canvas.addEventListener('mousedown', function (e) {
  police.noteInput(); // r11-B2: any click resets the BUSTED idle clock
  if (e.button === 0) mouseHeld = true;
  if (e.button === 2) rmbHeld = true;
});
window.addEventListener('mouseup', function (e) {
  if (e.button === 0) mouseHeld = false;
  if (e.button === 2) rmbHeld = false;
});
window.addEventListener('blur', function () { mouseHeld = false; rmbHeld = false; });
canvas.addEventListener('contextmenu', function (e) {
  e.preventDefault();
  rmbHeld = false;
});

weapons.bindInput(canvas);

function dist2D(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }
function nearTarget(r) {
  return S.missionTarget && dist2D(S.player, S.missionTarget) < r;
}
function boardCar(car) {
  // r11-B3: boarding a car with an NPC driver pulls them out — the
  // figure hides (the carjack scene spawns the ped instead; a
  // moving car just loses its driver, who is gone when it is left).
  if (car.driver === 'npc') car.hadDriver = true;
  if (car.body && car.body.userData && typeof car.body.userData.setDriverVisible === 'function') car.body.userData.setDriverVisible(false);
  S.player.vehicle = car;
  car.traffic = false;
  car.driver = 'player';
  S.player.x = car.x; S.player.z = car.z;
  S.player.angle = car.angle;
  S.player.y = 0; S.player.vy = 0; // no mid-air boarding
  snapCamera();
}
function boardGull() {
  gull.occupied = true;
  S.player.vehicle = gull;
  S.player.x = gull.x; S.player.z = gull.z;
  S.player.y = 0; S.player.vy = 0;
  snapCamera();
}
// r11-B3: a car the player took from an NPC driver gets its driver
// back when it is left behind (exit, WASTED, BUSTED), so it rejoins
// traffic as a normal driven car instead of driving around empty.
function restoreCarDriver(v) {
  if (v && v.hadDriver) {
    v.driver = 'npc';
    v.hadDriver = false;
    if (v.body && v.body.userData && typeof v.body.userData.setDriverVisible === 'function') v.body.userData.setDriverVisible(true);
  } else if (v) {
    v.driver = null;
  }
}
function exitVehicle() {
  const v = S.player.vehicle;
  if (!v) return;
  if (v.kind === 'heli') {
    if (!v.landed) { setHudMsg('LAND THE GULL FIRST'); return; }
    v.occupied = false;
  } else {
    v.traffic = !v.hero;
    restoreCarDriver(v); // r11-B3
    v.speed = 0;
  }
  const rx = Math.cos(S.player.angle + Math.PI / 2);
  const rz = Math.sin(S.player.angle + Math.PI / 2);
  S.player.x = v.x + rx * 3;
  S.player.z = v.z + rz * 3;
  S.player.vehicle = null;
  S.player.y = 0; S.player.vy = 0; // step out on the ground
  snapCamera();
}
function doContextAction() {
  const p = S.player;
  if (carjack) return; // r11-B3: E mid-scene does not restart it
  if (p.vehicle) { exitVehicle(); return; }
  const stage = Missions3d.currentStage(S);
  if (stage && stage.type === 'deliver' && nearTarget(12)) {
    Missions3d.reportDelivery(S, missionHooks);
    return;
  }
  if (!S.missions.current && S.missionTarget && nearTarget(12)) {
    const next = nextFreeMission();
    if (next) {
      Missions3d.startMission(S, next.id, missionHooks);
      return;
    }
  }
  if (dist2D(p, gull) < 9 && gull.landed) { boardGull(); return; }
  let best = null, bestD = 7;
  const candidates = S.cars.concat([heroCar]);
  for (const car of candidates) {
    const d = dist2D(p, car);
    if (d < bestD) { bestD = d; best = car; }
  }
  if (best) {
    // r11-B3: E next to a STOPPED traffic car with a driver runs the
    // carjack scene (aim -> driver exits -> player enters). Anything
    // else — hero, parked, moving, driverless — boards the old way.
    if (!best.hero && best.traffic && best.driver === 'npc' && !best.moped && !best.parkedRow && Math.abs(best.speed || 0) < 0.5) startCarjack(best);
    else boardCar(best);
  }
}

// ---------------------------------------------------------------------
// Carjacking (r11-B3). E next to a stopped traffic car with a driver
// runs a short scripted scene instead of the instant board:
//   aim (0.6 s) — Rey aims at the driver (the tick holds the aim
//     pose while the phase runs)
//   exit (0.6 s) — the driver figure hides, a ped steps out on the
//     driver's side and flees, Rey stops aiming
//   enter — Rey boards the car (boardCar); the car is flagged jacked
//     so leaving it later gives it a driver back (restoreCarDriver).
// The scene is a timer on the tick, so it survives frame-rate
// variation; Rey cannot move while it runs (the tick skips movement
// during a carjack), and it cancels if the car drives off, if Rey is
// pulled away from it, or if Rey dies / is busted mid-scene.
// ---------------------------------------------------------------------
let carjack = null; // { car, t, phase, startX, startZ } while jacking
function startCarjack(car) {
  const p = S.player;
  carjack = { car: car, t: 0, phase: 'aim', startX: car.x, startZ: car.z };
  p.aim = Math.atan2(car.z - p.z, car.x - p.x);
  p.angle = p.aim;
  setHudMsg('CARJACK — AIMING AT THE DRIVER');
}
function cancelCarjack() {
  if (!carjack) return;
  carjack = null;
  weapons.setAiming(false);
}
function spawnJackedDriverPed(car) {
  // The driver steps out on the driver's side (local -z, left-hand
  // drive, just outside the door) and flees along the sidewalk like
  // any startled ped. The record mirrors traffic3d's makePedRecord
  // fields so the ped loop handles it as a normal walker afterwards.
  const a = car.angle || 0;
  const ca = Math.cos(a), sa = Math.sin(a);
  const lx = -0.15, lz = -1.6;
  const x = car.x + lx * ca - lz * sa;
  const z = car.z + lx * sa + lz * ca;
  const skins = ['#e8b48f', '#c98d64', '#8a5a3b'];
  const shirts = ['#3d7ea6', '#c94f3d', '#e8c53a', '#4a6b4f'];
  const ped = {
    x: x, z: z,
    angle: Math.atan2(z - car.z, x - car.x),
    speed: 0, base: 1.2 + Math.random() * 1.2,
    color: skins[Math.floor(Math.random() * skins.length)],
    shirt: shirts[Math.floor(Math.random() * shirts.length)],
    health: 100,
    mode: 'flee', home: 'walk',
    fleeT: 4, duckT: 0, chatT: 0, browseT: 0,
    downT: 0, down: false, fleeSw: null,
    anchor: null, beach: false, fighter: false,
    promX: null, aisle: null, front: null,
    sw: null, wp: null, waiting: null, noStraightJ: null
  };
  (S.peds || []).push(ped);
}
function updateCarjack(dt) {
  if (!carjack) return;
  const p = S.player;
  const car = carjack.car;
  carjack.t += dt;
  // Cancel if the scene broke: the car drove off, Rey was pulled
  // away (death/busted respawn), or Rey died mid-scene.
  if (death || bustedState || Math.hypot(p.x - car.x, p.z - car.z) > 10 ||
      Math.hypot(car.x - carjack.startX, car.z - carjack.startZ) > 8) {
    cancelCarjack();
    return;
  }
  if (carjack.phase === 'aim' && carjack.t >= 0.6) {
    carjack.phase = 'exit';
    if (car.body && car.body.userData && typeof car.body.userData.setDriverVisible === 'function') car.body.userData.setDriverVisible(false);
    car.driver = null;
    car.hadDriver = true;
    spawnJackedDriverPed(car);
    weapons.setAiming(false);
    setHudMsg('DRIVER OUT — GETTING IN');
  } else if (carjack.phase === 'exit' && carjack.t >= 1.2) {
    const target = carjack.car;
    carjack = null;
    boardCar(target);
    target.jacked = true;
  }
}
function useCrewAbility(id) {
  const res = Crew3d.useAbility(S, id, Date.now(), function () {
    Progress3d.recordCrewAbility(S);
  });
  if (res && res.ok) {
    if (id === 'tuck') police.setWanted(S.wanted, S.player);
    if (id === 'ines' && S.player.vehicle && S.player.vehicle.body && S.player.vehicle.body.userData.setDamage) {
      S.player.vehicle.body.userData.setDamage(0);
    }
  } else if (res && res.reason) {
    setHudMsg('CREW: ' + String(res.reason).toUpperCase().replace(/-/g, ' '));
  }
}

function startGameFromTitle(loadSave) {
  if (window.PalmaScreens3d && window.PalmaScreens3d.hideTitle) window.PalmaScreens3d.hideTitle();
  // r12-B4: the HUD was hidden for the title — bring it back the
  // moment the game starts. display is cleared (not set to a fixed
  // value) so the host keeps its boot sizing; the 15 Hz tick
  // repopulates it on the first playing frame.
  if (hudHost) hudHost.style.display = '';
  S.screen = 'playing';
  // NEW GAME passes loadSave === false: the selected slot is ignored
  // and the game starts fresh. Anything else loads the slot.
  const loaded = loadSave === false ? false : loadTitleSlot();
  // r11-B1: the title pins the clock to golden hour (17.5); a fresh
  // game restarts at the normal 09:30 open. A loaded save sets its
  // own clock inside applyLoadedSave, so it is left alone.
  if (titlePinned) {
    titlePinned = false;
    if (!loaded) { daynight.setTime(CFG3D.DAY_START_HOUR); clockHours = CFG3D.DAY_START_HOUR; }
  }
  if (!loaded && !S.missions.current && (!S.missions.completed || S.missions.completed.length === 0)) {
    Missions3d.startMission(S, 'the-debt', missionHooks);
  }
  pointAtStage();
  snapCamera();
}
function loadTitleSlot() {
  try {
    const res = Progress3d.loadGame(S.titleSlot || 0);
    if (res && res.ok) return applyLoadedSave(res.state);
  } catch (e) { /* empty or corrupt slot: new game */ }
  return false;
}

// Title-menu dispatch (r8 follow-up to B1's mouse menu). B1's
// hover/click writes the shared selection in screens3d.js, but
// `lastMenuSel` there lives inside that file's IIFE — it is NOT a
// window global, so main3d cannot read it. The selected row IS
// readable in the DOM: B1 marks it .pv3d-title-menu-selected with
// data-menu='CONTINUE' etc. (r10: the row also carries a grey
// description line, so the label text alone no longer matches —
// data-menu is read first, label text is only a prefix fallback).
// Clicks fire a synthetic Enter, so click and keyboard share this
// one dispatch. A missing element (or unknown text) falls back to
// CONTINUE — the pre-existing Enter behaviour, so keyboard Enter is
// unchanged when nothing is selected. While the systems screen sits
// over the title (SETTINGS open), Enter is ignored so it cannot
// start the game behind it.
const TITLE_MENU_ITEMS = ['CONTINUE', 'NEW GAME', 'SETTINGS'];
function titleMenuSelection() {
  const el = document.querySelector('.pv3d-title-menu-selected');
  if (!el) return 0;
  const key = el.getAttribute ? el.getAttribute('data-menu') : null;
  if (key) {
    const ki = TITLE_MENU_ITEMS.indexOf(key);
    if (ki !== -1) return ki;
  }
  const text = (el.textContent || '').replace('▸', '').trim().toUpperCase();
  for (let i = 0; i < TITLE_MENU_ITEMS.length; i++) {
    if (text.indexOf(TITLE_MENU_ITEMS[i]) === 0) return i;
  }
  return 0;
}
function dispatchTitleMenu() {
  if (window.PalmaScreens3d && window.PalmaScreens3d.systemsVisible &&
      window.PalmaScreens3d.systemsVisible()) return;
  // r11-B1: while the dedicated settings panel is open, Enter must
  // not start the game behind it.
  if (window.PalmaScreens3d && window.PalmaScreens3d.settingsVisible &&
      window.PalmaScreens3d.settingsVisible()) return;
  const sel = titleMenuSelection();
  if (sel === 2) { // r11-B1 SETTINGS: dedicated settings panel, never the systems screen
    if (window.PalmaScreens3d && window.PalmaScreens3d.showSettings) {
      window.PalmaScreens3d.showSettings(S, { slots: Progress3d.listSaveSlots() });
    }
    return;
  }
  // r10: no LOAD GAME row — loading lives on the slot cards' Load
  // buttons (and double-click), which route through CONTINUE here.
  startGameFromTitle(sel !== 1); // CONTINUE loads the slot, NEW GAME skips it
}

window.addEventListener('keydown', function (e) {
  police.noteInput(); // r11-B2: any key resets the BUSTED idle clock
  if (e.code === 'Tab') return; // weapons.bindInput owns Tab
  keys.add(e.code);
  if (e.code === 'Enter') {
    if (S.screen === 'title') { dispatchTitleMenu(); return; }
    if (S.banner) hideBanner();
  }
  if (S.screen === 'title') {
    // r11-B1: arrows must not rebuild the title (resetting the menu
    // selection) while the settings panel sits over it.
    if (window.PalmaScreens3d && window.PalmaScreens3d.settingsVisible &&
        window.PalmaScreens3d.settingsVisible()) return;
    if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      S.titleSlot = (S.titleSlot + (e.code === 'ArrowRight' ? 1 : 2)) % 3;
      showTitleScreen();
    }
    return;
  }
  if (e.code === 'Escape') {
    // r11-B1: while the settings panel is open (from pause), Esc
    // closes the panel only — it must NOT resume the game behind it.
    // The panel's own Esc listener does the closing.
    if (window.PalmaScreens3d && window.PalmaScreens3d.settingsVisible &&
        window.PalmaScreens3d.settingsVisible()) return;
    if (S.screen === 'playing') {
      S.screen = 'paused';
      if (window.PalmaScreens3d) window.PalmaScreens3d.showSystems(S, city, { slots: Progress3d.listSaveSlots() });
    } else if (S.screen === 'paused') {
      S.screen = 'playing';
      if (window.PalmaScreens3d) window.PalmaScreens3d.hideSystems();
    }
    return;
  }
  if (S.screen !== 'playing') return;
  if (e.code === 'Space' && !e.repeat && !S.player.vehicle) { tryJump(); e.preventDefault(); }
  if (e.code === 'KeyE') doContextAction();
  if (e.code === 'KeyQ') { radio.nextStation(); S.radioStation = radio.stationIndex; S.radioTrack = radio.nowPlaying(); }
  if (e.code === 'KeyZ') useCrewAbility('tuck');
  if (e.code === 'KeyX') useCrewAbility('ines');
  if (e.code === 'KeyV') useCrewAbility('kip');
  if (e.code === 'F9') { saveToSlot(0); e.preventDefault(); }
  if (e.code === 'KeyT' && S.missions.lastFailed) Missions3d.restartMission(S, S.missions.lastFailed, missionHooks);
});
window.addEventListener('keyup', function (e) { keys.delete(e.code); });

// ---------------------------------------------------------------------
// Chase camera (B2). hero = { position, heading, speed, mode }.
// forward = (cos heading, 0, sin heading); camera sits behind the
// hero and looks ahead of it. Snap on enter/exit, game start and
// shot staging so the first frame is already framed.
// ---------------------------------------------------------------------
const chase = createChaseCamera(camera, {
  // The aim lens pulls in close behind Rey: keep it out of walls.
  isSolid: function (x, z) { return world.isSolid(x, z); }
});
function heroDescriptor() {
  const p = S.player;
  if (p.vehicle && p.vehicle.kind === 'heli') {
    return { position: new THREE.Vector3(p.vehicle.x, p.vehicle.altitude || 0, p.vehicle.z), heading: p.vehicle.angle, speed: p.vehicle.speed || 0, mode: 'heli' };
  }
  if (p.vehicle) {
    return { position: new THREE.Vector3(p.vehicle.x, 0, p.vehicle.z), heading: p.vehicle.angle, speed: Math.abs(p.vehicle.speed || 0), mode: 'car' };
  }
  // On foot the heading is the aim while aiming (stepOnFoot turns
  // the player to p.aim), so the aim lens looks where Rey aims.
  return { position: new THREE.Vector3(p.x, 0, p.z), heading: p.angle, speed: walkSpeed, mode: 'foot', aiming: !!p.aiming };
}
function snapCamera() {
  const hero = heroDescriptor();
  if (chase.snap) chase.snap(hero);
  S.cam = { x: hero.position.x, z: hero.position.z };
}
let walkSpeed = 0;
let walkDirX = 1, walkDirZ = 0; // last on-foot movement direction (unit vector)

// ---------------------------------------------------------------------
// Per-frame mesh sync. Traffic/police create bodies but never add
// them to the scene; this step adds a body once and keeps every
// body on its logic record. Bikes have no B2 mesh yet —
// unit.kind === 'bike' is the swap signal; they reuse a dark car.
// ---------------------------------------------------------------------
function ensureCarBody(car) {
  if (car.body) {
    if (!car.body.parent) scene.add(car.body);
    return car.body;
  }
  let body;
  if (car.hero || (car.model && (car.model.id === 'cometa' || car.model === 'cometa'))) {
    body = createHeroCar();
    if (typeof car.damage === 'number' && body.userData.setDamage) body.userData.setDamage(car.damage);
  } else {
    body = createTrafficCar(car.color || '#23262f');
  }
  car.body = body;
  scene.add(body);
  return body;
}
function syncCarBody(car, dt) {
  const body = ensureCarBody(car);
  body.position.set(car.x, 0, car.z);
  body.rotation.y = -car.angle;
  if (body.userData.update) {
    const steer = car.steer || 0;
    body.userData.update(dt, car.speed || 0, steer);
  }
  if (car.hero && typeof car.damage === 'number' && body.userData.setDamage) body.userData.setDamage(car.damage);
}
function syncHeliBody(heli, dt, rotorSpeed) {
  if (!heli) return;
  let body = heli.body;
  if (!body) { body = createHeli(); heli.body = body; scene.add(body); }
  if (!body.parent) scene.add(body);
  body.position.set(heli.x, heli.altitude || 0, heli.z);
  body.rotation.y = -heli.angle;
  if (body.userData.update) body.userData.update(dt, rotorSpeed);
  if (body.userData.setSpotlight) body.userData.setSpotlight((heli.altitude || 0) > 5);
}
function syncWorldMeshes(dt) {
  // Player figure.
  const p = S.player;
  if (p.vehicle) {
    playerMesh.visible = false;
  } else {
    playerMesh.visible = true;
    playerMesh.position.set(p.x, p.y || 0, p.z);
    playerMesh.rotation.y = -p.angle;
    let pose = 'idle';
    // r10 B6: the WASTED body lies PRONE where it fell — flat on its
    // back, at the death spot, for the whole card, until the hospital
    // respawn. The old code left the figure standing idle under the
    // card (Khase played it: body still upright).
    if (death) pose = 'down';
    else if (p.aiming) pose = 'aim';
    else if (walkSpeed > 5.5) pose = 'run';
    else if (walkSpeed > 0.15) pose = 'walk';
    // Signed speed: forward is +walkSpeed; S while aiming backpedals
    // (negative), so the figure plays the backpedal cycle instead of
    // moonwalking a forward walk. Not aiming, the figure turns to
    // face the movement, so the dot is +1 by construction.
    const walkSigned = walkSpeed * (Math.cos(p.angle) * walkDirX + Math.sin(p.angle) * walkDirZ);
    // The figure always shows the equipped slot: the pistol is in
    // Rey's hand (fists hides it, switching swaps the mesh).
    if (playerMesh.userData.setWeapon) playerMesh.userData.setWeapon(p.weapon);
    if (playerMesh.userData.update) playerMesh.userData.update(dt, walkSigned, pose);
  }
  // Hero car + traffic cars. In shot mode the live hero car stays
  // hidden: the staged state carries its own hero record.
  if (S === state) syncCarBody(heroCar, dt);
  else if (heroCar.body) heroCar.body.visible = false;
  for (const car of S.cars) syncCarBody(car, dt);
  // Pedestrians (traffic) + police officers.
  syncPedMeshes(dt);
  // Police ground units + heli.
  if (S.police) {
    for (const u of S.police.units || []) {
      if (u.ped) continue; // officer figure handled in syncPedMeshes
      if (u.body) syncCarBody(u, dt);
      else if (u.car) { u.body = ensureCarBody(u.car); syncCarBody(u, dt); }
    }
    if (S.police.heli) syncHeliBody(S.police.heli, dt, 14);
    if (S.police.heli2) syncHeliBody(S.police.heli2, dt, 14);
  }
  // The Gull. In shot mode the live Gull stays hidden: the staged
  // state carries its own Gull record (heli shot).
  if (S === state) {
    const rotor = (gull.occupied || (gull.altitude || 0) > 0) ? 14 : 0;
    syncHeliBody(gull, dt, rotor);
  } else {
    if (gull.body) gull.body.visible = false;
    if (S.gull) syncHeliBody(S.gull, dt, 14);
  }
  // Muzzle flash fades.
  if (flashMesh.visible && S.time > flashUntil) {
    flashMesh.visible = false;
    flashMat.opacity = 0;
  }
  // Bullet tracer fades (r11-B4).
  tracerFx.update(S.time);
}

// ---------------------------------------------------------------------
// Physics. On foot WASD moves camera-relative (camera yaw comes from
// the chase camera's position vs the player). Driving: W accel,
// S brake/reverse, A/D steer, Space handbrake; world.isSolid blocks
// buildings, the ocean blocks at the shore. The Gull: W forward,
// A/D yaw, Space climb, C sink, only while boarded.
// ---------------------------------------------------------------------
let driveOdo = 0;

// On-foot collision (r7). The player used to be a point that only
// world.isSolid saw: buildings blocked, but traffic cars, lamps,
// poles and trees had no test at all, so the player walked straight
// through (and visually on top of) parked cars. The player now has
// a 0.5 m radius and is solid against:
//   - buildings: world.isSolid, tested at the centre plus four rim
//     samples so the body stops at the wall instead of clipping in;
//   - cars: live oriented boxes off traffic + the hero car + police
//     cars (mopeds slimmer), read fresh every step — moving cars
//     included, so a car can never be walked through;
//   - the landed Gull: fuselage + tail only (the rotor disc is
//     2.8 m up, the player walks under it);
//   - lamps / signal poles / palms / beach umbrellas: small circles
//     from the world's exported spot lists, built once (static).
// Movement stays axis-separated, so a blocked axis slides along the
// obstacle instead of freezing the player. If the player is already
// inside an obstacle — a moving car drove into them, or an exit
// spawn landed on a footprint — the step is let through, so they can
// always walk back out instead of getting stuck.
const PLAYER_RADIUS = 0.5;
const CAR_HALF_LEN = 2.3; // traffic-car body is 4.6 m long (vehicles3d)
const CAR_HALF_WID = 1.0; // ... and 2.0 m wide
const MOPED_HALF_LEN = 1.1;
const MOPED_HALF_WID = 0.45;
const GULL_HALF_LEN = 3.2; // landed Gull: cabin + tail boom
const GULL_HALF_WID = 1.2;
let propObstacles = null; // [{ x, z, r }] — lamps, poles, palms, umbrellas
function buildPropObstacles() {
  if (propObstacles) return propObstacles;
  const list = [];
  const add = function (x, z, r) {
    if (typeof x === 'number' && typeof z === 'number' && isFinite(x) && isFinite(z)) list.push({ x: x, z: z, r: r });
  };
  // Every street lamp (junction + mid-block, world.lampSpots).
  for (const s of world.lampSpots || []) add(s[0], s[1], 0.9);
  // Traffic-light poles stand on the same junction corners: the light
  // record carries the head group, whose position is the pole.
  for (const tl of world.trafficLights || []) {
    if (tl.group && tl.group.position) add(tl.group.position.x, tl.group.position.z, 0.9);
  }
  for (const s of world.palms || []) add(s[0], s[1], 1.1);
  for (const s of world.umbrellas || []) add(s[0], s[1], 0.8);
  propObstacles = list;
  return list;
}
function carBlocksAt(car, x, z) {
  if (!car || typeof car.x !== 'number' || typeof car.z !== 'number') return false;
  const hl = car.moped ? MOPED_HALF_LEN : CAR_HALF_LEN;
  const hw = car.moped ? MOPED_HALF_WID : CAR_HALF_WID;
  const dx = x - car.x, dz = z - car.z;
  const ca = Math.cos(car.angle || 0), sa = Math.sin(car.angle || 0);
  const along = dx * ca + dz * sa;
  const perp = -dx * sa + dz * ca;
  return Math.abs(along) < hl + PLAYER_RADIUS && Math.abs(perp) < hw + PLAYER_RADIUS;
}
function footBlockedAt(x, z, skipCars) { // r11-B4: skipCars lets an airborne player pass over a car roof
  // Buildings, with the player radius.
  if (world.isSolid(x, z) || world.isSolid(x + PLAYER_RADIUS, z) || world.isSolid(x - PLAYER_RADIUS, z) ||
      world.isSolid(x, z + PLAYER_RADIUS) || world.isSolid(x, z - PLAYER_RADIUS)) return true;
  // Cars: traffic (parked + moving), the hero car, police cars.
  // r11-B4: skipped while airborne above roof height — a jump can
  // carry the player over a car instead of bumping into its side.
  if (!skipCars) {
  const cars = (traffic && traffic.cars) || S.cars || [];
  for (const car of cars) if (carBlocksAt(car, x, z)) return true;
  if (carBlocksAt(heroCar, x, z)) return true;
  if (S.police) {
    for (const u of S.police.units || []) {
      if (u.ped) continue;
      if (carBlocksAt(u.car || u, x, z)) return true;
    }
  }
  }
  // The landed Gull.
  if (gull && gull.landed && (gull.altitude || 0) <= 0.5) {
    const dx = x - gull.x, dz = z - gull.z;
    const ca = Math.cos(gull.angle || 0), sa = Math.sin(gull.angle || 0);
    const along = dx * ca + dz * sa;
    const perp = -dx * sa + dz * ca;
    if (Math.abs(along) < GULL_HALF_LEN + PLAYER_RADIUS && Math.abs(perp) < GULL_HALF_WID + PLAYER_RADIUS) return true;
  }
  // Lamps / poles / palms / umbrellas.
  for (const o of buildPropObstacles()) {
    const dx = x - o.x, dz = z - o.z, rr = o.r + PLAYER_RADIUS;
    if (dx * dx + dz * dz < rr * rr) return true;
  }
  return false;
}
// Jump (r11-B4): Space on foot only — never in a car, where Space is
// the handbrake. vy starts it, gravity pulls it back. Tall enough to
// clear a car roof (apex ~1.75 m vs a ~1.45 m roof) so the player can
// land on it: while above roof height cars stop blocking horizontal
// movement (footBlockedAt skipCars), and a descent over a car body
// lands on the roof instead of falling through it. Buildings still
// block at any height — a jump cannot carry the player through one.
// ~1.75 m high, ~1.0 s air.
const JUMP_V = 7.0; // m/s up
const JUMP_G = 14;  // m/s^2 down
const CAR_ROOF_Y = 1.45; // m — roof panel top (vehicles3d: ~1.36–1.41)
// r11-B4: strict oriented-box test — inside the car body itself, no
// player-radius padding, so standing on "air" beside a car is not a roof.
function carBodyAt(car, x, z) {
  if (!car || car.moped || typeof car.x !== 'number' || typeof car.z !== 'number') return false;
  const dx = x - car.x, dz = z - car.z;
  const ca = Math.cos(car.angle || 0), sa = Math.sin(car.angle || 0);
  const along = dx * ca + dz * sa;
  const perp = -dx * sa + dz * ca;
  return Math.abs(along) < CAR_HALF_LEN && Math.abs(perp) < CAR_HALF_WID;
}
// r11-B4: roof height under (x, z), or 0 when no car roof is there.
// Mopeds have no standable roof; the Gull is excluded too.
function carRoofAt(x, z) {
  const cars = (traffic && traffic.cars) || S.cars || [];
  for (const car of cars) if (carBodyAt(car, x, z)) return CAR_ROOF_Y;
  if (carBodyAt(heroCar, x, z)) return CAR_ROOF_Y;
  if (S.police) {
    for (const u of S.police.units || []) {
      if (u.ped) continue;
      if (carBodyAt(u.car || u, x, z)) return CAR_ROOF_Y;
    }
  }
  return 0;
}
function tryJump() { // r11-B4: also allowed from a car roof (standing on one is y > 0 with vy 0)
  const p = S.player;
  if (p.vehicle) return;
  if ((p.vy || 0) !== 0) return; // already airborne
  if ((p.y || 0) > 0 && carRoofAt(p.x, p.z) !== (p.y || 0)) return; // mid-air, not standing on a roof
  p.vy = JUMP_V;
}
function stepOnFoot(dt) {
  const p = S.player;
  const camDir = new THREE.Vector3(p.x - camera.position.x, 0, p.z - camera.position.z);
  if (camDir.lengthSq() < 0.01) camDir.set(Math.cos(p.angle), 0, Math.sin(p.angle));
  camDir.normalize();
  const right = new THREE.Vector3(-camDir.z, 0, camDir.x);
  let mx = 0, mz = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) { mx += camDir.x; mz += camDir.z; }
  if (keys.has('KeyS') || keys.has('ArrowDown')) { mx -= camDir.x; mz -= camDir.z; }
  if (keys.has('KeyA') || keys.has('ArrowLeft')) { mx -= right.x; mz -= right.z; }
  if (keys.has('KeyD') || keys.has('ArrowRight')) { mx += right.x; mz += right.z; }
  const len = Math.hypot(mx, mz);
  const sprint = keys.has('ShiftLeft') || keys.has('ShiftRight');
  const target = len > 0 ? (sprint ? 7 : 4) : 0;
  walkSpeed += (target - walkSpeed) * Math.min(1, dt * 8);
  if (len > 0) {
    mx /= len; mz /= len;
    walkDirX = mx; walkDirZ = mz;
    const nx = p.x + mx * walkSpeed * dt;
    const nz = p.z + mz * walkSpeed * dt;
    // Axis-separated, so a blocked axis slides along the obstacle.
    // Already inside (a car drove into the player, or an exit spawn
    // landed on a footprint)? Let the step through — the way out.
    // r11-B4: above roof height, cars stop blocking — the jump can
    // carry the player over a roof. Buildings still block (footBlockedAt
    // always checks world.isSolid), so no clipping through walls.
    const aboveRoof = (p.y || 0) > CAR_ROOF_Y;
    const inside = footBlockedAt(p.x, p.z, aboveRoof);
    if (inside || !footBlockedAt(nx, p.z, aboveRoof)) p.x = nx;
    if (inside || !footBlockedAt(p.x, nz, aboveRoof)) p.z = nz;
    if (!p.aiming) p.angle = Math.atan2(mz, mx);
    p.x = Math.max(CFG3D.OCEAN_X + 40, Math.min(CFG3D.CITY_HALF, p.x));
    p.z = Math.max(-CFG3D.CITY_HALF, Math.min(CFG3D.CITY_HALF, p.z));
  }
  if (p.aiming) p.angle = p.aim;
  // Jump arc (r11-B4): runs even with no movement keys held. Gravity
  // while airborne; descending over a car roof lands on the roof,
  // otherwise land flat on y=0. Walking off a roof edge falls to 0
  // (carRoofAt is 0 past the body, so no hovering on air).
  if ((p.y || 0) > 0 || (p.vy || 0) !== 0) {
    p.vy = (p.vy || 0) - JUMP_G * dt;
    p.y = (p.y || 0) + p.vy * dt;
    if ((p.vy || 0) <= 0) {
      const roof = carRoofAt(p.x, p.z);
      if (roof > 0 && p.y <= roof) { p.y = roof; p.vy = 0; }
      else if (p.y <= 0) { p.y = 0; p.vy = 0; }
    }
  }
}
function stepCar(dt) {
  const car = S.player.vehicle;
  const p = S.player;
  const top = car.hero ? 30 : 24;
  if (keys.has('KeyW')) car.speed = Math.min(top, car.speed + 14 * dt);
  else if (keys.has('KeyS')) car.speed = car.speed > 0.5 ? Math.max(0, car.speed - 22 * dt) : Math.max(-8, car.speed - 8 * dt);
  else car.speed *= Math.max(0, 1 - 0.25 * dt);
  if (keys.has('Space')) car.speed *= Math.max(0, 1 - 2.5 * dt);
  let steer = 0;
  if (keys.has('KeyA')) steer -= 1;
  if (keys.has('KeyD')) steer += 1;
  if (car.speed < 0) steer = -steer;
  car.angle += steer * Math.abs(car.speed) * 0.045 * dt;
  const nx = car.x + Math.cos(car.angle) * car.speed * dt;
  const nz = car.z + Math.sin(car.angle) * car.speed * dt;
  if (world.isSolid(nx, nz) || nx < CFG3D.OCEAN_X + 20 || Math.abs(nx) > CFG3D.CITY_HALF || Math.abs(nz) > CFG3D.CITY_HALF) {
    if (Math.abs(car.speed) > 10) {
      car.damage = Math.min(100, (car.damage || 0) + 5);
      car.condition = 100 - car.damage;
    }
    car.speed *= 0.2;
  } else {
    car.x = nx; car.z = nz;
    driveOdo += Math.abs(car.speed) * dt;
    if (driveOdo > 100) {
      driveOdo = 0;
      Progress3d.recordDistance(S, 0.1);
    }
  }
  car.steer = steer;
  p.x = car.x; p.z = car.z; p.angle = car.angle;
  if (car.body && car.body.userData.setLights) car.body.userData.setLights(true);
}
function stepGull(dt) {
  const heli = S.player.vehicle;
  const p = S.player;
  if (keys.has('KeyA')) heli.angle -= 0.9 * dt;
  if (keys.has('KeyD')) heli.angle += 0.9 * dt;
  const fwd = keys.has('KeyW') ? 12 : 0;
  heli.speed = fwd;
  heli.x += Math.cos(heli.angle) * fwd * dt;
  heli.z += Math.sin(heli.angle) * fwd * dt;
  if (keys.has('Space')) heli.altitude = Math.min(120, heli.altitude + 8 * dt);
  if (keys.has('KeyC')) heli.altitude = Math.max(0, heli.altitude - 8 * dt);
  heli.landed = heli.altitude <= 0.5;
  heli.x = Math.max(CFG3D.OCEAN_X - 400, Math.min(CFG3D.CITY_HALF + 400, heli.x));
  heli.z = Math.max(-CFG3D.CITY_HALF - 400, Math.min(CFG3D.CITY_HALF + 400, heli.z));
  p.x = heli.x; p.z = heli.z; p.angle = heli.angle;
}

// ---------------------------------------------------------------------
// Shot mode. ?shot=chase|night|systems|heli&seed=N stages a frozen
// frame: no system updates, camera set directly from the staged
// camera, HUD updated once, systems shot shows the pause screen,
// extras projected as DOM chips, footer strip set, and a JSON status
// written to #test-status + window.__pv3d.shot for the flow test.
// ---------------------------------------------------------------------
let shotRecord = null;
let shotMode = false;

function projectToScreen(x, y, z) {
  const v = new THREE.Vector3(x, y, z).project(camera);
  if (v.z > 1) return null;
  return {
    x: (v.x * 0.5 + 0.5) * window.innerWidth,
    y: (-v.y * 0.5 + 0.5) * window.innerHeight
  };
}

// ---------------------------------------------------------------------
// Aim overlay (r10): crosshair at the mouse + health bar over the
// one ped the aim ray hits. Pure geometry, no raycast against the
// scene: the aim ray is the player's aim heading on the ground
// plane, and a ped counts as targeted when it lies within a narrow
// corridor around that ray. Same corridor the shot system uses in
// spirit (weapons pickTarget: nearest in-range target inside the
// aim cone), so the bar and the bullet agree on the target.
// ---------------------------------------------------------------------
const AIM_TARGET_RANGE = 80; // m — the bar is a spotting aid, not the shot range
const AIM_TARGET_HALF_WIDTH = 0.9; // m across the ray at the ped
function findAimTarget() {
  const p = S.player;
  if (!p || p.vehicle) return null;
  const dx = Math.cos(p.aim), dz = Math.sin(p.aim);
  let best = null, bestAlong = AIM_TARGET_RANGE;
  const consider = function (ped) {
    if (!ped || ped.down || (typeof ped.health === 'number' && ped.health <= 0)) return;
    const rx = ped.x - p.x, rz = ped.z - p.z;
    const along = rx * dx + rz * dz;
    if (along < 0.5 || along >= bestAlong) return;
    const perp = Math.abs(-rx * dz + rz * dx);
    // The corridor widens slightly with distance: a ped 40 m out
    // is a smaller screen target, so the tolerance grows with range.
    if (perp > AIM_TARGET_HALF_WIDTH + along * 0.01) return;
    best = ped; bestAlong = along;
  };
  for (const ped of S.peds || []) consider(ped);
  // Police foot officers are peds too (u.ped) — same bar, same rule.
  for (const u of (S.police && S.police.units) || []) if (u.ped) consider(u.ped);
  return best ? { ped: best, along: bestAlong } : null;
}
function updateAimOverlay() {
  const p = S.player;
  const aiming = S.screen === 'playing' && !death && !!p && !p.vehicle && !!p.aiming;
  // Crosshair: exactly at the mouse while aiming, nowhere otherwise.
  if (aiming && mouseClient) {
    crosshairEl.style.display = 'block';
    crosshairEl.style.left = mouseClient.x + 'px';
    crosshairEl.style.top = mouseClient.y + 'px';
  } else {
    crosshairEl.style.display = 'none';
  }
  // Health bar: only the targeted ped, above their head, green->red.
  let target = null;
  if (aiming) target = findAimTarget();
  if (target) {
    const hp = Math.max(0, Math.min(100, typeof target.ped.health === 'number' ? target.ped.health : 100));
    const pt = projectToScreen(target.ped.x, 2.15, target.ped.z);
    if (pt) {
      pedHealthEl.style.display = 'block';
      pedHealthEl.style.left = pt.x + 'px';
      pedHealthEl.style.top = pt.y + 'px';
      pedHealthFillEl.style.width = hp + '%';
      // Hue 120 (green) at full health -> 0 (red) at empty.
      pedHealthFillEl.style.background = 'hsl(' + Math.round(hp * 1.2) + ',85%,45%)';
    } else {
      pedHealthEl.style.display = 'none';
    }
  } else {
    pedHealthEl.style.display = 'none';
  }
  // Probe for the flow/self test: what the aim overlay is showing.
  window.__pv3d.aim = {
    aiming: aiming,
    targetHealth: target ? Math.max(0, Math.min(100, typeof target.ped.health === 'number' ? target.ped.health : 100)) : null,
    aimWeight: chase && typeof chase.aimWeight === 'number' ? +chase.aimWeight.toFixed(3) : null
  };
}

function chip(text, x, y, style) {
  const d = document.createElement('div');
  d.textContent = text;
  d.style.cssText = 'position:absolute;left:' + x.toFixed(0) + 'px;top:' + y.toFixed(0) +
    'px;transform:translate(-50%,-50%);font:700 13px system-ui,sans-serif;color:#fff;' +
    'background:rgba(10,14,20,.72);border:1px solid rgba(255,255,255,.35);border-radius:4px;' +
    'padding:3px 8px;white-space:nowrap;text-shadow:0 1px 2px rgba(0,0,0,.8);' + (style || '');
  extrasEl.appendChild(d);
  return d;
}
function renderShotExtras(built) {
  // Extras arrive as an array of {kind, ...} records (see
  // shots3d.shotExtras): flash at the muzzle, hit/down markers on
  // rivals, neon signs offset from the player, heli tag + chip.
  extrasEl.innerHTML = '';
  const ex = built.extras || [];
  const p = S.player;
  for (const item of ex) {
    if (item.kind === 'flash') {
      const pt = projectToScreen(p.x + Math.cos(p.aim) * 1.3, 1.3, p.z + Math.sin(p.aim) * 1.3);
      if (pt) chip('✦', pt.x, pt.y, 'color:#ffe9a8;background:none;border:none;font-size:22px');
    } else if (item.kind === 'hit') {
      const pt = projectToScreen(item.x, 1.2, item.z);
      if (pt) chip('✕', pt.x, pt.y, 'color:#fff;background:none;border:none;font-size:16px');
    } else if (item.kind === 'down') {
      const pt = projectToScreen(item.x, 1.0, item.z);
      if (pt) chip('DOWN', pt.x, pt.y, 'color:#ffb3ab');
    } else if (item.kind === 'neon') {
      const pt = projectToScreen(p.x + (item.dx || 0), 3.2, p.z + (item.dz || 0));
      if (pt) chip(item.text, pt.x, pt.y, 'color:' + (item.color || '#7ef0e0'));
    } else if (item.kind === 'heli-tag') {
      const pt = projectToScreen(item.x, (item.altitude || 15) + 4, item.z);
      if (pt) chip(item.label, pt.x, pt.y, 'color:#ffd34d');
    } else if (item.kind === 'heli-chip') {
      chip(item.text, window.innerWidth / 2, 90, 'font-size:15px');
    }
  }
}
function sampleCanvas() {
  try {
    const src = renderer.domElement;
    const c = document.createElement('canvas');
    c.width = 160; c.height = 90;
    const ctx = c.getContext('2d');
    ctx.drawImage(src, 0, 0, 160, 90);
    const data = ctx.getImageData(0, 0, 160, 90).data;
    let nonBlank = 0, sum = 0;
    for (let i = 0; i < data.length; i += 4) {
      const l = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      sum += l;
      if (l > 12) nonBlank++;
    }
    const n = data.length / 4;
    return { nonBlank: nonBlank / n, meanLuma: sum / n };
  } catch (e) {
    return { nonBlank: 0, meanLuma: 0, sampleError: String(e && e.message ? e.message : e) };
  }
}
function setupShotMode() {
  if (!window.PalmaShots3d) return false;
  const built = window.PalmaShots3d.renderFromQuery(city);
  if (!built) return false;
  if (!built.ok) {
    reportError('shot staging failed: ' + (built.reason || built.shot));
    return false;
  }
  shotRecord = built;
  shotMode = true;
  S = built.state;
  S.city = city;
  S.screen = built.shot === 'systems' ? 'paused' : 'playing';
  // The staged clock drives the sky: without this every shot renders
  // in the default 09:30 morning grade no matter what the clock line
  // says (the night shot came out daylight-blue).
  if (typeof S.clockMinutes === 'number') {
    daynight.setTime(S.clockMinutes / 60);
    clockHours = daynight.hour;
    currentGrade = daynight.grade;
  }
  // The staged state needs the live radio track + clock strings the
  // HUD reads; the staged builders already set clockMinutes and
  // radioStation, and the radio system supplies the track line.
  S.radioTrack = radio.nowPlaying();
  if (built.camera) {
    camera.position.set(built.camera.pos.x, built.camera.pos.y, built.camera.pos.z);
    camera.lookAt(built.camera.lookAt.x, built.camera.lookAt.y, built.camera.lookAt.z);
    camera.fov = built.camera.fov || (built.mode === 'heli' ? 45 : 42);
    camera.updateProjectionMatrix();
    // r12: refresh matrixWorldInverse so renderShotExtras projects the
    // heli tags through THIS shot camera, not the stale title camera
    // (it runs before the first renderer.render updates the matrices).
    camera.updateMatrixWorld();
  }
  if (barEl) barEl.textContent = built.footer;
  // Meshes for the staged records (they carry no bodies yet).
  syncWorldMeshes(0);
  if (hud) hud.update(S, city);
  // applyShot's record carries the shot id as `shot`, not `name`
  // (name lives on the inner staged object) — check built.shot.
  if (built.shot === 'systems' && window.PalmaScreens3d) {
    try {
      window.PalmaScreens3d.showSystems(S, city, { slots: Progress3d.listSaveSlots() });
      window.__pv3d.screensProbe = 'called, visible=' + window.PalmaScreens3d.systemsVisible();
    } catch (e) {
      window.__pv3d.screensProbe = 'threw: ' + (e && e.message ? e.message : e);
    }
  } else {
    window.__pv3d.screensProbe = 'skipped: shot=' + built.shot + ' screens=' + !!window.PalmaScreens3d;
  }
  renderShotExtras(built);
  // r9 A2: official screenshots always render at DPR 2, even if the
  // live-play governor has stepped down to 1.25. Left at 2 after the
  // shot: updateSky's governor re-syncs to the live ratio on the next
  // tick (it recreates itself when the live ratio mismatches).
  renderer.setPixelRatio(CFG3D.PERF.DPR_SHOT);
  renderer.shadowMap.needsUpdate = true; // one shadow pass for the shot (autoUpdate is off)
  renderer.render(scene, camera);
  const sample = sampleCanvas();
  const info = {
    shot: built.shot, seed: built.seed, mode: built.mode,
    wanted: built.wanted, cars: built.cars, peds: built.peds,
    mission: built.mission, completion: built.completion,
    nonBlank: +sample.nonBlank.toFixed(3), meanLuma: +sample.meanLuma.toFixed(1),
    screensProbe: window.__pv3d.screensProbe || null,
    errors: window.__pv3d.errors.slice()
  };
  window.__pv3d.shot = info;
  statusEl.textContent = JSON.stringify(info);
  return true;
}

// ---------------------------------------------------------------------
// Title screen (default on boot).
// ---------------------------------------------------------------------
function showTitleScreen() {
  // r12-B4: the HUD host is built at boot with its panels (vitals,
  // dispatch) already in the DOM, and the title's sky scrim is
  // translucent — so HEALTH/ARMOUR and PVPD DISPATCH bled through
  // the top edge of the title even though hud.update never runs on
  // the title. Hide the whole HUD host while the title is up; the
  // title's own DOM is the only overlay on screen.
  if (hudHost) hudHost.style.display = 'none';
  if (window.PalmaScreens3d) {
    window.PalmaScreens3d.showTitle(S, city, { selected: S.titleSlot || 0 });
  }
}

// ---------------------------------------------------------------------
// Death + hospital revive (r8, B4) — the GTA "WASTED" beat.
//   trigger: player.health hits 0 (see applyStreetDamage + the police
//     ram damage in police3d.js contactHits — both real, no debug key)
//   card: canvas snaps to greyscale + WASTED card, ~3 s hold
//   fade: to black, then respawn on foot in front of the NEAREST
//     hospital (world.hospitals), full health, wanted cleared,
//     5% of cash capped at $5,000, weapons kept, mission failed.
//   While dying the player cannot move, shoot or be re-hit: weapons,
//     movement and police updates are skipped (traffic + day/night
//     keep running behind the card); input flags are cleared so the
//     player never respawns still firing or aiming.
// ---------------------------------------------------------------------
const WASTED_HOLD_S = 3.0;    // greyscale card hold before the fade
const WASTED_RESPAWN_S = 3.8; // fade (0.6 s CSS) + margin, then respawn
let death = null; // { elapsed, fee, hospital, faded } while dying
let streetDamageT = 0; // cooldown between street-damage hits

function nearestHospital(x, z) {
  const list = world.hospitals || [];
  if (!list.length) return null;
  let best = list[0], bestD = Infinity;
  for (const h of list) {
    const d = (h.x - x) * (h.x - x) + (h.z - z) * (h.z - z);
    if (d < bestD) { bestD = d; best = h; }
  }
  return best;
}

function startDeath() {
  if (death) return;
  const p = S.player;
  const hospital = nearestHospital(p.x, p.z);
  const fee = Math.min(5000, Math.floor((p.money || 0) * 0.05));
  death = { elapsed: 0, fee: fee, hospital: hospital, faded: false };
  // Leave any vehicle where it stands; the revive is always on foot.
  const v = p.vehicle;
  if (v) {
    if (v.kind === 'heli') v.occupied = false;
    else { v.traffic = !v.hero; restoreCarDriver(v); v.speed = 0; } // r11-B3: driver back
    p.vehicle = null;
  }
  weapons.setAiming(false);
  mouseHeld = false;
  rmbHeld = false;
  // Heat clears: units stand down (police.update also stands them
  // down at wanted 0, but the beat must not wait on it).
  police.setWanted(0, p);
  S.wanted = 0;
  for (const u of police.units || []) { u.leaving = true; u.leaveT = 0; }
  if (police.heli) police.heli = null;
  if (S.missions.current) Missions3d.failMission(S, 'wasted', missionHooks);
  // The card: greyscale canvas + WASTED + hospital line.
  canvas.style.filter = 'grayscale(1) brightness(.7) contrast(.9)';
  const sub = document.getElementById('pv3d-wasted-sub');
  if (sub) sub.textContent = (hospital ? hospital.name : 'PALMA VERDE GENERAL') +
    (fee > 0 ? ' — HOSPITAL FEE $' + fee : ' — NO FEE');
  wastedEl.style.display = 'block';
  wastedFadeEl.style.display = 'block';
  wastedFadeEl.style.opacity = '0';
}

function respawnFromDeath() {
  if (!death) return;
  const d = death;
  const p = S.player;
  const hospital = d.hospital || nearestHospital(p.x, p.z);
  const spawn = hospital ? hospital.spawn : { x: city.spawns.player.x, z: city.spawns.player.z, angle: city.spawns.player.angle || 0 };
  p.money = Math.max(0, (p.money || 0) - d.fee);
  p.health = 100;
  p.x = spawn.x;
  p.z = spawn.z;
  p.angle = spawn.angle || 0;
  p.aim = p.angle;
  p.y = 0; p.vy = 0; // revive on the ground, never mid-hop
  p.vehicle = null;
  S.wanted = 0;
  weapons.setAiming(false);
  mouseHeld = false;
  rmbHeld = false;
  death = null;
  canvas.style.filter = '';
  wastedEl.style.display = 'none';
  wastedFadeEl.style.display = 'none';
  wastedFadeEl.style.opacity = '0';
  snapCamera();
  setHudMsg('REVIVED AT ' + (hospital ? hospital.name : 'PALMA VERDE GENERAL') +
    (d.fee > 0 ? ' — FEE $' + d.fee : ' — NO FEE'), 4);
}

// ---------------------------------------------------------------------
// BUSTED + police-HQ revive (r10, B6) — the arrest beat.
//   trigger (r11 B2): police3d.js applyBusted — Rey gives NO input
//     at all for 60 s while wanted (BUSTED_IDLE_S). Moving, aiming
//     or shooting resets the clock; the surround/aim/shoot pressure
//     stays, but it can no longer bust a player still fighting.
//   card: BUSTED card (no greyscale), ~3 s hold
//   fade: to black, then respawn on foot in front of the PVPD
//     HEADQUARTERS (world.policeHQ, Northgate), full health, wanted
//     cleared, mission failed. The fine was already taken by
//     police3d.js applyBusted — main3d must NOT take it again.
//   While busted the player cannot move, shoot or be re-hit, exactly
//   like the death beat; traffic + day/night keep running.
// ---------------------------------------------------------------------
const BUSTED_HOLD_S = 3.0;
const BUSTED_RESPAWN_S = 3.8;
let bustedState = null; // { elapsed, fee, hq, faded } while arrested

function nearestPoliceHQ(x, z) {
  return world.policeHQ || null;
}

function startBusted(fine) {
  if (bustedState || death) return;
  const p = S.player;
  const hq = nearestPoliceHQ(p.x, p.z);
  bustedState = { elapsed: 0, fee: fine || 0, hq: hq, faded: false };
  const v = p.vehicle;
  if (v) {
    if (v.kind === 'heli') v.occupied = false;
    else { v.traffic = !v.hero; restoreCarDriver(v); v.speed = 0; } // r11-B3: driver back
    p.vehicle = null;
  }
  weapons.setAiming(false);
  mouseHeld = false;
  rmbHeld = false;
  S.wanted = 0;
  const sub = document.getElementById('pv3d-busted-sub');
  if (sub) sub.textContent = (hq ? hq.name : 'PVPD HEADQUARTERS') +
    (bustedState.fee > 0 ? ' — FINE $' + bustedState.fee : ' — NO FINE');
  bustedEl.style.display = 'block';
  wastedFadeEl.style.display = 'block';
  wastedFadeEl.style.opacity = '0';
}

function respawnFromBusted() {
  if (!bustedState) return;
  const d = bustedState;
  const p = S.player;
  const hq = d.hq || nearestPoliceHQ(p.x, p.z);
  const spawn = hq ? hq.spawn : { x: city.spawns.player.x, z: city.spawns.player.z, angle: city.spawns.player.angle || 0 };
  p.health = 100;
  p.x = spawn.x;
  p.z = spawn.z;
  p.angle = spawn.angle || 0;
  p.aim = p.angle;
  p.y = 0; p.vy = 0;
  p.vehicle = null;
  S.wanted = 0;
  weapons.setAiming(false);
  mouseHeld = false;
  rmbHeld = false;
  bustedState = null;
  bustedEl.style.display = 'none';
  wastedFadeEl.style.display = 'none';
  wastedFadeEl.style.opacity = '0';
  snapCamera();
  setHudMsg('RELEASED AT ' + (hq ? hq.name : 'PVPD HEADQUARTERS') +
    (d.fee > 0 ? ' — FINE $' + d.fee : ' — NO FINE'), 4);
}

// Street damage (r8, B4): the two damage sources that can actually
// put the player on the ground. (1) A moving traffic car that reaches
// an on-foot player — damage SCALED with impact speed (r11-B3,
// Khase 19:43 WIB): a slow bump is a bruise, a moderate-speed
// front/back hit deals damage proportional to the impact, the harder
// the hit the more damage — never one flat value. Traffic normally
// brakes and steers around the player (traffic3d carAhead), so this
// is the safety net for stepping in front of a car already too close
// to stop; the live source is (2) the police ram in police3d.js
// contactHits, -6 per unit per second on foot, which is what grinds
// HP to 0 in a chase. (3) A fighting ped's punch — 4 damage. One
// shared 1 s cooldown so a pile-up cannot insta-kill. Parked cars
// (speed 0) never hit.
function applyStreetDamage(dt) {
  const p = S.player;
  if (p.vehicle || death) return;
  streetDamageT = Math.max(0, streetDamageT - dt);
  if (streetDamageT > 0) return;
  for (const car of S.cars || []) {
    // r11-B3: only a REAL hit hurts, and only as hard as the impact.
    // A slow car has already yielded (traffic3d stops it at the
    // bumper gap), so merely standing in its path — or it creeping
    // up to Rey — costs nothing; the hit needs the car's body
    // actually reaching Rey (carBlocksAt), not just nearness, and a
    // car under CAR_HIT_SPEED (4 m/s) never hurts at all.
    const spd = car ? Math.abs(car.speed || 0) : 0;
    if (!car || spd < CAR_HIT_SPEED) continue;
    if (!carBlocksAt(car, p.x, p.z)) continue;
    // Damage curve (Khase 19:43, traffic3d carHitDamage): 4 at the
    // 4 m/s threshold, +2 per m/s above it, capped at 60 — a 12 m/s
    // hit deals 20, a 20 m/s hit 36, a 30 m/s hit 56. WASTED follows
    // from the health check in the tick (health <= 5), as before.
    // Knockback scales the same way: a harder hit throws Rey further.
    const dmg = carHitDamage(spd);
    const push = carHitKnockback(spd);
    const dx = p.x - car.x, dz = p.z - car.z;
    const d = Math.hypot(dx, dz) || 1;
    p.x += (dx / d) * push + Math.cos(car.angle || 0) * 1.2;
    p.z += (dz / d) * push + Math.sin(car.angle || 0) * 1.2;
    weapons.takeDamage(Math.round(dmg));
    streetDamageT = 1;
    setHudMsg('HIT BY A CAR');
    return;
  }
  for (const ped of S.peds || []) {
    if (ped && ped.mode === 'fight' && Math.hypot(ped.x - p.x, ped.z - p.z) < 2.2) {
      weapons.takeDamage(4);
      streetDamageT = 1;
      return;
    }
  }
}

// ---------------------------------------------------------------------
// Game loop. Live mode steps input, physics, traffic, police,
// missions, day/night, radio and the HUD at 15 Hz. Shot mode renders
// one frozen frame and stops.
// ---------------------------------------------------------------------
const clock = new THREE.Clock();
let hudAcc = 0;
let bustedWarnAt = 0; // r11-B2: last BUSTED-countdown warning (S.time)
let booted = false;
let frameNo = 0; // shadow map updates on even frames only (see above)
// r11-B1: true while the title's golden-hour grade is pinned (set in
// the title branch of tick, cleared in startGameFromTitle).
let titlePinned = false;

function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.1);
  if (shotMode) return;
  if ((frameNo++ & 1) === 0) renderer.shadowMap.needsUpdate = true;
  S.time += dt;
  const p = S.player;

  if (S.screen === 'playing') {
    // Day/night + radio. daynight.update applies the grade to the
    // sky itself through the adapter (gradeKey, not the 'Morning'
    // label — setTimeOfDay only knows the key); the tick only reads
    // the clock and the track back.
    daynight.update(dt);
    clockHours = daynight.hour;
    currentGrade = daynight.grade;
    S.clockMinutes = daynight.minutes();
    radio.update(dt);
    S.radioStation = radio.stationIndex;
    S.radioTrack = radio.nowPlaying();

    // While dying the world stays alive but the player is frozen:
    // no aim, no movement, no police — only traffic + day/night
    // behind the card, then the fade and the hospital revive.
    if (death) {
      death.elapsed += dt;
      traffic.update(dt, p, { time: S.time, nightF: daynight.stars });
      S.cars = traffic.cars;
      S.peds = traffic.peds;
      if (death.elapsed >= WASTED_HOLD_S && !death.faded) {
        death.faded = true;
        wastedFadeEl.style.opacity = '1';
      }
      if (death.elapsed >= WASTED_RESPAWN_S) respawnFromDeath();
    } else if (bustedState) {
      // Arrested: same frozen beat as death (traffic + day/night
      // behind the card), then the fade and the HQ respawn.
      bustedState.elapsed += dt;
      traffic.update(dt, p, { time: S.time, nightF: daynight.stars });
      S.cars = traffic.cars;
      S.peds = traffic.peds;
      if (bustedState.elapsed >= BUSTED_HOLD_S && !bustedState.faded) {
        bustedState.faded = true;
        wastedFadeEl.style.opacity = '1';
      }
      if (bustedState.elapsed >= BUSTED_RESPAWN_S) respawnFromBusted();
    } else {
    // Aim only while the right mouse button is held, on foot.
    // weapons.setAiming is the one writer of the aiming flag: the
    // loop never assigns p.aiming itself, so it cannot disagree
    // with the input binder about whether the player is aiming.
    // With no RMB held the player faces the movement direction
    // instead (stepOnFoot only turns to the aim while aiming).
    // weapons.update still steers p.aim at the cursor every frame,
    // so pressing RMB aims instantly with no snap; the trigger
    // below is what actually gates the shot. In a vehicle the
    // drive-by keeps its old behaviour: LMB fires from the car
    // with no RMB needed, and aiming stays off.
    // r11-B3: during the carjack aim phase Rey holds the aim pose
    // (the scene, not the mouse, is aiming); otherwise aim only
    // while the right mouse button is held, on foot.
    const wantAim = !p.vehicle && (rmbHeld || !!(carjack && carjack.phase === 'aim')) && !!mouseWorld;
    weapons.setAiming(wantAim);
    weapons.update(dt, {
      aimX: mouseWorld ? mouseWorld.x : p.x + Math.cos(p.aim),
      aimZ: mouseWorld ? mouseWorld.z : p.z + Math.sin(p.aim),
      firing: mouseHeld && (!!p.vehicle || wantAim),
      pressed: false
    });

    // Movement. A carjack freezes Rey on the spot while the scene
    // runs (r11-B3) — the timer, not input, advances it.
    if (carjack) updateCarjack(dt);
    else if (p.vehicle && p.vehicle.kind === 'heli') stepGull(dt);
    else if (p.vehicle) stepCar(dt);
    else stepOnFoot(dt);

    // Traffic + police.
    traffic.update(dt, p, { time: S.time, nightF: daynight.stars });
    police.update(dt, p, {
      time: S.time,
      missionId: S.missions.current,
      onWanted: function (w) { S.wanted = w; },
      onBusted: function (info) {
        // r10 B6: the fine was already taken by police3d.js
        // applyBusted — taking it here again double-charged Rey.
        // The arrest beat (card + HQ respawn) starts here; the
        // mission fails via onMissionFailed below.
        startBusted(info.fine || 0);
      },
      onMissionFailed: function (reason) { Missions3d.failMission(S, reason, missionHooks); },
      onEvent: function (st, kind, payload) {
        if (kind === 'dialogue' && payload && payload.line) setDialogue(payload.who || 'PVPD', payload.line);
      }
    });
    S.wanted = police.wanted;
    S.cars = traffic.cars;
    S.peds = traffic.peds;

    // Crew cooldowns.
    Crew3d.tickCrew(S, dt, Date.now());

    // Mission stage checks.
    const stage = Missions3d.currentStage(S);
    if (stage) {
      if ((stage.type === 'drive-to' || stage.type === 'pickup' || stage.type === 'escort') && nearTarget(14)) {
        Missions3d.reportArrival(S, missionHooks);
      } else if (stage.type === 'shoot' && S.missionKills >= 3) {
        Missions3d.reportCombat(S, missionHooks);
      } else if (stage.type === 'race') {
        if (nearTarget(14)) Missions3d.reportRace(S, missionHooks, true);
        else if (S.raceDeadline && S.time > S.raceDeadline) Missions3d.reportRace(S, missionHooks, false);
      }
    }

    // Street damage, then the death trigger. r10 B6: below 5 HP Rey
    // falls — hit or not, the body goes down and lies WASTED; there
    // is no "alive at 3 HP, still standing" state.
    applyStreetDamage(dt);
    if (S.player.health <= 5) startDeath();
    } // end of the else (not dying)

    // District + standing for the HUD chip.
    const d = districtAt(p.x, p.z);
    S.district = d || null;
    S.cam = { x: p.x, z: p.z };

    // Chase camera follows the hero.
    const hero = heroDescriptor();
    chase.update(dt, hero);

    // Expiry.
    if (S.dialogue && S.time > dialogueUntil) clearDialogue();
    if (S.banner && S.time > bannerUntil) hideBanner();
    if (hudMsgUntil && S.time > hudMsgUntil) { setHudLine(''); hudMsgUntil = 0; }

    // HUD at 15 Hz.
    hudAcc += dt;
    if (hudAcc > 1 / 15) {
      hudAcc = 0;
      if (hud) hud.update(S, city);
      // r11-B2: idle-BUSTED countdown — a quiet warning in the
      // last 10 s of the minute, only when no transient message
      // is up, re-armed every 4 s (warns ~10 s, ~6 s, ~2 s).
      if (!hudMsgUntil || S.time > hudMsgUntil) {
        const bi = police.hud().bustedIn;
        if (typeof bi === 'number' && bi <= 10 && S.time - bustedWarnAt > 4) {
          bustedWarnAt = S.time;
          setHudMsg('PVPD CLOSING IN — MOVE OR BE BUSTED IN ' + Math.ceil(bi) + 's', 3);
        }
      }
    }
  } else if (S.screen === 'paused') {
    // Frozen world behind the systems screen; keep the sky alive.
    updateSky(scene, dt);
  } else if (S.screen === 'title') {
    // r11-B1: LIVE TITLE — a slow golden-hour camera loop over the
    // beach/boardwalk, grade pinned to 17.5 (afternoon) so the title
    // never cycles into night mid-menu. 48 s ping-pong loop (24 s
    // out, 24 s back, smoothstep eased), camera over the shoreline
    // looking east into the city; clouds drift via updateSky and
    // traffic keeps moving so the frame has street life. The clock
    // restore on game start lives in startGameFromTitle.
    if (!titlePinned) {
      daynight.setTime(17.5);
      clockHours = 17.5;
      titlePinned = true;
    }
    updateSky(scene, dt);
    traffic.update(dt, p, { time: S.time, nightF: daynight.stars });
    S.cars = traffic.cars;
    S.peds = traffic.peds;
    const titleT = S.time % 48;
    const titlePh = titleT < 24 ? titleT / 24 : (48 - titleT) / 24;
    const titleE = titlePh * titlePh * (3 - 2 * titlePh);
    camera.position.set(-1560 + titleE * 120, 46 + Math.sin(titleE * Math.PI) * 10, -320 + titleE * 420);
    camera.lookAt(-700, 18, 40);
    if (Math.abs(camera.fov - 42) > 0.01) { camera.fov = 42; camera.updateProjectionMatrix(); }
  }

  // Aim overlay: crosshair + targeted-ped health bar. Runs every
  // frame (not at HUD 15 Hz) so the crosshair tracks the mouse and
  // the bar tracks a moving ped; it hides itself whenever the
  // player is not aiming, dead, driving, paused or on the title.
  updateAimOverlay();

  syncWorldMeshes(dt);
  renderer.render(scene, camera);
}

// ---------------------------------------------------------------------
// Boot.
// ---------------------------------------------------------------------
function boot() {
  // B1's loading overlay hands over to the HUD.
  const hudBox = document.getElementById('hud');
  if (hudBox) hudBox.style.display = 'none';

  // Traffic starts populated so the first frame already has a city.
  traffic.ensureLife(S.player);
  S.cars = traffic.cars;
  S.peds = traffic.peds;

  // The staged 48% profile lives in the seeded save slots; the live
  // game starts clean (0% / Runner) — see freshState above.
  refreshFreeMarker();

  const inShot = setupShotMode();
  if (!inShot) {
    showTitleScreen();
    window.__pv3d.shot = { shot: 'title', ok: true, errors: window.__pv3d.errors.slice() };
    statusEl.textContent = JSON.stringify(window.__pv3d.shot);
  }
  window.__pv3d.booted = true;
  window.__pv3d.modules = {
    hud: !!hud,
    screens: !!window.PalmaScreens3d,
    shots: !!window.PalmaShots3d,
    missions: !!Missions3d,
    police: !!police,
    crew: !!Crew3d,
    weapons: !!weapons,
    traffic: !!traffic,
    daynight: !!daynight,
    radio: !!radio,
    garage: !!Garage3d
  };
  setHudLine('');
  tick();
}

window.__palma3d = {
  scene: scene,
  camera: camera,
  renderer: renderer,
  world: world,
  sky: sky,
  state: state,
  city: city,
  traffic: traffic,
  police: police,
  weapons: weapons,
  radio: radio,
  daynight: daynight,
  progress: progress,
  chase: chase,
  hud: hud,
  get clockHours() { return clockHours; },
  get deathActive() { return !!death; },
  get bustedActive() { return !!bustedState; },
  setClockHours: function (h) { clockHours = h; daynight.setTime(h); }
};

try {
  boot();
} catch (e) {
  reportError('boot failed: ' + (e && e.message ? e.message : e));
  throw e;
}
