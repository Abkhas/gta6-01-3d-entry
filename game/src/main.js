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
// This file owns the loop and the state object only. It never imports
// missions.js, crew.js, progress.js or garage.js — those builders read
// and write these same fields, and the loop only ever reads the state.

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
      time: 0
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
      if (k === 'enter' && state.screen === 'title') state.screen = 'playing';
      if (k === 'escape' || k === 'p') {
        if (state.screen === 'playing') state.screen = 'paused';
        else if (state.screen === 'paused') state.screen = 'playing';
      }
      if (k === 'e' && state.screen === 'playing') {
        if (state.player.vehicle) window.PalmaPlayer.exitVehicle(state, city);
        else window.PalmaPlayer.enterVehicle(state, city);
      }
      if (k === 'r' && state.screen === 'playing') window.PalmaPlayer.reloadWeapon(state);
      if (k === 'q' && state.screen === 'playing') {
        state.radioStation = (state.radioStation + 1) % CFG.RADIO.length;
        if (window.PalmaAudio) window.PalmaAudio.jingle();
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
        if (p.vehicle) {
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
        state.district = WORLD.districtAt(city, p.x, p.y);
        window.PalmaPlayer.followCamera(state.cam, state, canvas.width, canvas.height, dt);
      }

      var mode = renderer.render(state, city, state.cam, state.time);
      if (window.PalmaHud) window.PalmaHud.draw(state, city, canvas, mode, renderer);
      else drawHud(state, mode);
      if (state.screen === 'title') drawTitle(state);
      if (state.screen === 'paused') drawPaused(state);
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
      // Car readout while driving, bottom right.
      if (p.vehicle) {
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(canvas.width - 234, canvas.height - 64, 220, 50);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 16px system-ui, sans-serif';
        ctx.fillText(p.vehicle.model.name, canvas.width - 226, canvas.height - 58);
        ctx.font = '13px system-ui, sans-serif';
        ctx.fillStyle = '#ffd166';
        ctx.fillText(Math.round(Math.abs(p.vehicle.speed) * 2.2) + ' km/h  ·  ' + window.PalmaVehicles.condition(p.vehicle) + '%', canvas.width - 226, canvas.height - 34);
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
      ctx.fillText('Press ENTER to start  ·  WASD drive / walk  ·  E enter car  ·  Mouse aim, click fire  ·  R reload  ·  Q radio', canvas.width / 2, canvas.height * 0.30 + 96);
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
