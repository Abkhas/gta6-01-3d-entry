// Palma Verde 3D — sky dome, sun, moon, stars and clouds.
// The dome is a big inverted sphere with a two-colour gradient shader;
// the sun is a disc plus a glow sprite, the moon a pale disc, the stars
// a point cloud that only shows at night. setTimeOfDay drives the grade
// from config3d.js: sky colours, sun position, lights and fog together.

import * as THREE from 'three';
import { CFG3D } from './config3d.js';

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
  return tex;
}

export function createSky(scene) {
  const sky = {};

  // Gradient dome: vertex-height mix between horizon and zenith colours.
  const domeMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      topColor: { value: new THREE.Color('#3f7fd0') },
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
      uniform vec3 horizonColor;
      varying vec3 vPos;
      void main() {
        float h = clamp(normalize(vPos).y * 1.6 + 0.12, 0.0, 1.0);
        gl_FragColor = vec4(mix(horizonColor, topColor, h), 1.0);
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
  const sunLight = new THREE.DirectionalLight('#fff1cf', 2.4);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.left = -1600;
  sunLight.shadow.camera.right = 1600;
  sunLight.shadow.camera.top = 1600;
  sunLight.shadow.camera.bottom = -1600;
  sunLight.shadow.camera.near = 100;
  sunLight.shadow.camera.far = 9000;
  sunLight.shadow.bias = -0.0004;
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
  sky.domeMat.uniforms.horizonColor.value.set(fg.skyHorizon);

  placeBody(sky.sun, fg.sunElevation, fg.sunAzimuth);
  sky.sunGlow.position.copy(sky.sun.position);
  sky.sunMat.color.set(fg.sunColor);
  sky.sun.visible = fg.sunElevation > 0;
  sky.sunGlow.material.opacity = fg.sunElevation > 0 ? 0.85 : 0;
  // The moon hangs HIGH and to the EAST SIDE (elevation 68, azimuth
  // 70), not mirrored off the sun: the old mirror put it low enough
  // to sit on the title screen's save slots, which live lower-center.
  // High + sideways keeps it clear of the menu area in any frame.
  placeBody(sky.moon, 68, 70);
  sky.moon.visible = fg.stars > 0;
  sky.starMat.opacity = fg.stars * 0.9;

  sky.sunLight.color.set(fg.sunColor);
  sky.sunLight.intensity = fg.sunIntensity;
  sky.sunLight.position.copy(sky.sun.position).multiplyScalar(0.9);
  sky.sunLight.position.y = Math.max(sky.sunLight.position.y, 400);
  sky.hemi.color.set(fg.hemiSky);
  sky.hemi.groundColor.set(fg.hemiGround);
  sky.hemi.intensity = fg.hemiIntensity;

  scene.fog = new THREE.Fog(fg.fogColor, fg.fogNear, fg.fogFar);
  scene.background = null; // the dome is the background

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

// Per-frame sky motion: clouds drift with the wind, the wheel of the pier
// is the world module's job. `dt` is seconds since the last frame.
export function updateSky(scene, dt) {
  const sky = scene.userData.palmaSky;
  if (!sky) return;
  for (const c of sky.clouds) {
    c.position.x += c.userData.drift * dt;
    if (c.position.x > 5200) c.position.x = -5200;
  }
}
