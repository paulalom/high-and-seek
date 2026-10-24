import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGameHarness } from './qa-pathing.mjs';
import { walkToHome } from './qa-route-helpers.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const near = (actual, expected, label, tolerance = .025) => assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: expected ${expected}, got ${actual}`);
function direct() {
  const sandbox = { window: {}, console };
  vm.createContext(sandbox);
  for (const file of ['world.js', 'wing.js']) vm.runInContext(fs.readFileSync(path.join(root, 'dist', file), 'utf8'), sandbox);
  const world = sandbox.window.HSWorld; world.activateFloor(2); world.shuffleSnacks(() => .5);
  const simulation = sandbox.window.HSWing.create(world), runtime = simulation.getState();
  const state = { level: 2, started: true, paused: false, won: false, failed: false, found: new Set(), energy: 100, player: { ...world.floors[2].doors[0], level: 2 } };
  return { world, simulation, runtime, state };
}
function advanceDirect(fixture, seconds, dt = .05) {
  const count = Math.ceil(seconds / dt);
  for (let step = 0; step < count; step++) {
    fixture.simulation.update(seconds / count, fixture.state);
    for (const actor of [fixture.runtime.dog, fixture.runtime.eater]) assert.ok(fixture.world.isWalkable(actor.x, actor.y, actor === fixture.runtime.dog ? .25 : .22, 2), 'wing actors stay collision-safe');
  }
}
function enterDen(fixture) {
  Object.assign(fixture.state.player, { x: 6, y: 4.5 });
  fixture.simulation.update(.05, fixture.state);
  assert.equal(fixture.runtime.eater.activated, true, 'entering Nico\'s room activates his snack hunt');
}
function advance(run, seconds, frameMs = 1000 / 60) {
  const end = run.getTime() + seconds * 1000;
  while (run.getTime() < end - 1e-7) run.stepFrame(Math.min(frameMs, end - run.getTime()));
}
function clearSegment(world, a, b, radius = .22) {
  const count = Math.max(1, Math.ceil(Math.hypot(a.x - b.x, a.y - b.y) / .07));
  for (let step = 0; step <= count; step++) if (!world.isWalkable(a.x + (b.x - a.x) * step / count, a.y + (b.y - a.y) * step / count, radius, 2)) return false;
  return true;
}
function route(world, start, goal) {
  const cols = 61, rows = 45, count = cols * rows, point = index => ({ x: index % cols / 2, y: Math.floor(index / cols) / 2 });
  const open = new Uint8Array(count), candidates = [];
  for (let index = 0; index < count; index++) { const p = point(index); if (world.isWalkable(p.x, p.y, .22, 2)) { open[index] = 1; candidates.push(index); } }
  const nearest = target => [...candidates].sort((a, b) => Math.hypot(point(a).x - target.x, point(a).y - target.y) - Math.hypot(point(b).x - target.x, point(b).y - target.y)).find(index => clearSegment(world, target, point(index)));
  const first = nearest(start), last = nearest(goal), previous = new Int32Array(count); previous.fill(-1); previous[first] = first;
  const queue = [first];
  for (let head = 0; head < queue.length && previous[last] < 0; head++) {
    const current = queue[head], p = point(current);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const nx = current % cols + dx, ny = Math.floor(current / cols) + dy, next = ny * cols + nx;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || !open[next] || previous[next] >= 0 || !clearSegment(world, p, point(next))) continue;
      previous[next] = current; queue.push(next);
    }
  }
  assert.ok(previous[last] >= 0, 'dog task rooms connect through the actual rounded-collision doorways');
  const points = [{ x: goal.x, y: goal.y }];
  for (let index = last; index !== first; index = previous[index]) points.push(point(index));
  points.push(point(first)); return points.reverse();
}
function coax(fixture) {
  const { world, state, simulation, runtime } = fixture, dog = runtime.dog;
  if (!['sniffing', 'waiting', 'sleeping'].includes(dog.status)) return;
  for (const target of route(world, state.player, dog)) {
    for (let step = 0; Math.hypot(state.player.x - dog.x, state.player.y - dog.y) > 1.35 && Math.hypot(target.x - state.player.x, target.y - state.player.y) > .035 && step < 500; step++) {
      const dx = target.x - state.player.x, dy = target.y - state.player.y, distance = Math.hypot(dx, dy), stride = Math.min(distance, 2.6 * .05);
      const moved = world.moveCircle(state.player.x, state.player.y, dx / distance * stride, dy / distance * stride, .22, 2);
      assert.ok(moved.distance > .0001, 'the player can walk back to the distracted dog');
      Object.assign(state.player, { x: moved.x, y: moved.y }); simulation.update(.05, state);
    }
    if (Math.hypot(state.player.x - dog.x, state.player.y - dog.y) <= 1.35) break;
  }
  assert.equal(simulation.interact(state), true, 'a nearby explicit recall resumes the distracted escort');
}
function guide(fixture, goal) {
  const { world, state, simulation, runtime } = fixture;
  for (const target of route(world, state.player, goal)) {
    for (let step = 0; Math.hypot(target.x - state.player.x, target.y - state.player.y) > .035 && step < 500; step++) {
      coax(fixture);
      const dx = target.x - state.player.x, dy = target.y - state.player.y, distance = Math.hypot(dx, dy), stride = Math.min(distance, 2.6 * .05);
      const moved = world.moveCircle(state.player.x, state.player.y, dx / distance * stride, dy / distance * stride, .22, 2);
      Object.assign(state.player, { x: moved.x, y: moved.y }); simulation.update(.05, state);
      assert.ok(world.isWalkable(runtime.dog.x, runtime.dog.y, .25, 2), 'following corgi routes around walls and themed props');
      assert.ok(moved.distance > .0001, 'guiding fixture stays connected');
      assert.equal(runtime.dog.sleeping, false, 'a deliberate escort with the toy break preserves dog energy');
    }
    assert.ok(Math.hypot(target.x - state.player.x, target.y - state.player.y) <= .035, 'guiding reaches every doorway waypoint');
  }
}

const fixture = direct(), { world, simulation, runtime, state } = fixture, wing = world.wing;
assert.equal(world.floors.length, 4, 'the pet wing and Midnight Wing are distinct connected areas');
assert.equal(world.floors[2].rooms.length, 3, 'wing has a snack den, corgi playroom and separate bowl room');
assert.ok(!world.floors[0].stair, 'the staircase has moved out of the main mansion');
assert.equal(world.floors[2].stair.to, 1, 'the clubhouse now contains the upstairs staircase');
assert.equal(world.floors[1].stair.to, 2, 'upstairs descends back into the clubhouse');
assert.equal(wing.dog.drain, 2.4, 'Waffles loses energy four times as quickly as before');
assert.ok(wing.bowl.x >= 26 && wing.bowl.y <= 4.5, 'dinner is at the far northeast end of the pet kitchen');
assert.ok(world.isWalkable(wing.toy.x, wing.toy.y, .25, 2), 'the midpoint squeaky toy is reachable by the dog');
assert.equal(world.getRoom(wing.dog.x, wing.dog.y, 2).id, 'corgiPlayroom');
assert.notEqual(world.getRoom(wing.dog.x, wing.dog.y, 2).id, world.getRoom(wing.bowl.x, wing.bowl.y, 2).id, 'feeding means guiding the dog into another room');
assert.equal(runtime.dog.energy, wing.dog.startEnergy);
assert.equal(runtime.taskCompleted, false);
const snapshot = () => JSON.stringify({ dog: runtime.dog, eater: runtime.eater, consumed: [...runtime.consumed] });
for (const change of [{ level: 0 }, { paused: true }, { started: false }, { failed: true }, { won: true }]) {
  const before = snapshot(), saved = { ...state }; Object.assign(state, change); advanceDirect(fixture, 4); Object.assign(state, saved);
  assert.equal(snapshot(), before, 'off-area, pause and completed/failed runs freeze dog hunger and eater movement');
}
Object.assign(state.player, { x: runtime.dog.x, y: runtime.dog.y });
simulation.drainEvents(); const beforeHunger = runtime.dog.energy;
advanceDirect(fixture, 20);
near(runtime.dog.energy, beforeHunger - wing.dog.drain * 20, 'hungry corgi energy uses elapsed active-wing time');
const whines = simulation.drainEvents().filter(event => event.type === 'whine');
assert.ok(whines.length > 0 && whines.length <= 3, 'a hungry dog whines occasionally rather than every frame');
// Start the escort fresh after independently checking twenty seconds of hunger.
simulation.reset(); Object.assign(state.player, { x: runtime.dog.x, y: runtime.dog.y });
const haulBefore = state.found.size, energyBefore = state.energy;
assert.equal(simulation.interact(state), true, 'nearby player can invite the dog to follow');
assert.equal(runtime.dog.following, true);
assert.equal(state.found.size, haulBefore, 'guiding does not consume a banked or carried snack');
assert.equal(state.energy, energyBefore, 'dog interaction does not refill player energy');
assert.equal(simulation.interact(state), false, 'a following dog does not steal the food action repeatedly');
guide(fixture, wing.toy);
assert.equal(simulation.canPlay(state), true, `the actual escort reaches the toy with Waffles nearby: ${JSON.stringify({ player: state.player, dog: runtime.dog, toy: world.wing.toy })}`);
const beforePlay = runtime.dog.energy, playerBeforePlay = state.energy, haulBeforePlay = state.found.size;
simulation.drainEvents(); assert.equal(simulation.play(state), true);
near(runtime.dog.energy, Math.min(100, beforePlay + 25), 'toy restores twenty-five dog energy');
assert.equal(state.energy, playerBeforePlay, 'toy gives no player energy');
assert.equal(state.found.size, haulBeforePlay, 'toy changes no carried or banked food');
assert.equal(runtime.toy.used, true); assert.ok(runtime.toy.usedAt > 0);
assert.equal(simulation.drainEvents().filter(event => event.type === 'play').length, 1, 'toy emits one play event');
const afterPlay = runtime.dog.energy;
assert.equal(simulation.play(state), false, 'toy cannot be farmed repeatedly in one run');
near(runtime.dog.energy, afterPlay, 'repeated toy input adds no energy');
const playPosition = { x: runtime.dog.x, y: runtime.dog.y }, playClock = runtime.clock;
guide(fixture, { x: wing.toy.x + 2, y: wing.toy.y }); advanceDirect(fixture, .8);
assert.ok(runtime.clock < runtime.dog.playUntil, 'play hold lasts two seconds');
near(runtime.dog.x, playPosition.x, 'toy play holds the dog in place'); near(runtime.dog.y, playPosition.y, 'toy play holds the dog in place');
near(runtime.dog.energy, afterPlay - wing.dog.drain * (runtime.clock - playClock), 'hunger continues during the short play break');
advanceDirect(fixture, .6);
guide(fixture, wing.bowl);
for (let step = 0; !runtime.taskCompleted && step < 300; step++) advanceDirect(fixture, .05);
assert.equal(runtime.taskCompleted, true, 'leading the corgi to its bowl completes the task');
assert.equal(runtime.dog.happy, true);
assert.equal(runtime.dog.energy, 100);
assert.ok(Math.hypot(runtime.dog.x - wing.bowl.x, runtime.dog.y - wing.bowl.y) <= wing.bowl.radius + .15, 'the dog actually reaches its bowl');
assert.equal(simulation.drainEvents().filter(event => event.type === 'fed').length, 1, 'feeding completes once');
advanceDirect(fixture, 25);
assert.equal(runtime.dog.energy, 100, 'fed dog stays content for the rest of the run');
assert.equal(simulation.drainEvents().filter(event => ['fed', 'whine'].includes(event.type)).length, 0, 'happy dog neither repeats the reward nor keeps whining');
console.log('PASS: wing layout, frozen off-area actors, hunger, bounded whining and an actual cross-room corgi feeding route');

const sleepy = direct(); Object.assign(sleepy.state.player, { x: sleepy.runtime.dog.x, y: sleepy.runtime.dog.y }); sleepy.runtime.dog.energy = .1;
advanceDirect(sleepy, 1);
assert.equal(sleepy.runtime.dog.sleeping, true);
assert.equal(sleepy.runtime.dog.energy, 0);
assert.equal(sleepy.runtime.dog.status, 'sleeping', 'zero energy means a harmless nap');
sleepy.simulation.drainEvents(); const nap = { x: sleepy.runtime.dog.x, y: sleepy.runtime.dog.y };
advanceDirect(sleepy, 20);
near(sleepy.runtime.dog.x, nap.x, 'sleeping dog stays put'); near(sleepy.runtime.dog.y, nap.y, 'sleeping dog stays put');
assert.equal(sleepy.simulation.drainEvents().filter(event => event.type === 'whine' || event.type === 'sleep').length, 0, 'sleep is quiet and not retriggered each frame');
assert.equal(sleepy.simulation.interact(sleepy.state), true, 'player can wake the sleepy corgi and still complete the task');
assert.equal(sleepy.runtime.dog.sleeping, false); assert.equal(sleepy.runtime.dog.following, true); assert.equal(sleepy.runtime.dog.energy, 25);
guide(sleepy, sleepy.world.wing.toy);
assert.equal(sleepy.simulation.play(sleepy.state), true, 'a woken dog can still use its unused toy');
advanceDirect(sleepy, 2.1); guide(sleepy, sleepy.world.wing.bowl);
for (let step = 0; !sleepy.runtime.taskCompleted && step < 300; step++) advanceDirect(sleepy, .05);
assert.equal(sleepy.runtime.taskCompleted, true, 'wake plus toy break can recover the entire longer escort');
sleepy.simulation.reset();
assert.equal(sleepy.simulation.getState().taskCompleted, false);
assert.equal(sleepy.simulation.getState().dog.energy, wing.dog.startEnergy);
assert.equal(sleepy.simulation.getState().consumed.size, 0, 'a fresh run resets dog task and the eater supply');
assert.equal(sleepy.simulation.getState().toy.used, false, 'a fresh run restores the single toy use');
assert.equal(sleepy.simulation.getState().toy.usedAt, 0);
assert.equal(sleepy.simulation.getState().dog.playUntil, 0);
console.log('PASS: zero-energy sleep, quiet nap, recoverable waking and fresh-run reset');

const separated = direct();
Object.assign(separated.runtime.dog, { x: 12.4, y: 14 });
Object.assign(separated.state.player, { x: 13.8, y: 14 });
assert.ok(Math.hypot(separated.state.player.x - separated.runtime.dog.x, separated.state.player.y - separated.runtime.dog.y) < 1.8);
assert.equal(separated.simulation.canInteract(separated.state), false, 'the nearby corgi cannot be recruited through a wall');
assert.equal(separated.simulation.interact(separated.state), false);

const dining = direct(), startingHaul = dining.state.found.size;
dining.simulation.update(.1, dining.state);
assert.equal(dining.runtime.consumed.size, 0, 'the eater does not instantly delete food');
assert.equal(dining.runtime.eater.activated, false, 'entering the wing corridor does not activate Nico');
const patrolStart = { x: dining.runtime.eater.x, y: dining.runtime.eater.y };
advanceDirect(dining, 4);
assert.ok(Math.hypot(dining.runtime.eater.x - patrolStart.x, dining.runtime.eater.y - patrolStart.y) > .2, 'Nico can stroll while waiting for the player');
Object.assign(dining.state.player, { x: dining.runtime.dog.x, y: dining.runtime.dog.y });
advanceDirect(dining, 35);
assert.equal(dining.runtime.eater.activated, false, 'visiting Waffles does not start Nico\'s competition');
assert.equal(dining.runtime.eater.target, null, 'waiting Nico never reserves a munchie');
assert.equal(dining.runtime.consumed.size, 0, 'wing snacks remain intact until the player enters the den');
assert.equal(dining.simulation.drainEvents().filter(event => ['munch', 'snackEaten'].includes(event.type)).length, 0, 'waiting Nico makes no eating sounds or consumption events');
enterDen(dining);
let munchEvents = 0, firstBite = false;
for (let frame = 0; frame < 700; frame++) {
  dining.simulation.update(.05, dining.state);
  const events = dining.simulation.drainEvents();
  const bites = events.filter(event => event.type === 'munch');
  munchEvents += bites.length;
  assert.ok(bites.length <= 1, 'each update emits at most one munch instead of replaying a backlog');
  if (bites.length) { firstBite = true; assert.equal(dining.runtime.eater.status, 'eating', 'munch sounds occur during an actual eating pose'); }
}
assert.ok(firstBite && munchEvents > 0 && munchEvents < 50, 'active Nico emits a bounded, audible eating rhythm');
assert.ok(dining.runtime.consumed.size > 0, 'the roaming person reaches snacks and consumes them over time');
for (const id of dining.runtime.consumed) assert.ok(dining.world.snacks.some(snack => snack.id === id && snack.level === 2), 'eater only removes actual wing snacks');
assert.equal(dining.state.found.size, startingHaul, 'NPC eating adds nothing to the player score');
assert.equal(dining.state.energy, 100, 'NPC eating gives the player no energy');
const competing = direct(); enterDen(competing);
assert.ok(competing.runtime.eater.target, 'eater selects a food target');
const claimed = competing.runtime.eater.target; competing.state.found.add(claimed);
advanceDirect(competing, 20);
assert.equal(competing.runtime.consumed.has(claimed), false, 'player collecting a target prevents the NPC from eating it again');
assert.equal(competing.state.found.size, 1);
Object.assign(competing.state.player, { x: competing.world.floors[2].doors[0].x, y: competing.world.floors[2].doors[0].y });
advanceDirect(competing, 1);
assert.equal(competing.runtime.eater.activated, true, 'leaving the den does not reset the competition');
competing.simulation.reset();
assert.equal(competing.runtime.eater.activated, false, 'a fresh run waits for den entry again');
console.log('PASS: den-entry activation, quiet waiting patrol, bounded munch sounds, timed real-food consumption and collection race guard');

let supplySeed = 981;
for (let trial = 0; trial < 100; trial++) {
  world.shuffleSnacks(() => ((supplySeed = (supplySeed * 1664525 + 1013904223) >>> 0) / 2 ** 32));
  const corgiSnacks = world.snacks.filter(snack => snack.room === 'corgiPlayroom');
  assert.ok(corgiSnacks.length >= 3, 'every run puts several player munchies in the corgi clubhouse');
  for (const snack of corgiSnacks) assert.ok(world.canSeeSnack(snack, { x: snack.x, y: snack.y, level: 2 }), 'corgi snacks participate in ordinary player discovery');
  const wingCount = world.snacks.filter(snack => snack.level === 2).length;
  assert.ok(wingCount >= 10 && wingCount <= 16, 'guaranteed clubhouse snacks retain the wing supply range');
}
console.log('PASS: all100 seeded runs include at least3 discoverable corgi-room munchies');

const run = createGameHarness({ seed: 89 }), game = run.qa, map = run.world;
assert.equal(typeof game.headForWing, 'function'); assert.equal(typeof game.useDoor, 'function');
assert.equal(game.useDoor(), false, 'door cannot remotely teleport the player from the couch');
game.headForWing();
for (let frame = 0; game.getPath().length && frame < 5000 && !game.state.failed; frame++) run.stepFrame();
assert.equal(game.state.failed, false); assert.equal(game.state.level, 0, 'walking to the wing entrance does not transition');
assert.ok(game.canUseDoor(), 'door becomes usable only at its real approach');
game.interact(); assert.equal(game.state.level, 2); assert.equal(map.level, 2); assert.equal(game.state.player.level, 2);
assert.equal(game.useStairs(), false, 'wing has no staircase action');
assert.equal(game.useDoor(), false, 'door cooldown prevents a bounce straight back');
game.openPause(); const frozenWing = JSON.stringify(game.state.wing.dog); advance(run, 5);
assert.equal(JSON.stringify(game.state.wing.dog), frozenWing, 'the real pause menu freezes the corgi task');
game.closeDialog(); run.document.hidden = true; run.dispatch('document', 'visibilitychange'); advance(run, 5);
assert.equal(JSON.stringify(game.state.wing.dog), frozenWing, 'hidden tabs do not drain dog energy');
run.document.hidden = false; run.dispatch('document', 'visibilitychange'); game.closeDialog();
const wingFood = map.snacks.find(snack => snack.level === 2);
game.state.wing.consumed.add(wingFood.id); game.state.discovered.add(wingFood.id);
Object.assign(game.state.player, { x: wingFood.x, y: wingFood.y }); const scoreBefore = game.state.found.size, playerEnergy = game.state.energy;
game.collect(wingFood);
assert.equal(game.state.found.size, scoreBefore, 'consumed food cannot enter the player haul');
assert.equal(game.state.energy, playerEnergy, 'consumed food cannot refill player energy');
game.hint(); assert.notEqual(game.state.hintTarget, wingFood.id, 'hints skip eaten food');
const carried = map.snacks.find(snack => snack.level === 2 && !game.state.wing.consumed.has(snack.id));
let approach = null;
for (let x = Math.floor((carried.x - 1.15) * 2) / 2; x <= carried.x + 1.15; x += .5) for (let y = Math.floor((carried.y - 1.15) * 2) / 2; y <= carried.y + 1.15; y += .5) if (map.isWalkable(x, y) && Math.hypot(x - carried.x, y - carried.y) <= map.collectionRadius && map.getRoom(x, y)?.id === carried.room) approach = { x, y };
assert.ok(approach); Object.assign(game.state.player, approach); game.state.discovered.add(carried.id); game.collect(carried);
assert.ok(game.state.found.has(carried.id), 'player can still collect available wing food into the real haul');
// This route test needs a carried surplus as well as fuel for the trip home.
for (const extra of map.snacks.filter(snack => snack.level === 2 && !game.state.found.has(snack.id) && !game.state.wing.consumed.has(snack.id)).slice(0, 5)) {
  let point = null;
  for (let x = Math.floor((extra.x - 1.15) * 2) / 2; x <= extra.x + 1.15; x += .5) for (let y = Math.floor((extra.y - 1.15) * 2) / 2; y <= extra.y + 1.15; y += .5) if (map.isWalkable(x, y) && Math.hypot(x - extra.x, y - extra.y) <= map.collectionRadius && map.getRoom(x, y)?.id === extra.room) point = { x, y };
  assert.ok(point); Object.assign(game.state.player, point); game.state.energy = 100; game.state.discovered.add(extra.id); game.collect(extra);
}
game.state.leftHome = true;
Object.assign(game.state.player, { x: map.home.x, y: map.home.y });
assert.equal(game.finishRun(), false, 'pet-wing coordinates never bank a haul at the final couch position');
game.state.energy = 100; Object.assign(game.state.player, map.floors[2].doors[0]); advance(run, 1);
walkToHome(run);
assert.equal(game.state.failed, false); assert.ok(map.isHome(game.state.player.x, game.state.player.y));
const restingEnergy = game.state.wing.dog.energy; advance(run, 2);
assert.equal(game.state.wing.dog.energy, restingEnergy, 'the unaccompanied pet task does not drain outside its wing');
const carriedAtHome = game.state.bag.length; assert.ok(carriedAtHome > 0, 'wing return retains a surplus after auto-eating for energy');
assert.equal(game.finishRun(), true, 'wing haul can return through the doorway and bank at the real couch');
assert.equal(game.state.bankedCount, carriedAtHome, 'the wing route banks only its remaining food');
game.restart(); assert.equal(game.state.level, 0); assert.equal(game.state.wing.taskCompleted, false); assert.equal(game.state.wing.consumed.size, 0);
console.log('PASS: explicit doorway transitions, eaten-food collection/hint guards, final-snug-only banking, return route and restart');

for (const hz of [60, 120, 144, 240]) {
  const performance = createGameHarness({ seed: 13 }); performance.qa.begin(); performance.qa.changeFloor(2, performance.world.floors[2].doors[0]);
  performance.resetMetrics(); advance(performance, 2, 1000 / hz);
  assert.ok(performance.metrics.draws <= 121 && performance.metrics.draws >= 118, `wing actors retain the sixty-fps cap at ${hz}Hz`);
  assert.equal(performance.getPendingRaf(), 1, 'wing keeps a single animation chain');
}
console.log('PASS: corgi and roaming eater retain the sixty-fps cap on all tested refresh rates');
