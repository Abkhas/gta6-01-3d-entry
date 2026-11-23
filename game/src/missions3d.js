// missions3d.js — the ten story missions of Palma Verde, rebuilt for 3D.
//
// Data first, engine second. A mission is plain data: id, act, giver,
// briefing, payout, RP, and a list of stages. A stage carries the type
// of work it asks for, the district and place the route points at, one
// short objective line, a detail line for the HUD, and the dialogue
// spoken when the stage begins.
//
// The engine is a small state machine over a plain mission-state
// object. It never touches the renderer, the DOM, or any other system
// directly: the caller supplies `hooks` for the things only the world
// can answer (has the player arrived? are the foes down? did the race
// end?) and for the side effects (dialogue lines, banners, wanted
// changes). Any hook may be missing — a missing hook just means "not
// finished yet", so the engine is safe to drive with an empty hooks
// object in a smoke test.
//
// Coordinates in 3D are metres on the ground plane: x east, z south,
// y up. Mission places are named districts + landmarks; the world
// layer (B1) resolves a place to a position, the engine only ever
// carries the name.
//
// Mission state shape (lives on the shared game state as
// `state.missions`, or stands alone via createMissionState()):
//   { current: <id|null>, stage: <index>, completed: [<id>],
//     lastFailed: <id|null> }

export const STAGE_TYPES = ['drive-to', 'shoot', 'deliver', 'race', 'escort', 'pickup'];

export const DISTRICTS = [
  'Marina',
  'Old Town',
  'Citrus Lane',
  'Boardwalk',
  'The Docks',
  'Palm Heights',
  'Northgate',
];

// Shot anchors: which staged screenshot frame each mission's key
// moment is built for. The integrator uses these to point the camera,
// not the engine.
export const MISSION_SHOTS = {
  'old-town-score': { chaseStage: 'score-escape', note: 'chase shot: stage 3, four-star escape' },
  'the-drop': { nightStage: 'drop-ambush', note: 'night shot: stage 3, handoff ambush' },
  'sky-courier': { heliStage: 'sky-lift', note: 'heli shot: stage 1, lift-off from the Marina pad' },
};

export const MISSIONS = [
  {
    id: 'the-debt',
    num: 1,
    act: 'ACT I',
    name: 'The Debt',
    giver: 'Nadia Venn',
    briefing:
      'Nadia lent you the car and the cash to get out of Marina. Now she wants her two thousand back, and she wants it in motion, not in promises.',
    payout: 500,
    rp: 150,
    stages: [
      {
        id: 'debt-pickup',
        type: 'drive-to',
        district: 'Marina',
        place: 'Nadia\u2019s garage',
        objective: 'Pick up Nadia\u2019s car',
        detail: 'Walk to the silver sedan parked behind the garage and get in.',
        dialogue: [
          { who: 'Nadia Venn', line: 'There it is. Two grand, Rey. You owe me, so tonight you drive for me.' },
          { who: 'Rey Calder', line: 'Two grand and a full tank. I can live with that. Where first?' },
        ],
      },
      {
        id: 'debt-cross-town',
        type: 'drive-to',
        district: 'Citrus Lane',
        place: 'Corner market',
        objective: 'Drive across town to Citrus Lane',
        detail: 'Follow the dashed route. Keep the car in one piece and the police unbothered.',
        dialogue: [
          { who: 'Nadia Venn', line: 'Easy does it. Lights green, hands steady. Palma Verde rewards patience.' },
          { who: 'Rey Calder', line: 'Patience I have. It is the debt I am in a hurry about.' },
        ],
      },
      {
        id: 'debt-handoff',
        type: 'deliver',
        district: 'Citrus Lane',
        place: 'Corner market',
        objective: 'Hand the envelope to the shopkeeper',
        detail: 'Get out, walk to the counter, and hand the envelope over. No talking, no lingering.',
        dialogue: [
          { who: 'Nadia Venn', line: 'Counter, envelope, out the door. He counts it later. You are done here.' },
          { who: 'Rey Calder', line: 'One errand down. Tell me the next one pays better than this one.' },
        ],
      },
    ],
  },
  {
    id: 'hot-wheels',
    num: 2,
    act: 'ACT I',
    name: 'Hot Wheels',
    giver: 'Nadia Venn',
    briefing:
      'A coral-red Cometa GT is parked outside the Boardwalk hotel every evening, and its owner never locks it twice. Bring it to the Docks, unmarked.',
    payout: 1200,
    rp: 250,
    stages: [
      {
        id: 'wheels-find',
        type: 'drive-to',
        district: 'Boardwalk',
        place: 'Hotel forecourt',
        objective: 'Find the Cometa GT',
        detail: 'The GT sits in front of the hotel. Walk up slow and check the street first.',
        dialogue: [
          { who: 'Nadia Venn', line: 'Coral red, black roof. If the valet is looking, wait him out.' },
          { who: 'Rey Calder', line: 'A car like that does not get parked, it gets displayed.' },
        ],
      },
      {
        id: 'wheels-steal',
        type: 'pickup',
        district: 'Boardwalk',
        place: 'Hotel forecourt',
        objective: 'Take the Cometa GT',
        detail: 'Get in and drive. Taking a car in the open will draw attention.',
        dialogue: [
          { who: 'Rey Calder', line: 'Keys in the sun visor. Some people earn their bad luck.' },
          { who: 'Nadia Venn', line: 'Drive it like it is already yours. That is half the job.' },
        ],
      },
      {
        id: 'wheels-deliver',
        type: 'drive-to',
        district: 'The Docks',
        place: 'Warehouse 9',
        objective: 'Deliver the GT to Warehouse 9',
        detail: 'Lose any attention first, then park inside the warehouse doors.',
        dialogue: [
          { who: 'Nadia Venn', line: 'Warehouse 9, doors shut behind you. The buyer pays in cash, no names.' },
          { who: 'Rey Calder', line: 'Next time, steal something with a slower owner.' },
        ],
      },
    ],
  },
  {
    id: 'boardwalk-heat',
    num: 3,
    act: 'ACT I',
    name: 'Boardwalk Heat',
    giver: 'Nadia Venn',
    briefing:
      'The Docks crew tipped the PVPD about the GT, and the beach road is crawling. Get from the Boardwalk to Old Town with three stars on you and do not get boxed in.',
    payout: 1500,
    rp: 300,
    wantedOnStart: 3,
    stages: [
      {
        id: 'heat-run',
        type: 'drive-to',
        district: 'Old Town',
        place: 'Church square',
        objective: 'Outrun the pursuit to Old Town',
        detail: 'Keep moving, use the side streets, and do not stop for anything with lights on top.',
        dialogue: [
          { who: 'Nadia Venn', line: 'Three stars, Rey. The beach road is a trap — cut through the lanes.' },
          { who: 'Rey Calder', line: 'Three stars and a full tank. I have had worse evenings.' },
        ],
      },
      {
        id: 'heat-lose',
        type: 'drive-to',
        district: 'Old Town',
        place: 'Church square',
        objective: 'Break line of sight and cool off',
        detail: 'Stay out of sight until the stars drop. A quiet alley works better than speed now.',
        dialogue: [
          { who: 'Nadia Venn', line: 'They cannot chase what they cannot see. Park it dark and wait.' },
          { who: 'Rey Calder', line: 'Quiet. That is the hardest part of this job.' },
        ],
      },
    ],
  },
  {
    id: 'the-drop',
    num: 4,
    act: 'ACT I',
    name: 'The Drop',
    giver: 'Nadia Venn',
    briefing:
      'A package for the Northgate crew, cash on delivery. The handoff is on foot, in the open, and the last crew that ran it got jumped halfway through.',
    payout: 1800,
    rp: 350,
    stages: [
      {
        id: 'drop-carry',
        type: 'drive-to',
        district: 'Northgate',
        place: 'Overpass car park',
        objective: 'Carry the package to Northgate',
        detail: 'Drive the package up to the overpass car park. Do not open it, do not stop for anyone.',
        dialogue: [
          { who: 'Nadia Venn', line: 'It is light, it is sealed, and it is none of our business what is inside.' },
          { who: 'Rey Calder', line: 'Sealed is fine. Sealed keeps everybody calm.' },
        ],
      },
      {
        id: 'drop-handoff',
        type: 'deliver',
        district: 'Northgate',
        place: 'Overpass car park',
        objective: 'Make the handoff on foot',
        detail: 'Leave the car, walk to the buyer, and hand the package over.',
        dialogue: [
          { who: 'Rey Calder', line: 'Package, as promised. Count it here, count it fast.' },
          { who: 'Nadia Venn', line: 'Good. He pays, you walk. Do not watch him leave.' },
        ],
      },
      {
        id: 'drop-ambush',
        type: 'shoot',
        district: 'Northgate',
        place: 'Overpass car park',
        objective: 'Fight off the ambush',
        detail: 'Rivals are moving in on the car park. Use cover, pick your shots, and clear them out.',
        dialogue: [
          { who: 'Rey Calder', line: 'Movement on the ramps. So much for a quiet handoff.' },
          { who: 'Nadia Venn', line: 'You are on your own up there, Rey. Make it quick and make it count.' },
        ],
      },
    ],
  },
  {
    id: 'sky-courier',
    num: 5,
    act: 'ACT II',
    name: 'Sky Courier',
    giver: 'Ines Duarte',
    briefing:
      'Ines has the Gull fuelled and waiting on the Marina pad. A rooftop pickup in Palm Heights, a drop on the Docks roof — and the whole city underneath you.',
    payout: 2200,
    rp: 400,
    stages: [
      {
        id: 'sky-lift',
        type: 'pickup',
        district: 'Marina',
        place: 'Helipad',
        objective: 'Take the Gull from the Marina pad',
        detail: 'Board the helicopter and lift off. Mind the masts on the way up.',
        dialogue: [
          { who: 'Ines Duarte', line: 'She is fuelled, she is patient, and she hates hard landings. Be gentle.' },
          { who: 'Rey Calder', line: 'I have never flown over my own city before. Let us see it from the top.' },
        ],
      },
      {
        id: 'sky-rooftop',
        type: 'pickup',
        district: 'Palm Heights',
        place: 'Villa roof',
        objective: 'Pick up the courier on the villa roof',
        detail: 'Set down on the marked roof, wait for the courier to board, then lift again.',
        dialogue: [
          { who: 'Rey Calder', line: 'Roof in sight. Hold still, hold still — there, she is aboard.' },
          { who: 'Ines Duarte', line: 'You fly like you drive. That is a compliment, mostly.' },
        ],
      },
      {
        id: 'sky-deliver',
        type: 'drive-to',
        district: 'The Docks',
        place: 'Warehouse roof',
        objective: 'Drop the courier on the Docks roof',
        detail: 'Fly to the warehouse roof and set down soft. The job ends when her feet touch the roof.',
        dialogue: [
          { who: 'Rey Calder', line: 'Docks roof, dead ahead. Last stop, then I am buying dinner.' },
          { who: 'Ines Duarte', line: 'Land it clean and dinner is on me instead.' },
        ],
      },
    ],
  },
  {
    id: 'old-town-score',
    num: 6,
    act: 'ACT II',
    name: 'Old Town Score',
    giver: 'Nadia Venn',
    briefing:
      'The Old Town bank keeps its morning cash in a back room with one tired guard and a slow alarm. In, out, and gone before the PVPD helicopter is overhead.',
    payout: 3500,
    rp: 550,
    stages: [
      {
        id: 'score-enter',
        type: 'drive-to',
        district: 'Old Town',
        place: 'Bank side door',
        objective: 'Reach the bank side door',
        detail: 'Park out of sight of the main street and slip in through the side door.',
        dialogue: [
          { who: 'Nadia Venn', line: 'Side door, back room, cash drawer. Four minutes, then you are smoke.' },
          { who: 'Rey Calder', line: 'Four minutes. I will give it three.' },
        ],
      },
      {
        id: 'score-grab',
        type: 'pickup',
        district: 'Old Town',
        place: 'Bank back room',
        objective: 'Grab the cash',
        detail: 'Take the cash from the back room. The alarm is already counting down.',
        dialogue: [
          { who: 'Rey Calder', line: 'Drawer open, bag full. Somebody upstairs is already shouting.' },
          { who: 'Nadia Venn', line: 'Then stop admiring it and run.' },
        ],
      },
      {
        id: 'score-escape',
        type: 'drive-to',
        district: 'Marina',
        place: 'Safehouse lane',
        objective: 'Escape the four-star response',
        detail: 'Four stars are on you and the helicopter is circling. Break away through the lanes and reach the safehouse.',
        dialogue: [
          { who: 'Nadia Venn', line: 'Heli overhead, Rey. Alleys, not avenues — the heli cannot follow you there.' },
          { who: 'Rey Calder', line: 'Alleys it is. Tell the safehouse to leave the light on.' },
        ],
      },
      {
        id: 'score-cool',
        type: 'drive-to',
        district: 'Marina',
        place: 'Safehouse lane',
        objective: 'Lay low until the heat fades',
        detail: 'Stay hidden until the wanted level drops. The bank money spends better cold.',
        dialogue: [
          { who: 'Nadia Venn', line: 'Breathe. The money is yours when the sky is empty again.' },
          { who: 'Rey Calder', line: 'Empty sky, full bag. That is the whole business, is it not?' },
        ],
      },
    ],
  },
  {
    id: 'street-kings',
    num: 7,
    act: 'ACT II',
    name: 'Street Kings',
    giver: 'Tuck Ibarra',
    briefing:
      'Tuck has talked the Boardwalk racers into a winner-takes-all sprint along the beach road. Beat the pack and the street starts saying your name.',
    payout: 2500,
    rp: 450,
    stages: [
      {
        id: 'kings-grid',
        type: 'drive-to',
        district: 'Boardwalk',
        place: 'Beach road start line',
        objective: 'Get to the start line',
        detail: 'Line up on the beach road with the other racers. The crowd is already betting against you.',
        dialogue: [
          { who: 'Tuck Ibarra', line: 'They are fast, Rey, but they are show-offs. You are a driver. Big difference.' },
          { who: 'Rey Calder', line: 'Show-offs brake late. I brake never. Let us see which wins.' },
        ],
      },
      {
        id: 'kings-race',
        type: 'race',
        district: 'Boardwalk',
        place: 'Beach road circuit',
        objective: 'Win the street race',
        detail: 'Three laps of the beach road. First across the line takes the pot.',
        dialogue: [
          { who: 'Tuck Ibarra', line: 'Green light, Rey. Keep it clean through the first bend and the rest is yours.' },
          { who: 'Rey Calder', line: 'Clean is a strong word. Fast is the one I need.' },
        ],
      },
      {
        id: 'kings-payout',
        type: 'deliver',
        district: 'Boardwalk',
        place: 'Beach road start line',
        objective: 'Collect the winnings',
        detail: 'Return to the start line and collect the pot from Tuck.',
        dialogue: [
          { who: 'Tuck Ibarra', line: 'There it is, winner. The beach road has a new king tonight.' },
          { who: 'Rey Calder', line: 'King for a night. I will take it — and the cash.' },
        ],
      },
    ],
  },
  {
    id: 'the-informant',
    num: 8,
    act: 'ACT II',
    name: 'The Informant',
    giver: 'Nadia Venn',
    briefing:
      'Tuck picked up word that a PVPD informant is about to be burned, and the only person who can walk him out is you. Keep him breathing until he is across the bridge.',
    payout: 2800,
    rp: 500,
    stages: [
      {
        id: 'informant-meet',
        type: 'drive-to',
        district: 'Citrus Lane',
        place: 'Market alley',
        objective: 'Meet Tuck in the market alley',
        detail: 'Tuck is waiting with the informant. Drive in quiet and keep the car running.',
        dialogue: [
          { who: 'Tuck Ibarra', line: 'He is nervous, he is talkative, and he is ours to lose. Easy now.' },
          { who: 'Rey Calder', line: 'Nervous I can handle. Talkative I can outdrive.' },
        ],
      },
      {
        id: 'informant-escort',
        type: 'escort',
        district: 'Citrus Lane',
        place: 'Market alley',
        objective: 'Escort Tuck and the informant out',
        detail: 'Stay close to Tuck\u2019s car and keep the tail off them. If they stop, you stop.',
        dialogue: [
          { who: 'Tuck Ibarra', line: 'Stay on my bumper, Rey. Anything that gets close, you deal with it.' },
          { who: 'Rey Calder', line: 'On your bumper. Nothing gets past me tonight.' },
        ],
      },
      {
        id: 'informant-bridge',
        type: 'drive-to',
        district: 'Northgate',
        place: 'Bridge north end',
        objective: 'Get them across the bridge',
        detail: 'Lead the escort across the bridge to the north end. Once they are over, the job is done.',
        dialogue: [
          { who: 'Tuck Ibarra', line: 'Bridge ahead. One push and he is somebody else\u2019s problem.' },
          { who: 'Rey Calder', line: 'Almost there. Keep your foot down and do not look back.' },
        ],
      },
    ],
  },
  {
    id: 'pier-pressure',
    num: 9,
    act: 'ACT III',
    name: 'Pier Pressure',
    giver: 'Nadia Venn',
    briefing:
      'A rival crew is moving product through the boat yard at dusk, and Nadia wants the yard — and the message it sends. Clear the yard, then take what they left behind.',
    payout: 3200,
    rp: 600,
    stages: [
      {
        id: 'pier-approach',
        type: 'drive-to',
        district: 'The Docks',
        place: 'Boat yard gate',
        objective: 'Reach the boat yard at dusk',
        detail: 'Drive to the boat yard gate as the light goes. Park where the cranes hide the car.',
        dialogue: [
          { who: 'Nadia Venn', line: 'Dusk is your cover. The yard crew counts crates, not shadows.' },
          { who: 'Rey Calder', line: 'Shadows and a full magazine. That should be enough.' },
        ],
      },
      {
        id: 'pier-clear',
        type: 'shoot',
        district: 'The Docks',
        place: 'Boat yard',
        objective: 'Clear the boat yard',
        detail: 'Rivals hold the yard between the hulls. Work the cover, clear them in pairs, and watch the high crates.',
        dialogue: [
          { who: 'Rey Calder', line: 'They know I am here. Good — it saves time finding them.' },
          { who: 'Nadia Venn', line: 'Yard is yours when the shooting stops. Make it stop soon.' },
        ],
      },
      {
        id: 'pier-take',
        type: 'pickup',
        district: 'The Docks',
        place: 'Boat yard',
        objective: 'Take the rival stash',
        detail: 'Collect the stash from the yard office and get back to the car.',
        dialogue: [
          { who: 'Rey Calder', line: 'Stash in hand. Their boat leaves without its cargo tonight.' },
          { who: 'Nadia Venn', line: 'And their crew leaves with a story about you. Even better.' },
        ],
      },
    ],
  },
  {
    id: 'palma-verde-nights',
    num: 10,
    act: 'ACT III',
    name: 'Palma Verde Nights',
    giver: 'Nadia Venn',
    briefing:
      'Everything comes due tonight. The whole PVPD is on the street, the helicopter is up, and the only way out is the pier at the end of the Boardwalk. Drive like the city is yours — because after tonight, it is.',
    payout: 8000,
    rp: 1000,
    wantedOnStart: 5,
    stages: [
      {
        id: 'nights-breakout',
        type: 'drive-to',
        district: 'Boardwalk',
        place: 'Pier approach',
        objective: 'Break out toward the Boardwalk',
        detail: 'Five stars, roadblocks ahead, helicopter above. Push through the cordon and keep the car moving.',
        dialogue: [
          { who: 'Nadia Venn', line: 'Every unit in the city is looking for you, Rey. So give them something to look at.' },
          { who: 'Rey Calder', line: 'Then let us make it a night they remember.' },
        ],
      },
      {
        id: 'nights-roadblock',
        type: 'shoot',
        district: 'Boardwalk',
        place: 'Pier approach',
        objective: 'Smash through the roadblock',
        detail: 'A roadblock holds the pier approach. Clear the way on foot if you have to — the pier is past it.',
        dialogue: [
          { who: 'Rey Calder', line: 'Roadblock dead ahead. They built a wall. Walls fall.' },
          { who: 'Nadia Venn', line: 'Through, not around. There is no around left.' },
        ],
      },
      {
        id: 'nights-heli',
        type: 'drive-to',
        district: 'Boardwalk',
        place: 'Pier approach',
        objective: 'Shake the helicopter',
        detail: 'The helicopter is still tracking you. Break its line of sight under the pier structure, then run for the end.',
        dialogue: [
          { who: 'Nadia Venn', line: 'Under the pier, Rey — the heli cannot see through steel.' },
          { who: 'Rey Calder', line: 'Steel above, sea below. I can work with that.' },
        ],
      },
      {
        id: 'nights-pier',
        type: 'drive-to',
        district: 'Boardwalk',
        place: 'Pier end',
        objective: 'Reach the end of the pier',
        detail: 'Run to the end of the pier. Nadia\u2019s boat is waiting, and Palma Verde is behind you now.',
        dialogue: [
          { who: 'Nadia Venn', line: 'End of the pier, Rey. Boat is waiting. Walk away from all of it.' },
          { who: 'Rey Calder', line: 'Palma Verde nights. I think I will be back for more of them.' },
        ],
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Engine. Pure functions over the mission-state object; the only outside
// contact is the hooks object described at the top of this file.
// ---------------------------------------------------------------------------

export function missionById(id) {
  return MISSIONS.find((m) => m.id === id) || null;
}

export function missionList() {
  return MISSIONS.map((m) => ({
    id: m.id, num: m.num, act: m.act, name: m.name, giver: m.giver,
    payout: m.payout, rp: m.rp, stageCount: m.stages.length,
  }));
}

export function createMissionState() {
  return { current: null, stage: 0, completed: [], lastFailed: null };
}

export function ensureMissionState(state) {
  if (!state.missions) state.missions = createMissionState();
  if (!Array.isArray(state.missions.completed)) state.missions.completed = [];
  if (typeof state.missions.stage !== 'number') state.missions.stage = 0;
  return state.missions;
}

export function isMissionUnlocked(state, id) {
  const target = missionById(id);
  if (!target) return false;
  ensureMissionState(state);
  if (target.num === 1) return true;
  const prev = MISSIONS.find((m) => m.num === target.num - 1);
  return prev ? state.missions.completed.includes(prev.id) : false;
}

export function currentMission(state) {
  ensureMissionState(state);
  if (!state.missions.current) return null;
  return missionById(state.missions.current);
}

export function currentStage(state) {
  const mission = currentMission(state);
  if (!mission) return null;
  return mission.stages[state.missions.stage] || null;
}

export function stageProgress(state) {
  const mission = currentMission(state);
  if (!mission) return { done: 0, total: 0, label: '' };
  const done = Math.min(state.missions.stage, mission.stages.length);
  return { done, total: mission.stages.length, label: `${done + 1}/${mission.stages.length}` };
}

// The NEXT line the HUD prints under the current objective: the next
// stage's objective in the same mission; on the last stage, the payoff
// line; with no mission running, the next unlocked mission's name.
export function nextObjective(state) {
  const mission = currentMission(state);
  if (!mission) {
    const next = MISSIONS.find(
      (m) => !state.missions?.completed?.includes(m.id) && isMissionUnlocked(state, m.id),
    );
    return next ? `Next job: ${next.name} — ${next.giver}` : 'All missions complete — free roam';
  }
  const idx = state.missions.stage;
  if (idx + 1 < mission.stages.length) return mission.stages[idx + 1].objective;
  return `Finish ${mission.name} — collect $${mission.payout.toLocaleString('en-US')} + ${mission.rp} RP`;
}

function emit(hooks, state, kind, payload) {
  if (hooks && typeof hooks.onEvent === 'function') hooks.onEvent(state, kind, payload || {});
}

function speakStage(hooks, state, stage) {
  if (!stage || !stage.dialogue) return;
  for (const line of stage.dialogue) {
    emit(hooks, state, 'dialogue', { who: line.who, line: line.line, stage: stage.id });
  }
}

export function startMission(state, id, hooks) {
  ensureMissionState(state);
  const mission = missionById(id);
  if (!mission) return { ok: false, reason: 'no-such-mission' };
  if (state.missions.current) return { ok: false, reason: 'mission-in-progress' };
  if (state.missions.completed.includes(id)) return { ok: false, reason: 'already-done' };
  if (!isMissionUnlocked(state, id)) return { ok: false, reason: 'locked' };
  state.missions.current = id;
  state.missions.stage = 0;
  if (mission.wantedOnStart) {
    if (hooks && typeof hooks.setWanted === 'function') hooks.setWanted(state, mission.wantedOnStart);
    else state.wanted = mission.wantedOnStart;
  }
  emit(hooks, state, 'mission-start', { id: mission.id, name: mission.name, act: mission.act });
  speakStage(hooks, state, mission.stages[0]);
  return { ok: true, mission: mission.name, stage: mission.stages[0] };
}

function finishStage(state, hooks) {
  const mission = currentMission(state);
  const stage = currentStage(state);
  if (!mission || !stage) return { ok: false, reason: 'no-active-stage' };
  emit(hooks, state, 'stage-done', { mission: mission.id, stage: stage.id });
  state.missions.stage += 1;
  if (state.missions.stage >= mission.stages.length) return completeMission(state, hooks);
  const next = mission.stages[state.missions.stage];
  emit(hooks, state, 'stage-start', { mission: mission.id, stage: next.id, objective: next.objective });
  speakStage(hooks, state, next);
  return { ok: true, advanced: true, stage: next };
}

export function completeMission(state, hooks) {
  const mission = currentMission(state);
  if (!mission) return { ok: false, reason: 'no-active-mission' };
  state.missions.completed.push(mission.id);
  state.missions.current = null;
  state.missions.stage = 0;
  if (typeof state.player?.money === 'number') state.player.money += mission.payout;
  if (typeof state.rp === 'number') state.rp += mission.rp;
  if (typeof state.respect === 'number') state.respect = Math.min(100, state.respect + 4);
  const banner = {
    kind: 'MISSION PASSED',
    title: 'MISSION PASSED',
    name: mission.name,
    payout: mission.payout,
    rp: mission.rp,
    completedCount: state.missions.completed.length,
    totalMissions: MISSIONS.length,
  };
  emit(hooks, state, 'banner', banner);
  return { ok: true, passed: true, banner };
}

// The four reporters below are the only way a stage advances. Each one
// asks the matching hook whether its condition is met, and does nothing
// when the hook is absent or says no.
export function reportArrival(state, hooks) {
  const stage = currentStage(state);
  if (!stage) return { ok: false, reason: 'no-active-stage' };
  if (stage.type !== 'drive-to' && stage.type !== 'escort' && stage.type !== 'pickup') {
    return { ok: false, reason: 'wrong-stage-type' };
  }
  const arrived = hooks && typeof hooks.atTarget === 'function' ? hooks.atTarget(state, stage) : false;
  if (!arrived) return { ok: false, reason: 'not-there-yet' };
  return finishStage(state, hooks);
}

export function reportCombat(state, hooks) {
  const stage = currentStage(state);
  if (!stage) return { ok: false, reason: 'no-active-stage' };
  if (stage.type !== 'shoot') return { ok: false, reason: 'wrong-stage-type' };
  const cleared = hooks && typeof hooks.foesDown === 'function' ? hooks.foesDown(state, stage) : false;
  if (!cleared) return { ok: false, reason: 'foes-remain' };
  return finishStage(state, hooks);
}

export function reportRace(state, hooks, won) {
  const stage = currentStage(state);
  if (!stage) return { ok: false, reason: 'no-active-stage' };
  if (stage.type !== 'race') return { ok: false, reason: 'wrong-stage-type' };
  const result = typeof won === 'boolean'
    ? won
    : hooks && typeof hooks.raceWon === 'function'
      ? hooks.raceWon(state, stage)
      : false;
  if (!result) return failMission(state, 'race-lost', hooks);
  return finishStage(state, hooks);
}

export function reportDelivery(state, hooks) {
  const stage = currentStage(state);
  if (!stage) return { ok: false, reason: 'no-active-stage' };
  if (stage.type !== 'deliver') return { ok: false, reason: 'wrong-stage-type' };
  const handed = hooks && typeof hooks.parcelHanded === 'function' ? hooks.parcelHanded(state, stage) : false;
  if (!handed) return { ok: false, reason: 'not-handed-over' };
  return finishStage(state, hooks);
}

export function failMission(state, reason, hooks) {
  const mission = currentMission(state);
  if (!mission) return { ok: false, reason: 'no-active-mission' };
  const failed = { id: mission.id, name: mission.name, stage: state.missions.stage, reason: reason || 'failed' };
  state.missions.current = null;
  state.missions.stage = 0;
  state.missions.lastFailed = mission.id;
  emit(hooks, state, 'banner', {
    kind: 'MISSION FAILED', title: 'MISSION FAILED', name: mission.name, reason: failed.reason,
  });
  return { ok: true, failed: true, mission: failed };
}

export function restartMission(state, id, hooks) {
  ensureMissionState(state);
  if (state.missions.current) return { ok: false, reason: 'mission-in-progress' };
  const mission = missionById(id);
  if (!mission) return { ok: false, reason: 'no-such-mission' };
  return startMission(state, id, hooks);
}

export function abandonMission(state, hooks) {
  const mission = currentMission(state);
  if (!mission) return { ok: false, reason: 'no-active-mission' };
  state.missions.current = null;
  state.missions.stage = 0;
  emit(hooks, state, 'mission-abandoned', { id: mission.id, name: mission.name });
  return { ok: true, abandoned: mission.name };
}

export function missionSummary(state) {
  ensureMissionState(state);
  return {
    completed: state.missions.completed.length,
    total: MISSIONS.length,
    current: state.missions.current,
    currentName: currentMission(state)?.name || null,
    stageLabel: stageProgress(state).label,
    next: nextObjective(state),
    nextUnlocked: MISSIONS.find(
      (m) => !state.missions.completed.includes(m.id) && isMissionUnlocked(state, m.id),
    )?.name || null,
  };
}

// The HUD block for the mission panel: everything the HUD needs in one
// plain object. `state` is the shared game state.
export function missionHud(state) {
  const mission = currentMission(state);
  const stage = currentStage(state);
  if (!mission || !stage) {
    return {
      active: false,
      title: 'FREE ROAM',
      objective: '',
      detail: '',
      next: nextObjective(state),
      progressLabel: '',
      act: '',
    };
  }
  return {
    active: true,
    title: `${mission.act} · ${mission.name}`,
    objective: stage.objective,
    detail: stage.detail || '',
    district: stage.district,
    place: stage.place,
    next: nextObjective(state),
    progressLabel: stageProgress(state).label,
    act: mission.act,
    giver: mission.giver,
  };
}
