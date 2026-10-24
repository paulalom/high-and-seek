import assert from 'node:assert/strict';
import { createGameHarness } from './qa-pathing.mjs';

const near = (actual, expected, message, tolerance = .001) => assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: expected ${expected}, got ${actual}`);
function advance(run, seconds, frameMs = 1000 / 60) {
  const end = run.getTime() + seconds * 1000;
  while (run.getTime() < end - 1e-7) run.stepFrame(Math.min(frameMs, end - run.getTime()));
}
function press(run) {
  run.dispatch('window', 'keydown', { key: 'e', repeat: false, target: { closest: () => null }, preventDefault() {} });
  run.dispatch('window', 'keyup', { key: 'e' });
}
function escape(run) { for (let count = 0; run.qa.state.conversation && count < 12; count++) press(run); assert.equal(run.qa.state.conversation, null, 'twelve presses still end a monologue'); }
function encounter(run, guest) {
  assert.equal(run.qa.state.conversation, null, 'fixture starts a distinct encounter');
  run.qa.state.energy = 100; // Content progression is tested independently of run balance.
  run.qa.state.talkCooldown = 0;
  Object.assign(run.qa.state.player, { x: guest.x, y: guest.y });
  assert.equal(run.qa.checkConversation(), true, `guest ${guest.id} starts speaking at close range`);
  assert.equal(run.qa.state.conversation.guestId, guest.id, 'monologue keeps the same guest identity');
  assert.equal(run.qa.state.conversation.name, guest.name, 'monologue keeps the same speaker name');
}
function setup(id = 'filmBuff') {
  const run = createGameHarness({ seed: 73 });
  run.qa.begin(); run.qa.changeFloor(1, run.world.floors[1].stair);
  return { run, guest: run.qa.state.guests.find(person => person.id === id) };
}

const content = createGameHarness();
assert.equal(content.world.rules.conversationLineDuration, 3.2, 'monologue cadence is 3.2 game seconds');
assert.equal(content.world.guests.length, 6, 'all six guests have a distinct voice');
const allLines = [];
for (const guest of content.world.guests) {
  assert.ok(Array.isArray(guest.monologue) && guest.monologue.length >= 16 && guest.monologue.length <= 20, `${guest.name} has a substantial ongoing script`);
  assert.equal(guest.line, guest.monologue[0], 'the original opener remains the beginning of the script');
  assert.ok(guest.monologue.every(line => typeof line === 'string' && line.trim() && line.length <= 110), `${guest.name} has short, readable dialogue beats`);
  allLines.push(...guest.monologue.map(line => line.trim().toLowerCase()));
}
assert.equal(new Set(allLines).size, allLines.length, 'every line is unique across all six scripts');
assert.equal(new Set(content.world.guests.map(guest => guest.monologue.join('|'))).size, 6, 'each guest has a distinct full monologue');
console.log(`PASS: six distinct ongoing scripts, ${allLines.length} unique short lines and 3.2-second cadence`);

const { run, guest } = setup(), { qa, world } = run, cadence = world.rules.conversationLineDuration;
encounter(run, guest);
assert.equal(qa.state.conversation.line, guest.monologue[0]);
assert.equal(qa.state.conversation.lineIndex, 0);
assert.equal(guest.monologueCursor, 1, 'opening advances the guest to the next unread line');
const initialEnergy = qa.state.energy;
advance(run, cadence - .1);
assert.equal(qa.state.conversation.line, guest.monologue[0], 'a line stays readable for its full duration');
qa.openPause();
const paused = { line: qa.state.conversation.line, elapsed: qa.state.conversation.lineElapsed, cursor: guest.monologueCursor, energy: qa.state.energy, remaining: qa.state.conversation.remaining };
advance(run, 12);
assert.equal(qa.state.conversation.line, paused.line, 'pause freezes the spoken line');
near(qa.state.conversation.lineElapsed, paused.elapsed, 'pause freezes the line clock');
assert.equal(guest.monologueCursor, paused.cursor, 'pause does not consume unseen dialogue');
near(qa.state.energy, paused.energy, 'pause does not charge monologue energy');
near(qa.state.conversation.remaining, paused.remaining, 'pause freezes the long-talk timer');
qa.closeDialog(); advance(run, .2);
assert.equal(qa.state.conversation.line, guest.monologue[1], 'the next line arrives after resumed game time crosses the cadence');
assert.equal(qa.state.conversation.lineIndex, 1);
assert.equal(guest.monologueCursor, 2);
assert.ok(run.getNode('conversation-status').textContent.includes(guest.monologue[1]), 'accessible dialogue updates with the visible spoken line');
near(qa.state.energy, initialEnergy - world.rules.idleDrain * (cadence + .1), 'line changes keep the existing idle-energy rate');
const lineBeforeMash = qa.state.conversation.line, cursorBeforeMash = guest.monologueCursor;
for (let count = 0; count < 11; count++) {
  press(run);
  assert.equal(qa.state.conversation.escapePresses, count + 1, 'mash progress continues alongside monologue progress');
  assert.equal(qa.state.conversation.line, lineBeforeMash, 'mashing does not rewind or replace dialogue');
  assert.equal(guest.monologueCursor, cursorBeforeMash, 'mashing consumes no extra dialogue beats');
}
const energyBeforeLastPress = qa.state.energy;
press(run);
near(qa.state.energy, energyBeforeLastPress - 4, 'finishing the mash retains the flat four-energy escape cost');
encounter(run, guest);
assert.equal(qa.state.conversation.lineIndex, 2, 'the next encounter resumes after the last displayed line');
assert.equal(qa.state.conversation.line, guest.monologue[2], 'repeat encounters continue the same story instead of replaying its opener');
escape(run);
console.log('PASS: timed lines, pause/resume, accessible text, preserved identity and mash progress; repeat catches resume the next line');

const slow = setup('snackExpert');
encounter(slow.run, slow.guest);
slow.run.stepFrame(7400);
assert.equal(slow.run.qa.state.conversation.lineIndex, 2, 'a long frame advances every elapsed dialogue beat');
assert.equal(slow.run.qa.state.conversation.line, slow.guest.monologue[2]);
near(slow.run.qa.state.conversation.lineElapsed, 1, 'long-frame advancement preserves fractional cadence carry');
near(slow.run.qa.state.conversation.remaining, 8.6, 'dialogue cadence does not replace the sixteen-second encounter timer');
slow.run.stepFrame(3200);
assert.equal(slow.run.qa.state.conversation.lineIndex, 3, 'subsequent slow frames keep the correct sequence');
near(slow.run.qa.state.conversation.lineElapsed, 1, 'subsequent slow frames retain cadence carry');
escape(slow.run);
console.log('PASS: long frames advance multiple lines without losing fractional timing');

const natural = setup('partyStory');
encounter(natural.run, natural.guest);
for (let index = 1; index <= 4; index++) {
  advance(natural.run, cadence);
  assert.equal(natural.run.qa.state.conversation.lineIndex, index, 'an uninterrupted encounter advances in script order');
  assert.equal(natural.run.qa.state.conversation.line, natural.guest.monologue[index]);
}
advance(natural.run, cadence + .02);
assert.equal(natural.run.qa.state.conversation, null, 'natural sixteen-second fallback still frees the player');
assert.equal(natural.guest.monologueCursor, 5, 'the end boundary does not silently consume a line that was never displayed');
encounter(natural.run, natural.guest);
assert.equal(natural.run.qa.state.conversation.line, natural.guest.monologue[5], 'natural ending resumes at the next unread sentence');
escape(natural.run);

// Repeated short encounters exercise every script and wrap each cursor without
// spending minutes waiting out the same already-tested line timer.
for (const template of content.world.guests) {
  const looping = setup(template.id);
  for (let index = 0; index < template.monologue.length + 3; index++) {
    encounter(looping.run, looping.guest);
    const conversation = looping.run.qa.state.conversation;
    assert.equal(conversation.lineIndex, index % template.monologue.length, `${template.name} maintains order across encounters and wrapping`);
    assert.equal(conversation.line, template.monologue[index % template.monologue.length]);
    assert.ok(typeof conversation.line === 'string' && conversation.line.length > 0, 'wrapped dialogue never becomes blank or undefined');
    escape(looping.run);
  }
  looping.run.qa.restart();
  assert.ok(looping.run.qa.state.guests.every(person => person.monologueCursor === 0), 'restart resets every guest story cursor');
  looping.run.qa.begin(); looping.run.qa.changeFloor(1, looping.run.world.floors[1].stair);
  const restartedGuest = looping.run.qa.state.guests.find(person => person.id === template.id);
  encounter(looping.run, restartedGuest);
  assert.equal(looping.run.qa.state.conversation.line, template.monologue[0], 'a new run restores the original opener');
  escape(looping.run);
}
console.log('PASS: all six monologues wrap cleanly, preserve order across many catches and reset on a fresh run');

const performance = setup('hallwayChat');
encounter(performance.run, performance.guest); performance.run.resetMetrics();
const energyBeforeFrames = performance.run.qa.state.energy;
const elapsedBeforeFrames = performance.run.qa.state.elapsed;
advance(performance.run, 10, 1000 / 240);
assert.ok(performance.run.metrics.draws <= 601 && performance.run.metrics.draws >= 597, 'ongoing speech remains capped at sixty fps on a 240Hz display');
assert.equal(performance.run.qa.state.conversation.lineIndex, 3, 'high-refresh rendering keeps the game-time cadence');
assert.ok(performance.run.metrics.domWrites < 700, 'changing dialogue does not introduce per-frame DOM churn');
assert.ok(performance.run.metrics.queries <= 5, 'ongoing speech reuses DOM references');
const simulatedTime = performance.run.qa.state.elapsed - elapsedBeforeFrames;
near(simulatedTime, 10, 'high-refresh simulation retains elapsed time within one capped frame', 1 / 60);
near(performance.run.qa.state.energy, energyBeforeFrames - performance.run.world.rules.idleDrain * simulatedTime, 'ongoing dialogue does not add an extra energy charge');
assert.equal(performance.run.getPendingRaf(), 1, 'dialogue progression retains one animation loop');
console.log(`PASS: ongoing speech at sixty fps with ${performance.run.metrics.domWrites} DOM writes over ten seconds; energy rate unchanged`);
