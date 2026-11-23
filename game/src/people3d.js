// Palma Verde 3D — people.
//
// A readable human figure, never a dot, never a box: head and hair,
// torso with a jacket colour, swinging legs and arms, a weapon when
// armed. Origin on the ground under the feet, facing local +x, y-up.
// The caller positions the group and sets rotation.y = -heading
// (same contract as the vehicles).
//
// Sizes are metres, matching B1's world (config3d.js: +X east,
// +Z south, +Y up): Rey is 1.8 m tall. Pass opts.height to scale
// the whole figure.
//
// update(dt, speed, state): speed is metres per second — anything
// above 40 is read as 2D world units and scaled by 0.1, the same
// rule as the camera and vehicles (Rey walks at 150 in 2D units).
// state is a pose string — 'idle', 'walk', 'run', 'sprint', 'flee',
// 'duck', 'down', 'aim' — or an object { pose, aim } where aim is a
// heading in radians for the arms. Poses blend into each other, so
// a walk never snaps into a sprint.

import * as THREE from '../vendor/three.module.min.js';

function normSpeed(speed) {
  var s = Math.abs(speed || 0);
  if (s > 40) s *= 0.1;
  return Math.min(s, 9);
}

function mat(color, roughness) {
  return new THREE.MeshStandardMaterial({
    color: color, roughness: roughness === undefined ? 0.8 : roughness,
    metalness: 0.05
  });
}

function limb(rTop, rBottom, len, material) {
  // A slightly tapered cylinder, pivoted at its top end so the
  // parent group can swing it. Smooth sides, no hard pixel blocks.
  var mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(rTop, rBottom, len, 12), material);
  mesh.position.y = -len / 2;
  var pivot = new THREE.Group();
  pivot.add(mesh);
  return pivot;
}

var WEAPONS = {
  pistol: { len: 0.22, h: 0.05, grip: 0.12 },
  smg: { len: 0.42, h: 0.07, grip: 0.16 },
  shotgun: { len: 0.7, h: 0.08, grip: 0.16 },
  carbine: { len: 0.62, h: 0.07, grip: 0.16 },
  revolver: { len: 0.26, h: 0.06, grip: 0.12 },
  bat: { len: 0.6, h: 0.06, grip: 0.1 }
};

function makeWeapon(id) {
  var def = WEAPONS[id] || WEAPONS.pistol;
  var g = new THREE.Group();
  var dark = mat(0x1a1a1a, 0.5);
  var barrel = new THREE.Mesh(
    new THREE.BoxGeometry(def.len, def.h, 0.06), dark);
  barrel.position.set(def.len / 2 - 0.05, 0, 0);
  g.add(barrel);
  var grip = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, def.grip, 0.06), dark);
  grip.position.set(0, -def.grip / 2 + 0.01, 0);
  g.add(grip);
  if (id === 'smg' || id === 'carbine') {
    var mag = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.14, 0.05), dark);
    mag.position.set(def.len * 0.45, -0.09, 0);
    g.add(mag);
  }
  return g;
}

// opts: jacket, skin, pants, hair, shoes (colours), height (m,
// default 1.8), officer (dark PVPD uniform, cap, badge), armed,
// weapon ('pistol' | 'smg' | 'shotgun' | 'carbine' | 'revolver' |
// 'bat'). Rey is the default: coral jacket, 1.8 m.
export function createPerson(opts) {
  var o = opts || {};
  var height = o.height || 1.8;
  var officer = !!o.officer;
  var jacketCol = o.jacket || (officer ? '#23262f' : '#c94f3d');
  var skinCol = o.skin || '#e8b48f';
  var pantsCol = o.pants || (officer ? '#1a1d24' : '#23262f');
  var hairCol = o.hair || '#2c2c34';

  var group = new THREE.Group();
  var scale = height / 1.8;
  var figure = new THREE.Group(); // everything scales with height
  figure.scale.setScalar(scale);
  group.add(figure);

  // Contact shadow under the feet.
  var blob = new THREE.Mesh(
    new THREE.CircleGeometry(0.32, 20),
    new THREE.MeshBasicMaterial({
      color: 0x000000, transparent: true, opacity: 0.22,
      depthWrite: false
    })
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.02;
  figure.add(blob);

  var body = new THREE.Group(); // bobs, leans, crouches, falls
  figure.add(body);

  var skin = mat(skinCol, 0.65);
  var jacket = mat(jacketCol, 0.75);
  var pants = mat(pantsCol, 0.8);

  // Legs, pivoted at the hips (y 0.88), swinging forward and back.
  var legL = limb(0.075, 0.06, 0.86, pants);
  legL.position.set(0, 0.88, 0.11);
  var legR = limb(0.075, 0.06, 0.86, pants);
  legR.position.set(0, 0.88, -0.11);
  // Shoes, pointing forward.
  var shoeMat = mat(o.shoes || '#1a1a1a', 0.6);
  var shoeL = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.07, 0.11), shoeMat);
  shoeL.position.set(0.05, -0.85, 0);
  legL.add(shoeL);
  var shoeR = shoeL.clone();
  legR.add(shoeR);
  body.add(legL);
  body.add(legR);

  // Torso: jacket with a lighter chest panel.
  var torso = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.56, 0.44), jacket);
  torso.position.set(0, 1.16, 0);
  body.add(torso);
  var chest = new THREE.Mesh(
    new THREE.BoxGeometry(0.02, 0.4, 0.3),
    new THREE.MeshStandardMaterial({
      color: 0xffffff, transparent: true, opacity: 0.14,
      roughness: 0.8
    }));
  chest.position.set(0.14, 1.16, 0);
  body.add(chest);
  if (officer) {
    // Badge, belt, and a nightstick at the hip read as PVPD.
    var badge = new THREE.Mesh(
      new THREE.BoxGeometry(0.02, 0.06, 0.06),
      new THREE.MeshStandardMaterial({
        color: 0xffd166, metalness: 0.8, roughness: 0.3,
        emissive: 0xffd166, emissiveIntensity: 0.25
      }));
    badge.position.set(0.14, 1.3, -0.12);
    body.add(badge);
    var belt = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.05, 0.46), mat(0x151515, 0.5));
    belt.position.set(0, 0.9, 0);
    body.add(belt);
    var stick = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.025, 0.4, 8), mat(0x1a1a1a, 0.5));
    stick.position.set(-0.05, 0.72, -0.26);
    stick.rotation.z = 0.15;
    body.add(stick);
  }

  // Arms, pivoted at the shoulders (y 1.40).
  var armL = limb(0.055, 0.048, 0.6, jacket);
  armL.position.set(0, 1.40, 0.26);
  var armR = limb(0.055, 0.048, 0.6, jacket);
  armR.position.set(0, 1.40, -0.26);
  var handL = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), skin);
  handL.position.y = -0.62;
  armL.add(handL);
  var handR = handL.clone();
  armR.add(handR);
  body.add(armL);
  body.add(armR);

  // Head and hair at y 1.62, with a cap for officers.
  var head = new THREE.Group();
  head.position.set(0, 1.62, 0);
  var skull = new THREE.Mesh(new THREE.SphereGeometry(0.125, 16, 12), skin);
  head.add(skull);
  if (officer) {
    var cap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.14, 0.05, 14), mat(0x1a1d24, 0.6));
    cap.position.y = 0.1;
    head.add(cap);
    var brim = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.02, 0.2), mat(0x1a1d24, 0.6));
    brim.position.set(0.12, 0.08, 0);
    head.add(brim);
  } else {
    // Hair: a cap of sphere covering the top and back of the head.
    var hair = new THREE.Mesh(
      new THREE.SphereGeometry(0.132, 16, 12, 0, Math.PI * 2, 0, 1.9),
      mat(hairCol, 0.9));
    hair.position.set(-0.015, 0.015, 0);
    hair.rotation.z = -0.5;
    head.add(hair);
  }
  body.add(head);

  // Weapon in the right hand, when armed.
  var weapon = null;
  if (o.armed || o.weapon) {
    weapon = makeWeapon(o.weapon || 'pistol');
    weapon.position.set(0.05, -0.62, 0);
    armR.add(weapon);
  }

  // ---- animation state -------------------------------------------
  var phase = 0;
  var time = 0;
  var moveBlend = 0; // 0 idle .. 1 full stride
  var crouch = 0;    // 0 standing .. 1 ducked
  var downAmt = 0;   // 0 standing .. 1 flat on the ground
  var aimAmt = 0;    // 0 arms down .. 1 both arms forward

  function damp(cur, target, dt, tau) {
    return cur + (target - cur) * (1 - Math.exp(-dt / tau));
  }

  group.userData.update = function (dt, speed, state) {
    var step = Math.max(0, Math.min(dt, 0.1));
    time += step;
    var pose = 'idle';
    if (typeof state === 'string') pose = state;
    else if (state && state.pose) pose = state.pose;

    var s = normSpeed(speed);
    var moving = s > 0.15 || pose === 'walk' || pose === 'run' ||
      pose === 'sprint' || pose === 'flee';
    var targetMove = moving ? 1 : 0;
    var targetCrouch = pose === 'duck' ? 1 : 0;
    var targetDown = pose === 'down' ? 1 : 0;
    var targetAim = pose === 'aim' ? 1 : 0;
    moveBlend = damp(moveBlend, targetMove, step, 0.12);
    crouch = damp(crouch, targetCrouch, step, 0.12);
    downAmt = damp(downAmt, targetDown, step, 0.18);
    aimAmt = damp(aimAmt, targetAim, step, 0.12);

    // Stride: distance-based phase, so feet match ground speed
    // instead of flailing at a fixed rate. Stride length grows
    // from a walk to a sprint.
    var strideLen = 0.62 + 0.1 * s;
    if (moving) phase += (s * step * Math.PI * 2) / strideLen;
    var swing = Math.sin(phase);
    // Walk -> run -> sprint amplitude, scaled by the move blend.
    var amp = Math.min(0.95, 0.12 + 0.11 * s) * moveBlend;
    if (pose === 'flee') amp = Math.min(1.0, amp * 1.25);

    // Legs swing opposite, arms counter-swing; fleeing pumps hard.
    var armAmp = amp * (pose === 'flee' ? 0.95 : 0.7);
    legL.rotation.z = amp * swing * (1 - crouch * 0.4);
    legR.rotation.z = -amp * swing * (1 - crouch * 0.4);
    armL.rotation.z = -armAmp * swing;
    armR.rotation.z = armAmp * swing;

    // Duck: bend the legs, drop the body, guard with the arms.
    if (crouch > 0.01) {
      legL.rotation.z = legL.rotation.z * (1 - crouch) + 0.55 * crouch;
      legR.rotation.z = legR.rotation.z * (1 - crouch) - 0.4 * crouch;
      armL.rotation.z = armL.rotation.z * (1 - crouch) + 0.7 * crouch;
      armR.rotation.z = armR.rotation.z * (1 - crouch) + 0.7 * crouch;
    }
    // Aim: both arms forward along the facing, weapon leading.
    if (aimAmt > 0.01) {
      armL.rotation.z = armL.rotation.z * (1 - aimAmt) + 1.35 * aimAmt;
      armR.rotation.z = armR.rotation.z * (1 - aimAmt) + 1.35 * aimAmt;
      legL.rotation.z = legL.rotation.z * (1 - aimAmt) + 0.25 * aimAmt;
      legR.rotation.z = legR.rotation.z * (1 - aimAmt) - 0.2 * aimAmt;
    }

    // Bob on the stride, a forward lean at speed, a breath at rest.
    var speedFactor = Math.min(s / 4.5, 1) * moveBlend;
    body.position.y = Math.abs(Math.sin(phase)) * 0.035 * speedFactor
      + Math.sin(time * 1.5) * 0.008 * (1 - moveBlend);
    body.rotation.z = -0.08 * speedFactor - 0.14 * (pose === 'flee' ? 1 : 0) * moveBlend;
    body.scale.y = 1 - 0.22 * crouch;
    // Down: the whole figure tips flat onto its back.
    body.rotation.x = -1.45 * downAmt;
    if (downAmt > 0.01) body.position.y = 0.18 * downAmt;
  };

  group.userData.height = height;
  group.userData.isOfficer = officer;
  return group;
}
