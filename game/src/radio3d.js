// radio3d.js — the three stations of Palma Verde radio.
//
// Radio is a state machine, not a sound engine: it tracks the current
// station, the current track, and when the track changes. The audio
// layer (B4) reads nowPlaying() and turns the jingle into sound. Q
// cycles stations in the game; the HUD prints the station tagline and
// the track now playing.
//
// Stations (our own, invented for Palma Verde):
//   Onda 98.4 — the sound of the bay (island pop)
//   Sol FM 101.1 — golden-hour pop, all day
//   Static Coast 88.9 — talk, static and night drives
//
// createRadio() returns a system with:
//   update(dt) — advances the track clock; rolls to the next track
//     when the current one ends.
//   nextStation(), prevStation(), setStation(id), setTrack(index)
//   currentStation(), currentTrack(), nowPlaying() — "Onda 98.4 —
//     Marea Alta — Los Corrientes"
//   hud() — the HUD block: station name, tag, track, seconds left.

export const RADIO = [
  {
    id: 'onda', freq: '98.4', name: 'Onda 98.4',
    tag: 'Onda 98.4 — the sound of the bay',
    tracks: ['Marea Alta — Los Corrientes', 'Sol de Medianoche — Vera Luz',
      'Callejon Verde — Duo Brisa', 'Vuelta Larga — Marisol Rey'],
  },
  {
    id: 'solfm', freq: '101.1', name: 'Sol FM',
    tag: 'Sol FM — golden-hour pop, all day',
    tracks: ['Palma Nights — The Halcons', 'Coral Sky — June Faro',
      'Drive Slow — Kip & the Monsoons', 'Neon Palms — Static Coast'],
  },
  {
    id: 'static', freq: '88.9', name: 'Static Coast',
    tag: 'Static Coast — talk, static and night drives',
    tracks: ['Night Desk with Nadia Venn', 'The Docks Report — hourly',
      'Coast to Coast Calls', 'Weather on the Water'],
  },
];

// Seconds each track plays before the station rolls to the next one.
// Talk segments run longer than songs.
const TRACK_SECONDS = { onda: 185, solfm: 205, static: 240 };

export function stationById(id) {
  return RADIO.find((s) => s.id === id) || RADIO[0];
}

export function createRadio() {
  const sys = {
    stationIndex: 0,
    trackIndex: 0,
    trackT: 0,
    on: true,
  };

  function station() {
    return RADIO[sys.stationIndex];
  }

  function trackSeconds() {
    return TRACK_SECONDS[station().id] || 200;
  }

  function nextStation() {
    sys.stationIndex = (sys.stationIndex + 1) % RADIO.length;
    sys.trackIndex = 0;
    sys.trackT = 0;
    return station();
  }

  function prevStation() {
    sys.stationIndex = (sys.stationIndex + RADIO.length - 1) % RADIO.length;
    sys.trackIndex = 0;
    sys.trackT = 0;
    return station();
  }

  function setStation(id) {
    const idx = RADIO.findIndex((s) => s.id === id);
    if (idx < 0) return null;
    sys.stationIndex = idx;
    sys.trackIndex = 0;
    sys.trackT = 0;
    return station();
  }

  function setTrack(index) {
    const st = station();
    if (index < 0 || index >= st.tracks.length) return null;
    sys.trackIndex = index;
    sys.trackT = 0;
    return st.tracks[index];
  }

  function currentTrack() {
    return station().tracks[sys.trackIndex];
  }

  function nowPlaying() {
    const st = station();
    return `${st.name} — ${currentTrack()}`;
  }

  // Advance the track clock; roll to the next track when the current
  // one ends. Returns the track now playing.
  function update(dt) {
    if (!sys.on) return currentTrack();
    sys.trackT += dt;
    if (sys.trackT >= trackSeconds()) {
      sys.trackT = 0;
      sys.trackIndex = (sys.trackIndex + 1) % station().tracks.length;
    }
    return currentTrack();
  }

  function toggle() {
    sys.on = !sys.on;
    return sys.on;
  }

  // The HUD block for the radio strip.
  function hud() {
    const st = station();
    return {
      on: sys.on,
      stationId: st.id,
      station: st.name,
      freq: st.freq,
      tag: st.tag,
      track: currentTrack(),
      trackIndex: sys.trackIndex,
      trackCount: st.tracks.length,
      secondsLeft: Math.max(0, Math.round(trackSeconds() - sys.trackT)),
      nowPlaying: nowPlaying(),
    };
  }

  sys.station = station;
  sys.currentStation = station;
  sys.currentTrack = currentTrack;
  sys.nowPlaying = nowPlaying;
  sys.nextStation = nextStation;
  sys.prevStation = prevStation;
  sys.setStation = setStation;
  sys.setTrack = setTrack;
  sys.update = update;
  sys.toggle = toggle;
  sys.hud = hud;
  return sys;
}
