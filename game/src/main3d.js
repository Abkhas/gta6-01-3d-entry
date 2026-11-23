// Palma Verde 3D — entry point (minimal base for the 3D challenger).
// Builds the renderer, the procedural city and the sky, then renders with
// a TEMPORARY orbit camera so the world can be inspected right away.
//
// INTEGRATION POINTS (other builders replace these, they do not rewrite
// this file's world/sky setup):
//   [CHASE-CAM]  — swap `updateOrbitCamera` for the chase camera that
//                  follows the player / car (player3d.js).
//   [GAME-LOOP]  — `tick()` is where gameplay steps: input, traffic,
//                  police, missions, HUD updates (hud3d.js).
//   [DAY-CYCLE]  — `clockHours` advances here; the day/night builder owns
//                  the schedule and calls setTimeOfDay on grade change.
//   [HUD]        — `setHudLine` is the placeholder; hud3d.js takes over
//                  #hud and renders the full HUD (minimap, wanted, cash).

import * as THREE from 'three';
import { CFG3D, districtAt, gradeForHour } from './config3d.js';
import { buildWorld } from './world3d.js';
import { createSky, setTimeOfDay, updateSky } from './sky3d.js';

const canvas = document.getElementById('world');
const hudLine = document.getElementById('hud-line');
const hudErr = document.getElementById('hud-err');

window.addEventListener('error', (e) => {
  if (hudErr) hudErr.textContent = 'Palma Verde 3D hit an error: ' + e.message;
});

function setHudLine(text) {
  if (hudLine) hudLine.textContent = text;
}

// ---- renderer / scene ---------------------------------------------------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.5, 14000);

const world = buildWorld(scene, CFG3D);
const sky = createSky(scene);

// The game opens mid-morning; the day/night builder advances this.
let clockHours = CFG3D.DAY_START_HOUR;
let currentGrade = setTimeOfDay(scene, gradeForHour(clockHours), world);

// ---- TEMPORARY orbit camera ---------------------------------------------
// Drag to orbit, wheel to zoom. [CHASE-CAM] replaces this whole block.
const orbit = {
  target: new THREE.Vector3(0, 0, 0),
  radius: 900,
  theta: -0.6,   // around Y
  phi: 0.9,      // down from vertical
  dragging: false,
  lastX: 0,
  lastY: 0,
};

function updateOrbitCamera() {
  const sp = Math.sin(orbit.phi), cp = Math.cos(orbit.phi);
  camera.position.set(
    orbit.target.x + orbit.radius * sp * Math.sin(orbit.theta),
    orbit.target.y + orbit.radius * cp,
    orbit.target.z + orbit.radius * sp * Math.cos(orbit.theta),
  );
  camera.lookAt(orbit.target);
}

canvas.addEventListener('pointerdown', (e) => {
  orbit.dragging = true;
  orbit.lastX = e.clientX;
  orbit.lastY = e.clientY;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (!orbit.dragging) return;
  orbit.theta -= (e.clientX - orbit.lastX) * 0.005;
  orbit.phi = Math.min(1.5, Math.max(0.15, orbit.phi - (e.clientY - orbit.lastY) * 0.005));
  orbit.lastX = e.clientX;
  orbit.lastY = e.clientY;
});
canvas.addEventListener('pointerup', () => { orbit.dragging = false; });
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  orbit.radius = Math.min(4000, Math.max(60, orbit.radius * (1 + Math.sign(e.deltaY) * 0.08)));
}, { passive: false });

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---- frame loop -----------------------------------------------------------
const clock = new THREE.Clock();
let elapsed = 0;

function formatClock(h) {
  const hh = Math.floor(h) % 24;
  const mm = Math.floor((h % 1) * 60);
  return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
}

function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.1);
  elapsed += dt;

  // [DAY-CYCLE] advance the clock; re-grade only when the grade changes.
  clockHours = (clockHours + (dt * 24) / CFG3D.DAY_LENGTH_S) % 24;
  const grade = gradeForHour(clockHours);
  if (grade !== currentGrade) currentGrade = setTimeOfDay(scene, grade, world);

  world.updateTrafficLights(elapsed);
  world.wheel.rotation.z -= dt * 0.05; // the pier wheel turns slowly
  updateSky(scene, dt);

  // [GAME-LOOP] gameplay steps go here (player, traffic, police, HUD).
  const d = districtAt(orbit.target.x, orbit.target.z);
  setHudLine(
    formatClock(clockHours) + ' · ' + currentGrade.label +
    (d ? ' · ' + d.name.toUpperCase() : ' · OUTSIDE THE CITY') +
    ' · drag to orbit, scroll to zoom',
  );

  updateOrbitCamera(); // [CHASE-CAM] replaced by the chase camera
  renderer.render(scene, camera);
}

updateOrbitCamera();
tick();

// Debug / integration handle: other builders and the console can reach
// the live scene, world and sky through window.__palma3d.
window.__palma3d = {
  scene, camera, renderer, world, sky, orbit,
  get clockHours() { return clockHours; },
  setClockHours(h) { clockHours = ((h % 24) + 24) % 24; },
};
