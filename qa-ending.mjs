import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createGameHarness } from './qa-pathing.mjs';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const recordKey = 'high-and-seek-best-haul-v2', videoId = 'lounge-tv-video';
const near = (actual, expected, message, tolerance = .02) => assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: expected ${expected}, got ${actual}`);
function advance(run, seconds, frameMs = 1000 / 60) {
  const end = run.getTime() + seconds * 1000;
  while (run.getTime() < end - 1e-7) run.stepFrame(Math.min(frameMs, end - run.getTime()));
}
const flushMedia = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
function safeApproach(world, snack) {
  for (let gx = Math.floor((snack.x - 1.1) * 2); gx <= Math.ceil((snack.x + 1.1) * 2); gx++) for (let gy = Math.floor((snack.y - 1.1) * 2); gy <= Math.ceil((snack.y + 1.1) * 2); gy++) {
    const x = gx / 2, y = gy / 2;
    if (Math.hypot(snack.x - x, snack.y - y) <= world.collectionRadius && world.isWalkable(x, y) && world.getRoom(x, y)?.id === snack.room) return { x, y };
  }
  assert.fail(`collection fixture has no safe approach to ${snack.id}`);
}
function readyToBank(options = {}) {
  const run = createGameHarness({ seed: 67, ...options }), { qa, world } = run;
  Object.assign(qa.state.player, { x: 10, y: 11 }); qa.begin(); run.stepFrame(100);
  const selected = [];
  for (const snack of world.snacks.filter(item => item.level === 0)) {
    if (selected.some(item => item.kind === snack.kind)) continue;
    Object.assign(qa.state.player, safeApproach(world, snack)); qa.state.discovered.add(snack.id); qa.collect(snack); selected.push(snack);
    if (selected.length === 2) break;
  }
  assert.equal(selected.length, 2, 'fixture banks two distinct snack kinds');
  qa.changeFloor(world.home.level, world.home); run.stepFrame(100);
  assert.equal(qa.canFinishRun(), true, 'fixture meets the real leave-home, haul and couch guards');
  return { run, selected };
}
function startEnding(options) {
  const fixture = readyToBank(options);
  assert.equal(fixture.run.qa.finishRun(), true, 'valid couch interaction starts the ending');
  return fixture;
}
function key(run, value) { run.dispatch('window', 'keydown', { key: value, repeat: false, target: { closest: () => null }, preventDefault() {} }); run.dispatch('window', 'keyup', { key: value }); }
function assertResultStats(run, { collected, carried, time }) {
  const text = run.getNode('dialog-content').innerHTML.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  for (const [label, value] of [['TOTAL COLLECTED', collected], ['CARRIED TO COUCH', carried], ['SCORE', carried], ['RUN TIME', time]]) {
    assert.match(text, new RegExp(`(?:^|\\s)${value}\\s+${label}(?:\\s|$)`), `${label} reports the run’s actual result`);
  }
  assert.doesNotMatch(text, /\benergy\s+(?:left|remaining)\b/i, 'the final screen has no energy-left metric');
  assert.doesNotMatch(text, /\d+(?:\.\d+)?\s*%/, 'the final screen has no leftover energy percentage');
  return text;
}

const html = fs.readFileSync(path.join(projectRoot, 'dist/index.html'), 'utf8');
const videoTag = html.match(/<video\b[^>]*\bid="lounge-tv-video"[^>]*>/)?.[0] || '';
assert.ok(videoTag, 'ending has a real HTML video element');
for (const attribute of ['muted', 'loop', 'playsinline']) assert.match(videoTag, new RegExp(`\\b${attribute}(?:\\s|=|>)`), `TV clip uses ${attribute}`);
const clip = fs.readFileSync(path.join(projectRoot, 'dist/assets/lounge-tv.mp4'));
assert.ok(clip.length > 1024 && clip.subarray(0, 32).includes(Buffer.from('ftyp')), 'local TV clip is a nonempty MP4 container');

const { run, selected } = startEnding(), { qa, getNode, world } = run, video = getNode(videoId);
assert.equal(qa.state.won, true, 'haul is banked before the cinematic');
assert.equal(qa.state.paused, true, 'gameplay freezes as the ending starts');
assert.ok(qa.state.ending?.active, 'the cinematic begins immediately');
assert.equal(qa.state.ending.duration, 9, 'cinematic runs for nine seconds');
assert.equal(getNode('game-dialog').open, false, 'result dialog does not cover the opening shot');
assert.equal(getNode('ending-overlay').hidden, false, 'ending controls are available');
const savedRecord = run.storage.get(recordKey), writesAfterBank = run.metrics.storageWrites;
assert.equal(JSON.parse(savedRecord).score, 2, 'selected haul is already saved');
assert.equal(getNode('found-count').textContent, '2');
assert.equal(getNode('haul-state').textContent, 'BANKED');
for (const snack of selected) assert.ok(getNode('snack-list').innerHTML.includes(snack.name), 'collected snack kinds stay represented in the banked haul');
const frozen = { energy: qa.state.energy, elapsed: qa.state.elapsed, x: qa.state.player.x, y: qa.state.player.y, found: qa.state.found.size };
key(run, 'w'); qa.collect(world.snacks.find(snack => !qa.state.found.has(snack.id)));
assert.equal(qa.finishRun(), false, 'repeated finish cannot bank the same run twice');
advance(run, 1);
assert.equal(qa.state.ending.seated, false, 'player has a moment to reach the couch');
assert.equal(qa.state.ending.tvOn, false, 'TV waits for the sit-down beat');
advance(run, .4);
assert.equal(qa.state.ending.seated, true, 'player sits after the couch approach');
assert.equal(qa.state.ending.tvOn, false);
advance(run, .7); await flushMedia();
assert.equal(qa.state.ending.tvOn, true, 'TV turns on after two seconds');
assert.ok(video.playCalls >= 1, 'ending starts real video playback');
assert.equal(run.renderer.tvVideo, video, 'the renderer receives the playable video surface');
assert.ok(video.src.endsWith('assets/lounge-tv.mp4'), 'TV plays the bundled local clip');
advance(run, 6.7);
assert.equal(getNode('game-dialog').open, false, 'cinematic remains visible until its final beat');
advance(run, .3); await flushMedia();
assert.equal(qa.state.ending.active, false);
assert.equal(qa.state.ending.seated, true);
assert.equal(qa.state.ending.tvOn, true);
assert.equal(getNode('game-dialog').open, true, 'result dialog opens after the cinematic');
assertResultStats(run, { collected: 2, carried: 2, time: '00:00' });
assert.equal(video.paused, true, 'result modal pauses video decoding');
assert.equal(qa.state.energy, frozen.energy, 'ending never drains gameplay energy');
assert.equal(qa.state.elapsed, frozen.elapsed, 'ending never adds survival time');
near(qa.state.player.x, frozen.x, 'held movement cannot move the player during the ending');
near(qa.state.player.y, frozen.y, 'held movement cannot move the player during the ending');
assert.equal(qa.state.found.size, frozen.found, 'ending cannot collect extra food');
assert.equal(run.storage.get(recordKey), savedRecord, 'cinematic never changes the saved score');
assert.equal(run.metrics.storageWrites, writesAfterBank, 'the ending writes the banked record only once');
qa.closeDialog(); await flushMedia();
assert.equal(video.paused, false, 'enjoying the couch resumes the video');
run.resetMetrics(); advance(run, 2, 1000 / 144);
assert.ok(run.metrics.draws >= 57 && run.metrics.draws <= 61, 'lounging video renders at about thirty fps');
run.dispatch('ending-pause', 'click'); run.resetMetrics(); advance(run, 1, 1000 / 144);
assert.equal(video.paused, true, 'pausing the post-result TV stops decoding');
assert.ok(run.metrics.draws <= 1, 'paused lounging paints once then stops drawing');
console.log('PASS: nine-second couch/TV sequence, delayed results, selected haul, frozen gameplay, single banking and thirty-fps lounging');

const paintedText = [], paintedImages = [];
const canvasContext = new Proxy({}, {
  get(target, name) {
    if (name === 'fillText') return text => paintedText.push(String(text));
    if (name === 'drawImage') return source => paintedImages.push(source);
    if (name === 'measureText') return text => ({ width: String(text).length * 6 });
    if (name === 'createLinearGradient' || name === 'createRadialGradient') return () => ({ addColorStop() {} });
    return name in target ? target[name] : () => {};
  }, set(target, name, value) { target[name] = value; return true; }
});
const rendererSandbox = { window: { HSWorld: world, devicePixelRatio: 1 }, console };
vm.createContext(rendererSandbox);
vm.runInContext(fs.readFileSync(path.join(projectRoot, 'dist/renderer.js'), 'utf8'), rendererSandbox);
const realRenderer = new rendererSandbox.window.MansionRenderer({ getContext: () => canvasContext, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1366, height: 768 }) }, world);
realRenderer.setTVVideo(video);
let seatedDraws = 0;
const originalSeatedAvatar = realRenderer.seatedAvatar;
realRenderer.seatedAvatar = function (...args) { seatedDraws++; return originalSeatedAvatar.apply(this, args); };
realRenderer.draw(qa.state, 0); realRenderer.draw(qa.state, 4100);
for (const snack of selected) assert.ok(paintedText.includes(snack.icon), 'the actual seated avatar eats snack kinds from the banked haul');
assert.equal(seatedDraws, 2, 'completed scene draws the seated avatar');
assert.equal(paintedImages.filter(source => source === video).length, 2, 'actual renderer maps decoded video frames onto the lounge TV');
video.readyState = 0; paintedText.length = 0;
realRenderer.draw(qa.state, 4200);
assert.ok(paintedText.includes('SNACK TV'), 'TV has a visible fallback while no decoded frame is available');
realRenderer.setTVVideo(null); video.readyState = 4;
assert.equal(realRenderer.tvVideo, null, 'video source can be released from the actual renderer');
console.log('PASS: actual renderer seats the avatar, eats selected snack kinds, draws decoded TV video and handles unavailable frames');

for (const [width, height] of [[390, 844], [360, 740]]) {
  const phoneRenderer = new rendererSandbox.window.MansionRenderer({ getContext: () => canvasContext, getBoundingClientRect: () => ({ left: 0, top: 0, width, height }) }, world);
  const phoneState = { ...qa.state, ending: { ...qa.state.ending, elapsed: 0, active: true, seated: false, tvOn: false, paused: false } };
  phoneRenderer.setTVVideo(video); phoneRenderer.draw(phoneState, 0);
  const television = world.furniture.find(item => item.type === 'television' && item.room === world.home.room);
  const visible = (points, message, topMargin = 0, bottomMargin = 0) => {
    assert.ok(points.every(point => Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= -1 && point.x <= width + 1 && point.y >= topMargin && point.y <= height - bottomMargin), `${message} at ${width}×${height}: ${JSON.stringify(points)}`);
  };
  const tvCorners = () => [
    phoneRenderer.worldToScreen(television.x + .23, television.y + .32, 1.65),
    phoneRenderer.worldToScreen(television.x + television.w - .23, television.y + .32, 1.65),
    phoneRenderer.worldToScreen(television.x + .23, television.y + .32, .7),
    phoneRenderer.worldToScreen(television.x + television.w - .23, television.y + .32, .7)
  ];
  const avatarCorners = () => {
    const player = phoneRenderer.lastPlayer, anchor = phoneRenderer.worldToScreen(player.x, player.y, .84), scale = Math.max(12, phoneRenderer.unit) / 18;
    return [{ x: anchor.x - 14 * scale, y: anchor.y - 34 * scale }, { x: anchor.x + 22 * scale, y: anchor.y + 10 * scale }];
  };
  Object.assign(phoneState.ending, { elapsed: 3, seated: true, tvOn: true }); phoneRenderer.draw(phoneState, 3000);
  const screen = tvCorners(); visible(screen, 'TV close-up remains fully visible', 72, 100);
  assert.ok(Math.max(...screen.map(point => point.x)) - Math.min(...screen.map(point => point.x)) >= Math.min(100, width * .26), 'portrait TV shot is large enough to read');
  phoneState.ending.elapsed = 6; phoneRenderer.draw(phoneState, 6000);
  const avatar = avatarCorners(); visible(avatar, 'eating close-up keeps the seated player above the caption', 72, 100);
  assert.ok(avatar[1].y - avatar[0].y >= 120, 'portrait eating shot gives the avatar meaningful screen space');
  phoneState.ending.elapsed = 9; phoneRenderer.draw(phoneState, 9000);
  visible(tvCorners(), 'final wide shot includes the TV'); visible(avatarCorners(), 'final wide shot includes the seated player');
}
console.log('PASS: portrait montage frames the readable TV at three seconds, eating at six, and both subjects at nine');

const skipping = readyToBank().run;
skipping.qa.changeFloor(0, skipping.world.start);
const extraSnack = skipping.world.snacks.find(snack => snack.level === 0 && !skipping.qa.state.found.has(snack.id));
Object.assign(skipping.qa.state.player, safeApproach(skipping.world, extraSnack));
skipping.qa.state.discovered.add(extraSnack.id); skipping.qa.collect(extraSnack);
const refill = Math.min(...skipping.qa.state.bag.map(snack => snack.energy));
skipping.qa.spendEnergy(refill);
assert.equal(skipping.qa.state.consumedCount, 1, 'result fixture has actually eaten one collected snack');
assert.equal(skipping.qa.state.found.size, 3);
assert.equal(skipping.qa.state.bag.length, 2, 'the remaining haul differs from historical pickups');
advance(skipping, 8.4);
skipping.qa.changeFloor(skipping.world.home.level, skipping.world.home); skipping.stepFrame(100);
assert.equal(skipping.qa.finishRun(), true);
const resultTime = skipping.qa.state.elapsed;
assert.equal(Math.floor(resultTime), 8, 'result fixture has visible gameplay time before the cinematic');
advance(skipping, .2); skipping.dispatch('skip-ending', 'click'); await flushMedia();
assert.equal(skipping.qa.state.ending.active, false, 'skip completes the sequence immediately');
assert.equal(skipping.qa.state.ending.seated, true, 'skip lands on the seated pose');
assert.equal(skipping.qa.state.ending.tvOn, true, 'skip lands on the TV-on pose');
assert.equal(skipping.getNode('game-dialog').open, true, 'skip shows the banked result');
assert.equal(JSON.parse(skipping.storage.get(recordKey)).score, 2, 'skip preserves the complete haul');
const skippedResult = assertResultStats(skipping, { collected: 3, carried: 2, time: '00:08' });
const skipWrites = skipping.metrics.storageWrites;
skipping.qa.closeDialog(); advance(skipping, 5); await flushMedia();
assert.equal(skipping.qa.state.elapsed, resultTime, 'lounging cannot add time to the final result');
skipping.dispatch('skip-ending', 'click');
assert.equal(skipping.getNode('game-dialog').open, true, 'View haul reopens the final result');
assert.equal(assertResultStats(skipping, { collected: 3, carried: 2, time: '00:08' }), skippedResult, 'reopened results preserve historical pickups, frozen carried count, score and time');
assert.equal(skipping.metrics.storageWrites, skipWrites, 'reopening the result cannot rebank the haul');
console.log('PASS: final results distinguish collected, carried and scored food; skip/reopen preserve frozen time and omit energy-left metrics');

const pausing = startEnding().run;
advance(pausing, 2.3); await flushMedia();
key(pausing, 'p');
assert.equal(pausing.qa.state.ending.paused, true, 'P pauses the cinematic');
const pausedAt = pausing.qa.state.ending.elapsed;
advance(pausing, 4);
near(pausing.qa.state.ending.elapsed, pausedAt, 'manual pause freezes cinematic time');
assert.equal(pausing.getNode(videoId).paused, true, 'manual pause stops video playback');
pausing.document.hidden = true; pausing.dispatch('document', 'visibilitychange'); advance(pausing, 4);
pausing.document.hidden = false; pausing.dispatch('document', 'visibilitychange'); await flushMedia();
assert.equal(pausing.qa.state.ending.paused, true, 'visibility restoration preserves manual pause');
pausing.dispatch('ending-pause', 'click'); advance(pausing, .3); await flushMedia();
assert.equal(pausing.qa.state.ending.paused, false);
assert.ok(pausing.qa.state.ending.elapsed > pausedAt, 'cinematic resumes from its paused beat');
const hiddenAt = pausing.qa.state.ending.elapsed;
pausing.document.hidden = true; pausing.dispatch('document', 'visibilitychange'); advance(pausing, 15);
near(pausing.qa.state.ending.elapsed, hiddenAt, 'hidden browser never skips ahead in the cinematic');
assert.equal(pausing.getNode(videoId).paused, true);
pausing.document.hidden = false; pausing.dispatch('document', 'visibilitychange'); advance(pausing, .3); await flushMedia();
assert.ok(pausing.qa.state.ending.elapsed > hiddenAt, 'visible browser resumes the cinematic');
console.log('PASS: skip, keyboard/button pause, hidden-tab freeze and explicit resume preserve the banked result');

const retrying = startEnding({ videoPlayError: true }).run;
advance(retrying, 2.2); await flushMedia();
assert.equal(retrying.qa.state.won, true, 'autoplay denial cannot undo a banked win');
assert.equal(retrying.getNode('tv-retry').hidden, false, 'autoplay failure exposes a playback retry control');
retrying.getNode(videoId).playError = false; retrying.dispatch('tv-retry', 'click'); await flushMedia();
assert.equal(retrying.getNode(videoId).paused, false, 'explicit retry can start playback');
assert.equal(retrying.getNode('tv-retry').hidden, true, 'successful playback clears retry UI');
advance(retrying, 7); await flushMedia();
assert.equal(retrying.getNode('game-dialog').open, true, 'autoplay recovery does not block results');
const denied = startEnding({ videoPlayError: true }).run;
advance(denied, 9.1); await flushMedia();
assert.equal(denied.qa.state.won, true, 'persistent playback denial still leaves a banked win');
assert.equal(denied.getNode('game-dialog').open, true, 'persistent playback denial cannot block the result dialog');

const restarting = startEnding().run;
let resolvePlay;
const pendingVideo = restarting.getNode(videoId);
pendingVideo.play = function () { this.playCalls++; return new Promise(resolve => { resolvePlay = resolve; }); };
advance(restarting, 2.2);
assert.equal(typeof resolvePlay, 'function', 'fixture has an in-flight playback promise');
pendingVideo.currentTime = 3.5;
const floorAssignments = restarting.metrics.floorAssignments;
restarting.dispatch('ending-restart', 'click');
assert.equal(restarting.qa.state.ending, null, 'restart discards the old cinematic');
assert.equal(restarting.qa.state.won, false);
assert.equal(restarting.qa.state.level, 0);
assert.equal(restarting.qa.state.found.size, 0);
assert.equal(pendingVideo.paused, true, 'restart pauses the video');
assert.equal(pendingVideo.currentTime, 0, 'restart rewinds the video');
assert.equal(restarting.renderer.tvVideo, null, 'restart releases the renderer video source');
assert.ok(restarting.metrics.floorAssignments > floorAssignments, 'restart resets the floor camera');
assert.equal(restarting.getNode('ending-overlay').hidden, true);
assert.equal(restarting.getNode('game-dialog').open, false);
resolvePlay(); await flushMedia(); advance(restarting, 12);
assert.equal(restarting.qa.state.ending, null, 'stale playback completion cannot resurrect the old ending');
assert.equal(restarting.renderer.tvVideo, null);
assert.equal(restarting.getNode('game-dialog').open, false, 'old cinematic cannot reopen results in the new run');
console.log('PASS: autoplay retry and early restart clean up media, camera, UI and stale asynchronous playback');

for (const hz of [60, 120, 144, 240]) {
  const capped = startEnding().run;
  advance(capped, .5, 1000 / hz); capped.resetMetrics();
  const bankedEnergy = capped.qa.state.energy, bankedTime = capped.qa.state.elapsed;
  advance(capped, 2, 1000 / hz);
  assert.ok(capped.metrics.draws >= 117 && capped.metrics.draws <= 121, `${hz}Hz display keeps the cinematic near the sixty-fps cap`);
  assert.equal(capped.getPendingRaf(), 1, 'cinematic keeps a single animation loop');
  assert.equal(capped.qa.state.energy, bankedEnergy);
  assert.equal(capped.qa.state.elapsed, bankedTime);
}
const failed = createGameHarness(); failed.qa.begin(); failed.qa.state.energy = .01; failed.stepFrame(100);
assert.equal(failed.qa.state.failed, true);
assert.equal(failed.qa.finishRun(), false, 'failure cannot launch a winning cinematic');
assert.equal(failed.qa.state.ending, null);
assert.equal(failed.getNode(videoId).playCalls, 0, 'failure never starts TV decoding');
console.log('PASS: cinematic sixty-fps cap at all refresh rates, one animation loop and failure guards');
