// Palma Verde 3D — sky dome, sun, moon, stars and clouds.
// The dome is a big inverted sphere with a two-colour gradient shader;
// the sun is a disc plus a glow sprite, the moon a pale disc, the stars
// a point cloud that only shows at night. setTimeOfDay drives the grade
// from config3d.js: sky colours, sun position, lights and fog together.

import * as THREE from 'three';
import { CFG3D, createDprGovernor } from './config3d.js';

function softBlobTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const g = c.getContext('2d');
  for (const [x, y, r] of [[40, 38, 26], [64, 30, 30], [88, 38, 24], [55, 42, 22], [75, 44, 20]]) {
    const grad = g.createRadialGradient(x, y, 2, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.85)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 64);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = CFG3D.PERF.maxAnisotropy || 4; // r9 A1: device max, shared constant
  return tex;
}

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = CFG3D.PERF.maxAnisotropy || 4; // r9 A1
  return tex;
}

// Round star sprite: WebGL points are squares by default, so a bare
// PointsMaterial renders every star as a white square. A radial disc
// texture with a transparent falloff makes each point a small round
// dot instead (corners fade to fully transparent).
function starTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 1, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.9)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = CFG3D.PERF.maxAnisotropy || 4; // r9 A1
  return tex;
}

export function createSky(scene) {
  const sky = {};

  // Gradient dome: three-stop vertical gradient (horizon -> mid ->
  // zenith) so the sky has a warm band at golden hour instead of a
  // flat two-colour blend. A ±0.4% hash dither on the fragment kills
  // the gradient banding a smooth dome shows on a big sky. (r9 C5)
  const domeMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      topColor: { value: new THREE.Color('#3f7fd0') },
      midColor: { value: new THREE.Color('#79aede') },
      horizonColor: { value: new THREE.Color('#cfe4f2') },
    },
    vertexShader: `
      varying vec3 vPos;
      void main() {
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 midColor;
      uniform vec3 horizonColor;
      varying vec3 vPos;
      void main() {
        float h = clamp(normalize(vPos).y * 1.6 + 0.12, 0.0, 1.0);
        vec3 col = h < 0.45
          ? mix(horizonColor, midColor, h / 0.45)
          : mix(midColor, topColor, (h - 0.45) / 0.55);
        // Dither: one hash step per pixel, far below perception, breaks banding.
        float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
        gl_FragColor = vec4(col + (n - 0.5) * 0.008, 1.0);
      }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(6000, 24, 16), domeMat);
  dome.name = 'SkyDome';
  scene.add(dome);
  sky.dome = dome;
  sky.domeMat = domeMat;

  // Sun disc + halo, and the moon. Both ride a fixed radius from the
  // camera target so they never clip the dome.
  const sunMat = new THREE.MeshBasicMaterial({ color: '#fff3c8', fog: false });
  const sun = new THREE.Mesh(new THREE.CircleGeometry(150, 32), sunMat);
  scene.add(sun);
  sky.sun = sun;
  sky.sunMat = sunMat;

  const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture(), color: '#ffdf9a', transparent: true, opacity: 0.85,
    depthWrite: false, fog: false,
  }));
  sunGlow.scale.set(1100, 1100, 1);
  scene.add(sunGlow);
  sky.sunGlow = sunGlow;

  // r9 C5: outer sun halo — a second, much larger and fainter glow
  // sprite reusing the same radial texture, so the sun reads as a
  // disc with a soft halo instead of a hard circle. Additive look via
  // low opacity + depthWrite off; fog:false, renders behind nothing
  // (sprites sort with the scene, no renderOrder hack needed).
  const sunHalo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture(), color: '#ffe9b8', transparent: true, opacity: 0.28,
    depthWrite: false, fog: false,
  }));
  sunHalo.scale.set(2600, 2600, 1);
  scene.add(sunHalo);
  sky.sunHalo = sunHalo;

  // r9 C5: distant skyline silhouette — a sparse ring of dark
  // low-poly slabs just outside the city edge (1600-2000 m), fog-faded
  // so the horizon is a hazy skyline instead of a hard line. One
  // shared geometry + one shared MeshBasicMaterial (fog:true does the
  // fading per grade); no shadows, no colliders, purely visual. The
  // west quadrant is left open — that is ocean, not city — and the
  // ring sits outside the 1400 m city bound so play never reaches it.
  // Fog far is 2500 by day / 1800 at night (r9 A5), so at 1600-2000 m
  // the slabs are 40-75% fogged: present, never hard-edged.
  const skylineMat = new THREE.MeshBasicMaterial({ color: '#33414f', fog: true });
  const skylineGeo = new THREE.BoxGeometry(1, 1, 1);
  sky.skyline = [];
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + 0.11;
    const x = Math.cos(a);
    const z = Math.sin(a);
    if (x < -0.55) continue; // west = ocean, no skyline
    const r = 1650 + ((i * 265) % 350);
    const w = 120 + ((i * 97) % 180);
    const h = 120 + ((i * 173) % 300);
    const slab = new THREE.Mesh(skylineGeo, skylineMat);
    slab.position.set(x * r, h / 2 - 10, z * r);
    slab.scale.set(w, h, 60 + ((i * 53) % 80));
    slab.rotation.y = -a;
    slab.name = 'SkylineSilhouette';
    scene.add(slab);
    sky.skyline.push(slab);
  }
  sky.skylineMat = skylineMat;

  const moonMat = new THREE.MeshBasicMaterial({ color: '#dfe6f2', fog: false });
  const moon = new THREE.Mesh(new THREE.CircleGeometry(90, 32), moonMat);
  moon.visible = false;
  scene.add(moon);
  sky.moon = moon;

  // Stars: points on the upper hemisphere, faded in only at night.
  const starCount = 900;
  const starPos = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const a = Math.random() * Math.PI * 2;
    const e = Math.random() * Math.PI * 0.48 + 0.04;
    const r = 5600;
    starPos[i * 3] = Math.cos(a) * Math.cos(e) * r;
    starPos[i * 3 + 1] = Math.sin(e) * r;
    starPos[i * 3 + 2] = Math.sin(a) * Math.cos(e) * r;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const starMat = new THREE.PointsMaterial({
    color: '#dfe8ff', size: 9, sizeAttenuation: false,
    map: starTexture(), alphaTest: 0.01,
    transparent: true, opacity: 0, fog: false, depthWrite: false,
  });
  const stars = new THREE.Points(starGeo, starMat);
  scene.add(stars);
  sky.stars = stars;
  sky.starMat = starMat;

  // Clouds: soft billboards drifting slowly across the dome.
  const cloudTex = softBlobTexture();
  sky.clouds = [];
  for (let i = 0; i < 16; i++) {
    const m = new THREE.SpriteMaterial({
      map: cloudTex, transparent: true, opacity: 0.85, depthWrite: false, fog: false,
    });
    const s = new THREE.Sprite(m);
    const a = Math.random() * Math.PI * 2;
    const r = 1800 + Math.random() * 2600;
    s.position.set(Math.cos(a) * r, 500 + Math.random() * 700, Math.sin(a) * r);
    const w = 500 + Math.random() * 700;
    s.scale.set(w, w * 0.42, 1);
    s.userData.drift = 2 + Math.random() * 4;
    scene.add(s);
    sky.clouds.push(s);
  }

  // Lights the grades drive: one sun (directional, shadow-casting) and
  // one hemisphere fill so night is never near-black.
  // SHADOW BOX (r8 B6): was a 2048 map over the whole ±1600 m city —
  // every caster in 3.2 km re-rendered into the shadow map every
  // frame at 1.56 m/texel (mush). Now a 1024 map over a ±160 m box
  // (~320 m, 0.31 m/texel — ~5x sharper) that FOLLOWS the player
  // (applyShadowFollow, below): only near-player casters enter the
  // shadow pass. Constants live in CFG3D.PERF.
  const sunLight = new THREE.DirectionalLight('#fff1cf', 2.4);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(CFG3D.PERF.SHADOW_MAP_SIZE, CFG3D.PERF.SHADOW_MAP_SIZE);
  const SH = CFG3D.PERF.SHADOW_HALF;
  sunLight.shadow.camera.left = -SH;
  sunLight.shadow.camera.right = SH;
  sunLight.shadow.camera.top = SH;
  sunLight.shadow.camera.bottom = -SH;
  sunLight.shadow.camera.near = 100;
  sunLight.shadow.camera.far = 2600;
  sunLight.shadow.camera.updateProjectionMatrix();
  sunLight.shadow.bias = -0.0004;
  // r9 A4: normalBias kills acne / peter-panning on rounded geometry
  // once B-geometry lands. Do NOT use shadow.radius (ignored under
  // PCFSoftShadowMap in r160) and do NOT switch to VSM.
  sunLight.shadow.normalBias = CFG3D.PERF.SHADOW_NORMAL_BIAS ?? 0.03;
  scene.add(sunLight);
  scene.add(sunLight.target);
  sky.sunLight = sunLight;

  const hemi = new THREE.HemisphereLight('#bcd6ea', '#6b7a5e', 0.75);
  scene.add(hemi);
  sky.hemi = hemi;

  scene.userData.palmaSky = sky;
  return sky;
}

// Point the sun/moon by elevation + azimuth (degrees). Azimuth 0 faces
// north (-Z), 90 faces east (+X). Both bodies sit 5200 m out.
function placeBody(body, elevationDeg, azimuthDeg) {
  const el = (elevationDeg * Math.PI) / 180;
  const az = (azimuthDeg * Math.PI) / 180;
  const r = 5200;
  body.position.set(
    Math.cos(el) * Math.sin(az) * r,
    Math.sin(el) * r,
    -Math.cos(el) * Math.cos(az) * r,
  );
  body.lookAt(0, 0, 0);
}

function lerpColor(a, b, t) {
  return new THREE.Color(a).lerp(new THREE.Color(b), t);
}

// ---- player-following shadow camera (r8 B6) -------------------------
// The 320 m shadow box is useless if it stays centred on the map
// origin while the player drives 1 km away, so the light + target
// track a focus point. Priority: (1) an explicit focus set via
// setShadowFocus (coordinator/shots can pin it); (2) the live player
// position from the handle main3d exposes (window.__palma3d.state,
// vehicle-aware — the hero car/heli when driving/flying); (3) the
// chase camera position (a few metres behind the hero, a good proxy);
// (4) the player spawn, so the title screen still has shadows before
// the first tick. All window reads are guarded — in Node / tests
// `window` is absent and the default applies. The focus snaps to an
// 8 m grid so a slow drive does not shimmer the shadow map, and the
// light/target only move when the snapped focus actually changes.
function resolveShadowFocus(scene) {
  const sky = scene.userData.palmaSky;
  if (sky && sky.shadowFocus) return sky.shadowFocus;
  try {
    if (typeof window !== 'undefined' && window.__palma3d) {
      const p = window.__palma3d.state && window.__palma3d.state.player;
      if (p) {
        if (p.vehicle && typeof p.vehicle.x === 'number' && typeof p.vehicle.z === 'number') {
          return { x: p.vehicle.x, z: p.vehicle.z };
        }
        if (typeof p.x === 'number' && typeof p.z === 'number') return { x: p.x, z: p.z };
      }
      const cam = window.__palma3d.camera;
      if (cam && cam.position && typeof cam.position.x === 'number') {
        return { x: cam.position.x, z: cam.position.z };
      }
    }
  } catch (e) { /* fall through to the default focus */ }
  return CFG3D.PERF.SHADOW_DEFAULT_FOCUS;
}

function applyShadowFollow(scene) {
  const sky = scene.userData.palmaSky;
  if (!sky || !sky.sunLight || !sky.sun) return;
  const f = resolveShadowFocus(scene);
  const snap = CFG3D.PERF.SHADOW_SNAP;
  const fx = Math.round(f.x / snap) * snap;
  const fz = Math.round(f.z / snap) * snap;
  if (sky.shadowApplied && sky.shadowApplied.x === fx && sky.shadowApplied.z === fz) return;
  // Sun direction: the sun body sits 5200 m out; the light rides
  // SHADOW_FOLLOW_DIST along the same ray, so near/far stay tight
  // (100..2600) instead of spanning the whole sky.
  const dir = sky.sun.position.clone().normalize();
  const D = CFG3D.PERF.SHADOW_FOLLOW_DIST;
  sky.sunLight.position.set(fx + dir.x * D, Math.max(dir.y * D, 300), fz + dir.z * D);
  sky.sunLight.target.position.set(fx, 0, fz);
  sky.sunLight.target.updateMatrixWorld();
  sky.shadowApplied = { x: fx, z: fz };
}

// Pin the shadow box to a world (x, z) — e.g. a staged shot's hero.
// Clears on the next call; pass null to return to live tracking.
export function setShadowFocus(scene, x, z) {
  const sky = scene.userData.palmaSky;
  if (!sky) return;
  if (x == null || z == null) { sky.shadowFocus = null; sky.shadowApplied = null; return; }
  sky.shadowFocus = { x: +x, z: +z };
  sky.shadowApplied = null;
  applyShadowFollow(scene);
}

// Apply one grade to the sky, lights and fog. `grade` is a GRADES entry
// from config3d.js; `world` is the buildWorld return, so window and lamp
// glow follow the same grade. Accepts a grade key ('morning') too.
export function setTimeOfDay(scene, grade, world = null) {
  const sky = scene.userData.palmaSky;
  if (!sky) throw new Error('setTimeOfDay: createSky(scene) must run first');
  const g = typeof grade === 'string' ? CFG3D.GRADES[grade] : grade;
  if (!g) throw new Error('setTimeOfDay: unknown grade ' + String(grade));

  // NIGHT FLOOR (B1 night polish): the raw night grade renders as a
  // ~90% black void (hemi 0.4, moonlight 0.55, sky #0a1230). Lift it to
  // a dark-but-readable neon night, scaled by nightness (g.stars: 0 by
  // day, 1 at full night) so day grades are untouched. `g` may be the
  // shared CFG3D.GRADES entry, so floor a copy — never mutate config.
  const nightness = Math.min(1, Math.max(0, g.stars ?? 0));
  const fg = { ...g };
  if (nightness > 0) {
    fg.hemiIntensity = Math.max(g.hemiIntensity ?? 0, 0.95 * nightness);
    fg.sunIntensity = Math.max(g.sunIntensity ?? 0, 1.2 * nightness);
    fg.windowGlow = Math.max(g.windowGlow ?? 0, 1.0 * nightness);
    fg.neonGlow = Math.max(g.neonGlow ?? 0, 1.0 * nightness);
    fg.skyTop = '#' + lerpColor(g.skyTop, '#1b2f5c', 0.6 * nightness).getHexString();
    fg.skyHorizon = '#' + lerpColor(g.skyHorizon, '#35548c', 0.6 * nightness).getHexString();
    fg.fogColor = '#' + lerpColor(g.fogColor, '#27395f', 0.5 * nightness).getHexString();
    fg.hemiSky = '#' + lerpColor(g.hemiSky, '#516f9f', 0.6 * nightness).getHexString();
    fg.hemiGround = '#' + lerpColor(g.hemiGround, '#2c313c', 0.5 * nightness).getHexString();
  }

  sky.domeMat.uniforms.topColor.value.set(fg.skyTop);
  sky.domeMat.uniforms.midColor.value.set(
    fg.skyMid || '#' + lerpColor(fg.skyHorizon, fg.skyTop, 0.45).getHexString(),
  );
  sky.domeMat.uniforms.horizonColor.value.set(fg.skyHorizon);

  placeBody(sky.sun, fg.sunElevation, fg.sunAzimuth);
  sky.sunGlow.position.copy(sky.sun.position);
  if (sky.sunHalo) sky.sunHalo.position.copy(sky.sun.position);
  sky.sunMat.color.set(fg.sunColor);
  sky.sun.visible = fg.sunElevation > 0;
  sky.sunGlow.material.opacity = fg.sunElevation > 0 ? 0.85 : 0;
  if (sky.sunHalo) sky.sunHalo.material.opacity = fg.sunElevation > 0 ? 0.28 : 0;
  // r9 C5: low sun = bigger halo (golden hour glows, noon stays tight).
  const haloScale = 1100 * (1.6 - Math.min(1, Math.max(0, (fg.sunElevation || 30) / 74)) * 0.6);
  sky.sunGlow.scale.set(haloScale, haloScale, 1);
  if (sky.sunHalo) {
    const outer = haloScale * 2.4;
    sky.sunHalo.scale.set(outer, outer, 1);
  }
  // The moon hangs HIGH and to the EAST SIDE (elevation 68, azimuth
  // 70), not mirrored off the sun: the old mirror put it low enough
  // to sit on the title screen's save slots, which live lower-center.
  // High + sideways keeps it clear of the menu area in any frame.
  placeBody(sky.moon, 68, 70);
  sky.moon.visible = fg.stars > 0;
  sky.starMat.opacity = fg.stars * 0.9;

  sky.sunLight.color.set(fg.sunColor);
  sky.sunLight.intensity = fg.sunIntensity;
  // Shadow follow (r8 B6): light + target track the player instead of
  // sitting over the map origin. Replaces the old fixed position
  // (sun.position * 0.9, ~4680 m out, far 9000).
  applyShadowFollow(scene);
  sky.hemi.color.set(fg.hemiSky);
  sky.hemi.groundColor.set(fg.hemiGround);
  sky.hemi.intensity = fg.hemiIntensity;

  // Fog: same params as before, but reuse the object when nothing
  // changed instead of allocating a new THREE.Fog every frame.
  if (!sky.fogCache || sky.fogCache.color !== fg.fogColor
      || sky.fogCache.near !== fg.fogNear || sky.fogCache.far !== fg.fogFar) {
    scene.fog = new THREE.Fog(fg.fogColor, fg.fogNear, fg.fogFar);
    sky.fogCache = { color: fg.fogColor, near: fg.fogNear, far: fg.fogFar };
  }
  scene.background = null; // the dome is the background

  // r9 A6: exposure is driven from the grade (golden hour ~1.15, noon
  // 1.05, deep night ~0.90). The night floor above keeps hemi/sun
  // lifted, so 0.90 is a mood shift, NOT a return to the r5 black-void
  // night — the street stays readable. Applied here because
  // daynight.update calls setTimeOfDay every frame; main3d.js covers
  // the very first call (before window.__palma3d exists) itself.
  // r9 C1: dim envMapIntensity at night by the same grade.
  applyEnvMapIntensity(scene, nightness);
  try {
    if (typeof window !== 'undefined' && window.__palma3d && window.__palma3d.renderer) {
      if (typeof fg.exposure === 'number') {
        window.__palma3d.renderer.toneMappingExposure = fg.exposure;
      }
    }
  } catch (e) { /* exposure is best-effort; never break the frame */ }

  for (const c of sky.clouds) c.material.color.set(fg.cloudTint);
  sky.clouds.forEach((c) => { c.material.opacity = fg.stars > 0 ? 0.3 : 0.85; });

  if (world) {
    world.setWindowGlow(fg.windowGlow);
    world.setLampGlow(fg.neonGlow);
    if (world.setNeonGlow) world.setNeonGlow(fg.neonGlow);
  }
  sky.grade = fg;
  return fg;
}

// ---- r9 C1: per-material envMapIntensity --------------------------------
// scene.environmentIntensity does NOT exist in r160, so intensity is
// per material. Rule (constants in CFG3D.PERF): metalness >= 0.3 — car
// paint, glass, chrome — gets base 1.0; everything else (buildings,
// ground, trim) gets base 0.3, so the env map adds life without
// washing the city to pastel. The base is stored on the material the
// first time it is seen, so a later night pass re-uses it instead of
// re-deriving it, and materials created after boot (traffic cars,
// hero car) pick up the same rule on the next pass. The traverse only
// runs when the night factor actually moved (> 0.02) — setTimeOfDay
// is called every frame by daynight.update, so an unguarded traverse
// would cost a full scene walk per frame.
export function applyEnvMapIntensity(scene, nightness) {
  const sky = scene.userData.palmaSky;
  if (!sky) return;
  const n = Math.min(1, Math.max(0, nightness ?? 0));
  const factor = 1 - (CFG3D.PERF.ENV_NIGHT_DIM ?? 0.45) * n;
  if (sky.lastEnvFactor != null && Math.abs(factor - sky.lastEnvFactor) <= 0.02) return;
  sky.lastEnvFactor = factor;
  const paint = CFG3D.PERF.ENV_INTENSITY_PAINT ?? 1.0;
  const world = CFG3D.PERF.ENV_INTENSITY_WORLD ?? 0.3;
  scene.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m || !m.isMeshStandardMaterial) continue;
      if (m.userData.envBase == null) {
        m.userData.envBase = (m.metalness ?? 0) >= 0.3 ? paint : world;
      }
      m.envMapIntensity = m.userData.envBase * factor;
    }
  });
}

// Per-frame sky motion: clouds drift with the wind, the wheel of the pier
// is the world module's job. `dt` is seconds since the last frame.
// Also runs the two r8 smoothness levers that need a per-frame tick:
// the shadow box follows the player (cheap no-op unless the snapped
// focus moved) and the dynamic-DPR governor steps the pixel ratio
// down/up through the renderer main3d exposes. Both are guarded so a
// missing window/renderer (Node, tests) simply skips them.
export function updateSky(scene, dt) {
  const sky = scene.userData.palmaSky;
  if (!sky) return;
  for (const c of sky.clouds) {
    c.position.x += c.userData.drift * dt;
    if (c.position.x > 5200) c.position.x = -5200;
  }
  applyShadowFollow(scene);
  if (CFG3D.PERF.dynamicDpr !== false) {
    try {
      if (typeof window !== 'undefined' && window.__palma3d && window.__palma3d.renderer) {
        const live = window.__palma3d.renderer.getPixelRatio();
        if (!sky.dprGovernor) {
          sky.dprGovernor = createDprGovernor(live);
        } else if (Math.abs(live - sky.dprGovernor.ratio) > 0.01) {
          // r9 A2: the live ratio moved out from under the governor
          // (setupShotMode forces DPR 2) — re-sync instead of
          // stepping from a stale rung. Floor stays 1.25: the ladder
          // in CFG3D.PERF.DPR_LEVELS no longer contains 1.
          sky.dprGovernor = createDprGovernor(live);
        }
        const next = sky.dprGovernor.update((dt || 0.016) * 1000);
        if (next != null) window.__palma3d.renderer.setPixelRatio(next);
      }
    } catch (e) { /* DPR is best-effort; never break the frame */ }
  }
}
