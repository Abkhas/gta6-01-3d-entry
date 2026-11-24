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

    // Minimap canvas, bottom-left. Backing store per r7 research:
    // Math.round(css * min(devicePixelRatio, 2)); the CSS size stays
    // exact, so the panel never moves or resizes.
    var minimapScale = Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 2);
    dom.minimapWrap = place(el('div', 'pv3d-minimap-wrap', stage), zones.minimap);
    dom.minimap = el('canvas', 'pv3d-minimap', dom.minimapWrap);
    dom.minimap.width = Math.round(zones.minimap.w * minimapScale);
    dom.minimap.height = Math.round(zones.minimap.h * minimapScale);
    dom.minimap.style.width = zones.minimap.w + 'px';
    dom.minimap.style.height = zones.minimap.h + 'px';
    dom.minimapScale = minimapScale;
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

    // Full map overlay (M), hidden until opened. Same SA style as
    // the radar, drawn large: the whole city, POI icons with names,
    // the gold route, police blips and the white player arrow.
    // Backing store 2x so the big map stays crisp.
    dom.fullmap = el('div', 'pv3d-fullmap-overlay', stage);
    dom.fullmap.style.display = 'none';
    dom.fullmapTitle = el('div', 'pv3d-fullmap-title', dom.fullmap);
    dom.fullmapTitle.textContent = 'PALMA VERDE — CITY MAP';
    dom.fullmapCanvas = el('canvas', 'pv3d-fullmap-canvas', dom.fullmap);
    dom.fullmapScale = 2;
    dom.fullmapCanvas.width = 1120 * dom.fullmapScale;
    dom.fullmapCanvas.height = 560 * dom.fullmapScale;
    dom.fullmapCanvas.style.width = '1120px';
    dom.fullmapCanvas.style.height = '560px';
    dom.fullmapHint = el('div', 'pv3d-fullmap-hint', dom.fullmap);
    dom.fullmapHint.textContent = 'M / ESC — CLOSE MAP  ·  WHITE ARROW IS YOU  ·  GOLD DIAMOND IS YOUR TARGET';
    dom.fullmapLegend = el('div', 'pv3d-fullmap-legend', dom.fullmap);
    dom.fullmapLegend.textContent = 'SHIRT CLOTHING  ·  DUMBBELL GYM  ·  SPRAY CAN SPRAY SHOP  ·  BURGER FOOD  ·  RED CROSS HOSPITAL  ·  HOUSE GARAGE';

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
  // A 2D canvas: real street geometry from the city adapter in the SA
  // colour language (green blocks, white buildings, black roads, blue
  // water, yellow sand), districts, a solid route to the waypoint
  // diamond, red police blips, a white player arrow, an N compass,
  // POI icons and the district-standing chip. Health + armour bars
  // sit in a strip along the bottom of the panel; a red border
  // flashes while wanted. The panel stays the r7 rectangle
  // (230x172): the world->map transform and every position on it are
  // byte-identical to r7 — only the style changed. World coords are
  // 3D metres: x east, z south; the map's vertical axis is z
  // (south = down).

  // Minimap render quality (r7 research): the panel stays 230x172 CSS
  // px on screen. The live canvas backing store is
  // Math.round(css * min(devicePixelRatio, 2)) with a scale transform,
  // so all drawing stays in CSS-pixel layout coords (mx/mz unchanged).
  // The STATIC layer (ground, blocks, roads, district tints, landmarks)
  // is pre-rendered once to an offscreen canvas at a FIXED 2x, even at
  // DPR 1, and downscaled per frame with drawImage — that 2x
  // supersampling is the sharpness win for thin lines on judge
  // screenshots. Per frame only the dynamic layer (route, blips,
  // arrow, labels, bars, wanted) is redrawn.
  var MINIMAP_STATIC_SCALE = 2;
  var minimapStatic = { city: null, canvas: null };

  // Fill a rect with softly rounded corners (radius clamped to the
  // rect's smaller side) so blocks and bars read as smooth shapes,
  // not hard-edged pixels.
  function roundRectPath(ctx, x, y, w, h, r) {
    var rr = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.arcTo(x + w, y, x + w, y + rr, rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
    ctx.lineTo(x + rr, y + h);
    ctx.arcTo(x, y + h, x, y + h - rr, rr);
    ctx.lineTo(x, y + rr);
    ctx.arcTo(x, y, x + rr, y, rr);
    ctx.closePath();
  }

  function fillRoundRect(ctx, x, y, w, h, r) {
    if (w <= 0 || h <= 0) return;
    roundRectPath(ctx, x, y, w, h, r);
    ctx.fill();
  }

  function strokeRoundRect(ctx, x, y, w, h, r) {
    if (w <= 0 || h <= 0) return;
    roundRectPath(ctx, x, y, w, h, r);
    ctx.stroke();
  }

  // ---- r9 realism palette (D3) --------------------------------------
  // Muted SA colours: olive-green ground, warm sand, deeper water.
  // The r8 saturated green (#5c8a3d) shouted; the olive reads as
  // terrain at 230x172 without drifting to GTA V grey.
  var MAP_COLORS = {
    ground: '#6d8a4a',
    water: '#6f97b8', shoreline: '#a8c8de',
    sand: '#e8cf8a', wetSand: '#c9a95e',
    building: '#f4f4f0', buildingOutline: 'rgba(60,60,55,0.55)',
    road: '#0d0d0d', casing: '#2e2e2e',
    highwayCasing: '#57503c', highwayEdge: '#8a7a4a'
  };

  // Deterministic 64x64 grain tile (LCG, fixed seed so screenshots
  // are reproducible), drawn at 3% opacity over the baked static
  // layer — texture without a per-frame cost (D2).
  var mapNoisePattern = null;
  function mapNoise(ctx) {
    if (mapNoisePattern) return mapNoisePattern;
    try {
      if (typeof document === 'undefined' || !document.createElement) return null;
      var c = document.createElement('canvas');
      c.width = 64; c.height = 64;
      var nctx = c.getContext('2d');
      if (!nctx) return null;
      var img = nctx.createImageData(64, 64);
      var seed = 1234567;
      for (var i = 0; i < img.data.length; i += 4) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        var v = 118 + (seed % 21) - 10; // mid-grey speckle +/-10
        img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v; img.data[i + 3] = 255;
      }
      nctx.putImageData(img, 0, 0);
      mapNoisePattern = ctx.createPattern(c, 'repeat');
      return mapNoisePattern;
    } catch (e) {
      return null;
    }
  }

  // Night factor for the map (D5): 0 by day, 1 at deep night.
  // Prefers an explicit state.nightF (test hook / future main3d
  // wiring), then the live day/night system the game already exposes
  // at window.__palma3d.daynight.stars (r8 wired the same value for
  // traffic-light halos), then a clock fallback.
  function nightFactor(state) {
    if (state && typeof state.nightF === 'number') return clamp(state.nightF, 0, 1);
    try {
      var dn = (typeof window !== 'undefined' && window.__palma3d) ? window.__palma3d.daynight : null;
      if (dn && typeof dn.stars === 'number') return clamp(dn.stars, 0, 1);
    } catch (e) { /* fall through to the clock */ }
    var mins = (state && typeof state.clockMinutes === 'number') ? state.clockMinutes : 720;
    var h = ((mins / 60) % 24 + 24) % 24;
    if (h >= 20 || h < 5) return 1;
    if (h >= 18 && h < 20) return (h - 18) / 2;
    if (h >= 5 && h < 7) return (7 - h) / 2;
    return 0;
  }

  // Night-mode map (D5): a cool dark-blue wash over the static layer
  // only (labels, POIs, route and bars draw after, so they stay
  // bright), then the highway centre lines re-stroked brighter so
  // roads stay readable. Only when nightF > 0.5; capped at ~35%
  // darkening so the map never goes void.
  function applyNightMap(ctx, W, mapH, nightF, mx, mz, c3, city) {
    if (!(nightF > 0.5)) return;
    var a = 0.35 * clamp((nightF - 0.5) * 2, 0, 1); // 0 at dusk, 0.35 deep night
    ctx.save();
    ctx.fillStyle = 'rgba(12,22,52,' + a.toFixed(3) + ')';
    ctx.fillRect(0, 0, W, mapH);
    ctx.restore();
    if (!city) return;
    var avenues = city.avenues || [];
    var streets = city.streets || [];
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,' + (0.55 + 0.35 * nightF).toFixed(2) + ')';
    ctx.lineWidth = 1.5;
    for (var i = 0; i < avenues.length; i++) {
      if (c3 && avenues[i] === c3.HIGHWAY_EAST_X) {
        var ax = mx(avenues[i]);
        ctx.beginPath();
        ctx.moveTo(ax + 0.5, 0);
        ctx.lineTo(ax + 0.5, mapH);
        ctx.stroke();
      }
    }
    // r10 clean sea: the night highway re-stroke starts at the sand
    // edge too, so no bright line crosses the water at night.
    var landX = 0;
    if (c3 && typeof c3.BEACH_X === 'number') landX = mx(c3.BEACH_X);
    for (var j = 0; j < streets.length; j++) {
      if (c3 && streets[j] === c3.HIGHWAY_NORTH_Z) {
        var sz = mz(streets[j]);
        ctx.beginPath();
        ctx.moveTo(landX, sz + 0.5);
        ctx.lineTo(W, sz + 0.5);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

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

  // One labelled bar of the minimap's bottom strip: label at the
  // left, dark track, coloured fill, number at the right.
  function drawMiniBar(ctx, x, y, w, h, frac, color, label, num) {
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 8px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(label, 4, y + h - 1);
    ctx.fillStyle = '#2a2a30';
    fillRoundRect(ctx, x, y, w, h, 2);
    ctx.fillStyle = color;
    fillRoundRect(ctx, x, y, Math.max(0, w * frac), h, 2);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'right';
    ctx.fillText(String(num), x + w + 24, y + h - 1);
    ctx.textAlign = 'left';
  }

  // Static minimap layer: ground, ocean/sand, building blocks,
  // district colour tints, roads, beach road, landmarks. Drawn once
  // into a 2x offscreen canvas; all of it is city geometry, so it
  // never changes while the city object is the same. (ctx, W, mapH
  // are CSS-pixel layout coords; the caller sets the transform.)
  //
  // SA STYLE (r8, muted r9 — see MAP_COLORS): the palette speaks San
  // Andreas — olive-green blocks, white buildings, black roads with
  // dark casing, blue water, warm sand — painted over OUR city
  // geometry. No SA art, no SA names, no SA map data: only the colour
  // language. The world->map transform and every position on the map
  // are byte-identical to r7; only colours change. r10: roads are
  // THIN/THICK lines, not a box grid, and the sea is clean blue —
  // no road, block or grain line ever crosses the water.
  function drawMinimapStatic(ctx, W, mapH, b, mx, mz, c3, shoreX, sandX, city, districts) {
    ctx.fillStyle = MAP_COLORS.ground;
    ctx.fillRect(0, 0, W, mapH);
    // Ocean, then the sand band, along the west edge. A darker wet
    // edge marks the waterline (r9 D3) and a 1 px lighter stroke is
    // the shoreline itself.
    ctx.fillStyle = MAP_COLORS.water;
    ctx.fillRect(0, 0, Math.max(0, mx(shoreX)), mapH);
    ctx.fillStyle = MAP_COLORS.sand;
    ctx.fillRect(Math.max(0, mx(shoreX)), 0, Math.max(0, mx(sandX) - mx(shoreX)), mapH);
    ctx.fillStyle = MAP_COLORS.wetSand;
    ctx.fillRect(Math.max(0, mx(shoreX)), 0, 2, mapH);
    ctx.strokeStyle = MAP_COLORS.shoreline;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(mx(shoreX) + 0.5, 0);
    ctx.lineTo(mx(shoreX) + 0.5, mapH);
    ctx.stroke();

    // r10 clean sea: landX is the east edge of the sand (no road or
    // grid line starts west of it) and seaX is the waterline (no
    // building or grain is painted west of it). The sea itself is
    // just the flat water fill above — clean blue, no lines.
    var landX = mx(sandX);
    var seaX = mx(shoreX);

    // City blocks: real building footprints when the city adapter
    // carries them, otherwise the block cells of the road grid.
    // SA language: white buildings on green blocks, so the map reads
    // as streets at a glance. r9 D2: buildings are rounded rects
    // (radius 1-2 px) with a 0.5 px grey outline so adjacent white
    // buildings don't merge into one blob.
    var avenues = (city && city.avenues) || [];
    var streets = (city && city.streets) || [];
    var buildings = (city && city.buildings) || [];
    if (buildings.length) {
      for (var bi = 0; bi < buildings.length; bi++) {
        var bd = buildings[bi];
        var bx0 = mx(bd.x0), bz0 = mz(bd.z0 !== undefined ? bd.z0 : bd.y0);
        var bx1 = mx(bd.x1), bz1 = mz(bd.z1 !== undefined ? bd.z1 : bd.y1);
        if (bx1 < 0 || bz1 < 0 || bx0 > W || bz0 > mapH || bx1 <= seaX) continue;
        ctx.fillStyle = MAP_COLORS.building;
        fillRoundRect(ctx, bx0, bz0, Math.max(1, bx1 - bx0), Math.max(1, bz1 - bz0), 2);
        ctx.strokeStyle = MAP_COLORS.buildingOutline;
        ctx.lineWidth = 0.5;
        strokeRoundRect(ctx, bx0, bz0, Math.max(1, bx1 - bx0), Math.max(1, bz1 - bz0), 2);
      }
    } else {
      // r10: NO per-block rects. The r9 fallback painted every block
      // cell as its own edged, bevelled box, so the map read as a
      // grid of boxes. The green ground fill above IS the block
      // field now — the road lines below carve it, and nothing else
      // needs drawing. (Positions unchanged: this branch only ran
      // when the city carried no buildings at all.)
    }
    // District tints: each district's own accent colour at low alpha,
    // under the roads — the stats-map colour-coding (brown/tan/blue),
    // so the minimap reads as districts, not a grid. r9 D3: a very
    // subtle per-district lightness shift (+3% even, -3% odd) so
    // districts read without labels.
    for (var d = 0; d < districts.length; d++) {
      var dist = districts[d];
      var x0 = dist.x0, z0 = (dist.z0 !== undefined ? dist.z0 : dist.y0);
      var x1 = dist.x1, z1 = (dist.z1 !== undefined ? dist.z1 : dist.y1);
      if (mx(x1) <= landX) continue; // r10: district tint never touches the sea
      ctx.fillStyle = (dist.accent || '#ffd166') + '2e';
      fillRoundRect(ctx, mx(x0), mz(z0), mx(x1) - mx(x0), mz(z1) - mz(z0), 2);
      ctx.fillStyle = (d % 2 === 0) ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)';
      fillRoundRect(ctx, mx(x0), mz(z0), mx(x1) - mx(x0), mz(z1) - mz(z0), 2);
    }
    // Roads, r10: LINES, not boxes. The r9 casing/fill at 5/3 px
    // carved the green into a grid of little squares, so the whole
    // map read as boxes. Now the hierarchy is line weight only: the
    // two highways are THICK main lines (7 casing / 5 fill, white
    // centre, warm edge); every grid street is one THIN side line
    // (3 casing / 1.5 fill, no centre line); the beach road sits
    // between them (4 / 2.5). No per-block rect is drawn any more —
    // the green ground fill IS the block field and the road lines
    // carve it. Clean sea: every road starts at landX, the east
    // edge of the sand, so no grid line ever crosses the water;
    // the beach road is the one exception — it runs on the sand
    // itself. Positions are unchanged, only stroke widths and the
    // clip point move. (The city data has one uniform 200 m grid,
    // so the thick/thin split is highways = mains, grid = sides.)
    for (var a = 0; a < avenues.length; a++) {
      var ax = mx(avenues[a]);
      if (ax < landX) continue; // west of the sand: sea, no road
      var wideA = !!(c3 && avenues[a] === c3.HIGHWAY_EAST_X);
      ctx.strokeStyle = wideA ? MAP_COLORS.highwayCasing : MAP_COLORS.casing;
      ctx.lineWidth = wideA ? 7 : 3;
      ctx.beginPath();
      ctx.moveTo(ax, 0);
      ctx.lineTo(ax, mapH);
      ctx.stroke();
      ctx.strokeStyle = MAP_COLORS.road;
      ctx.lineWidth = wideA ? 5 : 1.5;
      ctx.beginPath();
      ctx.moveTo(ax, 0);
      ctx.lineTo(ax, mapH);
      ctx.stroke();
      if (wideA) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(ax + 0.5, 0);
        ctx.lineTo(ax + 0.5, mapH);
        ctx.stroke();
        ctx.strokeStyle = MAP_COLORS.highwayEdge;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(ax - 3, 0);
        ctx.lineTo(ax - 3, mapH);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(ax + 3, 0);
        ctx.lineTo(ax + 3, mapH);
        ctx.stroke();
      }
    }
    for (var s = 0; s < streets.length; s++) {
      var sz = mz(streets[s]);
      var wideS = !!(c3 && streets[s] === c3.HIGHWAY_NORTH_Z);
      ctx.strokeStyle = wideS ? MAP_COLORS.highwayCasing : MAP_COLORS.casing;
      ctx.lineWidth = wideS ? 7 : 3;
      ctx.beginPath();
      ctx.moveTo(landX, sz);
      ctx.lineTo(W, sz);
      ctx.stroke();
      ctx.strokeStyle = MAP_COLORS.road;
      ctx.lineWidth = wideS ? 5 : 1.5;
      ctx.beginPath();
      ctx.moveTo(landX, sz);
      ctx.lineTo(W, sz);
      ctx.stroke();
      if (wideS) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(landX, sz + 0.5);
        ctx.lineTo(W, sz + 0.5);
        ctx.stroke();
        ctx.strokeStyle = MAP_COLORS.highwayEdge;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(landX, sz - 3);
        ctx.lineTo(W, sz - 3);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(landX, sz + 3);
        ctx.lineTo(W, sz + 3);
        ctx.stroke();
      }
    }
    if (city && typeof city.beachRoadX === 'number') {
      var brx = mx(city.beachRoadX);
      ctx.strokeStyle = MAP_COLORS.casing;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(brx, 0);
      ctx.lineTo(brx, mapH);
      ctx.stroke();
      ctx.strokeStyle = MAP_COLORS.road;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(brx, 0);
      ctx.lineTo(brx, mapH);
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
        ctx.lineWidth = 1.5;
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
    // Grain (r9 D2): a 3% opacity noise pattern over the baked
    // static layer. It is painted here, once, into the cached
    // offscreen canvas — never per frame. r10: land only, east of
    // the waterline — the sea stays clean blue, no speckle.
    var pat = mapNoise(ctx);
    if (pat) {
      ctx.save();
      ctx.globalAlpha = 0.03;
      ctx.fillStyle = pat;
      ctx.fillRect(seaX, 0, W - seaX, mapH);
      ctx.restore();
    }
  }

  // The cached 2x static layer for this city, rebuilt when the city
  // changes. Returns null when no offscreen canvas can be made; the
  // caller then draws the static layer inline each frame instead.
  function minimapStaticCanvas(city, W, mapH, b, mx, mz, c3, shoreX, sandX, districts) {
    if (minimapStatic.canvas && minimapStatic.city === city) return minimapStatic.canvas;
    var off = null;
    try {
      if (typeof document === 'undefined' || !document.createElement) return null;
      off = document.createElement('canvas');
      off.width = Math.round(W * MINIMAP_STATIC_SCALE);
      off.height = Math.round(mapH * MINIMAP_STATIC_SCALE);
      var octx = off.getContext('2d');
      if (!octx) return null;
      octx.setTransform(MINIMAP_STATIC_SCALE, 0, 0, MINIMAP_STATIC_SCALE, 0, 0);
      octx.lineJoin = 'round';
      octx.lineCap = 'round';
      drawMinimapStatic(octx, W, mapH, b, mx, mz, c3, shoreX, sandX, city, districts);
    } catch (e) {
      return null;
    }
    minimapStatic.city = city;
    minimapStatic.canvas = off;
    return off;
  }

  // ---- points of interest (r8, SA radar style) ----------------------
  // Canvas glyphs only — no images, no SA art. Names and spots are
  // OUR city: shop names invented here, positions on our own grid
  // (block centres, never on a road centreline). The hospital spots
  // are the real B4 meshes: PALMA VERDE GENERAL at (52,-500) and the
  // beach clinic CLINICA PLAYA at (-1520,300) in world3d.js. When the
  // city adapter carries `hospitals` (B4's export) those coordinates
  // win over the fallback constants below, so the icons track the
  // meshes if B4 ever moves them.
  var POIS = [
    { kind: 'clothing', name: 'TELA VIVA', x: -500, z: -300 },
    { kind: 'gym', name: 'GIMNASIO BRISA', x: -1100, z: 700 },
    { kind: 'spray', name: 'PINTURA SOL', x: 300, z: 700 },
    { kind: 'burger', name: 'BURGER SOL', x: -1300, z: 500 },
    { kind: 'garage', name: "NADIA'S GARAGE", x: -900, z: -900 },
    { kind: 'hospital', name: 'PALMA VERDE GENERAL', hid: 'general', x: 52, z: -500 },
    { kind: 'hospital', name: 'CLINICA PLAYA', hid: 'clinic', x: -1520, z: 300 }
  ];

  function poiList(city) {
    var hosps = (city && city.hospitals) || [];
    if (!hosps.length) return POIS;
    return POIS.map(function (poi) {
      if (!poi.hid) return poi;
      for (var i = 0; i < hosps.length; i++) {
        if (hosps[i].id === poi.hid) {
          return { kind: poi.kind, name: poi.name, hid: poi.hid, x: hosps[i].x, z: hosps[i].z };
        }
      }
      return poi;
    });
  }

  // The radar shows only the essential POIs (r9 D4 declutter):
  // hospital, garage and food. Clothing, gym and spray shop stay
  // on the full map (M), where there is room for all of them.
  var MINIMAP_POI = { hospital: true, garage: true, burger: true };

  // One POI glyph at map point (x, y), disc radius r. Glyphs are
  // drawn in unit space (-1..1) so the same painter serves the radar
  // (r 7) and the full map (r 13). A dark disc backs every glyph so
  // it reads over white buildings; the hospital is the exception — a
  // white disc with a red cross, the universal hospital mark.
  // r9 D4: every POI type is a DISTINCT shape (hospital = cross,
  // garage = wrench, food = burger, clothing = hanger), each filled
  // white and stroked with a 1 px dark outline so it stays crisp at
  // radar size.
  function drawPoiIcon(ctx, x, y, r, kind) {
    ctx.save();
    ctx.translate(x, y);
    if (kind === 'hospital') {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#111111';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#d21f14';
      ctx.fillRect(-r * 0.22, -r * 0.62, r * 0.44, r * 1.24);
      ctx.fillRect(-r * 0.62, -r * 0.22, r * 1.24, r * 0.44);
      ctx.restore();
      return;
    }
    ctx.fillStyle = 'rgba(10,14,10,0.78)';
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.scale(r, r);
    if (kind === 'clothing') {
      // Hanger: hook arc + triangular body, stroked white (a filled
      // triangle would read as a solid pennant, not a hanger).
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 0.16;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.arc(0, -0.42, 0.16, Math.PI * 0.9, Math.PI * 2.05);
      ctx.moveTo(0, -0.26);
      ctx.lineTo(0, -0.1);
      ctx.lineTo(-0.68, 0.5);
      ctx.lineTo(0.68, 0.5);
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
      return;
    }
    // Every other glyph is one canvas path: white fill + 1 px dark
    // outline (1/r in unit space = 1 device px after the scale).
    // fill() leaves the current path intact, so stroke() outlines
    // exactly the same shape — no Path2D needed (the Node self-test
    // has no Path2D global).
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#111111';
    ctx.lineWidth = 1 / r;
    ctx.lineJoin = 'round';
    if (kind === 'gym') {
      // Dumbbell: two plates and a bar.
      ctx.beginPath();
      ctx.rect(-0.85, -0.5, 0.28, 1.0);
      ctx.rect(0.57, -0.5, 0.28, 1.0);
      ctx.rect(-0.57, -0.16, 1.14, 0.32);
      ctx.fill();
      ctx.stroke();
    } else if (kind === 'spray') {
      // Spray can: body, nozzle, three spray dots.
      ctx.beginPath();
      ctx.rect(-0.42, -0.05, 0.84, 0.65);
      ctx.rect(-0.14, -0.4, 0.28, 0.35);
      ctx.arc(-0.3, -0.62, 0.09, 0, Math.PI * 2);
      ctx.arc(0.05, -0.72, 0.09, 0, Math.PI * 2);
      ctx.arc(0.38, -0.58, 0.09, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (kind === 'burger') {
      // Burger: top bun, patty, bottom bun, dark gaps between.
      ctx.beginPath();
      ctx.arc(0, 0.12, 0.62, Math.PI, 0);
      ctx.closePath();
      ctx.rect(-0.62, 0.22, 1.24, 0.18);
      ctx.rect(-0.55, 0.5, 1.1, 0.16);
      ctx.fill();
      ctx.stroke();
    } else if (kind === 'garage') {
      // Wrench (spanner): open jaw on top, handle below, tilted so
      // the jaw reads at radar size.
      ctx.rotate(-0.6);
      ctx.beginPath();
      ctx.arc(0, -0.5, 0.34, 0, Math.PI * 2);
      ctx.rect(-0.13, -0.3, 0.26, 1.05);
      ctx.fill();
      ctx.stroke();
      // Open jaw: cut the top of the head back out in the disc
      // colour so the wrench reads as open-ended, not a lollipop.
      ctx.fillStyle = 'rgba(10,14,10,0.78)';
      ctx.beginPath();
      ctx.moveTo(0, -0.5);
      ctx.lineTo(0.34, -1.02);
      ctx.lineTo(-0.34, -1.02);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      return;
    } else {
      // Unknown kind: plain dot, never invisible.
      ctx.beginPath();
      ctx.arc(0, 0, 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawMinimap(dom, state, city) {
    var canvas = dom.minimap;
    var ctx = canvas.getContext('2d');
    if (!ctx) return;
    // Layout coords stay in CSS pixels (W/H = the panel's on-screen
    // size); the scale transform maps them onto the backing store.
    var cssW = (dom.zones && dom.zones.minimap) ? dom.zones.minimap.w : canvas.width;
    var cssH = (dom.zones && dom.zones.minimap) ? dom.zones.minimap.h : canvas.height;
    var scale = dom.minimapScale || (canvas.width / cssW) || 1;
    var W = cssW, H = cssH;
    var barH = 26;
    var mapH = H - barH;
    var b = mapBounds(city);
    function mx(wx) { return ((wx - b.x0) / (b.x1 - b.x0)) * W; }
    function mz(wz) { return ((wz - b.z0) / (b.z1 - b.z0)) * mapH; }
    var c3 = config3d();
    var shoreX = c3 ? c3.SHORE_X : b.x0 + 180;
    var sandX = c3 ? c3.BEACH_X : b.x0 + 300;
    var wanted = state.wanted || 0;
    var pulse = 0.5 + 0.5 * Math.sin((state.time || 0) * 5);
    var districts = (city && city.districts) ||
      (c3 ? c3.DISTRICTS : ((config() || {}).DISTRICTS || []));

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    // Round joins/caps so the gold route's corner and road ends are
    // smooth curves instead of sharp mitres.
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    // Smooth downscale of the 2x static layer (never pixel-art mode).
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // Static layer: pre-rendered once per city, blitted each frame;
    // falls back to an inline draw when no offscreen canvas exists.
    // (Verified r9: the minimap does NOT re-paint the static layer
    // per frame — minimapStaticCanvas returns the cached canvas while
    // the city object is the same, so this is one drawImage.)
    var staticCanvas = minimapStaticCanvas(city, W, mapH, b, mx, mz, c3, shoreX, sandX, districts);
    if (staticCanvas) {
      ctx.drawImage(staticCanvas, 0, 0, W, mapH);
    } else {
      drawMinimapStatic(ctx, W, mapH, b, mx, mz, c3, shoreX, sandX, city, districts);
    }

    // Night mode (r9 D5): darkens the static layer only; labels,
    // POIs, route and bars draw after and stay bright.
    var nightF = nightFactor(state);
    applyNightMap(ctx, W, mapH, nightF, mx, mz, c3, city);

    // District labels: drawn per frame after the downscale, in a real
    // font at 10px CSS, so they stay crisp — never baked into the
    // static layer. Same centres as before, only the size changes.
    // White text with a dark outline, so it reads over white
    // buildings as well as green blocks.
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 3;
    ctx.font = 'bold 10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (var d = 0; d < districts.length; d++) {
      var dist = districts[d];
      var x0 = dist.x0, z0 = (dist.z0 !== undefined ? dist.z0 : dist.y0);
      var x1 = dist.x1, z1 = (dist.z1 !== undefined ? dist.z1 : dist.y1);
      var dLabel = (dist.short || dist.name || '').toUpperCase();
      var dCx = (mx(x0) + mx(x1)) / 2, dCy = (mz(z0) + mz(z1)) / 2;
      ctx.strokeText(dLabel, dCx, dCy);
      ctx.fillText(dLabel, dCx, dCy);
    }
    ctx.textAlign = 'left';

    // Points of interest: SA-style canvas glyphs on our own city
    // spots (see POIS). Drawn under the route and blips. The radar
    // shows only the essential POIs (r9 D4 declutter); at night each
    // shown icon gets a faint warm halo so lit POIs read brighter.
    var pois = poiList(city);
    for (var pi = 0; pi < pois.length; pi++) {
      if (!MINIMAP_POI[pois[pi].kind]) continue;
      var pix = mx(pois[pi].x), piy = mz(pois[pi].z);
      if (nightF > 0.5) {
        var halo = ctx.createRadialGradient(pix, piy, 2, pix, piy, 16);
        halo.addColorStop(0, 'rgba(255,214,110,' + (0.22 * nightF).toFixed(2) + ')');
        halo.addColorStop(1, 'rgba(255,214,110,0)');
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(pix, piy, 16, 0, Math.PI * 2);
        ctx.fill();
      }
      drawPoiIcon(ctx, pix, piy, 7, pois[pi].kind);
    }

    // Route: a solid gold line with a pale casing, player to the
    // mission marker along the grid, ending in a waypoint diamond
    // with a pulsing ring.
    var target = state.missionTarget;
    var p = state.player;
    var pz = (p.z !== undefined ? p.z : p.y);
    if (target) {
      var tz = (target.z !== undefined ? target.z : target.y);
      var tx = mx(target.x), ty = mz(tz);
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(mx(p.x), mz(pz));
      ctx.lineTo(tx, mz(pz));
      ctx.lineTo(tx, ty);
      ctx.stroke();
      ctx.strokeStyle = '#ffc21c';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(mx(p.x), mz(pz));
      ctx.lineTo(tx, mz(pz));
      ctx.lineTo(tx, ty);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,194,28,' + (0.5 + 0.5 * pulse).toFixed(2) + ')';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(tx, ty, 9 + 2 * pulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#ffc21c';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.save();
      ctx.translate(tx, ty);
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-6, -6, 12, 12);
      ctx.strokeRect(-6, -6, 12, 12);
      ctx.restore();
      // Rim arrow (r9 D4): the waypoint is off the radar — point at
      // it from the panel rim instead of letting the route run off
      // blind. Clamp the target onto the rim, 10 px inside the edge,
      // and draw a gold arrow pointing out toward it.
      if (tx < 0 || tx > W || ty < 0 || ty > mapH) {
        var rcx = W / 2, rcy = mapH / 2;
        var rdx = tx - rcx, rdy = ty - rcy;
        var rm = Math.max(Math.abs(rdx) / (W / 2 - 10), Math.abs(rdy) / (mapH / 2 - 10));
        var rx = rcx + rdx / rm, ry = rcy + rdy / rm;
        ctx.save();
        ctx.translate(rx, ry);
        ctx.rotate(Math.atan2(rdy, rdx));
        ctx.fillStyle = '#ffc21c';
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(9, 0);
        ctx.lineTo(-6, -6);
        ctx.lineTo(-6, 6);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }
    // Police blips: red dots with a white ring, pulsing while wanted.
    // The heli reads as a red ring with a red centre.
    if (state.police) {
      var units = state.police.units || [];
      for (var u = 0; u < units.length; u++) {
        var car = units[u].car || units[u].ped || units[u];
        var ux = car.x || 0, uz = (car.z !== undefined ? car.z : (car.y || 0));
        var ur = wanted > 0 ? 3.5 + 1.5 * pulse : 3.5;
        ctx.fillStyle = '#ff3b30';
        ctx.beginPath();
        ctx.arc(mx(ux), mz(uz), ur, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(mx(ux), mz(uz), ur, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (state.police.heli) {
        var hx = state.police.heli.x, hz = (state.police.heli.z !== undefined ? state.police.heli.z : state.police.heli.y);
        var hr = wanted > 0 ? 6 + 1.5 * pulse : 6;
        ctx.strokeStyle = '#ff3b30';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(mx(hx), mz(hz), hr, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#ff3b30';
        ctx.beginPath();
        ctx.arc(mx(hx), mz(hz), 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Player arrow: white, dark-outlined, pointing where Rey heads.
    // SA style — the arrow rotates with the facing, the map stays
    // north-up. Same shape and size as r7, only the colours change.
    // r9 D4: a thin direction tick past the tip, and a subtle pulse
    // (scale) while wanted.
    var ang = (p.vehicle ? p.vehicle.angle : p.angle) || 0;
    var arrowPulse = wanted > 0 ? 1 + 0.07 * pulse : 1;
    ctx.save();
    ctx.translate(mx(p.x), mz(pz));
    ctx.rotate(ang);
    ctx.scale(arrowPulse, arrowPulse);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#111111';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(11, 0);
    ctx.lineTo(-8, -7);
    ctx.lineTo(-4, 0);
    ctx.lineTo(-8, 7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = '#111111';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(11, 0);
    ctx.lineTo(16, 0);
    ctx.stroke();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(11, 0);
    ctx.lineTo(16, 0);
    ctx.stroke();
    ctx.restore();

    // Health + armour bars along the bottom of the minimap panel.
    var barY = mapH + 4;
    ctx.fillStyle = 'rgba(8,12,18,0.92)';
    ctx.fillRect(0, mapH, W, barH);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(0, mapH, W, 1);
    drawMiniBar(ctx, 24, barY, W - 52, 8, clamp(p.health || 0, 0, 100) / 100, '#4caf50', 'HP', Math.round(p.health || 0));
    drawMiniBar(ctx, 24, barY + 11, W - 52, 8, clamp(p.armour || 0, 0, 100) / 100, '#7ec3e8', 'AR', Math.round(p.armour || 0));
    // Wanted feedback: a red border that flashes while the heat is on,
    // plus a faint red wash over the map.
    if (wanted > 0) {
      ctx.fillStyle = 'rgba(255,59,48,' + (0.05 + 0.06 * pulse).toFixed(2) + ')';
      ctx.fillRect(0, 0, W, mapH);
      ctx.strokeStyle = 'rgba(255,59,48,' + (0.55 + 0.45 * pulse).toFixed(2) + ')';
      ctx.lineWidth = 3;
      ctx.strokeRect(1.5, 1.5, W - 3, H - 3);
    }
  }

  // ---- full map (M key, r8) --------------------------------------------
  // The SA full map, rectangular like the reference: the whole city
  // at 1120x560, same static painter as the radar (same SA colours,
  // same geometry source), with bigger labels, named POI icons, the
  // gold route, police blips and the white player arrow. The static
  // layer is cached per city at 2x, like the radar's; only the
  // dynamic layer redraws per frame while the map is open.
  var FULLMAP_W = 1120, FULLMAP_H = 560;
  var FULLMAP_STATIC_SCALE = 2;
  var fullmapStatic = { city: null, canvas: null };

  function fullmapStaticCanvas(city, W, mapH, b, mx, mz, c3, shoreX, sandX, districts) {
    if (fullmapStatic.canvas && fullmapStatic.city === city) return fullmapStatic.canvas;
    var off = null;
    try {
      if (typeof document === 'undefined' || !document.createElement) return null;
      off = document.createElement('canvas');
      off.width = Math.round(W * FULLMAP_STATIC_SCALE);
      off.height = Math.round(mapH * FULLMAP_STATIC_SCALE);
      var octx = off.getContext('2d');
      if (!octx) return null;
      octx.setTransform(FULLMAP_STATIC_SCALE, 0, 0, FULLMAP_STATIC_SCALE, 0, 0);
      octx.lineJoin = 'round';
      octx.lineCap = 'round';
      drawMinimapStatic(octx, W, mapH, b, mx, mz, c3, shoreX, sandX, city, districts);
    } catch (e) {
      return null;
    }
    fullmapStatic.city = city;
    fullmapStatic.canvas = off;
    return off;
  }

  function drawFullmap(dom, state, city) {
    var canvas = dom.fullmapCanvas;
    var ctx = canvas.getContext('2d');
    if (!ctx) return;
    var W = FULLMAP_W, H = FULLMAP_H;
    var scale = dom.fullmapScale || (canvas.width / W) || 1;
    var b = mapBounds(city);
    function mx(wx) { return ((wx - b.x0) / (b.x1 - b.x0)) * W; }
    function mz(wz) { return ((wz - b.z0) / (b.z1 - b.z0)) * H; }
    var c3 = config3d();
    var shoreX = c3 ? c3.SHORE_X : b.x0 + 180;
    var sandX = c3 ? c3.BEACH_X : b.x0 + 300;
    var districts = (city && city.districts) ||
      (c3 ? c3.DISTRICTS : ((config() || {}).DISTRICTS || []));
    var p = state.player;
    var pz = (p.z !== undefined ? p.z : p.y);
    var pulse = 0.5 + 0.5 * Math.sin((state.time || 0) * 5);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    var staticCanvas = fullmapStaticCanvas(city, W, H, b, mx, mz, c3, shoreX, sandX, districts);
    if (staticCanvas) {
      ctx.drawImage(staticCanvas, 0, 0, W, H);
    } else {
      drawMinimapStatic(ctx, W, H, b, mx, mz, c3, shoreX, sandX, city, districts);
    }

    // Night mode (r9 D5), same as the radar: the static layer dims,
    // everything dynamic stays bright.
    var nightF = nightFactor(state);
    applyNightMap(ctx, W, H, nightF, mx, mz, c3, city);

    // District labels, large, white with a dark outline.
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 4;
    ctx.font = 'bold 14px system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (var d = 0; d < districts.length; d++) {
      var dist = districts[d];
      var x0 = dist.x0, z0 = (dist.z0 !== undefined ? dist.z0 : dist.y0);
      var x1 = dist.x1, z1 = (dist.z1 !== undefined ? dist.z1 : dist.y1);
      var label = (dist.short || dist.name || '').toUpperCase();
      var cx = (mx(x0) + mx(x1)) / 2, cy = (mz(z0) + mz(z1)) / 2;
      ctx.strokeText(label, cx, cy);
      ctx.fillText(label, cx, cy);
    }

    // POI icons with names. The name goes right of the icon, or left
    // when the icon sits near the right edge. The full map shows ALL
    // POIs (r9 D4 declutter applies to the radar only).
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'left';
    var pois = poiList(city);
    for (var pi = 0; pi < pois.length; pi++) {
      var poi = pois[pi];
      var px = mx(poi.x), py = mz(poi.z);
      if (nightF > 0.5) {
        var fhalo = ctx.createRadialGradient(px, py, 3, px, py, 30);
        fhalo.addColorStop(0, 'rgba(255,214,110,' + (0.22 * nightF).toFixed(2) + ')');
        fhalo.addColorStop(1, 'rgba(255,214,110,0)');
        ctx.fillStyle = fhalo;
        ctx.beginPath();
        ctx.arc(px, py, 30, 0, Math.PI * 2);
        ctx.fill();
      }
      drawPoiIcon(ctx, px, py, 13, poi.kind);
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.lineWidth = 3;
      var nameX = (px > W - 180) ? px - 18 - ctx.measureText(poi.name).width : px + 18;
      ctx.strokeText(poi.name, nameX, py + 4);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(poi.name, nameX, py + 4);
    }
    ctx.textAlign = 'left';

    // Route: gold line with a pale casing, player to the waypoint.
    var target = state.missionTarget;
    if (target) {
      var tz = (target.z !== undefined ? target.z : target.y);
      var tx = mx(target.x), ty = mz(tz);
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(mx(p.x), mz(pz));
      ctx.lineTo(tx, mz(pz));
      ctx.lineTo(tx, ty);
      ctx.stroke();
      ctx.strokeStyle = '#ffc21c';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(mx(p.x), mz(pz));
      ctx.lineTo(tx, mz(pz));
      ctx.lineTo(tx, ty);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,194,28,' + (0.5 + 0.5 * pulse).toFixed(2) + ')';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(tx, ty, 13 + 3 * pulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#ffc21c';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.save();
      ctx.translate(tx, ty);
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-9, -9, 18, 18);
      ctx.strokeRect(-9, -9, 18, 18);
      ctx.restore();
    }

    // Police blips, same language as the radar, larger.
    if (state.police) {
      var units = state.police.units || [];
      for (var u = 0; u < units.length; u++) {
        var car = units[u].car || units[u].ped || units[u];
        var ux = car.x || 0, uz = (car.z !== undefined ? car.z : (car.y || 0));
        ctx.fillStyle = '#ff3b30';
        ctx.beginPath();
        ctx.arc(mx(ux), mz(uz), 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(mx(ux), mz(uz), 5, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (state.police.heli) {
        var hx = state.police.heli.x, hz = (state.police.heli.z !== undefined ? state.police.heli.z : state.police.heli.y);
        ctx.strokeStyle = '#ff3b30';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(mx(hx), mz(hz), 9, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#ff3b30';
        ctx.beginPath();
        ctx.arc(mx(hx), mz(hz), 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Player arrow, white, larger than the radar's, rotating, with
    // the same direction tick as the radar (r9 D4).
    var ang = (p.vehicle ? p.vehicle.angle : p.angle) || 0;
    ctx.save();
    ctx.translate(mx(p.x), mz(pz));
    ctx.rotate(ang);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#111111';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(18, 0);
    ctx.lineTo(-13, -11);
    ctx.lineTo(-6, 0);
    ctx.lineTo(-13, 11);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = '#111111';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(18, 0);
    ctx.lineTo(25, 0);
    ctx.stroke();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(18, 0);
    ctx.lineTo(25, 0);
    ctx.stroke();
    ctx.restore();

    // N marker, top-right corner of the map.
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.lineWidth = 4;
    ctx.font = 'bold 18px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.strokeText('N', W - 22, 28);
    ctx.fillText('N', W - 22, 28);
    ctx.textAlign = 'left';
  }

  // Full-map open state + the M key. hud3d.js loads as a classic
  // script before main3d.js (a deferred module), so this listener
  // registers BEFORE main3d's keydown handler: when the map is open
  // and the player presses Escape, stopImmediatePropagation keeps
  // main3d from also opening the pause menu. M is free everywhere —
  // main3d binds Tab/Enter/arrows/Escape/E/Q/Z/X/V/F9/T and
  // weapons3d binds Tab/digits/R — so no other file needs a change.
  var fullmapOpen = false;
  var fullmapDom = null;
  var fullmapLastState = null;

  function setFullmapOpen(open) {
    fullmapOpen = !!open;
    if (fullmapDom && fullmapDom.fullmap) {
      fullmapDom.fullmap.style.display = fullmapOpen ? '' : 'none';
    }
  }

  function onFullmapKeyDown(e) {
    if (!fullmapDom || !e || e.repeat) return;
    var playing = fullmapLastState && fullmapLastState.screen === 'playing';
    if (e.code === 'KeyM') {
      if (playing || fullmapOpen) {
        setFullmapOpen(!fullmapOpen);
        if (typeof e.preventDefault === 'function') e.preventDefault();
      }
    } else if (e.code === 'Escape' && fullmapOpen) {
      setFullmapOpen(false);
      if (typeof e.preventDefault === 'function') e.preventDefault();
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    }
  }

  if (typeof window !== 'undefined' && window.addEventListener) {
    try { window.addEventListener('keydown', onFullmapKeyDown); } catch (err) { /* key hook is best-effort */ }
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
    // Full map: the M key toggles it; redrawn per frame while open
    // so the arrow, blips and route track the live game.
    fullmapLastState = state;
    if (fullmapOpen) drawFullmap(dom, state, city);
    dom.minimapWrap.classList.toggle('pv3d-minimap-wanted', (state.wanted || 0) > 0);
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
    fullmapDom = dom;
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
      conditionLabel: conditionLabel,
      isFullmapOpen: function () { return fullmapOpen; },
      setFullmapOpen: setFullmapOpen,
      toggleFullmap: function () { setFullmapOpen(!fullmapOpen); }
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
      '.pv3d-minimap-wrap{position:absolute;box-shadow:0 4px 16px rgba(0,0,0,0.55)}',
      '.pv3d-minimap{display:block;background:rgba(8,18,14,0.8)}',
      '.pv3d-minimap-chip{position:absolute;left:4px;top:4px;background:rgba(8,12,18,0.85);color:#ffd166;font-size:10px;font-weight:700;padding:2px 6px}',
      '.pv3d-minimap-compass{position:absolute;right:6px;top:4px;color:#fff;font-size:11px;font-weight:700;text-shadow:0 1px 2px #000,0 0 3px #000}',
      '.pv3d-minimap-wanted{outline:2px solid #ff3b30;outline-offset:-2px}',
      '.pv3d-fullmap-overlay{position:absolute;left:0;top:0;width:1280px;height:720px;background:rgba(4,8,12,0.88);z-index:5}',
      '.pv3d-fullmap-title{position:absolute;left:0;top:14px;width:1280px;text-align:center;font-size:20px;font-weight:700;color:#ffd166;letter-spacing:3px}',
      '.pv3d-fullmap-canvas{position:absolute;left:80px;top:56px;border:2px solid rgba(255,209,102,0.6)}',
      '.pv3d-fullmap-hint{position:absolute;left:0;top:630px;width:1280px;text-align:center;font-size:13px;font-weight:700;color:#ffd166}',
      '.pv3d-fullmap-legend{position:absolute;left:0;top:654px;width:1280px;text-align:center;font-size:11px;color:#c9d2e0}',
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
    rankName: rankName,
    isFullmapOpen: function () { return fullmapOpen; },
    setFullmapOpen: setFullmapOpen,
    toggleFullmap: function () { setFullmapOpen(!fullmapOpen); }
  };
})();
