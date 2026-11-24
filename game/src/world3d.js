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
// those lit windows, so the glow can be dialled by time of day.
function facadeTextures(wall, trim, litShare, rng) {
  const cols = 5 + Math.floor(rng() * 3);
  const rows = 9 + Math.floor(rng() * 6);
  const wins = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) wins.push([c, r, rng() < litShare]);
  }
  const map = canvasTexture(128, 256, (g, w, h) => {
    g.fillStyle = wall; g.fillRect(0, 0, w, h);
    g.fillStyle = trim; g.fillRect(0, 0, w, 6); g.fillRect(0, h - 6, w, 6);
    const cw = w / cols, rh = h / rows;
    for (const [c, r, lit] of wins) {
      g.fillStyle = lit ? '#ffd98a' : '#2c3a4a';
      g.fillRect(c * cw + cw * 0.2, r * rh + rh * 0.22, cw * 0.6, rh * 0.56);
    }
  });
  const emissive = canvasTexture(128, 256, (g, w, h) => {
    g.fillStyle = '#000000'; g.fillRect(0, 0, w, h);
    const cw = w / cols, rh = h / rows;
    for (const [c, r, lit] of wins) {
      if (!lit) continue;
      g.fillStyle = '#ffbe5c';
      g.fillRect(c * cw + cw * 0.2, r * rh + rh * 0.22, cw * 0.6, rh * 0.56);
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
  const roadMat = mat('#4a4e56', { roughness: 0.95 });
  const walkMat = mat('#9ba1a8', { roughness: 1 });
  const hwMat = mat('#3d4048', { roughness: 0.95 });

  function roadStrip(x, z, w, d, material) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), material);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0, z);
    m.receiveShadow = true;
    group.add(m);
    return m;
  }

  for (const c of roadCentres) {
    // East-west streets (vary z) and north-south streets (vary x).
    if (c !== HW_N) {
      roadStrip(0, c, HALF * 2, ROAD_W, roadMat);
      roadStrip(0, c - ROAD_W / 2 - 2, HALF * 2, 4, walkMat);
      roadStrip(0, c + ROAD_W / 2 + 2, HALF * 2, 4, walkMat);
    }
    if (c !== HW_E) {
      roadStrip(c, 0, ROAD_W, HALF * 2, roadMat);
      roadStrip(c - ROAD_W / 2 - 2, 0, 4, HALF * 2, walkMat);
      roadStrip(c + ROAD_W / 2 + 2, 0, 4, HALF * 2, walkMat);
    }
  }
  // Highways: wider, fenced, no cross streets.
  roadStrip(0, HW_N, HALF * 2, HW_W, hwMat);
  roadStrip(HW_E, 0, HW_W, HALF * 2, hwMat);
  const barrierMat = mat('#8a8f94', { roughness: 0.8 });
  box(HALF * 2, 1.2, 1, barrierMat, 0, 0.6, HW_N - HW_W / 2 - 1);
  box(HALF * 2, 1.2, 1, barrierMat, 0, 0.6, HW_N + HW_W / 2 + 1);
  box(1, 1.2, HALF * 2, barrierMat, HW_E - HW_W / 2 - 1, 0.6, 0);
  box(1, 1.2, HALF * 2, barrierMat, HW_E + HW_W / 2 + 1, 0.6, 0);

  // Lane dashes, instanced: one thin white box per dash, both directions.
  // B3: near-white and longer so the centre lines read at chase distance.
  const dashGeo = new THREE.BoxGeometry(6, 0.06, 0.5);
  const dashMat = new THREE.MeshBasicMaterial({ color: '#f5f8fa' });
  const dashSpots = [];
  for (const c of roadCentres) {
    if (c === HW_N || c === HW_E) continue;
    for (let t = -HALF + 40; t <= HALF - 40; t += 40) {
      if (Math.abs(t - HW_N) < 30 || Math.abs(t - HW_E) < 30) continue;
      dashSpots.push([t, 0.03, c, 0]);       // along east-west street
      dashSpots.push([c, 0.03, t, 1]);       // along north-south street
    }
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
  function facadeMatFor(district) {
    if (!facadeCache.has(district.id)) {
      const set = [];
      for (let v = 0; v < 3; v++) {
        const t = facadeTextures(district.wall, district.trim, 0.25 + rng() * 0.25, rng);
        const m = new THREE.MeshStandardMaterial({
          map: t.map, emissiveMap: t.emissive, emissive: new THREE.Color('#ffb45c'),
          emissiveIntensity: 0.15, roughness: 0.85,
        });
        set.push(m);
        facadeMats.push(m);
      }
      facadeCache.set(district.id, set);
    }
    return facadeCache.get(district.id);
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
      if (!district) continue;
      if (rng() > district.density) continue; // empty lot / plaza
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
        const h = hMin + rng() * (hMax - hMin);
        const fm = facades[Math.floor(rng() * facades.length)];
        const tower = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), fm);
        tower.position.set(lx, h / 2, lz);
        tower.castShadow = true;
        tower.receiveShadow = true;
        group.add(tower);
        // Flat roof slab in the district's roof colour.
        const slab = new THREE.Mesh(new THREE.BoxGeometry(w + 1, 1.2, d + 1), roofMat);
        slab.position.set(lx, h + 0.6, lz);
        slab.castShadow = true;
        group.add(slab);
        buildings.push({ mesh: tower, district, h, x: lx, z: lz, w, d });
        colliders.push({ x0: lx - w / 2, z0: lz - d / 2, x1: lx + w / 2, z1: lz + d / 2, h });
      }
    }
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
    const hotelTex = facadeTextures('#e8e2d4', '#256b74', 0.4, rng);
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
    const tipMat = new THREE.MeshStandardMaterial({
      color: '#ff5c7a', emissive: new THREE.Color('#ff2a4a'), emissiveIntensity: 1.2,
    });
    neonMats.push(tipMat);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(2.2, 10, 8), tipMat);
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
    }
    landmarks.push({ id: 'mercado', mesh: stalls[0] });
    colliders.push({ x0: -790, z0: 60, x1: -610, z1: 140, h: 5 });
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
    }
    colliders.push({ x0: 240, z0: 860, x1: 380, z1: 920, h: 10 });
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
  const umbrellaSpots = [];
  for (let z = -HALF + 80; z <= HALF - 80; z += 55) {
    if (Math.abs(z - CFG.PIER_Z) < 90) continue; // keep the pier approach clear
    umbrellaSpots.push([CFG.BEACH_X - 30 - rng() * 130, z + (rng() - 0.5) * 24]);
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
      });
      neonMats.push(nm);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(b.w * 0.6, 18), 2.2), nm);
      sign.position.set(b.x, b.h * 0.55, b.z + b.d / 2 + 0.2);
      group.add(sign);
      placed++;
    }
  }

  // ---- palms ---------------------------------------------------------------
  // Instanced trunks + instanced crowns: cheap at a few hundred palms.
  const palmSpots = [];
  for (let z = -HALF + 60; z <= HALF - 60; z += 70) {
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
    dummy.position.set(x, 0.05, z);
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

  return {
    group, roads: roadCentres, junctions, trafficLights, buildings, colliders,
    palms: palmSpots, lamps: lampHeads, ocean, beach, pier: pierGroup, wheel,
    facadeMats, lampHeadMat, landmarks, yachts, umbrellas: umbrellaSpots, neonMats,
    districtAt, isSolid, nearestRoadPoint, randomRoadSpot,
    updateTrafficLights, setWindowGlow, setLampGlow, setNeonGlow,
  };
}
