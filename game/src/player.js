// Palma Verde — Rey Calder on foot.
//
// Rey walks, runs, aims and shoots, and climbs in and out of cars. The
// camera follows him smoothly instead of snapping, and his health and
// armour are the two bars the HUD reads. Combat follows the GTA V PC
// canon: hold right mouse to aim (the weapon raises, a reticle shows,
// the camera pulls a little toward where he aims), left mouse to fire,
// R to reload, hold Tab for the weapon wheel, 1–9 or the wheel to
// switch. Weapons are slots — Fists, Pistol, SMG, Shotgun and the rest
// — one weapon per slot, ammo counted per weapon, magazine plus
// reserve. Fists are a real slot with a real melee attack, not the
// absence of a weapon. Drive-by works with pistol and compact SMG
// only, from a car, never from the Gull.
//
// On-foot draw size: Rey stands ON_FOOT_DRAW_PX tall (175 px at the
// gameplay zoom) — a readable figure with head, torso, legs and arms,
// never a dot. render.js drawPerson reads player.drawHeight for this.
//
// Aiming lives in two places at once so every reader agrees:
// state.aiming (top level, what the task and the renderer read) and
// state.player.aiming (what the old loop and the renderer already
// read). setAiming writes both; updateOnFoot re-syncs them every
// frame. state.weaponSlots is the slot order (weapon ids, CFG.WEAPONS
// order); state.weaponWheel is true while Tab is held.

(function () {
  'use strict';

  var CFG = window.PalmaConfig;
  var WORLD = window.PalmaWorld;

  var WALK_SPEED = 150;   // world units per second
  var RUN_SPEED = 265;
  var PLAYER_RADIUS = 14;

  // On-foot Rey, in screen pixels at the gameplay zoom: 150–200 px
  // tall, a readable human figure. render.js drawPerson scales from
  // player.drawHeight; the number lives here so the size is owned by
  // the player file, not the renderer.
  var ON_FOOT_DRAW_PX = 175;
  var DRAW_HEIGHT_PX = 175;

  // Fire rate, seconds between shots, per weapon. Semi-auto weapons
  // fire once per click; SMG and carbine keep firing while the trigger
  // is held (see the combat input binder below).
  var FIRE_INTERVAL = {
    fists: 0.45, pistol: 0.28, smg: 0.09, shotgun: 0.9,
    carbine: 0.11, revolver: 0.5, bat: 0.5, sniper: 1.2
  };
  var AUTO_WEAPONS = { smg: true, carbine: true };
  var DRIVEBY_WEAPONS = { pistol: true, smg: true };
  var WEAPON_RANGE = {
    fists: 46, bat: 60, pistol: 420, smg: 380,
    shotgun: 260, carbine: 520, revolver: 460, sniper: 700
  };

  function makePlayer(spawn) {
    return {
      x: spawn.x, y: spawn.y,
      angle: -Math.PI / 2, aim: -Math.PI / 2,
      health: 100, armour: 0, money: 350,
      weapon: 'pistol', ammo: {}, aiming: false,
      vehicle: null, moving: false, running: false,
      color: '#e8b48f', shirt: '#c94f3d',
      drawHeight: ON_FOOT_DRAW_PX,
      meleeT: 0, lastFireT: -99, firing: false
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

  function fireInterval(id) {
    return FIRE_INTERVAL[id] || 0.3;
  }

  function weaponRange(id) {
    return WEAPON_RANGE[id] || 420;
  }

  function isMelee(id) {
    return weaponDef(id).mag === 0;
  }

  // The slot order, on the shared state so the HUD wheel, the digit
  // keys and the switcher all read the same list. Additive: created
  // lazily the first time combat runs, never renamed or removed.
  function ensureWeaponSlots(state) {
    if (!state.weaponSlots) {
      var slots = [];
      for (var i = 0; i < CFG.WEAPONS.length; i++) slots.push(CFG.WEAPONS[i].id);
      state.weaponSlots = slots;
    }
    if (state.weaponWheel === undefined) state.weaponWheel = false;
    if (state.aiming === undefined) state.aiming = !!state.player.aiming;
    return state.weaponSlots;
  }

  // Aim, mirrored on the state and on the player so both readers
  // agree. Returns the new aiming value.
  function setAiming(state, on) {
    var v = !!on;
    state.aiming = v;
    if (state.player) state.player.aiming = v;
    return v;
  }

  // Switch to a weapon by id ('pistol') or by slot index (0-based).
  // One weapon per slot; switching never touches ammo. Returns true
  // when the switch happened.
  function switchWeapon(state, idOrIndex) {
    var slots = ensureWeaponSlots(state);
    var p = state.player;
    var id = idOrIndex;
    if (typeof idOrIndex === 'number') {
      if (idOrIndex < 0 || idOrIndex >= slots.length) return false;
      id = slots[idOrIndex];
    }
    if (slots.indexOf(id) < 0) return false;
    if (p.weapon === id) return true;
    p.weapon = id;
    return true;
  }

  // Step to the next (dir 1) or previous (dir -1) slot, wrapping.
  function cycleWeapon(state, dir) {
    var slots = ensureWeaponSlots(state);
    var cur = slots.indexOf(state.player.weapon);
    if (cur < 0) cur = 0;
    var next = (cur + (dir >= 0 ? 1 : slots.length - 1)) % slots.length;
    return switchWeapon(state, next);
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
    // The combat input binder (Tab / digits / right mouse / drive-by)
    // installs itself the first time Rey is on foot, so no other file
    // has to be touched for the keys to work.
    if (!state._combatInputBound && typeof document !== 'undefined') {
      var cv = document.querySelector('canvas');
      if (cv) bindCombatInput(state, cv);
    }
    // Keep the two aiming flags in step no matter who set them.
    state.aiming = !!p.aiming;
    if (p.meleeT > 0) p.meleeT -= dt;
    var mx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    var my = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
    p.moving = (mx !== 0 || my !== 0);
    p.running = !!keys.run && p.moving;
    if (p.moving) {
      var len = Math.sqrt(mx * mx + my * my);
      // Aiming walks slow: the aim-walk, not the sprint.
      var speed = p.running ? RUN_SPEED : WALK_SPEED;
      if (p.aiming) speed *= 0.55;
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

  // Fists (and the bat): a real melee attack. Short reach, a forward
  // cone, a short swing cooldown, and it hurts — 12 damage barehanded.
  // A melee hit on someone in public is a crime the street reports.
  function meleeAttack(state, renderer) {
    var p = state.player;
    var def = weaponDef(p.weapon);
    var t = state.time || 0;
    if (p.meleeT > 0) return { hit: false, reason: 'cooling' };
    p.meleeT = fireInterval(def.id);
    p.lastFireT = t;
    if (renderer) renderer.addShake(2);
    var range = weaponRange(def.id);
    var best = null, bestD = range;
    var targets = (state.cars || []).concat(state.peds || []);
    for (var i = 0; i < targets.length; i++) {
      var tg = targets[i];
      var dx = tg.x - p.x, dy = tg.y - p.y;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d > range || d < 4) continue;
      var dot = (dx * Math.cos(p.aim) + dy * Math.sin(p.aim)) / d;
      if (dot > 0.7 && d < bestD) { best = tg; bestD = d; }
    }
    if (best) {
      if (best.damage !== undefined) {
        best.damage = Math.min(100, best.damage + def.damage / 4);
      } else if (best.health !== undefined) {
        best.health -= def.damage;
      }
      if (window.PalmaPolice && window.PalmaPolice.reportCrime) {
        window.PalmaPolice.reportCrime(state, 'assault');
      }
      return { hit: true, target: best, damage: def.damage };
    }
    return { hit: false, reason: 'miss' };
  }

  function fireWeapon(state, renderer) {
    var p = state.player;
    ensureWeaponSlots(state);
    var def = weaponDef(p.weapon);
    if (isMelee(def.id)) return meleeAttack(state, renderer);
    var t = state.time || 0;
    var lastShot = (p.lastFireT === undefined ? -99 : p.lastFireT);
    if (t - lastShot < fireInterval(def.id)) {
      return { hit: false, reason: 'cooling' };
    }
    var mag = p.ammo[p.weapon] === undefined ? def.mag : p.ammo[p.weapon];
    if (mag <= 0) return { hit: false, reason: 'empty' };
    p.ammo[p.weapon] = mag - 1;
    p.lastFireT = t;
    var mx = p.x + Math.cos(p.aim) * 26;
    var my = p.y + Math.sin(p.aim) * 26;
    if (renderer) {
      renderer.addFlash(mx, my, p.aim);
      renderer.addShake(3);
    }
    // Hit scan against the nearest car or ped in the firing cone.
    var range = weaponRange(def.id);
    var best = null, bestD = range;
    var i, d, dot;
    var targets = (state.cars || []).concat(state.peds || []);
    for (i = 0; i < targets.length; i++) {
      var tg = targets[i];
      var dx = tg.x - p.x, dy = tg.y - p.y;
      d = Math.sqrt(dx * dx + dy * dy);
      if (d > range || d < 10) continue;
      dot = (dx * Math.cos(p.aim) + dy * Math.sin(p.aim)) / d;
      if (dot > 0.94 && d < bestD) { best = tg; bestD = d; }
    }
    var result;
    if (best) {
      if (best.damage !== undefined) {
        best.damage = Math.min(100, best.damage + def.damage / 2);
      } else if (best.health !== undefined) {
        best.health -= def.damage;
      }
      result = { hit: true, target: best, damage: def.damage };
    } else {
      result = { hit: false, reason: 'miss' };
    }
    // Every shot is heard: the police file escalates the heat from
    // here, so drive-by fire raises wanted even though the main loop
    // only bumps it for on-foot shots.
    if (window.PalmaPolice && window.PalmaPolice.reportGunfire) {
      window.PalmaPolice.reportGunfire(state, result);
    }
    return result;
  }

  // Drive-by: fire from a car window, pistol or compact SMG only.
  // Never from the Gull — no leaning out of a helicopter. Aims at the
  // mouse point when there is one, else straight out of the driver's
  // side. Returns the same result shape as fireWeapon.
  function fireDriveBy(state, renderer) {
    var p = state.player;
    if (!p.vehicle || p.vehicle.kind === 'heli') {
      return { hit: false, reason: 'not-driving' };
    }
    if (!DRIVEBY_WEAPONS[p.weapon]) {
      return { hit: false, reason: 'no-driveby' };
    }
    var oldAim = p.aim;
    if (state.mouseWorld) {
      p.aim = Math.atan2(state.mouseWorld.y - p.y, state.mouseWorld.x - p.x);
    } else {
      p.aim = p.vehicle.angle + Math.PI / 2;
    }
    var result = fireWeapon(state, renderer);
    p.aim = oldAim;
    return result;
  }

  // Reload from the reserve: magazine plus reserve, counted per
  // weapon. A weapon with an empty reserve cannot reload. Returns
  // true when ammo moved.
  function reloadWeapon(state) {
    var p = state.player;
    var def = weaponDef(p.weapon);
    if (def.mag === 0) return false;
    var mag = p.ammo[p.weapon] === undefined ? def.mag : p.ammo[p.weapon];
    if (mag >= def.mag) return false;
    var reserve = p.ammo[p.weapon + '_reserve'];
    if (reserve === undefined) reserve = def.reserve;
    if (reserve <= 0) return false;
    var need = def.mag - mag;
    var take = Math.min(need, reserve);
    p.ammo[p.weapon] = mag + take;
    p.ammo[p.weapon + '_reserve'] = reserve - take;
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
  // the map so the frame never shows void past the edges. While aiming
  // on foot the focus pulls a little toward where Rey aims — the
  // slight camera pull of the aim stance.
  function followCamera(cam, state, canvasW, canvasH, dt) {
    var focus = state.player.vehicle || state.player;
    var tx = focus.x, ty = focus.y;
    if (!state.player.vehicle && state.player.aiming) {
      tx += Math.cos(state.player.aim) * 46;
      ty += Math.sin(state.player.aim) * 46;
    }
    var k = 1 - Math.pow(0.0015, dt);
    cam.x += (tx - cam.x) * k;
    cam.y += (ty - cam.y) * k;
    var hw = canvasW / 2 / cam.zoom, hh = canvasH / 2 / cam.zoom;
    cam.x = Math.max(hw - 200, Math.min(CFG.CITY.width - hw + 200, cam.x));
    cam.y = Math.max(hh - 200, Math.min(CFG.CITY.height - hh + 200, cam.y));
  }

  // ---- Combat input: right mouse, Tab, digits, held trigger ----
  //
  // The main loop owns left-click firing on foot and the R key; this
  // binder owns everything the loop does not: hold right mouse to aim
  // (and release to lower the weapon), hold Tab for the weapon wheel,
  // 1–9 to switch slots, and the held trigger — automatic weapons keep
  // firing while left mouse is held, on foot and drive-by alike.
  // It installs itself from updateOnFoot, and the coordinator can also
  // call PalmaPlayer.bindCombatInput(state, canvas, renderer) with the
  // loop's renderer so drive-by shots get muzzle flash and shake.
  // One install per state, guarded by state._combatInputBound.
  function bindCombatInput(state, canvas, renderer) {
    if (!canvas || !canvas.addEventListener || state._combatInputBound) return false;
    state._combatInputBound = true;
    if (renderer) state._combatRenderer = renderer;
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    canvas.addEventListener('mousedown', function (e) {
      if (state.screen !== 'playing') return;
      if (e.button === 2) {
        e.preventDefault();
        setAiming(state, true);
      } else if (e.button === 0) {
        state.firing = true;
        if (state.player.vehicle && state.player.vehicle.kind !== 'heli') {
          fireDriveBy(state, state._combatRenderer || null);
        }
      }
    });
    window.addEventListener('mouseup', function (e) {
      if (e.button === 2) setAiming(state, false);
      if (e.button === 0) state.firing = false;
    });
    window.addEventListener('keydown', function (e) {
      if (state.screen !== 'playing') return;
      if (e.key === 'Tab') {
        e.preventDefault();
        state.weaponWheel = true;
      } else if (/^[1-9]$/.test(e.key)) {
        switchWeapon(state, parseInt(e.key, 10) - 1);
      }
    });
    window.addEventListener('keyup', function (e) {
      if (e.key === 'Tab') state.weaponWheel = false;
    });
    // Held trigger: automatic weapons fire on their own interval
    // while left mouse stays down; semi-auto weapons fire once per
    // click in the main loop and never here.
    setInterval(function () {
      if (state.screen !== 'playing' || !state.firing) return;
      var p = state.player;
      if (!p || p.health <= 0) return;
      if (p.vehicle) {
        if (p.vehicle.kind !== 'heli' && AUTO_WEAPONS[p.weapon]) {
          fireDriveBy(state, state._combatRenderer || null);
        }
      } else if (AUTO_WEAPONS[p.weapon]) {
        fireWeapon(state, state._combatRenderer || null);
      }
    }, 80);
    return true;
  }

  window.PalmaPlayer = {
    makePlayer: makePlayer, updateOnFoot: updateOnFoot,
    fireWeapon: fireWeapon, fireDriveBy: fireDriveBy,
    meleeAttack: meleeAttack, reloadWeapon: reloadWeapon,
    takeDamage: takeDamage, heal: heal, addArmour: addArmour,
    enterVehicle: enterVehicle, exitVehicle: exitVehicle,
    followCamera: followCamera, giveAmmo: giveAmmo,
    weaponDef: weaponDef, setAiming: setAiming,
    switchWeapon: switchWeapon, cycleWeapon: cycleWeapon,
    ensureWeaponSlots: ensureWeaponSlots,
    bindCombatInput: bindCombatInput,
    WALK_SPEED: WALK_SPEED, RUN_SPEED: RUN_SPEED,
    ON_FOOT_DRAW_PX: ON_FOOT_DRAW_PX, DRAW_HEIGHT_PX: DRAW_HEIGHT_PX
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
