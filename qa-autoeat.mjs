import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createGameHarness } from './qa-pathing.mjs';

const near = (actual, expected, message, tolerance = .000001) => assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: expected ${expected}, got ${actual}`);
const step = (run, seconds, frameMs = 1000 / 60) => { const end = run.getTime() + seconds * 1000; while (run.getTime() < end - 1e-7) run.stepFrame(Math.min(frameMs, end - run.getTime())); };
function approach(world, snack) {
  for (let x = Math.floor((snack.x - 1.15) * 2) / 2; x <= snack.x + 1.15; x += .5) for (let y = Math.floor((snack.y - 1.15) * 2) / 2; y <= snack.y + 1.15; y += .5) {
    if (world.isWalkable(x, y, world.playerRadius, snack.level) && world.getRoom(x, y, snack.level)?.id === snack.room && Math.hypot(x - snack.x, y - snack.y) <= world.collectionRadius) return { x, y };
  }
  assert.fail(`no safe collection fixture for ${snack.id}`);
}
function pick(run, snack) {
  if (run.qa.state.level !== snack.level) run.qa.changeFloor(snack.level, run.world.floors[snack.level].stair || run.world.floors[snack.level].doors[0]);
  Object.assign(run.qa.state.player, approach(run.world, snack)); run.qa.state.discovered.add(snack.id); run.qa.collect(snack);
  assert.ok(run.qa.state.found.has(snack.id));
}
// Synthetic high-value meals below deliberately stress arithmetic beyond the
// live 16–29 energy balance. Integration fixtures use actual snack kinds.
function supplySynthetic(run, energies) {
  run.qa.state.bag = []; run.qa.state.haulCounts = {}; run.qa.state.found = new Set(); run.qa.state.consumedCount = 0;
  energies.forEach((energy, index) => {
    const kind = run.world.snackKinds.find(item => item.energy === energy) || run.world.snackKinds[index % run.world.snackKinds.length];
    const snack = { ...kind, id: `test-food-${index}-${energy}`, kind: kind.id, energy, level: 0 };
    run.qa.state.bag.push(snack); run.qa.state.found.add(snack.id); run.qa.state.haulCounts[snack.kind] = (run.qa.state.haulCounts[snack.kind] || 0) + 1;
  });
}
function supplyKinds(run, ids) {
  const kinds = ids.map(id => run.world.snackKinds.find(kind => kind.id === id));
  assert.ok(kinds.every(Boolean), 'integration bag uses declared snack kinds');
  supplySynthetic(run, kinds.map(kind => kind.energy));
}
function reconcile(qa) { assert.equal(qa.state.bag.length + qa.state.consumedCount, qa.state.found.size, 'picked food is either still carried or already eaten'); assert.equal(Object.values(qa.state.haulCounts).reduce((sum, count) => sum + count, 0), qa.state.bag.length, 'per-kind carried counts match the bag'); }

const run = createGameHarness({ seed: 103 }), { qa, world } = run;
assert.equal(typeof qa.autoEat, 'function'); assert.equal(typeof qa.spendEnergy, 'function');
assert.equal(qa.state.bag.length, 0); assert.equal(qa.state.consumedCount, 0); assert.equal(qa.state.bankedCount, 0);
const snack = world.snacks.find(item => item.level === 0);
qa.state.energy = 95; pick(run, snack);
near(qa.state.energy, 95, 'a pickup does not waste energy by eating into a nearly full meter');
assert.equal(qa.state.bag.length, 1); assert.equal(qa.state.consumedCount, 0); reconcile(qa);
const savedId = snack.id, beforeDuplicate = qa.state.bag.length;
qa.collect(snack); assert.equal(qa.state.bag.length, beforeDuplicate, 'a picked snack cannot enter the bag twice');
qa.spendEnergy(snack.energy - 5 - .01);
near(qa.state.energy, 100 - snack.energy + .01, 'food remains carried just before its exact threshold');
assert.equal(qa.state.bag.length, 1);
qa.spendEnergy(.01);
near(qa.state.energy, 100, 'crossing the exact threshold uses the entire refill');
assert.equal(qa.state.bag.length, 0); assert.equal(qa.state.consumedCount, 1); reconcile(qa);
assert.ok(qa.state.found.has(savedId), 'eating never forgets the picked ID');
qa.collect(snack); assert.equal(qa.state.bag.length, 0, 'eaten food cannot be picked from the world again');
const labels = [], context = new Proxy({}, { get(target, key) { if (key === 'fillText') return text => labels.push(String(text)); if (key === 'measureText') return text => ({ width: String(text).length * 6 }); return key in target ? target[key] : () => {}; }, set(target, key, value) { target[key] = value; return true; } });
const sandbox = { window: { HSWorld: world, devicePixelRatio: 1 }, console }; vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist/renderer.js'), 'utf8'), sandbox);
const renderer = new sandbox.window.MansionRenderer({ getBoundingClientRect: () => ({ width: 1000, height: 700, left: 0, top: 0 }), getContext: () => context }, world);
renderer.snack(snack, qa.state, 0); assert.equal(labels.length, 0, 'the actual world renderer never draws an eaten pickup again');
console.log('PASS: pickups enter a bag, exact refill thresholds avoid overflow, counts reconcile and eaten food never respawns');

qa.restart(); qa.begin(); supplySynthetic(run, [20, 30, 36]); qa.state.energy = 70;
const eaten = qa.autoEat(false);
assert.equal(eaten.length, 1); assert.equal(eaten[0].energy, 30, 'the largest snack that fits wins over bag order');
near(qa.state.energy, 100, 'mixed bag refill uses full energy');
assert.deepEqual(Array.from(qa.state.bag, item => item.energy), [20, 36]); reconcile(qa);
qa.state.energy = 40; const multiple = qa.autoEat(false);
assert.deepEqual(Array.from(multiple, item => item.energy), [36, 20], 'a larger deficit can consume multiple full refills');
near(qa.state.energy, 96, 'multiple full meals leave unused meter space instead of overflow'); reconcile(qa);

qa.restart(); qa.begin(); supplySynthetic(run, [20, 36]);
near(qa.spendEnergy(50), 50, 'spending reports the actual energy paid');
near(qa.state.energy, 70, 'a long cost eats the small snack at its earlier threshold');
assert.deepEqual(Array.from(qa.state.bag, item => item.energy), [36], 'long-frame costs preserve threshold order rather than consuming a later large snack');
const normal = createGameHarness(), slow = createGameHarness();
for (const current of [normal, slow]) { current.qa.begin(); supplyKinds(current, ['soda', 'chips', 'donut', 'pizza']); }
for (let i = 0; i < 160; i++) normal.qa.spendEnergy(.5);
slow.qa.spendEnergy(80);
near(normal.qa.state.energy, slow.qa.state.energy, 'split and long costs use the same energy');
assert.equal(normal.qa.state.consumedCount, slow.qa.state.consumedCount, 'split and long costs eat the same amount');
assert.deepEqual(Array.from(normal.qa.state.bag, item => item.energy), Array.from(slow.qa.state.bag, item => item.energy), 'split and long costs leave the same food');
console.log('PASS: mixed-bag largest-fit selection, multiple full refills and chronological long-cost thresholds');

const smallestRefill = world.snackKinds.find(kind => kind.id === 'soda').energy;
const largestRefill = world.snackKinds.find(kind => kind.id === 'pizza').energy;
qa.restart(); qa.begin(); supplyKinds(run, ['soda']); qa.state.energy = 2;
near(qa.spendEnergy(4), 4, 'a carried snack can pay a cost that exceeds the starting meter');
near(qa.state.energy, smallestRefill - 2, 'automatic eating rescues the meter before the four-energy conversation cost');
assert.equal(qa.state.consumedCount, 1); reconcile(qa);
qa.restart(); qa.begin(); supplyKinds(run, ['soda', 'pizza']);
near(qa.spendEnergy(1000), world.rules.startEnergy + smallestRefill + largestRefill, 'an unaffordable cost spends only the total available energy');
near(qa.state.energy, 0, 'exhaustion never creates negative energy or discards remaining debt as a refill');
assert.equal(qa.state.bag.length, 0); assert.equal(qa.state.consumedCount, 2); reconcile(qa);
run.stepFrame(100); assert.equal(qa.state.failed, true, 'once carried food is exhausted, the real frame ends the run');
assert.equal(qa.finishRun(), false, 'death cannot bank empty food history');

qa.restart(); supplyKinds(run, ['soda']); qa.state.energy = 10;
assert.equal(qa.autoEat().length, 0, 'a new unstarted run does not consume carried fixtures');
qa.begin(); qa.openPause(); const paused = JSON.stringify({ bag: qa.state.bag, energy: qa.state.energy, consumed: qa.state.consumedCount });
assert.equal(qa.autoEat().length, 0); assert.equal(qa.spendEnergy(10), 0); step(run, 4);
assert.equal(JSON.stringify({ bag: qa.state.bag, energy: qa.state.energy, consumed: qa.state.consumedCount }), paused, 'menus freeze both food and energy');
qa.closeDialog(); qa.autoEat(false); near(qa.state.energy, 10 + smallestRefill, 'explicit resume allows the hungry player to eat');
console.log('PASS: carried food rescues conversation-sized costs, total-resource exhaustion fails, and pause freezes automatic eating');

qa.restart(); qa.begin(); supplyKinds(run, ['soda', 'chips', 'pizza']); qa.state.energy = 100;
qa.spendEnergy(smallestRefill); assert.equal(qa.state.consumedCount, 1); assert.equal(qa.state.bag.length, 2);
qa.state.leftHome = true; Object.assign(qa.state.player, world.home);
assert.equal(qa.finishRun(), true); assert.equal(qa.state.bankedCount, 2, 'banking scores food still in the bag, not every pickup');
const recordKey = 'high-and-seek-best-haul-v2', record = JSON.parse(run.storage.get(recordKey));
assert.equal(record.score, 2); assert.equal(run.storage.has('high-and-seek-best-haul-v1'), false, 'the new scoring mode does not overwrite older haul records');
const banked = JSON.stringify({ bag: qa.state.bag, energy: qa.state.energy, consumed: qa.state.consumedCount, score: qa.state.bankedCount });
assert.equal(qa.autoEat().length, 0); assert.equal(qa.spendEnergy(100), 0); step(run, 10);
assert.equal(JSON.stringify({ bag: qa.state.bag, energy: qa.state.energy, consumed: qa.state.consumedCount, score: qa.state.bankedCount }), banked, 'the ending freezes score, bag and consumption');
qa.restart(); assert.equal(qa.state.bag.length, 0); assert.equal(qa.state.consumedCount, 0); assert.equal(qa.state.bankedCount, 0); assert.equal(qa.state.found.size, 0);
assert.equal(run.storage.get(recordKey), JSON.stringify(record), 'restart retains the banked record');

const empty = createGameHarness(); empty.qa.begin(); supplyKinds(empty, ['soda']); empty.qa.state.energy = 100 - smallestRefill; empty.qa.autoEat(false); empty.qa.state.leftHome = true;
Object.assign(empty.qa.state.player, empty.world.home); assert.equal(empty.qa.state.found.size, 1); assert.equal(empty.qa.state.bag.length, 0);
assert.equal(empty.qa.canFinishRun(), false, 'an entirely eaten haul cannot be banked even with pickup history');
console.log('PASS: remaining-food scoring, banked snapshot, separate records, empty-bag guard and clean restart');

const talking = createGameHarness(); talking.qa.begin(); talking.qa.changeFloor(1, talking.world.floors[1].stair);
const guest = talking.qa.state.guests[0]; Object.assign(talking.qa.state.player, { x: guest.x, y: guest.y }); talking.qa.state.talkCooldown = 0;
assert.equal(talking.qa.checkConversation(), true); supplyKinds(talking, ['soda']);
const beforeEscapeEnergy = 100 - smallestRefill + 2;
talking.qa.state.energy = beforeEscapeEnergy;
for (let press = 0; press < 11; press++) talking.qa.interact();
near(talking.qa.state.energy, beforeEscapeEnergy, 'the first eleven escape taps charge no energy');
assert.equal(talking.qa.state.bag.length, 1);
talking.qa.interact();
assert.equal(talking.qa.state.conversation, null, 'the actual twelfth escape tap ends the conversation');
near(talking.qa.state.energy, 98, 'the final escape cost crosses the threshold and auto-eats carried food');
assert.equal(talking.qa.state.bag.length, 0); assert.equal(talking.qa.state.consumedCount, 1); assert.equal(talking.qa.state.failed, false); reconcile(talking.qa);

const cross = createGameHarness(), groundFood = cross.world.snacks.find(item => item.level === 0);
pick(cross, groundFood); assert.equal(cross.qa.state.bag.length, 1);
cross.qa.changeFloor(1, cross.world.floors[1].stair); cross.qa.spendEnergy(groundFood.energy);
near(cross.qa.state.energy, 100, 'food carried upstairs still provides its full refill');
assert.equal(cross.qa.state.bag.length, 0); assert.ok(cross.qa.state.found.has(groundFood.id)); reconcile(cross.qa);

const nico = createGameHarness(); nico.qa.begin(); nico.qa.changeFloor(2, { x: 6, y: 4.5 });
const sharedFood = nico.world.snacks.find(item => item.level === 2 && item.room === 'snackerDen');
nico.qa.state.energy = 10; pick(nico, sharedFood);
assert.equal(nico.qa.state.bag.length, 0); assert.ok(nico.qa.state.found.has(sharedFood.id), 'auto-eaten wing food remains ever-picked');
Object.assign(nico.qa.state.wing.eater, { target: sharedFood.id, status: 'eating', eatTimer: 2.45, activated: true });
nico.stepFrame(100);
assert.equal(nico.qa.state.wing.consumed.has(sharedFood.id), false, 'Nico cannot consume food already picked and auto-eaten by the player');
assert.notEqual(nico.qa.state.wing.eater.target, sharedFood.id, 'the roaming eater abandons the unavailable picked ID');
console.log('PASS: actual mash escape auto-refill, cross-floor carried food and Nico/player no-double-consumption guard');
