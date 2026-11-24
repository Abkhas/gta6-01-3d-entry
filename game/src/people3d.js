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
// A NEGATIVE speed is backward movement (S while aiming): the cycle
// runs in reverse with short steps and a lean back. state is a pose
// string — 'idle', 'walk', 'run', 'sprint', 'flee', 'duck', 'down',
// 'aim' — or an object { pose, aim } where aim is a heading in
// radians for the arms. Poses blend into each other, so a walk never
// snaps into a sprint. Every figure gets its own gait (random phase,
// cadence, arm swing, stride) and its own idle behaviour (breathing,
// weight shift, looking around), so a crowd never moves in unison
// and a standing figure reads as alive, not frozen.

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

function capsuleLimb(radius, len, material) {
  // A capsule pivoted at its top end (same swing contract as limb).
  // len is the cylindrical mid-section; total length is len + 2*radius.
  // The rounded top reads as a shoulder, the rounded bottom as a wrist.
  var mesh = new THREE.Mesh(
    new THREE.CapsuleGeometry(radius, len, 4, 12), material);
  mesh.position.y = -(len / 2 + radius);
  var pivot = new THREE.Group();
  pivot.add(mesh);
  return pivot;
}

function roundedRectShape(w, h, r) {
  var s = new THREE.Shape();
  var x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false);
  s.lineTo(x + w, y + h - r);
  s.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false);
  s.lineTo(x + r, y + h);
  s.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(x, y + r);
  s.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}

function roundedBox(w, h, d, r) {
  // RoundedBoxGeometry is NOT vendored (game/vendor holds only the core
  // three module, no addons/), so build the same shape from core
  // ExtrudeGeometry: a rounded-rect shape extruded with a bevel.
  // Built at real size — never a non-uniformly scaled unit box, so the
  // bevel radius stays exact on every axis. Total size is w x h x d
  // and the effective corner radius is r (half in the shape, half in
  // the bevel); bevelSegments 2 per the r9 spec.
  var b = r / 2;
  var geo = new THREE.ExtrudeGeometry(roundedRectShape(w - r, h - r, b), {
    depth: d - r, bevelEnabled: true, bevelThickness: b, bevelSize: b,
    bevelSegments: 2, curveSegments: 6, steps: 1
  });
  geo.translate(0, 0, -(d - r) / 2);
  return geo;
}

// One shared radial-gradient blob texture / material / geometry for
// every ped contact shadow (r9 C4): a soft dark quad under the feet,
// not a hard-edged disc. Shared, so 86 peds cost no extra textures.
var blobTexture = null;
var blobMaterial = null;
var blobGeometry = null;
function pedBlobShadow() {
  if (!blobTexture) {
    var c = document.createElement('canvas');
    c.width = 128; c.height = 128;
    var ctx = c.getContext('2d');
    var g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
    g.addColorStop(0, 'rgba(0,0,0,0.85)');
    g.addColorStop(0.55, 'rgba(0,0,0,0.45)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    blobTexture = new THREE.CanvasTexture(c);
  }
  if (!blobMaterial) {
    blobMaterial = new THREE.MeshBasicMaterial({
      map: blobTexture, transparent: true, opacity: 0.35,
      depthWrite: false, polygonOffset: true,
      polygonOffsetFactor: -2, polygonOffsetUnits: -2
    });
  }
  if (!blobGeometry) blobGeometry = new THREE.PlaneGeometry(0.85, 0.65);
  var blob = new THREE.Mesh(blobGeometry, blobMaterial);
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.03;
  return blob;
}

var WEAPONS = {
  pistol: { len: 0.22, h: 0.05, grip: 0.12 },
  smg: { len: 0.42, h: 0.07, grip: 0.16 },
  shotgun: { len: 0.7, h: 0.08, grip: 0.16 },
  carbine: { len: 0.62, h: 0.07, grip: 0.16 },
  revolver: { len: 0.26, h: 0.06, grip: 0.12 },
  sniper: { len: 0.85, h: 0.07, grip: 0.16 },
  bat: { len: 0.6, h: 0.06, grip: 0.1 }
};

function makeWeapon(id) {
  var def = WEAPONS[id] || WEAPONS.pistol;
  var g = new THREE.Group();
  var dark = mat(0x1a1a1a, 0.5);
  // Gunmetal slide, a touch lighter than the frame, so the weapon
  // reads as a gun against a dark jacket instead of a black smudge.
  var steel = new THREE.MeshStandardMaterial({
    color: 0x3a3f46, roughness: 0.35, metalness: 0.6
  });
  if (id === 'pistol') {
    // A real pistol silhouette, not a box: frame, slide on top,
    // muzzle at the nose, front + rear sights, grip raked back,
    // trigger guard under the frame. ~0.22 m long, true to scale.
    var frame = new THREE.Mesh(
      new THREE.BoxGeometry(def.len * 0.72, 0.04, 0.05), dark);
    frame.position.set(def.len * 0.32, -0.005, 0);
    g.add(frame);
    var slide = new THREE.Mesh(
      new THREE.BoxGeometry(def.len * 0.78, 0.028, 0.056), steel);
    slide.position.set(def.len * 0.34, 0.028, 0);
    g.add(slide);
    var muzzle = new THREE.Mesh(
      new THREE.BoxGeometry(0.025, 0.032, 0.042), dark);
    muzzle.position.set(def.len * 0.72, 0.01, 0);
    g.add(muzzle);
    var frontSight = new THREE.Mesh(
      new THREE.BoxGeometry(0.012, 0.018, 0.012), dark);
    frontSight.position.set(def.len * 0.68, 0.05, 0);
    g.add(frontSight);
    var rearSight = new THREE.Mesh(
      new THREE.BoxGeometry(0.02, 0.016, 0.04), dark);
    rearSight.position.set(def.len * 0.02, 0.049, 0);
    g.add(rearSight);
    var grip = new THREE.Mesh(
      new THREE.BoxGeometry(0.045, def.grip, 0.05), dark);
    grip.position.set(-0.01, -def.grip / 2 - 0.01, 0);
    grip.rotation.z = 0.22; // raked back, like a held pistol
    g.add(grip);
    var guard = new THREE.Mesh(
      new THREE.BoxGeometry(0.07, 0.012, 0.014), dark);
    guard.position.set(0.07, -0.032, 0);
    g.add(guard);
  } else {
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
    if (id === 'sniper') {
      var scope = new THREE.Mesh(
        new THREE.CylinderGeometry(0.025, 0.025, 0.16, 8), steel);
      scope.rotation.z = Math.PI / 2;
      scope.position.set(def.len * 0.45, 0.07, 0);
      g.add(scope);
    }
  }
  // Barrel along the arm: with the weapon hung in the hand, the
  // muzzle points where the arm points — forward when aiming, down
  // at rest — instead of at the sky while aiming. The grip sits in
  // the palm, hanging below the hand.
  g.rotation.z = -Math.PI / 2;
  return g;
}

// opts: jacket, skin, pants, hair, shoes (colours), height (m,
// default 1.8), officer (dark PVPD uniform, cap, badge), armed,
// weapon ('pistol' | 'smg' | 'shotgun' | 'carbine' | 'revolver' |
// 'bat'), profession ('local' | 'police' | 'doctor' — r10 B6: a
// street is not clones in one shirt; mostly locals, sometimes a
// uniformed officer or a doctor in a white coat). Rey is the default:
// coral jacket, 1.8 m.
export function createPerson(opts) {
  var o = opts || {};
  var height = o.height || 1.8;
  // A 'police' profession IS an officer (same uniform, cap, badge);
  // a 'doctor' wears a white coat over dark trousers.
  var officer = !!o.officer || o.profession === 'police';
  var doctor = o.profession === 'doctor' && !officer;
  var jacketCol = o.jacket || (doctor ? '#f2f2ee' : (officer ? '#23262f' : '#c94f3d'));
  var skinCol = o.skin || '#e8b48f';
  var pantsCol = o.pants || (officer ? '#1a1d24' : '#23262f');
  var hairCol = o.hair || '#2c2c34';

  var group = new THREE.Group();
  var scale = height / 1.8;
  var figure = new THREE.Group(); // everything scales with height
  figure.scale.setScalar(scale);
  group.add(figure);

  // Contact shadow under the feet (r9 C4): a soft radial-gradient
  // quad, shared texture/material/geometry across all peds.
  figure.add(pedBlobShadow());

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
  // Shoes read against the trousers: default brown leather, never the
  // same near-black as the pants (r9 B5). Officers keep black shoes.
  var shoeMat = mat(o.shoes || (officer ? '#1a1a1a' : '#6b4226'), 0.6);
  var shoeL = new THREE.Mesh(roundedBox(0.24, 0.07, 0.11, 0.03), shoeMat);
  shoeL.position.set(0.05, -0.85, 0);
  legL.add(shoeL);
  var shoeR = shoeL.clone();
  legR.add(shoeR);
  body.add(legL);
  body.add(legR);

  // Torso (r9 B5): a capsule, not a box — radius 0.22, cylindrical
  // section 0.12, total height 0.56, same as the old box. The lighter
  // chest panel sits just proud of the capsule's front (x 0.22).
  var torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.12, 4, 12), jacket);
  torso.position.set(0, 1.16, 0);
  body.add(torso);
  var chest = new THREE.Mesh(
    new THREE.BoxGeometry(0.02, 0.32, 0.3),
    new THREE.MeshStandardMaterial({
      color: 0xffffff, transparent: true, opacity: 0.14,
      roughness: 0.8
    }));
  chest.position.set(0.225, 1.24, 0);
  body.add(chest);
  // A doctor's coat is white, but the shirt underneath stays dark
  // so the figure does not wash out against the pavement.
  if (doctor) {
    var coat = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.3, 0.26),
      new THREE.MeshStandardMaterial({
        color: 0xffffff, transparent: true, opacity: 0.12, roughness: 0.8
      }));
    coat.position.set(0.225, 1.24, 0);
    body.add(coat);
  }
  // Belt line (r9 B5): a dark waistband ring around the capsule for
  // every ped. Radius 0.225 clears the capsule (~0.205 at this height)
  // by ~2 cm, so it reads as a belt instead of sinking into the body.
  var belt = new THREE.Mesh(
    new THREE.CylinderGeometry(0.225, 0.225, 0.05, 16), mat(0x151515, 0.5));
  belt.position.set(0, 1.02, 0);
  body.add(belt);
  if (officer) {
    // Badge and a nightstick at the hip read as PVPD (the belt is the
    // shared waistband above). The badge sits proud of the chest panel.
    var badge = new THREE.Mesh(
      new THREE.BoxGeometry(0.02, 0.06, 0.06),
      new THREE.MeshStandardMaterial({
        color: 0xffd166, metalness: 0.8, roughness: 0.3,
        emissive: 0xffd166, emissiveIntensity: 0.25
      }));
    badge.position.set(0.24, 1.3, -0.10);
    body.add(badge);
    var stick = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.025, 0.4, 8), mat(0x1a1a1a, 0.5));
    stick.position.set(-0.05, 0.72, -0.26);
    stick.rotation.z = 0.15;
    body.add(stick);
  }

  // Arms (r9 B5): capsules, pivoted at the shoulders (y 1.40) — the
  // rounded top reads as a shoulder. z ±0.24 (was ±0.26): the capsule
  // torso narrows toward the shoulders, so the arms sit closer in.
  // Same 0.60 m total length and same pivots, so the walk/aim rig
  // and the hand/weapon attach points are unchanged.
  var armL = capsuleLimb(0.055, 0.49, jacket);
  armL.position.set(0, 1.40, 0.24);
  var armR = capsuleLimb(0.055, 0.49, jacket);
  armR.position.set(0, 1.40, -0.24);
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

  // Weapon in the right hand, when armed. Swappable at runtime:
  // userData.setWeapon(id) swaps the mesh in the hand (fists hides
  // it), so the figure always shows the equipped slot — Rey's
  // pistol is visible in his hand, not just in the HUD.
  var weapon = null;
  var weaponId = null;
  function attachWeapon(id) {
    if (weapon) { armR.remove(weapon); weapon = null; weaponId = null; }
    if (!id || id === 'fists') return;
    weapon = makeWeapon(id);
    weapon.position.set(0.05, -0.62, 0);
    armR.add(weapon);
    weaponId = id;
  }
  if (o.armed || o.weapon) attachWeapon(o.weapon || 'pistol');

  // ---- animation state -------------------------------------------
  // Every figure walks its own walk: a random starting phase, a
  // slightly different cadence, arm-swing and stride, so a crowd
  // never swings in unison like a marching band. Rey gets one too
  // — it is fixed for the session, so he stays consistent.
  var gaitPhase0 = Math.random() * Math.PI * 2;
  var gaitRate = 0.92 + Math.random() * 0.2;
  var armFactor = 0.65 + Math.random() * 0.35;
  var strideFactor = 0.92 + Math.random() * 0.16;
  var idleSeed = Math.random() * Math.PI * 2;
  var phase = gaitPhase0;
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

    // Signed speed: a negative speed is BACKWARD movement (S while
    // aiming — the figure keeps facing the aim and backpedals), so
    // the cycle runs in reverse with short steps and a lean back,
    // instead of moonwalking a forward walk. Forward is +.
    var rawSpeed = speed || 0;
    var dir = rawSpeed < -0.05 ? -1 : 1;
    var s = normSpeed(rawSpeed);
    var moving = s > 0.15 || pose === 'walk' || pose === 'run' ||
      pose === 'sprint' || pose === 'flee';
    var backward = dir < 0 && moving;
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
    // from a walk to a sprint; backpedalling takes short steps.
    // Each figure's own cadence/stride keeps a crowd out of step.
    var strideLen = (0.62 + 0.1 * s) * strideFactor * (backward ? 0.7 : 1);
    if (moving) phase += dir * (s * step * Math.PI * 2) / strideLen * gaitRate;
    var swing = Math.sin(phase);
    // Walk -> run -> sprint amplitude, scaled by the move blend.
    // Backpedalling is a smaller, careful step, not a full stride.
    var amp = Math.min(0.95, 0.12 + 0.11 * s) * moveBlend;
    if (backward) amp *= 0.55;
    if (pose === 'flee') amp = Math.min(1.0, amp * 1.25);

    // Legs swing opposite, arms counter-swing; fleeing pumps hard.
    // Each figure's arm swing differs, so the crowd is not a chorus.
    var armAmp = amp * (pose === 'flee' ? 0.95 : 0.7) * armFactor;
    if (backward) armAmp *= 0.6;
    legL.rotation.z = amp * swing * (1 - crouch * 0.4);
    legR.rotation.z = -amp * swing * (1 - crouch * 0.4);
    armL.rotation.z = -armAmp * swing;
    armR.rotation.z = armAmp * swing;
    armL.rotation.x = 0;
    armR.rotation.x = 0;

    // Idle life: the figure breathes, shifts its weight, and looks
    // around instead of standing frozen like a statue. Killed the
    // moment he moves, aims, ducks or goes down.
    var idleAmt = (1 - moveBlend) * (1 - aimAmt) * (1 - crouch) * (1 - downAmt);
    if (idleAmt > 0.01) {
      head.rotation.y = 0.5 * Math.sin(time * 0.45 + idleSeed) * idleAmt
        + 0.12 * Math.sin(time * 1.7 + idleSeed * 2.3) * idleAmt;
      head.rotation.z = 0.06 * Math.sin(time * 0.6 + idleSeed) * idleAmt;
      armL.rotation.x = 0.07 * Math.sin(time * 1.5 + idleSeed) * idleAmt;
      armR.rotation.x = 0.07 * Math.sin(time * 1.5 + idleSeed + 1.2) * idleAmt;
    } else {
      head.rotation.y = 0;
      head.rotation.z = 0;
    }

    // Duck: bend the legs, drop the body, guard with the arms.
    if (crouch > 0.01) {
      legL.rotation.z = legL.rotation.z * (1 - crouch) + 0.55 * crouch;
      legR.rotation.z = legR.rotation.z * (1 - crouch) - 0.4 * crouch;
      armL.rotation.z = armL.rotation.z * (1 - crouch) + 0.7 * crouch;
      armR.rotation.z = armR.rotation.z * (1 - crouch) + 0.7 * crouch;
    }
    // Aim: both arms forward along the facing, weapon leading — a
    // TWO-HANDED grip, not two empty hands in the air. The left arm
    // reaches across the chest so the left hand lands on the grip
    // beside the right hand; the right arm angles in slightly.
    // The stance staggers (front foot forward, back foot back) and
    // the body braces a touch lower, leaning into the shot.
    if (aimAmt > 0.01) {
      armL.rotation.z = armL.rotation.z * (1 - aimAmt) + 1.35 * aimAmt;
      armR.rotation.z = armR.rotation.z * (1 - aimAmt) + 1.35 * aimAmt;
      armL.rotation.x = armL.rotation.x * (1 - aimAmt) + 0.55 * aimAmt;
      armR.rotation.x = armR.rotation.x * (1 - aimAmt) - 0.15 * aimAmt;
      legL.rotation.z = legL.rotation.z * (1 - aimAmt) + 0.25 * aimAmt;
      legR.rotation.z = legR.rotation.z * (1 - aimAmt) - 0.2 * aimAmt;
    }

    // Bob on the stride, a forward lean at speed, a breath at rest.
    var speedFactor = Math.min(s / 4.5, 1) * moveBlend;
    body.position.y = Math.abs(Math.sin(phase)) * 0.035 * speedFactor
      + Math.sin(time * 1.5) * 0.008 * (1 - moveBlend)
      - 0.04 * aimAmt;
    // Forward lean at speed, a slight lean BACK when backpedalling
    // (you do not lean into a step you cannot see), a braced lean
    // into the aim.
    var lean = -0.08 * speedFactor - 0.14 * (pose === 'flee' ? 1 : 0) * moveBlend
      - 0.05 * aimAmt;
    if (backward) lean = 0.07 * speedFactor - 0.05 * aimAmt;
    body.rotation.z = lean;
    // Torso counter-twist on the stride: shoulders swing against
    // the hips, so a walk reads as a walk instead of a slide.
    // Halved while aiming — the shoulders stay square to the shot.
    body.rotation.y = 0.12 * Math.sin(phase) * moveBlend * dir * (1 - 0.5 * aimAmt);
    // Idle weight shift, sideways and slow.
    body.position.z = 0.02 * Math.sin(time * 0.4 + idleSeed) * (1 - moveBlend) * (1 - aimAmt);
    // Breathing: the chest rises and falls at rest.
    body.scale.y = (1 - 0.22 * crouch) * (1 + 0.012 * Math.sin(time * 1.6 + idleSeed) * (1 - moveBlend));
    // Down: the whole figure tips flat onto its BACK (supine), head
    // away from the feet — the GTA WASTED pose. Rotation about z is
    // the fall axis (the figure faces +x, so z tips it backward);
    // the old rotation.x rolled it sideways onto one shoulder.
    // Lean fades out as the fall completes, so the body ends flat.
    body.rotation.x = 0;
    body.rotation.z = lean * (1 - downAmt) + 1.5 * downAmt;
    if (downAmt > 0.01) body.position.y = 0.18 * downAmt;
  };

  group.userData.height = height;
  group.userData.isOfficer = officer;
  group.userData.profession = o.profession || (officer ? 'police' : 'local');
  // Swap the weapon in the right hand ('fists' hides it). A no-op
  // when the slot did not change, so the caller can call it every
  // frame for free.
  group.userData.setWeapon = function (id) {
    if (id === weaponId) return;
    attachWeapon(id);
  };
  group.userData.getWeapon = function () { return weaponId; };
  return group;
}

// Pedestrian professions (r10 B6): mostly locals, sometimes a
// police officer or a doctor. rng is a () => [0, 1) function; the
// weights are the street mix, not a per-district census.
export function pickProfession(rng) {
  const r = (typeof rng === 'function' ? rng() : Math.random());
  if (r < 0.11) return 'police';
  if (r < 0.22) return 'doctor';
  return 'local';
}
