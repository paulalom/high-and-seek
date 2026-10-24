import assert from 'node:assert/strict';
import { createGameHarness } from './qa-pathing.mjs';

const near = (actual, expected, message, tolerance = .0001) => assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: expected ${expected}, got ${actual}`);
const advance = (harness, seconds) => {
  const count = Math.ceil(seconds * 60);
  for (let i = 0; i < count; i++) harness.stepFrame(seconds * 1000 / count);
};
function approach(world, snack) {
  let best = null, distance = Infinity;
  for (let gx = Math.floor((snack.x - 1.3) * 2); gx <= Math.ceil((snack.x + 1.3) * 2); gx++) for (let gy = Math.floor((snack.y - 1.3) * 2); gy <= Math.ceil((snack.y + 1.3) * 2); gy++) {
    const x = gx / 2, y = gy / 2, d = Math.hypot(x - snack.x, y - snack.y);
    if (d <= world.collectionRadius && d < distance && world.isWalkable(x, y) && world.getRoom(x, y)?.id === snack.room) {
      best = { x, y }; distance = d;
    }
  }
  assert.ok(best, `walkable collection point exists for ${snack.id}`);
  return best;
}

const harness = createGameHarness({ seed: 44 });
const { qa, world, getNode } = harness;
const rules = world.rules;
assert.ok(rules, 'world declares energy and difficulty rules');
near(qa.state.energy, rules.startEnergy, 'new hunt starts with expected energy');
advance(harness, 2);
near(qa.state.energy, rules.startEnergy, 'energy does not drain before the hunt starts');
qa.begin();
const beforeIdle = qa.state.energy;
advance(harness, 5);
near(qa.state.energy, beforeIdle - rules.idleDrain * 5, 'started hunt drains energy while idle');

qa.restart(); Object.assign(qa.state.player, { x: 10, y: 11 }); qa.begin();
const beforeWalk = { energy: qa.state.energy, x: qa.state.player.x, y: qa.state.player.y };
qa.keys.add('d'); advance(harness, .15); qa.keys.clear();
const walkDistance = Math.hypot(qa.state.player.x - beforeWalk.x, qa.state.player.y - beforeWalk.y);
assert.ok(walkDistance > 0, 'walking actually changes position');
near(qa.state.energy, beforeWalk.energy - rules.idleDrain * .15 - walkDistance * rules.distanceDrain, 'walking drains energy per distance travelled', .001);
qa.restart(); Object.assign(qa.state.player, { x: 10, y: 11 }); qa.begin();
const beforeSprint = { energy: qa.state.energy, x: qa.state.player.x, y: qa.state.player.y };
qa.keys.add('d'); qa.keys.add('shift'); advance(harness, .15); qa.keys.clear();
const sprintDistance = Math.hypot(qa.state.player.x - beforeSprint.x, qa.state.player.y - beforeSprint.y);
assert.ok(sprintDistance > walkDistance, 'sprinting is faster than walking');
near(qa.state.energy, beforeSprint.energy - rules.idleDrain * .15 - sprintDistance * rules.distanceDrain * rules.sprintDrainMultiplier, 'sprinting pays its declared extra energy cost', .001);
assert.ok(beforeSprint.energy - qa.state.energy > rules.idleDrain * .15 + walkDistance * rules.distanceDrain, 'sprinting costs more energy than walking');

qa.restart();
const snack = world.snacks[0];
Object.assign(qa.state.player, approach(world, snack));
qa.state.discovered.add(snack.id); qa.state.energy = rules.maxEnergy - 5;
qa.collect(snack);
near(qa.state.energy, rules.maxEnergy - 5, 'pickup is stored when its full refill would overflow');
assert.equal(qa.state.bag.length, 1, 'food stays in the bag until all its energy fits');
assert.equal(qa.state.consumedCount, 0);
const collectedEnergy = qa.state.energy;
qa.collect(snack);
near(qa.state.energy, collectedEnergy, 'a collected snack cannot refill energy again');
assert.ok(qa.state.found.has(snack.id), 'stored snack is marked collected');

qa.restart();
const refillSnack = world.snacks[1];
Object.assign(qa.state.player, approach(world, refillSnack));
qa.state.discovered.add(refillSnack.id); qa.state.energy = 10;
qa.collect(refillSnack);
near(qa.state.energy, Math.min(rules.maxEnergy, 10 + refillSnack.energy), 'snacks restore their declared energy value');
assert.equal(qa.state.bag.length, 0, 'food that fits is eaten from the bag');
assert.equal(qa.state.consumedCount, 1);
qa.openPause();
const pausedEnergy = qa.state.energy;
advance(harness, 8);
near(qa.state.energy, pausedEnergy, 'pause freezes energy drain');
qa.closeDialog(); advance(harness, .2);
assert.ok(qa.state.energy < pausedEnergy, 'energy drain resumes with the hunt');

qa.restart(); qa.begin(); qa.state.energy = .01;
advance(harness, .2);
near(qa.state.energy, 0, 'depletion clamps energy to zero');
assert.equal(qa.state.failed, true, 'zero energy ends the hunt');
assert.equal(qa.state.paused, true, 'failed hunt stops simulation');
assert.equal(qa.state.won, false, 'depletion never wins the hunt');
assert.equal(getNode('game-dialog').open, true, 'depletion opens a retry dialog');
const failedFound = qa.state.found.size;
const failedSnack = world.snacks[0];
Object.assign(qa.state.player, approach(world, failedSnack)); qa.state.discovered.add(failedSnack.id);
qa.collect(failedSnack);
assert.equal(qa.state.found.size, failedFound, 'failed hunt cannot collect more snacks');
near(qa.state.energy, 0, 'failed hunt cannot refill itself');
qa.closeDialog(); advance(harness, .2);
assert.equal(qa.state.paused, true, 'closing failure dialog cannot resume an exhausted hunt');

const previousHides = world.snacks.map(item => `${item.x},${item.y}`);
qa.state.discovered = new Set(world.snacks.map(item => item.id));
qa.restart();
near(qa.state.energy, rules.startEnergy, 'restart restores initial energy');
assert.equal(qa.state.failed, false, 'restart clears failure');
assert.equal(qa.state.hints, rules.hints, 'restart restores hint charges');
assert.equal(qa.state.found.size, 0, 'restart clears collected snacks');
assert.equal(qa.state.bag.length, 0, 'restart empties carried food');
assert.equal(qa.state.consumedCount, 0, 'restart clears the eating count');
assert.ok(qa.state.discovered.size < world.snacks.length, 'restart forgets previous discoveries');
assert.ok(world.snacks.some((item, i) => `${item.x},${item.y}` !== previousHides[i]), 'restart shuffles snack hiding spots');

for (const item of world.snacks) {
  const area = world.floors[item.level], hallway = area.stair || area.doors[0];
  assert.equal(world.getRoom(hallway.x, hallway.y, item.level), null, 'the area entrance is in its connecting hallway');
  assert.equal(world.canSeeSnack(item, { x: item.x, y: item.y, level: item.level }), true, 'nearby snack in its room is visible');
  assert.equal(world.canSeeSnack(item, { x: hallway.x, y: hallway.y, level: item.level }), false, 'snacks cannot be seen from the hallway');
  assert.equal(world.canSeeSnack(item, { ...world.start, level: item.level }, item.id), true, 'a hint reveals its target regardless of distance on its floor');
  assert.equal(world.canSeeSnack(item, { x: item.x, y: item.y, level: 1 - item.level }, item.id), false, 'a hint never reveals food through the other floor');
}
assert.equal(rules.hints, 2, 'harder hunt gives two hints');
assert.ok(world.collectionRadius < 1.6, 'harder hunt requires a closer approach');
qa.hint();
assert.equal(qa.state.hints, rules.hints - 1, 'hint consumes a charge');
assert.ok(qa.state.discovered.has(qa.state.hintTarget), 'hint reveals its target snack');
qa.hint();
assert.equal(qa.state.hints, 0, 'second hint consumes the last charge');
const lastHint = qa.state.hintTarget;
qa.hint();
assert.equal(qa.state.hints, 0, 'empty hints cannot go negative');
assert.equal(qa.state.hintTarget, lastHint, 'empty hints cannot reveal another target');
console.log('PASS: idle/walking/sprint drain, deferred full-value refills, no duplicate pickup, pause, failure, restart and visibility');

// A hidden browser may suspend requestAnimationFrame entirely. Idle time before
// the hunt, and time spent paused, must not be billed on the first resumed frame.
const suspended = createGameHarness({ seed: 91 });
suspended.elapseWithoutFrame(90000);
suspended.qa.begin();
suspended.stepFrame(200);
near(suspended.qa.state.energy, suspended.world.rules.startEnergy - suspended.world.rules.idleDrain * .2, 'first activation ignores pre-hunt time without animation frames');
near(suspended.qa.state.elapsed, .2, 'pre-hunt suspension does not count toward hunt time');
suspended.qa.openPause();
const frozenEnergy = suspended.qa.state.energy, frozenTime = suspended.qa.state.elapsed;
suspended.elapseWithoutFrame(90000);
suspended.qa.closeDialog();
suspended.stepFrame(200);
near(suspended.qa.state.energy, frozenEnergy - suspended.world.rules.idleDrain * .2, 'resume ignores paused time without animation frames');
near(suspended.qa.state.elapsed, frozenTime + .2, 'paused suspension does not count toward hunt time');
assert.equal(suspended.qa.state.failed, false, 'a suspended pause cannot exhaust the player');
console.log('PASS: 90-second suspended animation before start and during pause never charges energy or hunt time');

let lowestFinish = rules.maxEnergy, lowestDuringHunt = rules.maxEnergy, highestTime = 0;
const searchSeconds = Number(process.argv[2] || process.env.QA_SEARCH_SECONDS) || 0;
for (const frameMs of [1000 / 60, 1000]) for (let seed = 1; seed <= 8; seed++) {
  const run = createGameHarness({ frameMs, seed });
  const game = run.qa, map = run.world;
  // A prudent player can bank a partial haul instead of being forced to clear
  // an undisclosed world pool. Each test leaves home, loots, then budgets return.
  const remaining = map.snacks.filter(item => item.level === 0 && item.room !== map.home.room);
  for (let pickup = 0; pickup < 8; pickup++) {
    remaining.sort((a, b) => Math.hypot(a.x - game.state.player.x, a.y - game.state.player.y) - Math.hypot(b.x - game.state.player.x, b.y - game.state.player.y));
    const target = remaining.shift();
    game.begin();
    for (let search = 0; search < Math.ceil(searchSeconds * 1000 / frameMs); search++) run.stepFrame();
    game.navigate(target.x, target.y, target);
    for (let frames = 0; frames < Math.ceil(300000 / frameMs) && !game.state.found.has(target.id) && !game.state.failed; frames++) {
      run.stepFrame();
      lowestDuringHunt = Math.min(lowestDuringHunt, game.state.energy);
      if (!game.getPath().length && !game.state.found.has(target.id)) break;
    }
    assert.ok(game.state.found.has(target.id), `seed ${seed}, ${frameMs}ms: ${target.id} reachable before energy runs out (energy ${game.state.energy})`);
  }
  assert.equal(game.state.won, false, 'looting a partial stash does not finish the run');
  game.navigate(map.home.x, map.home.y);
  for (let frames = 0; game.getPath().length && !game.state.failed && frames++ < 4000; ) {
    run.stepFrame(); lowestDuringHunt = Math.min(lowestDuringHunt, game.state.energy);
  }
  assert.ok(game.state.energy > 0, `seed ${seed} preserves enough energy to get home`);
  assert.equal(game.state.won, false, 'arrival home requires an explicit finish interaction');
  assert.equal(game.finishRun(), true, `seed ${seed} banks a partial haul at ${frameMs}ms frames`);
  assert.equal(game.state.won, true, 'resting at the couch finishes the haul');
  lowestFinish = Math.min(lowestFinish, game.state.energy); highestTime = Math.max(highestTime, game.state.elapsed);
}
console.log(`PASS: 16 seeded partial hauls return home at 60fps/1fps; minimum energy ${lowestDuringHunt.toFixed(1)}, minimum finish energy ${lowestFinish.toFixed(1)}, slowest run ${highestTime.toFixed(1)}s (${searchSeconds}s search per snack)`);
