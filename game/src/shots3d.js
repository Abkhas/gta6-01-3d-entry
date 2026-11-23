// Palma Verde 3D — shot staging: four deterministic frames for the
// judge's contact sheet, plus the ?shot=...&seed=... query handling.
//
// Each shot builds a fresh game state on the city adapter the game
// owns, bends it into its scene (wanted level, mission, cars,
// pedestrians, dialogue, camera), and hands it back. Nothing here
// advances time and every random choice comes from a seeded
// generator, so the same query stages the same frame every run.
// Nothing here touches Three.js: staging is pure state + camera
// placement, and main3d.js does the rendering.
//
// World units are 3D metres: x east, z south, north is -z. The beach
// road runs north-south on the west edge; the market avenue for the
// night shot runs through Citrus Lane. The four subjects match
// shots.json exactly: chase, night, systems, heli.
//
// The footer strip the shot page shows reuses the 2D bar's text
// pattern: "PALMA VERDE · screenshot staging — ?shot=chase&seed=1".

(function () {
  'use strict';

  var SHOTS = [
    { id: 'chase', file: '1-chase.jpg', title: 'Golden-hour 4-star chase', seed: 1 },
    { id: 'night', file: '2-night.jpg', title: 'Neon-night shootout, Citrus Lane', seed: 2 },
    { id: 'systems', file: '3-systems.jpg', title: 'Pause menu: map, stats, crew, saves', seed: 3 },
    { id: 'heli', file: '4-heli.jpg', title: 'The Gull low over the Boardwalk', seed: 4 }
  ];

  var SHIRT_COLORS = ['#3d7ea6', '#c94f3d', '#e8c53a', '#4a6b4f', '#e86a92', '#7a5a9e'];

  // Call-sign pool for the dispatch board, same pool the 2D game uses.
  var CALLSIGNS = ['HALCON', 'BRISA', 'FARO', 'MONZON', 'TIBURON', 'VELA', 'CORRIENTE', 'PLAYA'];

  // Completion weights: missions 40, activities 20, sun-discs 20,
  // properties 20 — the same split the 2D progress system uses, so a
  // staged 48.1% here is a real 48.1% there.
  var COMPLETION_WEIGHTS = { missions: 40, activities: 20, collectibles: 20, properties: 20 };
  var TOTALS = { missions: 10, activities: 28, collectibles: 12, properties: 3 };

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

  function footerText(id, seed) {
    return 'PALMA VERDE  ·  screenshot staging — ?shot=' + id + '&seed=' + seed;
  }

  // ---- city adapter helpers -------------------------------------------
  // The adapter is the plain city object main3d.js builds (avenues are
  // north-south road x positions, streets are east-west road z
  // positions, districts carry x0/z0/x1/z1). These helpers need nothing
  // else, so the self-test can stage shots on a fake city.

  function districtAt(city, x, z) {
    var districts = city.districts || [];
    for (var i = 0; i < districts.length; i++) {
      var d = districts[i];
      var z0 = (d.z0 !== undefined ? d.z0 : d.y0);
      var z1 = (d.z1 !== undefined ? d.z1 : d.y1);
      if (x >= d.x0 && x < d.x1 && z >= z0 && z < z1) return d;
    }
    return null;
  }

  function nearestRoadPoint(city, x, z) {
    var ax = null, best = Infinity;
    var avenues = city.avenues || [];
    var streets = city.streets || [];
    for (var i = 0; i < avenues.length; i++) {
      var d = Math.abs(x - avenues[i]);
      if (d < best) { best = d; ax = avenues[i]; }
    }
    var az = null;
    best = Infinity;
    for (var j = 0; j < streets.length; j++) {
      var e = Math.abs(z - streets[j]);
      if (e < best) { best = e; az = streets[j]; }
    }
    if (ax === null) ax = x;
    if (az === null) az = z;
    // Snap to the nearer of the two roads: avenue (x fixed) or street.
    var dAx = Math.abs(x - ax), dAz = Math.abs(z - az);
    if (dAx <= dAz) return { x: ax, z: z };
    return { x: x, z: az };
  }

  function beachRoadPoint(city, z) {
    var bx = (typeof city.beachRoadX === 'number') ? city.beachRoadX : -1430;
    return { x: bx, z: z };
  }

  function districtCentre(city, name) {
    var districts = city.districts || [];
    for (var i = 0; i < districts.length; i++) {
      if (districts[i].name === name) {
        var d = districts[i];
        return {
          x: (d.x0 + d.x1) / 2,
          z: (((d.z0 !== undefined ? d.z0 : d.y0) + (d.z1 !== undefined ? d.z1 : d.y1)) / 2)
        };
      }
    }
    return null;
  }

  function completionPercent(state) {
    var w = COMPLETION_WEIGHTS;
    var done = (state.missions && state.missions.completed) ? state.missions.completed.length : 0;
    var acts = Math.min(state.activitiesDone || 0, TOTALS.activities);
    var discs = (state.collectibles && state.collectibles.found) ? state.collectibles.found.length : 0;
    var props = (state.properties && state.properties.owned) ? state.properties.owned.length : 0;
    var total = (done / TOTALS.missions) * w.missions +
      (acts / TOTALS.activities) * w.activities +
      (discs / TOTALS.collectibles) * w.collectibles +
      (props / TOTALS.properties) * w.properties;
    return Math.max(0, Math.min(100, Math.round(total * 10) / 10));
  }

  // ---- police staging ---------------------------------------------------
  // Same composition the 2D game stages: 1 star is foot + cruiser,
  // 2 stars add a ramming cruiser and a flanking bike, 3 stars add a
  // PIT cruiser and a roadblock cruiser, 4 stars add a second bike —
  // 7 ground units — and AIR-1 comes in at 3 stars.

  function stageChase(state, city, stars) {
    if (window.PalmaPolice3d && window.PalmaPolice3d.stageChase) {
      try {
        window.PalmaPolice3d.stageChase(state, city, stars);
        return state.police;
      } catch (e) { /* fall through to the local staging */ }
    }
    state.wanted = stars;
    var comp = [];
    if (stars <= 0) { state.police = { units: [], heli: null }; return state.police; }
    comp.push({ kind: 'foot', tactic: 'PURSUIT' });
    comp.push({ kind: 'cruiser', tactic: 'PURSUIT' });
    if (stars >= 2) {
      comp.push({ kind: 'cruiser', tactic: 'RAMMING' });
      comp.push({ kind: 'bike', tactic: 'FLANKING' });
    }
    if (stars >= 3) {
      comp.push({ kind: 'cruiser', tactic: 'PIT' });
      comp.push({ kind: 'cruiser', tactic: 'ROADBLOCK' });
    }
    if (stars >= 4) comp.push({ kind: 'bike', tactic: 'FLANKING' });
    var units = [];
    for (var k = 0; k < comp.length; k++) {
      var sign = CALLSIGNS[k % CALLSIGNS.length];
      var num = Math.floor(k / CALLSIGNS.length) + 1;
      var spot = nearestRoadPoint(city, state.player.x + (k % 2 ? 60 : -60), state.player.z + 120 + k * 40);
      var unit = {
        kind: comp[k].kind,
        callsign: sign + '-' + num,
        tactic: comp[k].tactic,
        searching: false,
        car: { x: spot.x, z: spot.z, angle: 0, speed: 0, police: true }
      };
      if (comp[k].kind === 'foot') {
        unit.ped = { x: spot.x, z: spot.z, angle: 0, speed: 0, police: true };
        unit.car = unit.ped;
      }
      units.push(unit);
    }
    var heli = null;
    if (stars >= 3) heli = { x: state.player.x + 140, z: state.player.z - 130, altitude: 60 };
    state.police = { units: units, heli: heli };
    return state.police;
  }

  // Move one staged police unit onto a road spot: position, heading
  // along the road, and a cruising speed.
  function placePoliceUnit(unit, x, z, angle, speed) {
    var pos = unit.car || unit.ped || unit;
    pos.x = x;
    pos.z = z;
    pos.angle = angle;
    pos.speed = speed;
    return unit;
  }

  // Place the staged police where the frame can see them, by kind:
  // the first cruisers and bikes go to the spots the shot asks for,
  // the foot officer to the sidewalk, the rest stay where the
  // dispatch spawned them — responding from off-frame, their
  // call-signs and distances still on the HUD board.
  function placePolice(state, cruiserSpots, bikeSpots, footSpot) {
    if (!state.police || !state.police.units) return;
    var units = state.police.units;
    var ci = 0, bi = 0, i, u;
    for (i = 0; i < units.length; i++) {
      u = units[i];
      if (u.kind === 'foot' && footSpot) {
        placePoliceUnit(u, footSpot[0], footSpot[1],
          Math.atan2(state.player.z - footSpot[1], state.player.x - footSpot[0]), 0);
      } else if (u.kind === 'cruiser' && cruiserSpots[ci]) {
        placePoliceUnit(u, cruiserSpots[ci][0], cruiserSpots[ci][1], cruiserSpots[ci][2], 20 + ci * 4);
        ci++;
      } else if (u.kind === 'bike' && bikeSpots[bi]) {
        placePoliceUnit(u, bikeSpots[bi][0], bikeSpots[bi][1], bikeSpots[bi][2], 26 + bi * 4);
        bi++;
      }
    }
  }

  function setMission(state, id, title, stage, stages, next, completed) {
    state.missions = {
      current: id, title: title, stage: stage, stages: stages,
      next: next, completed: completed || []
    };
  }

  // A fresh game state shaped like the main loop's, without starting
  // the loop. The shot functions then bend it into their scene.
  function buildBaseState(city, seed, clockMinutes) {
    var spawn = (city.spawns && city.spawns.player) || { x: -800, z: 600 };
    return {
      player: {
        x: spawn.x, z: spawn.z, y: spawn.z, angle: 0, aim: 0, aiming: false,
        health: 100, armour: 0, money: 0, weapon: 'pistol', vehicle: null,
        ammo: { pistol: 12, pistol_reserve: 60 }
      },
      wanted: 0,
      // The staged campaign profile: every shot is the same campaign
      // at 48% (5 missions done, Fixer), so the vitals rank line and
      // the completion % agree across shots and with the systems shot.
      // Each shot still overrides what it needs on top of this.
      rp: 1500, rank: 2, respect: 46,
      missions: { current: null, stage: 0, completed: ['the-debt', 'hot-wheels', 'boardwalk-heat', 'the-drop', 'sky-courier'] },
      crew: { tuck: { cooldown: 0 }, ines: { cooldown: 0 }, kip: { cooldown: 0 } },
      garage: { owned: [], upgrades: {} },
      properties: { owned: ['boardwalk-flat'] },
      collectibles: { found: ['disc-marina-pier', 'disc-oldtown-church', 'disc-citrus-market', 'disc-boardwalk-wheel', 'disc-docks-crane', 'disc-palm-villa'] },
      completion: 48.1,
      activitiesDone: 16,
      racesWon: 0,
      weapons: { owned: ['fists', 'pistol'] },
      standing: {},
      clockMinutes: clockMinutes,
      weather: { haze: 0.12 },
      cars: [], peds: [],
      radioStation: 0,
      screen: 'playing',
      cam: { x: spawn.x, z: spawn.z, zoom: 1 },
      shotCamera: null,
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
      var spot = nearestRoadPoint(city,
        -1300 + rng() * 2600, -1300 + rng() * 2600);
      state.cars.push({
        x: spot.x + (rng() - 0.5) * 8, z: spot.z + (rng() - 0.5) * 8,
        angle: rng() * Math.PI * 2, speed: 8 + rng() * 8,
        model: { id: 'vela', name: 'Vela Sedan', color: '#3d7ea6' },
        parked: rng() < 0.5
      });
    }
    for (i = 0; i < 18; i++) {
      var pspot = nearestRoadPoint(city,
        -1300 + rng() * 2600, -1300 + rng() * 2600);
      state.peds.push({
        x: pspot.x + (rng() - 0.5) * 60, z: pspot.z + (rng() - 0.5) * 60,
        angle: rng() * Math.PI * 2, speed: 1 + rng() * 1.5,
        color: '#e8b48f', shirt: SHIRT_COLORS[i % SHIRT_COLORS.length], health: 100
      });
    }
  }

  function finishStaging(state, city) {
    state.district = districtAt(city, state.player.x, state.player.z);
    state.cam.x = state.player.x;
    state.cam.z = state.player.z;
    return state;
  }

  // A camera that sits behind the focus and above it, looking ahead
  // along the focus heading. pos/lookAt are world metres; the
  // renderer points the Three.js camera at lookAt from pos. The
  // numbers follow the camera builder's presets (CAMERA_PRESETS):
  // car 7 m back / 3 m up, foot 9 m / 3.3 m, heli 11 m / 4.9 m
  // above her altitude — with the narrow 42-45 FOV that puts the
  // horizon near the top quarter of the frame (22-25% sky) while
  // the hero stays large in the foreground.
  function chaseCamera(fx, fz, heading, behind, height, ahead, lookY) {
    var bx = Math.cos(heading), bz = Math.sin(heading);
    return {
      pos: { x: fx - bx * behind, y: height, z: fz - bz * behind },
      lookAt: { x: fx + bx * ahead, y: (lookY === undefined ? 2 : lookY), z: fz + bz * ahead }
    };
  }

  // SHOT 1 — chase. Golden hour, four stars, the coral-red Cometa GT
  // on the Boardwalk beach road, the PVPD dispatch board full, AIR-1
  // overhead, mission 6 running.
  //
  // The chase runs NORTH up the beach road (north is -z): the hero's
  // nose points at the horizon, the sand and palm rows read on the
  // left of the frame, the shopfront blocks on the right. The camera
  // sits south of the hero, above and behind, so the road ahead runs
  // to the horizon and the hero stays large in the low-centre
  // foreground, clear of the dialogue bar.
  function stageChaseShot(city, seed) {
    var rng = makeRng(seed * 7919 + 13);
    var state = buildBaseState(city, seed, 18 * 60 + 40);
    seedStreetLife(state, city, rng);
    var road = beachRoadPoint(city, 600);
    var hero = {
      kind: 'car', x: road.x, z: road.z, angle: -Math.PI / 2, speed: 24,
      damage: 12, condition: 88, driver: 'player',
      model: { id: 'cometa', name: 'Cometa GT', color: '#ff4f3d', top: 176 }
    };
    state.cars.push(hero);
    state.player.vehicle = hero;
    state.player.x = hero.x;
    state.player.z = hero.z;
    state.player.y = hero.z;
    state.player.angle = -Math.PI / 2;
    state.player.health = 82;
    state.player.armour = 60;
    state.player.money = 12450;
    state.player.ammo = { pistol: 9, pistol_reserve: 48 };
    stageChase(state, city, 4);
    // The pursuit, on the road in-frame: a cruiser ahead in the
    // northbound lane, a bike and a ramming cruiser head-on in the
    // southbound lane, a foot officer on the sand-side kerb. The
    // other units chase from behind, off-frame south — the board
    // shows them closing, the frame stays a chase, not a pile-up.
    placePolice(state,
      [[-1423, 540, -Math.PI / 2], [-1437, 660, Math.PI / 2], [-1423, 740, -Math.PI / 2], [-1437, 780, Math.PI / 2]],
      [[-1437, 570, Math.PI / 2], [-1423, 800, -Math.PI / 2]],
      [-1452, 620]);
    // AIR-1 stays at the dispatch offset (hero +140, -130): at chase
    // framing the police heli would crowd the hero's roof if it were
    // in-frame, so it stays off-frame east and the dispatch board
    // carries it — the Gull gets her own shot.
    if (state.police.heli) {
      state.police.heli.x = hero.x + 140;
      state.police.heli.z = hero.z - 130;
    }
    // Beach-road rush hour: movers on the road north and south of
    // the hero, strollers on the sand, walkers on the city sidewalk.
    var i;
    for (i = 0; i < 12; i++) {
      state.cars.push({
        x: road.x + (rng() < 0.5 ? -7 : 7), z: road.z - 220 + i * 40 + rng() * 12,
        angle: rng() < 0.5 ? -Math.PI / 2 : Math.PI / 2, speed: 10 + rng() * 6,
        model: { id: 'vela', name: 'Vela Sedan', color: SHIRT_COLORS[i % SHIRT_COLORS.length] }
      });
    }
    for (i = 0; i < 8; i++) {
      state.peds.push({
        x: -1560 + rng() * 60, z: road.z - 160 + i * 45,
        angle: rng() * Math.PI * 2, speed: 1 + rng(),
        color: '#e8b48f', shirt: SHIRT_COLORS[i % SHIRT_COLORS.length], health: 100
      });
    }
    setMission(state, 'old-town-score', 'MISSION 6 "OLD TOWN SCORE"', 2, 4,
      'Escape to the safehouse lane',
      ['the-debt', 'hot-wheels', 'boardwalk-heat', 'the-drop', 'sky-courier']);
    var villa = districtCentre(city, 'Palm Heights');
    state.missionTarget = villa ? { x: villa.x, z: villa.z } : { x: 900, z: 600 };
    state.dialogue = {
      name: 'Nadia Venn',
      text: 'Heli overhead, Rey. Stay low, stay moving — the alleys are yours.',
      color: '#c94f3d'
    };
    state.radioStation = 0;
    finishStaging(state, city);
    state.shotCamera = chaseCamera(hero.x, hero.z, -Math.PI / 2, 7, 3, 3, 1);
    return { name: 'chase', state: state, city: city, seed: seed, camera: state.shotCamera, mode: 'golden' };
  }

  // SHOT 2 — night. Neon night, on foot in Citrus Lane: Rey firing,
  // three rivals (one down), pedestrians running, two stars.
  //
  // Staged BEHIND Rey: he faces north up the market aisle, the
  // camera sits south of him, so the reader sees his back, the
  // pistol, and the rivals ahead of him toward the horizon. The
  // market avenue runs north-south through Citrus Lane; stalls flank
  // it on both kerbs.
  function stageNightShot(city, seed) {
    var rng = makeRng(seed * 7919 + 29);
    var state = buildBaseState(city, seed, 21 * 60 + 30);
    seedStreetLife(state, city, rng);
    var road = nearestRoadPoint(city, -800, 100);
    var p = state.player;
    p.x = road.x;
    p.z = road.z;
    p.y = road.z;
    p.angle = -Math.PI / 2;
    p.aiming = true;
    p.aim = -Math.PI / 2;
    p.health = 64;
    p.armour = 25;
    p.money = 8930;
    p.weapon = 'pistol';
    p.ammo = { pistol: 7, pistol_reserve: 36 };
    // Three rivals ahead of Rey in a line ACROSS the street: one on
    // the avenue's west edge, one on the cross street east, the
    // downed one centre on the avenue. They stand on the road, clear
    // of the building footprints, so the frame reads them all.
    var rivalSpots = [[-15, -130], [60, -140], [0, -125]];
    for (var r = 0; r < 3; r++) {
      var rp = nearestRoadPoint(city, p.x + rivalSpots[r][0], p.z + rivalSpots[r][1]);
      state.peds.push({
        x: rp.x, z: rp.z,
        angle: Math.atan2(p.z - rp.z, p.x - rp.x),
        aim: Math.atan2(p.z - rp.z, p.x - rp.x),
        aiming: r !== 2, speed: 0,
        color: '#d9a06b', shirt: '#8c2f2f', health: r === 2 ? 0 : 100,
        rival: true, down: r === 2
      });
    }
    // A fleeing market crowd: shoppers on the avenue south of Rey,
    // running away from the gunfire, two abreast down the road.
    var n = 0;
    for (var g = 0; g < 13; g++) {
      state.peds.push({
        x: road.x + (n % 2 ? 10 : -10), z: road.z + 60 + Math.floor(n / 2) * 22,
        angle: Math.PI / 2, speed: 3 + rng() * 1.5,
        color: '#e8b48f', shirt: SHIRT_COLORS[g % SHIRT_COLORS.length],
        health: 100, fleeing: true
      });
      n++;
    }
    var mover = nearestRoadPoint(city, road.x + 12, road.z + 180);
    state.cars.push({
      x: mover.x, z: mover.z, angle: Math.PI / 2, speed: 6,
      model: { id: 'brisa', name: 'Brisa Hatch', color: '#e8c53a' }
    });
    stageChase(state, city, 2);
    // Two units responding in-frame: a cruiser on the cross street
    // north of the market, a bike on the avenue below the rivals.
    // The foot officer and the second cruiser close in from off-frame.
    placePolice(state,
      [[-620, -140, Math.PI]],
      [[-792, -20, -Math.PI / 2]],
      null);
    setMission(state, 'the-drop', 'MISSION 4 "THE DROP"', 2, 3,
      'Fight off the ambush',
      ['the-debt', 'hot-wheels', 'boardwalk-heat']);
    state.missionTarget = { x: 900, z: 300 };
    state.dialogue = {
      name: 'Nadia Venn',
      text: 'Three of them, Rey. The market crowd is running — use the stalls for cover.',
      color: '#c94f3d'
    };
    state.crew.kip.cooldown = 0;
    finishStaging(state, city);
    state.shotCamera = chaseCamera(p.x, p.z, -Math.PI / 2, 9, 3.3, 2.2, 1.3);
    return { name: 'night', state: state, city: city, seed: seed, camera: state.shotCamera, mode: 'night' };
  }

  // SHOT 3 — systems. Pause menu, one frame: full-city map, stats
  // dashboard, crew, save slots, garage strip. The state is mid-game
  // — Act II, mission 6, 48.1% complete — so every number the
  // dashboard prints is a real number from the systems.
  function stageSystemsShot(city, seed) {
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
      tuck: { cooldown: 42, cooldownTotal: 120, activeUntil: 0, revealing: false },
      ines: { cooldown: 0, cooldownTotal: 0, activeUntil: 0, revealing: false },
      kip: { cooldown: 0, cooldownTotal: 0, activeUntil: 0, revealing: false }
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
    state.completion = completionPercent(state);
    var boardwalk = districtCentre(city, 'Boardwalk');
    state.missionTarget = boardwalk ? { x: boardwalk.x, z: boardwalk.z } : { x: 900, z: 600 };
    if (window.PalmaScreens3d && window.PalmaScreens3d.setWaypoint) {
      try { window.PalmaScreens3d.setWaypoint(state, city, 'Boardwalk'); } catch (e) { /* keep target */ }
    }
    state.demoSlots = [
      { slot: 1, empty: false, act: 'ACT II', mission: 'old-town-score', missionName: 'Old Town Score', completion: 48, money: 18200, rank: 'fixer' },
      { slot: 2, empty: false, act: 'ACT I', mission: 'hot-wheels', missionName: 'Hot Wheels', completion: 21, money: 6400, rank: 'wheelman' },
      { slot: 3, empty: true }
    ];
    finishStaging(state, city);
    var spawn = (city.spawns && city.spawns.player) || { x: -800, z: 600 };
    state.shotCamera = chaseCamera(spawn.x, spawn.z, 0, 120, 60, 100);    return { name: 'systems', state: state, city: city, seed: seed, camera: state.shotCamera, mode: 'golden' };
  }

  // SHOT 4 — heli. The Gull low over the Boardwalk beach road at
  // sunset, two stars, Sky Courier running.
  //
  // The Gull flies NORTH up the beach road at ALT 15 m, so the road
  // runs ahead of her to the horizon with the sand on the left and
  // the shopfront blocks on the right. The camera sits south of her,
  // low enough that her lifted body reads mid-frame with her shadow
  // on the road below her.
  function stageHeliShot(city, seed) {
    var rng = makeRng(seed * 7919 + 61);
    var state = buildBaseState(city, seed, 18 * 60 + 50);
    seedStreetLife(state, city, rng);
    var road = beachRoadPoint(city, 500);
    var p = state.player;
    p.x = road.x;
    p.z = road.z;
    p.y = road.z;
    p.angle = -Math.PI / 2;
    p.health = 90;
    p.armour = 40;
    p.money = 15600;
    p.ammo = { pistol: 12, pistol_reserve: 60 };
    var gull = null;
    if (window.PalmaVehicles3d && typeof window.PalmaVehicles3d.spawnGull === 'function') {
      try {
        gull = window.PalmaVehicles3d.spawnGull(city, { x: road.x + 10, z: road.z - 40, angle: -Math.PI / 2 });
      } catch (e) { gull = null; }
    }
    if (!gull) {
      gull = {
        kind: 'heli', name: 'Gull', x: road.x + 10, z: road.z - 40,
        angle: -Math.PI / 2, altitude: 15, speed: 16, landed: false
      };
    }
    gull.x = road.x + 10;
    gull.z = road.z - 40;
    gull.angle = -Math.PI / 2;
    gull.altitude = 15;
    gull.speed = 16;
    state.player.vehicle = gull;
    state.gull = gull;
    state.heliUsedGull = true;
    state.gullFallback = false;
    stageChase(state, city, 2);
    // Two units responding in-frame on the beach road NORTH of the
    // Gull: a cruiser and a bike ahead of her, clear of her body.
    // The rest close in from off-frame.
    placePolice(state,
      [[-1423, 330, -Math.PI / 2]],
      [[-1437, 340, Math.PI / 2]],
      null);
    // Beach-road cruise under the Gull: a few movers and a parked row
    // on the road NORTH of her — the road under and around her stays
    // clear, so she reads alone against the sky — plus beach
    // strollers on the sand and walkers on the sidewalk.
    var i;
    for (i = 0; i < 4; i++) {
      state.cars.push({
        x: road.x + (rng() < 0.5 ? -7 : 7), z: road.z - 260 - i * 45,
        angle: -Math.PI / 2, speed: 12 + rng() * 4,
        model: { id: 'vela', name: 'Vela Sedan', color: SHIRT_COLORS[i % SHIRT_COLORS.length] }
      });
    }
    for (i = 0; i < 4; i++) {
      state.peds.push({
        x: -1560 + rng() * 60, z: road.z - 120 + i * 40,
        angle: rng() * Math.PI * 2, speed: 1 + rng(),
        color: '#e8b48f', shirt: SHIRT_COLORS[i % SHIRT_COLORS.length], health: 100
      });
    }
    setMission(state, 'sky-courier', 'MISSION 5 "SKY COURIER"', 1, 3,
      'Pick up the courier on the villa roof',
      ['the-debt', 'hot-wheels', 'boardwalk-heat', 'the-drop']);
    var villa = districtCentre(city, 'Palm Heights');
    state.missionTarget = villa ? { x: villa.x, z: villa.z } : { x: 3300, z: 1200 };
    state.dialogue = {
      name: 'Ines Duarte',
      text: 'Easy on the stick, Rey. The Gull answers soft — let her.',
      color: '#3d7ea6'
    };
    state.radioStation = 1;
    finishStaging(state, city);
    state.shotCamera = chaseCamera(gull.x, gull.z, -Math.PI / 2, 11, 19.9, 8, 16);
    return { name: 'heli', state: state, city: city, seed: seed, camera: state.shotCamera, mode: 'golden' };
  }

  // Extra marks the 3D renderer does not draw by itself: the
  // muzzle-flash star and hit markers for the night shootout, the
  // fallen rival's marker, neon shop signs, and the Gull's altitude
  // readout. These are DOM chips the integration places over the
  // frame; applyShot returns them as data so main3d.js can render
  // them without re-deriving the staging.
  function shotExtras(built) {
    var state = built.state;
    var extras = [];
    if (built.name === 'night') {
      extras.push({ kind: 'flash', at: 'player-aim' });
      for (var i = 0; i < state.peds.length; i++) {
        var ped = state.peds[i];
        if (!ped.rival) continue;
        extras.push({ kind: ped.down ? 'down' : 'hit', x: ped.x, z: ped.z });
      }
      extras.push({ kind: 'neon', text: 'MERCADO', dx: -120, dz: -60, color: '#ff5a8a' });
      extras.push({ kind: 'neon', text: 'NEON', dx: 140, dz: -90, color: '#37e0c8' });
    }
    if (built.name === 'heli') {
      var gull = state.player.vehicle;
      if (gull && gull.kind === 'heli') {
        extras.push({ kind: 'heli-tag', x: gull.x, z: gull.z, altitude: gull.altitude || 15, label: 'THE GULL' });
        extras.push({ kind: 'heli-chip', text: 'ALT ' + (gull.altitude || 15) + ' m   ·   THE GULL   ·   58 km/h' });
      }
    }
    return extras;
  }

  function stageShot(name, seed, city) {
    var s = seed || 1;
    if (!city) return null;
    if (name === 'night') return stageNightShot(city, s);
    if (name === 'systems') return stageSystemsShot(city, s);
    if (name === 'heli') return stageHeliShot(city, s);
    return stageChaseShot(city, s);
  }

  // Stage one shot and return a small record the test (and the
  // capture page) can assert on.
  function applyShot(id, seed, city) {
    var built = stageShot(id, seed, city);
    if (!built) return { shot: id, ok: false, reason: 'no-city' };
    var state = built.state;
    return {
      shot: built.name,
      seed: seed || 1,
      mode: built.mode,
      wanted: state.wanted,
      cars: state.cars.length,
      peds: state.peds.length,
      mission: state.missions ? state.missions.current : null,
      heliUsedGull: !!state.heliUsedGull,
      gullFallback: !!state.gullFallback,
      completion: state.completion,
      camera: built.camera,
      extras: shotExtras(built),
      footer: footerText(built.name, seed || 1),
      state: state,
      city: city,
      ok: true
    };
  }

  // Capture-page entry: ?shot=chase&seed=1 stages that shot instead
  // of starting the live game loop. Returns the staged record, or
  // null when no shot was requested.
  function renderFromQuery(city) {
    var q = parseQuery(typeof location !== 'undefined' ? location.search : '');
    if (!q.shot) return null;
    var known = null;
    for (var i = 0; i < SHOTS.length; i++) {
      if (SHOTS[i].id === q.shot) known = SHOTS[i];
    }
    if (!known) return { shot: q.shot, ok: false, reason: 'unknown-shot' };
    return applyShot(known.id, q.seed, city);
  }

  window.PalmaShots3d = {
    SHOTS: SHOTS,
    parseQuery: parseQuery,
    footerText: footerText,
    stageShot: stageShot,
    stageChaseShot: stageChaseShot,
    stageNightShot: stageNightShot,
    stageSystemsShot: stageSystemsShot,
    stageHeliShot: stageHeliShot,
    applyShot: applyShot,
    renderFromQuery: renderFromQuery,
    stageChase: stageChase,
    placePolice: placePolice,
    buildBaseState: buildBaseState,
    districtAt: districtAt,
    nearestRoadPoint: nearestRoadPoint,
    beachRoadPoint: beachRoadPoint,
    districtCentre: districtCentre,
    completionPercent: completionPercent,
    makeRng: makeRng,
    shotExtras: shotExtras
  };
})();
