import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { FakeAudioContext } from './qa-audio-harness.mjs';
import { createGameHarness } from './qa-pathing.mjs';

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
  assert.ok(debug.scheduledUntil > context.currentTime && debug.scheduledUntil - context.currentTime <= 3.1, 'each phrase finishes before the next monologue line');
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
qa.begin(); qa.changeFloor(1, world.floors[1].stair);
const guest = qa.state.guests.find(person => person.id === 'filmBuff');
Object.assign(qa.state.player, { x: guest.x, y: guest.y }); qa.state.talkCooldown = 0; qa.checkConversation();
assert.ok(qa.state.conversation);
assert.equal(createdContexts.length, 0, 'a muted conversation does not unlock audio by itself');
run.dispatch('sound-button', 'click');
await Promise.resolve(); await Promise.resolve();
assert.equal(createdContexts.length, 1, 'the sound gesture creates one shared context');
const appContext = createdContexts[0];
assert.ok(appContext.sources.some(source => source.kind === 'bufferSource'), 'enabling sound during a conversation starts guest chatter');
const speechSources = () => appContext.sources.filter(source => source.kind === 'bufferSource');
const beforeAdvance = speechSources().length;
run.stepFrame(3300); appContext.advance(3.3);
assert.ok(speechSources().length > beforeAdvance, 'the next written monologue line starts a new spoken phrase');
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
run.stepFrame(3300);
assert.equal(speechSources().length, mutedSourceCount, 'muted monologue progression does not make voices');
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
run.stepFrame(16000); appContext.advance(0);
assert.equal(qa.state.conversation, null, 'the normal long-story timeout still ends a voiced conversation');
assert.equal(appContext.pendingSources().filter(source => source.kind === 'bufferSource').length, 0, 'natural conversation completion cancels any remaining voice');
Object.assign(qa.state.player, { x: nextGuest.x, y: nextGuest.y }); qa.state.talkCooldown = 0; qa.state.energy = .01; qa.checkConversation();
assert.ok(qa.state.conversation); run.stepFrame(100); appContext.advance(0);
assert.equal(qa.state.failed, true, 'the energy-failure path remains active during a voiced conversation');
assert.equal(appContext.pendingSources().filter(source => source.kind === 'bufferSource').length, 0, 'failure silences chatter immediately');
console.log('PASS: sound gesture, monologue updates, pause/resume, hidden tabs, mute/unmute, escape and restart control real guest speech');

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
delayed.dispatch('sound-button', 'click'); delayed.qa.openPause();
deferredContext.unlock(); await Promise.resolve(); await Promise.resolve();
assert.equal(deferredContext.sources.filter(source => source.kind === 'bufferSource').length, 0, 'a late browser audio unlock cannot revive speech after pause');
delayed.qa.closeDialog(); await Promise.resolve();
assert.ok(deferredContext.sources.some(source => source.kind === 'bufferSource'), 'an explicit resume can speak after audio eventually unlocks');
delayed.dispatch('window', 'pagehide', { persisted: false }); deferredContext.advance(0);
assert.equal(deferredContext.pendingSources().length, 0, 'page teardown releases both speech and pickup chimes');
assert.equal(deferredContext.closeCalls, 0, 'speech teardown never closes the shared AudioContext');

class UnavailableContext { constructor() { throw new Error('Audio unavailable'); } }
const unavailable = createGameHarness({ audioContextFactory: UnavailableContext });
assert.doesNotThrow(() => unavailable.dispatch('sound-button', 'click'), 'unavailable browser audio leaves gameplay usable');
assert.equal(unavailable.getNode('sound-button').getAttribute('aria-pressed'), 'false', 'unsupported audio keeps the toggle honestly off');
console.log('PASS: late audio unlock cannot revive paused chatter; page teardown and unavailable audio are safe');
