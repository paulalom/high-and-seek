/* High and Seek — a tiny adventure for a big appetite. */
(() => {
  'use strict';
  for (const eventName of ['selectstart', 'dragstart']) document.addEventListener(eventName, event => event.preventDefault(), true);
  const world = window.HSWorld;
  const rules = world.rules;
  world.shuffleSnacks();
  const domNodes = new Map();
  const $ = id => { if (!domNodes.has(id)) domNodes.set(id, document.getElementById(id)); return domNodes.get(id); };
  const setText = (id, value) => { const node = $(id), text = String(value); if (node.textContent !== text) node.textContent = text; };
  const setAttribute = (node, name, value) => { const text = String(value); if (node.getAttribute(name) !== text) node.setAttribute(name, text); };
  const setStyle = (node, name, value) => { if (node.style[name] !== value) node.style[name] = value; };
  const setHidden = (id, hidden) => { const node = $(id); if (node.hidden !== hidden) node.hidden = hidden; };
  const canvas = $('mansion');
  const gameWorldLabel = canvas.getAttribute('aria-label') || 'High and Seek mansion game world.';
  const renderer = new window.MansionRenderer(canvas, world);
  const guestBrain = window.HSGuestBrain.create(world);
  const wingSimulation = window.HSWing.create(world);
  const stealthSimulation = window.HSStealth.create(world);
  const chatter = window.HSChatter.create();
  const munching = window.HSMunching.create();
  const music = window.HSMusic.create();
  const tvVideo = $('lounge-tv-video');
  const keys = new Set();
  const createGuests = () => world.guests.map(guest => ({ ...guest, routeIndex: 0, monologueCursor: 0 }));
  const startRoom = world.getRoom(world.start.x, world.start.y, world.start.level)?.id;
  const state = { level: 0, player: { ...world.start, level: 0, facing: 1, moving: false }, guests: createGuests(), wing: wingSimulation.getState(), conversation: null, ending: null, talkCooldown: 0, stairsCooldown: 0, nearStairs: false, nearDoor: false, nearToy: false, found: new Set(), bag: [], consumedCount: 0, bankedCount: 0, discovered: new Set(), haulCounts: {}, leftHome: false, nearHome: false, homeAvailable: false, hintTarget: null, activeRoom: startRoom, paused: false, started: false, elapsed: 0, hints: rules.hints, visited: new Set(startRoom ? [startRoom] : []), won: false, failed: false, energy: rules.startEnergy, sprinting: false, warnedLow: false, refillFlash: 0, refillAmount: 0 };
  state.stealth = stealthSimulation.getState();
  const unavailableSnacks = { has: id => state.found.has(id) || state.wing.consumed.has(id) };
  const dialog = $('game-dialog');
  const FRAME_INTERVAL = 1000 / 60, IDLE_INTERVAL = 1000 / 30, HUD_INTERVAL = 100, FRAME_EPSILON = .001;
  let path = [], autoCollect = null, travelIntent = null, toastTimeout, roomTimeout, announcedRoom = startRoom, lastFrame = performance.now(), lastTick = null, lastHudUpdate = -Infinity, renderDirty = true, sound = false, audio;
  let chatterRequest = 0;
  let lastMusicUpdate = -Infinity;
  let terraceMusic = false;
  const chimeNodes = new Set();
  let best = 0, bestRunTime = Infinity;
  try { const record = JSON.parse(localStorage.getItem('high-and-seek-best-haul-v2') || 'null'); if (record && Number.isFinite(record.score) && record.score >= 0 && Number.isFinite(record.elapsed)) { best = record.score; bestRunTime = record.elapsed; } } catch { /* Local storage is optional. */ }
  const timeLabel = seconds => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
  function musicSnapshot() {
    // Keep the quiet arrangement inside the terrace and the hallway-accessed snug.
    // A small return threshold prevents boundary jitter from reversing the fade.
    if (state.level !== world.midnight.level) terraceMusic = false;
    else {
      const room = world.getRoom(state.player.x, state.player.y)?.id;
      const terrace = world.floors[state.level].rooms.find(room => room.id === 'terrace');
      if (room === 'terrace' || room === world.home.room) terraceMusic = true;
      else if (state.player.y < terrace.y - .35) terraceMusic = false;
    }
    if (!sound || document.hidden || state.failed || dialog.open || (state.ending ? state.ending.paused : state.paused) || state.won && !state.ending) return { mode: 'silent', threat: 0, duck: false };
    if (state.ending) return { mode: 'couch', threat: 0, duck: false };
    if (state.conversation) return { mode: 'conversation', threat: 0, duck: true };
    let threat = 0;
    if (state.level === 1) for (const guest of state.guests) if (guest.level === state.level && guest.chasing) threat = Math.max(threat, Math.max(0, 1 - Math.hypot(guest.x - state.player.x, guest.y - state.player.y) / 7));
    const mode = state.level === world.midnight.level ? (terraceMusic ? 'terrace' : 'midnight') : state.level === world.wing.level ? 'snack' : state.level === 1 ? 'upstairs' : 'lounge';
    return { mode, threat, duck: false };
  }
  function syncMusic(force = true, now = performance.now()) {
    if (!force && now - lastMusicUpdate < HUD_INTERVAL) return;
    lastMusicUpdate = now;
    music.update(musicSnapshot());
  }
  $('best-time').textContent = best ? String(best) : '—';
  function updateHaul() {
    setText('found-count', state.won ? state.bankedCount : state.bag.length);
    const kinds = world.snackKinds.filter(kind => state.haulCounts[kind.id]);
    $('snack-list').innerHTML = kinds.length ? kinds.map(kind => `<li class="snack-item found" tabindex="0" data-label="${kind.name} × ${state.haulCounts[kind.id]} · auto-eat +${kind.energy}" aria-label="${kind.name}: ${state.haulCounts[kind.id]} ${state.won ? 'banked' : 'in bag'}, each restores ${kind.energy} energy"><span class="snack-symbol" aria-hidden="true">${kind.icon}</span><span class="haul-quantity">×${state.haulCounts[kind.id]}</span></li>`).join('') : '<li class="haul-empty"><span aria-hidden="true">♧</span> Your bag is empty. Find another munchie.</li>';
    setText('stash-caption', state.won ? 'Couch claimed. TV on. Haul banked.' : state.bag.length ? 'Auto-eat when the full refill fits. Bring the rest home.' : 'Collect a stash. Auto-eat keeps you going.');
    setText('haul-state', state.won ? 'BANKED' : 'UNBANKED');
  }
  updateHaul();
  let mapTiles = Array.from(document.querySelectorAll('.mini-map [data-room]'));
  const mapTileState = new Map();
  let mapStatus = '';
  const promptNode = $('interact-prompt'), promptText = promptNode.querySelector('span'), grabButton = $('mobile-grab'), grabButtonText = grabButton.querySelector('span');
  function discoverSnacks() {
    world.snacks.forEach(snack => { if (snack.level === state.level && !unavailableSnacks.has(snack.id) && world.canSeeSnack(snack, state.player, state.hintTarget)) state.discovered.add(snack.id); });
  }
  function updateEnergyUI(force = true, now = performance.now()) {
    if (!force && now - lastHudUpdate < HUD_INTERVAL) return;
    lastHudUpdate = now;
    const amount = Math.ceil(state.energy), level = amount <= 25 ? 'critical' : amount <= 50 ? 'low' : 'good';
    setText('energy-value', `${amount}%`);
    setStyle($('energy-fill'), 'width', `${Math.round(state.energy * 10) / 10}%`);
    setAttribute($('energy-meter'), 'aria-valuenow', amount);
    setAttribute($('energy-meter'), 'aria-valuetext', `${amount} percent energy`);
    if ($('energy-panel').dataset.level !== level) $('energy-panel').dataset.level = level;
    setText('energy-status', state.failed ? 'Out of juice' : state.won ? 'Haul banked. Time to chill.' : state.conversation?.unskippable ? 'Listening · energy still drains' : state.conversation ? 'Trapped in a story. Mash E!' : !state.started ? 'Auto-eat · only when the full refill fits' : state.sprinting ? 'Sprinting · burns extra' : state.bag.length ? 'Auto-eat ready · no energy wasted' : level === 'critical' ? 'Empty bag. Food or couch. Fast.' : level === 'low' ? 'Empty bag · find more fuel' : 'Collect now. Eat when you need it.');
    setText('timer', timeLabel(state.elapsed));
    const homeExit = nextExitToward(world.home.level);
    setText('mission-status', state.won ? 'Haul banked. Another round?' : state.nearHome && !state.bag.length ? 'Empty bag? Search the terrace for one last snack.' : state.homeAvailable ? state.nearHome ? 'At the couch? Press E to finish.' : 'Another snack detour, or head to the couch.' : 'Collect munchies. The Midnight hallway leads to your couch.');
    setText('return-status', state.won ? 'RUN BANKED · ENJOY THE TV' : state.nearHome ? state.bag.length ? 'PRESS E TO BANK YOUR HAUL' : 'BRING AN UNEATEN SNACK TO BANK' : homeExit ? `${world.floors[homeExit.exit.to].name.toUpperCase()} · ${homeExit.kind === 'stairs' ? 'USE THE STAIRS' : 'THROUGH THE DOOR'}` : 'ACROSS THE TERRACE · TV SNUG');
    setText('floor-label', world.floors[state.level].name);
    setText('stairs-label', state.level === 1 ? 'Down to Waffles' : 'Head upstairs');
    setText('stairs-status', state.level === 0 ? 'VIA WAFFLES’S CLUBHOUSE' : state.level === 1 ? 'BACK TO THE SNACK & PAWS WING' : 'CLUBHOUSE STAIRS · MORE MUNCHIES');
    setHidden('stairs-button', !world.floors[state.level].stair && state.level !== world.start.level);
    setHidden('wing-button', !world.floors[state.level].doors?.length);
    setText('wing-label', currentDoor()?.label || 'Wing doorway');
    setText('wing-status', state.level === world.midnight.level ? 'BACK TO THE UPSTAIRS ROOMS' : currentDoor()?.to === world.midnight.level ? 'MIDNIGHT HALLWAY · YOUR FINAL COUCH' : state.level === world.wing.level ? 'BACK TO THE GROUND FLOOR' : 'WAFFLES · THE WAY UPSTAIRS');
    setHidden('dog-task', state.level !== world.wing.level);
    const inWing = state.level === world.wing.level;
    if ($('game-stage').classList.contains('in-wing') !== inWing) $('game-stage').classList.toggle('in-wing', inWing);
    const dog = state.wing.dog;
    setText('dog-task-title', state.wing.taskCompleted ? 'Dinner delivered ♥' : dog.sleeping ? 'Waffles is napping' : ['sniffing', 'waiting'].includes(dog.status) ? 'Waffles got distracted' : dog.following ? 'Lead Waffles to dinner' : 'Waffles needs dinner');
    setText('dog-task-status', state.wing.taskCompleted ? 'Waffles will follow you to the couch.' : dog.sleeping ? 'Press E nearby to wake him.' : ['sniffing', 'waiting'].includes(dog.status) ? 'Go back and press E to coax him along.' : dog.following ? state.wing.toy?.used ? 'Follow the paws to the far kitchen bowl.' : 'Far kitchen bowl · squeaky break on the way.' : 'Press E nearby. Dinner is across the wing.');
    setAttribute($('home-button'), 'aria-label', homeExit ? `Head to the couch via ${world.floors[homeExit.exit.to].name}` : 'Head to the couch in the TV snug');
    updateNoiseUI();
    updateMap();
    if (state.energy >= 35) state.warnedLow = false;
    if (state.started && !state.paused && !state.failed && !state.conversation && state.energy <= 25 && !state.warnedLow) {
      state.warnedLow = true; toast('You’re running on fumes.', 'Refuel or head for the couch. Unbanked munchies are at risk.', 'ϟ', 6000);
    }
  }
  function updateNoiseUI() {
    const midnight = state.level === world.midnight.level, noise = state.stealth;
    setHidden('noise-panel', !midnight || state.won);
    for (const [name, value] of [['in-midnight', midnight], ['in-resident-lecture', !!state.conversation?.unskippable]]) {
      if ($('game-stage').classList.contains(name) !== value) $('game-stage').classList.toggle(name, value);
    }
    if (!midnight) return;
    const amount = Math.ceil(noise.noise), safe = world.getRoom(state.player.x, state.player.y, state.level)?.id === world.home.room;
    setText('noise-value', safe ? 'SAFE' : `${amount}%`);
    setStyle($('noise-fill'), 'width', `${Math.round(noise.noise * 10) / 10}%`);
    setAttribute($('noise-meter'), 'aria-valuenow', amount);
    setAttribute($('noise-meter'), 'aria-valuetext', safe ? 'TV snug is safe' : `${amount} percent noise`);
    const status = state.conversation?.unskippable ? `Listen… ${Math.ceil(state.conversation.remaining)}s · no skipping` : safe ? 'TV snug · you can relax here.' : noise.label || 'Walk softly. Someone is sleeping.';
    setText('noise-status', status);
    const tone = safe ? 'safe' : ['investigating', 'searching', 'scolding'].includes(noise.mode) ? 'alert' : amount >= 50 ? 'warning' : 'quiet';
    if ($('noise-panel').dataset.level !== tone) $('noise-panel').dataset.level = tone;
  }
  discoverSnacks(); updateEnergyUI();
  roomTimeout = setTimeout(() => $('room-announcement').classList.remove('show'), 4500);
  function updateMap() {
    const status = `${state.level}|${state.activeRoom}|${state.visited.size}`;
    if (mapStatus !== status) {
      mapStatus = status;
      mapTiles.forEach(tile => {
        const active = tile.dataset.room === state.activeRoom;
        const previous = mapTileState.get(tile);
        if (!previous || previous.active !== active) tile.classList.toggle('active', active);
        mapTileState.set(tile, { active });
      });
      setText('explored-count', `${state.visited.size} / ${world.allRooms.length}`);
    }
    setStyle($('map-player'), 'left', `${Math.round(Math.max(4, Math.min(96, state.player.x / world.width * 100)) * 10) / 10}%`);
    setStyle($('map-player'), 'top', `${Math.round(Math.max(4, Math.min(96, state.player.y / world.height * 100)) * 10) / 10}%`);
  }
  function announceRoom(room) {
    const id = room?.id || 'gallery';
    if (id === announcedRoom) return;
    announcedRoom = id; clearTimeout(roomTimeout);
    $('current-room').textContent = room?.name || 'The Central Gallery';
    $('room-announcement').classList.add('show');
    roomTimeout = setTimeout(() => $('room-announcement').classList.remove('show'), 3500);
  }

  function toast(title, copy, icon = '✦', duration = 4800) {
    clearTimeout(toastTimeout);
    $('toast-title').textContent = title;
    $('toast-copy').textContent = copy;
    $('toast-icon').textContent = icon;
    $('toast').classList.remove('fade');
    toastTimeout = setTimeout(() => $('toast').classList.add('fade'), duration);
  }
  toastTimeout = setTimeout(() => $('toast').classList.add('fade'), 6500);

  function chime(victory = false) {
    if (!sound || !audio) return;
    if (audio.state === 'suspended') audio.resume().catch(() => {});
    const notes = victory ? [392, 494, 587, 784] : [523, 659, 784];
    notes.forEach((frequency, index) => {
      const oscillator = audio.createOscillator(), gain = audio.createGain(), start = audio.currentTime + index * .075;
      const note = { oscillator, gain }; chimeNodes.add(note);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); chimeNodes.delete(note); };
      oscillator.type = 'sine'; oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, start); gain.gain.linearRampToValueAtTime(.075, start + .014); gain.gain.exponentialRampToValueAtTime(.001, start + .38);
      oscillator.connect(gain); gain.connect(audio.destination); oscillator.start(start); oscillator.stop(start + .4);
    });
  }
  function stopChimes() { for (const nodes of chimeNodes) { try { nodes.oscillator.stop(); } catch { /* The note may already have ended. */ } nodes.oscillator.disconnect(); nodes.gain.disconnect(); } chimeNodes.clear(); }
  function stopChatter() { chatterRequest++; chatter.stop(); munching.stop(); }
  function speakConversation() {
    const conversation = state.conversation, request = ++chatterRequest;
    chatter.stop();
    if (!sound || !audio || !conversation || state.paused || document.hidden || state.won || state.failed) return;
    const speak = () => {
      if (request === chatterRequest && sound && state.conversation === conversation && !state.paused && !document.hidden && !state.won && !state.failed) chatter.speak(conversation.voiceId || conversation.guestId, conversation.line, conversation.lineIndex);
    };
    if (audio.state === 'suspended') {
      try { Promise.resolve(audio.resume()).then(speak).catch(() => {}); } catch { /* Speech remains optional if audio is blocked. */ }
    } else speak();
  }
  function begin() { if (!state.won && !state.failed && !state.paused) { if (!state.started) lastFrame = performance.now(); state.started = true; renderDirty = true; } }
  function canFinishRun() { return state.level === world.home.level && state.started && !state.paused && !state.failed && !state.won && !state.conversation && state.energy > 0 && state.leftHome && state.bag.length > 0 && world.isHome(state.player.x, state.player.y, state.level); }
  function canUseStairs() { const stair = world.floors[state.level].stair; return !!stair && !state.paused && !state.failed && !state.won && !state.conversation && state.energy > 0 && state.stairsCooldown <= 0 && Math.hypot(state.player.x - stair.x, state.player.y - stair.y) <= stair.radius; }
  function currentDoor() { return world.floors[state.level].doors?.[0] || null; }
  // Follow the actual area connections, including stairs relocated into a wing.
  // Only the next leg is walked; every doorway/stair transition still needs E.
  function nextExitToward(targetLevel) {
    if (state.level === targetLevel) return null;
    const seen = new Set([state.level]), queue = [{ level: state.level, first: null }];
    for (let i = 0; i < queue.length; i++) {
      const current = queue[i], floor = world.floors[current.level];
      const exits = [...(floor.stair ? [{ kind: 'stairs', exit: floor.stair }] : []), ...(floor.doors || []).map(exit => ({ kind: 'door', exit }))];
      for (const step of exits) {
        if (seen.has(step.exit.to)) continue;
        const first = current.first || step;
        if (step.exit.to === targetLevel) return first;
        seen.add(step.exit.to); queue.push({ level: step.exit.to, first });
      }
    }
    return null;
  }
  function canUseDoor() { const door = currentDoor(); return !!door && !state.paused && !state.failed && !state.won && !state.conversation && state.energy > 0 && state.stairsCooldown <= 0 && Math.hypot(state.player.x - door.x, state.player.y - door.y) <= door.radius; }
  function canCallDog() { return state.energy > 0 && wingSimulation.canInteract(state); }
  function canPlayToy() { return state.energy > 0 && !state.conversation && wingSimulation.canPlay(state); }
  function stairsAction() { return world.floors[state.level].stair?.direction === 'up' ? 'Go upstairs' : 'Downstairs to Waffles’s clubhouse'; }
  function interact() { if (state.conversation) { excuseConversation(); return; } if (canCallDog() && wingSimulation.interact(state)) { begin(); handleWingEvents(); updateEnergyUI(); return; } if (canPlayToy() && wingSimulation.play(state)) { begin(); handleWingEvents(); updateEnergyUI(); return; } const snack = nearest(); if (snack) collect(snack); else if (canUseDoor()) useDoor(); else if (canUseStairs()) useStairs(); else if (canFinishRun()) finishRun(); }
  function renderFloorMap() {
    $('mini-map').innerHTML = world.rooms.map(room => `<i data-room="${room.id}" class="${state.level === world.home.level && room.id === world.home.room ? 'home' : ''}"></i>`).join('') + '<b id="map-player"></b>';
    domNodes.delete('map-player'); mapTiles = Array.from(document.querySelectorAll('.mini-map [data-room]')); mapTileState.clear(); mapStatus = '';
    setText('map-floor-caption', world.floors[state.level].name.toUpperCase());
    $('mini-map').classList.toggle('wing-map', world.floors[state.level].kind !== 'mansion');
    if (world.floors[state.level].kind !== 'mansion') mapTiles.forEach(tile => { const room = world.rooms.find(item => item.id === tile.dataset.room); if (room) tile.style.cssText = `left:${room.x / world.width * 100}%;top:${room.y / world.height * 100}%;width:${room.w / world.width * 100}%;height:${room.h / world.height * 100}%`; });
  }
  function changeFloor(level, arrival) {
    stopChatter();
    world.activateFloor(level); state.level = level; state.player.level = level;
    state.player.x = arrival.x; state.player.y = arrival.y; state.player.moving = false;
    wingSimulation.changeFloor?.(level, arrival, state);
    stealthSimulation.changeFloor(level, arrival, state);
    path = []; autoCollect = null; keys.clear(); state.leftHome = true; state.conversation = null;
    guestBrain.reset(); setText('conversation-status', '');
    state.talkCooldown = Math.max(state.talkCooldown, 4); state.stairsCooldown = .75;
    state.nearHome = world.isHome(state.player.x, state.player.y); state.nearbySnack = null; state.nearDoor = false; state.nearDog = false; state.nearToy = false;
    state.activeRoom = world.getRoom(state.player.x, state.player.y)?.id || null;
    if (state.activeRoom) state.visited.add(state.activeRoom);
    rebuildNavigation(); renderer.setFloor(state.player); renderFloorMap();
    discoverSnacks(); updateEnergyUI(); announceRoom(world.getRoom(state.player.x, state.player.y));
    syncMusic();
    lastFrame = performance.now(); renderDirty = true;
  }
  function useStairs() {
    if (!canUseStairs()) return false;
    const stair = world.floors[state.level].stair;
    begin(); changeFloor(stair.to, stair.arrival);
    toast(state.level === 1 ? 'They’ve spotted you.' : 'Back in Waffles’s clubhouse.', state.level === 1 ? 'Dodge the guests for more snacks. The Midnight Wing doorway leads to your final couch.' : 'Explore the wing, or take these stairs back toward the Midnight Wing.', state.level === 1 ? '!' : '🐾');
    if (travelIntent === 'stairs') travelIntent = null;
    continueTravel();
    return true;
  }
  function useDoor() {
    if (!canUseDoor()) return false;
    const door = currentDoor(); begin(); changeFloor(door.to, door.arrival);
    const arrivingMidnight = state.level === world.midnight.level;
    toast(arrivingMidnight ? 'Welcome to the Midnight Wing.' : state.level === world.wing.level ? 'Welcome to Snack & Paws.' : `Back to ${world.floors[state.level].name.toLowerCase()}.`, arrivingMidnight ? 'R follows the hallway straight to your couch. Laundry, wardrobe, attic and terrace are optional detours.' : state.level === world.wing.level ? 'The stairs are in Waffles’s clubhouse. Helping him with dinner is optional.' : 'R points you toward the final couch. Press E at each doorway or staircase.', arrivingMidnight ? '☾' : state.level === world.wing.level ? '🐾' : '⌂', 6500);
    continueTravel();
    return true;
  }
  function headForWing() {
    if (state.paused || state.won || state.failed || state.conversation) return;
    travelIntent = null;
    const door = currentDoor();
    if (!door) return;
    navigate(door.x, door.y); toast(`This way to ${door.label}.`, 'Walk to the doorway, then press E to go through.', '↪');
  }
  function headForStairs() {
    if (state.paused || state.won || state.failed || state.conversation) return;
    travelIntent = 'stairs';
    const stair = world.floors[state.level].stair;
    if (!stair) { const door = currentDoor(); if (door) navigate(door.x, door.y); toast(state.level === world.midnight.level ? 'Back to the upstairs staircase.' : 'The stairs are in Waffles’s clubhouse.', 'Press E at the doorway. You’ll continue toward the stairs; press E there to change floors.', '↟', 6500); return; }
    navigate(stair.x, stair.y);
    toast(stair.direction === 'up' ? 'Going up?' : 'Time to head down?', 'Walk to the stair landing, then press E to change floors.', stair.direction === 'up' ? '↟' : '↡');
  }
  function continueTravel() { if (travelIntent === 'home') headHome(); else if (travelIntent === 'stairs') headForStairs(); }
  function headHome() {
    if (state.paused || state.won || state.failed || state.conversation) return;
    travelIntent = 'home';
    const next = nextExitToward(world.home.level);
    if (next) { navigate(next.exit.x, next.exit.y); toast(`To the couch via ${world.floors[next.exit.to].name}.`, `Press E at the ${next.kind === 'stairs' ? 'stairs' : 'doorway'}. Your route continues on the other side.`, '⌂'); return; }
    if (state.level !== world.home.level) return;
    navigate(world.home.x, world.home.y);
    toast('Your couch is off the Midnight hallway.', 'The side rooms are optional. Press E beside the couch & TV to bank your uneaten snacks.', '⌂');
  }
  function nearest() { const snack = world.nearestSnack(state.player.x, state.player.y, unavailableSnacks, world.collectionRadius); return snack && state.discovered.has(snack.id) ? snack : null; }
  function announceEating(eaten) {
    if (!eaten.length) return;
    state.refillAmount = eaten.reduce((sum, snack) => sum + snack.energy, 0);
    state.refillFlash = performance.now() + 1400;
    if (!document.hidden) munching.play();
    if (!state.conversation) toast(eaten.length === 1 ? `Auto-ate ${eaten[0].name}.` : `Auto-ate ${eaten.length} munchies.`, `+${state.refillAmount} energy · Full refill used · ${state.bag.length} in your bag`, eaten[0].icon, 3400);
  }
  function autoEat(announce = true) {
    if (!state.started || state.paused || state.won || state.failed) return [];
    const eaten = [];
    // Keep picked IDs in found: eaten food must never reappear in the mansion.
    while (state.bag.length) {
      const missing = rules.maxEnergy - state.energy;
      let index = -1;
      for (let i = 0; i < state.bag.length; i++) {
        const snack = state.bag[i];
        if (snack.energy <= missing && (index < 0 || snack.energy > state.bag[index].energy)) index = i;
      }
      if (index < 0) break;
      const [snack] = state.bag.splice(index, 1);
      state.energy += snack.energy;
      state.consumedCount++;
      if (--state.haulCounts[snack.kind] <= 0) delete state.haulCounts[snack.kind];
      eaten.push(snack);
    }
    if (eaten.length) {
      state.homeAvailable = state.leftHome && state.bag.length > 0;
      updateHaul(); updateEnergyUI(); renderDirty = true;
      if (announce) announceEating(eaten);
    }
    return eaten;
  }
  function spendEnergy(amount) {
    if (!state.started || state.paused || state.won || state.failed || !Number.isFinite(amount) || amount < 0) return 0;
    let remaining = amount;
    const eaten = autoEat(false);
    // Stop at each refill threshold, even on a long frame. Every point of a
    // snack's energy is used, and a full bag can rescue an otherwise empty meter.
    while (remaining > 0 && state.energy > 0) {
      const nextRefill = state.bag.length ? Math.min(...state.bag.map(snack => snack.energy)) : 0;
      const threshold = rules.maxEnergy - nextRefill;
      const untilRefill = state.energy - threshold;
      if (nextRefill > 0 && untilRefill > 0 && untilRefill <= remaining) {
        state.energy = threshold;
        remaining -= untilRefill;
      } else {
        const spent = Math.min(remaining, state.energy);
        state.energy -= spent;
        remaining -= spent;
      }
      eaten.push(...autoEat(false));
    }
    announceEating(eaten);
    return amount - remaining;
  }
  function collect(snack = nearest()) {
    if (!snack || snack.level !== state.level || state.paused || state.won || state.failed || state.conversation || state.energy <= 0 || unavailableSnacks.has(snack.id)) return;
    if (Math.hypot(snack.x - state.player.x, snack.y - state.player.y) > world.collectionRadius + .01) return;
    discoverSnacks();
    if (!state.discovered.has(snack.id)) return;
    begin(); state.found.add(snack.id); chime();
    stealthSimulation.makeNoise('rummage', state); handleStealthEvents();
    state.bag.push(snack);
    state.haulCounts[snack.kind] = (state.haulCounts[snack.kind] || 0) + 1;
    const eaten = autoEat(false);
    updateEnergyUI();
    if (state.hintTarget === snack.id) state.hintTarget = null;
    state.homeAvailable = state.leftHome && state.bag.length > 0;
    updateHaul();
    if (eaten.length) announceEating(eaten);
    else toast(`${snack.name} bagged.`, `Saved for later · Auto-eat +${snack.energy} when the full refill fits`, snack.icon);
    autoCollect = null;
    updateMap();
  }

  // The same collision map drives manual movement and click-to-walk pathfinding.
  const step = .5, cols = Math.round(world.width / step) + 1, rows = Math.round(world.height / step) + 1;
  const walkable = new Uint8Array(cols * rows);
  const navigationEdges = new Uint8Array(walkable.length), navigationFloors = new Map();
  const directions = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
  const oppositeDirections = [1, 0, 3, 2, 7, 6, 5, 4];
  const gridX = new Float32Array(walkable.length), gridY = new Float32Array(walkable.length), walkableCells = [], connectorCells = [];
  function rebuildNavigation() {
    walkableCells.length = 0; connectorCells.length = 0;
    const cached = navigationFloors.get(state.level);
    if (cached) {
      walkable.set(cached.walkable); navigationEdges.set(cached.edges);
      for (const index of cached.cells) { walkableCells.push(index); connectorCells.push(index); }
      return;
    }
    navigationEdges.fill(0);
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const index = y * cols + x; gridX[index] = x * step; gridY[index] = y * step;
      walkable[index] = world.isWalkable(gridX[index], gridY[index]) ? 1 : 0;
      if (walkable[index]) { walkableCells.push(index); connectorCells.push(index); }
    }
    for (const index of walkableCells) {
      const x = index % cols, y = Math.floor(index / cols);
      for (let direction = 0; direction < directions.length; direction++) {
        const [dx, dy] = directions[direction], nx = x + dx, ny = y + dy, next = ny * cols + nx;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || next <= index || !walkable[next]) continue;
        const checks = Math.ceil(Math.hypot(dx, dy) * step / .08);
        let clear = true;
        for (let sample = 1; sample < checks; sample++) if (!world.isWalkable(gridX[index] + dx * step * sample / checks, gridY[index] + dy * step * sample / checks)) { clear = false; break; }
        if (clear) {
          navigationEdges[index] |= 1 << direction;
          navigationEdges[next] |= 1 << oppositeDirections[direction];
        }
      }
    }
    navigationFloors.set(state.level, { walkable: walkable.slice(), edges: navigationEdges.slice(), cells: walkableCells.slice() });
  }
  rebuildNavigation();
  const routePrevious = new Int32Array(walkable.length), routeQueue = new Int32Array(walkable.length);
  const position = index => ({ x: gridX[index], y: gridY[index] });
  function closestCell(x, y, connect = false) {
    if (connect) {
      // Try nearby cells first. A distant scan would cast long rays on every click.
      const distanceTo = index => (gridX[index] - x) ** 2 + (gridY[index] - y) ** 2;
      connectorCells.sort((a, b) => distanceTo(a) - distanceTo(b));
      for (const index of connectorCells) {
        if (!navigationEdges[index]) continue;
        const checks = Math.max(1, Math.ceil(Math.sqrt(distanceTo(index)) / .06));
        let clear = true;
        for (let i = 1; i <= checks; i++) {
          const nextX = x + (gridX[index] - x) * i / checks, nextY = y + (gridY[index] - y) * i / checks;
          if (!world.isWalkable(nextX, nextY)) { clear = false; break; }
        }
        if (clear) return index;
      }
      return -1;
    }
    let bestIndex = -1, distance = Infinity;
    for (const index of walkableCells) {
      const d = (gridX[index] - x) ** 2 + (gridY[index] - y) ** 2;
      if (d >= distance) continue;
      distance = d; bestIndex = index;
    }
    return bestIndex;
  }
  function navigate(x, y, snack = null) {
    if (state.paused || state.won || state.failed || state.conversation) return;
    const start = closestCell(state.player.x, state.player.y, true), goal = snack ? 0 : closestCell(x, y);
    if (start < 0 || goal < 0) return;
    const previous = routePrevious, queue = routeQueue;
    previous.fill(-1); queue[0] = start; previous[start] = start;
    let tail = 1;
    const pickupDistanceSquared = (world.collectionRadius * .82) ** 2;
    let target = -1, targetDistance = Infinity;
    for (let head = 0; head < tail; head++) {
      const index = queue[head], d = (gridX[index] - x) ** 2 + (gridY[index] - y) ** 2;
      if (d < targetDistance) { targetDistance = d; target = index; }
      if ((!snack && index === goal) || (snack && d <= pickupDistanceSquared)) { target = index; break; }
      const cx = index % cols, cy = Math.floor(index / cols);
      for (let direction = 0; direction < directions.length; direction++) {
        if (!(navigationEdges[index] & (1 << direction))) continue;
        const [dx, dy] = directions[direction];
        const nx = cx + dx, ny = cy + dy, ni = ny * cols + nx;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || !walkable[ni] || previous[ni] !== -1) continue;
        previous[ni] = index; queue[tail++] = ni;
      }
    }
    if (target < 0 || (snack && (gridX[target] - x) ** 2 + (gridY[target] - y) ** 2 > world.collectionRadius ** 2)) {
      toast('A little too far out.', 'Try a spot inside the mansion.'); return;
    }
    const result = []; let index = target;
    while (index !== start) { result.push(position(index)); index = previous[index]; }
    result.push(position(start)); path = result.reverse(); autoCollect = snack; begin();
  }
  function move(dx, dy) {
    const p = state.player;
    let distanceMoved = 0;
    // Small collision steps also stay solid when a browser throttles animation.
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / .09));
    for (let i = 0; i < steps; i++) {
      if (state.conversation) break;
      const moved = world.moveCircle(p.x, p.y, dx / steps, dy / steps);
      p.x = moved.x; p.y = moved.y; distanceMoved += moved.distance;
      checkConversation();
    }
    if (dx || dy) p.facing = dx - dy >= 0 ? 1 : -1;
    if (!state.conversation && distanceMoved < Math.hypot(dx, dy) * .65) stealthSimulation.makeNoise('bump', state);
    return distanceMoved;
  }

  function updateGuests(dt) {
    const options = { cooldown: state.talkCooldown, conversation: state.conversation, active: !state.paused && state.started && !state.failed && !state.won };
    // Preserve pursuit speed on slow frames while keeping each AI step small.
    for (let remaining = Math.max(0, Math.min(1, dt)); remaining > .00001;) {
      const seconds = Math.min(.25, remaining);
      guestBrain.update(state.guests, state.player, seconds, options);
      remaining -= seconds;
    }
  }
  function whine() {
    if (!sound || !audio || audio.state !== 'running' || state.paused || document.hidden || state.level !== world.wing.level) return;
    const oscillator = audio.createOscillator(), gain = audio.createGain(), now = audio.currentTime;
    const note = { oscillator, gain }; chimeNodes.add(note);
    oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(720, now); oscillator.frequency.exponentialRampToValueAtTime(900, now + .12); oscillator.frequency.exponentialRampToValueAtTime(490, now + .56);
    gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(.045, now + .08); gain.gain.linearRampToValueAtTime(.025, now + .26); gain.gain.exponentialRampToValueAtTime(.001, now + .56);
    oscillator.connect(gain); gain.connect(audio.destination); oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); chimeNodes.delete(note); }; oscillator.start(now); oscillator.stop(now + .58);
  }
  function handleWingEvents() {
    for (const event of wingSimulation.drainEvents()) {
      if (event.type === 'whine') whine();
      if (event.type === 'munch') munching.play();
      if (event.type === 'following' || event.type === 'coaxed') toast('Come on, Waffles!', state.wing.taskCompleted ? 'He’s following you to the couch.' : 'He’s following again. Lead him to the far kitchen bowl.', '🐾', 4500);
      if (event.type === 'distracted') toast('Waffles found something fascinating.', 'Go back and press E nearby to coax him along.', '🐾', 4500);
      if (event.type === 'waiting') toast('Tiny legs. Big mansion.', 'Come back and press E nearby. Waffles needs a little encouragement.', '🐾', 4500);
      if (event.type === 'companion') toast('Your movie-night buddy.', 'Waffles will follow you through the mansion to the final couch.', '♥', 5000);
      if (event.type === 'play') { chime(); toast('A very squeaky snack break.', `+${Math.round(event.energy)} energy for Waffles. Now on to his dinner bowl.`, '🐾', 4500); }
      if (event.type === 'wake') toast('Good morning, sleepy pup.', 'A gentle wake-up. Now show Waffles where his dinner is.', '🐾', 4500);
      if (event.type === 'sleep') toast('Waffles curled up for a nap.', 'Press E nearby to gently wake him and finish the trip to his bowl.', '☾', 5000);
      if (event.type === 'fed') { chime(true); toast('One very happy corgi.', 'Dinner delivered. Waffles will follow you to the couch.', '♥', 6500); updateEnergyUI(); }
      if (event.type === 'snackEaten') {
        state.discovered.delete(event.snackId);
        if (state.hintTarget === event.snackId) state.hintTarget = null;
        if (autoCollect?.id === event.snackId) { path = []; autoCollect = null; toast('Nico got there first.', 'He ate that munchie. Try another hiding spot.', '😋'); }
      }
    }
  }
  function monologueLines(guest) { return guest.monologue?.length ? guest.monologue : [guest.line]; }
  function startResidentLecture(event) {
    if (state.conversation || state.paused || state.won || state.failed || state.level !== world.midnight.level || world.getRoom(state.player.x, state.player.y, state.level)?.id === world.home.room) return false;
    const resident = state.stealth.resident, lines = event.lines?.length ? event.lines : resident.lines;
    state.conversation = { kind: 'resident', unskippable: true, guestId: resident.id, voiceId: event.voiceId || resident.voiceId || 'houseGuest', name: event.name || resident.name, lines, line: lines[0], lineIndex: 0, lineElapsed: 0, remaining: 6, duration: 6, escapePresses: 0, escapeRequired: 0, excuseCost: 0 };
    state.player.moving = false; state.sprinting = false; path = []; autoCollect = null; travelIntent = null; keys.clear();
    clearTimeout(toastTimeout); $('toast').classList.add('fade');
    setText('conversation-status', `${state.conversation.name}: ${state.conversation.line} Listen for six seconds. This lecture cannot be skipped.`);
    syncMusic(); speakConversation(); updateEnergyUI(); renderDirty = true;
    return true;
  }
  function handleStealthEvents() {
    for (const event of stealthSimulation.drainEvents()) {
      if (event.type === 'warning') toast('Who’s still up?', 'You’re getting loud. Walk softly and let the house settle.', '☾', 3800);
      if (event.type === 'alarm') toast('You woke someone up.', 'They’re checking the last noise. Slip out of sight—or reach the safe TV snug.', '!', 4800);
      if (event.type === 'caught') startResidentLecture(event);
    }
  }
  function nextMonologueLine(conversation, advances = 1) {
    if (conversation.unskippable) {
      conversation.lineIndex = Math.min(conversation.lines.length - 1, conversation.lineIndex + advances);
      conversation.line = conversation.lines[conversation.lineIndex];
      setText('conversation-status', `${conversation.name}: ${conversation.line} ${Math.ceil(conversation.remaining)} seconds left. Listen until the lecture ends.`);
      speakConversation();
      return;
    }
    const guest = state.guests.find(person => person.id === conversation.guestId);
    if (!guest) return;
    const lines = monologueLines(guest);
    conversation.lineIndex = (guest.monologueCursor + advances - 1) % lines.length;
    conversation.line = lines[conversation.lineIndex];
    guest.monologueCursor = (guest.monologueCursor + advances) % lines.length;
    setText('conversation-status', `${guest.name}: ${conversation.line} E or Space: next line and escape. ${conversation.escapePresses} of ${conversation.escapeRequired} taps.`);
    speakConversation();
  }
  function advanceMonologue(conversation, seconds) {
    conversation.lineElapsed += seconds;
    const duration = conversation.unskippable ? 2 : rules.conversationLineDuration;
    const advances = Math.floor((conversation.lineElapsed + .000001) / duration);
    if (!advances) return;
    conversation.lineElapsed = Math.max(0, conversation.lineElapsed - advances * duration);
    nextMonologueLine(conversation, advances);
  }
  function checkConversation() {
    if (state.level !== 1 || !state.started || state.paused || state.won || state.failed || state.conversation || state.talkCooldown > 0 || state.energy <= 0) return false;
    const stair = world.floors[state.level].stair;
    // The landing is a safe exit, even if a guest happens to pass nearby.
    if (Math.hypot(state.player.x - stair.x, state.player.y - stair.y) < 2) return false;
    const room = world.getRoom(state.player.x, state.player.y)?.id;
    const guest = state.guests.find(person => {
      if (person.level !== state.level || world.getRoom(person.x, person.y)?.id !== room) return false;
      const distance = Math.hypot(person.x - state.player.x, person.y - state.player.y);
      if (distance > rules.conversationRadius) return false;
      const checks = Math.max(1, Math.ceil(distance / .1));
      for (let i = 1; i < checks; i++) if (!world.isWalkable(state.player.x + (person.x - state.player.x) * i / checks, state.player.y + (person.y - state.player.y) * i / checks, .12)) return false;
      return true;
    });
    if (!guest) return false;
    const lines = monologueLines(guest), lineIndex = (Number.isInteger(guest.monologueCursor) ? guest.monologueCursor : 0) % lines.length;
    state.conversation = { guestId: guest.id, name: guest.name, line: lines[lineIndex], lineIndex, lineElapsed: 0, remaining: rules.conversationDuration, duration: rules.conversationDuration, escapePresses: 0, escapeRequired: rules.conversationEscapePresses, excuseCost: rules.conversationEscapeCost, lastPressAt: -Infinity };
    guest.monologueCursor = (lineIndex + 1) % lines.length;
    state.player.moving = false; state.sprinting = false;
    clearTimeout(toastTimeout); $('toast').classList.add('fade');
    setText('conversation-status', `${guest.name} caught you in a long story. ${state.conversation.line} Mash E or Space ${rules.conversationEscapePresses} times to break away. Escaping costs ${rules.conversationEscapeCost} energy.`);
    syncMusic();
    speakConversation();
    renderDirty = true;
    return true;
  }
  function endConversation(excused = false) {
    const residentLecture = !!state.conversation?.unskippable;
    stopChatter();
    state.conversation = null; state.talkCooldown = rules.conversationCooldown;
    if (residentLecture) { stealthSimulation.endLecture(state); keys.clear(); }
    syncMusic();
    setText('conversation-status', excused ? 'You excused yourself. Keep moving.' : 'The conversation is over. You can move again.');
    renderDirty = true;
  }
  function excuseConversation() {
    if (!state.conversation || state.conversation.unskippable || state.paused || state.failed || state.won) return false;
    const conversation = state.conversation;
    conversation.escapePresses = Math.min(conversation.escapeRequired, conversation.escapePresses + 1);
    conversation.lastPressAt = performance.now();
    renderDirty = true;
    if (conversation.escapePresses < conversation.escapeRequired) {
      conversation.lineElapsed = 0;
      nextMonologueLine(conversation);
      if (sound && !document.hidden) chatter.mash(conversation.escapePresses / conversation.escapeRequired);
      return true;
    }
    const excuseCost = state.conversation.excuseCost, eatenBefore = state.consumedCount;
    endConversation(true);
    spendEnergy(excuseCost);
    toast('“Gotta go. Snack emergency.”', `−${excuseCost} energy${state.consumedCount > eatenBefore ? ' · Auto-eat refueled you.' : ''} · You have a moment to get away.`, '↗', 2600);
    if (state.energy <= 0) exhaust();
    updateEnergyUI();
    return true;
  }

  function hitTransition(transition, click, doorway = false) {
    const anchor = transition.anchor || transition;
    const targets = [{ ...transition, z: .2 }, { ...anchor, z: .2 }];
    if (doorway) targets.push({ ...anchor, z: 1 });
    return targets.some(target => {
      const point = renderer.worldToScreen(target.x, target.y, target.z);
      return Math.hypot(point.x - click.x, point.y - click.y) < 35;
    });
  }
  canvas.addEventListener('pointerdown', event => {
    if (state.paused || state.won || state.failed || state.conversation) return;
    canvas.focus({ preventScroll: true });
    const rect = canvas.getBoundingClientRect(), click = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    let clicked = null, distance = 24;
    for (const snack of world.snacks) {
      if (snack.level !== state.level || unavailableSnacks.has(snack.id) || !state.discovered.has(snack.id)) continue;
      const p = renderer.worldToScreen(snack.x, snack.y, 1.04), d = Math.hypot(p.x - click.x, p.y - click.y);
      if (d < distance) { distance = d; clicked = snack; }
    }
    if (clicked) { travelIntent = null; navigate(clicked.x, clicked.y, clicked); return; }
    const couch = renderer.worldToScreen(world.home.x, world.home.y, .03);
    if (state.level === world.home.level && Math.hypot(couch.x - click.x, couch.y - click.y) < 30) { headHome(); return; }
    const stair = world.floors[state.level].stair;
    if (stair && hitTransition(stair, click)) { headForStairs(); return; }
    const door = currentDoor();
    if (door && hitTransition(door, click, true)) { headForWing(); return; }
    const point = renderer.screenToWorld(event.clientX, event.clientY);
    if (point.x >= .8 && point.x <= 29.2 && point.y >= .8 && point.y <= 21.2) { travelIntent = null; navigate(point.x, point.y); }
    else toast('The snacks are inside.', 'Click a room to walk there, or use WASD.');
  });
  window.addEventListener('keydown', event => {
    if (state.conversation && event.repeat && event.target.closest('#mobile-grab') && [' ', 'Enter'].includes(event.key)) { event.preventDefault(); return; }
    if (event.target.closest('button') && [' ', 'Enter'].includes(event.key)) return;
    const key = event.key.toLowerCase();
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(key)) event.preventDefault();
    if (dialog.open) return;
    if (state.won && state.ending) {
      if (!event.repeat && key === 'p') toggleEndingPause();
      if (!event.repeat && key === 'escape' && state.ending.active) completeEnding();
      return;
    }
    if (state.failed || state.won) { if (key === 'p') openPause(); return; }
    if (key === 'shift') keys.add('shift');
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) { keys.add(key); path = []; autoCollect = null; travelIntent = null; begin(); }
    if (!event.repeat && (key === 'e' || key === ' ')) interact();
    if (!event.repeat && key === 'p') openPause();
    if (!event.repeat && key === 'm') openMap();
    if (!event.repeat && key === 'h') hint();
    if (!event.repeat && key === 'r') headHome();
    if (!event.repeat && key === 't') headForStairs();
    if (!event.repeat && key === 'g') headForWing();
    if (!event.repeat && key === 'v') toggleOverview();
    if (!event.repeat && ['=', '+'].includes(key)) zoomCamera(1.2);
    if (!event.repeat && key === '-') zoomCamera(1 / 1.2);
  });
  window.addEventListener('keyup', event => keys.delete(event.key.toLowerCase()));
  window.addEventListener('blur', () => { keys.clear(); if (state.started && !state.paused && !state.won) openPause(); });
  document.addEventListener('visibilitychange', () => {
    renderDirty = true; lastFrame = performance.now();
    if (document.hidden) { stopChatter(); stopChimes(); if (state.ending) stopTV(); if (state.started && !state.paused && !state.won) openPause(); }
    else if (state.ending?.tvOn && !state.ending.paused && !dialog.open) playTV();
    syncMusic();
  });

  function openDialog(html) {
    stopChatter(); stopChimes();
    state.paused = true; state.player.moving = false; state.nearbySnack = null; keys.clear();
    renderDirty = true;
    $('dialog-close').hidden = false;
    $('dialog-content').innerHTML = html;
    if (!dialog.open) dialog.showModal();
    syncMusic();
  }
  function closeDialog() { if (state.failed) return; dialog.close(); state.paused = state.won; lastFrame = performance.now(); renderDirty = true; keys.clear(); if (state.ending?.tvOn && !state.ending.paused && !document.hidden) playTV(); speakConversation(); syncMusic(); canvas.focus({ preventScroll: true }); }
  dialog.addEventListener('cancel', event => { event.preventDefault(); closeDialog(); });
  $('dialog-close').addEventListener('click', closeDialog);
  dialog.addEventListener('click', event => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'resume') closeDialog();
    if (action === 'restart') restart();
    if (action === 'help') openHelp();
    if (action === 'sound') { $('sound-button').click(); event.target.closest('[data-action]').textContent = `Turn sound ${sound ? 'off' : 'on'}`; }
  });
  function openPause() {
    if (state.failed) return;
    if (state.won) { if (state.ending?.active) toggleEndingPause(); else showBankedResult(state.ending?.isBest || false); return; }
    openDialog(`<span class="dialog-icon">☾</span><span class="dialog-eyebrow">A LITTLE BREATHER</span><h2 id="dialog-title" class="dialog-title">Snack break?</h2><p class="dialog-copy">Energy drain is paused. Keep searching for a bigger haul, or head to the Midnight Wing’s TV snug to bank this run.</p><div class="win-stats"><div><strong>${state.bag.length}</strong><small>UNBANKED MUNCHIES</small></div><div><strong>${timeLabel(state.elapsed)}</strong><small>RUN TIME</small></div></div><p class="dialog-copy">Best banked haul: ${best ? String(best) : 'your first feast awaits'}</p><button class="primary-button" data-action="resume">Back to the mansion →</button><button class="secondary-button" data-action="help">Controls & how to play</button><button class="secondary-button" data-action="sound">Turn sound ${sound ? 'off' : 'on'}</button><button class="secondary-button" data-action="restart">Start a fresh run</button>`);
  }
  function stopTV(reset = false) {
    tvVideo.pause();
    if (reset) { try { tvVideo.currentTime = 0; } catch { /* Metadata may still be loading. */ } renderer.setTVVideo(null); }
  }
  function playTV() {
    const ending = state.ending;
    if (!ending?.tvOn || ending.paused || document.hidden || dialog.open) return;
    tvVideo.muted = true; tvVideo.loop = true; tvVideo.playsInline = true;
    renderer.setTVVideo(tvVideo);
    try {
      const playback = tvVideo.play();
      if (playback?.then) playback.then(() => { if (state.ending === ending) { $('tv-retry').hidden = true; renderDirty = true; } }).catch(() => { if (state.ending === ending && !ending.paused && !dialog.open && !document.hidden) { $('tv-retry').hidden = false; renderDirty = true; } });
    } catch { if (state.ending === ending) $('tv-retry').hidden = false; }
  }
  function updateEndingCaption() {
    const ending = state.ending;
    if (!ending) return;
    const title = ending.elapsed < 1.3 ? 'Home, at last.' : ending.elapsed < 2.3 ? 'Make yourself comfortable.' : ending.elapsed < 5.5 ? 'The good life, on demand.' : ending.elapsed < 8 ? 'Just one more bite.' : 'Haul secured. Feet up.';
    setText('ending-caption', title);
    setText('ending-copy', ending.active ? ending.elapsed < 2.3 ? 'A couch. A TV. A very well-earned snack.' : 'Munchies. Movie night. Zero conversations.' : `${state.bankedCount} munchie${state.bankedCount === 1 ? '' : 's'} banked. Enjoy the couch & TV.`);
  }
  function toggleEndingPause() {
    if (!state.ending || dialog.open) return;
    state.ending.paused = !state.ending.paused;
    setText('ending-pause', state.ending.paused ? 'Resume' : 'Pause');
    setAttribute($('ending-pause'), 'aria-label', state.ending.paused ? 'Resume ending scene' : 'Pause ending scene');
    if (state.ending.paused) stopTV(); else if (state.ending.tvOn) playTV();
    syncMusic();
    lastFrame = performance.now(); renderDirty = true;
  }
  function completeEnding() {
    const ending = state.ending;
    if (!ending || !ending.active) return false;
    Object.assign(ending, { elapsed: ending.duration, active: false, seated: true, tvOn: true, paused: false });
    renderer.setTVVideo(tvVideo); stopTV();
    setText('skip-ending', 'View haul'); setText('ending-pause', 'Pause'); $('ending-restart').hidden = false;
    setAttribute(canvas, 'aria-label', 'Haul banked. You are sitting on the TV snug couch, eating munchies and watching Munchie TV. Press P to pause, or use View haul and Another run.');
    updateEndingCaption(); renderDirty = true;
    showBankedResult(ending.isBest);
    return true;
  }
  function openHelp() {
    openDialog(`<span class="dialog-icon">✦</span><span class="dialog-eyebrow">WELCOME TO HIGH AND SEEK</span><h2 id="dialog-title" class="dialog-title">One more munchie?</h2><p class="dialog-copy">Start downstairs and gather munchies on your way through Snack &amp; Paws and upstairs to the Midnight Wing. Its laundry, wardrobe, attic and moonlit terrace are optional snack detours. Follow the central hallway to the private TV snug doorway. Stand beside the couch & TV and press E to bank your haul. Room supplies are a mystery.</p><p class="dialog-copy">G walks to the ground-floor Snack &amp; Paws wing doorway; E goes through. Nico starts snacking after you first enter his den. Listen for his crunches and look for the Mmm thought bubble; he eats real munchies before you can grab them. Call Waffles the corgi with E, then guide him to his bowl in the far corner of the pet kitchen. He gets distracted: come back and press E nearby to coax him onward. A one-use squeaky break gives him up to 25 energy. His meter drains until dinner; at zero he naps and E gently wakes him. Once fed, he follows you to the TV snug and curls up beside you. Helping him is optional and does not spend your haul.</p><p class="dialog-copy">Collected snacks stay in your bag. You automatically eat one only when its entire 16–29 energy refill fits, so nothing is wasted. If several fit, the biggest refill goes first. Eaten snacks leave your bag; only the uneaten munchies you bring back count toward your haul. Upstairs guests spot you and chase you around the furniture. Keep your distance to grab the food. Everyone has their own very long story, and they pick up where you interrupted them next time. Get caught and they can talk for 16 seconds while energy drains. Each E or Space tap advances the dialogue immediately and counts toward escaping. Twelve taps free you for 4 energy. Holding a key does not count. You get six seconds to get away after a chat.</p><p class="dialog-copy">Don't wake the house in the Midnight Wing. Sprinting, bumping furniture, rummaging for snacks, creaky attic boards and loose terrace bottles build noise. Walking quietly lets it settle; spinning washers, soft wardrobe rugs and terrace wind help. At high noise, Mara wakes up and investigates the last sound. Break her sightline and slip away. If she catches you, you must listen for six seconds: E and Space cannot skip her lecture, and time and energy keep draining. You then get a chance to escape. The entire TV snug is safe, and fed Waffles stays quiet.</p><div class="dialog-controls"><div><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd><span>Move · arrow keys work too</span></div><div><kbd>E</kbd> or <kbd>Space</kbd><span>Grab / use stairs / mash to escape / bank haul</span></div><div><kbd>T</kbd><span>Walk to stairs · press E there</span></div><div><kbd>G</kbd><span>Wing doorway · press E there</span></div><div><kbd>R</kbd><span>Head to couch · E at each connection</span></div><div><kbd>Click</kbd><span>Walk to a spot or collect a snack</span></div><div><kbd>Scroll</kbd> or <kbd>+</kbd><kbd>−</kbd><span>Zoom the camera</span></div><div><kbd>V</kbd><span>Whole floor / follow camera</span></div><div><kbd>Shift</kbd><span>Sprint · burns more energy</span></div><div><kbd>H</kbd><span>Use one of two hints</span></div><div><kbd>M</kbd><span>Map · HOME marks the final TV snug</span></div><div><kbd>P</kbd><span>Pause and take a breather</span></div></div><p class="dialog-copy">On your phone? Tap to walk. The action button changes between GRAB, DOOR, STAIRS, CALL, WAKE, PLAY, MASH and CHILL. Save energy for the trip home; running out loses your unbanked haul. Your best banked haul saves on this device.</p><button class="primary-button" data-action="resume">Let’s get snackin’ →</button>`);
  }
  function openMap() {
    const roomIcons = { library: '📚', kitchen: '🍳', arcade: '🎮', lounge: '🛋️', foyer: '🏛️', conservatory: '🌿', cinema: '🎬', pantry: '🍪', party: '🎉', suite: '🛏️', upperLanding: '↟', studio: '🎨', snackerDen: '😋', corgiPlayroom: '🐾', petKitchen: '🥣', laundry: '🧺', wardrobe: '👕', attic: '📦', terrace: '☾', snug: '🛋️' };
    const floorMaps = world.floors.map(floor => `<h3 class="map-floor-title">${floor.name}${floor.id === state.level ? ' · YOU ARE HERE' : ''}</h3><div class="map-grid">${floor.rooms.map(room => `<div class="map-room ${state.activeRoom === room.id ? 'active' : ''} ${room.id === world.home.room ? 'home-room' : ''}"><span>${roomIcons[room.id] || '✦'}</span><strong>${room.shortName}</strong><small>${room.id === world.home.room ? '⌂ HOME · couch & TV' : state.visited.has(room.id) ? 'explored' : 'unexplored'}</small></div>`).join('')}</div>`).join('');
    openDialog(`<span class="dialog-eyebrow">YOUR RIDICULOUSLY LARGE HOME</span><h2 id="dialog-title" class="dialog-title">The lay of the land.</h2><p class="dialog-copy">The final TV snug is marked HOME. From downstairs, enter Snack &amp; Paws and take the stairs in Waffles’s clubhouse to the upstairs rooms. The upstairs doorway leads to the Midnight Wing. Follow its hallway to the couch, with laundry, wardrobe, attic and terrace detours if you want more snacks. R guides you toward the couch; press E at each doorway or staircase. The map shows exploration, never food supplies.</p>${floorMaps}<button class="primary-button" data-action="resume">Back to exploring →</button>`);
  }
  function hint() {
    if (!state.hints || state.won || state.failed || state.paused || state.conversation) return;
    const remaining = world.snacks.filter(snack => snack.level === state.level && !unavailableSnacks.has(snack.id) && snack.id !== state.hintTarget);
    const snack = remaining.sort((a, b) => Math.hypot(a.x - state.player.x, a.y - state.player.y) - Math.hypot(b.x - state.player.x, b.y - state.player.y))[0] || world.snacks.find(snack => snack.level === state.level && !unavailableSnacks.has(snack.id));
    if (!snack) { toast('The couch is calling.', 'Bring your haul home to bank this run.', '⌂'); return; }
    state.hints--; state.hintTarget = snack.id;
    state.discovered.add(snack.id);
    $('hint-count').textContent = state.hints;
    $('hint-description').textContent = `${world.rooms.find(room => room.id === snack.room).name}: ${snack.clue}`;
    $('hint-button').disabled = state.hints === 0;
    toast(`A craving in ${world.rooms.find(room => room.id === snack.room).shortName.toLowerCase()}…`, snack.clue, snack.icon, 8500);
  }
  function exhaust() {
    if (state.failed || state.won) return;
    stopChatter();
    state.energy = 0; state.failed = true; state.sprinting = false; state.player.moving = false;
    syncMusic();
    state.conversation = null; setText('conversation-status', '');
    path = []; autoCollect = null; travelIntent = null; keys.clear(); state.nearbySnack = null; state.destination = null;
    updateEnergyUI();
    openDialog(`<span class="dialog-icon">ϟ</span><span class="dialog-eyebrow">THE MUNCHIES WON THIS ROUND</span><h2 id="dialog-title" class="dialog-title">So close to the couch.</h2><p class="dialog-copy">Your energy hit zero before you banked your haul. Your bag had ${state.bag.length} uneaten munchie${state.bag.length === 1 ? '' : 's'} left. None were banked. Next time, save some energy for the final stretch to the couch.</p>${resultStats()}<p class="dialog-copy">Your best banked haul stays safe. A fresh run restores full energy and shuffles the mansion’s munchies.</p><button class="primary-button" data-action="restart">Refuel & try again ↻</button>`);
    $('dialog-close').hidden = true;
    $('dialog-content').querySelector('[data-action="restart"]').focus();
  }
  function resultStats() {
    const carried = state.won ? state.bankedCount : 0;
    return `<div class="win-stats result-stats" role="group" aria-label="Run results"><div><strong>${state.found.size}</strong><small>TOTAL COLLECTED</small></div><div><strong>${carried}</strong><small>CARRIED TO COUCH</small></div><div><strong>${carried}</strong><small>SCORE</small></div><div><strong>${timeLabel(state.elapsed)}</strong><small>RUN TIME</small></div></div>`;
  }
  function showBankedResult(isBest) {
    stopTV();
    openDialog(`<span class="dialog-icon">🛋️</span><span class="dialog-eyebrow">${isBest ? 'A NEW PERSONAL BEST HAUL' : 'BACK TO THE GOOD LIFE'}</span><h2 id="dialog-title" class="dialog-title">Haul secured.</h2><p class="dialog-copy">Back on the couch. TV on. You brought home ${state.bankedCount} uneaten munchie${state.bankedCount === 1 ? '' : 's'}, and every one counts.</p>${resultStats()}<p class="dialog-copy">Best score: ${best}. One point for every munchie carried to the couch. Fancy risking one more room next time?</p><button class="primary-button" data-action="restart">Another munchie run? ↻</button><button class="secondary-button" data-action="resume">Enjoy the couch & TV</button>`);
  }
  function finishRun() {
    if (!canFinishRun()) return false;
    stopChatter();
    state.bankedCount = state.bag.length;
    state.won = true; state.paused = true; state.player.moving = false; state.sprinting = false; state.conversation = null; state.nearbySnack = null; state.destination = null; path = []; autoCollect = null; travelIntent = null; keys.clear();
    const isBest = state.bankedCount > best || state.bankedCount === best && state.elapsed < bestRunTime;
    if (isBest) { best = state.bankedCount; bestRunTime = state.elapsed; try { localStorage.setItem('high-and-seek-best-haul-v2', JSON.stringify({ score: best, elapsed: bestRunTime })); } catch { /* Optional device record. */ } $('best-time').textContent = String(best); }
    updateHaul();
    updateEnergyUI();
    chime(true);
    state.ending = { elapsed: 0, duration: 9, active: true, tvOn: false, seated: false, paused: false, isBest };
    stopTV(true); renderer.setTVVideo(tvVideo);
    $('game-stage').classList.add('ending-scene'); $('game-hud').inert = true; setAttribute($('game-hud'), 'aria-hidden', 'true'); $('ending-overlay').hidden = false; $('tv-retry').hidden = true; $('ending-restart').hidden = true;
    setAttribute(canvas, 'aria-label', 'Ending scene. You settle onto the couch, eat your collected munchies and turn on Munchie TV. Your haul is banked. Press P to pause or Escape to skip.');
    setText('skip-ending', 'Skip scene'); setText('ending-pause', 'Pause'); setAttribute($('ending-pause'), 'aria-label', 'Pause ending scene');
    clearTimeout(toastTimeout); $('toast').classList.add('fade'); setText('conversation-status', '');
    updateEndingCaption(); lastFrame = performance.now(); renderDirty = true;
    syncMusic();
    $('skip-ending').focus({ preventScroll: true });
    return true;
  }
  function restart() {
    stopChatter();
    stopTV(true); state.ending = null; $('game-stage').classList.remove('ending-scene'); $('game-hud').inert = false; setAttribute($('game-hud'), 'aria-hidden', 'false'); $('ending-overlay').hidden = true; $('tv-retry').hidden = true;
    setAttribute(canvas, 'aria-label', gameWorldLabel);
    if (dialog.open) dialog.close();
    world.activateFloor(0); world.shuffleSnacks();
    wingSimulation.reset(); state.wing = wingSimulation.getState(); state.nearDoor = false; state.nearDog = false; state.nearToy = false;
    stealthSimulation.reset(); state.stealth = stealthSimulation.getState();
    Object.assign(state, { level: 0, player: { ...world.start, level: 0, facing: 1, moving: false }, guests: createGuests(), conversation: null, ending: null, talkCooldown: 0, stairsCooldown: 0, nearStairs: false, found: new Set(), bag: [], consumedCount: 0, bankedCount: 0, discovered: new Set(), haulCounts: {}, leftHome: false, nearHome: false, homeAvailable: false, hintTarget: null, activeRoom: startRoom, paused: false, started: false, elapsed: 0, hints: rules.hints, visited: new Set(startRoom ? [startRoom] : []), won: false, failed: false, energy: rules.startEnergy, sprinting: false, warnedLow: false, refillFlash: 0, refillAmount: 0 });
    path = []; autoCollect = null; travelIntent = null; keys.clear(); guestBrain.reset();
    renderDirty = true; lastFrame = performance.now();
    state.nearbySnack = null; state.destination = null; announcedRoom = ''; renderer.resetView(); renderer.setFloor(state.player); rebuildNavigation(); renderFloorMap(); setText('conversation-status', '');
    $('overview-button').setAttribute('aria-pressed', 'false');
    $('overview-button').setAttribute('aria-label', 'Show whole mansion');
    updateHaul(); $('hint-count').textContent = String(rules.hints); $('hint-button').disabled = false; $('hint-description').textContent = 'Two hints. Make them count.'; $('timer').textContent = '00:00';
    $('dialog-close').hidden = false;
    discoverSnacks(); updateEnergyUI(); announceRoom(world.getRoom(state.player.x, state.player.y)); updateMap();
    syncMusic();
    toast('A fresh midnight snack run.', 'Gather munchies, head upstairs through Waffles’s clubhouse, then follow the Midnight hallway to your couch.', '☾'); canvas.focus({ preventScroll: true });
  }
  $('how-button').addEventListener('click', openHelp); $('pause-button').addEventListener('click', openPause); $('map-button').addEventListener('click', openMap); $('hint-button').addEventListener('click', hint); $('restart-button').addEventListener('click', restart); $('mobile-grab').addEventListener('click', interact); $('home-button').addEventListener('click', headHome);
  $('stairs-button').addEventListener('click', headForStairs);
  $('wing-button').addEventListener('click', headForWing);
  $('skip-ending').addEventListener('click', () => { if (state.ending?.active) completeEnding(); else if (state.won) showBankedResult(state.ending?.isBest || false); });
  $('ending-pause').addEventListener('click', toggleEndingPause);
  $('ending-restart').addEventListener('click', restart);
  $('tv-retry').addEventListener('click', () => { if (state.ending?.paused) toggleEndingPause(); playTV(); });
  $('sound-button').addEventListener('click', () => {
    sound = !sound;
    if (sound && !audio) { const Context = window.AudioContext || window.webkitAudioContext; try { if (Context) audio = new Context(); else sound = false; } catch { sound = false; } }
    chatter.setContext(audio || null); chatter.setEnabled(sound);
    munching.setContext(audio || null); munching.setEnabled(sound);
    music.setContext(audio || null); music.setEnabled(sound); syncMusic();
    if (sound && audio?.state === 'suspended') { try { Promise.resolve(audio.resume()).then(() => syncMusic()).catch(() => {}); } catch { /* Sound remains optional if the browser blocks it. */ } }
    if (!sound) { stopChatter(); stopChimes(); }
    $('sound-button').setAttribute('aria-pressed', String(sound)); $('sound-button').querySelector('span').textContent = sound ? 'Sound on' : 'Sound off';
    $('sound-button').dataset.tip = sound ? 'Sound on' : 'Sound off';
    $('sound-button').querySelector('svg').innerHTML = `<path d="M11 5 6 9H3v6h3l5 4V5Z${sound ? 'm5 3c4 2 4 6 0 8m3-11c6 4 6 10 0 14' : 'm5 4 5 6m0-6-5 6'}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`;
    chime();
    if (sound) speakConversation();
  });
  window.addEventListener('pagehide', event => { stopChatter(); stopChimes(); music.stop(); if (!event.persisted) { chatter.dispose(); munching.dispose(); music.dispose(); } stopTV(); });
  window.addEventListener('pageshow', () => syncMusic());
  function zoomCamera(factor) { renderer.zoomBy(factor); renderDirty = true; $('overview-button').setAttribute('aria-pressed', 'false'); $('overview-button').setAttribute('aria-label', 'Show whole mansion'); }
  function toggleOverview() { const overview = renderer.toggleOverview(); renderDirty = true; $('overview-button').setAttribute('aria-pressed', String(overview)); $('overview-button').setAttribute('aria-label', overview ? 'Follow your character' : 'Show whole mansion'); }
  $('zoom-in').addEventListener('click', () => zoomCamera(1.2));
  $('zoom-out').addEventListener('click', () => zoomCamera(1 / 1.2));
  $('overview-button').addEventListener('click', toggleOverview);
  canvas.addEventListener('wheel', event => { event.preventDefault(); if (!state.ending) zoomCamera(Math.exp(-event.deltaY * .0015)); }, { passive: false });
  $('fullscreen-button').addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
      else toast('You’re already surrounded.', 'This browser does not support fullscreen. The world still fills the window.');
    } catch { toast('Fullscreen is unavailable.', 'The mansion still fills your browser window.'); }
  });
  document.addEventListener('fullscreenchange', () => {
    $('fullscreen-button').setAttribute('aria-label', document.fullscreenElement ? 'Exit fullscreen' : 'Enter fullscreen'); renderer.resize(); renderDirty = true;
  });
  document.querySelectorAll('[data-dir]').forEach(button => {
    const mapping = { up: 'w', down: 's', left: 'a', right: 'd' };
    button.addEventListener('pointerdown', event => { if (state.paused) return; event.preventDefault(); button.setPointerCapture(event.pointerId); keys.add(mapping[button.dataset.dir]); path = []; autoCollect = null; travelIntent = null; begin(); });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(type, () => keys.delete(mapping[button.dataset.dir]));
  });
  new ResizeObserver(() => { renderer.resize(); renderDirty = true; }).observe(canvas);
  renderer.resize();
  function frame(now) {
    // Keep one rAF chain. Higher-refresh displays skip work, not elapsed time.
    requestAnimationFrame(frame);
    syncMusic(false, now);
    if (document.hidden) { lastFrame = now; renderDirty = true; return; }
    const endingAnimating = state.ending && !state.ending.paused && (state.ending.active || !dialog.open);
    if (state.paused && !renderDirty && !endingAnimating) { lastFrame = now; return; }
    const interval = state.ending && !state.ending.active ? IDLE_INTERVAL : state.started ? FRAME_INTERVAL : IDLE_INTERVAL;
    if (lastTick !== null) {
      const sinceTick = now - lastTick;
      if (sinceTick + FRAME_EPSILON < interval) return;
      lastTick += Math.floor((sinceTick + FRAME_EPSILON) / interval) * interval;
    } else lastTick = now;
    const realDelta = Math.max(0, (now - lastFrame) / 1000), dt = Math.min(realDelta, 1); lastFrame = now;
    if (state.ending?.active && !state.ending.paused) {
      const ending = state.ending;
      ending.elapsed = Math.min(ending.duration, ending.elapsed + realDelta);
      ending.seated = ending.elapsed >= 1.3;
      if (ending.elapsed >= 2 && !ending.tvOn) { ending.tvOn = true; playTV(); }
      updateEndingCaption();
      if (ending.elapsed >= ending.duration - .000001) completeEnding();
    }
    if (state.started && !state.paused && !state.won && !state.failed) {
      state.elapsed += realDelta;
      state.talkCooldown = Math.max(0, state.talkCooldown - realDelta);
      state.stairsCooldown = Math.max(0, state.stairsCooldown - realDelta);
      updateGuests(dt);
      const wasTalking = Boolean(state.conversation);
      if (state.conversation) {
        const speakingTime = Math.min(realDelta, state.conversation.remaining);
        state.conversation.remaining = Math.max(0, state.conversation.remaining - realDelta);
        if (state.conversation.remaining <= .000001) endConversation();
        else advanceMonologue(state.conversation, speakingTime);
      }
      checkConversation();
      const canMove = !wasTalking && !state.conversation;
      let dx = Number(keys.has('d') || keys.has('arrowright')) - Number(keys.has('a') || keys.has('arrowleft'));
      let dy = Number(keys.has('s') || keys.has('arrowdown')) - Number(keys.has('w') || keys.has('arrowup'));
      state.player.moving = canMove && !!(dx || dy || path.length);
      state.sprinting = state.player.moving && keys.has('shift');
      spendEnergy(rules.idleDrain * realDelta);
      const speedMultiplier = state.sprinting ? rules.sprintMultiplier : 1;
      const distanceCost = rules.distanceDrain * (state.sprinting ? rules.sprintDrainMultiplier : 1);
      let distanceMoved = 0;
      if (state.energy <= 0) exhaust();
      else if (canMove && (dx || dy)) {
        const length = Math.hypot(dx, dy); dx /= length; dy /= length;
        const budget = Math.min(dt * 4.7 * speedMultiplier, state.energy / distanceCost);
        distanceMoved += move((dx + dy) / Math.SQRT2 * budget, (dy - dx) / Math.SQRT2 * budget);
      } else if (canMove && path.length) {
        let budget = Math.min(dt * 5.8 * speedMultiplier, state.energy / distanceCost);
        while (path.length && budget > .0001 && !state.conversation) {
          const target = path[0], vx = target.x - state.player.x, vy = target.y - state.player.y, distance = Math.hypot(vx, vy), stride = Math.min(budget, distance);
          if (distance < .015) { path.shift(); continue; }
          const before = { ...state.player }; distanceMoved += move(vx / distance * stride, vy / distance * stride); budget -= stride;
          if (Math.hypot(target.x - state.player.x, target.y - state.player.y) < .015) path.shift();
          if (state.conversation) break;
          if (Math.hypot(state.player.x - before.x, state.player.y - before.y) < .0001) { path = []; autoCollect = null; toast('Mind the furniture.', 'Try approaching from a different side.'); break; }
        }
      }
      spendEnergy(distanceMoved * distanceCost);
      if (state.energy <= 0) exhaust();
      if (!state.failed) {
        wingSimulation.update(realDelta, state); handleWingEvents();
        stealthSimulation.update(realDelta, state, { distance: distanceMoved, sprinting: state.sprinting }); handleStealthEvents();
      }
      discoverSnacks();
      if (!state.failed && !state.conversation && autoCollect && !unavailableSnacks.has(autoCollect.id) && autoCollect.level === state.level && state.discovered.has(autoCollect.id) && Math.hypot(autoCollect.x - state.player.x, autoCollect.y - state.player.y) <= world.collectionRadius) { const snack = autoCollect; path = []; collect(snack); }
      const room = world.getRoom(state.player.x, state.player.y); state.activeRoom = room?.id || null;
      if (state.level !== world.start.level || room?.id !== startRoom) state.leftHome = true;
      if (room) state.visited.add(room.id);
      announceRoom(room);
    } else { state.player.moving = false; state.sprinting = false; }
    state.nearHome = world.isHome(state.player.x, state.player.y);
    state.homeAvailable = state.leftHome && state.bag.length > 0;
    state.nearStairs = canUseStairs();
    state.nearDoor = canUseDoor(); state.nearDog = canCallDog(); state.nearToy = canPlayToy();
    state.nearbySnack = !state.paused && !state.won && !state.failed && !state.conversation ? nearest() : null;
    const atCouch = canFinishRun(), promptHidden = !state.conversation && !state.nearDog && !state.nearToy && !state.nearbySnack && !state.nearDoor && !state.nearStairs && !atCouch;
    if (promptNode.hidden !== promptHidden) promptNode.hidden = promptHidden;
    if (!promptHidden) { const text = state.conversation?.unskippable ? `Listen… ${Math.ceil(state.conversation.remaining)} seconds · no skipping` : state.conversation ? `Mash E to escape · ${state.conversation.escapePresses}/${state.conversation.escapeRequired}` : state.nearDog ? state.wing.dog.sleeping ? 'Wake Waffles and guide him to dinner' : ['sniffing', 'waiting'].includes(state.wing.dog.status) ? 'Coax Waffles to follow' : 'Call Waffles to follow you' : state.nearToy ? 'A squeaky break for Waffles · up to +25 energy' : state.nearbySnack ? `Grab ${state.nearbySnack.name}` : state.nearDoor ? `Enter ${currentDoor().label}` : state.nearStairs ? stairsAction() : 'End run at couch & TV'; if (promptText.textContent !== text) promptText.textContent = text; }
    const grabLabel = state.conversation?.unskippable ? 'LISTEN' : state.conversation ? 'MASH' : state.nearDog ? state.wing.dog.sleeping ? 'WAKE' : 'CALL' : state.nearToy ? 'PLAY' : state.nearbySnack ? 'GRAB' : state.nearDoor ? 'DOOR' : state.nearStairs ? 'STAIRS' : atCouch ? 'CHILL' : 'GRAB';
    if (grabButtonText.textContent !== grabLabel) grabButtonText.textContent = grabLabel;
    if (grabButton.disabled !== (grabLabel === 'LISTEN')) grabButton.disabled = grabLabel === 'LISTEN';
    setAttribute(grabButton, 'aria-label', grabLabel === 'LISTEN' ? `Listen for ${Math.ceil(state.conversation.remaining)} more seconds; this lecture cannot be skipped` : grabLabel === 'MASH' ? `Mash to escape, ${state.conversation.escapePresses} of ${state.conversation.escapeRequired} taps` : grabLabel === 'PLAY' ? 'Play with Waffles for up to 25 energy' : grabLabel === 'CALL' ? 'Coax Waffles to follow you' : grabLabel === 'WAKE' ? 'Gently wake Waffles and lead him to dinner' : grabLabel === 'DOOR' ? `Enter ${currentDoor().label}` : grabLabel === 'STAIRS' ? stairsAction() : grabLabel === 'CHILL' ? 'End run at couch and TV' : 'Grab nearby snack');
    state.destination = path.length ? path[path.length - 1] : null;
    updateEnergyUI(false, now);
    renderer.draw(state, now); renderDirty = false;
  }
  // Expose read-only snapshots for development checks without bypassing interactions.
  window.HighAndSeek = { getState: () => ({
    level: state.level, player: { x: state.player.x, y: state.player.y, level: state.player.level },
    conversation: state.conversation ? { ...state.conversation } : null, ending: state.ending ? { ...state.ending } : null,
    guests: state.guests.map(guest => ({ id: guest.id, level: guest.level, x: guest.x, y: guest.y, chasing: Boolean(guest.chasing) })),
    found: [...state.found], bag: state.bag.map(snack => ({ id: snack.id, kind: snack.kind, name: snack.name, energy: snack.energy })),
    consumedCount: state.consumedCount, bankedCount: state.bankedCount, haulCounts: { ...state.haulCounts },
    leftHome: state.leftHome, nearHome: state.nearHome, homeAvailable: state.homeAvailable, discovered: [...state.discovered],
    energy: state.energy, elapsed: state.elapsed, paused: state.paused,
    stealth: { noise: state.stealth.noise, mode: state.stealth.mode, safe: state.stealth.safe, masking: state.stealth.masking, resident: { x: state.stealth.resident.x, y: state.stealth.resident.y, status: state.stealth.resident.status, sleeping: state.stealth.resident.sleeping } },
    wing: { taskCompleted: state.wing.taskCompleted, toy: state.wing.toy ? { used: state.wing.toy.used } : null, consumed: [...state.wing.consumed], dog: { level: state.wing.dog.level, x: state.wing.dog.x, y: state.wing.dog.y, energy: state.wing.dog.energy, status: state.wing.dog.status, following: state.wing.dog.following, happy: state.wing.dog.happy, sleeping: state.wing.dog.sleeping }, eater: { x: state.wing.eater.x, y: state.wing.eater.y, status: state.wing.eater.status, activated: state.wing.eater.activated } },
    hints: state.hints, room: state.activeRoom, won: state.won, failed: state.failed
  }), worldToScreen: (x, y, z = 0) => renderer.worldToScreen(x, y, z) };
  requestAnimationFrame(frame);
})();
