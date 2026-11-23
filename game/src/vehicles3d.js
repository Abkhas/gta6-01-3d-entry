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
var WHEEL_Z = 0.92; // axle offset from centre, left and right

function makeWheel(detailed) {
  // A wrapper group at the axle: the inner spinner turns around the
  // axle (local z after the tyre is laid flat) so the spin reads.
  var wrapper = new THREE.Group();
  var spinner = new THREE.Group();
  var tyre = new THREE.Mesh(
    new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.28, 20),
    darkMat()
  );
  tyre.rotation.x = Math.PI / 2;
  spinner.add(tyre);
  var hub = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 0.2, 0.3, 12),
    paint(0xd8d8d8, 0.35, 0.8)
  );
  hub.rotation.x = Math.PI / 2;
  spinner.add(hub);
  if (detailed) {
    // Three spokes so the spin is visible, not just a grey disc.
    for (var i = 0; i < 3; i++) {
      var spoke = box(0.34, 0.06, 0.31, paint(0x8a8a92, 0.4, 0.7), 0, 0, 0);
      spoke.rotation.z = (i / 3) * Math.PI;
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
  // Grille, bumpers, lamps.
  body.add(box(0.04, 0.18, 1.1, darkMat(), 2.31, 0.45, 0));
  body.add(box(0.12, 0.16, 2.02, darkMat(), 2.32, 0.30, 0));
  body.add(box(0.12, 0.16, 2.02, darkMat(), -2.32, 0.30, 0));
  var headMat = lampMat(0xfff2b0);
  var tailMat = lampMat(0xff2e2e);
  body.add(box(0.06, 0.14, 0.34, headMat, 2.31, 0.62, 0.62));
  body.add(box(0.06, 0.14, 0.34, headMat, 2.31, 0.62, -0.62));
  body.add(box(0.06, 0.12, 0.30, tailMat, -2.31, 0.62, 0.62));
  body.add(box(0.06, 0.12, 0.30, tailMat, -2.31, 0.62, -0.62));

  var cones = [];
  if (detailed) {
    // Racing stripe down the centre line, hood to trunk.
    var stripeMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.55
    });
    body.add(box(1.6, 0.02, 0.5, stripeMat, 1.5, 0.86, 0));
    body.add(box(2.3, 0.02, 0.5, stripeMat, -0.15, 1.41, 0));
    body.add(box(0.9, 0.02, 0.5, stripeMat, -1.85, 0.84, 0));
    // Rear spoiler on two posts.
    body.add(box(0.08, 0.18, 0.08, skirtMat, -2.15, 0.92, 0.6));
    body.add(box(0.08, 0.18, 0.08, skirtMat, -2.15, 0.92, -0.6));
    body.add(box(0.5, 0.06, 1.9, skirtMat, -2.18, 1.03, 0));
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
  };

  group.userData.setLights = function (on) {
    for (var i = 0; i < cones.length; i++) {
      cones[i].material.opacity = on ? 0.18 : 0.07;
    }
    headMat.emissiveIntensity = on ? 1.6 : 0.9;
  };

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

  // Main cabin: a smooth scaled sphere, not a box — the Gull reads
  // round and friendly from every angle.
  var cabin = new THREE.Mesh(new THREE.SphereGeometry(1.0, 24, 18), gold);
  cabin.scale.set(1.9, 1.05, 1.25);
  cabin.position.set(0, 1.35, 0);
  airframe.add(cabin);
  // Cockpit bubble, forward and proud of the nose.
  var bubble = new THREE.Mesh(new THREE.SphereGeometry(0.62, 16, 12), glass);
  bubble.scale.set(1.0, 0.8, 1.1);
  bubble.position.set(1.35, 1.45, 0);
  airframe.add(bubble);
  // Belly stripe.
  airframe.add(box(2.6, 0.14, 2.3, goldDark, -0.1, 0.62, 0));

  // Tail boom, tapering to the fin, with a stabiliser and tail rotor.
  var boom = new THREE.Mesh(
    new THREE.CylinderGeometry(0.14, 0.30, 3.4, 10), gold);
  boom.rotation.z = -Math.PI / 2;
  boom.position.set(2.9, 1.6, 0);
  airframe.add(boom);
  airframe.add(box(0.08, 1.1, 0.5, gold, 4.5, 1.9, 0));
  airframe.add(box(0.5, 0.06, 1.4, goldDark, 4.3, 1.5, 0));
  var tailRotor = new THREE.Group();
  tailRotor.position.set(4.55, 1.75, 0.3);
  var tailBlade = box(0.04, 0.9, 0.08, darkMat(), 0, 0, 0);
  tailRotor.add(tailBlade);
  var tailBlade2 = box(0.04, 0.9, 0.08, darkMat(), 0, 0, 0);
  tailBlade2.rotation.z = Math.PI / 2;
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
    airframe.add(box(2.6, 0.07, 0.07, darkMat(), 0, 0.25, 0.85 * s));
    airframe.add(box(0.07, 0.6, 0.07, darkMat(), 0.7, 0.55, 0.85 * s));
    airframe.add(box(0.07, 0.6, 0.07, darkMat(), -0.7, 0.55, 0.85 * s));
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
  navW.position.set(4.6, 1.6, 0);
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
    tailRotor.rotation.z += rs * 1.6 * step;
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
