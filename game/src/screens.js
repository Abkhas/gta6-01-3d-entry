// Palma Verde — screens: title, pause menu, full-city map, stats
// dashboard, and the MISSION PASSED card.
//
// D7 SYSTEMS LAYOUT (1280x720, hard gutters, three strict columns):
//   margin 24, gutter 16 — left x24 w300, centre x340 w560,
//   right x916 w316. Left = completion ring + checklist with bars +
//   mission medals. Centre = full-city map, street grid and district
//   fills at full opacity, standing values, markers, route. Right =
//   career stats + rank card + save slots WITH progress. A bottom
//   band holds the crew cards and the garage strip. Nothing in one
//   column ever crosses into another.
//
// D8 TITLE: a dusk skyline behind the title — extruded buildings
// with lit windows and NAMED signs (original names only), palms and
// beach umbrellas in the foreground, menu left, save slots with
// progress right.
//
// Everything here draws on the game canvas with plain rectangles,
// text, and circles. Nothing here owns game logic: it reads the
// shared state object and the converted systems on window
// (PalmaMissions, PalmaCrew, PalmaProgress, PalmaGarage) and turns
// their numbers into panels. Every draw function takes the canvas
// so the layout can size itself to the real frame.

(function () {
  'use strict';

  var CFG = window.PalmaConfig || null;

  var TABS = [
    { id: 'map', label: 'MAP' },
    { id: 'missions', label: 'MISSIONS' },
    { id: 'stats', label: 'STATS' },
    { id: 'crew', label: 'CREW' },
    { id: 'garage', label: 'GARAGE' },
    { id: 'settings', label: 'SETTINGS' }
  ];

  // Catalogue totals the dashboard prints. Missions, activities,
  // districts and radio come from the live data; vehicles and weapons
  // count the full roster (models plus traffic and police variants).
  var CATALOGUE = { missions: 10, activities: 28, vehicles: 18, weapons: 8, districts: 7, radio: 3 };

  var MARGIN = 24, GUTTER = 16;
  var COL_L = { x: 24, w: 300 };
  var COL_C = { x: 340, w: 560 };
  var COL_R = { x: 916, w: 316 };

  function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
  }

  function moneyStr(n) {
    return '$' + Math.floor(n || 0).toLocaleString('en-US');
  }

  function clockStr(mins) {
    var hh = Math.floor((mins || 0) / 60) % 24;
    var mm = Math.floor(mins || 0) % 60;
    return (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm;
  }

  // Beach geometry for the map strips: Builder 2's world export
  // window.PalmaWorld.BEACH = { oceanX0, oceanX1, sandX1, beachRoadX }
  // (wide sand band to x540). Fall back to the old CFG.CITY strip
  // (ocean 0..180, sand 180..300) if the world builder is not loaded.
  function beach() {
    var b = window.PalmaWorld && window.PalmaWorld.BEACH;
    if (b && typeof b.oceanX1 === 'number' && typeof b.sandX1 === 'number') {
      return { oceanX0: b.oceanX0 || 0, oceanX1: b.oceanX1, sandX1: b.sandX1 };
    }
    return { oceanX0: 0, oceanX1: CFG.CITY.oceanX, sandX1: CFG.CITY.beachX };
  }

  // Deterministic 0..1 hash for the skyline and the medals: the same
  // index always draws the same building, no Math.random in a frame.
  function hashRand(i, j) {
    var v = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
    return v - Math.floor(v);
  }

  function panel(ctx, x, y, w, h, alpha) {
    ctx.fillStyle = 'rgba(8,12,18,' + (alpha === undefined ? 0.6 : alpha) + ')';
    ctx.fillRect(x, y, w, h);
  }

  function bar(ctx, x, y, w, h, frac, fill) {
    ctx.fillStyle = '#2a2a30';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, Math.max(0, w * clamp(frac, 0, 1)), h);
  }

  function headline(ctx, text, x, y, size, color, align) {
    ctx.fillStyle = color || '#ffd166';
    ctx.font = 'bold ' + size + 'px system-ui, sans-serif';
    ctx.textAlign = align || 'left';
    ctx.fillText(text, x, y);
    ctx.textAlign = 'left';
  }

  function bodyText(ctx, text, x, y, size, color) {
    ctx.fillStyle = color || '#e8e8e8';
    ctx.font = size + 'px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(text, x, y);
  }

  function fitText(ctx, text, maxW) {
    var t = String(text || '');
    if (ctx.measureText(t).width <= maxW) return t;
    while (t.length > 1 && ctx.measureText(t + '…').width > maxW) {
      t = t.slice(0, -1);
    }
    return t + '…';
  }

  // Wrap a sentence into lines that fit maxChars each.
  function wrapLines(text, maxChars) {
    var words = String(text || '').split(' ');
    var lines = [''];
    for (var i = 0; i < words.length; i++) {
      var test = lines[lines.length - 1] + words[i] + ' ';
      if (test.length > maxChars && lines[lines.length - 1].length > 0) lines.push(words[i] + ' ');
      else lines[lines.length - 1] = test;
    }
    return lines;
  }

  // A round portrait: coloured disc + the person's initial.
  function portrait(ctx, x, y, r, color, initial) {
    ctx.fillStyle = color || '#c94f3d';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold ' + Math.round(r) + 'px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(initial || '?', x, y - r * 0.45);
    ctx.textAlign = 'left';
  }

  function standingLabel(v) {
    if (typeof v !== 'number') return 'UNRANKED';
    if (v >= 60) return 'FRIENDLY';
    if (v >= 30) return 'NEUTRAL';
    return 'COLD';
  }

  // Save slots: the progress system's list, or an override passed in
  // by the caller (the shot stager passes demo slots; the game passes
  // nothing and the list comes from localStorage).
  function readSlots(opts) {
    if (opts && opts.slots) return opts.slots;
    if (window.PalmaProgress && window.PalmaProgress.listSaveSlots) {
      try { return window.PalmaProgress.listSaveSlots(); } catch (e) { /* fall through */ }
    }
    return [
      { slot: 1, empty: true }, { slot: 2, empty: true }, { slot: 3, empty: true }
    ];
  }

  // The title screen's staged slots (spec D8): slot 1 is the staged
  // 48% Act II game, slot 2 an earlier act, slot 3 empty. Used only
  // by the title screen when no real save exists yet.
  function stagedTitleSlots() {
    return [
      { slot: 1, empty: false, act: 'ACT II', mission: 'old-town-score', missionName: 'Old Town Score', completion: 48, money: 18200, rank: 'fixer', missionsDone: 5, playTime: 18 * 60 + 40 },
      { slot: 2, empty: false, act: 'ACT I', mission: 'hot-wheels', missionName: 'Hot Wheels', completion: 21, money: 6400, rank: 'wheelman', missionsDone: 1, playTime: 9 * 60 + 30 },
      { slot: 3, empty: true }
    ];
  }

  function missionRows(state) {
    var list = [];
    if (window.PalmaMissions && window.PalmaMissions.missionList) {
      list = window.PalmaMissions.missionList();
    }
    var done = (state.missions && state.missions.completed) || [];
    var current = state.missions ? state.missions.current : null;
    return list.map(function (m) {
      var status = 'LOCKED';
      if (done.indexOf(m.id) >= 0) status = 'DONE';
      else if (m.id === current) status = 'CURRENT';
      else if (m.num === 1 || done.indexOf(list[m.num - 2] ? list[m.num - 2].id : '') >= 0) status = 'OPEN';
      return {
        num: m.num, name: m.name, giver: m.giver, act: m.act,
        payout: m.payout, rp: m.rp, stages: m.stageCount, status: status
      };
    });
  }

  // Crew rows with cooldown display data when the crew system offers
  // it (cooldownDisplay: fraction + label), else the plain status.
  function crewRows(state) {
    if (window.PalmaCrew && window.PalmaCrew.cooldownDisplay) {
      try { return window.PalmaCrew.cooldownDisplay(state, Date.now()); } catch (e) { /* fall through */ }
    }
    if (window.PalmaCrew && window.PalmaCrew.crewStatus) {
      try { return window.PalmaCrew.crewStatus(state, Date.now()); } catch (e) { /* fall through */ }
    }
    return [
      { id: 'tuck', name: 'Tuck Ibarra', role: 'Driver', ability: 'Swap Plates', effect: 'Drop 1 wanted star', cooldownLeft: 0, ready: true, rpCost: 25 },
      { id: 'ines', name: 'Ines Duarte', role: 'Mechanic', ability: 'Quick Fix', effect: 'Repair current vehicle to full', cooldownLeft: 0, ready: true, rpCost: 25 },
      { id: 'kip', name: 'Kip Ansel', role: 'Lookout', ability: 'Eyes Out', effect: 'Reveal police on the minimap for 30s', cooldownLeft: 0, ready: true, rpCost: 15 }
    ];
  }

  function dashNumbers(state) {
    if (window.PalmaProgress && window.PalmaProgress.dashboardNumbers) {
      try { return window.PalmaProgress.dashboardNumbers(state); } catch (e) { /* fall through */ }
    }
    var done = (state.missions && state.missions.completed) || [];
    return {
      missions: done.length + '/' + CATALOGUE.missions,
      activities: (state.activitiesDone || 0) + '/' + CATALOGUE.activities,
      vehicles: '' + CATALOGUE.vehicles, weapons: '' + CATALOGUE.weapons,
      districts: '' + CATALOGUE.districts, radio: '' + CATALOGUE.radio,
      completion: state.completion || 0,
      rank: { name: 'Runner' }, rankIndex: 1,
      rpInto: state.rp || 0, rpNeeded: 800, rpFraction: 0,
      respect: state.respect || 0, standing: [],
      career: { carsStolen: 0, copsEscaped: 0, distanceDrivenKm: 0, longestJumpM: 0, crewAbilitiesUsed: 0 }
    };
  }

  function standingRows(state) {
    if (window.PalmaProgress && window.PalmaProgress.standingSummary) {
      try { return window.PalmaProgress.standingSummary(state); } catch (e) { /* fall through */ }
    }
    var names = ['Marina', 'Old Town', 'Citrus Lane', 'Boardwalk', 'The Docks', 'Palm Heights', 'Northgate'];
    return names.map(function (n) {
      return { district: n, value: (state.standing && state.standing[n]) || 0 };
    });
  }

  // The seven checklist rows for the left column, each with a bar.
  function checklistRows(state) {
    var done = (state.missions && state.missions.completed) || [];
    var strip = null;
    if (window.PalmaGarage && window.PalmaGarage.garageStrip) {
      try { strip = window.PalmaGarage.garageStrip(state); } catch (e) { /* keep null */ }
    }
    var friendly = 0;
    var rows = standingRows(state);
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].value >= 50) friendly++;
    }
    return [
      { label: 'MISSIONS', done: done.length, total: CATALOGUE.missions },
      { label: 'ACTIVITIES', done: state.activitiesDone || 0, total: CATALOGUE.activities },
      { label: 'STREET RACES', done: strip ? strip.racesWon : (state.racesWon || 0), total: strip ? strip.racesTotal : 3 },
      { label: 'SUN-DISCS', done: strip ? strip.discsFound : ((state.collectibles && state.collectibles.found) || []).length, total: strip ? strip.discsTotal : 12 },
      { label: 'PROPERTIES', done: strip ? strip.propertiesOwned : ((state.properties && state.properties.owned) || []).length, total: 3 },
      { label: 'DISTRICT JOBS', done: friendly, total: 7 },
      { label: 'CREW', done: 3, total: 3 }
    ];
  }

  // Career rows for the right column, from progress.careerStats.
  function careerRows(state) {
    var c = null;
    if (window.PalmaProgress && window.PalmaProgress.careerStats) {
      try { c = window.PalmaProgress.careerStats(state); } catch (e) { /* keep null */ }
    }
    if (!c) c = { carsStolen: 0, copsEscaped: 0, distanceDrivenKm: 0, longestJumpM: 0, crewAbilitiesUsed: 0 };
    return [
      { label: 'CARS STOLEN', value: '' + c.carsStolen },
      { label: 'COPS ESCAPED', value: '' + c.copsEscaped },
      { label: 'DISTANCE DRIVEN', value: c.distanceDrivenKm + ' km' },
      { label: 'LONGEST JUMP', value: c.longestJumpM > 0 ? c.longestJumpM + ' m' : '—' },
      { label: 'CREW ABILITIES USED', value: '' + c.crewAbilitiesUsed }
    ];
  }

  // Mission-rating medals: one letter per completed mission, derived
  // deterministically from the mission number (G gold, S silver,
  // B bronze). A real rating table replaces the derivation when the
  // progress system grows one.
  function medalFor(num) {
    if (num % 3 === 1) return { letter: 'G', color: '#ffd166' };
    if (num % 3 === 2) return { letter: 'S', color: '#cfd6e4' };
    return { letter: 'B', color: '#c47a3a' };
  }

  function districtCentre(city, name) {
    var districts = city.districts || (CFG ? CFG.DISTRICTS : []);
    for (var i = 0; i < districts.length; i++) {
      if (districts[i].name === name) {
        return { x: (districts[i].x0 + districts[i].x1) / 2, y: (districts[i].y0 + districts[i].y1) / 2 };
      }
    }
    return null;
  }

  // The full-city map, drawn into a rectangle: wide ocean + sand on
  // the west edge, district fills and labels at full opacity with
  // standing values, real streets, landmarks, race / garage /
  // safehouse markers, the dashed route to the mission marker, police
  // dots, the player arrow, and the waypoint diamond when one is set.
  function drawFullMap(ctx, state, city, x, y, w, h) {
    function sx(wx) { return x + (wx / city.width) * w; }
    function sy(wy) { return y + (wy / city.height) * h; }
    var bch = beach();
    ctx.fillStyle = 'rgba(8,18,14,0.9)';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#1f6f8f';
    ctx.fillRect(x, y, sx(bch.oceanX1) - x, h);
    ctx.fillStyle = '#c9b078';
    ctx.fillRect(sx(bch.oceanX1), y, sx(bch.sandX1) - sx(bch.oceanX1), h);
    var districts = city.districts || (CFG ? CFG.DISTRICTS : []);
    var standing = {};
    var srows = standingRows(state);
    for (var si = 0; si < srows.length; si++) standing[srows[si].district] = srows[si].value;
    // The downtown highway: the avenue through Northgate's centre,
    // drawn thick BEFORE the district fills and names so it reads
    // as a highway slicing the city without striking through the
    // NORTHGATE and PALM HEIGHTS labels (both sit on its line).
    // A plain grid of 1.2px avenues is what made the map read as
    // Pac-Man; the freeway is the one road with weight.
    var hwX = null;
    for (var di = 0; di < districts.length; di++) {
      if (districts[di].id === 'northgate') {
        var ncx = (districts[di].x0 + districts[di].x1) / 2;
        for (var ai2 = 0; ai2 < city.avenues.length; ai2++) {
          if (hwX === null || Math.abs(city.avenues[ai2] - ncx) < Math.abs(hwX - ncx)) hwX = city.avenues[ai2];
        }
      }
    }
    if (hwX !== null) {
      ctx.strokeStyle = '#e8c37a';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(sx(hwX), y);
      ctx.lineTo(sx(hwX), y + h);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(10,16,30,0.85)';
      ctx.lineWidth = 1;
      ctx.setLineDash([7, 7]);
      ctx.beginPath();
      ctx.moveTo(sx(hwX), y);
      ctx.lineTo(sx(hwX), y + h);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    for (var d = 0; d < districts.length; d++) {
      var dist = districts[d];
      ctx.fillStyle = (dist.accent || '#ffd166') + '55';
      ctx.fillRect(sx(dist.x0), sy(dist.y0), sx(dist.x1) - sx(dist.x0), sy(dist.y1) - sy(dist.y0));
      var cx = (sx(dist.x0) + sx(dist.x1)) / 2;
      var cy = (sy(dist.y0) + sy(dist.y1)) / 2;
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.font = 'bold 12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText((dist.short || dist.name).toUpperCase(), cx, cy - 4);
      var val = standing[dist.name];
      ctx.fillStyle = '#ffd166';
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.fillText(typeof val === 'number' ? (val + ' · ' + standingLabel(val)) : '—', cx, cy + 12);
      ctx.textAlign = 'left';
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1.2;
    var i;
    for (i = 0; i < city.avenues.length; i++) {
      ctx.beginPath();
      ctx.moveTo(sx(city.avenues[i]), y);
      ctx.lineTo(sx(city.avenues[i]), y + h);
      ctx.stroke();
    }
    for (i = 0; i < city.streets.length; i++) {
      ctx.beginPath();
      ctx.moveTo(x, sy(city.streets[i]));
      ctx.lineTo(x + w, sy(city.streets[i]));
      ctx.stroke();
    }
    if (hwX !== null) {
      // Highway tag at the top of the freeway, clear of the
      // district names below it.
      ctx.fillStyle = '#e8c37a';
      ctx.font = 'bold 10px system-ui, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText('NORTHGATE FWY', sx(hwX) - 8, y + 12);
      ctx.textAlign = 'left';
    }
    for (i = 0; i < (city.landmarks || []).length; i++) {
      var lm = city.landmarks[i];
      var lx = sx(lm.x), ly = sy(lm.y);
      if (lm.kind === 'wheel') {
        ctx.strokeStyle = '#ffd166';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(lx, ly, 9, 0, Math.PI * 2);
        ctx.stroke();
      } else if (lm.kind === 'pier') {
        ctx.strokeStyle = '#e8c37a';
        ctx.beginPath();
        ctx.moveTo(lx, ly);
        ctx.lineTo(sx(lm.x - lm.length), ly);
        ctx.stroke();
      } else {
        ctx.fillStyle = '#ffd166';
        ctx.beginPath();
        ctx.arc(lx, ly, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Letter markers: R street-race start, G garage, H safehouse.
    var markers = [
      { letter: 'R', district: 'Boardwalk', color: '#e84a3a' },
      { letter: 'G', district: 'Marina', color: '#4caf50' },
      { letter: 'H', district: 'Old Town', color: '#7ec3e8' }
    ];
    for (var mk = 0; mk < markers.length; mk++) {
      var centre = districtCentre(city, markers[mk].district);
      if (!centre) continue;
      var mx = sx(centre.x), my = sy(centre.y) + 30;
      ctx.fillStyle = markers[mk].color;
      ctx.beginPath();
      ctx.arc(mx, my, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(markers[mk].letter, mx, my - 4);
      ctx.textAlign = 'left';
    }
    var target = state.missionTarget || state.waypoint;
    if (target) {
      var p = state.player;
      ctx.strokeStyle = '#ffd166';
      ctx.lineWidth = 2;
      ctx.setLineDash([7, 6]);
      ctx.beginPath();
      ctx.moveTo(sx(p.x), sy(p.y));
      ctx.lineTo(sx(target.x), sy(p.y));
      ctx.lineTo(sx(target.x), sy(target.y));
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (state.waypoint) {
      ctx.fillStyle = '#ffd166';
      ctx.save();
      ctx.translate(sx(state.waypoint.x), sy(state.waypoint.y));
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-7, -7, 14, 14);
      ctx.restore();
      // Label ABOVE the marker on a dark plate: to the right it
      // runs into the next district's name — the Boardwalk waypoint
      // sits on the Docks' label line.
      var wLabel = 'WAYPOINT · ' + (state.waypoint.label || '').toUpperCase();
      ctx.fillStyle = '#ffd166';
      ctx.font = 'bold 11px system-ui, sans-serif';
      var wtw = ctx.measureText(wLabel).width;
      var wtx = sx(state.waypoint.x), wty = sy(state.waypoint.y) - 32;
      ctx.fillStyle = 'rgba(8,18,14,0.85)';
      ctx.fillRect(wtx - wtw / 2 - 5, wty - 11, wtw + 10, 15);
      ctx.fillStyle = '#ffd166';
      ctx.textAlign = 'center';
      ctx.fillText(wLabel, wtx, wty);
      ctx.textAlign = 'left';
    }
    if (state.police && state.police.units) {
      for (var u = 0; u < state.police.units.length; u++) {
        var car = state.police.units[u].car;
        ctx.fillStyle = '#ff3b30';
        ctx.beginPath();
        ctx.arc(sx(car.x), sy(car.y), 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    var px = sx(state.player.x), py = sy(state.player.y);
    var ang = state.player.vehicle ? state.player.vehicle.angle : state.player.angle;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(ang || 0);
    ctx.fillStyle = '#ffd166';
    ctx.beginPath();
    ctx.moveTo(11, 0);
    ctx.lineTo(-8, -7);
    ctx.lineTo(-8, 7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('N', x + w - 8, y + 16);
    ctx.textAlign = 'left';
    ctx.strokeStyle = 'rgba(255,209,102,0.8)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x, y, w, h);
  }

  // The time a slot was played, as HH:MM: the slot's own playTime
  // (minutes), else the clock the caller passes, else the save time.
  function slotTime(slot, fallbackClock) {
    if (slot && typeof slot.playTime === 'number') return clockStr(slot.playTime);
    if (slot && typeof slot.time === 'number') return clockStr(slot.time);
    if (fallbackClock) return fallbackClock;
    if (slot && slot.savedAt) {
      var d = new Date(slot.savedAt);
      if (!isNaN(d.getTime())) return clockStr(d.getHours() * 60 + d.getMinutes());
    }
    return null;
  }

  // Missions done for a slot: the stored count, else derived from the
  // mission's number (missions before it are done), else unknown.
  function slotMissionsDone(slot) {
    if (slot && typeof slot.missionsDone === 'number') return slot.missionsDone;
    if (slot && (slot.mission || slot.missionName) && window.PalmaMissions && window.PalmaMissions.missionList) {
      try {
        var list = window.PalmaMissions.missionList();
        for (var i = 0; i < list.length; i++) {
          if (list[i].id === slot.mission || list[i].name === slot.missionName) return list[i].num - 1;
        }
      } catch (e) { /* unknown */ }
    }
    return null;
  }

  // One save-slot card: number, act, mission, completion, missions,
  // money and time — or EMPTY. `timeStr` is the fallback clock the
  // caller passes (the live game clock at the dashboard).
  function drawSlotCard(ctx, slot, x, y, w, h, selected, timeStr) {
    panel(ctx, x, y, w, h, selected ? 0.85 : 0.55);
    ctx.strokeStyle = selected ? '#ffd166' : 'rgba(255,255,255,0.25)';
    ctx.lineWidth = selected ? 2 : 1;
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
    headline(ctx, 'SLOT ' + slot.slot, x + 14, y + 10, 15, '#ffd166');
    if (slot.empty) {
      bodyText(ctx, 'EMPTY — NEW GAME', x + 14, y + 38, 14, '#8a8a92');
      bodyText(ctx, 'A fresh start on the Boardwalk.', x + 14, y + 60, 12, '#8a8a92');
    } else {
      ctx.font = 'bold 14px system-ui, sans-serif';
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'left';
      ctx.fillText(fitText(ctx, (slot.act || 'ACT I') + '  ·  ' + (slot.missionName || slot.mission || 'FREE ROAM'), w - 28), x + 14, y + 34);
      var done = slotMissionsDone(slot);
      var parts = [];
      parts.push(slot.completion === null || slot.completion === undefined ? '—' : slot.completion + '%');
      parts.push(done === null ? '—' : done + '/' + CATALOGUE.missions + ' MISSIONS');
      if (slot.money !== null && slot.money !== undefined) parts.push(moneyStr(slot.money));
      var t = slotTime(slot, timeStr);
      if (t) parts.push(t);
      bodyText(ctx, fitText(ctx, parts.join('  ·  '), w - 28), x + 14, y + 56, 13, '#ffd166');
      if (slot.rank && h >= 84) bodyText(ctx, 'RANK: ' + String(slot.rank).toUpperCase(), x + 14, y + 76, 12, '#8a8a92');
    }
  }

  // One palm: trunk + five fronds, drawn with plain lines.
  function drawPalm(ctx, x, y, s, color) {
    ctx.strokeStyle = color || '#1d2b26';
    ctx.lineWidth = 4 * s;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + 6 * s, y - 34 * s, x + 2 * s, y - 52 * s);
    ctx.stroke();
    ctx.lineWidth = 2.5 * s;
    var tx = x + 2 * s, ty = y - 52 * s;
    var fronds = [[-26, -12], [-14, -24], [0, -28], [14, -22], [26, -10]];
    for (var i = 0; i < fronds.length; i++) {
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.quadraticCurveTo(tx + fronds[i][0] * 0.6 * s, ty + fronds[i][1] * 0.5 * s, tx + fronds[i][0] * s, ty + fronds[i][1] * s);
      ctx.stroke();
    }
  }

  // One beach umbrella: pole + striped half-disc canopy.
  function drawUmbrella(ctx, x, y, s, color) {
    ctx.strokeStyle = '#3a2a20';
    ctx.lineWidth = 2 * s;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y - 26 * s);
    ctx.stroke();
    ctx.fillStyle = color || '#e2725b';
    ctx.beginPath();
    ctx.arc(x, y - 26 * s, 20 * s, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.arc(x, y - 26 * s, 20 * s, Math.PI * 1.25, Math.PI * 1.6);
    ctx.closePath();
    ctx.fill();
  }

  // Dusk skyline: two rows of extruded buildings with lit windows
  // and named signs, a low sun, palms and umbrellas in front.
  function drawSkyline(ctx, W, H) {
    var horizon = H * 0.58;
    var g = ctx.createLinearGradient(0, 0, 0, horizon);
    g.addColorStop(0, '#2a1a4a');
    g.addColorStop(0.45, '#7a3a6e');
    g.addColorStop(0.8, '#ff8a4f');
    g.addColorStop(1, '#ffc46b');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, horizon);
    // Low sun + glow.
    var sunX = W * 0.72, sunY = horizon - 46;
    ctx.fillStyle = 'rgba(255,196,107,0.25)';
    ctx.beginPath();
    ctx.arc(sunX, sunY, 90, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffe9b8';
    ctx.beginPath();
    ctx.arc(sunX, sunY, 34, 0, Math.PI * 2);
    ctx.fill();
    // Back row: dark silhouettes.
    var bx = -20, bi = 0;
    while (bx < W) {
      var bw = 90 + hashRand(bi, 1) * 60;
      var bh = 150 + hashRand(bi, 2) * 130;
      ctx.fillStyle = '#241a33';
      ctx.fillRect(bx, horizon - bh, bw, bh);
      ctx.fillStyle = 'rgba(255,209,102,0.5)';
      for (var wy = 0; wy < 6; wy++) {
        for (var wx = 0; wx < 4; wx++) {
          if (hashRand(bi, wy * 10 + wx) > 0.6) {
            ctx.fillRect(bx + 12 + wx * 20, horizon - bh + 16 + wy * 22, 8, 10);
          }
        }
      }
      bx += bw + 8;
      bi++;
    }
    // Front row: nearer buildings with lit windows and named signs.
    var signs = [
      { text: 'HOTEL PALMA', size: 15 },
      { text: 'LAGUNA VERDE', size: 14 },
      { text: 'TORRE BRISA', size: 15 },
      { text: 'CASA MARINA', size: 11 },
      { text: 'PALM COURT', size: 11 }
    ];
    var fx = -10, fi = 0;
    while (fx < W) {
      var fw = 80 + hashRand(fi, 3) * 60;
      var fh = 90 + hashRand(fi, 4) * 110;
      var top = horizon - fh + 24;
      ctx.fillStyle = '#1a1226';
      ctx.fillRect(fx, top, fw, fh + 40);
      ctx.fillStyle = '#ffd166';
      ctx.fillRect(fx, top, fw, 3);
      for (var fy = 0; fy < 5; fy++) {
        for (var fwx = 0; fwx < 4; fwx++) {
          if (hashRand(fi, fy * 10 + fwx + 5) > 0.5) {
            ctx.fillStyle = hashRand(fi, fy * 10 + fwx + 9) > 0.8 ? '#ff9e4f' : '#ffd166';
            ctx.fillRect(fx + 10 + fwx * 18, top + 14 + fy * 20, 8, 10);
          }
        }
      }
      if (fi < signs.length) {
        ctx.fillStyle = '#ffd166';
        ctx.font = 'bold ' + signs[fi].size + 'px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(signs[fi].text, fx + fw / 2, top + 34);
        ctx.textAlign = 'left';
      }
      fx += fw + 14;
      fi++;
    }
    // Ground + foreground: palms and beach umbrellas.
    ctx.fillStyle = '#120e1a';
    ctx.fillRect(0, horizon, W, H - horizon);
    ctx.fillStyle = 'rgba(201,176,120,0.5)';
    ctx.fillRect(0, horizon, W, 10);
    drawPalm(ctx, W * 0.06, H - 8, 1.1);
    drawPalm(ctx, W * 0.16, H - 4, 0.9);
    drawPalm(ctx, W * 0.92, H - 8, 1.2);
    drawUmbrella(ctx, W * 0.82, H - 10, 1.0, '#e2725b');
    drawUmbrella(ctx, W * 0.26, H - 6, 0.8, '#3d7ea6');
  }

  // Title screen: dusk skyline, title + menu left, save slots with
  // progress right. ENTER starts the selected slot.
  function drawTitle(ctx, state, city, canvas, opts) {
    var W = canvas.width, H = canvas.height;
    drawSkyline(ctx, W, H);
    ctx.fillStyle = 'rgba(10,16,30,0.22)';
    ctx.fillRect(0, 0, W, H);
    headline(ctx, 'PALMA VERDE', 48, H * 0.13, 64, '#ffd166');
    bodyText(ctx, 'Rey Calder owes Nadia Venn $2,000. The city is open.', 50, H * 0.13 + 52, 20, '#fff');
    var menu = ['CONTINUE', 'NEW GAME', 'LOAD GAME', 'SETTINGS'];
    var sel = (opts && typeof opts.selectedMenu === 'number') ? opts.selectedMenu : 0;
    var menuY = H * 0.36;
    panel(ctx, 40, menuY - 24, 320, menu.length * 44 + 32, 0.55);
    for (var m = 0; m < menu.length; m++) {
      var my = menuY + m * 44;
      if (m === sel) {
        ctx.fillStyle = '#ffd166';
        ctx.fillRect(52, my + 2, 6, 20);
      }
      headline(ctx, (m === sel ? '▸ ' : '   ') + menu[m], 66, my, 20, m === sel ? '#ffd166' : '#e8e8e8');
    }
    var slots = readSlots(opts);
    var anyReal = false;
    for (var s0 = 0; s0 < slots.length; s0++) {
      if (slots[s0] && !slots[s0].empty) anyReal = true;
    }
    if (!anyReal) slots = stagedTitleSlots();
    var selected = (opts && typeof opts.selected === 'number') ? opts.selected : (state.titleSlot || 0);
    var sw = 452, sh = 104, sgap = 12;
    var sx = W - sw - 48, sy = H * 0.21;
    headline(ctx, 'SAVE SLOTS', sx, sy - 16, 15, '#ffd166');
    var clockNow = clockStr(state.clockMinutes);
    for (var i = 0; i < 3; i++) {
      drawSlotCard(ctx, slots[i] || { slot: i + 1, empty: true }, sx, sy + i * (sh + sgap), sw, sh, i === selected, clockNow);
    }
    headline(ctx, 'PRESS ENTER TO START  ·  ARROWS PICK A SLOT', W / 2, H - 88, 17, '#fff', 'center');
    bodyText(ctx, 'WASD walk / drive   ·   E enter & exit car / start mission   ·   Mouse aim, click fire   ·   R reload   ·   Q radio   ·   Z / X / V crew   ·   Esc pause   ·   F9 save', W / 2 - 330, H - 56, 14, '#c9d2e0');
    ctx.textAlign = 'left';
    bodyText(ctx, clockStr(state.clockMinutes) + '  ·  ' + (state.district ? state.district.name.toUpperCase() : 'PALMA VERDE') + '  ·  10 MISSIONS  ·  7 DISTRICTS  ·  3 RADIO STATIONS', 24, H - 24, 13, '#8a8a92');
  }

  // The stats grid: the left column of the systems screen — the
  // completion ring with the rank beside it, the checklist with bars,
  // and the mission-rating medals. `availH` is the column height the
  // caller gives it; the checklist stretches to fill what is left.
  // Shared by the STATS pause tab and the shot-3 dashboard.
  function drawStatsGrid(ctx, state, x, y, w, availH) {
    var nums = dashNumbers(state);
    var colH = availH || 500;
    var ringH = 132, medalsH = 78, gap = 10;
    var listH = Math.max(120, colH - ringH - medalsH - gap * 2);
    // Completion ring + rank.
    panel(ctx, x, y, w, ringH, 0.55);
    var rcx = x + 62, rcy = y + ringH / 2, rr = 42;
    ctx.strokeStyle = '#2a2a30';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.arc(rcx, rcy, rr, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = '#4caf50';
    ctx.beginPath();
    ctx.arc(rcx, rcy, rr, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp(nums.completion / 100, 0, 1));
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 24px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(Math.round(nums.completion) + '%', rcx, rcy - 8);
    ctx.fillStyle = '#8a8a92';
    ctx.font = '10px system-ui, sans-serif';
    ctx.fillText('COMPLETE', rcx, rcy + 14);
    ctx.textAlign = 'left';
    var rankName = (nums.rank && nums.rank.name) || 'Runner';
    headline(ctx, 'RANK ' + (nums.rankIndex || 1) + ' · ' + rankName.toUpperCase(), x + 122, y + 22, 17, '#ffd166');
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillStyle = '#e8e8e8';
    ctx.textAlign = 'left';
    ctx.fillText(fitText(ctx, 'RP ' + (nums.rpInto || 0) + ' / ' + (nums.rpNeeded || 0) + (nums.rank && nums.rank.tagline ? '  —  ' + nums.rank.tagline : ''), w - 134), x + 122, y + 46);
    bar(ctx, x + 122, y + 58, w - 134, 10, nums.rpFraction || 0, '#ffd166');
    bodyText(ctx, 'RESPECT ' + (nums.respect || 0) + ' / 100', x + 122, y + 86, 12, '#e8e8e8');
    bar(ctx, x + 122, y + 98, w - 134, 8, (nums.respect || 0) / 100, '#7ec3e8');
    // Checklist with bars.
    var ly = y + ringH + gap;
    panel(ctx, x, ly, w, listH, 0.55);
    var rows = checklistRows(state);
    var rowH = listH / rows.length;
    for (var r = 0; r < rows.length; r++) {
      var rowY = ly + r * rowH;
      bodyText(ctx, rows[r].label, x + 12, rowY + 6, 11, '#e8e8e8');
      ctx.fillStyle = '#ffd166';
      ctx.font = 'bold 12px system-ui, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(rows[r].done + ' / ' + rows[r].total, x + w - 12, rowY + 6);
      ctx.textAlign = 'left';
      bar(ctx, x + 12, rowY + 22, w - 24, 8, rows[r].total > 0 ? rows[r].done / rows[r].total : 0, '#4caf50');
    }
    // Mission-rating medals.
    var my = ly + listH + gap;
    panel(ctx, x, my, w, medalsH, 0.55);
    headline(ctx, 'MISSION MEDALS', x + 12, my + 8, 12, '#ffd166');
    var doneList = (state.missions && state.missions.completed) || [];
    var perRow = 7, cr = 12;
    for (var mi = 0; mi < doneList.length; mi++) {
      var num = mi + 1;
      var medal = medalFor(num);
      var mrow = Math.floor(mi / perRow);
      var mcol = mi % perRow;
      var mx = x + 24 + mcol * 36;
      var mcy = my + 38 + mrow * 28;
      ctx.fillStyle = medal.color;
      ctx.beginPath();
      ctx.arc(mx, mcy, cr, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#222';
      ctx.font = 'bold 12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(medal.letter, mx, mcy - 5);
      ctx.textAlign = 'left';
    }
    if (!doneList.length) {
      bodyText(ctx, 'No missions passed yet — medals land here.', x + 12, my + 44, 12, '#8a8a92');
    }
    return my + medalsH;
  }

  // One crew card: portrait, name, role, ability, effect, and either
  // READY in green or the live cooldown in orange, with a cooldown
  // fraction bar when the display data carries one.
  function drawCrewCard(ctx, member, x, y, w, h) {
    panel(ctx, x, y, w, h, 0.55);
    var colors = { tuck: '#3d7ea6', ines: '#c94f3d', kip: '#4a6b4f' };
    portrait(ctx, x + 28, y + 28, 20, colors[member.id] || '#8a8a92', (member.name || '?').charAt(0));
    headline(ctx, (member.name || '').toUpperCase() + '  ·  ' + (member.role || '').toUpperCase(), x + 56, y + 10, 14, '#fff');
    bodyText(ctx, (member.ability || '') + ' — ' + (member.effect || ''), x + 56, y + 32, 12, '#ffd166');
    if (member.label) {
      bodyText(ctx, member.label + '  ·  ' + (member.rpCost || 0) + ' RP', x + 56, y + 52, 12, member.ready ? '#4caf50' : '#ff8a5e');
    } else if (member.ready) {
      bodyText(ctx, 'READY  ·  ' + (member.rpCost || 0) + ' RP', x + 56, y + 52, 12, '#4caf50');
    } else {
      bodyText(ctx, 'COOLDOWN ' + (member.cooldownLeft || 0) + 's  ·  ' + (member.rpCost || 0) + ' RP', x + 56, y + 52, 12, '#ff8a5e');
    }
    if (!member.ready && typeof member.fraction === 'number') {
      bar(ctx, x + 56, y + h - 8, w - 68, 4, member.fraction, '#ff8a5e');
    }
  }

  // The garage strip: owned cars in a row plus one upgrade line and
  // the collection counts, from PalmaGarage.garageStrip when loaded.
  function drawGarageStrip(ctx, state, x, y, w) {
    panel(ctx, x, y, w, 64, 0.55);
    headline(ctx, 'GARAGE', x + 12, y + 8, 13, '#ffd166');
    var strip = null;
    if (window.PalmaGarage && window.PalmaGarage.garageStrip) {
      try { strip = window.PalmaGarage.garageStrip(state); } catch (e) { /* keep null */ }
    }
    if (strip) {
      var owned = strip.owned.length ? strip.owned.join('  ·  ') : 'Cometa GT';
      bodyText(ctx, fitText(ctx, owned, w - 24), x + 12, y + 30, 13, '#fff');
      var up = strip.upgrades;
      bodyText(ctx, strip.current.toUpperCase() + ' — ENGINE ' + up.engine + '  ·  ARMOR ' + up.armor + '  ·  PAINT ' + up.paint + '    ' + strip.carsOwned + '/' + strip.carsTotal + ' CARS  ·  ' + strip.propertiesOwned + '/3 PROPERTIES  ·  ' + strip.discsFound + '/' + strip.discsTotal + ' SUN-DISCS', x + 12, y + 50, 11, '#8a8a92');
    } else {
      var owned2 = (state.garage && state.garage.owned) || ['Cometa GT'];
      bodyText(ctx, owned2.join('  ·  '), x + 12, y + 30, 13, '#fff');
      var upgrades = (state.garage && state.garage.upgrades && state.garage.upgrades['Cometa GT']) || { engine: 0, armor: 0, paint: 'Factory' };
      bodyText(ctx, 'COMETA GT — ENGINE ' + (upgrades.engine || 0) + '  ·  ARMOR ' + (upgrades.armor || 0) + '  ·  PAINT ' + (upgrades.paint || 'Factory'), x + 12, y + 50, 11, '#8a8a92');
    }
  }

  // The three strict columns of the systems screen. `topY` is the
  // first row of the columns, `colH` their height, `showLabels`
  // draws the column captions (the dashboard has room for them; the
  // pause header does not). Returns the y just under the columns.
  function drawSystemsColumns(ctx, state, city, canvas, opts, topY, colH, showLabels) {
    var clockNow = clockStr(state.clockMinutes);
    if (showLabels) {
      headline(ctx, 'PROGRESS', COL_L.x, topY - 8, 13, '#ffd166');
      headline(ctx, 'FULL-CITY MAP', COL_C.x, topY - 8, 13, '#ffd166');
      headline(ctx, 'CAREER & SAVES', COL_R.x, topY - 8, 13, '#ffd166');
    }
    drawStatsGrid(ctx, state, COL_L.x, topY, COL_L.w, colH);
    drawFullMap(ctx, state, city, COL_C.x, topY, COL_C.w, colH - 32);
    var raceLine = '';
    if (window.PalmaGarage && window.PalmaGarage.raceSummary) {
      try {
        var races = window.PalmaGarage.raceSummary(state);
        if (races.length) raceLine = 'STREET RACE: ' + races[0].name.toUpperCase() + ' · ' + races[0].laps + ' LAPS · ' + moneyStr(races[0].payout);
      } catch (e) { /* keep empty */ }
    }
    if (!raceLine && state.waypoint) raceLine = 'WAYPOINT — ' + (state.waypoint.label || '').toUpperCase();
    if (raceLine) bodyText(ctx, raceLine, COL_C.x, topY + colH - 20, 12, '#ffd166');
    // Right column: career stats, rank card, save slots with progress.
    var rx = COL_R.x, rw = COL_R.w;
    var careerH = 132, rankH = 76, slotsHeader = 18, rgap = 8;
    var slotH = Math.max(64, Math.floor((colH - careerH - rankH - slotsHeader - rgap * 3) / 3));
    panel(ctx, rx, topY, rw, careerH, 0.55);
    headline(ctx, 'CAREER', rx + 12, topY + 8, 13, '#ffd166');
    var crows = careerRows(state);
    for (var ci = 0; ci < crows.length; ci++) {
      var cy = topY + 30 + ci * 20;
      bodyText(ctx, crows[ci].label, rx + 12, cy, 12, '#e8e8e8');
      ctx.fillStyle = '#ffd166';
      ctx.font = 'bold 12px system-ui, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(crows[ci].value, rx + rw - 12, cy);
      ctx.textAlign = 'left';
    }
    var ry = topY + careerH + rgap;
    var nums = dashNumbers(state);
    panel(ctx, rx, ry, rw, rankH, 0.55);
    headline(ctx, 'RANK ' + (nums.rankIndex || 1) + ' · ' + ((nums.rank && nums.rank.name) || 'Runner').toUpperCase(), rx + 12, ry + 8, 16, '#ffd166');
    bodyText(ctx, 'RP ' + (nums.rpInto || 0) + ' / ' + (nums.rpNeeded || 0) + '  ·  RESPECT ' + (nums.respect || 0), rx + 12, ry + 30, 12, '#e8e8e8');
    bar(ctx, rx + 12, ry + 50, rw - 24, 10, nums.rpFraction || 0, '#ffd166');
    var sy = ry + rankH + rgap;
    headline(ctx, 'SAVE SLOTS', rx, sy + 2, 13, '#ffd166');
    var slots = readSlots(opts);
    for (var s = 0; s < 3; s++) {
      drawSlotCard(ctx, slots[s] || { slot: s + 1, empty: true }, rx, sy + slotsHeader + s * (slotH + 8), rw, slotH, false, clockNow);
    }
    return topY + colH;
  }

  // Bottom band of the systems screen: three crew cards on the left,
  // the garage strip on the right. `y` is the band top, `h` its height.
  function drawSystemsBand(ctx, state, canvas, opts, y, h) {
    var crew = crewRows(state);
    var third = 200, gap = 10;
    for (var c = 0; c < 3; c++) {
      var mem = crew[c];
      if (!mem) continue;
      var cx = MARGIN + c * (third + gap);
      panel(ctx, cx, y, third, h, 0.6);
      headline(ctx, (mem.name || '').toUpperCase() + ' — ' + (mem.ability || '').toUpperCase(), cx + 10, y + 8, 12, '#ffd166');
      var status = mem.label || (mem.ready ? 'READY  ·  ' + (mem.rpCost || 0) + ' RP' : 'COOLDOWN ' + (mem.cooldownLeft || 0) + 's');
      bodyText(ctx, status, cx + 10, y + 30, 12, mem.ready ? '#4caf50' : '#ff8a5e');
      bodyText(ctx, fitText(ctx, mem.effect || '', third - 20), cx + 10, y + 50, 11, '#8a8a92');
    }
    drawGarageStrip(ctx, state, MARGIN + 3 * third + 2 * gap + 4, y, canvas.width - (MARGIN + 3 * third + 2 * gap + 4) - MARGIN);
  }

  function drawPauseHeader(ctx, state, canvas, tab) {
    var W = canvas.width;
    ctx.fillStyle = 'rgba(10,16,30,0.72)';
    ctx.fillRect(0, 0, W, canvas.height);
    headline(ctx, 'PAUSED — PALMA VERDE', 24, 20, 26, '#ffd166');
    bodyText(ctx, clockStr(state.clockMinutes) + '  ·  ' + (state.district ? state.district.name.toUpperCase() : 'PALMA VERDE') + '  ·  ' + moneyStr(state.player.money) + '  ·  ' + (state.wanted || 0) + '★ WANTED', 24, 52, 13, '#e8e8e8');
    var tx = 24;
    for (var i = 0; i < TABS.length; i++) {
      var t = TABS[i];
      var tw = 26 + t.label.length * 9;
      panel(ctx, tx, 76, tw, 30, t.id === tab ? 0.9 : 0.4);
      ctx.fillStyle = t.id === tab ? '#ffd166' : '#e8e8e8';
      ctx.font = 'bold 13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText((i + 1) + ' ' + t.label, tx + tw / 2, 84);
      ctx.textAlign = 'left';
      tx += tw + 8;
    }
    bodyText(ctx, 'Esc resume   ·   1–6 switch tab   ·   F9 save', W - 300, 84, 12, '#8a8a92');
  }

  // Pause menu. `tab` is one of map / missions / stats / crew /
  // garage / settings; the map tab is the default.
  function drawPause(ctx, state, city, canvas, tab, opts) {
    tab = tab || state.pauseTab || 'map';
    drawPauseHeader(ctx, state, canvas, tab);
    var W = canvas.width, H = canvas.height;
    var top = 122;
    if (tab === 'map') {
      drawFullMap(ctx, state, city, 24, top + 14, W - 48, H - top - 60);
      bodyText(ctx, state.waypoint ? ('WAYPOINT SET — ' + state.waypoint.label + '. The dashed route leads there.') : 'No waypoint set. The dashed route leads to the current mission marker.', 24, H - 24, 13, '#ffd166');
    } else if (tab === 'missions') {
      var rows = missionRows(state);
      for (var i = 0; i < rows.length; i++) {
        var m = rows[i];
        var my = top + i * 46;
        panel(ctx, 24, my, W - 48, 40, m.status === 'CURRENT' ? 0.8 : 0.5);
        ctx.fillStyle = m.status === 'DONE' ? '#4caf50' : (m.status === 'CURRENT' ? '#ffd166' : (m.status === 'OPEN' ? '#e8e8e8' : '#6a6a72'));
        ctx.font = 'bold 14px system-ui, sans-serif';
        ctx.fillText('MISSION ' + m.num, 38, my + 6);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 15px system-ui, sans-serif';
        ctx.fillText(m.name.toUpperCase() + '  ·  ' + m.act, 170, my + 6);
        ctx.fillStyle = '#8a8a92';
        ctx.font = '12px system-ui, sans-serif';
        ctx.fillText(m.giver + '  ·  ' + m.stages + ' STAGES  ·  ' + moneyStr(m.payout) + '  ·  +' + m.rp + ' RP', 170, my + 24);
        ctx.fillStyle = m.status === 'DONE' ? '#4caf50' : (m.status === 'CURRENT' ? '#ffd166' : '#8a8a92');
        ctx.font = 'bold 13px system-ui, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(m.status, W - 38, my + 12);
        ctx.textAlign = 'left';
      }
    } else if (tab === 'stats') {
      var endY = drawSystemsColumns(ctx, state, city, canvas, opts, top, 470, false);
      drawSystemsBand(ctx, state, canvas, opts, endY + 16, 74);
    } else if (tab === 'crew') {
      var members = crewRows(state);
      for (var k = 0; k < members.length; k++) {
        var mem = members[k];
        var ky = top + k * 118;
        drawCrewCard(ctx, mem, 24, ky, W - 48, 70);
        var blurb = {
          tuck: 'Tuck drives anything with wheels and swaps plates mid-chase so the cruisers lose the scent.',
          ines: 'Ines keeps the cars alive. She talks Rey through a roadside patch over the radio.',
          kip: 'Kip watches the scanners from a rooftop and calls every PVPD unit he hears.'
        }[mem.id] || '';
        var blines = wrapLines(blurb, 110);
        for (var b = 0; b < blines.length; b++) {
          bodyText(ctx, blines[b], 24, ky + 80 + b * 18, 13, '#c9d2e0');
        }
      }
    } else if (tab === 'garage') {
      var rows2 = [];
      if (window.PalmaGarage && window.PalmaGarage.garageRows) {
        try { rows2 = window.PalmaGarage.garageRows(state); } catch (e) { /* keep empty */ }
      }
      for (var g = 0; g < rows2.length; g++) {
        var row = rows2[g];
        var gy = top + g * 92;
        panel(ctx, 24, gy, W - 48, 84, 0.55);
        headline(ctx, row.row, 38, gy + 8, 15, '#ffd166');
        bodyText(ctx, row.blurb, 38, gy + 30, 12, '#c9d2e0');
        var lx = 38;
        for (var l = 0; l < row.levels.length; l++) {
          var lv = row.levels[l];
          bodyText(ctx, (lv.bought ? '✓ ' : '') + lv.name + ' — ' + moneyStr(lv.price), lx, gy + 56, 12, lv.bought ? '#4caf50' : '#fff');
          lx += 260;
        }
      }
      drawGarageStrip(ctx, state, 24, top + rows2.length * 92 + 8, W - 48);
    } else if (tab === 'settings') {
      panel(ctx, 24, top, W - 48, 220, 0.55);
      headline(ctx, 'CONTROLS', 38, top + 12, 15, '#ffd166');
      var lines = [
        'WASD / Arrows — walk and drive',
        'E — enter & exit car    ·    Mouse — aim    ·    Click — fire    ·    R — reload',
        'Q — switch radio station    ·    Z / X / V — call Tuck / Ines / Kip',
        'Esc / P — pause    ·    F9 — save to slot 1    ·    M — set waypoint on the mission marker',
        'RADIO: Onda 98.4  ·  Sol FM  ·  Static Coast — synthesized in-game, no audio files.',
        'SUBTITLES: on    ·    CAMERA: follow, 2.5D oblique    ·    LANGUAGE: English'
      ];
      for (var li = 0; li < lines.length; li++) {
        bodyText(ctx, lines[li], 38, top + 44 + li * 24, 13, '#e8e8e8');
      }
    }
  }

  // Shot-3 layout: the three strict columns (progress, full-city
  // map, career + saves) with the crew and the garage strip along
  // the bottom — every system in one frame, nothing overlapping.
  function drawDashboard(ctx, state, city, canvas, opts) {
    var W = canvas.width, H = canvas.height;
    ctx.fillStyle = 'rgba(10,16,30,0.78)';
    ctx.fillRect(0, 0, W, H);
    // The header band is fully opaque, down past the column tops:
    // the wash above lets the live HUD ghost through — the mission
    // and player panels top-left, the money and crew cards
    // top-right — and those HUD panels sit behind the first ~140 px
    // of the columns, not just behind the title. The columns draw
    // over the band, so nothing the dashboard owns is lost.
    ctx.fillStyle = 'rgba(10,16,30,1)';
    ctx.fillRect(0, 0, W, 240);
    headline(ctx, 'PALMA VERDE — MAP & STATS', 24, 18, 24, '#ffd166');
    bodyText(ctx, clockStr(state.clockMinutes) + '  ·  ' + (state.district ? state.district.name.toUpperCase() : 'PALMA VERDE') + '  ·  ' + moneyStr(state.player.money), 24, 48, 13, '#e8e8e8');
    var endY = drawSystemsColumns(ctx, state, city, canvas, opts, 96, 520, true);
    drawSystemsBand(ctx, state, canvas, opts, endY + 16, 74);
  }

  // The MISSION PASSED card: gold banner, payout, RP, and progress.
  function drawMissionPassed(ctx, state, canvas, banner) {
    var W = canvas.width, H = canvas.height;
    var b = banner || {};
    var w = 560, h = 260;
    var x = (W - w) / 2, y = (H - h) / 2;
    ctx.fillStyle = 'rgba(10,16,30,0.6)';
    ctx.fillRect(0, 0, W, H);
    panel(ctx, x, y, w, h, 0.92);
    ctx.fillStyle = '#ffd166';
    ctx.fillRect(x, y, w, 6);
    ctx.fillRect(x, y + h - 6, w, 6);
    headline(ctx, 'MISSION PASSED', W / 2, y + 24, 34, '#ffd166', 'center');
    headline(ctx, (b.name || 'MISSION COMPLETE').toUpperCase(), W / 2, y + 74, 20, '#fff', 'center');
    bodyText(ctx, '+' + moneyStr(b.payout || 0) + '      +' + (b.rp || 0) + ' RP', W / 2 - 90, y + 116, 18, '#4caf50');
    bodyText(ctx, 'MISSIONS COMPLETE: ' + (b.completedCount || ((state.missions && state.missions.completed) || []).length) + ' / ' + (b.totalMissions || CATALOGUE.missions), W / 2 - 110, y + 148, 14, '#e8e8e8');
    bodyText(ctx, 'COMPLETION ' + Math.round(state.completion || 0) + '%   ·   PRESS ENTER TO CONTINUE', W / 2 - 170, y + 184, 13, '#8a8a92');
    ctx.textAlign = 'left';
  }

  // Waypoint: point the dashed route at a district centre by name.
  // The pause map draws it; the minimap route follows missionTarget.
  function setWaypoint(state, city, label) {
    var districts = city.districts || (CFG ? CFG.DISTRICTS : []);
    var found = null;
    for (var i = 0; i < districts.length; i++) {
      if (districts[i].name.toLowerCase() === String(label || '').toLowerCase()) {
        found = districts[i];
        break;
      }
    }
    if (!found) found = districts[0];
    if (!found) return null;
    var wp = {
      x: (found.x0 + found.x1) / 2,
      y: (found.y0 + found.y1) / 2,
      label: found.name
    };
    state.waypoint = wp;
    state.missionTarget = { x: wp.x, y: wp.y };
    return wp;
  }

  function clearWaypoint(state) {
    state.waypoint = null;
    state.missionTarget = null;
    return true;
  }

  window.PalmaScreens = {
    TABS: TABS,
    CATALOGUE: CATALOGUE,
    drawTitle: drawTitle,
    drawPause: drawPause,
    drawFullMap: drawFullMap,
    drawStatsGrid: drawStatsGrid,
    drawDashboard: drawDashboard,
    drawMissionPassed: drawMissionPassed,
    drawSlotCard: drawSlotCard,
    setWaypoint: setWaypoint,
    clearWaypoint: clearWaypoint,
    missionRows: missionRows,
    crewRows: crewRows,
    dashNumbers: dashNumbers,
    readSlots: readSlots
  };
})();
