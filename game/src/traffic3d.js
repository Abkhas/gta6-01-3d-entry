// traffic3d.js — moving traffic and pedestrians for the 3D city.
//
// The city feels empty without them, so this file keeps the streets
// busy: two dozen-plus cars cruising the road grid, parked rows along
// the beach road, mopeds weaving through, and pedestrians in groups on
// the sidewalks, the beach and the market aisles. Cars stick to their
// (correct, right-hand) side of the road, stop at red lights, brake
// and honk behind the player, and steer around a blocked car instead
// of sitting on the horn forever. Pedestrians scatter when shots ring
// out — most flee, some duck, a stubborn few fight back.
//
// Units are metres and seconds. Roads run on the 200 m grid from
// CFG3D (centrelines at multiples of BLOCK); a car drives in the
// right-hand lane, 3.5 m off the centreline. The world handle (B1)
// is duck-typed and every method is optional — a grid fallback stands
// in when it is missing: isSolid(x, z), roadAt(x, z),
// randomRoadSpot(rng), nearestRoadPoint(x, z).
// The vehicles factory (B2) is optional: either a generic
// spawn(modelId, x, z, angle), or B2's own createTrafficCar(color).
// Without it, cars are plain records the renderer (B4) can read
// straight off sys.cars / sys.peds. With it, the THREE group is
// synced every frame (position + rotation.y = -angle, model faces +X).
//
// Density (live street, after ensureLife):
//   moving cars 28 (26 cars + 2 mopeds), parked rows ~20,
//   pedestrians 62+ (14 beach, 16 market, 32 sidewalk).
//
// createTraffic(world, vehicles) returns a system with:
//   update(dt, player, events) — events: { time, gunfire: {x,z}|null,
//     wanted }
//   ensureLife(player), spawnMover / spawnMoped / spawnParkedRow /
//   spawnPed / spawnPedGroup, lightIsRed(car), reportGunfire(x, z),
//   counts(), hud()
// Car records live in sys.cars, people in sys.peds.

import { CFG3D as CFG } from './config3d.js';

const MOVERS_WANTED = 28;
const MOPEDS_WANTED = 2;
const BEACH_PEDS = 14;
const MARKET_PEDS = 16;
const SIDEWALK_PEDS = 32;
const LANE_OFFSET = 3.5; // metres off the centreline, right-hand lane
const SKINS = ['#e8b48f', '#c98d64', '#8a5a3b', '#f0c8a0', '#a06a45'];
const SHIRTS = ['#3d7ea6', '#c94f3d', '#e8c53a', '#4a6b4f', '#e86a92', '#7a5a9e', '#2e8b7a', '#d97b2b'];
const CAR_MODELS = ['vela', 'brisa', 'faro', 'tiburon', 'monzon', 'playa', 'corriente', 'duna', 'arena', 'costa', 'palmera', 'luna', 'norte', 'sierra'];
const CAR_COLORS = ['#3d7ea6', '#e8c53a', '#7a8a6a', '#c9c2b4', '#f2a007', '#e86a92', '#4a6b4f', '#8c2f2f', '#e07840', '#2e6f7e', '#6a8f5a', '#c9c2d4', '#8c8a92', '#6b4a26'];

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
  };
}

// Build a body (THREE group) for a car, using whichever factory B2
// supplied: a generic spawn(modelId, x, z, angle), or B2's own
// createTrafficCar(color). Returns null when no factory is present —
// the car stays a pure logic record and B4 reads car.x / car.z /
// car.angle to place meshes. Forward-axis convention: the model is
// assumed to face +X, so a heading `angle` maps to rotation.y =
// -angle. B4 must adjust if B2's models face +Z instead.
function makeBody(vehicles, model, x, z, angle, color) {
  if (!vehicles) return null;
  let body = null;
  if (typeof vehicles.spawn === 'function') body = vehicles.spawn(model, x, z, angle);
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

export function createTraffic(world, vehicles) {
  const w = makeWorld(world);
  const sys = {
    world: w,
    vehicles: vehicles || null,
    cars: [],
    peds: [],
    ready: false,
    time: 0,
    rngSeed: 31,
  };

  function rngFor(salt) {
    return mulberry32((salt + Math.floor(sys.time)) >>> 0);
  }

  function makeCarRecord(model, x, z, angle, opts) {
    const o = opts || {};
    const color = o.color || CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)];
    const body = makeBody(sys.vehicles, model, x, z, angle, color);
    const car = {
      x, z, angle, speed: 0,
      model,
      color,
      traffic: true,
      moped: !!o.moped,
      parkedRow: !!o.parkedRow,
      cruise: o.cruise || 12 + Math.random() * 8,
      wait: 0, blocked: 0, playerBlock: 0, goAroundT: 0, goAroundSide: 1,
      honk: false, damage: 0, body,
    };
    if (body) {
      body.traffic = true; body.moped = car.moped;
    }
    return car;
  }

  function syncBody(car) {
    if (!car.body) return;
    syncBodyPos(car.body, car.x, car.z, car.angle);
    car.body.speed = car.speed;
  }

  // A moving car: pick a road spot near the player so the streets
  // around Rey are the busy ones, then cruise along the lanes. Keeps
  // the nearest candidate tried, so a spawn never lands across town.
  function spawnMover(player, rng) {
    const r = rng || rngFor(sys.rngSeed);
    let spot = null;
    let bestD = Infinity;
    for (let tries = 0; tries < 8; tries++) {
      const s = w.randomRoadSpot(r);
      const d = dist2(s.x, s.z, player.x, player.z);
      if (d < 600) { spot = s; break; }
      if (d < bestD) { bestD = d; spot = s; }
    }
    const model = CAR_MODELS[Math.floor(r() * CAR_MODELS.length)];
    const car = makeCarRecord(model, spot.x, spot.z, spot.angle || 0, {});
    sys.cars.push(car);
    return car;
  }

  // A moped: same streets as the cars, but faster, nimbler, and
  // flagged so the renderer draws a slim two-wheeler with a rider.
  function spawnMoped(player, rng) {
    const r = rng || rngFor(sys.rngSeed + 7);
    let spot = null;
    let bestD = Infinity;
    for (let tries = 0; tries < 8; tries++) {
      const s = w.randomRoadSpot(r);
      const d = dist2(s.x, s.z, player.x, player.z);
      if (d < 600) { spot = s; break; }
      if (d < bestD) { bestD = d; spot = s; }
    }
    const car = makeCarRecord('olas', spot.x, spot.z, spot.angle || 0, { moped: true, cruise: 15 + r() * 6 });
    sys.cars.push(car);
    return car;
  }

  // A parked row: cars nose-to-tail along the east kerb of the avenue
  // at avenueX, from z0 to z1, ~31 m apart, facing along the road.
  // Returns how many cars were parked.
  function spawnParkedRow(player, rng, avenueX, z0, z1) {
    const r = rng || rngFor(sys.rngSeed + 13);
    let n = 0;
    for (let z = z0; z <= z1; z += 31) {
      const model = CAR_MODELS[Math.floor(r() * CAR_MODELS.length)];
      const car = makeCarRecord(model, avenueX + 9, z, -Math.PI / 2, { parkedRow: true });
      sys.cars.push(car);
      n++;
    }
    return n;
  }

  function makePedRecord(x, z, rng, opts) {
    const o = opts || {};
    return {
      x, z,
      angle: rng() * Math.PI * 2,
      speed: 0,
      base: o.base || 1.2 + rng() * 1.8, // m/s walking pace
      color: SKINS[Math.floor(rng() * SKINS.length)],
      shirt: SHIRTS[Math.floor(rng() * SHIRTS.length)],
      health: 100,
      mode: o.mode || 'walk',
      fleeT: 0,
      duckT: 0,
      anchor: o.anchor || null,
      beach: !!o.beach,
      fighter: false,
    };
  }

  // A pedestrian: either a beach stroller with a patch of sand to
  // wander, or a sidewalk walker in a small group near a road.
  function spawnPed(player, rng, beach) {
    const r = rng || rngFor(sys.rngSeed + 21);
    let ped;
    if (beach) {
      const x = -1620 + r() * 200; // sand between shore and grid edge
      const z = -1200 + r() * 2400;
      ped = makePedRecord(x, z, r, { mode: 'beach', beach: true, base: 0.8 + r() * 1, anchor: { x, z } });
    } else {
      let spot = null;
      let bestD = Infinity;
      for (let tries = 0; tries < 8; tries++) {
        const s = w.randomRoadSpot(r);
        const d = dist2(s.x, s.z, player.x, player.z);
        if (d < 550) { spot = s; break; }
        if (d < bestD) { bestD = d; spot = s; }
      }
      const side = r() < 0.5 ? -1 : 1;
      ped = makePedRecord(spot.x + side * (8 + r() * 4), spot.z + (r() - 0.5) * 25, r, {});
    }
    ped.speed = ped.base;
    sys.peds.push(ped);
    return ped;
  }

  // A cluster of n pedestrians around (cx, cz). 'beach' strollers stay
  // on their patch of sand, 'market' shoppers stay near the aisle,
  // 'sidewalk' walkers stroll along the road. Returns the peds made.
  function spawnPedGroup(player, rng, cx, cz, n, kind) {
    const r = rng || rngFor(sys.rngSeed + 29);
    const made = [];
    for (let i = 0; i < n; i++) {
      const ped = makePedRecord(cx + (r() - 0.5) * 35, cz + (r() - 0.5) * 25, r, {
        mode: kind === 'beach' ? 'beach' : 'walk',
        beach: kind === 'beach',
        base: kind === 'beach' ? 0.7 + r() * 0.8 : 1 + r() * 1.4,
        anchor: { x: cx, z: cz },
      });
      ped.speed = ped.base;
      sys.peds.push(ped);
      made.push(ped);
    }
    return made;
  }

  // First-frame setup: top the traffic up to a full street, park two
  // rows, and seed the pedestrian groups. Runs once (sys.ready).
  function ensureLife(player) {
    if (sys.ready) return;
    sys.ready = true;
    const rng = mulberry32(31);
    let moving = 0;
    let mopeds = 0;
    for (const c of sys.cars) {
      if (c.traffic && !c.parkedRow) moving++;
      if (c.moped) mopeds++;
    }
    while (mopeds < MOPEDS_WANTED) { spawnMoped(player, rng); mopeds++; moving++; }
    while (moving < MOVERS_WANTED) { spawnMover(player, rng); moving++; }
    // Parked rows: a full kerb along the beach road (west edge) and a
    // second row on the Citrus Lane avenue, so the streets read
    // parked-up instead of empty.
    spawnParkedRow(player, rng, -1400, -1000, 1000);
    spawnParkedRow(player, rng, -400, -400, 400);
    // Beachgoers on the sand, between the road and the water.
    spawnPedGroup(player, rng, -1500, -600, 5, 'beach');
    spawnPedGroup(player, rng, -1520, 200, 5, 'beach');
    spawnPedGroup(player, rng, -1500, 900, 4, 'beach');
    // Market crowds in the Citrus Lane stall aisles.
    spawnPedGroup(player, rng, -1000, -100, 6, 'market');
    spawnPedGroup(player, rng, -600, 100, 5, 'market');
    spawnPedGroup(player, rng, -1200, 200, 5, 'market');
    // Sidewalk groups along the roads, spread across the districts.
    spawnPedGroup(player, rng, -200, -800, 8, 'sidewalk');
    spawnPedGroup(player, rng, 600, -200, 8, 'sidewalk');
    spawnPedGroup(player, rng, 1000, 800, 8, 'sidewalk');
    spawnPedGroup(player, rng, 0, 1000, 8, 'sidewalk');
  }

  // Traffic-light cycle, matching B1's world3d updateTrafficLights
  // exactly so our reds agree with the 3D light meshes: north-south
  // green for the first 45% of the cycle, east-west green for the
  // rest; each junction is offset by (x + z) / 400 of a cycle.
  // A car is "at" a junction when the next crossing is within 26 m
  // ahead of it; it stops only when its own direction is red.
  function lightIsRed(car) {
    const cycle = CFG.TRAFFIC_LIGHT_CYCLE || 14;
    const road = w.roadAt(car.x, car.z);
    if (!road) return false;
    const block = CFG.BLOCK || 200;
    // The junction ahead: on an X-road (car travels east-west) the
    // crossings sit on X centrelines; on a Z-road, on Z centrelines.
    let jx = null;
    let jz = null;
    const dirX = Math.cos(car.angle);
    const dirZ = Math.sin(car.angle);
    const lines = [];
    for (let k = -7; k <= 7; k++) lines.push(k * block);
    if (road.axis === 'x') {
      let best = Infinity;
      for (const a of lines) {
        const d = dirX < 0 ? car.x - a : dirX > 0 ? a - car.x : Infinity;
        if (d > 0 && d < best) { best = d; jx = a; }
      }
      if (jx === null || best > 26) return false;
      jz = Math.round(car.z / block) * block;
    } else {
      let best = Infinity;
      for (const s of lines) {
        const d = dirZ < 0 ? car.z - s : dirZ > 0 ? s - car.z : Infinity;
        if (d > 0 && d < best) { best = d; jz = s; }
      }
      if (jz === null || best > 26) return false;
      jx = Math.round(car.x / block) * block;
    }
    // Junction offset: B1's recorded offset when we have the light,
    // else B1's own formula (x + z) / 400.
    let offset = (jx + jz) / 400;
    if (w.trafficLights) {
      for (const tl of w.trafficLights) {
        if (Math.abs(tl.x - jx) < 1 && Math.abs(tl.z - jz) < 1 && typeof tl.offset === 'number') {
          offset = tl.offset;
          break;
        }
      }
    }
    const phase = (((sys.time + offset * cycle * 0.5) % cycle) + cycle) % cycle;
    const nsGreen = phase < cycle * 0.45;
    // Along-X travel is east-west: green when NOT nsGreen.
    // Along-Z travel is north-south: green when nsGreen.
    return road.axis === 'x' ? nsGreen : !nsGreen;
  }

  // What is directly ahead of this car, inside its lane: a moving car
  // or the player's vehicle. Parked cars are skipped (they sit in bays
  // at the kerb); a car in the next lane is skipped by the lateral test.
  function carAhead(player, car) {
    for (const o of sys.cars) {
      if (o === car || o.parkedRow) continue;
      if (o.speed === 0 && !o.traffic) continue;
      const dx = o.x - car.x;
      const dz = o.z - car.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d > 35 || d < 2) continue;
      const dot = (dx * Math.cos(car.angle) + dz * Math.sin(car.angle)) / d;
      if (dot < 0.82) continue;
      const perp = Math.abs(-dx * Math.sin(car.angle) + dz * Math.cos(car.angle));
      if (perp > 8) continue;
      return { kind: 'car' };
    }
    const pv = player.vehicle;
    if (pv && pv !== car) {
      const pdx = pv.x - car.x;
      const pdz = pv.z - car.z;
      const pd = Math.sqrt(pdx * pdx + pdz * pdz);
      if (pd < 35 && pd > 2) {
        const pdot = (pdx * Math.cos(car.angle) + pdz * Math.sin(car.angle)) / pd;
        const pperp = Math.abs(-pdx * Math.sin(car.angle) + pdz * Math.cos(car.angle));
        if (pdot > 0.82 && pperp <= 8) return { kind: 'player' };
      }
    }
    return null;
  }

  // Right-hand lane target: the nearest road centreline point ahead,
  // offset to the right of the direction of travel. On a road along X
  // heading east (+X), right is +Z (south); heading west, right is -Z.
  // On a road along Z heading south (+Z), right is -X; heading north,
  // right is +X.
  function laneTarget(car) {
    const snap = w.nearestRoadPoint(car.x, car.z);
    const aheadX = car.x + Math.cos(car.angle) * 30;
    const aheadZ = car.z + Math.sin(car.angle) * 30;
    const road = w.roadAt(aheadX, aheadZ) || w.roadAt(car.x, car.z);
    if (!road) return { x: aheadX, z: aheadZ };
    const off = car.goAroundT > 0 ? -LANE_OFFSET * (car.goAroundSide || 1) : LANE_OFFSET;
    if (road.axis === 'x') {
      // Road runs east-west; the car's lane sits off the Z centreline.
      const dir = Math.cos(car.angle) >= 0 ? 1 : -1;
      return { x: aheadX, z: snap.z + dir * off };
    }
    const dir = Math.sin(car.angle) >= 0 ? 1 : -1;
    return { x: snap.x - dir * off, z: aheadZ };
  }

  function updateMover(player, car, dt) {
    const dPlayer = dist2(car.x, car.z, player.x, player.z);
    let want = car.cruise;
    // Traffic pulls over and stops when a chase rolls past.
    if ((player.wanted || 0) >= 3 && dPlayer < 190) want = 0;
    // Gunfire nearby makes drivers floor it away from the noise.
    const shot = sys.lastShotAt;
    if (shot && sys.time - shot.t < 2.5 && dist2(car.x, car.z, shot.x, shot.z) < 250) {
      want = car.cruise * 1.7;
    }
    // Red light ahead: stop at the line, like the rest of the city.
    if (lightIsRed(car)) want = 0;
    // Something in our lane: brake. Behind the player, wait a beat,
    // honk, then steer around instead of sitting there forever.
    const ahead = carAhead(player, car);
    if (ahead) {
      want = 0;
      if (ahead.kind === 'player') {
        car.playerBlock = (car.playerBlock || 0) + dt;
        if (car.playerBlock > 1.5) car.honk = true;
        if (car.playerBlock > 2.2 && !car.goAroundT) {
          car.goAroundT = 2.6;
          car.goAroundSide = Math.random() < 0.5 ? 1 : -1;
        }
      } else {
        car.playerBlock = 0;
        car.honk = false;
      }
    } else {
      car.playerBlock = 0;
      car.honk = false;
    }
    // Committed to the pass: pull out half a lane and go around.
    if (car.goAroundT > 0) {
      car.goAroundT -= dt;
      want = car.cruise * 0.6;
    }
    // Blocked ahead: wait a beat, then swing onto the crossing road.
    if (w.isSolid(car.x + Math.cos(car.angle) * 14, car.z + Math.sin(car.angle) * 14)) {
      want = 0;
      car.blocked += dt;
      if (car.blocked > 1.4) {
        car.blocked = 0;
        car.angle += (Math.random() < 0.5 ? 1 : -1) * Math.PI / 2;
      }
    } else {
      car.blocked = 0;
    }
    // Lane follow: steer toward the right-hand lane target.
    const target = laneTarget(car);
    const wantAngle = Math.atan2(target.z - car.z, target.x - car.x);
    car.angle += angDiff(car.angle, wantAngle) * Math.min(1, 2.2 * dt);
    // Ease toward the wanted speed, braking harder than accelerating.
    const rate = want < car.speed ? 2.6 : 1.1;
    car.speed += (want - car.speed) * Math.min(1, rate * dt);
    if (Math.abs(car.speed) < 0.25) car.speed = 0;
    // Step forward, sliding past anything solid instead of sticking.
    const nx = car.x + Math.cos(car.angle) * car.speed * dt;
    const nz = car.z + Math.sin(car.angle) * car.speed * dt;
    if (!w.isSolid(nx, car.z)) car.x = nx;
    else car.speed *= 0.5;
    if (!w.isSolid(car.x, nz)) car.z = nz;
    else car.speed *= 0.5;
    // Never drift off the map: turn back toward the middle of town.
    const half = CFG.CITY_HALF || 1400;
    if (car.x < -half + 30 || car.x > half - 20 || car.z < -half + 30 || car.z > half - 20) {
      const home = Math.atan2(0 - car.z, 0 - car.x);
      car.angle += angDiff(car.angle, home) * Math.min(1, 3 * dt);
    }
    syncBody(car);
  }

  // Gunfire nearby: most peds flee, some duck, a stubborn few fight
  // back (they walk at the shooter; the combat layer decides what a
  // fighter's reach does). Fighters are rare — about one in twenty.
  function reportGunfire(x, z) {
    sys.lastShotAt = { x, z, t: sys.time };
    for (const ped of sys.peds) {
      if (ped.mode === 'flee' || ped.mode === 'duck' || ped.mode === 'fight') continue;
      const d = dist2(ped.x, ped.z, x, z);
      if (d > 240) continue;
      const roll = Math.random();
      if (roll < 0.05 && d < 120) {
        ped.mode = 'fight';
        ped.fighter = true;
        ped.fleeT = 6;
        ped.angle = Math.atan2(z - ped.z, x - ped.x);
      } else if (roll < 0.2) {
        ped.mode = 'duck';
        ped.duckT = 3;
        ped.speed = 0;
      } else {
        ped.mode = 'flee';
        ped.fleeT = 3;
        ped.angle = Math.atan2(ped.z - z, ped.x - x);
      }
    }
  }

  function updatePed(player, ped, dt) {
    if (ped.mode === 'flee') {
      ped.speed = ped.base * 2.4;
      ped.fleeT -= dt;
      if (ped.fleeT <= 0) { ped.mode = ped.beach ? 'beach' : 'walk'; ped.fighter = false; }
    } else if (ped.mode === 'duck') {
      ped.speed = 0;
      ped.duckT -= dt;
      if (ped.duckT <= 0) ped.mode = ped.beach ? 'beach' : 'walk';
    } else if (ped.mode === 'fight') {
      ped.speed = ped.base * 1.8;
      ped.angle = Math.atan2(player.z - ped.z, player.x - ped.x);
      ped.fleeT -= dt;
      if (ped.fleeT <= 0 || dist2(ped.x, ped.z, player.x, player.z) > 200) {
        ped.mode = 'walk';
        ped.fighter = false;
      }
    } else if (ped.mode === 'beach') {
      ped.speed = ped.base;
      if (ped.anchor && dist2(ped.x, ped.z, ped.anchor.x, ped.anchor.z) > 35) {
        ped.angle = Math.atan2(ped.anchor.z - ped.z, ped.anchor.x - ped.x);
      } else {
        ped.angle += (Math.random() - 0.5) * 1.6 * dt;
      }
    } else {
      ped.speed = ped.base;
      // Market shoppers stay near their aisle; sidewalk walkers
      // wander until something solid turns them.
      if (ped.anchor && dist2(ped.x, ped.z, ped.anchor.x, ped.anchor.z) > 45) {
        ped.angle = Math.atan2(ped.anchor.z - ped.z, ped.anchor.x - ped.x);
      } else {
        ped.angle += (Math.random() - 0.5) * 0.5 * dt;
      }
      if (w.isSolid(ped.x + Math.cos(ped.angle) * 6, ped.z + Math.sin(ped.angle) * 6)) {
        ped.angle += (Math.random() < 0.5 ? 1 : -1) * (0.9 + Math.random() * 0.9);
      }
    }
    const nx = ped.x + Math.cos(ped.angle) * ped.speed * dt;
    const nz = ped.z + Math.sin(ped.angle) * ped.speed * dt;
    if (!w.isSolid(nx, ped.z)) ped.x = nx;
    else ped.angle += Math.PI / 2 * dt * 4;
    if (!w.isSolid(ped.x, nz)) ped.z = nz;
    else ped.angle += Math.PI / 2 * dt * 4;
    const half = CFG.CITY_HALF || 1400;
    if (ped.x < -half - 220 || ped.x > half - 15 || ped.z < -half + 15 || ped.z > half - 15) {
      ped.angle = Math.atan2(0 - ped.z, 0 - ped.x);
    }
  }

  function update(dt, player, events) {
    sys.time += dt;
    if (events && typeof events.time === 'number') sys.time = events.time;
    if (events && events.gunfire) reportGunfire(events.gunfire.x, events.gunfire.z);
    ensureLife(player);
    for (const car of sys.cars) {
      if (car.traffic && !car.parkedRow) updateMover(player, car, dt);
    }
    for (let i = sys.peds.length - 1; i >= 0; i--) {
      const ped = sys.peds[i];
      if (ped.health <= 0) { sys.peds.splice(i, 1); continue; }
      updatePed(player, ped, dt);
    }
    // Wrecked traffic gets towed and replaced so the street never empties.
    const rng = rngFor(sys.rngSeed + 41);
    let moving = 0;
    let mopeds = 0;
    for (let i = sys.cars.length - 1; i >= 0; i--) {
      const c = sys.cars[i];
      if (!c.traffic || c.parkedRow) continue;
      if (c.damage >= 100) {
        if (sys.vehicles && typeof sys.vehicles.despawn === 'function' && c.body) sys.vehicles.despawn(c.body);
        else if (c.body && c.body.parent && typeof c.body.parent.remove === 'function') c.body.parent.remove(c.body);
        sys.cars.splice(i, 1);
        continue;
      }
      moving++;
      if (c.moped) mopeds++;
    }
    while (mopeds < MOPEDS_WANTED) { spawnMoped(player, rng); mopeds++; moving++; }
    while (moving < MOVERS_WANTED) { spawnMover(player, rng); moving++; }
    return sys;
  }

  function counts() {
    let moving = 0;
    let parked = 0;
    let mopeds = 0;
    for (const c of sys.cars) {
      if (c.parkedRow) parked++;
      else if (c.traffic) { moving++; if (c.moped) mopeds++; }
    }
    return { moving, parked, mopeds, peds: sys.peds.length, total: sys.cars.length };
  }

  function hud() {
    const c = counts();
    return {
      movingCars: c.moving,
      parkedCars: c.parked,
      peds: c.peds,
      honking: sys.cars.filter((car) => car.honk).length,
      fighters: sys.peds.filter((p) => p.mode === 'fight').length,
    };
  }

  sys.update = update;
  sys.ensureLife = ensureLife;
  sys.spawnMover = spawnMover;
  sys.spawnMoped = spawnMoped;
  sys.spawnParkedRow = spawnParkedRow;
  sys.spawnPed = spawnPed;
  sys.spawnPedGroup = spawnPedGroup;
  sys.lightIsRed = lightIsRed;
  sys.reportGunfire = reportGunfire;
  sys.counts = counts;
  sys.hud = hud;
  return sys;
}

export { MOVERS_WANTED, MOPEDS_WANTED, BEACH_PEDS, MARKET_PEDS, SIDEWALK_PEDS };
