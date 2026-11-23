// Palma Verde — HUD: every number and panel the player reads while
// playing, drawn straight onto the game canvas after the world render.
// Health and armour, money and stars, weapons, speed, radio, the
// mission header, the crew, the PVPD dispatch board, the dialogue bar
// — and the minimap, which traces the real streets and districts of
// the city instead of a blank grid.

(function () {
  'use strict';

  var CFG = window.PalmaConfig;

  var TACTIC_COLORS = {
    RAMMING: '#e84a3a', PIT: '#e87b2b', ROADBLOCK: '#e8c53a',
    FLANKING: '#4a90e8', SPOTLIGHT: '#e8e8e8', PURSUIT: '#4caf50',
    SEARCHING: '#8a8a92'
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

  // Top left: who Rey is, how hurt he is, and where he stands.
  function drawVitals(ctx, state, canvas) {
    var p = state.player;
    panel(ctx, 14, 14, 252, 92, 0.55);
    ctx.fillStyle = '#e8e8e8';
    ctx.font = 'bold 15px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('REY CALDER', 22, 20);
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillStyle = '#ffd166';
    var rank = CFG.RANKS[clamp(state.rank, 0, CFG.RANKS.length - 1)];
    ctx.fillText('RANK ' + (state.rank + 1) + ' · ' + rank.name.toUpperCase() + '  ·  ' + state.completion + '% DONE', 22, 88);
    ctx.fillStyle = '#e8e8e8';
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillText('HEALTH', 22, 40);
    bar(ctx, 76, 38, 120, 10, p.health / 100, p.health > 30 ? '#4caf50' : '#e84a3a');
    ctx.fillStyle = '#e8e8e8';
    ctx.fillText(Math.round(p.health), 202, 40);
    ctx.fillText('ARMOUR', 22, 58);
    bar(ctx, 76, 56, 120, 10, p.armour / 100, '#7ec3e8');
    ctx.fillText(Math.round(p.armour), 202, 58);
    var next = CFG.RANKS[Math.min(state.rank + 1, CFG.RANKS.length - 1)];
    var span = Math.max(1, next.rp - rank.rp);
    var rpFrac = state.rank >= CFG.RANKS.length - 1 ? 1 : clamp((state.rp - rank.rp) / span, 0, 1);
    ctx.fillStyle = '#8a8a92';
    ctx.fillText('RP ' + state.rp + ' / ' + next.rp, 22, 74);
    bar(ctx, 96, 72, 100, 6, rpFrac, '#ffd166');
  }

  // Top right: the money, big, and the wanted stars under it.
  function drawMoney(ctx, state, canvas) {
    var w = 230;
    var x = canvas.width - w - 14;
    panel(ctx, x, 14, w, 64, 0.55);
    ctx.fillStyle = '#ffd166';
    ctx.font = 'bold 22px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(moneyStr(state.player.money), x + w - 10, 20);
    ctx.font = '20px system-ui, sans-serif';
    var stars = '';
    for (var s = 0; s < 5; s++) stars += s < state.wanted ? '★' : '☆';
    ctx.fillStyle = state.wanted >= 4 ? '#ff5a4a' : '#ffd166';
    ctx.fillText(stars, x + w - 10, 48);
    ctx.textAlign = 'left';
  }

  // Top centre: what Rey is supposed to be doing right now.
  function drawMission(ctx, state, canvas) {
    var w = 520;
    var x = (canvas.width - w) / 2;
    panel(ctx, x, 14, w, 66, 0.55);
    var m = state.missions || {};
    ctx.textAlign = 'center';
    if (m.current) {
      var title = m.title || m.name || ('MISSION ' + m.current);
      ctx.fillStyle = '#ffd166';
      ctx.font = 'bold 16px system-ui, sans-serif';
      ctx.fillText(title.toUpperCase(), canvas.width / 2, 22);
      var total = m.stages || 4;
      var done = clamp(m.stage || 0, 0, total);
      ctx.fillStyle = '#2a2a30';
      ctx.fillRect(x + 40, 44, w - 80, 7);
      ctx.fillStyle = '#4caf50';
      ctx.fillRect(x + 40, 44, (w - 80) * (done / total), 7);
      ctx.fillStyle = '#e8e8e8';
      ctx.font = '12px system-ui, sans-serif';
      ctx.fillText('STAGE ' + (done + 1) + '/' + total + (m.next ? '  ·  NEXT: ' + m.next : ''), canvas.width / 2, 58);
    } else {
      ctx.fillStyle = '#ffd166';
      ctx.font = 'bold 16px system-ui, sans-serif';
      ctx.fillText('FREE ROAM — PALMA VERDE', canvas.width / 2, 22);
      ctx.fillStyle = '#e8e8e8';
      ctx.font = '12px system-ui, sans-serif';
      ctx.fillText('Nadia Venn is waiting on her $2,000 — find work around town.', canvas.width / 2, 48);
    }
    ctx.textAlign = 'left';
  }

  // Right edge: the PVPD dispatch board. Only shows while the heat
  // is on; the rows come from the police system, not from this file.
  function drawDispatch(ctx, state, canvas) {
    if (state.wanted <= 0 || !window.PalmaPolice) return;
    var rows = window.PalmaPolice.dispatchRows(state);
    if (!rows.length) return;
    var w = 248;
    var x = canvas.width - w - 14;
    var y = 92;
    var h = 30 + rows.length * 28;
    panel(ctx, x, y, w, h, 0.62);
    ctx.fillStyle = '#ff5a4a';
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.fillText('PVPD DISPATCH', x + 10, y + 8);
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var ry = y + 30 + i * 28;
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 13px system-ui, sans-serif';
      ctx.fillText(r.callsign, x + 10, ry);
      var pill = r.tactic;
      var pw = 8 + pill.length * 7;
      ctx.fillStyle = TACTIC_COLORS[pill] || '#8a8a92';
      ctx.beginPath();
      ctx.roundRect(x + 92, ry - 2, pw, 16, 8);
      ctx.fill();
      ctx.fillStyle = pill === 'SPOTLIGHT' ? '#222' : '#fff';
      ctx.font = 'bold 10px system-ui, sans-serif';
      ctx.fillText(pill, x + 96, ry + 1);
      ctx.fillStyle = '#ffd166';
      ctx.font = '12px system-ui, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(r.distM + 'm', x + w - 10, ry);
      ctx.textAlign = 'left';
    }
  }

  // Left edge: the crew. Three named specialists, each with an
  // ability and a live cooldown — or READY in green.
  function drawCrew(ctx, state, canvas) {
    var crew = state.crew || {};
    var defs = [
      { key: 'tuck', name: 'TUCK', job: 'Swap Plates', num: 'Z' },
      { key: 'ines', name: 'INES', job: 'Quick Fix', num: 'X' },
      { key: 'kip', name: 'KIP', job: 'Eyes Out', num: 'V' }
    ];
    var x = 14, y = 122;
    for (var i = 0; i < defs.length; i++) {
      var d = defs[i];
      var cd = crew[d.key] ? crew[d.key].cooldown : 0;
      var cy = y + i * 42;
      panel(ctx, x, cy, 168, 36, 0.55);
      ctx.fillStyle = '#ffd166';
      ctx.font = 'bold 13px system-ui, sans-serif';
      ctx.fillText(d.name + ' — ' + d.job.toUpperCase(), x + 8, cy + 6);
      ctx.font = '11px system-ui, sans-serif';
      if (cd > 0) {
        ctx.fillStyle = '#ff8a5e';
        ctx.fillText('COOLDOWN ' + Math.ceil(cd) + 's', x + 8, cy + 21);
      } else {
        ctx.fillStyle = '#4caf50';
        ctx.fillText('READY  [' + d.num + ']', x + 8, cy + 21);
      }
    }
  }

  // Bottom centre: five weapon slots. Four real weapons from the
  // config, one locked slot that shows what is still to earn.
  function drawWeapons(ctx, state, canvas) {
    var p = state.player;
    var slots = [];
    for (var i = 0; i < CFG.WEAPONS.length; i++) slots.push(CFG.WEAPONS[i]);
    slots.push({ id: 'rifle', name: 'PV-7 Rifle', damage: 0, mag: 0, price: 0, locked: true });
    var sw = 96, sh = 46, gap = 6;
    var total = slots.length * sw + (slots.length - 1) * gap;
    var x0 = (canvas.width - total) / 2;
    var y = canvas.height - sh - 14;
    for (var k = 0; k < slots.length; k++) {
      var s = slots[k];
      var sx = x0 + k * (sw + gap);
      var current = p.weapon === s.id;
      panel(ctx, sx, y, sw, sh, current ? 0.78 : 0.5);
      ctx.strokeStyle = current ? '#ffd166' : 'rgba(255,255,255,0.25)';
      ctx.lineWidth = current ? 2 : 1;
      ctx.strokeRect(sx + 1, y + 1, sw - 2, sh - 2);
      ctx.fillStyle = s.locked ? '#6a6a72' : '#e8e8e8';
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.fillText(s.locked ? 'LOCKED' : s.name.toUpperCase(), sx + 7, y + 7);
      ctx.font = 'bold 15px system-ui, sans-serif';
      if (s.locked) {
        ctx.fillStyle = '#6a6a72';
        ctx.fillText('—', sx + 7, y + 24);
      } else if (s.mag === 0) {
        ctx.fillStyle = '#e8e8e8';
        ctx.fillText('—', sx + 7, y + 24);
      } else {
        var mag = p.ammo[s.id] === undefined ? s.mag : p.ammo[s.id];
        ctx.fillStyle = mag === 0 ? '#e84a3a' : '#ffd166';
        ctx.fillText(mag + ' / ' + s.mag, sx + 7, y + 24);
      }
      ctx.fillStyle = '#8a8a92';
      ctx.font = '10px system-ui, sans-serif';
      ctx.fillText(current ? 'EQUIPPED' : ('[' + (k + 1) + ']'), sx + 7, y + 38);
    }
  }

  // Bottom centre, above the weapons: a line of dialogue with the
  // speaker's portrait. The missions system sets state.dialogue.
  function drawDialogue(ctx, state, canvas) {
    var dlg = state.dialogue;
    if (!dlg || !dlg.text) return;
    var w = 640;
    var x = (canvas.width - w) / 2;
    var y = canvas.height - 138;
    panel(ctx, x, y, w, 64, 0.72);
    ctx.fillStyle = dlg.color || '#c94f3d';
    ctx.beginPath();
    ctx.arc(x + 34, y + 32, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 16px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText((dlg.name || '???').charAt(0), x + 34, y + 26);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffd166';
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.fillText((dlg.name || '???').toUpperCase(), x + 66, y + 8);
    ctx.fillStyle = '#e8e8e8';
    ctx.font = '14px system-ui, sans-serif';
    var words = String(dlg.text).split(' ');
    var lines = [''];
    for (var i = 0; i < words.length; i++) {
      var test = lines[lines.length - 1] + words[i] + ' ';
      if (test.length > 62 && lines[lines.length - 1].length > 0) lines.push(words[i] + ' ');
      else lines[lines.length - 1] = test;
      if (lines.length > 2) break;
    }
    for (var l = 0; l < lines.length; l++) {
      ctx.fillText(lines[l], x + 66, y + 28 + l * 18);
    }
  }

  // Bottom right, above the minimap: speed, vehicle name, condition.
  // A heli has no car model, so the name line and the detail line
  // switch on kind: the Gull shows her name and her altitude.
  function drawSpeedo(ctx, state, canvas) {
    var p = state.player;
    if (!p.vehicle) return;
    var mw = 230;
    var mh = Math.round(mw * 3200 / 4200);
    var w = 230;
    var x = canvas.width - w - 14;
    var y = canvas.height - mh - 14 - 66;
    panel(ctx, x, y, w, 56, 0.55);
    var speed = Math.round(Math.abs(p.vehicle.speed) * 2.2);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 24px system-ui, sans-serif';
    ctx.fillText(speed + ' km/h', x + 10, y + 6);
    ctx.fillStyle = '#ffd166';
    ctx.font = 'bold 13px system-ui, sans-serif';
    var flying = p.vehicle.kind === 'heli';
    var shown = flying ? 'THE GULL' : p.vehicle.model.name.toUpperCase();
    ctx.fillText(shown, x + 10, y + 36);
    ctx.fillStyle = '#e8e8e8';
    ctx.font = '12px system-ui, sans-serif';
    var cond = window.PalmaVehicles ? window.PalmaVehicles.condition(p.vehicle) : 100;
    var detail = flying
      ? 'ALT ' + (window.PalmaVehicles ? window.PalmaVehicles.gullAltitude(p.vehicle) : 0) + ' m  ·  CONDITION ' + cond + '%'
      : 'CONDITION ' + cond + '%';
    ctx.fillText(detail, x + 130, y + 36);
  }

  // Bottom left: clock, district, and the radio line.
  function drawClockRadio(ctx, state, canvas) {
    panel(ctx, 14, canvas.height - 58, 340, 44, 0.55);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 16px system-ui, sans-serif';
    var dName = state.district ? state.district.name.toUpperCase() : 'PALMA VERDE';
    ctx.fillText(clockStr(state.clockMinutes) + '  ·  ' + dName, 22, canvas.height - 52);
    ctx.fillStyle = '#ffd166';
    ctx.font = '13px system-ui, sans-serif';
    var station = CFG.RADIO[state.radioStation % CFG.RADIO.length];
    var track = station.tracks[Math.floor(state.clockMinutes / 3) % station.tracks.length];
    ctx.fillText(station.name + ' — ' + track, 22, canvas.height - 28);
  }

  // The minimap: real street geometry, district names, a dashed route
  // to the mission marker, a compass, and live police dots.
  function drawMinimap(ctx, state, city, canvas) {
    var mw = 230;
    var mh = Math.round(mw * city.height / city.width);
    var mx = canvas.width - mw - 14;
    var my = canvas.height - mh - 14;
    function sx(wx) { return mx + (wx / city.width) * mw; }
    function sy(wy) { return my + (wy / city.height) * mh; }
    ctx.fillStyle = 'rgba(8,18,14,0.80)';
    ctx.fillRect(mx - 4, my - 4, mw + 8, mh + 8);
    // Ocean, then sand, along the west edge.
    ctx.fillStyle = '#1f6f8f';
    ctx.fillRect(mx, my, sx(CFG.CITY.oceanX) - mx, mh);
    ctx.fillStyle = '#c9b078';
    ctx.fillRect(sx(CFG.CITY.oceanX), my, sx(CFG.CITY.beachX) - sx(CFG.CITY.oceanX), mh);
    // Districts: a tinted block and a name each.
    for (var d = 0; d < city.districts.length; d++) {
      var dist = city.districts[d];
      ctx.fillStyle = dist.accent + '22';
      ctx.fillRect(sx(dist.x0), sy(dist.y0), sx(dist.x1) - sx(dist.x0), sy(dist.y1) - sy(dist.y0));
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.font = 'bold 8px system-ui, sans-serif';
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
    // Compass and frame.
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('N', mx + mw / 2, my - 8);
    ctx.textAlign = 'left';
    ctx.strokeStyle = 'rgba(255,209,102,0.8)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(mx - 4, my - 4, mw + 8, mh + 8);
  }

  function draw(state, city, canvas, mode, renderer) {
    var ctx = canvas.getContext('2d');
    if (window.PalmaPolice && window.PalmaPolice.drawOverlay) {
      window.PalmaPolice.drawOverlay(state, city, canvas, renderer, mode);
    }
    ctx.save();
    ctx.textBaseline = 'top';
    drawVitals(ctx, state, canvas);
    drawMoney(ctx, state, canvas);
    drawMission(ctx, state, canvas);
    drawDispatch(ctx, state, canvas);
    drawCrew(ctx, state, canvas);
    drawWeapons(ctx, state, canvas);
    drawDialogue(ctx, state, canvas);
    drawSpeedo(ctx, state, canvas);
    drawClockRadio(ctx, state, canvas);
    drawMinimap(ctx, state, city, canvas);
    ctx.restore();
  }

  window.PalmaHud = {
    draw: draw,
    drawMinimap: drawMinimap,
    clockStr: clockStr,
    moneyStr: moneyStr
  };
})();
