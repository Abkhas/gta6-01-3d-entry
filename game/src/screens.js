// Palma Verde — screens: title, pause menu, full-city map, stats
// dashboard, and the MISSION PASSED card.
//
// Everything here draws on the game canvas with plain rectangles,
// text, and circles — the same primitives the world renderer uses.
// Nothing here owns game logic: it reads the shared state object and
// the converted systems on window (PalmaMissions, PalmaCrew,
// PalmaProgress, PalmaGarage) and turns their numbers into panels the
// player can read at a glance. Every draw function takes the canvas
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

  function crewRows(state) {
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
      respect: state.respect || 0, standing: []
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

  // The full-city map, drawn into a rectangle: ocean and sand on the
  // west edge, district blocks with names, real streets, landmarks,
  // the dashed route to the mission marker, police dots, the player
  // arrow, and the waypoint diamond when one is set.
  function drawFullMap(ctx, state, city, x, y, w, h) {
    function sx(wx) { return x + (wx / city.width) * w; }
    function sy(wy) { return y + (wy / city.height) * h; }
    ctx.fillStyle = 'rgba(8,18,14,0.85)';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#1f6f8f';
    ctx.fillRect(x, y, sx(CFG.CITY.oceanX) - x, h);
    ctx.fillStyle = '#c9b078';
    ctx.fillRect(sx(CFG.CITY.oceanX), y, sx(CFG.CITY.beachX) - sx(CFG.CITY.oceanX), h);
    var districts = city.districts || (CFG ? CFG.DISTRICTS : []);
    for (var d = 0; d < districts.length; d++) {
      var dist = districts[d];
      ctx.fillStyle = (dist.accent || '#ffd166') + '30';
      ctx.fillRect(sx(dist.x0), sy(dist.y0), sx(dist.x1) - sx(dist.x0), sy(dist.y1) - sy(dist.y0));
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.font = 'bold 12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText((dist.short || dist.name).toUpperCase(), (sx(dist.x0) + sx(dist.x1)) / 2, (sy(dist.y0) + sy(dist.y1)) / 2);
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
      ctx.fillStyle = '#ffd166';
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.fillText('WAYPOINT · ' + (state.waypoint.label || '').toUpperCase(), sx(state.waypoint.x) + 12, sy(state.waypoint.y) + 4);
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
    ctx.textAlign = 'center';
    ctx.fillText('N', x + w / 2, y - 8);
    ctx.textAlign = 'left';
    ctx.strokeStyle = 'rgba(255,209,102,0.8)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x, y, w, h);
  }

  // One save-slot card: number, act, mission, completion — or EMPTY.
  function drawSlotCard(ctx, slot, x, y, w, h, selected) {
    panel(ctx, x, y, w, h, selected ? 0.85 : 0.55);
    ctx.strokeStyle = selected ? '#ffd166' : 'rgba(255,255,255,0.25)';
    ctx.lineWidth = selected ? 2 : 1;
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
    headline(ctx, 'SLOT ' + slot.slot, x + 14, y + 10, 15, '#ffd166');
    if (slot.empty) {
      bodyText(ctx, 'EMPTY — NEW GAME', x + 14, y + 38, 14, '#8a8a92');
      bodyText(ctx, 'A fresh start on the Boardwalk.', x + 14, y + 60, 12, '#8a8a92');
    } else {
      bodyText(ctx, (slot.act || 'ACT I') + '  ·  ' + (slot.missionName || slot.mission || 'FREE ROAM'), x + 14, y + 38, 14, '#fff');
      bodyText(ctx, (slot.completion === null || slot.completion === undefined ? '—' : slot.completion + '%') + ' COMPLETE' + (slot.money !== null && slot.money !== undefined ? '  ·  ' + moneyStr(slot.money) : ''), x + 14, y + 60, 13, '#ffd166');
      if (slot.rank) bodyText(ctx, 'RANK: ' + String(slot.rank).toUpperCase(), x + 14, y + 82, 12, '#8a8a92');
    }
  }

  // Title screen: sky band, city name, the debt hook, three save
  // slots, and the controls. ENTER starts the selected slot.
  function drawTitle(ctx, state, city, canvas, opts) {
    var W = canvas.width, H = canvas.height;
    var g = ctx.createLinearGradient(0, 0, 0, H * 0.45);
    g.addColorStop(0, '#ff9e4f');
    g.addColorStop(0.6, '#ffc46b');
    g.addColorStop(1, '#7fb3c8');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H * 0.45);
    ctx.fillStyle = '#1d2b26';
    ctx.fillRect(0, H * 0.45, W, H * 0.55);
    ctx.fillStyle = 'rgba(10,16,30,0.45)';
    ctx.fillRect(0, 0, W, H);
    headline(ctx, 'PALMA VERDE', W / 2, H * 0.16, 68, '#ffd166', 'center');
    bodyText(ctx, 'Rey Calder owes Nadia Venn $2,000. The city is open.', W / 2 - 260, H * 0.16 + 56, 20, '#fff');
    ctx.textAlign = 'left';
    var slots = readSlots(opts);
    var selected = (opts && typeof opts.selected === 'number') ? opts.selected : (state.titleSlot || 0);
    var cw = 300, gap = 24;
    var x0 = (W - (cw * 3 + gap * 2)) / 2;
    for (var i = 0; i < 3; i++) {
      drawSlotCard(ctx, slots[i] || { slot: i + 1, empty: true }, x0 + i * (cw + gap), H * 0.38, cw, 110, i === selected);
    }
    headline(ctx, 'PRESS ENTER TO START  ·  ARROWS PICK A SLOT', W / 2, H * 0.38 + 140, 17, '#fff', 'center');
    bodyText(ctx, 'WASD walk / drive   ·   E enter & exit car   ·   Mouse aim, click fire   ·   R reload   ·   Q radio   ·   Esc pause   ·   F9 save', W / 2 - 330, H * 0.38 + 176, 14, '#c9d2e0');
    ctx.textAlign = 'left';
    bodyText(ctx, clockStr(state.clockMinutes) + '  ·  ' + (state.district ? state.district.name.toUpperCase() : 'PALMA VERDE') + '  ·  10 MISSIONS  ·  7 DISTRICTS  ·  3 RADIO STATIONS', 24, H - 24, 13, '#8a8a92');
  }

  // The stats grid: six big catalogue numbers, completion, the rank
  // chip with its RP bar, and the seven district standing bars.
  // Shared by the STATS pause tab and the shot-3 dashboard.
  function drawStatsGrid(ctx, state, x, y, w) {
    var nums = dashNumbers(state);
    var done = (state.missions && state.missions.completed) || [];
    var cells = [
      { label: 'MISSIONS', value: done.length + ' / ' + CATALOGUE.missions },
      { label: 'ACTIVITIES', value: (state.activitiesDone || 0) + ' / ' + CATALOGUE.activities },
      { label: 'VEHICLES', value: '' + CATALOGUE.vehicles },
      { label: 'WEAPONS', value: '' + CATALOGUE.weapons },
      { label: 'DISTRICTS', value: '' + CATALOGUE.districts },
      { label: 'RADIO', value: '' + CATALOGUE.radio }
    ];
    var cw = (w - 10 * 2) / 3, ch = 52;
    for (var i = 0; i < cells.length; i++) {
      var cx = x + (i % 3) * (cw + 10);
      var cy = y + Math.floor(i / 3) * (ch + 10);
      panel(ctx, cx, cy, cw, ch, 0.55);
      headline(ctx, cells[i].value, cx + 10, cy + 6, 20, '#fff');
      bodyText(ctx, cells[i].label, cx + 10, cy + 32, 11, '#8a8a92');
    }
    var gy = y + 2 * (ch + 10) + 6;
    panel(ctx, x, gy, w, 86, 0.55);
    headline(ctx, 'COMPLETION  ' + Math.round(nums.completion) + '%', x + 12, gy + 8, 22, '#ffd166');
    bodyText(ctx, 'MISSIONS ' + done.length + '/' + CATALOGUE.missions + '  ·  SUN-DISCS ' + ((state.collectibles && state.collectibles.found) || []).length + '/12  ·  PROPERTIES ' + ((state.properties && state.properties.owned) || []).length + '/3', x + 12, gy + 38, 12, '#e8e8e8');
    bar(ctx, x + 12, gy + 60, w - 24, 10, nums.completion / 100, '#4caf50');
    var ry = gy + 96;
    panel(ctx, x, ry, w, 74, 0.55);
    var rankName = (nums.rank && nums.rank.name) || 'Runner';
    headline(ctx, 'RANK ' + (nums.rankIndex || 1) + ' · ' + rankName.toUpperCase(), x + 12, ry + 8, 17, '#ffd166');
    bodyText(ctx, 'RP ' + (nums.rpInto || 0) + ' / ' + (nums.rpNeeded || 0) + (nums.rank && nums.rank.tagline ? '  —  ' + nums.rank.tagline : ''), x + 12, ry + 32, 12, '#e8e8e8');
    bar(ctx, x + 12, ry + 52, w - 24, 10, nums.rpFraction || 0, '#ffd166');
    var sy = ry + 84;
    headline(ctx, 'DISTRICT STANDING', x, sy + 2, 13, '#ffd166');
    var rows = standingRows(state);
    for (var r = 0; r < rows.length; r++) {
      var rowY = sy + 22 + r * 22;
      bodyText(ctx, rows[r].district.toUpperCase(), x, rowY, 12, '#e8e8e8');
      bar(ctx, x + 130, rowY, w - 130 - 44, 9, rows[r].value / 100, '#7ec3e8');
      bodyText(ctx, '' + Math.round(rows[r].value), x + w - 34, rowY, 12, '#ffd166');
    }
    return sy + 22 + rows.length * 22;
  }

  // One crew card: portrait, name, role, ability, effect, and either
  // READY in green or the live cooldown in orange.
  function drawCrewCard(ctx, member, x, y, w, h) {
    panel(ctx, x, y, w, h, 0.55);
    var colors = { tuck: '#3d7ea6', ines: '#c94f3d', kip: '#4a6b4f' };
    portrait(ctx, x + 28, y + 28, 20, colors[member.id] || '#8a8a92', (member.name || '?').charAt(0));
    headline(ctx, (member.name || '').toUpperCase() + '  ·  ' + (member.role || '').toUpperCase(), x + 56, y + 10, 14, '#fff');
    bodyText(ctx, (member.ability || '') + ' — ' + (member.effect || ''), x + 56, y + 32, 12, '#ffd166');
    if (member.ready) {
      bodyText(ctx, 'READY  ·  ' + (member.rpCost || 0) + ' RP', x + 56, y + 52, 12, '#4caf50');
    } else {
      bodyText(ctx, 'COOLDOWN ' + (member.cooldownLeft || 0) + 's  ·  ' + (member.rpCost || 0) + ' RP', x + 56, y + 52, 12, '#ff8a5e');
    }
  }

  // The garage strip: owned cars in a row plus one upgrade line.
  function drawGarageStrip(ctx, state, x, y, w) {
    panel(ctx, x, y, w, 64, 0.55);
    headline(ctx, 'GARAGE', x + 12, y + 8, 13, '#ffd166');
    var owned = (state.garage && state.garage.owned) || ['Cometa GT'];
    var line = owned.join('  ·  ');
    bodyText(ctx, line, x + 12, y + 32, 13, '#fff');
    var upgrades = (state.garage && state.garage.upgrades && state.garage.upgrades['Cometa GT']) || { engine: 0, armor: 0, paint: 'Factory' };
    bodyText(ctx, 'COMETA GT — ENGINE ' + (upgrades.engine || 0) + '  ·  ARMOR ' + (upgrades.armor || 0) + '  ·  PAINT ' + (upgrades.paint || 'Factory'), x + 12, y + 50, 11, '#8a8a92');
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
      drawStatsGrid(ctx, state, 24, top, Math.min(560, W - 48));
      var crew = crewRows(state);
      var cx = Math.min(560, W - 48) + 48;
      headline(ctx, 'CREW', cx, top + 2, 13, '#ffd166');
      for (var c = 0; c < crew.length; c++) {
        drawCrewCard(ctx, crew[c], cx, top + 22 + c * 78, W - 24 - cx, 70);
      }
      var slots = readSlots(opts);
      var sy2 = top + 22 + crew.length * 78 + 10;
      headline(ctx, 'SAVE SLOTS', cx, sy2 + 2, 13, '#ffd166');
      for (var s = 0; s < 3; s++) {
        drawSlotCard(ctx, slots[s] || { slot: s + 1, empty: true }, cx, sy2 + 22 + s * 116, W - 24 - cx, 108, false);
      }
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
        'Q — switch radio station    ·    1 / 2 / 3 — call Tuck / Ines / Kip',
        'Esc / P — pause    ·    F9 — save to slot 1    ·    M — set waypoint on the mission marker',
        'RADIO: Onda 98.4  ·  Sol FM  ·  Static Coast — synthesized in-game, no audio files.',
        'SUBTITLES: on    ·    CAMERA: follow, 2.5D oblique    ·    LANGUAGE: English'
      ];
      for (var li = 0; li < lines.length; li++) {
        bodyText(ctx, lines[li], 38, top + 44 + li * 24, 13, '#e8e8e8');
      }
    }
  }

  // Shot-3 layout: the full-city map on the left and the stats
  // dashboard on the right, with the crew, the save slots, and the
  // garage strip along the bottom — five systems in one frame.
  function drawDashboard(ctx, state, city, canvas, opts) {
    var W = canvas.width, H = canvas.height;
    ctx.fillStyle = 'rgba(10,16,30,0.78)';
    ctx.fillRect(0, 0, W, H);
    headline(ctx, 'PALMA VERDE — MAP & STATS', 24, 18, 24, '#ffd166');
    bodyText(ctx, clockStr(state.clockMinutes) + '  ·  ' + (state.district ? state.district.name.toUpperCase() : 'PALMA VERDE') + '  ·  ' + moneyStr(state.player.money), 24, 48, 13, '#e8e8e8');
    var mapW = Math.floor(W * 0.46);
    var mapH = H - 190;
    headline(ctx, 'FULL-CITY MAP', 24, 76, 13, '#ffd166');
    drawFullMap(ctx, state, city, 24, 96, mapW, mapH);
    var rx = 24 + mapW + 24;
    var rw = W - rx - 24;
    headline(ctx, 'STATS', rx, 76, 13, '#ffd166');
    var endY = drawStatsGrid(ctx, state, rx, 96, rw);
    void endY;
    var stripY = H - 84;
    var crew = crewRows(state);
    var third = Math.floor((W - 48 - 16) / 3);
    for (var c = 0; c < 3; c++) {
      var mem = crew[c];
      if (!mem) continue;
      var cx = 24 + c * (third + 8);
      panel(ctx, cx, stripY, third, 68, 0.6);
      headline(ctx, (mem.name || '').toUpperCase() + ' — ' + (mem.ability || '').toUpperCase(), cx + 10, stripY + 8, 12, '#ffd166');
      bodyText(ctx, mem.ready ? 'READY  ·  ' + (mem.rpCost || 0) + ' RP' : 'COOLDOWN ' + (mem.cooldownLeft || 0) + 's', cx + 10, stripY + 30, 12, mem.ready ? '#4caf50' : '#ff8a5e');
      bodyText(ctx, mem.effect || '', cx + 10, stripY + 50, 11, '#8a8a92');
    }
    var slots = readSlots(opts);
    var slotLine = slots.map(function (s) {
      if (s.empty) return 'SLOT ' + s.slot + ': EMPTY';
      return 'SLOT ' + s.slot + ': ' + (s.act || '') + ' · MISSION ' + (s.missionName || s.mission || '—') + ' · ' + (s.completion === null || s.completion === undefined ? '—' : s.completion + '%');
    }).join('    ');
    bodyText(ctx, slotLine, 24, H - 8, 12, '#c9d2e0');
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
