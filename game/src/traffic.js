// Palma Verde — moving traffic and pedestrians.
//
// The city feels empty without them, so this file keeps the streets
// busy: a dozen-plus cars cruising the road grid, and pedestrians in
// small groups on the sidewalks and the beach. Cars stick to lanes,
// pull over when a chase rolls past, and speed off when shots ring
// out. Pedestrians scatter the same way. Cars live in state.cars,
// people in state.peds; the main loop calls update() once per frame.

(function () {
  'use strict';

  var WORLD = window.PalmaWorld;
  var VEH = window.PalmaVehicles;

  var MOVERS_WANTED = 14;
  var EXTRA_PEDS = 16;
  var SKINS = ['#e8b48f', '#c98d64', '#8a5a3b', '#f0c8a0', '#a06a45'];
  var SHIRTS = ['#3d7ea6', '#c94f3d', '#e8c53a', '#4a6b4f', '#e86a92', '#7a5a9e', '#2e8b7a', '#d97b2b'];

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
    state.cars.push(car);
    return car;
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
      health: 100, mode: 'walk', fleeT: 0, anchor: null
    };
    if (beach) {
      ped.x = 200 + rng() * 85;
      ped.y = 300 + rng() * (city.height - 600);
      ped.mode = 'beach';
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

  // First-frame setup: top the traffic up to a full street and add
  // beach walkers plus sidewalk groups. The main loop already seeded
  // parked cars and a few strollers; this only adds the moving life.
  function ensureLife(state, city) {
    if (state.trafficReady) return;
    state.trafficReady = true;
    var rng = WORLD.makeRng(city.seed + 31);
    var moving = 0, i;
    for (i = 0; i < state.cars.length; i++) {
      if (state.cars[i].traffic) moving++;
    }
    while (moving < MOVERS_WANTED) {
      spawnMover(state, city, rng);
      moving++;
    }
    for (i = 0; i < 6; i++) spawnPed(state, city, rng, true);
    for (i = 0; i < EXTRA_PEDS - 6; i++) spawnPed(state, city, rng, false);
  }

  function carAhead(state, car) {
    var cars = state.cars || [];
    for (var i = 0; i < cars.length; i++) {
      var o = cars[i];
      if (o === car || o.speed === 0 && !o.traffic && !o.police) continue;
      var dx = o.x - car.x, dy = o.y - car.y;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d > 70 || d < 4) continue;
      var dot = (dx * Math.cos(car.angle) + dy * Math.sin(car.angle)) / d;
      if (dot > 0.82) return true;
    }
    var pv = state.player.vehicle;
    if (pv) {
      var pdx = pv.x - car.x, pdy = pv.y - car.y;
      var pd = Math.sqrt(pdx * pdx + pdy * pdy);
      if (pd < 70 && pd > 4) {
        var pdot = (pdx * Math.cos(car.angle) + pdy * Math.sin(car.angle)) / pd;
        if (pdot > 0.82) return true;
      }
    }
    return false;
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
    if (carAhead(state, car)) want = 0;
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
    // Lane follow: ease the heading onto the road axis we are on.
    var road = WORLD.roadAt(city, car.x, car.y);
    if (road) {
      var desired;
      if (road.axis === 'x') desired = Math.sin(car.angle) < 0 ? -Math.PI / 2 : Math.PI / 2;
      else desired = Math.cos(car.angle) < 0 ? Math.PI : 0;
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
      if (ped.fleeT <= 0) ped.mode = ped.anchor ? 'beach' : 'walk';
    } else if (ped.mode === 'beach') {
      ped.speed = ped.base;
      if (ped.anchor && dist(ped.x, ped.y, ped.anchor.x, ped.anchor.y) > 70) {
        ped.angle = Math.atan2(ped.anchor.y - ped.y, ped.anchor.x - ped.x);
      } else {
        ped.angle += (Math.random() - 0.5) * 1.6 * dt;
      }
    } else {
      ped.speed = ped.base;
      ped.angle += (Math.random() - 0.5) * 0.5 * dt;
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
    var moving = 0;
    for (i = state.cars.length - 1; i >= 0; i--) {
      var c = state.cars[i];
      if (!c.traffic) continue;
      if (c.damage >= 100) { state.cars.splice(i, 1); continue; }
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
    spawnPed: spawnPed,
    MOVERS_WANTED: MOVERS_WANTED
  };
})();
