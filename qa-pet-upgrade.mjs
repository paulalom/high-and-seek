import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const near = (actual, expected, label, tolerance = .025) => assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: expected ${expected}, got ${actual}`);
function fixture() {
  const sandbox = { window: {}, console }; vm.createContext(sandbox);
  for (const file of ['world.js', 'wing.js']) vm.runInContext(fs.readFileSync(path.join(root, 'dist', file), 'utf8'), sandbox);
  const world = sandbox.window.HSWorld, wing = world.wing; world.activateFloor(wing.level); world.shuffleSnacks(() => .5);
  const simulation = sandbox.window.HSWing.create(world), runtime = simulation.getState();
  const entry = world.floors.find(floor => floor.id === wing.level).doors[0];
  const state = { level: wing.level, player: { x: entry.x, y: entry.y, level: wing.level }, started: true, paused: false, won: false, failed: false, found: new Set(), bag: [], haulCounts: {}, energy: 37 };
  return { world, wing, simulation, runtime, state, navigation: null, minimumEnergy: runtime.dog.energy, coaxed: 0, returnedToDog: 0 };
}
function update(f, seconds, interval = .05) {
  const count = Math.ceil(seconds / interval);
  for (let step = 0; step < count; step++) {
    f.simulation.update(seconds / count, f.state);
    f.minimumEnergy = Math.min(f.minimumEnergy, f.runtime.dog.energy);
    assert.ok(f.world.isWalkable(f.runtime.dog.x, f.runtime.dog.y, .25, f.wing.level), 'Waffles stays outside all themed props and walls');
    assert.ok(f.world.isWalkable(f.runtime.eater.x, f.runtime.eater.y, .22, f.wing.level), 'the snack hunter also stays collision-safe');
  }
}
function clear(f, a, b, radius = .26) {
  const count = Math.max(1, Math.ceil(Math.hypot(a.x - b.x, a.y - b.y) / .07));
  for (let step = 0; step <= count; step++) if (!f.world.isWalkable(a.x + (b.x - a.x) * step / count, a.y + (b.y - a.y) * step / count, radius, f.wing.level)) return false;
  return true;
}
function navigation(f, radius = .26) {
  if (f.navigation?.radius === radius) return f.navigation;
  const cols = 61, rows = 45, count = cols * rows;
  const point = index => ({ x: index % cols / 2, y: Math.floor(index / cols) / 2 });
  const open = new Uint8Array(count), edges = Array.from({ length: count }, () => []), cells = [];
  for (let index = 0; index < count; index++) { const p = point(index); if (f.world.isWalkable(p.x, p.y, radius, f.wing.level)) { open[index] = 1; cells.push(index); } }
  for (const index of cells) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const nx = index % cols + dx, ny = Math.floor(index / cols) + dy, next = ny * cols + nx;
    if (nx >= 0 && ny >= 0 && nx < cols && ny < rows && open[next] && clear(f, point(index), point(next), radius)) edges[index].push(next);
  }
  const nearest = target => [...cells].sort((a, b) => Math.hypot(point(a).x - target.x, point(a).y - target.y) - Math.hypot(point(b).x - target.x, point(b).y - target.y)).find(index => clear(f, target, point(index), radius));
  return f.navigation = { radius, point, cells, edges, nearest, count };
}
function route(f, start, goal) {
  const grid = navigation(f), first = grid.nearest(start), last = grid.nearest(goal), previous = new Int32Array(grid.count); previous.fill(-1);
  assert.ok(first !== undefined && last !== undefined, 'escort endpoints connect to the dog-safe grid');
  previous[first] = first; const queue = [first];
  for (let head = 0; head < queue.length && previous[last] < 0; head++) for (const next of grid.edges[queue[head]]) if (previous[next] < 0) { previous[next] = queue[head]; queue.push(next); }
  assert.ok(previous[last] >= 0, 'the longer escort remains connected through the real doorways');
  const result = [{ x: goal.x, y: goal.y }];
  for (let index = last; index !== first; index = previous[index]) result.push(grid.point(index));
  result.push(grid.point(first)); return result.reverse();
}
function coax(f) {
  if (!['sniffing', 'waiting'].includes(f.runtime.dog.status)) return false;
  if (!f.simulation.canInteract(f.state)) { f.returnedToDog++; guide(f, { x: f.runtime.dog.x, y: f.runtime.dog.y }, false); }
  update(f, .2); // A brief deliberate stop, followed by an actual nearby call.
  assert.equal(f.simulation.interact(f.state), true, 'a distracted or waiting dog resumes after a nearby call');
  f.coaxed++; return true;
}
function guide(f, goal, handleDistractions = true) {
  let points = route(f, f.state.player, goal), index = 0;
  for (let count = 0; index < points.length && count < 10000; count++) {
    if (handleDistractions && coax(f)) { points = route(f, f.state.player, goal); index = 0; continue; }
    const target = points[index], dx = target.x - f.state.player.x, dy = target.y - f.state.player.y, distance = Math.hypot(dx, dy);
    if (distance <= .035) { index++; continue; }
    const stride = Math.min(distance, 2.6 * .05);
    const moved = f.world.moveCircle(f.state.player.x, f.state.player.y, dx / distance * stride, dy / distance * stride, .22, f.wing.level);
    assert.ok(moved.distance > .0001, 'the player makes progress through every escort waypoint');
    Object.assign(f.state.player, { x: moved.x, y: moved.y }); update(f, .05);
    assert.equal(f.runtime.dog.sleeping, false, 'the deliberate escort with calls and its toy break remains affordable');
  }
  assert.ok(Math.hypot(goal.x - f.state.player.x, goal.y - f.state.player.y) <= .035, 'the player reaches the escort destination');
}
function finishDinner(f) { guide(f, f.wing.bowl); for (let step = 0; !f.runtime.taskCompleted && step < 300; step++) update(f, .05); assert.equal(f.runtime.taskCompleted, true, 'Waffles reaches and eats from the distant dinner bowl'); }

const f = fixture(), { world, wing } = f;
const floor = world.floors.find(area => area.id === wing.level), ground = world.floors.find(area => area.id === 0), upper = world.floors.find(area => area.id === 1);
assert.ok(!ground.stair, 'the old main-mansion staircase has moved');
assert.equal(floor.stair.to, upper.id, 'clubhouse stairs lead upstairs');
assert.equal(upper.stair.to, floor.id, 'upstairs returns to the clubhouse');
assert.equal(wing.dog.drain, 2.4, 'dog energy drains four times faster than the original rate');
assert.ok(wing.bowl.x >= 26 && wing.bowl.y <= 4.5, 'dinner is at the far northeast end of the pet kitchen');
assert.ok(Math.hypot(wing.bowl.x - wing.dog.x, wing.bowl.y - wing.dog.y) > 20, 'the new escort covers substantial distance');
assert.equal(wing.toy.energy, 25); assert.equal(wing.toy.level, wing.level);
assert.equal(world.getRoom(wing.toy.x, wing.toy.y, wing.level)?.id, wing.toy.room);
const reachedAreas = new Set([world.start.level ?? 0]), areaQueue = [...reachedAreas];
for (let head = 0; head < areaQueue.length; head++) {
  const area = world.floors.find(value => value.id === areaQueue[head]);
  for (const exit of [...(area.stair ? [area.stair] : []), ...(area.doors || [])]) if (!reachedAreas.has(exit.to)) { reachedAreas.add(exit.to); areaQueue.push(exit.to); }
}
assert.ok(reachedAreas.has(wing.level), 'the clubhouse is connected to the actual game start');
for (const radius of [.22, .25, .26]) {
  const grid = navigation(f, radius), first = grid.nearest(f.state.player), queue = [first], seen = new Set(queue);
  for (let head = 0; head < queue.length; head++) for (const next of grid.edges[queue[head]]) if (!seen.has(next)) { seen.add(next); queue.push(next); }
  const points = queue.map(grid.point), rooms = new Set(points.map(point => world.getRoom(point.x, point.y, wing.level)?.id).filter(Boolean));
  assert.ok(floor.rooms.every(room => rooms.has(room.id)), 'every themed pet room is connected at player and dog radii');
  for (const target of [wing.dog, wing.toy, wing.bowl, floor.stair, ...floor.doors]) assert.ok(points.some(point => Math.hypot(point.x - target.x, point.y - target.y) <= .75 && clear(f, point, target, radius)), 'pet task and transition targets connect safely');
  for (const spot of world.snackSpots.filter(spot => spot.level === wing.level)) assert.ok(points.some(point => world.getRoom(point.x, point.y, wing.level)?.id === spot.room && Math.hypot(point.x - spot.x, point.y - spot.y) <= world.collectionRadius), 'all possible pet-room snacks remain collectible');
}
console.log('PASS: moved reciprocal stairs, real-start connectivity, far dinner bowl and all pet rooms, pickups and task targets reachable');

const otherLevel = world.floors.find(area => area.id !== wing.level).id;
for (const change of [{ level: otherLevel }, { started: false }, { paused: true }, { won: true }, { failed: true }]) {
  const before = JSON.stringify(f.runtime), saved = { ...f.state }; Object.assign(f.state, change); update(f, 3); Object.assign(f.state, saved);
  assert.equal(JSON.stringify(f.runtime), before, 'off-area/inactive runs freeze the pet simulation');
}
Object.assign(f.state.player, { x: f.runtime.dog.x, y: f.runtime.dog.y });
const dogStartEnergy = f.runtime.dog.energy; update(f, 20);
near(f.runtime.dog.energy, dogStartEnergy - 20 * 2.4, 'faster hunger uses actual active-wing elapsed time');
assert.equal(f.simulation.interact(f.state), true, 'the nearby hungry corgi can be called');
guide(f, wing.toy);
assert.equal(f.simulation.canPlay(f.state), true, `the actual escort reaches its toy stop with Waffles close enough: ${JSON.stringify({ player: f.state.player, dog: f.runtime.dog, toy: wing.toy, clock: f.runtime.clock })}`);
const beforeToy = f.runtime.dog.energy, playerFuel = f.state.energy, foodBeforeToy = JSON.stringify({ found: [...f.state.found], bag: f.state.bag, haul: f.state.haulCounts });
f.simulation.drainEvents(); assert.equal(f.simulation.play(f.state), true);
near(f.runtime.dog.energy, Math.min(100, beforeToy + 25), 'toy provides the declared dog-energy refill');
assert.equal(f.state.energy, playerFuel, 'toy never refills player energy');
assert.equal(JSON.stringify({ found: [...f.state.found], bag: f.state.bag, haul: f.state.haulCounts }), foodBeforeToy, 'toy never changes the player haul');
assert.equal(f.runtime.toy.used, true); near(f.runtime.toy.usedAt, f.runtime.clock, 'toy records the actual use time');
assert.equal(f.simulation.drainEvents().filter(event => event.type === 'play').length, 1);
const onceEnergy = f.runtime.dog.energy; assert.equal(f.simulation.play(f.state), false); near(f.runtime.dog.energy, onceEnergy, 'toy cannot be farmed for repeat refills');
update(f, 2.1); finishDinner(f);
assert.equal(f.runtime.dog.happy, true); assert.equal(f.runtime.dog.energy, 100);
assert.ok(f.minimumEnergy > 0, 'the harder escort remains viable after a twenty-second delay when using the toy');
assert.ok(f.coaxed >= 3, 'the real escort handles the intentional sniffing stops with actual calls');
const afterDinner = f.runtime.clock; f.simulation.drainEvents(); update(f, 30);
assert.equal(f.runtime.dog.energy, 100); assert.equal(f.simulation.drainEvents().filter(event => ['fed', 'whine'].includes(event.type)).length, 0, 'completed feeding never repeats or drains again');
console.log(`PASS: full distant escort after20s delay; minimum energy ${f.minimumEnergy.toFixed(2)}, dinner by ${afterDinner.toFixed(2)}s, ${f.coaxed} coax calls/${f.returnedToDog} returns to dog`);

const sleepy = fixture(); Object.assign(sleepy.state.player, { x: sleepy.runtime.dog.x, y: sleepy.runtime.dog.y }); sleepy.runtime.dog.energy = .1;
update(sleepy, 1); assert.equal(sleepy.runtime.dog.sleeping, true); assert.equal(sleepy.runtime.dog.energy, 0);
const nap = { x: sleepy.runtime.dog.x, y: sleepy.runtime.dog.y }; sleepy.simulation.drainEvents(); update(sleepy, 20);
near(sleepy.runtime.dog.x, nap.x, 'sleeping dog stays put'); near(sleepy.runtime.dog.y, nap.y, 'sleeping dog stays put');
assert.equal(sleepy.simulation.drainEvents().filter(event => ['sleep', 'whine'].includes(event.type)).length, 0, 'sleeping dog is quiet without repeated events');
assert.equal(sleepy.simulation.interact(sleepy.state), true); assert.equal(sleepy.runtime.dog.energy, 25); sleepy.minimumEnergy = 25;
guide(sleepy, sleepy.wing.toy); assert.equal(sleepy.simulation.play(sleepy.state), true); update(sleepy, 2.1); finishDinner(sleepy);
assert.ok(sleepy.minimumEnergy > 0, 'wake energy plus the toy can recover the whole longer escort');
console.log(`PASS: wake25 recovery uses toy+2.1s break; minimum energy ${sleepy.minimumEnergy.toFixed(2)}, escort ${(sleepy.runtime.clock - 21).toFixed(2)}s, ${sleepy.coaxed} coax calls/${sleepy.returnedToDog} returns to dog`);
sleepy.simulation.reset();
assert.equal(sleepy.runtime.taskCompleted, false); assert.equal(sleepy.runtime.toy.used, false); assert.equal(sleepy.runtime.toy.usedAt, 0); assert.equal(sleepy.runtime.dog.playUntil, 0);
assert.equal(sleepy.runtime.dog.energy, sleepy.wing.dog.startEnergy);
console.log('PASS: quiet exhaustion, recoverable waking and fresh-run reset of dog and one-use toy');

const toy = fixture(), dog = toy.runtime.dog;
Object.assign(toy.state.player, toy.wing.toy);
assert.equal(toy.simulation.canPlay(toy.state), false, 'an unfollowing distant dog cannot play remotely');
Object.assign(dog, { x: toy.wing.toy.x - .75, y: toy.wing.toy.y, following: true, status: 'following', sleeping: false, energy: 90 });
assert.equal(toy.simulation.canPlay(toy.state), true);
for (const change of [{ level: otherLevel }, { started: false }, { paused: true }, { won: true }, { failed: true }]) {
  const saved = { ...toy.state }; Object.assign(toy.state, change); assert.equal(toy.simulation.play(toy.state), false); Object.assign(toy.state, saved);
}
for (const change of [{ following: false }, { sleeping: true }, { energy: 0 }, { y: toy.wing.toy.y + 3.1 }]) {
  const saved = { ...dog }; Object.assign(dog, change); assert.equal(toy.simulation.canPlay(toy.state), false); Object.assign(dog, saved);
}
toy.runtime.taskCompleted = true; assert.equal(toy.simulation.play(toy.state), false); toy.runtime.taskCompleted = false;
Object.assign(toy.state.player, { x: 18.01, y: 13.9 }); Object.assign(dog, { x: 15.6, y: 13.9 });
assert.ok(toy.world.isWalkable(dog.x, dog.y, .25, toy.wing.level)); assert.equal(toy.simulation.canPlay(toy.state), false, 'toy cannot recruit or refill through a wall');
Object.assign(toy.state.player, toy.wing.toy); Object.assign(dog, { x: toy.wing.toy.x - .75, y: toy.wing.toy.y });
toy.simulation.drainEvents(); assert.equal(toy.simulation.play(toy.state), true); assert.equal(dog.energy, 100);
near(toy.simulation.drainEvents().find(event => event.type === 'play').energy, 10, 'clamped toy event reports only the actual refill');
const hold = { x: dog.x, y: dog.y, energy: dog.energy, clock: toy.runtime.clock };
Object.assign(toy.state.player, { x: toy.wing.toy.x + 2, y: toy.wing.toy.y }); update(toy, 1.8);
near(dog.x, hold.x, 'two-second toy hold prevents following early'); near(dog.y, hold.y, 'two-second toy hold prevents following early');
near(dog.energy, hold.energy - 1.8 * 2.4, 'hunger continues while the dog plays');
update(toy, .4); assert.ok(Math.hypot(dog.x - hold.x, dog.y - hold.y) > .1, 'following resumes after the toy break');
assert.equal(toy.simulation.play(toy.state), false);
console.log('PASS: active/proximity/line-of-sight/following guards, clamped refill, two-second play hold, resumed following and one use per run');
