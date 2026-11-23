// Palma Verde — city generation and collision.
//
// CITY API (what later builders can call on window.PalmaWorld):
//   buildCity(seed) -> city
//       Builds the whole map once and returns it. The city object carries
//       width/height, the road lists, every building, palm, prop and
//       landmark, plus the spawn points. Call it once at boot; keep the
//       result and hand it to the renderer and the physics.
//   districtAt(city, x, y) -> district record or null
//       Which of the seven districts a world point sits in, or null when
//       the point is over the ocean or outside the map.
//   roadAt(city, x, y) -> { axis, line, dist } or null
//       The nearest road centreline within half a road width, with the
//       axis ('x' for a vertical avenue, 'y' for a horizontal street),
//       the line coordinate, and how far the point is from the centre.
//   isSolid(city, x, y) -> true/false
//       True when a point is inside a building, a landmark base, a palm
//       trunk, the ocean, or outside the map bounds. Movement and
//       vehicles ask this before stepping.
//   nearestRoadPoint(city, x, y) -> { x, y }
//       Snaps any point onto the closest road centreline. Traffic,
//       police and mission markers use it to stay on the streets.
//   randomRoadSpot(city, rng) -> { x, y, angle }
//       A random drivable spot with a heading along its road, for
//       spawning parked cars, traffic and cruisers.
//   findSpawn(city, kind) -> { x, y }
//       Named starts: 'player' (Boardwalk kerb), 'cometa' (the hero car
//       lot), 'pier' (end of the pier), 'wheel' (under the ferris wheel).
//
// A city is plain data: { width, height, avenues, streets, buildings,
// palms, props, landmarks, spawns }. Buildings are { x, y, w, d, h,
// district, roof, wall }. Palms are { x, y, lean }. Props are
// { x, y, kind } where kind is 'umbrella', 'bench', 'hydrant',
// 'crate', 'lamp' or 'stall'. Landmarks are { kind, x, y, ... }.

(function () {
  'use strict';

  var CFG = window.PalmaConfig;
  var CITY_W = CFG.CITY.width;
  var CITY_H = CFG.CITY.height;
  var OCEAN_X = CFG.CITY.oceanX;
  var BEACH_X = CFG.CITY.beachX;
  var ROAD_HALF = 17;

  // Small deterministic random source so the same seed builds the same
  // city every run. Two different seeds give two different cities.
  function makeRng(seed) {
    var s = seed >>> 0;
    if (s === 0) s = 1234567;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function pick(rng, arr) {
    return arr[Math.floor(rng() * arr.length)];
  }

  function inRect(x, y, r) {
    return x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1;
  }

  function districtAt(city, x, y) {
    for (var i = 0; i < city.districts.length; i++) {
      if (inRect(x, y, city.districts[i])) return city.districts[i];
    }
    return null;
  }

  function roadAt(city, x, y) {
    var best = null;
    var i, d;
    for (i = 0; i < city.avenues.length; i++) {
      d = Math.abs(x - city.avenues[i]);
      if (d <= ROAD_HALF && (!best || d < best.dist)) {
        best = { axis: 'x', line: city.avenues[i], dist: d };
      }
    }
    for (i = 0; i < city.streets.length; i++) {
      d = Math.abs(y - city.streets[i]);
      if (d <= ROAD_HALF && (!best || d < best.dist)) {
        best = { axis: 'y', line: city.streets[i], dist: d };
      }
    }
    return best;
  }

  function isSolid(city, x, y) {
    if (x < OCEAN_X + 6 || x > CITY_W - 8 || y < 8 || y > CITY_H - 8) return true;
    if (x < BEACH_X) return false; // sand and water are walkable in the shallows
    var i, b;
    for (i = 0; i < city.buildings.length; i++) {
      b = city.buildings[i];
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.d) return true;
    }
    for (i = 0; i < city.landmarks.length; i++) {
      var lm = city.landmarks[i];
      if (lm.solid && x >= lm.x - lm.r && x <= lm.x + lm.r &&
          y >= lm.y - lm.r && y <= lm.y + lm.r) return true;
    }
    for (i = 0; i < city.palms.length; i++) {
      var p = city.palms[i];
      var dx = x - p.x, dy = y - p.y;
      if (dx * dx + dy * dy < 36) return true;
    }
    return false;
  }

  function nearestRoadPoint(city, x, y) {
    var ax = city.avenues[0], ay = city.streets[0];
    var i, d, best = 1e9;
    for (i = 0; i < city.avenues.length; i++) {
      d = Math.abs(x - city.avenues[i]);
      if (d < best) { best = d; ax = city.avenues[i]; }
    }
    best = 1e9;
    for (i = 0; i < city.streets.length; i++) {
      d = Math.abs(y - city.streets[i]);
      if (d < best) { best = d; ay = city.streets[i]; }
    }
    if (Math.abs(x - ax) <= Math.abs(y - ay)) return { x: ax, y: y };
    return { x: x, y: ay };
  }

  function randomRoadSpot(city, rng) {
    var vertical = rng() < 0.5;
    if (vertical) {
      var ax = pick(rng, city.avenues);
      return { x: ax + (rng() < 0.5 ? -8 : 8), y: 240 + rng() * (CITY_H - 480), angle: rng() < 0.5 ? -Math.PI / 2 : Math.PI / 2 };
    }
    var sy = pick(rng, city.streets);
    return { x: 420 + rng() * (CITY_W - 840), y: sy + (rng() < 0.5 ? -8 : 8), angle: rng() < 0.5 ? 0 : Math.PI };
  }

  function buildCity(seed) {
    var rng = makeRng(seed);
    var avenues = [];
    var streets = [];
    var x, y;
    for (x = 420; x <= 4020; x += 360) avenues.push(x);
    for (y = 300; y <= 2860; y += 320) streets.push(y);

    var buildings = [];
    var palms = [];
    var props = [];

    // Fill every block between two avenues and two streets with one to
    // four buildings, leaving a sidewalk gap along the road edges.
    var ai, si, bx, by, bw, bd;
    for (ai = 0; ai < avenues.length - 1; ai++) {
      for (si = 0; si < streets.length - 1; si++) {
        bx = avenues[ai] + 34;
        by = streets[si] + 34;
        bw = avenues[ai + 1] - avenues[ai] - 68;
        bd = streets[si + 1] - streets[si] - 68;
        if (bw < 60 || bd < 60) continue;
        var cx = bx + bw / 2, cy = by + bd / 2;
        var d = districtAt({ districts: CFG.DISTRICTS }, cx, cy) || CFG.DISTRICTS[3];
        var tall = d.id === 'northgate' || d.id === 'palmheights';
        var count = rng() < 0.45 ? 1 : (rng() < 0.6 ? 2 : 4);
        if (count === 1) {
          buildings.push({
            x: bx + 8, y: by + 8, w: bw - 16, d: bd - 16,
            h: tall ? 90 + rng() * 130 : 34 + rng() * 46,
            district: d.id, roof: d.roof, wall: d.wall, trim: d.trim
          });
        } else if (count === 2) {
          var split = rng() < 0.5;
          if (split) {
            buildings.push({ x: bx + 6, y: by + 6, w: bw / 2 - 12, d: bd - 12, h: 30 + rng() * 60, district: d.id, roof: d.roof, wall: d.wall, trim: d.trim });
            buildings.push({ x: bx + bw / 2 + 6, y: by + 6, w: bw / 2 - 12, d: bd - 12, h: 30 + rng() * 60, district: d.id, roof: d.roof, wall: d.wall, trim: d.trim });
          } else {
            buildings.push({ x: bx + 6, y: by + 6, w: bw - 12, d: bd / 2 - 12, h: 30 + rng() * 60, district: d.id, roof: d.roof, wall: d.wall, trim: d.trim });
            buildings.push({ x: bx + 6, y: by + bd / 2 + 6, w: bw - 12, d: bd / 2 - 12, h: 30 + rng() * 60, district: d.id, roof: d.roof, wall: d.wall, trim: d.trim });
          }
        } else {
          var qw = bw / 2, qd = bd / 2;
          var q;
          for (q = 0; q < 4; q++) {
            buildings.push({
              x: bx + (q % 2) * qw + 6, y: by + Math.floor(q / 2) * qd + 6,
              w: qw - 12, d: qd - 12, h: 26 + rng() * 44,
              district: d.id, roof: d.roof, wall: d.wall, trim: d.trim
            });
          }
        }
        // A palm or two on the block corners, clear of the road.
        if (rng() < 0.7) palms.push({ x: bx + 10, y: by + 10, lean: (rng() - 0.5) * 0.5 });
        if (rng() < 0.5) palms.push({ x: bx + bw - 10, y: by + bd - 10, lean: (rng() - 0.5) * 0.5 });
      }
    }

    // Beach row: palms and umbrellas along the sand, west of the first avenue.
    var i;
    for (i = 0; i < 46; i++) {
      var py = 220 + rng() * (CITY_H - 440);
      palms.push({ x: 210 + rng() * 70, y: py, lean: (rng() - 0.5) * 0.6 });
      if (rng() < 0.55) props.push({ x: 205 + rng() * 80, y: py + 26, kind: 'umbrella' });
    }
    // Boardwalk props: benches and lamps down the beachfront avenue.
    for (y = 340; y < CITY_H - 200; y += 160) {
      props.push({ x: 398, y: y, kind: 'lamp' });
      if (rng() < 0.6) props.push({ x: 386, y: y + 40, kind: 'bench' });
    }
    // Market stalls on Citrus Lane and crates by the docks.
    for (i = 0; i < 18; i++) {
      props.push({ x: 500 + rng() * 1400, y: 1080 + rng() * 640, kind: 'stall' });
    }
    for (i = 0; i < 22; i++) {
      props.push({ x: 1600 + rng() * 1000, y: 2000 + rng() * 1100, kind: 'crate' });
    }
    for (i = 0; i < 14; i++) {
      props.push({ x: 480 + rng() * 3400, y: 320 + rng() * 2600, kind: 'hydrant' });
    }

    var landmarks = [
      { kind: 'wheel', name: 'Palma Wheel', x: 330, y: 1500, r: 46, solid: true, height: 150 },
      { kind: 'pier', name: 'Venn Pier', x: 150, y: 1740, r: 30, solid: false, length: 170 },
      { kind: 'bridge', name: 'Marina Bridge', x: 780, y: 210, r: 60, solid: false, span: 260 },
      { kind: 'tower', name: 'Faro Tower', x: 3600, y: 620, r: 40, solid: true, height: 260 },
      { kind: 'stadium', name: 'Corriente Bowl', x: 3300, y: 2400, r: 90, solid: true, height: 60 }
    ];

    var spawns = {
      player: { x: 470, y: 2060 },
      cometa: { x: 1560, y: 640 },
      pier: { x: 160, y: 1740 },
      wheel: { x: 400, y: 1500 }
    };

    var city = {
      width: CITY_W, height: CITY_H, seed: seed,
      avenues: avenues, streets: streets,
      districts: CFG.DISTRICTS,
      buildings: buildings, palms: palms, props: props,
      landmarks: landmarks, spawns: spawns
    };
    return city;
  }

  function findSpawn(city, kind) {
    return city.spawns[kind] || city.spawns.player;
  }

  window.PalmaWorld = {
    buildCity: buildCity,
    districtAt: districtAt,
    roadAt: roadAt,
    isSolid: isSolid,
    nearestRoadPoint: nearestRoadPoint,
    randomRoadSpot: randomRoadSpot,
    findSpawn: findSpawn,
    makeRng: makeRng
  };
})();
