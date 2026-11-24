// weapons3d.js — Rey's weapons, aiming, firing, and the weapon wheel.
//
// Combat follows the GTA V PC canon: hold right mouse to aim (the
// weapon raises, a reticle shows, the camera pulls a little toward
// where he aims), left mouse to fire, R to reload, hold Tab for the
// weapon wheel, 1–9 or the wheel to switch. Weapons are slots —
// Fists, Pistol, SMG, Shotgun and the rest — one weapon per slot,
// ammo counted per weapon, magazine plus reserve. Fists are a real
// slot with a real melee attack, not the absence of a weapon.
// Drive-by works with pistol and compact SMG only, from a car, never
// from the Gull.
//
// The player object this system reads/writes (B4 owns it):
//   { x, z, angle, aim, health, armour, weapon, ammo: {},
//     aiming, vehicle: { kind: 'car'|'heli', ... } | null,
//     meleeT, lastFireT, firing }
// Ammo is per weapon: ammo[id] is the magazine, ammo[id + '_reserve']
// is the reserve. A weapon with mag 0 is melee and never reloads.
//
// createWeapons(player, hooks) returns a system with:
//   update(dt, input) — input: { aimX, aimZ, firing } (world point
//     under the cursor + whether the trigger is held). Auto weapons
//     keep firing while held; semi-auto weapons fire once per press
//     (call fire() on the click, or set input.pressed for one frame).
//   fire(), fireDriveBy(), meleeAttack(), reload(), switchTo(id|index),
//   cycle(dir), bindInput(canvas), unbindInput(), snapshot()
// hooks (all optional):
//   getTargets() -> [{ x, z, health?, damage?, police?, officer? }]
//     — the cars and peds a shot can hit. When absent, shots still
//     consume ammo and report 'miss'.
//   onShot(result) — every shot, hit or miss; the police system
//     listens here to raise wanted.
//   tracer(tracer) — every gunshot, with the dashed yellow line from
//     the muzzle to the hit point (or the crosshair ray target on a
//     miss); the renderer draws it from this hook (see
//     createTracerRenderer). The shot result also carries it as
//     result.tracer, and live tracers sit on sys.tracers.
//   onCrime(kind) — 'assault' for a melee hit on someone.
//   onEmpty(weaponId), onReload(weaponId)
//   flash(x, z, angle), shake(amount) — renderer effects.
//   onSwitch(weaponId)

export const WEAPONS = [
  { id: 'fists', name: 'Fists', damage: 12, mag: 0, reserve: 0, price: 0, auto: false, driveby: false, range: 2.3, interval: 0.45 },
  { id: 'pistol', name: 'P9 Pistol', damage: 26, mag: 12, reserve: 60, price: 500, auto: false, driveby: true, range: 210, interval: 0.28 },
  { id: 'smg', name: 'Vespa SMG', damage: 16, mag: 30, reserve: 120, price: 1800, auto: true, driveby: true, range: 190, interval: 0.09 },
  { id: 'shotgun', name: 'Duna 12', damage: 55, mag: 6, reserve: 24, price: 2400, auto: false, driveby: false, range: 130, interval: 0.9 },
  { id: 'carbine', name: 'PV-9 Carbine', damage: 22, mag: 24, reserve: 120, price: 2600, auto: true, driveby: false, range: 260, interval: 0.11 },
  { id: 'revolver', name: 'Palma .44', damage: 40, mag: 6, reserve: 36, price: 1500, auto: false, driveby: false, range: 230, interval: 0.5 },
  { id: 'bat', name: 'Palma Bat', damage: 18, mag: 0, reserve: 0, price: 200, auto: false, driveby: false, range: 3, interval: 0.5 },
  { id: 'sniper', name: 'Mirador Longshot', damage: 70, mag: 5, reserve: 20, price: 3200, auto: false, driveby: false, range: 350, interval: 1.2 },
];

export const SLOT_ORDER = WEAPONS.map((w) => w.id);

export function weaponDef(id) {
  return WEAPONS.find((w) => w.id === id) || WEAPONS[0];
}

export function isMelee(id) {
  return weaponDef(id).mag === 0;
}

// Bullet tracer (r11-B4): a thin yellow SEGMENTED line — short dashes
// with gaps, never a solid beam — from the muzzle to the hit point
// (or the crosshair ray target on a miss). It lives TRACER_LIFE and
// fades; the renderer draws it from the `tracer` hook (or from
// createTracerRenderer below). Pure data, no THREE here, so the
// headless self-test can check it.
export const TRACER_LIFE = 0.12; // s — one brief streak per shot
export const MUZZLE_Y = 1.3; // m — muzzle height, same as the flash
export const TARGET_Y = 1.2; // m — chest height on a ped
export const TRACER_DASH = 0.9; // m of line per dash
export const TRACER_GAP = 0.6; // m of gap between dashes
export const TRACER_MAX_DASHES = 40; // cap: a 350 m miss still draws at most ~60 m of dashes

// Dash segments along the 3D line from→to: [{ from: {x,y,z}, to: {x,y,z} }].
// Gaps are real gaps in the geometry — the line reads as a tracer,
// not a beam. Pure function, exported for the headless test.
export function buildTracerSegments(from, to) {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (!(len > 0.001)) return [];
  const ux = dx / len, uy = dy / len, uz = dz / len;
  const segs = [];
  let s = 0;
  while (s < len && segs.length < TRACER_MAX_DASHES) {
    const e = Math.min(s + TRACER_DASH, len);
    segs.push({
      from: { x: from.x + ux * s, y: from.y + uy * s, z: from.z + uz * s },
      to: { x: from.x + ux * e, y: from.y + uy * e, z: from.z + uz * e },
    });
    s = e + TRACER_GAP;
  }
  return segs;
}

export function giveAmmo(player, weaponId, amount) {
  if (!player.ammo) player.ammo = {};
  player.ammo[weaponId] = (player.ammo[weaponId] || 0) + amount;
  return player.ammo[weaponId];
}

export function createWeapons(player, hooks) {
  const h = hooks || {};
  const sys = {
    player,
    aiming: false,
    wheelOpen: false,
    firing: false,
    time: 0,
    tracers: [], // r11-B4: live bullet tracers (fade in TRACER_LIFE)
    _aimX: null, // r11-B4: last crosshair ground point (miss tracer end)
    _aimZ: null,
    _bound: null,
  };

  function ensureSlots() {
    if (!player.ammo) player.ammo = {};
    if (!player.weapon) player.weapon = 'pistol';
    if (typeof player.meleeT !== 'number') player.meleeT = 0;
    if (typeof player.lastFireT !== 'number') player.lastFireT = -99;
    if (typeof player.aiming !== 'boolean') player.aiming = false;
    return SLOT_ORDER;
  }

  // Aim, mirrored on the system and on the player so both readers
  // agree. Returns the new aiming value.
  function setAiming(on) {
    const v = !!on;
    sys.aiming = v;
    player.aiming = v;
    return v;
  }

  // Switch to a weapon by id ('pistol') or by slot index (0-based).
  // One weapon per slot; switching never touches ammo.
  function switchTo(idOrIndex) {
    ensureSlots();
    let id = idOrIndex;
    if (typeof idOrIndex === 'number') {
      if (idOrIndex < 0 || idOrIndex >= SLOT_ORDER.length) return false;
      id = SLOT_ORDER[idOrIndex];
    }
    if (SLOT_ORDER.indexOf(id) < 0) return false;
    if (player.weapon === id) return true;
    player.weapon = id;
    if (typeof h.onSwitch === 'function') h.onSwitch(id);
    return true;
  }

  // Step to the next (dir 1) or previous (dir -1) slot, wrapping.
  function cycle(dir) {
    ensureSlots();
    const cur = SLOT_ORDER.indexOf(player.weapon);
    const next = (cur < 0 ? 0 : (cur + (dir >= 0 ? 1 : SLOT_ORDER.length - 1)) % SLOT_ORDER.length);
    return switchTo(next);
  }

  function pickTarget(range, coneDot) {
    if (typeof h.getTargets !== 'function') return null;
    const targets = h.getTargets() || [];
    let best = null;
    let bestD = range;
    for (const tg of targets) {
      const dx = tg.x - player.x;
      const dz = tg.z - player.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d > range || d < 0.5) continue;
      const dot = (dx * Math.cos(player.aim) + dz * Math.sin(player.aim)) / d;
      if (dot > coneDot && d < bestD) { best = tg; bestD = d; }
    }
    return best;
  }

  function applyHit(target, damage) {
    // Damage lands on the record that actually carries it: a wrapper
    // the integrator passes (B4 passes { damage: 0, car: <body> } for
    // a cruiser) writes through to its .car / .body, a plain car or
    // ped record takes it directly, a ped takes health damage.
    const rec = target.car || target.body || target;
    if (typeof rec.damage === 'number') {
      rec.damage = Math.min(100, rec.damage + damage / 2);
    } else if (typeof target.health === 'number') {
      target.health -= damage;
    }
  }

  // Fists (and the bat): a real melee attack. Short reach, a forward
  // cone, a short swing cooldown. A melee hit on someone in public is
  // a crime the street reports.
  function meleeAttack() {
    ensureSlots();
    const def = weaponDef(player.weapon);
    if (player.meleeT > 0) return { hit: false, reason: 'cooling' };
    player.meleeT = def.interval;
    player.lastFireT = sys.time;
    if (typeof h.shake === 'function') h.shake(2);
    const target = pickTarget(def.range, 0.7);
    if (target) {
      applyHit(target, def.damage);
      if (typeof h.onCrime === 'function') h.onCrime('assault');
      const result = { hit: true, target, damage: def.damage };
      if (typeof h.onShot === 'function') h.onShot(result);
      return result;
    }
    return { hit: false, reason: 'miss' };
  }

  function fire() {
    ensureSlots();
    const def = weaponDef(player.weapon);
    if (isMelee(def.id)) return meleeAttack();
    if (sys.time - player.lastFireT < def.interval) return { hit: false, reason: 'cooling' };
    const mag = player.ammo[player.weapon] === undefined ? def.mag : player.ammo[player.weapon];
    if (mag <= 0) {
      if (typeof h.onEmpty === 'function') h.onEmpty(player.weapon);
      return { hit: false, reason: 'empty' };
    }
    player.ammo[player.weapon] = mag - 1;
    player.lastFireT = sys.time;
    const mx = player.x + Math.cos(player.aim) * 1.3;
    const mz = player.z + Math.sin(player.aim) * 1.3;
    if (typeof h.flash === 'function') h.flash(mx, mz, player.aim);
    if (typeof h.shake === 'function') h.shake(3);
    const target = pickTarget(def.range, 0.94);
    let result;
    if (target) {
      applyHit(target, def.damage);
      result = { hit: true, target, damage: def.damage };
    } else {
      result = { hit: false, reason: 'miss' };
    }
    // r11-B4: bullet tracer — muzzle to the hit point, or to the
    // crosshair ray target on a miss. Fists/bat never reach here
    // (melee returns above), so no tracer without a gunshot. The
    // existing muzzle flash still fires (h.flash above); the tracer
    // is in addition, showing the bullet's path.
    const muzzle = { x: mx, y: MUZZLE_Y, z: mz };
    let end;
    if (target) {
      end = {
        x: target.x,
        y: typeof target.y === 'number' ? target.y : TARGET_Y,
        z: target.z,
      };
    } else if (typeof sys._aimX === 'number' && typeof sys._aimZ === 'number') {
      const adx = sys._aimX - player.x, adz = sys._aimZ - player.z;
      const ad = Math.sqrt(adx * adx + adz * adz);
      end = ad <= def.range
        ? { x: sys._aimX, y: 0.05, z: sys._aimZ } // crosshair ground point
        : {
            x: muzzle.x + Math.cos(player.aim) * def.range,
            y: MUZZLE_Y,
            z: muzzle.z + Math.sin(player.aim) * def.range,
          };
    } else {
      end = {
        x: muzzle.x + Math.cos(player.aim) * def.range,
        y: MUZZLE_Y,
        z: muzzle.z + Math.sin(player.aim) * def.range,
      };
    }
    const tracer = {
      from: muzzle,
      to: end,
      segments: buildTracerSegments(muzzle, end),
      born: sys.time,
      life: TRACER_LIFE,
      weapon: def.id,
    };
    sys.tracers.push(tracer);
    result.tracer = tracer;
    if (typeof h.tracer === 'function') h.tracer(tracer);
    // Every shot is heard: the police system escalates from here.
    if (typeof h.onShot === 'function') h.onShot(result);
    return result;
  }

  // Drive-by: fire from a car window, pistol or compact SMG only.
  // Never from the Gull — no leaning out of a helicopter. Aims at the
  // mouse point when there is one, else straight out of the driver's
  // side. Returns the same result shape as fire().
  function fireDriveBy() {
    if (!player.vehicle || player.vehicle.kind === 'heli') {
      return { hit: false, reason: 'not-driving' };
    }
    if (!weaponDef(player.weapon).driveby) {
      return { hit: false, reason: 'no-driveby' };
    }
    return fire();
  }

  // Reload from the reserve: magazine plus reserve, counted per
  // weapon. A weapon with an empty reserve cannot reload. Returns
  // true when ammo moved.
  function reload() {
    ensureSlots();
    const def = weaponDef(player.weapon);
    if (def.mag === 0) return false;
    const mag = player.ammo[player.weapon] === undefined ? def.mag : player.ammo[player.weapon];
    if (mag >= def.mag) return false;
    let reserve = player.ammo[`${player.weapon}_reserve`];
    if (reserve === undefined) reserve = def.reserve;
    if (reserve <= 0) return false;
    const take = Math.min(def.mag - mag, reserve);
    player.ammo[player.weapon] = mag + take;
    player.ammo[`${player.weapon}_reserve`] = reserve - take;
    if (typeof h.onReload === 'function') h.onReload(player.weapon);
    return true;
  }

  function takeDamage(amount) {
    if (player.armour > 0) {
      const absorbed = Math.min(player.armour, amount * 0.6);
      player.armour -= absorbed;
      amount -= absorbed;
    }
    player.health = Math.max(0, player.health - amount);
    return player.health <= 0;
  }

  // Per-frame update. `input` carries the aim point and trigger state
  // from the main loop: { aimX, aimZ, firing, pressed }.
  //   aimX/aimZ: world point under the cursor (ground plane).
  //   firing: left mouse held (auto weapons keep firing). The main
  //   loop only passes it while aiming on foot, or from a vehicle
  //   as a drive-by; a held trigger with no aim never reaches here.
  //   pressed: left mouse went down this frame (semi-auto fires once).
  function update(dt, input) {
    ensureSlots();
    sys.time += dt;
    if (player.meleeT > 0) player.meleeT -= dt;
    const inp = input || {};
    if (typeof inp.aimX === 'number' && typeof inp.aimZ === 'number') {
      player.aim = Math.atan2(inp.aimZ - player.z, inp.aimX - player.x);
      if (player.aiming) player.angle = player.aim;
    }
    // r11-B4: remember the crosshair ground point — a miss's tracer
    // ends there — and age out dead tracers (they fade in TRACER_LIFE).
    if (typeof inp.aimX === 'number' && typeof inp.aimZ === 'number') {
      sys._aimX = inp.aimX; sys._aimZ = inp.aimZ;
    }
    if (sys.tracers.length) {
      sys.tracers = sys.tracers.filter((t) => sys.time - t.born < t.life);
    }
    sys.firing = !!inp.firing;
    const def = weaponDef(player.weapon);
    if (sys.firing && def.auto) {
      if (player.vehicle) fireDriveBy();
      else fire();
    } else if (inp.pressed) {
      if (player.vehicle) fireDriveBy();
      else fire();
    }
    return sys;
  }

  // Combat input: right mouse, Tab, digits, R. Installs itself on the
  // canvas (and window for keys); call unbindInput() to remove. The
  // main loop still owns the per-frame update() call and the aim
  // point; this binder owns everything the loop does not: hold right
  // mouse to aim (release to lower the weapon), hold Tab for the
  // weapon wheel, 1–9 to switch slots, R to reload.
  function bindInput(canvas) {
    if (!canvas || !canvas.addEventListener || sys._bound) return false;
    const onContext = (e) => e.preventDefault();
    const onMouseDown = (e) => {
      if (e.button === 2) { e.preventDefault(); setAiming(true); }
      else if (e.button === 0 && (player.vehicle || player.aiming)) {
        // Left mouse only shoots while aiming on foot, or from a
        // vehicle as a drive-by. A click with no RMB held on foot
        // does nothing: no shot, no wasted round, no police call.
        sys.firing = true;
        if (!weaponDef(player.weapon).auto) {
          if (player.vehicle) fireDriveBy();
          else fire();
        }
      }
    };
    const onMouseUp = (e) => {
      if (e.button === 2) setAiming(false);
      if (e.button === 0) sys.firing = false;
    };
    const onBlur = () => {
      setAiming(false);
      sys.firing = false;
    };
    const onKeyDown = (e) => {
      if (e.key === 'Tab') { e.preventDefault(); sys.wheelOpen = true; }
      else if (/^[1-9]$/.test(e.key)) switchTo(parseInt(e.key, 10) - 1);
      else if (e.key === 'r' || e.key === 'R') reload();
    };
    const onKeyUp = (e) => {
      if (e.key === 'Tab') sys.wheelOpen = false;
    };
    canvas.addEventListener('contextmenu', onContext);
    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('blur', onBlur);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    sys._bound = { onContext, onMouseDown, onMouseUp, onBlur, onKeyDown, onKeyUp, canvas };
    return true;
  }

  function unbindInput() {
    const b = sys._bound;
    if (!b) return false;
    b.canvas.removeEventListener('contextmenu', b.onContext);
    b.canvas.removeEventListener('mousedown', b.onMouseDown);
    window.removeEventListener('mouseup', b.onMouseUp);
    window.removeEventListener('blur', b.onBlur);
    window.removeEventListener('keydown', b.onKeyDown);
    window.removeEventListener('keyup', b.onKeyUp);
    sys._bound = null;
    return true;
  }

  // The HUD block for the weapons panel: current weapon, ammo in the
  // magazine and in reserve, the wheel state, and the slot list.
  function snapshot() {
    ensureSlots();
    const def = weaponDef(player.weapon);
    const mag = player.ammo[player.weapon] === undefined ? def.mag : player.ammo[player.weapon];
    let reserve = player.ammo[`${player.weapon}_reserve`];
    if (reserve === undefined) reserve = def.reserve;
    return {
      weapon: player.weapon,
      weaponName: def.name,
      damage: def.damage,
      mag,
      magSize: def.mag,
      reserve,
      melee: def.mag === 0,
      aiming: sys.aiming,
      wheelOpen: sys.wheelOpen,
      tracer: sys.tracers.length ? sys.tracers[sys.tracers.length - 1] : null, // r11-B4: latest live tracer
      slots: SLOT_ORDER.map((id, i) => {
        const d = weaponDef(id);
        const m = player.ammo[id] === undefined ? d.mag : player.ammo[id];
        let r = player.ammo[`${id}_reserve`];
        if (r === undefined) r = d.reserve;
        return { index: i, id, name: d.name, mag: m, magSize: d.mag, reserve: r, active: id === player.weapon };
      }),
    };
  }

  sys.setAiming = setAiming;
  sys.switchTo = switchTo;
  sys.cycle = cycle;
  sys.fire = fire;
  sys.fireDriveBy = fireDriveBy;
  sys.meleeAttack = meleeAttack;
  sys.reload = reload;
  sys.takeDamage = takeDamage;
  sys.update = update;
  sys.bindInput = bindInput;
  sys.unbindInput = unbindInput;
  sys.snapshot = snapshot;
  return sys;
}

// Renderer for the r11-B4 tracer — the one piece the wiring layer
// owns: pass THREE + the scene, get { show, update, dispose }.
// show(tracer) draws its dash segments as a thin yellow
// THREE.LineSegments (the segmentation lives in the geometry, so the
// line is dashed by construction, never a solid beam); update(now)
// fades each line out over its life and removes it. The weapons
// system calls the `tracer` hook on every shot; the wiring layer
// hands that hook to show() and ticks update(state.time) per frame
// (born/life run on the same game clock as the muzzle flash).
// No THREE is imported here — it is passed in, so this module stays
// importable headless (Node self-test).
export function createTracerRenderer(THREE, scene) {
  const noop = { show() {}, update() {}, dispose() {} };
  if (!THREE || !scene || typeof scene.add !== 'function') return noop;
  const live = [];
  function show(tracer) {
    if (!tracer || !Array.isArray(tracer.segments) || !tracer.segments.length) return;
    const pos = [];
    for (const s of tracer.segments) {
      pos.push(s.from.x, s.from.y, s.from.z, s.to.x, s.to.y, s.to.z);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const mat = new THREE.LineBasicMaterial({
      color: 0xffe14d, transparent: true, opacity: 0.95,
    });
    const line = new THREE.LineSegments(geo, mat);
    line.frustumCulled = false;
    scene.add(line);
    live.push({ line, geo, mat, born: tracer.born, life: tracer.life || TRACER_LIFE });
  }
  function update(now) {
    for (let i = live.length - 1; i >= 0; i--) {
      const t = live[i];
      const age = now - t.born;
      if (age >= t.life) {
        scene.remove(t.line);
        t.geo.dispose();
        t.mat.dispose();
        live.splice(i, 1);
      } else {
        t.mat.opacity = 0.95 * (1 - age / t.life);
      }
    }
  }
  function dispose() {
    for (const t of live) {
      scene.remove(t.line);
      t.geo.dispose();
      t.mat.dispose();
    }
    live.length = 0;
  }
  return { show, update, dispose };
}
