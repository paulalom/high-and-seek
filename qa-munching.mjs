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
vm.runInContext(fs.readFileSync(path.join(root, 'dist/munching.js'), 'utf8'), sandbox);
const api = sandbox.window.HSMunching;
assert.equal(typeof api?.create, 'function');
const silent = api.create();
assert.doesNotThrow(() => { silent.play(); silent.setEnabled(true); silent.play(); silent.stop(); silent.dispose(); });
const context = new FakeAudioContext(), munching = api.create();
munching.setContext(context);
assert.equal(munching.play(), false);
assert.equal(context.sources.length, 0, 'munching starts muted');
munching.setEnabled(true);
assert.equal(munching.play(), true);
const firstSources = [...context.sources], firstNodes = [...context.nodes];
assert.ok(firstSources.some(source => source.kind === 'bufferSource'), 'dry crunches use a noise recording generated in memory');
assert.ok(firstSources.some(source => source.kind === 'oscillator' && source.type === 'sawtooth'), 'a voiced nasal mmm accompanies the crunches');
assert.ok(firstSources.length >= 2 && firstSources.length <= 5);
assert.ok(firstNodes.length <= 20, 'each bite has a small finite audio graph');
assert.ok(firstSources.every(source => Number.isFinite(source.started) && Number.isFinite(source.stopped) && source.stopped - source.started <= .8 && source.stopped > source.started), 'all bite sources finish promptly');
const crunchEnvelope = firstNodes.filter(node => node.kind === 'gain').flatMap(node => node.gain.events);
assert.ok(crunchEnvelope.filter(event => event.type === 'linear' && event.value > .2).length >= 3, 'the burst contains obvious repeated chewing accents');
for (let repeat = 0; repeat < 100; repeat++) assert.equal(munching.play(), false);
assert.equal(context.sources.length, firstSources.length, 'repeated frame events cannot stack chewing sounds');
for (const node of context.nodes) for (const parameter of ['frequency', 'gain', 'Q']) for (const event of node[parameter].events) {
  assert.ok(Number.isFinite(event.time));
  if ('value' in event) assert.ok(Number.isFinite(event.value));
}
context.advance(1);
assert.equal(context.pendingSources().length, 0);
assert.ok(firstNodes.every(node => node.disconnections > 0), 'natural completion disconnects the entire graph');
munching.play();
assert.equal(context.buffers.length, 1, 'subsequent bites reuse the noise buffer');
munching.stop(); context.advance(0);
assert.equal(context.pendingSources().length, 0, 'stop cancels current and scheduled chewing');
assert.ok(context.nodes.every(node => node.disconnections > 0));
munching.play(); munching.setEnabled(false); context.advance(0);
assert.equal(context.pendingSources().length, 0, 'mute immediately cancels a bite');
const sourceCount = context.sources.length; munching.play();
assert.equal(context.sources.length, sourceCount, 'mute prevents new bite graphs');
munching.setEnabled(true); munching.play();
const replacement = new FakeAudioContext(); munching.setContext(replacement); context.advance(0);
assert.equal(context.pendingSources().length, 0, 'changing context cancels the old bite');
assert.equal(munching.play(), true); munching.dispose(); replacement.advance(0);
assert.equal(replacement.pendingSources().length, 0, 'disposal releases chewing sources');
assert.equal(munching.play(), false, 'disposed chewing cannot restart');
assert.equal(context.closeCalls + replacement.closeCalls, 0, 'the shared audio contexts remain owned by the game');
const suspended = new FakeAudioContext({ state: 'suspended' }), locked = api.create(); locked.setContext(suspended); locked.setEnabled(true);
assert.equal(locked.play(), false); assert.equal(suspended.sources.length, 0); assert.equal(suspended.resumeCalls, 0, 'only the sound gesture unlocks audio');
locked.dispose();
console.log('PASS: original crunch and mmm, bounded finite scheduling, cached noise, natural completion, stop/mute/context/disposal cleanup');

function prepareEating(run) {
  const { qa, world } = run;
  qa.begin(); qa.changeFloor(2, { x: 6, y: 4.5 });
  const snack = world.snacks.find(item => item.room === 'snackerDen');
  assert.ok(snack);
  let approach = null;
  for (let x = 1.5; x < 13; x += .5) for (let y = 1.5; y < 9; y += .5) if (world.isWalkable(x, y, .26, 2) && Math.hypot(x - snack.x, y - snack.y) <= 1.14) approach = { x, y };
  assert.ok(approach, 'a real den snack has an eating approach');
  Object.assign(qa.state.wing.eater, approach, { target: snack.id, status: 'searching', eatTimer: 0, activated: true });
}
const mutedContexts = [];
class MutedContext extends FakeAudioContext { constructor() { super(); mutedContexts.push(this); } }
const muted = createGameHarness({ audioContextFactory: MutedContext });
assert.equal(muted.getNode('sound-button').getAttribute('aria-pressed'), 'true', 'game sound begins enabled while browser audio remains locked');
muted.dispatch('sound-button', 'click');
prepareEating(muted);
for (const type of ['pointerdown', 'keydown', 'click']) muted.dispatch('window', type, { isTrusted: true, key: 'Shift', pointerType: 'touch', target: { closest: () => null }, preventDefault() {} });
for (let frame = 0; frame < 150; frame++) muted.stepFrame(20);
assert.equal(mutedContexts.length, 0, 'muting before the first gesture keeps real Nico bites and later gameplay silent');
assert.equal(muted.getNode('sound-button').getAttribute('aria-pressed'), 'false');
muted.dispatch('window', 'pagehide', { persisted: false });
for (const action of ['mute', 'pause', 'hidden', 'leave', 'restart', 'failure', 'pagehide']) {
  const contexts = [];
  class AppAudio extends FakeAudioContext { constructor() { super(); contexts.push(this); } }
  const run = createGameHarness({ audioContextFactory: AppAudio });
  assert.equal(contexts.length, 0, 'loading does not create audio');
  prepareEating(run);
  run.dispatch('window', 'pointerdown', { isTrusted: true, pointerType: 'mouse', target: { closest: () => null } });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(contexts.length, 1, 'the first gameplay gesture creates a single shared context');
  const audio = contexts[0];
  audio.advance(1);
  run.stepFrame(20); audio.advance(.02);
  assert.ok(audio.pendingSources().some(source => source.kind === 'bufferSource'), 'the actual Nico bite event plays a crunch through game sound');
  if (action === 'mute') run.dispatch('sound-button', 'click');
  if (action === 'pause') run.qa.openPause();
  if (action === 'hidden') { run.document.hidden = true; run.dispatch('document', 'visibilitychange'); }
  if (action === 'leave') run.qa.changeFloor(0, run.world.start);
  if (action === 'restart') run.qa.restart();
  if (action === 'failure') { run.qa.state.energy = .001; run.stepFrame(100); assert.equal(run.qa.state.failed, true); }
  if (action === 'pagehide') run.dispatch('window', 'pagehide', { persisted: false });
  audio.advance(0);
  assert.equal(audio.pendingSources().length, 0, `${action} cancels Nico's chewing immediately`);
  if (action === 'mute') {
    const mutedSourceCount = audio.sources.length;
    for (const type of ['pointerdown', 'keydown', 'click']) run.dispatch('window', type, { isTrusted: true, key: 'Shift', pointerType: 'touch', target: { closest: () => null }, preventDefault() {} });
    for (let frame = 0; frame < 150; frame++) { run.stepFrame(20); audio.advance(.02); }
    assert.equal(audio.sources.length, mutedSourceCount, 'later gestures and Nico bites cannot undo a mute');
    assert.equal(contexts.length, 1, 'muted gameplay never creates a replacement context');
  }
  assert.equal(audio.closeCalls, 0, `${action} retains shared context ownership`);
}
console.log('PASS: actual bite events use the sound toggle and shared context; mute, pause, hidden, leaving, restart, failure and teardown cancel chewing');
