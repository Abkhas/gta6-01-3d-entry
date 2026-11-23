// Palma Verde — moving traffic and pedestrians.
//
// The city feels empty without them, so this file keeps the streets
// busy: two dozen-plus cars cruising the road grid, parked rows along
// the beach road, mopeds weaving through, and pedestrians in groups
// on the sidewalks, the beach and the market aisles. Cars stick to
// their (correct) side of the road, stop at red lights, brake and
// honk behind the player, and steer around a blocked car instead of
// sitting on the horn forever. Pedestrians scatter when shots ring
// out. Cars live in state.cars, people in state.peds; the main loop
// calls update() once per frame.
//
// STAGING API (stable names — the shot/integration builder calls
// these to set per-shot density, and update() keeps the street full
// afterwards):
//   ensureLife(state, city)
//       First-frame setup. Tops moving traffic up to MOVERS_WANTED
//       (28, including MOPEDS_WANTED mopeds), parks two rows
//       (beach road + Citrus Lane avenue), and seeds 52 pedestrians
//       in groups: 14 beachgoers, 16 market shoppers, 22 sidewalk
//       walkers. Live play adds main.js's 18 strollers on top, so a
//       live street holds 70 pedestrians.
//   spawnMover(state, city, rng) -> car
//       One moving traffic car near the player, on the correct side
//       of its road, cruising at its own speed.
//   spawnMoped(state, city, rng) -> car
//       One moped (car.moped = true, model 'olas'): faster, nimbler,
//       drawn slim by the renderer. Two ride the streets.
//   spawnParkedRow(state, city, rng, avenueX, y0, y1) -> count
//       Parks a row of cars along the east kerb of the avenue at
//       avenueX, from height y0 to y1, ~62 apart, facing along the
//       road. Returns how many cars were parked.
//   spawnPed(state, city, rng, beach) -> ped
//       One pedestrian: a beach stroller (beach true) or a sidewalk
//       walker (beach false).
//   spawnPedGroup(state, city, rng, cx, cy, n, kind) -> [ped]
//       A cluster of n pedestrians around (cx, cy). kind is 'beach'
//       (sand strollers with a home patch), 'market' (shoppers who
//       stay near the aisle) or 'sidewalk' (walkers along the road).
//   lightIsRed(state, city, car) -> true/false
//       True when the car is approaching a junction whose light is
//       red for its direction of travel. Lights run a 12 s cycle,
//       staggered by junction so the city is not all red at once.
//
// Counts (live street, after ensureLife + main.js seeding):
//   moving cars 28 (26 cars + 2 mopeds), parked rows 20,
//   pedestrians 70 (52 grouped here + 18 strollers).

(function () {
  'use strict';

  var WORLD = window.PalmaWorld;
  var VEH = window.PalmaVehicles;

  var MOVERS_WANTED = 28;
  var MOPEDS_WANTED = 2;
  var BEACH_PEDS = 14;
  var MARKET_PEDS = 16;
  var SIDEWALK_PEDS = 22;
  var SKINS = ['#e8b48f', '#c98d64', '#8a5a3b', '#f0c8a0', '#a06a45'];
  var SHIRTS = ['#3d7ea6', '#c94f3d', '#e8c53a', '#4a6b4f', '#e86a92', '#7a5a9e', '#2e8b7a', '#d97b2b'];

  // Traffic-light cycle, seconds: north-south green 0..5.5, then
  // east-west green 6..11.5, with a short amber each way. Each
  // junction staggers its phase by (avenue + street) % 3 * 2 s.
  var LIGHT_CYCLE = 12;

  function dist(ax, ay, bx, by) {
    var dx = ax - bx, dy = ay - by;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function angDiff(a, b) {
    var twoPi = Math.PI * 2;
    var d = (b - a) % twoPi;
    if (d > Math.PI) d -= twoPi;
    if (d < -Math.PI) d += twoPi;
    return d;
  }

  function probeBlocked(city, x, y, angle, ahead) {
    var px = x + Math.cos(angle) * ahead;
    var py = y + Math.sin(angle) * ahead;
    return WORLD.isSolid(city, px, py);
  }

  function junctionIndex(list, v) {
    var best = 0, bd = 1e9;
    for (var i = 0; i < list.length; i++) {
      var d = Math.abs(list[i] - v);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  // True when the car is closing on a junction (within 52 of the
  // crossing line) and the light is red for its direction.
  function lightIsRed(state, city, car) {
    var road = WORLD.roadAt(city, car.x, car.y);
    if (!road) return false;
    var ai, si, next, distTo, phase, i;
    if (road.axis === 'x') {
      var dirNS = Math.sin(car.angle) < 0 ? -1 : 1;
      ai = junctionIndex(city.avenues, car.x);
      next = null;
      for (i = 0; i < city.streets.length; i++) {
        var s = city.streets[i];
        if (dirNS < 0 && s < car.y && (next === null || s > next)) next = s;
        if (dirNS > 0 && s > car.y && (next === null || s < next)) next = s;
      }
      if (next === null) return false;
      distTo = Math.abs(next - car.y);
      si = junctionIndex(city.streets, next);
      phase = (state.time + ((ai + si) % 3) * 2) % LIGHT_CYCLE;
      return distTo < 52 && phase >= 5.5;
    }
    var dirEW = Math.cos(car.angle) < 0 ? -1 : 1;
    si = junctionIndex(city.streets, car.y);
    next = null;
    for (i = 0; i < city.avenues.length; i++) {
      var a = city.avenues[i];
      if (dirEW < 0 && a < car.x && (next === null || a > next)) next = a;
      if (dirEW > 0 && a > car.x && (next === null || a < next)) next = a;
    }
    if (next === null) return false;
    distTo = Math.abs(next - car.x);
    ai = junctionIndex(city.avenues, next);
    phase = (state.time + ((ai + si) % 3) * 2) % LIGHT_CYCLE;
    return distTo < 52 && !(phase >= 6 && phase < 11.5);
  }

  // A moving car: pick a road spot near the player so the streets
  // around Rey are the busy ones, then cruise along the lanes.
  function spawnMover(state, city, rng) {
    var p = state.player;
    var spot = null;
    for (var tries = 0; tries < 8; tries++) {
      var s = WORLD.randomRoadSpot(city, rng);
      if (dist(s.x, s.y, p.x, p.y) < 850) { spot = s; break; }
      spot = s;
    }
    var car = VEH.makeCar(VEH.pickModel(rng), spot.x, spot.y, spot.angle, {});
    car.traffic = true;
    car.cruise = 85 + rng() * 65;
    car.wait = 0;
    car.blocked = 0;
    car.playerBlock = 0;
    car.goAroundT = 0;
    car.honk = false;
    state.cars.push(car);
    return car;
  }

  // A moped: same streets as the cars, but faster, nimbler, and
  // flagged so the renderer draws a slim two-wheeler with a rider
  // instead of a full car body.
  function spawnMoped(state, city, rng) {
    var p = state.player;
    var spot = null;
    for (var tries = 0; tries < 8; tries++) {
      var s = WORLD.randomRoadSpot(city, rng);
      if (dist(s.x, s.y, p.x, p.y) < 850) { spot = s; break; }
      spot = s;
    }
    var car = VEH.makeCar('olas', spot.x, spot.y, spot.angle, {});
    car.traffic = true;
    car.moped = true;
    car.cruise = 105 + rng() * 45;
    car.wait = 0;
    car.blocked = 0;
    car.playerBlock = 0;
    car.goAroundT = 0;
    car.honk = false;
    state.cars.push(car);
    return car;
  }

  // A parked row: cars nose-to-tail along the east kerb of the
  // avenue at avenueX, from height y0 to y1, ~62 apart, facing
  // along the road. Returns how many cars were parked.
  function spawnParkedRow(state, city, rng, avenueX, y0, y1) {
    var n = 0;
    for (var y = y0; y <= y1; y += 62) {
      var car = VEH.makeCar(VEH.pickModel(rng), avenueX + 26, y, -Math.PI / 2, {});
      car.parkedRow = true;
      state.cars.push(car);
      n++;
    }
    return n;
  }

  // A pedestrian: either a beach stroller with a patch of sand to
  // wander, or a sidewalk walker in a small group near a road.
  function spawnPed(state, city, rng, beach) {
    var p = state.player;
    var ped = {
      x: 0, y: 0, angle: rng() * Math.PI * 2,
      speed: 0, base: 18 + rng() * 26,
      color: SKINS[Math.floor(rng() * SKINS.length)],
      shirt: SHIRTS[Math.floor(rng() * SHIRTS.length)],
      health: 100, mode: 'walk', fleeT: 0, anchor: null, beach: false
    };
    if (beach) {
      ped.x = 230 + rng() * 280;
      ped.y = 300 + rng() * (city.height - 600);
      ped.mode = 'beach';
      ped.beach = true;
      ped.base = 12 + rng() * 14;
      ped.anchor = { x: ped.x, y: ped.y };
    } else {
      var spot = null;
      for (var tries = 0; tries < 8; tries++) {
        var s = WORLD.randomRoadSpot(city, rng);
        if (dist(s.x, s.y, p.x, p.y) < 800) { spot = s; break; }
        spot = s;
      }
      var side = rng() < 0.5 ? -1 : 1;
      ped.x = spot.x + side * (26 + rng() * 14);
      ped.y = spot.y + (rng() - 0.5) * 50;
      ped.speed = ped.base;
    }
    ped.speed = ped.base;
    state.peds.push(ped);
    return ped;
  }

  // A cluster of n pedestrians around (cx, cy). 'beach' strollers
  // stay on their patch of sand, 'market' shoppers stay near the
  // aisle, 'sidewalk' walkers stroll along the road. Returns the
  // peds it made, so the staging builder can move a group as one.
  function spawnPedGroup(state, city, rng, cx, cy, n, kind) {
    var made = [];
    for (var i = 0; i < n; i++) {
      var ped = {
        x: cx + (rng() - 0.5) * 70, y: cy + (rng() - 0.5) * 50,
        angle: rng() * Math.PI * 2, speed: 0,
        base: 14 + rng() * 20,
        color: SKINS[Math.floor(rng() * SKINS.length)],
        shirt: SHIRTS[Math.floor(rng() * SHIRTS.length)],
        health: 100, mode: 'walk', fleeT: 0, anchor: null, beach: false
      };
      if (kind === 'beach') {
        ped.mode = 'beach';
        ped.beach = true;
        ped.base = 10 + rng() * 12;
        ped.anchor = { x: ped.x, y: ped.y };
      } else if (kind === 'market') {
        ped.mode = 'walk';
        ped.base = 12 + rng() * 16;
        ped.anchor = { x: cx, y: cy };
      }
      ped.speed = ped.base;
      state.peds.push(ped);
      made.push(ped);
    }
    return made;
  }

  // First-frame setup: top the traffic up to a full street, park two
  // rows, and seed the pedestrian groups. The main loop already
  // seeded parked cars and a few strollers; this only adds the
  // moving life. Runs once (state.trafficReady).
  function ensureLife(state, city) {
    if (state.trafficReady) return;
    state.trafficReady = true;
    var rng = WORLD.makeRng(city.seed + 31);
    var moving = 0, mopeds = 0, i;
    for (i = 0; i < state.cars.length; i++) {
      if (state.cars[i].traffic) moving++;
      if (state.cars[i].moped) mopeds++;
    }
    while (mopeds < MOPEDS_WANTED) {
      spawnMoped(state, city, rng);
      mopeds++;
      moving++;
    }
    while (moving < MOVERS_WANTED) {
      spawnMover(state, city, rng);
      moving++;
    }
    // Parked rows: a full kerb along the Boardwalk beach road and a
    // second row on the Citrus Lane avenue, so the streets read
    // parked-up instead of empty.
    spawnParkedRow(state, city, rng, WORLD.BEACH.beachRoadX, 620, 1240);
    spawnParkedRow(state, city, rng, 1680, 1000, 1500);
    // Beachgoers on the sand, between the road and the water.
    spawnPedGroup(state, city, rng, 330, 800, 5, 'beach');
    spawnPedGroup(state, city, rng, 400, 1600, 5, 'beach');
    spawnPedGroup(state, city, rng, 320, 2400, 4, 'beach');
    // Market crowds in the Citrus Lane stall aisles.
    spawnPedGroup(state, city, rng, 1200, 1380, 6, 'market');
    spawnPedGroup(state, city, rng, 1650, 1460, 5, 'market');
    spawnPedGroup(state, city, rng, 900, 1420, 5, 'market');
    // Sidewalk groups along the roads, spread across the districts.
    spawnPedGroup(state, city, rng, 1000, 700, 6, 'sidewalk');
    spawnPedGroup(state, city, rng, 2200, 1100, 5, 'sidewalk');
    spawnPedGroup(state, city, rng, 3000, 2000, 5, 'sidewalk');
    spawnPedGroup(state, city, rng, 1300, 2600, 6, 'sidewalk');
  }

  // What is directly ahead of this car, inside its lane: a moving
  // car, a police car, or the player's vehicle. Parked cars are
  // skipped (they sit in bays at the kerb); a car in the next lane
  // is skipped too, by the lateral test.
  function carAhead(state, car) {
    var cars = state.cars || [];
    for (var i = 0; i < cars.length; i++) {
      var o = cars[i];
      if (o === car || (o.speed === 0 && !o.traffic && !o.police)) continue;
      var dx = o.x - car.x, dy = o.y - car.y;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d > 70 || d < 4) continue;
      var dot = (dx * Math.cos(car.angle) + dy * Math.sin(car.angle)) / d;
      if (dot < 0.82) continue;
      var perp = Math.abs(-dx * Math.sin(car.angle) + dy * Math.cos(car.angle));
      if (perp > 16) continue;
      return { kind: o.police ? 'police' : 'car' };
    }
    var pv = state.player.vehicle;
    if (pv && pv !== car) {
      var pdx = pv.x - car.x, pdy = pv.y - car.y;
      var pd = Math.sqrt(pdx * pdx + pdy * pdy);
      if (pd < 70 && pd > 4) {
        var pdot = (pdx * Math.cos(car.angle) + pdy * Math.sin(car.angle)) / pd;
        var pperp = Math.abs(-pdx * Math.sin(car.angle) + pdy * Math.cos(car.angle));
        if (pdot > 0.82 && pperp <= 16) return { kind: 'player' };
      }
    }
    return null;
  }

  function updateMover(state, city, car, dt) {
    var p = state.player;
    var dPlayer = dist(car.x, car.y, p.x, p.y);
    var want = car.cruise;
    // Traffic pulls over and stops when a chase rolls past.
    if (state.wanted >= 3 && dPlayer < 380) want = 0;
    // Gunfire nearby makes drivers floor it away from the noise.
    var shot = state.lastShotAt;
    if (shot && state.time - shot.t < 2.5 && dist(car.x, car.y, shot.x, shot.y) < 500) {
      want = car.cruise * 1.7;
    }
    // Red light ahead: stop at the line, like the rest of the city.
    if (lightIsRed(state, city, car)) want = 0;
    // Something in our lane: brake. Behind the player, wait a beat,
    // honk, then steer around instead of sitting there forever.
    var ahead = carAhead(state, car);
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
    if (probeBlocked(city, car.x, car.y, car.angle, 58)) {
      want = 0;
      car.blocked += dt;
      if (car.blocked > 1.4) {
        car.blocked = 0;
        car.angle += (Math.random() < 0.5 ? 1 : -1) * Math.PI / 2;
      }
    } else {
      car.blocked = 0;
    }
    // Lane follow: ease the heading onto the road axis we are on,
    // swinging half a lane to the side while passing the player.
    var road = WORLD.roadAt(city, car.x, car.y);
    if (road) {
      var desired;
      if (road.axis === 'x') desired = Math.sin(car.angle) < 0 ? -Math.PI / 2 : Math.PI / 2;
      else desired = Math.cos(car.angle) < 0 ? Math.PI : 0;
      if (car.goAroundT > 0) desired += (car.goAroundSide || 1) * 0.5;
      car.angle += angDiff(car.angle, desired) * Math.min(1, 2.2 * dt);
    }
    // Ease toward the wanted speed, braking harder than accelerating.
    var rate = want < car.speed ? 2.6 : 1.1;
    car.speed += (want - car.speed) * Math.min(1, rate * dt);
    if (Math.abs(car.speed) < 0.5) car.speed = 0;
    // Step forward, sliding past anything solid instead of sticking.
    var nx = car.x + Math.cos(car.angle) * car.speed * dt;
    var ny = car.y + Math.sin(car.angle) * car.speed * dt;
    if (!WORLD.isSolid(city, nx, car.y)) car.x = nx;
    else car.speed *= 0.5;
    if (!WORLD.isSolid(city, car.x, ny)) car.y = ny;
    else car.speed *= 0.5;
    // Never drift off the map: turn back toward the middle of town.
    if (car.x < 330 || car.x > city.width - 40 || car.y < 60 || car.y > city.height - 40) {
      var home = Math.atan2(city.height / 2 - car.y, city.width / 2 - car.x);
      car.angle += angDiff(car.angle, home) * Math.min(1, 3 * dt);
    }
  }

  function threatNear(state, ped) {
    var shot = state.lastShotAt;
    if (shot && state.time - shot.t < 3 && dist(ped.x, ped.y, shot.x, shot.y) < 480) {
      return { x: shot.x, y: shot.y };
    }
    if (state.wanted >= 2 && state.police && state.police.units) {
      for (var i = 0; i < state.police.units.length; i++) {
        var c = state.police.units[i].car;
        if (dist(ped.x, ped.y, c.x, c.y) < 170) return { x: c.x, y: c.y };
      }
    }
    return null;
  }

  function updatePed(state, city, ped, dt) {
    var danger = threatNear(state, ped);
    if (danger && ped.mode !== 'flee') {
      ped.mode = 'flee';
      ped.fleeT = 3;
      ped.angle = Math.atan2(ped.y - danger.y, ped.x - danger.x);
    }
    if (ped.mode === 'flee') {
      ped.speed = ped.base * 2.4;
      ped.fleeT -= dt;
      if (ped.fleeT <= 0) ped.mode = ped.beach ? 'beach' : 'walk';
    } else if (ped.mode === 'beach') {
      ped.speed = ped.base;
      if (ped.anchor && dist(ped.x, ped.y, ped.anchor.x, ped.anchor.y) > 70) {
        ped.angle = Math.atan2(ped.anchor.y - ped.y, ped.anchor.x - ped.x);
      } else {
        ped.angle += (Math.random() - 0.5) * 1.6 * dt;
      }
    } else {
      ped.speed = ped.base;
      // Market shoppers stay near their aisle; sidewalk walkers
      // wander until something solid turns them.
      if (ped.anchor && dist(ped.x, ped.y, ped.anchor.x, ped.anchor.y) > 90) {
        ped.angle = Math.atan2(ped.anchor.y - ped.y, ped.anchor.x - ped.x);
      } else {
        ped.angle += (Math.random() - 0.5) * 0.5 * dt;
      }
      if (probeBlocked(city, ped.x, ped.y, ped.angle, 26)) {
        ped.angle += (Math.random() < 0.5 ? 1 : -1) * (0.9 + Math.random() * 0.9);
      }
    }
    var nx = ped.x + Math.cos(ped.angle) * ped.speed * dt;
    var ny = ped.y + Math.sin(ped.angle) * ped.speed * dt;
    if (!WORLD.isSolid(city, nx, ped.y)) ped.x = nx;
    else ped.angle += Math.PI / 2 * dt * 4;
    if (!WORLD.isSolid(city, ped.x, ny)) ped.y = ny;
    else ped.angle += Math.PI / 2 * dt * 4;
    if (ped.x < 200 || ped.x > city.width - 30 || ped.y < 30 || ped.y > city.height - 30) {
      ped.angle = Math.atan2(city.height / 2 - ped.y, city.width / 2 - ped.x);
    }
  }

  function update(state, city, dt) {
    ensureLife(state, city);
    var i;
    for (i = 0; i < state.cars.length; i++) {
      var car = state.cars[i];
      if (car.traffic) updateMover(state, city, car, dt);
    }
    for (i = state.peds.length - 1; i >= 0; i--) {
      var ped = state.peds[i];
      if (ped.health <= 0) { state.peds.splice(i, 1); continue; }
      updatePed(state, city, ped, dt);
    }
    // Wrecked traffic gets towed and replaced so the street never empties.
    var rng = WORLD.makeRng((city.seed + 31 + Math.floor(state.time)) >>> 0);
    var moving = 0, mopeds = 0;
    for (i = state.cars.length - 1; i >= 0; i--) {
      var c = state.cars[i];
      if (!c.traffic) continue;
      if (c.damage >= 100) { state.cars.splice(i, 1); continue; }
      moving++;
      if (c.moped) mopeds++;
    }
    while (mopeds < MOPEDS_WANTED) {
      spawnMoped(state, city, rng);
      mopeds++;
      moving++;
    }
    while (moving < MOVERS_WANTED) {
      spawnMover(state, city, rng);
      moving++;
    }
  }

  window.PalmaTraffic = {
    update: update,
    ensureLife: ensureLife,
    spawnMover: spawnMover,
    spawnMoped: spawnMoped,
    spawnParkedRow: spawnParkedRow,
    spawnPed: spawnPed,
    spawnPedGroup: spawnPedGroup,
    lightIsRed: lightIsRed,
    MOVERS_WANTED: MOVERS_WANTED,
    MOPEDS_WANTED: MOPEDS_WANTED,
    BEACH_PEDS: BEACH_PEDS,
    MARKET_PEDS: MARKET_PEDS,
    SIDEWALK_PEDS: SIDEWALK_PEDS
  };
})();
