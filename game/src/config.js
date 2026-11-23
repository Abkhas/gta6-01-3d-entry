// Palma Verde — city data.
// Every number and name below was chosen for this city only. Nothing here
// is copied from another game: the districts, the stations, the prices and
// the car roster are new for Palma Verde.

(function () {
  'use strict';

  // The seven districts. Each one owns a rectangle of the map, a palette
  // the renderer uses for its rooftops and shopfronts, and a short line
  // the HUD shows when the player crosses into it.
  var DISTRICTS = [
    {
      id: 'marina', name: 'Marina', short: 'MARINA',
      x0: 300, y0: 180, x1: 1500, y1: 900,
      roof: '#c96f4a', wall: '#e8b48f', trim: '#2e6f7e',
      accent: '#f2d492', blurb: 'Yachts, white stucco, salt in the air.'
    },
    {
      id: 'oldtown', name: 'Old Town', short: 'OLD TOWN',
      x0: 1500, y0: 180, x1: 2700, y1: 900,
      roof: '#a8543c', wall: '#d9a06b', trim: '#5d3a2a',
      accent: '#e8c37a', blurb: 'Tile roofs and narrow lanes older than the city.'
    },
    {
      id: 'northgate', name: 'Northgate', short: 'NORTHGATE',
      x0: 2700, y0: 180, x1: 4200, y1: 900,
      roof: '#5d6e8c', wall: '#9fb0c9', trim: '#33415e',
      accent: '#bcd6f5', blurb: 'Glass towers and the north freeway gate.'
    },
    {
      id: 'citrus', name: 'Citrus Lane', short: 'CITRUS LANE',
      x0: 300, y0: 900, x1: 2100, y1: 1900,
      roof: '#d98a2b', wall: '#f0c078', trim: '#7a4a1d',
      accent: '#ffe08a', blurb: 'Market stalls, neon signs, orange trees.'
    },
    {
      id: 'boardwalk', name: 'Boardwalk', short: 'BOARDWALK',
      x0: 300, y0: 1900, x1: 1500, y1: 3200,
      roof: '#e2725b', wall: '#f7c9a8', trim: '#1f6f6b',
      accent: '#ffd166', blurb: 'Arcades, surf shops and the ferris wheel.'
    },
    {
      id: 'docks', name: 'The Docks', short: 'THE DOCKS',
      x0: 1500, y0: 1900, x1: 2700, y1: 3200,
      roof: '#6b5d4f', wall: '#a08b74', trim: '#3d342a',
      accent: '#e8b04b', blurb: 'Cranes, containers and night-shift work.'
    },
    {
      id: 'palmheights', name: 'Palm Heights', short: 'PALM HEIGHTS',
      x0: 2700, y0: 900, x1: 4200, y1: 3200,
      roof: '#b0597a', wall: '#e3a7bd', trim: '#4d2a3d',
      accent: '#ffd9e8', blurb: 'Villas on the hill, gates and garden walls.'
    }
  ];

  // Radio: three stations, each with a tagline and a short playlist of
  // invented track titles. The HUD prints the current line; the audio
  // builder turns the jingles into sound later.
  var RADIO = [
    {
      id: 'onda', freq: '98.4', name: 'Onda 98.4',
      tag: 'Onda 98.4 — the sound of the bay',
      tracks: ['Marea Alta — Los Corrientes', 'Sol de Medianoche — Vera Luz',
        'Callejon Verde — Duo Brisa', 'Vuelta Larga — Marisol Rey']
    },
    {
      id: 'solfm', freq: '101.1', name: 'Sol FM',
      tag: 'Sol FM — golden-hour pop, all day',
      tracks: ['Palma Nights — The Halcons', 'Coral Sky — June Faro',
        'Drive Slow — Kip & the Monsoons', 'Neon Palms — Static Coast']
    },
    {
      id: 'static', freq: '88.9', name: 'Static Coast',
      tag: 'Static Coast — talk, static and night drives',
      tracks: ['Night Desk with Nadia Venn', 'The Docks Report — hourly',
        'Coast to Coast Calls', 'Weather on the Water']
    }
  ];

  // Money: what things cost in Palma Verde. Missions pay in this same
  // currency; the garage and property builders read these tables too.
  var PRICES = {
    repairFull: 400, repairHalf: 180,
    paintJob: 250, engineTune: 900, armourPlate: 1200,
    ammoPistol: 60, ammoSmg: 140, pistol: 500, smg: 1800,
    snackHeal: 25, armourVest: 300,
    raceEntry: 200, racePayout: 1200,
    propertyFlat: 12000, propertyWarehouse: 30000, propertyVilla: 80000,
    carCheap: 6000, carMid: 18000, carTop: 45000
  };

  // The car roster. The Cometa GT is Rey's prize: bright coral red,
  // fastest in the city, and the target of mission two.
  var CARS = [
    { id: 'cometa', name: 'Cometa GT', color: '#ff4f3d', top: 176, accel: 0.34, grip: 0.92, price: 45000, seats: 2 },
    { id: 'vela', name: 'Vela Sedan', color: '#3d7ea6', top: 132, accel: 0.22, grip: 0.86, price: 12000, seats: 4 },
    { id: 'brisa', name: 'Brisa Hatch', color: '#e8c53a', top: 118, accel: 0.24, grip: 0.88, price: 6000, seats: 4 },
    { id: 'halcon', name: 'Halcon Coupe', color: '#2b2f38', top: 158, accel: 0.30, grip: 0.90, price: 18000, seats: 2 },
    { id: 'faro', name: 'Faro Pickup', color: '#7a8a6a', top: 124, accel: 0.20, grip: 0.80, price: 14000, seats: 2 },
    { id: 'tiburon', name: 'Tiburon Van', color: '#c9c2b4', top: 108, accel: 0.16, grip: 0.78, price: 9000, seats: 6 },
    { id: 'monzon', name: 'Monzon Taxi', color: '#f2a007', top: 128, accel: 0.22, grip: 0.85, price: 11000, seats: 4 },
    { id: 'playa', name: 'Playa Convertible', color: '#e86a92', top: 148, accel: 0.28, grip: 0.87, price: 22000, seats: 2 },
    { id: 'corriente', name: 'Corriente SUV', color: '#4a6b4f', top: 136, accel: 0.21, grip: 0.84, price: 20000, seats: 5 },
    { id: 'duna', name: 'Duna Muscle', color: '#8c2f2f', top: 164, accel: 0.31, grip: 0.82, price: 26000, seats: 2 }
  ];

  var WEAPONS = [
    { id: 'fists', name: 'Fists', damage: 12, mag: 0, reserve: 0, price: 0 },
    { id: 'pistol', name: 'P9 Pistol', damage: 26, mag: 12, reserve: 60, price: 500 },
    { id: 'smg', name: 'Vespa SMG', damage: 16, mag: 30, reserve: 120, price: 1800 },
    { id: 'shotgun', name: 'Duna 12', damage: 55, mag: 6, reserve: 24, price: 2400 }
  ];

  // Rank ladder for RP progression.
  var RANKS = [
    { name: 'Runner', rp: 0 },
    { name: 'Wheelman', rp: 800 },
    { name: 'Fixer', rp: 2200 },
    { name: 'Kingpin', rp: 5200 },
    { name: 'Legend', rp: 10000 }
  ];

  // Police call-sign pool for dispatch. Fresh for this city.
  var CALLSIGNS = ['HALCON', 'BRISA', 'FARO', 'MONZON', 'TIBURON', 'VELA', 'CORRIENTE', 'PLAYA'];

  // Clock anchors: minutes after midnight.
  var CLOCK = {
    dawn: 6 * 60, noon: 13 * 60, golden: 18 * 60 + 40, night: 21 * 60 + 30,
    startMinutes: 18 * 60 + 40, minutesPerSecond: 1
  };

  var CITY = { width: 4200, height: 3200, oceanX: 180, beachX: 300 };

  window.PalmaConfig = {
    DISTRICTS: DISTRICTS, RADIO: RADIO, PRICES: PRICES, CARS: CARS,
    WEAPONS: WEAPONS, RANKS: RANKS, CALLSIGNS: CALLSIGNS,
    CLOCK: CLOCK, CITY: CITY
  };
})();
