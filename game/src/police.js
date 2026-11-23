// Palma Verde — wanted level, PVPD response, dispatch board, AIR-1.
//
// Stars on the HUD are only half the system: behind them sits the
// dispatch board — named units, a tactic each, a live distance — and
// the cruisers, bikes, foot officers and the helicopter that actually
// come for Rey. Firing a weapon in public raises the heat within
// seconds, and the heat keeps rising while Rey keeps shooting. Units
// are dispatched in a stagger, never all at once, and they DRIVE to
// the scene from roads a few blocks away — they never appear on top
// of him. Once on scene they pursue with a named tactic each (PIT,
// RAMMING, FLANKING, ROADBLOCK, SPOTLIGHT), and when every unit loses
// line of sight they fall back to SEARCHING the last place Rey was
// seen. Escape means breaking sight AND distance, not outrunning a
// timer: stars blink out one at a time only while nobody can see him
// and the nearest unit is far away. Get caught on foot and it is
// BUSTED — the mission fails, the PVPD takes a fine, and the heat
// clears. One star is a foot officer and a patrol car; five stars is
// the whole department plus the helicopter overhead.

(function () {
  'use strict';

  var WORLD = window.PalmaWorld;
  var VEH = window.PalmaVehicles;
  var CFG = window.PalmaConfig;

  var CALLS = CFG.CALLSIGNS;
  var TACTIC_CYCLE = ['PIT', 'RAMMING', 'ROADBLOCK', 'FLANKING', 'PIT', 'PURSUIT'];
  var MAX_UNITS = 5;
  var MAX_GROUND = 9;
  var HELI_STARS = 3;
  var HELI_ORBIT = 190;

  // How the chase behaves, in seconds and world units.
  var DISPATCH_FIRST = 0.5;   // first unit rolls within half a second of the call
  var DISPATCH_GAP = 0.9;     // then one more unit every ~second
  var HELI_DELAY = 4;         // AIR-1 lifts off a few seconds after 3 stars
  var SIGHT_CAR = 520;        // how far a cruiser or bike can spot Rey
  var SIGHT_FOOT = 430;       // how far a foot officer can spot Rey
  var SIGHT_HELI = 560;       // how far AIR-1 can spot Rey
  var SEARCH_DELAY = 2;       // unseen this long and the hunt becomes a search
  var ESCAPE_UNSEEN = 8;      // unseen this long, far away, and a star blinks out
  var ESCAPE_DIST = 320;      // nearest unit must be further than this to escape
  var ESCALATE_SHOTS = 4;     // shots fired since the last rise
  var ESCALATE_GAP = 5;       // seconds between wanted rises
  var BUST_DIST = 30;         // a foot officer this close can make the arrest
  var BUST_HOLD = 1.2;        // seconds the officer must stay that close
  var FOOT_SPEED = 250;       // an officer runs at Rey's run speed

  function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
  }

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

  // The whole chase lives under state.police. Additive fields only:
  // nothing here renames or removes a field another file reads.
  //   units      the live units (cruisers, bikes, foot officers)
  //   heli       the AIR-1 helicopter, or null
  //   queue      specs waiting to be dispatched, staggered over seconds
  //   heat       gunfire bookkeeping for escalation
  //   pendingWanted  a star level scheduled a moment from now
  //   lastSeen   where Rey was last seen by any unit { x, y, t }
  //   unseenT    seconds since any unit last saw Rey
  //   searching  true while every unit has lost sight of Rey
  //   heliAt     game time when AIR-1 is due, or 0
  //   busted     the last bust { at, fine, mission }, or null
  //   spawnSeq   running counter so call-signs stay unique
  function policeState(state) {
    if (!state.police) {
      state.police = {
        units: [], heli: null, goneT: 0,
        queue: [],
        heat: { shots: 0, lastShotT: 0, shotsSinceEsc: 0, lastEscT: -99, shotPolice: false },
        pendingWanted: null,
        lastSeen: null, unseenT: 0, searching: false,
        heliAt: 0, busted: null, spawnSeq: 0
      };
    }
    return state.police;
  }

  // What the heat buys, by star level. One star is a foot officer and
  // a patrol car; two stars add a second car and a bike; three stars
  // add a roadblock and AIR-1; four and five stars stack more of
  // everything. A spec is { kind, role, tactic }.
  function desiredComposition(wanted) {
    var comp = [];
    if (wanted <= 0) return comp;
    comp.push({ kind: 'foot', role: 'foot', tactic: 'PURSUIT' });
    comp.push({ kind: 'cruiser', role: 'chase', tactic: 'PURSUIT' });
    if (wanted >= 2) {
      comp.push({ kind: 'cruiser', role: 'chase', tactic: 'RAMMING' });
      comp.push({ kind: 'bike', role: 'flank', tactic: 'FLANKING' });
    }
    if (wanted >= 3) {
      comp.push({ kind: 'cruiser', role: 'chase', tactic: 'PIT' });
      comp.push({ kind: 'cruiser', role: 'roadblock', tactic: 'ROADBLOCK' });
    }
    if (wanted >= 4) {
      comp.push({ kind: 'bike', role: 'chase', tactic: 'PIT' });
    }
    if (wanted >= 5) {
      comp.push({ kind: 'foot', role: 'foot', tactic: 'PURSUIT' });
      comp.push({ kind: 'cruiser', role: 'roadblock', tactic: 'ROADBLOCK' });
    }
    return comp.slice(0, MAX_GROUND);
  }

  function cruisersFor(wanted) {
    var comp = desiredComposition(wanted);
    var n = 0;
    for (var i = 0; i < comp.length; i++) {
      if (comp[i].kind === 'cruiser') n++;
    }
    return clamp(n, 0, MAX_UNITS);
  }

  function callsignFor(state, city, idx) {
    var pol = state.police;
    var n = pol ? (pol.spawnSeq++) : idx;
    return CALLS[(idx + (city.seed % CALLS.length)) % CALLS.length] + '-' + (n + 1);
  }

  // A road spot a few blocks from Rey, never on top of him: the
  // dispatch rule every spawn below obeys.
  function sceneSpot(state, city, rng, minD, maxD) {
    var p = state.player;
    var spot = null;
    for (var tries = 0; tries < 12; tries++) {
      var s = WORLD.randomRoadSpot(city, rng);
      var d = dist(s.x, s.y, p.x, p.y);
      if (d > minD && d < maxD) { spot = s; break; }
      spot = s;
    }
    return spot;
  }

  // A cruiser spawns on a road a few blocks from Rey, never on top of
  // him, with a fresh call-sign and the tactic its spec asks for.
  function spawnCruiser(state, city, idx, spec) {
    var rng = WORLD.makeRng((city.seed + 101 + idx * 17 + (state.time * 7 | 0)) >>> 0);
    var spot = sceneSpot(state, city, rng, 180, 900);
    var car = VEH.makeCar('halcon', spot.x, spot.y, spot.angle, { police: true, color: '#23262f' });
    car.policeUnit = true;
    var unit = {
      kind: 'cruiser', car: car,
      callsign: callsignFor(state, city, idx),
      tactic: (spec && spec.tactic) || TACTIC_CYCLE[idx % TACTIC_CYCLE.length],
      role: (spec && spec.role) || 'chase',
      side: idx % 2 === 0 ? 1 : -1,
      searching: false, leaving: false, leaveT: 0,
      ramT: 0, bustT: 0, bornT: state.time || 0,
      searchPhase: idx * 1.7, parkedT: 0
    };
    (state.cars = state.cars || []).push(car);
    return unit;
  }

  // A PVPD interceptor bike: a light, fast machine, not a car. It is
  // built on the small hatch model with a bike-tuned copy of the
  // model table (faster top end, sharper acceleration) and flagged
  // car.bike so the renderer can draw a two-wheeler instead of a car.
  function spawnBike(state, city, idx, spec) {
    var rng = WORLD.makeRng((city.seed + 211 + idx * 29 + (state.time * 7 | 0)) >>> 0);
    var spot = sceneSpot(state, city, rng, 200, 800);
    var car = VEH.makeCar('brisa', spot.x, spot.y, spot.angle, { police: true, color: '#23262f' });
    var tuned = {};
    for (var k in car.model) tuned[k] = car.model[k];
    tuned.top = 172;
    tuned.accel = 0.34;
    tuned.name = 'PVPD Interceptor';
    car.model = tuned;
    car.bike = true;
    car.policeUnit = true;
    var unit = {
      kind: 'bike', car: car,
      callsign: callsignFor(state, city, idx),
      tactic: (spec && spec.tactic) || 'FLANKING',
      role: (spec && spec.role) || 'flank',
      side: idx % 2 === 0 ? 1 : -1,
      searching: false, leaving: false, leaveT: 0,
      ramT: 0, bustT: 0, bornT: state.time || 0,
      searchPhase: idx * 1.7, parkedT: 0
    };
    (state.cars = state.cars || []).push(car);
    return unit;
  }

  // A foot officer: a pedestrian in PVPD dark, driven by this file,
  // not by the traffic system. base 0 keeps the traffic walker from
  // moving him — police.update below does all of his walking. His
  // unit.car aliases the ped itself, so every existing reader of
  // unit.car (traffic's threat check, the dispatch board) keeps
  // working on a foot unit without a null check.
  function spawnFoot(state, city, idx, spec) {
    var rng = WORLD.makeRng((city.seed + 307 + idx * 23 + (state.time * 7 | 0)) >>> 0);
    var spot = sceneSpot(state, city, rng, 150, 500);
    var side = rng() < 0.5 ? -1 : 1;
    var ped = {
      x: spot.x + side * 26, y: spot.y + (rng() - 0.5) * 40,
      angle: rng() * Math.PI * 2, speed: 0, base: 0,
      color: '#e8b48f', shirt: '#23262f',
      health: 100, mode: 'walk', fleeT: 0, anchor: null,
      police: true, officer: true
    };
    (state.peds = state.peds || []).push(ped);
    var unit = {
      kind: 'foot', ped: ped, car: ped,
      callsign: callsignFor(state, city, idx),
      tactic: (spec && spec.tactic) || 'PURSUIT',
      role: 'foot',
      searching: false, leaving: false, leaveT: 0,
      ramT: 0, bustT: 0, bornT: state.time || 0,
      searchPhase: idx * 1.7, parkedT: 0
    };
    return unit;
  }

  function spawnUnit(state, city, spec, idx) {
    if (spec.kind === 'bike') return spawnBike(state, city, idx, spec);
    if (spec.kind === 'foot') return spawnFoot(state, city, idx, spec);
    return spawnCruiser(state, city, idx, spec);
  }

  function spawnHeli(state) {
    return {
      x: state.player.x + 140, y: state.player.y - 130,
      alt: 130, orbit: 0.7, angle: 0
    };
  }

  function headingOf(state) {
    var p = state.player;
    if (p.vehicle) return p.vehicle.angle;
    return p.angle;
  }

  // Line of sight from a unit to Rey: close enough, and no building
  // on the segment between them. Buildings are the only thing that
  // blocks sight — palms and props do not. Sampled every 45 world
  // units, so a check costs a dozen point tests at most.
  function hasLineOfSight(state, city, ux, uy, range) {
    var p = state.player;
    var d = dist(ux, uy, p.x, p.y);
    if (d > range) return false;
    if (!city || !WORLD.isSolid) return true;
    var steps = Math.max(1, Math.ceil(d / 45));
    for (var i = 1; i < steps; i++) {
      var t = i / steps;
      var x = ux + (p.x - ux) * t;
      var y = uy + (p.y - uy) * t;
      if (WORLD.isSolid(city, x, y)) return false;
    }
    return true;
  }

  function unitPos(unit) {
    return unit.car || unit.ped || { x: 0, y: 0 };
  }

  function unitSees(state, city, unit) {
    var pos = unitPos(unit);
    if (unit.kind === 'foot') return hasLineOfSight(state, city, pos.x, pos.y, SIGHT_FOOT);
    return hasLineOfSight(state, city, pos.x, pos.y, SIGHT_CAR);
  }

  // One cruiser or bike, one frame of driving. Chasers aim at Rey,
  // flankers aim at a point off his shoulder, PIT units pull alongside
  // and steer into his rear quarter, and the roadblock car races ahead
  // of him and parks sideways across the street. A leaving unit drives
  // away from Rey until it can be stood down; a searching unit sweeps
  // the last place Rey was seen instead of chasing him.
  function driveCruiser(state, city, unit, dt) {
    var car = unit.car;
    var p = state.player;
    var tx, ty;
    if (unit.leaving) {
      var away = Math.atan2(car.y - p.y, car.x - p.x);
      tx = car.x + Math.cos(away) * 300;
      ty = car.y + Math.sin(away) * 300;
    } else if (unit.searching && state.police.lastSeen) {
      var ls = state.police.lastSeen;
      var ph = (state.time || 0) * 0.35 + unit.searchPhase;
      tx = ls.x + Math.cos(ph) * 150;
      ty = ls.y + Math.sin(ph) * 150;
    } else if (unit.role === 'roadblock') {
      var head = headingOf(state);
      tx = p.x + Math.cos(head) * 280;
      ty = p.y + Math.sin(head) * 280;
      var snap = WORLD.nearestRoadPoint(city, tx, ty);
      tx = snap.x;
      ty = snap.y;
      if (dist(car.x, car.y, tx, ty) < 70) {
        unit.parkedT += dt;
        var road = WORLD.roadAt(city, car.x, car.y);
        var want = road && road.axis === 'x' ? 0 : Math.PI / 2;
        car.angle += angDiff(car.angle, want) * Math.min(1, 3 * dt);
        VEH.updateCar(state, city, car, { throttle: 0, steer: 0, brake: true, handbrake: false }, dt);
        // A roadblock holds its ground, then rejoins the chase once
        // Rey has slipped past it or it has sat too long.
        if (unit.parkedT > 25 || dist(car.x, car.y, p.x, p.y) > 500) {
          unit.role = 'chase';
          unit.parkedT = 0;
        }
        return;
      }
      unit.parkedT = 0;
    } else if (unit.role === 'flank') {
      var side = headingOf(state) + Math.PI / 2 * unit.side;
      tx = p.x + Math.cos(side) * 170;
      ty = p.y + Math.sin(side) * 170;
    } else if (unit.tactic === 'PIT') {
      var fwd = headingOf(state);
      var ps = fwd + Math.PI / 2 * unit.side;
      var dPlayer = dist(car.x, car.y, p.x, p.y);
      if (dPlayer < 75) {
        // Alongside: steer into his rear quarter to spin him.
        tx = p.x - Math.cos(fwd) * 30 + Math.cos(ps) * 20;
        ty = p.y - Math.sin(fwd) * 30 + Math.sin(ps) * 20;
      } else {
        tx = p.x + Math.cos(fwd) * 55 + Math.cos(ps) * 40;
        ty = p.y + Math.sin(fwd) * 55 + Math.sin(ps) * 40;
      }
    } else {
      tx = p.x;
      ty = p.y;
    }
    var wantAngle = Math.atan2(ty - car.y, tx - car.x);
    var diff = angDiff(car.angle, wantAngle);
    var steer = clamp(diff * 1.6, -1, 1);
    var throttle = Math.abs(diff) > 1.4 ? 0.25 : 1;
    if (unit.tactic === 'RAMMING' || unit.tactic === 'PIT') throttle = 1;
    var dP = dist(car.x, car.y, p.x, p.y);
    if (dP < 55 && !unit.leaving) throttle = 0.35;
    VEH.updateCar(state, city, car, {
      throttle: throttle, steer: steer, brake: false, handbrake: false
    }, dt);
  }

  // One foot officer, one frame. He runs at Rey on foot, walks the
  // last-seen point while searching, and drifts off when stood down.
  // Close on Rey while Rey is on foot and the arrest clock runs: hold
  // him for BUST_HOLD seconds and Rey is BUSTED.
  function driveFoot(state, city, unit, dt) {
    var ped = unit.ped;
    var p = state.player;
    var tx, ty;
    if (unit.leaving) {
      var away = Math.atan2(ped.y - p.y, ped.x - p.x);
      tx = ped.x + Math.cos(away) * 200;
      ty = ped.y + Math.sin(away) * 200;
    } else if (unit.searching && state.police.lastSeen) {
      var ls = state.police.lastSeen;
      var ph = (state.time || 0) * 0.3 + unit.searchPhase;
      tx = ls.x + Math.cos(ph) * 110;
      ty = ls.y + Math.sin(ph) * 110;
    } else {
      tx = p.x;
      ty = p.y;
    }
    var d = dist(ped.x, ped.y, tx, ty);
    if (d > 4) {
      var a = Math.atan2(ty - ped.y, tx - ped.x);
      ped.angle = a;
      var nx = ped.x + Math.cos(a) * FOOT_SPEED * dt;
      var ny = ped.y + Math.sin(a) * FOOT_SPEED * dt;
      if (!WORLD.isSolid(city, nx, ped.y)) ped.x = nx;
      if (!WORLD.isSolid(city, ped.x, ny)) ped.y = ny;
    }
    // The arrest: a foot officer on top of Rey, while Rey is on foot.
    if (!unit.leaving && !p.vehicle) {
      var dp = dist(ped.x, ped.y, p.x, p.y);
      if (dp < BUST_DIST) {
        unit.bustT += dt;
        if (unit.bustT > BUST_HOLD) applyBusted(state);
      } else {
        unit.bustT = 0;
      }
    } else {
      unit.bustT = 0;
    }
  }

  // BUSTED: the mission fails, the PVPD takes a fine, the heat
  // clears and every unit stands down. Weapons are NOT stripped —
  // the shoot stages need them — the cost is the fine plus the
  // failed mission. state.lastFailedMission is set so T runs it back.
  function applyBusted(state) {
    var pol = policeState(state);
    if (pol.busted && state.time - pol.busted.at < 3) return;
    var fine = Math.min(1500, 100 + 200 * (state.wanted || 0));
    state.player.money = Math.max(0, (state.player.money || 0) - fine);
    var missionId = state.missions ? state.missions.current : null;
    pol.busted = { at: state.time || 0, fine: fine, mission: missionId };
    state.wanted = 0;
    state.lastFailedMission = missionId || state.lastFailedMission || null;
    if (window.PalmaPlayer) {
      window.PalmaPlayer.setAiming(state, false);
    }
    state.firing = false;
    if (missionId && window.PalmaMissions) {
      window.PalmaMissions.failMission(state, 'busted');
    }
    state.dialogue = {
      name: 'PVPD',
      text: 'BUSTED — the PVPD took $' + fine + ' and the job fell apart. Press T to run it back.',
      color: '#2e6bff'
    };
    pol.queue = [];
    pol.heli = null;
    pol.heliAt = 0;
    pol.searching = false;
    pol.unseenT = 0;
    for (var i = 0; i < pol.units.length; i++) {
      pol.units[i].leaving = true;
      pol.units[i].leaveT = 0;
    }
  }

  function updateHeli(state, dt) {
    var heli = state.police.heli;
    if (!heli) return;
    var p = state.player;
    heli.orbit += dt * 0.4;
    var tx = p.x + Math.cos(heli.orbit) * HELI_ORBIT;
    var ty = p.y + Math.sin(heli.orbit) * HELI_ORBIT;
    heli.x += (tx - heli.x) * Math.min(1, 1.5 * dt);
    heli.y += (ty - heli.y) * Math.min(1, 1.5 * dt);
    heli.angle = heli.orbit + Math.PI / 2;
  }

  // Contact: a RAMMING or PIT unit that reaches Rey's car bends it —
  // damage plus a speed cut, and a small nudge on a PIT hit. A unit
  // that reaches Rey on foot knocks him down a little instead. One
  // hit per unit per second, so a pile-up does not insta-kill him.
  function contactHits(state, dt) {
    var pol = state.police;
    var p = state.player;
    for (var i = 0; i < pol.units.length; i++) {
      var u = pol.units[i];
      if (u.kind === 'foot' || u.leaving) continue;
      u.ramT = Math.max(0, (u.ramT || 0) - dt);
      if (u.ramT > 0) continue;
      var pos = unitPos(u);
      var d = dist(pos.x, pos.y, p.x, p.y);
      if (d > 48) continue;
      u.ramT = 1;
      if (p.vehicle && p.vehicle.kind !== 'heli') {
        p.vehicle.damage = Math.min(100, (p.vehicle.damage || 0) + (u.tactic === 'PIT' ? 4 : 5));
        p.vehicle.speed = (p.vehicle.speed || 0) * (u.tactic === 'PIT' ? 0.7 : 0.55);
        if (u.tactic === 'PIT') p.vehicle.angle += u.side * 0.12;
      } else if (!p.vehicle && window.PalmaPlayer) {
        window.PalmaPlayer.takeDamage(state, 6);
      }
    }
  }

  // The dispatch board the HUD draws: one row per unit on the street,
  // call-sign + tactic + live distance in metres, plus the AIR-1 row
  // while the helicopter is up. One world unit reads as half a metre.
  // Shape is stable for hud.js: { callsign, tactic, distM, kind }.
  // While searching, every ground unit shows SEARCHING instead of its
  // pursuit tactic; kind is 'cruiser', 'bike', 'foot' or 'heli'.
  function dispatchRows(state) {
    var pol = state.police;
    if (!pol) return [];
    var rows = [];
    var p = state.player;
    for (var i = 0; i < pol.units.length; i++) {
      var u = pol.units[i];
      if (u.leaving) continue;
      var pos = unitPos(u);
      rows.push({
        callsign: u.callsign,
        tactic: u.searching ? 'SEARCHING' : u.tactic,
        distM: Math.round(dist(pos.x, pos.y, p.x, p.y) / 2),
        kind: u.kind || 'cruiser'
      });
    }
    if (pol.heli) {
      rows.push({
        callsign: 'AIR-1',
        tactic: 'SPOTLIGHT',
        distM: Math.round(dist(pol.heli.x, pol.heli.y, p.x, p.y) / 2),
        kind: 'heli'
      });
    }
    return rows;
  }

  // Gunfire heard: bookkeeping for escalation, plus the star itself
  // when nothing else raised it yet (drive-by fire never passes
  // through the main loop's wanted bump). Firing on a police unit
  // escalates the heat faster. Called from player.js fireWeapon, so
  // every shot — on foot or drive-by — is heard.
  function reportGunfire(state, result) {
    var pol = policeState(state);
    var heat = pol.heat;
    var t = state.time || 0;
    heat.shots++;
    heat.shotsSinceEsc++;
    heat.lastShotT = t;
    if (result && result.target && (result.target.police || result.target.officer)) {
      heat.shotPolice = true;
    }
    if ((state.wanted || 0) === 0 && !pol.pendingWanted) {
      pol.pendingWanted = { level: 1, at: t + 0.8 };
    }
    if (!pol.lastSeen) pol.lastSeen = { x: state.player.x, y: state.player.y, t: t };
  }

  // A crime the street saw, by kind: 'gunfire', 'assault' (a melee
  // hit on someone), 'ram-police'. Gunfire and assault raise a star
  // within about a second; ramming a police unit escalates at once.
  function reportCrime(state, kind) {
    var pol = policeState(state);
    var t = state.time || 0;
    if (kind === 'ram-police') {
      pol.heat.shotPolice = true;
      return;
    }
    if ((state.wanted || 0) === 0 && !pol.pendingWanted) {
      pol.pendingWanted = { level: 1, at: t + (kind === 'assault' ? 1.0 : 0.8) };
    }
    if (!pol.lastSeen) pol.lastSeen = { x: state.player.x, y: state.player.y, t: t };
  }

  // Stand a unit down: take its car off the street, or its officer
  // off the sidewalk, so nothing lingers after the heat clears.
  function removeUnit(state, unit) {
    if (unit.kind === 'foot' && unit.ped) {
      var pi = (state.peds || []).indexOf(unit.ped);
      if (pi >= 0) state.peds.splice(pi, 1);
    } else if (unit.car) {
      var ci = (state.cars || []).indexOf(unit.car);
      if (ci >= 0) state.cars.splice(ci, 1);
    }
  }

  // Raise the heat to a given star level right now: the full
  // composition for that level appears on the roads around Rey and
  // the helicopter comes in at three stars. Staging uses this to set
  // up the chase frame deterministically — no stagger, everything at
  // once, and the search/heat bookkeeping reset.
  function stageChase(state, city, stars) {
    state.wanted = stars;
    var pol = policeState(state);
    for (var i = 0; i < pol.units.length; i++) removeUnit(state, pol.units[i]);
    pol.units = [];
    pol.queue = [];
    pol.heat = { shots: 0, lastShotT: 0, shotsSinceEsc: 0, lastEscT: -99, shotPolice: false };
    pol.pendingWanted = null;
    pol.lastSeen = { x: state.player.x, y: state.player.y, t: state.time || 0 };
    pol.unseenT = 0;
    pol.searching = false;
    pol.busted = null;
    var comp = desiredComposition(stars);
    for (var k = 0; k < comp.length; k++) pol.units.push(spawnUnit(state, city, comp[k], k));
    if (stars >= HELI_STARS) {
      pol.heli = spawnHeli(state);
      pol.heli.x = state.player.x + 140;
      pol.heli.y = state.player.y - 130;
    } else {
      pol.heli = null;
    }
    pol.heliAt = 0;
    return pol;
  }

  // The helicopter and its spotlight cone, drawn over the world after
  // the renderer finishes, before the HUD panels go on top. AIR-1
  // wears the same drawn body as the player's Gull — the renderer's
  // drawHeli, in police dark — so the two helicopters read as the
  // same machine in different hands. The cone is anchored at the
  // lifted body, not at the ground point, so cone and body meet.
  function drawOverlay(state, city, canvas, renderer, mode) {
    var pol = state.police;
    if (!pol || !pol.heli || !renderer || !renderer.drawHeli) return;
    var ctx = canvas.getContext('2d');
    var heli = pol.heli;
    // drawHeli lifts its body by altitude * 2.4 * zoom. AIR-1 flies
    // at one fixed show height, so the cone apex and the body agree.
    var showAlt = 16;
    var lift = showAlt * 2.4 * state.cam.zoom;
    var hp = renderer.project(state.cam, heli.x, heli.y);
    var top = { x: hp.x, y: hp.y - lift };
    var pp = renderer.project(state.cam, state.player.x, state.player.y);
    var g = ctx.createLinearGradient(top.x, top.y, pp.x, pp.y);
    g.addColorStop(0, 'rgba(255,240,180,0.30)');
    g.addColorStop(1, 'rgba(255,240,180,0.08)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(top.x - 10, top.y);
    ctx.lineTo(top.x + 10, top.y);
    ctx.lineTo(pp.x + 46, pp.y + 30);
    ctx.lineTo(pp.x - 46, pp.y + 30);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,240,180,0.20)';
    ctx.beginPath();
    ctx.ellipse(pp.x, pp.y + 10, 52, 26, 0, 0, Math.PI * 2);
    ctx.fill();
    renderer.drawHeli(state.cam, {
      x: heli.x, y: heli.y, altitude: showAlt,
      angle: heli.angle, rotor: (state.time || 0) * 9, color: '#23262f'
    }, mode || 'golden');
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('AIR-1', top.x, top.y - 16);
    ctx.textAlign = 'left';
  }

  function update(state, city, dt) {
    var pol = policeState(state);
    var t = state.time || 0;
    var wanted = state.wanted || 0;

    // A star scheduled by a crime lands a moment after the shot.
    if (pol.pendingWanted && t >= pol.pendingWanted.at) {
      state.wanted = Math.max(state.wanted || 0, pol.pendingWanted.level);
      wanted = state.wanted;
      pol.pendingWanted = null;
    }

    // Reconcile the street with the heat: missing units are queued
    // with a stagger (first inside a second, then one a second), and
    // surplus units — after a star blinks out — are stood down.
    if (wanted > 0) {
      var desired = desiredComposition(wanted);
      var have = {};
      for (var i = 0; i < pol.units.length; i++) {
        var u = pol.units[i];
        if (u.leaving) continue;
        var key = u.kind + ':' + u.role + ':' + u.tactic;
        have[key] = (have[key] || 0) + 1;
      }
      var queued = {};
      for (var q = 0; q < pol.queue.length; q++) {
        var qk = pol.queue[q].spec.kind + ':' + pol.queue[q].spec.role + ':' + pol.queue[q].spec.tactic;
        queued[qk] = (queued[qk] || 0) + 1;
      }
      var delay = DISPATCH_FIRST;
      for (var d = 0; d < desired.length; d++) {
        var dk = desired[d].kind + ':' + desired[d].role + ':' + desired[d].tactic;
        var need = 1 - (have[dk] || 0) - (queued[dk] || 0);
        if (need > 0) {
          pol.queue.push({ spec: desired[d], at: t + delay });
          delay += DISPATCH_GAP;
        }
      }
      // Surplus: mark the oldest extra unit of each over-full kind
      // leaving, so the street shrinks instead of teleporting away.
      var counts = {};
      for (var s = 0; s < pol.units.length; s++) {
        var su = pol.units[s];
        if (su.leaving) continue;
        var sk = su.kind + ':' + su.role + ':' + su.tactic;
        counts[sk] = (counts[sk] || 0) + 1;
        var want = 0;
        for (var w = 0; w < desired.length; w++) {
          if (desired[w].kind + ':' + desired[w].role + ':' + desired[w].tactic === sk) want++;
        }
        if (counts[sk] > want) { su.leaving = true; su.leaveT = 0; }
      }
    } else {
      for (var z = 0; z < pol.units.length; z++) {
        if (!pol.units[z].leaving) { pol.units[z].leaving = true; pol.units[z].leaveT = 0; }
      }
      pol.queue = [];
      pol.heliAt = 0;
    }

    // The dispatch queue: a due spec becomes a unit on the road.
    for (var qi = pol.queue.length - 1; qi >= 0; qi--) {
      if (t >= pol.queue[qi].at) {
        var spec = pol.queue.splice(qi, 1)[0].spec;
        pol.units.push(spawnUnit(state, city, spec, pol.units.length));
      }
    }

    // AIR-1 lifts off a few seconds after the third star, and leaves
    // the moment the heat drops back below it.
    if (wanted >= HELI_STARS && !pol.heli) {
      if (!pol.heliAt) pol.heliAt = t + HELI_DELAY;
      else if (t >= pol.heliAt) { pol.heli = spawnHeli(state); pol.heliAt = 0; }
    }
    if (wanted < HELI_STARS) { pol.heli = null; pol.heliAt = 0; }

    // Drive every unit, and prune the dead: a downed officer leaves
    // the street, a wrecked cruiser is stood down.
    for (var ui = pol.units.length - 1; ui >= 0; ui--) {
      var unit = pol.units[ui];
      if (unit.kind === 'foot' && unit.ped && unit.ped.health <= 0) {
        removeUnit(state, unit);
        pol.units.splice(ui, 1);
        continue;
      }
      if (unit.kind !== 'foot' && unit.car && unit.car.damage >= 100 && !unit.leaving) {
        unit.leaving = true;
        unit.leaveT = 0;
      }
      if (unit.kind === 'foot') driveFoot(state, city, unit, dt);
      else driveCruiser(state, city, unit, dt);
      if (unit.leaving) {
        unit.leaveT += dt;
        var upos = unitPos(unit);
        if (dist(upos.x, upos.y, state.player.x, state.player.y) > 900 || unit.leaveT > 8) {
          removeUnit(state, unit);
          pol.units.splice(ui, 1);
        }
      }
    }
    updateHeli(state, dt);
    contactHits(state, dt);

    // Sight: any unit (or AIR-1) with eyes on Rey refreshes the last
    // seen point. Nobody seeing him starts the search clock.
    var anySee = false;
    if (pol.heli && hasLineOfSight(state, city, pol.heli.x, pol.heli.y, SIGHT_HELI)) anySee = true;
    if (!anySee) {
      for (var vi = 0; vi < pol.units.length; vi++) {
        var vu = pol.units[vi];
        if (vu.leaving) continue;
        if (unitSees(state, city, vu)) { anySee = true; break; }
      }
    }
    if (anySee) {
      pol.lastSeen = { x: state.player.x, y: state.player.y, t: t };
      pol.unseenT = 0;
      pol.searching = false;
    } else if (wanted > 0) {
      pol.unseenT += dt;
      if (pol.unseenT > SEARCH_DELAY) pol.searching = true;
    }
    for (var si = 0; si < pol.units.length; si++) pol.units[si].searching = pol.searching;

    // Escape: unseen long enough, and the nearest unit far away, and
    // a star blinks out. One star per escape window, so a five-star
    // heat takes real hiding to clear.
    if (pol.searching && pol.unseenT > ESCAPE_UNSEEN && wanted > 0) {
      var nearest = 1e9;
      for (var ni = 0; ni < pol.units.length; ni++) {
        var npos = unitPos(pol.units[ni]);
        nearest = Math.min(nearest, dist(npos.x, npos.y, state.player.x, state.player.y));
      }
      if (pol.heli) nearest = Math.min(nearest, dist(pol.heli.x, pol.heli.y, state.player.x, state.player.y));
      if (nearest > ESCAPE_DIST) {
        state.wanted = wanted - 1;
        pol.unseenT = ESCAPE_UNSEEN - 4;
        if (state.wanted === 0) state.lastCrime = 'lost the PVPD';
      }
    }

    // Escalation: keep shooting and the heat rises, a star at a time.
    // Shooting a police unit escalates faster.
    var heat = pol.heat;
    if (wanted > 0 && wanted < 5) {
      if (heat.shotPolice && t - heat.lastEscT > 3) {
        state.wanted = wanted + 1;
        heat.lastEscT = t;
        heat.shotsSinceEsc = 0;
        heat.shotPolice = false;
      } else if (heat.shotsSinceEsc >= ESCALATE_SHOTS && t - heat.lastEscT > ESCALATE_GAP) {
        state.wanted = wanted + 1;
        heat.lastEscT = t;
        heat.shotsSinceEsc = 0;
      }
    } else {
      heat.shotPolice = false;
    }
  }

  window.PalmaPolice = {
    update: update,
    dispatchRows: dispatchRows,
    stageChase: stageChase,
    drawOverlay: drawOverlay,
    cruisersFor: cruisersFor,
    reportGunfire: reportGunfire,
    reportCrime: reportCrime,
    hasLineOfSight: hasLineOfSight,
    desiredComposition: desiredComposition,
    HELI_STARS: HELI_STARS
  };
})();
