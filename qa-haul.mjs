import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGameHarness } from './qa-pathing.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const recordKey = 'high-and-seek-best-haul-v2';
function approach(world, snack) {
  let best = null, distance = Infinity;
  for (let gx = Math.floor((snack.x - 1.3) * 2); gx <= Math.ceil((snack.x + 1.3) * 2); gx++) for (let gy = Math.floor((snack.y - 1.3) * 2); gy <= Math.ceil((snack.y + 1.3) * 2); gy++) {
    const x = gx / 2, y = gy / 2, d = Math.hypot(x - snack.x, y - snack.y);
    if (d < distance && d <= world.collectionRadius && world.isWalkable(x, y) && world.getRoom(x, y)?.id === snack.room) { best = { x, y }; distance = d; }
  }
  assert.ok(best, `walkable approach exists for ${snack.id}`);
  return best;
}
function pickUp(run, snack) {
  if (run.qa.state.level !== snack.level) run.qa.changeFloor(snack.level, run.world.floors[snack.level].stair || run.world.floors[snack.level].doors[0]);
  Object.assign(run.qa.state.player, approach(run.world, snack));
  run.qa.state.discovered.add(snack.id);
  run.qa.collect(snack);
  assert.ok(run.qa.state.found.has(snack.id), `${snack.id} enters the haul`);
}
function leaveHome(run) {
  Object.assign(run.qa.state.player, { x: 10, y: 11 });
  assert.ok(run.world.isWalkable(10, 11), 'leave-home fixture is a walkable gallery point');
  run.qa.begin(); run.stepFrame(100);
  assert.equal(run.qa.state.leftHome, true, 'leaving the home room arms the return journey');
}
function arriveHome(run) {
  if (run.qa.state.level !== 0) run.qa.changeFloor(0, run.world.start);
  run.qa.navigate(run.world.home.x, run.world.home.y);
  for (let frames = 0; run.qa.getPath().length && !run.qa.state.failed && frames++ < 4000; ) run.stepFrame();
  assert.ok(run.world.isHome(run.qa.state.player.x, run.qa.state.player.y), `return route reaches the couch zone: ${JSON.stringify({ player: run.qa.state.player, energy: run.qa.state.energy, failed: run.qa.state.failed, path: run.qa.getPath().length })}`);
}

const run = createGameHarness({ seed: 52 });
const { qa, world, storage, getNode } = run;
assert.equal(typeof qa.canFinishRun, 'function');
assert.equal(typeof qa.finishRun, 'function');
assert.ok(world.isHome(qa.state.player.x, qa.state.player.y), 'the run begins by the couch and TV');
assert.equal(qa.canFinishRun(), false, 'empty starting haul cannot finish');
assert.equal(qa.finishRun(), false, 'finish is guarded at the start');
assert.equal(storage.has(recordKey), false, 'starting does not save a score');

pickUp(run, world.snacks.find(snack => snack.room === world.home.room));
Object.assign(qa.state.player, { x: world.home.x, y: world.home.y });
assert.equal(qa.finishRun(), false, 'collecting a home snack without leaving cannot bank a run');
leaveHome(run);
assert.equal(qa.canFinishRun(), false, 'being outside the couch zone blocks finishing');
assert.equal(qa.finishRun(), false, 'finishing remotely is rejected');
assert.equal(storage.has(recordKey), false, 'unbanked pickups never save a score');
arriveHome(run);
assert.equal(qa.state.won, false, 'arriving home does not end the run automatically');
assert.equal(qa.canFinishRun(), true, 'a positive partial haul can finish at home');
assert.equal(qa.finishRun(), true, 'explicit rest at the couch banks the partial haul');
assert.equal(qa.state.won, true, 'banked run ends successfully');
assert.equal(qa.state.paused, true, 'banked run freezes simulation');
assert.equal(qa.state.ending.active, true, 'banked run begins its couch cinematic');
assert.equal(getNode('game-dialog').open, false, 'banked result waits for the cinematic');
assert.equal(qa.finishRun(), false, 'banking is idempotent');
const record = JSON.parse(storage.get(recordKey));
assert.equal(record.score, 1, 'best record stores the banked snack count');
const finishedEnergy = qa.state.energy, finishedTime = qa.state.elapsed;
for (let frame = 0; frame < 120; frame++) run.stepFrame();
assert.equal(qa.state.energy, finishedEnergy, 'finished run stops energy drain');
assert.equal(qa.state.elapsed, finishedTime, 'finished run stops hunt time');
assert.equal(qa.state.ending.active, true, 'first two ending seconds remain in the cinematic');
assert.equal(getNode('game-dialog').open, false, 'the result modal does not interrupt the opening cinematic');
console.log('PASS: leave-home, positive-haul, proximity and explicit-finish guards; partial haul banking');

qa.restart();
assert.equal(qa.state.leftHome, false, 'restart disarms the return journey');
assert.equal(qa.state.found.size, 0, 'restart empties the haul');
assert.equal(qa.state.bag.length, 0, 'restart empties the carried bag');
assert.equal(qa.state.energy, world.rules.startEnergy, 'restart restores energy');
assert.equal(qa.state.won, false, 'restart clears banked state');
assert.equal(storage.get(recordKey), JSON.stringify(record), 'restart preserves the best banked record');
leaveHome(run);
pickUp(run, world.snacks.find(snack => snack.room !== world.home.room));
const recordBeforeFailure = storage.get(recordKey);
qa.state.bag.length = 0; qa.state.haulCounts = {}; qa.state.consumedCount = qa.state.found.size;
qa.state.energy = .01; run.stepFrame(100);
assert.equal(qa.state.failed, true, 'energy depletion ends an unbanked run');
Object.assign(qa.state.player, { x: world.home.x, y: world.home.y });
assert.equal(qa.finishRun(), false, 'an exhausted player cannot bank a haul');
assert.equal(storage.get(recordKey), recordBeforeFailure, 'lost stash does not overwrite the best banked record');
console.log('PASS: depletion loses the unbanked haul without changing the saved score');

const full = createGameHarness({ seed: 6 });
leaveHome(full);
for (const snack of full.world.snacks) { full.qa.state.energy = full.world.rules.maxEnergy; pickUp(full, snack); }
assert.equal(full.qa.state.found.size, full.world.snacks.length);
assert.equal(full.qa.state.won, false, 'collecting the entire hidden pool never auto-finishes');
full.qa.state.energy = full.world.rules.maxEnergy; arriveHome(full);
assert.equal(full.qa.state.won, false, 'even an entire world haul still needs a couch interaction');
assert.equal(full.qa.finishRun(), true);
console.log('PASS: no fixed collect-all victory condition remains');

for (const control of ['keyboard', 'touch']) {
  const interactive = createGameHarness({ seed: 33 });
  leaveHome(interactive);
  for (const snack of interactive.world.snacks.filter(snack => snack.level === 0 && snack.room !== interactive.world.home.room).slice(0, 3)) pickUp(interactive, snack);
  interactive.dispatch('home-button', 'click');
  assert.ok(interactive.qa.getPath().length, 'return button creates a walking route');
  assert.equal(interactive.qa.state.won, false, 'return button never banks a haul remotely');
  for (let frames = 0; interactive.qa.getPath().length && frames++ < 4000; ) interactive.stepFrame();
  assert.ok(interactive.world.isHome(interactive.qa.state.player.x, interactive.qa.state.player.y));
  assert.ok(interactive.qa.state.bag.length > 0, 'return fixture retains food after automatic refueling');
  assert.equal(interactive.qa.state.won, false, 'return-button arrival remains an active run');
  if (control === 'keyboard') interactive.dispatch('window', 'keydown', { key: 'e', repeat: false, target: { closest: () => null }, preventDefault() {} });
  else interactive.dispatch('mobile-grab', 'click');
  assert.equal(interactive.qa.state.won, true, `${control} interaction explicitly banks the haul at home`);
}
console.log('PASS: return button walks home without remote banking; keyboard and touch finish at the couch');

function bankFixture(score, elapsed) {
  const scored = createGameHarness({ seed: 104, storage });
  leaveHome(scored);
  for (const snack of scored.world.snacks.slice(0, score)) pickUp(scored, snack);
  Object.assign(scored.qa.state.player, { x: scored.world.home.x, y: scored.world.home.y });
  scored.stepFrame(100); scored.qa.state.elapsed = elapsed;
  assert.equal(scored.qa.finishRun(), true);
  return JSON.parse(storage.get(recordKey));
}
assert.equal(bankFixture(2, 100).score, 2, 'larger banked haul beats a faster smaller one');
assert.deepEqual(bankFixture(1, 1), { score: 2, elapsed: 100 }, 'lower score cannot replace a larger banked haul');
assert.deepEqual(bankFixture(2, 120), { score: 2, elapsed: 100 }, 'slower tied score leaves the record intact');
assert.deepEqual(bankFixture(2, 80), { score: 2, elapsed: 80 }, 'faster tied score improves the banked record');
console.log('PASS: best haul persists by snack count with elapsed time breaking ties');

const map = createGameHarness({ seed: 8 });
map.qa.openMap();
assert.doesNotMatch(map.getNode('dialog-content').innerHTML, /\b\d+\s*\/\s*\d+\b/, 'room map does not expose snack counts');
assert.ok(map.miniMapTiles.every(tile => !tile.classList.contains('cleared')), 'minimap does not reveal cleared room status');
const labels = [], context = new Proxy({}, { get(target, name) { if (name === 'fillText') return text => labels.push(String(text)); if (name === 'measureText') return text => ({ width: String(text).length * 6 }); if (name in target) return target[name]; return () => {}; }, set(target, name, value) { target[name] = value; return true; } });
const sandbox = { window: { HSWorld: map.world, devicePixelRatio: 1 }, console };
vm.createContext(sandbox); vm.runInContext(fs.readFileSync(path.join(root, 'dist/renderer.js'), 'utf8'), sandbox);
const renderer = new sandbox.window.MansionRenderer({ getBoundingClientRect: () => ({ width: 1366, height: 768, left: 0, top: 0 }), getContext: () => context }, map.world);
for (const room of map.world.rooms) renderer.roomLabel(room, true, map.qa.state);
assert.ok(labels.length >= map.world.rooms.length, 'actual room label renderer was exercised');
assert.ok(labels.every(text => !/\d/.test(text)), `world room labels expose names, not counts: ${labels.join(', ')}`);
const html = fs.readFileSync(path.join(root, 'dist/index.html'), 'utf8');
assert.doesNotMatch(html, /find all (?:eight|8)|\/\s*8\b/i, 'HUD does not expose a fixed eight-snack target');
console.log('PASS: rendered room labels, map and mission HUD hide snack totals');
