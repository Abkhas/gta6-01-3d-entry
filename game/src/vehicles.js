// Palma Verde — cars: driving physics, damage, stealing.
//
// A car is plain data: { model, x, y, angle, speed, damage, owned,
// driver, police }. The model table lives in config.js; this file only
// knows how a car moves, how it breaks, and how it changes hands.
// Traffic and police builders spawn cars through makeCar and park them
// through parkCar, and drive them by calling updateCar with the same
// input shape the player uses.

(function () {
  'use strict';

  var CFG = window.PalmaConfig;
  var WORLD = window.PalmaWorld;

  var CAR_LEN = 46, CAR_WID = 22;

  function modelById(id) {
    for (var i = 0; i < CFG.CARS.length; i++) {
      if (CFG.CARS[i].id === id) return CFG.CARS[i];
    }
    return CFG.CARS[1];
  }

  function makeCar(modelId, x, y, angle, opts) {
    var o = opts || {};
    return {
      model: modelById(modelId),
      x: x, y: y, angle: angle || 0,
      speed: 0, damage: o.damage || 0,
      owned: !!o.owned, driver: o.driver || null,
      police: !!o.police, color: o.color || modelById(modelId).color,
      steering: 0
    };
  }

  // A parked car: place it at a road spot, facing along the road.
  function parkCar(city, rng, modelId) {
    var spot = WORLD.randomRoadSpot(city, rng);
    var car = makeCar(modelId || pickModel(rng), spot.x, spot.y, spot.angle, {});
    return car;
  }

  function pickModel(rng) {
    // Weight the roster toward cheap street cars; the Cometa GT almost
    // never parks itself — it has to be found or stolen on purpose.
    var roll = rng();
    if (roll < 0.25) return 'vela';
    if (roll < 0.45) return 'brisa';
    if (roll < 0.58) return 'monzon';
    if (roll < 0.70) return 'corriente';
    if (roll < 0.80) return 'faro';
    if (roll < 0.88) return 'tiburon';
    if (roll < 0.95) return 'halcon';
    return 'playa';
  }

  // input: { throttle: -1..1, steer: -1..1, brake: bool, handbrake: bool }
  // dt in seconds. Returns a small event object for sound and effects.
  function updateCar(state, city, car, input, dt) {
    var model = car.model;
    var events = { crashed: false, scraped: false };
    // Acceleration: the engine pulls toward top speed; braking and
    // reversing fight it. Damage saps the top end.
    var top = model.top * (1 - car.damage / 220);
    var accel = model.accel * 260;
    if (input.throttle > 0) {
      car.speed += accel * input.throttle * dt * (car.speed < top ? 1 : 0.15);
    } else if (input.throttle < 0) {
      if (car.speed > 4) car.speed -= accel * 1.4 * dt;
      else car.speed = Math.max(-42, car.speed + accel * 0.55 * dt);
    } else {
      car.speed -= car.speed * 0.9 * dt;
    }
    if (input.brake) car.speed -= car.speed * 2.6 * dt + Math.sign(car.speed) * 60 * dt;
    if (input.handbrake) {
      car.speed -= car.speed * 4.5 * dt;
      car.steering = input.steer * 1.6;
    }
    // Drag and rolling stop.
    car.speed -= car.speed * 0.12 * dt;
    if (Math.abs(car.speed) < 0.6 && input.throttle === 0) car.speed = 0;
    car.speed = Math.max(-46, Math.min(top + 12, car.speed));

    // Steering bites harder at low speed and washes out at high speed.
    var steerTarget = input.steer * model.grip;
    car.steering += (steerTarget - car.steering) * Math.min(1, 8 * dt);
    var turnRate = car.steering * 2.1 * Math.min(1, Math.abs(car.speed) / 40 + 0.25);
    if (car.speed < 0) turnRate = -turnRate;
    car.angle += turnRate * dt * Math.sign(car.speed || 1);

    // Step forward, then resolve collisions against buildings and other
    // cars one axis at a time so a crash slides instead of sticking.
    var nx = car.x + Math.cos(car.angle) * car.speed * dt;
    var ny = car.y + Math.sin(car.angle) * car.speed * dt;
    var hit = false;
    if (!hitsAnything(state, city, car, nx, car.y)) {
      car.x = nx;
    } else { hit = true; }
    if (!hitsAnything(state, city, car, car.x, ny)) {
      car.y = ny;
    } else { hit = true; }
    if (hit) {
      var impact = Math.abs(car.speed);
      if (impact > 30) {
        car.damage = Math.min(100, car.damage + impact * 0.12);
        events.crashed = true;
        if (state && state.player && car.driver === 'player') {
          // A hard crash hurts the driver a little.
          window.PalmaPlayer.takeDamage(state, impact * 0.04);
        }
      } else if (impact > 8) {
        events.scraped = true;
      }
      car.speed *= 0.35;
    }
    return events;
  }

  function hitsAnything(state, city, car, x, y) {
    // Building / map collision at the four corners of the car body.
    var cos = Math.cos(car.angle), sin = Math.sin(car.angle);
    var corners = [
      [CAR_LEN / 2, CAR_WID / 2], [CAR_LEN / 2, -CAR_WID / 2],
      [-CAR_LEN / 2, CAR_WID / 2], [-CAR_LEN / 2, -CAR_WID / 2]
    ];
    for (var i = 0; i < 4; i++) {
      var px = x + corners[i][0] * cos - corners[i][1] * sin;
      var py = y + corners[i][0] * sin + corners[i][1] * cos;
      if (WORLD.isSolid(city, px, py)) return true;
    }
    // Other cars: cheap circle test at the centre.
    var others = state.cars || [];
    for (var j = 0; j < others.length; j++) {
      var o = others[j];
      if (o === car) continue;
      var dx = o.x - x, dy = o.y - y;
      if (dx * dx + dy * dy < 42 * 42) return true;
    }
    if (state.player && state.player.vehicle && state.player.vehicle !== car) {
      var pv = state.player.vehicle;
      var pdx = pv.x - x, pdy = pv.y - y;
      if (pdx * pdx + pdy * pdy < 42 * 42) return true;
    }
    return false;
  }

  // Repair: costs money, returns the new damage percent.
  function repairCar(state, car, full) {
    var cost = full ? CFG.PRICES.repairFull : CFG.PRICES.repairHalf;
    if (state.player.money < cost) return { ok: false, reason: 'broke' };
    if (car.damage <= 0) return { ok: false, reason: 'mint' };
    state.player.money -= cost;
    car.damage = full ? 0 : Math.max(0, car.damage - 50);
    return { ok: true, damage: car.damage, cost: cost };
  }

  // Condition as the HUD shows it: 100 minus damage.
  function condition(car) {
    return Math.max(0, Math.round(100 - car.damage));
  }

  // Steal check: the player takes a car they do not own. The wanted
  // bump itself lives in player.js; this helper only answers whether
  // the car counts as stolen and what the street saw.
  function stealCar(state, car) {
    if (car.owned) return { stolen: false };
    if (car.police) {
      state.wanted = Math.max(state.wanted, 3);
      return { stolen: true, heat: 3, note: 'Stole a PVPD cruiser' };
    }
    return { stolen: true, heat: 1, note: 'Stole a ' + car.model.name };
  }

  // The hero car: a bright coral-red Cometa GT, parked in its lot in
  // Old Town. The systems builder wires mission two to this spawn.
  function spawnHeroCar(city) {
    var s = WORLD.findSpawn(city, 'cometa');
    return makeCar('cometa', s.x, s.y, Math.PI / 2, { owned: false });
  }

  window.PalmaVehicles = {
    makeCar: makeCar, parkCar: parkCar, updateCar: updateCar,
    repairCar: repairCar, condition: condition,
    stealCar: stealCar, spawnHeroCar: spawnHeroCar,
    modelById: modelById, pickModel: pickModel,
    CAR_LEN: CAR_LEN, CAR_WID: CAR_WID
  };

  // ---- The Gull: Rey's flyable air-taxi heli ----
  //
  // A heli is plain data like a car, plus height and a spinning rotor:
  // { kind, name, x, y, angle, altitude, speed, climb, rotor, damage,
  // driver, landed, color }. Altitude is metres; one metre reads as
  // four world units, so a rooftop of height h units sits at h / 4
  // metres. Flying the Gull never raises wanted on its own — it is an
  // air-taxi, and the rooftop pickup in mission five relies on Rey
  // being able to come and go without the PVPD noticing. The loop
  // hands the city in through state.city and the keys through
  // state.heliInput ({ throttle, steer, climb, brake }) each frame.

  var GULL_UNITS_PER_M = 4;
  var GULL_TOP_SPEED = 120;   // world units per second, forward
  var GULL_BACK_SPEED = 30;   // world units per second, reverse
  var GULL_CLIMB_UP = 6;      // metres per second
  var GULL_CLIMB_DOWN = 5;    // metres per second
  var GULL_MAX_ALT = 120;     // metres
  var GULL_HOVER_FLOOR = 1.5; // metres: below this, palms and kerbs matter

  // Parked on the sand by the pier by default; the staging builder can
  // pass x/y/angle to put her somewhere exact for a shot.
  function spawnGull(city, opts) {
    var o = opts || {};
    var pad = WORLD.findSpawn(city, 'pier');
    return {
      kind: 'heli', name: 'Gull',
      x: o.x !== undefined ? o.x : pad.x + 90,
      y: o.y !== undefined ? o.y : pad.y + 20,
      angle: o.angle !== undefined ? o.angle : -Math.PI / 2,
      altitude: 0, speed: 0, climb: 0, rotor: 0, rotorSpeed: 0,
      damage: 0, driver: null, landed: true,
      color: '#ffd166'
    };
  }

  // Flat deck under a point, in metres: a rooftop when the point is
  // over a building, open ground (or pier sand) everywhere else.
  function deckHeight(city, x, y) {
    var halls = city.buildings;
    for (var i = 0; i < halls.length; i++) {
      var b = halls[i];
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.d) {
        return b.h / GULL_UNITS_PER_M;
      }
    }
    return 0;
  }

  // True when the Gull cannot sit at (x, y) at this altitude: inside a
  // building taller than she is high, or brushing something solid near
  // the ground (a palm trunk, the wheel base, the map edge, the water).
  function gullBlocked(city, x, y, altitude) {
    var halls = city.buildings;
    for (var i = 0; i < halls.length; i++) {
      var b = halls[i];
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.d) {
        if (altitude * GULL_UNITS_PER_M < b.h) return true;
      }
    }
    if (altitude < GULL_HOVER_FLOOR && WORLD.isSolid(city, x, y)) return true;
    if (x < 8 || x > CFG.CITY.width - 8 || y < 8 || y > CFG.CITY.height - 8) return true;
    return false;
  }

  // Altitude readout for the HUD, in whole metres.
  function gullAltitude(heli) {
    if (!heli) return 0;
    return Math.round(heli.altitude || 0);
  }

  // Fly the Gull one tick. dt is seconds. Returns an event bag for
  // shake and sound: { crashed, scraped, landed, liftedOff }.
  function updateHeli(state, dt) {
    var events = { crashed: false, scraped: false, landed: false, liftedOff: false };
    var heli = state.player ? state.player.vehicle : null;
    if (!heli || heli.kind !== 'heli') return events;
    var city = state.city || null;
    var input = state.heliInput || {};
    var throttle = input.throttle || 0;
    var steer = input.steer || 0;
    var climbIn = input.climb || 0;

    // Rotor spools up in the air and idles on the deck.
    var spinTarget = heli.landed ? 3 : 16;
    heli.rotorSpeed += (spinTarget - heli.rotorSpeed) * Math.min(1, 1.5 * dt);
    heli.rotor += heli.rotorSpeed * dt;

    // Vertical: climb input lifts off the deck; no input holds a hover.
    if (heli.landed) {
      heli.climb = 0;
      if (climbIn > 0) {
        heli.landed = false;
        heli.climb = GULL_CLIMB_UP * climbIn;
        events.liftedOff = true;
      }
    } else {
      var climbTarget = 0;
      if (climbIn > 0) climbTarget = GULL_CLIMB_UP * climbIn;
      else if (climbIn < 0) climbTarget = GULL_CLIMB_DOWN * climbIn;
      heli.climb += (climbTarget - heli.climb) * Math.min(1, 2.5 * dt);
      heli.altitude += heli.climb * dt;
      if (heli.altitude > GULL_MAX_ALT) {
        heli.altitude = GULL_MAX_ALT;
        if (heli.climb > 0) heli.climb = 0;
      }
      if (heli.altitude < 0) { heli.altitude = 0; heli.climb = 0; }
      // Touching down: the deck under the skids decides the landing.
      var deck = city ? deckHeight(city, heli.x, heli.y) : 0;
      if (heli.climb <= 0 && heli.altitude <= deck) {
        heli.altitude = deck;
        heli.climb = 0;
        heli.landed = true;
        events.landed = true;
      }
    }

    // Forward speed eases toward what the throttle asks; the air brake
    // kills it fast. A landed Gull does not taxi.
    if (heli.landed) {
      heli.speed = 0;
    } else {
      var want = 0;
      if (throttle > 0) want = throttle * GULL_TOP_SPEED;
      else if (throttle < 0) want = throttle * GULL_BACK_SPEED;
      var ease = throttle !== 0 ? 1.4 : 0.8;
      heli.speed += (want - heli.speed) * Math.min(1, ease * dt);
      if (input.brake) heli.speed -= heli.speed * Math.min(1, 3 * dt);
      // Yaw: she turns even at a hover, quicker with forward speed.
      var yaw = steer * (0.9 + Math.min(1, Math.abs(heli.speed) / GULL_TOP_SPEED) * 1.1);
      heli.angle += yaw * dt;
    }

    // Step forward, one axis at a time, so a wall scrape slides instead
    // of sticking. A hard hit bends the airframe and stops her.
    if (!heli.landed && city) {
      var nx = heli.x + Math.cos(heli.angle) * heli.speed * dt;
      var ny = heli.y + Math.sin(heli.angle) * heli.speed * dt;
      var bumped = false;
      if (!gullBlocked(city, nx, heli.y, heli.altitude)) heli.x = nx;
      else bumped = true;
      if (!gullBlocked(city, heli.x, ny, heli.altitude)) heli.y = ny;
      else bumped = true;
      if (bumped) {
        var hit = Math.abs(heli.speed);
        if (hit > 25) {
          heli.damage = Math.min(100, heli.damage + hit * 0.15);
          events.crashed = true;
        } else if (hit > 6) {
          events.scraped = true;
        }
        heli.speed *= 0.3;
      }
    }
    return events;
  }

  window.PalmaVehicles.spawnGull = spawnGull;
  window.PalmaVehicles.updateHeli = updateHeli;
  window.PalmaVehicles.gullAltitude = gullAltitude;
  window.PalmaVehicles.deckHeight = deckHeight;
})();
