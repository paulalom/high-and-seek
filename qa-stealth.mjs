import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createGameHarness } from './qa-pathing.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const near = (actual, expected, message, tolerance = .03) => assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} vs ${expected}`);
function fixture(point = { x: 15, y: 11 }) {
  const sandbox = { window: {}, console }; vm.createContext(sandbox);
  for (const file of ['world.js', 'stealth.js']) vm.runInContext(fs.readFileSync(path.join(root, 'dist', file), 'utf8'), sandbox);
  const world = sandbox.window.HSWorld; world.activateFloor(world.midnight.level);
  const engine = sandbox.window.HSStealth.create(world), runtime = engine.getState();
  const state = { level: world.midnight.level, started: true, paused: false, won: false, failed: false, hidden: false, energy: 100,
    player: { ...point, level: world.midnight.level, moving: false }, wing: { dog: { happy: true, following: true, moving: true } }, conversation: null };
  assert.ok(world.isWalkable(point.x, point.y, .22, state.level), 'fixture begins on a real walkable floor');
  return { world, engine, runtime, state, events: [] };
}
function inSnug(world, point) {
  const room = world.floors.find(floor => floor.id === world.home.level).rooms.find(room => room.id === world.home.room);
  return point.x >= room.x && point.x <= room.x + room.w && point.y >= room.y && point.y <= room.y + room.h;
}
function tick(f, seconds = .05, activity = {}) {
  f.engine.update(seconds, f.state, activity); f.events.push(...f.engine.drainEvents());
  const resident = f.runtime.resident;
  assert.ok(f.world.isWalkable(resident.x, resident.y, .26, f.world.midnight.level), 'investigator never clips through real walls or furniture');
  assert.equal(inSnug(f.world, resident), false, 'resident stays outside the entire TV snug');
  assert.ok(Number.isFinite(f.runtime.noise) && f.runtime.noise >= 0 && f.runtime.noise <= 100, 'noise is finite and clamped');
}
function advance(f, seconds, activity = {}, dt = .05) {
  for (let left = seconds; left > .000001; left -= dt) tick(f, Math.min(left, dt), activity);
}
function advanceApp(run, seconds, dt = 1000 / 60) {
  const end = run.getTime() + seconds * 1000;
  while (run.getTime() < end - .000001) run.stepFrame(Math.min(dt, end - run.getTime()));
}
function safeRoomPoint(world, roomId) {
  const room = world.rooms.find(room => room.id === roomId), candidates = [];
  for (let x = Math.ceil((room.x + .5) * 2) / 2; x < room.x + room.w - .3; x += .5) for (let y = Math.ceil((room.y + .5) * 2) / 2; y < room.y + room.h - .3; y += .5) {
    if (world.isWalkable(x, y, .26, world.midnight.level)) candidates.push({ x, y });
  }
  assert.ok(candidates.length, `${roomId} has walkable searching positions`);
  return candidates[Math.floor(candidates.length / 2)];
}

const quiet = fixture(), { engine, runtime, state, world } = quiet;
assert.equal(typeof engine.changeFloor, 'function'); assert.equal(typeof engine.endLecture, 'function');
assert.equal(runtime.noise, 0); assert.equal(runtime.resident.sleeping, true);
advance(quiet, 12);
assert.equal(runtime.noise, 0, 'a motionless player and moving fed Waffles do not make house noise');
assert.equal(runtime.resident.sleeping, true, 'quiet Waffles never wakes the resident');
for (const room of ['laundry', 'wardrobe', 'attic', 'terrace']) {
  const f = fixture(safeRoomPoint(world, room)); f.engine.makeNoise('rummage', f.state); tick(f, .01);
  assert.ok(f.runtime.noise > 0, `rummaging makes noise in the ${room}`);
}
const walk = fixture(), sprint = fixture(); walk.runtime.noise = sprint.runtime.noise = 30;
tick(walk, .1, { distance: 1, sprinting: false }); tick(sprint, .1, { distance: 1, sprinting: true });
assert.ok(sprint.runtime.noise > walk.runtime.noise + 6, 'sprinting is substantially louder than the same walked distance');
advance(walk, 2); assert.ok(walk.runtime.noise < 25, 'suspicion settles when the player is quiet');
const bumps = fixture();
for (let i = 0; i < 100; i++) bumps.engine.makeNoise('bump', bumps.state);
assert.ok(bumps.runtime.noise <= 12.001, 'a held collision cannot allocate noise every frame');
advance(bumps, .95); const beforeNextBump = bumps.runtime.noise; bumps.engine.makeNoise('bump', bumps.state);
assert.ok(bumps.runtime.noise > beforeNextBump, 'a later distinct bump still matters');
const noOp = JSON.stringify(quiet.runtime);
engine.makeNoise(NaN, state); engine.makeNoise(Infinity, state); engine.makeNoise(-5, state);
assert.equal(JSON.stringify(quiet.runtime), noOp, 'invalid noise inputs have no effect');
console.log('PASS: whole-wing noise, quiet fed Waffles, walk/sprint contrast, natural decay and bounded bumps');

const masked = fixture({ x: 6.5, y: 4 }), exposed = fixture({ x: 6.5, y: 4 });
advance(exposed, 6.1); masked.engine.makeNoise('rummage', masked.state); exposed.engine.makeNoise('rummage', exposed.state);
assert.ok(masked.runtime.noise < exposed.runtime.noise * .5, 'spinning laundry machines mask nearby rummaging');
const rug = fixture({ x: 15, y: 7.5 }), plain = fixture({ x: 15, y: 11 }); rug.runtime.noise = plain.runtime.noise = 30;
tick(rug, .1, { distance: 1, sprinting: false }); tick(plain, .1, { distance: 1, sprinting: false });
assert.ok(rug.runtime.noise < plain.runtime.noise, 'wardrobe rugs soften footsteps');
for (const point of [{ x: 24.5, y: 3.5 }, { x: 14.5, y: 16.5 }]) {
  const noisy = fixture(point), baseline = fixture(); noisy.runtime.noise = baseline.runtime.noise = 20;
  tick(noisy, .05, { distance: .3, sprinting: false }); tick(baseline, .05, { distance: .3, sprinting: false });
  assert.ok(noisy.runtime.noise > baseline.runtime.noise + 5, 'marked creaky boards and terrace clutter are noisier than clear flooring');
}
const warning = fixture(); warning.engine.makeNoise(51, warning.state); tick(warning, .01);
assert.equal(warning.events.filter(event => event.type === 'warning').length, 1, 'first warning is emitted once');
advance(warning, .5); assert.equal(warning.events.filter(event => event.type === 'warning').length, 1, 'warning does not spam each frame');
advance(warning, 4); warning.engine.makeNoise(45, warning.state); tick(warning, .01);
assert.equal(warning.events.filter(event => event.type === 'warning').length, 2, 'warning rearms after suspicion subsides');
console.log('PASS: washer timing, quiet rugs, creaky boards, clinking terrace and warning hysteresis');

const investigation = fixture({ x: 22, y: 11 });
investigation.engine.makeNoise(86, investigation.state); tick(investigation, .01);
assert.equal(investigation.runtime.resident.sleeping, false, 'loud noise wakes Mara');
assert.ok(['investigating', 'searching'].includes(investigation.runtime.mode));
const heard = { ...investigation.runtime.lastNoise };
Object.assign(investigation.state.player, { x: 10, y: 11 }); tick(investigation, .05);
assert.ok(investigation.runtime.resident.target, 'investigator has a remembered destination');
near(investigation.runtime.resident.target.x, heard.x, 'a distant unseen player does not move the heard destination');
near(investigation.runtime.resident.target.y, heard.y, 'last-noise destination remains grounded');
advance(investigation, 35);
assert.equal(investigation.events.filter(event => event.type === 'caught').length, 0, 'an unseen player outside the heard area is not caught remotely');
assert.equal(investigation.runtime.resident.sleeping, true, 'an unsuccessful search returns the resident to bed');
assert.ok(investigation.runtime.stats.pathBuilds <= 1, 'investigation reuses a static collision grid');
assert.ok(investigation.runtime.stats.pathQueries <= 150, 'investigation route refresh remains bounded');
const caught = fixture(); Object.assign(caught.runtime.resident, { x: 15.6, y: 11 });
caught.engine.makeNoise(86, caught.state); tick(caught, .01);
assert.equal(caught.runtime.mode, 'scolding');
assert.equal(caught.events.filter(event => event.type === 'caught').length, 1, 'close sightline produces one lecture request');
advance(caught, 2); assert.equal(caught.events.filter(event => event.type === 'caught').length, 1, 'scolding never queues additional catches');
caught.engine.endLecture(caught.state); near(caught.runtime.noise, 25, 'lecture release lowers the meter');
advance(caught, 1); assert.equal(caught.events.filter(event => event.type === 'caught').length, 1, 'release cooldown allows the player to leave');
console.log('PASS: last-heard investigation, collision-aware search/return, finite path budget, capture and release cooldown');

const sanctuary = fixture(); sanctuary.engine.makeNoise(100, sanctuary.state); tick(sanctuary, .01);
const snug = world.rooms.find(room => room.id === world.home.room);
for (const point of [{ x: snug.x + .6, y: snug.y + 5 }, safeRoomPoint(world, world.home.room), { x: world.home.x, y: world.home.y }]) {
  if (!world.isWalkable(point.x, point.y, .22, state.level)) continue;
  Object.assign(sanctuary.state.player, point); const score = sanctuary.state.energy;
  sanctuary.engine.makeNoise(1000, sanctuary.state); advance(sanctuary, 3, { distance: 1, sprinting: true });
  assert.equal(sanctuary.runtime.safe, true); assert.equal(sanctuary.runtime.noise, 0, 'all parts of the TV snug suppress player noise');
  assert.equal(sanctuary.events.filter(event => event.type === 'caught').length, 0, 'the snug is a sanctuary even during an active search');
  assert.equal(sanctuary.state.energy, score, 'investigator engine never charges player energy or food');
}
for (const patch of [{ paused: true }, { started: false }, { failed: true }, { won: true }, { hidden: true }, { level: 1 }]) {
  const f = fixture(); f.engine.makeNoise(65, f.state); tick(f, .01); const before = JSON.stringify(f.runtime), original = { ...f.state };
  Object.assign(f.state, patch); advance(f, 2, { distance: 1, sprinting: true }); f.engine.makeNoise('rummage', f.state);
  assert.equal(JSON.stringify(f.runtime), before, 'inactive state freezes both noise and resident'); Object.assign(f.state, original);
}
const reference = sanctuary.runtime; sanctuary.engine.reset(); assert.equal(sanctuary.engine.getState(), reference, 'restart preserves the shared runtime reference');
assert.equal(reference.noise, 0); assert.equal(reference.resident.sleeping, true);
sanctuary.engine.makeNoise(90, sanctuary.state); sanctuary.engine.changeFloor(1, world.floors[1].stair, sanctuary.state);
assert.equal(reference.noise, 0); assert.equal(reference.resident.sleeping, true, 'leaving the wing cancels an investigation');
console.log('PASS: entire TV snug safety, pause/hidden/off-area freeze, no score damage, stable reset and departure cleanup');

const app = createGameHarness({ guestBrainEnabled: false }), game = app.qa;
assert.equal(typeof game.startResidentLecture, 'function'); assert.equal(typeof game.handleStealthEvents, 'function');
game.begin(); game.changeFloor(app.world.midnight.level, { x: 15, y: 11 }); advanceApp(app, .05);
Object.assign(game.state.stealth.resident, { x: 15.55, y: 11 }); game.stealthSimulation.makeNoise(100, game.state); advanceApp(app, .05);
assert.equal(game.state.conversation?.kind, 'resident', 'real engine catch starts the actual resident conversation');
const lecture = game.state.conversation; assert.equal(lecture.unskippable, true); assert.equal(lecture.duration, 6);
const startPosition = { x: game.state.player.x, y: game.state.player.y }, line = lecture.line, energyAtStart = game.state.energy, clockAtStart = game.state.elapsed;
const press = value => { app.dispatch('window', 'keydown', { key: value, repeat: false, target: { closest: () => null }, preventDefault() {} }); app.dispatch('window', 'keyup', { key: value }); };
for (let tap = 0; tap < 30; tap++) { press(tap % 2 ? 'e' : ' '); app.dispatch('mobile-grab', 'click'); }
assert.equal(game.state.conversation, lecture); assert.equal(lecture.line, line, 'input cannot skip the lecture dialogue');
assert.equal(game.excuseConversation(), false, 'the upstairs mash-to-escape API cannot bypass the resident');
app.dispatch('window', 'keydown', { key: 'd', repeat: false, target: { closest: () => null }, preventDefault() {} }); advanceApp(app, 2);
app.dispatch('window', 'keyup', { key: 'd' });
near(game.state.player.x, startPosition.x, 'lecture locks horizontal movement'); near(game.state.player.y, startPosition.y, 'lecture locks vertical movement');
assert.equal(app.getNode('mobile-grab').disabled, true); assert.equal(app.getNode('mobile-grab').querySelector('span').textContent, 'LISTEN');
const remainingAtPause = lecture.remaining; game.openPause(); advanceApp(app, 3); near(lecture.remaining, remainingAtPause, 'pause freezes six-second lecture'); game.closeDialog();
app.document.hidden = true; app.dispatch('document', 'visibilitychange'); advanceApp(app, 3); near(lecture.remaining, remainingAtPause, 'hidden tabs freeze lecture'); app.document.hidden = false; app.dispatch('document', 'visibilitychange'); game.closeDialog();
advanceApp(app, 3.9); assert.equal(game.state.conversation, lecture, 'lecturing continues until the full six active seconds');
advanceApp(app, .15); assert.equal(game.state.conversation, null, 'six active seconds releases the player automatically');
const activeTime = game.state.elapsed - clockAtStart;
near(energyAtStart - game.state.energy, app.world.rules.idleDrain * activeTime, 'lecture charges idle energy only, with no escape penalty', .04);
assert.equal(app.getNode('mobile-grab').disabled, false, 'mobile action unlocks after lecture');
assert.ok(game.state.stealth.noise <= 25 && game.state.stealth.resident.cooldown > 0, 'the actual conversation release notifies the investigator engine');
game.restart(); assert.equal(game.state.stealth.noise, 0); assert.equal(game.state.conversation, null); assert.equal(game.state.stealth.resident.sleeping, true);
console.log('PASS: actual unskippable six-second lecture, E/Space/touch lock, movement/energy, pause/visibility and restart');

const labels = [], canvasContext = new Proxy({}, { get(target, property) {
  if (property in target) return target[property];
  if (property === 'measureText') return text => ({ width: String(text).length * 6 });
  if (property === 'fillText') return text => labels.push(String(text));
  if (property === 'createLinearGradient' || property === 'createRadialGradient') return () => ({ addColorStop() {} });
  return () => {};
}, set(target, property, value) { target[property] = value; return true; } });
const renderSandbox = { window: { devicePixelRatio: 1 }, console }; vm.createContext(renderSandbox);
for (const file of ['world.js', 'stealth.js', 'renderer.js']) vm.runInContext(fs.readFileSync(path.join(root, 'dist', file), 'utf8'), renderSandbox);
const renderWorld = renderSandbox.window.HSWorld; renderWorld.activateFloor(3);
const renderNoise = renderSandbox.window.HSStealth.create(renderWorld).getState();
Object.assign(renderNoise.resident, { x: 15.6, y: 11, status: 'scolding', sleeping: false });
const renderState = { level: 3, player: { x: 15, y: 11, moving: false }, guests: [], stealth: renderNoise, found: new Set(), discovered: new Set(), energy: 100,
  conversation: { kind: 'resident', unskippable: true, guestId: renderNoise.resident.id, name: renderNoise.resident.name, line: renderNoise.resident.lines[0], duration: 6, remaining: 6, escapeRequired: 0, escapePresses: 0 } };
for (const [width, height] of [[1905, 890], [390, 844], [844, 390]]) {
  const renderer = new renderSandbox.window.MansionRenderer({ getBoundingClientRect: () => ({ width, height }), getContext: () => canvasContext }, renderWorld);
  labels.length = 0; renderer.guestSpeech(renderState, 0);
  assert.ok(labels.some(text => text.includes('LISTEN')), 'resident bubble explains the locked lecture');
  assert.ok(labels.some(text => text.includes('6.0s')), 'resident bubble shows the actual six-second countdown');
  assert.ok(labels.some(text => text.includes('No skipping')), 'resident bubble explicitly communicates the rule');
  assert.equal(labels.some(text => /Break away|NEXT LINE|TAPS|Mash E/i.test(text)), false, 'the unskippable bubble never offers an escape or dialogue shortcut');
}
const actorRenderer = new renderSandbox.window.MansionRenderer({ getBoundingClientRect: () => ({ width: 1200, height: 800 }), getContext: () => canvasContext }, renderWorld);
let actorDraws = 0; actorRenderer.resident = () => { actorDraws++; };
actorRenderer.draw(renderState, 1000); assert.equal(actorDraws, 1, 'investigator is an actor in the shared painter order');
Object.assign(renderNoise.resident, { x: renderWorld.home.x, y: renderWorld.home.y }); actorDraws = 0; actorRenderer.draw(renderState, 1001);
assert.equal(actorDraws, 0, 'a resident inside the safe TV snug is never drawn');
console.log('PASS: resident lecture UI explains six-second listening without escape controls across three viewport sizes');

for (const hz of [60, 120, 144, 240]) {
  const run = createGameHarness({ guestBrainEnabled: false }); run.qa.begin(); run.qa.changeFloor(3, { x: 15, y: 11 });
  run.qa.stealthSimulation.makeNoise(100, run.qa.state); run.resetMetrics(); advanceApp(run, 2, 1000 / hz);
  assert.ok(run.metrics.draws >= 118 && run.metrics.draws <= 121, `investigation retains sixty FPS at ${hz}Hz`);
  assert.equal(run.getPendingRaf(), 1, 'stealth adds no animation loop');
}
console.log('PASS: active investigation retains the sixty-FPS cap and single animation loop at every tested refresh rate');
