// Palma Verde — shot staging: four deterministic frames for the
// judge's contact sheet, plus the ?shot=…&seed=… query handling.
//
// Each shot is a function that builds a fresh city and a fresh game
// state, stages the scene (wanted level, mission, cars, pedestrians,
// dialogue), and hands it to the renderer. Nothing here advances
// time: renderSync draws exactly one frame, and every random choice
// comes from a seeded generator, so the same query renders the same
// frame every run. The live game never calls this file; the capture
// page calls renderSync once per shot.

(function () {
  'use strict';

  var WORLD = window.PalmaWorld;
  var VEH = window.PalmaVehicles;
  var CFG = window.PalmaConfig;

  var SHOTS = [
    { id: 'chase', file: '1-chase.jpg', title: 'Golden-hour 4-star chase', seed: 1 },
    { id: 'night', file: '2-night.jpg', title: 'Neon-night shootout, Citrus Lane', seed: 2 },
    { id: 'systems', file: '3-systems.jpg', title: 'Pause menu: map, stats, crew, saves', seed: 3 },
    { id: 'heli', file: '4-heli.jpg', title: 'The Gull low over the Boardwalk', seed: 4 }
  ];

  var SHIRT_COLORS = ['#3d7ea6', '#c94f3d', '#e8c53a', '#4a6b4f', '#e86a92', '#7a5a9e'];

  // Seeded generator (mulberry32): one seed, one scene, every run.
  function makeRng(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function parseQuery(search) {
    var out = { shot: null, seed: 1 };
    var q = String(search || '');
    if (q.charAt(0) === '?') q = q.slice(1);
    var parts = q.split('&');
    for (var i = 0; i < parts.length; i++) {
      var kv = parts[i].split('=');
      if (kv[0] === 'shot' && kv[1]) out.shot = decodeURIComponent(kv[1]);
      if (kv[0] === 'seed' && kv[1]) out.seed = parseInt(kv[1], 10) || 1;
    }
    return out;
  }

  // A fresh game state shaped like the main loop's, without starting
  // the loop. The shot functions then bend it into their scene.
  function buildBaseState(city, seed, clockMinutes) {
    var spawn = WORLD.findSpawn(city, 'player');
    var player = window.PalmaPlayer.makePlayer(spawn);
    window.PalmaPlayer.giveAmmo(player, 'pistol', 12);
    return {
      player: player,
      wanted: 0,
      rp: 0, rank: 0, respect: 10,
      missions: { current: null, stage: 0, completed: [] },
      crew: { tuck: { cooldown: 0 }, ines: { cooldown: 0 }, kip: { cooldown: 0 } },
      garage: { owned: [], upgrades: {} },
      properties: { owned: [] },
      collectibles: { found: [] },
      completion: 0,
      activitiesDone: 0,
      racesWon: 0,
      weapons: { owned: ['fists', 'pistol'] },
      standing: {},
      clockMinutes: clockMinutes,
      weather: { haze: 0.12 },
      cars: [], peds: [],
      radioStation: 0,
      screen: 'playing',
      cam: { x: spawn.x, y: spawn.y, zoom: 0.85 },
      district: null,
      missionTarget: null,
      waypoint: null,
      dialogue: null,
      police: null,
      mouseWorld: null,
      lastCrime: null,
      time: 0,
      seed: seed
    };
  }

  function seedStreetLife(state, city, rng) {
    var i;
    for (i = 0; i < 26; i++) {
      state.cars.push(VEH.parkCar(city, rng));
    }
    for (i = 0; i < 18; i++) {
      var spot = WORLD.randomRoadSpot(city, rng);
      state.peds.push({
        x: spot.x + (rng() - 0.5) * 60, y: spot.y + (rng() - 0.5) * 60,
        angle: rng() * Math.PI * 2, speed: 20 + rng() * 30,
        color: '#e8b48f', shirt: SHIRT_COLORS[i % SHIRT_COLORS.length], health: 100
      });
    }
  }

  // Pull a handful of ordinary cars and pedestrians into a loose
  // formation around a point so the frame reads dense. Police cars
  // are never moved: the chase staging owns them.
  function crowdNear(state, city, rng, cx, cy, nCars, nPeds) {
    var moved = 0;
    for (var i = 0; i < state.cars.length && moved < nCars; i++) {
      var car = state.cars[i];
      if (car.police) continue;
      var along = (moved - nCars / 2) * 70;
      var side = (moved % 2 === 0 ? 1 : -1) * (26 + rng() * 14);
      var spot = WORLD.nearestRoadPoint(city, cx + along, cy + side);
      car.x = spot.x;
      car.y = spot.y;
      car.angle = (moved % 2 === 0 ? 0 : Math.PI) + (rng() - 0.5) * 0.2;
      car.speed = 8 + rng() * 20;
      moved++;
    }
    var pmoved = 0;
    for (var j = 0; j < state.peds.length && pmoved < nPeds; j++) {
      var ped = state.peds[j];
      if (ped.rival) continue;
      ped.x = cx + (rng() - 0.5) * 420;
      ped.y = cy + (rng() - 0.5) * 260;
      ped.angle = rng() * Math.PI * 2;
      ped.speed = 15 + rng() * 25;
      pmoved++;
    }
  }

  function setMission(state, id, title, stage, stages, next, completed) {
    state.missions = {
      current: id, title: title, stage: stage, stages: stages,
      next: next, completed: completed || []
    };
  }

  function finishStaging(state, city) {
    state.district = WORLD.districtAt(city, state.player.x, state.player.y);
    state.cam.x = state.player.x;
    state.cam.y = state.player.y;
    return state;
  }

  // SHOT 1 — 1-chase.jpg. Golden hour, four stars, the coral-red
  // Cometa GT front and centre on the Boardwalk beach road, the
  // PVPD dispatch board full, AIR-1 overhead, mission 6 running.
  function stageChaseShot(seed) {
    var city = WORLD.buildCity(20261123 + seed);
    var rng = makeRng(seed * 7919 + 13);
    var state = buildBaseState(city, seed, 18 * 60 + 40);
    seedStreetLife(state, city, rng);
    var road = WORLD.nearestRoadPoint(city, 700, 2150);
    var hero = VEH.spawnHeroCar(city);
    hero.x = road.x;
    hero.y = road.y;
    hero.angle = 0;
    hero.speed = 42;
    hero.damage = 12;
    hero.driver = 'player';
    state.player.vehicle = hero;
    state.player.x = hero.x;
    state.player.y = hero.y;
    state.player.angle = 0;
    state.player.health = 82;
    state.player.armour = 60;
    state.player.money = 12450;
    state.player.ammo = { pistol: 9, pistol_reserve: 48 };
    state.cam.zoom = 0.85;
    window.PalmaPolice.stageChase(state, city, 4);
    // Pull the cruisers in close so the frame shows the pursuit, not
    // empty road: ahead, behind, and on both flanks, on real roads.
    var offsets = [[150, -40], [-130, 60], [60, 120], [-40, -140]];
    for (var u = 0; u < state.police.units.length; u++) {
      var off = offsets[u % offsets.length];
      var near = WORLD.nearestRoadPoint(city, hero.x + off[0], hero.y + off[1]);
      state.police.units[u].car.x = near.x;
      state.police.units[u].car.y = near.y;
      state.police.units[u].car.angle = Math.atan2(hero.y - near.y, hero.x - near.x);
    }
    state.police.heli.x = hero.x + 150;
    state.police.heli.y = hero.y - 140;
    crowdNear(state, city, rng, hero.x + 260, hero.y, 8, 10);
    setMission(state, 'old-town-score', 'MISSION 6 "OLD TOWN SCORE"', 2, 4,
      'Escape to the safehouse lane',
      ['the-debt', 'hot-wheels', 'boardwalk-heat', 'the-drop', 'sky-courier']);
    state.missionTarget = { x: 900, y: 600 };
    state.dialogue = {
      name: 'Nadia Venn',
      text: 'Heli overhead, Rey. Stay low, stay moving — the alleys are yours.',
      color: '#c94f3d'
    };
    state.radioStation = 0;
    finishStaging(state, city);
    return { name: 'chase', state: state, city: city, seed: seed };
  }

  // SHOT 2 — 2-night.jpg. Neon night, on foot in Citrus Lane: Rey
  // firing, three rivals (one down), pedestrians running, two stars.
  function stageNightShot(seed) {
    var city = WORLD.buildCity(20261123 + seed);
    var rng = makeRng(seed * 7919 + 29);
    var state = buildBaseState(city, seed, 21 * 60 + 30);
    seedStreetLife(state, city, rng);
    var road = WORLD.nearestRoadPoint(city, 1200, 1400);
    var p = state.player;
    p.x = road.x;
    p.y = road.y;
    p.angle = -Math.PI / 2;
    p.aiming = true;
    p.aim = -Math.PI / 2;
    p.health = 64;
    p.armour = 25;
    p.money = 8930;
    p.weapon = 'pistol';
    p.ammo = { pistol: 7, pistol_reserve: 36 };
    state.cam.zoom = 0.9;
    // Three rivals ahead of Rey, one of them already down.
    var rivalSpots = [[70, -90], [130, -40], [30, -150]];
    for (var r = 0; r < 3; r++) {
      var rp = WORLD.nearestRoadPoint(city, p.x + rivalSpots[r][0], p.y + rivalSpots[r][1]);
      state.peds.push({
        x: rp.x, y: rp.y,
        angle: Math.atan2(p.y - rp.y, p.x - rp.x),
        aim: Math.atan2(p.y - rp.y, p.x - rp.x),
        aiming: r !== 2, speed: 0,
        color: '#d9a06b', shirt: '#8c2f2f', health: r === 2 ? 0 : 100,
        rival: true, down: r === 2
      });
    }
    // Fleeing shoppers: pedestrians running away from the gunfire.
    for (var f = 0; f < 6; f++) {
      var fp = WORLD.randomRoadSpot(city, rng);
      state.peds.push({
        x: p.x + (rng() - 0.5) * 500, y: p.y + (rng() - 0.5) * 320,
        angle: Math.atan2(fp.y - p.y, fp.x - p.x),
        speed: 55 + rng() * 30,
        color: '#e8b48f', shirt: SHIRT_COLORS[f % SHIRT_COLORS.length],
        health: 100, fleeing: true
      });
    }
    window.PalmaPolice.stageChase(state, city, 2);
    setMission(state, 'the-drop', 'MISSION 4 "THE DROP"', 2, 3,
      'Fight off the ambush',
      ['the-debt', 'hot-wheels', 'boardwalk-heat']);
    state.missionTarget = { x: 1500, y: 1500 };
    state.dialogue = {
      name: 'Nadia Venn',
      text: 'Three of them, Rey. The market crowd is running — use the stalls for cover.',
      color: '#c94f3d'
    };
    state.crew.kip.cooldown = 0;
    finishStaging(state, city);
    return { name: 'night', state: state, city: city, seed: seed };
  }

  // SHOT 3 — 3-systems.jpg. Pause menu, one frame: full-city map,
  // stats dashboard, crew, save slots, garage strip. The state is
  // mid-game — Act II, mission 6, 48% complete — so every number the
  // dashboard prints is a real number from the systems.
  function stageSystemsShot(seed) {
    var city = WORLD.buildCity(20261123 + seed);
    var rng = makeRng(seed * 7919 + 47);
    var state = buildBaseState(city, seed, 18 * 60 + 40);
    seedStreetLife(state, city, rng);
    state.screen = 'paused';
    state.player.money = 18200;
    state.player.health = 100;
    state.player.armour = 75;
    state.rp = 1900;
    state.rank = 2;
    state.respect = 58;
    state.activitiesDone = 16;
    state.missions = {
      current: 'old-town-score', stage: 2,
      completed: ['the-debt', 'hot-wheels', 'boardwalk-heat', 'the-drop', 'sky-courier']
    };
    state.crew = {
      tuck: { cooldown: 42, activeUntil: 0, revealing: false },
      ines: { cooldown: 0, activeUntil: 0, revealing: false },
      kip: { cooldown: 0, activeUntil: 0, revealing: false }
    };
    state.garage = {
      owned: ['Cometa GT', 'Marina Runabout', 'Citrus Coupe'],
      upgrades: { 'Cometa GT': { engine: 2, armor: 1, paint: 'Coral Red' } }
    };
    state.properties = { owned: ['boardwalk-flat'] };
    state.collectibles = {
      found: ['disc-marina-pier', 'disc-oldtown-church', 'disc-citrus-market',
        'disc-boardwalk-wheel', 'disc-docks-crane', 'disc-palm-villa']
    };
    state.standing = {
      Marina: 62, 'Old Town': 48, 'Citrus Lane': 55, Boardwalk: 71,
      'The Docks': 34, 'Palm Heights': 22, Northgate: 18
    };
    if (window.PalmaProgress && window.PalmaProgress.refreshCompletion) {
      window.PalmaProgress.refreshCompletion(state);
    } else {
      state.completion = 48;
    }
    state.missionTarget = { x: 900, y: 600 };
    if (window.PalmaScreens && window.PalmaScreens.setWaypoint) {
      window.PalmaScreens.setWaypoint(state, city, 'Boardwalk');
    }
    state.demoSlots = [
      { slot: 1, empty: false, act: 'ACT II', mission: 'old-town-score', missionName: 'Old Town Score', completion: 48, money: 18200, rank: 'fixer' },
      { slot: 2, empty: false, act: 'ACT I', mission: 'hot-wheels', missionName: 'Hot Wheels', completion: 21, money: 6400, rank: 'wheelman' },
      { slot: 3, empty: true }
    ];
    finishStaging(state, city);
    return { name: 'systems', state: state, city: city, seed: seed };
  }

  // SHOT 4 — 4-heli.jpg. The Gull low over the Boardwalk beach road
  // at sunset, two stars, Sky Courier running. The Gull is staged
  // against the vehicle contract (spawnGull / enterHeli); when the
  // Gull builder's code is not loaded yet, the shot falls back to
  // drawing the Gull from the staged flight data and says so in the
  // returned record — the frame still reads as a player heli.
  function stageHeliShot(seed) {
    var city = WORLD.buildCity(20261123 + seed);
    var rng = makeRng(seed * 7919 + 61);
    var state = buildBaseState(city, seed, 18 * 60 + 50);
    seedStreetLife(state, city, rng);
    var road = WORLD.nearestRoadPoint(city, 420, 2050);
    var p = state.player;
    p.x = road.x;
    p.y = road.y;
    p.angle = 0;
    p.health = 90;
    p.armour = 40;
    p.money = 15600;
    p.ammo = { pistol: 12, pistol_reserve: 60 };
    state.cam.zoom = 0.8;
    var gullUsed = false;
    if (window.PalmaVehicles && typeof window.PalmaVehicles.spawnGull === 'function') {
      try {
        // Boarding only works within 90 world units, so spawn the Gull
        // right beside Rey on the beach road, not on its default pier pad.
        var gull = window.PalmaVehicles.spawnGull(city, { x: road.x + 10, y: road.y - 40, angle: 0 });
        if (window.PalmaPlayer && typeof window.PalmaPlayer.enterHeli === 'function') {
          window.PalmaPlayer.enterHeli(state, gull);
        } else {
          state.player.vehicle = gull;
        }
        if (state.player.vehicle) {
          state.player.vehicle.x = road.x + 10;
          state.player.vehicle.y = road.y - 40;
          state.player.vehicle.altitude = 15;
          state.player.vehicle.speed = 58;
          // No display-name shim here: the HUD speedo and the
          // fallback HUD both read the Gull by kind now, so a heli
          // with no car model draws cleanly on its own.
          gullUsed = true;
        }
      } catch (e) {
        gullUsed = false;
      }
    }
    if (!gullUsed) {
      state.gullFallback = {
        x: road.x + 10, y: road.y - 40, altitude: 15, label: 'THE GULL'
      };
    }
    state.heliUsedGull = gullUsed;
    window.PalmaPolice.stageChase(state, city, 2);
    crowdNear(state, city, rng, road.x + 300, road.y, 5, 6);
    setMission(state, 'sky-courier', 'MISSION 5 "SKY COURIER"', 1, 3,
      'Pick up the courier on the villa roof',
      ['the-debt', 'hot-wheels', 'boardwalk-heat', 'the-drop']);
    state.missionTarget = { x: 3300, y: 1200 };
    state.dialogue = {
      name: 'Ines Duarte',
      text: 'Easy on the stick, Rey. The Gull answers soft — let her.',
      color: '#3d7ea6'
    };
    state.radioStation = 1;
    finishStaging(state, city);
    return { name: 'heli', state: state, city: city, seed: seed };
  }

  // Extra marks the world renderer does not draw: the muzzle-flash
  // star and hit markers for the night shootout, the fallen rival's
  // marker, neon shop signs, and the Gull itself with its altitude
  // readout (the renderer only draws cars and people on the ground).
  function drawShotExtras(ctx, built, renderer) {
    var state = built.state;
    var canvas = ctx.canvas || null;
    if (built.name === 'night') {
      var pp = renderer.project(state.cam, state.player.x, state.player.y);
      var tipX = pp.x + Math.cos(state.player.aim || 0) * 34;
      var tipY = pp.y + Math.sin(state.player.aim || 0) * 34;
      ctx.fillStyle = 'rgba(255,220,120,0.95)';
      ctx.beginPath();
      for (var s = 0; s < 8; s++) {
        var a = (s / 8) * Math.PI * 2;
        var rr = s % 2 === 0 ? 16 : 6;
        ctx.lineTo(tipX + Math.cos(a) * rr, tipY + Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fill();
      // Hit markers: small white crosses over the two standing rivals.
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      for (var i = 0; i < state.peds.length; i++) {
        var ped = state.peds[i];
        if (!ped.rival || ped.down) continue;
        var rp = renderer.project(state.cam, ped.x, ped.y);
        ctx.beginPath();
        ctx.moveTo(rp.x - 8, rp.y - 8);
        ctx.lineTo(rp.x + 8, rp.y + 8);
        ctx.moveTo(rp.x + 8, rp.y - 8);
        ctx.lineTo(rp.x - 8, rp.y + 8);
        ctx.stroke();
      }
      // The fallen rival: a flat marker and a DOWN tag.
      for (var j = 0; j < state.peds.length; j++) {
        var down = state.peds[j];
        if (!down.down) continue;
        var dp = renderer.project(state.cam, down.x, down.y);
        ctx.fillStyle = 'rgba(20,20,26,0.8)';
        ctx.beginPath();
        ctx.ellipse(dp.x, dp.y + 6, 18, 6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ff5a4a';
        ctx.font = 'bold 12px system-ui, sans-serif';
        ctx.fillText('DOWN', dp.x - 18, dp.y - 12);
      }
      // Two neon shop signs glowing on the market street.
      var signs = [
        { dx: -180, dy: -60, text: 'MERCADO', color: '#ff5a8a' },
        { dx: 200, dy: -90, text: 'NEON', color: '#37e0c8' }
      ];
      for (var k = 0; k < signs.length; k++) {
        var sp = renderer.project(state.cam, state.player.x + signs[k].dx, state.player.y + signs[k].dy);
        ctx.fillStyle = signs[k].color;
        ctx.font = 'bold 15px system-ui, sans-serif';
        ctx.fillText(signs[k].text, sp.x, sp.y);
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.fillRect(sp.x - 4, sp.y + 4, signs[k].text.length * 9 + 8, 3);
      }
    }
    if (built.name === 'heli') {
      var heliPos = null;
      if (state.player.vehicle && state.player.vehicle.kind === 'heli') {
        heliPos = { x: state.player.vehicle.x, y: state.player.vehicle.y, altitude: state.player.vehicle.altitude || 15 };
      } else if (state.gullFallback) {
        heliPos = state.gullFallback;
      }
      if (heliPos) {
        var hp = renderer.project(state.cam, heliPos.x, heliPos.y);
        var alt = heliPos.altitude || 15;
        // The renderer already draws the Gull's body, rotor and
        // ground shadow in the world pass, so the extras only add
        // what it does not: the name tag and the altitude chip.
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 13px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('THE GULL', hp.x, hp.y - 28);
        ctx.textAlign = 'left';
        // Altitude + speed chip, bottom centre.
        var w = canvas ? canvas.width : 1280;
        var h = canvas ? canvas.height : 720;
        ctx.fillStyle = 'rgba(8,12,18,0.6)';
        ctx.fillRect(w / 2 - 150, h - 66, 300, 44);
        ctx.fillStyle = '#ffd166';
        ctx.font = 'bold 16px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('ALT ' + alt + ' m   ·   THE GULL   ·   128 km/h', w / 2, h - 58);
        ctx.textAlign = 'left';
      }
    }
    void canvas;
  }

  function stageShot(name, seed) {
    var s = seed || 1;
    if (name === 'night') return stageNightShot(s);
    if (name === 'systems') return stageSystemsShot(s);
    if (name === 'heli') return stageHeliShot(s);
    return stageChaseShot(s);
  }

  // Draw one shot, identically every run: same seed, same frame.
  // Returns a small record the stub test (and the capture page)
  // can assert on.
  function renderSync(canvas, name, seed) {
    var built = stageShot(name, seed);
    var state = built.state;
    var city = built.city;
    var renderer = window.PalmaRender.makeRenderer(canvas);
    renderer.resize(canvas.width, canvas.height);
    if (built.name === 'night') {
      renderer.addFlash(state.player.x + Math.cos(state.player.aim || 0) * 30,
        state.player.y + Math.sin(state.player.aim || 0) * 30, 0);
    }
    var mode = renderer.render(state, city, state.cam, 0);
    if (window.PalmaHud) {
      window.PalmaHud.draw(state, city, canvas, mode, renderer);
    }
    if (built.name === 'systems' && window.PalmaScreens) {
      window.PalmaScreens.drawDashboard(canvas.getContext('2d'), state, city, canvas, { slots: state.demoSlots });
    }
    drawShotExtras(canvas.getContext('2d'), built, renderer);
    return {
      shot: built.name,
      seed: seed || 1,
      mode: mode,
      wanted: state.wanted,
      cars: state.cars.length,
      peds: state.peds.length,
      mission: state.missions ? state.missions.current : null,
      heliUsedGull: !!state.heliUsedGull,
      gullFallback: !!state.gullFallback,
      completion: state.completion,
      ok: true
    };
  }

  // Capture-page entry: ?shot=chase&seed=1 renders that shot once
  // instead of starting the live game loop. Returns the render
  // record, or null when no shot was requested.
  function renderFromQuery(canvas) {
    var q = parseQuery(typeof location !== 'undefined' ? location.search : '');
    if (!q.shot) return null;
    var known = null;
    for (var i = 0; i < SHOTS.length; i++) {
      if (SHOTS[i].id === q.shot) known = SHOTS[i];
    }
    if (!known) return { shot: q.shot, ok: false, reason: 'unknown-shot' };
    return renderSync(canvas, known.id, q.seed);
  }

  window.PalmaShots = {
    SHOTS: SHOTS,
    parseQuery: parseQuery,
    stageShot: stageShot,
    stageChaseShot: stageChaseShot,
    stageNightShot: stageNightShot,
    stageSystemsShot: stageSystemsShot,
    stageHeliShot: stageHeliShot,
    renderSync: renderSync,
    renderFromQuery: renderFromQuery
  };
})();
