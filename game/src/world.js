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
//       A random drivable spot with a heading along its road, on the
//       CORRECT side for right-hand traffic: northbound on the east
//       side of an avenue, southbound on the west side, eastbound on
//       the south side of a street, westbound on the north side.
//   beachRoadPoint(city, y) -> { x, y }
//       A point on the Boardwalk beach road at height y. The road runs
//       parallel to the shoreline for the full height of the map, so
//       the chase staging route is beachRoadPoint(city, y) for any y.
//   findSpawn(city, kind) -> { x, y }
//       Named starts: 'player' (Boardwalk kerb), 'cometa' (the hero car
//       lot), 'pier' (end of the pier), 'wheel' (under the ferris wheel).
//
// WORLD.BEACH = { oceanX0: 0, oceanX1: 180, sandX1: 540, beachRoadX: 600 }
//   The beachfront geometry, in world units. The render builder reads
//   it by name (window.PalmaWorld.BEACH) to draw the ocean, the sand
//   and the city ground, so these four numbers are the single source
//   of truth for where the water ends and the city starts:
//     oceanX0   west edge of the map; the ocean starts here (0)
//     oceanX1   shoreline: the water ends and the sand begins (180)
//     sandX1    the sand ends and the city ground begins (540). The
//               sand band 180..540 is 360 wide — three times the old
//               120-wide strip — so the beach reads as a beach, with
//               room for umbrellas, towels and beachgoers between the
//               road and the water.
//     beachRoadX centreline of the Boardwalk beach road (600), running
//               parallel to the shoreline for the full height of the map.
//
// A city is plain data: { width, height, avenues, streets, buildings,
// palms, props, landmarks, spawns }. Buildings are { x, y, w, d, h,
// district, roof, wall, trim }. Palms are { x, y, lean }. Props are
// { x, y, kind } where kind is one of:
//   'umbrella' beach umbrella on the sand, 'towel' beach towel,
//   'bench' kerb bench, 'lamp' street lamp, 'hydrant' fire hydrant,
//   'crate' dock crate, 'container' dock shipping container,
//   'stall' market stall in a Citrus Lane aisle,
//   'awning' shopfront awning on a ground floor facing the road,
//   'neon' neon shop sign on a commercial frontage,
//   'trafficlight' traffic-light pole at a junction corner.
// Landmarks are { kind, x, y, ... }.
//
// The seven districts each read differently, not just by name:
//   Marina — white stucco mid-rises by the water.
//   Old Town — low tile-roof houses, narrow lanes.
//   Northgate — tall glass towers by the north gate.
//   Citrus Lane — low market blocks, stall aisles, neon shopfronts.
//   Boardwalk — mid arcades and surf shops along the beach road.
//   The Docks — low warehouses, container rows, crates.
//   Palm Heights — tall villas on the hill, garden walls.

(function () {
  'use strict';

  var CFG = window.PalmaConfig;

  // WORLD.BEACH — see the header. The render builder reads these four
  // numbers by name to draw ocean / sand / city ground.
  var BEACH = { oceanX0: 0, oceanX1: 180, sandX1: 540, beachRoadX: 600 };

  var CITY_W = CFG.CITY.width;
  var CITY_H = CFG.CITY.height;
  var OCEAN_X = BEACH.oceanX1; // 180 — matches CFG.CITY.oceanX
  var BEACH_X = BEACH.sandX1;  // 540 — sand ends here, city begins
  var ROAD_HALF = 17;

  // Building height range per district, [low, high]. Northgate and
  // Palm Heights tower; Old Town and the Docks stay low and flat;
  // Citrus Lane and the Boardwalk sit in the middle with shopfronts.
  var HEIGHTS = {
    marina: [30, 62], oldtown: [22, 42], northgate: [90, 220],
    citrus: [26, 52], boardwalk: [30, 56], docks: [18, 30],
    palmheights: [70, 170]
  };

  // Districts whose ground floors face the road with shopfronts:
  // awnings on the frontage, neon signs on the corners.
  var COMMERCIAL = { citrus: true, boardwalk: true, marina: true };

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
    if (x < BEACH_X) return false; // sand and shallows are walkable
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

  function beachRoadPoint(city, y) {
    var yy = y;
    if (yy < 320) yy = 320;
    if (yy > city.height - 320) yy = city.height - 320;
    return { x: BEACH.beachRoadX, y: yy };
  }

  function randomRoadSpot(city, rng) {
    var vertical = rng() < 0.5;
    if (vertical) {
      var ax = pick(rng, city.avenues);
      var north = rng() < 0.5;
      // Right-hand traffic: northbound runs on the east side of the
      // avenue, southbound on the west side.
      return {
        x: ax + (north ? 8 : -8),
        y: 240 + rng() * (CITY_H - 480),
        angle: north ? -Math.PI / 2 : Math.PI / 2
      };
    }
    var sy = pick(rng, city.streets);
    var east = rng() < 0.5;
    // Right-hand traffic: eastbound runs on the south side of the
    // street, westbound on the north side. Horizontal spots start
    // east of the beach road, never on the sand.
    return {
      x: BEACH.beachRoadX + 60 + rng() * (CITY_W - BEACH.beachRoadX - 480),
      y: sy + (east ? 8 : -8),
      angle: east ? 0 : Math.PI
    };
  }

  function bHeight(rng, d) {
    var r = HEIGHTS[d.id] || [30, 60];
    return r[0] + rng() * (r[1] - r[0]);
  }

  function buildCity(seed) {
    var rng = makeRng(seed);
    var avenues = [];
    var streets = [];
    var x, y;
    // The first avenue IS the Boardwalk beach road, parallel to the
    // shoreline; the grid runs east from there in 360 steps.
    for (x = BEACH.beachRoadX; x <= 4020; x += 360) avenues.push(x);
    for (y = 300; y <= 2860; y += 320) streets.push(y);

    var buildings = [];
    var palms = [];
    var props = [];

    // Fill every block between two avenues and two streets with one to
    // four buildings, leaving a sidewalk gap along the road edges.
    // Heights follow the district: towers in Northgate and Palm
    // Heights, low roofs in Old Town and the Docks.
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
        var count = rng() < 0.45 ? 1 : (rng() < 0.6 ? 2 : 4);
        if (count === 1) {
          buildings.push({
            x: bx + 8, y: by + 8, w: bw - 16, d: bd - 16,
            h: bHeight(rng, d),
            district: d.id, roof: d.roof, wall: d.wall, trim: d.trim
          });
        } else if (count === 2) {
          var split = rng() < 0.5;
          if (split) {
            buildings.push({ x: bx + 6, y: by + 6, w: bw / 2 - 12, d: bd - 12, h: bHeight(rng, d) * 0.8, district: d.id, roof: d.roof, wall: d.wall, trim: d.trim });
            buildings.push({ x: bx + bw / 2 + 6, y: by + 6, w: bw / 2 - 12, d: bd - 12, h: bHeight(rng, d) * 0.8, district: d.id, roof: d.roof, wall: d.wall, trim: d.trim });
          } else {
            buildings.push({ x: bx + 6, y: by + 6, w: bw - 12, d: bd / 2 - 12, h: bHeight(rng, d) * 0.8, district: d.id, roof: d.roof, wall: d.wall, trim: d.trim });
            buildings.push({ x: bx + 6, y: by + bd / 2 + 6, w: bw - 12, d: bd / 2 - 12, h: bHeight(rng, d) * 0.8, district: d.id, roof: d.roof, wall: d.wall, trim: d.trim });
          }
        } else {
          var qw = bw / 2, qd = bd / 2;
          var q;
          for (q = 0; q < 4; q++) {
            buildings.push({
              x: bx + (q % 2) * qw + 6, y: by + Math.floor(q / 2) * qd + 6,
              w: qw - 12, d: qd - 12, h: bHeight(rng, d) * 0.7,
              district: d.id, roof: d.roof, wall: d.wall, trim: d.trim
            });
          }
        }
        // A palm or two on the block corners, clear of the road.
        if (rng() < 0.7) palms.push({ x: bx + 10, y: by + 10, lean: (rng() - 0.5) * 0.5 });
        if (rng() < 0.5) palms.push({ x: bx + bw - 10, y: by + bd - 10, lean: (rng() - 0.5) * 0.5 });
      }
    }

    // Shopfronts: awnings on the ground floor facing the road and neon
    // signs on the corners, only in the commercial districts, so a
    // market street never looks like a warehouse row.
    var i, b;
    for (i = 0; i < buildings.length; i++) {
      b = buildings[i];
      if (!COMMERCIAL[b.district]) continue;
      if (rng() < 0.55) {
        props.push({
          x: b.x + 16 + rng() * Math.max(8, b.w - 32),
          y: b.y + b.d + 6, kind: 'awning'
        });
      }
      if ((b.district === 'citrus' || b.district === 'boardwalk') && rng() < 0.4) {
        props.push({ x: b.x - 4, y: b.y + 12, kind: 'neon' });
      }
    }

    // The beach: two palm rows flanking the beach road — one on the
    // sand side, one on the city side — so the boulevard reads as a
    // boulevard, not a lone tree line.
    for (y = 340; y < CITY_H - 160; y += 130) {
      palms.push({ x: BEACH.sandX1 - 26, y: y, lean: (rng() - 0.5) * 0.5 });
      palms.push({ x: BEACH.beachRoadX + 42, y: y + 65, lean: (rng() - 0.5) * 0.5 });
    }
    // Umbrellas and towels spread across the wide sand, between the
    // road and the water, where the beachgoers walk.
    for (i = 0; i < 34; i++) {
      var uy = 260 + rng() * (CITY_H - 520);
      var ux = 225 + rng() * 220;
      props.push({ x: ux, y: uy, kind: 'umbrella' });
      if (rng() < 0.6) {
        props.push({ x: ux + 20 + rng() * 14, y: uy + 22 + rng() * 10, kind: 'towel' });
      }
    }
    // A few palms scattered across the open sand, clear of the rows.
    for (i = 0; i < 12; i++) {
      palms.push({ x: 240 + rng() * 240, y: 260 + rng() * (CITY_H - 520), lean: (rng() - 0.5) * 0.6 });
    }
    // Boardwalk kerb: lamps on the sand side of the beach road,
    // benches on the city side.
    for (y = 340; y < CITY_H - 200; y += 160) {
      props.push({ x: BEACH.beachRoadX - 40, y: y, kind: 'lamp' });
      if (rng() < 0.6) props.push({ x: BEACH.beachRoadX + 40, y: y + 40, kind: 'bench' });
    }

    // Citrus Lane market: stalls in two parallel aisles inside the
    // block between the 1260 and 1580 streets, so shoppers walk a
    // lane between the rows instead of past scattered boxes.
    for (x = 700; x <= 2000; x += 82) {
      props.push({ x: x, y: 1380, kind: 'stall' });
      props.push({ x: x + 40, y: 1462, kind: 'stall' });
    }

    // The Docks: shipping containers in rows and crates stacked by
    // the warehouse blocks, so the district reads industrial.
    for (x = 1700; x <= 2500; x += 110) {
      for (y = 2100; y <= 2950; y += 150) {
        if (rng() < 0.7) props.push({ x: x, y: y, kind: 'container' });
      }
    }
    for (i = 0; i < 22; i++) {
      props.push({ x: 1600 + rng() * 1000, y: 2000 + rng() * 1100, kind: 'crate' });
    }
    for (i = 0; i < 14; i++) {
      props.push({ x: 680 + rng() * 3400, y: 320 + rng() * 2600, kind: 'hydrant' });
    }

    // Traffic-light poles at the junction corners: every junction on
    // the beach road, and every other junction elsewhere, so every
    // junction in a staged shot has a light to stop at.
    for (ai = 0; ai < avenues.length; ai++) {
      for (si = 0; si < streets.length; si++) {
        if (ai === 0 || ai % 2 === 0 || si % 2 === 0) {
          props.push({ x: avenues[ai] + 24, y: streets[si] + 24, kind: 'trafficlight' });
        }
      }
    }

    var landmarks = [
      { kind: 'wheel', name: 'Palma Wheel', x: 330, y: 1500, r: 46, solid: true, height: 150 },
      { kind: 'pier', name: 'Venn Pier', x: 150, y: 1740, r: 30, solid: false, length: 170 },
      { kind: 'bridge', name: 'Marina Bridge', x: 780, y: 210, r: 60, solid: false, span: 260 },
      { kind: 'tower', name: 'Faro Tower', x: 3600, y: 620, r: 40, solid: true, height: 260 },
      { kind: 'stadium', name: 'Corriente Bowl', x: 3300, y: 2400, r: 90, solid: true, height: 60 }
    ];

    var spawns = {
      player: { x: 634, y: 2060 },
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
    BEACH: BEACH,
    buildCity: buildCity,
    districtAt: districtAt,
    roadAt: roadAt,
    isSolid: isSolid,
    nearestRoadPoint: nearestRoadPoint,
    beachRoadPoint: beachRoadPoint,
    randomRoadSpot: randomRoadSpot,
    findSpawn: findSpawn,
    makeRng: makeRng
  };
})();
