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
    mat('#39402f'),
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
  const roadMat = mat('#23262b', { roughness: 0.95 });
  const walkMat = mat('#5d6167', { roughness: 1 });
  const hwMat = mat('#1d1f24', { roughness: 0.95 });

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
  const dashGeo = new THREE.BoxGeometry(4, 0.06, 0.5);
  const dashMat = new THREE.MeshBasicMaterial({ color: '#c8cdd2' });
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
  for (let bi = 0; bi < blockN; bi++) {
    for (let bj = 0; bj < blockN; bj++) {
      const cx = -HALF + (bi + 0.5) * BLOCK;
      const cz = -HALF + (bj + 0.5) * BLOCK;
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
    color: '#fff2c8', emissive: new THREE.Color('#ffe9a8'), emissiveIntensity: 0.1,
  });
  const lampPoles = [];
  const lampHeads = [];
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
      }
    }
  }

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
    lampHeadMat.emissiveIntensity = 0.1 + v * 1.6;
  }

  return {
    group, roads: roadCentres, junctions, trafficLights, buildings, colliders,
    palms: palmSpots, lamps: lampHeads, ocean, beach, pier: pierGroup, wheel,
    facadeMats, lampHeadMat,
    districtAt, isSolid, nearestRoadPoint, randomRoadSpot,
    updateTrafficLights, setWindowGlow, setLampGlow,
  };
}
