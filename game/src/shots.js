// Palma Verde — shot staging: four deterministic frames for the
// judge's contact sheet, plus the ?shot=…&seed=… query handling.
//
// REWORK (r2): every shot is re-staged for the low oblique camera.
// The renderer looks north toward a horizon at HORIZON_Y (180): the
// ground band is 180..720, and things shrink toward the horizon by
// the depth scale. So a shot camera is placed by SCREEN position,
// not by world offset: placeCamera() puts the focus exactly where
// the frame wants it (hero low-centre, road ahead to the horizon)
// by inverting the projection. The live loop's followCamera anchor
// is NOT reused here — at chase zoom its north bias puts the hero
// car's nose off the bottom of the frame, so the shots frame the
// hero a little higher (sy ~465) with the same zoom.
//
// Zoom per shot (Builder 1's numbers): chase 6.4 (hero car ~230 px
// long on the vertical beach-road run, ~21% of the frame at the
// live-loop anchor), night 2.5 (Rey ~150 px, market stalls read),
// heli 2.4 (the Gull's rotor ~250 px, ~20% of the frame), systems
// as before (a pause screen, no world camera).
//
// Density per shot comes from the traffic layer's own spawn
// functions (spawnMover / spawnMoped / spawnParkedRow /
// spawnPedGroup), never from hand-rolled cars: chase is beach-road
// rush hour, night is a fleeing market crowd, heli is a beach-road
// cruise. Anything a spawn function places off-frame still counts
// in the record — the street is full, the frame shows its centre.
//
// Each shot builds a fresh city and a fresh game state, stages the
// scene (wanted level, mission, cars, pedestrians, dialogue), and
// hands it to the renderer. Nothing here advances time: renderSync
// draws exactly one frame, and every random choice comes from a
// seeded generator, so the same query renders the same frame every
// run. The live game never calls this file; the capture page calls
// renderSync once per shot.

(function () {
  'use strict';

  var WORLD = window.PalmaWorld;
  var VEH = window.PalmaVehicles;
  var CFG = window.PalmaConfig;
  var TRAF = window.PalmaTraffic;

  var SHOTS = [
    { id: 'chase', file: '1-chase.jpg', title: 'Golden-hour 4-star chase', seed: 1 },
    { id: 'night', file: '2-night.jpg', title: 'Neon-night shootout, Citrus Lane', seed: 2 },
    { id: 'systems', file: '3-systems.jpg', title: 'Pause menu: map, stats, crew, saves', seed: 3 },
    { id: 'heli', file: '4-heli.jpg', title: 'The Gull low over the Boardwalk', seed: 4 }
  ];

  var SHIRT_COLORS = ['#3d7ea6', '#c94f3d', '#e8c53a', '#4a6b4f', '#e86a92', '#7a5a9e'];

  // Frame constants for the camera math: the design frame is
  // 1280x720, the horizon sits at HORIZON_Y, the ground plane is
  // squashed by V_SQUASH. Read from the config when the render
  // builder has landed it, fall back to the spec values.
  function frameConsts() {
    var fr = (CFG && CFG.FRAME) || {};
    return {
      W: fr.W || 1280,
      horizon: (typeof fr.HORIZON_Y === 'number') ? fr.HORIZON_Y : 180,
      squash: (typeof fr.V_SQUASH === 'number') ? fr.V_SQUASH : 0.5
    };
  }

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

  // Put the camera so the world point (fx, fy) lands on screen
  // pixel (sx, sy) at the given zoom. This is the projection
  // solved backwards: sx = (fx - cam.x) * zoom + W/2 and
  // sy = horizon + (fy - cam.y) * zoom * squash. The caller picks
  // the focus screen position; the road ahead (north, toward the
  // horizon) and the foreground (south, toward the HUD) follow.
  function placeCamera(state, fx, fy, zoom, sx, sy) {
    var fr = frameConsts();
    state.cam.zoom = zoom;
    state.cam.x = fx - (sx - fr.W / 2) / zoom;
    state.cam.y = fy - (sy - fr.horizon) / (zoom * fr.squash);
    return state.cam;
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

  // Move one staged car onto a road spot: position, heading along
  // the road, and a cruising speed. The traffic layer spawned it on
  // a real road near the player; this only pulls it into the frame.
  function parkOnRoad(car, x, y, angle, speed) {
    car.x = x;
    car.y = y;
    car.angle = angle;
    car.speed = speed;
    return car;
  }

  // Chase density: beach-road rush hour. 26 movers + 2 mopeds from
  // the traffic layer, parked rows on both kerbs, beach strollers
  // on the sand and sidewalk walkers on the city side. The movers
  // stay at their spawned spots near the hero — at chase zoom the
  // frame only holds ~90 units of road ahead, and pulling movers
  // into it packs them nose-to-tail into a pile-up instead of a
  // chase. The street is full; the frame shows its centre: the
  // hero, the pursuit, the parked rows, the beachgoers.
  function stageBeachRush(state, city, rng) {
    if (!TRAF) return;
    var i;
    for (i = 0; i < 26; i++) TRAF.spawnMover(state, city, rng);
    for (i = 0; i < 2; i++) TRAF.spawnMoped(state, city, rng);
    // Parked rows: three cars on the sand-side kerb (avenue 548
    // parks at x574, facing the beach) and one on the east kerb
    // south of the hero. The old single east row sat ten units
    // behind the lead cruiser and read as one more car in the stack.
    TRAF.spawnParkedRow(state, city, rng, 548, 2075, 2200);
    TRAF.spawnParkedRow(state, city, rng, 600, 2160, 2160);
    TRAF.spawnPedGroup(state, city, rng, 520, 2100, 5, 'beach');
    TRAF.spawnPedGroup(state, city, rng, 650, 2120, 6, 'sidewalk');
    TRAF.spawnPedGroup(state, city, rng, 515, 2195, 4, 'beach');
    // Umbrellas on the sand in-frame: the world scatters 34 across
    // the whole beach, but at chase zoom the frame only sees the
    // strip beside the road, so the shot plants three where the
    // camera looks. Fixed spots, so the frame is deterministic.
    city.props.push({ x: 470, y: 2030, kind: 'umbrella' });
    city.props.push({ x: 500, y: 2110, kind: 'umbrella' });
    city.props.push({ x: 460, y: 2170, kind: 'umbrella' });
    city.props.push({ x: 492, y: 2052, kind: 'towel' });
    city.props.push({ x: 522, y: 2132, kind: 'towel' });
  }

  // Any staged car whose ground point projects into the sky band
  // (screen y above the horizon) would draw floating in the sky:
  // the camera looks north, so cars north of the anchor sit above
  // the horizon line. Move those cars south of the hero, off the
  // bottom of the frame — they stay in the record, out of the sky.
  // Call after placeCamera, so the projection is final.
  function sweepSkyCars(state, rng) {
    var fr = frameConsts();
    var cam = state.cam;
    var i, car, sy, sx;
    for (i = 0; i < state.cars.length; i++) {
      car = state.cars[i];
      if (!car || car.policeUnit) continue;
      sy = fr.horizon + (car.y - cam.y) * cam.zoom * fr.squash;
      sx = (car.x - cam.x) * cam.zoom + fr.W / 2;
      if (sy < fr.horizon + 5 && sx > -80 && sx < fr.W + 80) {
        car.y = state.player.y + 130 + rng() * 120;
      }
    }
  }

  // Night density: a fleeing market crowd. Three market groups from
  // the traffic layer, every ped moved onto the market avenue south
  // of Rey (the groups spawn inside the market block, where the
  // buildings would hide them) and flagged fleeing away from him,
  // plus one car on the avenue behind him.
  function stageMarketCrowd(state, city, rng) {
    if (!TRAF) return;
    var p = state.player;
    var groups = [
      TRAF.spawnPedGroup(state, city, rng, 1250, 1350, 4, 'market'),
      TRAF.spawnPedGroup(state, city, rng, 1420, 1450, 4, 'market'),
      TRAF.spawnPedGroup(state, city, rng, 1350, 1420, 5, 'market')
    ];
    var g, i, ped, n = 0;
    for (g = 0; g < groups.length; g++) {
      for (i = 0; i < groups[g].length; i++) {
        ped = groups[g][i];
        // Onto the avenue (x 1310/1330), running south away from
        // the gunfire, two abreast down the road.
        ped.x = 1310 + (n % 2) * 20;
        ped.y = 1430 + Math.floor(n / 2) * 26;
        ped.fleeing = true;
        ped.speed = 55 + rng() * 30;
        ped.angle = Math.atan2(ped.y - p.y, ped.x - p.x);
        n++;
      }
    }
    var base = state.cars.length;
    for (i = 0; i < 3; i++) TRAF.spawnMover(state, city, rng);
    var movers = state.cars.slice(base, base + 3);
    if (movers[0]) parkOnRoad(movers[0], 1312, 1470, Math.PI / 2, 10 + rng() * 8);
  }

  // Heli density: a beach-road cruise under the Gull. A few movers
  // and a parked row on the road NORTH of the Gull — the road under
  // and around her stays clear, so she reads alone against the sky
  // — plus beach strollers on the sand and walkers on the sidewalk.
  function stageBeachCruise(state, city, rng) {
    if (!TRAF) return;
    var base = state.cars.length;
    var i;
    for (i = 0; i < 4; i++) TRAF.spawnMover(state, city, rng);
    var movers = state.cars.slice(base, base + 4);
    if (movers[0]) parkOnRoad(movers[0], 592, 1820, Math.PI / 2, 14 + rng() * 8);
    if (movers[1]) parkOnRoad(movers[1], 608, 1850, -Math.PI / 2, 12 + rng() * 8);
    TRAF.spawnParkedRow(state, city, rng, 600, 1700, 1880);
    TRAF.spawnPedGroup(state, city, rng, 500, 1950, 4, 'beach');
    TRAF.spawnPedGroup(state, city, rng, 650, 2000, 4, 'sidewalk');
  }

  // Place the staged police where the frame can see them, by kind:
  // the first cruiser and first bike go to the spots the shot asks
  // for, the foot officer to the sidewalk, and the rest stay where
  // the dispatch spawned them — responding from off-frame, their
  // call-signs and distances still on the HUD board.
  function placePolice(state, cruiserSpots, bikeSpots, footSpot) {
    if (!state.police || !state.police.units) return;
    var units = state.police.units;
    var ci = 0, bi = 0, i, u;
    for (i = 0; i < units.length; i++) {
      u = units[i];
      if (u.kind === 'foot' && footSpot) {
        u.car.x = footSpot[0];
        u.car.y = footSpot[1];
        u.car.angle = Math.atan2(state.player.y - footSpot[1], state.player.x - footSpot[0]);
      } else if (u.kind === 'cruiser' && cruiserSpots[ci]) {
        parkOnRoad(u.car, cruiserSpots[ci][0], cruiserSpots[ci][1], cruiserSpots[ci][2], 20 + ci * 4);
        ci++;
      } else if (u.kind === 'bike' && bikeSpots[bi]) {
        parkOnRoad(u.car, bikeSpots[bi][0], bikeSpots[bi][1], bikeSpots[bi][2], 26 + bi * 4);
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

  function finishStaging(state, city) {
    state.district = WORLD.districtAt(city, state.player.x, state.player.y);
    state.cam.x = state.player.x;
    state.cam.y = state.player.y;
    return state;
  }

  // SHOT 1 — 1-chase.jpg. Golden hour, four stars, the coral-red
  // Cometa GT on the Boardwalk beach road, the PVPD dispatch board
  // full, AIR-1 overhead, mission 6 running.
  //
  // The chase runs NORTH up the beach road (the road is parallel to
  // the shore, so north is along it): the hero's nose points at the
  // horizon, the sand and palm rows read on the left of the frame,
  // the shopfront blocks on the right. beachRoadPoint(city, 2150)
  // is the route — nearestRoadPoint(700, 2150) snaps to street 2220
  // instead, off the beach road. Zoom 6.4, hero framed at screen
  // (640, 465): low-centre foreground, road ahead to the horizon,
  // clear of the dialogue bar (top y588).
  function stageChaseShot(seed) {
    var city = WORLD.buildCity(20261123 + seed);
    var rng = makeRng(seed * 7919 + 13);
    var state = buildBaseState(city, seed, 18 * 60 + 40);
    seedStreetLife(state, city, rng);
    var road = WORLD.beachRoadPoint(city, 2150);
    var hero = VEH.spawnHeroCar(city);
    hero.x = road.x;
    hero.y = road.y;
    hero.angle = -Math.PI / 2;
    hero.speed = 42;
    hero.damage = 12;
    hero.driver = 'player';
    state.player.vehicle = hero;
    state.player.x = hero.x;
    state.player.y = hero.y;
    state.player.angle = -Math.PI / 2;
    state.player.health = 82;
    state.player.armour = 60;
    state.player.money = 12450;
    state.player.ammo = { pistol: 9, pistol_reserve: 48 };
    window.PalmaPolice.stageChase(state, city, 4);
    // The pursuit, on the road in-frame: a cruiser ahead in the
    // northbound lane, a bike and a ramming cruiser head-on in the
    // southbound lane, a foot officer on the sand-side kerb where
    // the parked cars do not hide him. The other three units chase
    // from behind, off-frame south — the board shows them closing,
    // the frame stays a chase instead of a pile-up.
    placePolice(state,
      [[608, 2085, -Math.PI / 2], [592, 2145, Math.PI / 2], [608, 2260, -Math.PI / 2], [592, 2300, Math.PI / 2]],
      [[592, 2110, Math.PI / 2], [608, 2340, -Math.PI / 2]],
      [574, 2120]);
    // AIR-1 stays at the dispatch offset (hero +150, -140): at
    // chase zoom the police heli would be a 400 px body if it were
    // in-frame, so it stays off-frame east and the dispatch board
    // carries it — the Gull gets her own shot.
    state.police.heli.x = hero.x + 150;
    state.police.heli.y = hero.y - 140;
    stageBeachRush(state, city, rng);
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
    placeCamera(state, hero.x, hero.y, 6.4, 640, 465);
    sweepSkyCars(state, rng);
    return { name: 'chase', state: state, city: city, seed: seed };
  }

  // SHOT 2 — 2-night.jpg. Neon night, on foot in Citrus Lane: Rey
  // firing, three rivals (one down), pedestrians running, two stars.
  //
  // Staged BEHIND Rey: he faces north up the market aisle, the
  // camera sits south of him, so the reader sees his back, the
  // pistol, and the rivals ahead of him toward the horizon. Zoom
  // 2.5 — tight enough that the stalls, the neon, and the fleeing
  // crowd read, wide enough that the market street fits.
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
    // Three rivals ahead of Rey in a line ACROSS the street: one
    // on the avenue's west edge, one on the cross street east, the
    // downed one centre on the avenue. nearestRoadPoint snaps the
    // west one onto the street (y1260) and keeps the east one's x,
    // so the three spread 75-190 px apart instead of stacking in a
    // totem pole on Rey's line. Rivals placed in the block east of
    // the avenue stand inside building footprints and the painter
    // hides them behind the walls.
    var rivalSpots = [[-15, -130], [60, -140], [0, -125]];
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
    stageMarketCrowd(state, city, rng);
    window.PalmaPolice.stageChase(state, city, 2);
    // Two units responding in-frame: a cruiser on the cross street
    // north of the market, a bike on the avenue below the rivals.
    // The foot officer and the second cruiser close in from off-frame.
    placePolice(state,
      [[1420, 1260, Math.PI]],
      [[1332, 1375, -Math.PI / 2]],
      null);
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
    placeCamera(state, p.x, p.y, 2.5, 640, 520);
    return { name: 'night', state: state, city: city, seed: seed };
  }

  // SHOT 3 — 3-systems.jpg. Pause menu, one frame: full-city map,
  // stats dashboard, crew, save slots, garage strip. The state is
  // mid-game — Act II, mission 6, 48% complete — so every number the
  // dashboard prints is a real number from the systems. Framing as
  // before the rework: the dashboard owns the frame, the world
  // camera behind it is the player spawn.
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
  // at sunset, two stars, Sky Courier running.
  //
  // The Gull flies NORTH up the beach road at ALT 15 m, so the road
  // runs ahead of her to the horizon with the sand on the left and
  // the shopfront blocks on the right. Zoom 2.4: her rotor spans
  // ~250 px, ~20% of the frame. She boards from the beach road
  // (beachRoadPoint, not the old sand spot at (420, 1900)), and the
  // camera puts her ground point at screen (640, 560) so her lifted
  // body sits mid-frame with the shadow on the road below her.
  function stageHeliShot(seed) {
    var city = WORLD.buildCity(20261123 + seed);
    var rng = makeRng(seed * 7919 + 61);
    var state = buildBaseState(city, seed, 18 * 60 + 50);
    seedStreetLife(state, city, rng);
    var road = WORLD.beachRoadPoint(city, 2050);
    var p = state.player;
    p.x = road.x;
    p.y = road.y;
    p.angle = -Math.PI / 2;
    p.health = 90;
    p.armour = 40;
    p.money = 15600;
    p.ammo = { pistol: 12, pistol_reserve: 60 };
    var gullUsed = false;
    if (window.PalmaVehicles && typeof window.PalmaVehicles.spawnGull === 'function') {
      try {
        // Boarding only works within 90 world units, so spawn the Gull
        // right beside Rey on the beach road, not on its default pier pad.
        var gull = window.PalmaVehicles.spawnGull(city, { x: road.x + 10, y: road.y - 40, angle: -Math.PI / 2 });
        if (window.PalmaPlayer && typeof window.PalmaPlayer.enterHeli === 'function') {
          window.PalmaPlayer.enterHeli(state, gull);
        } else {
          state.player.vehicle = gull;
        }
        if (state.player.vehicle) {
          state.player.vehicle.x = road.x + 10;
          state.player.vehicle.y = road.y - 40;
          state.player.vehicle.angle = -Math.PI / 2;
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
    // Two units responding in-frame on the beach road NORTH of the
    // Gull: a cruiser and a bike ahead of her, clear of her body.
    // The rest close in from off-frame.
    placePolice(state,
      [[608, 1880, -Math.PI / 2]],
      [[592, 1870, Math.PI / 2]],
      null);
    stageBeachCruise(state, city, rng);
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
    var gx = gullUsed ? state.player.vehicle.x : state.gullFallback.x;
    var gy = gullUsed ? state.player.vehicle.y : state.gullFallback.y;
    placeCamera(state, gx, gy, 2.4, 640, 560);
    return { name: 'heli', state: state, city: city, seed: seed };
  }

  // Extra marks the world renderer does not draw: the muzzle-flash
  // star and hit markers for the night shootout, the fallen rival's
  // marker, neon shop signs, and the Gull herself with her altitude
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
      // Two neon shop signs glowing on the market street, kept off
      // the minimap (x14-244): at night zoom the old offsets landed
      // the MERCADO sign on top of it.
      var signs = [
        { dx: -120, dy: -60, text: 'MERCADO', color: '#ff5a8a' },
        { dx: 140, dy: -90, text: 'NEON', color: '#37e0c8' }
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
        // The renderer lifts the Gull's body above her ground point
        // by alt * 2.4 * zoom * depth, so the name tag sits above
        // the rotor, not on the body: tag height = lift + 36 px.
        var lift = alt * 2.4 * state.cam.zoom * (hp.s || 1);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 13px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('THE GULL', hp.x, hp.y - lift - 36);
        ctx.textAlign = 'left';
        // Altitude + speed chip, TOP centre: the old spot (bottom
        // centre, y h-66) painted straight over the weapon bar
        // (y660-706). The top centre is free — the mission panel
        // ends at x484, the money panel starts at x1036 — and the
        // sky sits behind it.
        var w = canvas ? canvas.width : 1280;
        ctx.fillStyle = 'rgba(8,12,18,0.6)';
        ctx.fillRect(w / 2 - 150, 14, 300, 44);
        ctx.fillStyle = '#ffd166';
        ctx.font = 'bold 16px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('ALT ' + alt + ' m   ·   THE GULL   ·   128 km/h', w / 2, 43);
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
    // No renderer flash on the night shot: at night zoom its halo
    // is ~170 px across and it draws OVER Rey, washing him out.
    // The muzzle flash is the star drawShotExtras paints at the
    // pistol tip, after the HUD.
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
      zoom: state.cam.zoom,
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
