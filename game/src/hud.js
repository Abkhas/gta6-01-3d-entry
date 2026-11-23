// Palma Verde — HUD: every number and panel the player reads while
// playing, drawn straight onto the game canvas after the world render.
//
// D6 LAYOUT GRID (1280x720 design frame, scaled to the real canvas).
// One grid, every panel clamped inside its own zone, zero overlaps:
//
//   TOP ROW    mission header (left, x14 w470) | money + stars (right)
//   LEFT RAIL  vitals (y100) -> PVPD dispatch (y202, only when wanted)
//   RIGHT RAIL crew cards (y90, three cards, no dispatch here)
//   BOTTOM     clock + radio (above the minimap, never under the bar)
//              minimap (bottom-left) | weapon bar (bottom centre-left)
//              dialogue (bottom-centre, above the weapon bar)
//              speedo (bottom-right)
//   The horizon band (CFG.FRAME.HORIZON_Y, fallback 180) is the sky
//   the render builder reserves; HUD panels sit over it, never in the
//   way of the road. Zones are checked against each other by the
//   numbers in layout(): mission ends x484, money starts x1036;
//   dialogue ends y652, weapons start y660; weapons end x814, speedo
//   starts x1036; clock ends y523, minimap starts y531.

(function () {
  'use strict';

  var CFG = window.PalmaConfig;

  var TACTIC_COLORS = {
    RAMMING: '#e84a3a', PIT: '#e87b2b', ROADBLOCK: '#e8c53a',
    FLANKING: '#4a90e8', SPOTLIGHT: '#e8e8e8', PURSUIT: '#4caf50',
    SEARCHING: '#8a8a92'
  };

  var CREW_KEYS = { tuck: 'Z', ines: 'X', kip: 'V' };

  // Unit-kind chips for the dispatch rail: cruiser / bike / foot /
  // heli, each with its own tag colour. SEARCHING is a tactic value
  // the police layer already sends (grey pill, see TACTIC_COLORS).
  var KIND_CHIPS = {
    cruiser: { tag: 'CR', fill: '#4a90e8' },
    bike: { tag: 'BK', fill: '#e87b2b' },
    foot: { tag: 'FT', fill: '#4caf50' },
    heli: { tag: 'AIR', fill: '#e8e8e8' }
  };

  function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
  }

  function moneyStr(n) {
    return '$' + Math.floor(n).toLocaleString('en-US');
  }

  function clockStr(mins) {
    var hh = Math.floor(mins / 60);
    var mm = Math.floor(mins % 60);
    return (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm;
  }

  // The sky band the render builder reserves at the top of the frame.
  // config.js defines CFG.FRAME.HORIZON_Y; if the render builder has
  // not landed it yet this falls back to the spec value, 180.
  function horizonY() {
    if (CFG && CFG.FRAME && typeof CFG.FRAME.HORIZON_Y === 'number') {
      return CFG.FRAME.HORIZON_Y;
    }
    return 180;
  }

  // The one layout grid. All coordinates are design pixels for
  // 1280x720, scaled to the real canvas. Every draw function below
  // takes its rectangle from here and draws inside it.
  function layout(canvas) {
    var W = canvas.width, H = canvas.height;
    var sx = W / 1280, sy = H / 720;
    var s = Math.min(sx, sy);
    function R(x, y, w, h) {
      return { x: x * sx, y: y * sy, w: w * sx, h: h * sy };
    }
    return {
      W: W, H: H, s: s, sx: sx, sy: sy,
      horizon: horizonY() * sy,
      mission: R(14, 14, 470, 76),
      money: R(1036, 14, 230, 64),
      vitals: R(14, 100, 252, 92),
      dispatch: R(14, 202, 252, 0),
      crew: R(1096, 90, 170, 120),
      clock: R(14, 479, 340, 44),
      dialogue: R(320, 588, 640, 64),
      weapons: R(280, 660, 534, 46),
      speedo: R(1036, 650, 230, 56)
    };
  }

  function font(L, px, bold) {
    return (bold ? 'bold ' : '') + Math.max(8, Math.round(px * L.s)) + 'px system-ui, sans-serif';
  }

  function panel(ctx, x, y, w, h, alpha) {
    ctx.fillStyle = 'rgba(8,12,18,' + (alpha || 0.55) + ')';
    ctx.fillRect(x, y, w, h);
  }

  function bar(ctx, x, y, w, h, frac, fill) {
    ctx.fillStyle = '#2a2a30';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, w * clamp(frac, 0, 1), h);
  }

  // Shorten a string with an ellipsis until it fits maxW.
  function fitText(ctx, text, maxW) {
    var t = String(text || '');
    if (ctx.measureText(t).width <= maxW) return t;
    while (t.length > 1 && ctx.measureText(t + '…').width > maxW) {
      t = t.slice(0, -1);
    }
    return t + '…';
  }

  // Beach geometry for the minimap strips: Builder 2's world export
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

  // Mission title + current objective + NEXT line, from the missions
  // system when it is loaded, else from the staged fields the shot
  // stager writes onto state.missions (title / next).
  function missionInfo(state) {
    var m = state.missions || {};
    var info = {
      title: m.title || null, objective: null, next: m.next || null,
      stage: m.stage || 0, total: m.stages || 0
    };
    if (window.PalmaMissions) {
      try {
        var cur = window.PalmaMissions.currentMission(state);
        if (cur) {
          info.title = cur.name;
          info.total = cur.stages.length;
          var st = window.PalmaMissions.currentStage(state);
          if (st) info.objective = st.objective;
          if (window.PalmaMissions.nextObjective) {
            info.next = window.PalmaMissions.nextObjective(state);
          }
        }
      } catch (e) { /* staged fields stand */ }
    }
    if (!info.title && m.current) info.title = 'MISSION ' + String(m.current).toUpperCase();
    return info;
  }

  // Top left: what Rey is supposed to be doing right now, the current
  // objective, and the NEXT line under it so the player always knows
  // what happens after this stage.
  function drawMission(ctx, state, canvas, L) {
    var z = L.mission;
    panel(ctx, z.x, z.y, z.w, z.h, 0.55);
    var info = missionInfo(state);
    ctx.textAlign = 'left';
    if (info.title) {
      ctx.fillStyle = '#ffd166';
      ctx.font = font(L, 16, true);
      ctx.fillText(fitText(ctx, info.title.toUpperCase(), z.w - 20), z.x + 10, z.y + 8);
      ctx.fillStyle = '#e8e8e8';
      ctx.font = font(L, 12, false);
      var obj = info.objective || 'Follow the dashed route to the marker.';
      ctx.fillText(fitText(ctx, obj, z.w - 20), z.x + 10, z.y + 28);
      if (info.next) {
        ctx.fillStyle = '#ffd166';
        ctx.font = font(L, 12, true);
        ctx.fillText(fitText(ctx, 'NEXT: ' + info.next, z.w - 100), z.x + 10, z.y + 46);
      }
      var total = Math.max(1, info.total || 1);
      var done = clamp(info.stage || 0, 0, total);
      ctx.fillStyle = '#2a2a30';
      ctx.fillRect(z.x + 10, z.y + z.h - 12, z.w - 20, 6);
      ctx.fillStyle = '#4caf50';
      ctx.fillRect(z.x + 10, z.y + z.h - 12, (z.w - 20) * (done / total), 6);
      ctx.fillStyle = '#8a8a92';
      ctx.font = font(L, 10, false);
      ctx.textAlign = 'right';
      ctx.fillText('STAGE ' + (done + 1) + '/' + total, z.x + z.w - 10, z.y + 46);
      ctx.textAlign = 'left';
    } else {
      ctx.fillStyle = '#ffd166';
      ctx.font = font(L, 16, true);
      ctx.fillText('FREE ROAM — PALMA VERDE', z.x + 10, z.y + 8);
      ctx.fillStyle = '#e8e8e8';
      ctx.font = font(L, 12, false);
      ctx.fillText('Nadia Venn is waiting on her $2,000 — find work around town.', z.x + 10, z.y + 30);
      ctx.fillStyle = '#ffd166';
      ctx.font = font(L, 12, true);
      ctx.fillText('NEXT: PICK UP A JOB — MISSION 1, THE DEBT', z.x + 10, z.y + 48);
    }
  }

  // Left rail, under the mission header: who Rey is, how hurt he is,
  // and where he stands on the rank ladder.
  function drawVitals(ctx, state, canvas, L) {
    var z = L.vitals;
    var p = state.player;
    panel(ctx, z.x, z.y, z.w, z.h, 0.55);
    ctx.fillStyle = '#e8e8e8';
    ctx.font = font(L, 15, true);
    ctx.textAlign = 'left';
    ctx.fillText('REY CALDER', z.x + 8, z.y + 6);
    ctx.font = font(L, 11, false);
    ctx.fillText('HEALTH', z.x + 8, z.y + 28);
    bar(ctx, z.x + 62, z.y + 26, 120 * L.sx, 10 * L.sy, p.health / 100, p.health > 30 ? '#4caf50' : '#e84a3a');
    ctx.fillText(Math.round(p.health), z.x + 188, z.y + 28);
    ctx.fillText('ARMOUR', z.x + 8, z.y + 46);
    bar(ctx, z.x + 62, z.y + 44, 120 * L.sx, 10 * L.sy, p.armour / 100, '#7ec3e8');
    ctx.fillText(Math.round(p.armour), z.x + 188, z.y + 46);
    var rank = CFG.RANKS[clamp(state.rank, 0, CFG.RANKS.length - 1)];
    var next = CFG.RANKS[Math.min(state.rank + 1, CFG.RANKS.length - 1)];
    var span = Math.max(1, next.rp - rank.rp);
    var rpFrac = state.rank >= CFG.RANKS.length - 1 ? 1 : clamp((state.rp - rank.rp) / span, 0, 1);
    ctx.fillStyle = '#ffd166';
    ctx.fillText('RANK ' + (state.rank + 1) + ' · ' + rank.name.toUpperCase() + '  ·  ' + state.completion + '% DONE', z.x + 8, z.y + 64);
    ctx.fillStyle = '#8a8a92';
    ctx.fillText('RP ' + state.rp + ' / ' + next.rp, z.x + 8, z.y + 80);
    bar(ctx, z.x + 82, z.y + 78, 100 * L.sx, 6 * L.sy, rpFrac, '#ffd166');
  }

  // Top right: the money, big, and the wanted stars under it.
  function drawMoney(ctx, state, canvas, L) {
    var z = L.money;
    panel(ctx, z.x, z.y, z.w, z.h, 0.55);
    ctx.fillStyle = '#ffd166';
    ctx.font = font(L, 22, true);
    ctx.textAlign = 'right';
    ctx.fillText(moneyStr(state.player.money), z.x + z.w - 10, z.y + 6);
    ctx.font = font(L, 20, false);
    var stars = '';
    for (var s = 0; s < 5; s++) stars += s < state.wanted ? '★' : '☆';
    ctx.fillStyle = state.wanted >= 4 ? '#ff5a4a' : '#ffd166';
    ctx.fillText(stars, z.x + z.w - 10, z.y + 34);
    ctx.textAlign = 'left';
  }

  // Left rail, under the vitals: the PVPD dispatch board. Only shows
  // while the heat is on; the rows come from the police system.
  // Capped at 5 rows so the board never runs into the clock line.
  function drawDispatch(ctx, state, canvas, L) {
    if (state.wanted <= 0 || !window.PalmaPolice) return;
    var rows = window.PalmaPolice.dispatchRows(state);
    if (!rows.length) return;
    var z = L.dispatch;
    var shown = rows.slice(0, 5);
    var rowH = 24 * L.sy;
    var h = (28 + shown.length * 24) * L.sy + 6 * L.sy;
    panel(ctx, z.x, z.y, z.w, h, 0.62);
    ctx.fillStyle = '#ff5a4a';
    ctx.font = font(L, 13, true);
    ctx.textAlign = 'left';
    ctx.fillText('PVPD DISPATCH', z.x + 10, z.y + 8);
    ctx.fillStyle = '#8a8a92';
    ctx.font = font(L, 11, false);
    ctx.textAlign = 'right';
    ctx.fillText(rows.length + (rows.length === 1 ? ' UNIT' : ' UNITS'), z.x + z.w - 10, z.y + 8);
    ctx.textAlign = 'left';
    for (var i = 0; i < shown.length; i++) {
      var r = shown[i];
      var ry = z.y + 28 * L.sy + i * rowH;
      var chip = KIND_CHIPS[r.kind] || KIND_CHIPS.cruiser;
      ctx.fillStyle = chip.fill;
      ctx.fillRect(z.x + 8, ry - 3, 22 * L.sx, 14 * L.sy);
      ctx.fillStyle = r.kind === 'heli' ? '#222' : '#fff';
      ctx.font = font(L, 8, true);
      ctx.textAlign = 'center';
      ctx.fillText(chip.tag, z.x + 19 * L.sx, ry - 1);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#fff';
      ctx.font = font(L, 12, true);
      ctx.fillText(fitText(ctx, r.callsign, 58 * L.sx), z.x + 34 * L.sx, ry);
      var pill = r.tactic;
      ctx.font = font(L, 10, true);
      var pw = 8 + ctx.measureText(pill).width;
      ctx.fillStyle = TACTIC_COLORS[pill] || '#8a8a92';
      ctx.beginPath();
      ctx.roundRect(z.x + 96 * L.sx, ry - 2, pw, 16 * L.sy, 8);
      ctx.fill();
      ctx.fillStyle = pill === 'SPOTLIGHT' ? '#222' : '#fff';
      ctx.fillText(pill, z.x + 100 * L.sx, ry + 1);
      ctx.fillStyle = '#ffd166';
      ctx.font = font(L, 12, false);
      ctx.textAlign = 'right';
      ctx.fillText(r.distM + 'm', z.x + z.w - 10, ry);
      ctx.textAlign = 'left';
    }
    if (rows.length > shown.length) {
      ctx.fillStyle = '#8a8a92';
      ctx.font = font(L, 11, false);
      ctx.fillText('+' + (rows.length - shown.length) + ' MORE', z.x + 10, z.y + 28 * L.sy + shown.length * rowH);
    }
  }

  // Right rail: the crew. Three named specialists, each with an
  // ability and a live cooldown — or READY in green. Cooldown display
  // data comes from PalmaCrew.cooldownDisplay when it is loaded.
  function drawCrew(ctx, state, canvas, L) {
    var z = L.crew;
    var rows = null;
    if (window.PalmaCrew && window.PalmaCrew.cooldownDisplay) {
      try { rows = window.PalmaCrew.cooldownDisplay(state, Date.now()); } catch (e) { rows = null; }
    }
    var defs = [
      { key: 'tuck', name: 'TUCK', job: 'Swap Plates' },
      { key: 'ines', name: 'INES', job: 'Quick Fix' },
      { key: 'kip', name: 'KIP', job: 'Eyes Out' }
    ];
    var cardH = 36 * L.sy, gap = 6 * L.sy;
    for (var i = 0; i < defs.length; i++) {
      var d = defs[i];
      var cy = z.y + i * (cardH + gap);
      panel(ctx, z.x, cy, z.w, cardH, 0.55);
      ctx.fillStyle = '#ffd166';
      ctx.font = font(L, 12, true);
      ctx.textAlign = 'left';
      ctx.fillText(d.name + ' — ' + d.job.toUpperCase(), z.x + 8, cy + 5);
      var disp = rows ? rows[i] : null;
      var cd = disp ? disp.cooldownLeft : ((state.crew || {})[d.key] ? state.crew[d.key].cooldown : 0);
      var frac = disp ? disp.fraction : 0;
      ctx.font = font(L, 11, false);
      if (cd > 0) {
        ctx.fillStyle = '#ff8a5e';
        ctx.fillText('COOLDOWN ' + Math.ceil(cd) + 's', z.x + 8, cy + 20);
        bar(ctx, z.x + 8, cy + cardH - 5, z.w - 16, 3 * L.sy, clamp(frac, 0, 1), '#ff8a5e');
      } else {
        ctx.fillStyle = '#4caf50';
        ctx.fillText('READY  [' + CREW_KEYS[d.key] + ']', z.x + 8, cy + 20);
      }
    }
  }

  // Bottom centre-left: weapon slots. Five real weapons from the
  // config plus one locked slot that shows what is still to earn.
  // Sits clear of the minimap (ends x248) and the speedo (starts
  // x1036); the aiming state swaps the equipped slot's key line.
  function drawWeapons(ctx, state, canvas, L) {
    var z = L.weapons;
    var p = state.player;
    var aiming = (p && p.aiming) || false;
    var slots = [];
    for (var i = 0; i < Math.min(5, CFG.WEAPONS.length); i++) slots.push(CFG.WEAPONS[i]);
    slots.push({ id: 'rifle', name: 'PV-7 Rifle', damage: 0, mag: 0, reserve: 0, price: 0, locked: true });
    var sw = 84 * L.sx, gap = 6 * L.sx;
    var sh = z.h;
    for (var k = 0; k < slots.length; k++) {
      var s = slots[k];
      var sx = z.x + k * (sw + gap);
      var current = p.weapon === s.id;
      panel(ctx, sx, z.y, sw, sh, current ? 0.78 : 0.5);
      ctx.strokeStyle = current ? '#ffd166' : 'rgba(255,255,255,0.25)';
      ctx.lineWidth = current ? 2 : 1;
      ctx.strokeRect(sx + 1, z.y + 1, sw - 2, sh - 2);
      ctx.fillStyle = s.locked ? '#6a6a72' : '#e8e8e8';
      ctx.font = font(L, 10, true);
      ctx.textAlign = 'left';
      ctx.fillText(fitText(ctx, s.locked ? 'LOCKED' : s.name.toUpperCase(), sw - 12), sx + 6, z.y + 5);
      ctx.font = font(L, 14, true);
      if (s.locked) {
        ctx.fillStyle = '#6a6a72';
        ctx.fillText('—', sx + 6, z.y + 20);
      } else if (s.mag === 0) {
        ctx.fillStyle = '#e8e8e8';
        ctx.fillText('—', sx + 6, z.y + 20);
      } else {
        var mag = (p.ammo && p.ammo[s.id] !== undefined) ? p.ammo[s.id] : s.mag;
        var reserve = (p.ammo && p.ammo[s.id + '_reserve'] !== undefined) ? p.ammo[s.id + '_reserve'] : s.reserve;
        ctx.fillStyle = mag === 0 ? '#e84a3a' : '#ffd166';
        ctx.fillText(mag + ' / ' + reserve, sx + 6, z.y + 20);
      }
      ctx.fillStyle = '#8a8a92';
      ctx.font = font(L, 10, false);
      if (current && aiming) {
        ctx.fillStyle = '#ffd166';
        ctx.fillText('◉ AIMING', sx + 6, z.y + 36);
      } else {
        ctx.fillText(current ? 'EQUIPPED' : ('[' + (k + 1) + ']'), sx + 6, z.y + 36);
      }
    }
  }

  // Bottom centre, above the weapon bar: a line of dialogue with the
  // speaker's portrait. The missions system sets state.dialogue.
  // Wrapped to at most 2 lines so it never reaches the speedo.
  function drawDialogue(ctx, state, canvas, L) {
    var dlg = state.dialogue;
    if (!dlg || !dlg.text) return;
    var z = L.dialogue;
    panel(ctx, z.x, z.y, z.w, z.h, 0.72);
    ctx.fillStyle = dlg.color || '#c94f3d';
    ctx.beginPath();
    ctx.arc(z.x + 34 * L.sx, z.y + z.h / 2, 22 * L.s, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = font(L, 16, true);
    ctx.textAlign = 'center';
    ctx.fillText((dlg.name || '???').charAt(0), z.x + 34 * L.sx, z.y + z.h / 2 - 10 * L.sy);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffd166';
    ctx.font = font(L, 13, true);
    ctx.fillText((dlg.name || '???').toUpperCase(), z.x + 66 * L.sx, z.y + 8);
    ctx.fillStyle = '#e8e8e8';
    ctx.font = font(L, 14, false);
    var words = String(dlg.text).split(' ');
    var lines = [''];
    for (var i = 0; i < words.length; i++) {
      var test = lines[lines.length - 1] + words[i] + ' ';
      if (test.length > 62 && lines[lines.length - 1].length > 0) lines.push(words[i] + ' ');
      else lines[lines.length - 1] = test;
      if (lines.length > 2) break;
    }
    for (var l = 0; l < lines.length; l++) {
      ctx.fillText(lines[l], z.x + 66 * L.sx, z.y + 28 + l * 18 * L.sy);
    }
  }

  // Bottom right: speed, vehicle name, and condition as a damage
  // read ("62% DENTED"). A heli has no car model, so the name line
  // and the detail line switch on kind: the Gull shows her name and
  // her altitude.
  function drawSpeedo(ctx, state, canvas, L) {
    var p = state.player;
    if (!p.vehicle) return;
    var z = L.speedo;
    panel(ctx, z.x, z.y, z.w, z.h, 0.55);
    var speed = Math.round(Math.abs(p.vehicle.speed) * 2.2);
    ctx.fillStyle = '#fff';
    ctx.font = font(L, 22, true);
    ctx.textAlign = 'left';
    ctx.fillText(speed + ' km/h', z.x + 10, z.y + 5);
    var flying = p.vehicle.kind === 'heli';
    var shown = flying ? 'THE GULL' : (p.vehicle.model ? p.vehicle.model.name.toUpperCase() : 'COMETA GT');
    var cond = 100;
    if (window.PalmaVehicles && window.PalmaVehicles.condition) {
      cond = window.PalmaVehicles.condition(p.vehicle);
    } else if (typeof p.vehicle.condition === 'number') {
      cond = p.vehicle.condition;
    } else if (typeof p.vehicle.damage === 'number') {
      cond = Math.max(0, 100 - p.vehicle.damage);
    }
    cond = Math.round(cond);
    var detail = flying
      ? 'ALT ' + (window.PalmaVehicles && window.PalmaVehicles.gullAltitude ? window.PalmaVehicles.gullAltitude(p.vehicle) : 0) + ' m  ·  ' + cond + '% ' + conditionLabel(cond)
      : cond + '% ' + conditionLabel(cond);
    ctx.fillStyle = '#ffd166';
    ctx.font = font(L, 12, true);
    ctx.fillText(fitText(ctx, shown + '  ·  ' + detail, z.w - 20), z.x + 10, z.y + 34);
  }

  // Bottom left, ABOVE the minimap: clock, district, and the radio
  // line. This panel never sits under the weapon bar.
  function drawClockRadio(ctx, state, canvas, L) {
    var z = L.clock;
    panel(ctx, z.x, z.y, z.w, z.h, 0.55);
    ctx.fillStyle = '#fff';
    ctx.font = font(L, 15, true);
    ctx.textAlign = 'left';
    var dName = state.district ? state.district.name.toUpperCase() : 'PALMA VERDE';
    ctx.fillText(clockStr(state.clockMinutes) + '  ·  ' + dName, z.x + 8, z.y + 6);
    ctx.fillStyle = '#ffd166';
    ctx.font = font(L, 12, false);
    var station = CFG.RADIO[state.radioStation % CFG.RADIO.length];
    var track = station.tracks[Math.floor(state.clockMinutes / 3) % station.tracks.length];
    ctx.fillText(fitText(ctx, station.name + ' — ' + track, z.w - 16), z.x + 8, z.y + 25);
  }

  // The minimap: bottom-left, real street geometry, district names, a
  // dashed route to the mission marker, a compass, live police dots,
  // and a standing chip on its own frame: district + standing label.
  function drawMinimap(ctx, state, city, canvas, L) {
    var mw = 230 * L.sx;
    var mh = mw * city.height / city.width;
    var mx = 14 * L.sx;
    var my = canvas.height - mh - 14 * L.sy;
    function sx(wx) { return mx + (wx / city.width) * mw; }
    function sy(wy) { return my + (wy / city.height) * mh; }
    var bch = beach();
    ctx.fillStyle = 'rgba(8,18,14,0.80)';
    ctx.fillRect(mx - 4, my - 4, mw + 8, mh + 8);
    // Ocean, then the wide sand band, along the west edge.
    ctx.fillStyle = '#1f6f8f';
    ctx.fillRect(mx, my, sx(bch.oceanX1) - mx, mh);
    ctx.fillStyle = '#c9b078';
    ctx.fillRect(sx(bch.oceanX1), my, sx(bch.sandX1) - sx(bch.oceanX1), mh);
    // Districts: a tinted block and a name each.
    for (var d = 0; d < city.districts.length; d++) {
      var dist = city.districts[d];
      ctx.fillStyle = dist.accent + '22';
      ctx.fillRect(sx(dist.x0), sy(dist.y0), sx(dist.x1) - sx(dist.x0), sy(dist.y1) - sy(dist.y0));
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.font = font(L, 8, true);
      ctx.textAlign = 'center';
      ctx.fillText(dist.short, (sx(dist.x0) + sx(dist.x1)) / 2, (sy(dist.y0) + sy(dist.y1)) / 2);
      ctx.textAlign = 'left';
    }
    // Streets: every avenue and street, drawn where it really is.
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1.2;
    for (var a = 0; a < city.avenues.length; a++) {
      ctx.beginPath();
      ctx.moveTo(sx(city.avenues[a]), my);
      ctx.lineTo(sx(city.avenues[a]), my + mh);
      ctx.stroke();
    }
    for (var s = 0; s < city.streets.length; s++) {
      ctx.beginPath();
      ctx.moveTo(mx, sy(city.streets[s]));
      ctx.lineTo(mx + mw, sy(city.streets[s]));
      ctx.stroke();
    }
    // Landmarks: the wheel, the pier, the tower.
    for (var l = 0; l < city.landmarks.length; l++) {
      var lm = city.landmarks[l];
      var lx = sx(lm.x), ly = sy(lm.y);
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
        ctx.lineTo(sx(lm.x - lm.length), ly);
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
    if (target) {
      var p = state.player;
      ctx.strokeStyle = '#ffd166';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      ctx.moveTo(sx(p.x), sy(p.y));
      ctx.lineTo(sx(target.x), sy(p.y));
      ctx.lineTo(sx(target.x), sy(target.y));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#ffd166';
      ctx.save();
      ctx.translate(sx(target.x), sy(target.y));
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-5, -5, 10, 10);
      ctx.restore();
    }
    // Police dots: red-blue flashers on the cruisers, white ring on AIR-1.
    if (state.police) {
      var flash = Math.floor(state.time * 2) % 2 === 0;
      for (var u = 0; u < state.police.units.length; u++) {
        var car = state.police.units[u].car;
        ctx.fillStyle = flash ? '#ff3b30' : '#2e6bff';
        ctx.beginPath();
        ctx.arc(sx(car.x), sy(car.y), 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
      if (state.police.heli) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(sx(state.police.heli.x), sy(state.police.heli.y), 5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(sx(state.police.heli.x), sy(state.police.heli.y), 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Player arrow, pointing where Rey is heading.
    var px = sx(state.player.x), py = sy(state.player.y);
    var ang = state.player.vehicle ? state.player.vehicle.angle : state.player.angle;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(ang);
    ctx.fillStyle = '#ffd166';
    ctx.beginPath();
    ctx.moveTo(8, 0);
    ctx.lineTo(-6, -5);
    ctx.lineTo(-6, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // District standing chip, pinned to the top-left inside the frame
    // (over the ocean strip, never over the clock line above it).
    var dName = state.district ? state.district.name : 'PALMA VERDE';
    var dVal = state.standing && typeof state.standing[dName] === 'number' ? state.standing[dName] : null;
    var chipText = dName.toUpperCase() + (dVal === null ? '' : ' · ' + standingLabel(dVal) + ' ' + dVal);
    ctx.font = font(L, 10, true);
    var chipW = ctx.measureText(chipText).width + 12;
    ctx.fillStyle = 'rgba(8,12,18,0.85)';
    ctx.fillRect(mx + 4, my + 4, chipW, 18 * L.sy);
    ctx.fillStyle = '#ffd166';
    ctx.textAlign = 'left';
    ctx.fillText(chipText, mx + 10, my + 7);
    // Compass, inside the top-right corner so it never touches the
    // clock panel above the frame.
    ctx.fillStyle = '#fff';
    ctx.font = font(L, 11, true);
    ctx.textAlign = 'right';
    ctx.fillText('N', mx + mw - 6, my + 7);
    ctx.textAlign = 'left';
    ctx.strokeStyle = 'rgba(255,209,102,0.8)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(mx - 4, my - 4, mw + 8, mh + 8);
  }

  // Tab-hold weapon wheel (state.weaponWheel, set by player.js).
  // A dimmed overlay with the eight config weapons on a radial
  // wheel, ammo under each name, the equipped slot in gold. The
  // bottom weapon bar stays the fallback when the wheel is closed.
  function drawWeaponWheel(ctx, state, canvas, L) {
    if (!state.weaponWheel) return;
    var W = canvas.width, H = canvas.height;
    var cx = W / 2, cy = H / 2 - 10 * L.sy;
    var R = 150 * L.s;
    ctx.fillStyle = 'rgba(8,12,18,0.55)';
    ctx.fillRect(0, 0, W, H);
    var slots = CFG.WEAPONS;
    var n = slots.length;
    var p = state.player;
    for (var i = 0; i < n; i++) {
      var s = slots[i];
      var a0 = -Math.PI / 2 + (i / n) * Math.PI * 2;
      var a1 = -Math.PI / 2 + ((i + 1) / n) * Math.PI * 2;
      var current = p.weapon === s.id;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, R, a0, a1);
      ctx.closePath();
      ctx.fillStyle = current ? 'rgba(255,209,102,0.85)' : 'rgba(8,12,18,0.72)';
      ctx.fill();
      ctx.strokeStyle = current ? '#ffd166' : 'rgba(255,255,255,0.25)';
      ctx.lineWidth = current ? 2 : 1;
      ctx.stroke();
      var mid = (a0 + a1) / 2;
      var lx = cx + Math.cos(mid) * R * 0.68;
      var ly = cy + Math.sin(mid) * R * 0.68;
      ctx.fillStyle = current ? '#222' : '#e8e8e8';
      ctx.font = font(L, 11, true);
      ctx.textAlign = 'center';
      ctx.fillText(fitText(ctx, s.name.toUpperCase(), 104 * L.sx), lx, ly - 6 * L.sy);
      ctx.font = font(L, 11, false);
      ctx.fillStyle = current ? '#222' : '#ffd166';
      var ammoTxt = '—';
      if (s.mag > 0) {
        var mag = (p.ammo && p.ammo[s.id] !== undefined) ? p.ammo[s.id] : s.mag;
        var reserve = (p.ammo && p.ammo[s.id + '_reserve'] !== undefined) ? p.ammo[s.id + '_reserve'] : s.reserve;
        ammoTxt = mag + ' / ' + reserve;
      }
      ctx.fillText(ammoTxt, lx, ly + 10 * L.sy);
      ctx.fillStyle = '#8a8a92';
      ctx.font = font(L, 9, false);
      ctx.fillText('[' + (i + 1) + ']', lx, ly + 24 * L.sy);
    }
    ctx.fillStyle = 'rgba(8,12,18,0.85)';
    ctx.beginPath();
    ctx.arc(cx, cy, 52 * L.s, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffd166';
    ctx.lineWidth = 2;
    ctx.stroke();
    var cur = null;
    for (var k = 0; k < slots.length; k++) {
      if (slots[k].id === p.weapon) cur = slots[k];
    }
    ctx.fillStyle = '#ffd166';
    ctx.font = font(L, 11, true);
    ctx.textAlign = 'center';
    ctx.fillText('WEAPON WHEEL', cx, cy - 8 * L.sy);
    ctx.fillStyle = '#fff';
    ctx.font = font(L, 12, true);
    ctx.fillText(cur ? fitText(ctx, cur.name.toUpperCase(), 96 * L.sx) : 'FISTS', cx, cy + 10 * L.sy);
    ctx.fillStyle = '#8a8a92';
    ctx.font = font(L, 11, false);
    ctx.textAlign = 'left';
    ctx.fillText('HOLD TAB — TAP 1–8 TO SELECT', cx - 92 * L.sx, cy + R + 26 * L.sy);
  }

  function draw(state, city, canvas, mode, renderer) {
    var ctx = canvas.getContext('2d');
    if (window.PalmaPolice && window.PalmaPolice.drawOverlay) {
      window.PalmaPolice.drawOverlay(state, city, canvas, renderer, mode);
    }
    var L = layout(canvas);
    ctx.save();
    ctx.textBaseline = 'top';
    drawVitals(ctx, state, canvas, L);
    drawMoney(ctx, state, canvas, L);
    drawMission(ctx, state, canvas, L);
    drawDispatch(ctx, state, canvas, L);
    drawCrew(ctx, state, canvas, L);
    drawWeapons(ctx, state, canvas, L);
    drawDialogue(ctx, state, canvas, L);
    drawSpeedo(ctx, state, canvas, L);
    drawClockRadio(ctx, state, canvas, L);
    drawMinimap(ctx, state, city, canvas, L);
    drawWeaponWheel(ctx, state, canvas, L);
    ctx.restore();
  }

  window.PalmaHud = {
    draw: draw,
    drawMinimap: drawMinimap,
    clockStr: clockStr,
    moneyStr: moneyStr,
    layoutGrid: layout,
    horizonY: horizonY
  };
})();
