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
  // plays its jingle.
  function tick(state, dt) {
    if (!armed || !ensure()) return;
    var p = state.player;
    var speed = p.vehicle ? Math.abs(p.vehicle.speed) : 0;
    var engTarget = p.vehicle ? 0.05 + Math.min(0.16, speed / 900) : 0;
    engGain.gain.value += (engTarget - engGain.gain.value) * Math.min(1, 4 * dt);
    engOsc.frequency.value = 52 + speed * 0.9;
    if (state.wanted > 0) {
      sirTimer -= dt;
      if (sirTimer <= 0) {
        sirHigh = !sirHigh;
        sirTimer = state.wanted >= 4 ? 0.32 : 0.45;
        sirOsc.frequency.value = sirHigh ? 920 : 660;
      }
      var sirTarget = 0.05 + state.wanted * 0.012;
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
    jingle: jingle,
    ensure: ensure
  };
})();
