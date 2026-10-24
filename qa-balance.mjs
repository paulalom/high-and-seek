import assert from 'node:assert/strict';
import { createGameHarness } from './qa-pathing.mjs';
import { escapeConversation, nextHomeExit, walkRoute, walkToHome } from './qa-route-helpers.mjs';

const values = { cookies: 22, chips: 19, nachos: 26, icecream: 21, soda: 16, pizza: 29, donut: 24, gummies: 22 };
const oldValues = { cookies: 28, chips: 24, nachos: 32, icecream: 26, soda: 20, pizza: 36, donut: 30, gummies: 28 };
const meal = ['soda', 'chips', 'cookies', 'pizza'];
const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-7, `${label}: ${actual} versus ${expected}`);

// This fixture isolates the food budget from mansion layout. Both versions use
// the real game's automatic-eating functions, identical food kinds and costs.
// The previous energies exist only on fixture meals in their separate VM.
function foodBudget(previous = false) {
  const run = createGameHarness({ guestBrainEnabled: false, wingSimulationEnabled: false });
  const { qa, world } = run;
  assert.deepEqual(Object.fromEntries(world.snackKinds.map(kind => [kind.id, kind.energy])), values, 'live refill values retain the reduced balance');
  qa.begin();
  qa.state.bag = meal.map((id, index) => {
    const kind = world.snackKinds.find(item => item.id === id);
    return { ...kind, id: `budget-${index}`, kind: id, energy: previous ? oldValues[id] : kind.energy };
  });
  qa.state.found = new Set(qa.state.bag.map(item => item.id));
  qa.state.haulCounts = Object.fromEntries(meal.map(id => [id, 1]));
  qa.state.consumedCount = 0;
  const collectedEnergy = qa.state.bag.reduce((sum, item) => sum + item.energy, 0);
  let spent = 0;
  const snapshot = () => {
    const carriedEnergy = qa.state.bag.reduce((sum, item) => sum + item.energy, 0);
    assert.equal(qa.state.bag.length + qa.state.consumedCount, meal.length, 'each picked food is carried or eaten exactly once');
    assert.equal(qa.state.found.size, meal.length, 'eating preserves pickup history');
    assert.equal(Object.values(qa.state.haulCounts).reduce((sum, count) => sum + count, 0), qa.state.bag.length, 'per-kind counts match the remaining bag');
    near(world.rules.startEnergy + collectedEnergy, spent + qa.state.energy + carriedEnergy, 'collected fuel is conserved in meter, bag and actual expenditure');
    assert.ok(qa.state.energy >= 0 && qa.state.energy <= world.rules.maxEnergy, 'automatic eating never overflows the meter');
    return { collectedEnergy, spent, energy: qa.state.energy, consumed: qa.state.consumedCount, carried: qa.state.bag.length, carriedEnergy };
  };
  const drain = amount => {
    near(qa.spendEnergy(amount), amount, 'the budget pays the entire affordable cost');
    spent += amount;
    return snapshot();
  };
  return { qa, world, drain, snapshot };
}

for (const [kind, energy] of Object.entries(values)) {
  assert.ok(energy >= 16 && energy <= 29 && energy < oldValues[kind], `${kind} supplies less fuel than before`);
}

const current = foodBudget(), previous = foodBudget(true);
const before = current.drain(70), original = previous.drain(70);
assert.ok(before.collectedEnergy < original.collectedEnergy, 'the same four kinds supply less total fuel');
assert.ok(before.consumed > original.consumed && before.carried < original.carried, 'the same expenditure now eats more food and leaves less to bank');
near(original.energy + original.carriedEnergy - before.energy - before.carriedEnergy, original.collectedEnergy - before.collectedEnergy, 'remaining fuel falls by exactly the reduction in food energy');

// Charge thirty seconds at the actual idle rate, in one-second chunks. Timing
// and route integration are covered by the gameplay suites; this checks how
// that declared time cost changes the food available to bank on any floor.
const lingerSeconds = 30;
for (let second = 0; second < lingerSeconds; second++) current.drain(current.world.rules.idleDrain);
const delayed = current.snapshot();
near(delayed.spent - before.spent, lingerSeconds * current.world.rules.idleDrain, 'lingering pays its full declared time cost');
assert.ok(delayed.consumed > before.consumed && delayed.carried < before.carried, 'waiting consumes more of the same haul');
assert.equal(delayed.carried, 0, 'the remaining snack can be eaten before a player banks it');
assert.equal(current.qa.state.failed, false, 'losing bankable food does not itself fail a healthy player');

console.log(`PASS: identical four-food budgets supply ${before.collectedEnergy} versus ${original.collectedEnergy} previous energy; spending 70 leaves ${before.carried} versus ${original.carried} snacks`);
console.log(`PASS: ${lingerSeconds}s of idle cost spends ${(delayed.spent - before.spent).toFixed(1)} more energy, eats the last snack, and preserves all fuel and pickup counts`);

// One complete journey uses normal movement, food and actors. After exploring
// the starting area, an optional three-snack terrace detour funds the walk
// back into the hallway and through the snug's north entrance.
const journey = createGameHarness({ seed: 7 }), { qa, world } = journey;
let minimumEnergy = qa.state.energy;
const onFrame = () => { minimumEnergy = Math.min(minimumEnergy, qa.state.energy); };
qa.begin();
const remaining = world.snacks.filter(food => food.level === world.start.level);
for (let pickup = 0; pickup < 8; pickup++) {
  remaining.sort((a, b) => Math.hypot(a.x - qa.state.player.x, a.y - qa.state.player.y) - Math.hypot(b.x - qa.state.player.x, b.y - qa.state.player.y));
  const target = remaining.shift();
  qa.navigate(target.x, target.y, target);
  walkRoute(journey, { onFrame, label: `starting-area pickup ${target.id}` });
  assert.ok(qa.state.found.has(target.id), 'the food budget comes from actual world pickups');
}
const transitions = [];
while (qa.state.level !== world.home.level) {
  const from = qa.state.level, exit = nextHomeExit(world, from);
  qa.headHome(); walkRoute(journey, { onFrame, label: 'forward route to the next section' });
  assert.equal(qa.state.level, from, 'the forward journey crosses every boundary explicitly');
  for (let count = 0; qa.state.stairsCooldown > 0 && count < 120; count++) { journey.stepFrame(100); onFrame(); escapeConversation(journey, onFrame); }
  assert.equal(world.floors[from].stair === exit ? qa.useStairs() : qa.useDoor(), true, 'the forward route uses a physical section connection');
  assert.equal(qa.state.level, exit.to); transitions.push([from, qa.state.level]);
}
assert.ok(transitions.length >= 2, 'the journey physically crosses the intervening areas');
for (let pickup = 0; pickup < 3; pickup++) {
  const nearby = world.snacks.filter(food => food.level === qa.state.level && food.room === 'terrace' && !qa.state.found.has(food.id))
    .sort((a, b) => Math.hypot(a.x - qa.state.player.x, a.y - qa.state.player.y) - Math.hypot(b.x - qa.state.player.x, b.y - qa.state.player.y))[0];
  assert.ok(nearby, 'the optional terrace detour has a real uncollected snack');
  qa.navigate(nearby.x, nearby.y, nearby); walkRoute(journey, { onFrame, label: 'optional terrace pickup' });
  assert.ok(qa.state.found.has(nearby.id), 'each terrace snack is collected by actual walking');
}
walkToHome(journey, { onFrame });
const pickedEnergy = world.snacks.filter(food => qa.state.found.has(food.id)).reduce((sum, food) => sum + food.energy, 0);
const bankedEnergy = qa.state.bag.reduce((sum, food) => sum + food.energy, 0);
const consumedEnergy = pickedEnergy - bankedEnergy;
const energySpent = world.rules.startEnergy + consumedEnergy - qa.state.energy;
assert.equal(qa.state.found.size, 11, 'the journey takes eight starting pickups and three optional terrace snacks');
assert.equal(qa.state.bag.length + qa.state.consumedCount, qa.state.found.size, 'all journey food remains accounted for');
assert.ok(qa.state.bag.length > 0 && minimumEnergy > 0, 'a prudent final detour retains a haul and enough fuel');
assert.equal(qa.finishRun(), true, 'the actual final couch explicitly banks the remaining food');
assert.equal(qa.state.bankedCount, qa.state.bag.length, 'only carried food is banked');
console.log(`PASS: physical ${transitions.map(([from, to]) => `${from}→${to}`).join(', ')} journey picks ${qa.state.found.size}, eats ${qa.state.consumedCount} (${consumedEnergy} energy), banks ${qa.state.bankedCount} (${bankedEnergy} energy), spends ${energySpent.toFixed(2)}, and finishes in ${qa.state.elapsed.toFixed(2)}s at ${qa.state.energy.toFixed(2)} energy (minimum ${minimumEnergy.toFixed(2)})`);
