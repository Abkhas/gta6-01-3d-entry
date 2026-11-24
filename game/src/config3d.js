// Palma Verde 3D — world constants, districts and time-of-day grades.
// Units are metres. Three.js axes: +X east, +Z south, +Y up. The beach and
// the ocean sit on the WEST edge (negative X); the city grid is centred on
// the origin. Every value here was picked fresh for the 3D build.

export const CFG3D = {
  // ---- city footprint -------------------------------------------------
  CITY_HALF: 1400,          // city grid runs -1400..+1400 on X and Z
  BLOCK: 200,               // distance between road centrelines
  ROAD_WIDTH: 14,           // ordinary two-lane street width
  HIGHWAY_WIDTH: 30,        // multi-lane highway width
  SIDEWALK: 4,              // pavement strip beside each road

  // ---- west edge: sand, sea, pier ------------------------------------
  BEACH_X: -1400,           // where the city grid ends and sand begins
  SHORE_X: -1620,           // waterline at mid tide
  OCEAN_X: -2350,           // far edge of the ocean plane
  PIER_Z: 950,              // pier centreline (south end of the Boardwalk)
  PIER_LENGTH: 520,         // how far the pier reaches into the sea
  PIER_WIDTH: 26,

  // ---- highway ---------------------------------------------------------
  // East-west freeway across the north edge + north-south freeway on the
  // east edge. Both are fenced, multi-lane, no cross streets.
  HIGHWAY_NORTH_Z: -1200,
  HIGHWAY_EAST_X: 1200,

  // ---- traffic ---------------------------------------------------------
  TRAFFIC_LIGHT_CYCLE: 14,  // seconds for a full green-yellow-red cycle
  SPEED_LIMIT_CITY: 14,     // m/s (~50 km/h) on ordinary streets
  SPEED_LIMIT_HIGHWAY: 30,  // m/s on the freeway

  // ---- districts -------------------------------------------------------
  // Seven rectangles that tile the city. Each carries the palette the
  // world builder paints its buildings with and a one-line flavour note
  // the HUD can show when the player crosses into it.
  DISTRICTS: [
    {
      id: 'marina', name: 'Marina', short: 'MARINA',
      x0: -1400, z0: -1400, x1: -480, z1: -480,
      roof: '#b85c38', wall: '#ead9c2', trim: '#256b74', accent: '#ffd98a',
      blurb: 'White stucco, moored yachts, gulls over the pontoons.',
      height: [10, 34], density: 0.72,
    },
    {
      id: 'oldtown', name: 'Old Town', short: 'OLD TOWN',
      x0: -480, z0: -1400, x1: 480, z1: -480,
      roof: '#8f3d2c', wall: '#cfa06e', trim: '#4a2c20', accent: '#f0c268',
      blurb: 'Terracotta roofs and lanes that predate the freeway.',
      height: [8, 26], density: 0.8,
    },
    {
      id: 'northgate', name: 'Northgate', short: 'NORTHGATE',
      x0: 480, z0: -1400, x1: 1400, z1: -480,
      roof: '#46586e', wall: '#8fa3bd', trim: '#232f45', accent: '#a8c8ee',
      blurb: 'Glass towers, the north gate, and the city\'s money.',
      height: [45, 150], density: 0.62,
    },
    {
      id: 'citrus', name: 'Citrus Lane', short: 'CITRUS LANE',
      x0: -1400, z0: -480, x1: -260, z1: 480,
      roof: '#c07a1e', wall: '#eec27e', trim: '#6b3f14', accent: '#ffe27a',
      blurb: 'Market awnings, neon, and orange trees in the planters.',
      height: [9, 30], density: 0.78,
    },
    {
      id: 'palmheights', name: 'Palm Heights', short: 'PALM HEIGHTS',
      x0: 480, z0: -480, x1: 1400, z1: 480,
      roof: '#96486b', wall: '#dca9c0', trim: '#3c2130', accent: '#ffc9de',
      blurb: 'Villas behind gates, gardens, and a view of the bay.',
      height: [12, 42], density: 0.55,
    },
    {
      id: 'boardwalk', name: 'Boardwalk', short: 'BOARDWALK',
      x0: -1400, z0: 480, x1: -260, z1: 1400,
      roof: '#c65a45', wall: '#f2c49b', trim: '#175e5a', accent: '#ffcf5c',
      blurb: 'Arcades, surf shops, and the wheel over the water.',
      height: [8, 28], density: 0.66,
    },
    {
      id: 'docks', name: 'The Docks', short: 'THE DOCKS',
      x0: -260, z0: 480, x1: 1400, z1: 1400,
      roof: '#5c5145', wall: '#9a8a72', trim: '#2e2820', accent: '#e0a83e',
      blurb: 'Cranes, stacked containers, and the night shift.',
      height: [10, 38], density: 0.6,
    },
  ],

  // ---- named landmarks -------------------------------------------------
  // Five hand-placed landmarks with our own names (see CFG.LANDMARKS):
  // the hotel, the lighthouse, the tallest tower, the market and the
  // container cranes. They give the skyline its named silhouettes.
  LANDMARKS: [
    { id: 'miramar', name: 'Hotel Miramar', kind: 'hotel', x: -1100, z: -900,
      blurb: 'The white slab over the Marina, lit floor by floor.' },
    { id: 'faro', name: 'Faro de Palma', kind: 'lighthouse', x: -1900, z: 1010,
      blurb: 'The old light at the end of the pier, still turning.' },
    { id: 'brisa', name: 'Torre Brisa', kind: 'tower', x: 900, z: -900,
      blurb: 'Northgate\'s tallest glass needle, seen from anywhere.' },
    { id: 'mercado', name: 'Mercado Citrus', kind: 'market', x: -700, z: 100,
      blurb: 'Stalls, awnings and oranges under the plane trees.' },
    { id: 'muelle', name: 'Muelle Viejo', kind: 'cranes', x: 500, z: 1000,
      blurb: 'The dock cranes, working the night shift.' },
  ],

  // ---- time of day -----------------------------------------------------
  // Four grades. Night is dark blue with stars, a moon and lit windows —
  // never near-black: the player must always read the street.
  GRADES: {
    morning: {
      label: 'Morning', skyTop: '#3f7fd0', skyHorizon: '#cfe4f2', skyMid: '#79aede',
      sunColor: '#fff1cf', sunIntensity: 2.4, sunElevation: 32, sunAzimuth: 95,
      hemiSky: '#bcd6ea', hemiGround: '#6b7a5e', hemiIntensity: 0.75,
      fogColor: '#c3d8e6', fogNear: 400, fogFar: 2500,
      stars: 0, windowGlow: 0.12, neonGlow: 0.25, cloudTint: '#ffffff',
      exposure: 1.10,
    },
    noon: {
      label: 'Midday', skyTop: '#2f6fd0', skyHorizon: '#a8d0ea', skyMid: '#6ea7dc',
      sunColor: '#fff8e2', sunIntensity: 3.0, sunElevation: 74, sunAzimuth: 180,
      hemiSky: '#cfe4f2', hemiGround: '#7a8a6a', hemiIntensity: 0.9,
      fogColor: '#b8d2e4', fogNear: 400, fogFar: 2500,
      stars: 0, windowGlow: 0.05, neonGlow: 0.15, cloudTint: '#ffffff',
      exposure: 1.05,
    },
    afternoon: {
      label: 'Afternoon', skyTop: '#35608f', skyHorizon: '#f2c98a', skyMid: '#d99a5e',
      sunColor: '#ffc978', sunIntensity: 2.2, sunElevation: 24, sunAzimuth: 265,
      hemiSky: '#d8c49a', hemiGround: '#5e5a4a', hemiIntensity: 0.6,
      fogColor: '#d8bd8e', fogNear: 400, fogFar: 2500,
      stars: 0, windowGlow: 0.25, neonGlow: 0.5, cloudTint: '#ffe8c8',
      exposure: 1.15,
    },
    night: {
      label: 'Night', skyTop: '#0a1230', skyHorizon: '#1d2f55', skyMid: '#1a2c50',
      sunColor: '#8fa8d8', sunIntensity: 0.55, sunElevation: 38, sunAzimuth: 300,
      hemiSky: '#22345e', hemiGround: '#11141c', hemiIntensity: 0.4,
      fogColor: '#16233f', fogNear: 250, fogFar: 1800,
      stars: 1, windowGlow: 1.0, neonGlow: 1.0, cloudTint: '#5a6a8a',
      exposure: 0.90,
    },
  },

  // ---- day/night clock --------------------------------------------------
  DAY_LENGTH_S: 480,        // one full day cycle in seconds of play
  DAY_START_HOUR: 9.5,      // the game opens mid-morning

  // ---- perf (r8 B6 — smoothness) ---------------------------------------
  // Shadow box + dynamic DPR. Shadow: was a 2048 map over the whole
  // ±1600 m city (1.56 m/texel, every caster re-rendered every
  // frame); now a 1024 map over a ±160 m box that follows the player
  // (0.31 m/texel, near casters only). DPR: step down the ladder
  // while frames stay slow, step back up when they recover.
  PERF: {
    SHADOW_HALF: 160,          // shadow camera half-extent (m) — ~320 m box
    SHADOW_MAP_SIZE: 1024,     // was 2048 over ±1600 m
    SHADOW_FOLLOW_DIST: 1200,  // sun light rides this far out along the sun ray
    SHADOW_SNAP: 8,            // snap the follow focus to this grid (m) — no shimmer
    SHADOW_DEFAULT_FOCUS: { x: -900, z: -591 }, // player spawn (title screen)
    SHADOW_NORMAL_BIAS: 0.03, // r9 A4: kills acne on rounded geometry; shadow.radius is ignored under PCFSoft in r160 — do NOT use it, do NOT switch to VSM
    DPR_LEVELS: [2, 1.5, 1.25], // r9 A2: floor is 1.25, never 1 — DPR 1 at 1280x720 is visibly pixelated
    DPR_MIN: 1.25,              // live-play floor (governor never steps below this)
    DPR_SHOT: 2,               // setupShotMode / official screenshots force this
    // A1 anisotropy: main3d.js overwrites this at boot with
    // renderer.capabilities.getMaxAnisotropy() (typically 8-16)
    // BEFORE buildWorld runs, so world3d.js / trafficlights3d.js can
    // read it as CFG3D.PERF.maxAnisotropy instead of hardcoding 4.
    // Default 4 is the pre-r9 behaviour, for Node/test contexts with
    // no renderer. sky3d.js textures read the same value.
    maxAnisotropy: 4,
    // C1 env-map defaults (r9): per-material envMapIntensity base
    // values, applied by sky3d.js (first setTimeOfDay call traverses
    // the scene; the night dimming pass re-uses the stored base).
    // Rule: metalness >= 0.3 (car paint, glass, chrome) -> 1.0,
    // everything else (buildings, ground, trim) -> 0.3, so the env
    // map never washes the city to pastel. vehicles3d.js should set
    // envMapIntensity 1.0 explicitly on paint()/glass() materials.
    ENV_INTENSITY_PAINT: 1.0,  // car paint / glass / chrome base
    ENV_INTENSITY_WORLD: 0.3,  // buildings / ground / trim base
    ENV_NIGHT_DIM: 0.45,       // env intensity scaled by (1 - 0.45 * nightness)
    DPR_DROP_MS: 20,           // step down if EMA frame time exceeds this…
    DPR_DROP_HOLD_S: 2,        // …sustained this long
    DPR_RECOVER_MS: 13,        // step back up if EMA frame time is under this…
    DPR_RECOVER_HOLD_S: 4,     // …sustained this long
    dynamicDpr: true,          // false pins DPR (coordinator/main-side wiring)
  },
};

// District lookup: returns the district record for a world (x, z), or null
// when the point is outside the city grid (beach, ocean, freeway verge).
export function districtAt(x, z) {
  for (const d of CFG3D.DISTRICTS) {
    if (x >= d.x0 && x < d.x1 && z >= d.z0 && z < d.z1) return d;
  }
  return null;
}

// Grade lookup by clock hour (0..24). Dawn and dusk borrow the nearest
// grade so the cycle never snaps: morning 06–11, noon 11–16, afternoon
// 16–19, night otherwise.
export function gradeForHour(hour) {
  const h = ((hour % 24) + 24) % 24;
  if (h >= 6 && h < 11) return CFG3D.GRADES.morning;
  if (h >= 11 && h < 16) return CFG3D.GRADES.noon;
  if (h >= 16 && h < 19) return CFG3D.GRADES.afternoon;
  return CFG3D.GRADES.night;
}

// Blend factor 0..1 between two grades, for smooth dawn/dusk transitions.
// Callers lerp colours by this; the grade keys below are the two to mix.
export function gradeBlend(hour) {
  const h = ((hour % 24) + 24) % 24;
  const edges = [
    [5, 6, 'night', 'morning'],
    [10.5, 11, 'morning', 'noon'],
    [15.5, 16, 'noon', 'afternoon'],
    [18.5, 19, 'afternoon', 'night'],
  ];
  for (const [a, b, from, to] of edges) {
    if (h >= a && h < b) return { from: CFG3D.GRADES[from], to: CFG3D.GRADES[to], t: (h - a) / (b - a) };
  }
  return { from: gradeForHour(h), to: gradeForHour(h), t: 0 };
}

// Dynamic-DPR governor (r8 B6). Pure logic, no DOM/renderer: feed it
// each frame's dt (ms) and it returns the new pixel ratio when a step
// is due, else null. Steps down CFG3D.PERF.DPR_LEVELS while the EMA
// frame time stays slow, steps back up when it stays fast. The
// renderer itself is applied by the caller (sky3d.updateSky applies
// it through the renderer main3d exposes; a main-side wiring can call
// this directly instead — either way, setPixelRatio only on change).
export function createDprGovernor(startRatio) {
  const levels = CFG3D.PERF.DPR_LEVELS;
  let idx = levels.length - 1;
  for (let i = 0; i < levels.length; i++) {
    if (levels[i] <= (startRatio || 1) + 1e-6) { idx = i; break; }
  }
  let ema = 16;
  let slowS = 0;
  let fastS = 0;
  return {
    get ratio() { return levels[idx]; },
    update(dtMs) {
      const dt = Math.min(Math.max(dtMs || 16, 1), 250);
      ema += (dt - ema) * 0.05;
      if (ema > CFG3D.PERF.DPR_DROP_MS) { slowS += dt / 1000; fastS = 0; }
      else if (ema < CFG3D.PERF.DPR_RECOVER_MS) { fastS += dt / 1000; slowS = 0; }
      else { slowS = 0; fastS = 0; }
      if (slowS >= CFG3D.PERF.DPR_DROP_HOLD_S && idx < levels.length - 1) {
        idx++; slowS = 0; fastS = 0; ema = 16;
        return levels[idx];
      }
      if (fastS >= CFG3D.PERF.DPR_RECOVER_HOLD_S && idx > 0) {
        idx--; slowS = 0; fastS = 0; ema = 16;
        return levels[idx];
      }
      return null;
    },
  };
}
