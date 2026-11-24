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
  // r9 C6: dark glass base + envMapIntensity 1.0 (takes effect once
  // the rendering builder lands scene.environment; harmless until).
  return new THREE.MeshStandardMaterial({
    color: 0x1c2836, roughness: 0.1, metalness: 0.6, envMapIntensity: 1.0
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
// even before the scene's real shadows are tuned. r9 C4: a
// radial-gradient dark quad, not a hard-edged disc — one shared
// texture / material / geometry for every car, at y 0.03 with a
// polygon offset so it never z-fights the road.
var blobTexCache = null;
var blobMatCache = null;
var blobGeoCache = null;
function contactShadow() {
  if (!blobTexCache) {
    var c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    var g = c.getContext('2d');
    var grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
    grad.addColorStop(0, 'rgba(0,0,0,0.85)');
    grad.addColorStop(0.55, 'rgba(0,0,0,0.45)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    blobTexCache = new THREE.CanvasTexture(c);
  }
  if (!blobMatCache) {
    blobMatCache = new THREE.MeshBasicMaterial({
      map: blobTexCache, transparent: true, opacity: 0.35,
      depthWrite: false, polygonOffset: true,
      polygonOffsetFactor: -2, polygonOffsetUnits: -2
    });
  }
  if (!blobGeoCache) blobGeoCache = new THREE.PlaneGeometry(5.1, 2.5);
  var m = new THREE.Mesh(blobGeoCache, blobMatCache);
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.03;
  return m;
}

// ---- rounded boxes (r9 B1) ------------------------------------------
//
// RoundedBoxGeometry is NOT vendored (game/vendor holds only the core
// three module, no addons/), so the bevel is built from core
// ExtrudeGeometry instead: a rounded-rectangle shape, extruded with a
// bevel. The shape carries half the radius in its corner arcs and the
// bevel carries the other half, so the finished part is exactly
// w x h x d with corner radius r — built at real size, never a
// non-uniformly scaled unit box, so the bevel stays exact on every
// axis. Geometries are cached by size: every car shares one body
// geometry, so 150 cars cost one extrude, not 150.
var roundedBoxCache = {};

function roundedRectShape(w, h, r) {
  var s = new THREE.Shape();
  var x = -w / 2;
  var y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false);
  s.lineTo(x + w, y + h - r);
  s.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false);
  s.lineTo(x + r, y + h);
  s.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(x, y + r);
  s.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
  s.closePath();
  return s;
}

function roundedBoxGeo(w, h, d, r) {
  var key = w + '|' + h + '|' + d + '|' + r;
  if (roundedBoxCache[key]) return roundedBoxCache[key];
  var b = r / 2;
  var geo = new THREE.ExtrudeGeometry(roundedRectShape(w - r, h - r, b), {
    depth: d - r, bevelEnabled: true, bevelThickness: b, bevelSize: b,
    bevelSegments: 2, curveSegments: 6, steps: 1
  });
  geo.translate(0, 0, -(d - r) / 2);
  // Police livery (police3d.js) re-identifies the body and skirt by
  // geometry.parameters width/height/depth — an extrude carries the
  // extrude options there instead, so stamp the box size back on.
  geo.parameters = { width: w, height: h, depth: d };
  roundedBoxCache[key] = geo;
  return geo;
}

function rbox(w, h, d, material, x, y, z, r) {
  var m = new THREE.Mesh(roundedBoxGeo(w, h, d, r), material);
  m.position.set(x, y, z);
  return m;
}

// Tumblehome greenhouse (r9 B2): a trapezoid in the Y-Z plane —
// 1.72 m wide at the beltline, 1.45 m at the roof — extruded along
// the car's length, so the cabin narrows toward the roof instead of
// standing as a straight box. One shared geometry for every car.
var greenhouseGeoCache = null;
function greenhouseGeo() {
  if (greenhouseGeoCache) return greenhouseGeoCache;
  var s = new THREE.Shape();
  s.moveTo(-0.86, -0.26);
  s.lineTo(0.86, -0.26);
  s.lineTo(0.725, 0.26);
  s.lineTo(-0.725, 0.26);
  s.closePath();
  var geo = new THREE.ExtrudeGeometry(s, {
    depth: 2.3, bevelEnabled: false, steps: 1
  });
  geo.translate(0, 0, -1.15);
  geo.rotateY(Math.PI / 2);
  greenhouseGeoCache = geo;
  return geo;
}

// Dark wheel-arch recess (r9 B2): a dark disc behind each wheel, so
// the tyre sits in a shadowed arch instead of floating on the flat
// flank. One shared geometry for every car.
var recessGeoCache = null;
function recessGeo() {
  if (!recessGeoCache) recessGeoCache = new THREE.CircleGeometry(0.46, 20);
  return recessGeoCache;
}

// Diagonal windshield specular streak (r9 C6): a thin low-opacity
// white plane across the windshield, tilted so it reads as a light
// streak, not a scratch — edge-on from the side it nearly vanishes.
// One shared geometry + material for every car.
var streakGeoCache = null;
var streakMatCache = null;
function windshieldStreak() {
  if (!streakGeoCache) {
    streakGeoCache = new THREE.PlaneGeometry(0.10, 0.55);
    streakGeoCache.rotateY(Math.PI / 2);
    streakGeoCache.rotateX(0.6);
  }
  if (!streakMatCache) {
    streakMatCache = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.22,
      depthWrite: false
    });
  }
  var m = new THREE.Mesh(streakGeoCache, streakMatCache);
  m.position.set(1.015, 1.08, 0);
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
// `tex` overrides the shared circular glow: the beam/pool pass an
// elongated gradient so the pool reads as a long soft wash on the
// road, not a squashed disc.
function groundGlow(color, w, d, tex) {
  var mat = new THREE.MeshBasicMaterial({
    map: tex || glowTexture(), color: color, transparent: true, opacity: 0.4,
    blending: THREE.AdditiveBlending, depthWrite: false
  });
  var m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 1;
  return m;
}

// An elongated soft gradient for the headlight beam/pool: the
// shared circular glow texture stretched over a long quad collapses
// into a wedge at a grazing angle, so the beam gets its own
// texture — a radial falloff drawn once, then stretched 2:1, so
// the pool fades softly along its length and across its width.
var sharedBeamTex = null;
function beamTexture() {
  if (sharedBeamTex) return sharedBeamTex;
  var s = document.createElement('canvas');
  s.width = 128;
  s.height = 128;
  var sg = s.getContext('2d');
  var grad = sg.createRadialGradient(64, 64, 2, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.5)');
  grad.addColorStop(0.75, 'rgba(255,255,255,0.10)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  sg.fillStyle = grad;
  sg.fillRect(0, 0, 128, 128);
  var c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  var g = c.getContext('2d');
  g.drawImage(s, 0, 0, 256, 128);
  var tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  sharedBeamTex = tex;
  return tex;
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

// ---- drivers (r11 B3) -----------------------------------------------
// A seated driver in every moving traffic car, visible through the
// (tinted) glass: head, torso, arms reaching for the wheel, and the
// wheel itself, plus a seat bench and a dash so the cabin does not
// read hollow through the glass. Parked cars and mopeds have none
// (traffic3d hides the figure for those), the hero has none (the
// player drives it). Built from primitives — no dependency on
// people3d. Left-hand drive: the seat sits at local z -0.45.
var DRIVER_SKINS = ['#e8b48f', '#c98d64', '#8a5a3b', '#f0c8a0', '#a06a45'];
var DRIVER_SHIRTS = ['#3d7ea6', '#c94f3d', '#e8c53a', '#4a6b4f', '#e86a92', '#7a5a9e', '#2e8b7a', '#d97b2b'];
var DRIVER_HAIRS = ['#2c2c34', '#4a2f1d', '#111111', '#6b6b6b'];
function buildDriver() {
  var g = new THREE.Group();
  g.name = 'driver'; // r11 B3: the headless test finds it by name
  var skin = DRIVER_SKINS[Math.floor(Math.random() * DRIVER_SKINS.length)];
  var shirt = DRIVER_SHIRTS[Math.floor(Math.random() * DRIVER_SHIRTS.length)];
  var hair = DRIVER_HAIRS[Math.floor(Math.random() * DRIVER_HAIRS.length)];
  var skinMat = paint(skin, 0.65, 0.05);
  var shirtMat = paint(shirt, 0.75, 0.05);
  // Seat bench under the driver + dash under the windshield.
  g.add(box(0.55, 0.30, 1.5, darkMat(), -0.15, 0.72, 0));
  g.add(box(0.30, 0.12, 1.5, darkMat(), 0.85, 0.95, 0));
  // Torso, seated: a short capsule from the bench to the shoulders.
  var torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.18, 4, 10), shirtMat);
  torso.position.set(-0.15, 0.98, -0.45);
  g.add(torso);
  // Head + hair cap, just under the roof.
  var head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 14, 10), skinMat);
  head.position.set(-0.12, 1.22, -0.45);
  g.add(head);
  var hairCap = new THREE.Mesh(
    new THREE.SphereGeometry(0.122, 14, 10, 0, Math.PI * 2, 0, 1.9),
    paint(hair, 0.9, 0.05));
  hairCap.position.set(-0.135, 1.235, -0.45);
  hairCap.rotation.z = -0.5;
  g.add(hairCap);
  // Steering wheel: a dark torus ahead of the driver, its plane
  // vertical and facing the driver, tipped back toward them.
  var wheelMount = new THREE.Group();
  wheelMount.position.set(0.38, 1.02, -0.45);
  wheelMount.rotation.z = 0.35;
  var wheel = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.022, 8, 20), darkMat());
  wheel.rotation.y = Math.PI / 2;
  wheelMount.add(wheel);
  var column = box(0.3, 0.05, 0.05, darkMat(), -0.18, -0.12, 0);
  column.rotation.z = 0.5;
  wheelMount.add(column);
  g.add(wheelMount);
  // Arms: from the shoulders forward-down to the wheel rim.
  for (var s = -1; s <= 1; s += 2) {
    var arm = box(0.5, 0.07, 0.07, shirtMat, 0.12, 1.02, -0.45 + 0.16 * s);
    arm.rotation.z = -0.12;
    g.add(arm);
    var hand = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 8), skinMat);
    hand.position.set(0.36, 0.99, -0.45 + 0.15 * s);
    g.add(hand);
  }
  return g;
}

// One builder for every car in the city. detail 3 is the hero:
// racing stripe, spoiler, mirrors, spoked wheels.
// detail 1 is traffic: same body and glass, fewer meshes.
function buildCar(color, detailed, opts) {
  var group = new THREE.Group();
  var body = new THREE.Group(); // leans on its suspension; wheels stay put
  group.add(body);
  group.add(contactShadow());

  // Beam splash + light pool on the road ahead, in the group (not
  // the leaning body) so they stay glued to the asphalt. The splash
  // is a long faint-blue ellipse stretching ~10 m forward from the
  // nose; the pool is a shorter, brighter ellipse under the beam's
  // near end — the headlights' answer to the street-lamp pools.
  // Both sit just above the contact shadow (y 0.02) so they never
  // z-fight it, and both are driven by applyLampLevels below.
  // GTA V approach: NO volumetric cone in the air — the beam IS the
  // pool on the road plus the lens glow. The old additive cones
  // were deleted in r8: a cone's silhouette is a triangle from the
  // side, exactly the angle live play sees. Both quads use the
  // elongated beam texture so the pool fades softly, never wedged.
  var beam = groundGlow(0xaac8ff, 11.5, 3.8, beamTexture());
  beam.position.set(2.3 + 5.2, 0.04, 0);
  group.add(beam);
  var pool = groundGlow(0xcfe0ff, 8.0, 5.0, beamTexture());
  pool.position.set(2.3 + 3.2, 0.05, 0);
  group.add(pool);

  var base = new THREE.Color(color);
  // r9 C2: the hero gets a real clearcoat paint job —
  // MeshPhysicalMaterial with clearcoat 1 — while traffic keeps the
  // cheaper MeshStandardMaterial (never physical on traffic).
  var bodyMat = detailed
    ? new THREE.MeshPhysicalMaterial({
        color: color, roughness: 0.3, metalness: 0.7,
        clearcoat: 1, clearcoatRoughness: 0.1, envMapIntensity: 1.0
      })
    : paint(color, 0.35, 0.6);
  var skirtMat = paint(base.clone().multiplyScalar(0.55).getHex(), 0.5, 0.4);
  var glass = glassMat();
  // r11 B3: traffic glass is tinted but see-through, so the driver
  // inside reads through it; the hero keeps opaque glass.
  if (!detailed) {
    glass.transparent = true;
    glass.opacity = 0.45;
    glass.depthWrite = false;
  }

  // Main body, low skirt, sloped hood: a long low shape, not a box
  // with a box on top. r9 B1: the body is a rounded box (bevel
  // catches a highlight); the hero gets the skirt and hood rounded
  // too, traffic keeps them sharp to hold the triangle budget.
  body.add(rbox(4.6, 0.55, 2.0, bodyMat, 0, 0.55, 0, 0.06));
  if (detailed) {
    body.add(rbox(4.4, 0.22, 1.9, skirtMat, 0, 0.28, 0, 0.05));
  } else {
    body.add(box(4.4, 0.22, 1.9, skirtMat, 0, 0.28, 0));
  }
  var hood = detailed
    ? rbox(1.2, 0.16, 1.86, bodyMat, 1.55, 0.86, 0, 0.04)
    : box(1.2, 0.16, 1.86, bodyMat, 1.55, 0.86, 0);
  hood.rotation.z = -0.10;
  body.add(hood);
  // Glasshouse with a painted roof panel, so the cabin reads as
  // glass from every angle and paint from above. The hero cabin is
  // the tumblehome trapezoid; traffic keeps the straight box.
  if (detailed) {
    var cabin = new THREE.Mesh(greenhouseGeo(), glass);
    cabin.position.set(-0.15, 1.08, 0);
    body.add(cabin);
  } else {
    body.add(box(2.3, 0.52, 1.72, glass, -0.15, 1.08, 0));
  }
  if (detailed) {
    body.add(rbox(2.3, 0.08, 1.5, bodyMat, -0.15, 1.36, 0, 0.03));
  } else {
    body.add(box(2.3, 0.08, 1.5, bodyMat, -0.15, 1.36, 0));
  }
  // Windshield light streak: a diagonal white plane across the
  // windshield (r9 C6) — a specular streak, not a scratch.
  body.add(windshieldStreak());
  // Rear window: a distinct dark glass panel set into the back face
  // of the glasshouse, so the rear reads as glass, not painted body.
  // The hero pane is narrower so its top corners stay inside the
  // trapezoid's sloping flanks.
  body.add(box(0.05, 0.42, detailed ? 1.44 : 1.5, glass, -1.31, 1.08, 0));
  // Side glass: proud dark panels on both flanks of the glasshouse,
  // split front/rear by a body-colour B-pillar strip, with a
  // beltline under them.
  // Hero side glass follows the trapezoid slope (14.6 deg in from
  // the beltline); traffic glass stays flat on the straight box
  // cabin. The tilt is about the x-axis so the top edge leans in.
  var glassZ = detailed ? 0.8125 : 0.87;
  var glassTilt = detailed ? -0.255 : 0;
  for (var sg = -1; sg <= 1; sg += 2) {
    var sideGlass = box(2.0, 0.38, 0.04, glass, -0.15, 1.08, glassZ * sg);
    sideGlass.rotation.x = glassTilt * sg;
    body.add(sideGlass);
    var bPillar = box(0.06, 0.38, 0.05, bodyMat, -0.15, 1.08, glassZ * sg);
    bPillar.rotation.x = glassTilt * sg;
    body.add(bPillar);
    body.add(box(2.3, 0.05, 0.02, darkMat(), -0.15, 0.84, (detailed ? 0.86 : 0.87) * sg));
    // Panel lines: a side character line, door shut lines, and
    // door handles, so the flanks read as panelled bodywork.
    body.add(box(3.8, 0.03, 0.02, darkMat(), 0, 0.70, 1.005 * sg));
    body.add(box(0.03, 0.5, 0.02, darkMat(), 0.55, 0.55, 1.005 * sg));
    body.add(box(0.03, 0.5, 0.02, darkMat(), -0.85, 0.55, 1.005 * sg));
    body.add(box(0.22, 0.05, 0.04, darkMat(), 0.35, 0.78, 1.01 * sg));
    body.add(box(0.22, 0.05, 0.04, darkMat(), -0.55, 0.78, 1.01 * sg));
  }
  // Trunk shut line across the deck. On the hero it rides the
  // sloped decklid (below); on traffic it stays on the flat deck.
  if (detailed) {
    var trunkShut = box(0.03, 0.02, 1.7, darkMat(), -1.95, 0.905, 0);
    trunkShut.rotation.z = 0.08;
    body.add(trunkShut);
  } else {
    body.add(box(0.03, 0.02, 1.7, darkMat(), -1.95, 0.84, 0));
  }
  // Sloped trunk deck (hero, r9 B2): a thin decklid sloping down
  // toward the rear, so the tail is a slope, not a flat top. Its
  // rearmost point is x -2.3, inside the 4.6 m collision box.
  if (detailed) {
    var trunk = rbox(0.9, 0.10, 1.86, bodyMat, -1.85, 0.86, 0, 0.03);
    trunk.rotation.z = 0.08;
    body.add(trunk);
  }
  // Grille, bumpers, lamps.
  body.add(box(0.04, 0.18, 1.1, darkMat(), 2.31, 0.45, 0));
  body.add(box(0.04, 0.05, 1.1,
    paint(0xc0c0c0, 0.3, 0.9), 2.33, 0.45, 0));
  if (detailed) {
    body.add(rbox(0.12, 0.16, 2.02, darkMat(), 2.32, 0.30, 0, 0.04));
    body.add(rbox(0.12, 0.16, 2.02, darkMat(), -2.32, 0.30, 0, 0.04));
  } else {
    body.add(box(0.12, 0.16, 2.02, darkMat(), 2.32, 0.30, 0));
    body.add(box(0.12, 0.16, 2.02, darkMat(), -2.32, 0.30, 0));
  }
  var headMat = lampMat(0xfff2b0);
  var tailMat = lampMat(0xff2e2e);
  tailMat.emissiveIntensity = 1.5; // taillights glow from behind
  body.add(box(0.06, 0.18, 0.40, headMat, 2.31, 0.62, 0.62));
  body.add(box(0.06, 0.18, 0.40, headMat, 2.31, 0.62, -0.62));
  body.add(box(0.06, 0.16, 0.42, tailMat, -2.33, 0.62, 0.62));
  body.add(box(0.06, 0.16, 0.42, tailMat, -2.33, 0.62, -0.62));
  // Full-width rear light bar joining the taillights.
  body.add(box(0.05, 0.10, 1.5, tailMat, -2.335, 0.62, 0));
  // Rear fascia: a dark full-width panel across the rear face
  // behind the lamps, so the back of the car reads as a designed
  // rear end — lamps, bar and plate mounted on black — instead of
  // one flat painted slab. The lamps/bar above sit proud of it.
  body.add(box(0.03, 0.36, 1.96, darkMat(), -2.30, 0.61, 0));
  // Bright trim strip under the lamps, above the bumper.
  body.add(box(0.02, 0.04, 1.9,
    paint(0xc0c0c0, 0.3, 0.9), -2.32, 0.40, 0));
  // Wrap-around tail segments on the rear quarters, so the red
  // reads from the rear three-quarter chase view, not just dead
  // behind — the lamps turn the corner instead of stopping at it.
  body.add(box(0.5, 0.16, 0.04, tailMat, -2.05, 0.62, 1.01));
  body.add(box(0.5, 0.16, 0.04, tailMat, -2.05, 0.62, -1.01));
  // Low rear reflectors on the diffuser, flanking the exhausts.
  body.add(box(0.04, 0.07, 0.28, tailMat, -2.36, 0.20, 0.80));
  body.add(box(0.04, 0.07, 0.28, tailMat, -2.36, 0.20, -0.80));
  // C-pillar strips framing the rear glass, and a rear wiper on
  // it, so the glasshouse reads as glass with pillars from behind.
  body.add(box(0.06, 0.44, 0.12, bodyMat, -1.32, 1.08, 0.82));
  body.add(box(0.06, 0.44, 0.12, bodyMat, -1.32, 1.08, -0.82));
  body.add(box(0.02, 0.03, 0.5, darkMat(), -1.345, 0.95, 0));
  // Mudflaps behind the rear wheels — dark shapes flanking the
  // bumper that break the body's lower edge from behind.
  body.add(box(0.04, 0.32, 0.42, darkMat(), -1.84, 0.32, 1.0));
  body.add(box(0.04, 0.32, 0.42, darkMat(), -1.84, 0.32, -1.0));
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
  // Licence plate in a dark frame, mounted on the fascia panel.
  body.add(box(0.02, 0.24, 0.65, darkMat(), -2.33, 0.45, 0));
  body.add(box(0.03, 0.18, 0.55,
    new THREE.MeshStandardMaterial({
      color: 0xe8e8e8, roughness: 0.5, metalness: 0.1
    }), -2.345, 0.45, 0));

  if (detailed) {
    // Racing stripe down the centre line, hood to trunk.
    var stripeMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.55
    });
    body.add(box(1.6, 0.02, 0.5, stripeMat, 1.5, 0.86, 0));
    body.add(box(2.3, 0.02, 0.5, stripeMat, -0.15, 1.41, 0));
    // The trunk stripe rides the sloped decklid, not the flat deck.
    var trunkStripe = box(0.9, 0.02, 0.5, stripeMat, -1.85, 0.92, 0);
    trunkStripe.rotation.z = 0.08;
    body.add(trunkStripe);
    // Rear spoiler on two posts, with a centre third brake light
    // facing the chase camera.
    body.add(box(0.08, 0.18, 0.08, skirtMat, -2.15, 0.92, 0.6));
    body.add(box(0.08, 0.18, 0.08, skirtMat, -2.15, 0.92, -0.6));
    body.add(rbox(0.5, 0.06, 1.9, skirtMat, -2.18, 1.03, 0, 0.02));
    body.add(box(0.06, 0.05, 0.5, tailMat, -2.44, 1.04, 0));
    // Wheel-arch eyebrows over each wheel, so the arches read
    // from the side and the rear three-quarter.
    for (var fa = -1; fa <= 1; fa += 2) {
      for (var fb = -1; fb <= 1; fb += 2) {
        body.add(box(1.0, 0.08, 0.06, skirtMat, WHEEL_X * fa, 0.82, 1.02 * fb));
      }
    }
    // Wheel-arch recesses (r9 B2): a dark disc behind each wheel,
    // so the tyre sits in a shadowed arch instead of floating on
    // the flat flank. Hero only — +4 meshes per car would cost
    // ~600 draw calls across the traffic fleet.
    for (var ra = -1; ra <= 1; ra += 2) {
      for (var rb = -1; rb <= 1; rb += 2) {
        var recess = new THREE.Mesh(recessGeo(), darkMat());
        recess.position.set(WHEEL_X * ra, WHEEL_R, 1.01 * rb);
        if (rb < 0) recess.rotation.y = Math.PI;
        body.add(recess);
      }
    }
    // Side mirrors.
    body.add(box(0.12, 0.10, 0.16, bodyMat, 0.75, 1.0, 1.0));
    body.add(box(0.12, 0.10, 0.16, bodyMat, 0.75, 1.0, -1.0));
    // Hero rear: a roof lip over the rear glass and a lower rear
    // valance under the diffuser, so the silhouette breaks at the
    // top and the bottom as well as at the lamps.
    body.add(box(0.3, 0.04, 1.5, skirtMat, -1.25, 1.40, 0));
    body.add(box(0.14, 0.10, 1.9, skirtMat, -2.30, 0.12, 0));
    // NOTE (r8): no headlight cones here any more. The old additive
    // ConeGeometry meshes were deleted — a cone's silhouette IS a
    // triangle from the side, which is exactly the angle live play
    // sees. The beam is the ground pool + lens glow only (GTA V).
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

  // r11 B3: the driver figure (traffic only — the hero is driven by
  // the player). The hook hides/shows it: traffic3d hides it for
  // parked cars and mopeds, main3d hides it when the player boards
  // and shows it again when a jacked car is left behind.
  var driver = null;
  if (!detailed && (!opts || opts.driver !== false)) {
    driver = buildDriver();
    body.add(driver);
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
    beam.material.opacity = 0.38 * nf;
    pool.material.opacity = 0.65 * nf;
    // r8: the headlight cones are gone (deleted above) — no cone
    // opacity to drive any more. Beam = pool + lens glow only.
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

  // r11-B3: driver visibility hook (see the driver block above).
  // A no-op on the hero (no driver figure); traffic3d and main3d
  // call it without guards.
  group.userData.setDriverVisible = function (v) {
    if (driver) driver.visible = !!v;
  };
  group.userData.hasDriver = function () { return !!driver; };

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

// Traffic: same assembly, cheaper (no stripe, spoiler, mirrors
// or spokes), in a street colour. Pass a colour, or one
// is picked from the roster palette in turn so the street varies.
// opts.driver === false builds the car with no driver figure
// (parked cars, mopeds — r11 B3).
export function createTrafficCar(color, opts) {
  var c = color;
  if (!c) {
    c = TRAFFIC_PALETTE[paletteCursor % TRAFFIC_PALETTE.length];
    paletteCursor++;
  }
  return buildCar(c, false, opts);
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
