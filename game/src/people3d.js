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
  // Rey is the default figure: no explicit jacket/pants, not an
  // officer or doctor. Peds always arrive with jacket+skin from
  // traffic (main3d.js personMeshFor), officers/doctors by
  // profession — so only the player mesh takes the Rey branch.
  // Explicit override: opts.rey / opts.face === 'full' forces the
  // full face; opts.rey === false forces the ped branch.
  var isRey = o.rey === true || o.face === 'full' ? true
    : o.rey === false ? false
    : (!officer && !doctor && o.jacket === undefined && o.pants === undefined);

  var group = new THREE.Group();
  var scale = height / 1.8;
  var figure = new THREE.Group(); // everything scales with height
  // Ped variety (r11 B5): 3 body widths — stocky / average / slim.
  // Rey stays width 1.0; peds draw 0.92–1.10. Width scales x/z
  // only, so height and the limb pivots stay byte-identical.
  var widthFactor = o.width || (isRey ? 1 : 0.92 + Math.random() * 0.18);
  figure.scale.set(scale * widthFactor, scale, scale * widthFactor);
  group.add(figure);

  // Contact shadow under the feet (r9 C4): a soft radial-gradient
  // quad, shared texture/material/geometry across all peds.
  figure.add(pedBlobShadow());

  var body = new THREE.Group(); // bobs, leans, crouches, falls
  figure.add(body);

  var skin = mat(skinCol, 0.65);
  var jacket = mat(jacketCol, 0.75);
  var pants = mat(pantsCol, 0.8);

  // Legs (r11 B1): split into thigh + shin so knees can bend.
  // Pivots byte-identical to r10: hips y 0.88, total leg 0.86 m.
  // Thigh 0.43 m (hip->knee, r 0.08->0.065 — thighs thicker than
  // shins, the "legs look like posts" fix) + shin 0.43 m
  // (knee->ankle, r 0.065->0.055), shin pivot Group at the thigh
  // end (y -0.43 in thigh space). Shoes stay parented to the shin
  // end, so the foot still lands at y -0.85 below the hip.
  var legL = limb(0.08, 0.065, 0.43, pants);
  legL.position.set(0, 0.88, 0.11);
  var legR = limb(0.08, 0.065, 0.43, pants);
  legR.position.set(0, 0.88, -0.11);
  var shinL = limb(0.065, 0.055, 0.43, pants);
  shinL.position.set(0, -0.43, 0);
  legL.add(shinL);
  var shinR = limb(0.065, 0.055, 0.43, pants);
  shinR.position.set(0, -0.43, 0);
  legR.add(shinR);
  // Shoes, pointing forward.
  // Shoes read against the trousers: default brown leather, never the
  // same near-black as the pants (r9 B5). Officers keep black shoes.
  var shoeMat = mat(o.shoes || (officer ? '#1a1a1a' : '#6b4226'), 0.6);
  var shoeL = new THREE.Mesh(roundedBox(0.24, 0.07, 0.11, 0.03), shoeMat);
  shoeL.position.set(0.05, -0.42, 0);
  shinL.add(shoeL);
  var shoeR = shoeL.clone();
  shinR.add(shoeR);
  body.add(legL);
  body.add(legR);

  // Torso (r9 B5): a capsule, not a box — radius 0.22, cylindrical
  // section 0.12, total height 0.56, same as the old box. The lighter
  // chest panel sits just proud of the capsule's front (x 0.22).
  var torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.12, 4, 12), jacket);
  torso.position.set(0, 1.16, 0);
  body.add(torso);
  if (isRey) {
    // Rey's neck (r11 B2): the sphere no longer sits directly on
    // the torso capsule. Cylinder r 0.05, h 0.08, y 1.50 — spans
    // 1.46–1.54, bridging torso top (1.44) and head bottom (1.50).
    var neck = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.055, 0.08, 10), skin);
    neck.position.set(0, 1.50, 0);
    body.add(neck);
    // Shirt V (r11 B2): replaces the flat white chest panel for
    // Rey — a 0.11 m wide triangle, apex down at y 1.22, in
    // off-white, extruded 0.012 m proud of the capsule front.
    var vShape = new THREE.Shape();
    vShape.moveTo(-0.055, 0.10);
    vShape.lineTo(0.055, 0.10);
    vShape.lineTo(0, -0.12);
    vShape.closePath();
    var shirtV = new THREE.Mesh(
      new THREE.ExtrudeGeometry(vShape, { depth: 0.012, bevelEnabled: false }),
      new THREE.MeshStandardMaterial({ color: 0xf5efe2, roughness: 0.8 }));
    shirtV.rotation.y = Math.PI / 2;
    shirtV.position.set(0.222, 1.34, 0);
    body.add(shirtV);
    // Jacket collar (r11 B2): a darker-coral torus ring around the
    // neck base at y 1.44, r 0.13 / tube 0.028.
    var collar = new THREE.Mesh(
      new THREE.TorusGeometry(0.13, 0.028, 8, 20), mat(0x7e2f26, 0.75));
    collar.rotation.x = Math.PI / 2;
    collar.position.set(0, 1.44, 0);
    body.add(collar);
    // Zipper (r11 B2): a dark vertical strip down the jacket front
    // BELOW the shirt-V apex (y 0.98–1.22), so it never crosses the V.
    var zipper = new THREE.Mesh(
      new THREE.BoxGeometry(0.012, 0.24, 0.018), mat(0x1a1a1a, 0.5));
    zipper.position.set(0.232, 1.10, 0);
    body.add(zipper);
    // Jacket hem (r11 B2): a darker band at y 0.96, r 0.205 —
    // clears the capsule surface there (r ~0.196) by ~1 cm.
    var hem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.205, 0.205, 0.025, 16), mat(0x7e2f26, 0.75));
    hem.position.set(0, 0.96, 0);
    body.add(hem);
  } else {
    var chest = new THREE.Mesh(
      new THREE.BoxGeometry(0.02, 0.32, 0.3),
      new THREE.MeshStandardMaterial({
        color: 0xffffff, transparent: true, opacity: 0.14,
        roughness: 0.8
      }));
    chest.position.set(0.225, 1.24, 0);
    body.add(chest);
  }
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

  // Arms (r11 B1): split into upper arm + forearm so elbows can
  // bend. Pivots byte-identical to r10: shoulders y 1.40, total
  // arm 0.60 m, hand at -0.62. Upper arm 0.30 m (shoulder->elbow,
  // capsule r 0.055, cyl 0.19) + forearm 0.30 m (elbow->wrist,
  // tapered to r 0.045, cyl 0.21), forearm pivot at the upper-arm
  // end. Shoulders narrowed ±0.24 -> ±0.22 (r11 B2 proportions:
  // 0.48 m was slightly wide for a 1.8 m figure). Hands and the
  // weapon stay parented to the FOREARM end at -0.32 in forearm
  // space — the hand/weapon attach point does not move.
  var armL = capsuleLimb(0.055, 0.19, jacket);
  armL.position.set(0, 1.40, 0.22);
  var armR = capsuleLimb(0.055, 0.19, jacket);
  armR.position.set(0, 1.40, -0.22);
  var foreL = capsuleLimb(0.045, 0.21, jacket);
  foreL.position.set(0, -0.30, 0);
  armL.add(foreL);
  var foreR = capsuleLimb(0.045, 0.21, jacket);
  foreR.position.set(0, -0.30, 0);
  armR.add(foreR);
  var handL = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), skin);
  handL.position.y = -0.32;
  foreL.add(handL);
  var handR = handL.clone();
  foreR.add(handR);
  body.add(armL);
  body.add(armR);
  // Phone-check micro-idle prop (r11 B4): 1 in 6 non-Rey peds
  // carries a phone in the right hand. Hidden unless the ped is
  // actually looking at it, so a resting ped never reads as
  // holding something.
  var phonePed = !isRey && !officer && Math.random() < 0.17;
  var phoneMesh = null;
  if (phonePed) {
    phoneMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.015, 0.13, 0.07), mat(0x111111, 0.4));
    phoneMesh.position.set(0.03, -0.34, 0);
    phoneMesh.visible = false;
    foreR.add(phoneMesh);
  }

  // Head and hair at y 1.62, with a cap for officers.
  var head = new THREE.Group();
  head.position.set(0, 1.62, 0);
  var skull = new THREE.Mesh(new THREE.SphereGeometry(0.125, 16, 12), skin);
  head.add(skull);
  if (isRey) {
    // Rey's face (r11 B2): eyes + brows + nose + mouth, all set
    // into the front (+x) of the skull so each mesh just breaks
    // the surface — readable in close-up, invisible as bumps at
    // chase distance. Eyes are dark beads (r 0.02 at x 0.108);
    // brows sit above them; the nose protrudes ~1 cm at x 0.122;
    // the mouth is a thin dark box at y -0.062.
    var eyeMat = mat(0x14100c, 0.4);
    var eyeGeo = new THREE.SphereGeometry(0.02, 10, 8);
    var eyeL = new THREE.Mesh(eyeGeo, eyeMat);
    eyeL.position.set(0.108, 0.02, 0.045);
    head.add(eyeL);
    var eyeR = new THREE.Mesh(eyeGeo, eyeMat);
    eyeR.position.set(0.108, 0.02, -0.045);
    head.add(eyeR);
    var browMat = mat(hairCol, 0.9);
    var browGeo = new THREE.BoxGeometry(0.014, 0.012, 0.05);
    var browL = new THREE.Mesh(browGeo, browMat);
    browL.position.set(0.105, 0.058, 0.045);
    head.add(browL);
    var browR = new THREE.Mesh(browGeo, browMat);
    browR.position.set(0.105, 0.058, -0.045);
    head.add(browR);
    var nose = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.035, 0.028), skin);
    nose.position.set(0.122, -0.012, 0);
    head.add(nose);
    var mouth = new THREE.Mesh(
      new THREE.BoxGeometry(0.012, 0.01, 0.052), mat(0x4a1f1a, 0.7));
    mouth.position.set(0.112, -0.062, 0);
    head.add(mouth);
  }
  // Peds get NO face meshes (r11 B2 draw-call note: 2 spheres per
  // ped would be ~170 extra draws across the crowd — Rey-only is
  // the right scope; ped variety comes from hair/width/palette).
  if (officer) {
    var cap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.14, 0.05, 14), mat(0x1a1d24, 0.6));
    cap.position.y = 0.1;
    head.add(cap);
    var brim = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.02, 0.2), mat(0x1a1d24, 0.6));
    brim.position.set(0.12, 0.08, 0);
    head.add(brim);
  } else {
    // Hair (r11 B5): a cap of sphere covering the top and back of
    // the head, plus a variant for peds — a bun or a ponytail
    // sphere at the back — so the crowd stops sharing one haircut.
    // Rey keeps the plain cap.
    var hair = new THREE.Mesh(
      new THREE.SphereGeometry(0.132, 16, 12, 0, Math.PI * 2, 0, 1.9),
      mat(hairCol, 0.9));
    hair.position.set(-0.015, 0.015, 0);
    hair.rotation.z = -0.5;
    head.add(hair);
    if (!isRey) {
      var hairStyle = o.hairStyle || (function () {
        var r = Math.random();
        return r < 0.6 ? 'cap' : (r < 0.8 ? 'bun' : 'ponytail');
      })();
      if (hairStyle === 'bun') {
        var bun = new THREE.Mesh(
          new THREE.SphereGeometry(0.05, 10, 8), mat(hairCol, 0.9));
        bun.position.set(-0.11, 0.07, 0);
        head.add(bun);
      } else if (hairStyle === 'ponytail') {
        var tail = new THREE.Mesh(
          new THREE.SphereGeometry(0.04, 10, 8), mat(hairCol, 0.9));
        tail.position.set(-0.135, -0.03, 0);
        head.add(tail);
      }
    }
  }
  body.add(head);

  // Weapon in the right hand, when armed. Swappable at runtime:
  // userData.setWeapon(id) swaps the mesh in the hand (fists hides
  // it), so the figure always shows the equipped slot — Rey's
  // pistol is visible in his hand, not just in the HUD.
  var weapon = null;
  var weaponId = null;
  function attachWeapon(id) {
    if (weapon) { foreR.remove(weapon); weapon = null; weaponId = null; }
    if (!id || id === 'fists') return;
    weapon = makeWeapon(id);
    // Parented to the FOREARM end (r11 B1): -0.32 in forearm space
    // is -0.62 below the shoulder, the exact r10 attach point —
    // shots still originate from the right hand.
    weapon.position.set(0.05, -0.32, 0);
    foreR.add(weapon);
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
  var idleTime = 0; // seconds standing still (Rey pockets, r11 B4)
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
    // r11 B3: knees and elbows. The knee bends ONE way only — the
    // shin rotates BACK relative to the thigh (negative rotation.z),
    // flexing through the swing phase (when the leg travels forward
    // to plant) and straight at heel-strike; it is never positive,
    // so a knee never bends backward. The elbow bends forward
    // (positive rotation.z): a natural ~25° hang at rest, pumping
    // toward 80° at a sprint.
    var armAmp = amp * (pose === 'flee' ? 0.95 : 0.7) * armFactor;
    if (backward) armAmp *= 0.6;
    var runFactor = Math.max(0, Math.min(1, (s - 2) / 3.5)) * moveBlend;
    var kneeMax = Math.min(0.6, 0.32 + 0.05 * s) * moveBlend * (backward ? 0.55 : 1);
    var kneeL = kneeMax * Math.max(0, -Math.sin(phase));
    var kneeR = kneeMax * Math.max(0, Math.sin(phase));
    var elbowBend = 0.25 + 0.15 * moveBlend + 1.0 * runFactor;
    legL.rotation.z = amp * swing * (1 - crouch * 0.4);
    legR.rotation.z = -amp * swing * (1 - crouch * 0.4);
    shinL.rotation.z = -kneeL;
    shinR.rotation.z = -kneeR;
    armL.rotation.z = -armAmp * swing;
    armR.rotation.z = armAmp * swing;
    foreL.rotation.z = elbowBend;
    foreR.rotation.z = elbowBend;
    armL.rotation.x = 0;
    armR.rotation.x = 0;
    foreL.rotation.x = 0;
    foreR.rotation.x = 0;
    // Backpedal guard arms: elbows slightly out for balance.
    if (backward) {
      foreL.rotation.x = 0.15;
      foreR.rotation.x = -0.15;
    }

    // Idle life: the figure breathes, shifts its weight, and looks
    // around instead of standing frozen like a statue. Killed the
    // moment he moves, aims, ducks or goes down.
    var idleAmt = (1 - moveBlend) * (1 - aimAmt) * (1 - crouch) * (1 - downAmt);
    if (idleAmt > 0.9) idleTime += step; else idleTime = 0;
    if (idleAmt > 0.01) {
      head.rotation.y = 0.5 * Math.sin(time * 0.45 + idleSeed) * idleAmt
        + 0.12 * Math.sin(time * 1.7 + idleSeed * 2.3) * idleAmt;
      head.rotation.z = 0.06 * Math.sin(time * 0.6 + idleSeed) * idleAmt;
      armL.rotation.x = 0.07 * Math.sin(time * 1.5 + idleSeed) * idleAmt;
      armR.rotation.x = 0.07 * Math.sin(time * 1.5 + idleSeed + 1.2) * idleAmt;
      // Phone-check micro-idle (r11 B4): 1 in 6 peds looks at the
      // phone for 2 s out of every ~14 s — head down 15°, right
      // forearm raised, phone visible only while it is up.
      var phoneWin = phonePed && idleAmt > 0.5 && (((time + idleSeed) % 14) < 2);
      if (phoneWin) {
        head.rotation.z = -0.26;
        foreR.rotation.z = 1.1;
        foreR.rotation.x = -0.2;
      }
      if (phoneMesh) phoneMesh.visible = !!phoneWin;
      // Rey hands-in-pockets (r11 B4): standing still >10 s, arms
      // drift inward and forearms bend, hands toward the pockets.
      if (isRey && idleTime > 10) {
        armL.rotation.x = 0.18;
        armR.rotation.x = -0.18;
        foreL.rotation.z = 0.7;
        foreR.rotation.z = 0.7;
      }
    } else {
      head.rotation.y = 0;
      head.rotation.z = 0;
      if (phoneMesh) phoneMesh.visible = false;
    }

    // Duck: bend the legs, drop the body, guard with the arms.
    // Knees bend with the crouch (shin -0.55/-0.40), elbows guard.
    if (crouch > 0.01) {
      legL.rotation.z = legL.rotation.z * (1 - crouch) + 0.55 * crouch;
      legR.rotation.z = legR.rotation.z * (1 - crouch) - 0.4 * crouch;
      shinL.rotation.z = shinL.rotation.z * (1 - crouch) - 0.55 * crouch;
      shinR.rotation.z = shinR.rotation.z * (1 - crouch) - 0.4 * crouch;
      armL.rotation.z = armL.rotation.z * (1 - crouch) + 0.7 * crouch;
      armR.rotation.z = armR.rotation.z * (1 - crouch) + 0.7 * crouch;
      foreL.rotation.z = foreL.rotation.z * (1 - crouch) + 0.6 * crouch;
      foreR.rotation.z = foreR.rotation.z * (1 - crouch) + 0.6 * crouch;
    }
    // Aim: both arms forward along the facing, weapon leading — a
    // TWO-HANDED grip, not two empty hands in the air. The left arm
    // reaches across the chest so the left hand lands on the grip
    // beside the right hand; the right arm angles in slightly.
    // The stance staggers (front foot forward, back foot back) and
    // the body braces a touch lower, leaning into the shot.
    // r11 B1: forearms finally bend — left forearm +0.55 rad to
    // meet the grip, right +0.15 (elbow soft, not locked); knees
    // bend ~15° in the stance (front leg more than the back).
    if (aimAmt > 0.01) {
      armL.rotation.z = armL.rotation.z * (1 - aimAmt) + 1.35 * aimAmt;
      armR.rotation.z = armR.rotation.z * (1 - aimAmt) + 1.35 * aimAmt;
      armL.rotation.x = armL.rotation.x * (1 - aimAmt) + 0.55 * aimAmt;
      armR.rotation.x = armR.rotation.x * (1 - aimAmt) - 0.15 * aimAmt;
      foreL.rotation.z = foreL.rotation.z * (1 - aimAmt) + 0.55 * aimAmt;
      foreR.rotation.z = foreR.rotation.z * (1 - aimAmt) + 0.15 * aimAmt;
      foreL.rotation.x = foreL.rotation.x * (1 - aimAmt) + 0.25 * aimAmt;
      foreR.rotation.x = foreR.rotation.x * (1 - aimAmt) - 0.05 * aimAmt;
      legL.rotation.z = legL.rotation.z * (1 - aimAmt) + 0.25 * aimAmt;
      legR.rotation.z = legR.rotation.z * (1 - aimAmt) - 0.2 * aimAmt;
      shinL.rotation.z = shinL.rotation.z * (1 - aimAmt) - 0.25 * aimAmt;
      shinR.rotation.z = shinR.rotation.z * (1 - aimAmt) - 0.15 * aimAmt;
    }
    // Down: limbs go slack and straight as the body tips flat —
    // no bent knee or raised arm survives the fall.
    if (downAmt > 0.01) {
      var slack = 1 - downAmt;
      legL.rotation.z *= slack; legR.rotation.z *= slack;
      shinL.rotation.z *= slack; shinR.rotation.z *= slack;
      armL.rotation.z *= slack; armR.rotation.z *= slack;
      foreL.rotation.z *= slack; foreR.rotation.z *= slack;
      armL.rotation.x *= slack; armR.rotation.x *= slack;
      foreL.rotation.x *= slack; foreR.rotation.x *= slack;
    }

    // Bob on the stride, a forward lean at speed.
    // r11 B3: airborne frame at run speeds — a flat-top second
    // harmonic (0.015 m) hangs the body at the top of the cycle,
    // so a sprint reads as leaving the ground, not gliding.
    // r11 B4: breathing moved OFF body.position.y (bobbing the whole
    // body reads as floating) and onto the chest — torso.scale.y
    // below, 0.25 Hz, chest only.
    var speedFactor = Math.min(s / 4.5, 1) * moveBlend;
    body.position.y = Math.abs(Math.sin(phase)) * 0.035 * speedFactor
      + 0.015 * Math.max(0, Math.sin(2 * phase)) * runFactor
      - 0.04 * aimAmt;
    // Forward lean at speed, a slight lean BACK when backpedalling
    // (you do not lean into a step you cannot see), a braced lean
    // into the aim. r11 B3: run lean doubles at a sprint — -0.08
    // base plus -0.08 at full runFactor is -0.16 rad ≈ 9.2°,
    // inside the 8–12° run-lean band (r10's 4.6° was half).
    var lean = -0.08 * speedFactor - 0.08 * runFactor
      - 0.14 * (pose === 'flee' ? 1 : 0) * moveBlend
      - 0.05 * aimAmt;
    if (backward) lean = 0.07 * speedFactor - 0.05 * aimAmt;
    body.rotation.z = lean;
    // Torso counter-twist on the stride: shoulders swing against
    // the hips, so a walk reads as a walk instead of a slide.
    // Halved while aiming — the shoulders stay square to the shot.
    body.rotation.y = 0.12 * Math.sin(phase) * moveBlend * dir * (1 - 0.5 * aimAmt);
    // Hip sway / torso roll (r11 B3): 2–3° side-to-side at 1x rate,
    // shifting weight over the support foot. Fades out as the
    // figure goes down or aims.
    body.rotation.x = 0.04 * Math.sin(phase) * moveBlend * (1 - downAmt) * (1 - 0.5 * aimAmt);
    // Idle weight shift, sideways and slow.
    body.position.z = 0.02 * Math.sin(time * 0.4 + idleSeed) * (1 - moveBlend) * (1 - aimAmt);
    // Breathing: the CHEST rises and falls at rest (0.25 Hz —
    // one breath per ~4 s, scale.y 1.00->1.02 on the torso only).
    torso.scale.y = 1 + 0.02 * Math.sin(time * 1.57 + idleSeed) * idleAmt;
    body.scale.y = (1 - 0.22 * crouch);
    // Down: the whole figure tips flat onto its BACK (supine), head
    // away from the feet — the GTA WASTED pose. Rotation about z is
    // the fall axis (the figure faces +x, so z tips it backward);
    // the old rotation.x rolled it sideways onto one shoulder.
    // Lean fades out as the fall completes, so the body ends flat.
    // rotation.x is the hip sway above (already faded by downAmt)
    // and is left alone — zeroing it here would kill the sway.
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
  group.userData.isRey = isRey;
  group.userData.widthFactor = widthFactor;
  // Live rig refs for headless verification (r11): thigh/shin,
  // upper/forearm, head, torso, body. Pivots: hips y 0.88,
  // shoulders y 1.40, forearm pivot at upper-arm end (-0.30),
  // hand/weapon at forearm -0.32 (= -0.62 below the shoulder).
  group.userData.rig = {
    body: body, figure: figure, torso: torso, head: head,
    legL: legL, legR: legR, shinL: shinL, shinR: shinR,
    armL: armL, armR: armR, foreL: foreL, foreR: foreR
  };
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
