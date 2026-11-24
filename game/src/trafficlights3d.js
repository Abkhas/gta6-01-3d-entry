// trafficlights3d.js — visible, directional traffic-light heads.
//
// Why this file exists: world3d already builds a lamp at every 400 m
// junction, but the lamp spheres sit INSIDE their housings (a 0.42 m
// sphere inside a 1.1 m box), so no light is ever visible — and the
// one head per junction shows the north-south state to every approach,
// so east-west drivers read the wrong colour. This module fixes both
// without touching world3d: it slims the world heads' housings so
// their lamps poke out, drives all 64 of them from the same clock the
// cars read, and adds proper directional heads — one per approach, on
// the far-right corner, black GTA-style housing with a ped box — at
// the 22 avenue + beach-road junctions, plus a stop line and zebra
// crossings painted on one shared canvas texture per junction.
//
// Cycle (the existing one — this file does not invent a second cycle):
// the 14 s cycle from CFG.TRAFFIC_LIGHT_CYCLE, north-south green for
// the first 45%, a 0.7 s yellow, then east-west green; each junction
// is offset by (x + z) / 400 of a cycle, so neighbours are not in
// sync. phaseAt / directionState are the single source of truth:
// traffic3d's car logic reads them, and the meshes below display
// them, so a lamp and the cars waiting under it can never disagree.
// GTA rule, kept: red goes straight to green, no red-amber stage,
// and the player is never penalised for running a light.
//
// r8 (daylight visibility): the r7 heads vanished by day — a contrast
// problem, not a brightness one. Real signals fix it with hardware:
// a black backplate behind each housing, a visor hood over each lens,
// a mast-arm head hung over the lane centre, a daylight halo (an
// additive radial disc) on the lit lens, and lit-lens colours punched
// past 1.0 so the lit lens beats the ACES tonemap. The 14 s cycle,
// per-junction offsets and the GTA red→green rule are untouched.
//
// Perf: the 22 junctions × 4 approaches × 2 heads (corner + mast-arm)
// are a handful of InstancedMeshes (poles, housings, one per lens
// colour, ped boxes, backplates, visors, halos, mast arms, risers,
// marking planes), so the whole system costs ~12 draw calls. The
// per-frame update only writes instance colours (and, on a state flip,
// the halo matrices), and only when a junction's displayed state
// actually changes.
//
// THREE arrives by dynamic import (the page's import map resolves
// 'three'): the mesh build is async and fire-and-forget, but the
// world-head slimming + driving needs no THREE at all and runs
// synchronously, so the game never depends on the import resolving.

import { CFG3D as CFG } from './config3d.js';

// ---- the signalled set --------------------------------------------------
// The 22 junctions that get full directional heads: the central 4x4
// avenue grid (Old Town / Citrus / Northgate / Palm Heights / Docks)
// plus the beach-road avenue one block east of the sand, which the
// chase camera runs past. The other 42 junctions keep world3d's
// (slimmed, now visible) single head.
export const SIGNAL_JUNCTIONS = (() => {
  const list = [];
  for (const x of [-600, -200, 200, 600]) {
    for (const z of [-600, -200, 200, 600]) list.push({ x, z });
  }
  for (const z of [-1000, -600, -200, 200, 600, 1000]) list.push({ x: -1400, z });
  return list;
})();

// A car stops with its centre this far before the junction centre:
// the stop line sits 12 m out, the car's nose ~2 m ahead of its
// centre, so the nose lands on the line. traffic3d reads this.
export const STOP_GAP = 14;

// Yellow length in seconds, at the end of each direction's green.
const YELLOW_S = 0.7;

// ---- the cycle (single source of truth) ---------------------------------
function signalOffset(jx, jz) {
  return (jx + jz) / 400;
}

// Phase in seconds, [0, cycle), for the junction at (jx, jz).
export function phaseAt(jx, jz, timeS, cycle) {
  const c = cycle || CFG.TRAFFIC_LIGHT_CYCLE || 14;
  const offset = signalOffset(jx, jz);
  return (((timeS + offset * c * 0.5) % c) + c) % c;
}

// 'green' | 'yellow' | 'red' for traffic travelling along `axis`
// ('x' = east-west, 'z' = north-south) at time timeS.
export function directionState(jx, jz, axis, timeS, cycle) {
  const c = cycle || CFG.TRAFFIC_LIGHT_CYCLE || 14;
  const p = phaseAt(jx, jz, timeS, c);
  if (axis === 'z') {
    // North-south: green first 45%, yellow 0.7 s, then red.
    if (p < c * 0.45) return 'green';
    if (p < c * 0.45 + YELLOW_S) return 'yellow';
    return 'red';
  }
  // East-west: red first 45%, green, yellow in the last 0.7 s.
  if (p < c * 0.45) return 'red';
  if (p >= c - YELLOW_S) return 'yellow';
  return 'green';
}

// Ped signal for crossing parallel to `axis` ('walk' while that
// direction is green, flashing 'clearance' in its last second, red
// otherwise). Returns 'walk' | 'clear' | 'stop'.
export function pedState(jx, jz, axis, timeS, cycle) {
  const c = cycle || CFG.TRAFFIC_LIGHT_CYCLE || 14;
  const p = phaseAt(jx, jz, timeS, c);
  const greenEnd = axis === 'z' ? c * 0.45 : c - YELLOW_S;
  const greenStart = axis === 'z' ? 0 : c * 0.45;
  if (p < greenStart || p >= greenEnd) return 'stop';
  if (p >= greenEnd - 1) return Math.floor(timeS * 2) % 2 === 0 ? 'clear' : 'stop';
  return 'walk';
}

// Lens heights (housing centre 5.1 m; red on top, green at the bottom).
const LENS_Y = { red: 6.05, yellow: 5.1, green: 4.15 };

// ---- head placement -----------------------------------------------------
// One head per approach, on the far-right corner of its junction, so
// each head stands on the far side facing the drivers it serves.
// Plus a mast-arm head per approach, hung over the right-hand lane
// centre on the far side (3.5 m off the centreline), so a head sits
// in the driving sightline instead of only off to the side — the
// corner head alone is a small target from a chase camera 30 m back.
function headSpots(jx, jz) {
  return [
    { x: jx - 10, z: jz + 10, axis: 'z' }, // southbound
    { x: jx + 10, z: jz - 10, axis: 'z' }, // northbound
    { x: jx + 10, z: jz + 10, axis: 'x' }, // eastbound
    { x: jx - 10, z: jz - 10, axis: 'x' }, // westbound
  ];
}

// ---- daylight halo texture --------------------------------------------
// One shared radial-gradient canvas texture for every lit-lens halo:
// a white core fading to transparent, drawn once and reused by all
// 176 halos. Additive blending means the halo only ever adds light —
// it never paints a grey disc over the housing or the street. (This
// is the same radial-gradient technique vehicles3d uses for headlight
// glow; that module does not export its texture, so this file draws
// its own rather than reaching across modules.)
function glowTexture(THREE) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 2, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.3, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.7, 'rgba(255,255,255,0.12)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---- road markings ------------------------------------------------------
// One 40x40 m canvas texture, shared by every junction: a zebra
// crossing on each side (bars parallel to traffic) and a stop line
// 12 m out across each right-hand lane. The layout is symmetric
// under 90-degree rotation, so plane orientation does not matter.
function markingTexture(THREE) {
  const S = 256;
  const m = S / 40; // px per metre
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, S, S);
  g.fillStyle = 'rgba(255,255,255,0.85)';
  const X = (mx) => (mx + 20) * m;
  const Y = (mz) => (mz + 20) * m;
  // Zebras across the north-south road (peds walk east-west): bars
  // long in z, in bands 8-11 m north and south of the centre.
  for (const zc of [-9.5, 9.5]) {
    for (let bx = -6.3; bx <= 6.3; bx += 2.1) {
      g.fillRect(X(bx - 0.55), Y(zc - 1.5), 1.1 * m, 3 * m);
    }
  }
  // Zebras across the east-west road (peds walk north-south): bars
  // long in x, in bands 8-11 m east and west of the centre.
  for (const xc of [-9.5, 9.5]) {
    for (let bz = -6.3; bz <= 6.3; bz += 2.1) {
      g.fillRect(X(xc - 1.5), Y(bz - 0.55), 3 * m, 1.1 * m);
    }
  }
  // Stop lines, 12 m out, across each right-hand lane.
  g.fillRect(X(-7), Y(-12.25), 7 * m, 0.5 * m); // southbound
  g.fillRect(X(0), Y(11.75), 7 * m, 0.5 * m); // northbound
  g.fillRect(X(-12.25), Y(0), 0.5 * m, 7 * m); // eastbound
  g.fillRect(X(11.75), Y(-7), 0.5 * m, 7 * m); // westbound
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// ---- the controller -----------------------------------------------------
export function createTrafficLights(world) {
  const tls = world && Array.isArray(world.trafficLights) ? world.trafficLights : null;
  const group = world && world.group ? world.group : null;
  const ctl = {
    built: false,
    time: 0,
    junctions: SIGNAL_JUNCTIONS.length,
    heads: 0,
    worldHeads: tls ? tls.length : 0,
    update: function () {},
    summary: function () {
      return { built: ctl.built, junctions: ctl.junctions, heads: ctl.heads, mastHeads: ctl.mastHeads || 0, worldHeads: ctl.worldHeads, slimmedWorldHeads: ctl.slimmedWorldHeads || 0 };
    },
  };
  if (!tls || !group) return ctl;

  const sigKeys = new Set(SIGNAL_JUNCTIONS.map((j) => j.x + ',' + j.z));

  // (1) Slim world3d's housings so their lamps are visible at all:
  // the housing is the BoxGeometry child of each head group; at 0.45
  // scale it is a 0.5 m spine and the 0.42 m lamp spheres poke out
  // on every side. At the 22 upgraded junctions the whole head is
  // hidden instead (the directional heads below replace it), and
  // its bare pole is hidden too.
  let slimmed = 0;
  for (const tl of tls) {
    if (!tl.group) continue;
    if (sigKeys.has(tl.x + ',' + tl.z)) {
      tl.group.visible = false;
      continue;
    }
    if (Array.isArray(tl.group.children)) {
      for (const child of tl.group.children) {
        if (child && child.geometry && child.geometry.type === 'BoxGeometry') {
          child.scale.set(0.45, 1, 0.45);
          slimmed++;
        } else if (child && child.geometry && child.geometry.type === 'SphereGeometry') {
          // r8: the world lamps are small (r 0.42 m) — fatten them so
          // the 42 non-upgraded junctions read by day as well.
          child.scale.setScalar(1.25);
        }
      }
    }
  }
  ctl.slimmedWorldHeads = slimmed;
  // Hide the bare pole world3d left at each upgraded junction's
  // south-east corner (a cylinder at y 3.75, 7.5 m tall, at +10/+10).
  if (Array.isArray(group.children)) {
    for (const child of group.children) {
      if (!child || !child.isMesh || child.isInstancedMesh) continue;
      if (!child.geometry || child.geometry.type !== 'CylinderGeometry') continue;
      if (Math.abs(child.position.y - 3.75) > 0.5) continue;
      for (const j of SIGNAL_JUNCTIONS) {
        if (Math.abs(child.position.x - (j.x + 10)) < 0.5 && Math.abs(child.position.z - (j.z + 10)) < 0.5) {
          child.visible = false;
        }
      }
    }
  }

  // (2) Drive world3d's remaining heads from the same clock the cars
  // read. One writer, one formula: a head never disagrees with the
  // cars waiting under it. (world3d's own updateTrafficLights is
  // never called by the game loop, so its heads would otherwise sit
  // frozen at t=0.) r8: lit emissive 4.0, not 2.2 — under a 2.4–3.0
  // sun with ACES tonemapping the old value washed out by day.
  function driveWorldHeads(timeS) {
    for (const tl of tls) {
      if (sigKeys.has(tl.x + ',' + tl.z)) continue;
      const st = directionState(tl.x, tl.z, 'z', timeS);
      if (tl.red && tl.red.material) tl.red.material.emissiveIntensity = st === 'red' ? 4.0 : 0;
      if (tl.yellow && tl.yellow.material) tl.yellow.material.emissiveIntensity = st === 'yellow' ? 4.0 : 0;
      if (tl.green && tl.green.material) tl.green.material.emissiveIntensity = st === 'green' ? 4.0 : 0;
    }
  }

  // (3) The directional heads: instanced, built once THREE arrives.
  // Spots are fixed; only the instance colours (and, on a state flip,
  // the halo matrices) change per frame. Each corner spot gets a
  // mast-arm twin over the lane centre, facing the same drivers.
  const spots = [];
  for (const j of SIGNAL_JUNCTIONS) {
    for (const s of headSpots(j.x, j.z)) {
      const f = s.axis === 'z' ? { x: 0, z: s.z > j.z ? -1 : 1 } : { x: s.x > j.x ? -1 : 1, z: 0 };
      const yaw = Math.atan2(f.x, f.z);
      spots.push({ x: s.x, z: s.z, axis: s.axis, jx: j.x, jz: j.z, fx: f.x, fz: f.z, yaw, mast: false, cornerIdx: -1 });
      const mx = s.axis === 'z' ? j.x + Math.sign(s.x - j.x) * 3.5 : s.x;
      const mz = s.axis === 'x' ? j.z + Math.sign(s.z - j.z) * 3.5 : s.z;
      spots.push({ x: mx, z: mz, axis: s.axis, jx: j.x, jz: j.z, fx: f.x, fz: f.z, yaw, mast: true, cornerIdx: -1 });
    }
  }
  // Corner heads only (poles, ped boxes, mast arms and risers hang
  // off these); the mast-arm twins share the corner head's state.
  const cornerSpots = [];
  for (const s of spots) {
    if (s.mast) continue;
    s.cornerIdx = cornerSpots.length;
    cornerSpots.push(s);
  }
  // Lens / ped colours, as hex: setColorAt needs THREE.Color objects,
  // which only exist once THREE is imported, so they are built with
  // the meshes and read back here per frame.
  let built = null; // { red, yellow, green, ped, lastSig, colors }

  function applyLights(timeS, opts) {
    ctl.time = timeS;
    driveWorldHeads(timeS);
    if (!built) return;
    // Daylight halo sizing. No caller passes the day/night factor yet
    // (traffic3d calls update(time) only), so it defaults to the
    // daylight tune — a ~1.7 m disc at 0.45 gain; pass
    // { nightF: 0..1 } to grow it after dark (~2.6 m, gain 1.0).
    // A night-factor change invalidates the state signatures so every
    // halo is re-parked at the new size on the next pass.
    const nightF = opts && typeof opts.nightF === 'number' ? Math.max(0, Math.min(1, opts.nightF)) : 0;
    const nightQ = Math.round(nightF * 10);
    if (nightQ !== built.lastNightQ) {
      built.lastNightQ = nightQ;
      built.lastSig.fill('');
    }
    const haloSize = 1.7 + nightF * 0.9;
    const haloGain = 0.45 + nightF * 0.55;
    // One signature per spot; skip the colour writes when nothing
    // changed (states flip at most every 0.7 s per junction).
    let changed = false;
    for (let i = 0; i < spots.length; i++) {
      const s = spots[i];
      const st = directionState(s.jx, s.jz, s.axis, timeS);
      const ps = pedState(s.jx, s.jz, s.axis, timeS);
      const sig = st + ps;
      if (built.lastSig[i] === sig) continue;
      built.lastSig[i] = sig;
      changed = true;
      const cc = built.colors;
      built.red.setColorAt(i, st === 'red' ? cc.litRed : cc.unlit);
      built.yellow.setColorAt(i, st === 'yellow' ? cc.litYellow : cc.unlit);
      built.green.setColorAt(i, st === 'green' ? cc.litGreen : cc.unlit);
      // Ped boxes exist on corner heads only; mast twins share the
      // corner head's state but have no box of their own.
      if (!s.mast) built.ped.setColorAt(s.cornerIdx, ps === 'walk' ? cc.pedWalk : ps === 'clear' ? cc.pedStop : cc.pedOff);
      // Halo: park the additive disc on the lit lens, facing the
      // drivers, just past the lens surface (0.55 m out — the sphere
      // is r 0.5, so any closer and the lens itself would occlude it).
      // Its colour IS the lit colour, dimmed for daylight; exactly one
      // lens is always lit, so the halo never needs an on/off flag.
      const litY = st === 'red' ? LENS_Y.red : st === 'yellow' ? LENS_Y.yellow : LENS_Y.green;
      const litCol = st === 'red' ? cc.litRed : st === 'yellow' ? cc.litYellow : cc.litGreen;
      const d = built.dummy;
      d.position.set(s.x + s.fx * 0.55, litY, s.z + s.fz * 0.55);
      d.rotation.set(0, s.yaw, 0);
      d.scale.set(haloSize, haloSize, 1);
      d.updateMatrix();
      built.halo.setMatrixAt(i, d.matrix);
      built.halo.setColorAt(i, built.haloCol.copy(litCol).multiplyScalar(haloGain));
    }
    if (changed) {
      built.red.instanceColor.needsUpdate = true;
      built.yellow.instanceColor.needsUpdate = true;
      built.green.instanceColor.needsUpdate = true;
      built.ped.instanceColor.needsUpdate = true;
      built.halo.instanceColor.needsUpdate = true;
      built.halo.instanceMatrix.needsUpdate = true;
    }
  }
  ctl.update = applyLights;

  // No browser, no meshes: the world heads above are still driven
  // (they need no THREE), but there is nothing to build.
  if (typeof window === 'undefined' || typeof document === 'undefined') return ctl;

  import('three').then((THREE) => {
    try {
      const dummy = new THREE.Object3D();
      const n = spots.length; // 176: 88 corner heads + 88 mast-arm twins
      const nc = cornerSpots.length; // 88: corner heads only
      const poleMat = new THREE.MeshStandardMaterial({ color: '#2a2e33', roughness: 0.6, metalness: 0.5 });
      const housingMat = new THREE.MeshStandardMaterial({ color: '#111214', roughness: 0.5, metalness: 0.3 });
      const lensMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
      const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.3, 5.5, 8), poleMat, nc);
      const housings = new THREE.InstancedMesh(new THREE.BoxGeometry(0.55, 2.9, 0.55), housingMat, n);
      const red = new THREE.InstancedMesh(new THREE.SphereGeometry(0.5, 12, 10), lensMat, n);
      const yellow = new THREE.InstancedMesh(new THREE.SphereGeometry(0.5, 12, 10), lensMat, n);
      const green = new THREE.InstancedMesh(new THREE.SphereGeometry(0.5, 12, 10), lensMat, n);
      // Ped box: a small box on the pole, facing the junction; its
      // colour IS the walk signal (white walk, red hand, dark stop),
      // so the material is plain white and the instance colour does
      // the talking. Corner heads only.
      const pedMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
      const ped = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 1.2, 0.3), pedMat, nc);
      // Backplate (r8): a flat matte-black frame behind each housing,
      // 0.2 m of dark border on every side — the consistent dark
      // background a lit lens needs to keep contrast at noon.
      const plateMat = new THREE.MeshStandardMaterial({ color: '#0a0a0c', roughness: 0.9, metalness: 0.05 });
      const plates = new THREE.InstancedMesh(new THREE.BoxGeometry(0.95, 3.3, 0.06), plateMat, n);
      // Visor (r8): a top-half tunnel hood over each lens. The
      // cylinder is built around Y, thetaStart PI/2 length PI keeps
      // the half where z <= 0, and rotateX(PI/2) maps that half onto
      // y >= 0 with the axis along +Z — so after a yaw the hood sits
      // over the top of the lens, open at the front and underneath,
      // shading the lens from the sun without hiding it from below.
      const visorGeo = new THREE.CylinderGeometry(0.58, 0.58, 0.8, 12, 1, true, Math.PI / 2, Math.PI);
      visorGeo.rotateX(Math.PI / 2);
      const visorMat = new THREE.MeshStandardMaterial({ color: '#0c0c0e', roughness: 0.85, metalness: 0.1, side: THREE.DoubleSide });
      const visors = new THREE.InstancedMesh(visorGeo, visorMat, n * 3);
      // Halo (r8): one additive radial disc per head, parked on the
      // lit lens by applyLights. Unit plane — the per-state matrix
      // scales it to the daylight/night size.
      const haloMat = new THREE.MeshBasicMaterial({
        map: glowTexture(THREE), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: '#ffffff',
      });
      const halo = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), haloMat, n);
      halo.renderOrder = 3;
      // Mast arm + riser (r8, corner heads only): a horizontal arm at
      // 6.6 m from the pole top across to the lane-centre head, and a
      // riser continuing the pole up to the arm. One arm per approach.
      const arms = new THREE.InstancedMesh(new THREE.BoxGeometry(6.5, 0.18, 0.18), poleMat, nc);
      const risers = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.18, 0.22, 1.3, 8), poleMat, nc);
      // Corner heads: pole, ped box, mast arm, riser.
      cornerSpots.forEach((s, i) => {
        dummy.scale.set(1, 1, 1);
        dummy.position.set(s.x, 2.75, s.z);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        poles.setMatrixAt(i, dummy.matrix);
        dummy.position.set(s.x, 2.6, s.z);
        dummy.rotation.set(0, Math.atan2(s.jx - s.x, s.jz - s.z), 0);
        dummy.updateMatrix();
        ped.setMatrixAt(i, dummy.matrix);
        dummy.rotation.set(0, 0, 0);
        const alongX = s.axis === 'z';
        const midX = alongX ? (s.x + (s.jx + Math.sign(s.x - s.jx) * 3.5)) / 2 : s.x;
        const midZ = alongX ? s.z : (s.z + (s.jz + Math.sign(s.z - s.jz) * 3.5)) / 2;
        dummy.position.set(midX, 6.6, midZ);
        dummy.rotation.set(0, alongX ? 0 : Math.PI / 2, 0);
        dummy.updateMatrix();
        arms.setMatrixAt(i, dummy.matrix);
        dummy.position.set(s.x, 6.0, s.z);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        risers.setMatrixAt(i, dummy.matrix);
      });
      // All heads (corner + mast-arm): housing, lenses, backplate,
      // one visor per lens.
      spots.forEach((s, i) => {
        dummy.scale.set(1, 1, 1);
        dummy.rotation.set(0, 0, 0);
        dummy.position.set(s.x, 5.1, s.z);
        dummy.updateMatrix();
        housings.setMatrixAt(i, dummy.matrix);
        dummy.position.set(s.x, LENS_Y.red, s.z);
        dummy.updateMatrix();
        red.setMatrixAt(i, dummy.matrix);
        dummy.position.set(s.x, LENS_Y.yellow, s.z);
        dummy.updateMatrix();
        yellow.setMatrixAt(i, dummy.matrix);
        dummy.position.set(s.x, LENS_Y.green, s.z);
        dummy.updateMatrix();
        green.setMatrixAt(i, dummy.matrix);
        dummy.position.set(s.x - s.fx * 0.31, 5.1, s.z - s.fz * 0.31);
        dummy.rotation.set(0, s.yaw, 0);
        dummy.updateMatrix();
        plates.setMatrixAt(i, dummy.matrix);
        const ys = [LENS_Y.red, LENS_Y.yellow, LENS_Y.green];
        for (let k = 0; k < 3; k++) {
          dummy.position.set(s.x + s.fx * 0.25, ys[k], s.z + s.fz * 0.25);
          dummy.rotation.set(0, s.yaw, 0);
          dummy.updateMatrix();
          visors.setMatrixAt(i * 3 + k, dummy.matrix);
        }
        dummy.rotation.set(0, 0, 0);
      });
      for (const im of [poles, housings, red, yellow, green, ped, plates, visors, halo, arms, risers]) {
        im.instanceMatrix.needsUpdate = true;
        im.frustumCulled = false;
        group.add(im);
      }
      // Road markings: one shared canvas texture, one instanced
      // plane per signalled junction, lying on the asphalt.
      const marks = new THREE.InstancedMesh(
        new THREE.PlaneGeometry(40, 40),
        new THREE.MeshBasicMaterial({
          map: markingTexture(THREE), transparent: true, depthWrite: false,
        }),
        SIGNAL_JUNCTIONS.length,
      );
      marks.renderOrder = 2;
      SIGNAL_JUNCTIONS.forEach((j, i) => {
        dummy.position.set(j.x, 0.06, j.z);
        dummy.rotation.set(-Math.PI / 2, 0, 0);
        dummy.updateMatrix();
        marks.setMatrixAt(i, dummy.matrix);
      });
      dummy.rotation.set(0, 0, 0);
      marks.instanceMatrix.needsUpdate = true;
      marks.frustumCulled = false;
      group.add(marks);
      built = {
        red, yellow, green, ped, halo, dummy,
        lastSig: new Array(n).fill(''),
        lastNightQ: -1,
        haloCol: new THREE.Color('#ffffff'),
        colors: {
          // Lit lenses punched past 1.0 (r8): a 1.0 red under a 3.0
          // noon sun and ACES tonemapping reads grey-pink; 1.8 keeps
          // the lit lens the brightest thing on the housing by day.
          litRed: new THREE.Color('#ff2a1a').multiplyScalar(1.8),
          litYellow: new THREE.Color('#ffb52a').multiplyScalar(1.8),
          litGreen: new THREE.Color('#2aff5c').multiplyScalar(1.8),
          unlit: new THREE.Color('#26262a'),
          pedWalk: new THREE.Color('#ffffff'),
          pedStop: new THREE.Color('#ff3b30'),
          pedOff: new THREE.Color('#1e1e22'),
        },
      };
      ctl.built = true;
      ctl.heads = n;
      ctl.mastHeads = nc;
      // Paint the initial states now: in shot mode traffic.update
      // never runs, so without this the lenses would render white
      // (no instance colour yet) instead of their t=0 red/green mix.
      applyLights(ctl.time || 0);
    } catch (e) {
      // Meshes failed; the slimmed + driven world heads still show.
      built = null;
    }
  }).catch(() => {});
  return ctl;
}
