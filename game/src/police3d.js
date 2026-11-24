// police3d.js — wanted level, PVPD response, dispatch board, AIR-1.
//
// Stars on the HUD are only half the system: behind them sits the
// dispatch board — named units, a tactic each, a live distance — and
// the cruisers, bikes, foot officers and the helicopter that actually
// come for Rey. Firing a weapon in public raises the heat within
// about a second, and the heat keeps rising while Rey keeps shooting.
// Units are dispatched in a stagger, never all at once, and they
// DRIVE to the scene from roads a few blocks away — they never appear
// on top of him. Once on scene they pursue with a named tactic each
// (PIT, RAMMING, FLANKING, ROADBLOCK, SPOTLIGHT), and when every unit
// loses line of sight they fall back to SEARCHING the last place Rey
// was seen. Escape means breaking sight AND distance, not outrunning
// a timer: stars blink out one at a time only while nobody can see
// him and the nearest unit is far away. Get caught on foot and it is
// BUSTED — the mission fails, the PVPD takes a fine, and the heat
// clears. One star is a foot officer and a patrol car; five stars is
// the whole department plus the helicopter overhead.
//
// Units are metres and seconds. The 2D design measured the city in
// world units at roughly 2 units to the metre, so its distances are
// halved here (spawn ring 90–450 m, bust distance 15 m, heli orbit
// 95 m). All the timings are carried over unchanged: dispatch first
// unit 0.5 s, one more every 0.9 s, heli 4 s after the third star,
// search after 2 s unseen, a star blinks out after 8 s unseen,
// bust hold 1.2 s.
//
// World handle (B1's world3d, duck-typed — every method is optional
// and a 200 m road-grid fallback from CFG3D stands in when it is
// missing): isSolid(x, z), randomRoadSpot(rng), nearestRoadPoint(x, z),
// roadAt(x, z) -> { axis: 'x' | 'z' }.
// Vehicles factory (B2, optional): either a generic spawn(kind, x, z,
// angle), or B2's own createTrafficCar(color) / createHeli(). When
// no factory is supplied the unit itself is the source of truth and
// `body` is null; B4 reads unit.x / unit.z / unit.angle to place
// meshes. When a factory IS supplied, the THREE group is synced every
// frame (position + rotation.y = -angle, model faces +X).
//
// update(dt, player, events):
//   player: { x, z, angle, health, armour, money,
//             vehicle: { kind: 'car'|'heli', damage, speed, angle } | null }
//   events: { time, gunfire: { x, z, hitPolice } | null,
//             crime: 'assault' | 'ram-police' | null,
//             missionId, onEvent(kind, payload),
//             onBusted({ fine, missionId }), onMissionFailed(reason),
//             onWanted(level) }
// Dispatch call-signs use OUR pool only: HALCON, BRISA, FARO, MONZON
// (plus AIR-1 for the helicopter and PVPD as the department name).

import { CFG3D as CFG } from './config3d.js';
import * as THREE from '../vendor/three.module.min.js';

const CALLSIGNS = ['HALCON', 'BRISA', 'FARO', 'MONZON'];
const TACTIC_CYCLE = ['PIT', 'RAMMING', 'ROADBLOCK', 'FLANKING', 'PIT', 'PURSUIT'];
const MAX_UNITS = 5;
const MAX_GROUND = 10;
const MAX_WANTED = 6; // r10 B6: the heat goes to six stars
const MAX_FOOT = 8; // r10 B6: cap on foot officers on the street at once
const HELI_STARS = 3;
const HELI2_STARS = 6; // r10 B6: the second helicopter only at six stars
const HELI_ORBIT = 95; // metres, heli orbit radius around the player
// r10 B6 — the standoff: when Rey stops moving, cruisers park and their
// crews get out, surround him at pistol range and shoot. Hold still
// surrounded for BUSTED_STILL_S and it is BUSTED.
const BUSTED_STILL_S = 6; // seconds still, surrounded, before BUSTED
const SURROUND_RING = 10; // metres — the ring officers hold around Rey
const OFFICER_FIRE_RANGE = 40; // metres — pistol range from an officer
const OFFICER_FIRE_DMG = 2; // HP per officer pistol hit (armour absorbs 60%)
const OFFICER_FIRE_GAP = 0.9; // seconds between shots per officer
const HELI_FIRE_RANGE = 120; // metres — a heli shoots from its orbit
const HELI_FIRE_DMG = 2;
const HELI_FIRE_GAP = 1.5;

const DISPATCH_FIRST = 0.5;
const DISPATCH_GAP = 0.9;
const HELI_DELAY = 4;
const SIGHT_CAR = 260; // metres a cruiser or bike can spot Rey
const SIGHT_FOOT = 180;
const SIGHT_HELI = 300;
const SEARCH_DELAY = 2;
const ESCAPE_UNSEEN = 8;
const ESCAPE_DIST = 180; // nearest unit must be further than this to escape
const ESCALATE_SHOTS = 4;
const ESCALATE_GAP = 5;
const BUST_DIST = 15; // metres — the 2D design's 30u at ~2u per metre
const BUST_HOLD = 1.2;
const FOOT_SPEED = 5; // m/s, an officer runs at Rey's run speed
const CRUISER_TOP = 40; // m/s
const BIKE_TOP = 46; // m/s
const SPAWN_MIN = 90; // never closer than this to the player
const SPAWN_MAX = 450;

// ---- LAPD black-and-white livery + flashing sirens (r8, B3) ------------
// A cruiser is a traffic car underneath (vehicles.spawn hands back a
// random palette colour — the colour argument never reaches it), so
// the livery is applied here, on the finished body: the paint is
// re-identified by geometry (main body 4.6 x 0.55 x 2.0, skirt
// 4.4 x 0.22 x 1.9) and re-dyed black, white door panels + a PVPD
// door plate are added on both flanks, and a roof bar carries red /
// blue lenses. The strobe is a shared 0.4 s square wave (2.5 Hz):
// red on, brief both-off gap, blue on, gap — the two sides never
// flash together. Glow sprites + an alternating ground pool do the
// long-distance read (the r6 headlight technique); there is no real
// PointLight per car. Everything here is guarded: in Node (self-test)
// there is no document and the stub bodies have no traverse/add, so
// dressPoliceCruiser returns null and the logic runs bare.
const POLICE_BLACK = 0x0c0d10;
const POLICE_SKIRT = 0x07080a;
const POLICE_WHITE = 0xe8e8e8;
const SIREN_PERIOD = 0.4; // seconds per red+blue cycle (~2.5 Hz)
const CAR_HALF_LEN = 2.3; // metres, same 4.6 m body as traffic cars
const CAR_HALF_WID = 1.0;
const PLAYER_RADIUS = 0.5; // same radius as main3d's footBlockedAt

let sharedSirenGlowTex = null;
function sirenGlowTexture() {
  if (sharedSirenGlowTex) return sharedSirenGlowTex;
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 2, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.3, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.7, 'rgba(255,255,255,0.12)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  sharedSirenGlowTex = tex;
  return tex;
}

let sharedPvpdTex = null;
function pvpdDoorTexture() {
  if (sharedPvpdTex) return sharedPvpdTex;
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 256, 64);
  g.fillStyle = '#0c0d10';
  g.font = 'bold 40px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('PVPD', 128, 24);
  g.font = 'bold 17px sans-serif';
  g.fillText('P O L I C E', 128, 52);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  sharedPvpdTex = tex;
  return tex;
}

// Dress a finished traffic-car body as a PVPD cruiser. Returns the
// siren handles (lens materials, glow sprites, ground pools) for the
// per-frame strobe, or null when the body is not a real THREE group.
function dressPoliceCruiser(body) {
  if (!body || typeof body.add !== 'function' || typeof body.traverse !== 'function') return null;
  // Black paint: re-dye the shared body + skirt materials, found by
  // their box size so the random palette colour does not matter.
  let bodyMat = null;
  let skirtMat = null;
  body.traverse((o) => {
    if (!o || !o.geometry || !o.geometry.parameters || !o.material) return;
    const p = o.geometry.parameters;
    if (p.width === 4.6 && p.height === 0.55 && p.depth === 2.0) bodyMat = o.material;
    if (p.width === 4.4 && p.height === 0.22 && p.depth === 1.9) skirtMat = o.material;
  });
  if (bodyMat && bodyMat.color && typeof bodyMat.color.setHex === 'function') {
    bodyMat.color.setHex(POLICE_BLACK);
  }
  if (skirtMat && skirtMat.color && typeof skirtMat.color.setHex === 'function') {
    skirtMat.color.setHex(POLICE_SKIRT);
  }
  // The leaning body subgroup is the first Group child (buildCar
  // adds it first); livery + bar lean with the suspension. The
  // ground pools go on the top group so they stay on the asphalt.
  let inner = body;
  if (Array.isArray(body.children)) {
    for (const ch of body.children) {
      if (ch && ch.isGroup) { inner = ch; break; }
    }
  }
  const whiteMat = new THREE.MeshStandardMaterial({
    color: POLICE_WHITE, roughness: 0.35, metalness: 0.6,
  });
  const doorTex = pvpdDoorTexture();
  for (const s of [1, -1]) {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.48, 0.03), whiteMat);
    panel.position.set(-0.15, 0.58, 1.015 * s);
    inner.add(panel);
    if (doorTex) {
      const plate = new THREE.Mesh(
        new THREE.PlaneGeometry(1.25, 0.31),
        new THREE.MeshBasicMaterial({ map: doorTex, transparent: true, depthWrite: false }),
      );
      plate.position.set(-0.15, 0.58, 1.035 * s);
      if (s < 0) plate.rotation.y = Math.PI;
      inner.add(plate);
    }
  }
  // Roof light bar: dark base, red lens one side, blue the other,
  // steady white takedown lens in the middle.
  const barBase = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.10, 1.30),
    new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.4, metalness: 0.6 }),
  );
  barBase.position.set(-0.15, 1.46, 0);
  inner.add(barBase);
  const redMat = new THREE.MeshStandardMaterial({
    color: 0x550000, emissive: 0xff1a1a, emissiveIntensity: 0.15, roughness: 0.3, metalness: 0.1,
  });
  const blueMat = new THREE.MeshStandardMaterial({
    color: 0x000a55, emissive: 0x1a3cff, emissiveIntensity: 0.15, roughness: 0.3, metalness: 0.1,
  });
  const redLens = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.09, 0.56), redMat);
  redLens.position.set(-0.15, 1.47, 0.32);
  inner.add(redLens);
  const blueLens = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.09, 0.56), blueMat);
  blueLens.position.set(-0.15, 1.47, -0.32);
  inner.add(blueLens);
  const takeMat = new THREE.MeshStandardMaterial({
    color: 0x555544, emissive: 0xfff2c0, emissiveIntensity: 0.6, roughness: 0.3, metalness: 0.1,
  });
  const takeLens = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.08, 0.14), takeMat);
  takeLens.position.set(-0.15, 1.47, 0);
  inner.add(takeLens);
  // A-pillar spotlight on the driver's flank: a small white cylinder
  // + a steady emissive dot.
  const spot = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.06, 0.22, 10),
    new THREE.MeshStandardMaterial({ color: 0xd8d8d8, roughness: 0.3, metalness: 0.8 }),
  );
  spot.rotation.x = Math.PI / 2;
  spot.position.set(0.75, 1.18, 1.04);
  inner.add(spot);
  const spotDot = new THREE.Mesh(
    new THREE.SphereGeometry(0.035, 8, 8),
    new THREE.MeshStandardMaterial({
      color: 0x444422, emissive: 0xfff2c0, emissiveIntensity: 1.2, roughness: 0.3, metalness: 0.1,
    }),
  );
  spotDot.position.set(0.75, 1.18, 1.16);
  inner.add(spotDot);
  // Glow sprites at the bar ends + one red / one blue ground pool.
  // Without a glow texture (Node) the lenses still strobe.
  const glowTex = sirenGlowTexture();
  let redSprite = null;
  let blueSprite = null;
  let redPool = null;
  let bluePool = null;
  if (glowTex) {
    const mkSprite = (color, z) => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTex, color, transparent: true, opacity: 0.04,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      sp.scale.set(1.7, 1.7, 1);
      sp.position.set(-0.15, 1.55, z);
      inner.add(sp);
      return sp;
    };
    redSprite = mkSprite(0xff2a2a, 0.55);
    blueSprite = mkSprite(0x2a55ff, -0.55);
    const mkPool = (color) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(5.2, 3.6),
        new THREE.MeshBasicMaterial({
          map: glowTex, color, transparent: true, opacity: 0.02,
          blending: THREE.AdditiveBlending, depthWrite: false,
        }),
      );
      m.rotation.x = -Math.PI / 2;
      m.position.set(0, 0.06, 0);
      m.renderOrder = 1;
      body.add(m);
      return m;
    };
    redPool = mkPool(0xff2222);
    bluePool = mkPool(0x2244ff);
  }
  return { redMat, blueMat, redSprite, blueSprite, redPool, bluePool };
}

// ---- police car vs on-foot player contact (r8, B3) ---------------------
// r7's footBlockedAt stops the PLAYER walking into a car; it does
// nothing about a MOVING police car driving through a standing
// player. That is closed here, inside the police update: a cruiser
// that reaches the player stops dead and shoves the player clear to
// the side — it never passes through. Only the on-foot player: when
// Rey is driving, contactHits already bends his car and cuts its
// speed, and pursuit behaviour there stays exactly as it was.
// Overlap test in the car's local frame: nose axis + flank axis,
// half extents plus the player's radius.
function carPlayerOverlap(unit, player) {
  if (!player || player.vehicle) return null;
  if (typeof player.x !== 'number' || typeof player.z !== 'number') return null;
  const dx = player.x - unit.x;
  const dz = player.z - unit.z;
  const c = Math.cos(unit.angle);
  const s = Math.sin(unit.angle);
  const lx = dx * c + dz * s;
  const lz = -dx * s + dz * c;
  const ex = CAR_HALF_LEN + PLAYER_RADIUS;
  const ez = CAR_HALF_WID + PLAYER_RADIUS;
  if (Math.abs(lx) >= ex || Math.abs(lz) >= ez) return null;
  return { lx, lz, penX: ex - Math.abs(lx), penZ: ez - Math.abs(lz) };
}

// Shove the player clear of the car's footprint, to the side first
// (out of the car's path, not along it), then nose/tail if the sides
// are blocked. Never pushes the player into a building: each
// candidate is checked against the world, and if every side is solid
// the player is left where they are — the car is stopped anyway, and
// main3d's anti-trap rule lets them walk out.
function pushPlayerOut(unit, player, ov, isSolid) {
  const c = Math.cos(unit.angle);
  const s = Math.sin(unit.angle);
  const fx = c;
  const fz = s;
  const sx = -s;
  const sz = c;
  const sideSign = ov.lz >= 0 ? 1 : -1;
  const noseSign = ov.lx >= 0 ? 1 : -1;
  const d = ov.penZ + 0.05;
  const e = ov.penX + 0.05;
  const tries = [
    [sx * sideSign * d, sz * sideSign * d],
    [-sx * sideSign * d, -sz * sideSign * d],
    [fx * noseSign * e, fz * noseSign * e],
    [-fx * noseSign * e, -fz * noseSign * e],
  ];
  for (const [px, pz] of tries) {
    const nx = player.x + px;
    const nz = player.z + pz;
    if (!isSolid(nx, nz)) {
      player.x = nx;
      player.z = nz;
      return true;
    }
  }
  return false;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function dist2(ax, az, bx, bz) {
  const dx = ax - bx;
  const dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

function angDiff(a, b) {
  const twoPi = Math.PI * 2;
  let d = (b - a) % twoPi;
  if (d > Math.PI) d -= twoPi;
  if (d < -Math.PI) d += twoPi;
  return d;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- world fallbacks (200 m road grid from CFG3D) ----------------------
// Roads run on centrelines at multiples of CFG.BLOCK. A point is on a
// road when it is within half the road width of a centreline; a point
// inside the city grid but off every road is inside a building block.

function gridRoadAt(x, z) {
  const block = CFG.BLOCK || 200;
  const half = (CFG.ROAD_WIDTH || 14) / 2 + (CFG.SIDEWALK || 4);
  const nx = Math.round(x / block) * block;
  const nz = Math.round(z / block) * block;
  const dx = Math.abs(x - nx);
  const dz = Math.abs(z - nz);
  if (dx <= half && dx <= dz) return { axis: 'z', line: nx };
  if (dz <= half && dz <= dx) return { axis: 'x', line: nz };
  return null;
}

function gridIsSolid(x, z) {
  const half = CFG.CITY_HALF || 1400;
  if (Math.abs(x) > half || Math.abs(z) > half) return false;
  return gridRoadAt(x, z) === null;
}

function gridRoadSpot(rng) {
  const block = CFG.BLOCK || 200;
  const half = CFG.CITY_HALF || 1400;
  const lines = [];
  for (let k = -Math.floor(half / block); k <= Math.floor(half / block); k++) lines.push(k * block);
  const alongX = rng() < 0.5;
  const line = lines[Math.floor(rng() * lines.length)];
  const along = -half + rng() * 2 * half;
  if (alongX) return { x: along, z: line, angle: rng() < 0.5 ? 0 : Math.PI };
  return { x: line, z: along, angle: rng() < 0.5 ? Math.PI / 2 : -Math.PI / 2 };
}

function makeWorld(world) {
  const w = world || {};
  return {
    isSolid: typeof w.isSolid === 'function' ? w.isSolid.bind(w) : gridIsSolid,
    roadAt: typeof w.roadAt === 'function' ? w.roadAt.bind(w) : gridRoadAt,
    randomRoadSpot: typeof w.randomRoadSpot === 'function'
      ? w.randomRoadSpot.bind(w)
      : (rng) => gridRoadSpot(rng),
    nearestRoadPoint: typeof w.nearestRoadPoint === 'function'
      ? w.nearestRoadPoint.bind(w)
      : (x, z) => {
        const block = CFG.BLOCK || 200;
        const nx = Math.round(x / block) * block;
        const nz = Math.round(z / block) * block;
        return Math.abs(x - nx) < Math.abs(z - nz) ? { x: nx, z } : { x, z: nz };
      },
    // B1's world object also carries these; the traffic-light logic
    // below reads them so our reds match the 3D light meshes.
    junctions: Array.isArray(w.junctions) ? w.junctions : null,
    trafficLights: Array.isArray(w.trafficLights) ? w.trafficLights : null,
    setWindowGlow: typeof w.setWindowGlow === 'function' ? w.setWindowGlow.bind(w) : null,
    setLampGlow: typeof w.setLampGlow === 'function' ? w.setLampGlow.bind(w) : null,
  };
}

// Build a body (THREE group) for a unit, using whichever factory B2
// supplied: a generic spawn(kind, x, z, angle), or B2's own
// createTrafficCar(color) / createHeli(). Returns null when no
// factory is present — the unit stays a pure logic record and B4
// reads unit.x / unit.z / unit.angle to place meshes.
// Forward-axis convention: the model is assumed to face +X, so a
// heading `angle` (atan2 in the x/z plane) maps to rotation.y =
// -angle. B4 must adjust if B2's models face +Z instead.
function makeBody(vehicles, kind, x, z, angle, color) {
  if (!vehicles) return null;
  let body = null;
  if (typeof vehicles.spawn === 'function') body = vehicles.spawn(kind, x, z, angle);
  else if (kind === 'heli' && typeof vehicles.createHeli === 'function') body = vehicles.createHeli();
  else if (typeof vehicles.createTrafficCar === 'function') body = vehicles.createTrafficCar(color);
  if (!body) return null;
  syncBodyPos(body, x, z, angle);
  return body;
}

function syncBodyPos(body, x, z, angle) {
  if (!body) return;
  body.x = x;
  body.z = z;
  body.angle = angle;
  if (body.position && typeof body.position.set === 'function') {
    body.position.set(x, body.position.y || 0, z);
  }
  if (body.rotation) body.rotation.y = -angle;
}

// What the heat buys, by star level (r10 B6, Khase's spec). A spec is
// { kind, role, tactic, crew }: every cruiser carries `crew` officers
// aboard (front + back seat) who get out and surround Rey when he
// stops moving; the `foot` entries are officers walking in from the
// pedestrian paths. 1 star: 1 cruiser (2 aboard) + 2 walk-ins. 2 stars:
// 2 cruisers (2 aboard each) + 2 walk-ins. 3+: one more cruiser and
// walk-in per star, AIR-1 from 3 stars, a second helicopter at 6.
// Foot officers on the street are capped at MAX_FOOT by the deploy
// step, so six stars never floods the scene.
export function desiredComposition(wanted) {
  const comp = [];
  if (wanted <= 0) return comp;
  const cruisers = Math.min(wanted, 6);
  const walkIns = Math.min(2 + Math.max(0, wanted - 2), 4);
  for (let i = 0; i < cruisers; i++) {
    comp.push({
      kind: 'cruiser', role: 'chase', tactic: TACTIC_CYCLE[i % TACTIC_CYCLE.length], crew: 2,
    });
  }
  for (let i = 0; i < walkIns; i++) {
    comp.push({ kind: 'foot', role: 'foot', tactic: 'PURSUIT', crew: 0 });
  }
  return comp.slice(0, MAX_GROUND);
}

export function createPoliceSystem(world, vehicles) {
  const w = makeWorld(world);
  const sys = {
    world: w,
    vehicles: vehicles || null,
    units: [],
    heli: null,
    heli2: null,
    queue: [],
    heat: { shots: 0, lastShotT: 0, shotsSinceEsc: 0, lastEscT: -99, shotPolice: false },
    pendingWanted: null,
    lastSeen: null,
    unseenT: 0,
    searching: false,
    heliAt: 0,
    heli2At: 0,
    busted: null,
    bustedT: 0, // r10 B6: seconds Rey has held still while surrounded
    playerStill: false, // r10 B6: Rey (on foot or in a stopped car) is not moving
    playerSpeed: 0,
    movingT: 0, // r10 B6: continuous seconds of movement — a single
    // shove frame (a cruiser pushing Rey clear) must not break the
    // standoff; stillness only breaks after 0.5 s of real movement
    prevPX: null,
    prevPZ: null,
    spawnSeq: 0,
    time: 0,
    wanted: 0,
  };

  function callsign(idx) {
    const n = sys.spawnSeq++;
    return `${CALLSIGNS[(idx + n) % CALLSIGNS.length]}-${n + 1}`;
  }

  // A road spot a few blocks from the player, never on top of him.
  // Keeps the best candidate tried (closest to the middle of the
  // ring); if every candidate is out of range, the spot is pulled
  // onto the ring at mid distance and snapped to the nearest road,
  // so a spawn never lands a kilometre away.
  function sceneSpot(player, rng, minD, maxD) {
    const mid = (minD + maxD) / 2;
    let best = null;
    let bestScore = Infinity;
    for (let tries = 0; tries < 12; tries++) {
      const s = w.randomRoadSpot(rng);
      const d = dist2(s.x, s.z, player.x, player.z);
      if (d > minD && d < maxD) return s;
      const score = Math.abs(d - mid);
      if (score < bestScore) { bestScore = score; best = s; }
    }
    if (best) {
      const d = dist2(best.x, best.z, player.x, player.z);
      if (d < minD || d > maxD) {
        const a = Math.atan2(best.z - player.z, best.x - player.x);
        const snap = w.nearestRoadPoint(player.x + Math.cos(a) * mid, player.z + Math.sin(a) * mid);
        return { x: snap.x, z: snap.z, angle: a + Math.PI };
      }
      return best;
    }
    return w.randomRoadSpot(rng);
  }

  // Is the straight segment from (ax, az) to (bx, bz) clear of
  // buildings? Sampled every 20 m, like line of sight.
  function segmentClear(ax, az, bx, bz) {
    const d = dist2(ax, az, bx, bz);
    const steps = Math.max(1, Math.ceil(d / 20));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (w.isSolid(ax + (bx - ax) * t, az + (bz - az) * t)) return false;
    }
    return true;
  }

  // Grid navigation: the point to actually steer at. When the direct
  // line to the target is clear, that IS the target. When a block is
  // in the way, the unit follows the road grid: a breadth-first
  // search over the junction graph (15 x 15, so it costs nothing)
  // from the unit's nearest junction to the target's, and the
  // waypoint is the first junction on the shortest path — reached via
  // the unit's own nearest junction first, since the BFS step assumes
  // the unit starts AT a junction. The chosen waypoint STICKS until
  // the unit reaches it (12 m) or the target moves far away, so a
  // unit never flip-flops between two junctions on a boundary.
  function navigateTarget(unit, tx, ty) {
    if (segmentClear(unit.x, unit.z, tx, ty)) {
      unit.navWp = null;
      unit.navWpFor = null;
      return { x: tx, z: ty };
    }
    if (unit.navWp && unit.navWpFor) {
      const moved = dist2(tx, ty, unit.navWpFor.x, unit.navWpFor.z);
      const left = dist2(unit.x, unit.z, unit.navWp.x, unit.navWp.z);
      if (moved <= 60 && left > 12) return unit.navWp;
      unit.navWp = null;
      unit.navWpFor = null;
    }
    const road = w.roadAt(unit.x, unit.z);
    let wp;
    if (!road) {
      wp = w.nearestRoadPoint(unit.x, unit.z);
    } else {
      const block = CFG.BLOCK || 200;
      const n = Math.round((CFG.CITY_HALF || 1400) / block);
      const ujx = Math.round(unit.x / block);
      const ujz = Math.round(unit.z / block);
      const tjx = Math.round(tx / block);
      const tjz = Math.round(ty / block);
      if (ujx === tjx && ujz === tjz) {
        wp = { x: tx, z: ty };
      } else {
        // First reach the unit's own nearest junction — the BFS step
        // assumes the unit starts AT a junction, and steering
        // diagonally at a far junction cuts straight through the
        // block in between.
        const uj = { x: ujx * block, z: ujz * block };
        if (dist2(unit.x, unit.z, uj.x, uj.z) > 15) {
          wp = uj;
        } else {
          const key = (a, b) => `${a},${b}`;
          const prev = new Map();
          const queue = [[ujx, ujz]];
          prev.set(key(ujx, ujz), null);
          let found = false;
          while (queue.length > 0) {
            const [cx, cz] = queue.shift();
            if (cx === tjx && cz === tjz) { found = true; break; }
            for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
              const nx = cx + dx;
              const nz = cz + dz;
              if (nx < -n || nx > n || nz < -n || nz > n) continue;
              const k = key(nx, nz);
              if (prev.has(k)) continue;
              prev.set(k, [cx, cz]);
              queue.push([nx, nz]);
            }
          }
          if (!found) {
            wp = { x: tx, z: ty };
          } else {
            let cur = [tjx, tjz];
            let step = cur;
            while (prev.get(key(cur[0], cur[1]))) {
              step = cur;
              cur = prev.get(key(cur[0], cur[1]));
            }
            wp = { x: step[0] * block, z: step[1] * block };
          }
        }
      }
    }
    unit.navWp = wp;
    unit.navWpFor = { x: tx, z: ty };
    return wp;
  }

  // Wall navigation: when a solid block sits directly ahead, swing
  // 90° toward the side whose probe point is open AND closer to the
  // target. Lets a unit work around a block instead of pushing into
  // it forever. Returns true when it steered around a wall.
  function steerAroundWalls(unit, tx, ty, dt) {
    const probeD = 14;
    const aheadX = unit.x + Math.cos(unit.angle) * probeD;
    const aheadZ = unit.z + Math.sin(unit.angle) * probeD;
    if (!w.isSolid(aheadX, aheadZ)) return false;
    const left = unit.angle + Math.PI / 2;
    const right = unit.angle - Math.PI / 2;
    const lp = { x: unit.x + Math.cos(left) * probeD, z: unit.z + Math.sin(left) * probeD };
    const rp = { x: unit.x + Math.cos(right) * probeD, z: unit.z + Math.sin(right) * probeD };
    const lBlocked = w.isSolid(lp.x, lp.z);
    const rBlocked = w.isSolid(rp.x, rp.z);
    let turnTo = null;
    if (!lBlocked && (rBlocked || dist2(lp.x, lp.z, tx, ty) <= dist2(rp.x, rp.z, tx, ty))) turnTo = left;
    else if (!rBlocked) turnTo = right;
    if (turnTo !== null) {
      unit.angle += angDiff(unit.angle, turnTo) * Math.min(1, 4 * dt);
    } else {
      unit.angle += Math.PI * dt; // boxed in: turn around
    }
    return true;
  }

  // One foot officer's logic record + ped. Armed with a pistol,
  // aiming/shooting state owned by driveFoot. `slot` spreads officers
  // around the surround ring; `fromCar` marks a deployed crew member.
  function makeFootUnit(x, z, angle, idx, now, fromCar) {
    const slot = ((idx * 2.39996) % (Math.PI * 2)); // golden angle: slots never bunch
    return {
      kind: 'foot',
      callsign: callsign(idx),
      tactic: 'PURSUIT',
      role: 'foot',
      side: idx % 2 === 0 ? 1 : -1,
      x, z, angle,
      speed: 0,
      body: null,
      ped: {
        x, z, angle,
        health: 100, police: true, officer: true,
        armed: 'pistol', aiming: false,
      },
      searching: false,
      leaving: false,
      leaveT: 0,
      ramT: 0,
      bustT: 0,
      fireT: 0.5 + (idx % 3) * 0.3, // staggered first shots, no volley
      slotAngle: slot,
      deployedFrom: fromCar || null,
      bornT: now,
      searchPhase: idx * 1.7,
      parkedT: 0,
    };
  }

  function spawnUnit(player, spec, idx, now) {
    const rng = mulberry32((101 + idx * 17 + Math.floor(now * 7)) >>> 0);
    const minD = spec.kind === 'foot' ? 80 : SPAWN_MIN;
    const spot = sceneSpot(player, rng, minD, SPAWN_MAX);
    const base = {
      kind: spec.kind,
      callsign: callsign(idx),
      tactic: spec.tactic || TACTIC_CYCLE[idx % TACTIC_CYCLE.length],
      role: spec.role || 'chase',
      side: idx % 2 === 0 ? 1 : -1,
      x: spot.x,
      z: spot.z,
      angle: spot.angle || 0,
      speed: 0,
      body: null,
      ped: null,
      searching: false,
      leaving: false,
      leaveT: 0,
      ramT: 0,
      bustT: 0,
      fireT: 0,
      slotAngle: 0,
      crew: spec.crew || 0, // officers still aboard this cruiser
      deployed: [], // foot units this cruiser has put on the street
      bornT: now,
      searchPhase: idx * 1.7,
      parkedT: 0,
    };
    if (spec.kind === 'foot') {
      const foot = makeFootUnit(
        spot.x + (rng() < 0.5 ? -1 : 1) * 13,
        spot.z + (rng() - 0.5) * 20,
        rng() * Math.PI * 2, idx, now, null,
      );
      base.ped = foot.ped;
      base.x = foot.x;
      base.z = foot.z;
      base.angle = foot.angle;
      base.slotAngle = foot.slotAngle;
      base.fireT = foot.fireT;
      base.callsign = foot.callsign;
    } else if (sys.vehicles) {
      // Cruisers and bikes both ride on B2's traffic-car factory
      // (there is no separate bike mesh yet); kind 'bike' is the
      // signal for B4/B2 to swap in a two-wheeler when one exists.
      base.body = makeBody(sys.vehicles, spec.kind, spot.x, spot.z, spot.angle || 0, '#23262f');
      if (base.body) {
        base.body.policeUnit = true;
        base.body.topSpeed = spec.kind === 'bike' ? BIKE_TOP : CRUISER_TOP;
        // Cruisers only: black-and-white livery + flashing bar.
        // Bikes keep the plain traffic body. Dressing never throws:
        // a failure leaves a plain dark cruiser, never a dead unit.
        if (spec.kind === 'cruiser') {
          try {
            base.siren = dressPoliceCruiser(base.body);
          } catch (e) {
            base.siren = null;
          }
        }
      }
    }
    return base;
  }

  function spawnHeli(player) {
    const heli = {
      x: player.x + 70, z: player.z - 65,
      alt: 65, orbit: 0.7, angle: 0, callsign: 'AIR-1', body: null, fireT: 1,
    };
    if (sys.vehicles) {
      heli.body = makeBody(sys.vehicles, 'heli', heli.x, heli.z, 0, null);
      if (heli.body && heli.body.position && typeof heli.body.position.set === 'function') {
        heli.body.position.set(heli.x, heli.alt, heli.z);
      }
    }
    return heli;
  }

  // Second helicopter (six stars): same orbit, opposite phase, so
  // the two never stack on one point in the sky.
  function spawnHeli2(player) {
    const heli = spawnHeli(player);
    heli.callsign = 'AIR-2';
    heli.orbit = 0.7 + Math.PI;
    heli.x = player.x - 70;
    heli.z = player.z + 65;
    return heli;
  }

  function countFoot() {
    let n = 0;
    for (const u of sys.units) if (u.kind === 'foot' && !u.leaving) n++;
    return n;
  }

  // A cruiser's crew gets out: up to `crew` officers, one per flank
  // plus one at the rear, each taking a surround slot. The street
  // never floods — deployment stops at MAX_FOOT officers total.
  function deployFromCar(car, player) {
    if (!car.crew || car.crew <= 0) return;
    if (countFoot() >= MAX_FOOT) return;
    const c = Math.cos(car.angle);
    const s = Math.sin(car.angle);
    const spots = [
      { x: car.x - s * 2.2, z: car.z + c * 2.2 },
      { x: car.x + s * 2.2, z: car.z - c * 2.2 },
      { x: car.x - c * 3.2, z: car.z - s * 3.2 },
    ];
    for (const spot of spots) {
      if (car.crew <= 0 || countFoot() >= MAX_FOOT) break;
      if (w.isSolid(spot.x, spot.z)) continue;
      const foot = makeFootUnit(spot.x, spot.z, Math.atan2(player.z - spot.z, player.x - spot.x),
        sys.units.length + sys.spawnSeq, sys.time, car);
      sys.units.push(foot);
      car.deployed.push(foot);
      car.crew--;
    }
  }

  // One pistol/heli hit on Rey: armour absorbs 60% (same split as
  // the ram damage), the rest is health. A stopped car takes the
  // hit as damage instead — officers shoot the car, not through it.
  function damagePlayer(player, dmg) {
    if (player.vehicle && player.vehicle.kind !== 'heli') {
      player.vehicle.damage = Math.min(100, (player.vehicle.damage || 0) + dmg);
      return;
    }
    if (typeof player.health !== 'number') return;
    if (typeof player.armour === 'number' && player.armour > 0) {
      const absorbed = Math.min(player.armour, dmg * 0.6);
      player.armour -= absorbed;
      player.health = Math.max(0, player.health - (dmg - absorbed));
    } else {
      player.health = Math.max(0, player.health - dmg);
    }
  }

  function headingOf(player) {
    if (player.vehicle) return player.vehicle.angle;
    return player.angle;
  }

  // Line of sight from a point to the player: close enough, and no
  // building on the segment between them. Sampled every 20 m.
  function hasLineOfSight(ux, uz, player, range) {
    const d = dist2(ux, uz, player.x, player.z);
    if (d > range) return false;
    const steps = Math.max(1, Math.ceil(d / 20));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (w.isSolid(ux + (player.x - ux) * t, uz + (player.z - uz) * t)) return false;
    }
    return true;
  }

  function unitSees(unit, player) {
    if (unit.kind === 'foot') return hasLineOfSight(unit.x, unit.z, player, SIGHT_FOOT);
    return hasLineOfSight(unit.x, unit.z, player, SIGHT_CAR);
  }

  function syncBody(unit) {
    if (!unit.body) return;
    syncBodyPos(unit.body, unit.x, unit.z, unit.angle);
    unit.body.speed = unit.speed;
  }

  // One siren strobe step, from the shared phase clock: red on for
  // the first 40% of the 0.4 s cycle, both off briefly, blue on for
  // the next 40%, both off again. All units share sys.time, so the
  // fleet strobes in sync like a real pursuit.
  function updateSiren(unit) {
    const s = unit.siren;
    if (!s) return;
    const p = (((sys.time / SIREN_PERIOD) % 1) + 1) % 1;
    const redOn = p < 0.4;
    const blueOn = p >= 0.5 && p < 0.9;
    if (s.redMat) s.redMat.emissiveIntensity = redOn ? 3.5 : 0.15;
    if (s.blueMat) s.blueMat.emissiveIntensity = blueOn ? 3.5 : 0.15;
    if (s.redSprite) s.redSprite.material.opacity = redOn ? 0.9 : 0.04;
    if (s.blueSprite) s.blueSprite.material.opacity = blueOn ? 0.9 : 0.04;
    if (s.redPool) s.redPool.material.opacity = redOn ? 0.5 : 0.02;
    if (s.bluePool) s.bluePool.material.opacity = blueOn ? 0.5 : 0.02;
  }

  // One cruiser or bike, one frame of driving. Chasers aim at Rey,
  // flankers aim at a point off his shoulder, PIT units pull alongside
  // and steer into his rear quarter, and the roadblock car races ahead
  // of him and parks sideways across the street.
  function driveVehicle(unit, player, dt) {
    // Never drive through a standing player: already overlapping at
    // the top of the frame, hold still and shove them clear instead
    // of rolling on. Covers every role/tactic, including the
    // roadblock car parking sideways and units driving away.
    if (!player.vehicle) {
      const standing = carPlayerOverlap(unit, player);
      if (standing) {
        unit.speed = 0;
        pushPlayerOut(unit, player, standing, w.isSolid);
        syncBody(unit);
        return;
      }
    }
    // The standoff (r10 B6): Rey has stopped — in a parked car or on
    // foot — and this cruiser is on scene. Park, put the crew on the
    // street, and hold: the officers do the arresting, the car does
    // not keep circling him. A car whose crew is already out holds
    // with them — it does not drive on into Rey. A moving Rey gets
    // a chase instead.
    const crewOut = unit.deployed.some((d) => !d.leaving);
    if (sys.playerStill && !unit.leaving && (unit.crew > 0 || crewOut) &&
        dist2(unit.x, unit.z, player.x, player.z) < 70) {
      unit.speed = Math.max(0, unit.speed - 30 * dt);
      if (unit.speed < 1) {
        unit.speed = 0;
        deployFromCar(unit, player);
      }
      syncBody(unit);
      return;
    }
    let tx;
    let ty;
    if (unit.leaving) {
      const away = Math.atan2(unit.z - player.z, unit.x - player.x);
      tx = unit.x + Math.cos(away) * 150;
      ty = unit.z + Math.sin(away) * 150;
    } else if (unit.searching && sys.lastSeen) {
      const ls = sys.lastSeen;
      const ph = sys.time * 0.35 + unit.searchPhase;
      tx = ls.x + Math.cos(ph) * 75;
      ty = ls.z + Math.sin(ph) * 75;
    } else if (unit.role === 'roadblock') {
      const head = headingOf(player);
      const snap = w.nearestRoadPoint(player.x + Math.cos(head) * 140, player.z + Math.sin(head) * 140);
      tx = snap.x;
      ty = snap.z;
      if (dist2(unit.x, unit.z, tx, ty) < 35) {
        unit.parkedT += dt;
        const road = w.roadAt(unit.x, unit.z);
        const want = road && road.axis === 'x' ? 0 : Math.PI / 2;
        unit.angle += angDiff(unit.angle, want) * Math.min(1, 3 * dt);
        unit.speed = Math.max(0, unit.speed - 30 * dt);
        if (unit.parkedT > 25 || dist2(unit.x, unit.z, player.x, player.z) > 250) {
          unit.role = 'chase';
          unit.parkedT = 0;
        }
        syncBody(unit);
        return;
      }
      unit.parkedT = 0;
    } else if (unit.role === 'flank') {
      const side = headingOf(player) + (Math.PI / 2) * unit.side;
      tx = player.x + Math.cos(side) * 85;
      ty = player.z + Math.sin(side) * 85;
    } else if (unit.tactic === 'PIT') {
      const fwd = headingOf(player);
      const ps = fwd + (Math.PI / 2) * unit.side;
      const dPlayer = dist2(unit.x, unit.z, player.x, player.z);
      if (dPlayer < 38) {
        tx = player.x - Math.cos(fwd) * 15 + Math.cos(ps) * 10;
        ty = player.z - Math.sin(fwd) * 15 + Math.sin(ps) * 10;
      } else {
        tx = player.x + Math.cos(fwd) * 28 + Math.cos(ps) * 20;
        ty = player.z + Math.sin(fwd) * 28 + Math.sin(ps) * 20;
      }
    } else {
      tx = player.x;
      ty = player.z;
    }
    // Route around blocks: steer at the grid waypoint, not straight
    // through the building in the way.
    const wp = navigateTarget(unit, tx, ty);
    tx = wp.x;
    ty = wp.z;
    const wantAngle = Math.atan2(ty - unit.z, tx - unit.x);
    const diff = angDiff(unit.angle, wantAngle);
    const turnRate = 2.4; // rad/s — a cruiser turns, it does not snap
    unit.angle += clamp(diff, -turnRate * dt, turnRate * dt);
    // A block dead ahead: work around it instead of pushing into it.
    steerAroundWalls(unit, tx, ty, dt);    // Steer toward the target angle, then roll forward.
    const top = unit.kind === 'bike' ? BIKE_TOP : CRUISER_TOP;
    let throttle = Math.abs(diff) > 1.4 ? 0.25 : 1;
    if (unit.tactic === 'RAMMING' || unit.tactic === 'PIT') throttle = 1;
    const dP = dist2(unit.x, unit.z, player.x, player.z);
    if (dP < 28 && !unit.leaving) throttle = 0.35;
    const target = top * throttle;
    unit.speed += clamp(target - unit.speed, -26 * dt, 14 * dt);
    unit.speed = Math.max(0, unit.speed);
    let nx = unit.x + Math.cos(unit.angle) * unit.speed * dt;
    let nz = unit.z + Math.sin(unit.angle) * unit.speed * dt;
    const ox = unit.x;
    const oz = unit.z;
    if (!w.isSolid(nx, unit.z)) unit.x = nx;
    else unit.speed *= 0.5;
    if (!w.isSolid(unit.x, nz)) unit.z = nz;
    else unit.speed *= 0.5;
    // This step carried the car onto the player: stay where the step
    // started, stop dead, and shove them clear to the side. The car
    // never ends a frame overlapping the player.
    if (!player.vehicle) {
      const hit = carPlayerOverlap(unit, player);
      if (hit) {
        unit.x = ox;
        unit.z = oz;
        unit.speed = 0;
        pushPlayerOut(unit, player, hit, w.isSolid);
      }
    }
    syncBody(unit);
  }

  // One foot officer, one frame. Runs at Rey on foot, walks the
  // last-seen point while searching, drifts off when stood down.
  // The standoff (r10 B6): while Rey holds still, officers take
  // their ring slot around him (SURROUND_RING), face him, point
  // their pistols and shoot. A moving Rey gets chased, not shot at.
  // Close on Rey while Rey is on foot and the arrest clock runs.
  function driveFoot(unit, player, dt) {
    let tx;
    let ty;
    const dp = dist2(unit.x, unit.z, player.x, player.z);
    const surrounding = sys.playerStill && !unit.leaving && dp < 70;
    if (unit.leaving) {
      const away = Math.atan2(unit.z - player.z, unit.x - player.x);
      tx = unit.x + Math.cos(away) * 100;
      ty = unit.z + Math.sin(away) * 100;
    } else if (unit.searching && sys.lastSeen) {
      const ls = sys.lastSeen;
      const ph = sys.time * 0.3 + unit.searchPhase;
      tx = ls.x + Math.cos(ph) * 55;
      ty = ls.z + Math.sin(ph) * 55;
    } else if (surrounding) {
      tx = player.x + Math.cos(unit.slotAngle) * SURROUND_RING;
      ty = player.z + Math.sin(unit.slotAngle) * SURROUND_RING;
    } else {
      tx = player.x;
      ty = player.z;
    }
    const wp = navigateTarget(unit, tx, ty);
    const d = dist2(unit.x, unit.z, wp.x, wp.z);
    if (d > 2) {
      const a = Math.atan2(wp.z - unit.z, wp.x - unit.x);
      unit.angle = a;
      steerAroundWalls(unit, tx, ty, dt);
      const nx = unit.x + Math.cos(unit.angle) * FOOT_SPEED * dt;
      const nz = unit.z + Math.sin(unit.angle) * FOOT_SPEED * dt;
      if (!w.isSolid(nx, unit.z)) unit.x = nx;
      if (!w.isSolid(unit.x, nz)) unit.z = nz;
      if (unit.ped) { unit.ped.x = unit.x; unit.ped.z = unit.z; unit.ped.angle = a; }
    }
    // Aim + shoot: on the ring (or close), still target, pistol
    // range, line of sight. The ped faces Rey and the aim pose
    // shows the pistol; each officer fires on their own timer.
    const inRange = dp < OFFICER_FIRE_RANGE;
    const aiming = surrounding && inRange && hasLineOfSight(unit.x, unit.z, player, OFFICER_FIRE_RANGE);
    if (unit.ped) {
      unit.ped.aiming = aiming;
      if (aiming) unit.ped.angle = Math.atan2(player.z - unit.ped.z, player.x - unit.ped.x);
    }
    if (aiming) {
      unit.angle = Math.atan2(player.z - unit.z, player.x - unit.x);
      unit.fireT -= dt;
      if (unit.fireT <= 0) {
        unit.fireT = OFFICER_FIRE_GAP + (sys.spawnSeq % 5) * 0.08;
        damagePlayer(player, OFFICER_FIRE_DMG);
      }
    } else {
      unit.fireT = Math.max(unit.fireT - dt, 0);
    }
    // The close-range arrest (r10 B6, kept): an officer who RUNS Rey
    // down and holds him within 15 m for 1.2 s busts him. Officers
    // already in the standoff ring do NOT use this rule — the 6 s
    // still-timer governs the surround, or the ring would bust Rey
    // in 1.2 s and the 6 s rule could never fire.
    if (!unit.leaving && !player.vehicle && !surrounding) {
      const dp2 = dist2(unit.x, unit.z, player.x, player.z);
      if (dp2 < BUST_DIST) {
        unit.bustT += dt;
        if (unit.bustT > BUST_HOLD) applyBusted(player);
      } else {
        unit.bustT = 0;
      }
    } else {
      unit.bustT = 0;
    }
  }

  // BUSTED: the mission fails, the PVPD takes a fine, the heat clears
  // and every unit stands down. Weapons are NOT stripped — the shoot
  // stages need them — the cost is the fine plus the failed mission.
  function applyBusted(player) {
    if (sys.busted && sys.time - sys.busted.at < 3) return;
    const fine = Math.min(1500, 100 + 200 * (sys.wanted || 0));
    if (typeof player.money === 'number') player.money = Math.max(0, player.money - fine);
    const missionId = sys.missionId || null;
    sys.busted = { at: sys.time, fine, mission: missionId };
    sys.bustedT = 0;
    sys.wanted = 0;
    sys.queue = [];
    sys.heli = null;
    sys.heli2 = null;
    sys.heliAt = 0;
    sys.heli2At = 0;
    sys.searching = false;
    sys.unseenT = 0;
    for (const u of sys.units) { u.leaving = true; u.leaveT = 0; }
    if (sys.events && typeof sys.events.onBusted === 'function') {
      sys.events.onBusted({ fine, missionId });
    }
    if (sys.events && typeof sys.events.onMissionFailed === 'function' && missionId) {
      sys.events.onMissionFailed('busted');
    }
    if (sys.events && typeof sys.events.onEvent === 'function') {
      sys.events.onEvent(null, 'dialogue', {
        who: 'PVPD',
        line: `BUSTED — the PVPD took $${fine} and the job fell apart. Press T to run it back.`,
      });
    }
  }

  // One helicopter, one frame of orbiting. At six stars the helis
  // shoot: a visible burst from above on their own timer, only with
  // line of sight (a roof between Rey and AIR-1 is cover).
  function stepHeli(heli, player, dt, phase) {
    heli.orbit += dt * 0.4;
    const tx = player.x + Math.cos(heli.orbit + phase) * HELI_ORBIT;
    const ty = player.z + Math.sin(heli.orbit + phase) * HELI_ORBIT;
    heli.x += (tx - heli.x) * Math.min(1, 1.5 * dt);
    heli.z += (ty - heli.z) * Math.min(1, 1.5 * dt);
    heli.angle = heli.orbit + phase + Math.PI / 2;
    if (heli.body) {
      if (heli.body.position && typeof heli.body.position.set === 'function') {
        heli.body.position.set(heli.x, heli.alt, heli.z);
      }
      if (heli.body.rotation) heli.body.rotation.y = -heli.angle;
      heli.body.x = heli.x;
      heli.body.z = heli.z;
    }
    if (sys.wanted >= HELI2_STARS) {
      heli.fireT = (heli.fireT || 0) - dt;
      if (heli.fireT <= 0) {
        heli.fireT = HELI_FIRE_GAP;
        if (dist2(heli.x, heli.z, player.x, player.z) < HELI_FIRE_RANGE &&
            hasLineOfSight(heli.x, heli.z, player, HELI_FIRE_RANGE)) {
          damagePlayer(player, HELI_FIRE_DMG);
        }
      }
    }
  }

  function updateHeli(player, dt) {
    if (sys.heli) stepHeli(sys.heli, player, dt, 0);
    if (sys.heli2) stepHeli(sys.heli2, player, dt, Math.PI);
  }

  // Contact: a RAMMING or PIT unit that reaches Rey's car bends it —
  // damage plus a speed cut, and a small nudge on a PIT hit. One hit
  // per unit per second, so a pile-up does not insta-kill him.
  function contactHits(player, dt) {
    for (const u of sys.units) {
      if (u.kind === 'foot' || u.leaving) continue;
      u.ramT = Math.max(0, (u.ramT || 0) - dt);
      if (u.ramT > 0) continue;
      const d = dist2(u.x, u.z, player.x, player.z);
      if (d > 24) continue;
      u.ramT = 1;
      if (player.vehicle && player.vehicle.kind !== 'heli') {
        player.vehicle.damage = Math.min(100, (player.vehicle.damage || 0) + (u.tactic === 'PIT' ? 4 : 5));
        player.vehicle.speed = (player.vehicle.speed || 0) * (u.tactic === 'PIT' ? 0.7 : 0.55);
        if (u.tactic === 'PIT') player.vehicle.angle += u.side * 0.12;
      } else if (!player.vehicle && typeof player.health === 'number') {
        if (typeof player.armour === 'number' && player.armour > 0) {
          const absorbed = Math.min(player.armour, 6 * 0.6);
          player.armour -= absorbed;
          player.health = Math.max(0, player.health - (6 - absorbed));
        } else {
          player.health = Math.max(0, player.health - 6);
        }
      }
    }
  }

  function removeUnit(unit) {
    if (sys.vehicles && typeof sys.vehicles.despawn === 'function' && unit.body) {
      sys.vehicles.despawn(unit.body);
    } else if (unit.body && unit.body.parent && typeof unit.body.parent.remove === 'function') {
      unit.body.parent.remove(unit.body);
    }
  }

  // Raise the heat to a given star level right now: the full
  // composition for that level appears on the roads around Rey and the
  // helicopter comes in at three stars. Staging uses this to set up
  // the chase frame deterministically — no stagger, everything at
  // once, and the search/heat bookkeeping reset.
  function stageChase(stars, player) {
    sys.wanted = stars;
    for (const u of sys.units) removeUnit(u);
    sys.units = [];
    sys.queue = [];
    sys.heat = { shots: 0, lastShotT: 0, shotsSinceEsc: 0, lastEscT: -99, shotPolice: false };
    sys.pendingWanted = null;
    sys.lastSeen = { x: player.x, z: player.z, t: sys.time };
    sys.unseenT = 0;
    sys.searching = false;
    sys.busted = null;
    sys.bustedT = 0;
    sys.prevPX = null;
    sys.prevPZ = null;
    const comp = desiredComposition(stars);
    for (let k = 0; k < comp.length; k++) sys.units.push(spawnUnit(player, comp[k], k, sys.time));
    sys.heli = stars >= HELI_STARS ? spawnHeli(player) : null;
    sys.heli2 = stars >= HELI2_STARS ? spawnHeli2(player) : null;
    sys.heliAt = 0;
    sys.heli2At = 0;
    return sys;
  }

  function setWanted(level, player) {
    const target = clamp(level | 0, 0, MAX_WANTED);
    if (target === sys.wanted) return sys.wanted;
    sys.wanted = target;
    if (sys.events && typeof sys.events.onWanted === 'function') sys.events.onWanted(target);
    return target;
  }

  // Gunfire heard: bookkeeping for escalation, plus the star itself
  // when nothing else raised it yet. Firing on a police unit
  // escalates the heat faster.
  function reportGunfire(result, player) {
    const t = sys.time;
    sys.heat.shots++;
    sys.heat.shotsSinceEsc++;
    sys.heat.lastShotT = t;
    if (result && result.target && (result.target.police || result.target.officer)) {
      sys.heat.shotPolice = true;
    }
    if (sys.wanted === 0 && !sys.pendingWanted) {
      sys.pendingWanted = { level: 1, at: t + 0.8 };
    }
    if (!sys.lastSeen) sys.lastSeen = { x: player.x, z: player.z, t };
  }

  // A crime the street saw, by kind: 'gunfire', 'assault' (a melee hit
  // on someone), 'ram-police'. Gunfire and assault raise a star within
  // about a second; ramming a police unit escalates at once.
  function reportCrime(kind, player) {
    const t = sys.time;
    if (kind === 'ram-police') {
      sys.heat.shotPolice = true;
      return;
    }
    if (sys.wanted === 0 && !sys.pendingWanted) {
      sys.pendingWanted = { level: 1, at: t + (kind === 'assault' ? 1.0 : 0.8) };
    }
    if (!sys.lastSeen) sys.lastSeen = { x: player.x, z: player.z, t };
  }

  // The dispatch board the HUD draws: one row per unit on the street,
  // call-sign + tactic + live distance in metres, plus the AIR-1 row
  // while the helicopter is up. While searching, every ground unit
  // shows SEARCHING instead of its pursuit tactic.
  function dispatchRows(player) {
    const rows = [];
    for (const u of sys.units) {
      if (u.leaving) continue;
      rows.push({
        callsign: u.callsign,
        tactic: u.searching ? 'SEARCHING' : u.tactic,
        distM: Math.round(dist2(u.x, u.z, player.x, player.z)),
        kind: u.kind || 'cruiser',
      });
    }
    if (sys.heli) {
      rows.push({
        callsign: 'AIR-1',
        tactic: 'SPOTLIGHT',
        distM: Math.round(dist2(sys.heli.x, sys.heli.z, player.x, player.z)),
        kind: 'heli',
      });
    }
    if (sys.heli2) {
      rows.push({
        callsign: 'AIR-2',
        tactic: 'SPOTLIGHT',
        distM: Math.round(dist2(sys.heli2.x, sys.heli2.z, player.x, player.z)),
        kind: 'heli',
      });
    }
    return rows;
  }

  function update(dt, player, events) {
    sys.events = events || null;
    sys.time += dt;
    const t = sys.time;
    if (events && typeof events.time === 'number') sys.time = events.time;
    if (events && events.missionId) sys.missionId = events.missionId;
    if (events && events.gunfire) reportGunfire({ target: events.gunfire.target || null }, player);
    if (events && events.crime) reportCrime(events.crime, player);
    let wanted = sys.wanted;

    // Still or moving (r10 B6): displacement since last frame. On
    // foot, standing still; in a car, speed under 1 m/s. The
    // standoff, the surround and the BUSTED timer all read this.
    if (sys.prevPX === null || typeof player.x !== 'number') {
      sys.prevPX = player.x;
      sys.prevPZ = player.z;
      sys.playerSpeed = 0;
    } else {
      const moved = dist2(player.x, player.z, sys.prevPX, sys.prevPZ);
      sys.playerSpeed = dt > 0 ? moved / dt : 0;
      sys.prevPX = player.x;
      sys.prevPZ = player.z;
    }
    const inCar = !!(player.vehicle && player.vehicle.kind !== 'heli');
    // Stillness breaks only after half a second of continuous
    // movement: a single shove frame (a cruiser pushing Rey clear
    // of its bumper) is not Rey moving, and must not reset the
    // standoff or the BUSTED clock.
    const movingNow = inCar
      ? Math.abs(player.vehicle.speed || 0) >= 1
      : sys.playerSpeed >= 0.6;
    sys.movingT = movingNow ? (sys.movingT || 0) + dt : 0;
    sys.playerStill = (sys.movingT || 0) < 0.5;

    // A star scheduled by a crime lands a moment after the shot.
    if (sys.pendingWanted && t >= sys.pendingWanted.at) {
      sys.wanted = Math.max(sys.wanted, sys.pendingWanted.level);
      wanted = sys.wanted;
      sys.pendingWanted = null;
      if (events && typeof events.onWanted === 'function') events.onWanted(wanted);
    }

    // Reconcile the street with the heat: missing units are queued
    // with a stagger (first inside a second, then one a second), and
    // surplus units — after a star blinks out — are stood down.
    if (wanted > 0) {
      const desired = desiredComposition(wanted);
      const have = {};
      for (const u of sys.units) {
        if (u.leaving) continue;
        if (u.deployedFrom) continue; // a deployed crew member is not
        // a composition walk-in: counting it would stand the crew down
        const key = `${u.kind}:${u.role}:${u.tactic}`;
        have[key] = (have[key] || 0) + 1;
      }
      const queued = {};
      for (const q of sys.queue) {
        const qk = `${q.spec.kind}:${q.spec.role}:${q.spec.tactic}`;
        queued[qk] = (queued[qk] || 0) + 1;
      }
      let delay = DISPATCH_FIRST;
      for (const spec of desired) {
        const dk = `${spec.kind}:${spec.role}:${spec.tactic}`;
        if (1 - (have[dk] || 0) - (queued[dk] || 0) > 0) {
          sys.queue.push({ spec, at: t + delay });
          delay += DISPATCH_GAP;
        }
      }
      const counts = {};
      for (const u of sys.units) {
        if (u.leaving) continue;
        if (u.deployedFrom) continue; // crew, not a composition unit
        const sk = `${u.kind}:${u.role}:${u.tactic}`;
        counts[sk] = (counts[sk] || 0) + 1;
        const want = desired.filter(
          (d) => `${d.kind}:${d.role}:${d.tactic}` === sk,
        ).length;
        if (counts[sk] > want) { u.leaving = true; u.leaveT = 0; }
      }
    } else {
      for (const u of sys.units) {
        if (!u.leaving) { u.leaving = true; u.leaveT = 0; }
      }
      sys.queue = [];
      sys.heliAt = 0;
      sys.heli2At = 0;
      sys.bustedT = 0;
    }

    // The dispatch queue: a due spec becomes a unit on the road.
    for (let qi = sys.queue.length - 1; qi >= 0; qi--) {
      if (t >= sys.queue[qi].at) {
        const spec = sys.queue.splice(qi, 1)[0].spec;
        sys.units.push(spawnUnit(player, spec, sys.units.length, t));
      }
    }

    // AIR-1 lifts off a few seconds after the third star, and leaves
    // the moment the heat drops back below it.
    if (wanted >= HELI_STARS && !sys.heli) {
      if (!sys.heliAt) sys.heliAt = t + HELI_DELAY;
      else if (t >= sys.heliAt) { sys.heli = spawnHeli(player); sys.heliAt = 0; }
    }
    if (wanted < HELI_STARS) { sys.heli = null; sys.heliAt = 0; }
    // AIR-2 lifts off a few seconds after the sixth star.
    if (wanted >= HELI2_STARS && !sys.heli2) {
      if (!sys.heli2At) sys.heli2At = t + HELI_DELAY;
      else if (t >= sys.heli2At) { sys.heli2 = spawnHeli2(player); sys.heli2At = 0; }
    }
    if (wanted < HELI2_STARS) { sys.heli2 = null; sys.heli2At = 0; }

    // Drive every unit, and prune the dead: a downed officer leaves
    // the street, a wrecked cruiser is stood down.
    for (let ui = sys.units.length - 1; ui >= 0; ui--) {
      const unit = sys.units[ui];
      if (unit.kind === 'foot' && unit.ped && unit.ped.health <= 0) {
        removeUnit(unit);
        sys.units.splice(ui, 1);
        continue;
      }
      if (unit.kind !== 'foot' && unit.body && unit.body.damage >= 100 && !unit.leaving) {
        unit.leaving = true;
        unit.leaveT = 0;
      }
      if (unit.kind === 'foot') driveFoot(unit, player, dt);
      else driveVehicle(unit, player, dt);
      if (unit.leaving) {
        unit.leaveT += dt;
        if (dist2(unit.x, unit.z, player.x, player.z) > 450 || unit.leaveT > 8) {
          removeUnit(unit);
          sys.units.splice(ui, 1);
        }
      }
    }
    updateHeli(player, dt);
    for (const u of sys.units) updateSiren(u);
    contactHits(player, dt);

    // The BUSTED clock (r10 B6): Rey holding still while at least
    // two officers are aiming at him from the ring. Moving, or the
    // ring breaking, resets it — running is always an out.
    if (wanted > 0 && sys.playerStill) {
      let aimers = 0;
      for (const u of sys.units) {
        if (u.kind === 'foot' && u.ped && u.ped.aiming &&
            dist2(u.x, u.z, player.x, player.z) < 30) aimers++;
      }
      if (aimers >= 2) {
        sys.bustedT += dt;
        if (sys.bustedT >= BUSTED_STILL_S) applyBusted(player);
      } else {
        sys.bustedT = 0;
      }
    } else {
      sys.bustedT = 0;
    }

    // Sight: any unit (or AIR-1) with eyes on Rey refreshes the last
    // seen point. Nobody seeing him starts the search clock.
    let anySee = false;
    if (sys.heli && hasLineOfSight(sys.heli.x, sys.heli.z, player, SIGHT_HELI)) anySee = true;
    if (!anySee) {
      for (const u of sys.units) {
        if (u.leaving) continue;
        if (unitSees(u, player)) { anySee = true; break; }
      }
    }
    if (anySee) {
      sys.lastSeen = { x: player.x, z: player.z, t };
      sys.unseenT = 0;
      sys.searching = false;
    } else if (wanted > 0) {
      sys.unseenT += dt;
      if (sys.unseenT > SEARCH_DELAY) sys.searching = true;
    }
    for (const u of sys.units) u.searching = sys.searching;

    // Escape: unseen long enough, and the nearest unit far away, and
    // a star blinks out. One star per escape window, so a five-star
    // heat takes real hiding to clear.
    if (sys.searching && sys.unseenT > ESCAPE_UNSEEN && wanted > 0) {
      let nearest = Infinity;
      for (const u of sys.units) nearest = Math.min(nearest, dist2(u.x, u.z, player.x, player.z));
      if (sys.heli) nearest = Math.min(nearest, dist2(sys.heli.x, sys.heli.z, player.x, player.z));
      if (nearest > ESCAPE_DIST) {
        sys.wanted = wanted - 1;
        sys.unseenT = ESCAPE_UNSEEN - 4;
        if (sys.wanted === 0 && events && typeof events.onEvent === 'function') {
          events.onEvent(null, 'crime-cleared', { line: 'lost the PVPD' });
        }
        if (events && typeof events.onWanted === 'function') events.onWanted(sys.wanted);
      }
    }

    // Escalation: keep shooting and the heat rises, a star at a time.
    // Shooting a police unit escalates faster.
    const heat = sys.heat;
    if (wanted > 0 && wanted < MAX_WANTED) {
      if (heat.shotPolice && t - heat.lastEscT > 3) {
        sys.wanted = wanted + 1;
        heat.lastEscT = t;
        heat.shotsSinceEsc = 0;
        heat.shotPolice = false;
        if (events && typeof events.onWanted === 'function') events.onWanted(sys.wanted);
      } else if (heat.shotsSinceEsc >= ESCALATE_SHOTS && t - heat.lastEscT > ESCALATE_GAP) {
        sys.wanted = wanted + 1;
        heat.lastEscT = t;
        heat.shotsSinceEsc = 0;
        if (events && typeof events.onWanted === 'function') events.onWanted(sys.wanted);
      }
    } else {
      heat.shotPolice = false;
    }
    return sys;
  }

  // The HUD block for the police panel.
  function hud(player) {
    return {
      wanted: sys.wanted,
      searching: sys.searching,
      unseenSeconds: Math.round(sys.unseenT * 10) / 10,
      heliUp: !!sys.heli,
      heli2Up: !!sys.heli2,
      units: sys.units.filter((u) => !u.leaving).length,
      foot: countFoot(),
      playerStill: sys.playerStill,
      bustedIn: sys.bustedT > 0 ? Math.max(0, +(BUSTED_STILL_S - sys.bustedT).toFixed(1)) : null,
      dispatch: dispatchRows(player),
      busted: sys.busted,
    };
  }

  sys.update = update;
  sys.dispatchRows = dispatchRows;
  sys.stageChase = stageChase;
  sys.setWanted = setWanted;
  sys.reportGunfire = reportGunfire;
  sys.reportCrime = reportCrime;
  sys.hasLineOfSight = hasLineOfSight;
  sys.hud = hud;
  return sys;
}

export { HELI_STARS, HELI2_STARS, BUSTED_STILL_S, MAX_FOOT, MAX_WANTED, CALLSIGNS };
