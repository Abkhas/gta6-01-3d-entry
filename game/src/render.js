// Palma Verde — Canvas 2D renderer, low oblique chase camera.
//
// The camera sits low behind the hero and looks north down the road
// toward a horizon: the top 180 px of every frame is real sky, the
// ground plane is squashed by V_SQUASH (0.5) with a depth scale that
// shrinks things toward the horizon, and buildings are tall extruded
// boxes with lit front faces and roofs. Traffic, peds and the hero
// are drawn as proper oblique sprites — body, glass, wheels, lights,
// damage — and the Gull flies big with a rotor disc, a spotlight cone
// and a shadow on the deck below. Collision and aiming stay in world
// coordinates; only this file's DRAW projection tilts. Four lighting
// modes — dawn, noon, golden hour, neon night — come from
// CFG.DAYLIGHT: sky, sun/moon, shadow length and the night ambient
// floor are a palette change per mode, never a brightness slider.

(function () {
  'use strict';

  var CFG = window.PalmaConfig;

  // Frame geometry, from CFG.FRAME (config.js) with a local fallback.
  var FRAME = CFG.FRAME || { W: 1280, H: 720, HORIZON_Y: 180, SKY_H: 180, V_SQUASH: 0.5 };

  // Lighting modes, keyed by clock minutes. config.js owns the table
  // (CFG.DAYLIGHT); this literal is only the fallback when it is absent.
  var MODES = CFG.DAYLIGHT || {
    dawn:   { sky: ['#f7c9d4', '#f9e3b8', '#bcd8e8'], tint: 'rgba(244,178,166,0.10)', shadowLen: 1.4, shadowCol: 'rgba(90,60,110,0.28)', windowLit: 0.25, haze: 0.10, ambient: 0.82, sun: { x: 0.24, y: 0.62, r: 26, col: '#ffd9a0' }, moon: null, stars: false, glitter: false },
    noon:   { sky: ['#7ec3e8', '#a8d8f0', '#d9eefb'], tint: 'rgba(255,255,255,0.00)', shadowLen: 0.5, shadowCol: 'rgba(40,60,90,0.22)', windowLit: 0.05, haze: 0.04, ambient: 1.0, sun: { x: 0.68, y: 0.30, r: 30, col: '#fff3c4' }, moon: null, stars: false, glitter: true },
    golden: { sky: ['#ff9e4f', '#ffc46b', '#7fb3c8'], tint: 'rgba(255,150,60,0.14)', shadowLen: 2.2, shadowCol: 'rgba(120,50,20,0.34)', windowLit: 0.45, haze: 0.12, ambient: 0.88, sun: { x: 0.72, y: 0.55, r: 34, col: '#ffdf8a' }, moon: null, stars: false, glitter: true },
    dusk:   { sky: ['#e86a6a', '#f09a6a', '#3d4a7a'], tint: 'rgba(180,90,140,0.12)', shadowLen: 1.8, shadowCol: 'rgba(60,30,70,0.36)', windowLit: 0.7, haze: 0.14, ambient: 0.72, sun: { x: 0.30, y: 0.72, r: 30, col: '#ff9a5e' }, moon: null, stars: true, glitter: false },
    night:  { sky: ['#0d1530', '#1c2a52', '#2c3a6e'], tint: 'rgba(20,30,80,0.18)', shadowLen: 0.8, shadowCol: 'rgba(0,0,10,0.45)', windowLit: 1.0, haze: 0.08, ambient: 0.62, sun: null, moon: { x: 0.78, y: 0.34, r: 20, col: '#f4ead0' }, stars: true, glitter: true }
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

  // Deterministic 0..1 hash from two numbers, so lit windows, stars
  // and glitter never flicker between frames.
  function hash2(a, b) {
    var h = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
    return h - Math.floor(h);
  }

  // Beach geometry, from the world builder (window.PalmaWorld.BEACH)
  // with a fallback that matches the built city.
  function beachGeom() {
    var b = (window.PalmaWorld && window.PalmaWorld.BEACH) || null;
    if (b) return { oceanX0: b.oceanX0, oceanX1: b.oceanX1, sandX1: b.sandX1, beachRoadX: b.beachRoadX };
    return { oceanX0: 0, oceanX1: 180, sandX1: 540, beachRoadX: 600 };
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

    // World -> screen, low oblique. The horizon sits HORIZON_Y down
    // the frame; the ground plane is squashed by V_SQUASH, and things
    // shrink toward the horizon (s = 0.55 at the horizon, 1.0 at the
    // bottom of the frame). Collision stays in world coordinates;
    // only the draw projection tilts. Returns { x, y, s }.
    function project(cam, wx, wy) {
      var sx = (wx - cam.x) * cam.zoom + canvas.width / 2;
      var sy = FRAME.HORIZON_Y + (wy - cam.y) * cam.zoom * FRAME.V_SQUASH;
      var f = (sy - FRAME.HORIZON_Y) / Math.max(1, canvas.height - FRAME.HORIZON_Y);
      if (f < 0) f = 0;
      if (f > 1) f = 1;
      return { x: sx, y: sy, s: 0.55 + 0.45 * f };
    }

    function inView(cam, wx, wy, pad) {
      var hw = canvas.width / 2 / cam.zoom + pad;
      var hn = FRAME.HORIZON_Y / (cam.zoom * FRAME.V_SQUASH) + pad;
      var hs = (canvas.height - FRAME.HORIZON_Y) / (cam.zoom * FRAME.V_SQUASH) + pad;
      return wx > cam.x - hw && wx < cam.x + hw && wy > cam.y - hn && wy < cam.y + hs;
    }

    // Real sky in the top band only (0..SKY_H): gradient + sun disc
    // and glow by day, stars + bokeh + moon at night, drifting cloud
    // bands, and a distant skyline silhouette along the horizon.
    function drawSky(mode, weather, t) {
      var m = MODES[mode];
      var W = canvas.width, H = FRAME.SKY_H;
      var g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, m.sky[0]);
      g.addColorStop(0.55, m.sky[1]);
      g.addColorStop(1, m.sky[2]);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      var i, sx, sy;
      if (m.stars) {
        for (i = 0; i < 46; i++) {
          sx = hash2(i, 3) * W;
          sy = hash2(i, 7) * (H - 40);
          ctx.fillStyle = 'rgba(255,255,255,' + (0.35 + hash2(i, 11) * 0.55).toFixed(2) + ')';
          ctx.beginPath();
          ctx.arc(sx, sy, hash2(i, 13) < 0.2 ? 2 : 1, 0, Math.PI * 2);
          ctx.fill();
        }
        // Bokeh: soft out-of-focus city lights hanging in the night sky.
        for (i = 0; i < 9; i++) {
          sx = hash2(i, 21) * W;
          sy = 30 + hash2(i, 29) * (H - 70);
          ctx.fillStyle = i % 3 === 0 ? 'rgba(255,120,160,0.20)' : (i % 3 === 1 ? 'rgba(255,200,110,0.20)' : 'rgba(140,200,255,0.18)');
          ctx.beginPath();
          ctx.arc(sx, sy, 5 + hash2(i, 31) * 7, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      if (m.sun) {
        var sunX = m.sun.x * W, sunY = m.sun.y * H;
        var glow = ctx.createRadialGradient(sunX, sunY, 4, sunX, sunY, m.sun.r * 4);
        glow.addColorStop(0, m.sun.col);
        glow.addColorStop(1, 'rgba(255,200,120,0)');
        ctx.fillStyle = glow;
        ctx.beginPath(); ctx.arc(sunX, sunY, m.sun.r * 4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = m.sun.col;
        ctx.beginPath(); ctx.arc(sunX, sunY, m.sun.r, 0, Math.PI * 2); ctx.fill();
      }
      if (m.moon) {
        var mx = m.moon.x * W, my = m.moon.y * H;
        var mg = ctx.createRadialGradient(mx, my, 4, mx, my, m.moon.r * 3.5);
        mg.addColorStop(0, 'rgba(240,230,200,0.55)');
        mg.addColorStop(1, 'rgba(240,230,200,0)');
        ctx.fillStyle = mg;
        ctx.beginPath(); ctx.arc(mx, my, m.moon.r * 3.5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = m.moon.col;
        ctx.beginPath(); ctx.arc(mx, my, m.moon.r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(200,190,160,0.7)';
        ctx.beginPath(); ctx.arc(mx - 6, my - 4, 4, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(mx + 5, my + 6, 3, 0, Math.PI * 2); ctx.fill();
      }
      // Cloud bands drifting with time (day modes; pink at dusk).
      if (mode !== 'night') {
        ctx.fillStyle = mode === 'dusk' ? 'rgba(255,170,150,0.55)' : 'rgba(255,255,255,0.75)';
        var bands = [[0.22, 46], [0.5, 86], [0.78, 128]];
        for (var b = 0; b < bands.length; b++) {
          var bx = ((t * (6 + b * 4) + b * 420) % (W + 360)) - 180;
          var by = bands[b][1], bl = 120 + b * 40;
          ctx.beginPath();
          ctx.ellipse(bx, by, bl, 9, 0, 0, Math.PI * 2);
          ctx.ellipse(bx + bl * 0.5, by + 4, bl * 0.6, 7, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      // Distant skyline silhouette along the horizon so the city
      // reads beyond the frame, not just the ground plane.
      ctx.fillStyle = mode === 'night' ? 'rgba(10,16,40,0.55)' : 'rgba(60,60,90,0.28)';
      var x = 0;
      while (x < W) {
        var bw = 26 + hash2(x, 5) * 60;
        var bh = 12 + hash2(x, 9) * 34;
        ctx.fillRect(x, H - bh, bw, bh);
        x += bw + 8 + hash2(x, 13) * 26;
      }
      if (weather && weather.haze > 0) {
        ctx.fillStyle = 'rgba(220,225,235,' + (weather.haze * 0.5).toFixed(2) + ')';
        ctx.fillRect(0, 0, W, H);
      }
    }

    // Ground, from the horizon line down — never into the sky band.
    // Ocean, sand and city are world-x bands from WORLD.BEACH; the
    // beach road is the first avenue. Avenues through Northgate are
    // drawn wide with a median: a multi-lane highway slicing through
    // the tall buildings. Streets are horizontal strips at their
    // squashed y, thicker toward the camera.
    function drawGround(cam, city, mode) {
      var m = MODES[mode];
      var W = canvas.width, H = canvas.height;
      var top = FRAME.HORIZON_Y;
      var bg = beachGeom();
      // Grass / dirt base for the whole ground band.
      ctx.fillStyle = mode === 'night' ? '#26332c' : (mode === 'dusk' ? '#6d7a52' : '#7fae62');
      ctx.fillRect(0, top, W, H - top);
      // Ocean on the west edge.
      var ox0 = project(cam, bg.oceanX0, 0).x;
      var ox1 = project(cam, bg.oceanX1, 0).x;
      var sx1 = project(cam, bg.sandX1, 0).x;
      var og = ctx.createLinearGradient(ox0, 0, ox1, 0);
      if (mode === 'night') { og.addColorStop(0, '#0a1a3a'); og.addColorStop(1, '#143a5e'); }
      else if (mode === 'golden') { og.addColorStop(0, '#2a7a8c'); og.addColorStop(1, '#e8a25a'); }
      else if (mode === 'dusk') { og.addColorStop(0, '#1c4a6a'); og.addColorStop(1, '#c96a5a'); }
      else { og.addColorStop(0, '#1f7fa8'); og.addColorStop(1, '#4fb3c9'); }
      ctx.fillStyle = og;
      ctx.fillRect(ox0, top, ox1 - ox0, H - top);
      // Sun glitter on the water by day, moon path at night: a bright
      // streak down the ocean band from the horizon.
      if (m.glitter) {
        var gx = ox0 + (ox1 - ox0) * (mode === 'night' ? 0.62 : 0.45);
        var gg = ctx.createLinearGradient(0, top, 0, H);
        if (mode === 'night') { gg.addColorStop(0, 'rgba(230,225,190,0.55)'); gg.addColorStop(1, 'rgba(230,225,190,0.05)'); }
        else { gg.addColorStop(0, 'rgba(255,230,150,0.75)'); gg.addColorStop(1, 'rgba(255,230,150,0.08)'); }
        ctx.fillStyle = gg;
        ctx.fillRect(gx - 14, top, 28, H - top);
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        for (var gi = 0; gi < 7; gi++) {
          ctx.fillRect(gx - 26 + hash2(gi, 2) * 52, top + 30 + gi * 70, 18 + hash2(gi, 5) * 22, 3);
        }
      }
      // Sand strip.
      ctx.fillStyle = mode === 'night' ? '#7d7057' : '#ecd9a0';
      ctx.fillRect(ox1, top, sx1 - ox1, H - top);
      // City ground: warm concrete, brighter at night than before so
      // the night frame keeps its ambient floor.
      ctx.fillStyle = mode === 'night' ? '#46464e' : '#b9a98c';
      ctx.fillRect(sx1, top, W - sx1, H - top);

      // Roads: dark asphalt ribbons with centre dashes and crosswalks.
      var i, p, q;
      var ng = null;
      if (city.districts) {
        for (i = 0; i < city.districts.length; i++) {
          if (city.districts[i].id === 'northgate') ng = city.districts[i];
        }
      }
      if (!ng) ng = { x0: 2700, x1: 4200 };
      var highway = function (x) { return x >= ng.x0 && x <= ng.x1; };
      ctx.fillStyle = mode === 'night' ? '#2e2e36' : '#4a4a52';
      for (i = 0; i < city.avenues.length; i++) {
        p = project(cam, city.avenues[i], 0);
        var half = highway(city.avenues[i]) ? 32 : 17;
        ctx.fillRect(p.x - half * cam.zoom, top, half * 2 * cam.zoom, H - top);
      }
      for (i = 0; i < city.streets.length; i++) {
        p = project(cam, 0, city.streets[i]);
        var th = 34 * cam.zoom * p.s;
        if (p.y + th / 2 < top) continue;
        var sy0 = Math.max(top, p.y - th / 2);
        ctx.fillRect(0, sy0, W, p.y + th / 2 - sy0);
      }
      // Highway median through Northgate: a concrete spine with a
      // lane each side.
      for (i = 0; i < city.avenues.length; i++) {
        if (!highway(city.avenues[i])) continue;
        p = project(cam, city.avenues[i], 0);
        ctx.fillStyle = mode === 'night' ? '#55555e' : '#8a8a86';
        ctx.fillRect(p.x - 3 * cam.zoom, top, 6 * cam.zoom, H - top);
      }
      // Lane dashes.
      ctx.fillStyle = mode === 'night' ? '#c9a13a' : '#e8d27a';
      for (i = 0; i < city.avenues.length; i++) {
        p = project(cam, city.avenues[i], 0);
        var off = highway(city.avenues[i]) ? 16 * cam.zoom : 0;
        for (q = top; q < H; q += 44) {
          if (off) {
            ctx.fillRect(p.x - off - 2, q, 4, 22);
            ctx.fillRect(p.x + off - 2, q, 4, 22);
          } else {
            ctx.fillRect(p.x - 2, q, 4, 22);
          }
        }
      }
      for (i = 0; i < city.streets.length; i++) {
        p = project(cam, 0, city.streets[i]);
        if (p.y < top) continue;
        for (q = 0; q < W; q += 44) ctx.fillRect(q, p.y - 2, 22, 4);
      }
      // Wet-street light streaks at night and dusk — brighter now,
      // with a neon tint, so the night frame stays legible.
      if (mode === 'night' || mode === 'dusk') {
        ctx.fillStyle = 'rgba(255,190,120,0.20)';
        for (i = 0; i < city.avenues.length; i += 2) {
          p = project(cam, city.avenues[i], 0);
          ctx.fillRect(p.x - 6 * cam.zoom, top, 12 * cam.zoom, H - top);
        }
        ctx.fillStyle = 'rgba(255,110,160,0.12)';
        for (i = 1; i < city.avenues.length; i += 4) {
          p = project(cam, city.avenues[i], 0);
          ctx.fillRect(p.x - 4 * cam.zoom, top, 8 * cam.zoom, H - top);
        }
      }
    }

    // Tall extruded box: a lit front face, a shaded east face, a lit
    // roof with a trim, and lit windows at night and dusk. The front
    // edge is the south (near) side; the roof's back edge sits higher
    // on screen by the squashed footprint depth, which is what makes
    // the box read as solid from the low camera.
    function drawBuilding(cam, b, mode) {
      var m = MODES[mode];
      var pf = project(cam, b.x, b.y + b.d);
      var pb = project(cam, b.x, b.y);
      var z = cam.zoom * pf.s;
      var w = b.w * cam.zoom;
      var h = b.h * z * 1.35;
      if (pf.x + w < -60 || pf.x > canvas.width + 60 || pf.y < -h - 40 || pb.y - h > canvas.height + 40) return;
      // Long diagonal warm shadow, thrown south-east toward the camera.
      var shx = m.shadowLen * h * 0.45, shy = m.shadowLen * h * 0.30;
      ctx.fillStyle = m.shadowCol;
      ctx.beginPath();
      ctx.moveTo(pf.x, pf.y);
      ctx.lineTo(pf.x + w, pf.y);
      ctx.lineTo(pf.x + w + shx, pf.y + shy);
      ctx.lineTo(pf.x + shx, pf.y + shy);
      ctx.closePath();
      ctx.fill();
      // South face: the lit front.
      var nightF = mode === 'night' ? 0.42 : (mode === 'dusk' ? 0.6 : 1.0);
      ctx.fillStyle = shade(b.wall, (mode === 'golden' ? 1.08 : 1.0) * nightF);
      ctx.fillRect(pf.x, pf.y - h, w, h);
      // East face: the shaded side, slanting up toward the horizon.
      ctx.fillStyle = shade(b.wall, mode === 'night' ? 0.30 : (mode === 'dusk' ? 0.45 : 0.72));
      ctx.beginPath();
      ctx.moveTo(pf.x + w, pf.y);
      ctx.lineTo(pf.x + w, pf.y - h);
      ctx.lineTo(pf.x + w, pb.y - h);
      ctx.lineTo(pf.x + w, pb.y);
      ctx.closePath();
      ctx.fill();
      // Roof: lit top face, offset toward the horizon by the footprint.
      ctx.fillStyle = mode === 'night' ? shade(b.roof, 0.45) : shade(b.roof, mode === 'golden' ? 1.15 : 1.0);
      ctx.beginPath();
      ctx.moveTo(pf.x, pf.y - h);
      ctx.lineTo(pf.x + w, pf.y - h);
      ctx.lineTo(pf.x + w, pb.y - h);
      ctx.lineTo(pf.x, pb.y - h);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = b.trim;
      ctx.lineWidth = Math.max(1, 1.5 * cam.zoom);
      ctx.stroke();
      // Rooftop box on tall buildings.
      if (h > 60 * cam.zoom) {
        ctx.fillStyle = shade(b.roof, mode === 'night' ? 0.35 : 0.8);
        ctx.fillRect(pf.x + w * 0.3, pb.y - h - 10 * z, w * 0.22, 10 * z);
      }
      // Windows on the front face: lit rows at night and dusk, dark
      // glass by day. Deterministic per building so they never flicker.
      // Capped at 8 x 4 so a big facade stays cheap to draw.
      if (w > 26 && h > 26) {
        var cols = Math.max(1, Math.floor(w / 20));
        var rows = Math.max(1, Math.floor(h / 24));
        if (cols > 8) cols = 8;
        if (rows > 4) rows = 4;
        var cw = w / cols, ch = h / rows;
        for (var r = 0; r < rows; r++) {
          for (var c = 0; c < cols; c++) {
            var lit = hash2(b.x + c * 3.1, b.y + r * 7.7) < m.windowLit;
            if (lit) ctx.fillStyle = 'rgba(255,214,120,0.92)';
            else if (mode === 'night' || mode === 'dusk') ctx.fillStyle = 'rgba(20,26,44,0.85)';
            else ctx.fillStyle = 'rgba(30,50,80,0.35)';
            ctx.fillRect(pf.x + c * cw + cw * 0.28, pf.y - h + r * ch + ch * 0.28, cw * 0.44, ch * 0.44);
          }
        }
      }
    }

    function drawPalm(cam, palm, mode) {
      var p = project(cam, palm.x, palm.y);
      var z = cam.zoom * p.s;
      if (p.x < -40 || p.x > canvas.width + 40 || p.y < -60 || p.y > canvas.height + 40) return;
      var m = MODES[mode];
      ctx.fillStyle = m.shadowCol;
      ctx.beginPath();
      ctx.ellipse(p.x + 14 * z * m.shadowLen * 0.4, p.y + 4, 16 * z, 4 * z, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = mode === 'night' ? '#4a3626' : '#7a5a38';
      ctx.lineWidth = Math.max(1, 4 * z);
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
      var z = cam.zoom * p.s;
      if (p.x < -40 || p.x > canvas.width + 40 || p.y < -40 || p.y > canvas.height + 40) return;
      var nightGlow = mode === 'night' || mode === 'dusk';
      if (prop.kind === 'umbrella') {
        ctx.fillStyle = mode === 'night' ? '#7a3a4a' : '#ff6b5e';
        ctx.beginPath(); ctx.arc(p.x, p.y, 14 * z, Math.PI, 0); ctx.fill();
        ctx.strokeStyle = '#5a3a28'; ctx.lineWidth = Math.max(1, 2 * z);
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x, p.y - 12 * z); ctx.stroke();
      } else if (prop.kind === 'bench') {
        ctx.fillStyle = '#8a6a42'; ctx.fillRect(p.x - 12 * z, p.y - 4 * z, 24 * z, 8 * z);
      } else if (prop.kind === 'lamp') {
        ctx.strokeStyle = '#2c2c34'; ctx.lineWidth = Math.max(1, 3 * z);
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x, p.y - 26 * z); ctx.stroke();
        if (nightGlow) {
          var halo = ctx.createRadialGradient(p.x, p.y - 28 * z, 2, p.x, p.y - 28 * z, 22 * z);
          halo.addColorStop(0, 'rgba(255,220,140,0.5)');
          halo.addColorStop(1, 'rgba(255,220,140,0)');
          ctx.fillStyle = halo;
          ctx.beginPath(); ctx.arc(p.x, p.y - 28 * z, 22 * z, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = 'rgba(255,220,140,0.95)';
          ctx.beginPath(); ctx.arc(p.x, p.y - 28 * z, 5 * z, 0, Math.PI * 2); ctx.fill();
        }
      } else if (prop.kind === 'crate') {
        ctx.fillStyle = '#a8845a'; ctx.fillRect(p.x - 9 * z, p.y - 9 * z, 18 * z, 18 * z);
        ctx.strokeStyle = '#6b4a26'; ctx.strokeRect(p.x - 9 * z, p.y - 9 * z, 18 * z, 18 * z);
      } else if (prop.kind === 'stall') {
        if (nightGlow) {
          var sg = ctx.createRadialGradient(p.x, p.y - 6 * z, 2, p.x, p.y - 6 * z, 34 * z);
          sg.addColorStop(0, 'rgba(255,190,110,0.45)');
          sg.addColorStop(1, 'rgba(255,190,110,0)');
          ctx.fillStyle = sg;
          ctx.beginPath(); ctx.arc(p.x, p.y - 6 * z, 34 * z, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = mode === 'night' ? '#8c4a3a' : '#e86a4a';
        ctx.fillRect(p.x - 14 * z, p.y - 10 * z, 28 * z, 16 * z);
        ctx.fillStyle = nightGlow ? '#ffd166' : '#f7e3b0';
        ctx.fillRect(p.x - 16 * z, p.y - 14 * z, 32 * z, 6 * z);
      } else if (prop.kind === 'hydrant') {
        ctx.fillStyle = '#d23c2e'; ctx.fillRect(p.x - 4 * z, p.y - 7 * z, 8 * z, 12 * z);
      }
    }

    function drawLandmark(cam, lm, mode, t) {
      var p = project(cam, lm.x, lm.y);
      var z = cam.zoom * p.s;
      if (lm.kind === 'wheel') {
        ctx.strokeStyle = mode === 'night' ? '#ffd166' : '#e86a6a';
        ctx.lineWidth = Math.max(1, 4 * z);
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
        ctx.strokeStyle = '#3a3a44'; ctx.lineWidth = Math.max(1, 5 * z);
        ctx.beginPath(); ctx.moveTo(p.x - 24 * z, p.y); ctx.lineTo(p.x, p.y - 60 * z); ctx.lineTo(p.x + 24 * z, p.y); ctx.stroke();
      } else if (lm.kind === 'pier') {
        // The pier juts west into the ocean, and a wheel stands on its
        // seaward end — boardwalk, not just sand.
        var px0 = project(cam, lm.x - lm.length, lm.y);
        var px1 = project(cam, lm.x + 20, lm.y);
        var deckY = p.y;
        ctx.strokeStyle = mode === 'night' ? '#3a2c20' : '#5d4a30';
        ctx.lineWidth = Math.max(1, 3 * z);
        for (var k = 0; k < 6; k++) {
          var postX = px0.x + (px1.x - px0.x) * k / 5;
          ctx.beginPath(); ctx.moveTo(postX, deckY); ctx.lineTo(postX, deckY + 16 * z); ctx.stroke();
        }
        ctx.fillStyle = '#8a6a42';
        ctx.fillRect(px0.x, deckY - 8 * z, px1.x - px0.x, 16 * z);
        ctx.strokeStyle = 'rgba(60,40,20,0.6)';
        ctx.lineWidth = 1;
        for (var d = 0; d < 8; d++) {
          var dx = px0.x + (px1.x - px0.x) * d / 8;
          ctx.beginPath(); ctx.moveTo(dx, deckY - 8 * z); ctx.lineTo(dx, deckY + 8 * z); ctx.stroke();
        }
        ctx.fillStyle = (mode === 'night' || mode === 'dusk') ? '#ffd166' : '#ffe08a';
        for (var l = 0; l < 5; l++) {
          ctx.beginPath(); ctx.arc(px0.x + l * ((px1.x - px0.x) / 4), deckY - 12 * z, 3 * z, 0, Math.PI * 2); ctx.fill();
        }
        var wx = px0.x + 8 * z, wy = deckY - 52 * z;
        ctx.strokeStyle = mode === 'night' ? '#ffd166' : '#e86a6a';
        ctx.lineWidth = Math.max(1, 4 * z);
        ctx.beginPath(); ctx.arc(wx, wy, 40 * z, 0, Math.PI * 2); ctx.stroke();
        for (var s = 0; s < 8; s++) {
          var sa = (s / 8) * Math.PI * 2 + t * 0.05;
          ctx.beginPath();
          ctx.moveTo(wx, wy);
          ctx.lineTo(wx + Math.cos(sa) * 40 * z, wy + Math.sin(sa) * 40 * z);
          ctx.stroke();
          ctx.fillStyle = mode === 'night' ? '#ffd166' : '#ff8a5e';
          ctx.beginPath(); ctx.arc(wx + Math.cos(sa) * 40 * z, wy + Math.sin(sa) * 40 * z, 4 * z, 0, Math.PI * 2); ctx.fill();
        }
        ctx.strokeStyle = '#3a3a44';
        ctx.lineWidth = Math.max(1, 5 * z);
        ctx.beginPath(); ctx.moveTo(wx - 20 * z, deckY); ctx.lineTo(wx, wy); ctx.lineTo(wx + 20 * z, deckY); ctx.stroke();
      } else if (lm.kind === 'bridge') {
        ctx.strokeStyle = mode === 'night' ? '#9fb0c9' : '#5d6e8c';
        ctx.lineWidth = Math.max(1, 10 * z);
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

    // A moped or police bike (car.moped / car.bike, model 'olas'): a
    // slim two-wheeler with a rider leaning over the bars, not a car.
    function drawBike(cam, car, mode) {
      var p = project(cam, car.x, car.y);
      var z = cam.zoom * p.s;
      var m = MODES[mode];
      ctx.fillStyle = m.shadowCol;
      ctx.beginPath();
      ctx.ellipse(p.x + 4, p.y + 5, 20 * z, 5 * z, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(car.angle);
      ctx.fillStyle = '#181818';
      ctx.beginPath(); ctx.arc(-13 * z, 0, 6 * z, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(13 * z, 0, 6 * z, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(220,220,220,0.7)';
      ctx.beginPath(); ctx.arc(-13 * z, 0, 2.5 * z, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(13 * z, 0, 2.5 * z, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = car.color || '#e8d27a';
      ctx.lineWidth = Math.max(1, 3 * z);
      ctx.beginPath();
      ctx.moveTo(-13 * z, 0); ctx.lineTo(2 * z, -7 * z); ctx.lineTo(13 * z, 0);
      ctx.moveTo(2 * z, -7 * z); ctx.lineTo(6 * z, -2 * z);
      ctx.stroke();
      // Rider leaning forward: jacket, helmet, bent legs.
      ctx.strokeStyle = '#23262f';
      ctx.lineWidth = Math.max(2, 5 * z);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(0, -14 * z); ctx.lineTo(-6 * z, -2 * z);
      ctx.moveTo(2 * z, -12 * z); ctx.lineTo(8 * z, -2 * z);
      ctx.stroke();
      ctx.fillStyle = '#c94f3d';
      ctx.beginPath();
      ctx.roundRect(-6 * z, -22 * z, 14 * z, 12 * z, 4 * z);
      ctx.fill();
      ctx.fillStyle = '#2c2c34';
      ctx.beginPath(); ctx.arc(2 * z, -26 * z, 6 * z, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      if (mode === 'night' || mode === 'dusk') {
        ctx.fillStyle = 'rgba(255,240,180,0.9)';
        ctx.beginPath(); ctx.arc(p.x + Math.cos(car.angle) * 16 * z, p.y + Math.sin(car.angle) * 16 * z, 2.5 * z, 0, Math.PI * 2); ctx.fill();
      }
    }

    // A proper oblique car sprite: body + cabin + glass + wheels +
    // headlights + taillights + damage tint. Detail follows the
    // model's sprite tier (config.js); the Cometa GT is tier 3.
    function drawCar(cam, car, mode) {
      if (car.moped || car.bike) { drawBike(cam, car, mode); return; }
      var p = project(cam, car.x, car.y);
      var z = cam.zoom * p.s;
      var tier = (car.model && car.model.sprite) || 1;
      var len = 46 * z, wid = 22 * z;
      var m = MODES[mode];
      // Shadow on the ground, unrotated: long and warm at golden hour.
      ctx.fillStyle = m.shadowCol;
      ctx.beginPath();
      ctx.ellipse(p.x + 4 + m.shadowLen * 5, p.y + 6 + m.shadowLen * 3, len * 0.55, wid * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(car.angle);
      // Body with a light top edge and a dark skirt.
      ctx.fillStyle = car.damage > 0 ? shade(car.color, 1 - Math.min(0.35, car.damage / 300)) : car.color;
      ctx.beginPath();
      ctx.roundRect(-len / 2, -wid / 2, len, wid, 6 * z);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(-len / 2 + 3 * z, -wid / 2 + 2 * z, len - 6 * z, 3 * z);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(-len / 2 + 2 * z, wid / 2 - 4 * z, len - 4 * z, 3 * z);
      if (tier >= 3) {
        // Cometa racing stripe down the centre line.
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.fillRect(-len / 2 + 4 * z, -2.5 * z, len - 8 * z, 5 * z);
        // Rear spoiler.
        ctx.fillStyle = shade(car.color, 0.7);
        ctx.fillRect(-len / 2 - 3 * z, -wid / 2 - 1 * z, 4 * z, wid + 2 * z);
      }
      if (car.police) {
        // White door stripe + roof light bar.
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.fillRect(-len * 0.1, -wid / 2 + 2 * z, len * 0.2, wid - 4 * z);
        ctx.fillStyle = '#ff2e2e';
        ctx.beginPath(); ctx.roundRect(-len * 0.08, -wid * 0.30, len * 0.10, wid * 0.60, 2 * z); ctx.fill();
        ctx.fillStyle = '#2e6bff';
        ctx.beginPath(); ctx.roundRect(len * 0.02, -wid * 0.30, len * 0.10, wid * 0.60, 2 * z); ctx.fill();
      }
      // Wheels: four dark tyres; tier 2+ adds hubcaps, tier 3 rings.
      ctx.fillStyle = '#151515';
      var wx = len * 0.32, wy = wid / 2 - 1 * z;
      ctx.beginPath(); ctx.roundRect(-wx - 5 * z, -wy - 3 * z, 10 * z, 6 * z, 2 * z); ctx.fill();
      ctx.beginPath(); ctx.roundRect(wx - 5 * z, -wy - 3 * z, 10 * z, 6 * z, 2 * z); ctx.fill();
      ctx.beginPath(); ctx.roundRect(-wx - 5 * z, wy - 3 * z, 10 * z, 6 * z, 2 * z); ctx.fill();
      ctx.beginPath(); ctx.roundRect(wx - 5 * z, wy - 3 * z, 10 * z, 6 * z, 2 * z); ctx.fill();
      if (tier >= 2) {
        ctx.fillStyle = tier >= 3 ? '#e8e8e8' : '#8a8a92';
        ctx.beginPath(); ctx.arc(-wx, -wy, 2.5 * z, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(wx, -wy, 2.5 * z, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(-wx, wy, 2.5 * z, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(wx, wy, 2.5 * z, 0, Math.PI * 2); ctx.fill();
      }
      // Cabin + glass, with a light streak across the windshield.
      ctx.fillStyle = shade(car.color, 0.55);
      ctx.beginPath();
      ctx.roundRect(-len * 0.16, -wid * 0.34, len * 0.34, wid * 0.68, 4 * z);
      ctx.fill();
      ctx.fillStyle = 'rgba(24,40,64,0.92)';
      ctx.beginPath();
      ctx.roundRect(-len * 0.13, -wid * 0.30, len * 0.28, wid * 0.60, 3 * z);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(-len * 0.10, -wid * 0.30, 3 * z, wid * 0.60);
      if (tier >= 2) {
        // Grille + bumpers + side mirrors.
        ctx.fillStyle = 'rgba(20,20,24,0.8)';
        ctx.fillRect(len / 2 - 3 * z, -wid * 0.28, 3 * z, wid * 0.56);
        ctx.fillStyle = 'rgba(200,200,210,0.6)';
        ctx.fillRect(len / 2 - 1 * z, -wid / 2 - 1 * z, 2 * z, wid + 2 * z);
        ctx.fillRect(-len / 2 - 1 * z, -wid / 2 - 1 * z, 2 * z, wid + 2 * z);
        ctx.fillStyle = '#151515';
        ctx.fillRect(-len * 0.05, -wid / 2 - 2 * z, 4 * z, 3 * z);
        ctx.fillRect(-len * 0.05, wid / 2 - 1 * z, 4 * z, 3 * z);
      }
      // Headlights (front, +x) and taillights (rear, -x).
      var nightLamp = mode === 'night' || mode === 'dusk';
      ctx.fillStyle = nightLamp ? 'rgba(255,244,190,0.98)' : 'rgba(255,244,190,0.75)';
      ctx.fillRect(len / 2 - 3 * z, -wid / 2 + 3 * z, 3 * z, 4 * z);
      ctx.fillRect(len / 2 - 3 * z, wid / 2 - 7 * z, 3 * z, 4 * z);
      ctx.fillStyle = nightLamp ? 'rgba(255,60,50,0.95)' : 'rgba(200,40,40,0.8)';
      ctx.fillRect(-len / 2, -wid / 2 + 3 * z, 3 * z, 4 * z);
      ctx.fillRect(-len / 2, wid / 2 - 7 * z, 3 * z, 4 * z);
      if (nightLamp && tier >= 2) {
        // Headlight cones spilling forward onto the road.
        var cone = ctx.createLinearGradient(len / 2, 0, len / 2 + 44 * z, 0);
        cone.addColorStop(0, 'rgba(255,240,180,0.30)');
        cone.addColorStop(1, 'rgba(255,240,180,0)');
        ctx.fillStyle = cone;
        ctx.beginPath();
        ctx.moveTo(len / 2, -wid / 2 + 2 * z);
        ctx.lineTo(len / 2 + 44 * z, -wid * 0.9);
        ctx.lineTo(len / 2 + 44 * z, wid * 0.9);
        ctx.lineTo(len / 2, wid / 2 - 2 * z);
        ctx.closePath();
        ctx.fill();
      }
      // Damage: dents scale with damage percent; heavy damage smokes.
      if (car.damage > 25) {
        ctx.fillStyle = 'rgba(40,40,40,0.5)';
        ctx.beginPath(); ctx.arc(-len * 0.3, 0, 6 * z * (car.damage / 50), 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(120,120,120,' + Math.min(0.5, car.damage / 200).toFixed(2) + ')';
        ctx.beginPath(); ctx.arc(-len * 0.32, -wid * 0.2, 9 * z * (car.damage / 60), 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }

    // A readable figure, never a dot: head, hair, torso with a jacket
    // colour, legs, arms, and a weapon when armed. Height comes from
    // person.drawHeight in screen px (Rey ~175, street peds ~150),
    // scaled by depth only, so the figure stays readable at any
    // camera zoom. Fleeing peds get a run pose; officers read as
    // police (dark uniform, cap, badge); downed figures lie flat.
    function drawPerson(cam, person, mode) {
      var p = project(cam, person.x, person.y);
      var hp = (person.drawHeight || 150) * p.s;
      var z = hp / 150;
      var down = person.down || (typeof person.health === 'number' && person.health <= 0);
      ctx.fillStyle = 'rgba(0,0,0,0.30)';
      if (down) {
        ctx.beginPath(); ctx.ellipse(p.x, p.y + 4 * z, 26 * z, 7 * z, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = person.shirt || '#8c2f2f';
        ctx.beginPath(); ctx.roundRect(p.x - 24 * z, p.y - 5 * z, 34 * z, 10 * z, 5 * z); ctx.fill();
        ctx.fillStyle = '#2c2c34';
        ctx.beginPath(); ctx.roundRect(p.x + 10 * z, p.y - 4 * z, 16 * z, 8 * z, 4 * z); ctx.fill();
        ctx.fillStyle = person.color || '#e8b48f';
        ctx.beginPath(); ctx.arc(p.x - 28 * z, p.y, 6 * z, 0, Math.PI * 2); ctx.fill();
        return;
      }
      ctx.beginPath(); ctx.ellipse(p.x + 3, p.y + 4, 10 * z, 4 * z, 0, 0, Math.PI * 2); ctx.fill();
      var officer = person.officer || person.police;
      var shirt = officer ? '#23262f' : (person.shirt || '#3d7ea6');
      var skin = person.color || '#e8b48f';
      var running = person.mode === 'flee' || person.fleeing || person.running || (person.speed && person.speed > 120);
      var facing = Math.cos(person.angle || 0) >= 0 ? 1 : -1;
      var hipY = p.y - 72 * z;
      // Legs: run pose splits them wide, walk a little, idle together.
      var legSpread = running ? 10 : (person.moving ? 4 : 1.5);
      ctx.strokeStyle = officer ? '#1a1d24' : '#23262f';
      ctx.lineWidth = Math.max(2, 6 * z);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(p.x, hipY);
      ctx.lineTo(p.x - legSpread * z * facing - (running ? 4 * z : 0), p.y);
      ctx.moveTo(p.x, hipY);
      ctx.lineTo(p.x + legSpread * z * facing + (running ? 5 * z : 0), p.y);
      ctx.stroke();
      // Torso: jacket colour with a lighter chest panel.
      ctx.fillStyle = shirt;
      ctx.beginPath();
      ctx.roundRect(p.x - 11 * z, p.y - 118 * z, 22 * z, 48 * z, 6 * z);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      ctx.beginPath();
      ctx.roundRect(p.x - 6 * z, p.y - 114 * z, 12 * z, 40 * z, 4 * z);
      ctx.fill();
      if (officer) {
        // Badge + belt + cap brim read as PVPD at a glance.
        ctx.fillStyle = '#ffd166';
        ctx.beginPath(); ctx.arc(p.x - 5 * z, p.y - 96 * z, 2.5 * z, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#151515';
        ctx.fillRect(p.x - 11 * z, p.y - 74 * z, 22 * z, 3 * z);
      }
      // Head + hair.
      ctx.fillStyle = skin;
      ctx.beginPath(); ctx.arc(p.x, p.y - 132 * z, 10 * z, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = officer ? '#1a1d24' : '#2c2c34';
      ctx.beginPath(); ctx.arc(p.x, p.y - 134 * z, 10 * z, Math.PI, 0); ctx.fill();
      if (officer) {
        ctx.fillStyle = '#1a1d24';
        ctx.fillRect(p.x - 10 * z, p.y - 138 * z, 20 * z, 4 * z);
      }
      // Arms: pumping when running, raised with a pistol when aiming.
      var aiming = person.aiming || person.armed;
      var shY = p.y - 110 * z;
      ctx.strokeStyle = shirt;
      ctx.lineWidth = Math.max(2, 5 * z);
      if (aiming) {
        var ax = Math.cos(person.aim || 0), ay = Math.sin(person.aim || 0) * FRAME.V_SQUASH;
        var al = Math.sqrt(ax * ax + ay * ay) || 1;
        ax /= al; ay /= al;
        var hx = p.x + ax * 20 * z, hy = shY + ay * 20 * z;
        ctx.beginPath();
        ctx.moveTo(p.x - 9 * z, shY); ctx.lineTo(hx, hy);
        ctx.moveTo(p.x + 9 * z, shY); ctx.lineTo(hx, hy);
        ctx.stroke();
        // Pistol in both hands, barrel along the aim.
        ctx.strokeStyle = '#1a1a1a';
        ctx.lineWidth = Math.max(2, 3 * z);
        ctx.beginPath();
        ctx.moveTo(hx, hy);
        ctx.lineTo(hx + ax * 12 * z, hy + ay * 12 * z);
        ctx.stroke();
      } else if (running) {
        ctx.beginPath();
        ctx.moveTo(p.x - 10 * z, shY); ctx.lineTo(p.x - 16 * z, shY + 22 * z);
        ctx.moveTo(p.x + 10 * z, shY); ctx.lineTo(p.x + 16 * z, shY - 12 * z);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.moveTo(p.x - 10 * z, shY); ctx.lineTo(p.x - 13 * z, shY + 34 * z);
        ctx.moveTo(p.x + 10 * z, shY); ctx.lineTo(p.x + 13 * z, shY + 34 * z);
        ctx.stroke();
      }
      if (officer && !aiming) {
        // Nightstick at the hip when the officer is not aiming.
        ctx.strokeStyle = '#1a1a1a';
        ctx.lineWidth = Math.max(2, 3 * z);
        ctx.beginPath();
        ctx.moveTo(p.x + 12 * z, hipY - 4 * z);
        ctx.lineTo(p.x + 14 * z, hipY + 14 * z);
        ctx.stroke();
      }
    }

    // The Gull, drawn BIG: a gold body lifted off the ground by her
    // altitude, a spinning rotor disc, a tail with fin and tail rotor,
    // skids, nav lights, a spotlight cone and a pool of light at
    // night, and a shadow that stays on the deck below and fades as
    // she climbs. Nose points -x, tail +x, as before.
    function drawHeli(cam, heli, mode) {
      var g = project(cam, heli.x, heli.y);
      var z = cam.zoom * g.s;
      var alt = heli.altitude || 0;
      var lift = alt * 2.4 * z;
      var fade = Math.max(0.12, 1 - alt / 60);
      ctx.fillStyle = 'rgba(0,0,0,' + (0.30 * fade).toFixed(2) + ')';
      ctx.beginPath();
      ctx.ellipse(g.x + alt * 1.2, g.y + alt * 1.6, 58 * z * (1 - alt / 240), 20 * z, 0, 0, Math.PI * 2);
      ctx.fill();
      var nightSpot = (mode === 'night' || mode === 'dusk') && alt > 2;
      if (nightSpot) {
        ctx.fillStyle = 'rgba(255,240,180,0.16)';
        ctx.beginPath();
        ctx.ellipse(g.x + alt * 1.2, g.y + alt * 1.6, 46 * z, 16 * z, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      var bx = g.x, by = g.y - lift;
      if (nightSpot) {
        var cone = ctx.createLinearGradient(0, by, 0, g.y);
        cone.addColorStop(0, 'rgba(255,240,180,0.28)');
        cone.addColorStop(1, 'rgba(255,240,180,0.02)');
        ctx.fillStyle = cone;
        ctx.beginPath();
        ctx.moveTo(bx - 8 * z, by + 8 * z);
        ctx.lineTo(bx + 8 * z, by + 8 * z);
        ctx.lineTo(bx + 34 * z, g.y);
        ctx.lineTo(bx - 34 * z, g.y);
        ctx.closePath();
        ctx.fill();
      }
      ctx.save();
      ctx.translate(bx, by);
      ctx.rotate(heli.angle);
      // Rotor disc, seen oblique: a translucent ellipse behind the body.
      ctx.fillStyle = 'rgba(200,212,224,0.22)';
      ctx.beginPath();
      ctx.ellipse(0, -12 * z, 62 * z, 12 * z, 0, 0, Math.PI * 2);
      ctx.fill();
      // Tail boom + fin + tail rotor.
      ctx.fillStyle = heli.color || '#ffd166';
      ctx.fillRect(20 * z, -4 * z, 38 * z, 8 * z);
      ctx.beginPath();
      ctx.moveTo(52 * z, -10 * z);
      ctx.lineTo(60 * z, -10 * z);
      ctx.lineTo(58 * z, 10 * z);
      ctx.lineTo(52 * z, 10 * z);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#23262f';
      ctx.lineWidth = Math.max(1, 2 * z);
      ctx.beginPath();
      ctx.arc(60 * z, 0, 6 * z, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(60 * z, -6 * z);
      ctx.lineTo(60 * z, 6 * z);
      ctx.stroke();
      // Body: big gold ellipse with a darker belly and a white stripe.
      ctx.fillStyle = heli.color || '#ffd166';
      ctx.beginPath();
      ctx.ellipse(0, 0, 46 * z, 20 * z, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.beginPath();
      ctx.ellipse(0, 8 * z, 40 * z, 9 * z, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillRect(-30 * z, -2 * z, 52 * z, 4 * z);
      // Nose glass + side windows.
      ctx.fillStyle = '#c8d4e0';
      ctx.beginPath();
      ctx.ellipse(-30 * z, -4 * z, 14 * z, 9 * z, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(24,40,64,0.9)';
      ctx.beginPath();
      ctx.roundRect(-8 * z, -10 * z, 14 * z, 12 * z, 3 * z);
      ctx.fill();
      ctx.beginPath();
      ctx.roundRect(10 * z, -10 * z, 14 * z, 12 * z, 3 * z);
      ctx.fill();
      // Skids.
      ctx.strokeStyle = '#23262f';
      ctx.lineWidth = Math.max(1, 2 * z);
      ctx.beginPath();
      ctx.moveTo(-30 * z, 20 * z);
      ctx.lineTo(30 * z, 20 * z);
      ctx.moveTo(-20 * z, 18 * z);
      ctx.lineTo(-20 * z, 24 * z);
      ctx.moveTo(20 * z, 18 * z);
      ctx.lineTo(20 * z, 24 * z);
      ctx.stroke();
      // Nav lights: red tail, green nose, white belly strobe.
      ctx.fillStyle = '#ff2e2e';
      ctx.beginPath(); ctx.arc(58 * z, -8 * z, 3 * z, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#2eff5e';
      ctx.beginPath(); ctx.arc(-44 * z, 0, 3 * z, 0, Math.PI * 2); ctx.fill();
      if (mode === 'night' || mode === 'dusk') {
        ctx.fillStyle = 'rgba(255,240,180,0.95)';
        ctx.beginPath(); ctx.arc(0, 12 * z, 3 * z, 0, Math.PI * 2); ctx.fill();
      }
      // Rotor: mast + two blades turning with heli.rotor.
      var ra = heli.rotor || 0;
      ctx.strokeStyle = '#23262f';
      ctx.lineWidth = Math.max(1, 3 * z);
      ctx.beginPath();
      ctx.moveTo(0, -10 * z);
      ctx.lineTo(0, -16 * z);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(200,212,224,0.9)';
      ctx.lineWidth = Math.max(2, 3 * z);
      var b1 = ra, b2 = ra + Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(b1) * -62 * z, -12 * z + Math.sin(b1) * 12 * z);
      ctx.lineTo(Math.cos(b1) * 62 * z, -12 * z + Math.sin(b1) * -12 * z);
      ctx.moveTo(Math.cos(b2) * -62 * z, -12 * z + Math.sin(b2) * 12 * z);
      ctx.lineTo(Math.cos(b2) * 62 * z, -12 * z + Math.sin(b2) * -12 * z);
      ctx.stroke();
      ctx.restore();
    }

    // Muzzle flash: halo + white core + four spikes, so it reads
    // even at thumbnail size in the night shot.
    function drawFlashes(cam) {
      for (var i = flashes.length - 1; i >= 0; i--) {
        var f = flashes[i];
        var p = project(cam, f.x, f.y);
        var r = 30 * cam.zoom * f.life + 8;
        var halo = ctx.createRadialGradient(p.x, p.y, 1, p.x, p.y, r * 2.2);
        halo.addColorStop(0, 'rgba(255,220,120,' + (0.85 * f.life).toFixed(2) + ')');
        halo.addColorStop(1, 'rgba(255,140,40,0)');
        ctx.fillStyle = halo;
        ctx.beginPath(); ctx.arc(p.x, p.y, r * 2.2, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,246,200,' + (0.95 * f.life).toFixed(2) + ')';
        ctx.beginPath(); ctx.arc(p.x, p.y, r * 0.55, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(255,220,120,' + (0.9 * f.life).toFixed(2) + ')';
        ctx.lineWidth = Math.max(1, 3 * cam.zoom * f.life);
        ctx.beginPath();
        ctx.moveTo(p.x - r, p.y); ctx.lineTo(p.x + r, p.y);
        ctx.moveTo(p.x, p.y - r); ctx.lineTo(p.x, p.y + r);
        ctx.stroke();
        f.life -= 0.25;
        if (f.life <= 0) flashes.splice(i, 1);
      }
    }

    // Aim reticle at the mouse position while Rey aims (RMB held).
    function drawReticle(cam, state) {
      if (!state.aiming || !state.mouseWorld) return;
      var p = project(cam, state.mouseWorld.x, state.mouseWorld.y);
      var r = 14;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(p.x - r - 6, p.y); ctx.lineTo(p.x - r + 2, p.y);
      ctx.moveTo(p.x + r - 2, p.y); ctx.lineTo(p.x + r + 6, p.y);
      ctx.moveTo(p.x, p.y - r - 6); ctx.lineTo(p.x, p.y - r + 2);
      ctx.moveTo(p.x, p.y + r - 2); ctx.lineTo(p.x, p.y + r + 6);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,80,60,0.95)';
      ctx.beginPath(); ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2); ctx.fill();
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
      drawSky(mode, state.weather, t);
      drawGround(cam, city, mode);
      var i;
      for (i = 0; i < city.props.length; i++) drawProp(cam, city.props[i], mode);
      for (i = 0; i < city.landmarks.length; i++) drawLandmark(cam, city.landmarks[i], mode, t);
      // One painter's list, far (north) to near (south), so a car on
      // the far side of a building goes under its front face and a
      // car on the near side goes over it.
      var sorted = city.buildings.slice().sort(function (a, b) { return a.y - b.y; });
      var drawList = [];
      for (i = 0; i < sorted.length; i++) drawList.push({ y: sorted[i].y + sorted[i].d, kind: 'building', b: sorted[i] });
      for (i = 0; i < city.palms.length; i++) drawList.push({ y: city.palms[i].y, kind: 'palm', palm: city.palms[i] });
      var cars = state.cars || [];
      for (i = 0; i < cars.length; i++) drawList.push({ y: cars[i].y, kind: 'car', car: cars[i] });
      if (state.player.vehicle) drawList.push({ y: state.player.vehicle.y, kind: 'hero', car: state.player.vehicle });
      var peds = state.peds || [];
      for (i = 0; i < peds.length; i++) drawList.push({ y: peds[i].y, kind: 'ped', ped: peds[i] });
      if (!state.player.vehicle) drawList.push({ y: state.player.y, kind: 'ped', ped: state.player });
      drawList.sort(function (a, b) { return a.y - b.y; });
      for (i = 0; i < drawList.length; i++) {
        var d = drawList[i];
        if (d.kind === 'building') {
          if (inView(cam, d.b.x, d.b.y, 260)) drawBuilding(cam, d.b, mode);
        } else if (d.kind === 'palm') {
          if (inView(cam, d.palm.x, d.palm.y, 60)) drawPalm(cam, d.palm, mode);
        } else if (d.kind === 'car') {
          drawCar(cam, d.car, mode);
        } else if (d.kind === 'hero') {
          if (d.car.kind === 'heli') drawHeli(cam, d.car, mode);
          else drawCar(cam, d.car, mode);
        } else if (d.kind === 'ped') {
          drawPerson(cam, d.ped, mode);
        }
      }
      // The Gull on her pad (or AIR-1's own draw call, which passes
      // through drawHeli directly) — a heli is drawn as a heli, never
      // as a car, whether she is parked or being flown.
      if (state.gull && state.gull !== state.player.vehicle) drawHeli(cam, state.gull, mode);
      drawFlashes(cam);
      // Golden-hour tint + haze wash over everything.
      ctx.fillStyle = m.tint;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      if (state.weather && state.weather.haze > 0.05) {
        ctx.fillStyle = 'rgba(225,228,238,' + (state.weather.haze * 0.35).toFixed(2) + ')';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      // Night vignette, lighter than before so the frame never looks
      // flat or near-black.
      if (mode === 'night' || mode === 'dusk') {
        var vg = ctx.createRadialGradient(canvas.width / 2, canvas.height / 2, canvas.height * 0.35, canvas.width / 2, canvas.height / 2, canvas.height * 0.85);
        vg.addColorStop(0, 'rgba(0,0,20,0)');
        vg.addColorStop(1, 'rgba(0,0,20,0.30)');
        ctx.fillStyle = vg;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      drawReticle(cam, state);
      ctx.restore();
      return mode;
    }

    return {
      render: render, resize: resize, project: project,
      addShake: addShake, addFlash: addFlash, drawHeli: drawHeli,
      modeForMinutes: modeForMinutes, shade: shade
    };
  }

  window.PalmaRender = { makeRenderer: makeRenderer, modeForMinutes: modeForMinutes };
})();
