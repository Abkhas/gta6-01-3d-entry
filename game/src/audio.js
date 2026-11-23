// Palma Verde — synthesized sound. No audio files ship with the
// game: every sound is built from oscillators and filtered noise in
// the browser's WebAudio graph — engine hum, two-tone PVPD sirens,
// radio station jingles, gunfire cracks and menu blips.

(function () {
  'use strict';

  var actx = null, master = null;
  var engOsc = null, engGain = null, engFilter = null;
  var sirOsc = null, sirGain = null;
  var sirTimer = 0, sirHigh = false;
  var armed = false, lastStation = -1;
  var lastHonkT = -99;

  // Browsers only let sound start after the player touches something.
  function arm() {
    armed = true;
    if (actx && actx.resume) actx.resume();
  }
  window.addEventListener('keydown', arm);
  window.addEventListener('mousedown', arm);

  function ensure() {
    if (!armed) return false;
    if (!actx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      actx = new AC();
      master = actx.createGain();
      master.gain.value = 0.5;
      master.connect(actx.destination);
      engOsc = actx.createOscillator();
      engOsc.type = 'sawtooth';
      engOsc.frequency.value = 55;
      engFilter = actx.createBiquadFilter();
      engFilter.type = 'lowpass';
      engFilter.frequency.value = 320;
      engGain = actx.createGain();
      engGain.gain.value = 0;
      engOsc.connect(engFilter);
      engFilter.connect(engGain);
      engGain.connect(master);
      engOsc.start();
      sirOsc = actx.createOscillator();
      sirOsc.type = 'triangle';
      sirOsc.frequency.value = 720;
      sirGain = actx.createGain();
      sirGain.gain.value = 0;
      sirOsc.connect(sirGain);
      sirGain.connect(master);
      sirOsc.start();
    }
    if (actx.state === 'suspended') actx.resume();
    return true;
  }

  // One short note, scheduled a little in the future for jingles.
  function tone(freq, dur, type, vol, delay) {
    if (!actx) return;
    var o = actx.createOscillator();
    var g = actx.createGain();
    var t0 = actx.currentTime + (delay || 0);
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g);
    g.connect(master);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  // A burst of white noise through a lowpass: the gunfire crack.
  function noiseBurst(dur, vol) {
    if (!actx) return;
    var len = Math.floor(actx.sampleRate * dur);
    var buf = actx.createBuffer(1, len, actx.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    var src = actx.createBufferSource();
    src.buffer = buf;
    var g = actx.createGain();
    g.gain.value = vol;
    var f = actx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1800;
    src.connect(f);
    f.connect(g);
    g.connect(master);
    src.start();
  }

  function blip() {
    if (ensure()) tone(880, 0.07, 'square', 0.12, 0);
  }

  function gunshot() {
    if (!ensure()) return;
    noiseBurst(0.14, 0.5);
    tone(140, 0.1, 'sine', 0.4, 0);
  }

  // Two-tone horn blast: a 370 Hz + 466 Hz square pair, the sound a
  // driver makes when the car ahead will not move. Throttled to one
  // blast per 1.2 s of audio time so a jam does not machine-gun.
  function honk() {
    if (!ensure()) return;
    var now = actx.currentTime;
    if (now - lastHonkT < 1.2) return;
    lastHonkT = now;
    tone(370, 0.22, 'square', 0.16, 0);
    tone(466, 0.22, 'square', 0.16, 0);
  }

  // Distance in world units from the player to the nearest police
  // unit (cruiser, bike, foot officer, or the AIR-1 heli), or
  // Infinity when no police exist. Pure: no audio, so the tests can
  // assert on it with a fake state.
  function nearestPoliceDist(state) {
    var pol = state.police;
    if (!pol) return Infinity;
    var p = state.player;
    if (!p) return Infinity;
    var best = Infinity;
    var i, pos, d;
    var units = pol.units || [];
    for (i = 0; i < units.length; i++) {
      pos = units[i].car || units[i].ped;
      if (!pos) continue;
      d = Math.hypot(pos.x - p.x, pos.y - p.y);
      if (d < best) best = d;
    }
    if (pol.heli) {
      d = Math.hypot(pol.heli.x - p.x, pol.heli.y - p.y);
      if (d < best) best = d;
    }
    return best;
  }

  // The nearest ordinary traffic car to the player, with its
  // distance: { car, dist } or null when the street is empty.
  // Police cars are skipped — they have their own siren.
  function nearestTrafficCar(state) {
    var p = state.player;
    if (!p || !state.cars) return null;
    var best = null, bestD = Infinity;
    for (var i = 0; i < state.cars.length; i++) {
      var car = state.cars[i];
      if (!car || car.police || car.policeUnit) continue;
      var d = Math.hypot(car.x - p.x, car.y - p.y);
      if (d < bestD) { bestD = d; best = car; }
    }
    return best ? { car: best, dist: bestD } : null;
  }

  // Four-note station ident, played when the radio changes.
  function jingle() {
    if (!ensure()) return;
    var notes = [523, 659, 784, 1046];
    for (var i = 0; i < notes.length; i++) {
      tone(notes[i], 0.12, 'triangle', 0.15, i * 0.09);
    }
  }

  // Once per frame: the engine follows the car's speed, the siren
  // wails two-tone while the wanted level is up, and a station change
  // plays its jingle. Two distance rules: the siren is loudest when
  // a police unit is close and fades as the nearest unit falls
  // behind (full inside ~100 units, a fifth at 800+), and a car
  // stuck behind the player honks once per block — the traffic
  // layer raises car.honk, this tick consumes it. On foot, the
  // engine bed follows the nearest traffic car instead of the
  // player's own (silent) feet, fading out past 300 units.
  function tick(state, dt) {
    // The honk flag is consumed even before the audio gate: the
    // traffic layer re-raises it while the car is still blocked, so
    // an unarmed tick loses nothing, and a test can watch the flag
    // clear without an AudioContext.
    var cars = state.cars || [];
    for (var h = 0; h < cars.length; h++) {
      if (cars[h] && cars[h].honk) {
        cars[h].honk = false;
        honk();
        break;
      }
    }
    if (!armed || !ensure()) return;
    var p = state.player;
    var speed = p.vehicle ? Math.abs(p.vehicle.speed) : 0;
    var engTarget, engFreq;
    if (p.vehicle) {
      engTarget = 0.05 + Math.min(0.16, speed / 900);
      engFreq = 52 + speed * 0.9;
    } else {
      var near = nearestTrafficCar(state);
      if (near && near.dist < 300) {
        var prox = 1 - near.dist / 300;
        var nspeed = Math.abs(near.car.speed || 0);
        engTarget = (0.02 + Math.min(0.08, nspeed / 900)) * prox;
        engFreq = 52 + nspeed * 0.9;
      } else {
        engTarget = 0;
        engFreq = 52;
      }
    }
    engGain.gain.value += (engTarget - engGain.gain.value) * Math.min(1, 4 * dt);
    engOsc.frequency.value = engFreq;
    if (state.wanted > 0) {
      sirTimer -= dt;
      if (sirTimer <= 0) {
        sirHigh = !sirHigh;
        sirTimer = state.wanted >= 4 ? 0.32 : 0.45;
        sirOsc.frequency.value = sirHigh ? 920 : 660;
      }
      var nd = nearestPoliceDist(state);
      var sirProx = nd === Infinity ? 0.25 : Math.max(0.2, Math.min(1, 1.15 - nd / 800));
      var sirTarget = (0.05 + state.wanted * 0.012) * sirProx;
      sirGain.gain.value += (sirTarget - sirGain.gain.value) * Math.min(1, 3 * dt);
    } else {
      sirGain.gain.value += (0 - sirGain.gain.value) * Math.min(1, 3 * dt);
    }
    if (state.radioStation !== lastStation) {
      lastStation = state.radioStation;
      jingle();
    }
  }

  window.PalmaAudio = {
    tick: tick,
    blip: blip,
    gunshot: gunshot,
    honk: honk,
    jingle: jingle,
    ensure: ensure,
    nearestPoliceDist: nearestPoliceDist,
    nearestTrafficCar: nearestTrafficCar
  };
})();
