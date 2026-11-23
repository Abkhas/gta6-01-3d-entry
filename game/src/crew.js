// crew.js — the three specialists Rey can call on mid-job.
//
// Each specialist is one row in the crew panel: a name, a face the HUD
// draws from the `portrait` tag, one ability with a plain-English effect,
// a cooldown in seconds, and an RP price for the call. Effects are kept
// small on purpose: they reuse things the game already does (lower the
// wanted level, repair the car, show police on the minimap) instead of
// inventing new systems.
//
// State shape used here (fields live on the shared state object):
//   state.crew = {
//     tuck: { cooldown: 0, activeUntil: 0 },
//     ines: { cooldown: 0, activeUntil: 0 },
//     kip:  { cooldown: 0, activeUntil: 0, revealing: false },
//   }
// Cooldowns count down in seconds through tickCrew(state, dtSeconds).
// `nowMs` is a millisecond clock supplied by the caller (Date.now() in
// the game, a fake clock in tests) so nothing here reads the real clock
// behind the caller's back. No canvas, no DOM in this file.

const CREW = [
  {
    id: 'tuck',
    name: 'Tuck Ibarra',
    role: 'Driver',
    portrait: 'tuck',
    ability: 'Swap Plates',
    blurb: 'Tuck swaps the plates mid-chase and the cruisers lose the scent.',
    effect: 'Drop 1 wanted star',
    cooldownSeconds: 90,
    rpCost: 25,
    durationSeconds: 0,
  },
  {
    id: 'ines',
    name: 'Ines Duarte',
    role: 'Mechanic',
    portrait: 'ines',
    ability: 'Quick Fix',
    blurb: 'Ines talks Rey through a roadside patch over the radio.',
    effect: 'Repair current vehicle to full',
    cooldownSeconds: 120,
    rpCost: 25,
    durationSeconds: 0,
  },
  {
    id: 'kip',
    name: 'Kip Ansel',
    role: 'Lookout',
    portrait: 'kip',
    ability: 'Eyes Out',
    blurb: 'Kip watches the scanners and calls every unit he hears.',
    effect: 'Reveal police on the minimap for 30s',
    cooldownSeconds: 60,
    rpCost: 15,
    durationSeconds: 30,
  },
];

function crewById(id) {
  return CREW.find((c) => c.id === id) || null;
}

function freshCrew() {
  const out = {};
  for (const member of CREW) {
    out[member.id] = { cooldown: 0, activeUntil: 0, revealing: false };
  }
  return out;
}

function ensureCrew(state) {
  if (!state.crew) state.crew = freshCrew();
  for (const member of CREW) {
    if (!state.crew[member.id]) state.crew[member.id] = { cooldown: 0, activeUntil: 0, revealing: false };
    if (typeof state.crew[member.id].cooldown !== 'number') state.crew[member.id].cooldown = 0;
  }
  return state.crew;
}

// Count every cooldown down by dtSeconds. Call once per frame (or once
// per tick) from the main loop; never call it from inside useAbility.
function tickCrew(state, dtSeconds, nowMs) {
  ensureCrew(state);
  const now = typeof nowMs === 'number' ? nowMs : Date.now();
  for (const member of CREW) {
    const slot = state.crew[member.id];
    if (slot.cooldown > 0) slot.cooldown = Math.max(0, slot.cooldown - dtSeconds);
    if (member.id === 'kip' && slot.revealing && slot.activeUntil > 0 && now >= slot.activeUntil) {
      slot.revealing = false;
      slot.activeUntil = 0;
    }
  }
  return state.crew;
}

function crewReady(state, id) {
  ensureCrew(state);
  const member = crewById(id);
  if (!member) return { ready: false, reason: 'no-such-crew' };
  if (state.crew[id].cooldown > 0) {
    return { ready: false, reason: 'cooling-down', remaining: Math.ceil(state.crew[id].cooldown) };
  }
  if (typeof state.rp === 'number' && state.rp < member.rpCost) {
    return { ready: false, reason: 'not-enough-rp', need: member.rpCost };
  }
  return { ready: true };
}

function crewStatus(state, nowMs) {
  ensureCrew(state);
  const now = typeof nowMs === 'number' ? nowMs : Date.now();
  return CREW.map((member) => {
    const slot = state.crew[member.id];
    const activeLeft = member.durationSeconds > 0 && slot.activeUntil > now
      ? Math.ceil((slot.activeUntil - now) / 1000)
      : 0;
    return {
      id: member.id,
      name: member.name,
      role: member.role,
      ability: member.ability,
      effect: member.effect,
      cooldownSeconds: member.cooldownSeconds,
      rpCost: member.rpCost,
      cooldownLeft: Math.ceil(slot.cooldown),
      ready: slot.cooldown <= 0,
      activeLeft,
      revealing: !!slot.revealing,
    };
  });
}

// Fire an ability. Returns { ok, applied } on success, or { ok:false }
// with a reason the HUD can show ("cooling-down", "not-enough-rp",
// "nothing-to-fix", "not-in-a-car"). The RP price is charged only when
// the ability actually applies.
function useAbility(state, id, nowMs) {
  ensureCrew(state);
  const member = crewById(id);
  if (!member) return { ok: false, reason: 'no-such-crew' };
  const check = crewReady(state, id);
  if (!check.ready) return { ok: false, reason: check.reason, remaining: check.remaining, need: check.need };

  const now = typeof nowMs === 'number' ? nowMs : Date.now();
  let applied = null;

  if (id === 'tuck') {
    const before = typeof state.wanted === 'number' ? state.wanted : 0;
    if (before <= 0) return { ok: false, reason: 'no-heat-to-lose' };
    state.wanted = before - 1;
    applied = { wanted: state.wanted, dropped: 1 };
  } else if (id === 'ines') {
    const vehicle = state.player?.vehicle;
    if (!vehicle) return { ok: false, reason: 'not-in-a-car' };
    const before = typeof vehicle.condition === 'number' ? vehicle.condition : 100;
    if (before >= 100) return { ok: false, reason: 'nothing-to-fix' };
    vehicle.condition = 100;
    if (typeof vehicle.health === 'number') vehicle.health = 100;
    applied = { condition: 100, repaired: 100 - before };
  } else if (id === 'kip') {
    state.crew.kip.revealing = true;
    state.crew.kip.activeUntil = now + member.durationSeconds * 1000;
    applied = { revealing: true, seconds: member.durationSeconds };
  }

  if (typeof state.rp === 'number') state.rp -= member.rpCost;
  state.crew[id].cooldown = member.cooldownSeconds;
  return { ok: true, applied, ability: member.ability, name: member.name, cooldown: member.cooldownSeconds };
}

function policeRevealed(state, nowMs) {
  ensureCrew(state);
  const now = typeof nowMs === 'number' ? nowMs : Date.now();
  return !!state.crew.kip.revealing && state.crew.kip.activeUntil > now;
}

// Cooldown display data for the HUD rail and the screens crew cards:
// one row per specialist with the key, the seconds left, the fraction
// of the cooldown still to run (1 = just used, 0 = ready), and a
// ready-made label string. Pure data, no canvas.
const CREW_KEYS = { tuck: 'Z', ines: 'X', kip: 'V' };

function cooldownDisplay(state, nowMs) {
  const rows = crewStatus(state, nowMs);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    role: r.role,
    ability: r.ability,
    effect: r.effect,
    key: CREW_KEYS[r.id] || '',
    cooldownLeft: r.cooldownLeft,
    cooldownTotal: r.cooldownSeconds,
    fraction: r.cooldownSeconds > 0 ? Math.max(0, Math.min(1, r.cooldownLeft / r.cooldownSeconds)) : 0,
    ready: r.ready,
    activeLeft: r.activeLeft,
    revealing: r.revealing,
    label: r.ready
      ? (r.activeLeft > 0 ? `ACTIVE ${r.activeLeft}s` : `READY [${CREW_KEYS[r.id] || ''}]`)
      : `COOLDOWN ${r.cooldownLeft}s`,
  }));
}

// Classic-script export: the browser loads this file with a plain
// <script> tag, so the public API is published on window.
window.PalmaCrew = {
  CREW: CREW, crewById: crewById, freshCrew: freshCrew,
  ensureCrew: ensureCrew, tickCrew: tickCrew, crewReady: crewReady,
  crewStatus: crewStatus, useAbility: useAbility,
  policeRevealed: policeRevealed, cooldownDisplay: cooldownDisplay,
};
