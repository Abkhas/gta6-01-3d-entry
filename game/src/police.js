// Palma Verde — wanted level, PVPD response, dispatch board, AIR-1.
//
// Stars on the HUD are only half the system: behind them sits the
// dispatch board — named units, a tactic each, a live distance — and
// the cruisers and the helicopter that actually come for Rey. One star
// is a single patrol car; five stars is the whole department plus the
// helicopter overhead, and the heli never leaves once it arrives.

(function () {
  'use strict';

  var WORLD = window.PalmaWorld;
  var VEH = window.PalmaVehicles;
  var CFG = window.PalmaConfig;

  var CALLS = CFG.CALLSIGNS;
  var TACTIC_CYCLE = ['PIT', 'RAMMING', 'ROADBLOCK', 'FLANKING', 'PIT', 'PURSUIT'];
  var MAX_UNITS = 5;
  var HELI_STARS = 4;
  var HELI_ORBIT = 190;

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

  function policeState(state) {
    if (!state.police) state.police = { units: [], heli: null, goneT: 0 };
    return state.police;
  }

  function cruisersFor(wanted) {
    return clamp(wanted, 0, MAX_UNITS);
  }

  // A cruiser spawns on a road a few blocks from Rey, never on top of
  // him, with a fresh call-sign and a tactic picked by its slot.
  function spawnCruiser(state, city, idx) {
    var rng = WORLD.makeRng((city.seed + 101 + idx * 17) >>> 0);
    var p = state.player;
    var spot = null;
    for (var tries = 0; tries < 10; tries++) {
      var s = WORLD.randomRoadSpot(city, rng);
      if (dist(s.x, s.y, p.x, p.y) > 180 && dist(s.x, s.y, p.x, p.y) < 900) {
        spot = s;
        break;
      }
      spot = s;
    }
    var car = VEH.makeCar('halcon', spot.x, spot.y, spot.angle, { police: true, color: '#23262f' });
    car.policeUnit = true;
    var unit = {
      car: car,
      callsign: CALLS[(idx + (city.seed % CALLS.length)) % CALLS.length],
      tactic: TACTIC_CYCLE[idx % TACTIC_CYCLE.length],
      role: idx === 2 ? 'roadblock' : (idx === 3 ? 'flank' : 'chase')
    };
    state.cars.push(car);
    return unit;
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

  // One cruiser, one frame of driving. Chasers aim at Rey, flankers
  // aim at a point off his shoulder, and the roadblock car races ahead
  // of him and parks sideways across the street.
  function driveCruiser(state, city, unit, dt) {
    var car = unit.car;
    var p = state.player;
    var tx = p.x, ty = p.y;
    if (unit.role === 'roadblock') {
      var head = headingOf(state);
      tx = p.x + Math.cos(head) * 280;
      ty = p.y + Math.sin(head) * 280;
      var snap = WORLD.nearestRoadPoint(city, tx, ty);
      tx = snap.x;
      ty = snap.y;
      if (dist(car.x, car.y, tx, ty) < 70) {
        var road = WORLD.roadAt(city, car.x, car.y);
        var want = road && road.axis === 'x' ? 0 : Math.PI / 2;
        car.angle += angDiff(car.angle, want) * Math.min(1, 3 * dt);
        VEH.updateCar(state, city, car, { throttle: 0, steer: 0, brake: true, handbrake: false }, dt);
        return;
      }
    } else if (unit.role === 'flank') {
      var side = headingOf(state) + Math.PI / 2;
      tx = p.x + Math.cos(side) * 170;
      ty = p.y + Math.sin(side) * 170;
    }
    var wantAngle = Math.atan2(ty - car.y, tx - car.x);
    var diff = angDiff(car.angle, wantAngle);
    var steer = clamp(diff * 1.6, -1, 1);
    var throttle = Math.abs(diff) > 1.4 ? 0.25 : 1;
    if (unit.tactic === 'RAMMING') throttle = 1;
    var dPlayer = dist(car.x, car.y, p.x, p.y);
    if (dPlayer < 55) throttle = 0.35;
    VEH.updateCar(state, city, car, {
      throttle: throttle, steer: steer, brake: false, handbrake: false
    }, dt);
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

  // The dispatch board the HUD draws: one row per unit on the street,
  // call-sign + tactic + live distance in metres, plus the AIR-1 row
  // while the helicopter is up. One world unit reads as half a metre.
  function dispatchRows(state) {
    var pol = state.police;
    if (!pol) return [];
    var rows = [];
    var p = state.player;
    for (var i = 0; i < pol.units.length; i++) {
      var u = pol.units[i];
      rows.push({
        callsign: u.callsign,
        tactic: u.tactic,
        distM: Math.round(dist(u.car.x, u.car.y, p.x, p.y) / 2),
        kind: 'cruiser'
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

  // Raise the heat to a given star level right now: cruisers appear on
  // the roads around Rey and the helicopter comes in at four stars.
  // Staging uses this to set up the chase frame deterministically.
  function stageChase(state, city, stars) {
    state.wanted = stars;
    var pol = policeState(state);
    for (var i = 0; i < pol.units.length; i++) {
      var ix = state.cars.indexOf(pol.units[i].car);
      if (ix >= 0) state.cars.splice(ix, 1);
    }
    pol.units = [];
    var need = cruisersFor(stars);
    for (var k = 0; k < need; k++) pol.units.push(spawnCruiser(state, city, k));
    if (stars >= HELI_STARS) {
      pol.heli = spawnHeli(state);
      pol.heli.x = state.player.x + 140;
      pol.heli.y = state.player.y - 130;
    } else {
      pol.heli = null;
    }
    return pol;
  }

  // The helicopter and its spotlight cone, drawn over the world after
  // the renderer finishes, before the HUD panels go on top.
  function drawOverlay(state, city, canvas, renderer) {
    var pol = state.police;
    if (!pol || !pol.heli || !renderer) return;
    var ctx = canvas.getContext('2d');
    var heli = pol.heli;
    var hp = renderer.project(state.cam, heli.x, heli.y);
    var pp = renderer.project(state.cam, state.player.x, state.player.y);
    var g = ctx.createLinearGradient(hp.x, hp.y, pp.x, pp.y);
    g.addColorStop(0, 'rgba(255,240,180,0.30)');
    g.addColorStop(1, 'rgba(255,240,180,0.08)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(hp.x - 10, hp.y);
    ctx.lineTo(hp.x + 10, hp.y);
    ctx.lineTo(pp.x + 46, pp.y + 30);
    ctx.lineTo(pp.x - 46, pp.y + 30);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,240,180,0.20)';
    ctx.beginPath();
    ctx.ellipse(pp.x, pp.y + 10, 52, 26, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1d2733';
    ctx.beginPath();
    ctx.ellipse(hp.x, hp.y, 26, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#c8d4e0';
    ctx.fillRect(hp.x - 40, hp.y - 2, 16, 4);
    ctx.strokeStyle = 'rgba(200,212,224,0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(hp.x - 34, hp.y - 4);
    ctx.lineTo(hp.x + 34, hp.y - 4);
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('AIR-1', hp.x, hp.y - 16);
    ctx.textAlign = 'left';
  }

  function update(state, city, dt) {
    var pol = policeState(state);
    var need = cruisersFor(state.wanted);
    while (pol.units.length < need) {
      pol.units.push(spawnCruiser(state, city, pol.units.length));
    }
    if (state.wanted === 0 && pol.units.length > 0) {
      pol.goneT += dt;
      if (pol.goneT > 4) {
        var gone = pol.units.pop();
        var ix = state.cars.indexOf(gone.car);
        if (ix >= 0) state.cars.splice(ix, 1);
        pol.goneT = 0;
      }
    } else {
      pol.goneT = 0;
    }
    if (state.wanted >= HELI_STARS && !pol.heli) pol.heli = spawnHeli(state);
    if (state.wanted < HELI_STARS) pol.heli = null;
    for (var i = 0; i < pol.units.length; i++) {
      driveCruiser(state, city, pol.units[i], dt);
    }
    updateHeli(state, dt);
  }

  window.PalmaPolice = {
    update: update,
    dispatchRows: dispatchRows,
    stageChase: stageChase,
    drawOverlay: drawOverlay,
    cruisersFor: cruisersFor,
    HELI_STARS: HELI_STARS
  };
})();
