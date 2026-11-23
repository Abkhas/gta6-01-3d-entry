// progress.js — ranks, respect, save slots, completion, district standing.
//
// This file answers the dashboard questions: how far along is Rey, what
// rank is he, what has he finished, and where does he stand in each part
// of the city. It holds no rendering: it computes numbers and reads /
// writes plain JSON in localStorage, and the screens layer draws them.
//
// Ranks (RP ladder, cumulative RP needed to reach each rank):
//   Runner -> Wheelman -> Fixer -> Kingpin -> Legend.
// Respect is a 0-100 meter that rises with jobs done in a district and
// with missions passed; district standing is a separate 0-100 bar per
// district, so the player can see where they are liked and where they
// are still a stranger.
//
// State shape used here:
//   state.rp, state.rank (rank id string), state.respect (0-100),
//   state.standing = { Marina: 0, 'Old Town': 0, ... } (0-100 each),
//   state.missions.completed, state.activitiesDone (count),
//   state.collectibles.found, state.properties.owned, state.completion.

export const RANKS = [
  { id: 'runner', name: 'Runner', rpNeeded: 0, tagline: 'New boots on the Boardwalk.' },
  { id: 'wheelman', name: 'Wheelman', rpNeeded: 400, tagline: 'The wheel answers to you now.' },
  { id: 'fixer', name: 'Fixer', rpNeeded: 1200, tagline: 'People call you when it matters.' },
  { id: 'kingpin', name: 'Kingpin', rpNeeded: 2600, tagline: 'Half the city works for you.' },
  { id: 'legend', name: 'Legend', rpNeeded: 5200, tagline: 'Palma Verde tells stories about you.' },
];

export const DISTRICT_NAMES = [
  'Marina',
  'Old Town',
  'Citrus Lane',
  'Boardwalk',
  'The Docks',
  'Palm Heights',
  'Northgate',
];

export const SAVE_KEY = 'palma-verde-saves-v1';
export const SAVE_SLOTS = 3;

// Completion weights: the four buckets add to 100. Missions matter
// most; the other three split the rest evenly-ish.
export const COMPLETION_WEIGHTS = { missions: 40, activities: 20, collectibles: 20, properties: 20 };
export const TOTALS = { missions: 10, activities: 28, collectibles: 12, properties: 3 };

export function rankForRp(rp) {
  let current = RANKS[0];
  for (const rank of RANKS) {
    if (rp >= rank.rpNeeded) current = rank;
  }
  return current;
}

export function rankProgress(rp) {
  const current = rankForRp(rp);
  const index = RANKS.indexOf(current);
  const next = RANKS[index + 1] || null;
  if (!next) return { rank: current, index, next: null, into: rp - current.rpNeeded, needed: 0, fraction: 1 };
  const needed = next.rpNeeded - current.rpNeeded;
  const into = rp - current.rpNeeded;
  return { rank: current, index, next, into, needed, fraction: Math.min(1, into / needed) };
}

// Add RP and return the new rank state. If the player crossed into a
// new rank, `rankedUp` carries the new rank so the HUD can celebrate.
export function addRp(state, amount) {
  if (typeof state.rp !== 'number') state.rp = 0;
  const before = rankForRp(state.rp);
  state.rp += amount;
  const after = rankForRp(state.rp);
  state.rank = after.id;
  return {
    rp: state.rp,
    rank: after,
    rankedUp: after.id !== before.id ? after : null,
    progress: rankProgress(state.rp),
  };
}

export function addRespect(state, amount) {
  if (typeof state.respect !== 'number') state.respect = 0;
  state.respect = Math.max(0, Math.min(100, state.respect + amount));
  return state.respect;
}

export function freshStanding() {
  const out = {};
  for (const name of DISTRICT_NAMES) out[name] = 0;
  return out;
}

export function ensureStanding(state) {
  if (!state.standing) state.standing = freshStanding();
  for (const name of DISTRICT_NAMES) {
    if (typeof state.standing[name] !== 'number') state.standing[name] = 0;
  }
  return state.standing;
}

export function addStanding(state, district, amount) {
  ensureStanding(state);
  if (!(district in state.standing)) return null;
  state.standing[district] = Math.max(0, Math.min(100, state.standing[district] + amount));
  return state.standing[district];
}

export function standingSummary(state) {
  ensureStanding(state);
  return DISTRICT_NAMES.map((name) => ({ district: name, value: state.standing[name] }));
}

// Completion percent, 0-100, from the four buckets. `totals` lets a
// test (or a later rebalance) override the denominators; the defaults
// match the shipped game: 10 missions, 28 activities, 12 sun-discs,
// 3 properties.
export function completionPercent(state, totals) {
  const t = { ...TOTALS, ...(totals || {}) };
  const w = COMPLETION_WEIGHTS;
  const missionCount = Array.isArray(state.missions?.completed) ? state.missions.completed.length : 0;
  const activityCount = typeof state.activitiesDone === 'number' ? state.activitiesDone : 0;
  const discCount = Array.isArray(state.collectibles?.found) ? state.collectibles.found.length : 0;
  const propertyCount = Array.isArray(state.properties?.owned) ? state.properties.owned.length : 0;
  const missionPart = t.missions > 0 ? (missionCount / t.missions) * w.missions : 0;
  const activityPart = t.activities > 0 ? (Math.min(activityCount, t.activities) / t.activities) * w.activities : 0;
  const discPart = t.collectibles > 0 ? (discCount / t.collectibles) * w.collectibles : 0;
  const propertyPart = t.properties > 0 ? (propertyCount / t.properties) * w.properties : 0;
  const total = missionPart + activityPart + discPart + propertyPart;
  return Math.max(0, Math.min(100, Math.round(total * 10) / 10));
}

export function refreshCompletion(state, totals) {
  state.completion = completionPercent(state, totals);
  return state.completion;
}

// Act is derived from mission progress: Act I until mission 4 is done,
// Act II until mission 8 is done, Act III after that.
export function actForState(state) {
  const done = Array.isArray(state.missions?.completed) ? state.missions.completed.length : 0;
  if (done >= 8) return 'ACT III';
  if (done >= 4) return 'ACT II';
  return 'ACT I';
}

export function currentMissionName(state) {
  if (!state.missions?.current) return '—';
  return state.missions.current;
}

// ---------------------------------------------------------------------------
// Save slots. Three slots in one localStorage key. A slot stores a small
// snapshot (act, current mission, completion, money, rp, rank, time) so
// the title screen can show "ACT II · MISSION 6 · 48%" at a glance.
// `storage` is injectable (localStorage in the game, a plain object in
// tests) and only needs getItem / setItem / removeItem.
// ---------------------------------------------------------------------------

function readAllSlots(storage) {
  const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!store) return [null, null, null];
  try {
    const raw = store.getItem(SAVE_KEY);
    if (!raw) return [null, null, null];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [null, null, null];
    const slots = [null, null, null];
    for (let i = 0; i < 3; i++) slots[i] = parsed[i] || null;
    return slots;
  } catch (err) {
    return [null, null, null];
  }
}

function writeAllSlots(storage, slots) {
  const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!store) return false;
  try {
    store.setItem(SAVE_KEY, JSON.stringify(slots));
    return true;
  } catch (err) {
    return false;
  }
}

export function listSaveSlots(storage) {
  return readAllSlots(storage).map((slot, i) => ({
    slot: i + 1,
    empty: !slot,
    act: slot?.act || null,
    mission: slot?.mission || null,
    missionName: slot?.missionName || null,
    completion: typeof slot?.completion === 'number' ? slot.completion : null,
    money: typeof slot?.money === 'number' ? slot.money : null,
    rank: slot?.rank || null,
    savedAt: slot?.savedAt || null,
  }));
}

export function saveGame(state, slotIndex, storage) {
  if (slotIndex < 0 || slotIndex > 2) return { ok: false, reason: 'bad-slot' };
  const slots = readAllSlots(storage);
  const snapshot = {
    act: actForState(state),
    mission: state.missions?.current || null,
    missionName: state.missions?.current || null,
    completion: refreshCompletion(state),
    money: state.player?.money ?? 0,
    rp: state.rp ?? 0,
    rank: state.rank || rankForRp(state.rp || 0).id,
    savedAt: new Date().toISOString(),
    data: JSON.parse(JSON.stringify(state)),
  };
  slots[slotIndex] = snapshot;
  const ok = writeAllSlots(storage, slots);
  return { ok, slot: slotIndex + 1, snapshot: listSaveSlots(storage)[slotIndex] };
}

export function loadGame(slotIndex, storage) {
  if (slotIndex < 0 || slotIndex > 2) return { ok: false, reason: 'bad-slot' };
  const slots = readAllSlots(storage);
  const slot = slots[slotIndex];
  if (!slot || !slot.data) return { ok: false, reason: 'empty-slot' };
  return { ok: true, slot: slotIndex + 1, state: slot.data };
}

export function clearSaveSlot(slotIndex, storage) {
  if (slotIndex < 0 || slotIndex > 2) return { ok: false, reason: 'bad-slot' };
  const slots = readAllSlots(storage);
  slots[slotIndex] = null;
  return { ok: writeAllSlots(storage, slots), slot: slotIndex + 1 };
}

export function dashboardNumbers(state, totals) {
  const progress = rankProgress(state.rp || 0);
  return {
    missions: `${Array.isArray(state.missions?.completed) ? state.missions.completed.length : 0}/${TOTALS.missions}`,
    activities: `${Math.min(state.activitiesDone || 0, TOTALS.activities)}/${TOTALS.activities}`,
    vehicles: `${(state.garage?.owned || []).length}`,
    weapons: `${(state.weapons?.owned || []).length}`,
    districts: `${DISTRICT_NAMES.length}`,
    radio: '3',
    completion: refreshCompletion(state, totals),
    rank: progress.rank,
    rankIndex: progress.index + 1,
    rpInto: progress.into,
    rpNeeded: progress.needed,
    rpFraction: progress.fraction,
    respect: state.respect || 0,
    standing: standingSummary(state),
  };
}
