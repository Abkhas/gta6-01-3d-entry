// Palma Verde — Rey Calder on foot.
//
// Rey walks, runs, aims and shoots, and climbs in and out of cars. The
// camera follows him smoothly instead of snapping, and his health and
// armour are the two bars the HUD reads. Combat is simple on purpose:
// aim with the mouse, fire with the click, reload with R, and every shot
// costs ammo from the current weapon's magazine.

(function () {
  'use strict';

  var CFG = window.PalmaConfig;
  var WORLD = window.PalmaWorld;

  var WALK_SPEED = 150;   // world units per second
  var RUN_SPEED = 265;
  var PLAYER_RADIUS = 14;

  function makePlayer(spawn) {
    return {
      x: spawn.x, y: spawn.y,
      angle: -Math.PI / 2, aim: -Math.PI / 2,
      health: 100, armour: 0, money: 350,
      weapon: 'pistol', ammo: {}, aiming: false,
      vehicle: null, moving: false, running: false,
      color: '#e8b48f', shirt: '#c94f3d'
    };
  }

  function giveAmmo(player, weaponId, amount) {
    player.ammo[weaponId] = (player.ammo[weaponId] || 0) + amount;
  }

  function weaponDef(id) {
    for (var i = 0; i < CFG.WEAPONS.length; i++) {
      if (CFG.WEAPONS[i].id === id) return CFG.WEAPONS[i];
    }
    return CFG.WEAPONS[0];
  }

  function moveAxis(city, player, dx, dy) {
    // Step one axis at a time so Rey slides along walls instead of
    // sticking on corners.
    var nx = player.x + dx;
    if (!WORLD.isSolid(city, nx, player.y)) player.x = nx;
    var ny = player.y + dy;
    if (!WORLD.isSolid(city, player.x, ny)) player.y = ny;
  }

  // keys: {up,down,left,right,run}; dt in seconds. Returns nothing;
  // mutates the player and the shared state (wanted rises on gunfire
  // only through the combat path, not here).
  function updateOnFoot(state, city, keys, dt) {
    var p = state.player;
    var mx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    var my = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
    p.moving = (mx !== 0 || my !== 0);
    p.running = !!keys.run && p.moving;
    if (p.moving) {
      var len = Math.sqrt(mx * mx + my * my);
      var speed = p.running ? RUN_SPEED : WALK_SPEED;
      moveAxis(city, p, (mx / len) * speed * dt, (my / len) * speed * dt);
      if (!p.aiming) p.angle = Math.atan2(my, mx);
    }
    // Aim follows the mouse: the main loop stores the world point under
    // the cursor in state.mouseWorld each frame.
    if (state.mouseWorld) {
      p.aim = Math.atan2(state.mouseWorld.y - p.y, state.mouseWorld.x - p.x);
      if (p.aiming) p.angle = p.aim;
    }
    // Slow health regen when out of trouble, capped at 100.
    if (state.wanted === 0 && p.health < 100 && p.health > 0) {
      p.health = Math.min(100, p.health + 2 * dt);
    }
  }

  function fireWeapon(state, renderer) {
    var p = state.player;
    var def = weaponDef(p.weapon);
    if (def.id === 'fists') {
      if (renderer) renderer.addShake(2);
      return { hit: false, reason: 'fists' };
    }
    var mag = p.ammo[p.weapon] === undefined ? def.mag : p.ammo[p.weapon];
    if (mag <= 0) return { hit: false, reason: 'empty' };
    p.ammo[p.weapon] = mag - 1;
    var mx = p.x + Math.cos(p.aim) * 26;
    var my = p.y + Math.sin(p.aim) * 26;
    if (renderer) {
      renderer.addFlash(mx, my, p.aim);
      renderer.addShake(3);
    }
    // Hit scan against the nearest car or ped in the firing cone.
    var best = null, bestD = 60;
    var i, d, dot;
    var targets = (state.cars || []).concat(state.peds || []);
    for (i = 0; i < targets.length; i++) {
      var t = targets[i];
      var dx = t.x - p.x, dy = t.y - p.y;
      d = Math.sqrt(dx * dx + dy * dy);
      if (d > 420 || d < 10) continue;
      dot = (dx * Math.cos(p.aim) + dy * Math.sin(p.aim)) / d;
      if (dot > 0.94 && d < bestD * 7) { best = t; bestD = d; }
    }
    if (best) {
      if (best.damage !== undefined) {
        best.damage = Math.min(100, best.damage + def.damage / 2);
      } else if (best.health !== undefined) {
        best.health -= def.damage;
      }
      return { hit: true, target: best, damage: def.damage };
    }
    return { hit: false, reason: 'miss' };
  }

  function reloadWeapon(state) {
    var p = state.player;
    var def = weaponDef(p.weapon);
    if (def.mag === 0) return false;
    var mag = p.ammo[p.weapon] === undefined ? def.mag : p.ammo[p.weapon];
    if (mag >= def.mag) return false;
    p.ammo[p.weapon] = def.mag;
    p.ammo[p.weapon + '_reserve'] = Math.max(0, (p.ammo[p.weapon + '_reserve'] || def.reserve) - (def.mag - mag));
    return true;
  }

  function takeDamage(state, amount) {
    var p = state.player;
    if (p.armour > 0) {
      var absorbed = Math.min(p.armour, amount * 0.6);
      p.armour -= absorbed;
      amount -= absorbed;
    }
    p.health = Math.max(0, p.health - amount);
    return p.health <= 0;
  }

  function heal(state, amount) {
    state.player.health = Math.min(100, state.player.health + amount);
  }

  function addArmour(state, amount) {
    state.player.armour = Math.min(100, state.player.armour + amount);
  }

  // Enter the nearest car within reach. Returns the car or null.
  // Stealing a car the player does not own raises the wanted level.
  function enterVehicle(state, city) {
    var p = state.player;
    if (p.vehicle) return null;
    var cars = state.cars || [];
    var best = null, bestD = 70;
    for (var i = 0; i < cars.length; i++) {
      var c = cars[i];
      var dx = c.x - p.x, dy = c.y - p.y;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d < bestD) { bestD = d; best = c; }
    }
    if (!best) return null;
    p.vehicle = best;
    best.driver = 'player';
    // Remove it from the parked list so it is not drawn twice.
    var idx = cars.indexOf(best);
    if (idx >= 0) cars.splice(idx, 1);
    if (!best.owned) {
      state.wanted = Math.max(state.wanted, 1);
      state.lastCrime = 'stole a ' + best.model.name;
    }
    return best;
  }

  function exitVehicle(state, city) {
    var p = state.player;
    var car = p.vehicle;
    if (!car) return null;
    // Step out to the driver's side; if that spot is solid, try the other.
    var side = car.angle + Math.PI / 2;
    var ox = car.x + Math.cos(side) * 34, oy = car.y + Math.sin(side) * 34;
    if (WORLD.isSolid(city, ox, oy)) {
      ox = car.x - Math.cos(side) * 34;
      oy = car.y - Math.sin(side) * 34;
    }
    if (WORLD.isSolid(city, ox, oy)) { ox = car.x; oy = car.y - 40; }
    p.x = ox; p.y = oy;
    p.vehicle = null;
    car.driver = null;
    car.speed = 0;
    (state.cars = state.cars || []).push(car);
    return car;
  }

  // Camera: ease toward the player (or the player's car) and clamp to
  // the map so the frame never shows void past the edges.
  function followCamera(cam, state, canvasW, canvasH, dt) {
    var focus = state.player.vehicle || state.player;
    var tx = focus.x, ty = focus.y;
    var k = 1 - Math.pow(0.0015, dt);
    cam.x += (tx - cam.x) * k;
    cam.y += (ty - cam.y) * k;
    var hw = canvasW / 2 / cam.zoom, hh = canvasH / 2 / cam.zoom;
    cam.x = Math.max(hw - 200, Math.min(CFG.CITY.width - hw + 200, cam.x));
    cam.y = Math.max(hh - 200, Math.min(CFG.CITY.height - hh + 200, cam.y));
  }

  window.PalmaPlayer = {
    makePlayer: makePlayer, updateOnFoot: updateOnFoot,
    fireWeapon: fireWeapon, reloadWeapon: reloadWeapon,
    takeDamage: takeDamage, heal: heal, addArmour: addArmour,
    enterVehicle: enterVehicle, exitVehicle: exitVehicle,
    followCamera: followCamera, giveAmmo: giveAmmo,
    weaponDef: weaponDef, WALK_SPEED: WALK_SPEED, RUN_SPEED: RUN_SPEED
  };

  // ---- The Gull: climbing in and out ----
  //
  // The E key is shared with cars; the loop decides which one Rey is
  // near and calls the matching pair. Boarding the Gull never raises
  // wanted: she is an air-taxi, and mission five's rooftop pickup
  // depends on Rey being able to come and go without the PVPD
  // noticing. Stepping out only works once she is down — on the ground
  // or on a roof — never in mid-air.

  var HELI_BOARD_R = 90; // how close Rey must stand to climb in

  function enterHeli(state, heli) {
    var p = state.player;
    if (p.vehicle) return null;
    var g = heli || state.gull || null;
    if (!g) return null;
    var dx = g.x - p.x, dy = g.y - p.y;
    if (dx * dx + dy * dy > HELI_BOARD_R * HELI_BOARD_R) return null;
    p.vehicle = g;
    g.driver = 'player';
    p.x = g.x; p.y = g.y;
    p.angle = g.angle;
    return g;
  }

  // First walkable square around (x, y): rings widen spoke by spoke,
  // so stepping off a rooftop lands Rey past the parapet, on the
  // street below, instead of inside the building footprint.
  function stepOffSpot(city, x, y) {
    var rings = [36, 80, 150, 260];
    var spokes = 12;
    for (var r = 0; r < rings.length; r++) {
      for (var s = 0; s < spokes; s++) {
        var a = (s / spokes) * Math.PI * 2;
        var px = x + Math.cos(a) * rings[r];
        var py = y + Math.sin(a) * rings[r];
        if (!WORLD.isSolid(city, px, py)) return { x: px, y: py };
      }
    }
    return null;
  }

  function exitHeli(state) {
    var p = state.player;
    var g = p.vehicle;
    if (!g || g.kind !== 'heli') return null;
    if (!g.landed) return null; // still in the air — set her down first
    var city = state.city || null;
    var spot = city ? stepOffSpot(city, g.x, g.y) : null;
    if (spot) { p.x = spot.x; p.y = spot.y; }
    else { p.x = g.x + 40; p.y = g.y; }
    p.vehicle = null;
    g.driver = null;
    g.speed = 0;
    g.climb = 0;
    return g;
  }

  window.PalmaPlayer.enterHeli = enterHeli;
  window.PalmaPlayer.exitHeli = exitHeli;
})();
