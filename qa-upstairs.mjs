import assert from 'node:assert/strict';
import { createGameHarness } from './qa-pathing.mjs';

const testFrameMs = Number(process.argv[2]) || 1000 / 60;
const gameHarness = options => createGameHarness({ frameMs: testFrameMs, ...options });
const near = (actual, expected, message, tolerance = .001) => assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: expected ${expected}, got ${actual}`);
function advance(run, seconds) { for (let i = 0, count = Math.ceil(seconds * 60); i < count; i++) run.stepFrame(seconds * 1000 / count); }
function tap(run, control = 'e', repeat = false) {
  if (control === 'mobile') run.dispatch('mobile-grab', 'click');
  else {
    run.dispatch('window', 'keydown', { key: control, repeat, target: { closest: () => null }, preventDefault() {} });
    run.dispatch('window', 'keyup', { key: control });
  }
}
function mashConversation(run) {
  const required = run.qa.state.conversation?.escapeRequired || 12;
  for (let count = 0; run.qa.state.conversation && !run.qa.state.failed && count < required + 1; count++) { advance(run, .09); tap(run); }
  assert.equal(run.qa.state.conversation, null, 'distinct presses escape a conversation');
}
function walkRoute(run, label, maxSeconds = 90) {
  for (let frame = 0; run.qa.getPath().length && !run.qa.state.failed && frame < maxSeconds * 60; frame++) { run.stepFrame(); if (run.qa.state.conversation) mashConversation(run); }
  assert.equal(run.qa.state.failed, false, `${label} preserves energy`);
  assert.equal(run.qa.getPath().length, 0, `${label} completes its walking route`);
}
function goUp(run) {
  run.qa.headForStairs();
  walkRoute(run, 'walk from couch to stairs');
  assert.equal(run.qa.state.level, 0, 'walking to the stairs does not change floor');
  assert.equal(run.qa.canUseStairs(), true, 'stair approach enables an explicit interaction');
  run.qa.interact();
  assert.equal(run.qa.state.level, 1, 'E interaction enters upstairs');
  assert.equal(run.qa.state.player.level, 1, 'player and app agree on upstairs');
  assert.equal(run.world.level, 1, 'world activates upstairs collision surface');
}

const run = gameHarness({ seed: 41 }), { qa, world } = run;
assert.equal(qa.state.level, 0, 'new run starts downstairs');
assert.equal(qa.canUseStairs(), false, 'stairs cannot be used from the couch');
assert.equal(qa.useStairs(), false, 'remote floor teleport is rejected');
assert.equal(qa.state.level, 0);
const upstairs = world.snacks.find(snack => snack.level === 1);
qa.begin(); qa.state.discovered.add(upstairs.id);
const foodBefore = qa.state.found.size, energyBefore = qa.state.energy;
qa.collect(upstairs);
assert.equal(qa.state.found.size, foodBefore, 'upstairs food cannot be collected downstairs');
near(qa.state.energy, energyBefore, 'cross-floor pickup gives no energy');
assert.equal(world.canSeeSnack(upstairs, { x: upstairs.x, y: upstairs.y, level: 0 }, upstairs.id), false, 'hints do not draw upstairs food through the ground floor');
goUp(run);
assert.ok(world.isWalkable(qa.state.player.x, qa.state.player.y), 'upstairs arrival is safe');
assert.equal(qa.useStairs(), false, 'stair cooldown prevents an immediate accidental round trip');
assert.ok(qa.state.talkCooldown > 0, 'stair arrival grants a brief grace period');
const activeUpstairsIds = new Set(world.rooms.map(room => room.id));
assert.ok(world.snacks.filter(snack => snack.level === 1).every(snack => activeUpstairsIds.has(snack.room)), 'upstairs pool uses upstairs rooms');
assert.ok(world.snacks.filter(snack => snack.level === 1).length > world.snacks.filter(snack => snack.level === 0).length, 'upstairs has more food than downstairs');
console.log('PASS: separate floor activation, explicit near-stair E interaction, no remote pickup, safe arrival and stair grace');

// Runtime guests must wander, pause, and interrupt rather than becoming static
// scenery. Trigger a real encounter at a validated guest position.
assert.ok(qa.state.guests.length >= 5, 'run instantiates the talkative upstairs guests');
const initialGuests = JSON.stringify(qa.state.guests.map(guest => [guest.x, guest.y]));
advance(run, 1);
assert.notEqual(JSON.stringify(qa.state.guests.map(guest => [guest.x, guest.y])), initialGuests, 'upstairs guests wander during active play');
assert.ok(qa.state.guests.every(guest => world.isWalkable(guest.x, guest.y)), 'wandering guests stay collision-safe');
const guest = qa.state.guests[0];
Object.assign(qa.state.player, { x: guest.x, y: guest.y });
qa.state.talkCooldown = 0; qa.checkConversation();
assert.ok(qa.state.conversation, 'close same-floor guest begins a conversation');
assert.equal(qa.state.conversation.guestId, guest.id, 'encounter identifies its guest');
const startTalk = { x: qa.state.player.x, y: qa.state.player.y, energy: qa.state.energy, remaining: qa.state.conversation.remaining };
assert.equal(qa.state.conversation.duration, 16, 'small talk has a long sixteen-second fallback');
assert.equal(qa.state.conversation.escapeRequired, 12, 'escaping requires twelve deliberate presses');
assert.equal(qa.state.conversation.escapePresses, 0, 'each conversation starts with no escape progress');
qa.keys.add('d'); advance(run, .5); qa.keys.clear();
near(qa.state.player.x, startTalk.x, 'conversation blocks horizontal movement');
near(qa.state.player.y, startTalk.y, 'conversation blocks vertical movement');
near(qa.state.energy, startTalk.energy - world.rules.idleDrain * .5, 'conversation keeps draining idle energy');
assert.ok(qa.state.conversation.remaining < startTalk.remaining, 'conversation countdown advances');
qa.openPause();
const frozen = { energy: qa.state.energy, remaining: qa.state.conversation.remaining, guests: JSON.stringify(qa.state.guests.map(item => [item.x, item.y])) };
qa.interact();
assert.ok(qa.state.conversation, 'paused interaction cannot excuse a conversation');
advance(run, 3);
near(qa.state.energy, frozen.energy, 'pause freezes conversation energy');
near(qa.state.conversation.remaining, frozen.remaining, 'pause freezes talk countdown');
assert.equal(JSON.stringify(qa.state.guests.map(item => [item.x, item.y])), frozen.guests, 'pause freezes guest motion');
qa.closeDialog();
const beforeExcuse = qa.state.energy;
for (let press = 0; press < 11; press++) {
  advance(run, .09); tap(run, ['e', ' ', 'mobile'][press % 3]);
  assert.ok(qa.state.conversation, 'fewer than twelve presses do not escape');
  assert.equal(qa.state.conversation.escapePresses, press + 1, 'keyboard, Space and mobile clicks each advance escape progress once');
  if (press === 0) {
    for (let held = 0; held < 8; held++) tap(run, 'e', true);
    assert.equal(qa.state.conversation.escapePresses, 1, 'keyboard auto-repeat cannot mash out a conversation');
    for (const key of [' ', 'Enter']) {
      let prevented = false;
      run.dispatch('window', 'keydown', { key, repeat: true, target: { closest: selector => selector === '#mobile-grab' ? run.getNode('mobile-grab') : null }, preventDefault() { prevented = true; } });
      assert.equal(prevented, true, 'a held key on the focused MASH button prevents repeated native clicks');
    }
  }
}
near(qa.state.energy, beforeExcuse - world.rules.idleDrain * .99, 'incomplete mash progress costs only elapsed idle energy');
advance(run, .09); tap(run);
assert.equal(qa.state.conversation, null, 'twelfth distinct press escapes the conversation');
near(qa.state.energy, beforeExcuse - world.rules.idleDrain * 1.08 - 4, 'completed escape charges four energy once');
assert.ok(qa.state.talkCooldown >= 5.9, 'escaping grants about six seconds of global immunity');
advance(run, .5);
assert.equal(qa.state.conversation, null, 'standing near a guest cannot immediately chain another conversation');
const naturalGuest = qa.state.guests[1];
Object.assign(qa.state.player, { x: naturalGuest.x, y: naturalGuest.y });
qa.state.talkCooldown = 0; qa.checkConversation();
const duration = qa.state.conversation.duration, naturalEnergy = qa.state.energy;
advance(run, duration + .05);
assert.equal(qa.state.conversation, null, 'waiting out a conversation frees the player');
near(qa.state.energy, naturalEnergy - world.rules.idleDrain * (duration + .05), 'natural conversation pays only its elapsed idle drain', .03);
assert.ok(qa.state.talkCooldown > 5, 'natural ending also grants global immunity');
console.log('PASS: chasing guests, blocked movement, continuous energy, pause, twelve distinct E/Space/mobile presses, ignored key-repeat, flat escape cost and six-second immunity');

// This guard uses upstairs coordinates matching the home couch downstairs.
qa.state.found.add(upstairs.id); qa.state.leftHome = true;
qa.state.bag.push(upstairs); qa.state.haulCounts[upstairs.kind] = 1;
Object.assign(qa.state.player, { x: world.home.x, y: world.home.y });
assert.equal(qa.canFinishRun(), false, 'matching couch coordinates upstairs cannot finish a run');
assert.equal(qa.finishRun(), false, 'banking is restricted to the downstairs couch');
qa.restart();
assert.equal(qa.state.level, 0, 'restart returns the app downstairs');
assert.equal(qa.state.player.level, 0, 'restart returns the player downstairs');
assert.equal(world.level, 0, 'restart restores the ground collision surface');
assert.equal(qa.state.conversation, null, 'restart clears an interrupted conversation');
assert.equal(qa.state.talkCooldown, 0, 'restart clears conversation immunity');
assert.ok(qa.state.guests.every(item => world.guests.some(template => template.id === item.id && template.x === item.x && template.y === item.y)), 'restart resets guest positions from templates');
console.log('PASS: upstairs cannot bank a haul; restart resets floor, conversation and guests');

const slow = gameHarness({ frameMs: 1000 });
slow.qa.begin(); slow.qa.changeFloor(1, { x: 10, y: 1.3 });
slow.qa.state.talkCooldown = 0;
slow.qa.navigate(10, 9.5); slow.stepFrame();
assert.ok(slow.qa.state.conversation, 'one-second movement frames still detect a guest crossed along the route');
assert.ok(slow.qa.state.player.y < 5, 'guest interruption stops the avatar before it walks through the person');
const stranded = slow.qa.state.player.y;
slow.stepFrame();
near(slow.qa.state.player.y, stranded, 'slow-frame conversation continues to block movement');
for (let press = 0; press < 11; press++) { advance(slow, .09); tap(slow); }
slow.qa.state.energy = 2; advance(slow, .09); tap(slow);
assert.equal(slow.qa.state.energy, 0, 'excusing with less than four energy clamps to zero');
assert.equal(slow.qa.state.failed, true, 'an unaffordable excuse ends the unbanked run');
console.log('PASS: one-second frames cannot tunnel through a guest; an exhausted excuse fails the run');

let minimumEnergy = 100, longestRun = 0;
for (let seed = 1; seed <= 8; seed++) {
  const trip = gameHarness({ seed }), game = trip.qa, map = trip.world;
  goUp(trip);
  const candidates = map.snacks.filter(snack => snack.level === 1);
  for (let pickup = 0; pickup < 8; pickup++) {
    candidates.sort((a, b) => Math.hypot(a.x - game.state.player.x, a.y - game.state.player.y) - Math.hypot(b.x - game.state.player.x, b.y - game.state.player.y));
    const snack = candidates.shift(); game.navigate(snack.x, snack.y, snack);
    for (let frame = 0; !game.state.found.has(snack.id) && !game.state.failed && frame < 6000; frame++) {
      trip.stepFrame(); minimumEnergy = Math.min(minimumEnergy, game.state.energy);
      if (game.state.conversation) mashConversation(trip);
    }
    assert.ok(game.state.found.has(snack.id), `seed ${seed} collects eight upstairs snacks without fixture refills`);
  }
  game.headHome(); walkRoute(trip, `seed ${seed} return to upstairs stair`);
  assert.equal(game.state.level, 1, 'return button does not remotely descend');
  assert.equal(game.state.won, false, 'upstairs return action does not bank the haul');
  assert.equal(game.canUseStairs(), true, 'upstairs return route ends at usable stairs');
  game.interact();
  assert.equal(game.state.level, 0, 'explicit E descends');
  game.headHome(); walkRoute(trip, `seed ${seed} walk downstairs to couch`);
  assert.ok(map.isHome(game.state.player.x, game.state.player.y), 'second home route reaches downstairs couch');
  assert.equal(game.state.won, false, 'return journey still needs explicit banking');
  const carriedHome = game.state.bag.length;
  assert.ok(carriedHome > 0, 'return journey retains some food after automatic refueling');
  assert.equal(game.finishRun(), true, `seed ${seed} banks its upstairs haul`);
  assert.equal(game.state.found.size, 8, 'discovery history retains all eight pickups');
  assert.equal(game.state.bankedCount, carriedHome, 'score banks only food still carried home');
  assert.equal(game.state.bag.length + game.state.consumedCount, game.state.found.size, 'carried and eaten food reconcile to pickups');
  minimumEnergy = Math.min(minimumEnergy, game.state.energy); longestRun = Math.max(longestRun, game.state.elapsed);
}
console.log(`PASS: eight seeded upstairs eight-snack trips return and bank with active guests; minimum energy ${minimumEnergy.toFixed(1)}, longest ${longestRun.toFixed(1)}s`);

const tour = gameHarness({ seed: 7 }), game = tour.qa, map = tour.world;
goUp(tour);
const remaining = map.snacks.filter(snack => snack.level === 1), targetCount = remaining.length;
let encounters = 0, wasTalking = false, tourMinimum = game.state.energy;
while (remaining.length) {
  remaining.sort((a, b) => Math.hypot(a.x - game.state.player.x, a.y - game.state.player.y) - Math.hypot(b.x - game.state.player.x, b.y - game.state.player.y));
  const snack = remaining.shift(); game.navigate(snack.x, snack.y, snack);
  for (let frame = 0; !game.state.found.has(snack.id) && !game.state.failed && frame < 6000; frame++) {
    tour.stepFrame(); tourMinimum = Math.min(tourMinimum, game.state.energy);
    const talking = Boolean(game.state.conversation);
    if (talking && !wasTalking) encounters++;
    wasTalking = talking;
    if (talking) { mashConversation(tour); wasTalking = false; }
  }
  assert.ok(game.state.found.has(snack.id), `full upstairs tour collects ${snack.id} without fixture refills`);
}
game.headHome(); walkRoute(tour, 'full upstairs tour return to stairs');
assert.equal(game.canUseStairs(), true);
game.interact(); game.headHome(); walkRoute(tour, 'full upstairs tour return to couch');
assert.equal(game.finishRun(), true, 'a full upstairs tour can still reach and bank at the couch');
assert.equal(game.state.found.size, targetCount, 'full upstairs pickup history remains complete');
assert.equal(game.state.bankedCount, game.state.bag.length, 'full tour banks only unconsumed food');
assert.equal(game.state.bag.length + game.state.consumedCount, targetCount, 'tour food is either carried or eaten');
assert.ok(encounters > 0, 'a real multiroom food route encounters at least one talkative guest');
console.log(`PASS: full upstairs ${targetCount}-snack tour banks after ${encounters} natural guest encounters; minimum energy ${tourMinimum.toFixed(1)}, finish energy ${game.state.energy.toFixed(1)}, ${game.state.elapsed.toFixed(1)}s`);
