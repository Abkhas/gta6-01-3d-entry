// Palma Verde — Canvas 2D renderer.
//
// The camera looks down at the city from the south-east at about 55
// degrees: the ground is drawn flat, and every building is an extruded
// box with a lit roof and two shaded walls, so the city reads as solid
// from above. Light comes from the west at golden hour, which throws
// long shadows toward the camera. Four lighting modes — dawn, noon,
// golden hour, neon night — are layered gradients and tints over the
// same geometry, never a single flat colour.

(function () {
  'use strict';

  var CFG = window.PalmaConfig;

  // Lighting modes, keyed by clock minutes. Each entry describes the
  // sky band, the ground tint, how long shadows stretch, and the colour
  // of lit windows at night.
  var MODES = {
    dawn:   { sky: ['#f7c9d4', '#f9e3b8', '#bcd8e8'], tint: 'rgba(244,178,166,0.10)', shadowLen: 1.4, shadowCol: 'rgba(90,60,110,0.28)', windowLit: 0.25, haze: 0.10 },
    noon:   { sky: ['#7ec3e8', '#a8d8f0', '#d9eefb'], tint: 'rgba(255,255,255,0.00)', shadowLen: 0.5, shadowCol: 'rgba(40,60,90,0.22)', windowLit: 0.05, haze: 0.04 },
    golden: { sky: ['#ff9e4f', '#ffc46b', '#7fb3c8'], tint: 'rgba(255,150,60,0.14)', shadowLen: 2.2, shadowCol: 'rgba(120,50,20,0.34)', windowLit: 0.45, haze: 0.12 },
    dusk:   { sky: ['#e86a6a', '#b06a9e', '#3d4a7a'], tint: 'rgba(180,90,140,0.12)', shadowLen: 1.8, shadowCol: 'rgba(60,30,70,0.36)', windowLit: 0.7, haze: 0.14 },
    night:  { sky: ['#0d1530', '#1c2a52', '#2c3a6e'], tint: 'rgba(20,30,80,0.30)', shadowLen: 0.8, shadowCol: 'rgba(0,0,10,0.45)', windowLit: 1.0, haze: 0.08 }
  };

  // minutes -> lighting mode name
  function modeForMinutes(mins) {
    if (mins < 7 * 60 + 30) return 'dawn';
    if (mins < 17 * 60) return 'noon';
    if (mins < 19 * 60 + 30) return 'golden';
    if (mins < 21 * 60) return 'dusk';
    return 'night';
  }

  function shade(hex, f) {
    var n = parseInt(hex.slice(1), 16);
    var r = Math.min(255, Math.max(0, Math.round(((n >> 16) & 255) * f)));
    var g = Math.min(255, Math.max(0, Math.round(((n >> 8) & 255) * f)));
    var b = Math.min(255, Math.max(0, Math.round((n & 255) * f)));
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  function makeRenderer(canvas) {
    var ctx = canvas.getContext('2d');
    var shakeMag = 0;
    var flashes = [];

    function resize(w, h) {
      canvas.width = w;
      canvas.height = h;
    }

    function addShake(m) { shakeMag = Math.min(18, shakeMag + m); }
    function addFlash(x, y, a) { flashes.push({ x: x, y: y, a: a || 0, life: 1 }); }

    // World -> screen. Ground is flat; the oblique feel comes from the
    // extruded buildings and the diagonal shadows, not from skewing the
    // ground plane, which keeps driving and aiming honest.
    function project(cam, wx, wy) {
      return { x: (wx - cam.x) * cam.zoom + canvas.width / 2, y: (wy - cam.y) * cam.zoom + canvas.height / 2 };
    }

    function inView(cam, wx, wy, pad) {
      var hw = canvas.width / 2 / cam.zoom + pad;
      var hh = canvas.height / 2 / cam.zoom + pad;
      return wx > cam.x - hw && wx < cam.x + hw && wy > cam.y - hh && wy < cam.y + hh;
    }

    function drawSky(mode, weather) {
      var m = MODES[mode];
      var g = ctx.createLinearGradient(0, 0, 0, canvas.height * 0.42);
      g.addColorStop(0, m.sky[0]);
      g.addColorStop(0.55, m.sky[1]);
      g.addColorStop(1, m.sky[2]);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, canvas.width, canvas.height * 0.42);
      if (weather && weather.haze > 0) {
        ctx.fillStyle = 'rgba(220,225,235,' + (weather.haze * 0.5).toFixed(2) + ')';
        ctx.fillRect(0, 0, canvas.width, canvas.height * 0.42);
      }
    }

    function drawGround(cam, city, mode) {
      var m = MODES[mode];
      // Grass / dirt base for the whole map.
      ctx.fillStyle = mode === 'night' ? '#1d2b26' : '#7fae62';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      var tl = project(cam, 0, 0);
      var br = project(cam, city.width, city.height);
      // Ocean on the west edge.
      var ox = project(cam, 0, 0).x;
      var bx = project(cam, CFG.CITY.beachX, 0).x;
      var og = ctx.createLinearGradient(ox, 0, bx, 0);
      if (mode === 'night') { og.addColorStop(0, '#0a1a3a'); og.addColorStop(1, '#143a5e'); }
      else if (mode === 'golden') { og.addColorStop(0, '#2a7a8c'); og.addColorStop(1, '#e8a25a'); }
      else { og.addColorStop(0, '#1f7fa8'); og.addColorStop(1, '#4fb3c9'); }
      ctx.fillStyle = og;
      ctx.fillRect(ox, 0, bx - ox, canvas.height);
      // Sand strip.
      ctx.fillStyle = mode === 'night' ? '#6b5f4a' : '#ecd9a0';
      var sx0 = project(cam, CFG.CITY.oceanX, 0).x;
      ctx.fillRect(sx0, 0, bx - sx0, canvas.height);
      // City ground: warm concrete.
      ctx.fillStyle = mode === 'night' ? '#3a3a40' : '#b9a98c';
      ctx.fillRect(bx, 0, canvas.width - bx, canvas.height);

      // Roads: dark asphalt ribbons with centre dashes and crosswalks.
      var i, p, q;
      ctx.fillStyle = mode === 'night' ? '#23232a' : '#4a4a52';
      for (i = 0; i < city.avenues.length; i++) {
        p = project(cam, city.avenues[i], 0);
        ctx.fillRect(p.x - 17 * cam.zoom, 0, 34 * cam.zoom, canvas.height);
      }
      for (i = 0; i < city.streets.length; i++) {
        p = project(cam, 0, city.streets[i]);
        ctx.fillRect(0, p.y - 17 * cam.zoom, canvas.width, 34 * cam.zoom);
      }
      // Lane dashes.
      ctx.fillStyle = mode === 'night' ? '#c9a13a' : '#e8d27a';
      for (i = 0; i < city.avenues.length; i++) {
        p = project(cam, city.avenues[i], 0);
        for (q = 0; q < canvas.height; q += 44) ctx.fillRect(p.x - 2, q, 4, 22);
      }
      for (i = 0; i < city.streets.length; i++) {
        p = project(cam, 0, city.streets[i]);
        for (q = 0; q < canvas.width; q += 44) ctx.fillRect(q, p.y - 2, 22, 4);
      }
      // Wet-street light streaks at night and dusk.
      if (mode === 'night' || mode === 'dusk') {
        ctx.fillStyle = 'rgba(255,190,120,0.10)';
        for (i = 0; i < city.avenues.length; i += 2) {
          p = project(cam, city.avenues[i], 0);
          ctx.fillRect(p.x - 6 * cam.zoom, 0, 12 * cam.zoom, canvas.height);
        }
      }
    }

    function drawBuilding(cam, b, mode) {
      var m = MODES[mode];
      var z = cam.zoom;
      var p = project(cam, b.x, b.y);
      var w = b.w * z, d = b.d * z;
      var h = b.h * z * 0.9;
      if (p.x + w < -40 || p.x > canvas.width + 40 || p.y + d < -200 || p.y - h > canvas.height + 40) return;
      // Long shadow toward the camera (south-east) at golden hour.
      var shx = -m.shadowLen * h * 0.55, shy = m.shadowLen * h * 0.35;
      ctx.fillStyle = m.shadowCol;
      ctx.beginPath();
      ctx.moveTo(p.x + shx, p.y + d + shy);
      ctx.lineTo(p.x + w + shx, p.y + d + shy);
      ctx.lineTo(p.x + w, p.y + d);
      ctx.lineTo(p.x, p.y + d);
      ctx.closePath();
      ctx.fill();
      // South wall (darker) and east wall (mid).
      ctx.fillStyle = shade(b.wall, mode === 'night' ? 0.35 : 0.62);
      ctx.fillRect(p.x, p.y + d - h * 0.28, w, h * 0.28 + d * 0);
      ctx.fillStyle = shade(b.wall, mode === 'night' ? 0.45 : 0.8);
      ctx.beginPath();
      ctx.moveTo(p.x + w, p.y);
      ctx.lineTo(p.x + w, p.y + d);
      ctx.lineTo(p.x + w - h * 0.3, p.y + d - h * 0.3);
      ctx.lineTo(p.x + w - h * 0.3, p.y - h * 0.3);
      ctx.closePath();
      ctx.fill();
      // Roof: lit top face, offset up-left so the box reads extruded.
      var rx = p.x - h * 0.3, ry = p.y - h * 0.62;
      ctx.fillStyle = mode === 'night' ? shade(b.roof, 0.4) : shade(b.roof, mode === 'golden' ? 1.15 : 1.0);
      ctx.fillRect(rx, ry, w, d);
      ctx.strokeStyle = b.trim;
      ctx.lineWidth = Math.max(1, 2 * z);
      ctx.strokeRect(rx, ry, w, d);
      // Lit windows on the roof edge at night.
      if (m.windowLit > 0.3) {
        ctx.fillStyle = 'rgba(255,214,120,0.9)';
        var n = Math.floor(w / 26);
        for (var i = 0; i < n; i++) {
          ctx.fillRect(rx + 8 + i * 26, ry + 6, 8, 5);
        }
      }
    }

    function drawPalm(cam, palm, mode) {
      var p = project(cam, palm.x, palm.y);
      var z = cam.zoom;
      if (p.x < -30 || p.x > canvas.width + 30 || p.y < -30 || p.y > canvas.height + 30) return;
      ctx.strokeStyle = mode === 'night' ? '#4a3626' : '#7a5a38';
      ctx.lineWidth = 4 * z;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.quadraticCurveTo(p.x + palm.lean * 20, p.y - 18 * z, p.x + palm.lean * 30, p.y - 30 * z);
      ctx.stroke();
      ctx.fillStyle = mode === 'night' ? '#1e4a2e' : '#2f8f4e';
      var tx = p.x + palm.lean * 30, ty = p.y - 30 * z;
      for (var i = 0; i < 6; i++) {
        var a = (i / 6) * Math.PI * 2 + palm.lean;
        ctx.beginPath();
        ctx.ellipse(tx + Math.cos(a) * 12 * z, ty + Math.sin(a) * 6 * z, 14 * z, 4 * z, a, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    function drawProp(cam, prop, mode) {
      var p = project(cam, prop.x, prop.y);
      var z = cam.zoom;
      if (p.x < -40 || p.x > canvas.width + 40 || p.y < -40 || p.y > canvas.height + 40) return;
      if (prop.kind === 'umbrella') {
        ctx.fillStyle = mode === 'night' ? '#7a3a4a' : '#ff6b5e';
        ctx.beginPath(); ctx.arc(p.x, p.y, 14 * z, Math.PI, 0); ctx.fill();
        ctx.strokeStyle = '#5a3a28'; ctx.lineWidth = 2 * z;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x, p.y - 12 * z); ctx.stroke();
      } else if (prop.kind === 'bench') {
        ctx.fillStyle = '#8a6a42'; ctx.fillRect(p.x - 12 * z, p.y - 4 * z, 24 * z, 8 * z);
      } else if (prop.kind === 'lamp') {
        ctx.strokeStyle = '#2c2c34'; ctx.lineWidth = 3 * z;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x, p.y - 26 * z); ctx.stroke();
        if (mode === 'night' || mode === 'dusk') {
          ctx.fillStyle = 'rgba(255,220,140,0.95)';
          ctx.beginPath(); ctx.arc(p.x, p.y - 28 * z, 5 * z, 0, Math.PI * 2); ctx.fill();
        }
      } else if (prop.kind === 'crate') {
        ctx.fillStyle = '#a8845a'; ctx.fillRect(p.x - 9 * z, p.y - 9 * z, 18 * z, 18 * z);
        ctx.strokeStyle = '#6b4a26'; ctx.strokeRect(p.x - 9 * z, p.y - 9 * z, 18 * z, 18 * z);
      } else if (prop.kind === 'stall') {
        ctx.fillStyle = mode === 'night' ? '#8c4a3a' : '#e86a4a';
        ctx.fillRect(p.x - 14 * z, p.y - 10 * z, 28 * z, 16 * z);
        ctx.fillStyle = '#f7e3b0'; ctx.fillRect(p.x - 16 * z, p.y - 14 * z, 32 * z, 6 * z);
      } else if (prop.kind === 'hydrant') {
        ctx.fillStyle = '#d23c2e'; ctx.fillRect(p.x - 4 * z, p.y - 7 * z, 8 * z, 12 * z);
      }
    }

    function drawLandmark(cam, lm, mode, t) {
      var p = project(cam, lm.x, lm.y);
      var z = cam.zoom;
      if (lm.kind === 'wheel') {
        ctx.strokeStyle = mode === 'night' ? '#ffd166' : '#e86a6a';
        ctx.lineWidth = 4 * z;
        ctx.beginPath(); ctx.arc(p.x, p.y - 60 * z, 46 * z, 0, Math.PI * 2); ctx.stroke();
        var i, a;
        for (i = 0; i < 8; i++) {
          a = (i / 8) * Math.PI * 2 + t * 0.05;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y - 60 * z);
          ctx.lineTo(p.x + Math.cos(a) * 46 * z, p.y - 60 * z + Math.sin(a) * 46 * z);
          ctx.stroke();
          ctx.fillStyle = mode === 'night' ? '#ffd166' : '#ff8a5e';
          ctx.beginPath(); ctx.arc(p.x + Math.cos(a) * 46 * z, p.y - 60 * z + Math.sin(a) * 46 * z, 5 * z, 0, Math.PI * 2); ctx.fill();
        }
        ctx.strokeStyle = '#3a3a44'; ctx.lineWidth = 5 * z;
        ctx.beginPath(); ctx.moveTo(p.x - 24 * z, p.y); ctx.lineTo(p.x, p.y - 60 * z); ctx.lineTo(p.x + 24 * z, p.y); ctx.stroke();
      } else if (lm.kind === 'pier') {
        ctx.fillStyle = '#8a6a42';
        var px0 = project(cam, lm.x - lm.length, lm.y).x;
        ctx.fillRect(px0, p.y - 10 * z, (lm.x + 20 - (lm.x - lm.length)) * z, 20 * z);
        ctx.fillStyle = mode === 'night' ? '#ffd166' : '#ffe08a';
        for (var k = 0; k < 5; k++) {
          ctx.beginPath(); ctx.arc(px0 + k * 30 * z, p.y - 12 * z, 3 * z, 0, Math.PI * 2); ctx.fill();
        }
      } else if (lm.kind === 'bridge') {
        ctx.strokeStyle = mode === 'night' ? '#9fb0c9' : '#5d6e8c';
        ctx.lineWidth = 10 * z;
        ctx.beginPath();
        ctx.moveTo(p.x - lm.span * z / 2, p.y);
        ctx.quadraticCurveTo(p.x, p.y - 40 * z, p.x + lm.span * z / 2, p.y);
        ctx.stroke();
      } else if (lm.kind === 'tower') {
        ctx.fillStyle = mode === 'night' ? '#2c3a5e' : '#7a8aa8';
        ctx.fillRect(p.x - 18 * z, p.y - 200 * z, 36 * z, 200 * z);
        ctx.fillStyle = mode === 'night' ? '#ff5a4a' : '#d23c2e';
        ctx.beginPath(); ctx.arc(p.x, p.y - 206 * z, 5 * z, 0, Math.PI * 2); ctx.fill();
      } else if (lm.kind === 'stadium') {
        ctx.fillStyle = mode === 'night' ? '#3a4a6a' : '#8aa0c0';
        ctx.beginPath(); ctx.ellipse(p.x, p.y, lm.r * z, lm.r * z * 0.6, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = mode === 'night' ? '#1e2c4a' : '#5d7a5a';
        ctx.beginPath(); ctx.ellipse(p.x, p.y, lm.r * z * 0.7, lm.r * z * 0.4, 0, 0, Math.PI * 2); ctx.fill();
      }
    }

    function drawCar(cam, car, mode) {
      var p = project(cam, car.x, car.y);
      var z = cam.zoom;
      var len = 46 * z, wid = 22 * z;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(car.angle);
      // Shadow under the car.
      ctx.fillStyle = 'rgba(0,0,0,0.30)';
      ctx.fillRect(-len / 2 + 4, -wid / 2 + 5, len, wid);
      ctx.fillStyle = car.color;
      ctx.beginPath();
      ctx.roundRect(-len / 2, -wid / 2, len, wid, 6 * z);
      ctx.fill();
      ctx.fillStyle = 'rgba(20,30,50,0.85)';
      ctx.beginPath();
      ctx.roundRect(-len * 0.18, -wid * 0.32, len * 0.36, wid * 0.64, 4 * z);
      ctx.fill();
      // Headlights at night.
      if (mode === 'night' || mode === 'dusk') {
        ctx.fillStyle = 'rgba(255,240,180,0.9)';
        ctx.fillRect(len / 2 - 2, -wid / 2 + 3, 4, 4);
        ctx.fillRect(len / 2 - 2, wid / 2 - 7, 4, 4);
      }
      // Damage: smoke and dents scale with damage percent.
      if (car.damage > 25) {
        ctx.fillStyle = 'rgba(40,40,40,0.5)';
        ctx.beginPath(); ctx.arc(-len * 0.3, 0, 6 * z * (car.damage / 50), 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
      if (car.police) {
        ctx.fillStyle = '#ff2e2e';
        ctx.beginPath(); ctx.arc(p.x, p.y - 18 * z, 3 * z, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#2e6bff';
        ctx.beginPath(); ctx.arc(p.x + 8 * z, p.y - 18 * z, 3 * z, 0, Math.PI * 2); ctx.fill();
      }
    }

    // The Gull, drawn as a heli: a gold body lifted off the ground
    // by her altitude, a spinning rotor, and a shadow that stays on
    // the deck below and fades as she climbs.
    function drawHeli(cam, heli, mode) {
      var g = project(cam, heli.x, heli.y);
      var z = cam.zoom;
      var alt = heli.altitude || 0;
      var lift = alt * 2.4 * z;
      var fade = Math.max(0.12, 1 - alt / 60);
      ctx.fillStyle = 'rgba(0,0,0,' + (0.30 * fade).toFixed(2) + ')';
      ctx.beginPath();
      ctx.ellipse(g.x + alt * 1.2, g.y + alt * 1.6, 46 * z * (1 - alt / 240), 16 * z, 0, 0, Math.PI * 2);
      ctx.fill();
      var bx = g.x, by = g.y - lift;
      ctx.save();
      ctx.translate(bx, by);
      ctx.rotate(heli.angle);
      ctx.fillStyle = heli.color || '#ffd166';
      ctx.beginPath();
      ctx.ellipse(0, 0, 30 * z, 13 * z, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#23262f';
      ctx.fillRect(22 * z, -3 * z, 34 * z, 6 * z);
      ctx.fillRect(52 * z, -9 * z, 5 * z, 18 * z);
      ctx.fillStyle = '#c8d4e0';
      ctx.beginPath();
      ctx.ellipse(-12 * z, -2 * z, 10 * z, 6 * z, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#23262f';
      ctx.lineWidth = 2 * z;
      ctx.beginPath();
      ctx.moveTo(-16 * z, 11 * z);
      ctx.lineTo(-16 * z, 18 * z);
      ctx.moveTo(16 * z, 11 * z);
      ctx.lineTo(16 * z, 18 * z);
      ctx.stroke();
      ctx.restore();
      // Rotor: one bar through the mast, turning with heli.rotor.
      var ra = heli.rotor || 0;
      ctx.strokeStyle = 'rgba(200,212,224,0.9)';
      ctx.lineWidth = 3 * z;
      ctx.beginPath();
      ctx.moveTo(bx - Math.cos(ra) * 44 * z, by - Math.sin(ra) * 44 * z - 10 * z);
      ctx.lineTo(bx + Math.cos(ra) * 44 * z, by + Math.sin(ra) * 44 * z - 10 * z);
      ctx.stroke();
      if (mode === 'night' || mode === 'dusk') {
        ctx.fillStyle = 'rgba(255,240,180,0.95)';
        ctx.beginPath();
        ctx.arc(bx, by - 12 * z, 3 * z, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    function drawPerson(cam, person, mode) {
      var p = project(cam, person.x, person.y);
      var z = cam.zoom;
      ctx.fillStyle = 'rgba(0,0,0,0.30)';
      ctx.beginPath(); ctx.ellipse(p.x + 3, p.y + 4, 9 * z, 4 * z, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = person.color || '#e8b48f';
      ctx.beginPath(); ctx.arc(p.x, p.y, 8 * z, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = person.shirt || '#3d7ea6';
      ctx.fillRect(p.x - 7 * z, p.y + 2 * z, 14 * z, 12 * z);
      if (person.aiming) {
        ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 3 * z;
        ctx.beginPath(); ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + Math.cos(person.aim) * 22 * z, p.y + Math.sin(person.aim) * 22 * z);
        ctx.stroke();
      }
    }

    function drawFlashes(cam) {
      for (var i = flashes.length - 1; i >= 0; i--) {
        var f = flashes[i];
        var p = project(cam, f.x, f.y);
        ctx.fillStyle = 'rgba(255,220,120,' + (0.9 * f.life).toFixed(2) + ')';
        ctx.beginPath(); ctx.arc(p.x, p.y, 16 * cam.zoom * f.life + 4, 0, Math.PI * 2); ctx.fill();
        f.life -= 0.25;
        if (f.life <= 0) flashes.splice(i, 1);
      }
    }

    function render(state, city, cam, t) {
      var mode = modeForMinutes(state.clockMinutes);
      var m = MODES[mode];
      var shx = 0, shy = 0;
      if (shakeMag > 0.3) {
        shx = (Math.random() - 0.5) * shakeMag;
        shy = (Math.random() - 0.5) * shakeMag;
        shakeMag *= 0.86;
      }
      ctx.save();
      ctx.translate(shx, shy);
      drawSky(mode, state.weather);
      drawGround(cam, city, mode);
      var i;
      for (i = 0; i < city.props.length; i++) drawProp(cam, city.props[i], mode);
      for (i = 0; i < city.landmarks.length; i++) drawLandmark(cam, city.landmarks[i], mode, t);
      // Buildings sorted far-to-near so nearer roofs overlap correctly.
      var sorted = city.buildings.slice().sort(function (a, b) { return a.y - b.y; });
      for (i = 0; i < sorted.length; i++) {
        if (inView(cam, sorted[i].x, sorted[i].y, 260)) drawBuilding(cam, sorted[i], mode);
      }
      for (i = 0; i < city.palms.length; i++) {
        if (inView(cam, city.palms[i].x, city.palms[i].y, 60)) drawPalm(cam, city.palms[i], mode);
      }
      // Parked + traffic + police cars, then the Gull on her pad,
      // then the player's ride — a heli is drawn as a heli, never
      // as a car, whether she is parked or being flown.
      var cars = state.cars || [];
      for (i = 0; i < cars.length; i++) drawCar(cam, cars[i], mode);
      if (state.gull && state.gull !== state.player.vehicle) drawHeli(cam, state.gull, mode);
      if (state.player.vehicle) {
        if (state.player.vehicle.kind === 'heli') drawHeli(cam, state.player.vehicle, mode);
        else drawCar(cam, state.player.vehicle, mode);
      }
      var peds = state.peds || [];
      for (i = 0; i < peds.length; i++) drawPerson(cam, peds[i], mode);
      if (!state.player.vehicle) drawPerson(cam, state.player, mode);
      drawFlashes(cam);
      // Golden-hour tint + haze wash over everything.
      ctx.fillStyle = m.tint;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      if (state.weather && state.weather.haze > 0.05) {
        ctx.fillStyle = 'rgba(225,228,238,' + (state.weather.haze * 0.35).toFixed(2) + ')';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      // Night vignette so the frame never looks flat.
      if (mode === 'night' || mode === 'dusk') {
        var vg = ctx.createRadialGradient(canvas.width / 2, canvas.height / 2, canvas.height * 0.35, canvas.width / 2, canvas.height / 2, canvas.height * 0.85);
        vg.addColorStop(0, 'rgba(0,0,20,0)');
        vg.addColorStop(1, 'rgba(0,0,20,0.42)');
        ctx.fillStyle = vg;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      ctx.restore();
      return mode;
    }

    return {
      render: render, resize: resize, project: project,
      addShake: addShake, addFlash: addFlash,
      modeForMinutes: modeForMinutes, shade: shade
    };
  }

  window.PalmaRender = { makeRenderer: makeRenderer, modeForMinutes: modeForMinutes };
})();
