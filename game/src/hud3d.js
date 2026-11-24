// Palma Verde 3D — HUD: a DOM overlay over the WebGL canvas.
//
// The 3D game renders its world with Three.js, so the HUD is plain DOM
// on top of it: crisp text at any window size, no canvas text to blur.
// One strict 1280x720 design grid, scaled as a whole to the real
// window; every panel lives inside its own zone, zero overlaps:
//
//   TOP ROW    mission header (left, x14 w470) | money + stars (right)
//   LEFT RAIL  vitals (y100) -> PVPD dispatch (y154, only when wanted)
//   RIGHT RAIL crew cards (y90, three cards)
//   BOTTOM     clock + radio (above the minimap, never under the bar)
//              minimap (bottom-left) | weapon bar (bottom centre-left)
//              dialogue (bottom-centre, above the weapon bar)
//              speedo (bottom-right)
//
// Zone edges, checked against each other: mission ends x484, money
// starts x1036; dialogue ends y652, weapons start y660; weapons end
// x814, speedo starts x1036; clock ends y523, minimap starts y534.
//
// Everything the HUD shows comes from the state object the game loop
// owns (see main3d.js for the full shape). Where a 3D system module
// offers a richer view (PalmaPolice3d.dispatchRows,
// PalmaCrew3d.cooldownDisplay) the HUD prefers it and falls back to
// the plain state fields, so the overlay works before those modules
// land and after they do.

(function () {
  'use strict';

  var CFG = null; // window.PalmaConfig (2D data tables) when loaded
  var CFG3D = null; // 3D config, bridged by main3d.js when it loads

  function config() {
    if (!CFG) CFG = window.PalmaConfig || null;
    return CFG;
  }

  function config3d() {
    if (!CFG3D) CFG3D = window.PalmaConfig3d || null;
    return CFG3D;
  }

  // ---- small value helpers -------------------------------------------

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

  function conditionLabel(cond) {
    if (cond >= 80) return 'CLEAN';
    if (cond >= 50) return 'DENTED';
    if (cond >= 25) return 'BATTERED';
    return 'WRECKED';
  }

  function rankName(state) {
    var cfg = config();
    if (cfg && cfg.RANKS) {
      var r = cfg.RANKS[clamp(state.rank || 0, 0, cfg.RANKS.length - 1)];
      return r ? r.name : 'Runner';
    }
    var names = ['Runner', 'Wheelman', 'Fixer', 'Kingpin', 'Legend'];
    return names[clamp(state.rank || 0, 0, names.length - 1)];
  }

  // ---- the one layout grid -------------------------------------------
  // Design pixels for 1280x720. layoutZones() is exported so the
  // self-test can prove no two zones overlap. Heights are CONTENT
  // heights (content-box: padding adds on top), measured against the
  // real rendered panels in headless Chrome — the declared height
  // plus padding must cover the content, or the panel's text spills
  // onto the panel below it. The dispatch height is dynamic (see the
  // update code) and capped at 5 rows + a "+N MORE" line.
  function layoutZones() {
    return {
      mission: { x: 14, y: 14, w: 470, h: 80 },
      money: { x: 1036, y: 14, w: 230, h: 74 },
      vitals: { x: 14, y: 118, w: 252, h: 86 },
      dispatch: { x: 14, y: 222, w: 252, h: 0 }, // height grows with rows
      crew: { x: 1096, y: 108, w: 170, h: 120 },
      clock: { x: 14, y: 470, w: 340, h: 52 },
      minimap: { x: 14, y: 542, w: 230, h: 172 },
      dialogue: { x: 320, y: 580, w: 640, h: 70 },
      weapons: { x: 280, y: 672, w: 534, h: 46 },
      speedo: { x: 1036, y: 640, w: 230, h: 64 }
    };
  }

  function zonesOverlap(a, b) {
    return a.x < b.x + b.w && b.x < a.x + a.w &&
      a.y < b.y + b.h && b.y < a.y + a.h;
  }

  // ---- dispatch rows --------------------------------------------------
  // Prefer the police module's rows; otherwise build them from
  // state.police.units, one world unit reading as half a metre.

  var TACTIC_COLORS = {
    RAMMING: '#e84a3a', PIT: '#e87b2b', ROADBLOCK: '#e8c53a',
    FLANKING: '#4a90e8', SPOTLIGHT: '#e8e8e8', PURSUIT: '#4caf50',
    SEARCHING: '#8a8a92'
  };

  var KIND_CHIPS = {
    cruiser: { tag: 'CR', fill: '#4a90e8', dark: false },
    bike: { tag: 'BK', fill: '#e87b2b', dark: false },
    foot: { tag: 'FT', fill: '#4caf50', dark: false },
    heli: { tag: 'AIR', fill: '#e8e8e8', dark: true }
  };

  function dispatchRows(state) {
    if (window.PalmaPolice3d && window.PalmaPolice3d.dispatchRows) {
      try {
        var rows = window.PalmaPolice3d.dispatchRows(state);
        if (rows) return rows;
      } catch (e) { /* fall through to the state rows */ }
    }
    var pol = state.police;
    if (!pol || !pol.units) return [];
    var p = state.player;
    var out = [];
    for (var i = 0; i < pol.units.length; i++) {
      var u = pol.units[i];
      if (u.leaving) continue;
      var pos = u.car || u.ped || u;
      var d = Math.hypot((pos.x || 0) - p.x, (pos.z !== undefined ? pos.z : (pos.y || 0)) - (p.z !== undefined ? p.z : p.y));
      out.push({
        callsign: u.callsign || 'UNIT',
        tactic: u.searching ? 'SEARCHING' : (u.tactic || 'PURSUIT'),
        distM: Math.round(d / 2),
        kind: u.kind || 'cruiser'
      });
    }
    if (pol.heli) {
      var hd = Math.hypot(pol.heli.x - p.x, (pol.heli.z !== undefined ? pol.heli.z : pol.heli.y) - (p.z !== undefined ? p.z : p.y));
      out.push({ callsign: 'AIR-1', tactic: 'SPOTLIGHT', distM: Math.round(hd / 2), kind: 'heli' });
    }
    return out;
  }

  // ---- mission info ----------------------------------------------------

  function missionInfo(state) {
    var m = state.missions || {};
    var info = {
      title: m.title || null, objective: m.objective || null,
      next: m.next || null, stage: m.stage || 0, total: m.stages || 0
    };
    if (window.PalmaMissions3d && window.PalmaMissions3d.currentMission) {
      try {
        var cur = window.PalmaMissions3d.currentMission(state);
        if (cur) {
          info.title = cur.name;
          info.total = cur.stages ? cur.stages.length : info.total;
          var st = window.PalmaMissions3d.currentStage(state);
          if (st) info.objective = st.objective;
          if (window.PalmaMissions3d.nextObjective) {
            info.next = window.PalmaMissions3d.nextObjective(state);
          }
        }
      } catch (e) { /* staged fields stand */ }
    }
    if (!info.title && m.current) info.title = 'MISSION ' + String(m.current).toUpperCase();
    return info;
  }

  // ---- crew rows -------------------------------------------------------

  var CREW_DEFS = [
    { key: 'tuck', name: 'TUCK', job: 'Swap Plates', hotkey: 'Z' },
    { key: 'ines', name: 'INES', job: 'Quick Fix', hotkey: 'X' },
    { key: 'kip', name: 'KIP', job: 'Eyes Out', hotkey: 'V' }
  ];

  function crewRows(state) {
    if (window.PalmaCrew3d && window.PalmaCrew3d.cooldownDisplay) {
      try {
        var rows = window.PalmaCrew3d.cooldownDisplay(state, Date.now());
        if (rows && rows.length) return rows;
      } catch (e) { /* fall through */ }
    }
    var out = [];
    for (var i = 0; i < CREW_DEFS.length; i++) {
      var d = CREW_DEFS[i];
      var c = (state.crew || {})[d.key] || {};
      out.push({
        id: d.key, name: d.name, ability: d.job, key: d.hotkey,
        cooldownLeft: c.cooldown || 0, cooldownTotal: c.cooldownTotal || 0,
        fraction: c.cooldownTotal ? clamp((c.cooldown || 0) / c.cooldownTotal, 0, 1) : 0,
        ready: !(c.cooldown > 0),
        label: (c.cooldown > 0)
          ? ('COOLDOWN ' + Math.ceil(c.cooldown) + 's')
          : ('READY [' + d.hotkey + ']')
      });
    }
    return out;
  }

  // ---- weapons ----------------------------------------------------------

  function weaponDefs() {
    var cfg = config();
    if (cfg && cfg.WEAPONS) return cfg.WEAPONS;
    return [
      { id: 'fists', name: 'Fists', damage: 12, mag: 0, reserve: 0 },
      { id: 'pistol', name: 'P9 Pistol', damage: 26, mag: 12, reserve: 60 },
      { id: 'smg', name: 'Vespa SMG', damage: 16, mag: 30, reserve: 120 },
      { id: 'shotgun', name: 'Duna 12', damage: 55, mag: 6, reserve: 24 },
      { id: 'carbine', name: 'PV-9 Carbine', damage: 22, mag: 24, reserve: 120 },
      { id: 'revolver', name: 'Palma .44', damage: 40, mag: 6, reserve: 36 },
      { id: 'bat', name: 'Palma Bat', damage: 18, mag: 0, reserve: 0 },
      { id: 'sniper', name: 'Mirador Longshot', damage: 70, mag: 5, reserve: 20 }
    ];
  }

  // Weapon icons: one small inline SVG silhouette per roster weapon,
  // drawn fresh here (weapons3d.js carries names only, no icons).
  // fill="currentColor" so the slot CSS colours the icon: gold when
  // owned, muted grey when locked.
  var WEAPON_ICONS = {
    fists: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="8" cy="11" r="5"/><circle cx="16" cy="13" r="5"/></svg>',
    pistol: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M2 5h16v4H9v2H7v7H4v-7H2z"/></svg>',
    smg: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M1 6h20v3H1zM6 9h3v6H6zM14 9h3v4h-3zM18 9h3v3h-3z"/></svg>',
    shotgun: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M1 7h21v3H1zM8 10h3v5H8zM17 10h3v3h-3z"/></svg>',
    carbine: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M1 7h21v3H1zM10 4h5v3h-5zM7 10h3v6H7zM17 10h3v4h-3z"/></svg>',
    revolver: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M2 6h11v4H8v2H6v6H3v-6H2z"/><circle cx="16.5" cy="8" r="3.5"/></svg>',
    bat: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 2l5 3-8 14-4-2z"/></svg>',
    sniper: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M1 8h22v2H1zM9 5h6v3H9zM7 10h3v5H7zM18 10h3v3h-3z"/></svg>'
  };

  // Eight slots: the full weapon roster. Every roster weapon shows
  // with its icon and name; a weapon the player does not own yet is
  // dimmed and tagged LOCKED, never a bare LOCKED placeholder.
  function weaponSlots(state) {
    var defs = weaponDefs().slice(0, 8);
    var p = state.player;
    var owned = state.weapons ? state.weapons.owned : null;
    return defs.map(function (w) {
      var locked = owned ? owned.indexOf(w.id) < 0 : false;
      var mag = (p.ammo && p.ammo[w.id] !== undefined) ? p.ammo[w.id] : w.mag;
      var reserve = (p.ammo && p.ammo[w.id + '_reserve'] !== undefined)
        ? p.ammo[w.id + '_reserve'] : w.reserve;
      return {
        id: w.id, name: w.name, locked: locked, icon: WEAPON_ICONS[w.id] || '',
        mag: mag, reserve: reserve, hasMag: w.mag > 0,
        current: p.weapon === w.id
      };
    });
  }

  // ---- DOM construction -------------------------------------------------
  // One inner 1280x720 stage, scaled by transform to the window.
  // All panels are plain divs; the minimap is a <canvas>.

  function el(tag, cls, parent) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (parent) parent.appendChild(node);
    return node;
  }

  function place(node, z) {
    // Panels are absolutely positioned at their zone: without this
    // the left/top/width/height below are ignored and the panels
    // stack in normal flow, overlapping each other down the left rail.
    node.style.position = 'absolute';
    node.style.left = z.x + 'px';
    node.style.top = z.y + 'px';
    node.style.width = z.w + 'px';
    node.style.height = z.h + 'px';
    return node;
  }

  function buildDom(root) {
    var zones = layoutZones();
    var stage = el('div', 'pv3d-stage', root);
    stage.style.width = '1280px';
    stage.style.height = '720px';

    var dom = { stage: stage, zones: zones };

    // Mission header, top-left.
    dom.mission = place(el('div', 'pv3d-panel pv3d-mission', stage), zones.mission);
    dom.missionTitle = el('div', 'pv3d-mission-title', dom.mission);
    dom.missionObjective = el('div', 'pv3d-mission-objective', dom.mission);
    dom.missionNext = el('div', 'pv3d-mission-next', dom.mission);
    dom.missionStage = el('div', 'pv3d-mission-stage', dom.mission);
    var barWrap = el('div', 'pv3d-bar-track', dom.mission);
    dom.missionBar = el('div', 'pv3d-bar-fill', barWrap);

    // Money + stars, top-right.
    dom.money = place(el('div', 'pv3d-panel pv3d-money', stage), zones.money);
    dom.moneyValue = el('div', 'pv3d-money-value', dom.money);
    dom.moneyStars = el('div', 'pv3d-money-stars', dom.money);

    // Vitals, left rail under the mission header.
    dom.vitals = place(el('div', 'pv3d-panel pv3d-vitals', stage), zones.vitals);
    dom.vitalsName = el('div', 'pv3d-vitals-name', dom.vitals);
    dom.vitalsHealth = el('div', 'pv3d-vitals-row', dom.vitals);
    dom.vitalsHealthLabel = el('span', 'pv3d-vitals-label', dom.vitalsHealth);
    dom.vitalsHealthLabel.textContent = 'HEALTH';
    var hTrack = el('div', 'pv3d-bar-track pv3d-bar-thin', dom.vitalsHealth);
    dom.vitalsHealthFill = el('div', 'pv3d-bar-fill pv3d-bar-health', hTrack);
    dom.vitalsHealthNum = el('span', 'pv3d-vitals-num', dom.vitalsHealth);
    dom.vitalsArmour = el('div', 'pv3d-vitals-row', dom.vitals);
    dom.vitalsArmourLabel = el('span', 'pv3d-vitals-label', dom.vitalsArmour);
    dom.vitalsArmourLabel.textContent = 'ARMOUR';
    var aTrack = el('div', 'pv3d-bar-track pv3d-bar-thin', dom.vitalsArmour);
    dom.vitalsArmourFill = el('div', 'pv3d-bar-fill pv3d-bar-armour', aTrack);
    dom.vitalsArmourNum = el('span', 'pv3d-vitals-num', dom.vitalsArmour);
    dom.vitalsRank = el('div', 'pv3d-vitals-rank', dom.vitals);

    // Dispatch board, left rail under the vitals. Rows are rebuilt
    // on each update; height follows the row count.
    dom.dispatch = place(el('div', 'pv3d-panel pv3d-dispatch', stage), zones.dispatch);
    dom.dispatchHead = el('div', 'pv3d-dispatch-head', dom.dispatch);
    dom.dispatchTitle = el('span', 'pv3d-dispatch-title', dom.dispatchHead);
    dom.dispatchTitle.textContent = 'PVPD DISPATCH';
    dom.dispatchCount = el('span', 'pv3d-dispatch-count', dom.dispatchHead);
    dom.dispatchRows = el('div', 'pv3d-dispatch-rows', dom.dispatch);
    dom.dispatchMore = el('div', 'pv3d-dispatch-more', dom.dispatch);

    // Crew rail, right.
    dom.crew = place(el('div', 'pv3d-crew', stage), zones.crew);
    dom.crewCards = [];
    for (var c = 0; c < 3; c++) {
      var card = el('div', 'pv3d-panel pv3d-crew-card', dom.crew);
      var head = el('div', 'pv3d-crew-head', card);
      var status = el('div', 'pv3d-crew-status', card);
      var track = el('div', 'pv3d-bar-track pv3d-bar-thin', card);
      var fill = el('div', 'pv3d-bar-fill pv3d-bar-cooldown', track);
      dom.crewCards.push({ card: card, head: head, status: status, fill: fill, track: track });
    }

    // Clock + radio, above the minimap.
    dom.clock = place(el('div', 'pv3d-panel pv3d-clock', stage), zones.clock);
    dom.clockLine = el('div', 'pv3d-clock-line', dom.clock);
    dom.radioLine = el('div', 'pv3d-radio-line', dom.clock);

    // Minimap canvas, bottom-left.
    dom.minimapWrap = place(el('div', 'pv3d-minimap-wrap', stage), zones.minimap);
    dom.minimap = el('canvas', 'pv3d-minimap', dom.minimapWrap);
    dom.minimap.width = zones.minimap.w;
    dom.minimap.height = zones.minimap.h;
    dom.minimapChip = el('div', 'pv3d-minimap-chip', dom.minimapWrap);
    dom.minimapCompass = el('div', 'pv3d-minimap-compass', dom.minimapWrap);
    dom.minimapCompass.textContent = 'N';

    // Dialogue, bottom-centre above the weapon bar.
    dom.dialogue = place(el('div', 'pv3d-panel pv3d-dialogue', stage), zones.dialogue);
    dom.dialoguePortrait = el('div', 'pv3d-dialogue-portrait', dom.dialogue);
    dom.dialogueName = el('div', 'pv3d-dialogue-name', dom.dialogue);
    dom.dialogueText = el('div', 'pv3d-dialogue-text', dom.dialogue);

    // Weapon bar, bottom centre-left: eight slots.
    dom.weapons = place(el('div', 'pv3d-weapons', stage), zones.weapons);
    dom.weaponSlots = [];
    for (var w = 0; w < 8; w++) {
      var slot = el('div', 'pv3d-panel pv3d-weapon-slot', dom.weapons);
      var nm = el('div', 'pv3d-weapon-name', slot);
      var ic = el('span', 'pv3d-weapon-icon', nm);
      var nt = el('span', 'pv3d-weapon-name-text', nm);
      var ammo = el('div', 'pv3d-weapon-ammo', slot);
      var key = el('div', 'pv3d-weapon-key', slot);
      dom.weaponSlots.push({ slot: slot, icon: ic, name: nt, ammo: ammo, key: key });
    }

    // Speedo, bottom-right.
    dom.speedo = place(el('div', 'pv3d-panel pv3d-speedo', stage), zones.speedo);
    dom.speedoValue = el('div', 'pv3d-speedo-value', dom.speedo);
    dom.speedoDetail = el('div', 'pv3d-speedo-detail', dom.speedo);

    // Weapon wheel overlay (Tab), hidden until opened.
    dom.wheel = el('div', 'pv3d-wheel', stage);
    dom.wheel.style.display = 'none';
    dom.wheelTitle = el('div', 'pv3d-wheel-title', dom.wheel);
    dom.wheelTitle.textContent = 'WEAPON WHEEL';
    dom.wheelGrid = el('div', 'pv3d-wheel-grid', dom.wheel);
    dom.wheelHint = el('div', 'pv3d-wheel-hint', dom.wheel);
    dom.wheelHint.textContent = 'HOLD TAB — TAP 1–8 TO SELECT';

    return dom;
  }

  // ---- minimap ----------------------------------------------------------
  // A 2D canvas: real street network from the city adapter, districts,
  // route to the mission marker, police dots, player arrow, N compass
  // and the district-standing chip. World coords are 3D metres:
  // x east, z south; the map's vertical axis is z (south = down).

  function mapBounds(city) {
    if (city && typeof city.mapX0 === 'number') {
      return { x0: city.mapX0, x1: city.mapX1, z0: city.mapZ0, z1: city.mapZ1 };
    }
    var c3 = config3d();
    if (c3) {
      return { x0: c3.OCEAN_X, x1: c3.CITY_HALF, z0: -c3.CITY_HALF, z1: c3.CITY_HALF };
    }
    return { x0: 0, x1: 4200, z0: 0, z1: 3200 };
  }

  function drawMinimap(dom, state, city) {
    var canvas = dom.minimap;
    var ctx = canvas.getContext('2d');
    if (!ctx) return;
    var W = canvas.width, H = canvas.height;
    var b = mapBounds(city);
    function mx(wx) { return ((wx - b.x0) / (b.x1 - b.x0)) * W; }
    function mz(wz) { return ((wz - b.z0) / (b.z1 - b.z0)) * H; }
    var c3 = config3d();
    var shoreX = c3 ? c3.SHORE_X : b.x0 + 180;
    var sandX = c3 ? c3.BEACH_X : b.x0 + 300;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(8,18,14,0.80)';
    ctx.fillRect(0, 0, W, H);
    // Ocean, then the sand band, along the west edge.
    ctx.fillStyle = '#1f6f8f';
    ctx.fillRect(0, 0, Math.max(0, mx(shoreX)), H);
    ctx.fillStyle = '#c9b078';
    ctx.fillRect(Math.max(0, mx(shoreX)), 0, Math.max(0, mx(sandX) - mx(shoreX)), H);

    var districts = (city && city.districts) ||
      (c3 ? c3.DISTRICTS : ((config() || {}).DISTRICTS || []));
    for (var d = 0; d < districts.length; d++) {
      var dist = districts[d];
      var x0 = dist.x0, z0 = (dist.z0 !== undefined ? dist.z0 : dist.y0);
      var x1 = dist.x1, z1 = (dist.z1 !== undefined ? dist.z1 : dist.y1);
      ctx.fillStyle = (dist.accent || '#ffd166') + '22';
      ctx.fillRect(mx(x0), mz(z0), mx(x1) - mx(x0), mz(z1) - mz(z0));
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.font = 'bold 8px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText((dist.short || dist.name || '').toUpperCase(),
        (mx(x0) + mx(x1)) / 2, (mz(z0) + mz(z1)) / 2);
      ctx.textAlign = 'left';
    }
    // Streets: every avenue (north-south) and street (east-west).
    var avenues = (city && city.avenues) || [];
    var streets = (city && city.streets) || [];
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1.2;
    for (var a = 0; a < avenues.length; a++) {
      ctx.beginPath();
      ctx.moveTo(mx(avenues[a]), 0);
      ctx.lineTo(mx(avenues[a]), H);
      ctx.stroke();
    }
    for (var s = 0; s < streets.length; s++) {
      ctx.beginPath();
      ctx.moveTo(0, mz(streets[s]));
      ctx.lineTo(W, mz(streets[s]));
      ctx.stroke();
    }
    // Landmarks: the wheel, the pier, the tower.
    var lms = (city && city.landmarks) || [];
    for (var l = 0; l < lms.length; l++) {
      var lm = lms[l];
      var lx = mx(lm.x), ly = mz(lm.z !== undefined ? lm.z : lm.y);
      if (lm.kind === 'wheel') {
        ctx.strokeStyle = '#ffd166';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(lx, ly, 6, 0, Math.PI * 2);
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
        ctx.arc(lx, ly, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Dashed route: player to the mission marker, along the grid.
    var target = state.missionTarget;
    var p = state.player;
    var pz = (p.z !== undefined ? p.z : p.y);
    if (target) {
      var tz = (target.z !== undefined ? target.z : target.y);
      ctx.strokeStyle = '#ffd166';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      ctx.moveTo(mx(p.x), mz(pz));
      ctx.lineTo(mx(target.x), mz(pz));
      ctx.lineTo(mx(target.x), mz(tz));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#ffd166';
      ctx.save();
      ctx.translate(mx(target.x), mz(tz));
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-5, -5, 10, 10);
      ctx.restore();
    }
    // Police dots: flashing red/blue on the cruisers, white ring on AIR-1.
    if (state.police) {
      var flash = Math.floor((state.time || 0) * 2) % 2 === 0;
      var units = state.police.units || [];
      for (var u = 0; u < units.length; u++) {
        var car = units[u].car || units[u].ped || units[u];
        var ux = car.x || 0, uz = (car.z !== undefined ? car.z : (car.y || 0));
        ctx.fillStyle = flash ? '#ff3b30' : '#2e6bff';
        ctx.beginPath();
        ctx.arc(mx(ux), mz(uz), 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
      if (state.police.heli) {
        var hx = state.police.heli.x, hz = (state.police.heli.z !== undefined ? state.police.heli.z : state.police.heli.y);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(mx(hx), mz(hz), 5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(mx(hx), mz(hz), 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Player arrow, pointing where Rey is heading.
    var ang = (p.vehicle ? p.vehicle.angle : p.angle) || 0;
    ctx.save();
    ctx.translate(mx(p.x), mz(pz));
    ctx.rotate(ang);
    ctx.fillStyle = '#ffd166';
    ctx.beginPath();
    ctx.moveTo(8, 0);
    ctx.lineTo(-6, -5);
    ctx.lineTo(-6, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // ---- per-frame update -------------------------------------------------

  function updateHud(dom, state, city) {
    var p = state.player;
    var zones = dom.zones;

    // Mission header.
    var info = missionInfo(state);
    if (info.title) {
      dom.missionTitle.textContent = info.title.toUpperCase();
      dom.missionObjective.textContent = info.objective || 'Follow the dashed route to the marker.';
      dom.missionNext.textContent = info.next ? ('NEXT: ' + info.next) : '';
      dom.missionNext.style.display = info.next ? '' : 'none';
      var total = Math.max(1, info.total || 1);
      var done = clamp(info.stage || 0, 0, total);
      dom.missionStage.textContent = 'STAGE ' + (done + 1) + '/' + total;
      dom.missionBar.style.width = Math.round((done / total) * 100) + '%';
    } else {
      dom.missionTitle.textContent = 'FREE ROAM — PALMA VERDE';
      dom.missionObjective.textContent = 'Nadia Venn is waiting on her $2,000 — find work around town.';
      dom.missionNext.textContent = 'NEXT: PICK UP A JOB — MISSION 1, THE DEBT';
      dom.missionNext.style.display = '';
      dom.missionStage.textContent = '';
      dom.missionBar.style.width = '0%';
    }

    // Money + stars.
    dom.moneyValue.textContent = moneyStr(p.money);
    var stars = '';
    for (var s = 0; s < 5; s++) stars += s < state.wanted ? '★' : '☆';
    dom.moneyStars.textContent = stars;
    dom.moneyStars.style.color = state.wanted >= 4 ? '#ff5a4a' : '#ffd166';

    // Vitals.
    dom.vitalsName.textContent = 'REY CALDER';
    dom.vitalsHealthFill.style.width = clamp(p.health || 0, 0, 100) + '%';
    dom.vitalsHealthFill.style.background = (p.health || 0) > 30 ? '#4caf50' : '#e84a3a';
    dom.vitalsHealthNum.textContent = String(Math.round(p.health || 0));
    dom.vitalsArmourFill.style.width = clamp(p.armour || 0, 0, 100) + '%';
    dom.vitalsArmourNum.textContent = String(Math.round(p.armour || 0));
    dom.vitalsRank.textContent = 'RANK ' + ((state.rank || 0) + 1) + ' · ' +
      rankName(state).toUpperCase() + '  ·  RP ' + (state.rp || 0) + '  ·  ' + (state.completion || 0) + '% DONE';

    // Dispatch board: hidden while the heat is off.
    var rows = state.wanted > 0 ? dispatchRows(state) : [];
    if (rows.length) {
      dom.dispatch.style.display = '';
      var shown = rows.slice(0, 5);
      dom.dispatchCount.textContent = rows.length + (rows.length === 1 ? ' UNIT' : ' UNITS');
      var html = '';
      for (var i = 0; i < shown.length; i++) {
        var r = shown[i];
        var chip = KIND_CHIPS[r.kind] || KIND_CHIPS.cruiser;
        var pill = TACTIC_COLORS[r.tactic] || '#8a8a92';
        html += '<div class="pv3d-dispatch-row">' +
          '<span class="pv3d-chip" style="background:' + chip.fill + ';color:' +
          (chip.dark ? '#222' : '#fff') + '">' + chip.tag + '</span>' +
          '<span class="pv3d-dispatch-name">' + r.callsign + '</span>' +
          '<span class="pv3d-pill" style="background:' + pill + ';color:' +
          (r.tactic === 'SPOTLIGHT' ? '#222' : '#fff') + '">' + r.tactic + '</span>' +
          '<span class="pv3d-dispatch-dist">' + r.distM + 'm</span></div>';
      }
      dom.dispatchRows.innerHTML = html;
      var hasMore = rows.length > shown.length;
      dom.dispatchMore.textContent = hasMore ? ('+' + (rows.length - shown.length) + ' MORE') : '';
      dom.dispatchMore.style.display = hasMore ? '' : 'none';
      var h = 28 + shown.length * 24 + 6 + (hasMore ? 19 : 0) + 8; // +8: the header line-height runs taller than 28px
      dom.dispatch.style.height = h + 'px';
    } else {
      dom.dispatch.style.display = 'none';
    }

    // Crew rail.
    var crows = crewRows(state);
    for (var c = 0; c < 3; c++) {
      var card = dom.crewCards[c];
      var row = crows[c] || { name: CREW_DEFS[c].name, ability: CREW_DEFS[c].job, label: 'READY [' + CREW_DEFS[c].hotkey + ']', fraction: 0, ready: true };
      card.head.textContent = (row.name || CREW_DEFS[c].name) + ' — ' + (row.ability || CREW_DEFS[c].job).toUpperCase();
      card.status.textContent = row.label || '';
      card.status.style.color = row.ready ? '#4caf50' : '#ff8a5e';
      card.fill.style.width = Math.round(clamp(row.fraction || 0, 0, 1) * 100) + '%';
      card.track.style.display = row.ready ? 'none' : '';
    }

    // Clock + radio, above the minimap.
    var dName = state.district ? state.district.name.toUpperCase() : 'PALMA VERDE';
    dom.clockLine.textContent = clockStr(state.clockMinutes) + '  ·  ' + dName;
    var cfg = config();
    if (state.radioTrack) {
      dom.radioLine.textContent = state.radioTrack;
    } else if (cfg && cfg.RADIO) {
      var station = cfg.RADIO[(state.radioStation || 0) % cfg.RADIO.length];
      var track = station.tracks[Math.floor((state.clockMinutes || 0) / 3) % station.tracks.length];
      dom.radioLine.textContent = station.name + ' — ' + track;
    } else {
      dom.radioLine.textContent = 'Onda 98.4 — the sound of the bay';
    }

    // Minimap + standing chip.
    drawMinimap(dom, state, city);
    var dVal = null;
    if (state.district && state.standing && typeof state.standing[state.district.name] === 'number') {
      dVal = state.standing[state.district.name];
    }
    dom.minimapChip.textContent = dName + (dVal === null ? '' : ' · ' + standingLabel(dVal) + ' ' + dVal);

    // Dialogue: at most two lines, hidden when nobody is talking.
    if (state.dialogue && state.dialogue.text) {
      dom.dialogue.style.display = '';
      dom.dialoguePortrait.textContent = (state.dialogue.name || '?').charAt(0);
      dom.dialoguePortrait.style.background = state.dialogue.color || '#c94f3d';
      dom.dialogueName.textContent = (state.dialogue.name || '???').toUpperCase();
      var words = String(state.dialogue.text).split(' ');
      var lines = [''];
      for (var wi = 0; wi < words.length; wi++) {
        var test = lines[lines.length - 1] + words[wi] + ' ';
        if (test.length > 62 && lines[lines.length - 1].length > 0) lines.push(words[wi] + ' ');
        else lines[lines.length - 1] = test;
        if (lines.length > 2) break;
      }
      dom.dialogueText.textContent = lines.join(' ');
    } else {
      dom.dialogue.style.display = 'none';
    }

    // Weapon bar: eight slots, equipped highlighted.
    var slots = weaponSlots(state);
    for (var w = 0; w < 8; w++) {
      var slotDom = dom.weaponSlots[w];
      var slot = slots[w];
      if (!slot) { slotDom.slot.style.display = 'none'; continue; }
      slotDom.slot.style.display = '';
      slotDom.slot.classList.toggle('pv3d-weapon-current', !!slot.current);
      slotDom.slot.classList.toggle('pv3d-weapon-locked', !!slot.locked);
      // Every slot shows its icon + name, locked or not; a locked
      // slot is dimmed and tagged LOCKED in the key line, never a
      // bare LOCKED placeholder.
      slotDom.icon.innerHTML = slot.icon || '';
      slotDom.name.textContent = slot.name.toUpperCase();
      if (slot.locked) {
        slotDom.ammo.textContent = '—';
        slotDom.ammo.style.color = '#8a8a92';
      } else if (!slot.hasMag) {
        slotDom.ammo.textContent = '—';
      } else {
        slotDom.ammo.textContent = slot.mag + ' / ' + slot.reserve;
        slotDom.ammo.style.color = slot.mag === 0 ? '#e84a3a' : '#ffd166';
      }
      slotDom.key.textContent = (slot.current && p.aiming)
        ? '◉ AIMING' : (slot.current ? 'EQUIPPED' : (slot.locked ? 'LOCKED' : ('[' + (w + 1) + ']')));
    }

    // Speedo: hidden on foot.
    if (p.vehicle) {
      dom.speedo.style.display = '';
      var speed = Math.round(Math.abs(p.vehicle.speed || 0) * 3.6);
      dom.speedoValue.textContent = speed + ' km/h';
      var flying = p.vehicle.kind === 'heli';
      var modelName = (typeof p.vehicle.model === 'string')
        ? p.vehicle.model
        : ((p.vehicle.model && p.vehicle.model.name) ? p.vehicle.model.name : 'COMETA GT');
      var shown = flying ? 'THE GULL' : modelName.toUpperCase();
      var cond = 100;
      if (window.PalmaVehicles3d && window.PalmaVehicles3d.condition) {
        try { cond = window.PalmaVehicles3d.condition(p.vehicle); } catch (e) { /* keep 100 */ }
      } else if (typeof p.vehicle.condition === 'number') cond = p.vehicle.condition;
      else if (typeof p.vehicle.damage === 'number') cond = Math.max(0, 100 - p.vehicle.damage);
      cond = Math.round(cond);
      var detail = flying
        ? ('ALT ' + Math.round(p.vehicle.altitude || 0) + ' m  ·  ' + cond + '% ' + conditionLabel(cond))
        : (cond + '% ' + conditionLabel(cond));
      dom.speedoDetail.textContent = shown + '  ·  ' + detail;
    } else {
      dom.speedo.style.display = 'none';
    }

    // Weapon wheel.
    dom.wheel.style.display = state.weaponWheel ? '' : 'none';
    if (state.weaponWheel) {
      var wheelHtml = '';
      for (var k = 0; k < slots.length; k++) {
        var ws = slots[k];
        var ammoTxt = ws.locked ? '—' : (ws.hasMag ? (ws.mag + ' / ' + ws.reserve) : '—');
        wheelHtml += '<div class="pv3d-wheel-slot' + (ws.current ? ' pv3d-wheel-current' : '') + (ws.locked ? ' pv3d-wheel-locked' : '') + '">' +
          '<div class="pv3d-wheel-name"><span class="pv3d-wheel-icon">' + (ws.icon || '') + '</span><span>' + ws.name.toUpperCase() + '</span></div>' +
          '<div class="pv3d-wheel-ammo">' + ammoTxt + '</div>' +
          '<div class="pv3d-wheel-key">' + (ws.locked ? 'LOCKED' : ('[' + (k + 1) + ']')) + '</div></div>';
      }
      dom.wheelGrid.innerHTML = wheelHtml;
    }
  }

  // ---- public API -------------------------------------------------------

  function createHUD(root) {
    var host = root || document.getElementById('hud3d');
    if (!host) return null;
    host.innerHTML = '';
    var dom = buildDom(host);
    var api = {
      element: host,
      stage: dom.stage,
      update: function (state, city) {
        if (!state) return;
        // Keep the stage scaled to the host size (host is full-window).
        var w = host.clientWidth || window.innerWidth || 1280;
        var h = host.clientHeight || window.innerHeight || 720;
        var s = Math.min(w / 1280, h / 720);
        dom.stage.style.transform = 'scale(' + s + ')';
        updateHud(dom, state, city);
      },
      layoutZones: layoutZones,
      zonesOverlap: zonesOverlap,
      dispatchRows: dispatchRows,
      missionInfo: missionInfo,
      crewRows: crewRows,
      weaponSlots: weaponSlots,
      moneyStr: moneyStr,
      clockStr: clockStr,
      standingLabel: standingLabel,
      conditionLabel: conditionLabel
    };
    return api;
  }

  // Inject the HUD stylesheet once, so the game page needs no extra CSS.
  function injectCss() {
    if (document.getElementById('pv3d-hud-css')) return;
    var css = [
      '#hud3d{position:fixed;left:0;top:0;width:100vw;height:100vh;pointer-events:none;z-index:6;overflow:hidden}',
      '.pv3d-stage{position:absolute;left:0;top:0;transform-origin:top left;font-family:system-ui,sans-serif;color:#e8e8e8}',
      // 0.68, not 0.55: against a bright sunset sky the money panel
      // and crew cards washed out at 0.55 (a cloud behind "$15,600"
      // left the stars unreadable); 0.68 keeps the scene visible
      // through the panels while the text stays legible.
      '.pv3d-panel{background:rgba(8,12,18,0.68);border-radius:2px}',
      '.pv3d-mission{padding:8px 10px}',
      '.pv3d-mission-title{font-size:16px;font-weight:700;color:#ffd166;white-space:nowrap;overflow:hidden}',
      '.pv3d-mission-objective{font-size:12px;margin-top:4px;white-space:nowrap;overflow:hidden}',
      '.pv3d-mission-next{font-size:12px;font-weight:700;color:#ffd166;margin-top:4px;white-space:nowrap;overflow:hidden}',
      '.pv3d-mission-stage{position:absolute;right:10px;top:44px;font-size:10px;color:#8a8a92}',
      '.pv3d-mission .pv3d-bar-track{position:absolute;left:10px;right:10px;bottom:6px;height:4px}',
      '.pv3d-bar-track{background:#2a2a30;position:relative}',
      '.pv3d-bar-fill{height:100%;background:#4caf50}',
      '.pv3d-bar-thin{height:10px;flex:1}',
      '.pv3d-bar-health{background:#4caf50}',
      '.pv3d-bar-armour{background:#7ec3e8}',
      '.pv3d-bar-cooldown{background:#ff8a5e}',
      '.pv3d-money{padding:6px 10px;text-align:right}',
      '.pv3d-money-value{font-size:22px;font-weight:700;color:#ffd166}',
      '.pv3d-money-stars{font-size:20px;letter-spacing:2px;margin-top:2px}',
      '.pv3d-vitals{padding:5px 8px}',
      '.pv3d-vitals-name{font-size:13px;font-weight:700}',
      '.pv3d-vitals-row{display:flex;align-items:center;gap:6px;margin-top:3px}',
      '.pv3d-vitals-label{font-size:10px;color:#c9d2e0;width:48px}',
      '.pv3d-vitals-num{font-size:11px;width:22px;text-align:right}',
      '.pv3d-vitals-rank{font-size:10px;color:#ffd166;margin-top:4px;white-space:nowrap;overflow:hidden}',
      '.pv3d-dispatch{padding:6px 8px}',
      '.pv3d-dispatch-head{display:flex;justify-content:space-between}',
      '.pv3d-dispatch-title{font-size:13px;font-weight:700;color:#ff5a4a}',
      '.pv3d-dispatch-count{font-size:11px;color:#8a8a92}',
      '.pv3d-dispatch-row{display:flex;align-items:center;gap:6px;height:24px}',
      '.pv3d-chip{font-size:8px;font-weight:700;padding:2px 4px;border-radius:2px}',
      '.pv3d-dispatch-name{font-size:12px;font-weight:700;color:#fff;width:86px;white-space:nowrap;overflow:hidden}',
      '.pv3d-pill{font-size:10px;font-weight:700;padding:2px 5px;border-radius:8px}',
      '.pv3d-dispatch-dist{font-size:12px;color:#ffd166;margin-left:auto}',
      '.pv3d-dispatch-more{font-size:11px;color:#8a8a92;margin-top:2px}',
      '.pv3d-crew{display:flex;flex-direction:column;gap:6px}',
      '.pv3d-crew-card{height:36px;padding:4px 8px}',
      '.pv3d-crew-head{font-size:12px;font-weight:700;color:#ffd166}',
      '.pv3d-crew-status{font-size:11px;margin-top:2px}',
      '.pv3d-clock{padding:6px 8px}',
      '.pv3d-clock-line{font-size:15px;font-weight:700;color:#fff}',
      '.pv3d-radio-line{font-size:12px;color:#ffd166;margin-top:4px;white-space:nowrap;overflow:hidden}',
      '.pv3d-minimap-wrap{position:absolute}',
      '.pv3d-minimap{display:block;background:rgba(8,18,14,0.8)}',
      '.pv3d-minimap-chip{position:absolute;left:4px;top:4px;background:rgba(8,12,18,0.85);color:#ffd166;font-size:10px;font-weight:700;padding:2px 6px}',
      '.pv3d-minimap-compass{position:absolute;right:6px;top:4px;color:#fff;font-size:11px;font-weight:700}',
      '.pv3d-dialogue{padding:8px 10px 8px 66px}',
      '.pv3d-dialogue-portrait{position:absolute;left:12px;top:50%;margin-top:-22px;width:44px;height:44px;border-radius:50%;background:#c94f3d;color:#fff;font-size:16px;font-weight:700;display:flex;align-items:center;justify-content:center}',
      '.pv3d-dialogue-name{font-size:13px;font-weight:700;color:#ffd166}',
      '.pv3d-dialogue-text{font-size:14px;margin-top:3px;line-height:1.35}',
      '.pv3d-weapons{display:flex;gap:6px}',
      '.pv3d-weapon-slot{flex:1;padding:5px 6px}',
      '.pv3d-weapon-current{outline:2px solid #ffd166;background:rgba(8,12,18,0.78)}',
      '.pv3d-weapon-name{display:flex;align-items:center;gap:4px;font-size:10px;font-weight:700;white-space:nowrap;overflow:hidden}',
      '.pv3d-weapon-icon{flex:none;display:inline-flex;color:#ffd166}',
      '.pv3d-weapon-icon svg{width:16px;height:14px}',
      '.pv3d-weapon-name-text{overflow:hidden;text-overflow:ellipsis}',
      '.pv3d-weapon-locked{opacity:0.65}',
      '.pv3d-weapon-locked .pv3d-weapon-icon{color:#c9d2e0}',
      '.pv3d-weapon-locked .pv3d-weapon-name-text{color:#c9d2e0}',
      '.pv3d-weapon-ammo{font-size:14px;font-weight:700;color:#ffd166;margin-top:3px}',
      '.pv3d-weapon-key{font-size:10px;color:#8a8a92;margin-top:3px}',
      '.pv3d-speedo{padding:6px 10px}',
      '.pv3d-speedo-value{font-size:22px;font-weight:700;color:#fff}',
      '.pv3d-speedo-detail{font-size:12px;font-weight:700;color:#ffd166;margin-top:2px;white-space:nowrap;overflow:hidden}',
      '.pv3d-wheel{position:absolute;left:50%;top:50%;width:560px;margin-left:-280px;margin-top:-190px;background:rgba(8,12,18,0.72);padding:18px;border-radius:8px;text-align:center}',
      '.pv3d-wheel-title{font-size:14px;font-weight:700;color:#ffd166;letter-spacing:2px}',
      '.pv3d-wheel-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px}',
      '.pv3d-wheel-slot{background:rgba(8,12,18,0.72);border:1px solid rgba(255,255,255,0.25);padding:8px}',
      '.pv3d-wheel-current{background:rgba(255,209,102,0.85);color:#222;border-color:#ffd166}',
      '.pv3d-wheel-name{display:flex;align-items:center;justify-content:center;gap:5px;font-size:12px;font-weight:700}',
      '.pv3d-wheel-icon{display:inline-flex;color:#ffd166}',
      '.pv3d-wheel-icon svg{width:16px;height:14px}',
      '.pv3d-wheel-locked{opacity:0.65}',
      '.pv3d-wheel-locked .pv3d-wheel-icon{color:#c9d2e0}',
      '.pv3d-wheel-ammo{font-size:12px;color:#ffd166;margin-top:2px}',
      '.pv3d-wheel-current .pv3d-wheel-ammo{color:#222}',
      '.pv3d-wheel-key{font-size:10px;color:#8a8a92;margin-top:2px}',
      '.pv3d-wheel-hint{font-size:11px;color:#8a8a92;margin-top:12px}'
    ].join('\n');
    var style = document.createElement('style');
    style.id = 'pv3d-hud-css';
    style.textContent = css;
    document.head.appendChild(style);
  }

  if (typeof document !== 'undefined' && document.createElement) injectCss();

  window.PalmaHud3d = {
    createHUD: createHUD,
    layoutZones: layoutZones,
    zonesOverlap: zonesOverlap,
    dispatchRows: dispatchRows,
    missionInfo: missionInfo,
    crewRows: crewRows,
    weaponSlots: weaponSlots,
    moneyStr: moneyStr,
    clockStr: clockStr,
    standingLabel: standingLabel,
    conditionLabel: conditionLabel,
    rankName: rankName
  };
})();
