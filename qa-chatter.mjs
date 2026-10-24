import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { FakeAudioContext } from './qa-audio-harness.mjs';
import { createGameHarness } from './qa-pathing.mjs';

const gesture = run => run.dispatch('window', 'pointerdown', { isTrusted: true, target: { closest: () => null } });
const root = path.dirname(fileURLToPath(import.meta.url));
const sandbox = { window: {}, console };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, 'dist/chatter.js'), 'utf8'), sandbox);
const api = sandbox.window.HSChatter;
assert.equal(typeof api?.create, 'function', 'speech is a standalone audio module');
const silent = api.create();
assert.doesNotThrow(() => { silent.speak('filmBuff', 'A silent question?', 0); silent.mash(.5); silent.stop(); silent.setEnabled(true); silent.speak('filmBuff', 'Still no context.', 1); silent.dispose(); }, 'unsupported or locked audio never blocks the game');

const context = new FakeAudioContext(), voice = api.create();
voice.setContext(context);
voice.speak('filmBuff', 'A much longer question about this film?', 0);
assert.equal(context.sources.length, 0, 'guest voices start muted');
voice.setEnabled(true);
const ids = ['filmBuff', 'snackExpert', 'partyStory', 'houseGuest', 'creativeFriend', 'hallwayChat'];
const pitches = [], profiles = [];
for (const [index, id] of ids.entries()) {
  const before = context.sources.length;
  voice.speak(id, `Original rambling line number ${index}. Is that the important bit?`, index);
  const debug = voice.getDebug();
  assert.equal(debug.active, true, `${id} has an active speaking phrase`);
  assert.equal(debug.guestId, id, 'only the current speaker owns the phrase');
  assert.ok(Number.isFinite(debug.pitch) && debug.pitch > 50 && debug.pitch < 500, 'voice uses a plausible voiced fundamental');
  assert.ok(debug.scheduledUntil > context.currentTime && debug.scheduledUntil - context.currentTime <= 3.1, 'each synthesized phrase has a short, finite duration');
  assert.ok(debug.activeNodes > 0 && debug.activeNodes < 40, 'one speech graph has a bounded node count');
  pitches.push(debug.pitch); profiles.push(debug.profileId);
  const sources = context.sources.slice(before);
  assert.ok(sources.length >= 2 && sources.length <= 5, 'each voice combines a few finite sources rather than spawning unbounded syllable nodes');
  assert.ok(sources.every(source => Number.isFinite(source.started) && Number.isFinite(source.stopped) && source.stopped > source.started), 'all sources have a finite stop time');
  const filters = context.nodes.filter(node => node.kind === 'filter' && node.connections.length);
  assert.ok(filters.filter(node => node.type === 'bandpass').length >= 3, 'vowel formants shape a voice rather than a plain musical beep');
  assert.ok(sources.some(source => source.kind === 'oscillator' && ['sawtooth', 'triangle'].includes(source.type)), 'a voiced oscillator supplies speech harmonics');
  assert.ok(sources.some(source => source.kind === 'bufferSource'), 'noise supplies consonant articulation');
  assert.ok(context.sources.slice(0, before).every(source => source.stopped <= context.currentTime), 'switching speakers cancels the preceding phrase');
}
assert.equal(new Set(profiles).size, 6, 'all six guests use different voice profiles');
assert.equal(new Set(pitches).size, 6, 'all six guests have distinct pitch/timbre configurations');
for (const node of context.nodes) for (const parameter of ['frequency', 'detune', 'gain', 'Q']) {
  for (const event of node[parameter].events) {
    if ('value' in event) assert.ok(Number.isFinite(event.value), 'audio automation never schedules NaN or infinite values');
    assert.ok(Number.isFinite(event.time), 'audio automation has finite timing');
  }
}
console.log('PASS: six original formant voices, finite phrases, consonants, speaker replacement and bounded audio graphs');

const beforeMashNodes = context.nodes.length;
for (let press = 0; press < 24; press++) voice.mash(press / 24);
assert.ok(context.nodes.length - beforeMashNodes <= 40, 'mash feedback cannot allocate an unbounded stack of voices');
assert.ok(voice.getDebug().mashReactions > 0, 'mashing produces a vocal reaction');
voice.stop(); context.advance(0);
assert.equal(voice.getDebug().active, false, 'stopping cancels the active voice');
assert.equal(voice.getDebug().activeNodes, 0, 'stopping disconnects the phrase graph');
assert.equal(context.pendingSources().length, 0, 'stopping cancels both current and future sources');
voice.speak('filmBuff', 'Start another wildly unnecessary explanation.', 4);
voice.setEnabled(false); context.advance(0);
assert.equal(voice.getDebug().active, false, 'mute silences speech immediately');
assert.equal(context.pendingSources().length, 0, 'mute leaves no scheduled syllables');
voice.setEnabled(true); voice.speak('houseGuest', 'A soft couch needs a long scientific report.', 3);
context.advance(4);
assert.equal(voice.getDebug().active, false, 'a completed phrase cleans itself up without timers');
assert.equal(voice.getDebug().activeNodes, 0, 'natural completion disconnects the voice graph');
voice.speak('partyStory', 'And then the rabbit asked for the chandelier.', 9); voice.dispose(); context.advance(0);
assert.equal(context.pendingSources().length, 0, 'dispose cancels every speech source');
assert.equal(context.closeCalls, 0, 'guest speech never closes the shared game AudioContext');
console.log('PASS: mash feedback stays bounded; stop, mute, natural completion and disposal release all speech nodes');

const suspendedContext = new FakeAudioContext({ state: 'suspended' }), suspendedVoice = api.create();
suspendedVoice.setContext(suspendedContext); suspendedVoice.setEnabled(true);
assert.doesNotThrow(() => suspendedVoice.speak('creativeFriend', 'The kettle has a new business proposal.', 0));
assert.equal(suspendedContext.sources.length, 0, 'a suspended context queues no stale speech to play later');
assert.equal(suspendedContext.resumeCalls, 0, 'only the user-gesture app path resumes audio');
suspendedVoice.dispose();

const createdContexts = [];
class AppAudioContext extends FakeAudioContext { constructor() { super(); createdContexts.push(this); } }
const run = createGameHarness({ audioContextFactory: AppAudioContext }), { qa, world } = run;
assert.equal(createdContexts.length, 0, 'loading the game creates no AudioContext');
assert.equal(run.getNode('sound-button').getAttribute('aria-pressed'), 'true', 'guest sound starts enabled');
assert.equal(run.getNode('sound-button').querySelector('span').textContent, 'Sound on', 'the default sound label matches its enabled preference');
qa.begin(); qa.changeFloor(1, world.floors[1].stair);
const guest = qa.state.guests.find(person => person.id === 'filmBuff');
Object.assign(qa.state.player, { x: guest.x, y: guest.y }); qa.state.talkCooldown = 0; qa.checkConversation();
assert.ok(qa.state.conversation);
assert.equal(createdContexts.length, 0, 'a programmatically entered conversation does not unlock audio by itself');
const openingCursor = guest.monologueCursor;
run.dispatch('window', 'keydown', { isTrusted: true, key: 'e', repeat: true, target: { closest: () => null }, preventDefault() {} });
run.dispatch('window', 'pointerdown', { isTrusted: false, target: { closest: () => null } });
assert.equal(createdContexts.length, 0, 'repeated keys and untrusted pointer events do not unlock guest audio');
assert.equal(guest.monologueCursor, openingCursor, 'a repeated key does not advance the locked guest sentence');
gesture(run);
await Promise.resolve(); await Promise.resolve();
assert.equal(createdContexts.length, 1, 'the first trusted gameplay gesture creates one shared context');
const appContext = createdContexts[0];
assert.ok(appContext.sources.some(source => source.kind === 'bufferSource'), 'the first gesture starts the currently displayed guest sentence');
assert.equal(guest.monologueCursor, openingCursor, 'unlocking sound does not skip to another sentence');
const speechSources = () => appContext.sources.filter(source => source.kind === 'bufferSource');
const cadence = world.rules.conversationLineDuration;
const beforeAdvance = speechSources().length, previousPhrase = [...appContext.sources];
const openingIndex = qa.state.conversation.lineIndex;
appContext.advance(cadence - .1); run.stepFrame((cadence - .1) * 1000);
assert.equal(qa.state.conversation.lineIndex, openingIndex, 'speech and text retain the opening sentence before the declared cadence');
assert.equal(speechSources().length, beforeAdvance, 'a nearly elapsed sentence does not schedule its successor early');
appContext.advance(.2); run.stepFrame(200);
assert.equal(qa.state.conversation.lineIndex, (openingIndex + 1) % guest.monologue.length, 'the written sentence advances at the declared cadence');
assert.ok(speechSources().length > beforeAdvance, 'the next written monologue line starts a new spoken phrase');
assert.ok(previousPhrase.every(source => source.stopped <= appContext.currentTime && source.disconnections > 0), 'advancing a sentence releases all sources from the preceding phrase');
assert.ok(appContext.pendingSources().some(source => source.kind === 'bufferSource'), 'the replacement phrase remains active after the sentence change');
qa.openPause(); appContext.advance(0);
assert.equal(appContext.pendingSources().filter(source => source.kind === 'bufferSource').length, 0, 'pause cancels guest speech');
const pausedSourceCount = speechSources().length;
run.stepFrame(5000);
assert.equal(speechSources().length, pausedSourceCount, 'paused frames do not schedule new speech');
qa.closeDialog(); await Promise.resolve();
assert.ok(speechSources().length > pausedSourceCount, 'resume restores the current guest phrase');
run.document.hidden = true; run.dispatch('document', 'visibilitychange'); appContext.advance(0);
assert.equal(appContext.pendingSources().filter(source => source.kind === 'bufferSource').length, 0, 'hidden tabs cancel speech');
run.document.hidden = false; run.dispatch('document', 'visibilitychange'); qa.closeDialog(); await Promise.resolve();
run.dispatch('sound-button', 'click'); appContext.advance(0);
assert.equal(appContext.pendingSources().filter(source => source.kind === 'bufferSource').length, 0, 'the existing sound toggle mutes active chatter');
const mutedSourceCount = speechSources().length;
const mutedLineIndex = qa.state.conversation.lineIndex;
run.stepFrame((cadence + .1) * 1000);
assert.equal(speechSources().length, mutedSourceCount, 'muted monologue progression does not make voices');
assert.equal(qa.state.conversation.lineIndex, (mutedLineIndex + 1) % guest.monologue.length, 'muting preserves the faster written sentence cadence');
run.dispatch('sound-button', 'click'); await Promise.resolve();
assert.equal(createdContexts.length, 1, 'unmuting reuses the shared context');
for (let press = 0; press < 12; press++) qa.interact(); appContext.advance(0);
assert.equal(qa.state.conversation, null, 'voice effects preserve the mash-to-escape interaction');
assert.equal(appContext.pendingSources().filter(source => source.kind === 'bufferSource').length, 0, 'escaping ends the guest voice immediately');
qa.state.talkCooldown = 0; Object.assign(qa.state.player, { x: guest.x, y: guest.y }); qa.checkConversation();
assert.ok(qa.state.conversation); qa.restart(); appContext.advance(0);
assert.equal(appContext.pendingSources().filter(source => source.kind === 'bufferSource').length, 0, 'restart cancels the old guest voice');
assert.equal(appContext.closeCalls, 0, 'restart retains the shared context for later chimes');
qa.begin(); qa.changeFloor(1, world.floors[1].stair);
const nextGuest = qa.state.guests[0];
Object.assign(qa.state.player, { x: nextGuest.x, y: nextGuest.y }); qa.state.talkCooldown = 0; qa.checkConversation();
run.stepFrame(world.rules.conversationDuration * 1000); appContext.advance(0);
assert.equal(qa.state.conversation, null, 'the normal long-story timeout still ends a voiced conversation');
assert.equal(appContext.pendingSources().filter(source => source.kind === 'bufferSource').length, 0, 'natural conversation completion cancels any remaining voice');
Object.assign(qa.state.player, { x: nextGuest.x, y: nextGuest.y }); qa.state.talkCooldown = 0; qa.state.energy = .01; qa.checkConversation();
assert.ok(qa.state.conversation); run.stepFrame(100); appContext.advance(0);
assert.equal(qa.state.failed, true, 'the energy-failure path remains active during a voiced conversation');
assert.equal(appContext.pendingSources().filter(source => source.kind === 'bufferSource').length, 0, 'failure silences chatter immediately');
console.log('PASS: sound gesture, monologue updates, pause/resume, hidden tabs, mute/unmute, escape and restart control real guest speech');

let mashContext;
class MashContext extends FakeAudioContext { constructor() { super(); mashContext = this; } }
const mashRun = createGameHarness({ audioContextFactory: MashContext }), mashQA = mashRun.qa;
mashQA.begin(); mashQA.changeFloor(1, mashRun.world.floors[1].stair);
const mashGuest = mashQA.state.guests.find(person => person.id === 'houseGuest');
Object.assign(mashQA.state.player, { x: mashGuest.x, y: mashGuest.y }); mashQA.state.talkCooldown = 0;
assert.equal(mashQA.checkConversation(), true);
gesture(mashRun); await Promise.resolve(); await Promise.resolve();
// Give the opening sentence a partially elapsed timer before the first mash.
mashContext.advance(.6); mashRun.stepFrame(600);
const mashTap = (control, repeat = false) => {
  if (control === 'mobile') mashRun.dispatch('mobile-grab', 'click');
  else {
    const key = control === 'space' ? ' ' : 'e';
    mashRun.dispatch('window', 'keydown', { key, repeat, target: { closest: () => null }, preventDefault() {} });
    mashRun.dispatch('window', 'keyup', { key });
  }
};
const neededPresses = mashRun.world.rules.conversationEscapePresses;
for (let press = 1; press < neededPresses; press++) {
  const cursor = mashGuest.monologueCursor, firstSource = mashContext.sources.length;
  const previousSources = mashContext.pendingSources();
  mashTap(['e', 'space', 'mobile'][(press - 1) % 3]);
  const conversation = mashQA.state.conversation, newSources = mashContext.sources.slice(firstSource);
  assert.equal(conversation.escapePresses, press, 'each accepted control increments mash progress once');
  assert.equal(conversation.lineIndex, cursor % mashGuest.monologue.length, 'each nonfinal mash reads exactly the next sentence');
  assert.equal(conversation.line, mashGuest.monologue[conversation.lineIndex]);
  assert.equal(mashGuest.monologueCursor, (cursor + 1) % mashGuest.monologue.length, 'the new spoken sentence consumes one cursor entry');
  assert.equal(conversation.lineElapsed, 0, 'a mash gives its replacement sentence a fresh timer');
  assert.ok(mashRun.getNode('conversation-status').textContent.includes(conversation.line), 'the displayed sentence matches the replacement voice');
  assert.ok(previousSources.every(source => source.stopped <= mashContext.currentTime && source.disconnections > 0), 'each mash cancels and disconnects the preceding phrase');
  assert.ok(newSources.some(source => source.kind === 'bufferSource') && newSources.length <= 5, 'each accepted mash starts one bounded replacement voice');
  const voiced = newSources.filter(source => source.kind === 'oscillator');
  assert.ok(voiced.length > 0 && voiced.every(source => source.detune.events.some(event => event.type === 'set' && event.value > 0)), 'mash pitch feedback affects the newly created voice');

  const ignored = { cursor: mashGuest.monologueCursor, sources: mashContext.sources.length, line: conversation.line, presses: conversation.escapePresses };
  mashTap('e', true); mashTap('space', true);
  assert.deepEqual({ cursor: mashGuest.monologueCursor, sources: mashContext.sources.length, line: conversation.line, presses: conversation.escapePresses }, ignored, 'repeated keyboard events neither advance dialogue nor schedule voices');
  if (press === 4) {
    mashQA.openPause(); mashContext.advance(0);
    const pausedSources = mashContext.sources.length;
    mashTap('e'); mashTap('mobile'); mashRun.stepFrame(1000);
    assert.equal(mashContext.sources.length, pausedSources, 'paused input schedules no replacement speech');
    assert.equal(mashContext.pendingSources().length, 0, 'pause cancels the active replacement phrase');
    assert.equal(conversation.escapePresses, press); assert.equal(mashGuest.monologueCursor, ignored.cursor);
    assert.equal(conversation.line, ignored.line, 'pause preserves the last displayed mash sentence');
    mashQA.closeDialog(); await Promise.resolve();
  }
}
const finalCursor = mashGuest.monologueCursor, sourcesBeforeFinal = mashContext.sources.length, energyBeforeFinal = mashQA.state.energy;
mashTap('e'); mashContext.advance(0);
assert.equal(mashQA.state.conversation, null, 'the final accepted mash ends the encounter');
assert.equal(mashGuest.monologueCursor, finalCursor, 'escape consumes no undisplayed final sentence');
assert.equal(mashContext.sources.length, sourcesBeforeFinal, 'escape creates no unread final phrase');
assert.equal(mashContext.pendingSources().length, 0, 'escape releases every active replacement voice');
assert.ok(Math.abs(mashQA.state.energy - energyBeforeFinal + mashRun.world.rules.conversationEscapeCost) < 1e-7, 'the final press retains the existing escape cost');
mashQA.state.talkCooldown = 0; Object.assign(mashQA.state.player, { x: mashGuest.x, y: mashGuest.y });
assert.equal(mashQA.checkConversation(), true);
assert.equal(mashQA.state.conversation.lineIndex, finalCursor, 'a later encounter resumes at the next unheard sentence');
assert.equal(mashQA.state.conversation.line, mashGuest.monologue[finalCursor]);
mashRun.dispatch('window', 'pagehide', { persisted: false }); mashContext.advance(0);
assert.equal(mashContext.pendingSources().length, 0, 'teardown releases the resumed voice');
assert.equal(mashContext.closeCalls, 0, 'mash replacement never closes the shared context');
console.log('PASS: accepted E/Space/mobile mashes replace and pitch the new voice; repeat, pause, final escape and resumed cursor preserve speech ownership');

const sentenceContext = new FakeAudioContext(), sentenceVoice = api.create();
sentenceVoice.setContext(sentenceContext); sentenceVoice.setEnabled(true);
let sentenceChecks = 0, longestPhrase = 0;
for (const person of world.guests) for (const [index, line] of person.monologue.entries()) {
  const firstSource = sentenceContext.sources.length;
  sentenceVoice.speak(person.id, line, index);
  const debug = sentenceVoice.getDebug(), duration = debug.scheduledUntil - sentenceContext.currentTime;
  assert.ok(debug.active && debug.activeNodes > 0 && debug.activeNodes < 40, `${person.name} sentence ${index} uses one bounded speech graph`);
  assert.ok(duration > 0 && duration < cadence, `${person.name} sentence ${index} finishes before its written sentence changes`);
  assert.ok(sentenceContext.sources.slice(firstSource).every(source => Number.isFinite(source.stopped) && source.stopped < sentenceContext.currentTime + cadence), 'all actual sentence sources end before the next text boundary');
  longestPhrase = Math.max(longestPhrase, duration); sentenceChecks++;
  sentenceContext.advance(cadence);
  assert.equal(sentenceVoice.getDebug().activeNodes, 0, 'every sentence naturally releases its full speech graph');
  assert.equal(sentenceContext.pendingSources().length, 0, 'a completed sentence leaves no future audio sources');
}
sentenceVoice.dispose();
assert.equal(sentenceContext.closeCalls, 0, 'sentence completion never closes the shared audio context');
console.log(`PASS: all ${sentenceChecks} actual monologue phrases finish within the ${cadence}s text cadence (longest ${longestPhrase.toFixed(3)}s) and release their audio graphs`);

let deferredContext;
class DeferredContext extends FakeAudioContext {
  constructor() { super({ state: 'suspended' }); this.resolvers = []; deferredContext = this; }
  resume() { this.resumeCalls++; return new Promise(resolve => this.resolvers.push(resolve)); }
  unlock() { this.state = 'running'; for (const resolve of this.resolvers.splice(0)) resolve(); }
}
const delayed = createGameHarness({ audioContextFactory: DeferredContext });
delayed.qa.begin(); delayed.qa.changeFloor(1, delayed.world.floors[1].stair);
const delayedGuest = delayed.qa.state.guests[0];
Object.assign(delayed.qa.state.player, { x: delayedGuest.x, y: delayedGuest.y }); delayed.qa.state.talkCooldown = 0; delayed.qa.checkConversation();
gesture(delayed); delayed.qa.openPause();
deferredContext.unlock(); await Promise.resolve(); await Promise.resolve();
assert.equal(deferredContext.sources.filter(source => source.kind === 'bufferSource').length, 0, 'a late browser audio unlock cannot revive speech after pause');
delayed.qa.closeDialog(); await Promise.resolve();
assert.ok(deferredContext.sources.some(source => source.kind === 'bufferSource'), 'an explicit resume can speak after audio eventually unlocks');
delayed.dispatch('window', 'pagehide', { persisted: false }); deferredContext.advance(0);
assert.equal(deferredContext.pendingSources().length, 0, 'page teardown releases both speech and pickup chimes');
assert.equal(deferredContext.closeCalls, 0, 'speech teardown never closes the shared AudioContext');

let mutedContextCount = 0;
class NeverUnlockedContext extends FakeAudioContext { constructor() { super(); mutedContextCount++; } }
const preMuted = createGameHarness({ audioContextFactory: NeverUnlockedContext });
const muteTarget = { closest: () => preMuted.getNode('sound-button') };
preMuted.dispatch('window', 'pointerdown', { isTrusted: true, target: muteTarget });
preMuted.dispatch('window', 'click', { isTrusted: true, target: muteTarget });
preMuted.dispatch('sound-button', 'click');
assert.equal(preMuted.getNode('sound-button').getAttribute('aria-pressed'), 'false', 'the first sound-button click mutes the default preference');
assert.equal(mutedContextCount, 0, 'muting before audio unlock creates no context or speech');
preMuted.qa.begin(); preMuted.qa.changeFloor(1, preMuted.world.floors[1].stair);
const preMutedGuest = preMuted.qa.state.guests[0];
Object.assign(preMuted.qa.state.player, { x: preMutedGuest.x, y: preMutedGuest.y }); preMuted.qa.state.talkCooldown = 0; preMuted.qa.checkConversation();
gesture(preMuted);
assert.equal(mutedContextCount, 0, 'later gameplay gestures and a guest encounter honor the muted preference');

const lateMuted = createGameHarness({ audioContextFactory: DeferredContext });
lateMuted.qa.begin(); lateMuted.qa.changeFloor(1, lateMuted.world.floors[1].stair);
const lateGuest = lateMuted.qa.state.guests[0];
Object.assign(lateMuted.qa.state.player, { x: lateGuest.x, y: lateGuest.y }); lateMuted.qa.state.talkCooldown = 0; lateMuted.qa.checkConversation();
gesture(lateMuted); lateMuted.dispatch('sound-button', 'click');
deferredContext.unlock(); await Promise.resolve(); await Promise.resolve();
assert.equal(deferredContext.sources.length, 0, 'late audio resume cannot revive guest speech after mute');
assert.equal(lateMuted.getNode('sound-button').getAttribute('aria-pressed'), 'false', 'late resume preserves the user mute');
gesture(lateMuted); assert.equal(deferredContext.sources.length, 0, 'a later gesture cannot bypass mute on an unlocked context');
lateMuted.dispatch('window', 'pagehide', { persisted: false }); deferredContext.advance(0);

class UnavailableContext { constructor() { throw new Error('Audio unavailable'); } }
const unavailable = createGameHarness({ audioContextFactory: UnavailableContext });
assert.doesNotThrow(() => gesture(unavailable), 'unavailable browser audio leaves gameplay usable');
assert.equal(unavailable.getNode('sound-button').getAttribute('aria-pressed'), 'false', 'unsupported audio keeps the toggle honestly off');
console.log('PASS: mute before unlock stays silent, late resume respects pause/mute, and teardown/unavailable audio remain safe');
