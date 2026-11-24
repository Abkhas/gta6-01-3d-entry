// Palma Verde 3D — procedural city builder.
// Everything is generated from the config: no external models, no textures
// fetched from the web. Facades, sand and planks are painted on canvases
// at build time. One deterministic seed drives the whole layout so the
// city is identical on every load.

import * as THREE from 'three';
import { CFG3D, districtAt } from './config3d.js';

// Deterministic RNG: the same seed always grows the same city.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- canvas texture helpers -------------------------------------------

function canvasTexture(w, h, painter) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  painter(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// A building face: wall colour with a grid of windows. `litShare` is the
// share of windows that glow warm at night; the emissive canvas holds only
// those lit windows, so the glow can be dialled by time of day. `type`
// picks the facade family: 'brick' (mortar courses + lintels), 'glass'
// (curtain wall: big panes, thin mullions) or 'concrete' (floor shadow
// bands, small punched windows). Each lit window takes its own warm
// colour, so night facades are varied instead of one flat amber.
const LIT_WINDOW_COLORS = ['#ffd98a', '#ffb45c', '#ff9a4d', '#ffe9b0', '#ff8a5c'];
// `rngB` is the B4 stream: every new random pick (lit colours, brick
// patches, glass pane tones) draws from it, so the main stream — and
// therefore the building layout — is unchanged.
function facadeTextures(wall, trim, litShare, rng, type, rngB) {
  const cols = 5 + Math.floor(rng() * 3);
  const rows = 9 + Math.floor(rng() * 6);
  const wins = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      wins.push([c, r, rng() < litShare, LIT_WINDOW_COLORS[Math.floor(rngB() * LIT_WINDOW_COLORS.length)]]);
    }
  }
  const map = canvasTexture(128, 256, (g, w, h) => {
    g.fillStyle = wall; g.fillRect(0, 0, w, h);
    const cw = w / cols, rh = h / rows;
    if (type === 'brick') {
      // Mortar courses + a few darker/lighter bricks so the wall is not flat.
      g.fillStyle = 'rgba(0,0,0,0.18)';
      for (let y = 0; y < h; y += 10) g.fillRect(0, y, w, 1);
      for (let i = 0; i < 40; i++) {
        g.fillStyle = rngB() < 0.5 ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.06)';
        g.fillRect(Math.floor(rngB() * 16) * 8, Math.floor(rngB() * 25) * 10, 8, 10);
      }
    } else if (type === 'glass') {
      // Curtain wall: the face is mostly glass; thin metal mullions grid it.
      g.fillStyle = '#22374e'; g.fillRect(0, 0, w, h);
      for (const [c, r] of wins) {
        g.fillStyle = rngB() < 0.5 ? '#33506e' : '#2a4258';
        g.fillRect(c * cw + 1, r * rh + 1, cw - 2, rh - 2);
      }
      g.fillStyle = '#9fb4c8';
      for (let c = 0; c <= cols; c++) g.fillRect(c * cw - 1, 0, 2, h);
      for (let r = 0; r <= rows; r++) g.fillRect(0, r * rh - 1, w, 2);
    } else if (type === 'ribbon') {
      // R7 ribbon windows: a continuous dark glass band per floor with
      // thin vertical fins — the mid-rise office look, distinct from the
      // curtain-wall grid (glass) and the punched concrete.
      g.fillStyle = '#2b3a4a';
      for (let r = 0; r < rows; r++) {
        g.fillRect(0, r * rh + rh * 0.28, w, rh * 0.44);
        g.fillStyle = rngB() < 0.5 ? '#3a4f63' : '#31455a';
        g.fillRect(0, r * rh + rh * 0.28, w, rh * 0.44);
      }
      g.fillStyle = '#8b98a5';
      for (let c = 0; c <= cols; c++) g.fillRect(c * cw - 0.5, 0, 1, h);
    } else if (type === 'punched') {
      // R7 brick punched-window: warm brick + small deep-set windows with
      // a dark reveal and a concrete lintel — the old-town / market face.
      g.fillStyle = 'rgba(0,0,0,0.18)';
      for (let y = 0; y < h; y += 10) g.fillRect(0, y, w, 1);
      for (let i = 0; i < 40; i++) {
        g.fillStyle = rngB() < 0.5 ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.06)';
        g.fillRect(Math.floor(rngB() * 16) * 8, Math.floor(rngB() * 25) * 10, 8, 10);
      }
    } else if (type === 'balcony') {
      // R7 balcony slab: concrete with tall door-windows — the instanced
      // balcony slabs + rails (world builder) hang off these openings.
      g.fillStyle = 'rgba(0,0,0,0.12)';
      for (let r = 0; r <= rows; r++) g.fillRect(0, r * rh, w, 2);
      g.fillStyle = trim;
      for (let r = 0; r < rows; r++) g.fillRect(0, r * rh + rh * 0.82, w, 2);
    } else {
      // Concrete: a shadow band at every floor line, small windows.
      g.fillStyle = 'rgba(0,0,0,0.16)';
      for (let r = 0; r <= rows; r++) g.fillRect(0, r * rh, w, 3);
    }
    g.fillStyle = trim; g.fillRect(0, 0, w, 6); g.fillRect(0, h - 6, w, 6);
    for (const [c, r, lit, litColor] of wins) {
      if (type === 'glass') {
        if (lit) {
          g.fillStyle = litColor;
          g.fillRect(c * cw + 2, r * rh + 2, cw - 4, rh - 4);
        }
        continue;
      }
      if (type === 'brick') {
        // Stone lintel above each window.
        g.fillStyle = trim;
        g.fillRect(c * cw + cw * 0.15, r * rh + rh * 0.12, cw * 0.7, 2);
      }
      if (type === 'punched') {
        // R7: dark reveal around a small deep-set window + lintel.
        g.fillStyle = 'rgba(0,0,0,0.35)';
        g.fillRect(c * cw + cw * 0.1, r * rh + rh * 0.15, cw * 0.8, rh * 0.7);
        g.fillStyle = trim;
        g.fillRect(c * cw + cw * 0.15, r * rh + rh * 0.12, cw * 0.7, 2);
        g.fillStyle = lit ? litColor : '#20262e';
        g.fillRect(c * cw + cw * 0.28, r * rh + rh * 0.28, cw * 0.44, rh * 0.44);
        continue;
      }
      if (type === 'balcony') {
        // R7: tall door-window the balcony slab hangs off.
        g.fillStyle = lit ? litColor : '#2c3a4a';
        g.fillRect(c * cw + cw * 0.25, r * rh + rh * 0.08, cw * 0.5, rh * 0.72);
        continue;
      }
      if (type === 'ribbon') {
        // R7: lit pane sits inside the glass band (rh 0.28..0.72).
        g.fillStyle = lit ? litColor : '#26313d';
        g.fillRect(c * cw + cw * 0.15, r * rh + rh * 0.32, cw * 0.7, rh * 0.36);
        continue;
      }
      g.fillStyle = lit ? litColor : '#2c3a4a';
      g.fillRect(c * cw + cw * 0.2, r * rh + rh * 0.22, cw * 0.6, rh * 0.56);
    }
  });
  const emissive = canvasTexture(128, 256, (g, w, h) => {
    g.fillStyle = '#000000'; g.fillRect(0, 0, w, h);
    const cw = w / cols, rh = h / rows;
    for (const [c, r, lit, litColor] of wins) {
      if (!lit) continue;
      g.fillStyle = litColor;
      // R7: the glow rect matches the map window rect per facade type.
      if (type === 'punched') g.fillRect(c * cw + cw * 0.28, r * rh + rh * 0.28, cw * 0.44, rh * 0.44);
      else if (type === 'balcony') g.fillRect(c * cw + cw * 0.25, r * rh + rh * 0.08, cw * 0.5, rh * 0.72);
      else if (type === 'ribbon') g.fillRect(c * cw + cw * 0.15, r * rh + rh * 0.32, cw * 0.7, rh * 0.36);
      else g.fillRect(c * cw + cw * 0.2, r * rh + rh * 0.22, cw * 0.6, rh * 0.56);
    }
  });
  return { map, emissive };
}

function sandTexture(rng) {
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#d9c08a'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) {
      g.fillStyle = rng() < 0.5 ? '#c9ac72' : '#e8d5a4';
      g.fillRect(rng() * w, rng() * h, 2, 2);
    }
  });
}

function plankTexture() {
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#7a5a38'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 32) {
      g.fillStyle = y % 64 === 0 ? '#86663f' : '#6e4f30';
      g.fillRect(0, y, w, 30);
      g.fillStyle = '#4a3520'; g.fillRect(0, y + 30, w, 2);
    }
  });
}

// ---- world ------------------------------------------------------------

export function buildWorld(scene, CFG = CFG3D) {
  const rng = mulberry32(20261124);
  // B4: a second deterministic stream for every B4 addition (facade
  // types, height variation, rooftop props, storefronts, blade signs).
  // The main stream is untouched, so the building layout, footprints and
  // colliders stay byte-identical to the r5 city.
  const rngB4 = mulberry32(20261124 ^ 0xb400);
  const group = new THREE.Group();
  group.name = 'PalmaVerdeWorld';
  scene.add(group);

  const HALF = CFG.CITY_HALF;
  const BLOCK = CFG.BLOCK;
  const ROAD_W = CFG.ROAD_WIDTH;
  const HW_W = CFG.HIGHWAY_WIDTH;
  const HW_N = CFG.HIGHWAY_NORTH_Z;
  const HW_E = CFG.HIGHWAY_EAST_X;

  const colliders = [];   // { x0, z0, x1, z1, h } — building footprints
  const buildings = [];   // { mesh, district, h, x, z }
  const junctions = [];   // { x, z } road crossings (traffic-light sites)
  const trafficLights = [];
  const facadeMats = [];  // materials whose emissiveIntensity tracks night
  const neonMats = [];    // neon sign materials, bright at night
  const roadCentres = []; // road centreline coordinates, one axis

  for (let c = -HALF; c <= HALF; c += BLOCK) roadCentres.push(c);

  const mat = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0.0, ...opts });

  function box(w, h, d, material, x, y, z, parent = group) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    m.position.set(x, y, z);
    m.castShadow = h > 4;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  // ---- ground, beach, ocean -------------------------------------------
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(HALF * 2 + 200, HALF * 2 + 200),
    mat('#4c5541'),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, -0.2, 0);
  ground.receiveShadow = true;
  group.add(ground);

  const sandTex = sandTexture(rng);
  sandTex.wrapS = sandTex.wrapT = THREE.RepeatWrapping;
  sandTex.repeat.set(3, 10);
  const beach = new THREE.Mesh(
    new THREE.PlaneGeometry(CFG.SHORE_X - CFG.BEACH_X + 240, HALF * 2 + 400),
    new THREE.MeshStandardMaterial({ map: sandTex, roughness: 1 }),
  );
  beach.rotation.x = -Math.PI / 2;
  beach.position.set((CFG.BEACH_X + CFG.SHORE_X) / 2 - 20, -0.1, 0);
  beach.receiveShadow = true;
  group.add(beach);

  const ocean = new THREE.Mesh(
    new THREE.PlaneGeometry(CFG.SHORE_X - CFG.OCEAN_X + 400, HALF * 2 + 800),
    new THREE.MeshStandardMaterial({ color: '#1d5f7a', roughness: 0.35, metalness: 0.15 }),
  );
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.set((CFG.SHORE_X + CFG.OCEAN_X) / 2 - 40, -0.6, 0);
  ocean.receiveShadow = true;
  group.add(ocean);

  // ---- roads ------------------------------------------------------------
  // Ordinary streets run along every grid line except the two highway
  // lines; the highways get their own wider strips below.
  // B3 road polish: asphalt lifted out of near-black so it reads in the
  // golden-hour chase, and the pavement is now clearly lighter than the
  // road — the sidewalk strips double as the light curb edge.
  // R7 flicker fix: the road/sidewalk/highway planes were ALL coplanar
  // at y=0 (89 planes), so every intersection shimmered. Each layer now
  // sits at its own height AND carries a polygonOffset, so the draw
  // order is deterministic even at long range where depth precision
  // is thin: roads pushed back, sidewalks forward, highways between,
  // dashes always on top.
  const roadMat = mat('#4a4e56', { roughness: 0.95, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  const walkMat = mat('#9ba1a8', { roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  const hwMat = mat('#3d4048', { roughness: 0.95, polygonOffset: true, polygonOffsetFactor: 0, polygonOffsetUnits: -1 });

  function roadStrip(x, z, w, d, material, y = 0.02) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), material);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y, z);
    m.receiveShadow = true;
    group.add(m);
    return m;
  }

  for (const c of roadCentres) {
    // East-west streets (vary z) and north-south streets (vary x).
    if (c !== HW_N) {
      roadStrip(0, c, HALF * 2, ROAD_W, roadMat, 0.02);
      roadStrip(0, c - ROAD_W / 2 - 2, HALF * 2, 4, walkMat, 0.05);
      roadStrip(0, c + ROAD_W / 2 + 2, HALF * 2, 4, walkMat, 0.05);
    }
    if (c !== HW_E) {
      roadStrip(c, 0, ROAD_W, HALF * 2, roadMat, 0.02);
      roadStrip(c - ROAD_W / 2 - 2, 0, 4, HALF * 2, walkMat, 0.05);
      roadStrip(c + ROAD_W / 2 + 2, 0, 4, HALF * 2, walkMat, 0.05);
    }
  }
  // Highways: wider, fenced, no cross streets.
  roadStrip(0, HW_N, HALF * 2, HW_W, hwMat, 0.035);
  roadStrip(HW_E, 0, HW_W, HALF * 2, hwMat, 0.035);
  // B4: the beach road — the chase runs NORTH up it (x = BEACH_X - 30),
  // but it was bare ground with no asphalt and no lane markings, so the
  // chase shot read as driving on grass. Give it a real strip, kerbs and
  // centre dashes (added to dashSpots below).
  const BEACH_ROAD_X = CFG.BEACH_X - 30;
  roadStrip(BEACH_ROAD_X, 0, ROAD_W, HALF * 2, roadMat, 0.02);
  roadStrip(BEACH_ROAD_X - ROAD_W / 2 - 2, 0, 4, HALF * 2, walkMat, 0.05);
  roadStrip(BEACH_ROAD_X + ROAD_W / 2 + 2, 0, 4, HALF * 2, walkMat, 0.05);
  const barrierMat = mat('#8a8f94', { roughness: 0.8 });
  box(HALF * 2, 1.2, 1, barrierMat, 0, 0.6, HW_N - HW_W / 2 - 1);
  box(HALF * 2, 1.2, 1, barrierMat, 0, 0.6, HW_N + HW_W / 2 + 1);
  box(1, 1.2, HALF * 2, barrierMat, HW_E - HW_W / 2 - 1, 0.6, 0);
  box(1, 1.2, HALF * 2, barrierMat, HW_E + HW_W / 2 + 1, 0.6, 0);

  // Lane dashes, instanced: one thin white box per dash, both directions.
  // B3: near-white and longer so the centre lines read at chase distance.
  // R7: raised to y=0.09 (was 0.03 — the box bottom sat exactly ON the
  // road plane at y=0 and z-fought at intersections) + polygonOffset so
  // dashes always win the depth test against road and sidewalk.
  const dashGeo = new THREE.BoxGeometry(6, 0.06, 0.5);
  const dashMat = new THREE.MeshBasicMaterial({ color: '#f5f8fa', polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const dashSpots = [];
  for (const c of roadCentres) {
    if (c === HW_N || c === HW_E) continue;
    for (let t = -HALF + 40; t <= HALF - 40; t += 40) {
      if (Math.abs(t - HW_N) < 30 || Math.abs(t - HW_E) < 30) continue;
      dashSpots.push([t, 0.09, c, 0]);       // along east-west street
      dashSpots.push([c, 0.09, t, 1]);       // along north-south street
    }
  }
  // B4: centre dashes up the beach road (skip the pier crossing).
  for (let t = -HALF + 40; t <= HALF - 40; t += 40) {
    if (Math.abs(t - HW_N) < 30 || Math.abs(t - CFG.PIER_Z) < 45) continue;
    dashSpots.push([BEACH_ROAD_X, 0.09, t, 1]);
  }
  const dashes = new THREE.InstancedMesh(dashGeo, dashMat, dashSpots.length);
  const dummy = new THREE.Object3D();
  dashSpots.forEach(([x, y, z, rot], i) => {
    dummy.position.set(x, y, z);
    dummy.rotation.set(0, rot ? Math.PI / 2 : 0, 0);
    dummy.updateMatrix();
    dashes.setMatrixAt(i, dummy.matrix);
  });
  dashes.instanceMatrix.needsUpdate = true;
  group.add(dashes);

  // ---- buildings ----------------------------------------------------------
  // One block = the square between four road centrelines. Each block holds
  // one large building or up to four small ones, by district density.
  const facadeCache = new Map();
  // R7: 6 facade families (was 3). 'glass' is the curtain-wall grid;
  // 'ribbon' is the horizontal-band office face; 'punched' is brick
  // with small deep-set windows; 'balcony' carries the instanced
  // balcony slabs. Assigned per district with a little mix.
  function facadeTypeFor(district, rng) {
    const r = rng();
    if (district.id === 'northgate') return r < 0.5 ? 'glass' : 'ribbon';
    if (district.id === 'oldtown') return r < 0.5 ? 'brick' : 'punched';
    if (district.id === 'citrus') return r < 0.4 ? 'brick' : r < 0.7 ? 'punched' : 'balcony';
    if (district.id === 'boardwalk') return r < 0.5 ? 'balcony' : 'concrete';
    if (district.id === 'palmheights') return r < 0.6 ? 'balcony' : 'concrete';
    if (district.id === 'marina') return r < 0.4 ? 'balcony' : 'concrete';
    return 'concrete';
  }
  function facadeMatFor(district) {
    if (!facadeCache.has(district.id)) {
      const set = [];
      for (let v = 0; v < 3; v++) {
        // R7: keep the facade TYPE next to its material so the builder
        // can hang type-specific geometry (balcony slabs) off it.
        const ftype = facadeTypeFor(district, rngB4);
        const t = facadeTextures(district.wall, district.trim, 0.25 + rng() * 0.25, rng, ftype, rngB4);
        const m = new THREE.MeshStandardMaterial({
          map: t.map, emissiveMap: t.emissive, emissive: new THREE.Color('#ffb45c'),
          emissiveIntensity: 0.15, roughness: 0.85,
        });
        set.push({ m, type: ftype });
        facadeMats.push(m);
      }
      facadeCache.set(district.id, set);
    }
    return facadeCache.get(district.id);
  }

  // B4: real 3D facade relief — floor-slab lips, mullion strips and
  // corner pillars are collected per building and drawn as three
  // InstancedMeshes, so the window bands read recessed instead of flat
  // without a draw call per building. Parapets likewise. Rooftop props
  // and storefronts are ordinary meshes (few dozen each).
  const ledgeMat = mat('#cfc8b8', { roughness: 0.95 });
  const mullionMat = mat('#33383f', { roughness: 0.7, metalness: 0.2 });
  const parapetMat = mat('#4a4640', { roughness: 0.95 });
  const acMat = mat('#9aa0a6', { roughness: 0.6, metalness: 0.4 });
  const tankMat = mat('#8a6f4d', { roughness: 0.9 });
  const antMat = mat('#5a5f66', { roughness: 0.5, metalness: 0.6 });
  const skylightMat = new THREE.MeshStandardMaterial({ color: '#9fc4d8', roughness: 0.15, metalness: 0.4 });
  const ledgeSpots = [];    // [x, y, z, sx, sy, sz] floor-slab lips
  const mullionSpots = [];  // [x, y, z, sx, sy, sz] vertical strips + pillars
  const parapetSpots = [];  // [x, y, z, sx, sy, sz] roof-edge walls
  let tallestGen = null;    // tallest generated building (gets a beacon)
  // R7: spots may carry an optional 7th element [rx, ry, rz] (e.g. tilted
  // stall awnings) and instancedBoxes may take per-spot colours
  // (setColorAt — base material must be white for true colours).
  function instancedBoxes(spots, material, colors) {
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, spots.length);
    spots.forEach(([x, y, z, sx, sy, sz, rot], i) => {
      dummy.position.set(x, y, z);
      dummy.scale.set(sx, sy, sz);
      dummy.rotation.set(rot ? rot[0] : 0, rot ? rot[1] : 0, rot ? rot[2] : 0);
      dummy.updateMatrix();
      im.setMatrixAt(i, dummy.matrix);
      if (colors) im.setColorAt(i, colors[i]);
    });
    im.instanceMatrix.needsUpdate = true;
    if (colors && im.instanceColor) im.instanceColor.needsUpdate = true;
    im.receiveShadow = true;
    group.add(im);
    // The shared dummy is reused by palms/pools below — leave it clean.
    dummy.scale.set(1, 1, 1);
    dummy.rotation.set(0, 0, 0);
    return im;
  }

  // B4: aviation beacon — red, blinking, on the tallest tower. The live
  // loop has no per-frame world hook, so the material blinks itself in
  // onBeforeRender (fires every rendered frame); updateBeacon below is
  // the deterministic twin for staged shots.
  const beaconMat = new THREE.MeshStandardMaterial({
    color: '#ff5c7a', emissive: new THREE.Color('#ff2a4a'), emissiveIntensity: 2.6,
  });
  beaconMat.onBeforeRender = function () {
    const t = (typeof performance !== 'undefined' ? performance.now() : 0) / 1000;
    beaconMat.emissiveIntensity = (t % 2.0) < 1.6 ? 2.6 : 0.15;
  };
  function updateBeacon(timeS) {
    const cycle = ((timeS % 2.0) + 2.0) % 2.0;
    beaconMat.emissiveIntensity = cycle < 1.6 ? 2.6 : 0.15;
  }

  // B4: striped shop awnings + coloured fascia boards for ground floors.
  const awningTexB4 = canvasTexture(128, 64, (g, w, h) => {
    for (let x = 0; x < w; x += 16) {
      g.fillStyle = (x / 16) % 2 === 0 ? '#e2725b' : '#f2ead8';
      g.fillRect(x, 0, 16, h);
    }
  });
  awningTexB4.wrapS = awningTexB4.wrapT = THREE.RepeatWrapping;
  const awningMatB4 = new THREE.MeshStandardMaterial({ map: awningTexB4, roughness: 0.9, side: THREE.DoubleSide });
  const fasciaMats = ['#e2725b', '#2a9d8f', '#e9c46a', '#4361ee'].map((c) => mat(c, { roughness: 0.7, side: THREE.DoubleSide }));

  // ---- R7 empty-lot fills -----------------------------------------------
  // Rule: no bare flat ground inside the playable city. Every block the
  // density roll skips (and the 12 district-less central blocks) gets one
  // lot archetype. Props are collected as instanced spots and drawn once
  // after the building loop — a handful of draw calls for ~60 lots.
  // All new random draws come from rngB4, so the main stream — and the
  // building layout / footprints / colliders — stay byte-identical.
  const lotTreeSpots = [];   // [x, z] — merged into palmSpots later
  const benchSpots = [];     // seat + back, one InstancedMesh
  const carBodySpots = []; const carCabinSpots = []; const carColors = [];
  const baySpots = [];       // parking-bay white lines
  const padSpots = []; const padColors = []; // lot ground pads (thin boxes)
  const stallCounterSpots = []; const stallAwningSpots = [];
  const stallGoodsSpots = []; const stallGoodsColors = [];
  const fenceSpots = [];     // construction hoarding / vacant-lot fence
  const basinSpots = []; const waterSpots = []; // fountain basin + water
  const hedgeSpots = [];     // park hedge border
  const moundSpots = [];     // dirt mounds
  const lotContainerSpots = []; const lotContainerColors = [];
  const balconySpots = [];   // balcony slabs (ledgeMat)
  const stats = {
    emptyLots: 0, lotFills: {}, storefronts: 0, rooftopSigns: 0,
    midBlockLamps: 0, mansards: 0, setbacks: 0, podiums: 0, balconies: 0,
  };
  let constructionLots = 0, vacantLots = 0;
  const CAR_COLORS = ['#c0392b', '#2e6f7e', '#e8a13a', '#6a8f5a', '#8c5a8c', '#d8d8d2', '#3a3f45', '#7a2e3a'];
  const GOODS_COLORS = ['#e07840', '#e8c53a', '#6a8f5a', '#e86a92', '#3d7ea6'];
  const PAD_COLORS = { asphalt: '#3a3d42', paving: '#b9b3a4', dirt: '#8a6f4d' };
  const benchMat = mat('#6e4f30', { roughness: 1 });
  const carBodyMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.35, metalness: 0.4 });
  const carCabinMat = new THREE.MeshStandardMaterial({ color: '#1c2836', roughness: 0.25, metalness: 0.5 });
  const bayMat = new THREE.MeshBasicMaterial({ color: '#e8e8e8' });
  const padWhiteMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1 });
  const stallCounterMat = mat('#6e4f30', { roughness: 1 });
  const stallGoodsMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9 });
  const fenceMat = mat('#d8c49a', { roughness: 1 });
  const basinMat = mat('#9a938a', { roughness: 0.9 });
  const waterMat = new THREE.MeshStandardMaterial({ color: '#2a7a9e', roughness: 0.2, metalness: 0.1 });
  const hedgeMat = mat('#2e5b34', { roughness: 1 });
  const moundMat = mat('#8a6f4d', { roughness: 1 });
  const lotContainerMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85, metalness: 0.2 });
  const comingSoonTex = canvasTexture(256, 96, (g, w, h) => {
    g.fillStyle = '#e8e0cc'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#2a2a2a'; g.font = 'bold 34px sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('COMING SOON', w / 2, h / 2);
  });
  const comingSoonMat = new THREE.MeshStandardMaterial({ map: comingSoonTex, roughness: 0.9, side: THREE.DoubleSide });
  function lotCount(kind) { stats.lotFills[kind] = (stats.lotFills[kind] || 0) + 1; stats.emptyLots++; }
  function addPad(x, z, w, d, kind) {
    padSpots.push([x, -0.07, z, w, 0.2, d]);
    padColors.push(new THREE.Color(PAD_COLORS[kind]));
  }
  function addBench(x, z, alongX) {
    if (alongX) {
      benchSpots.push([x, 0.45, z, 1.8, 0.12, 0.55]);
      benchSpots.push([x, 0.8, z - 0.28, 1.8, 0.55, 0.1]);
    } else {
      benchSpots.push([x, 0.45, z, 0.55, 0.12, 1.8]);
      benchSpots.push([x - 0.28, 0.8, z, 0.1, 0.55, 1.8]);
    }
  }
  function addParkedCar(x, z, ry) {
    carBodySpots.push([x, 0.55, z, 4.4, 1.1, 1.9, [0, ry, 0]]);
    carCabinSpots.push([x, 1.35, z, 2.2, 0.7, 1.7, [0, ry, 0]]);
    carColors.push(new THREE.Color(CAR_COLORS[Math.floor(rngB4() * CAR_COLORS.length)]));
    const hx = ry === 0 ? 2.2 : 0.95, hz = ry === 0 ? 0.95 : 2.2;
    colliders.push({ x0: x - hx, z0: z - hz, x1: x + hx, z1: z + hz, h: 1.6 });
  }
  function addLotStall(x, z) {
    stallCounterSpots.push([x, 1.2, z, 10, 2.4, 5]);
    stallAwningSpots.push([x, 4.2, z, 11, 0.12, 6, [-Math.PI / 2 + 0.5, 0, 0]]);
    stallGoodsSpots.push([x, 2.9, z, 8, 1, 3.5]);
    stallGoodsColors.push(new THREE.Color(GOODS_COLORS[Math.floor(rngB4() * GOODS_COLORS.length)]));
    colliders.push({ x0: x - 5, z0: z - 2.5, x1: x + 5, z1: z + 2.5, h: 3 });
  }
  function addHedgeBorder(cx, cz) {
    hedgeSpots.push([cx, 0.4, cz - 74, 148, 0.8, 1]);
    hedgeSpots.push([cx, 0.4, cz + 74, 148, 0.8, 1]);
    hedgeSpots.push([cx - 74, 0.4, cz, 1, 0.8, 148]);
    hedgeSpots.push([cx + 74, 0.4, cz, 1, 0.8, 148]);
  }
  function addFenceBorder(cx, cz, hgt) {
    fenceSpots.push([cx, hgt / 2, cz - 74, 150, hgt, 0.3]);
    fenceSpots.push([cx, hgt / 2, cz + 74, 150, hgt, 0.3]);
    fenceSpots.push([cx - 74, hgt / 2, cz, 0.3, hgt, 150]);
    fenceSpots.push([cx + 74, hgt / 2, cz, 0.3, hgt, 150]);
  }
  function fillParking(cx, cz) {
    lotCount('parking');
    addPad(cx, cz, 154, 154, 'asphalt');
    const n = 5 + Math.floor(rngB4() * 3);
    for (let i = 0; i < n; i++) {
      const x = cx - 55 + i * 22 + (rngB4() - 0.5) * 4;
      const z = cz + (rngB4() < 0.5 ? -28 : 28);
      if (rngB4() < 0.2) continue; // ~80% occupancy — one empty bay reads lived-in
      addParkedCar(x, z, 0);
      baySpots.push([x - 3.4, 0.06, z, 0.18, 0.02, 5.4]);
    }
  }
  function fillPark(cx, cz) {
    lotCount('park');
    const nT = 3 + Math.floor(rngB4() * 3);
    for (let i = 0; i < nT; i++) lotTreeSpots.push([cx + (rngB4() - 0.5) * 120, cz + (rngB4() - 0.5) * 120]);
    addPad(cx, cz, 150, 6, 'paving');
    addPad(cx, cz, 6, 150, 'paving');
    addBench(cx - 20, cz + 8, true);
    addBench(cx + 20, cz - 8, false);
    addHedgeBorder(cx, cz);
  }
  function fillPlaza(cx, cz) {
    lotCount('plaza');
    addPad(cx, cz, 154, 154, 'paving');
    basinSpots.push([cx, 0.5, cz, 7, 1.0, 7]);
    waterSpots.push([cx, 0.85, cz, 6, 0.3, 6]);
    addBench(cx - 25, cz - 25, true);
    addBench(cx + 25, cz - 25, true);
    addBench(cx - 25, cz + 25, true);
    addBench(cx + 25, cz + 25, true);
    lotTreeSpots.push([cx - 55, cz - 55]);
    lotTreeSpots.push([cx + 55, cz + 55]);
  }
  function fillMarket(cx, cz) {
    lotCount('market');
    addPad(cx, cz, 154, 154, 'paving');
    const n = 4 + Math.floor(rngB4() * 4);
    for (let i = 0; i < n; i++) {
      addLotStall(cx - 55 + (i % 4) * 36, cz + (i < 4 ? -28 : 28));
    }
  }
  function fillConstruction(cx, cz) {
    if (constructionLots >= 3) { fillParking(cx, cz); return; }
    constructionLots++;
    lotCount('construction');
    addPad(cx, cz, 154, 154, 'dirt');
    addFenceBorder(cx, cz, 2.2);
    lotContainerSpots.push([cx - 30, 1.6, cz - 20, 14, 3.2, 3.4, [0, 0.06, 0]]);
    lotContainerColors.push(new THREE.Color('#c0392b'));
    colliders.push({ x0: cx - 37.5, z0: cz - 23, x1: cx - 22.5, z1: cz - 17, h: 3.2 });
    moundSpots.push([cx + 35, 1.0, cz + 25, 16, 2.0, 16]);
    fenceSpots.push([cx + 40, 3, cz - 40, 0.3, 6, 0.3]);
    fenceSpots.push([cx + 48, 3, cz - 40, 0.3, 6, 0.3]);
    fenceSpots.push([cx + 44, 5.5, cz - 40, 8.5, 0.3, 0.3]);
  }
  function fillVacant(cx, cz) {
    if (vacantLots >= 2) { fillPark(cx, cz); return; }
    vacantLots++;
    lotCount('vacant');
    addFenceBorder(cx, cz, 1.2);
    const board = new THREE.Mesh(new THREE.PlaneGeometry(10, 3), comingSoonMat);
    board.position.set(cx, 2.2, cz - 40);
    group.add(board);
    fenceSpots.push([cx - 4, 1, cz - 40, 0.3, 2, 0.3]);
    fenceSpots.push([cx + 4, 1, cz - 40, 0.3, 2, 0.3]);
  }
  function fillEmptyLot(cx, cz, district) {
    const r = rngB4();
    if (district.id === 'citrus' || district.id === 'boardwalk') {
      if (r < 0.4) fillMarket(cx, cz);
      else if (r < 0.7) fillPlaza(cx, cz);
      else fillParking(cx, cz);
    } else if (district.id === 'northgate' || district.id === 'docks') {
      if (r < 0.5) fillParking(cx, cz);
      else if (r < 0.75) fillConstruction(cx, cz);
      else fillPlaza(cx, cz);
    } else {
      if (r < 0.5) fillPark(cx, cz);
      else if (r < 0.75) fillPlaza(cx, cz);
      else if (r < 0.9) fillParking(cx, cz);
      else fillVacant(cx, cz);
    }
  }
  // The 12 district-less central blocks: one big central park, not bare grass.
  function fillCentralPark(cx, cz) {
    lotCount('central-park');
    const nT = 6 + Math.floor(rngB4() * 3);
    for (let i = 0; i < nT; i++) lotTreeSpots.push([cx + (rngB4() - 0.5) * 130, cz + (rngB4() - 0.5) * 130]);
    addPad(cx, cz, 150, 6, 'paving');
    addPad(cx, cz, 6, 150, 'paving');
    basinSpots.push([cx, 0.5, cz, 8, 1.0, 8]);
    waterSpots.push([cx, 0.85, cz, 7, 0.3, 7]);
    addBench(cx - 30, cz - 20, true);
    addBench(cx + 30, cz - 20, true);
    addBench(cx - 30, cz + 20, true);
    addBench(cx + 30, cz + 20, true);
    addHedgeBorder(cx, cz);
  }

  const blockN = Math.round((HALF * 2) / BLOCK); // 14 blocks per side
  // Landmark blocks are reserved for hand-placed landmarks (CFG.LANDMARKS);
  // no generated buildings grow here.
  const landmarkBlocks = new Set(['-1100,-900', '900,-900', '-700,100', '300,900', '300,1100', '700,1100']);
  for (let bi = 0; bi < blockN; bi++) {
    for (let bj = 0; bj < blockN; bj++) {
      const cx = -HALF + (bi + 0.5) * BLOCK;
      const cz = -HALF + (bj + 0.5) * BLOCK;
      if (landmarkBlocks.has(cx + ',' + cz)) continue;
      // Highway corridors stay clear.
      if (Math.abs(cz - HW_N) < HW_W / 2 + BLOCK / 2) continue;
      if (Math.abs(cx - HW_E) < HW_W / 2 + BLOCK / 2) continue;
      const district = districtAt(cx, cz);
      // R7: never bare ground — district-less centre blocks become the
      // central park, density-skipped blocks get a filled lot archetype.
      if (!district) { fillCentralPark(cx, cz); continue; }
      if (rng() > district.density) { fillEmptyLot(cx, cz, district); continue; }
      const facades = facadeMatFor(district);
      const roofMat = mat(district.roof, { roughness: 0.9 });
      const [hMin, hMax] = district.height;
      const inset = ROAD_W / 2 + CFG.SIDEWALK + 12;
      const span = BLOCK - inset * 2;
      const lots = rng() < 0.45 ? 1 : 4;
      for (let l = 0; l < lots; l++) {
        const lx = lots === 1 ? cx : cx + (l % 2 === 0 ? -span / 4 : span / 4);
        const lz = lots === 1 ? cz : cz + (l < 2 ? -span / 4 : span / 4);
        const w = (lots === 1 ? span * (0.7 + rng() * 0.25) : span * 0.42);
        const d = (lots === 1 ? span * (0.7 + rng() * 0.25) : span * 0.42);
        // B4: wider height variation — downtown spikes, low-rise bias in
        // the residential districts, occasional mid-rise spike elsewhere.
        // (rngB4: the main stream, and the footprints, are untouched.)
        let h = hMin + rng() * (hMax - hMin);
        if (district.id === 'northgate') {
          if (rngB4() < 0.22) h = Math.min(h * 1.35, 190);
        } else if (district.id === 'palmheights' || district.id === 'boardwalk' || district.id === 'marina') {
          h = hMin + Math.pow(rngB4(), 1.6) * (hMax - hMin);
        } else if (rngB4() < 0.12) {
          h = Math.min(h * 1.3, hMax * 1.5);
        }
        const fm = facades[Math.floor(rng() * facades.length)];
        // R7 roof archetypes (decided up front so the beacon + collider
        // can account for them): podium+tower (wide 2-storey retail base,
        // narrow tower above), stepped setback (tall towers), mansard
        // pitched roof (low residential). All rngB4 — layout untouched.
        const isPodium = lots === 1 && (district.id === 'citrus' || district.id === 'northgate' || district.id === 'docks') && rngB4() < 0.2;
        const podiumW = w * 1.3, podiumD = d * 1.3, podiumH = 6;
        const towerH = isPodium ? h - podiumH : h;
        const towerY = isPodium ? podiumH + towerH / 2 : h / 2;
        const frontW = isPodium ? podiumW : w; // ground-floor front width
        const frontD = isPodium ? podiumD : d; // ground-floor front depth
        const isMansard = !isPodium && h < 20 && (district.id === 'palmheights' || district.id === 'boardwalk' || district.id === 'marina') && rngB4() < 0.35;
        const isSetback = !isPodium && !isMansard && h > 55 && rngB4() < 0.5;
        const setH = isSetback ? Math.max(4, h * 0.1) : 0;
        const tower = new THREE.Mesh(new THREE.BoxGeometry(w, towerH, d), fm.m);
        tower.position.set(lx, towerY, lz);
        tower.castShadow = true;
        tower.receiveShadow = true;
        group.add(tower);
        if (isPodium) {
          // Plain stucco base (the facade texture would squeeze 9–15
          // storeys into 6 m); the shopfronts break it up.
          const podium = new THREE.Mesh(new THREE.BoxGeometry(podiumW, podiumH, podiumD), mat(district.wall, { roughness: 0.9 }));
          podium.position.set(lx, podiumH / 2, lz);
          podium.castShadow = true;
          podium.receiveShadow = true;
          group.add(podium);
          stats.podiums++;
        }
        // Flat roof slab in the district's roof colour.
        const slab = new THREE.Mesh(new THREE.BoxGeometry(w + 1, 1.2, d + 1), roofMat);
        slab.position.set(lx, h + 0.6, lz);
        slab.castShadow = true;
        group.add(slab);
        buildings.push({ mesh: tower, district, h, x: lx, z: lz, w, d, podium: isPodium ? { w: podiumW, d: podiumD } : null });
        // R7: the collider is the WIDEST visible footprint — the podium
        // when there is one, else the tower. Never a bare rect.
        const colW = isPodium ? podiumW / 2 : w / 2, colD = isPodium ? podiumD / 2 : d / 2;
        colliders.push({ x0: lx - colW, z0: lz - colD, x1: lx + colW, z1: lz + colD, h });
        if (!tallestGen || h > tallestGen.h) tallestGen = { x: lx, z: lz, h, w, d, setH };
        // B4: recessed window bands — a floor-slab lip at every 3 m
        // storey line, so the glazing sits behind the slab edge.
        // (Podium towers start their bands at the podium top.)
        const floors = Math.max(1, Math.round(towerH / 3));
        const ledgeBase = isPodium ? podiumH : 0;
        for (let f = 1; f < floors; f++) ledgeSpots.push([lx, ledgeBase + f * 3, lz, w + 0.5, 0.28, d + 0.5]);
        // B4: vertical mullion strips on the front/back faces + corner
        // pillars, proud of the wall by a few centimetres.
        const mullions = Math.max(2, Math.floor(w / 7));
        for (let m = 0; m <= mullions; m++) {
          const mx = lx - w / 2 + (m * w) / mullions;
          mullionSpots.push([mx, towerY, lz + d / 2 + 0.07, 0.32, towerH, 0.32]);
          mullionSpots.push([mx, towerY, lz - d / 2 - 0.07, 0.32, towerH, 0.32]);
        }
        for (const [px, pz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          mullionSpots.push([lx + px * (w / 2 + 0.05), towerY, lz + pz * (d / 2 + 0.05), 0.55, towerH, 0.55]);
        }
        // R7: balcony slabs + rails on 'balcony' facades (low/mid-rise).
        if (fm.type === 'balcony' && h <= 45) {
          for (let f = 1; f < floors; f++) {
            const by = ledgeBase + f * 3 + 0.15;
            for (let b = 0; b < 2; b++) {
              const bx = lx - w / 4 + b * (w / 2);
              balconySpots.push([bx, by, lz + d / 2 + 0.55, 2.4, 0.18, 1.1]);
              mullionSpots.push([bx, by + 0.55, lz + d / 2 + 1.05, 2.4, 0.9, 0.12]);
              stats.balconies++;
            }
          }
        }
        // B4: parapet — four low walls on the roof edge (not under a
        // mansard: a pitched roof needs no parapet).
        if (!isMansard) {
          const py = h + 1.2 + 0.5;
          parapetSpots.push([lx, py, lz + d / 2, w + 1, 1.0, 0.5]);
          parapetSpots.push([lx, py, lz - d / 2, w + 1, 1.0, 0.5]);
          parapetSpots.push([lx + w / 2, py, lz, 0.5, 1.0, d + 1]);
          parapetSpots.push([lx - w / 2, py, lz, 0.5, 1.0, d + 1]);
        }
        // R7: stepped setback — top floors inset on tall towers.
        if (isSetback) {
          const setback = new THREE.Mesh(new THREE.BoxGeometry(w * 0.62, setH, d * 0.62), fm.m);
          setback.position.set(lx, h + 1.2 + setH / 2, lz);
          setback.castShadow = true;
          group.add(setback);
          stats.setbacks++;
        }
        // R7: mansard — pitched pyramid roof on low residential.
        if (isMansard) {
          const pyr = new THREE.Mesh(new THREE.ConeGeometry(1, 4.5, 4), roofMat);
          pyr.scale.set(w * 0.72, 1, d * 0.72);
          pyr.rotation.y = Math.PI / 4;
          pyr.position.set(lx, h + 1.2 + 2.25, lz);
          pyr.castShadow = true;
          group.add(pyr);
          stats.mansards++;
        }
        // B4: rooftop props on a share of buildings — AC unit, water
        // tank, antenna or skylight, one per roof. (Not on mansards:
        // the pyramid occupies the roof.)
        if (!isMansard && rngB4() < 0.45 && w > 18 && d > 18) {
          const slabTop = h + 1.2;
          const rx = lx + (rngB4() - 0.5) * w * 0.4;
          const rz = lz + (rngB4() - 0.5) * d * 0.4;
          const pick = rngB4();
          if (pick < 0.35) {
            box(3, 1.4, 2.2, acMat, rx, slabTop + 0.7, rz);
          } else if (pick < 0.6) {
            const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 3.2, 10), tankMat);
            tank.position.set(rx, slabTop + 1.6, rz);
            tank.castShadow = true;
            group.add(tank);
            const cone = new THREE.Mesh(new THREE.ConeGeometry(1.8, 1.2, 10), tankMat);
            cone.position.set(rx, slabTop + 3.8, rz);
            group.add(cone);
          } else if (pick < 0.8) {
            const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 7, 6), antMat);
            ant.position.set(rx, slabTop + 3.5, rz);
            group.add(ant);
            box(2.4, 0.15, 0.15, antMat, rx, slabTop + 6.0, rz);
          } else {
            box(4, 0.7, 2.6, skylightMat, rx, slabTop + 0.35, rz);
          }
        }
        // B4: ground-floor storefront — glass, striped awning, fascia
        // board. R7: extended to every building facing a main avenue /
        // market street (target ~90–110, was 57), blade sign on 1 in 3
        // shops, and the front follows the podium when there is one.
        const shopP = district.id === 'citrus' || district.id === 'boardwalk' ? 0.85
          : district.id === 'marina' ? 0.4
          : district.id === 'oldtown' ? 0.35
          : district.id === 'docks' ? 0.2 : 0;
        if (shopP > 0 && rngB4() < shopP) {
          stats.storefronts++;
          const frontZ = lz + frontD / 2;
          const glassMat = new THREE.MeshStandardMaterial({
            color: '#1c2836', metalness: 0.55, roughness: 0.25,
            emissive: new THREE.Color('#ff9a3c'), emissiveIntensity: 0.1,
          });
          facadeMats.push(glassMat); // setWindowGlow warms it at night
          const glass = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(frontW * 0.8, 22), 3.0), glassMat);
          glass.position.set(lx, 1.9, frontZ + 0.28);
          group.add(glass);
          const awn = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(frontW * 0.85, 24), 2.4), awningMatB4);
          awn.rotation.x = -Math.PI / 2 + 0.45;
          awn.position.set(lx, 3.9, frontZ + 1.1);
          group.add(awn);
          box(Math.min(frontW * 0.6, 16), 1.1, 0.35, fasciaMats[Math.floor(rngB4() * fasciaMats.length)], lx, 4.9, frontZ + 0.3);
          // R7: blade sign — a fin perpendicular to the facade, read
          // from down the street, on 1 in 3 shops.
          if (rngB4() < 0.34) {
            const blade = new THREE.Mesh(
              new THREE.PlaneGeometry(1.2, 3.2),
              fasciaMats[Math.floor(rngB4() * fasciaMats.length)],
            );
            blade.rotation.y = Math.PI / 2;
            blade.position.set(lx - frontW * 0.3, 3.4, frontZ + 1.0);
            group.add(blade);
          }
        }
      }
    }
  }

  // B4: draw the collected facade relief as three instanced meshes.
  instancedBoxes(ledgeSpots, ledgeMat);
  instancedBoxes(mullionSpots, mullionMat);
  instancedBoxes(parapetSpots, parapetMat);
  // R7: draw the collected lot props + balcony slabs, each one
  // InstancedMesh — ~60 filled lots for ~15 draw calls.
  if (balconySpots.length) instancedBoxes(balconySpots, ledgeMat);
  if (benchSpots.length) instancedBoxes(benchSpots, benchMat);
  if (carBodySpots.length) instancedBoxes(carBodySpots, carBodyMat, carColors);
  if (carCabinSpots.length) instancedBoxes(carCabinSpots, carCabinMat);
  if (baySpots.length) instancedBoxes(baySpots, bayMat);
  if (padSpots.length) instancedBoxes(padSpots, padWhiteMat, padColors);
  if (stallCounterSpots.length) instancedBoxes(stallCounterSpots, stallCounterMat);
  if (stallAwningSpots.length) instancedBoxes(stallAwningSpots, awningMatB4);
  if (stallGoodsSpots.length) instancedBoxes(stallGoodsSpots, stallGoodsMat, stallGoodsColors);
  if (fenceSpots.length) instancedBoxes(fenceSpots, fenceMat);
  if (basinSpots.length) instancedBoxes(basinSpots, basinMat);
  if (waterSpots.length) instancedBoxes(waterSpots, waterMat);
  if (hedgeSpots.length) instancedBoxes(hedgeSpots, hedgeMat);
  if (moundSpots.length) instancedBoxes(moundSpots, moundMat);
  if (lotContainerSpots.length) instancedBoxes(lotContainerSpots, lotContainerMat, lotContainerColors);
  // B4: blinking beacon on the tallest generated building (Torre Brisa,
  // the overall tallest, gets the same material below). R7: the tip sits
  // above the setback when the tallest tower has one.
  if (tallestGen) {
    const genTip = new THREE.Mesh(new THREE.SphereGeometry(1.6, 10, 8), beaconMat);
    genTip.position.set(tallestGen.x, tallestGen.h + 1.2 + (tallestGen.setH || 0) + 1.6, tallestGen.z);
    group.add(genTip);
  }
  // R7: rooftop signs — 6–8 lit fascia names on the tallest roofs
  // (the title skyline reads as a city because of these; the names are
  // our own originals). One shared atlas canvas, one cloned texture
  // per sign, emissive at night via neonMats.
  {
    const ROOF_NAMES = ['HOTEL BRISA', 'PALMA SUITES', 'CASA VERDE', 'TORRE SOL', 'MARINA BAY', 'VISTA MAR', 'SOL Y MAR', 'EL FARO INN'];
    const ROOF_COLORS = ['#ffd98a', '#9fd8ff', '#ffb45c', '#e8e4da', '#ff9a4d', '#c8e8d8', '#ffe14d', '#ff8a7a'];
    const atlas = canvasTexture(2048, 64, (g, w, h) => {
      g.fillStyle = '#14181f'; g.fillRect(0, 0, w, h);
      g.font = 'bold 40px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      ROOF_NAMES.forEach((name, i) => {
        g.fillStyle = ROOF_COLORS[i];
        g.fillText(name, (i + 0.5) * (w / ROOF_NAMES.length), h / 2);
      });
    });
    const tallest = [...buildings].sort((a, b) => b.h - a.h);
    const chosen = [];
    for (const b of tallest) {
      if (chosen.length >= 8) break;
      if (chosen.some((o) => Math.hypot(o.x - b.x, o.z - b.z) < 200)) continue; // spread across the skyline
      chosen.push(b);
    }
    chosen.forEach((b, i) => {
      const tex = atlas.clone();
      tex.needsUpdate = true;
      tex.repeat.set(1 / ROOF_NAMES.length, 1);
      tex.offset.set(i / ROOF_NAMES.length, 0);
      const signMat = new THREE.MeshStandardMaterial({
        map: tex, emissiveMap: tex, emissive: new THREE.Color('#ffffff'),
        emissiveIntensity: 0.9, roughness: 0.7,
      });
      neonMats.push(signMat); // setNeonGlow lights it at night
      const signW = Math.min(b.w * 0.9, 26);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(signW, 3.6), signMat);
      sign.position.set(b.x, b.h + 3.4, b.z + b.d / 2 + 0.4);
      group.add(sign);
      const back = new THREE.Mesh(new THREE.BoxGeometry(signW, 3.8, 0.25), mat('#14181f', { roughness: 0.9 }));
      back.position.set(b.x, b.h + 3.4, b.z + b.d / 2 + 0.25);
      group.add(back);
      stats.rooftopSigns++;
    });
  }

  // ---- pier + wheel ------------------------------------------------------
  const pierGroup = new THREE.Group();
  pierGroup.name = 'Pier';
  group.add(pierGroup);
  const plankTex = plankTexture();
  plankTex.wrapS = plankTex.wrapT = THREE.RepeatWrapping;
  plankTex.repeat.set(8, 1);
  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(CFG.PIER_LENGTH, 1.5, CFG.PIER_WIDTH),
    new THREE.MeshStandardMaterial({ map: plankTex, roughness: 0.95 }),
  );
  deck.position.set(CFG.BEACH_X - CFG.PIER_LENGTH / 2 + 40, 1.2, CFG.PIER_Z);
  deck.castShadow = true;
  deck.receiveShadow = true;
  pierGroup.add(deck);
  const postMat = mat('#4a3826', { roughness: 1 });
  for (let t = 0; t <= CFG.PIER_LENGTH; t += 40) {
    for (const dz of [-CFG.PIER_WIDTH / 2 + 2, CFG.PIER_WIDTH / 2 - 2]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 6, 8), postMat);
      post.position.set(CFG.BEACH_X + 40 - t, -1, CFG.PIER_Z + dz);
      pierGroup.add(post);
    }
  }
  // Ferris wheel at the pier end: rim, spokes, cabins, slow spin.
  const wheel = new THREE.Group();
  const wheelX = CFG.BEACH_X - CFG.PIER_LENGTH + 90;
  wheel.position.set(wheelX, 34, CFG.PIER_Z);
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(26, 0.9, 8, 40),
    new THREE.MeshStandardMaterial({ color: '#e8e4da', roughness: 0.5, metalness: 0.4 }),
  );
  wheel.add(rim);
  const spokeMat = new THREE.MeshStandardMaterial({ color: '#c8ccd2', roughness: 0.5, metalness: 0.5 });
  for (let s = 0; s < 8; s++) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(1, 52, 1), spokeMat);
    spoke.rotation.z = (s * Math.PI) / 8;
    wheel.add(spoke);
  }
  const cabinMat = new THREE.MeshStandardMaterial({ color: '#e2725b', roughness: 0.6 });
  for (let s = 0; s < 8; s++) {
    const a = (s * Math.PI) / 4;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(4, 3.5, 4), cabinMat);
    cabin.position.set(Math.cos(a) * 26, Math.sin(a) * 26, 0);
    wheel.add(cabin);
  }
  pierGroup.add(wheel);
  const wheelLegA = box(1.5, 34, 1.5, spokeMat, wheelX - 6, 17, CFG.PIER_Z, pierGroup);
  const wheelLegB = box(1.5, 34, 1.5, spokeMat, wheelX + 6, 17, CFG.PIER_Z, pierGroup);
  wheelLegA.rotation.z = 0.18;
  wheelLegB.rotation.z = -0.18;

  // ---- landmarks ---------------------------------------------------------
  // Hand-placed, one of each kind, from CFG.LANDMARKS. Distinct silhouettes
  // so the skyline reads from the title screen and the chase camera.
  const landmarks = [];
  const yachts = [];

  // Hotel Miramar: a tall white slab with a lit crown, over the Marina.
  {
    const hm = new THREE.MeshStandardMaterial({ color: '#e8e2d4', roughness: 0.7 });
    const hotel = box(64, 96, 30, hm, -1100, 48, -900);
    const crownMat = new THREE.MeshStandardMaterial({
      color: '#ffd98a', emissive: new THREE.Color('#ffbe5c'), emissiveIntensity: 0.4,
    });
    neonMats.push(crownMat);
    box(66, 3, 32, crownMat, -1100, 97, -900);
    const hotelTex = facadeTextures('#e8e2d4', '#256b74', 0.4, rng, undefined, rngB4);
    hotel.material = new THREE.MeshStandardMaterial({
      map: hotelTex.map, emissiveMap: hotelTex.emissive,
      emissive: new THREE.Color('#ffb45c'), emissiveIntensity: 0.15, roughness: 0.7,
    });
    facadeMats.push(hotel.material);
    landmarks.push({ id: 'miramar', mesh: hotel });
    colliders.push({ x0: -1132, z0: -915, x1: -1068, z1: -885, h: 96 });
  }

  // Torre Brisa: Northgate's tallest needle, stepped glass crown.
  {
    const tm = new THREE.MeshStandardMaterial({ color: '#7fa0c4', roughness: 0.25, metalness: 0.55 });
    const tower = box(44, 170, 44, tm, 900, 85, -900);
    box(30, 26, 30, tm, 900, 183, -900);
    // B4: the tip is the aviation beacon — shared beaconMat blinks on its
    // own (onBeforeRender) and via updateBeacon; it is NOT in neonMats,
    // so setNeonGlow never fights the blink.
    const tip = new THREE.Mesh(new THREE.SphereGeometry(2.2, 10, 8), beaconMat);
    tip.position.set(900, 198, -900);
    group.add(tip);
    landmarks.push({ id: 'brisa', mesh: tower });
    colliders.push({ x0: 878, z0: -922, x1: 922, z1: -878, h: 196 });
  }

  // Faro de Palma: striped lighthouse at the pier end, lamp room glowing.
  {
    const lhGroup = new THREE.Group();
    lhGroup.position.set(-1900, 0, 1010);
    const stripeWhite = new THREE.MeshStandardMaterial({ color: '#f2ede2', roughness: 0.8 });
    const stripeRed = new THREE.MeshStandardMaterial({ color: '#c0392b', roughness: 0.8 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(6, 8, 10, 12), stripeWhite);
    base.position.y = 5;
    const mid = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 6, 16, 12), stripeRed);
    mid.position.y = 18;
    const top = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 4.5, 14, 12), stripeWhite);
    top.position.y = 33;
    const lampMat = new THREE.MeshStandardMaterial({
      color: '#fff6c8', emissive: new THREE.Color('#ffe98a'), emissiveIntensity: 2.4,
    });
    neonMats.push(lampMat);
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 5, 10), lampMat);
    lamp.position.y = 42;
    const cap = new THREE.Mesh(new THREE.ConeGeometry(4, 4, 10), stripeRed);
    cap.position.y = 46;
    lhGroup.add(base, mid, top, lamp, cap);
    lhGroup.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
    group.add(lhGroup);
    landmarks.push({ id: 'faro', mesh: lhGroup });
    // R7: the lighthouse was visible but walk-through — its base (radius
    // 8) gets a collider so it reads as solid.
    colliders.push({ x0: -1908, z0: 1002, x1: -1892, z1: 1018, h: 10 });
  }

  // Mercado Citrus: striped-awning stalls around the plaza block.
  {
    const awningTex = canvasTexture(128, 64, (g, w, h) => {
      for (let x = 0; x < w; x += 16) {
        g.fillStyle = (x / 16) % 2 === 0 ? '#e2725b' : '#f2ead8';
        g.fillRect(x, 0, 16, h);
      }
    });
    awningTex.wrapS = awningTex.wrapT = THREE.RepeatWrapping;
    const stallBaseMat = mat('#6e4f30', { roughness: 1 });
    const goodsColors = ['#e07840', '#e8c53a', '#6a8f5a', '#e86a92', '#3d7ea6'];
    const stalls = [];
    for (let i = 0; i < 10; i++) {
      const sx = -700 + (i % 5) * 34 - 68;
      const sz = 100 + (i < 5 ? -28 : 28);
      const stall = new THREE.Group();
      stall.position.set(sx, 0, sz);
      const counter = new THREE.Mesh(new THREE.BoxGeometry(10, 2.4, 5), stallBaseMat);
      counter.position.y = 1.2;
      counter.castShadow = true;
      const awning = new THREE.Mesh(
        new THREE.PlaneGeometry(11, 6),
        new THREE.MeshStandardMaterial({ map: awningTex, roughness: 0.9, side: THREE.DoubleSide }),
      );
      awning.rotation.x = -Math.PI / 2 + 0.5;
      awning.position.y = 4.2;
      const goods = new THREE.Mesh(
        new THREE.BoxGeometry(8, 1, 3.5),
        mat(goodsColors[i % goodsColors.length], { roughness: 0.9 }),
      );
      goods.position.y = 2.9;
      stall.add(counter, awning, goods);
      group.add(stall);
      stalls.push(stall);
      // R7: one small collider per stall (counter 10x5) — the old single
      // block collider (-790..-610 x 60..140) blocked the gaps BETWEEN
      // stalls, so the plaza felt full of invisible walls.
      colliders.push({ x0: sx - 5, z0: sz - 2.5, x1: sx + 5, z1: sz + 2.5, h: 3 });
    }
    landmarks.push({ id: 'mercado', mesh: stalls[0] });
  }

  // Muelle Viejo: container yard + two gantry cranes in The Docks.
  {
    const contColors = ['#c0392b', '#2e6f7e', '#e8a13a', '#6a8f5a', '#8c5a8c'];
    for (let s = 0; s < 3; s++) {
      for (let l = 0; l < 3; l++) {
        const cMat = mat(contColors[(s * 3 + l) % contColors.length], { roughness: 0.85, metalness: 0.2 });
        const c = box(14, 3.2, 3.4, cMat, 250 + s * 44, 1.6 + l * 3.3, 880 + (s % 2) * 18);
        c.rotation.y = 0.06 * s;
      }
      // R7: one collider per container stack — the exact rotated AABB
      // (14x3.4 box turned 0.06*s rad). The old single block
      // (240..380 x 860..920) blocked ~80% empty dock ground.
      const ccx = 250 + s * 44, ccz = 880 + (s % 2) * 18;
      const rot = 0.06 * s;
      const chx = 7 * Math.cos(rot) + 1.7 * Math.sin(rot);
      const chz = 1.7 * Math.cos(rot) + 7 * Math.sin(rot);
      colliders.push({ x0: ccx - chx, z0: ccz - chz, x1: ccx + chx, z1: ccz + chz, h: 10 });
    }
    const craneMat = new THREE.MeshStandardMaterial({ color: '#d8a13a', roughness: 0.6, metalness: 0.4 });
    for (const cx of [300, 700]) {
      const crane = new THREE.Group();
      crane.position.set(cx, 0, 1100);
      const legA = new THREE.Mesh(new THREE.BoxGeometry(2, 42, 2), craneMat);
      legA.position.set(-10, 21, 0);
      const legB = new THREE.Mesh(new THREE.BoxGeometry(2, 42, 2), craneMat);
      legB.position.set(10, 21, 0);
      const jib = new THREE.Mesh(new THREE.BoxGeometry(64, 2.5, 2.5), craneMat);
      jib.position.set(8, 43, 0);
      const cable = new THREE.Mesh(new THREE.BoxGeometry(0.4, 12, 0.4), craneMat);
      cable.position.set(28, 36, 0);
      const hook = new THREE.Mesh(new THREE.BoxGeometry(4, 3, 4), craneMat);
      hook.position.set(28, 29, 0);
      crane.add(legA, legB, jib, cable, hook);
      crane.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      group.add(crane);
      // R7: the crane legs were walk-through — one small collider each.
      colliders.push({ x0: cx - 11, z0: 1099, x1: cx - 9, z1: 1101, h: 42 });
      colliders.push({ x0: cx + 9, z0: 1099, x1: cx + 11, z1: 1101, h: 42 });
    }
    landmarks.push({ id: 'muelle', mesh: group });
  }

  // Yachts moored off the Marina shore: hull, mast and a white sail.
  {
    const hullMat = new THREE.MeshStandardMaterial({ color: '#f2f2ee', roughness: 0.4 });
    const sailMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, side: THREE.DoubleSide });
    const mastMat = new THREE.MeshStandardMaterial({ color: '#5a5148', roughness: 0.7 });
    for (let i = 0; i < 7; i++) {
      const y = new THREE.Group();
      const yx = -1740 - rng() * 160;
      const yz = -1250 + i * 130 + rng() * 40;
      y.position.set(yx, -0.2, yz);
      y.rotation.y = rng() * Math.PI * 2;
      const hull = new THREE.Mesh(new THREE.BoxGeometry(16, 2.6, 5), hullMat);
      hull.position.y = 1.0;
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 14, 6), mastMat);
      mast.position.y = 9;
      const sail = new THREE.Mesh(new THREE.PlaneGeometry(7, 11), sailMat);
      sail.position.set(2.2, 9, 0);
      y.add(hull, mast, sail);
      y.userData.phase = rng() * Math.PI * 2;
      group.add(y);
      yachts.push(y);
    }
  }

  // Beach umbrellas: instanced poles + striped canopies along the sand.
  // R7: denser (every ~36 m, was 55) + towels beside half of them —
  // the beach is a hero shot, it gets furniture, not bare sand.
  const umbrellaSpots = [];
  const towelSpots = []; const towelColors = [];
  const TOWEL_COLORS = ['#e2725b', '#2a9d8f', '#e9c46a', '#4361ee', '#e86a92'];
  for (let z = -HALF + 80; z <= HALF - 80; z += 36) {
    if (Math.abs(z - CFG.PIER_Z) < 90) continue; // keep the pier approach clear
    const ux = CFG.BEACH_X - 30 - rng() * 130;
    const uz = z + (rng() - 0.5) * 24;
    umbrellaSpots.push([ux, uz]);
    if (rngB4() < 0.5) {
      towelSpots.push([ux + 4 + rngB4() * 2, 0.06, uz + 2, 2.2, 0.08, 1.0, [0, rngB4() * Math.PI, 0]]);
      towelColors.push(new THREE.Color(TOWEL_COLORS[Math.floor(rngB4() * TOWEL_COLORS.length)]));
    }
  }
  {
    const poleGeo = new THREE.CylinderGeometry(0.12, 0.12, 3.4, 6);
    const poleMat = new THREE.MeshStandardMaterial({ color: '#e8e0cc', roughness: 0.9 });
    const poles = new THREE.InstancedMesh(poleGeo, poleMat, umbrellaSpots.length);
    const canopyGeo = new THREE.ConeGeometry(3.6, 1.6, 10, 1, true);
    const canopyMat = new THREE.MeshStandardMaterial({
      color: '#e2725b', roughness: 0.9, side: THREE.DoubleSide,
    });
    const canopies = new THREE.InstancedMesh(canopyGeo, canopyMat, umbrellaSpots.length);
    umbrellaSpots.forEach(([x, z], i) => {
      dummy.position.set(x, 1.7, z);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      poles.setMatrixAt(i, dummy.matrix);
      dummy.position.set(x, 3.9, z);
      dummy.rotation.set(0, rng() * Math.PI, 0);
      dummy.updateMatrix();
      canopies.setMatrixAt(i, dummy.matrix);
    });
    poles.instanceMatrix.needsUpdate = true;
    canopies.instanceMatrix.needsUpdate = true;
    group.add(poles);
    group.add(canopies);
  }
  // R7: towels beside the umbrellas (one InstancedMesh, coloured).
  if (towelSpots.length) {
    const towelMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1 });
    instancedBoxes(towelSpots, towelMat, towelColors);
  }
  // R7: lifeguard chair + volleyball net — the beach's furniture.
  {
    const chairMat = mat('#f2f2ee', { roughness: 0.8 });
    const lgX = CFG.BEACH_X - 15, lgZ = CFG.PIER_Z - 120;
    box(0.8, 5, 0.8, chairMat, lgX, 2.5, lgZ);
    box(2, 0.3, 2, chairMat, lgX, 5, lgZ);
    box(2.5, 0.15, 2.5, mat('#e2725b', { roughness: 0.9 }), lgX, 6.2, lgZ);
    const netMat = new THREE.MeshStandardMaterial({ color: '#f2f2ee', roughness: 0.9, side: THREE.DoubleSide });
    const nvX = CFG.BEACH_X - 60, nvZ = CFG.PIER_Z + 180;
    const nvPoleMat = mat('#5a5f66', { roughness: 0.6, metalness: 0.4 });
    const netPoleA = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 2.6, 6), nvPoleMat);
    netPoleA.position.set(nvX - 4, 1.3, nvZ);
    const netPoleB = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 2.6, 6), nvPoleMat);
    netPoleB.position.set(nvX + 4, 1.3, nvZ);
    const net = new THREE.Mesh(new THREE.PlaneGeometry(8, 1), netMat);
    net.position.set(nvX, 1.9, nvZ);
    group.add(netPoleA, netPoleB, net);
  }

  // Neon signs: glowing strips on shopfronts in Citrus Lane + Boardwalk.
  // Each sign hangs on a building face; its material brightens at night.
  {
    // B3: seven varied neon hues (was five) so the night city is not
    // one-colour, and a much higher base glow so signs read before night.
    const neonColors = ['#ff5c8a', '#2ad8ff', '#ffe14d', '#4dff88', '#c07aff', '#ff9f1c', '#00e5c0'];
    let placed = 0;
    for (const b of buildings) {
      if (placed >= 26) break;
      if (b.district.id !== 'citrus' && b.district.id !== 'boardwalk') continue;
      if (rng() < 0.55) continue;
      const color = neonColors[Math.floor(rng() * neonColors.length)];
      const nm = new THREE.MeshStandardMaterial({
        color: '#111111', emissive: new THREE.Color(color), emissiveIntensity: 0.9,
        side: THREE.DoubleSide,
      });
      neonMats.push(nm);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(b.w * 0.6, 18), 1.6 + rngB4() * 1.6), nm);
      sign.position.set(b.x, b.h * 0.55, b.z + b.d / 2 + 0.2);
      group.add(sign);
      // B4: blade sign — a vertical fin projecting from the facade, read
      // from along the street, on a share of signed fronts.
      if (rngB4() < 0.4) {
        const blade = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 4.5), nm);
        blade.rotation.y = Math.PI / 2;
        blade.position.set(b.x - b.w * 0.25, b.h * 0.5, b.z + b.d / 2 + 1.2);
        group.add(blade);
      }
      placed++;
    }
  }

  // ---- palms ---------------------------------------------------------------
  // Instanced trunks + instanced crowns: cheap at a few hundred palms.
  const palmSpots = [];
  // R7: beach palms denser (every ~24 m, was 70) — the beach is a hero
  // shot and the research asks for palms every ~12 m.
  for (let z = -HALF + 60; z <= HALF - 60; z += 24) {
    palmSpots.push([CFG.BEACH_X - 40 - rng() * 90, z + (rng() - 0.5) * 30]);
  }
  for (let z = -HALF + 100; z <= HALF - 100; z += 260) {
    palmSpots.push([-HALF + 40 + rng() * 40, z]);
  }
  for (let i = 0; i < 60; i++) {
    const c = roadCentres[Math.floor(rng() * roadCentres.length)];
    const t = -HALF + rng() * HALF * 2;
    if (Math.abs(c - HW_E) < 40 || Math.abs(t - HW_N) < 40) continue;
    palmSpots.push([c + ROAD_W / 2 + 6, t]);
  }
  // R7: street trees — one side of every street, ~60 m apart (research
  // asks 12–18 m; 60 m keeps the streets readable), skipping junctions
  // and the highway corridors. Lot trees from the filled lots join here.
  for (const c of roadCentres) {
    if (c === HW_N || c === HW_E) continue;
    for (let t = -HALF + 100; t <= HALF - 100; t += 60) {
      if (Math.abs(t - HW_N) < 30 || Math.abs(t - HW_E) < 30) continue;
      if (roadCentres.some((rc) => Math.abs(t - rc) < 20)) continue; // junction — keep the crossing clear
      const side = (Math.floor(t / 60) % 2 === 0) ? 1 : -1;
      palmSpots.push([c + side * (ROAD_W / 2 + 6), t]);
      palmSpots.push([t, c + side * (ROAD_W / 2 + 6)]);
    }
  }
  for (const s of lotTreeSpots) palmSpots.push(s);
  const trunkGeo = new THREE.CylinderGeometry(0.45, 0.8, 9, 7);
  const trunkMat = new THREE.MeshStandardMaterial({ color: '#6b4a2c', roughness: 1 });
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, palmSpots.length);
  const crownGeo = new THREE.SphereGeometry(3.4, 8, 6);
  crownGeo.scale(1, 0.45, 1);
  const crownMat = new THREE.MeshStandardMaterial({ color: '#2e6b34', roughness: 1 });
  const crowns = new THREE.InstancedMesh(crownGeo, crownMat, palmSpots.length);
  palmSpots.forEach(([x, z], i) => {
    const lean = (rng() - 0.5) * 0.14;
    dummy.position.set(x, 4.5, z);
    dummy.rotation.set(lean, rng() * Math.PI * 2, (rng() - 0.5) * 0.14);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
    dummy.position.set(x + lean * 20, 9.6, z);
    dummy.rotation.set(0, rng() * Math.PI * 2, 0);
    dummy.updateMatrix();
    crowns.setMatrixAt(i, dummy.matrix);
  });
  trunks.instanceMatrix.needsUpdate = true;
  crowns.instanceMatrix.needsUpdate = true;
  trunks.castShadow = true;
  crowns.castShadow = true;
  group.add(trunks);
  group.add(crowns);

  // ---- traffic lights + lamps ----------------------------------------------
  const poleMat = new THREE.MeshStandardMaterial({ color: '#3a3f45', roughness: 0.6, metalness: 0.5 });
  const lampHeadMat = new THREE.MeshStandardMaterial({
    color: '#fff2c8', emissive: new THREE.Color('#ffe9a8'), emissiveIntensity: 0.6,
  });
  const lampPoles = [];
  const lampHeads = [];
  const lampSpots = []; // [x, z] of every street lamp — light-pool sites
  for (const cx of roadCentres) {
    for (const cz of roadCentres) {
      if (cx === HW_E || cz === HW_N) continue;
      // Traffic light at every 400 m junction, lamps at the rest.
      const isSignal = ((cx + 1400) % 400 === 0) && ((cz + 1400) % 400 === 0);
      const px = cx + ROAD_W / 2 + 3;
      const pz = cz + ROAD_W / 2 + 3;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.35, 7.5, 8), poleMat);
      pole.position.set(px, 3.75, pz);
      pole.castShadow = true;
      group.add(pole);
      if (isSignal) {
        junctions.push({ x: cx, z: cz });
        const head = new THREE.Group();
        head.position.set(px, 7.6, pz);
        const housing = new THREE.Mesh(new THREE.BoxGeometry(1.1, 3.2, 1.1), poleMat);
        head.add(housing);
        const lampGeo = new THREE.SphereGeometry(0.42, 10, 8);
        const red = new THREE.Mesh(lampGeo, new THREE.MeshStandardMaterial({ color: '#5a1010', emissive: new THREE.Color('#ff2a1a'), emissiveIntensity: 0 }));
        const yellow = new THREE.Mesh(lampGeo, new THREE.MeshStandardMaterial({ color: '#5a4a10', emissive: new THREE.Color('#ffb52a'), emissiveIntensity: 0 }));
        const green = new THREE.Mesh(lampGeo, new THREE.MeshStandardMaterial({ color: '#0f3d1a', emissive: new THREE.Color('#2aff5c'), emissiveIntensity: 0 }));
        red.position.y = 1.0; yellow.position.y = 0; green.position.y = -1.0;
        head.add(red, yellow, green);
        group.add(head);
        trafficLights.push({ group: head, red, yellow, green, x: cx, z: cz, offset: (cx + cz) / 400 });
      } else {
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 8), lampHeadMat);
        bulb.position.set(px, 7.7, pz);
        group.add(bulb);
        lampPoles.push(pole);
        lampHeads.push(bulb);
        lampSpots.push([px, pz]);
      }
    }
  }

  // R7: mid-block lamps — junction lamps alone leave 200 m dark gaps.
  // Instanced (one draw call each for poles + bulbs); positions join
  // lampSpots so they get light pools too. Spacing ~72 m (research
  // asks ~36 m; 72 m keeps pool overdraw sane), alternating sides,
  // skipping junctions and the highway corridors.
  {
    const midSpots = [];
    for (const c of roadCentres) {
      if (c === HW_E || c === HW_N) continue;
      for (let t = -HALF + 90; t <= HALF - 90; t += 72) {
        if (Math.abs(t - HW_N) < 30 || Math.abs(t - HW_E) < 30) continue;
        if (roadCentres.some((rc) => Math.abs(t - rc) < 18)) continue; // junction lamp already there
        const side = (Math.floor(t / 72) % 2 === 0) ? 1 : -1;
        midSpots.push([c + side * (ROAD_W / 2 + 3), t]);
        midSpots.push([t, c + side * (ROAD_W / 2 + 3)]);
      }
    }
    const midPoles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.28, 0.35, 7.5, 8), poleMat, midSpots.length);
    const midBulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.55, 10, 8), lampHeadMat, midSpots.length);
    midSpots.forEach(([x, z], i) => {
      dummy.position.set(x, 3.75, z);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      midPoles.setMatrixAt(i, dummy.matrix);
      dummy.position.set(x, 7.7, z);
      dummy.updateMatrix();
      midBulbs.setMatrixAt(i, dummy.matrix);
      lampSpots.push([x, z]);
    });
    midPoles.instanceMatrix.needsUpdate = true;
    midBulbs.instanceMatrix.needsUpdate = true;
    group.add(midPoles);
    group.add(midBulbs);
    stats.midBlockLamps = midSpots.length;
  }

  // B3: a warm pool of light on the asphalt under every street lamp.
  // One instanced radial-gradient disc per lamp (additive, no shadow,
  // no collider) — its opacity is driven by setLampGlow below, so the
  // pools strengthen as the grade goes to night.
  const poolTex = canvasTexture(128, 128, (g, w, h) => {
    const grad = g.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w / 2);
    grad.addColorStop(0, 'rgba(255,255,255,0.95)');
    grad.addColorStop(0.45, 'rgba(255,255,255,0.38)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  });
  const poolMat = new THREE.MeshBasicMaterial({
    map: poolTex, color: '#ffca7a', transparent: true, opacity: 0.32,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const poolGeo = new THREE.CircleGeometry(9, 24);
  const pools = new THREE.InstancedMesh(poolGeo, poolMat, lampSpots.length);
  lampSpots.forEach(([x, z], i) => {
    // R7: y=0.09 (was 0.05) — the sidewalk planes moved to 0.05, and a
    // transparent disc coplanar with them would shimmer at glancing angles.
    dummy.position.set(x, 0.09, z);
    dummy.rotation.set(-Math.PI / 2, 0, 0);
    dummy.updateMatrix();
    pools.setMatrixAt(i, dummy.matrix);
  });
  pools.instanceMatrix.needsUpdate = true;
  pools.renderOrder = 1;
  group.add(pools);

  // ---- queries + animation hooks -------------------------------------------
  function isSolid(x, z) {
    for (const b of colliders) {
      if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1) return true;
    }
    return false;
  }

  function nearestRoadPoint(x, z) {
    let bx = roadCentres[0], bz = roadCentres[0];
    for (const c of roadCentres) {
      if (Math.abs(c - x) < Math.abs(bx - x)) bx = c;
      if (Math.abs(c - z) < Math.abs(bz - z)) bz = c;
    }
    // Snap to whichever axis road is closer.
    return Math.abs(bx - x) < Math.abs(bz - z) ? { x: bx, z } : { x, z: bz };
  }

  function randomRoadSpot() {
    const axisRoad = roadCentres[Math.floor(rng() * roadCentres.length)];
    const along = -HALF + rng() * HALF * 2;
    return rng() < 0.5 ? { x: axisRoad, z: along } : { x: along, z: axisRoad };
  }

  // Traffic-light phase: north-south green for the first half of the
  // cycle, east-west green for the second; each junction is offset so
  // the city does not flip in unison.
  function updateTrafficLights(timeS) {
    const cycle = CFG.TRAFFIC_LIGHT_CYCLE;
    for (const tl of trafficLights) {
      const phase = (((timeS + tl.offset * cycle * 0.5) % cycle) + cycle) % cycle;
      const nsGreen = phase < cycle * 0.45;
      const amber = phase >= cycle * 0.45 && phase < cycle * 0.5;
      tl.red.material.emissiveIntensity = nsGreen ? 0 : 2.2;
      tl.green.material.emissiveIntensity = nsGreen ? 2.2 : 0;
      tl.yellow.material.emissiveIntensity = amber ? 2.2 : 0;
      tl.group.rotation.y = 0;
    }
    // B4: the aviation beacon blinks on the same clock as the lights.
    updateBeacon(timeS);
  }
  updateTrafficLights(0);

  function setWindowGlow(v) {
    for (const m of facadeMats) m.emissiveIntensity = 0.1 + v * 1.4;
  }
  function setLampGlow(v) {
    // B3: bulbs 0.5 + 3.0v (was 0.1 + 1.6v) — clearly lit at the
    // golden-hour chase (v=0.5) and strong at night (v=1); the light
    // pools on the asphalt scale with the same grade value.
    lampHeadMat.emissiveIntensity = 0.5 + v * 3.0;
    poolMat.opacity = 0.10 + v * 0.45;
  }
  function setNeonGlow(v) {
    // B3: 0.9 + 3.4v (was 0.3 + 1.8v) — neon reads at night (v=1 → 4.3)
    // and stays visible in the golden hour (v=0.5 → 2.6).
    for (const m of neonMats) m.emissiveIntensity = 0.9 + v * 3.4;
  }

  // ---- hospitals (r8, B4) ------------------------------------------------
  // Death has somewhere to come back to: one general hospital in Old
  // Town + one beach clinic. Both sit on ground the probe proved
  // empty (no generated building, collider, palm or umbrella inside
  // either footprint): the hospital takes the empty Old Town lot at
  // block (100,-500), the clinic a bare stretch of sand west of the
  // beach road. A local rng stream (rngH) feeds the facade painter so
  // the main / B4 streams — and the city layout — are untouched.
  // Each record carries its entrance spawn: on foot, on the forecourt,
  // facing the doors. Exported as `hospitals` for the death system.
  const rngH = mulberry32(20261124 ^ 0x48);
  const hospitals = [];
  {
    const hospTex = facadeTextures('#e8e2d4', '#256b74', 0.35, rngH, 'concrete', rngH);
    const hospMat = new THREE.MeshStandardMaterial({
      map: hospTex.map, emissiveMap: hospTex.emissive,
      emissive: new THREE.Color('#ffb45c'), emissiveIntensity: 0.15, roughness: 0.7,
    });
    facadeMats.push(hospMat);
    const hosp = new THREE.Mesh(new THREE.BoxGeometry(64, 18, 40), hospMat);
    hosp.position.set(52, 9, -500);
    hosp.castShadow = true;
    hosp.receiveShadow = true;
    group.add(hosp);
    const roofMatH = mat('#8f3d2c', { roughness: 0.9 });
    box(66, 1.2, 42, roofMatH, 52, 18.6, -500);
    // Lit red cross on the south face (left of the sign, clear of it)
    // + fascia sign.
    const crossMat = new THREE.MeshStandardMaterial({
      color: '#c0392b', emissive: new THREE.Color('#ff2a1a'), emissiveIntensity: 1.6, roughness: 0.5,
    });
    neonMats.push(crossMat); // setNeonGlow keeps it lit at night
    box(3, 9, 0.8, crossMat, 30, 12, -479.4);
    box(9, 3, 0.8, crossMat, 30, 12, -479.4);
    const signTex = canvasTexture(1024, 128, (g, w, h) => {
      g.fillStyle = '#0e3b2e'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#c0392b'; g.fillRect(28, 34, 60, 60); g.fillStyle = '#f2f6f8'; g.fillRect(52, 40, 12, 48); g.fillRect(34, 58, 48, 12);
      g.fillStyle = '#f2f6f8'; g.font = 'bold 56px sans-serif'; g.textAlign = 'left'; g.textBaseline = 'middle';
      g.fillText('PALMA VERDE GENERAL', 110, h / 2 + 2);
    });
    const signMat = new THREE.MeshStandardMaterial({
      map: signTex, emissiveMap: signTex, emissive: new THREE.Color('#ffffff'),
      emissiveIntensity: 0.9, roughness: 0.7,
    });
    neonMats.push(signMat);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(34, 4.25), signMat);
    sign.position.set(52, 15.2, -479.5);
    group.add(sign);
    // Entrance canopy + glass doors on the south face.
    box(16, 0.6, 6, mat('#0e3b2e', { roughness: 0.9 }), 52, 4.4, -477);
    const doorMat = new THREE.MeshStandardMaterial({
      color: '#1c2836', metalness: 0.55, roughness: 0.25,
      emissive: new THREE.Color('#ff9a3c'), emissiveIntensity: 0.1,
    });
    facadeMats.push(doorMat);
    const doors = new THREE.Mesh(new THREE.PlaneGeometry(8, 3.6), doorMat);
    doors.position.set(52, 1.8, -479.7);
    group.add(doors);
    // Ambulance parked on the forecourt, clear of the spawn point.
    const amb = new THREE.Group();
    amb.position.set(78, 0, -464);
    const ambWhite = mat('#f2f2ee', { roughness: 0.4 });
    const ambBody = new THREE.Mesh(new THREE.BoxGeometry(6.5, 2.6, 2.6), ambWhite);
    ambBody.position.y = 1.7; ambBody.castShadow = true;
    const ambCab = new THREE.Mesh(new THREE.BoxGeometry(2, 1.9, 2.4), ambWhite);
    ambCab.position.set(4, 1.35, 0); ambCab.castShadow = true;
    const ambStripe = new THREE.Mesh(new THREE.BoxGeometry(6.6, 0.5, 2.7), crossMat);
    ambStripe.position.y = 1.9;
    const ambWheelMat = mat('#14181f', { roughness: 1 });
    for (const [wx, wz] of [[-2.2, 1.35], [2.6, 1.35], [-2.2, -1.35], [2.6, -1.35]]) {
      const wheel = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 0.4), ambWheelMat);
      wheel.position.set(wx, 0.5, wz);
      amb.add(wheel);
    }
    amb.add(ambBody, ambCab, ambStripe);
    group.add(amb);
    colliders.push({ x0: 20, z0: -520, x1: 84, z1: -480, h: 18 });
    colliders.push({ x0: 74.5, z0: -465.5, x1: 81.5, z1: -462.5, h: 3 });
    buildings.push({ mesh: hosp, district: districtAt(52, -500), h: 18, x: 52, z: -500, w: 64, d: 40 });
    hospitals.push({
      id: 'general', name: 'PALMA VERDE GENERAL', x: 52, z: -500,
      spawn: { x: 52, z: -466, angle: -Math.PI / 2 },
    });
    // Beach clinic: small white block on the sand, entrance facing east
    // (the beach road), red cross + CLINICA PLAYA sign on the east face.
    const clinicTex = facadeTextures('#f2ede2', '#175e5a', 0.3, rngH, 'concrete', rngH);
    const clinicMat = new THREE.MeshStandardMaterial({
      map: clinicTex.map, emissiveMap: clinicTex.emissive,
      emissive: new THREE.Color('#ffb45c'), emissiveIntensity: 0.15, roughness: 0.7,
    });
    facadeMats.push(clinicMat);
    const clinic = new THREE.Mesh(new THREE.BoxGeometry(30, 8, 20), clinicMat);
    clinic.position.set(-1520, 4, 300);
    clinic.castShadow = true;
    clinic.receiveShadow = true;
    group.add(clinic);
    box(32, 1, 22, roofMatH, -1520, 8.5, 300);
    box(0.8, 5, 2.2, crossMat, -1504.4, 5.5, 288);
    box(0.8, 2.2, 5, crossMat, -1504.4, 5.5, 288);
    const clinicTex2 = canvasTexture(512, 128, (g, w, h) => {
      g.fillStyle = '#0e3b2e'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#f2f6f8'; g.font = 'bold 52px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('CLINICA PLAYA', w / 2, h / 2 + 2);
    });
    const clinicSignMat = new THREE.MeshStandardMaterial({
      map: clinicTex2, emissiveMap: clinicTex2, emissive: new THREE.Color('#ffffff'),
      emissiveIntensity: 0.9, roughness: 0.7,
    });
    neonMats.push(clinicSignMat);
    const clinicSign = new THREE.Mesh(new THREE.PlaneGeometry(16, 4), clinicSignMat);
    clinicSign.rotation.y = Math.PI / 2;
    clinicSign.position.set(-1504.5, 6, 300);
    group.add(clinicSign);
    const clinicDoors = new THREE.Mesh(new THREE.PlaneGeometry(4, 3), doorMat);
    clinicDoors.rotation.y = Math.PI / 2;
    clinicDoors.position.set(-1504.8, 1.5, 300);
    group.add(clinicDoors);
    colliders.push({ x0: -1535, z0: 290, x1: -1505, z1: 310, h: 8 });
    buildings.push({ mesh: clinic, district: null, h: 8, x: -1520, z: 300, w: 30, d: 20 });
    hospitals.push({
      id: 'clinic', name: 'CLINICA PLAYA', x: -1520, z: 300,
      spawn: { x: -1494, z: 300, angle: Math.PI },
    });
    stats.hospitals = hospitals.length;
  }

  return {
    group, roads: roadCentres, junctions, trafficLights, buildings, colliders,
    palms: palmSpots, lamps: lampHeads, lampSpots, ocean, beach, pier: pierGroup, wheel,
    facadeMats, lampHeadMat, landmarks, yachts, umbrellas: umbrellaSpots, neonMats,
    districtAt, isSolid, nearestRoadPoint, randomRoadSpot,
    updateTrafficLights, updateBeacon, setWindowGlow, setLampGlow, setNeonGlow,
    stats, // R7 build census: emptyLots, lotFills, storefronts, rooftopSigns, …
    hospitals,
  };
}
