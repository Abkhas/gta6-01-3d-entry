// daynight3d.js — the game clock and the four-grade day/night cycle.
//
// The clock advances in game time (one full day per DAY_LENGTH_S of
// play, 480 s by default, so a game minute passes every 3 seconds).
// The visible clock, the sky, the lights and the street all follow
// the same grade. A grade is a full palette, not a brightness slider:
// morning is bright and clear, noon is warm-yellow with short
// shadows, afternoon is darker with long shadows, night is dark-blue
// with stars, a moon, lit windows and neon — and never near-black, so
// the street stays legible after dark.
//
// Grades come from CFG3D.GRADES (B1's config3d.js) through its
// gradeForHour / gradeBlend helpers: gradeBlend interpolates across
// the dawn and dusk edges so the cycle never snaps. This module
// blends the two neighbouring grades itself (lerping every colour and
// number) and hands the result to the sky and the lights.
//
// createDayNight(sky, opts):
//   sky — B1's sky handle (duck-typed, optional). When present it is
//     driven each frame: sky.setTimeOfDay(gradeName, grade) is called
//     with the grade NAME ('morning' | 'noon' | 'afternoon' | 'night')
//     and the blended grade object. B1's module function has the
//     signature setTimeOfDay(scene, gradeName, world), so B4 passes a
//     one-line adapter:
//       { setTimeOfDay: (gradeName) => setTimeOfDay(scene, gradeName, world) }
//     When absent, the system still computes the clock and the grade
//     and exposes them for B4 to consume.
//   opts.lights — optional { sun, hemi, ambient } light objects
//     (THREE lights, duck-typed: .color.set(hex) + .intensity). The
//     sun's position is set from the grade's elevation/azimuth.
//   opts.world — optional B1 world object; its setWindowGlow(v) and
//     setLampGlow(v) are driven from the grade's windowGlow/neonGlow.
//   opts.startHour (default CFG.DAY_START_HOUR, 9.5), opts.timeScale
//     (multiplier on the clock rate, default 1).
//
// The system exposes: update(dt), setTime(hour), hour, minutes,
// clockLabel() ("09:30 · Morning"), gradeName, grade (the blended
// palette object), stars, windowGlow, neonGlow, shadowLength,
// snapshot() for the HUD.

import { CFG3D as CFG, gradeForHour, gradeBlend } from './config3d.js';

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function hexToRgb(hex) {
  const h = String(hex).replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r, g, b) {
  const p = (v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0');
  return `#${p(r)}${p(g)}${p(b)}`;
}

function lerpHex(a, b, t) {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  return rgbToHex(
    ca[0] + (cb[0] - ca[0]) * t,
    ca[1] + (cb[1] - ca[1]) * t,
    ca[2] + (cb[2] - ca[2]) * t,
  );
}

function lerpNum(a, b, t) {
  return a + (b - a) * t;
}

// Blend two grade records field by field: colours lerp, numbers lerp.
function blendGrades(from, to, t) {
  const out = {};
  for (const key of Object.keys(from)) {
    const a = from[key];
    const b = to[key];
    if (typeof a === 'string' && a.startsWith('#') && typeof b === 'string' && b.startsWith('#')) {
      out[key] = lerpHex(a, b, t);
    } else if (typeof a === 'number' && typeof b === 'number') {
      out[key] = lerpNum(a, b, t);
    } else {
      out[key] = t < 0.5 ? a : b;
    }
  }
  return out;
}

export function createDayNight(sky, opts) {
  const o = opts || {};
  const dayLength = CFG.DAY_LENGTH_S || 480;
  const sys = {
    sky: sky || null,
    world: o.world || null,
    lights: o.lights || null,
    hour: typeof o.startHour === 'number' ? o.startHour : (CFG.DAY_START_HOUR ?? 9.5),
    timeScale: typeof o.timeScale === 'number' ? o.timeScale : 1,
    gradeName: 'morning',
    grade: null,
    stars: 0,
    windowGlow: 0.12,
    neonGlow: 0.25,
    shadowLength: 1,
    moonUp: false,
  };

  function computeGrade() {
    const blend = gradeBlend(sys.hour);
    const g = blendGrades(blend.from, blend.to, blend.t);
    const base = gradeForHour(sys.hour);
    sys.gradeName = base.label;
    sys.gradeKey = Object.keys(CFG.GRADES).find((k) => CFG.GRADES[k] === base) || 'morning';
    sys.grade = g;
    sys.stars = g.stars ?? 0;
    sys.windowGlow = g.windowGlow ?? 0;
    sys.neonGlow = g.neonGlow ?? 0;
    // Shadow length from sun elevation: low sun, long shadows.
    const elev = Math.max(2, g.sunElevation || 30);
    sys.shadowLength = Math.round((1 / Math.tan((elev * Math.PI) / 180)) * 10) / 10;
    sys.moonUp = sys.gradeName === 'Night';
    return g;
  }

  function applyToSkyAndLights() {
    const g = sys.grade;
    if (!g) return;
    if (sys.sky) {
      if (typeof sys.sky.setTimeOfDay === 'function') sys.sky.setTimeOfDay(sys.gradeKey, g);
      if (typeof sys.sky.applyGrade === 'function') sys.sky.applyGrade(g);
    }
    if (sys.world) {
      if (typeof sys.world.setWindowGlow === 'function') sys.world.setWindowGlow(sys.windowGlow);
      if (typeof sys.world.setLampGlow === 'function') sys.world.setLampGlow(sys.neonGlow);
    }
    if (sys.lights) {
      const L = sys.lights;
      if (L.sun) {
        if (L.sun.color && typeof L.sun.color.set === 'function') L.sun.color.set(g.sunColor);
        else if (L.sun.color) L.sun.color = g.sunColor;
        if (typeof L.sun.intensity === 'number') L.sun.intensity = g.sunIntensity;
        // Sun position from elevation / azimuth (metres out, y up).
        const el = ((g.sunElevation || 30) * Math.PI) / 180;
        const az = ((g.sunAzimuth || 180) * Math.PI) / 180;
        const r = 800;
        if (L.sun.position && typeof L.sun.position.set === 'function') {
          L.sun.position.set(
            Math.cos(el) * Math.sin(az) * r,
            Math.sin(el) * r,
            Math.cos(el) * Math.cos(az) * r,
          );
        }
      }
      if (L.hemi) {
        if (L.hemi.color && typeof L.hemi.color.set === 'function') L.hemi.color.set(g.hemiSky);
        else if (L.hemi.color) L.hemi.color = g.hemiSky;
        if (L.hemi.groundColor && typeof L.hemi.groundColor.set === 'function') {
          L.hemi.groundColor.set(g.hemiGround);
        } else if (L.hemi.groundColor) L.hemi.groundColor = g.hemiGround;
        if (typeof L.hemi.intensity === 'number') L.hemi.intensity = g.hemiIntensity;
      }
      if (L.ambient) {
        if (L.ambient.color && typeof L.ambient.color.set === 'function') L.ambient.color.set(g.hemiSky);
        else if (L.ambient.color) L.ambient.color = g.hemiSky;
        if (typeof L.ambient.intensity === 'number') L.ambient.intensity = g.hemiIntensity * 0.5;
      }
    }
  }

  function update(dt) {
    // 24 game-hours per DAY_LENGTH_S of play, times the scale.
    sys.hour = (sys.hour + (dt * 24) / dayLength * sys.timeScale) % 24;
    computeGrade();
    applyToSkyAndLights();
    return sys;
  }

  function setTime(hour) {
    sys.hour = ((hour % 24) + 24) % 24;
    computeGrade();
    applyToSkyAndLights();
    return sys;
  }

  function clockLabel() {
    const h = Math.floor(sys.hour);
    const m = Math.floor((sys.hour - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  function minutes() {
    return Math.floor(sys.hour * 60);
  }

  // The HUD block for the clock + day/night panel.
  function snapshot() {
    return {
      clock: clockLabel(),
      hour: sys.hour,
      minutes: minutes(),
      grade: sys.gradeName,
      gradeKey: sys.gradeKey,
      stars: sys.stars,
      windowGlow: sys.windowGlow,
      neonGlow: sys.neonGlow,
      shadowLength: sys.shadowLength,
      moonUp: sys.moonUp,
      skyTop: sys.grade?.skyTop || null,
      skyHorizon: sys.grade?.skyHorizon || null,
      fogColor: sys.grade?.fogColor || null,
    };
  }

  computeGrade();
  sys.update = update;
  sys.setTime = setTime;
  sys.clockLabel = clockLabel;
  sys.minutes = minutes;
  sys.snapshot = snapshot;
  return sys;
}
