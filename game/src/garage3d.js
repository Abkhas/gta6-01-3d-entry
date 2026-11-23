// garage3d.js — garage upgrades, properties, sun-disc collectibles,
// and street races.
//
// Everything here is data plus small money-moving functions. The
// garage screen draws rows from UPGRADE_ROWS (ENGINE / ARMOR / PAINT /
// REPAIR, each with prices and a BUY action); properties pay a steady
// income tick; sun-discs are twelve hidden pickups scattered across
// the seven districts; street races are a fee in, a payout out.
//
// State shape used here:
//   state.player.money
//   state.player.vehicle = { model, condition, damage } (condition 0-100)
//   state.garage = { owned: [<car model>], upgrades: { <car>: { engine: n, armor: n, paint: '<name>' } } }
//   state.properties = { owned: [<property id>] }
//   state.collectibles = { found: [<disc id>] }
//   state.racesWon, state.activitiesDone (counters other systems read)
// No canvas, no DOM in this file.

export const UPGRADE_ROWS = [
  {
    row: 'ENGINE',
    blurb: 'More pull off the line, higher top speed.',
    levels: [
      { level: 1, name: 'Street Tuned', price: 800 },
      { level: 2, name: 'Race Tuned', price: 2200 },
      { level: 3, name: 'Track Spec', price: 5000 },
    ],
  },
  {
    row: 'ARMOR',
    blurb: 'Plating that shrugs off bumps, bullets, and bad parking.',
    levels: [
      { level: 1, name: 'Light Plating', price: 1000 },
      { level: 2, name: 'Heavy Plating', price: 2600 },
      { level: 3, name: 'Armored Shell', price: 6000 },
    ],
  },
  {
    row: 'PAINT',
    blurb: 'A fresh coat. The city notices a clean car.',
    levels: [
      { level: 1, name: 'Coral Red', price: 400 },
      { level: 2, name: 'Midnight Teal', price: 400 },
      { level: 3, name: 'Sunset Gold', price: 900 },
    ],
  },
  {
    row: 'REPAIR',
    blurb: 'Patch the dents and straighten the frame.',
    levels: [
      { level: 1, name: 'Patch Up', price: 250 },
      { level: 2, name: 'Full Service', price: 600 },
      { level: 3, name: 'Showroom Restore', price: 1200 },
    ],
  },
];

export const REPAIR_FULL_PRICE = 600;

export const GARAGE_CARS = [
  { model: 'Cometa GT', price: 0, note: 'Story car — earned, not bought.' },
  { model: 'Marina Runabout', price: 4500, note: 'Nimble, cheap, easy to park.' },
  { model: 'Citrus Coupe', price: 9000, note: 'Quick off the line, light on armor.' },
  { model: 'Docks Hauler', price: 12000, note: 'Slow, heavy, nearly unkillable.' },
  { model: 'Palm Cruiser', price: 18000, note: 'Long, low, and loud in the best way.' },
];

export const PROPERTIES = [
  {
    id: 'boardwalk-flat',
    name: 'Boardwalk Flat',
    district: 'Boardwalk',
    price: 8000,
    incomePerTick: 120,
    blurb: 'A small flat above the arcades. Rent rolls in while you sleep.',
  },
  {
    id: 'docks-warehouse',
    name: 'Docks Warehouse',
    district: 'The Docks',
    price: 20000,
    incomePerTick: 350,
    blurb: 'Warehouse 9, legit on paper. Crates in, cash out.',
  },
  {
    id: 'palm-villa',
    name: 'Palm Heights Villa',
    district: 'Palm Heights',
    price: 45000,
    incomePerTick: 800,
    blurb: 'A villa with a view and a garage that fits four cars.',
  },
];

export const SUN_DISCS = [
  { id: 'disc-marina-pier', district: 'Marina', place: 'Pier end' },
  { id: 'disc-marina-lighthouse', district: 'Marina', place: 'Lighthouse base' },
  { id: 'disc-oldtown-church', district: 'Old Town', place: 'Church square' },
  { id: 'disc-oldtown-alley', district: 'Old Town', place: 'Back alley mural' },
  { id: 'disc-citrus-market', district: 'Citrus Lane', place: 'Market roof' },
  { id: 'disc-citrus-cafe', district: 'Citrus Lane', place: 'Cafe awning' },
  { id: 'disc-boardwalk-wheel', district: 'Boardwalk', place: 'Ferris wheel base' },
  { id: 'disc-boardwalk-arcade', district: 'Boardwalk', place: 'Arcade roof' },
  { id: 'disc-docks-crane', district: 'The Docks', place: 'Crane platform' },
  { id: 'disc-docks-yard', district: 'The Docks', place: 'Boat yard office' },
  { id: 'disc-palm-villa', district: 'Palm Heights', place: 'Villa garden' },
  { id: 'disc-northgate-bridge', district: 'Northgate', place: 'Bridge north end' },
];

export const STREET_RACES = [
  {
    id: 'race-boardwalk',
    name: 'Boardwalk Sprint',
    district: 'Boardwalk',
    entryFee: 300,
    payout: 1200,
    laps: 2,
    blurb: 'Two laps down the beach road, sunset at your back.',
  },
  {
    id: 'race-docks',
    name: 'Docks Midnight Run',
    district: 'The Docks',
    entryFee: 600,
    payout: 2400,
    laps: 3,
    blurb: 'Three laps between the containers. Tight corners, no mercy.',
  },
  {
    id: 'race-northgate',
    name: 'Northgate Bridge Dash',
    district: 'Northgate',
    entryFee: 1000,
    payout: 4500,
    laps: 3,
    blurb: 'Over the bridge and back. The fastest cars in the city show up.',
  },
];

export function ensureGarage(state) {
  if (!state.garage) state.garage = { owned: [], upgrades: {} };
  if (!Array.isArray(state.garage.owned)) state.garage.owned = [];
  if (!state.garage.upgrades) state.garage.upgrades = {};
  if (!state.properties) state.properties = { owned: [] };
  if (!Array.isArray(state.properties.owned)) state.properties.owned = [];
  if (!state.collectibles) state.collectibles = { found: [] };
  if (!Array.isArray(state.collectibles.found)) state.collectibles.found = [];
  return state.garage;
}

function charge(state, amount) {
  const money = state.player?.money ?? state.money;
  if (typeof money !== 'number') return false;
  if (money < amount) return false;
  if (state.player && typeof state.player.money === 'number') state.player.money -= amount;
  else state.money -= amount;
  return true;
}

function moneyLeft(state) {
  return state.player?.money ?? state.money ?? 0;
}

function carUpgrades(state, model) {
  ensureGarage(state);
  if (!state.garage.upgrades[model]) state.garage.upgrades[model] = { engine: 0, armor: 0, paint: 'Factory' };
  return state.garage.upgrades[model];
}

function currentModel(state) {
  const v = state.player?.vehicle;
  if (!v) return 'Cometa GT';
  return v.model || v.name || 'Cometa GT';
}

// Buy one upgrade level for the player's current car. Levels must be
// bought in order; buying level 2 while level 1 is missing is refused.
// PAINT sets the colour name instead of raising a number.
export function buyUpgrade(state, row, level) {
  ensureGarage(state);
  const rowDef = UPGRADE_ROWS.find((r) => r.row === row);
  if (!rowDef) return { ok: false, reason: 'no-such-row' };
  const levelDef = rowDef.levels.find((l) => l.level === level);
  if (!levelDef) return { ok: false, reason: 'no-such-level' };
  const model = currentModel(state);
  const owned = carUpgrades(state, model);
  if (row === 'ENGINE' && owned.engine !== level - 1) return { ok: false, reason: 'buy-in-order' };
  if (row === 'ARMOR' && owned.armor !== level - 1) return { ok: false, reason: 'buy-in-order' };
  if (!charge(state, levelDef.price)) return { ok: false, reason: 'not-enough-money', price: levelDef.price };
  if (row === 'ENGINE') owned.engine = level;
  else if (row === 'ARMOR') owned.armor = level;
  else if (row === 'PAINT') owned.paint = levelDef.name;
  else if (row === 'REPAIR') {
    if (state.player?.vehicle) {
      state.player.vehicle.condition = 100;
      if (typeof state.player.vehicle.damage === 'number') state.player.vehicle.damage = 0;
    }
  }
  return { ok: true, row, level, name: levelDef.name, price: levelDef.price, moneyLeft: moneyLeft(state) };
}

export function repairVehicle(state, price) {
  ensureGarage(state);
  const vehicle = state.player?.vehicle;
  if (!vehicle) return { ok: false, reason: 'not-in-a-car' };
  const cost = typeof price === 'number' ? price : REPAIR_FULL_PRICE;
  const condition = typeof vehicle.condition === 'number'
    ? vehicle.condition
    : typeof vehicle.damage === 'number' ? 100 - vehicle.damage : 100;
  if (condition >= 100) return { ok: false, reason: 'nothing-to-fix' };
  if (!charge(state, cost)) return { ok: false, reason: 'not-enough-money', price: cost };
  if (typeof vehicle.condition === 'number') vehicle.condition = 100;
  if (typeof vehicle.damage === 'number') vehicle.damage = 0;
  return { ok: true, cost, moneyLeft: moneyLeft(state) };
}

export function buyCar(state, model) {
  ensureGarage(state);
  const car = GARAGE_CARS.find((c) => c.model === model);
  if (!car) return { ok: false, reason: 'no-such-car' };
  if (state.garage.owned.includes(model)) return { ok: false, reason: 'already-owned' };
  if (!charge(state, car.price)) return { ok: false, reason: 'not-enough-money', price: car.price };
  state.garage.owned.push(model);
  return { ok: true, model, price: car.price, moneyLeft: moneyLeft(state) };
}

export function garageRows(state) {
  ensureGarage(state);
  const model = currentModel(state);
  const owned = carUpgrades(state, model);
  return UPGRADE_ROWS.map((rowDef) => ({
    row: rowDef.row,
    blurb: rowDef.blurb,
    levels: rowDef.levels.map((l) => ({
      level: l.level,
      name: l.name,
      price: l.price,
      bought: rowDef.row === 'ENGINE' ? owned.engine >= l.level
        : rowDef.row === 'ARMOR' ? owned.armor >= l.level
        : rowDef.row === 'PAINT' ? owned.paint === l.name
        : false,
    })),
  }));
}

export function buyProperty(state, id) {
  ensureGarage(state);
  const prop = PROPERTIES.find((p) => p.id === id);
  if (!prop) return { ok: false, reason: 'no-such-property' };
  if (state.properties.owned.includes(id)) return { ok: false, reason: 'already-owned' };
  if (!charge(state, prop.price)) return { ok: false, reason: 'not-enough-money', price: prop.price };
  state.properties.owned.push(id);
  return { ok: true, id, name: prop.name, price: prop.price, moneyLeft: moneyLeft(state) };
}

// One income tick (called on the game's slow timer). Each owned
// property pays its per-tick income into the player's money.
export function collectPropertyIncome(state) {
  ensureGarage(state);
  let total = 0;
  for (const id of state.properties.owned) {
    const prop = PROPERTIES.find((p) => p.id === id);
    if (prop) total += prop.incomePerTick;
  }
  if (total > 0) {
    if (state.player && typeof state.player.money === 'number') state.player.money += total;
    else if (typeof state.money === 'number') state.money += total;
  }
  return { paid: total, money: moneyLeft(state) };
}

export function propertySummary(state) {
  ensureGarage(state);
  return PROPERTIES.map((p) => ({
    id: p.id,
    name: p.name,
    district: p.district,
    price: p.price,
    incomePerTick: p.incomePerTick,
    blurb: p.blurb,
    owned: state.properties.owned.includes(p.id),
  }));
}

export function collectSunDisc(state, id) {
  ensureGarage(state);
  const disc = SUN_DISCS.find((d) => d.id === id);
  if (!disc) return { ok: false, reason: 'no-such-disc' };
  if (state.collectibles.found.includes(id)) return { ok: false, reason: 'already-found' };
  state.collectibles.found.push(id);
  if (typeof state.activitiesDone === 'number') state.activitiesDone += 1;
  return {
    ok: true,
    id,
    place: disc.place,
    found: state.collectibles.found.length,
    total: SUN_DISCS.length,
  };
}

export function sunDiscSummary(state) {
  ensureGarage(state);
  return SUN_DISCS.map((d) => ({
    id: d.id,
    district: d.district,
    place: d.place,
    found: state.collectibles.found.includes(d.id),
  }));
}

export function enterRace(state, id) {
  ensureGarage(state);
  const race = STREET_RACES.find((r) => r.id === id);
  if (!race) return { ok: false, reason: 'no-such-race' };
  if (!charge(state, race.entryFee)) return { ok: false, reason: 'not-enough-money', fee: race.entryFee };
  return { ok: true, id, name: race.name, fee: race.entryFee, laps: race.laps, moneyLeft: moneyLeft(state) };
}

export function finishRace(state, id, won) {
  ensureGarage(state);
  const race = STREET_RACES.find((r) => r.id === id);
  if (!race) return { ok: false, reason: 'no-such-race' };
  if (!won) return { ok: true, won: false, payout: 0 };
  if (state.player && typeof state.player.money === 'number') state.player.money += race.payout;
  else if (typeof state.money === 'number') state.money += race.payout;
  if (typeof state.racesWon === 'number') state.racesWon += 1;
  if (typeof state.activitiesDone === 'number') state.activitiesDone += 1;
  if (typeof state.rp === 'number') state.rp += 50;
  return { ok: true, won: true, payout: race.payout, money: moneyLeft(state) };
}

export function raceSummary(state) {
  ensureGarage(state);
  return STREET_RACES.map((r) => ({
    id: r.id,
    name: r.name,
    district: r.district,
    entryFee: r.entryFee,
    payout: r.payout,
    laps: r.laps,
    blurb: r.blurb,
  }));
}

// The garage strip the screens layer draws: owned cars, the current
// car's upgrades, and the counts the dashboard prints. Pure data, no
// canvas — screens.js turns it into chips and lines.
export function garageStrip(state) {
  ensureGarage(state);
  const model = currentModel(state);
  const owned = carUpgrades(state, model);
  const totalUpgrades = (owned.engine || 0) + (owned.armor || 0) + (owned.paint && owned.paint !== 'Factory' ? 1 : 0);
  return {
    owned: [...state.garage.owned],
    current: model,
    upgrades: { engine: owned.engine || 0, armor: owned.armor || 0, paint: owned.paint || 'Factory' },
    totalUpgrades,
    carsOwned: state.garage.owned.length,
    carsTotal: GARAGE_CARS.length,
    propertiesOwned: (state.properties?.owned || []).length,
    discsFound: (state.collectibles?.found || []).length,
    discsTotal: SUN_DISCS.length,
    racesWon: typeof state.racesWon === 'number' ? state.racesWon : 0,
    racesTotal: STREET_RACES.length,
  };
}
