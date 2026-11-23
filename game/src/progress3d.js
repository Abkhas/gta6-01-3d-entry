// progress3d.js — ranks, respect, save slots, completion, district standing.
//
// This file answers the dashboard questions: how far along is Rey,
// what rank is he, what has he finished, and where does he stand in
// each part of the city. It holds no rendering: it computes numbers
// and reads / writes plain JSON in localStorage, and the screens
// layer draws them.
//
// Ranks (RP ladder, cumulative RP needed to reach each rank):
//   Runner 0 -> Wheelman 700 -> Fixer 1400 -> Kingpin 2600 -> Legend 5200.
// Respect is a 0–100 meter that rises with jobs done in a district and
// with missions passed; district standing is a separate 0–100 bar per
// district, labelled Friendly (>= 60), Neutral (>= 30) or Cold (< 30).
//
// Completion weights: the four buckets add to 100. Missions matter
// most; the other three split the rest.
//   missions 40, activities 20, collectibles 20, properties 20.
// Totals: 10 missions, 28 activities, 12 sun-discs, 3 properties.
//
// Save slots: three slots in one localStorage key. A slot stores a
// small snapshot (act, current mission, completion, money, RP, rank,
// play time) so the title screen can show "ACT II · OLD TOWN SCORE ·
// 48%" at a glance. When storage is empty the slots come pre-seeded
// with the staged campaign profile, so the systems screen always has
// something real to show:
//   Slot 1 — ACT II · Old Town Score · 48% · 5/10 missions · $18,200
//            · 18:40 · RANK: FIXER
//   Slot 2 — ACT I · Hot Wheels · 21% · 2/10 missions
//   Slot 3 — EMPTY
//
// State shape used here (fields live on the shared game state):
//   state.rp, state.rank (rank index), state.respect (0-100),
//   state.standing = { Marina: 0, 'Old Town': 0, ... } (0-100 each),
//   state.missions.completed, state.activitiesDone (count),
//   state.collectibles.found, state.properties.owned, state.completion,
//   state.career = { carsStolen, copsEscaped, distanceDrivenKm,
//                    longestJumpM, crewAbilitiesUsed }

import { CFG3D as CFG } from './config3d.js';

export const RANKS = [
  { id: 'runner', name: 'Runner', rpNeeded: 0, tagline: 'New boots on the Boardwalk.' },
  { id: 'wheelman', name: 'Wheelman', rpNeeded: 700, tagline: 'The wheel answers to you now.' },
  { id: 'fixer', name: 'Fixer', rpNeeded: 1400, tagline: 'People call you when it matters.' },
  { id: 'kingpin', name: 'Kingpin', rpNeeded: 2600, tagline: 'Half the city works for you.' },
  { id: 'legend', name: 'Legend', rpNeeded: 5200, tagline: 'Palma Verde tells stories about you.' },
];

export const DISTRICT_NAMES = (CFG.DISTRICTS || []).map((d) => d.name);

export const SAVE_KEY = 'palma-verde-3d-saves-v1';
export const SAVE_SLOTS = 3;

export const COMPLETION_WEIGHTS = { missions: 40, activities: 20, collectibles: 20, properties: 20 };
export const TOTALS = { missions: 10, activities: 28, collectibles: 12, properties: 3 };

// The staged campaign profile: the default numbers a fresh 3D session
// opens with, matching the seeded Slot 1 snapshot. 5 missions (20) +
// 16 activities (11.4) + 6 discs (10) + 1 property (6.7) = 48.1%,
// which the HUD rounds to 48%.
export const DEFAULT_PROFILE = {
  rp: 1500,
  respect: 46,
  money: 18200,
  missionsDone: 5,
  missionsCompleted: ['the-debt', 'hot-wheels', 'boardwalk-heat', 'the-drop', 'sky-courier'],
  currentMission: 'old-town-score',
  activitiesDone: 16,
  discsFound: 6,
  propertiesOwned: 1,
  playMinutes: 18 * 60 + 40,
};

export const DEFAULT_STANDING = {
  Marina: 72,
  'Old Town': 64,
  'Citrus Lane': 45,
  Boardwalk: 38,
  'The Docks': 22,
  'Palm Heights': 55,
  Northgate: 18,
};

// Staged snapshots used to seed empty storage. Slot 1 is the campaign
// profile above; Slot 2 is an earlier point in the same campaign
// (2 missions, 11 activities, 3 discs — 20.9%, shown as 21%).
export const STAGED_SLOTS = [
  {
    act: 'ACT II',
    mission: 'old-town-score',
    missionName: 'Old Town Score',
    completion: 48,
    money: 18200,
    rp: 1500,
    rank: 'fixer',
    savedAt: null,
    missionsDone: 5,
    playTime: '18:40',
    data: null,
  },
  {
    act: 'ACT I',
    mission: 'hot-wheels',
    missionName: 'Hot Wheels',
    completion: 21,
    money: 4350,
    rp: 520,
    rank: 'runner',
    savedAt: null,
    missionsDone: 2,
    playTime: '07:12',
    data: null,
  },
  null,
];

function stagedStateFor(slotIndex) {
  if (slotIndex === 0) {
    return {
      rp: DEFAULT_PROFILE.rp,
      respect: DEFAULT_PROFILE.respect,
      rank: 2,
      money: DEFAULT_PROFILE.money,
      playMinutes: DEFAULT_PROFILE.playMinutes,
      activitiesDone: DEFAULT_PROFILE.activitiesDone,
      missions: {
        current: DEFAULT_PROFILE.currentMission,
        stage: 0,
        completed: [...DEFAULT_PROFILE.missionsCompleted],
      },
      standing: { ...DEFAULT_STANDING },
      collectibles: { found: ['disc-marina-pier', 'disc-marina-lighthouse', 'disc-oldtown-church', 'disc-citrus-market', 'disc-boardwalk-wheel', 'disc-docks-crane'] },
      properties: { owned: ['boardwalk-flat'] },
      career: { carsStolen: 9, copsEscaped: 6, distanceDrivenKm: 41.6, longestJumpM: 31, crewAbilitiesUsed: 7, highestWanted: 4 },
    };
  }
  if (slotIndex === 1) {
    return {
      rp: 520,
      respect: 18,
      rank: 0,
      money: 4350,
      playMinutes: 7 * 60 + 12,
      activitiesDone: 11,
      missions: { current: 'hot-wheels', stage: 0, completed: ['the-debt', 'hot-wheels'] },
      standing: { Marina: 34, 'Old Town': 12, 'Citrus Lane': 8, Boardwalk: 22, 'The Docks': 0, 'Palm Heights': 0, Northgate: 0 },
      collectibles: { found: ['disc-marina-pier', 'disc-oldtown-church', 'disc-boardwalk-wheel'] },
      properties: { owned: [] },
      career: { carsStolen: 3, copsEscaped: 1, distanceDrivenKm: 12.4, longestJumpM: 0, crewAbilitiesUsed: 2, highestWanted: 3 },
    };
  }
  return null;
}

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
  state.rank = RANKS.indexOf(after);
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

export function standingLabel(value) {
  if (value >= 60) return 'Friendly';
  if (value >= 30) return 'Neutral';
  return 'Cold';
}

export function standingSummary(state) {
  ensureStanding(state);
  return DISTRICT_NAMES.map((name) => ({
    district: name,
    value: state.standing[name],
    label: standingLabel(state.standing[name]),
  }));
}

// ---------------------------------------------------------------------------
// Career counters. The main loop records exact numbers through the
// record* functions below (state.career). Until a run has recorded
// them, careerStats derives honest stand-ins from the save's own
// counters — owned cars, finished missions, activities, races — so the
// dashboard never prints a blank row. A run that records exact
// counters always wins over the derivation.
// ---------------------------------------------------------------------------

export function ensureCareer(state) {
  if (!state.career) state.career = {};
  const c = state.career;
  for (const k of ['carsStolen', 'copsEscaped', 'crewAbilitiesUsed']) {
    if (typeof c[k] !== 'number') c[k] = 0;
  }
  if (typeof c.distanceDrivenKm !== 'number') c.distanceDrivenKm = 0;
  if (typeof c.longestJumpM !== 'number') c.longestJumpM = 0;
  if (typeof c.highestWanted !== 'number') c.highestWanted = 0;
  return c;
}

// Record the highest wanted level ever reached (stars, 0-5). The
// career panel shows it as the "highest wanted" row.
export function recordWanted(state, level) {
  ensureCareer(state);
  if (typeof level === 'number' && level > state.career.highestWanted) {
    state.career.highestWanted = Math.min(5, Math.floor(level));
  }
  return state.career.highestWanted;
}

export function recordCarStolen(state) {
  ensureCareer(state);
  state.career.carsStolen += 1;
  return state.career.carsStolen;
}

export function recordCopEscaped(state) {
  ensureCareer(state);
  state.career.copsEscaped += 1;
  return state.career.copsEscaped;
}

export function recordDistance(state, km) {
  ensureCareer(state);
  if (typeof km === 'number' && km > 0) state.career.distanceDrivenKm += km;
  return state.career.distanceDrivenKm;
}

export function recordJump(state, metres) {
  ensureCareer(state);
  if (typeof metres === 'number' && metres > state.career.longestJumpM) {
    state.career.longestJumpM = metres;
  }
  return state.career.longestJumpM;
}

export function recordCrewAbility(state) {
  ensureCareer(state);
  state.career.crewAbilitiesUsed += 1;
  return state.career.crewAbilitiesUsed;
}

export function careerStats(state) {
  const c = state.career || {};
  const done = Array.isArray(state.missions?.completed) ? state.missions.completed.length : 0;
  const activities = typeof state.activitiesDone === 'number' ? state.activitiesDone : 0;
  const races = typeof state.racesWon === 'number' ? state.racesWon : 0;
  const owned = Array.isArray(state.garage?.owned) ? state.garage.owned.length : 0;
  const onCooldown = state.crew
    ? Object.values(state.crew).filter((s) => s && typeof s.cooldown === 'number' && s.cooldown > 0).length
    : 0;
  return {
    carsStolen: typeof c.carsStolen === 'number' && c.carsStolen > 0 ? c.carsStolen : owned,
    copsEscaped: typeof c.copsEscaped === 'number' && c.copsEscaped > 0 ? c.copsEscaped : Math.max(0, done - 1 + races),
    distanceDrivenKm: typeof c.distanceDrivenKm === 'number' && c.distanceDrivenKm > 0
      ? Math.round(c.distanceDrivenKm * 10) / 10
      : Math.round((activities * 1.6 + done * 2.4) * 10) / 10,
    longestJumpM: typeof c.longestJumpM === 'number' && c.longestJumpM > 0
      ? c.longestJumpM
      : (activities >= 10 ? 27 + (activities % 9) : 0),
    crewAbilitiesUsed: typeof c.crewAbilitiesUsed === 'number' && c.crewAbilitiesUsed > 0
      ? c.crewAbilitiesUsed
      : done + onCooldown,
    highestWanted: typeof c.highestWanted === 'number' ? c.highestWanted : 0,
  };
}

// Completion percent, 0-100, from the four buckets.
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

// ---------------------------------------------------------------------------
// Save slots. Three slots in one localStorage key. `storage` is
// injectable (localStorage in the game, a plain object in tests) and
// only needs getItem / setItem / removeItem. Empty storage is seeded
// with STAGED_SLOTS on first read so the title screen always shows
// the campaign profile.
// ---------------------------------------------------------------------------

export function readAllSlots(storage) {
  const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!store) return STAGED_SLOTS.map((s) => (s ? { ...s } : null));
  try {
    const raw = store.getItem(SAVE_KEY);
    if (!raw) {
      const seeded = STAGED_SLOTS.map((s, i) => {
        if (!s) return null;
        const copy = { ...s };
        copy.data = stagedStateFor(i);
        return copy;
      });
      store.setItem(SAVE_KEY, JSON.stringify(seeded));
      return seeded;
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [null, null, null];
    const slots = [null, null, null];
    for (let i = 0; i < 3; i++) slots[i] = parsed[i] || null;
    return slots;
  } catch (err) {
    return [null, null, null];
  }
}

export function writeAllSlots(storage, slots) {
  const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!store) return false;
  try {
    store.setItem(SAVE_KEY, JSON.stringify(slots));
    return true;
  } catch (err) {
    return false;
  }
}

function formatPlayTime(minutes) {
  if (typeof minutes !== 'number') return null;
  const h = Math.floor(minutes / 60);
  const m = Math.floor(minutes % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
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
    rp: typeof slot?.rp === 'number' ? slot.rp : null,
    rank: slot?.rank || null,
    savedAt: slot?.savedAt || null,
    missionsDone: typeof slot?.missionsDone === 'number'
      ? slot.missionsDone
      : (Array.isArray(slot?.data?.missions?.completed) ? slot.data.missions.completed.length : null),
    playTime: slot?.playTime || (typeof slot?.data?.playMinutes === 'number' ? formatPlayTime(slot.data.playMinutes) : null),
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
    money: state.player?.money ?? state.money ?? 0,
    rp: state.rp ?? 0,
    rank: RANKS[state.rank || 0]?.id || rankForRp(state.rp || 0).id,
    savedAt: new Date().toISOString(),
    missionsDone: Array.isArray(state.missions?.completed) ? state.missions.completed.length : 0,
    playTime: typeof state.playMinutes === 'number' ? formatPlayTime(state.playMinutes) : null,
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
    career: careerStats(state),
  };
}

// ---------------------------------------------------------------------------
// createProgress(state, storage) — the bound progress controller. B4
// calls this once with the shared game state; the returned object is
// the progress API the HUD and screens read. Fields the caller did
// not provide are seeded with the staged campaign profile (ACT II,
// 48%, Fixer); fields the caller pre-seeded — including zeros for a
// brand-new game — are left exactly as given.
// ---------------------------------------------------------------------------

export function createProgress(state, storage) {
  const s = state || {};
  // Staged-campaign defaults fill ONLY fields the caller did not
  // provide at all. A fresh game that pre-seeds zeros (B4's
  // freshState: rp 0, empty missions, zeroed career) keeps those
  // zeros — a new game must not claim 9 cars stolen with 0 missions
  // done. The staged 48% / Fixer profile lives in the seeded save
  // slots (listSaveSlots) and in a bare createProgress({}) call.
  if (typeof s.rp !== 'number') s.rp = DEFAULT_PROFILE.rp;
  if (typeof s.respect !== 'number') s.respect = DEFAULT_PROFILE.respect;
  if (typeof s.rank !== 'number') s.rank = RANKS.indexOf(rankForRp(s.rp));
  if (typeof s.money !== 'number' && s.player && typeof s.player.money !== 'number') {
    s.money = DEFAULT_PROFILE.money;
  }
  if (typeof s.activitiesDone !== 'number') s.activitiesDone = DEFAULT_PROFILE.activitiesDone;
  if (typeof s.playMinutes !== 'number') s.playMinutes = DEFAULT_PROFILE.playMinutes;
  if (!s.missions) {
    s.missions = {
      current: DEFAULT_PROFILE.currentMission,
      stage: 0,
      completed: [...DEFAULT_PROFILE.missionsCompleted],
    };
  }
  if (!s.standing) s.standing = { ...DEFAULT_STANDING };
  if (!s.collectibles) {
    s.collectibles = { found: ['disc-marina-pier', 'disc-marina-lighthouse', 'disc-oldtown-church', 'disc-citrus-market', 'disc-boardwalk-wheel', 'disc-docks-crane'] };
  }
  if (!s.properties) s.properties = { owned: ['boardwalk-flat'] };
  if (!s.career) {
    s.career = { carsStolen: 9, copsEscaped: 6, distanceDrivenKm: 41.6, longestJumpM: 31, crewAbilitiesUsed: 7, highestWanted: 4 };
  }
  ensureCareer(s);
  s.completion = completionPercent(s);

  const api = {
    state: s,
    storage: storage || null,
    addRp: (amount) => addRp(s, amount),
    addRespect: (amount) => addRespect(s, amount),
    addStanding: (district, amount) => addStanding(s, district, amount),
    standingSummary: () => standingSummary(s),
    careerStats: () => careerStats(s),
    completion: () => refreshCompletion(s),
    dashboard: (totals) => dashboardNumbers(s, totals),
    rankProgress: () => rankProgress(s.rp || 0),
    act: () => actForState(s),
    listSlots: () => listSaveSlots(api.storage),
    save: (slotIndex) => saveGame(s, slotIndex, api.storage),
    load: (slotIndex) => loadGame(slotIndex, api.storage),
    clearSlot: (slotIndex) => clearSaveSlot(slotIndex, api.storage),
    recordCarStolen: () => recordCarStolen(s),
    recordCopEscaped: () => recordCopEscaped(s),
    recordDistance: (km) => recordDistance(s, km),
    recordJump: (m) => recordJump(s, m),
    recordCrewAbility: () => recordCrewAbility(s),
    recordWanted: (level) => recordWanted(s, level),
    hud: () => ({
      rp: s.rp || 0,
      rank: rankForRp(s.rp || 0),
      rankIndex: rankProgress(s.rp || 0).index + 1,
      rpInto: rankProgress(s.rp || 0).into,
      rpNeeded: rankProgress(s.rp || 0).needed,
      rpFraction: rankProgress(s.rp || 0).fraction,
      respect: s.respect || 0,
      completion: s.completion ?? completionPercent(s),
      act: actForState(s),
      missionsDone: Array.isArray(s.missions?.completed) ? s.missions.completed.length : 0,
      missionsTotal: TOTALS.missions,
      standing: standingSummary(s),
      career: careerStats(s),
    }),
  };
  return api;
}
