import assert from 'node:assert/strict';
import { createGameHarness } from './qa-pathing.mjs';

const near = (actual, expected, message, tolerance = .001) => assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: expected ${expected}, got ${actual}`);
function advance(run, seconds, frameMs = 1000 / 60) {
  const end = run.getTime() + seconds * 1000;
  while (run.getTime() < end - 1e-7) run.stepFrame(Math.min(frameMs, end - run.getTime()));
}
function press(run, control = 'e', repeat = false) {
  if (control === 'mobile') { run.dispatch('mobile-grab', 'click'); return; }
  run.dispatch('window', 'keydown', { key: control, repeat, target: { closest: () => null }, preventDefault() {} });
  run.dispatch('window', 'keyup', { key: control });
}
function escape(run) { const required = run.qa.state.conversation.escapeRequired; for (let count = 0; run.qa.state.conversation && count < required; count++) press(run); assert.equal(run.qa.state.conversation, null, 'the required presses still end a monologue'); }
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
assert.equal(content.world.rules.conversationLineDuration, 2.4, 'monologue cadence is quicker at 2.4 game seconds');
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
console.log(`PASS: six distinct ongoing scripts, ${allLines.length} unique short lines and ${content.world.rules.conversationLineDuration}-second cadence`);

const { run, guest } = setup(), { qa, world } = run, cadence = world.rules.conversationLineDuration;
encounter(run, guest);
assert.equal(qa.state.conversation.line, guest.monologue[0]);
assert.equal(qa.state.conversation.lineIndex, 0);
assert.equal(guest.monologueCursor, 1, 'opening advances the guest to the next unread line');
const initialEnergy = qa.state.energy;
advance(run, cadence - .1);
assert.equal(qa.state.conversation.line, guest.monologue[0], 'a line stays readable for its full duration');
qa.openPause();
const paused = { line: qa.state.conversation.line, elapsed: qa.state.conversation.lineElapsed, cursor: guest.monologueCursor, energy: qa.state.energy, remaining: qa.state.conversation.remaining, presses: qa.state.conversation.escapePresses };
for (const control of ['e', ' ', 'mobile']) press(run, control);
advance(run, 12);
assert.equal(qa.state.conversation.line, paused.line, 'pause freezes the spoken line');
near(qa.state.conversation.lineElapsed, paused.elapsed, 'pause freezes the line clock');
assert.equal(guest.monologueCursor, paused.cursor, 'pause does not consume unseen dialogue');
near(qa.state.energy, paused.energy, 'pause does not charge monologue energy');
near(qa.state.conversation.remaining, paused.remaining, 'pause freezes the long-talk timer');
assert.equal(qa.state.conversation.escapePresses, paused.presses, 'paused keyboard and mobile presses do not advance mash progress');
qa.closeDialog(); advance(run, .2);
assert.equal(qa.state.conversation.line, guest.monologue[1], 'the next line arrives after resumed game time crosses the cadence');
assert.equal(qa.state.conversation.lineIndex, 1);
assert.equal(guest.monologueCursor, 2);
assert.ok(run.getNode('conversation-status').textContent.includes(guest.monologue[1]), 'accessible dialogue updates with the visible spoken line');
near(qa.state.energy, initialEnergy - world.rules.idleDrain * (cadence + .1), 'line changes keep the existing idle-energy rate');
for (let count = 0; count < 11; count++) {
  const previousIndex = qa.state.conversation.lineIndex, previousCursor = guest.monologueCursor, remainingBeforePress = qa.state.conversation.remaining;
  const control = ['e', ' ', 'mobile'][count % 3];
  press(run, control);
  assert.equal(qa.state.conversation.escapePresses, count + 1, 'mash progress continues alongside monologue progress');
  assert.equal(qa.state.conversation.lineIndex, (previousIndex + 1) % guest.monologue.length, 'each distinct E, Space or mobile press advances exactly one sentence');
  assert.equal(qa.state.conversation.line, guest.monologue[qa.state.conversation.lineIndex]);
  assert.equal(guest.monologueCursor, (previousCursor + 1) % guest.monologue.length, 'a manual advance preserves the next unread sentence');
  near(qa.state.conversation.lineElapsed, 0, 'a manual advance resets the automatic sentence clock');
  near(qa.state.conversation.remaining, remainingBeforePress, 'advancing a sentence does not extend the encounter');
  assert.ok(run.getNode('conversation-status').textContent.includes(qa.state.conversation.line), 'accessible dialogue follows each manual sentence');
  if (count === 0) {
    const manualLine = qa.state.conversation.lineIndex;
    advance(run, cadence - .1);
    const repeatState = { line: qa.state.conversation.line, cursor: guest.monologueCursor, elapsed: qa.state.conversation.lineElapsed, presses: qa.state.conversation.escapePresses };
    for (const key of ['e', ' ']) press(run, key, true);
    assert.equal(qa.state.conversation.line, repeatState.line, 'held keys never skip additional sentences');
    assert.equal(guest.monologueCursor, repeatState.cursor, 'ignored repeats preserve the next unread sentence');
    assert.equal(qa.state.conversation.escapePresses, repeatState.presses, 'ignored repeats cannot escape sooner');
    near(qa.state.conversation.lineElapsed, repeatState.elapsed, 'ignored repeats do not reset the automatic sentence clock');
    assert.equal(qa.state.conversation.lineIndex, manualLine, 'the manual sentence remains visible for a full new cadence');
    advance(run, .2);
    assert.equal(qa.state.conversation.lineIndex, (manualLine + 1) % guest.monologue.length, 'automatic progression resumes after the reset clock reaches its cadence');
  }
}
const energyBeforeLastPress = qa.state.energy, nextUnread = guest.monologueCursor;
press(run, 'mobile');
assert.equal(qa.state.conversation, null, 'the final mobile press ends the conversation');
assert.equal(guest.monologueCursor, nextUnread, 'the escape press does not consume an unseen sentence');
near(qa.state.energy, energyBeforeLastPress - 4, 'finishing the mash retains the flat four-energy escape cost');
encounter(run, guest);
assert.equal(qa.state.conversation.lineIndex, nextUnread, 'the next encounter resumes after the last displayed line');
assert.equal(qa.state.conversation.line, guest.monologue[nextUnread], 'repeat encounters continue the same story instead of replaying its opener');
escape(run);
console.log('PASS: E/Space/mobile advances one sentence per accepted press, resets the automatic clock, ignores repeats/pause, and escapes without consuming unread text');

const slow = setup('snackExpert');
encounter(slow.run, slow.guest);
const longFrame = 7.4, elapsedBeats = Math.floor(longFrame / cadence), carriedTime = longFrame - elapsedBeats * cadence;
slow.run.stepFrame(longFrame * 1000);
assert.equal(slow.run.qa.state.conversation.lineIndex, elapsedBeats, 'a long frame advances every elapsed dialogue beat');
assert.equal(slow.run.qa.state.conversation.line, slow.guest.monologue[elapsedBeats]);
near(slow.run.qa.state.conversation.lineElapsed, carriedTime, 'long-frame advancement preserves fractional cadence carry');
near(slow.run.qa.state.conversation.remaining, slow.run.world.rules.conversationDuration - longFrame, 'dialogue cadence does not replace the sixteen-second encounter timer');
slow.run.stepFrame(cadence * 1000);
assert.equal(slow.run.qa.state.conversation.lineIndex, elapsedBeats + 1, 'subsequent slow frames keep the correct sequence');
near(slow.run.qa.state.conversation.lineElapsed, carriedTime, 'subsequent slow frames retain cadence carry');
escape(slow.run);
console.log('PASS: long frames advance multiple lines without losing fractional timing');

const shownCount = Math.ceil(world.rules.conversationDuration / cadence - 1e-9);
assert.ok(shownCount >= 4, 'the shorter cadence makes at least four sentences readable before the natural endpoint');
for (const template of content.world.guests) {
  const natural = setup(template.id);
  encounter(natural.run, natural.guest);
  const shown = [natural.run.qa.state.conversation.line];
  for (let index = 1; index < shownCount; index++) {
    advance(natural.run, cadence);
    assert.equal(natural.run.qa.state.conversation.lineIndex, index, `${template.name} advances in script order during an uninterrupted encounter`);
    assert.equal(natural.run.qa.state.conversation.line, natural.guest.monologue[index]);
    shown.push(natural.run.qa.state.conversation.line);
  }
  assert.ok(new Set(shown).size >= 4, `${template.name} actually displays at least four distinct sentences`);
  const lastLineTime = world.rules.conversationDuration - (shownCount - 1) * cadence;
  advance(natural.run, lastLineTime - .05);
  assert.equal(natural.run.qa.state.conversation.line, shown.at(-1), 'the last displayed sentence remains readable until the encounter ends');
  advance(natural.run, .1);
  assert.equal(natural.run.qa.state.conversation, null, 'natural sixteen-second fallback still frees the player');
  assert.equal(natural.guest.monologueCursor, shownCount, 'the end boundary does not silently consume a sentence that was never displayed');
  encounter(natural.run, natural.guest);
  assert.equal(natural.run.qa.state.conversation.line, natural.guest.monologue[shownCount], 'natural ending resumes at the next unread sentence');
  escape(natural.run);
}
const endingFrame = setup('partyStory');
encounter(endingFrame.run, endingFrame.guest);
endingFrame.run.stepFrame(endingFrame.run.world.rules.conversationDuration * 1000);
assert.equal(endingFrame.run.qa.state.conversation, null, 'a frame spanning the timeout still releases the player');
assert.equal(endingFrame.guest.monologueCursor, 1, 'a terminal long frame never consumes intermediate sentences that were not displayed');
encounter(endingFrame.run, endingFrame.guest);
assert.equal(endingFrame.run.qa.state.conversation.lineIndex, 1, 'the first unread sentence remains available after a terminal long frame');
escape(endingFrame.run);
console.log(`PASS: all six guests display ${shownCount} distinct sentences in a full encounter, end without unread-line consumption, and resume correctly`);

// Manual advances exercise each script across several catches, including the
// wrap boundary and the unread cursor preserved by the final escape press.
for (const template of content.world.guests) {
  const looping = setup(template.id);
  const required = looping.run.world.rules.conversationEscapePresses, shown = new Set();
  let expectedCursor = 0;
  for (let encounterIndex = 0; encounterIndex < Math.ceil(template.monologue.length / required) + 1; encounterIndex++) {
    encounter(looping.run, looping.guest);
    const conversation = looping.run.qa.state.conversation;
    assert.equal(conversation.lineIndex, expectedCursor, `${template.name} resumes the next unread sentence across catches`);
    assert.equal(conversation.line, template.monologue[expectedCursor]);
    assert.ok(typeof conversation.line === 'string' && conversation.line.length > 0, 'wrapped dialogue never becomes blank or undefined');
    shown.add(conversation.lineIndex);
    const openingIndex = conversation.lineIndex;
    for (let pressIndex = 1; pressIndex < required; pressIndex++) {
      press(looping.run);
      assert.equal(conversation.lineIndex, (openingIndex + pressIndex) % template.monologue.length, `${template.name} advances in order through the wrap boundary`);
      assert.equal(conversation.line, template.monologue[conversation.lineIndex]);
      shown.add(conversation.lineIndex);
    }
    expectedCursor = looping.guest.monologueCursor;
    press(looping.run);
    assert.equal(looping.run.qa.state.conversation, null);
    assert.equal(looping.guest.monologueCursor, expectedCursor, 'the final escape press leaves the next story sentence unread');
  }
  assert.equal(shown.size, template.monologue.length, `${template.name} displays every unique sentence across repeated catches`);
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
assert.ok(performance.run.metrics.domWrites < 700, 'changing dialogue does not introduce per-frame DOM churn');
assert.ok(performance.run.metrics.queries <= 5, 'ongoing speech reuses DOM references');
const simulatedTime = performance.run.qa.state.elapsed - elapsedBeforeFrames;
assert.equal(performance.run.qa.state.conversation.lineIndex, Math.floor((simulatedTime + .000001) / cadence), 'high-refresh rendering keeps the declared game-time cadence');
near(simulatedTime, 10, 'high-refresh simulation retains elapsed time within one capped frame', 1 / 60);
near(performance.run.qa.state.energy, energyBeforeFrames - performance.run.world.rules.idleDrain * simulatedTime, 'ongoing dialogue does not add an extra energy charge');
assert.equal(performance.run.getPendingRaf(), 1, 'dialogue progression retains one animation loop');
console.log(`PASS: ongoing speech at sixty fps with ${performance.run.metrics.domWrites} DOM writes over ten seconds; energy rate unchanged`);
