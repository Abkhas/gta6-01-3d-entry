// Palma Verde 3D — vehicles: the hero Cometa GT, traffic cars,
// and the Gull air-taxi helicopter.
//
// Every group is built nose-forward on local +x, origin on the
// ground under the centre, y-up. The caller positions the group at
// the hero's three-space position and sets rotation.y = -heading
// (heading in the camera contract: forward = (cos h, 0, sin h)).
// Geometry is in metres, matching B1's world (config3d.js: +X
// east, +Z south, +Y up, city -1400..+1400) — a car is 4.6 m long,
// a person 1.8 m tall, the Gull's rotor 6.8 m across.
//
// Motion is the caller's job; each group carries a userData.update
// that only adds the feel on top: wheel spin, suspension lean in
// corners, rotor spin. Speeds are metres per second; anything above
// 40 is read as 2D world units and scaled by 0.1 (same rule as the
// camera), so a 2D speed of 176 arrives as a plausible 17.6 m/s.

import * as THREE from '../vendor/three.module.min.js';

// ---- shared bits -------------------------------------------------

function paint(color, roughness, metalness) {
  return new THREE.MeshStandardMaterial({
    color: color, roughness: roughness, metalness: metalness
  });
}

function glassMat() {
  return new THREE.MeshStandardMaterial({
    color: 0x182840, roughness: 0.08, metalness: 0.9
  });
}

function darkMat() {
  return new THREE.MeshStandardMaterial({
    color: 0x151515, roughness: 0.85, metalness: 0.2
  });
}

function lampMat(color) {
  return new THREE.MeshStandardMaterial({
    color: color, emissive: color, emissiveIntensity: 0.9,
    roughness: 0.3, metalness: 0.1
  });
}

function box(w, h, d, material, x, y, z) {
  var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  return m;
}

function normSpeed(speed) {
  var s = Math.abs(speed || 0);
  if (s > 40) s *= 0.1;
  return Math.min(s, 40);
}

// A soft contact shadow so the car reads as sitting on the road
// even before the scene's real shadows are tuned.
function contactShadow(rx, rz, opacity) {
  var m = new THREE.Mesh(
    new THREE.CircleGeometry(1, 24),
    new THREE.MeshBasicMaterial({
      color: 0x000000, transparent: true, opacity: opacity,
      depthWrite: false
    })
  );
  m.rotation.x = -Math.PI / 2;
  m.scale.set(rx, rz, 1);
  m.position.y = 0.02;
  return m;
}

// ---- headlight glow, beam and pool -----------------------------------
//
// One shared radial-gradient canvas texture for every lamp glow in
// the city: drawn once, reused by all sprites and ground quads, so
// twenty cars do not each bake their own texture. Additive blending
// means the glow only ever adds light — it never paints a grey disc
// over the road or the bodywork.
var sharedGlowTex = null;
function glowTexture() {
  if (sharedGlowTex) return sharedGlowTex;
  var c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  var g = c.getContext('2d');
  var grad = g.createRadialGradient(64, 64, 2, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.3, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.7, 'rgba(255,255,255,0.12)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  var tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  sharedGlowTex = tex;
  return tex;
}

// A camera-facing glow sprite: unlike a flat quad it reads from any
// angle, so a headlight still blooms when the camera sits behind
// the car on the chase view.
function glowSprite(color, size) {
  var mat = new THREE.SpriteMaterial({
    map: glowTexture(), color: color, transparent: true, opacity: 0.8,
    blending: THREE.AdditiveBlending, depthWrite: false
  });
  var s = new THREE.Sprite(mat);
  s.scale.set(size, size, 1);
  return s;
}

// A flat additive quad lying on the asphalt, for beam splashes and
// light pools. The radial texture stretched over the plane fades the
// edges to nothing, so there is no hard rectangle on the road.
function groundGlow(color, w, d) {
  var mat = new THREE.MeshBasicMaterial({
    map: glowTexture(), color: color, transparent: true, opacity: 0.4,
    blending: THREE.AdditiveBlending, depthWrite: false
  });
  var m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 1;
  return m;
}

// ---- cars --------------------------------------------------------

// Traffic palette: the same street colours the 2D roster drives,
// so a traffic jam reads as the same city.
var TRAFFIC_PALETTE = [
  '#3d7ea6', '#e8c53a', '#2b2f38', '#7a8a6a', '#f2a007',
  '#e86a92', '#4a6b4f', '#8c2f2f', '#e07840', '#2e6f7e',
  '#6a8f5a', '#c9c2d4', '#3a5a8c', '#8c8a92', '#6b4a26', '#c9c2b4'
];
var paletteCursor = 0;

var WHEEL_R = 0.36;
var WHEEL_X = 1.45; // axle offset from centre, front and rear
var WHEEL_Z = 1.0; // axle offset from centre, left and right — pushed
// out so the tyres stand proud of the 2.0 m body and read from the
// chase camera behind, instead of hiding inside the bodywork.

function makeWheel(detailed) {
  // A wrapper group at the axle: the inner spinner turns around the
  // axle (local z after the tyre is laid flat) so the spin reads.
  var wrapper = new THREE.Group();
  var spinner = new THREE.Group();
  // Hero tyres are wider (0.36) so they read from behind; traffic
  // keeps the narrower 0.28.
  var tyreW = detailed ? 0.36 : 0.28;
  var tyre = new THREE.Mesh(
    new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, tyreW, 20),
    darkMat()
  );
  tyre.rotation.x = Math.PI / 2;
  spinner.add(tyre);
  var hub = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.22, tyreW + 0.04, 12),
    paint(0xd8d8d8, 0.35, 0.8)
  );
  hub.rotation.x = Math.PI / 2;
  spinner.add(hub);
  if (detailed) {
    // Five full-length spokes so the spin is visible, not just a
    // grey disc, and the wheel reads as a wheel from the rear.
    for (var i = 0; i < 5; i++) {
      var spoke = box(0.62, 0.07, tyreW + 0.02, paint(0x8a8a92, 0.4, 0.7), 0, 0, 0);
      spoke.rotation.z = (i / 5) * Math.PI;
      spinner.add(spoke);
    }
  }
  wrapper.add(spinner);
  wrapper.userData.spinner = spinner;
  return wrapper;
}

// One builder for every car in the city. detail 3 is the hero:
// racing stripe, spoiler, mirrors, spoked wheels, headlight cones.
// detail 1 is traffic: same body and glass, fewer meshes.
function buildCar(color, detailed) {
  var group = new THREE.Group();
  var body = new THREE.Group(); // leans on its suspension; wheels stay put
  group.add(body);
  group.add(contactShadow(2.55, 1.25, 0.25));

  // Beam splash + light pool on the road ahead, in the group (not
  // the leaning body) so they stay glued to the asphalt. The splash
  // is a long faint-blue ellipse stretching ~10 m forward from the
  // nose; the pool is a shorter, brighter ellipse under the beam's
  // near end — the headlights' answer to the street-lamp pools.
  // Both sit just above the contact shadow (y 0.02) so they never
  // z-fight it, and both are driven by applyLampLevels below.
  var beam = groundGlow(0xaac8ff, 10.5, 3.4);
  beam.position.set(2.3 + 5.2, 0.04, 0);
  group.add(beam);
  var pool = groundGlow(0xcfe0ff, 7.0, 4.6);
  pool.position.set(2.3 + 3.2, 0.05, 0);
  group.add(pool);

  var base = new THREE.Color(color);
  var bodyMat = paint(color, 0.35, 0.6);
  var skirtMat = paint(base.clone().multiplyScalar(0.55).getHex(), 0.5, 0.4);
  var glass = glassMat();

  // Main body, low skirt, sloped hood: a long low shape, not a box
  // with a box on top.
  body.add(box(4.6, 0.55, 2.0, bodyMat, 0, 0.55, 0));
  body.add(box(4.4, 0.22, 1.9, skirtMat, 0, 0.28, 0));
  var hood = box(1.2, 0.16, 1.86, bodyMat, 1.55, 0.86, 0);
  hood.rotation.z = -0.10;
  body.add(hood);
  // Glasshouse with a painted roof panel, so the cabin reads as
  // glass from every angle and paint from above.
  body.add(box(2.3, 0.52, 1.72, glass, -0.15, 1.08, 0));
  body.add(box(2.3, 0.08, 1.5, bodyMat, -0.15, 1.36, 0));
  // Windshield light streak.
  var streak = box(0.02, 0.34, 0.5,
    new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.3
    }), 1.02, 1.08, 0);
  body.add(streak);
  // Rear window: a distinct dark glass panel set into the back face
  // of the glasshouse, so the rear reads as glass, not painted body.
  body.add(box(0.05, 0.42, 1.5, glass, -1.31, 1.08, 0));
  // Side glass: proud dark panels on both flanks of the glasshouse,
  // split front/rear by a body-colour B-pillar strip, with a
  // beltline under them.
  for (var sg = -1; sg <= 1; sg += 2) {
    body.add(box(2.0, 0.38, 0.04, glass, -0.15, 1.08, 0.87 * sg));
    body.add(box(0.06, 0.38, 0.05, bodyMat, -0.15, 1.08, 0.87 * sg));
    body.add(box(2.3, 0.05, 0.02, darkMat(), -0.15, 0.84, 0.87 * sg));
    // Panel lines: a side character line, door shut lines, and
    // door handles, so the flanks read as panelled bodywork.
    body.add(box(3.8, 0.03, 0.02, darkMat(), 0, 0.70, 1.005 * sg));
    body.add(box(0.03, 0.5, 0.02, darkMat(), 0.55, 0.55, 1.005 * sg));
    body.add(box(0.03, 0.5, 0.02, darkMat(), -0.85, 0.55, 1.005 * sg));
    body.add(box(0.22, 0.05, 0.04, darkMat(), 0.35, 0.78, 1.01 * sg));
    body.add(box(0.22, 0.05, 0.04, darkMat(), -0.55, 0.78, 1.01 * sg));
  }
  // Trunk shut line across the deck.
  body.add(box(0.03, 0.02, 1.7, darkMat(), -1.95, 0.84, 0));
  // Grille, bumpers, lamps.
  body.add(box(0.04, 0.18, 1.1, darkMat(), 2.31, 0.45, 0));
  body.add(box(0.04, 0.05, 1.1,
    paint(0xc0c0c0, 0.3, 0.9), 2.33, 0.45, 0));
  body.add(box(0.12, 0.16, 2.02, darkMat(), 2.32, 0.30, 0));
  body.add(box(0.12, 0.16, 2.02, darkMat(), -2.32, 0.30, 0));
  var headMat = lampMat(0xfff2b0);
  var tailMat = lampMat(0xff2e2e);
  tailMat.emissiveIntensity = 1.5; // taillights glow from behind
  body.add(box(0.06, 0.18, 0.40, headMat, 2.31, 0.62, 0.62));
  body.add(box(0.06, 0.18, 0.40, headMat, 2.31, 0.62, -0.62));
  body.add(box(0.06, 0.16, 0.42, tailMat, -2.31, 0.62, 0.62));
  body.add(box(0.06, 0.16, 0.42, tailMat, -2.31, 0.62, -0.62));
  // Full-width rear light bar joining the taillights.
  body.add(box(0.05, 0.10, 1.5, tailMat, -2.32, 0.62, 0));
  // Lamp glow: near-white sprites on the headlights, red sprites on
  // the taillights, sitting just proud of the lamp faces. Sprites
  // face the camera, so the lamps bloom from the front, the side,
  // and the rear three-quarter chase view alike. Opacity is driven
  // by applyLampLevels below; the lenses themselves are also pushed
  // past emissive 1 so they read as lit, not painted.
  headMat.emissiveIntensity = 2.0;
  var headGlowL = glowSprite(0xd8ecff, 1.15);
  headGlowL.position.set(2.38, 0.62, 0.62);
  body.add(headGlowL);
  var headGlowR = glowSprite(0xd8ecff, 1.15);
  headGlowR.position.set(2.38, 0.62, -0.62);
  body.add(headGlowR);
  var tailGlowL = glowSprite(0xff2a1e, 0.95);
  tailGlowL.position.set(-2.38, 0.62, 0.62);
  body.add(tailGlowL);
  var tailGlowR = glowSprite(0xff2a1e, 0.95);
  tailGlowR.position.set(-2.38, 0.62, -0.62);
  body.add(tailGlowR);
  // Rear diffuser valance with fins, twin chrome exhausts, and a
  // licence plate — the whole rear face, not a flat red slab.
  body.add(box(0.10, 0.14, 1.7, darkMat(), -2.30, 0.20, 0));
  for (var df = -1; df <= 1; df++) {
    body.add(box(0.10, 0.12, 0.04, darkMat(), -2.36, 0.20, 0.3 * df));
  }
  for (var ex = -1; ex <= 1; ex += 2) {
    var pipe = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 0.18, 10),
      paint(0xc0c0c0, 0.3, 0.9)
    );
    pipe.rotation.z = Math.PI / 2;
    pipe.position.set(-2.34, 0.16, 0.55 * ex);
    body.add(pipe);
  }
  body.add(box(0.03, 0.18, 0.55,
    new THREE.MeshStandardMaterial({
      color: 0xe8e8e8, roughness: 0.5, metalness: 0.1
    }), -2.32, 0.45, 0));

  var cones = [];
  if (detailed) {
    // Racing stripe down the centre line, hood to trunk.
    var stripeMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.55
    });
    body.add(box(1.6, 0.02, 0.5, stripeMat, 1.5, 0.86, 0));
    body.add(box(2.3, 0.02, 0.5, stripeMat, -0.15, 1.41, 0));
    body.add(box(0.9, 0.02, 0.5, stripeMat, -1.85, 0.84, 0));
    // Rear spoiler on two posts, with a centre third brake light
    // facing the chase camera.
    body.add(box(0.08, 0.18, 0.08, skirtMat, -2.15, 0.92, 0.6));
    body.add(box(0.08, 0.18, 0.08, skirtMat, -2.15, 0.92, -0.6));
    body.add(box(0.5, 0.06, 1.9, skirtMat, -2.18, 1.03, 0));
    body.add(box(0.06, 0.05, 0.5, tailMat, -2.44, 1.04, 0));
    // Wheel-arch eyebrows over each wheel, so the arches read
    // from the side and the rear three-quarter.
    for (var fa = -1; fa <= 1; fa += 2) {
      for (var fb = -1; fb <= 1; fb += 2) {
        body.add(box(1.0, 0.08, 0.06, skirtMat, WHEEL_X * fa, 0.82, 1.02 * fb));
      }
    }
    // Side mirrors.
    body.add(box(0.12, 0.10, 0.16, bodyMat, 0.75, 1.0, 1.0));
    body.add(box(0.12, 0.10, 0.16, bodyMat, 0.75, 1.0, -1.0));
    // Headlight cones spilling forward onto the road.
    for (var s = -1; s <= 1; s += 2) {
      var cone = new THREE.Mesh(
        new THREE.ConeGeometry(0.55, 3.4, 12, 1, true),
        new THREE.MeshBasicMaterial({
          color: 0xfff0b0, transparent: true, opacity: 0.07,
          blending: THREE.AdditiveBlending, depthWrite: false,
          side: THREE.DoubleSide
        })
      );
      cone.rotation.z = -Math.PI / 2; // apex back at the lamp, base forward
      cone.position.set(2.3 + 1.7, 0.5, 0.62 * s);
      body.add(cone);
      cones.push(cone);
    }
  }

  // Wheels: four, each spinning on its own axle.
  var wheels = [];
  var wx, wz;
  for (wx = -1; wx <= 1; wx += 2) {
    for (wz = -1; wz <= 1; wz += 2) {
      var wheel = makeWheel(detailed);
      wheel.position.set(WHEEL_X * wx, WHEEL_R, WHEEL_Z * wz);
      group.add(wheel);
      wheels.push(wheel.userData.spinner);
    }
  }

  var dent = null;
  if (detailed) {
    // A dark dent patch on the hood flank, invisible until damage.
    dent = new THREE.Mesh(
      new THREE.SphereGeometry(0.35, 12, 8),
      new THREE.MeshStandardMaterial({
        color: 0x282828, roughness: 0.9, metalness: 0.1,
        transparent: true, opacity: 0
      })
    );
    dent.scale.set(1.4, 0.35, 0.9);
    dent.position.set(-0.9, 0.88, 0.85);
    body.add(dent);
  }

  var prevSpeed = 0;
  var roll = 0;
  var pitch = 0;

  group.userData.update = function (dt, speed, steer) {
    var s = normSpeed(speed);
    var step = Math.max(0, Math.min(dt, 0.1));
    // Wheel spin: one turn per circumference travelled.
    var spin = (s * step) / WHEEL_R;
    for (var i = 0; i < wheels.length; i++) {
      wheels[i].rotation.z -= spin;
    }
    // Suspension lean: the body rolls out of a corner and pitches
    // with acceleration — nose down under braking, squat on the
    // throttle. steer is signed the same way as heading change.
    var speedFactor = Math.min(Math.abs(s) / 8, 1);
    var targetRoll = -(steer || 0) * 0.06 * speedFactor;
    var accel = step > 0 ? (s - prevSpeed) / step : 0;
    prevSpeed = s;
    var targetPitch = Math.max(-0.06, Math.min(0.06, accel * 0.006));
    var k = 1 - Math.exp(-step / 0.15);
    roll += (targetRoll - roll) * k;
    pitch += (targetPitch - pitch) * k;
    body.rotation.x = roll;
    body.rotation.z = pitch;
    // Brake flare: hard deceleration flares the taillight glow, so
    // a car slowing ahead of the hero reads as braking. Smoothed
    // with the same spring constant as the suspension lean.
    var targetBrake = accel < -3 ? 1 : 0;
    brakeF += (targetBrake - brakeF) * k;
    if (Math.abs(brakeF - targetBrake) < 0.02) brakeF = targetBrake;
    applyLampLevels();
  };

  // Light levels. nightF is 0 by day (lamps are lenses only) and 1
  // at full night; it scales the beam, the pool and the glow. It
  // defaults to 0.7 — dusk — because the frozen night shot never
  // calls setLights or setNightness, so the build-time level is what
  // the screenshot shows; live callers can dial it per frame with
  // setNightness. brakeF is the brake flare, 0..1, smoothed in
  // update() from hard deceleration and settable via setBrake.
  var nightF = 0.7;
  var lightsOn = true;
  var brakeF = 0;
  function applyLampLevels() {
    var nf = lightsOn ? nightF : 0;
    headMat.emissiveIntensity = lightsOn ? 1.2 + 1.6 * nightF : 0.9;
    tailMat.emissiveIntensity = 1.5 + brakeF * 1.5;
    headGlowL.material.opacity = 0.15 + 0.75 * nf;
    headGlowR.material.opacity = 0.15 + 0.75 * nf;
    tailGlowL.material.opacity = 0.3 + 0.5 * nf + brakeF * 0.35;
    tailGlowR.material.opacity = 0.3 + 0.5 * nf + brakeF * 0.35;
    beam.material.opacity = 0.3 * nf;
    pool.material.opacity = 0.55 * nf;
    for (var i = 0; i < cones.length; i++) {
      cones[i].material.opacity = lightsOn ? 0.07 + 0.11 * nightF : 0.07;
    }
  }

  group.userData.setLights = function (on, night) {
    lightsOn = !!on;
    if (typeof night === 'number') nightF = Math.max(0, Math.min(1, night));
    applyLampLevels();
  };

  group.userData.setNightness = function (v) {
    if (typeof v === 'number') nightF = Math.max(0, Math.min(1, v));
    applyLampLevels();
  };

  group.userData.setBrake = function (on) {
    brakeF = on ? 1 : 0;
    applyLampLevels();
  };

  applyLampLevels();

  if (detailed) {
    var damaged = new THREE.Color(0x4a3a32);
    group.userData.setDamage = function (d) {
      var f = Math.max(0, Math.min(100, d || 0)) / 100;
      bodyMat.color.copy(base).lerp(damaged, f * 0.5);
      if (dent) dent.material.opacity = f * 0.85;
    };
  }

  return group;
}

// The hero: a bright coral-red Cometa GT, the prize of the second
// mission. Tier-3 detail, with a damage hook the garage and combat
// layers drive.
export function createHeroCar() {
  return buildCar('#ff4f3d', true);
}

// Traffic: same assembly, cheaper (no stripe, spoiler, mirrors,
// spokes or light cones), in a street colour. Pass a colour, or one
// is picked from the roster palette in turn so the street varies.
export function createTrafficCar(color) {
  var c = color;
  if (!c) {
    c = TRAFFIC_PALETTE[paletteCursor % TRAFFIC_PALETTE.length];
    paletteCursor++;
  }
  return buildCar(c, false);
}

// ---- the Gull ----------------------------------------------------

// The Gull: Rey's flyable air-taxi helicopter. Gold body, a spinning
// main rotor with a translucent blur disc, tail boom and fin, tail
// rotor, skids, nav lights, a forward-down spotlight cone, and a
// shadow blob that stays on the deck below and fades as she climbs.
// Origin on the ground under the skids; the caller sets the group's
// y to the current altitude.
export function createHeli() {
  var group = new THREE.Group();
  var airframe = new THREE.Group(); // bobs gently when airborne
  group.add(airframe);

  var gold = paint(0xffd166, 0.4, 0.55);
  var goldDark = paint(0xd9a83c, 0.5, 0.5);
  var glass = glassMat();

  // Main cabin: a proper helicopter fuselage — a flat-sided box
  // with a flat belly, NOT a sphere — so the Gull reads as a heli
  // from every angle instead of a gold ball.
  airframe.add(box(2.8, 1.35, 1.9, gold, -0.2, 1.35, 0));
  // Sloped nose tapering down-forward, with dark cockpit glass
  // proud of it and a glare streak.
  var nose = box(1.0, 1.0, 1.7, gold, 1.45, 1.15, 0);
  nose.rotation.z = -0.38;
  airframe.add(nose);
  var cockpit = box(0.85, 0.75, 1.75, glass, 1.5, 1.5, 0);
  cockpit.rotation.z = -0.38;
  airframe.add(cockpit);
  var glare = box(0.04, 0.4, 0.5,
    new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.25
    }), 1.88, 1.6, 0);
  glare.rotation.z = -0.38;
  airframe.add(glare);
  // Side windows and door shut lines on both flanks.
  for (var sw = -1; sw <= 1; sw += 2) {
    airframe.add(box(1.3, 0.55, 0.04, glass, -0.35, 1.55, 0.96 * sw));
    airframe.add(box(0.7, 0.5, 0.04, glass, -1.15, 1.5, 0.96 * sw));
    airframe.add(box(0.03, 1.0, 0.02, darkMat(), 0.35, 1.3, 0.96 * sw));
    airframe.add(box(0.03, 1.0, 0.02, darkMat(), -0.95, 1.3, 0.96 * sw));
  }
  // Engine deck hump under the mast, and a flat belly plate.
  airframe.add(box(1.5, 0.35, 1.2, goldDark, -0.1, 2.15, 0));
  airframe.add(box(2.4, 0.1, 1.7, goldDark, -0.2, 0.66, 0));
  // Belly stripe.
  airframe.add(box(2.6, 0.14, 2.3, goldDark, -0.1, 0.62, 0));

  // Tail boom, tapering to the fin, with a stabiliser and tail
  // rotor. The tail is at -x (rear): nose-forward is +x, so the
  // boom runs backwards from the cabin, not forwards through the
  // cockpit as it did before.
  var boom = new THREE.Mesh(
    new THREE.CylinderGeometry(0.34, 0.18, 3.4, 10), gold);
  boom.rotation.z = -Math.PI / 2; // top radius (0.34) lands at +x,
  // the cabin end; the tail tip tapers to 0.18.
  boom.position.set(-2.9, 1.6, 0);
  airframe.add(boom);
  airframe.add(box(0.08, 1.5, 0.7, gold, -4.55, 2.0, 0));
  airframe.add(box(0.5, 0.06, 1.6, goldDark, -4.3, 1.5, 0));
  var tailRotor = new THREE.Group();
  tailRotor.position.set(-4.6, 1.75, 0.35);
  var tailBlade = box(0.04, 0.9, 0.08, darkMat(), 0, 0, 0);
  tailRotor.add(tailBlade);
  var tailBlade2 = box(0.04, 0.08, 0.9, darkMat(), 0, 0, 0);
  tailRotor.add(tailBlade2);
  airframe.add(tailRotor);

  // Main rotor: mast, crossed blades, and a translucent disc that
  // fades in as the blades blur with speed.
  var mast = new THREE.Mesh(
    new THREE.CylinderGeometry(0.09, 0.09, 0.5, 10), darkMat());
  mast.position.set(0, 2.5, 0);
  airframe.add(mast);
  var rotor = new THREE.Group();
  rotor.position.set(0, 2.78, 0);
  var bladeMat = darkMat();
  rotor.add(box(6.8, 0.04, 0.3, bladeMat, 0, 0, 0));
  var blade2 = box(6.8, 0.04, 0.3, bladeMat, 0, 0, 0);
  blade2.rotation.y = Math.PI / 2;
  rotor.add(blade2);
  rotor.add(new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.22, 0.14, 12), goldDark));
  airframe.add(rotor);
  var disc = new THREE.Mesh(
    new THREE.CircleGeometry(3.4, 32),
    new THREE.MeshBasicMaterial({
      color: 0xc8d4e0, transparent: true, opacity: 0.06,
      side: THREE.DoubleSide, depthWrite: false
    })
  );
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 2.78;
  airframe.add(disc);

  // Skids on four short struts.
  for (var s = -1; s <= 1; s += 2) {
    airframe.add(box(3.0, 0.07, 0.07, darkMat(), 0, 0.25, 0.85 * s));
    airframe.add(box(0.07, 0.6, 0.07, darkMat(), 0.9, 0.55, 0.85 * s));
    airframe.add(box(0.07, 0.6, 0.07, darkMat(), -0.9, 0.55, 0.85 * s));
  }

  // Nav lights: red port, green starboard, white tail.
  var navR = new THREE.Mesh(
    new THREE.SphereGeometry(0.07, 8, 8), lampMat(0xff2e2e));
  navR.position.set(0, 1.3, -1.28);
  airframe.add(navR);
  var navG = new THREE.Mesh(
    new THREE.SphereGeometry(0.07, 8, 8), lampMat(0x2eff5e));
  navG.position.set(0, 1.3, 1.28);
  airframe.add(navG);
  var navW = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 8, 8), lampMat(0xffffff));
  navW.position.set(-4.6, 1.6, 0);
  airframe.add(navW);

  // Spotlight cone, apex at the nose, pooling forward-down.
  var spot = new THREE.Mesh(
    new THREE.ConeGeometry(2.2, 6.0, 16, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xfff0b0, transparent: true, opacity: 0.12,
      blending: THREE.AdditiveBlending, depthWrite: false,
      side: THREE.DoubleSide
    })
  );
  spot.position.set(1.6, -1.4, 0);
  spot.visible = false;
  airframe.add(spot);

  // Shadow blob on the deck below. Its height is re-set every
  // update from the group's own altitude.
  var blob = new THREE.Mesh(
    new THREE.CircleGeometry(2.8, 24),
    new THREE.MeshBasicMaterial({
      color: 0x000000, transparent: true, opacity: 0.28,
      depthWrite: false
    })
  );
  blob.rotation.x = -Math.PI / 2;
  group.add(blob);

  var bobT = 0;
  group.userData.update = function (dt, rotorSpeed) {
    var step = Math.max(0, Math.min(dt, 0.1));
    var rs = rotorSpeed || 0;
    rotor.rotation.y += rs * step;
    tailRotor.rotation.x += rs * 1.6 * step; // tail disc is in the
    // YZ plane, so it spins around the boom (x) axis.
    // The blur disc thickens with rotor speed.
    disc.material.opacity = Math.max(0.06,
      Math.min(0.22, 0.06 + rs * 0.008));
    // Gentle hover bob, only once she is off the deck.
    bobT += step;
    var alt = group.position.y;
    if (alt > 0.5) {
      airframe.position.y = Math.sin(bobT * 2.0) * 0.06;
    } else {
      airframe.position.y = 0;
    }
    // Shadow stays on the ground and fades as she climbs.
    var f = Math.max(0.35, 1 - alt / 120);
    blob.position.y = -alt + 0.06;
    blob.material.opacity = 0.28 * f;
    var sc = 0.7 + 0.3 * f;
    blob.scale.set(sc, sc, 1);
  };

  group.userData.setSpotlight = function (on) {
    spot.visible = !!on;
  };

  group.userData.rotor = rotor;
  return group;
}
