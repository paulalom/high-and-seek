import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FakeAudioContext, FakeAudioParam } from './qa-audio-harness.mjs';
import { createGameHarness } from './qa-pathing.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const names = ['lounge', 'snack', 'upstairs', 'midnight', 'midnight-rhythm', 'tension', 'conversation', 'couch'];
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const gesture = (run, type = 'pointerdown', details = {}) => run.dispatch('window', type, { isTrusted: true, repeat: false, key: 'Shift', pointerType: 'mouse', target: { closest: () => null }, preventDefault() {}, ...details });
const close = (a, b, message, tolerance = .002) => assert.ok(Math.abs(a - b) <= tolerance, `${message}: ${a} vs ${b}`);
// Verify the test clock itself before using it to judge interrupted ramps.
const clockFixture = new FakeAudioContext(), clockGain = new FakeAudioParam(clockFixture, 'gain');
clockGain.setValueAtTime(0, 0); clockGain.linearRampToValueAtTime(1, 2); clockFixture.advance(.5);
close(clockGain.value, .25, 'the audio fixture interpolates a scheduled gain ramp');
clockGain.cancelAndHoldAtTime(.5); clockGain.linearRampToValueAtTime(0, 1.5); clockFixture.advance(.5);
close(clockGain.value, .125, 'the audio fixture holds and reverses a partial ramp');
const bytesFor = name => { const file = fs.readFileSync(path.join(root, 'dist/assets/music', `${name}.wav`)); return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength); };
function inspectWav(name) {
  const file = Buffer.from(bytesFor(name));
  assert.equal(file.toString('ascii', 0, 4), 'RIFF'); assert.equal(file.toString('ascii', 8, 12), 'WAVE');
  let format, data;
  for (let offset = 12; offset + 8 <= file.length;) {
    const id = file.toString('ascii', offset, offset + 4), length = file.readUInt32LE(offset + 4);
    if (id === 'fmt ') format = file.subarray(offset + 8, offset + 8 + length);
    if (id === 'data') data = file.subarray(offset + 8, offset + 8 + length);
    offset += 8 + length + (length % 2);
  }
  assert.ok(format && data && data.length > 100000, `${name} is a substantial PCM loop`);
  assert.equal(format.readUInt16LE(0), 1, 'music uses widely supported PCM');
  assert.equal(format.readUInt16LE(2), 2, 'music is stereo');
  assert.equal(format.readUInt32LE(4), 22050, 'music has a bounded sample rate');
  assert.equal(format.readUInt16LE(14), 16, 'music uses sixteen-bit samples');
  let sum = 0, squared = 0, peak = 0;
  for (let offset = 0; offset < data.length; offset += 2) { const sample = data.readInt16LE(offset) / 32768; sum += sample; squared += sample * sample; peak = Math.max(peak, Math.abs(sample)); }
  const rms = Math.sqrt(squared / (data.length / 2));
  assert.ok(rms > .005 && rms < .3, `${name} has audible, restrained RMS (${rms.toFixed(3)})`);
  assert.ok(peak > .025 && peak < .98, `${name} has headroom (${peak.toFixed(3)})`);
  assert.ok(Math.abs(sum / (data.length / 2)) < .01, `${name} has no large DC offset`);
  for (let channel = 0; channel < 2; channel++) close(data.readInt16LE(channel * 2) / 32768, data.readInt16LE(data.length - 4 + channel * 2) / 32768, `${name} loops without a large sample jump`, .065);
  const frames = data.length / 4;
  const checks = [0, 12345, Math.floor(frames / 3), frames - 1].flatMap(frame => [0, 1].map(channel => ({ frame, channel, value: data.readInt16LE((frame * 2 + channel) * 2) / 32768 })));
  return { frames, rms, peak, checks, digest: createHash('sha256').update(data).digest('hex') };
}
const assets = names.map(inspectWav);
assert.ok(assets.every(asset => asset.frames === assets[0].frames), 'all stems share exactly the same loop length');
close(assets[0].frames / 22050, 24 * 4 * 60 / 88, 'loops contain twenty-four bars at eighty-eight BPM');
assert.equal(new Set(assets.map(asset => asset.digest)).size, names.length, 'all eight musical arrangements have distinct audio');
console.log(`PASS: eight original synchronized PCM loops (${(assets[0].frames / 22050).toFixed(3)}s), safe levels, headroom and seam checks`);

function makeFetch({ deferred = false, fail = false, corrupt = null } = {}) {
  const calls = [], pending = [];
  const fetch = (input, options = {}) => {
    const name = path.basename(new URL(String(input), 'http://127.0.0.1:4173/').pathname, '.wav');
    assert.ok(names.includes(name), 'only bundled soundtrack files are requested');
    calls.push({ name, signal: options.signal });
    const response = () => ({ ok: !fail, status: fail ? 503 : 200, arrayBuffer: async () => { const bytes = bytesFor(name); bytes.fixtureAsset = name; return corrupt ? corrupt(bytes) : bytes; } });
    if (!deferred) return Promise.resolve(response());
    return new Promise(resolve => pending.push(() => resolve(response())));
  };
  return { fetch, calls, release() { for (const resolve of pending.splice(0)) resolve(); } };
}
function harness(options) {
  const network = makeFetch(options), sandbox = { window: {}, document: { baseURI: 'http://127.0.0.1:4173/' }, URL, AbortController, fetch: network.fetch, console };
  vm.createContext(sandbox); vm.runInContext(fs.readFileSync(path.join(root, 'dist/music.js'), 'utf8'), sandbox);
  const context = new FakeAudioContext({ sampleRate: 48000 }), music = sandbox.window.HSMusic.create();
  return { music, context, network };
}
const normal = harness(), { music, context, network } = normal;
music.update({ mode: 'lounge', threat: 0, duck: false }); await flush();
assert.equal(network.calls.length, 0, 'loading the game does not fetch music while sound is off');
music.setContext(context); music.update({ mode: 'lounge' }); await flush();
assert.equal(network.calls.length, 0, 'providing a shared context does not enable sound');
music.setEnabled(true); music.update({ mode: 'lounge', threat: 0, duck: false }); await flush();
assert.equal(network.calls.length, names.length, 'one explicit sound activation loads the eight local arrangements');
assert.equal(context.decodeCalls, 0, 'bundled PCM parsing avoids device-rate resampling');
assert.equal(music.getDebug().ready, true); assert.equal(music.getDebug().playing, true);
assert.equal(music.getDebug().activeSources, names.length, 'one synchronized source per loop remains bounded');
assert.ok(music.getDebug().activeNodes <= names.length * 2 + 1, 'music uses a small audio graph');
const firstSources = context.sources.slice(), sourceCount = context.sources.length, nodeCount = context.nodes.length;
assert.ok(firstSources.every(source => source.loop === true), 'music loops through Web Audio without timer scheduling');
assert.equal(new Set(firstSources.map(source => source.started)).size, 1, 'stems start on one shared audio-clock boundary');
assert.equal(new Set(firstSources.map(source => source.offset)).size, 1, 'stems share the same phase');
assert.equal(context.buffers.length, names.length, 'each native-rate arrangement allocates one reusable buffer');
for (const [index, source] of firstSources.entries()) {
  assert.equal(source.buffer.sampleRate, 22050, 'a 48 kHz output context retains the native 22.05 kHz score');
  assert.equal(source.buffer.numberOfChannels, 2, 'native PCM parsing preserves stereo');
  for (const check of assets[index].checks) close(source.buffer.getChannelData(check.channel)[check.frame], check.value, `${names[index]} preserves its actual PCM samples`, 1 / 32768);
  assert.ok(source.buffer.getChannelData(0).some(sample => Math.abs(sample) > .001), 'decoded audio has actual samples rather than empty placeholder data');
}
const expectedCacheBytes = assets.reduce((sum, asset) => sum + asset.frames * 2 * 4, 0);
assert.equal(music.getDebug().cachedBytes, expectedCacheBytes, 'reported cache bytes include all stereo float channels');
assert.ok(expectedCacheBytes > 80 * 1024 * 1024 && expectedCacheBytes < 96 * 1024 * 1024, 'the longer score stays below 96 MiB even at a 48 kHz device rate');
const gain = Object.fromEntries(names.map((name, index) => [name, firstSources[index].connections[0].gain]));
const lastRamp = parameter => parameter.events.filter(event => event.type === 'linear').at(-1);
context.advance(2);
close(gain.lounge.value, 1, 'the initial lounge fade settles');
let changedAt = context.currentTime;
music.update({ mode: 'snack' });
assert.equal(music.getDebug().targets.snack, 1); assert.equal(music.getDebug().targets.lounge, 0);
close(lastRamp(gain.snack).time, changedAt + 2, 'normal area transition uses a two-second audio-clock fade');
close(gain.lounge.value, 1, 'leaving an area holds its current gain without a jump');
context.advance(1);
close(gain.lounge.value, .5, 'outgoing area reaches half gain halfway through its fade');
close(gain.snack.value, .5, 'incoming area reaches half gain halfway through its fade');
const steadyEvents = gain.snack.events.length;
for (let update = 0; update < 100; update++) music.update({ mode: 'snack' });
assert.equal(gain.snack.events.length, steadyEvents, 'unchanged game frames never restart a crossfade');
music.update({ mode: 'upstairs', threat: 0 });
close(gain.snack.value, .5, 'a quick area reversal holds the interrupted in-flight gain');
context.advance(2);
close(gain.upstairs.value, 1, 'upstairs has its own settled arrangement'); close(gain.snack.value, 0, 'the previous arrangement completes its fade out');
assert.equal(music.getDebug().targets.lounge, 0, 'upstairs does not reuse the ground-floor recording');
music.update({ mode: 'midnight' }); context.advance(2);
close(gain.midnight.value, 1, 'Midnight Wing has its own settled bed'); close(gain['midnight-rhythm'].value, 1, 'the indoor wing has its rhythm layer');
const bedEvents = gain.midnight.events.length;
changedAt = context.currentTime; music.update({ mode: 'terrace' });
assert.equal(music.getDebug().targets.midnight, 1); assert.equal(music.getDebug().targets['midnight-rhythm'], 0);
assert.equal(gain.midnight.events.length, bedEvents, 'the terrace leaves the shared musical bed uninterrupted');
close(lastRamp(gain['midnight-rhythm']).time, changedAt + 3.2, 'entering the terrace thins the rhythm over 3.2 seconds');
context.advance(1.6); close(gain['midnight-rhythm'].value, .5, 'terrace rhythm is halfway out at the midpoint');
music.update({ mode: 'midnight' });
close(gain['midnight-rhythm'].value, .5, 'leaving mid-fade holds the current rhythm volume');
close(lastRamp(gain['midnight-rhythm']).time, context.currentTime + 3.2, 'leaving the terrace restores rhythm over 3.2 seconds');
context.advance(1.6); close(gain['midnight-rhythm'].value, .75, 'a reversed fade interpolates from its held volume');
for (let turn = 0; turn < 20; turn++) {
  const before = gain['midnight-rhythm'].value;
  music.update({ mode: turn % 2 ? 'midnight' : 'terrace' });
  close(gain['midnight-rhythm'].value, before, 'rapid terrace reversals remain continuous');
  context.advance(.08);
}
music.update({ mode: 'terrace' }); context.advance(3.2);
close(gain['midnight-rhythm'].value, 0, 'a completed terrace fade removes rhythm entirely'); close(gain.midnight.value, 1, 'the quiet musical bed remains audible');
gain['midnight-rhythm'].cancelAndHoldAtTime = undefined;
music.update({ mode: 'midnight' }); context.advance(1.6);
close(gain['midnight-rhythm'].value, .5, 'the automation fallback reaches the same halfway volume');
music.update({ mode: 'terrace' });
close(gain['midnight-rhythm'].value, .5, 'the fallback reverses without jumping to the old target');
context.advance(1.6); close(gain['midnight-rhythm'].value, .25, 'the fallback interpolates from the held volume');
gain['midnight-rhythm'].cancelAndHoldAtTime = FakeAudioParam.prototype.cancelAndHoldAtTime;
music.update({ mode: 'upstairs', threat: 0 });
close(lastRamp(gain.upstairs).time, context.currentTime + 2, 'leaving the terrace for another area uses the normal two-second fade');
assert.equal(context.sources.length, sourceCount, 'room and area changes never allocate replacement loop sources');
assert.equal(context.nodes.length, nodeCount, 'crossfades reuse the bounded audio graph');
console.log('PASS: native-rate stereo samples, bounded long-score memory, two-second area fades, continuous 3.2-second terrace reversals and uninterrupted bed');
for (let i = 0; i < 1000; i++) music.update({ mode: 'upstairs', threat: i / 1000, duck: false });
assert.equal(context.sources.length, sourceCount, 'frame updates and threat changes do not restart the soundtrack');
assert.equal(context.nodes.length, nodeCount, 'frame updates allocate no extra audio nodes');
const danger = music.getDebug();
assert.equal(danger.mode, 'upstairs'); assert.ok(danger.targets.tension > 0, 'upstairs adds a tension layer');
music.update({ mode: 'conversation', duck: true });
const talking = music.getDebug();
assert.equal(talking.mode, 'conversation'); assert.ok(talking.targets.conversation > 0, 'conversation selects the awkward lounge arrangement');
assert.equal(talking.targets.tension, 0, 'conversation stops the chase percussion');
music.update({ mode: 'couch', duck: false });
assert.ok(music.getDebug().targets.couch > 0, 'the couch selects the warm resolved arrangement');
assert.equal(context.sources.length, sourceCount, 'arrangement changes crossfade the existing synchronized loops');
context.advance(4.25); const pausedPhase = music.getDebug().phase; music.update({ mode: 'silent' }); context.advance(0);
assert.equal(music.getDebug().playing, false); assert.equal(context.pendingSources().length, 0, 'pause/hidden silence stops current and future music sources');
assert.equal(music.getDebug().activeNodes, 0, 'silence releases the music graph');
music.update({ mode: 'lounge' }); await flush();
assert.equal(network.calls.length, names.length, 'resuming reuses decoded buffers');
assert.equal(music.getDebug().playing, true);
assert.ok(context.sources.slice(sourceCount).every(source => Math.abs(source.offset - pausedPhase) < .001), 'resuming preserves musical phase');
music.setEnabled(false); context.advance(0);
assert.equal(context.pendingSources().length, 0, 'mute immediately releases every loop');
music.dispose(); assert.equal(context.closeCalls, 0, 'the music engine never closes the shared game context');
assert.equal(music.getDebug().disposed, true);
music.setEnabled(true); music.update({ mode: 'couch' }); await flush();
assert.equal(context.pendingSources().length, 0, 'a disposed engine cannot revive');
context.releaseBufferData();
console.log('PASS: explicit audio activation, shared context, synchronized loops, adaptive gains, bounded updates, silence/resume/mute and disposal');

const late = harness({ deferred: true }); late.music.setContext(late.context); late.music.setEnabled(true); late.music.update({ mode: 'lounge' });
await flush(); assert.equal(late.network.calls.length, names.length);
late.music.setEnabled(false); late.network.release(); await flush();
assert.equal(late.context.pendingSources().length, 0, 'late loading cannot revive muted music');
late.music.dispose(); late.context.releaseBufferData();
const pausedLoad = harness({ deferred: true }); pausedLoad.music.setContext(pausedLoad.context); pausedLoad.music.setEnabled(true); pausedLoad.music.update({ mode: 'lounge' });
await flush(); pausedLoad.music.update({ mode: 'silent' }); pausedLoad.network.release(); await flush();
assert.equal(pausedLoad.context.pendingSources().length, 0, 'a completed load cannot play through a pause'); pausedLoad.music.dispose(); pausedLoad.context.releaseBufferData();
const replaced = harness({ deferred: true }); replaced.music.setContext(replaced.context); replaced.music.setEnabled(true); replaced.music.update({ mode: 'lounge' }); await flush();
const replacement = new FakeAudioContext(); replaced.music.setContext(replacement); replaced.music.update({ mode: 'couch' }); replaced.network.release(); await flush();
assert.equal(replaced.context.pendingSources().length, 0, 'late decoding cannot play through an old context');
assert.equal(replaced.music.getDebug().playing, true, 'the replacement context can load and play its own valid buffers');
assert.equal(replacement.pendingSources().length, names.length);
assert.equal(replaced.context.closeCalls, 0, 'context replacement does not close someone else’s audio'); replaced.music.dispose(); replaced.context.releaseBufferData(); replacement.releaseBufferData();
const broken = harness({ fail: true }); broken.music.setContext(broken.context); broken.music.setEnabled(true); broken.music.update({ mode: 'lounge' }); await flush();
assert.equal(broken.music.getDebug().playing, false); assert.ok(broken.music.getDebug().error, 'failed music loads are observable without breaking gameplay'); broken.music.dispose(); broken.context.releaseBufferData();
const suspended = harness(); suspended.context.state = 'suspended'; suspended.music.setContext(suspended.context); suspended.music.setEnabled(true); suspended.music.update({ mode: 'lounge' }); await flush();
assert.equal(suspended.network.calls.length, 0, 'suspended audio does not request or schedule a stale soundtrack'); assert.equal(suspended.context.resumeCalls, 0, 'only the user-gesture app path can resume audio'); suspended.music.dispose(); suspended.context.releaseBufferData();
const disposedLoad = harness({ deferred: true }); disposedLoad.music.setContext(disposedLoad.context); disposedLoad.music.setEnabled(true); disposedLoad.music.update({ mode: 'lounge' }); await flush();
disposedLoad.music.dispose(); disposedLoad.network.release(); await flush();
assert.equal(disposedLoad.context.pendingSources().length, 0, 'late responses cannot revive a disposed engine');
assert.equal(disposedLoad.music.getDebug().cachedBytes, 0, 'disposal releases decoded music memory');
disposedLoad.context.releaseBufferData();
for (const [label, corrupt] of [
  ['invalid RIFF header', bytes => { new DataView(bytes).setUint32(0, 0); return bytes; }],
  ['truncated PCM chunk', bytes => bytes.slice(0, bytes.byteLength - 16)],
  ['unsupported sample width', bytes => { new DataView(bytes).setUint16(34, 8, true); return bytes; }]
]) {
  const invalid = harness({ corrupt }); invalid.music.setContext(invalid.context); invalid.music.setEnabled(true); invalid.music.update({ mode: 'lounge' }); await flush();
  assert.ok(invalid.music.getDebug().error, `${label} is rejected`); assert.equal(invalid.context.buffers.length, 0, `${label} is rejected before allocating long buffers`);
  assert.equal(invalid.context.pendingSources().length, 0, `${label} cannot start an incomplete score`); invalid.music.dispose(); invalid.context.releaseBufferData();
}
const retryNetwork = makeFetch(), retrySandbox = { window: {}, document: { baseURI: 'http://127.0.0.1:4173/' }, URL, AbortController, console };
let rejectAssets = true;
retrySandbox.fetch = (...args) => rejectAssets ? Promise.reject(new Error('Temporary network failure')) : retryNetwork.fetch(...args);
vm.createContext(retrySandbox); vm.runInContext(fs.readFileSync(path.join(root, 'dist/music.js'), 'utf8'), retrySandbox);
const retry = retrySandbox.window.HSMusic.create(), retryContext = new FakeAudioContext();
retry.setContext(retryContext); retry.setEnabled(true); retry.update({ mode: 'lounge' }); await flush();
assert.ok(retry.getDebug().error); rejectAssets = false; retry.setEnabled(false); retry.setEnabled(true); retry.update({ mode: 'lounge' }); await flush();
assert.equal(retry.getDebug().playing, true, 'an explicit sound toggle retries a recovered asset load'); retry.dispose(); retryContext.releaseBufferData();
console.log('PASS: blocked audio, late fetches, paused loads, replaced contexts and unavailable assets remain safe');

const clickNetwork = makeFetch({ deferred: true }), clickContexts = [];
class ClickContext extends FakeAudioContext { constructor() { super(); clickContexts.push(this); } }
const clickApp = createGameHarness({ audioContextFactory: ClickContext, musicFetch: clickNetwork.fetch });
assert.equal(clickApp.getNode('sound-button').getAttribute('aria-pressed'), 'true');
clickApp.document.hidden = true; gesture(clickApp, 'click'); await flush();
assert.equal(clickContexts.length, 0, 'hidden interactions cannot create or download audio');
assert.equal(clickNetwork.calls.length, 0);
clickApp.document.hidden = false;
gesture(clickApp, 'click'); await flush();
assert.equal(clickContexts.length, 1, 'a trusted click can activate default-on audio without a preceding pointer event');
assert.equal(clickNetwork.calls.length, names.length, 'only the first valid gesture requests the bundled score');
for (const type of ['pointerdown', 'keydown', 'click']) gesture(clickApp, type);
assert.equal(clickContexts.length, 1); assert.equal(clickNetwork.calls.length, names.length, 'later gestures do not duplicate music loading');
clickApp.dispatch('window', 'pagehide', { persisted: false }); clickNetwork.release(); await flush();
assert.equal(clickContexts[0].pendingSources().length, 0, 'late first-gesture downloads cannot survive teardown');
clickContexts[0].releaseBufferData();

for (const action of ['pause', 'hidden', 'pagehide']) {
  const pendingNetwork = makeFetch(), waitingContexts = [];
  class WaitingContext extends FakeAudioContext {
    constructor() { super({ state: 'suspended' }); this.waiters = []; waitingContexts.push(this); }
    resume() { this.resumeCalls++; return new Promise(resolve => this.waiters.push(resolve)); }
    unlock() { this.state = 'running'; for (const resolve of this.waiters.splice(0)) resolve(); }
  }
  const waiting = createGameHarness({ audioContextFactory: WaitingContext, musicFetch: pendingNetwork.fetch });
  waiting.qa.begin(); gesture(waiting); gesture(waiting, 'click');
  assert.equal(waitingContexts.length, 1); assert.equal(waitingContexts[0].resumeCalls, 1, 'pointerdown and click share one pending browser resume');
  assert.equal(pendingNetwork.calls.length, 0, 'a suspended context requests no music assets');
  if (action === 'pause') waiting.qa.openPause();
  if (action === 'hidden') { waiting.document.hidden = true; waiting.dispatch('document', 'visibilitychange'); }
  if (action === 'pagehide') waiting.dispatch('window', 'pagehide', { persisted: false });
  waitingContexts[0].unlock(); await flush();
  assert.equal(pendingNetwork.calls.length, 0, `${action} prevents a late browser resume from downloading music`);
  assert.equal(waitingContexts[0].pendingSources().length, 0, `${action} prevents late audio sources`);
  if (action === 'pagehide') {
    gesture(waiting); await flush();
    assert.equal(waitingContexts.length, 1); assert.equal(waitingContexts[0].resumeCalls, 1, 'disposed pages cannot unlock audio again');
  } else waiting.dispatch('window', 'pagehide', { persisted: false });
  assert.equal(waitingContexts[0].closeCalls, 0); waitingContexts[0].releaseBufferData();
}

const recoveryNetwork = makeFetch(), recoveryContexts = [];
class RecoveryContext extends FakeAudioContext { constructor() { super({ state: 'suspended', resumeError: true }); recoveryContexts.push(this); } }
const recovery = createGameHarness({ audioContextFactory: RecoveryContext, musicFetch: recoveryNetwork.fetch });
gesture(recovery, 'keydown'); await flush();
assert.equal(recoveryContexts.length, 1); assert.equal(recoveryContexts[0].resumeCalls, 1);
assert.equal(recoveryNetwork.calls.length, 0, 'a rejected resume leaves the soundtrack locked');
for (let frame = 0; frame < 10; frame++) recovery.stepFrame();
assert.equal(recoveryContexts[0].resumeCalls, 1, 'animation frames never retry browser activation');
recoveryContexts[0].resumeError = false;
gesture(recovery, 'click'); await flush();
assert.equal(recoveryContexts.length, 1); assert.equal(recoveryContexts[0].resumeCalls, 2, 'a later real gesture retries the same context');
assert.equal(recovery.qa.music.getDebug().playing, true, 'a recovered browser resume starts the default soundtrack');
assert.equal(recoveryNetwork.calls.length, names.length);
recovery.dispatch('window', 'pagehide', { persisted: false }); recoveryContexts[0].advance(0); recoveryContexts[0].releaseBufferData();
console.log('PASS: default-on click/key activation, deduplicated resume, hidden/pause/teardown guards and later-gesture recovery without early asset downloads');

const appNetwork = makeFetch(), contexts = [];
class AppContext extends FakeAudioContext { constructor() { super(); contexts.push(this); } }
const app = createGameHarness({ audioContextFactory: AppContext, musicFetch: appNetwork.fetch }), { qa, world } = app;
assert.ok(qa.music, 'the actual application creates its music engine');
assert.equal(app.getNode('sound-button').getAttribute('aria-pressed'), 'true', 'sound is visibly enabled by default');
assert.equal(app.getNode('sound-button').querySelector('span').textContent, 'Sound on');
assert.equal(contexts.length, 0); assert.equal(appNetwork.calls.length, 0, 'default-on audio still waits for a gesture before creating or downloading anything');
qa.begin(); app.stepFrame(); await flush();
assert.equal(contexts.length, 0); assert.equal(appNetwork.calls.length, 0, 'programmatic gameplay cannot unlock browser audio');
gesture(app, 'keydown'); await flush(); app.stepFrame(); await flush();
assert.equal(contexts.length, 1, 'sound unlock shares one game AudioContext with voices and effects');
assert.equal(qa.music.getDebug().playing, true); assert.equal(qa.music.getDebug().mode, 'lounge');
qa.begin();
const areaStarts = qa.music.getDebug().starts;
qa.changeFloor(world.wing.level, world.floors[world.wing.level].doors[0]); qa.syncMusic();
assert.equal(qa.music.getDebug().mode, 'snack', 'the pet and snack wing selects its own arrangement');
qa.changeFloor(world.midnight.level, world.floors[world.midnight.level].doors[0]); qa.syncMusic();
assert.equal(qa.music.getDebug().mode, 'midnight', 'the Midnight Wing entrance selects its full arrangement');
assert.equal(qa.music.getDebug().targets.midnight, 1); assert.equal(qa.music.getDebug().targets['midnight-rhythm'], 1);
const terrace = world.floors[world.midnight.level].rooms.find(room => room.id === 'terrace');
Object.assign(qa.state.player, { x: 15, y: terrace.y + .15 }); qa.syncMusic();
assert.equal(qa.music.getDebug().mode, 'terrace', 'crossing into the actual terrace selects its quiet arrangement');
assert.equal(qa.music.getDebug().targets.midnight, 1); assert.equal(qa.music.getDebug().targets['midnight-rhythm'], 0);
const appRhythm = contexts[0].sources.filter(source => source.loop)[names.indexOf('midnight-rhythm')].connections[0].gain;
const terraceEvents = appRhythm.events.length;
for (const offset of [-.1, .05, -.3, .1, -.2]) {
  qa.state.player.y = terrace.y + offset; qa.syncMusic();
  assert.equal(qa.music.getDebug().mode, 'terrace', 'doorway movement inside the deadband retains the terrace arrangement');
}
assert.equal(appRhythm.events.length, terraceEvents, 'doorway jitter does not restart the rhythm fade');
qa.state.player.y = terrace.y - .5; qa.syncMusic();
assert.equal(qa.music.getDebug().mode, 'midnight', 'walking fully back indoors restores the full arrangement');
Object.assign(qa.state.player, world.home); qa.syncMusic();
assert.equal(qa.music.getDebug().mode, 'terrace', 'the snug keeps the quiet terrace arrangement before finishing');
assert.equal(qa.music.getDebug().targets.couch, 0, 'standing beside the couch cannot trigger the ending reprise');
qa.changeFloor(0, world.start); qa.syncMusic();
assert.equal(qa.music.getDebug().mode, 'lounge');
qa.changeFloor(world.midnight.level, world.floors[world.midnight.level].doors[0]); qa.syncMusic();
assert.equal(qa.music.getDebug().mode, 'midnight', 'leaving the floor resets the terrace latch');
assert.equal(qa.music.getDebug().starts, areaStarts, 'actual floor and room changes reuse the original synchronized sources');
Object.assign(qa.state.player, { x: 15, y: terrace.y + .15 }); qa.syncMusic();
app.dispatch('sound-button', 'click');
qa.state.player.y = terrace.y - .5; qa.syncMusic();
app.dispatch('sound-button', 'click'); await flush();
assert.equal(qa.music.getDebug().mode, 'midnight', 'moving back indoors while muted still resets the terrace latch');
assert.equal(appNetwork.calls.length, names.length, 'muting and re-enabling after area changes reuses the cached recordings');
qa.changeFloor(1, world.floors[1].stair); app.stepFrame();
assert.equal(qa.music.getDebug().mode, 'upstairs', 'ascending selects the upstairs mix');
const guest = qa.state.guests[0];
Object.assign(qa.state.player, { x: guest.x, y: guest.y }); qa.state.talkCooldown = 0; qa.checkConversation(); app.stepFrame();
assert.equal(qa.music.getDebug().mode, 'conversation', 'guest encounters select the talking arrangement');
assert.ok(qa.music.getDebug().targets.conversation > 0);
qa.openPause(); contexts[0].advance(0);
assert.equal(qa.music.getDebug().playing, false, 'pause silences music with the guest voice');
qa.closeDialog(); app.stepFrame(); await flush();
assert.equal(qa.music.getDebug().mode, 'conversation'); assert.equal(qa.music.getDebug().playing, true);
app.document.hidden = true; app.dispatch('document', 'visibilitychange'); contexts[0].advance(0);
assert.equal(qa.music.getDebug().playing, false, 'hidden tabs stop soundtrack decoding');
app.document.hidden = false; app.dispatch('document', 'visibilitychange'); qa.closeDialog(); app.stepFrame(); await flush();
for (let i = 0; i < 12; i++) qa.interact(); app.stepFrame();
assert.equal(qa.music.getDebug().mode, 'upstairs', 'escaping restores the exploration mix');
qa.restart(); app.stepFrame();
assert.equal(qa.music.getDebug().mode, 'lounge', 'a fresh run returns to the downstairs groove');
assert.equal(contexts.length, 1, 'restart reuses the shared context');
qa.state.started = true; qa.state.leftHome = true; qa.state.found.add(world.snacks[0].id);
qa.state.bag.push(world.snacks[0]); qa.state.haulCounts[world.snacks[0].kind] = 1;
qa.changeFloor(world.home.level, world.home); qa.syncMusic();
assert.equal(qa.music.getDebug().mode, 'terrace', 'arriving home does not start the couch reprise until the run is banked');
assert.equal(qa.finishRun(), true); app.stepFrame();
assert.equal(qa.music.getDebug().mode, 'couch', 'the cinematic resolves to the couch arrangement despite gameplay being paused');
app.dispatch('ending-pause', 'click'); contexts[0].advance(0);
assert.equal(qa.music.getDebug().playing, false, 'manual cinematic pause silences the music');
app.dispatch('ending-pause', 'click'); app.stepFrame(); await flush();
assert.equal(qa.music.getDebug().playing, true);
app.dispatch('skip-ending', 'click'); contexts[0].advance(0);
assert.equal(qa.music.getDebug().playing, false, 'the results modal pauses the soundtrack');
qa.closeDialog(); app.stepFrame(); await flush();
assert.equal(qa.music.getDebug().mode, 'couch'); assert.equal(qa.music.getDebug().playing, true, 'enjoying the couch restores the satisfied groove');
app.dispatch('sound-button', 'click'); contexts[0].advance(0);
assert.equal(qa.music.getDebug().playing, false, 'the existing sound button mutes music immediately');
const mutedSources = contexts[0].sources.length;
for (const type of ['pointerdown', 'keydown', 'click']) gesture(app, type);
app.stepFrame(); await flush();
assert.equal(contexts.length, 1); assert.equal(contexts[0].sources.length, mutedSources, 'later gameplay gestures respect an explicit mute');
assert.equal(qa.music.getDebug().playing, false);
app.dispatch('window', 'pagehide', { persisted: false }); contexts[0].advance(0);
assert.equal(qa.music.getDebug().activeSources, 0, 'page teardown releases soundtrack sources');
assert.equal(contexts[0].closeCalls, 0); assert.equal(app.getPendingRaf(), 1, 'the soundtrack adds no animation loop');
contexts[0].releaseBufferData();
console.log('PASS: all actual area modes, stable terrace doorway, snug/ending separation, sound/pause/hidden/restart/result/mute/pagehide integration with one shared context and animation loop');

const fastNetwork = makeFetch(), fastContexts = [];
class FastContext extends FakeAudioContext { constructor() { super(); fastContexts.push(this); } }
const fast = createGameHarness({ frameMs: 1000 / 240, audioContextFactory: FastContext, musicFetch: fastNetwork.fetch });
gesture(fast, 'pointerdown', { pointerType: 'touch' }); await flush(); fast.qa.begin(); fast.resetMetrics();
const audioNodesBefore = fastContexts[0].nodes.length;
for (let frame = 0; frame < 2400; frame++) { fast.stepFrame(); fastContexts[0].advance(1 / 240); }
assert.ok(fast.metrics.draws >= 597 && fast.metrics.draws <= 601, 'music-on play remains capped at sixty fps on a 240Hz display');
assert.equal(fast.getPendingRaf(), 1); assert.equal(fast.qa.music.getDebug().activeSources, names.length);
assert.equal(fastContexts[0].nodes.length, audioNodesBefore, 'ten seconds of normal playback create no recurring audio graphs');
assert.ok(fast.metrics.domWrites < 700, 'music introduces no per-frame DOM churn');
fast.dispatch('window', 'pagehide', { persisted: false }); fastContexts[0].advance(0);
assert.equal(fastContexts[0].pendingSources().length, 0, 'the high-refresh fixture releases every sound source');
fastContexts[0].releaseBufferData();
console.log(`PASS: music-on sixty-fps play at 240Hz, one animation loop, stable audio graph and ${fast.metrics.domWrites} DOM writes over ten seconds`);
