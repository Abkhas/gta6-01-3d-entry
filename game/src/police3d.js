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

const CALLSIGNS = ['HALCON', 'BRISA', 'FARO', 'MONZON'];
const TACTIC_CYCLE = ['PIT', 'RAMMING', 'ROADBLOCK', 'FLANKING', 'PIT', 'PURSUIT'];
const MAX_UNITS = 5;
const MAX_GROUND = 9;
const HELI_STARS = 3;
const HELI_ORBIT = 95; // metres, heli orbit radius around the player

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

// What the heat buys, by star level. A spec is { kind, role, tactic }.
export function desiredComposition(wanted) {
  const comp = [];
  if (wanted <= 0) return comp;
  comp.push({ kind: 'foot', role: 'foot', tactic: 'PURSUIT' });
  comp.push({ kind: 'cruiser', role: 'chase', tactic: 'PURSUIT' });
  if (wanted >= 2) {
    comp.push({ kind: 'cruiser', role: 'chase', tactic: 'RAMMING' });
    comp.push({ kind: 'bike', role: 'flank', tactic: 'FLANKING' });
  }
  if (wanted >= 3) {
    comp.push({ kind: 'cruiser', role: 'chase', tactic: 'PIT' });
    comp.push({ kind: 'cruiser', role: 'roadblock', tactic: 'ROADBLOCK' });
  }
  if (wanted >= 4) comp.push({ kind: 'bike', role: 'chase', tactic: 'PIT' });
  if (wanted >= 5) {
    comp.push({ kind: 'foot', role: 'foot', tactic: 'PURSUIT' });
    comp.push({ kind: 'cruiser', role: 'roadblock', tactic: 'ROADBLOCK' });
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
    queue: [],
    heat: { shots: 0, lastShotT: 0, shotsSinceEsc: 0, lastEscT: -99, shotPolice: false },
    pendingWanted: null,
    lastSeen: null,
    unseenT: 0,
    searching: false,
    heliAt: 0,
    busted: null,
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
      bornT: now,
      searchPhase: idx * 1.7,
      parkedT: 0,
    };
    if (spec.kind === 'foot') {
      base.ped = {
        x: spot.x + (rng() < 0.5 ? -1 : 1) * 13,
        z: spot.z + (rng() - 0.5) * 20,
        angle: rng() * Math.PI * 2,
        health: 100, police: true, officer: true,
      };
      base.x = base.ped.x;
      base.z = base.ped.z;
    } else if (sys.vehicles) {
      // Cruisers and bikes both ride on B2's traffic-car factory
      // (there is no separate bike mesh yet); kind 'bike' is the
      // signal for B4/B2 to swap in a two-wheeler when one exists.
      base.body = makeBody(sys.vehicles, spec.kind, spot.x, spot.z, spot.angle || 0, '#23262f');
      if (base.body) {
        base.body.policeUnit = true;
        base.body.topSpeed = spec.kind === 'bike' ? BIKE_TOP : CRUISER_TOP;
      }
    }
    return base;
  }

  function spawnHeli(player) {
    const heli = {
      x: player.x + 70, z: player.z - 65,
      alt: 65, orbit: 0.7, angle: 0, callsign: 'AIR-1', body: null,
    };
    if (sys.vehicles) {
      heli.body = makeBody(sys.vehicles, 'heli', heli.x, heli.z, 0, null);
      if (heli.body && heli.body.position && typeof heli.body.position.set === 'function') {
        heli.body.position.set(heli.x, heli.alt, heli.z);
      }
    }
    return heli;
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

  // One cruiser or bike, one frame of driving. Chasers aim at Rey,
  // flankers aim at a point off his shoulder, PIT units pull alongside
  // and steer into his rear quarter, and the roadblock car races ahead
  // of him and parks sideways across the street.
  function driveVehicle(unit, player, dt) {
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
    if (!w.isSolid(nx, unit.z)) unit.x = nx;
    else unit.speed *= 0.5;
    if (!w.isSolid(unit.x, nz)) unit.z = nz;
    else unit.speed *= 0.5;
    syncBody(unit);
  }

  // One foot officer, one frame. Runs at Rey on foot, walks the
  // last-seen point while searching, drifts off when stood down.
  // Close on Rey while Rey is on foot and the arrest clock runs.
  function driveFoot(unit, player, dt) {
    let tx;
    let ty;
    if (unit.leaving) {
      const away = Math.atan2(unit.z - player.z, unit.x - player.x);
      tx = unit.x + Math.cos(away) * 100;
      ty = unit.z + Math.sin(away) * 100;
    } else if (unit.searching && sys.lastSeen) {
      const ls = sys.lastSeen;
      const ph = sys.time * 0.3 + unit.searchPhase;
      tx = ls.x + Math.cos(ph) * 55;
      ty = ls.z + Math.sin(ph) * 55;
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
    if (!unit.leaving && !player.vehicle) {
      const dp = dist2(unit.x, unit.z, player.x, player.z);
      if (dp < BUST_DIST) {
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
    sys.wanted = 0;
    sys.queue = [];
    sys.heli = null;
    sys.heliAt = 0;
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

  function updateHeli(player, dt) {
    const heli = sys.heli;
    if (!heli) return;
    heli.orbit += dt * 0.4;
    const tx = player.x + Math.cos(heli.orbit) * HELI_ORBIT;
    const ty = player.z + Math.sin(heli.orbit) * HELI_ORBIT;
    heli.x += (tx - heli.x) * Math.min(1, 1.5 * dt);
    heli.z += (ty - heli.z) * Math.min(1, 1.5 * dt);
    heli.angle = heli.orbit + Math.PI / 2;
    if (heli.body) {
      if (heli.body.position && typeof heli.body.position.set === 'function') {
        heli.body.position.set(heli.x, heli.alt, heli.z);
      }
      if (heli.body.rotation) heli.body.rotation.y = -heli.angle;
      heli.body.x = heli.x;
      heli.body.z = heli.z;
    }
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
    const comp = desiredComposition(stars);
    for (let k = 0; k < comp.length; k++) sys.units.push(spawnUnit(player, comp[k], k, sys.time));
    sys.heli = stars >= HELI_STARS ? spawnHeli(player) : null;
    sys.heliAt = 0;
    return sys;
  }

  function setWanted(level, player) {
    const target = clamp(level | 0, 0, 5);
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
    contactHits(player, dt);

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
    if (wanted > 0 && wanted < 5) {
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
      units: sys.units.filter((u) => !u.leaving).length,
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

export { HELI_STARS, CALLSIGNS };
