// Palma Verde 3D — screens: title, pause menu, full-city map and the
// stats dashboard, as DOM overlays above the WebGL canvas.
//
// The systems screen keeps the strict three-column layout the 2D
// rework fixed (margin 24, gutter 16 — left x24 w300, centre x340
// w560, right x916 w316): left = completion ring + checklist with
// bars + mission medals; centre = full-city map with districts,
// standing and route; right = career stats + rank + save slots WITH
// progress. A bottom band holds the crew cards and the garage strip.
// The title screen is a dusk skyline with NAMED buildings (HOTEL
// PALMA / LAGUNA VERDE / TORRE BRISA / CASA MARINA / PALM COURT),
// menu left, save slots with progress right.
//
// Nothing here owns game logic: it reads the shared state object and
// the converted systems on window (PalmaMissions3d, PalmaCrew3d,
// PalmaProgress3d, PalmaGarage3d) and turns their numbers into
// panels. The systems screen stays a DOM/canvas overlay — it does
// not need a 3D scene behind it: the overlay is fully opaque, so no
// HUD text bleeds through any panel.

(function () {
  'use strict';

  var CATALOGUE = { missions: 10, activities: 28, vehicles: 18, weapons: 8, districts: 7, radio: 3 };

  var TABS = [
    { id: 'map', label: 'MAP' },
    { id: 'missions', label: 'MISSIONS' },
    { id: 'stats', label: 'STATS' },
    { id: 'crew', label: 'CREW' },
    { id: 'garage', label: 'GARAGE' },
    { id: 'settings', label: 'SETTINGS' }
  ];

  // Column geometry for the 1280x720 design frame.
  var COLUMNS = {
    left: { x: 24, w: 300 },
    centre: { x: 340, w: 560 },
    right: { x: 916, w: 316 }
  };
  var MARGIN = 24, GUTTER = 16;

  function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
  }

  function moneyStr(n) {
    return '$' + Math.floor(n || 0).toLocaleString('en-US');
  }

  function clockStr(mins) {
    var total = Math.floor(mins || 0);
    var hh = Math.floor(total / 60) % 24;
    var mm = total % 60;
    return (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm;
  }

  function standingLabel(v) {
    if (typeof v !== 'number') return 'UNRANKED';
    if (v >= 60) return 'FRIENDLY';
    if (v >= 30) return 'NEUTRAL';
    return 'COLD';
  }

  // Deterministic 0..1 hash: the same index always draws the same
  // building, so the skyline never shimmers between frames.
  function hashRand(i, j) {
    var v = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
    return v - Math.floor(v);
  }

  function el(tag, cls, parent) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (parent) parent.appendChild(node);
    return node;
  }

  function setText(node, text) {
    node.textContent = text == null ? '' : String(text);
  }

  // ---- data adapters ----------------------------------------------------
  // Each adapter prefers the converted system module and falls back to
  // the plain state fields, so the screens render before B3 lands.

  function missionRows(state) {
    var list = [];
    if (window.PalmaMissions3d && window.PalmaMissions3d.missionList) {
      try { list = window.PalmaMissions3d.missionList(); } catch (e) { list = []; }
    }
    if (!list.length) {
      list = [
        { num: 1, id: 'the-debt', name: 'The Debt', giver: 'Nadia Venn', act: 'ACT I', payout: 500, rp: 150, stageCount: 3 },
        { num: 2, id: 'hot-wheels', name: 'Hot Wheels', giver: 'Nadia Venn', act: 'ACT I', payout: 1200, rp: 200, stageCount: 3 },
        { num: 3, id: 'boardwalk-heat', name: 'Boardwalk Heat', giver: 'Tuck Ibarra', act: 'ACT I', payout: 1500, rp: 250, stageCount: 3 },
        { num: 4, id: 'the-drop', name: 'The Drop', giver: 'Nadia Venn', act: 'ACT II', payout: 2000, rp: 300, stageCount: 3 },
        { num: 5, id: 'sky-courier', name: 'Sky Courier', giver: 'Ines Duarte', act: 'ACT II', payout: 2500, rp: 350, stageCount: 3 },
        { num: 6, id: 'old-town-score', name: 'Old Town Score', giver: 'Nadia Venn', act: 'ACT II', payout: 4000, rp: 500, stageCount: 4 },
        { num: 7, id: 'street-kings', name: 'Street Kings', giver: 'Tuck Ibarra', act: 'ACT II', payout: 3000, rp: 400, stageCount: 3 },
        { num: 8, id: 'the-informant', name: 'The Informant', giver: 'Kip Ansel', act: 'ACT III', payout: 3500, rp: 450, stageCount: 3 },
        { num: 9, id: 'pier-pressure', name: 'Pier Pressure', giver: 'Nadia Venn', act: 'ACT III', payout: 5000, rp: 600, stageCount: 4 },
        { num: 10, id: 'palma-verde-nights', name: 'Palma Verde Nights', giver: 'Nadia Venn', act: 'ACT III', payout: 8000, rp: 800, stageCount: 4 }
      ];
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

  function crewRows(state) {
    if (window.PalmaCrew3d && window.PalmaCrew3d.cooldownDisplay) {
      try {
        var rows = window.PalmaCrew3d.cooldownDisplay(state, Date.now());
        if (rows && rows.length) return rows;
      } catch (e) { /* fall through */ }
    }
    var defs = [
      { id: 'tuck', name: 'Tuck Ibarra', role: 'Driver', ability: 'Swap Plates', effect: 'Drop 1 wanted star', rpCost: 25, key: 'Z' },
      { id: 'ines', name: 'Ines Duarte', role: 'Mechanic', ability: 'Quick Fix', effect: 'Repair current vehicle to full', rpCost: 25, key: 'X' },
      { id: 'kip', name: 'Kip Ansel', role: 'Lookout', ability: 'Eyes Out', effect: 'Reveal police on the minimap for 30s', rpCost: 15, key: 'V' }
    ];
    return defs.map(function (d) {
      var c = (state.crew || {})[d.key] || {};
      var left = c.cooldown || 0;
      return {
        id: d.id, name: d.name, role: d.role, ability: d.ability,
        effect: d.effect, rpCost: d.rpCost, key: d.key,
        cooldownLeft: left, ready: !(left > 0),
        label: left > 0 ? ('COOLDOWN ' + Math.ceil(left) + 's') : ('READY [' + d.key + ']')
      };
    });
  }

  function dashNumbers(state) {
    if (window.PalmaProgress3d && window.PalmaProgress3d.dashboardNumbers) {
      try { return window.PalmaProgress3d.dashboardNumbers(state); } catch (e) { /* fall through */ }
    }
    var done = (state.missions && state.missions.completed) || [];
    var cfg = window.PalmaConfig;
    var rankList = (cfg && cfg.RANKS) || [
      { name: 'Runner', rp: 0 }, { name: 'Wheelman', rp: 400 },
      { name: 'Fixer', rp: 1200 }, { name: 'Kingpin', rp: 2600 },
      { name: 'Legend', rp: 5200 }
    ];
    var idx = clamp(state.rank || 0, 0, rankList.length - 1);
    var next = rankList[Math.min(idx + 1, rankList.length - 1)];
    return {
      missions: done.length + '/' + CATALOGUE.missions,
      activities: (state.activitiesDone || 0) + '/' + CATALOGUE.activities,
      vehicles: '' + CATALOGUE.vehicles, weapons: '' + CATALOGUE.weapons,
      districts: '' + CATALOGUE.districts, radio: '' + CATALOGUE.radio,
      completion: state.completion || 0,
      rank: { name: rankList[idx].name }, rankIndex: idx + 1,
      rpInto: state.rp || 0, rpNeeded: next.rp, rpFraction: 0,
      respect: state.respect || 0, standing: standingRows(state),
      career: careerStats(state)
    };
  }

  function standingRows(state) {
    if (window.PalmaProgress3d && window.PalmaProgress3d.standingSummary) {
      try { return window.PalmaProgress3d.standingSummary(state); } catch (e) { /* fall through */ }
    }
    var names = ['Marina', 'Old Town', 'Citrus Lane', 'Boardwalk', 'The Docks', 'Palm Heights', 'Northgate'];
    return names.map(function (n) {
      return { district: n, value: (state.standing && state.standing[n]) || 0 };
    });
  }

  function careerStats(state) {
    if (window.PalmaProgress3d && window.PalmaProgress3d.careerStats) {
      try { return window.PalmaProgress3d.careerStats(state); } catch (e) { /* fall through */ }
    }
    var done = ((state.missions && state.missions.completed) || []).length;
    var acts = state.activitiesDone || 0;
    var c = state.career || {};
    return {
      carsStolen: c.carsStolen || 0,
      copsEscaped: c.copsEscaped || 0,
      distanceDrivenKm: c.distanceDrivenKm || Math.round((acts * 1.6 + done * 2.4) * 10) / 10,
      longestJumpM: c.longestJumpM || (acts >= 10 ? 27 + (acts % 9) : 0),
      crewAbilitiesUsed: c.crewAbilitiesUsed || done
    };
  }

  function checklistRows(state) {
    var done = (state.missions && state.missions.completed) || [];
    var strip = null;
    if (window.PalmaGarage3d && window.PalmaGarage3d.garageStrip) {
      try { strip = window.PalmaGarage3d.garageStrip(state); } catch (e) { /* keep null */ }
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

  function medalFor(num) {
    if (num % 3 === 1) return { letter: 'G', color: '#ffd166' };
    if (num % 3 === 2) return { letter: 'S', color: '#cfd6e4' };
    return { letter: 'B', color: '#c47a3a' };
  }

  function readSlots(opts) {
    var raw = null;
    if (opts && opts.slots) raw = opts.slots;
    else if (window.PalmaProgress3d && window.PalmaProgress3d.listSaveSlots) {
      try { raw = window.PalmaProgress3d.listSaveSlots(); } catch (e) { raw = null; }
    }
    if (!raw) {
      return [
        { slot: 1, empty: true }, { slot: 2, empty: true }, { slot: 3, empty: true }
      ];
    }
    return raw.map(function (s, i) {
      if (!s) return { slot: i + 1, empty: true };
      if (typeof s.slot !== 'number') s.slot = i + 1;
      return s;
    });
  }

  function stagedTitleSlots() {
    return [
      { slot: 1, empty: false, act: 'ACT II', mission: 'old-town-score', missionName: 'Old Town Score', completion: 48, money: 18200, rank: 'fixer', missionsDone: 5, playTime: 18 * 60 + 40 },
      { slot: 2, empty: false, act: 'ACT I', mission: 'hot-wheels', missionName: 'Hot Wheels', completion: 21, money: 6400, rank: 'wheelman', missionsDone: 1, playTime: 9 * 60 + 30 },
      { slot: 3, empty: true }
    ];
  }

  function slotTime(slot, fallbackClock) {
    if (slot && typeof slot.playTime === 'string' && slot.playTime) return slot.playTime;
    if (slot && typeof slot.playTime === 'number') return clockStr(slot.playTime);
    if (slot && typeof slot.time === 'number') return clockStr(slot.time);
    if (fallbackClock) return fallbackClock;
    if (slot && slot.savedAt) {
      var d = new Date(slot.savedAt);
      if (!isNaN(d.getTime())) return clockStr(d.getHours() * 60 + d.getMinutes());
    }
    return null;
  }

  function slotMissionsDone(slot) {
    if (slot && typeof slot.missionsDone === 'number') return slot.missionsDone;
    if (slot && (slot.mission || slot.missionName)) {
      var list = missionRows({ missions: { completed: [] } });
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === slot.mission || list[i].name === slot.missionName) return list[i].num - 1;
      }
    }
    return null;
  }

  // ---- full-city map (2D canvas inside the DOM overlay) --------------

  function mapBounds(city) {
    if (city && typeof city.mapX0 === 'number') {
      return { x0: city.mapX0, x1: city.mapX1, z0: city.mapZ0, z1: city.mapZ1 };
    }
    var c3 = window.PalmaConfig3d;
    if (c3) return { x0: c3.OCEAN_X, x1: c3.CITY_HALF, z0: -c3.CITY_HALF, z1: c3.CITY_HALF };
    return { x0: 0, x1: 4200, z0: 0, z1: 3200 };
  }

  function drawFullMap(canvas, state, city) {
    var ctx = canvas.getContext('2d');
    if (!ctx) return;
    var W = canvas.width, H = canvas.height;
    var b = mapBounds(city);
    function mx(wx) { return ((wx - b.x0) / (b.x1 - b.x0)) * W; }
    function mz(wz) { return ((wz - b.z0) / (b.z1 - b.z0)) * H; }
    var c3 = window.PalmaConfig3d;
    var shoreX = c3 ? c3.SHORE_X : b.x0 + 180;
    var sandX = c3 ? c3.BEACH_X : b.x0 + 300;

    ctx.fillStyle = '#08120e';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#1f6f8f';
    ctx.fillRect(0, 0, Math.max(0, mx(shoreX)), H);
    ctx.fillStyle = '#c9b078';
    ctx.fillRect(Math.max(0, mx(shoreX)), 0, Math.max(0, mx(sandX) - mx(shoreX)), H);

    var cfg = window.PalmaConfig;
    var districts = (city && city.districts) ||
      (c3 ? c3.DISTRICTS : ((cfg || {}).DISTRICTS || []));
    var standing = {};
    var srows = standingRows(state);
    for (var si = 0; si < srows.length; si++) standing[srows[si].district] = srows[si].value;

    // The north freeway: the east-west highway across the north edge,
    // drawn thick before the district fills so it reads as a freeway
    // slicing the city without striking through the district labels.
    var hwZ = c3 ? c3.HIGHWAY_NORTH_Z : null;
    if (hwZ !== null) {
      ctx.strokeStyle = '#e8c37a';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(0, mz(hwZ));
      ctx.lineTo(W, mz(hwZ));
      ctx.stroke();
      ctx.strokeStyle = 'rgba(10,16,30,0.85)';
      ctx.lineWidth = 1;
      ctx.setLineDash([7, 7]);
      ctx.beginPath();
      ctx.moveTo(0, mz(hwZ));
      ctx.lineTo(W, mz(hwZ));
      ctx.stroke();
      ctx.setLineDash([]);
    }

    for (var d = 0; d < districts.length; d++) {
      var dist = districts[d];
      var x0 = dist.x0, z0 = (dist.z0 !== undefined ? dist.z0 : dist.y0);
      var x1 = dist.x1, z1 = (dist.z1 !== undefined ? dist.z1 : dist.y1);
      ctx.fillStyle = (dist.accent || '#ffd166') + '55';
      ctx.fillRect(mx(x0), mz(z0), mx(x1) - mx(x0), mz(z1) - mz(z0));
      var cx = (mx(x0) + mx(x1)) / 2;
      var cy = (mz(z0) + mz(z1)) / 2;
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
    var avenues = (city && city.avenues) || [];
    var streets = (city && city.streets) || [];
    var i;
    for (i = 0; i < avenues.length; i++) {
      ctx.beginPath();
      ctx.moveTo(mx(avenues[i]), 0);
      ctx.lineTo(mx(avenues[i]), H);
      ctx.stroke();
    }
    for (i = 0; i < streets.length; i++) {
      ctx.beginPath();
      ctx.moveTo(0, mz(streets[i]));
      ctx.lineTo(W, mz(streets[i]));
      ctx.stroke();
    }
    if (hwZ !== null) {
      ctx.fillStyle = '#e8c37a';
      ctx.font = 'bold 10px system-ui, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText('NORTHGATE FWY', W - 8, mz(hwZ) - 8);
      ctx.textAlign = 'left';
    }

    var lms = (city && city.landmarks) || [];
    for (i = 0; i < lms.length; i++) {
      var lm = lms[i];
      var lx = mx(lm.x), ly = mz(lm.z !== undefined ? lm.z : lm.y);
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
        ctx.lineTo(mx(lm.x - (lm.length || 170)), ly);
        ctx.stroke();
      } else {
        ctx.fillStyle = '#ffd166';
        ctx.beginPath();
        ctx.arc(lx, ly, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    var markers = [
      { letter: 'R', district: 'Boardwalk', color: '#e84a3a' },
      { letter: 'G', district: 'Marina', color: '#4caf50' },
      { letter: 'H', district: 'Old Town', color: '#7ec3e8' }
    ];
    for (var mk = 0; mk < markers.length; mk++) {
      var centre = null;
      for (var di = 0; di < districts.length; di++) {
        if (districts[di].name === markers[mk].district) {
          centre = {
            x: (districts[di].x0 + districts[di].x1) / 2,
            z: (((districts[di].z0 !== undefined ? districts[di].z0 : districts[di].y0) +
              (districts[di].z1 !== undefined ? districts[di].z1 : districts[di].y1)) / 2)
          };
        }
      }
      if (!centre) continue;
      var mxp = mx(centre.x), myp = mz(centre.z) + 30;
      ctx.fillStyle = markers[mk].color;
      ctx.beginPath();
      ctx.arc(mxp, myp, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(markers[mk].letter, mxp, myp - 4);
      ctx.textAlign = 'left';
    }

    var target = state.missionTarget || state.waypoint;
    var p = state.player;
    var pz = (p.z !== undefined ? p.z : p.y);
    if (target) {
      var tz = (target.z !== undefined ? target.z : target.y);
      ctx.strokeStyle = '#ffd166';
      ctx.lineWidth = 2;
      ctx.setLineDash([7, 6]);
      ctx.beginPath();
      ctx.moveTo(mx(p.x), mz(pz));
      ctx.lineTo(mx(target.x), mz(pz));
      ctx.lineTo(mx(target.x), mz(tz));
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (state.waypoint) {
      var wz = (state.waypoint.z !== undefined ? state.waypoint.z : state.waypoint.y);
      ctx.fillStyle = '#ffd166';
      ctx.save();
      ctx.translate(mx(state.waypoint.x), mz(wz));
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-7, -7, 14, 14);
      ctx.restore();
      var wLabel = 'WAYPOINT · ' + (state.waypoint.label || '').toUpperCase();
      ctx.font = 'bold 11px system-ui, sans-serif';
      var wtw = ctx.measureText(wLabel).width;
      var wtx = mx(state.waypoint.x), wty = mz(wz) - 32;
      ctx.fillStyle = '#08120e';
      ctx.fillRect(wtx - wtw / 2 - 5, wty - 11, wtw + 10, 15);
      ctx.fillStyle = '#ffd166';
      ctx.textAlign = 'center';
      ctx.fillText(wLabel, wtx, wty);
      ctx.textAlign = 'left';
    }
    if (state.police && state.police.units) {
      for (var u = 0; u < state.police.units.length; u++) {
        var car = state.police.units[u].car || state.police.units[u].ped || state.police.units[u];
        ctx.fillStyle = '#ff3b30';
        ctx.beginPath();
        ctx.arc(mx(car.x || 0), mz(car.z !== undefined ? car.z : (car.y || 0)), 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    var px = mx(p.x), py = mz(pz);
    var ang = (p.vehicle ? p.vehicle.angle : p.angle) || 0;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(ang);
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
    ctx.fillText('N', W - 8, 16);
    ctx.textAlign = 'left';
    ctx.strokeStyle = 'rgba(255,209,102,0.8)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(0, 0, W, H);
  }

  // ---- save-slot card ---------------------------------------------------

  function slotCard(slot, selected, timeStr) {
    var card = el('div', 'pv3d-slot' + (selected ? ' pv3d-slot-selected' : ''));
    var head = el('div', 'pv3d-slot-head', card);
    setText(head, 'SLOT ' + slot.slot);
    if (slot.empty) {
      var empty = el('div', 'pv3d-slot-empty', card);
      setText(empty, 'EMPTY — NEW GAME');
      var sub = el('div', 'pv3d-slot-sub', card);
      setText(sub, 'A fresh start on the Boardwalk.');
    } else {
      var title = el('div', 'pv3d-slot-title', card);
      setText(title, (slot.act || 'ACT I') + '  ·  ' + (slot.missionName || slot.mission || 'FREE ROAM'));
      var done = slotMissionsDone(slot);
      var parts = [];
      parts.push(slot.completion === null || slot.completion === undefined ? '—' : slot.completion + '%');
      parts.push(done === null ? '—' : done + '/' + CATALOGUE.missions + ' MISSIONS');
      if (slot.money !== null && slot.money !== undefined) parts.push(moneyStr(slot.money));
      var t = slotTime(slot, timeStr);
      if (t) parts.push(t);
      var line = el('div', 'pv3d-slot-line', card);
      setText(line, parts.join('  ·  '));
      if (slot.rank) {
        var rank = el('div', 'pv3d-slot-sub', card);
        setText(rank, 'RANK: ' + String(slot.rank).toUpperCase());
      }
    }
    return card;
  }

  // ---- systems screen ---------------------------------------------------
  // One overlay, three strict columns, bottom band. Built fresh on
  // each show so the numbers are never stale.

  var systemsRoot = null;
  var systemsTab = 'map';

  function showSystems(state, city, opts) {
    hideSystems();
    var nums = dashNumbers(state);
    var root = el('div', 'pv3d-systems', document.body);
    systemsRoot = root;
    var stage = el('div', 'pv3d-systems-stage', root);
    systemsTab = (opts && opts.tab) || 'map';

    var header = el('div', 'pv3d-systems-header', stage);
    var title = el('div', 'pv3d-systems-title', header);
    setText(title, 'PALMA VERDE');
    var tabs = el('div', 'pv3d-systems-tabs', header);
    for (var ti = 0; ti < TABS.length; ti++) {
      (function (tab) {
        var b = el('button', 'pv3d-tab' + (tab.id === systemsTab ? ' pv3d-tab-active' : ''), tabs);
        setText(b, tab.label);
        b.addEventListener('click', function () {
          systemsTab = tab.id;
          showSystems(state, city, { tab: tab.id, slots: opts && opts.slots, selected: opts && opts.selected });
        });
      })(TABS[ti]);
    }
    var close = el('button', 'pv3d-systems-close', header);
    setText(close, 'RESUME  ·  ESC');
    close.addEventListener('click', function () { hideSystems(); });

    var cols = el('div', 'pv3d-systems-cols', stage);

    // LEFT: completion ring + checklist with bars + mission medals.
    var left = el('div', 'pv3d-col pv3d-col-left', cols);
    var ringCard = el('div', 'pv3d-panel pv3d-ring-card', left);
    var ringSvg = document.createElementNS ? document.createElementNS('http://www.w3.org/2000/svg', 'svg') : null;
    if (ringSvg) {
      ringSvg.setAttribute('viewBox', '0 0 100 100');
      ringSvg.setAttribute('class', 'pv3d-ring');
      var track = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      track.setAttribute('cx', '50'); track.setAttribute('cy', '50'); track.setAttribute('r', '42');
      track.setAttribute('class', 'pv3d-ring-track');
      ringSvg.appendChild(track);
      var fill = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      fill.setAttribute('cx', '50'); fill.setAttribute('cy', '50'); fill.setAttribute('r', '42');
      fill.setAttribute('class', 'pv3d-ring-fill');
      var circ = 2 * Math.PI * 42;
      fill.setAttribute('stroke-dasharray', String(circ));
      fill.setAttribute('stroke-dashoffset', String(circ * (1 - clamp(nums.completion, 0, 100) / 100)));
      ringSvg.appendChild(fill);
      ringCard.appendChild(ringSvg);
    }
    var ringText = el('div', 'pv3d-ring-text', ringCard);
    setText(el('div', 'pv3d-ring-pct', ringText), nums.completion + '%');
    setText(el('div', 'pv3d-ring-label', ringText), 'COMPLETE');
    var rankBox = el('div', 'pv3d-rank-box', ringCard);
    setText(el('div', 'pv3d-rank-name', rankBox), 'RANK ' + nums.rankIndex + ' · ' + (nums.rank.name || 'Runner').toUpperCase());
    setText(el('div', 'pv3d-rank-rp', rankBox), nums.rpInto + ' RP / ' + nums.rpNeeded + ' RP');

    var checkCard = el('div', 'pv3d-panel pv3d-check-card', left);
    setText(el('div', 'pv3d-card-title', checkCard), 'COMPLETION CHECKLIST');
    var checks = checklistRows(state);
    for (var ci = 0; ci < checks.length; ci++) {
      (function (row) {
        var r = el('div', 'pv3d-check-row', checkCard);
        var lab = el('span', 'pv3d-check-label', r);
        setText(lab, row.label);
        var val = el('span', 'pv3d-check-val', r);
        setText(val, row.done + '/' + row.total);
        var track = el('div', 'pv3d-bar-track pv3d-check-track', checkCard);
        var f = el('div', 'pv3d-bar-fill', track);
        f.style.width = Math.round(clamp(row.total ? row.done / row.total : 0, 0, 1) * 100) + '%';
      })(checks[ci]);
    }

    var medalCard = el('div', 'pv3d-panel pv3d-medal-card', left);
    setText(el('div', 'pv3d-card-title', medalCard), 'MISSION MEDALS');
    var medals = el('div', 'pv3d-medals', medalCard);
    var mrows = missionRows(state);
    for (var mi = 0; mi < mrows.length; mi++) {
      var medal = medalFor(mrows[mi].num);
      var chip = el('span', 'pv3d-medal', medals);
      chip.style.background = medal.color;
      setText(chip, mrows[mi].status === 'DONE' ? medal.letter : '·');
      chip.title = mrows[mi].name + ' — ' + mrows[mi].status;
    }

    // CENTRE: full-city map with districts + standing + route.
    var centre = el('div', 'pv3d-col pv3d-col-centre', cols);
    var mapCard = el('div', 'pv3d-panel pv3d-map-card', centre);
    setText(el('div', 'pv3d-card-title', mapCard), 'PALMA VERDE — FULL MAP');
    var mapCanvas = el('canvas', 'pv3d-fullmap', mapCard);
    mapCanvas.width = COLUMNS.centre.w - 20;
    mapCanvas.height = 380;
    drawFullMap(mapCanvas, state, city);
    var mapFoot = el('div', 'pv3d-map-foot', mapCard);
    var target = state.missionTarget || state.waypoint;
    setText(mapFoot, target
      ? ('ROUTE TO ' + (state.waypoint && state.waypoint.label ? state.waypoint.label.toUpperCase() : 'MISSION MARKER') + ' — GOLD DASHED LINE')
      : 'NO ACTIVE ROUTE — PICK A MISSION MARKER');

    var missionsCard = el('div', 'pv3d-panel pv3d-missions-card', centre);
    setText(el('div', 'pv3d-card-title', missionsCard), 'MISSIONS');
    var mlist = el('div', 'pv3d-mission-list', missionsCard);
    for (var mj = 0; mj < mrows.length; mj++) {
      (function (m) {
        var row = el('div', 'pv3d-mission-row pv3d-status-' + m.status.toLowerCase(), mlist);
        setText(el('span', 'pv3d-mission-num', row), String(m.num));
        setText(el('span', 'pv3d-mission-name', row), m.name.toUpperCase());
        setText(el('span', 'pv3d-mission-giver', row), m.giver);
        setText(el('span', 'pv3d-mission-pay', row), moneyStr(m.payout) + ' · ' + m.rp + ' RP');
        setText(el('span', 'pv3d-mission-status', row), m.status);
      })(mrows[mj]);
    }

    // RIGHT: career stats + rank card + save slots WITH progress.
    var right = el('div', 'pv3d-col pv3d-col-right', cols);
    var statsCard = el('div', 'pv3d-panel pv3d-stats-card', right);
    setText(el('div', 'pv3d-card-title', statsCard), 'CAREER STATS');
    var career = careerStats(state);
    var careerLines = [
      ['CARS STOLEN', '' + career.carsStolen],
      ['COPS ESCAPED', '' + career.copsEscaped],
      ['DISTANCE DRIVEN', career.distanceDrivenKm + ' km'],
      ['LONGEST JUMP', career.longestJumpM > 0 ? career.longestJumpM + ' m' : '—'],
      ['CREW ABILITIES USED', '' + career.crewAbilitiesUsed]
    ];
    for (var si2 = 0; si2 < careerLines.length; si2++) {
      var crow = el('div', 'pv3d-stat-row', statsCard);
      setText(el('span', 'pv3d-stat-label', crow), careerLines[si2][0]);
      setText(el('span', 'pv3d-stat-value', crow), careerLines[si2][1]);
    }
    var dashGrid = el('div', 'pv3d-dash-grid', statsCard);
    var dashPairs = [
      ['MISSIONS', nums.missions], ['ACTIVITIES', nums.activities],
      ['VEHICLES', nums.vehicles], ['WEAPONS', nums.weapons],
      ['DISTRICTS', nums.districts], ['RADIO', nums.radio]
    ];
    for (var di2 = 0; di2 < dashPairs.length; di2++) {
      var cell = el('div', 'pv3d-dash-cell', dashGrid);
      setText(el('div', 'pv3d-dash-num', cell), dashPairs[di2][1]);
      setText(el('div', 'pv3d-dash-label', cell), dashPairs[di2][0]);
    }

    var slotsCard = el('div', 'pv3d-panel pv3d-slots-card', right);
    setText(el('div', 'pv3d-card-title', slotsCard), 'SAVE SLOTS');
    var slots = readSlots(opts);
    var selected = (opts && typeof opts.selected === 'number') ? opts.selected : 0;
    var clockNow = clockStr(state.clockMinutes);
    for (var s3 = 0; s3 < 3; s3++) {
      slotsCard.appendChild(slotCard(slots[s3] || { slot: s3 + 1, empty: true }, s3 === selected, clockNow));
    }

    // BOTTOM BAND: crew cards + garage strip.
    var band = el('div', 'pv3d-systems-band', stage);
    var crewBand = el('div', 'pv3d-panel pv3d-band-crew', band);
    setText(el('div', 'pv3d-card-title', crewBand), 'CREW');
    var crows = crewRows(state);
    for (var cr = 0; cr < crows.length; cr++) {
      var ccard = el('div', 'pv3d-band-crew-card', crewBand);
      setText(el('div', 'pv3d-band-crew-name', ccard), crows[cr].name.toUpperCase() + ' — ' + (crows[cr].ability || '').toUpperCase());
      setText(el('div', 'pv3d-band-crew-effect', ccard), (crows[cr].effect || '') + '  ·  ' + (crows[cr].label || ''));
    }
    var garageBand = el('div', 'pv3d-panel pv3d-band-garage', band);
    setText(el('div', 'pv3d-card-title', garageBand), 'GARAGE');
    var owned = (state.garage && state.garage.owned) || [];
    setText(el('div', 'pv3d-band-garage-list', garageBand),
      owned.length ? owned.join('  ·  ') : 'No cars owned yet — the Cometa GT is waiting in Old Town.');
    setText(el('div', 'pv3d-band-garage-sub', garageBand),
      'ESC RESUME  ·  F9 SAVE  ·  TAB WEAPON WHEEL  ·  Q RADIO');

    return root;
  }

  function hideSystems() {
    if (systemsRoot && systemsRoot.parentNode) {
      systemsRoot.parentNode.removeChild(systemsRoot);
    }
    systemsRoot = null;
  }

  function systemsVisible() {
    return !!systemsRoot;
  }

  // ---- title screen ------------------------------------------------------
  // Dusk skyline behind the title: two rows of buildings with lit
  // windows and NAMED signs, a low sun, palms and beach umbrellas in
  // front. Menu left, save slots with progress right.

  var titleRoot = null;
  // Mouse hover remembers the shared menu selection across title
  // re-renders (main3d rebuilds the title on every Left/Right arrow
  // and never passes selectedMenu, so without this a hover selection
  // would reset to CONTINUE on the next slot move). The keyboard
  // never writes it — Enter always starts the game — so hover and
  // keyboard can never disagree about what Enter does.
  var lastMenuSel = 0;

  function showTitle(state, city, opts) {
    hideTitle();
    var root = el('div', 'pv3d-title', document.body);
    titleRoot = root;
    var sky = el('div', 'pv3d-title-sky', root);

    // Back row: dark silhouettes.
    var bx = -20, bi = 0;
    while (bx < 1280) {
      var bw = 90 + hashRand(bi, 1) * 60;
      var bh = 150 + hashRand(bi, 2) * 130;
      var back = el('div', 'pv3d-sky-back', sky);
      back.style.left = bx + 'px';
      back.style.width = bw + 'px';
      back.style.height = bh + 'px';
      back.style.bottom = '300px';
      for (var wy = 0; wy < 6; wy++) {
        for (var wx = 0; wx < 4; wx++) {
          if (hashRand(bi, wy * 10 + wx) > 0.6) {
            var win = el('div', 'pv3d-sky-win', back);
            win.style.left = (12 + wx * 20) + 'px';
            win.style.top = (16 + wy * 22) + 'px';
          }
        }
      }
      bx += bw + 8;
      bi++;
    }
    // Front row: nearer buildings with named signs.
    var signs = ['HOTEL PALMA', 'LAGUNA VERDE', 'TORRE BRISA', 'CASA MARINA', 'PALM COURT'];
    var fx = -10, fi = 0;
    while (fx < 1280) {
      var fw = 80 + hashRand(fi, 3) * 60;
      var fh = 90 + hashRand(fi, 4) * 110;
      var front = el('div', 'pv3d-sky-front', sky);
      front.style.left = fx + 'px';
      front.style.width = fw + 'px';
      front.style.height = (fh + 40) + 'px';
      front.style.bottom = '276px';
      var sign = el('div', 'pv3d-sky-sign', front);
      if (fi < signs.length) setText(sign, signs[fi]);
      for (var fy = 0; fy < 5; fy++) {
        for (var fwx = 0; fwx < 4; fwx++) {
          if (hashRand(fi, fy * 10 + fwx + 5) > 0.5) {
            var win2 = el('div', 'pv3d-sky-win pv3d-sky-win-warm', front);
            win2.style.left = (10 + fwx * 18) + 'px';
            win2.style.top = (46 + fy * 20) + 'px';
          }
        }
      }
      fx += fw + 14;
      fi++;
    }
    // Low sun, ground band, palms and umbrellas.
    var sun = el('div', 'pv3d-title-sun', sky);
    var ground = el('div', 'pv3d-title-ground', sky);
    var palm1 = el('div', 'pv3d-title-palm', sky);
    palm1.style.left = '70px';
    var palm2 = el('div', 'pv3d-title-palm', sky);
    palm2.style.left = '1180px';
    var umb = el('div', 'pv3d-title-umbrella', sky);
    umb.style.left = '1040px';

    var stage = el('div', 'pv3d-title-stage', root);
    var headline = el('div', 'pv3d-title-headline', stage);
    setText(headline, 'PALMA VERDE');
    var tagline = el('div', 'pv3d-title-tagline', stage);
    setText(tagline, 'Rey Calder owes Nadia Venn $2,000. The city is open.');

    var menu = ['CONTINUE', 'NEW GAME', 'LOAD GAME', 'SETTINGS'];
    var sel = (opts && typeof opts.selectedMenu === 'number') ? opts.selectedMenu : lastMenuSel;
    var menuBox = el('div', 'pv3d-panel pv3d-title-menu', stage);
    var menuItems = [];
    // One shared selection: mouse hover writes the same sel the
    // render reads, and a click fires the exact Enter handler.
    // main3d is a module, so its start function is not reachable
    // from this classic script — a synthetic Enter keydown on
    // window is the in-scope route to it (main3d listens for
    // keydown Enter on window; the event is indistinguishable to
    // that handler from a physical Enter press).
    function paintMenu() {
      for (var pi = 0; pi < menuItems.length; pi++) {
        if (pi === sel) menuItems[pi].classList.add('pv3d-title-menu-selected');
        else menuItems[pi].classList.remove('pv3d-title-menu-selected');
        setText(menuItems[pi], (pi === sel ? '▸ ' : '   ') + menu[pi]);
      }
    }
    function activateMenu() {
      var ev = null;
      try {
        ev = new window.KeyboardEvent('keydown', { code: 'Enter', key: 'Enter', bubbles: true });
      } catch (e) { ev = null; }
      if (ev) window.dispatchEvent(ev);
    }
    for (var m = 0; m < menu.length; m++) {
      (function (mi) {
        var item = el('div', 'pv3d-title-menu-item' + (mi === sel ? ' pv3d-title-menu-selected' : ''), menuBox);
        setText(item, (mi === sel ? '▸ ' : '   ') + menu[mi]);
        menuItems.push(item);
        item.addEventListener('mouseenter', function () {
          sel = mi;
          lastMenuSel = mi;
          paintMenu();
        });
        item.addEventListener('click', function () {
          sel = mi;
          lastMenuSel = mi;
          paintMenu();
          activateMenu();
        });
      })(m);
    }

    var slots = readSlots(opts);
    var anyReal = false;
    for (var s0 = 0; s0 < slots.length; s0++) {
      if (slots[s0] && !slots[s0].empty) anyReal = true;
    }
    if (!anyReal) slots = stagedTitleSlots();
    var selected = (opts && typeof opts.selected === 'number') ? opts.selected : (state.titleSlot || 0);
    var slotsBox = el('div', 'pv3d-title-slots', stage);
    setText(el('div', 'pv3d-title-slots-head', slotsBox), 'SAVE SLOTS');
    var clockNow = clockStr(state.clockMinutes);
    var slotCards = [];
    function paintSlots() {
      for (var psi = 0; psi < slotCards.length; psi++) {
        if (psi === selected) slotCards[psi].classList.add('pv3d-slot-selected');
        else slotCards[psi].classList.remove('pv3d-slot-selected');
      }
    }
    for (var i = 0; i < 3; i++) {
      (function (si) {
        var card = slotCard(slots[si] || { slot: si + 1, empty: true }, si === selected, clockNow);
        slotsBox.appendChild(card);
        slotCards.push(card);
        // Click a slot = select it: writes the same state.titleSlot
        // the Left/Right arrows write, so mouse and keyboard share
        // one selection. Double-click = load it, the same Enter
        // activation as the menu. (Systems-screen slots are
        // display-only and are deliberately left untouched.)
        card.addEventListener('mouseenter', function () {
          selected = si;
          state.titleSlot = si;
          paintSlots();
        });
        card.addEventListener('click', function () {
          selected = si;
          state.titleSlot = si;
          paintSlots();
        });
        card.addEventListener('dblclick', function () {
          selected = si;
          state.titleSlot = si;
          paintSlots();
          activateMenu();
        });
      })(i);
    }

    var foot = el('div', 'pv3d-title-foot', stage);
    setText(foot, 'CLICK OR PRESS ENTER TO START  ·  ARROWS / MOUSE PICK A SLOT');
    var controls = el('div', 'pv3d-title-controls', stage);
    setText(controls, 'WASD walk / drive   ·   E enter & exit car / start mission   ·   Hold RMB to aim, LMB fire   ·   R reload   ·   Q radio   ·   Z / X / V crew   ·   Esc pause   ·   F9 save');
    var meta = el('div', 'pv3d-title-meta', stage);
    setText(meta, clockStr(state.clockMinutes) + '  ·  ' +
      (state.district ? state.district.name.toUpperCase() : 'PALMA VERDE') +
      '  ·  10 MISSIONS  ·  7 DISTRICTS  ·  3 RADIO STATIONS');
    return root;
  }

  function hideTitle() {
    if (titleRoot && titleRoot.parentNode) {
      titleRoot.parentNode.removeChild(titleRoot);
    }
    titleRoot = null;
  }

  function titleVisible() {
    return !!titleRoot;
  }

  function setWaypoint(state, city, districtName) {
    var districts = (city && city.districts) || [];
    for (var i = 0; i < districts.length; i++) {
      if (districts[i].name === districtName) {
        var cx = (districts[i].x0 + districts[i].x1) / 2;
        var cy = ((districts[i].z0 !== undefined ? districts[i].z0 : districts[i].y0) +
          (districts[i].z1 !== undefined ? districts[i].z1 : districts[i].y1)) / 2;
        state.waypoint = { x: cx, z: cy, y: cy, label: districtName };
        state.missionTarget = { x: cx, z: cy, y: cy };
        return state.waypoint;
      }
    }
    return null;
  }

  function injectCss() {
    if (document.getElementById('pv3d-screens-css')) return;
    var css = [
      '.pv3d-systems{position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:8;background:#060a10;display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif;color:#e8e8e8}',
      '.pv3d-systems-stage{width:1280px;height:720px;position:relative}',
      '.pv3d-systems-header{display:flex;align-items:center;gap:16px;padding:0 24px;height:56px}',
      '.pv3d-systems-title{font-size:22px;font-weight:800;color:#ffd166;letter-spacing:2px}',
      '.pv3d-systems-tabs{display:flex;gap:6px}',
      '.pv3d-tab{background:#080c12;color:#e8e8e8;border:1px solid rgba(255,255,255,0.2);padding:6px 12px;font-size:12px;font-weight:700;cursor:pointer}',
      '.pv3d-tab-active{background:#ffd166;color:#222;border-color:#ffd166}',
      '.pv3d-systems-close{margin-left:auto;background:#080c12;color:#ffd166;border:1px solid #ffd166;padding:6px 12px;font-size:12px;font-weight:700;cursor:pointer}',
      '.pv3d-systems-cols{display:flex;gap:16px;padding:0 24px;height:520px}',
      '.pv3d-col{display:flex;flex-direction:column;gap:10px}',
      '.pv3d-col-left{width:300px}',
      '.pv3d-col-centre{width:560px}',
      '.pv3d-col-right{width:316px}',
      // Scoped to the two screens: an unscoped .pv3d-panel rule here
      // used to leak padding:10px 12px onto the HUD's panels (same
      // class, later stylesheet wins), adding 20px to every HUD panel
      // and pushing their text onto the panel below.
      // Every systems/title panel is fully solid: the old 0.6 alpha
      // let HUD text ghost through the pause screen.
      '.pv3d-systems .pv3d-panel,.pv3d-title .pv3d-panel{background:#080c12;padding:10px 12px}',
      '.pv3d-card-title{font-size:12px;font-weight:700;color:#ffd166;letter-spacing:1px;margin-bottom:8px}',
      '.pv3d-ring-card{display:flex;align-items:center;gap:14px;height:132px}',
      '.pv3d-ring{width:110px;height:110px;flex:none;transform:rotate(-90deg)}',
      '.pv3d-ring-track{fill:none;stroke:#2a2a30;stroke-width:9}',
      '.pv3d-ring-fill{fill:none;stroke:#4caf50;stroke-width:9;stroke-linecap:round}',
      '.pv3d-ring-text{text-align:center}',
      '.pv3d-ring-pct{font-size:26px;font-weight:800;color:#ffd166}',
      '.pv3d-ring-label{font-size:11px;color:#8a8a92}',
      '.pv3d-rank-box{margin-left:auto;text-align:right}',
      '.pv3d-rank-name{font-size:13px;font-weight:700;color:#fff}',
      '.pv3d-rank-rp{font-size:12px;color:#ffd166;margin-top:4px}',
      '.pv3d-check-card{flex:1}',
      '.pv3d-check-row{display:flex;justify-content:space-between;font-size:11px;margin-top:6px}',
      '.pv3d-check-label{color:#c9d2e0}',
      '.pv3d-check-val{color:#ffd166;font-weight:700}',
      '.pv3d-check-track{height:5px;margin:2px 0 4px}',
      '.pv3d-bar-track{background:#2a2a30}',
      '.pv3d-bar-fill{height:100%;background:#4caf50}',
      '.pv3d-medal-card{height:78px}',
      '.pv3d-medals{display:flex;gap:6px}',
      '.pv3d-medal{width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;color:#222}',
      '.pv3d-map-card{height:430px}',
      '.pv3d-fullmap{display:block;background:#08120e}',
      '.pv3d-map-foot{font-size:11px;color:#ffd166;margin-top:6px}',
      '.pv3d-missions-card{flex:1;overflow:hidden}',
      '.pv3d-mission-list{display:flex;flex-direction:column}',
      '.pv3d-mission-row{display:flex;gap:8px;font-size:11px;padding:2px 0;border-bottom:1px solid rgba(255,255,255,0.06)}',
      '.pv3d-mission-num{width:16px;color:#8a8a92}',
      '.pv3d-mission-name{flex:1;font-weight:700;color:#fff}',
      '.pv3d-mission-giver{color:#8a8a92}',
      '.pv3d-mission-pay{color:#ffd166}',
      '.pv3d-mission-status{font-weight:700}',
      '.pv3d-status-done .pv3d-mission-status{color:#4caf50}',
      '.pv3d-status-current .pv3d-mission-status{color:#ffd166}',
      '.pv3d-status-open .pv3d-mission-status{color:#7ec3e8}',
      '.pv3d-status-locked .pv3d-mission-status{color:#8a8a92}',
      '.pv3d-stats-card{height:300px}',
      '.pv3d-stat-row{display:flex;justify-content:space-between;font-size:12px;padding:3px 0}',
      '.pv3d-stat-label{color:#c9d2e0}',
      '.pv3d-stat-value{color:#fff;font-weight:700}',
      '.pv3d-dash-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-top:10px}',
      '.pv3d-dash-cell{background:#141a22;padding:6px;text-align:center}',
      '.pv3d-dash-num{font-size:15px;font-weight:700;color:#ffd166}',
      '.pv3d-dash-label{font-size:9px;color:#8a8a92;margin-top:2px}',
      '.pv3d-slots-card{flex:1}',
      '.pv3d-systems-band{display:flex;gap:16px;padding:10px 24px 0}',
      '.pv3d-band-crew{flex:1}',
      '.pv3d-band-garage{flex:1}',
      '.pv3d-band-crew-card{margin-top:6px}',
      '.pv3d-band-crew-name{font-size:12px;font-weight:700;color:#ffd166}',
      '.pv3d-band-crew-effect{font-size:11px;color:#e8e8e8;margin-top:2px}',
      '.pv3d-band-garage-list{font-size:12px;color:#fff}',
      '.pv3d-band-garage-sub{font-size:11px;color:#8a8a92;margin-top:6px}',
      '.pv3d-slot{background:#080c12;border:1px solid rgba(255,255,255,0.25);padding:8px 12px;margin-top:8px}',
      '.pv3d-slot-selected{border:2px solid #ffd166;background:#080c12}',
      '.pv3d-slot-head{font-size:13px;font-weight:700;color:#ffd166}',
      '.pv3d-slot-title{font-size:14px;font-weight:700;color:#fff;margin-top:4px;white-space:nowrap;overflow:hidden}',
      '.pv3d-slot-line{font-size:13px;color:#ffd166;margin-top:4px}',
      '.pv3d-slot-empty{font-size:14px;color:#8a8a92;margin-top:6px}',
      '.pv3d-slot-sub{font-size:12px;color:#8a8a92;margin-top:4px}',
      '.pv3d-title{position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:8;font-family:system-ui,sans-serif;color:#e8e8e8;overflow:hidden}',
      '.pv3d-title-sky{position:absolute;left:0;top:0;width:100%;height:100%;background:linear-gradient(180deg,#2a1a4a 0%,#7a3a6e 45%,#ff8a4f 80%,#ffc46b 100%)}',
      '.pv3d-title-sun{position:absolute;left:72%;top:44%;width:68px;height:68px;border-radius:50%;background:#ffe9b8;box-shadow:0 0 90px 40px rgba(255,196,107,0.35)}',
      '.pv3d-sky-back{position:absolute;background:#241a33}',
      '.pv3d-sky-front{position:absolute;background:#1a1226;border-top:3px solid #ffd166}',
      '.pv3d-sky-win{position:absolute;width:8px;height:10px;background:rgba(255,209,102,0.5)}',
      '.pv3d-sky-win-warm{background:#ffd166}',
      '.pv3d-sky-sign{position:absolute;left:0;right:0;top:22px;text-align:center;font-size:13px;font-weight:700;color:#ffd166}',
      '.pv3d-title-ground{position:absolute;left:0;right:0;bottom:0;height:276px;background:#120e1a;border-top:10px solid rgba(201,176,120,0.5)}',
      '.pv3d-title-palm{position:absolute;bottom:8px;width:4px;height:56px;background:#1d2b26}',
      '.pv3d-title-umbrella{position:absolute;bottom:10px;width:40px;height:20px;border-radius:20px 20px 0 0;background:#e2725b}',
      '.pv3d-title-stage{position:absolute;left:0;top:0;width:1280px;height:720px}',
      '.pv3d-title-headline{position:absolute;left:48px;top:80px;font-size:64px;font-weight:800;color:#ffd166;letter-spacing:2px;text-shadow:0 2px 12px rgba(0,0,0,0.6)}',
      '.pv3d-title-tagline{position:absolute;left:50px;top:152px;font-size:20px;color:#fff;text-shadow:0 1px 6px rgba(0,0,0,0.6)}',
      '.pv3d-title-menu{position:absolute;left:40px;top:260px;width:320px;padding:12px 16px;user-select:none}',
      '.pv3d-title-menu-item{font-size:20px;font-weight:700;padding:10px 6px;color:#e8e8e8;cursor:pointer;user-select:none}',
      '.pv3d-title-menu-selected{color:#ffd166}',
      '.pv3d-title-menu-item:hover{color:#ffd166}',
      // Save slots moved left + down off the right edge: at right:48
      // the sun disc (left 72%, top 44% -> x922-990, y317-385) sat
      // squarely behind save slot 2 and glowed through its panel.
      // Now x388-840: 81px clear of the disc, ~41px clear of its
      // glow; 28px right of the menu, 14px below the tagline, ~18px
      // above the footer. The sun itself is untouched.
      '.pv3d-title-slots{position:absolute;right:440px;top:190px;width:452px}',
      '.pv3d-title-slots-head{font-size:15px;font-weight:700;color:#ffd166;margin-bottom:4px}',
      '.pv3d-title-slots .pv3d-slot{height:104px;cursor:pointer;user-select:none}',
      '.pv3d-title-slots .pv3d-slot:hover{border-color:#ffd166}',
      '.pv3d-title-foot{position:absolute;left:0;right:0;bottom:88px;text-align:center;font-size:17px;font-weight:700;color:#fff;text-shadow:0 1px 6px rgba(0,0,0,0.6)}',
      '.pv3d-title-controls{position:absolute;left:0;right:0;bottom:56px;text-align:center;font-size:14px;color:#c9d2e0}',
      '.pv3d-title-meta{position:absolute;left:24px;bottom:24px;font-size:13px;color:#8a8a92}'
    ].join('\n');
    var style = document.createElement('style');
    style.id = 'pv3d-screens-css';
    style.textContent = css;
    document.head.appendChild(style);
  }

  if (typeof document !== 'undefined' && document.createElement) injectCss();

  window.PalmaScreens3d = {
    CATALOGUE: CATALOGUE,
    COLUMNS: COLUMNS,
    TABS: TABS,
    showSystems: showSystems,
    hideSystems: hideSystems,
    systemsVisible: systemsVisible,
    showTitle: showTitle,
    hideTitle: hideTitle,
    titleVisible: titleVisible,
    setWaypoint: setWaypoint,
    drawFullMap: drawFullMap,
    missionRows: missionRows,
    crewRows: crewRows,
    dashNumbers: dashNumbers,
    standingRows: standingRows,
    careerStats: careerStats,
    checklistRows: checklistRows,
    readSlots: readSlots,
    stagedTitleSlots: stagedTitleSlots,
    moneyStr: moneyStr,
    clockStr: clockStr,
    standingLabel: standingLabel
  };
})();
