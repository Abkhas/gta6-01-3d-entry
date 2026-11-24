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
// Perf: the 22 junctions × 4 heads are a handful of InstancedMeshes
// (poles, housings, one per lens colour, ped boxes, marking planes),
// so the whole system costs ~7 draw calls. The per-frame update only
// writes instance colours, and only when a junction's displayed state
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

// ---- head placement -----------------------------------------------------
// One head per approach, on the far-right corner of its junction, so
// each head stands on the far side facing the drivers it serves.
function headSpots(jx, jz) {
  return [
    { x: jx - 10, z: jz + 10, axis: 'z' }, // southbound
    { x: jx + 10, z: jz - 10, axis: 'z' }, // northbound
    { x: jx + 10, z: jz + 10, axis: 'x' }, // eastbound
    { x: jx - 10, z: jz - 10, axis: 'x' }, // westbound
  ];
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
      return { built: ctl.built, junctions: ctl.junctions, heads: ctl.heads, worldHeads: ctl.worldHeads, slimmedWorldHeads: ctl.slimmedWorldHeads || 0 };
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
  // frozen at t=0.)
  function driveWorldHeads(timeS) {
    for (const tl of tls) {
      if (sigKeys.has(tl.x + ',' + tl.z)) continue;
      const st = directionState(tl.x, tl.z, 'z', timeS);
      if (tl.red && tl.red.material) tl.red.material.emissiveIntensity = st === 'red' ? 2.2 : 0;
      if (tl.yellow && tl.yellow.material) tl.yellow.material.emissiveIntensity = st === 'yellow' ? 2.2 : 0;
      if (tl.green && tl.green.material) tl.green.material.emissiveIntensity = st === 'green' ? 2.2 : 0;
    }
  }

  // (3) The directional heads: instanced, built once THREE arrives.
  // Spots are fixed; only the instance colours change per frame.
  const spots = [];
  for (const j of SIGNAL_JUNCTIONS) {
    for (const s of headSpots(j.x, j.z)) spots.push({ x: s.x, z: s.z, axis: s.axis, jx: j.x, jz: j.z });
  }
  // Lens / ped colours, as hex: setColorAt needs THREE.Color objects,
  // which only exist once THREE is imported, so they are built with
  // the meshes and read back here per frame.
  let built = null; // { red, yellow, green, ped, lastSig, colors }

  function applyLights(timeS) {
    ctl.time = timeS;
    driveWorldHeads(timeS);
    if (!built) return;
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
      built.ped.setColorAt(i, ps === 'walk' ? cc.pedWalk : ps === 'clear' ? cc.pedStop : cc.pedOff);
    }
    if (changed) {
      built.red.instanceColor.needsUpdate = true;
      built.yellow.instanceColor.needsUpdate = true;
      built.green.instanceColor.needsUpdate = true;
      built.ped.instanceColor.needsUpdate = true;
    }
  }
  ctl.update = applyLights;

  // No browser, no meshes: the world heads above are still driven
  // (they need no THREE), but there is nothing to build.
  if (typeof window === 'undefined' || typeof document === 'undefined') return ctl;

  import('three').then((THREE) => {
    try {
      const dummy = new THREE.Object3D();
      const n = spots.length;
      const poleMat = new THREE.MeshStandardMaterial({ color: '#2a2e33', roughness: 0.6, metalness: 0.5 });
      const housingMat = new THREE.MeshStandardMaterial({ color: '#111214', roughness: 0.5, metalness: 0.3 });
      const lensMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
      const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.3, 5.5, 8), poleMat, n);
      const housings = new THREE.InstancedMesh(new THREE.BoxGeometry(0.55, 2.9, 0.55), housingMat, n);
      const red = new THREE.InstancedMesh(new THREE.SphereGeometry(0.5, 12, 10), lensMat, n);
      const yellow = new THREE.InstancedMesh(new THREE.SphereGeometry(0.5, 12, 10), lensMat, n);
      const green = new THREE.InstancedMesh(new THREE.SphereGeometry(0.5, 12, 10), lensMat, n);
      // Ped box: a small box on the pole, facing the junction; its
      // colour IS the walk signal (white walk, red hand, dark stop),
      // so the material is plain white and the instance colour does
      // the talking.
      const pedMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
      const ped = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 1.2, 0.3), pedMat, n);
      spots.forEach((s, i) => {
        dummy.position.set(s.x, 2.75, s.z);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        poles.setMatrixAt(i, dummy.matrix);
        dummy.position.set(s.x, 5.1, s.z);
        dummy.updateMatrix();
        housings.setMatrixAt(i, dummy.matrix);
        dummy.position.set(s.x, 6.05, s.z);
        dummy.updateMatrix();
        red.setMatrixAt(i, dummy.matrix);
        dummy.position.set(s.x, 5.1, s.z);
        dummy.updateMatrix();
        yellow.setMatrixAt(i, dummy.matrix);
        dummy.position.set(s.x, 4.15, s.z);
        dummy.updateMatrix();
        green.setMatrixAt(i, dummy.matrix);
        dummy.position.set(s.x, 2.6, s.z);
        dummy.rotation.set(0, Math.atan2(s.jx - s.x, s.jz - s.z), 0);
        dummy.updateMatrix();
        ped.setMatrixAt(i, dummy.matrix);
        dummy.rotation.set(0, 0, 0);
      });
      for (const im of [poles, housings, red, yellow, green, ped]) {
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
        red, yellow, green, ped,
        lastSig: new Array(n).fill(''),
        colors: {
          litRed: new THREE.Color('#ff2a1a'),
          litYellow: new THREE.Color('#ffb52a'),
          litGreen: new THREE.Color('#2aff5c'),
          unlit: new THREE.Color('#26262a'),
          pedWalk: new THREE.Color('#ffffff'),
          pedStop: new THREE.Color('#ff3b30'),
          pedOff: new THREE.Color('#1e1e22'),
        },
      };
      ctl.built = true;
      ctl.heads = n;
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
