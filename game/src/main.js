// Palma Verde — game loop, input, state machine, clock, saves.
//
// THE SHARED STATE OBJECT (every system builder reads this shape):
//   state.player    { x, y, health, armour, money, vehicle, weapon, ammo, ... }
//   state.wanted    0–5 stars
//   state.rp        reputation points; state.rank is the rank index
//   state.respect   0–100, grows with jobs done well
//   state.missions  { current: null|id, stage: 0, completed: [] }
//   state.crew      { tuck: { cooldown }, ines: { cooldown }, kip: { cooldown } }
//   state.garage    { owned: [], upgrades: {} }
//   state.properties{ owned: [] }
//   state.collectibles { found: [] }
//   state.completion 0–100 percent
//   state.clockMinutes, state.weather { haze }, state.cars, state.peds,
//   state.radioStation, state.screen ('title' | 'playing' | 'paused'),
//   state.cam { x, y, zoom }, state.district (current district record)
//   state.dialogue { name, text, color } (last spoken line, drawn by the HUD),
//   state.banner (MISSION PASSED card, or null), state.missionTarget { x, y }
//   (the dashed-route marker), state.missionKills (takedowns in the
//   current shoot stage), state.raceDeadline (game seconds), and
//   state.lastFailedMission (id, for the T retry key)
// This file owns the loop and the state object, and it drives the
// mission, crew and progress systems through their window APIs —
// PalmaMissions for the stage reporters, PalmaCrew for the three
// abilities, PalmaProgress for the RP-to-rank mapping. The systems
// themselves stay separate files; the loop only ever calls them with
// the shared state and the hooks object built in startGame below.

(function () {
  'use strict';

  var CFG = window.PalmaConfig;
  var WORLD = window.PalmaWorld;

  var SAVE_KEY = 'palma-verde-save';

  function freshState(city) {
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
      clockMinutes: CFG.CLOCK.startMinutes,
      weather: { haze: 0.12 },
      cars: [], peds: [],
      radioStation: 0,
      screen: 'title',
      cam: { x: spawn.x, y: spawn.y, zoom: 0.85 },
      district: null,
      mouseWorld: null,
      lastCrime: null,
      time: 0,
      dialogue: null, banner: null,
      missionTarget: null, waypoint: null,
      missionKills: 0, raceDeadline: 0, lastFailedMission: null
    };
  }

  function seedStreetLife(state, city) {
    var rng = WORLD.makeRng(city.seed + 77);
    // Parked cars along the roads, plus the hero Cometa GT in Old Town.
    var i;
    for (i = 0; i < 26; i++) {
      state.cars.push(window.PalmaVehicles.parkCar(city, rng));
    }
    state.cars.push(window.PalmaVehicles.spawnHeroCar(city));
    // A few strolling pedestrians near the Boardwalk and Citrus Lane.
    var shirts = ['#3d7ea6', '#c94f3d', '#e8c53a', '#4a6b4f', '#e86a92', '#7a5a9e'];
    for (i = 0; i < 18; i++) {
      var spot = WORLD.randomRoadSpot(city, rng);
      state.peds.push({
        x: spot.x + (rng() - 0.5) * 60, y: spot.y + (rng() - 0.5) * 60,
        angle: rng() * Math.PI * 2, speed: 20 + rng() * 30,
        color: '#e8b48f', shirt: shirts[i % shirts.length], health: 100
      });
    }
  }

  function saveGame(state, slot) {
    try {
      var data = {
        slot: slot || 1, savedAt: Date.now(),
        player: {
          x: state.player.x, y: state.player.y,
          health: state.player.health, armour: state.player.armour,
          money: state.player.money, weapon: state.player.weapon,
          ammo: state.player.ammo
        },
        wanted: state.wanted, rp: state.rp, rank: state.rank,
        respect: state.respect, missions: state.missions,
        crew: state.crew, garage: state.garage,
        properties: state.properties, collectibles: state.collectibles,
        completion: state.completion, clockMinutes: state.clockMinutes
      };
      localStorage.setItem(SAVE_KEY + '-' + (slot || 1), JSON.stringify(data));
      return true;
    } catch (e) { return false; }
  }

  function loadGame(slot) {
    try {
      var raw = localStorage.getItem(SAVE_KEY + '-' + (slot || 1));
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function applySave(state, data) {
    if (!data) return false;
    var p = state.player;
    p.x = data.player.x; p.y = data.player.y;
    p.health = data.player.health; p.armour = data.player.armour;
    p.money = data.player.money; p.weapon = data.player.weapon;
    p.ammo = data.player.ammo || {};
    state.wanted = data.wanted; state.rp = data.rp; state.rank = data.rank;
    state.respect = data.respect; state.missions = data.missions;
    state.crew = data.crew; state.garage = data.garage;
    state.properties = data.properties; state.collectibles = data.collectibles;
    state.completion = data.completion; state.clockMinutes = data.clockMinutes;
    state.cam.x = p.x; state.cam.y = p.y;
    return true;
  }

  function rankName(state) {
    var r = CFG.RANKS[Math.min(state.rank, CFG.RANKS.length - 1)];
    return r ? r.name : 'Runner';
  }

  function startGame(canvas) {
    var city = WORLD.buildCity(20261123);
    var state = freshState(city);
    seedStreetLife(state, city);
    // The heli builder hands the loop the city and the parked Gull;
    // the flight step and the boarding key both read them from here.
    state.city = city;
    state.gull = window.PalmaVehicles.spawnGull(city);

    // ---- LIVE MISSION + CREW WIRING ----
    //
    // How a live player actually plays a mission, by keyboard:
    //  - Mission 1 starts by itself the moment a new game leaves the
    //    title screen (Enter). Later missions wait at their markers:
    //    the minimap route points at the next unlocked mission's first
    //    stage, and E starts it when Rey stands on foot near the
    //    marker. E never does two jobs at once — delivery first, then
    //    mission start, then the car/heli logic it already had.
    //  - A stage's target is a road point inside its district: the
    //    district centre, shifted a little per stage so two stages in
    //    one district do not share a marker, then snapped to the
    //    nearest road. Reaching it advances drive-to, pickup and
    //    escort stages. A deliver stage needs E, on foot, at the
    //    marker. A shoot stage clears when Rey downs three people
    //    while it runs (the world has no separate rival faction, so
    //    any takedown counts — the fiction calls them rivals). A race
    //    stage is a timed sprint to the pier end: 120 seconds, then
    //    the mission fails.
    //  - Crew keys are Z (Tuck), X (Ines), V (Kip). They sit clear of
    //    the pause-tab digits 1-6, of E/R/Q and of F9, and of the
    //    heli sink key C. T retries the last failed mission.
    //  - Rank never moves inside missions.js: completeMission pays
    //    the RP, and this loop then asks progress.js to re-derive the
    //    rank from the new total (addRp with zero, so the RP is not
    //    counted twice) and to refresh completion.
    var ARRIVE_R = 170;   // how close counts as "there" for a stage
    var MARKER_R = 120;   // how close E starts a mission / hands over
    var RACE_SECONDS = 120;
    var SHOOT_KILLS = 3;
    var STAGE_OFFS = [[0, 0], [320, -180], [-300, 240], [180, 300]];

    function nearTarget(radius) {
      var t = state.missionTarget;
      if (!t) return false;
      var dx = state.player.x - t.x, dy = state.player.y - t.y;
      return Math.sqrt(dx * dx + dy * dy) < radius;
    }

    function speakerColor(who) {
      if (who === 'Nadia Venn') return '#c94f3d';
      if (who === 'Ines Duarte') return '#3d7ea6';
      if (who === 'Tuck Ibarra') return '#e8c53a';
      return '#e8e8e8';
    }

    function pointAtStage(stage, ordinal) {
      if (!stage) { state.missionTarget = null; return; }
      var rect = null;
      for (var i = 0; i < CFG.DISTRICTS.length; i++) {
        if (CFG.DISTRICTS[i].name === stage.district) rect = CFG.DISTRICTS[i];
      }
      var cx = rect ? (rect.x0 + rect.x1) / 2 : state.player.x;
      var cy = rect ? (rect.y0 + rect.y1) / 2 : state.player.y;
      var off = STAGE_OFFS[Math.min(ordinal || 0, STAGE_OFFS.length - 1)];
      var pt = WORLD.nearestRoadPoint(city, cx + off[0], cy + off[1]);
      state.missionTarget = { x: pt.x, y: pt.y };
      state.waypoint = { x: pt.x, y: pt.y, label: stage.place || stage.district };
    }

    function nextFreeMission() {
      if (!window.PalmaMissions) return null;
      var list = window.PalmaMissions.MISSIONS;
      for (var i = 0; i < list.length; i++) {
        if (state.missions.completed.indexOf(list[i].id) < 0 &&
            window.PalmaMissions.isMissionUnlocked(state, list[i].id)) return list[i];
      }
      return null;
    }

    function refreshFreeMarker() {
      if (state.missions.current) return;
      var next = nextFreeMission();
      if (next) pointAtStage(next.stages[0], 0);
      else state.missionTarget = null;
    }

    var hooks = {
      atTarget: function () { return nearTarget(ARRIVE_R); },
      foesDown: function () { return (state.missionKills || 0) >= SHOOT_KILLS; },
      raceWon: function () { return false; },
      parcelHanded: function () { return !state.player.vehicle && nearTarget(ARRIVE_R); },
      setWanted: function (st, level) { st.wanted = level; },
      onEvent: function (st, kind, payload) {
        if (kind === 'dialogue') {
          st.dialogue = { name: payload.who, text: payload.line, color: speakerColor(payload.who) };
        } else if (kind === 'mission-start') {
          var m = window.PalmaMissions.missionById(payload.id);
          if (m && m.stages[0]) pointAtStage(m.stages[0], 0);
          st.missionKills = 0;
          st.lastFailedMission = null;
        } else if (kind === 'stage-start') {
          var mm = window.PalmaMissions.missionById(payload.mission);
          if (mm) {
            var idx = 0;
            for (var i = 0; i < mm.stages.length; i++) {
              if (mm.stages[i].id === payload.stage) idx = i;
            }
            pointAtStage(mm.stages[idx], idx);
            if (mm.stages[idx].type === 'race') {
              st.raceDeadline = st.time + RACE_SECONDS;
              var pier = WORLD.findSpawn(city, 'pier');
              st.missionTarget = { x: pier.x, y: pier.y };
              st.waypoint = { x: pier.x, y: pier.y, label: 'Pier end' };
            }
          }
          st.missionKills = 0;
        } else if (kind === 'banner') {
          if (payload.kind === 'MISSION PASSED') {
            st.banner = payload;
          } else {
            st.banner = null;
            st.dialogue = { name: 'Nadia Venn', text: (payload.name || 'The mission') + ' fell apart. Press T to run it back.', color: '#c94f3d' };
          }
        }
      }
    };

    function settleReport(result, rankBefore) {
      if (!result || !result.ok) return;
      if (result.passed) {
        if (window.PalmaProgress) {
          window.PalmaProgress.addRp(state, 0);
          window.PalmaProgress.refreshCompletion(state);
          if (typeof state.rank === 'number' && state.rank > rankBefore) {
            var rn = window.PalmaProgress.rankForRp(state.rp);
            state.dialogue = { name: 'Nadia Venn', text: 'Rank up, Rey — you are ' + rn.name + ' now. The city noticed.', color: '#c94f3d' };
          }
        }
        refreshFreeMarker();
      } else if (result.failed) {
        refreshFreeMarker();
      }
    }

    function missionTick() {
      if (!window.PalmaMissions) return;
      var cur = window.PalmaMissions.currentMission(state);
      if (!cur) return;
      var stage = window.PalmaMissions.currentStage(state);
      if (!stage) return;
      var rankBefore = state.rank;
      var result = null;
      if (stage.type === 'drive-to' || stage.type === 'pickup' || stage.type === 'escort') {
        result = window.PalmaMissions.reportArrival(state, hooks);
      } else if (stage.type === 'shoot') {
        result = window.PalmaMissions.reportCombat(state, hooks);
      } else if (stage.type === 'race') {
        if (nearTarget(ARRIVE_R)) {
          result = window.PalmaMissions.reportRace(state, hooks, true);
        } else if (state.raceDeadline && state.time > state.raceDeadline) {
          var failing = state.missions.current;
          result = window.PalmaMissions.reportRace(state, hooks, false);
          if (result && result.failed) state.lastFailedMission = failing;
        } else return;
      } else {
        return; // deliver stages wait for the E key, not the clock
      }
      settleReport(result, rankBefore);
    }

    function handleDeath() {
      var cur = window.PalmaMissions ? window.PalmaMissions.currentMission(state) : null;
      if (cur) {
        state.lastFailedMission = cur.id;
        window.PalmaMissions.failMission(state, 'rey-down', hooks);
        refreshFreeMarker();
      }
      state.player.health = 50;
      state.wanted = 0;
      state.dialogue = { name: 'Nadia Venn', text: 'You are still breathing, Rey. Press T to run it back.', color: '#c94f3d' };
    }

    refreshFreeMarker();

    var renderer = window.PalmaRender.makeRenderer(canvas);
    renderer.resize(canvas.clientWidth || 1280, canvas.clientHeight || 720);

    var keys = {};
    var mouse = { x: 0, y: 0, down: false };
    var last = performance.now();

    function keyName(e) {
      var k = e.key.toLowerCase();
      if (k === ' ') return 'space';
      return k;
    }

    window.addEventListener('keydown', function (e) {
      var k = keyName(e);
      keys[k] = true;
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].indexOf(k) >= 0) e.preventDefault();
      if (k === 'enter' && state.screen === 'title') {
        state.screen = 'playing';
        // A new game opens on mission 1: no marker hunt first, the
        // debt is the tutorial and it starts itself.
        if (window.PalmaMissions) {
          var first = window.PalmaMissions.startMission(state, 'the-debt', hooks);
          if (!first.ok) refreshFreeMarker();
        }
      }
      if (k === 'enter' && state.screen === 'playing' && state.banner) state.banner = null;
      if (state.screen === 'title' && (k === 'arrowleft' || k === 'arrowright')) {
        state.titleSlot = ((state.titleSlot || 0) + (k === 'arrowright' ? 1 : 2)) % 3;
      }
      if (k === 'escape' || k === 'p') {
        if (state.screen === 'playing') state.screen = 'paused';
        else if (state.screen === 'paused') state.screen = 'playing';
      }
      // Pause-menu keys: 1-6 switch the PalmaScreens tab, M drops a
      // waypoint on the current mission marker.
      if (state.screen === 'paused' && window.PalmaScreens) {
        var tabs = window.PalmaScreens.TABS;
        var n = parseInt(k, 10);
        if (n >= 1 && n <= tabs.length) state.pauseTab = tabs[n - 1].id;
        if (k === 'm' && state.missionTarget) {
          state.waypoint = { x: state.missionTarget.x, y: state.missionTarget.y, label: 'Mission' };
        }
      }
      if (k === 'e' && state.screen === 'playing') {
        // One key, three jobs, in priority order: hand a parcel over
        // (deliver stage, on foot, at the marker), start the waiting
        // mission (free roam, on foot, at its marker), then the car
        // and heli logic — a heli in the air lands first in the exit
        // check, then a car, then boarding, the Gull when she is
        // close, else a car.
        var stageNow = window.PalmaMissions ? window.PalmaMissions.currentStage(state) : null;
        var nearMark = state.missionTarget &&
          Math.hypot(state.player.x - state.missionTarget.x, state.player.y - state.missionTarget.y) < MARKER_R;
        if (stageNow && stageNow.type === 'deliver' && !state.player.vehicle && nearMark) {
          var rb = state.rank;
          settleReport(window.PalmaMissions.reportDelivery(state, hooks), rb);
        } else if (!state.missions.current && !state.player.vehicle && nearMark) {
          var next = nextFreeMission();
          if (next) window.PalmaMissions.startMission(state, next.id, hooks);
        } else {
          var riding = state.player.vehicle;
          if (riding && riding.kind === 'heli') window.PalmaPlayer.exitHeli(state);
          else if (riding) window.PalmaPlayer.exitVehicle(state, city);
          else if (state.gull && window.PalmaPlayer.enterHeli(state)) { /* aboard the Gull */ }
          else window.PalmaPlayer.enterVehicle(state, city);
        }
      }
      if (k === 'r' && state.screen === 'playing') window.PalmaPlayer.reloadWeapon(state);
      if (k === 'q' && state.screen === 'playing') {
        state.radioStation = (state.radioStation + 1) % CFG.RADIO.length;
        if (window.PalmaAudio) window.PalmaAudio.jingle();
      }
      // Crew abilities: Z Tuck, X Ines, V Kip. The digits stay with
      // the pause tabs and the weapon slots, so the crew lives on
      // letters instead.
      if ((k === 'z' || k === 'x' || k === 'v') && state.screen === 'playing' && window.PalmaCrew) {
        var crewId = k === 'z' ? 'tuck' : (k === 'x' ? 'ines' : 'kip');
        var cast = window.PalmaCrew.useAbility(state, crewId, Date.now());
        var member = window.PalmaCrew.crewById(crewId);
        if (cast.ok) {
          state.dialogue = { name: member.name, text: member.blurb, color: '#3d7ea6' };
        } else if (cast.reason === 'cooling-down') {
          state.dialogue = { name: member.name, text: member.ability + ' is cooling down — ' + (cast.remaining || 0) + 's left.', color: '#8a8a92' };
        } else if (cast.reason === 'not-enough-rp') {
          state.dialogue = { name: member.name, text: member.ability + ' costs ' + (cast.need || 0) + ' RP. Earn some first.', color: '#8a8a92' };
        } else {
          state.dialogue = { name: member.name, text: member.ability + ' — ' + String(cast.reason || 'not now').replace(/-/g, ' ') + '.', color: '#8a8a92' };
        }
      }
      // T runs the last failed mission back from its first stage.
      if (k === 't' && state.screen === 'playing' && state.lastFailedMission && window.PalmaMissions) {
        var retry = window.PalmaMissions.restartMission(state, state.lastFailedMission, hooks);
        if (retry.ok) state.lastFailedMission = null;
      }
      if (k === 'f5') { /* let the browser reload */ }
      if ((k === 'f9' || k === 'f6') && state.screen === 'playing') saveGame(state, 1);
    });
    window.addEventListener('keyup', function (e) { keys[keyName(e)] = false; });
    canvas.addEventListener('mousemove', function (e) {
      var rect = canvas.getBoundingClientRect();
      mouse.x = e.clientX - rect.left;
      mouse.y = e.clientY - rect.top;
    });
    canvas.addEventListener('mousedown', function (e) {
      if (e.button === 0) {
        mouse.down = true;
        if (state.screen === 'playing' && !state.player.vehicle) {
          state.player.aiming = true;
          var res = window.PalmaPlayer.fireWeapon(state, renderer);
          state.lastShotAt = { x: state.player.x, y: state.player.y, t: state.time };
          if ((res.hit || res.reason === 'miss') && window.PalmaAudio) window.PalmaAudio.gunshot();
          if (res.hit && state.wanted < 2) state.wanted = Math.max(state.wanted, 2);
          else if (!res.hit && res.reason === 'miss' && state.wanted === 0) state.wanted = 1;
          // A takedown during a shoot stage counts toward clearing it.
          // The shot is judged here, at fire time, because the street
          // layer removes the fallen on its next update.
          if (res.hit && res.target && typeof res.target.health === 'number' && res.target.health <= 0) {
            var shootStage = window.PalmaMissions ? window.PalmaMissions.currentStage(state) : null;
            if (shootStage && shootStage.type === 'shoot') state.missionKills = (state.missionKills || 0) + 1;
          }
        }
      }
    });
    window.addEventListener('mouseup', function () {
      mouse.down = false;
      state.player.aiming = false;
    });
    window.addEventListener('resize', function () {
      renderer.resize(canvas.clientWidth || 1280, canvas.clientHeight || 720);
    });

    function step(now) {
      var dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      state.time += dt;

      if (state.screen === 'playing') {
        // Clock: one game minute per real second.
        state.clockMinutes = (state.clockMinutes + dt * CFG.CLOCK.minutesPerSecond) % (24 * 60);
        // Mouse position in world space, for aiming.
        state.mouseWorld = {
          x: state.cam.x + (mouse.x - canvas.width / 2) / state.cam.zoom,
          y: state.cam.y + (mouse.y - canvas.height / 2) / state.cam.zoom
        };
        var p = state.player;
        if (p.vehicle && p.vehicle.kind === 'heli') {
          // Flying the Gull: W/S for speed, A/D to turn, Space to
          // climb, C to sink, Shift to brake. The flight step reads
          // its input from state.heliInput each frame.
          state.heliInput = {
            throttle: (keys['w'] || keys['arrowup'] ? 1 : 0) + (keys['s'] || keys['arrowdown'] ? -1 : 0),
            steer: (keys['d'] || keys['arrowright'] ? 1 : 0) - (keys['a'] || keys['arrowleft'] ? 1 : 0),
            climb: (keys['space'] ? 1 : 0) - (keys['c'] ? 1 : 0),
            brake: !!keys['shift']
          };
          var hev = window.PalmaVehicles.updateHeli(state, dt);
          if (hev.crashed) renderer.addShake(6);
          else if (hev.scraped) renderer.addShake(2);
          p.x = p.vehicle.x; p.y = p.vehicle.y;
          p.angle = p.vehicle.angle;
        } else if (p.vehicle) {
          var input = {
            throttle: (keys['w'] || keys['arrowup'] ? 1 : 0) + (keys['s'] || keys['arrowdown'] ? -1 : 0),
            steer: (keys['d'] || keys['arrowright'] ? 1 : 0) - (keys['a'] || keys['arrowleft'] ? 1 : 0),
            brake: !!keys['space'],
            handbrake: !!keys['shift']
          };
          var ev = window.PalmaVehicles.updateCar(state, city, p.vehicle, input, dt);
          if (ev.crashed) renderer.addShake(6);
          else if (ev.scraped) renderer.addShake(2);
          p.x = p.vehicle.x; p.y = p.vehicle.y;
          p.angle = p.vehicle.angle;
        } else {
          window.PalmaPlayer.updateOnFoot(state, city, {
            up: !!(keys['w'] || keys['arrowup']),
            down: !!(keys['s'] || keys['arrowdown']),
            left: !!(keys['a'] || keys['arrowleft']),
            right: !!(keys['d'] || keys['arrowright']),
            run: !!keys['shift']
          }, dt);
        }
        // Crew cooldowns tick down.
        var c;
        for (c in state.crew) {
          if (state.crew[c].cooldown > 0) state.crew[c].cooldown = Math.max(0, state.crew[c].cooldown - dt);
        }
        // Kip's reveal ends on its own clock, not on the cooldown.
        if (state.crew.kip && state.crew.kip.revealing && state.crew.kip.activeUntil && Date.now() >= state.crew.kip.activeUntil) {
          state.crew.kip.revealing = false;
          state.crew.kip.activeUntil = 0;
        }
        // Wanted cools off slowly when the player stays out of trouble.
        if (state.wanted > 0) {
          state.wantedTimer = (state.wantedTimer || 0) + dt;
          if (state.wantedTimer > 45) { state.wanted--; state.wantedTimer = 0; }
        } else state.wantedTimer = 0;
        // Street life, police response and sound all run through the
        // Block B systems; traffic owns the pedestrians now.
        if (window.PalmaTraffic) window.PalmaTraffic.update(state, city, dt);
        if (window.PalmaPolice) window.PalmaPolice.update(state, city, dt);
        if (window.PalmaAudio) window.PalmaAudio.tick(state, dt);
        missionTick();
        if (state.player.health <= 0) handleDeath();
        state.district = WORLD.districtAt(city, p.x, p.y);
        window.PalmaPlayer.followCamera(state.cam, state, canvas.width, canvas.height, dt);
      }

      var mode = renderer.render(state, city, state.cam, state.time);
      if (window.PalmaHud) window.PalmaHud.draw(state, city, canvas, mode, renderer);
      else drawHud(state, mode);
      if (state.screen === 'title') {
        if (window.PalmaScreens) window.PalmaScreens.drawTitle(canvas.getContext('2d'), state, city, canvas);
        else drawTitle(state);
      }
      if (state.screen === 'paused') {
        if (window.PalmaScreens) window.PalmaScreens.drawPause(canvas.getContext('2d'), state, city, canvas, state.pauseTab || 'map');
        else drawPaused(state);
      }
      if (state.screen === 'playing' && state.banner && state.banner.kind === 'MISSION PASSED' && window.PalmaScreens) {
        window.PalmaScreens.drawMissionPassed(canvas.getContext('2d'), state, canvas, state.banner);
      }
      requestAnimationFrame(step);
    }

    function drawHud(state, mode) {
      var ctx = canvas.getContext('2d');
      var p = state.player;
      ctx.save();
      ctx.font = 'bold 15px system-ui, sans-serif';
      ctx.textBaseline = 'top';
      // Health + armour bars, top left.
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(14, 14, 220, 54);
      ctx.fillStyle = '#e8e8e8';
      ctx.fillText('REY CALDER', 22, 20);
      ctx.fillStyle = '#3a3a3a';
      ctx.fillRect(22, 42, 140, 10);
      ctx.fillStyle = p.health > 30 ? '#4caf50' : '#e84a3a';
      ctx.fillRect(22, 42, 140 * (p.health / 100), 10);
      ctx.fillStyle = '#3a3a3a';
      ctx.fillRect(168, 42, 58, 10);
      ctx.fillStyle = '#7ec3e8';
      ctx.fillRect(168, 42, 58 * (p.armour / 100), 10);
      // Money + wanted, top right.
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      var mw = 190;
      ctx.fillRect(canvas.width - mw - 14, 14, mw, 54);
      ctx.fillStyle = '#ffd166';
      ctx.font = 'bold 20px system-ui, sans-serif';
      ctx.fillText('$' + p.money.toLocaleString('en-US'), canvas.width - mw - 4, 20);
      ctx.font = '15px system-ui, sans-serif';
      ctx.fillStyle = '#ffd166';
      var stars = '';
      for (var s = 0; s < 5; s++) stars += s < state.wanted ? '★' : '☆';
      ctx.fillText(stars, canvas.width - mw - 4, 46);
      // Clock + district + radio, bottom left.
      var hh = Math.floor(state.clockMinutes / 60);
      var mm = Math.floor(state.clockMinutes % 60);
      var clock = (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(14, canvas.height - 64, 330, 50);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 16px system-ui, sans-serif';
      ctx.fillText(clock + '  ·  ' + (state.district ? state.district.name.toUpperCase() : 'PALMA VERDE'), 22, canvas.height - 58);
      ctx.font = '13px system-ui, sans-serif';
      ctx.fillStyle = '#ffd166';
      var station = CFG.RADIO[state.radioStation];
      ctx.fillText(station.name + ' — ' + station.tracks[0], 22, canvas.height - 34);
      // Vehicle readout while driving or flying, bottom right. A
      // heli carries no car model, so the label and the second line
      // switch on kind instead of reading vehicle.model.
      if (p.vehicle) {
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(canvas.width - 234, canvas.height - 64, 220, 50);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 16px system-ui, sans-serif';
        var flying = p.vehicle.kind === 'heli';
        var rideName = flying ? 'The Gull' : p.vehicle.model.name;
        ctx.fillText(rideName, canvas.width - 226, canvas.height - 58);
        ctx.font = '13px system-ui, sans-serif';
        ctx.fillStyle = '#ffd166';
        var cond = window.PalmaVehicles.condition(p.vehicle);
        var rideLine = flying
          ? 'ALT ' + window.PalmaVehicles.gullAltitude(p.vehicle) + ' m  ·  ' + cond + '%'
          : Math.round(Math.abs(p.vehicle.speed) * 2.2) + ' km/h  ·  ' + cond + '%';
        ctx.fillText(rideLine, canvas.width - 226, canvas.height - 34);
      }
      // Small minimap: real street geometry, district dots, player arrow.
      var ms = 150, mx = canvas.width - ms - 14, my = 84;
      ctx.fillStyle = 'rgba(10,20,16,0.72)';
      ctx.fillRect(mx, my, ms, ms * (city.height / city.width));
      var mh = ms * (city.height / city.width);
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 1;
      var i, a, b;
      for (i = 0; i < city.avenues.length; i++) {
        a = mx + (city.avenues[i] / city.width) * ms;
        ctx.beginPath(); ctx.moveTo(a, my); ctx.lineTo(a, my + mh); ctx.stroke();
      }
      for (i = 0; i < city.streets.length; i++) {
        b = my + (city.streets[i] / city.height) * mh;
        ctx.beginPath(); ctx.moveTo(mx, b); ctx.lineTo(mx + ms, b); ctx.stroke();
      }
      ctx.fillStyle = '#ffd166';
      ctx.beginPath();
      ctx.arc(mx + (p.x / city.width) * ms, my + (p.y / city.height) * mh, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    function drawTitle(state) {
      var ctx = canvas.getContext('2d');
      ctx.save();
      ctx.fillStyle = 'rgba(10,16,30,0.62)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#ffd166';
      ctx.font = 'bold 64px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('PALMA VERDE', canvas.width / 2, canvas.height * 0.30);
      ctx.fillStyle = '#fff';
      ctx.font = '20px system-ui, sans-serif';
      ctx.fillText('Rey Calder owes Nadia Venn $2,000. The city is open.', canvas.width / 2, canvas.height * 0.30 + 52);
      ctx.font = 'bold 18px system-ui, sans-serif';
      ctx.fillText('Press ENTER to start  ·  WASD drive / walk  ·  E enter car / start mission  ·  Mouse aim, click fire  ·  R reload  ·  Q radio  ·  Z/X/V crew', canvas.width / 2, canvas.height * 0.30 + 96);
      ctx.restore();
    }

    function drawPaused(state) {
      var ctx = canvas.getContext('2d');
      ctx.save();
      ctx.fillStyle = 'rgba(10,16,30,0.55)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 40px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('PAUSED', canvas.width / 2, canvas.height * 0.4);
      ctx.font = '17px system-ui, sans-serif';
      ctx.fillText('Rank: ' + rankName(state) + '  ·  RP ' + state.rp + '  ·  Completion ' + state.completion + '%  ·  F9 save', canvas.width / 2, canvas.height * 0.4 + 52);
      ctx.restore();
    }

    requestAnimationFrame(step);
    return { state: state, city: city, saveGame: saveGame, loadGame: loadGame, applySave: applySave };
  }

  window.PalmaMain = {
    startGame: startGame, freshState: freshState,
    saveGame: saveGame, loadGame: loadGame, applySave: applySave,
    rankName: rankName
  };
})();
