import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const sandbox = { window: {}, console };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, 'dist/world.js'), 'utf8'), sandbox);
const world = sandbox.window.HSWorld;
assert.ok(world, 'world.js exposes HSWorld');
const expectedSnackEnergy = { cookies: 22, chips: 19, nachos: 26, icecream: 21, soda: 16, pizza: 29, donut: 24, gummies: 22 };
assert.deepEqual(Object.fromEntries(world.snackKinds.map(kind => [kind.id, kind.energy])), expectedSnackEnergy, 'declared snack energy uses the reduced full-value refill balance');
assert.ok(world.width > 0 && world.height > 0, 'world has positive dimensions');
assert.equal(world.floors.length, 3, 'mansion contains two floors and a separate ground-floor wing');
assert.equal(world.level, 0, 'standalone world starts downstairs');
assert.equal(world.home.level, 0, 'only downstairs has the extraction couch');
assert.equal(world.rules.conversationRadius, 1.05, 'small talk needs close contact');
assert.equal(world.rules.conversationDuration, 16, 'talk fallback lasts sixteen seconds');
assert.equal(world.rules.conversationEscapePresses, 12, 'escape needs twelve presses');
assert.equal(world.rules.conversationCooldown, 6, 'escaped players receive six seconds of breathing room');
assert.ok(world.isHome(world.start.x, world.start.y, 0), 'player starts at home');
assert.equal(world.isHome(world.home.x, world.home.y, 1), false, 'same coordinates upstairs cannot bank a haul');
assert.ok(world.furniture.some(item => item.room === world.home.room && item.type === 'sofa'), 'starting room has a couch');
assert.ok(world.furniture.some(item => item.room === world.home.room && item.type === 'television'), 'starting room has a television');
assert.equal(world.isWalkable(23.71369904661551, 1.3522738945204764, world.playerRadius, 1), false, 'party sofa closes the north-wall sliver that has no navigation-grid cell');

const snacksReference = world.snacks, poolSizes = new Set(), spotCatalog = world.snackSpots;
assert.ok(spotCatalog.length > 0, 'possible hiding spots are exposed for reachability checks');
let randomSeed = 71;
const random = () => ((randomSeed = (randomSeed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
for (let trial = 0; trial < 24; trial++) {
  world.shuffleSnacks(random);
  assert.equal(world.snacks, snacksReference, 'new runs preserve the shared snack array identity');
  poolSizes.add(world.snacks.length);
  const downstairs = world.snacks.filter(item => item.level === 0), upstairs = world.snacks.filter(item => item.level === 1);
  assert.ok(downstairs.length >= 16 && downstairs.length <= 22, 'ground floor retains 16–22 hidden pickups');
  assert.ok(upstairs.length >= 30 && upstairs.length <= 40, 'upstairs has 30–40 hidden pickups');
  assert.ok(upstairs.length > downstairs.length, 'upstairs offers a larger haul');
  const wing = world.snacks.filter(item => item.level === 2);
  assert.ok(wing.length >= 10 && wing.length <= 16, 'the new wing has its own hidden snack supply');
  assert.equal(new Set(world.snacks.map(item => item.id)).size, world.snacks.length, 'pickup IDs are globally unique');
  assert.equal(new Set(world.snacks.map(item => `${item.level}:${item.x},${item.y}`)).size, world.snacks.length, 'pickups never overlap on the same floor');
  assert.ok(downstairs.some(item => item.room === world.home.room), 'home has an onboarding snack');
  assert.ok(world.snacks.every(item => world.snackKinds.some(kind => kind.id === item.kind)), 'every pickup uses a declared snack kind');
  assert.ok(world.snacks.every(item => item.energy >= 16 && item.energy <= 29), 'smaller 16–29 energy refills make carried food part of the return budget');
  assert.ok(world.snacks.every(item => item.energy === world.snackKinds.find(kind => kind.id === item.kind).energy), 'spawned pickups retain their kind’s declared energy');
}
assert.ok(poolSizes.size > 1, 'hidden total varies between runs');
world.shuffleSnacks(() => .5);

let totalPositions = 0, totalTargets = 0;
for (const floor of world.floors) {
  world.activateFloor(floor.id);
  assert.equal(world.level, floor.id, 'activation changes the active floor');
  assert.equal(world.rooms, floor.rooms, 'activation supplies this floor’s rooms');
  assert.equal(world.furniture, floor.furniture, 'activation supplies this floor’s furniture');
  assert.equal(world.walls, floor.walls, 'activation supplies this floor’s walls');
  assert.equal(floor.rooms.length, floor.id === 2 ? 3 : 6, 'each area has its intended room layout');
  const roomIds = new Set(floor.rooms.map(room => room.id));
  assert.equal(roomIds.size, floor.rooms.length, 'room IDs are unique within a floor');
  const exits = [...(floor.stair ? [floor.stair] : []), ...(floor.doors || [])];
  assert.ok(exits.length, 'every area has an exit');
  for (const exit of exits) {
    const destination = world.floors.find(other => other.id === exit.to);
    assert.ok(destination && [...(destination.stair ? [destination.stair] : []), ...(destination.doors || [])].some(returnExit => returnExit.to === floor.id), 'transitions form reversible connections');
    assert.ok(world.isWalkable(exit.x, exit.y), 'transition interaction point is collision-safe');
    assert.ok(world.isWalkable(exit.arrival.x, exit.arrival.y, world.playerRadius, destination.id), 'transition arrives at a safe point in the destination area');
  }
  const snacks = world.snacks.filter(item => item.level === floor.id), targets = [];
  for (const room of floor.rooms) {
    assert.ok(room.name && room.w > 0 && room.h > 0, `room ${room.id} has a name and valid size`);
    assert.ok(room.x >= 0 && room.y >= 0 && room.x + room.w <= world.width && room.y + room.h <= world.height, `room ${room.id} stays inside the world`);
  }
  for (const spot of spotCatalog.filter(item => item.level === floor.id)) {
    const room = floor.rooms.find(value => value.id === spot.room);
    assert.ok(room, `catalog spot ${spot.id} belongs to this floor`);
    assert.ok(spot.x >= room.x && spot.x <= room.x + room.w && spot.y >= room.y && spot.y <= room.y + room.h, `catalog spot ${spot.id} stays in its room`);
    targets.push({ key: `catalog:${spot.id}`, x: spot.x, y: spot.y });
  }
  for (const snack of snacks) {
    assert.ok(snack.name && snack.clue && roomIds.has(snack.room), `snack ${snack.id} has a valid name, clue and room`);
    assert.ok(snack.energy > 0 && snack.energy <= world.rules.maxEnergy, `snack ${snack.id} has a valid refill`);
    targets.push({ key: snack.id, x: snack.x, y: snack.y });
    for (const [index, spot] of (snack.hidingSpots || []).entries()) targets.push({ key: `${snack.id}:${index}`, ...spot });
  }
  // Explore the actual collision surface, not a hand-maintained room graph.
  const origin = floor.id === 0 ? world.start : floor.stair || floor.doors[0];
  const step = .25, key = (x, y) => `${x},${y}`, queue = [[0, 0]], seen = new Set([key(0, 0)]);
  const reachedRooms = new Set(), reachedTargets = new Set();
  const reachedExits = new Set();
  for (let head = 0; head < queue.length; head++) {
    const [gx, gy] = queue[head], x = origin.x + gx * step, y = origin.y + gy * step;
    const room = world.getRoom(x, y);
    if (room) reachedRooms.add(room.id);
    exits.forEach((exit, index) => { if (Math.hypot(x - exit.x, y - exit.y) <= exit.radius) reachedExits.add(index); });
    for (const target of targets) if (Math.hypot(target.x - x, target.y - y) <= world.collectionRadius) reachedTargets.add(target.key);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = gx + dx, ny = gy + dy, nextKey = key(nx, ny), wx = origin.x + nx * step, wy = origin.y + ny * step;
      if (seen.has(nextKey) || wx < 0 || wy < 0 || wx > world.width || wy > world.height || !world.isWalkable(wx, wy)) continue;
      seen.add(nextKey); queue.push([nx, ny]);
    }
  }
  assert.equal(reachedRooms.size, floor.rooms.length, `all ${floor.name} rooms reachable; missing ${floor.rooms.filter(room => !reachedRooms.has(room.id)).map(room => room.id)}`);
  assert.equal(reachedExits.size, exits.length, 'all area transitions are reachable from its entry');
  assert.equal(reachedTargets.size, targets.length, `all ${floor.name} hides collectible; missing ${targets.filter(target => !reachedTargets.has(target.key)).map(target => target.key)}`);
  // A manually reachable pickup can still sit just beyond every point on the
  // coarser click-navigation grid, particularly when it is on a deep sofa.
  const clickPickupTargets = new Set();
  for (let y = .5; y < world.height; y += .5) for (let x = .5; x < world.width; x += .5) {
    if (!world.isWalkable(x, y)) continue;
    for (const target of targets) if (Math.hypot(target.x - x, target.y - y) <= world.collectionRadius) clickPickupTargets.add(target.key);
  }
  assert.equal(clickPickupTargets.size, targets.length, `all ${floor.name} hides have a click-navigation pickup position; missing ${targets.filter(target => !clickPickupTargets.has(target.key)).map(target => target.key)}`);
  for (const guest of world.guests.filter(item => item.level === floor.id)) {
    assert.ok(world.isWalkable(guest.x, guest.y), `guest ${guest.id} spawns on walkable floor`);
    assert.ok(guest.route.length >= 2, `guest ${guest.id} has a wandering route`);
    for (const point of guest.route) assert.ok(world.isWalkable(point.x, point.y), `guest ${guest.id} route waypoint is walkable`);
  }
  totalPositions += queue.length; totalTargets += targets.length;
  console.log(`PASS: ${floor.name}: ${floor.rooms.length} rooms, exits and ${targets.length} snack placements reachable across ${queue.length} collision-safe positions`);
}
assert.ok(world.guests.filter(item => item.level === 1).length >= 5, 'upstairs has at least five talkative guests');
world.activateFloor(0);
console.log(`PASS: two floors and the wing, smaller refills, variable hidden pools, valid guest routes; ${totalTargets} placements / ${totalPositions} walkable positions`);
