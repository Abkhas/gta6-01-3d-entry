// traffic3d.js — moving traffic and pedestrians for the 3D city.
//
// The city feels empty without them, so this file keeps the streets
// busy: two dozen-plus cars cruising the road grid, parked rows along
// the beach road, mopeds weaving through, and pedestrians in groups on
// the sidewalks, the beach and the market aisles. Sidewalk walkers
// stay on the sidewalk strip (9 m off the centreline) and cross a
// road only on a zebra at one of the 22 signalled junctions, waiting
// at the kerb for the walk signal — there is no jaywalking. Cars stick to their
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
// Density (live street, after ensureLife): the same caps as r7, but
// spent where the player is — moving cars 34 (30 cars + 4 mopeds),
// parked rows ~117, pedestrians 86 (18 beach, 24 market, 44 sidewalk).
// Movers and sidewalk walkers spawn in a 60–180 m ring around the
// player and recycle beyond a speed-scaled radius (300 m on foot,
// 170 m driving), so the bubble around the player
// stays full; beach strollers keep to the promenade strip west of the
// beach road and market shoppers to the Mercado plaza aisles.
//
// The lights live in trafficlights3d.js: the 14 s cycle, the
// per-junction phase, and the visible heads are one source of truth
// with the car logic here — a lamp and the cars under it read the
// same phase, so they can never disagree. Cars stop only where a
// signal stands (the 64); minor 200 m cross-streets are uncontrolled
// and traffic flows through, GTA-style.
//
// createTraffic(world, vehicles) returns a system with:
//   update(dt, player, events) — events: { time, gunfire: {x,z}|null,
//     wanted }
//   ensureLife(player), spawnMover / spawnMoped / spawnParkedRow /
//   spawnPed / spawnPedGroup, lightIsRed(car), reportGunfire(x, z),
//   counts(), hud()
// Car records live in sys.cars, people in sys.peds.

import { CFG3D as CFG, districtAt, gradeBlend } from './config3d.js';
import { directionState, pedState, createTrafficLights, STOP_GAP, SIGNAL_JUNCTIONS } from './trafficlights3d.js';

const MOVERS_WANTED = 34;
const MOPEDS_WANTED = 4;
const BEACH_PEDS = 18;
const MARKET_PEDS = 24;
const SIDEWALK_PEDS = 44;
const LANE_OFFSET = 3.5; // metres off the centreline, right-hand lane

// ---- downed peds ----------------------------------------------------------
// A ped shot down lies where it fell and fades after ~25 s — a body in
// the road is gone within half a minute, never for the whole session.
const DOWN_FADE_S = 25;

// ---- beach promenade ------------------------------------------------------
// Beach strollers walk a sand strip west of the beach road (centreline
// -1430, kerb -1437): strip centre -1470, waypoints -1500..-1462, and a
// hard guard at -1458 so no stroller ever reaches the road.
const PROMENADE_X = -1470;
const PROM_WALK_MIN = -1500;
const PROM_WALK_MAX = -1462;
const PROM_SPAWN_MIN = -1520;
const PROM_SPAWN_MAX = -1465;
const PROM_GUARD_X = -1458;

// ---- market aisles --------------------------------------------------------
// Mercado Citrus stalls sit in one plaza block (stall rows z=72/128,
// counters 10x5 at x=-768,-734,-700,-666,-632). Shoppers walk the aisle
// (z=100) stall to stall and browse at the stall fronts (z=78/122) —
// the whole plaza is inside the block, so a shopper never needs the
// carriageway. One shared read-only table; peds never mutate it.
const MARKET_AISLE = {
  x0: -770, x1: -630, aisleZ: 100, frontN: 78, frontS: 122,
  stalls: [-768, -734, -700, -666, -632],
};

// ---- population bubble (density near the player) --------------------------
// GTA streams population around the player: agents spawn in a ring just
// outside the view (60–180 m) and recycle when far away (speed-scaled
// 170–300 m), so the same ~120 agents read as a full street wherever
// the player is, instead of a thin scatter over 2.8 x 2.8 km. Spawn
// weighted by district: the market and the beach road run 1.5x, main
// avenues 1.0x, residential 0.7x. Caps never move (34 movers / 86 peds).
const RING_MIN = 60;
const RING_MAX = 180;
const RECYCLE_FAR = 300;
const RECYCLE_NEAR = 170;
// The recycle radius scales with the player's speed. On foot the
// bubble never outruns the peds, so a wide 300 m radius lets them
// roam to the next junction (200 m away) and cross — with a fixed
// 170 m radius a standing player never sees a crossing at all. When
// driving (≥10 m/s) the player outruns the bubble, so the radius
// tightens to 170 m, just past the 150 m the player sees, and the
// street stays full. A despawn at 170–300 m is a few pixels and reads
// as distance, not a pop.
const DISTRICT_MULT = {
  citrus: 1.5, boardwalk: 1.5, marina: 1.2, oldtown: 1.0,
  northgate: 1.0, palmheights: 0.7, docks: 0.7,
};

// ---- sidewalk routing (pedestrians stay off the car lanes) --------------
// Geometry, read off CFG + the painted markings in trafficlights3d.js:
// a road is ROAD_WIDTH (14 m) wide, so its kerb sits 7 m from the
// centreline; the sidewalk strip beside it is SIDEWALK (4 m) wide, so
// its centre is 9 m out. The zebra bands the lights module paints sit
// 8–11 m out from a junction centre (band centre 9.5 m) — i.e. a ped
// walking down the middle of the sidewalk is already ON the zebra
// when it crosses a junction, and a ped crossing its own road at
// 9.5 m out from the junction walks straight down the painted bars.
// Sidewalk walkers therefore never need the lanes at all: they walk
// the 9 m line, cross the cross-road on the zebra at a signalled
// junction (waiting at the kerb for the walk signal), cross their own
// road only on the zebra at a signalled junction, and otherwise turn
// the corner onto the cross-road's near sidewalk or turn back. There
// is no jaywalking: every crossing is on a zebra at one of the 22
// signalled junctions. Beach strollers and market shoppers keep their
// old behaviour — they are not on roads.
const SWALK_OFF = (CFG.ROAD_WIDTH || 14) / 2 + (CFG.SIDEWALK || 4) / 2; // 9 m
const ZEBRA_OFF = 9.5; // zebra band centre out from a junction centre
const BLOCK = CFG.BLOCK || 200;
const CITY_HALF = CFG.CITY_HALF || 1400;

const SIGNAL_KEYS = new Set(SIGNAL_JUNCTIONS.map((j) => j.x + ',' + j.z));
function isSignalledJunction(jx, jz) { return SIGNAL_KEYS.has(jx + ',' + jz); }

// The two fenced freeways carry no sidewalks: peds never walk along
// them and never turn onto them.
function isWalkableRoad(axis, line) {
  if (axis === 'x' && line === (CFG.HIGHWAY_NORTH_Z ?? -1200)) return false;
  if (axis === 'z' && line === (CFG.HIGHWAY_EAST_X ?? 1200)) return false;
  return true;
}

function nearestLine(v) { return Math.round(v / BLOCK) * BLOCK; }

function nextJunction(parallel, dir) {
  const k = dir > 0 ? Math.floor(parallel / BLOCK) + 1 : Math.ceil(parallel / BLOCK) - 1;
  return k * BLOCK;
}

// Point on a sidewalk route `sw` at `parallel` metres along the road.
function sidewalkPoint(sw, parallel) {
  return sw.axis === 'x'
    ? { x: parallel, z: sw.line + sw.side * SWALK_OFF }
    : { x: sw.line + sw.side * SWALK_OFF, z: parallel };
}

// A parallel coordinate kept at least 15 m from any junction, so a ped
// never spawns (or is sent) already inside a crossing.
function clampOffJunction(parallel) {
  const nj = nearestLine(parallel);
  if (Math.abs(parallel - nj) < 15) parallel = parallel >= nj ? nj + 30 : nj - 30;
  return clamp(parallel, -CITY_HALF + 20, CITY_HALF - 20);
}

// The nearest sidewalk to where a ped stands (after fleeing or
// fighting knocked it off its strip): the nearer road, the nearer side
// of it, facing along it. The walk back runs from outside the kerb
// toward the strip, so it never enters a lane.
function nearestSidewalk(ped) {
  const nx = nearestLine(ped.x);
  const nz = nearestLine(ped.z);
  const dx = Math.abs(ped.x - nx);
  const dz = Math.abs(ped.z - nz);
  let axis = dx <= dz ? 'z' : 'x';
  let line = axis === 'z' ? nx : nz;
  if (!isWalkableRoad(axis, line)) {
    axis = axis === 'z' ? 'x' : 'z';
    line = axis === 'z' ? nx : nz;
    if (!isWalkableRoad(axis, line)) line += line > 0 ? -BLOCK : BLOCK;
  }
  const perp = axis === 'x' ? ped.z : ped.x;
  const heading = axis === 'x' ? Math.cos(ped.angle) : Math.sin(ped.angle);
  return { axis, line, side: perp >= line ? 1 : -1, dir: heading >= 0 ? 1 : -1 };
}

// Build a sidewalk route from a road spot (world randomRoadSpot or the
// grid fallback): which road the spot sits on, which side of it, and
// which way along it — plus a start point on the 9 m strip, clear of
// any junction. The spot's on-centreline coordinate says which road
// it is (world3d spots carry no angle). A highway line is shifted one
// block toward the centre.
function sidewalkFromSpot(spot, rng) {
  const r = rng || Math.random;
  const dx = Math.abs(spot.x - nearestLine(spot.x));
  const dz = Math.abs(spot.z - nearestLine(spot.z));
  let axis, line, parallel;
  if (dx <= dz) { axis = 'z'; line = nearestLine(spot.x); parallel = spot.z; }
  else { axis = 'x'; line = nearestLine(spot.z); parallel = spot.x; }
  if (!isWalkableRoad(axis, line)) line += line > 0 ? -BLOCK : BLOCK;
  parallel = clampOffJunction(clamp(parallel, -CITY_HALF + 20, CITY_HALF - 20));
  const sw = { axis, line, side: r() < 0.5 ? -1 : 1, dir: r() < 0.5 ? -1 : 1 };
  const at = sidewalkPoint(sw, parallel);
  return { sw, x: at.x, z: at.z };
}
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
    // The scene group the light meshes hang from (trafficlights3d
    // builds into it); absent in stubs, where no meshes are built.
    group: w.group || null,
    // District lookup for the bubble's per-district spawn weights;
    // falls back to the config table when the world has none.
    districtAt: typeof w.districtAt === 'function' ? w.districtAt.bind(w) : districtAt,
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
  // The visible lights: built into the world group when there is one
  // (a no-op stub in tests). Driven every frame from update(), on the
  // same clock the cars read.
  const lights = createTrafficLights(world);
  sys.lights = lights;

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

  // The night factor for the traffic-light halos (B2's hook): prefer
  // an explicit events.nightF when the caller passes one; otherwise
  // derive it from the game clock — a fresh session opens at
  // DAY_START_HOUR and the clock runs 24 h per DAY_LENGTH_S, the same
  // rate S.time advances at. The factor is the blended grade `stars`
  // (0 by day, 1 at full night, ramping across dawn/dusk) — the same
  // quantity daynight3d calls nightness. Caveat: after loading a save
  // the day/night clock is restored from the save while S.time restarts
  // at 0, so the derived factor is phase-shifted until the caller
  // passes nightF explicitly (one line in main3d's traffic.update
  // call — flagged to the coordinator, not this file).
  function nightFactor(events) {
    if (events && typeof events.nightF === 'number') return clamp(events.nightF, 0, 1);
    const t = events && typeof events.time === 'number' ? events.time : sys.time;
    const dayLength = CFG.DAY_LENGTH_S || 480;
    const startHour = CFG.DAY_START_HOUR ?? 9.5;
    const hour = (((startHour + (t * 24) / dayLength) % 24) + 24) % 24;
    const blend = gradeBlend(hour);
    const stars = (blend.from.stars ?? 0) + ((blend.to.stars ?? 0) - (blend.from.stars ?? 0)) * blend.t;
    return clamp(stars, 0, 1);
  }

  // Spawn weight of the district a point sits in (market / beach road
  // 1.5x, avenues 1.0x, residential 0.7x). Unknown district: 1.0x.
  function districtMultAt(x, z) {
    const d = w.districtAt ? w.districtAt(x, z) : null;
    const id = d && d.id ? d.id : null;
    return (id && DISTRICT_MULT[id]) || 1.0;
  }

  // A point in the ring around the player (60–180 m, just outside the
  // view so nothing pops in on screen), best of four candidates
  // weighted toward lively districts. The angle is biased ahead of the
  // player's heading (the street the player is about to drive into)
  // and the radius is biased inward, so the bubble stays ahead of a
  // driving player instead of trailing behind them.
  function ringPoint(player, rng) {
    const r = rng || Math.random;
    let best = null;
    let bestScore = -1;
    for (let i = 0; i < 4; i++) {
      let a;
      if (typeof player.angle === 'number' && r() < 0.7) {
        a = player.angle + (r() - 0.5) * Math.PI;
      } else {
        a = r() * Math.PI * 2;
      }
      const rad = RING_MIN + (r() * r()) * (RING_MAX - RING_MIN);
      const x = clamp(player.x + Math.cos(a) * rad, -CITY_HALF + 20, CITY_HALF - 20);
      const z = clamp(player.z + Math.sin(a) * rad, -CITY_HALF + 20, CITY_HALF - 20);
      const score = districtMultAt(x, z) * (0.5 + r());
      if (score > bestScore) { bestScore = score; best = { x, z }; }
    }
    return best;
  }

  // The road spot nearest a ring point, with a travel direction along
  // it: the snapped coordinate says which road it is (x snapped =
  // north-south road, travel along z; z snapped = east-west road).
  function ringRoadSpot(player, rng) {
    const r = rng || Math.random;
    const p = ringPoint(player, r);
    const snapped = w.nearestRoadPoint(p.x, p.z);
    const onNSRoad = Math.abs(snapped.z - p.z) < 0.001;
    const angle = onNSRoad
      ? (r() < 0.5 ? Math.PI / 2 : -Math.PI / 2)
      : (r() < 0.5 ? 0 : Math.PI);
    return { x: snapped.x, z: snapped.z, angle };
  }

  // A moving car: spawned in the ring around the player, so the streets
  // around Rey are the busy ones — never a map-wide scatter that reads
  // empty everywhere. The recycle pass keeps it there.
  function spawnMover(player, rng) {
    const r = rng || rngFor(sys.rngSeed);
    const spot = ringRoadSpot(player, r);
    const model = CAR_MODELS[Math.floor(r() * CAR_MODELS.length)];
    const car = makeCarRecord(model, spot.x, spot.z, spot.angle || 0, {});
    sys.cars.push(car);
    return car;
  }

  // A moped: same ring as the cars, but faster, nimbler, and flagged
  // so the renderer draws a slim two-wheeler with a rider.
  function spawnMoped(player, rng) {
    const r = rng || rngFor(sys.rngSeed + 7);
    const spot = ringRoadSpot(player, r);
    const car = makeCarRecord('olas', spot.x, spot.z, spot.angle || 0, { moped: true, cruise: 15 + r() * 6 });
    sys.cars.push(car);
    return car;
  }

  // A parked row: cars nose-to-tail along the east kerb of the avenue
  // at avenueX, from z0 to z1, `step` m apart (tighter on the beach
  // road, where kerbside parking is the street's furniture), facing
  // along the road. Returns how many cars were parked.
  function spawnParkedRow(player, rng, avenueX, z0, z1, step) {
    const r = rng || rngFor(sys.rngSeed + 13);
    const gap = step || 31;
    let n = 0;
    for (let z = z0; z <= z1; z += gap) {
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
      // Home mode: where this ped belongs when a reaction ends — flee,
      // duck, chat and fight all return here, never to a bare 'walk'
      // that would leave a market/beach ped routeless.
      home: o.home || o.mode || 'walk',
      fleeT: 0,
      duckT: 0,
      chatT: 0,
      browseT: 0, // market: seconds left looking at a stall front
      downT: 0, // downed: seconds left before the body fades
      down: false,
      fleeSw: null, // flee: the strip this flee runs on, pinned at its start
      anchor: o.anchor || null,
      beach: !!o.beach,
      fighter: false,
      // Beach promenade strip centre for this ped (x = PROMENADE_X).
      promX: o.promX || null,
      // Market aisle table for this ped (shared MARKET_AISLE).
      aisle: o.aisle || null,
      front: null, // market: the stall front currently being browsed
      // Sidewalk route (sidewalk walkers only; beach/market peds leave
      // it null and keep their own line instead): the road the ped walks
      // beside (axis 'x' = east-west road, line = its centreline),
      // which side of it, and which way along it. wp is the current
      // waypoint, waiting is a kerb wait for a walk signal, and
      // noStraightJ is the junction just crossed over at (straight
      // crossings there wait or turn back — never a second crossing
      // on a stale signal).
      sw: null,
      wp: null,
      waiting: null,
      noStraightJ: null,
    };
  }

  // A pedestrian: either a beach stroller on the promenade strip west
  // of the beach road, or a sidewalk walker in a small group near a road.
  function spawnPed(player, rng, beach) {
    const r = rng || rngFor(sys.rngSeed + 21);
    let ped;
    if (beach) {
      // Sand between the beach road and the water, never the road:
      // the strip runs -1520..-1465, 28 m clear of the kerb at -1437.
      const x = PROM_SPAWN_MIN + r() * (PROM_SPAWN_MAX - PROM_SPAWN_MIN);
      const z = -1200 + r() * 2400;
      ped = makePedRecord(x, z, r, { mode: 'beach', home: 'beach', beach: true, base: 0.8 + r() * 1, anchor: { x, z }, promX: PROMENADE_X });
    } else {
      let spot = null;
      let bestD = Infinity;
      for (let tries = 0; tries < 8; tries++) {
        const s = w.randomRoadSpot(r);
        const d = dist2(s.x, s.z, player.x, player.z);
        if (d < 550) { spot = s; break; }
        if (d < bestD) { bestD = d; spot = s; }
      }
      // Sidewalk walkers start ON the sidewalk strip (9 m off the
      // centreline), never on the lanes.
      const built = sidewalkFromSpot(spot, r);
      ped = makePedRecord(built.x, built.z, r, {});
      ped.sw = built.sw;
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
      let ped;
      if (kind === 'sidewalk') {
        // Each walker gets its own sidewalk route: a road through the
        // anchor junction, a side, a direction, and a start spread
        // along the block — always on the 9 m strip, never on a lane.
        const axis = r() < 0.5 ? 'x' : 'z';
        let line = axis === 'x' ? nearestLine(cz) : nearestLine(cx);
        if (!isWalkableRoad(axis, line)) line += line > 0 ? -BLOCK : BLOCK;
        const anchorParallel = axis === 'x' ? cx : cz;
        const parallel = clampOffJunction(clamp(anchorParallel + (r() - 0.5) * 160, -CITY_HALF + 20, CITY_HALF - 20));
        const sw = { axis, line, side: r() < 0.5 ? -1 : 1, dir: r() < 0.5 ? -1 : 1 };
        const at = sidewalkPoint(sw, parallel);
        ped = makePedRecord(at.x, at.z, r, {
          mode: 'walk',
          home: 'walk',
          base: 1 + r() * 1.4,
          anchor: { x: cx, z: cz },
        });
        ped.sw = sw;
      } else if (kind === 'beach') {
        // Promenade strollers: on the sand strip, spread along their
        // home stretch of it — never on the beach road or the grid.
        ped = makePedRecord(
          clamp(cx + (r() - 0.5) * 30, PROM_SPAWN_MIN, PROM_SPAWN_MAX),
          cz + (r() - 0.5) * 50, r, {
            mode: 'beach',
            home: 'beach',
            beach: true,
            base: 0.7 + r() * 0.8,
            anchor: { x: cx, z: cz },
            promX: PROMENADE_X,
          });
      } else {
        // Market shoppers: all three groups browse the one real market,
        // the Mercado plaza — along the aisle, never on a road. The old
        // anchors sat on road centrelines, which is why shoppers were
        // standing in the lanes.
        const a = MARKET_AISLE;
        ped = makePedRecord(a.x0 + 10 + r() * (a.x1 - a.x0 - 20), a.aisleZ + (r() - 0.5) * 12, r, {
          mode: 'market',
          home: 'market',
          base: 0.9 + r() * 0.9,
          anchor: { x: -700, z: 100 },
          aisle: a,
        });
      }
      ped.speed = ped.base;
      sys.peds.push(ped);
      made.push(ped);
    }
    // A stopped pair reads as life where a lone walker reads as a
    // prop: in market and sidewalk groups, half the time the first
    // two stand facing each other, chatting for 20-40 s, then move on.
    if ((kind === 'market' || kind === 'sidewalk') && made.length >= 2 && r() < 0.5) {
      const a = made[0], b = made[1];
      a.mode = 'chat'; b.mode = 'chat';
      a.chatT = 20 + r() * 20; b.chatT = a.chatT;
      a.speed = 0; b.speed = 0;
      a.angle = Math.atan2(b.z - a.z, b.x - a.x);
      b.angle = Math.atan2(a.z - b.z, a.x - b.x);
    }
    return made;
  }

  // One sidewalk walker in the ring around the player (top-ups and
  // recycling): a road spot in the ring, then onto its 9 m strip.
  function spawnSidewalkPedNear(player, rng) {
    const r = rng || Math.random;
    const built = sidewalkFromSpot(ringRoadSpot(player, r), r);
    const ped = makePedRecord(built.x, built.z, r, {
      mode: 'walk', home: 'walk', base: 1 + r() * 1.4,
      anchor: { x: player.x, z: player.z },
    });
    ped.sw = built.sw;
    ped.speed = ped.base;
    sys.peds.push(ped);
    return ped;
  }

  // One market shopper in the Mercado plaza aisle (top-ups).
  function spawnMarketPed(rng) {
    const r = rng || Math.random;
    const a = MARKET_AISLE;
    const ped = makePedRecord(a.x0 + 10 + r() * (a.x1 - a.x0 - 20), a.aisleZ + (r() - 0.5) * 12, r, {
      mode: 'market', home: 'market', base: 0.9 + r() * 0.9,
      anchor: { x: -700, z: 100 }, aisle: a,
    });
    ped.speed = ped.base;
    sys.peds.push(ped);
    return ped;
  }

  // Metres from the ped to its sidewalk strip (0 when on it): the
  // pinned flee strip while fleeing, else the nearest strip.
  function distToStrip(ped) {
    const sw = (ped.fleeSw && ped.mode === 'flee') ? ped.fleeSw : nearestSidewalk(ped);
    const perp = sw.axis === 'x' ? ped.z : ped.x;
    return Math.abs(perp - (sw.line + sw.side * SWALK_OFF));
  }

  // Where a fleeing ped runs: a point on its OWN line, 30 m along it
  // away from the shot — the sidewalk strip, the market aisle, or the
  // beach promenade. A ped on a strip runs along it; a ped caught
  // mid-road runs diagonally to the nearest strip and then along it.
  // It never runs straight across the lanes the way the old flee did.
  function fleeTarget(ped) {
    const shot = sys.lastShotAt;
    const awayX = shot ? ped.x - shot.x : Math.cos(ped.angle);
    const awayZ = shot ? ped.z - shot.z : Math.sin(ped.angle);
    if (ped.home === 'market' && ped.aisle) {
      const a = ped.aisle;
      const dir = awayX >= 0 ? 1 : -1;
      return { x: clamp(ped.x + dir * 30, a.x0, a.x1), z: a.aisleZ };
    }
    if (ped.home === 'beach' || ped.beach) {
      const dir = awayZ >= 0 ? 1 : -1;
      const cz = ped.anchor ? ped.anchor.z : ped.z;
      return { x: PROMENADE_X, z: clamp(ped.z + dir * 30, cz - 80, cz + 80) };
    }
    // Sidewalk walker: run on its flee strip, pinned for the whole
    // flee (ped.fleeSw) — at a junction corner two strips are
    // equidistant, and re-picking every frame flips the target back
    // and forth while the ped zigzags in place.
    const sw = ped.fleeSw || nearestSidewalk(ped);
    const perp = sw.axis === 'x' ? ped.z : ped.x;
    const stripPerp = sw.line + sw.side * SWALK_OFF;
    const along = sw.axis === 'x' ? ped.x : ped.z;
    if (Math.abs(perp - stripPerp) > 2) {
      // Off the strip (mid-road, mid-crossing): shortest exit first —
      // straight to the nearest point on the strip, not 30 m along it
      // (which would run the ped parallel to the strip, down the lane).
      return sidewalkPoint(sw, along);
    }
    const awayAlong = sw.axis === 'x' ? awayX : awayZ;
    const dir = awayAlong >= 0 ? 1 : -1;
    return sidewalkPoint(sw, clamp(along + dir * 30, -CITY_HALF + 20, CITY_HALF - 20));
  }

  // A car body out of the scene (wrecked or recycled): the renderer's
  // despawn when it has one, else drop the group from its parent.
  function despawnCarBody(c) {
    if (sys.vehicles && typeof sys.vehicles.despawn === 'function' && c.body) sys.vehicles.despawn(c.body);
    else if (c.body && c.body.parent && typeof c.body.parent.remove === 'function') c.body.parent.remove(c.body);
  }

  // Recycle radius for this frame, from the player's speed (tracked
  // from position deltas, smoothed over ~1 s, so it follows the
  // player rather than any one frame). On foot the radius is wide
  // (300 m) so peds roam to the next junction and cross; driving it
  // tightens to 170 m so the bubble stays full.
  function recycleDist() {
    const s = sys._playerSpeed || 0;
    return clamp(RECYCLE_FAR - s * 13, RECYCLE_NEAR, RECYCLE_FAR);
  }

  // Recycle agents that drifted out of sight (beyond the
  // speed-scaled radius) back into the ring: movers and sidewalk
  // walkers respawn near the player, so the bubble stays full without
  // raising the cap. Beach and market peds are place-bound (promenade
  // / plaza) and stay put; parked rows never move.
  function recycleFar(player, rng) {
    const r = rng || Math.random;
    const RD = recycleDist();
    for (let i = sys.cars.length - 1; i >= 0; i--) {
      const c = sys.cars[i];
      if (!c.traffic || c.parkedRow) continue;
      if (dist2(c.x, c.z, player.x, player.z) > RD) {
        despawnCarBody(c);
        sys.cars.splice(i, 1);
        if (c.moped) spawnMoped(player, r); else spawnMover(player, r);
      }
    }
    for (let i = sys.peds.length - 1; i >= 0; i--) {
      const p = sys.peds[i];
      if (p.home !== 'walk' || p.health <= 0) continue;
      if (dist2(p.x, p.z, player.x, player.z) > RD) {
        sys.peds.splice(i, 1);
        spawnSidewalkPedNear(player, r);
      }
    }
  }

  // Top the street back up to its counts after downed peds fade (or a
  // recycle drops one): sidewalk walkers in the ring, beach strollers
  // on the promenade, shoppers in the plaza.
  function topUpPeds(player, rng) {
    const r = rng || Math.random;
    let beach = 0, market = 0, walk = 0;
    for (const p of sys.peds) {
      if (p.home === 'beach') beach++;
      else if (p.home === 'market') market++;
      else if (p.home === 'walk') walk++;
    }
    while (walk < SIDEWALK_PEDS) { spawnSidewalkPedNear(player, r); walk++; }
    while (beach < BEACH_PEDS) { spawnPed(player, r, true); beach++; }
    while (market < MARKET_PEDS) { spawnMarketPed(r); market++; }
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
    // parked-up instead of empty. The beach row parks tighter (24 m),
    // the way a busy kerb does.
    spawnParkedRow(player, rng, -1400, -1000, 1000, 24);
    spawnParkedRow(player, rng, -400, -500, 500);
    // Beachgoers on the sand, between the road and the water.
    spawnPedGroup(player, rng, -1500, -600, 6, 'beach');
    spawnPedGroup(player, rng, -1520, 200, 6, 'beach');
    spawnPedGroup(player, rng, -1500, 900, 6, 'beach');
    // Market crowds in the Citrus Lane stall aisles.
    spawnPedGroup(player, rng, -1000, -100, 8, 'market');
    spawnPedGroup(player, rng, -600, 100, 8, 'market');
    spawnPedGroup(player, rng, -1200, 200, 8, 'market');
    // Sidewalk groups along the roads, spread across the districts.
    spawnPedGroup(player, rng, -200, -800, 11, 'sidewalk');
    spawnPedGroup(player, rng, 600, -200, 11, 'sidewalk');
    spawnPedGroup(player, rng, 1000, 800, 11, 'sidewalk');
    spawnPedGroup(player, rng, 0, 1000, 11, 'sidewalk');
  }

  // The junction ahead of this car: the next road-centreline crossing
  // within 40 m, on the road the car is travelling. The travel axis
  // follows the HEADING, not the road under the car: near a crossing
  // the road under the car can be the crossing road, which used to
  // steer a car stopped at a red light back the way it came.
  // Returns null when the car is not on a road or no crossing is near.
  function junctionAhead(car) {
    const road = w.roadAt(car.x, car.z);
    if (!road) return null;
    const block = CFG.BLOCK || 200;
    const dirX = Math.cos(car.angle);
    const dirZ = Math.sin(car.angle);
    const lines = [];
    for (let k = -7; k <= 7; k++) lines.push(k * block);
    if (Math.abs(dirX) >= Math.abs(dirZ)) {
      let best = Infinity;
      let jx = null;
      for (const a of lines) {
        const d = dirX < 0 ? car.x - a : dirX > 0 ? a - car.x : Infinity;
        if (d > 0 && d < best) { best = d; jx = a; }
      }
      if (jx === null || best > 40) return null;
      return { jx, jz: Math.round(car.z / block) * block, dist: best, axis: 'x' };
    }
    let best = Infinity;
    let jz = null;
    for (const s of lines) {
      const d = dirZ < 0 ? car.z - s : dirZ > 0 ? s - car.z : Infinity;
      if (d > 0 && d < best) { best = d; jz = s; }
    }
    if (jz === null || best > 40) return null;
    return { jx: Math.round(car.x / block) * block, jz, dist: best, axis: 'z' };
  }

  // The signal record for a junction, when the world built one there
  // (the 64, every 400 m). Null at a minor 200 m cross-street.
  function signalAt(jx, jz) {
    if (!w.trafficLights) return null;
    for (const tl of w.trafficLights) {
      if (Math.abs(tl.x - jx) < 1 && Math.abs(tl.z - jz) < 1) return tl;
    }
    return null;
  }

  // Is this car facing a red (or yellow) light? Only at a crossing
  // that actually has a signal: a minor cross-street has no light to
  // obey, so traffic flows through it. The state comes from the same
  // phase function the visible heads display, so the two agree.
  function lightIsRed(car) {
    const j = junctionAhead(car);
    if (!j || j.dist > 26) return false;
    if (w.trafficLights && !signalAt(j.jx, j.jz)) return false;
    return directionState(j.jx, j.jz, j.axis, sys.time) !== 'green';
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

  // Right-hand lane target: the lane on the car's OWN road, picked by
  // its heading. The old version read the road 30 m ahead, which near
  // a junction is the CROSSING road — and a car stopped there got a
  // target behind it and turned around. A car far from any centreline
  // (beach road, a lot) just holds its heading.
  function laneTarget(car) {
    const aheadX = car.x + Math.cos(car.angle) * 30;
    const aheadZ = car.z + Math.sin(car.angle) * 30;
    const block = CFG.BLOCK || 200;
    const half = (CFG.ROAD_WIDTH || 14) / 2 + (CFG.SIDEWALK || 4) + 6;
    const off = car.goAroundT > 0 ? -LANE_OFFSET * (car.goAroundSide || 1) : LANE_OFFSET;
    if (Math.abs(Math.cos(car.angle)) >= Math.abs(Math.sin(car.angle))) {
      // East-west travel: the lane sits off the Z centreline.
      const line = Math.round(car.z / block) * block;
      if (Math.abs(car.z - line) > half) return { x: aheadX, z: aheadZ };
      const dir = Math.cos(car.angle) >= 0 ? 1 : -1;
      return { x: aheadX, z: line + dir * off };
    }
    const line = Math.round(car.x / block) * block;
    if (Math.abs(car.x - line) > half) return { x: aheadX, z: aheadZ };
    const dir = Math.sin(car.angle) >= 0 ? 1 : -1;
    return { x: line - dir * off, z: aheadZ };
  }

  function updateMover(player, car, dt) {
    const dPlayer = dist2(car.x, car.z, player.x, player.z);
    let want = car.cruise;
    // Traffic pulls over and stops when a chase rolls past.
    if ((player.wanted || 0) >= 3 && dPlayer < 190) want = 0;
    // Gunfire nearby makes drivers floor it away from the noise —
    // and a fleeing driver runs the light, so the red handling below
    // is skipped while fleeing.
    const shot = sys.lastShotAt;
    const fleeing = !!(shot && sys.time - shot.t < 2.5 && dist2(car.x, car.z, shot.x, shot.z) < 250);
    if (fleeing) {
      want = car.cruise * 1.7;
    }
    // Red light ahead: ease down to the stop line (STOP_GAP before
    // the junction centre) and wait there until OUR junction turns
    // green. The latch (car.redJunction) is what keeps the car
    // stopped: without it the car stops outside the 26 m trigger,
    // the light "clears", and it creeps forward and stops again.
    // A car already rolling past the line clears the junction instead
    // of stopping in it.
    if (!fleeing) {
      const j = junctionAhead(car);
      let redHere = false;
      if (j && (!w.trafficLights || signalAt(j.jx, j.jz))) {
        const state = directionState(j.jx, j.jz, j.axis, sys.time);
        if (state !== 'green') {
          redHere = true;
          const stopDist = j.dist - STOP_GAP;
          if (stopDist > 0.5) {
            want = Math.min(want, Math.max(0, stopDist * 0.7));
            if (stopDist < 3) car.redJunction = { jx: j.jx, jz: j.jz, axis: j.axis };
          } else if (car.speed < 0.5 || car.redJunction) {
            want = 0;
            car.redJunction = { jx: j.jx, jz: j.jz, axis: j.axis };
          }
        }
      }
      if (!redHere && car.redJunction) {
        // Was waiting: release only when our own junction turns green.
        if (directionState(car.redJunction.jx, car.redJunction.jz, car.redJunction.axis, sys.time) === 'green') {
          car.redJunction = null;
        } else {
          want = 0;
        }
      }
    }
    // Something in our lane: brake. Behind the player, wait a beat,
    // honk, then steer around instead of sitting there forever.
    const ahead = carAhead(player, car);
    if (ahead) {
      want = 0;
      if (ahead.kind === 'player') {
        car.playerBlock = (car.playerBlock || 0) + dt;
        if (car.playerBlock > 1.5) car.honk = true;
        // No going around while waiting at a red: the car stays in
        // its lane behind the player until the light turns green.
        if (car.playerBlock > 2.2 && !car.goAroundT && !car.redJunction) {
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
    // Committed to the pass: pull out half a lane and go around —
    // unless the light ahead is red, in which case the pass waits.
    if (car.goAroundT > 0) {
      car.goAroundT -= dt;
      if (!car.redJunction) want = car.cruise * 0.6;
    }
    // Blocked ahead: wait a beat, then swing onto the crossing road.
    // Not while waiting at a red — a car at the line is waiting, not
    // stuck, and must not turn itself into the junction.
    if (!car.redJunction && w.isSolid(car.x + Math.cos(car.angle) * 14, car.z + Math.sin(car.angle) * 14)) {
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

  // Sidewalk-only walking for a ped with a route (ped.sw). The ped
  // walks the 9 m strip toward its next junction's approach point
  // (9.5 m out — the zebra line); there it either crosses on the zebra
  // (signalled junction + walk signal, waiting at the kerb otherwise),
  // crosses its own road on the zebra (same rule, other axis), turns
  // the corner onto the cross-road's near sidewalk, or turns back. A
  // ped knocked off its strip (fleeing, fighting) is re-snapped to
  // the nearest sidewalk first. Sets ped.angle / ped.speed; the shared
  // movement step at the end of updatePed does the stepping.
  function updateSidewalkPed(ped) {
    let sw = ped.sw;
    const hasSignals = !!w.trafficLights;

    // Waiting at a kerb: hold until the walk signal, unless the ped
    // was knocked away from the junction meanwhile (gunfire) — then
    // drop the wait and re-route from wherever it stands.
    if (ped.waiting) {
      const wt = ped.waiting;
      if (dist2(ped.x, ped.z, wt.target.x, wt.target.z) > 25) {
        ped.waiting = null;
        ped.wp = null;
      } else if (pedState(wt.jx, wt.jz, wt.axis, sys.time) === 'walk') {
        ped.wp = wt.target;
        ped.waiting = null;
      } else {
        ped.speed = 0;
        ped.angle = Math.atan2(wt.target.z - ped.z, wt.target.x - ped.x);
        return;
      }
    }

    // Off the strip (fled, fought): walk straight back to the NEAREST
    // strip — usually its own — at a hurry, not diagonally to the next
    // junction's approach point (which used to march the ped across
    // the lanes for seconds). Nearest STRIP, not nearest road: at a
    // junction corner the nearest road's strip can be farther than its
    // own, and re-snapping to it sends the ped across the lane. The
    // threshold is 1 m: the strip sits at 9 m and the zebra band is
    // 8–11 m, so a ped more than 1 m off the strip can miss the band
    // when it crosses the next junction; within 1 m it is inside it.
    const perpNow = sw.axis === 'x' ? ped.z : ped.x;
    const offOwn = Math.abs(perpNow - (sw.line + sw.side * SWALK_OFF));
    if (offOwn > 1.0) {
      const ns = nearestSidewalk(ped);
      const nsPerp = ns.axis === 'x' ? ped.z : ped.x;
      const nsOff = Math.abs(nsPerp - (ns.line + ns.side * SWALK_OFF));
      if (nsOff < offOwn) { ped.sw = ns; sw = ns; }
      const parallel = sw.axis === 'x' ? ped.x : ped.z;
      const back = sidewalkPoint(sw, parallel);
      ped.wp = { x: back.x, z: back.z, kind: 'back' };
    }

    // Arrived at the current waypoint? Snap to it exactly, apply its
    // effect, then (for an approach point) decide the junction.
    if (ped.wp && dist2(ped.x, ped.z, ped.wp.x, ped.wp.z) < 1.2) {
      const wp = ped.wp;
      ped.x = wp.x;
      ped.z = wp.z;
      ped.wp = null;
      if (wp.kind === 'cross') {
        if (wp.sideFlip) {
          sw.side = -sw.side;
          ped.noStraightJ = sw.axis + ':' + sw.line + ':' + wp.j;
        } else {
          ped.noStraightJ = null;
        }
      } else if (wp.kind === 'along') {
        const j = wp.j;
        const jx = sw.axis === 'x' ? j : sw.line;
        const jz = sw.axis === 'x' ? sw.line : j;
        const crossAxis = sw.axis === 'x' ? 'z' : 'x';
        const signalled = hasSignals && isSignalledJunction(jx, jz);
        const key = sw.axis + ':' + sw.line + ':' + j;
        const justCrossed = ped.noStraightJ === key;
        if (ped.noStraightJ && !justCrossed) ped.noStraightJ = null;
        const roll = Math.random();
        const straightTarget = () => {
          const far = sidewalkPoint(sw, j + sw.dir * ZEBRA_OFF);
          return { x: far.x, z: far.z, kind: 'cross', jx, jz, axis: sw.axis, j };
        };
        const sideTarget = () => {
          const across = sw.axis === 'x'
            ? { x: j - sw.dir * ZEBRA_OFF, z: sw.line - sw.side * SWALK_OFF }
            : { x: sw.line - sw.side * SWALK_OFF, z: j - sw.dir * ZEBRA_OFF };
          return { x: across.x, z: across.z, kind: 'cross', jx, jz, axis: crossAxis, j, sideFlip: true };
        };
        const waitFor = (axis, target) => {
          ped.waiting = { jx, jz, axis, target };
          ped.speed = 0;
        };
        if (justCrossed) {
          // Just crossed over at this junction: either wait and cross
          // the cross-road, or turn back — no corner turn from the
          // far side (it would mean crossing a road again).
          if (roll < 0.5 && signalled) {
            if (pedState(jx, jz, sw.axis, sys.time) === 'walk') ped.wp = straightTarget();
            else waitFor(sw.axis, straightTarget());
          } else {
            sw.dir = -sw.dir;
            ped.noStraightJ = null;
          }
        } else if (signalled && roll < 0.40) {
          // Straight across the cross-road, on the zebra.
          if (pedState(jx, jz, sw.axis, sys.time) === 'walk') ped.wp = straightTarget();
          else waitFor(sw.axis, straightTarget());
        } else if (signalled && roll < 0.58) {
          // Across our own road, on the zebra at this junction.
          if (pedState(jx, jz, crossAxis, sys.time) === 'walk') ped.wp = sideTarget();
          else waitFor(crossAxis, sideTarget());
        } else if (roll < 0.80) {
          // Corner turn onto the cross-road's near sidewalk: the
          // 0.5 m sidestep stays on the corner square, no lane
          // involved. Never onto a freeway.
          const ns = { axis: crossAxis, line: j, side: -sw.dir, dir: sw.side };
          if (isWalkableRoad(ns.axis, ns.line)) {
            ped.sw = ns;
            sw = ns;
            ped.noStraightJ = null;
          } else {
            sw.dir = -sw.dir;
            ped.noStraightJ = null;
          }
        } else {
          sw.dir = -sw.dir;
          ped.noStraightJ = null;
        }
      }
    }

    // No waypoint: head for the next junction's approach point (the
    // zebra line, 9.5 m out). Already past the kerb inside a junction
    // (knocked there): committed — walk straight across on the zebra
    // to the far kerb instead of waiting in the road. Past the last
    // junction the road ends at the city edge, so turn back.
    if (!ped.wp && !ped.waiting) {
      const parallel = sw.axis === 'x' ? ped.x : ped.z;
      let j = nextJunction(parallel, sw.dir);
      if (j < -CITY_HALF || j > CITY_HALF) {
        sw.dir = -sw.dir;
        j = nextJunction(parallel, sw.dir);
      }
      const toJ = (j - parallel) * sw.dir;
      const jx = sw.axis === 'x' ? j : sw.line;
      const jz = sw.axis === 'x' ? sw.line : j;
      if (toJ >= 0 && toJ < ZEBRA_OFF - 1) {
        const far = sidewalkPoint(sw, j + sw.dir * ZEBRA_OFF);
        ped.wp = { x: far.x, z: far.z, kind: 'cross', jx, jz, axis: sw.axis, j };
      } else {
        const at = sidewalkPoint(sw, j - sw.dir * ZEBRA_OFF);
        ped.wp = { x: at.x, z: at.z, kind: 'along', j };
      }
    }

    // Steer at the waypoint. On a zebra against the signal, hurry
    // across — never wait in the road. Walking back to the strip after
    // a reaction hurries too — the shortest time on the road wins.
    if (ped.wp) {
      ped.angle = Math.atan2(ped.wp.z - ped.z, ped.wp.x - ped.x);
      ped.speed = ped.base;
      if (ped.wp.kind === 'back') ped.speed = ped.base * 1.6;
      if (ped.wp.kind === 'cross' && hasSignals && isSignalledJunction(ped.wp.jx, ped.wp.jz)
        && pedState(ped.wp.jx, ped.wp.jz, ped.wp.axis, sys.time) !== 'walk') {
        ped.speed = ped.base * 1.6;
      }
    } else if (!ped.waiting) {
      ped.speed = ped.base;
    }
  }

  function updatePed(player, ped, dt) {
    if (ped.mode === 'flee') {
      // Flee ALONG the ped's own line (sidewalk strip / market aisle /
      // beach promenade), away from the shot — never straight across
      // the lanes. A ped caught mid-road runs to the nearest strip
      // first, then along it; afterwards it re-snaps to its route.
      // The flee strip is pinned at the flee's start (see fleeTarget).
      if (!ped.fleeSw && ped.home === 'walk') ped.fleeSw = nearestSidewalk(ped);
      const target = fleeTarget(ped);
      ped.angle = Math.atan2(target.z - ped.z, target.x - ped.x);
      ped.speed = ped.base * 2.4;
      ped.fleeT -= dt;
      if (ped.fleeT <= 0) {
        // Not safe yet: keep running for the strip (max 4 s extra) —
        // a flee must not end with the ped still standing in a lane.
        // The bar is 1 m off the strip (inside the zebra band), not
        // 1.5 m: at 1.5 m the ped is 0.5 m outside the band and walks
        // its route parallel to the road through the next junction.
        // The slowest walker (2.4 m/s) covers the farthest strip exit
        // (~11 m from a junction centre) inside that window.
        if (ped.home === 'walk' && distToStrip(ped) > 1.0 && ped.fleeT > -4) {
          // keep fleeing
        } else { ped.mode = ped.home; ped.fighter = false; ped.fleeSw = null; }
      }
    } else if (ped.mode === 'duck') {
      ped.speed = 0;
      ped.duckT -= dt;
      if (ped.duckT <= 0) ped.mode = ped.home;
    } else if (ped.mode === 'chat') {
      // A stopped pair, talking: still, facing each other, until the
      // chat runs out — then they walk on, back on their own line.
      ped.speed = 0;
      ped.chatT -= dt;
      if (ped.chatT <= 0) ped.mode = ped.home;
    } else if (ped.mode === 'fight') {
      ped.speed = ped.base * 1.8;
      ped.angle = Math.atan2(player.z - ped.z, player.x - ped.x);
      ped.fleeT -= dt;
      if (ped.fleeT <= 0 || dist2(ped.x, ped.z, player.x, player.z) > 200) {
        ped.fighter = false;
        // Gives up mid-road: run for the strip like a fleer, don't
        // stroll back through the lanes at walking pace. The bar is
        // 1 m off the strip (inside the zebra band).
        if (ped.home === 'walk' && distToStrip(ped) > 1.0) {
          ped.mode = 'flee';
          ped.fleeT = 2;
        } else {
          ped.mode = ped.home;
        }
      }
    } else if (ped.mode === 'beach') {
      // Promenade strollers: waypoint-walk the sand strip west of the
      // beach road, within their home stretch. A hard guard turns any
      // ped that drifts toward the road back west, so no stroller can
      // ever reach the beach road's kerb.
      ped.speed = ped.base;
      if (ped.x > PROM_GUARD_X) {
        ped.angle = Math.PI;
        ped.wp = null;
      } else {
        const cz = ped.anchor ? ped.anchor.z : ped.z;
        if (!ped.wp || dist2(ped.x, ped.z, ped.wp.x, ped.wp.z) < 2
          || dist2(ped.x, ped.z, ped.wp.x, ped.wp.z) > 100) {
          ped.wp = {
            x: clamp(PROMENADE_X + (Math.random() - 0.5) * 20, PROM_WALK_MIN, PROM_WALK_MAX),
            z: clamp(ped.z + (Math.random() - 0.5) * 80, cz - 60, cz + 60),
          };
        }
        ped.angle = Math.atan2(ped.wp.z - ped.z, ped.wp.x - ped.x);
      }
    } else if (ped.mode === 'market') {
      // Market shoppers: walk the plaza aisle stall to stall, step up
      // to a stall front, browse a few seconds, move on. The whole
      // plaza sits inside one block, so a shopper never needs a lane.
      const a = ped.aisle || MARKET_AISLE;
      if (ped.browseT > 0) {
        ped.speed = 0;
        ped.browseT -= dt;
        if (ped.browseT <= 0) ped.wp = null;
      } else {
        if (!ped.wp) {
          const sx = a.stalls[Math.floor(Math.random() * a.stalls.length)];
          const sz = Math.random() < 0.5 ? a.frontN : a.frontS;
          ped.wp = { x: sx, z: a.aisleZ, kind: 'aisle' };
          ped.front = { x: sx, z: sz };
        }
        if (ped.wp.kind === 'aisle' && dist2(ped.x, ped.z, ped.wp.x, ped.wp.z) < 1.5) {
          ped.wp = { x: ped.front.x, z: ped.front.z, kind: 'front' };
        } else if (ped.wp.kind === 'front' && dist2(ped.x, ped.z, ped.wp.x, ped.wp.z) < 1.5) {
          ped.wp = null;
          ped.browseT = 4 + Math.random() * 6;
          ped.speed = 0;
        } else {
          ped.angle = Math.atan2(ped.wp.z - ped.z, ped.wp.x - ped.x);
          ped.speed = ped.base;
        }
      }
    } else {
      ped.speed = ped.base;
      if (ped.sw) {
        // Sidewalk route: stays on the 9 m strip, crosses only on
        // zebras at signalled junctions. Sets angle/speed itself.
        updateSidewalkPed(ped, dt);
      } else {
        // No route yet (a ped knocked far from its strip, or a legacy
        // spawn): give it the nearest sidewalk route NOW instead of
        // wandering — every walking ped has a route, so the old
        // random-walk + kerb-wait fallback is gone.
        ped.sw = nearestSidewalk(ped);
        ped.wp = null;
        updateSidewalkPed(ped, dt);
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
    // Player speed, from position deltas (smoothed over ~1 s): the
    // recycle radius follows it (wide on foot, tight when driving).
    if (typeof player.x === 'number' && typeof player.z === 'number') {
      if (sys._lastPx !== undefined) {
        const sp = Math.hypot(player.x - sys._lastPx, player.z - sys._lastPz) / Math.max(dt, 0.001);
        sys._playerSpeed = sys._playerSpeed === undefined ? sp
          : sys._playerSpeed + (sp - sys._playerSpeed) * Math.min(1, dt * 1.5);
      }
      sys._lastPx = player.x; sys._lastPz = player.z;
    }
    // The lights run on this same clock, so a lamp and the cars
    // waiting under it can never disagree — and the halo sizing gets
    // the night factor, so the discs grow after dark (B2's hook).
    if (lights) lights.update(sys.time, { nightF: nightFactor(events) });
    ensureLife(player);
    const rng = rngFor(sys.rngSeed + 41);
    for (const car of sys.cars) {
      if (car.traffic && !car.parkedRow) updateMover(player, car, dt);
    }
    for (let i = sys.peds.length - 1; i >= 0; i--) {
      const ped = sys.peds[i];
      if (ped.health <= 0) {
        // Downed, not gone: the body lies where it fell and fades
        // after ~25 s, then the street tops back up (below). It never
        // walks again and never blocks a lane for a whole session.
        if (ped.mode !== 'down') {
          ped.mode = 'down'; ped.down = true; ped.speed = 0; ped.downT = DOWN_FADE_S;
        }
        ped.downT -= dt;
        if (ped.downT <= 0) sys.peds.splice(i, 1);
        continue;
      }
      updatePed(player, ped, dt);
    }
    // Population bubble, once a second: recycle far agents into the
    // ring around the player, then top the street back up to its
    // counts (a faded body is replaced, not left as a hole).
    sys.recycleT = (sys.recycleT || 0) + dt;
    if (sys.recycleT >= 1) { sys.recycleT = 0; recycleFar(player, rng); }
    topUpPeds(player, rng);
    // Wrecked traffic gets towed and replaced so the street never empties.
    let moving = 0;
    let mopeds = 0;
    for (let i = sys.cars.length - 1; i >= 0; i--) {
      const c = sys.cars[i];
      if (!c.traffic || c.parkedRow) continue;
      if (c.damage >= 100) {
        despawnCarBody(c);
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
    return { moving, parked, mopeds, peds: sys.peds.length, total: sys.cars.length, lights: lights ? lights.summary() : null };
  }

  // How full the street is around the player: movers + peds within
  // `radius` m (default 150), split by ped home. The live-play probe
  // for the bubble — the number that has to stay high everywhere.
  function bubble(player, radius) {
    const R = radius || 150;
    let movers = 0, mopeds = 0, peds = 0, sidewalk = 0, beach = 0, market = 0;
    for (const c of sys.cars) {
      if (c.traffic && !c.parkedRow && dist2(c.x, c.z, player.x, player.z) <= R) {
        movers++;
        if (c.moped) mopeds++;
      }
    }
    for (const p of sys.peds) {
      if (dist2(p.x, p.z, player.x, player.z) <= R) {
        peds++;
        if (p.home === 'walk') sidewalk++;
        else if (p.home === 'beach') beach++;
        else if (p.home === 'market') market++;
      }
    }
    return { movers, mopeds, peds, sidewalk, beach, market };
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
  sys.bubble = bubble;
  sys.hud = hud;
  return sys;
}

export { MOVERS_WANTED, MOPEDS_WANTED, BEACH_PEDS, MARKET_PEDS, SIDEWALK_PEDS };
