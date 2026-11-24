// Palma Verde 3D — chase camera.
//
// Third-person camera that sits BEHIND and ABOVE the hero, follows
// with lag (never a snap), and looks slightly down the road toward a
// horizon. The top of the frame is real sky, never a top-down view.
//
// Coordinate contract (agreed with the world builder): the hero's
// position is a THREE.Vector3 in three-space, y-up, ground at y = 0.
// heading is radians, forward = (cos heading, 0, sin heading) — the
// same convention as the 2D game (angle 0 = east, angle grows toward
// south). If the world builder maps 2D y to -z instead, pass
// heading = -angle2d and everything below still holds.
//
// Units: metres. B1's world (config3d.js) is metres — city
// -1400..+1400, +X east, +Z south, +Y up — the same axes this
// camera assumes, so no scale conversion is needed anywhere.
// Game speeds are m/s (city limit 14, highway 30); they pass
// through normSpeed unchanged, and the >40 rule below only covers
// a caller that still hands over raw 2D world units.
//
// Sky budget (the number the frame is judged by): with vertical FOV
// f and a downward pitch p, the horizon sits at
// (1 - tan(p) / tan(f / 2)) / 2 of the frame from the top.
// pitch = atan((height - lookHeight) / (distance + lookAhead)).
// A low lens AND a small sky band fight each other — a low camera
// pitched gently shows more sky — so the presets use a narrower
// FOV (42-45) to hold both: the lens sits low (20-24 deg elevation
// at the hero, a real third-person read, not a drone) while the
// horizon still lands near the top quarter of the frame.
//   car:  elev ~23 deg, pitch ~11 deg, FOV 42 -> sky ~24%, car ~23% wide
//   foot: elev ~20 deg, pitch ~10 deg, FOV 42 -> sky ~27%, Rey ~196 px on 720p
//   heli: elev ~24 deg, pitch ~12 deg, FOV 45 -> sky ~25%, low over the beach road

import * as THREE from '../vendor/three.module.min.js';

// distance: metres behind the hero. height: metres above the hero's
// base (for the heli that is above her current altitude).
// lookAhead: metres in front of the hero the lens points at.
// lookHeight: height of that look point above the hero's base.
// tauPos / tauLook / tauDir: smoothing time constants in seconds —
// larger means lazier, heavier follow. Speed adds a little look-ahead
// and a little FOV so fast driving feels fast without a snap.
export const CAMERA_PRESETS = {
  car: {
    distance: 7.0, height: 3.0, lookAhead: 3.0, lookHeight: 1.0,
    fov: 42, tauPos: 0.30, tauLook: 0.22, tauDir: 0.45
  },
  foot: {
    distance: 9.0, height: 3.3, lookAhead: 2.2, lookHeight: 1.3,
    fov: 42, tauPos: 0.25, tauLook: 0.20, tauDir: 0.35
  },
  heli: {
    distance: 11.0, height: 4.9, lookAhead: 8.0, lookHeight: 1.0,
    fov: 45, tauPos: 0.45, tauLook: 0.30, tauDir: 0.55
  }
};

// Aim framing (r10): while the hero aims on foot the lens pulls in
// close over the shoulder — near Rey, gun and target in frame — and
// eases back to the chase preset when aiming stops. The blend is a
// damped 0..1 weight, so there is never a snap either way.
var AIM = {
  distance: 3.4, height: 2.0, lookAhead: 5.5, lookHeight: 1.35,
  fov: 40, shoulder: 0.85, tau: 0.15
};

var MIN_CAM_Y = 0.8; // the lens never dips under the ground plane

// The game loop tracks 2D world units (Rey walks at 150, a car tops
// out near 176); the camera only needs speed for feel, so anything
// above 40 is read as 2D units and scaled to metres per second at
// the 0.1 world mapping. Smaller values pass through as m/s.
function normSpeed(speed) {
  var s = Math.abs(speed || 0);
  if (s > 40) s *= 0.1;
  return Math.min(s, 40);
}

function dampFactor(dt, tau) {
  return 1 - Math.exp(-dt / Math.max(tau, 0.001));
}

export function createChaseCamera(camera, opts) {
  var options = opts || {};
  // Optional wall test (main3d passes world.isSolid): the closer aim
  // lens must never sit inside a building. When present, the desired
  // position is pulled back toward the hero until it clears.
  var isSolid = typeof options.isSolid === 'function' ? options.isSolid : null;
  var smoothedPos = new THREE.Vector3();
  var smoothedLook = new THREE.Vector3();
  var smoothedDir = new THREE.Vector3(1, 0, 0);
  var started = false;
  var aimT = 0; // 0 chase .. 1 full over-the-shoulder aim framing
  var tmpDir = new THREE.Vector3();
  var tmpPos = new THREE.Vector3();
  var tmpLook = new THREE.Vector3();

  // Blend the chase preset toward the aim preset by aimT. Aim only
  // applies on foot: in a car or the Gull the hero descriptor never
  // sets aiming, so aimT decays back to chase framing there.
  function framed(preset, aiming) {
    var t = aiming ? aimT : 0;
    return {
      distance: preset.distance + (AIM.distance - preset.distance) * t,
      height: preset.height + (AIM.height - preset.height) * t,
      lookAhead: preset.lookAhead + (AIM.lookAhead - preset.lookAhead) * t,
      lookHeight: preset.lookHeight + (AIM.lookHeight - preset.lookHeight) * t,
      fov: preset.fov + (AIM.fov - preset.fov) * t,
      shoulder: AIM.shoulder * t
    };
  }

  // Pull a desired camera position back along the hero->camera
  // segment until it is out of any solid, keeping at least 1.2 m
  // from the hero so the lens never lands on top of Rey. Without a
  // solid test the position passes through untouched.
  function clearOfWalls(heroPos, pos) {
    if (!isSolid) return;
    var dx = pos.x - heroPos.x, dz = pos.z - heroPos.z;
    var len = Math.hypot(dx, dz);
    if (len < 0.01) return;
    var step = 0.5, minLen = 1.2;
    var clear = len;
    for (var d = len; d > minLen; d -= step) {
      var s = d / len;
      if (!isSolid(heroPos.x + dx * s, heroPos.z + dz * s)) { clear = d; break; }
      clear = d - step;
    }
    if (clear < len) {
      var c = Math.max(clear, minLen) / len;
      pos.x = heroPos.x + dx * c;
      pos.z = heroPos.z + dz * c;
    }
  }

  function desired(hero, preset, outPos, outLook) {
    var speed = normSpeed(hero.speed);
    var fr = framed(preset, hero.mode === 'foot' && !!hero.aiming);
    // Faster travel pulls the lens a little further back and further
    // down the road, so the frame opens up instead of crowding.
    // Aiming pins the distance: the over-the-shoulder shot must not
    // drift back with speed.
    var dist = fr.distance + Math.min(speed * 0.05, 1.2) * (1 - aimT);
    var ahead = fr.lookAhead + Math.min(speed * 0.12, 2.0) * (1 - aimT);
    var base = hero.position.y;
    tmpDir.set(Math.cos(hero.heading), 0, Math.sin(hero.heading));
    outPos.copy(hero.position)
      .addScaledVector(tmpDir, -dist);
    // Over-the-shoulder: shift the lens to the hero's right side so
    // the gun arm and the target stay in frame, not the back of Rey.
    if (fr.shoulder > 0.01) {
      outPos.x += -tmpDir.z * fr.shoulder;
      outPos.z += tmpDir.x * fr.shoulder;
    }
    outPos.y = base + fr.height;
    clearOfWalls(hero.position, outPos);
    outLook.copy(hero.position)
      .addScaledVector(tmpDir, ahead);
    outLook.y = base + fr.lookHeight;
    return speed;
  }

  function place(hero) {
    var preset = CAMERA_PRESETS[hero.mode] || CAMERA_PRESETS.foot;
    var speed = desired(hero, preset, smoothedPos, smoothedLook);
    if (smoothedPos.y < MIN_CAM_Y) smoothedPos.y = MIN_CAM_Y;
    camera.position.copy(smoothedPos);
    camera.lookAt(smoothedLook);
    var fr = framed(preset, hero.mode === 'foot' && !!hero.aiming);
    var targetFov = fr.fov + Math.min(normSpeed(hero.speed) * 0.35, 6) * (1 - aimT);
    if (Math.abs(camera.fov - targetFov) > 0.01) {
      camera.fov = targetFov;
      camera.updateProjectionMatrix();
    }
    return speed;
  }

  return {
    // One frame of follow. dt in seconds. hero is
    // { position: THREE.Vector3, heading: number, speed: number,
    //   mode: 'car' | 'foot' | 'heli', aiming?: boolean } — aiming
    // is only ever true on foot (the descriptor sets it from
    // player.aiming); cars and the Gull keep chase framing.
    update: function (dt, hero) {
      if (!hero || !hero.position) return;
      var preset = CAMERA_PRESETS[hero.mode] || CAMERA_PRESETS.foot;
      var step = Math.max(0, Math.min(dt, 0.1));

      // Ease the aim weight in and out (tau 0.15 s): the lens
      // glides to the shoulder and back, never snaps.
      var wantAim = (hero.mode === 'foot' && !!hero.aiming) ? 1 : 0;
      aimT += (wantAim - aimT) * dampFactor(step, AIM.tau);
      if (Math.abs(aimT - wantAim) < 0.001) aimT = wantAim;

      // Smooth the heading direction itself (a vector, so there is
      // no wrap jump at +/-PI) and the position / look point.
      tmpDir.set(Math.cos(hero.heading), 0, Math.sin(hero.heading));
      smoothedDir.lerp(tmpDir, dampFactor(step, preset.tauDir)).normalize();

      var speed = normSpeed(hero.speed);
      var fr = framed(preset, wantAim === 1);
      var dist = fr.distance + Math.min(speed * 0.05, 1.2) * (1 - aimT);
      var ahead = fr.lookAhead + Math.min(speed * 0.12, 2.0) * (1 - aimT);
      tmpPos.copy(hero.position).addScaledVector(smoothedDir, -dist);
      if (fr.shoulder > 0.01) {
        tmpPos.x += -smoothedDir.z * fr.shoulder;
        tmpPos.z += smoothedDir.x * fr.shoulder;
      }
      tmpPos.y = hero.position.y + fr.height;
      clearOfWalls(hero.position, tmpPos);
      tmpLook.copy(hero.position).addScaledVector(smoothedDir, ahead);
      tmpLook.y = hero.position.y + fr.lookHeight;

      if (!started) {
        smoothedPos.copy(tmpPos);
        smoothedLook.copy(tmpLook);
        started = true;
      } else {
        smoothedPos.lerp(tmpPos, dampFactor(step, preset.tauPos));
        smoothedLook.lerp(tmpLook, dampFactor(step, preset.tauLook));
      }
      if (smoothedPos.y < MIN_CAM_Y) smoothedPos.y = MIN_CAM_Y;

      camera.position.copy(smoothedPos);
      camera.lookAt(smoothedLook);

      var targetFov = fr.fov + Math.min(speed * 0.35, 6) * (1 - aimT);
      if (Math.abs(camera.fov - targetFov) > 0.01) {
        camera.fov += (targetFov - camera.fov) * dampFactor(step, 0.4);
        camera.updateProjectionMatrix();
      }
    },

    // Put the lens exactly on the target (spawn / teleport / mode
    // cut). The only snap in the module; update() never snaps.
    snap: function (hero) {
      if (!hero || !hero.position) return;
      started = false;
      place(hero);
      started = true;
    },

    presets: CAMERA_PRESETS,
    // Current aim blend (0 chase .. 1 shoulder), for probes/tests.
    get aimWeight() { return aimT; }
  };
}
