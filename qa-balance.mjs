import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGameHarness } from './qa-pathing.mjs';

// These are real walks from the couch, with normal fuel, pickup and guest rules.
// No world positions, energy meters, bags or guests are replaced by fixtures.
export function simulateReturnTrip({ seed, floor = 0, pickups = 4, linger = 0, homePickups = 0, energyValues = null } = {}) {
  const run = createGameHarness({ seed }), { qa, world } = run;
  // A local comparison fixture can restore the previous values in this VM only.
  // Routes, bag rules, drains, guests and all production files stay untouched.
  if (energyValues) {
    for (const kind of world.snackKinds) kind.energy = energyValues[kind.id];
    for (const snack of world.snacks) snack.energy = energyValues[snack.kind];
  }
  let distance = 0, minimumEnergy = qa.state.energy, escaped = 0;
  const moveCircle = world.moveCircle;
  world.moveCircle = function (...args) {
    const moved = moveCircle.apply(this, args);
    if (args.length === 4) distance += moved.distance; // Player calls use the default radius; NPC calls pass their radius.
    return moved;
  };
  const frame = () => {
    run.stepFrame();
    minimumEnergy = Math.min(minimumEnergy, qa.state.energy);
  };
  const escape = () => {
    if (!qa.state.conversation) return;
    const required = qa.state.conversation.escapeRequired;
    for (let press = 0; qa.state.conversation && !qa.state.failed && press < required + 1; press++) {
      for (let count = 0; count < 6 && !qa.state.failed; count++) frame();
      qa.interact();
    }
    if (!qa.state.conversation && !qa.state.failed) escaped++;
  };
  const walk = condition => {
    for (let count = 0; !condition() && !qa.state.failed && count < 6000; count++) {
      frame(); escape();
      if (!qa.getPath().length && !condition() && !qa.state.conversation) break;
    }
    return condition();
  };
  qa.begin();
  if (floor === 1) {
    qa.headForStairs();
    assert.ok(walk(() => !qa.getPath().length), 'outbound stair route completes');
    assert.ok(qa.canUseStairs(), 'outbound walk reaches the usable stairs');
    qa.interact();
    assert.equal(qa.state.level, 1, 'the player explicitly climbs the stairs');
  }
  const candidates = world.snacks.filter(snack => snack.level === floor);
  for (let count = 0; count < pickups && !qa.state.failed; count++) {
    const pool = candidates.filter(snack => floor !== 0 || (count < homePickups ? snack.room === world.home.room : snack.room !== world.home.room));
    pool.sort((a, b) => Math.hypot(a.x - qa.state.player.x, a.y - qa.state.player.y) - Math.hypot(b.x - qa.state.player.x, b.y - qa.state.player.y));
    const target = pool[0];
    assert.ok(target, 'the prescribed trip has enough world pickups');
    candidates.splice(candidates.indexOf(target), 1);
    qa.navigate(target.x, target.y, target);
    if (!walk(() => qa.state.found.has(target.id))) break;
  }
  const pickedBeforeLinger = qa.state.found.size, carriedBeforeLinger = qa.state.bag.length;
  const lingerUntil = qa.state.elapsed + linger;
  while (qa.state.elapsed < lingerUntil && !qa.state.failed) { frame(); escape(); }
  if (!qa.state.failed) {
    qa.headHome();
    walk(() => !qa.getPath().length);
    if (floor === 1 && !qa.state.failed) {
      assert.ok(qa.canUseStairs(), 'the upstairs return reaches usable stairs');
      qa.interact();
      assert.equal(qa.state.level, 0, 'the return trip explicitly descends');
      qa.headHome(); walk(() => !qa.getPath().length);
    }
  }
  const atHome = qa.state.level === 0 && world.isHome(qa.state.player.x, qa.state.player.y);
  const pickedEnergy = world.snacks.filter(snack => qa.state.found.has(snack.id)).reduce((total, snack) => total + snack.energy, 0);
  const carriedEnergy = qa.state.bag.reduce((total, snack) => total + snack.energy, 0);
  const consumedEnergy = pickedEnergy - carriedEnergy;
  const energySpent = world.rules.startEnergy + consumedEnergy - qa.state.energy;
  const banked = atHome && !qa.state.failed ? qa.finishRun() : false;
  const result = {
    seed, floor, pickups, homePickups, linger, elapsed: qa.state.elapsed, distance, energySpent,
    movementEnergy: distance * world.rules.distanceDrain,
    picked: qa.state.found.size, pickedEnergy, consumed: qa.state.consumedCount,
    consumedEnergy, carried: qa.state.bag.length, carriedEnergy, banked: qa.state.bankedCount,
    minimumEnergy, finishEnergy: qa.state.energy, escaped, failed: qa.state.failed,
    atHome, finished: banked, pickedBeforeLinger, carriedBeforeLinger
  };
  assert.equal(result.picked, result.consumed + result.carried, 'every picked snack is carried or eaten');
  assert.equal(result.banked, banked ? result.carried : 0, 'only food actually carried to the couch is banked');
  assert.ok(Math.abs(world.rules.startEnergy + pickedEnergy - energySpent - qa.state.energy - carriedEnergy) < 1e-7, 'starting fuel and collected food reconcile to spent fuel, remaining meter and carried food');
  const expectedSpent = world.rules.idleDrain * result.elapsed + result.movementEnergy + escaped * world.rules.conversationEscapeCost;
  assert.ok(Math.abs(energySpent - expectedSpent) < .06, `meter expenditure reconciles to real time, distance and escaped conversations: ${JSON.stringify({ result, expectedSpent })}`);
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const oldValues = { cookies: 28, chips: 24, nachos: 32, icecream: 26, soda: 20, pizza: 36, donut: 30, gummies: 28 };
  console.log(`BALANCE VALUES ${JSON.stringify(Object.fromEntries(createGameHarness().world.snackKinds.map(kind => [kind.id, kind.energy])))}`);
  let tighterHaul = false;
  for (const plan of [{ floor: 0, pickups: 3, homePickups: 1 }, { floor: 1, pickups: 8 }]) {
    const current = simulateReturnTrip({ seed: 7, ...plan });
    const original = simulateReturnTrip({ seed: 7, ...plan, energyValues: oldValues });
    const delayed = simulateReturnTrip({ seed: 7, ...plan, linger: 30 });
    for (const [label, result] of Object.entries({ current, original, delayed })) console.log(`BALANCE ${label} ${JSON.stringify(Object.fromEntries(Object.entries(result).map(([key, value]) => [key, typeof value === 'number' ? Math.round(value * 100) / 100 : value])))}`);
    assert.equal(current.picked, plan.pickups, 'the immediate trip reaches its prescribed pickups');
    assert.equal(current.finished, true, 'the nearby and medium trips can return and bank');
    assert.ok(current.banked > 0, 'a careful return retains food to bank');
    assert.equal(original.picked, current.picked, 'the previous values comparison follows the same pickup count');
    assert.ok(current.pickedEnergy < original.pickedEnergy, 'the same food now supplies less total energy');
    assert.ok(current.consumed >= original.consumed && current.banked <= original.banked, 'smaller refills do not produce a larger banked haul');
    tighterHaul ||= current.consumed > original.consumed || current.banked < original.banked;
    assert.equal(delayed.pickedBeforeLinger, current.pickedBeforeLinger, 'the linger comparison starts with the same actual pickups');
    assert.equal(delayed.carriedBeforeLinger, current.carriedBeforeLinger, 'the linger comparison starts with the same actual bag');
    assert.ok(delayed.energySpent > current.energySpent, 'lingering increases the real energy budget');
    assert.ok(delayed.failed || delayed.banked < current.banked, 'waiting consumes more of the haul or loses the run');
  }
  assert.ok(tighterHaul, 'at least one real return trip consumes more food and banks less than before');
  console.log('PASS: real nearby and upstairs return trips remain viable, lower refills reduce the haul, and lingering spends more food');
}
