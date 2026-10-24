import assert from 'node:assert/strict';
import { createGameHarness } from './qa-pathing.mjs';
import { nextHomeExit, walkRoute, walkToHome } from './qa-route-helpers.mjs';

const wingRoomIds = ['laundry', 'wardrobe', 'attic', 'terrace', 'snug'];
const optionalRoomIds = new Set(['laundry', 'wardrobe', 'attic', 'terrace']);
const run = createGameHarness({ seed: 22 }), { qa, world } = run;
const wing = world.floors[3], upstairsDoor = world.floors[1].doors.find(door => door.to === 3);
assert.deepEqual(Array.from(wing.rooms, room => room.id).sort(), wingRoomIds.slice().sort(), 'the Midnight Wing contains the five requested rooms');
assert.equal(world.home.level, 3); assert.equal(world.home.room, 'snug');
assert.ok(upstairsDoor, 'a doorway connects the existing upstairs to the Midnight Wing');
assert.equal(wing.doors.find(door => door.to === 1)?.id, 'midnight-exit', 'the Midnight Wing has a reversible exit to the upstairs');
assert.equal(world.guests.some(guest => guest.level === 3), false, 'no talkative guests pursue the player through the final wing');
assert.equal(qa.state.level, 0, 'the run still starts downstairs');
assert.equal(qa.state.activeRoom, world.getRoom(world.start.x, world.start.y, 0).id, 'starting room is separate from final HOME');
assert.equal(qa.state.visited.has('snug'), false, 'the final snug is unexplored at the beginning');
assert.equal(qa.useDoor(), false, 'the Midnight Wing cannot be entered remotely');

qa.begin(); qa.changeFloor(1, upstairsDoor);
for (let count = 0; qa.state.stairsCooldown > 0 && count < 20; count++) run.stepFrame(100);
assert.equal(qa.canUseDoor(), true, 'the upstairs doorway supports an explicit interaction');
assert.equal(qa.useDoor(), true);
assert.equal(qa.state.level, 3); assert.equal(world.level, 3); assert.equal(qa.state.player.level, 3);
assert.ok(world.isWalkable(qa.state.player.x, qa.state.player.y), 'Midnight Wing arrival is collision-safe');
assert.equal(qa.useDoor(), false, 'transition cooldown prevents an accidental immediate exit');
assert.equal(qa.state.bag.length, 0, 'the direct route begins with no detour food or unlock item');
for (const radius of [.22, world.wing.dog.radius]) {
  for (let y = 11; y <= 13; y += .05) assert.ok(world.isWalkable(25.2, y, radius, 3), `the north hallway entrance clears an actor of radius ${radius}`);
  const entrance = world.moveCircle(25.2, 11, 0, 2, radius, 3);
  assert.ok(Math.abs(entrance.y - 13) < .001, 'swept movement crosses the new north entrance');
  for (const x of [23.8, 26.6]) assert.equal(world.isWalkable(x, 12, radius, 3), false, 'the north wall remains solid beside the opening');
  for (let y = 12.4; y <= 20.6; y += .2) assert.equal(world.isWalkable(21, y, radius, 3), false, 'the full west wall separates the snug from the terrace');
  const fromTerrace = world.moveCircle(20, 16.5, 2, 0, radius, 3);
  const fromSnug = world.moveCircle(22, 16.5, -2, 0, radius, 3);
  assert.ok(fromTerrace.x < 21 && fromSnug.x > 21, 'the old terrace opening blocks swept movement in both directions');
  assert.ok(world.isWalkable(15, 12, radius, 3), 'the terrace retains its own optional hallway entrance');
  for (let index = 1; index < world.midnight.directRoute.length; index++) {
    const from = world.midnight.directRoute[index - 1], to = world.midnight.directRoute[index];
    const steps = Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / .05);
    for (let step = 0; step <= steps; step++) {
      const x = from.x + (to.x - from.x) * step / steps, y = from.y + (to.y - from.y) * step / steps;
      assert.ok(world.isWalkable(x, y, radius, 3), 'every advertised direct-route segment clears both player and dog');
      assert.equal(optionalRoomIds.has(world.getRoom(x, y, 3)?.id), false, 'advertised direct-route segments stay out of every optional room');
    }
  }
}
const visitedAlongRoute = new Set();
let previousPosition = { ...qa.state.player }, crossedNorthEntrance = false;
qa.headHome();
for (const point of qa.getPath()) {
  assert.equal(optionalRoomIds.has(world.getRoom(point.x, point.y)?.id), false, 'couch navigation does not enter an optional snack room');
}
walkRoute(run, { label: 'direct hallway-to-couch path', onFrame: () => {
  const player = qa.state.player, room = world.getRoom(player.x, player.y);
  if (room) visitedAlongRoute.add(room.id);
  if (previousPosition.y < 12 && player.y >= 12) {
    assert.ok(player.x >= 24.2 + .22 && player.x <= 26.2 - .22, 'the actual couch route crosses through the new north opening');
    crossedNorthEntrance = true;
  }
  previousPosition = { x: player.x, y: player.y };
} });
assert.equal(qa.state.level, 3);
assert.ok(world.isHome(qa.state.player.x, qa.state.player.y), 'direct route reaches the couch');
assert.ok(crossedNorthEntrance && visitedAlongRoute.has('snug'), 'the direct hallway route enters the snug from the north');
for (const id of optionalRoomIds) assert.equal(visitedAlongRoute.has(id), false, `${id} remains an optional detour`);
assert.equal(qa.state.found.size, 0, 'taking the direct path requires no automatic pickups');
assert.equal(qa.finishRun(), false, 'reaching the couch with an empty bag cannot bank a score');
console.log(`PASS: upstairs doorway, direct hallway-to-couch route, north entrance and closed west wall for player/Waffles, no optional rooms or food; ${qa.state.energy.toFixed(1)} energy left`);

const stairTrip = createGameHarness();
stairTrip.qa.begin(); stairTrip.qa.changeFloor(3, stairTrip.world.home);
stairTrip.qa.headForStairs(); walkRoute(stairTrip, { label: 'Midnight Wing route back to stairs' });
assert.equal(stairTrip.qa.state.level, 3, 'the stair shortcut first stops at the real Midnight Wing door');
assert.equal(stairTrip.qa.canUseDoor(), true); assert.equal(stairTrip.qa.useDoor(), true);
assert.equal(stairTrip.qa.state.level, 1, 'explicit E returns to the upstairs');
assert.ok(stairTrip.qa.getPath().length, 'the stair shortcut continues toward the upstairs staircase');
walkRoute(stairTrip, { label: 'continued upstairs staircase route' });
assert.equal(stairTrip.qa.state.level, 1, 'the continued route does not descend automatically');
assert.equal(stairTrip.qa.canUseStairs(), true, 'the stair shortcut ends at an interactable staircase');
console.log('PASS: Midnight Wing stair shortcut crosses its door explicitly and continues to the upstairs stairs');

// Check every area uses the same connected destination. Fixtures isolate the
// navigation control; actual pickup/energy budgets are tested below and by the
// seeded energy and upstairs suites.
for (const floor of world.floors) {
  const trip = createGameHarness({ seed: 4 }), game = trip.qa, map = trip.world;
  game.begin();
  if (floor.id !== 0) game.changeFloor(floor.id, map.floors[floor.id].stair || map.floors[floor.id].doors[0]);
  for (const food of map.snacks.filter(snack => snack.level === 0).slice(0, 8)) {
    game.state.found.add(food.id); game.state.bag.push(food); game.state.haulCounts[food.kind] = (game.state.haulCounts[food.kind] || 0) + 1;
  }
  const expected = [], seen = new Set(); let cursor = floor.id;
  while (cursor !== map.home.level) {
    assert.equal(seen.has(cursor), false); seen.add(cursor);
    const exit = nextHomeExit(map, cursor); expected.push([cursor, exit.to]); cursor = exit.to;
  }
  assert.deepEqual(walkToHome(trip), expected, `couch control uses all required connections from ${floor.name}`);
  for (const room of optionalRoomIds) assert.equal(game.state.visited.has(room), false, `${room} is optional when heading home from any floor`);
  assert.ok(game.state.bag.length > 0, 'navigation fixture retains food for explicit banking');
  assert.equal(game.finishRun(), true, 'the final couch banks without completing side rooms');
  assert.ok(game.state.ending?.active, 'the cinematic begins in the final snug');
  assert.equal(game.state.level, map.home.level, 'the cinematic stays on the relocated couch floor');
}
console.log('PASS: couch navigation from every area, explicit floor transitions and optional-room-free banking');

const guard = createGameHarness(), game = guard.qa, map = guard.world;
game.begin(); const food = map.snacks[0]; game.state.found.add(food.id); game.state.bag.push(food); game.state.haulCounts[food.kind] = 1;
for (const floor of map.floors.filter(floor => floor.id !== map.home.level)) {
  game.changeFloor(floor.id, map.home);
  assert.equal(game.canFinishRun(), false, `matching couch coordinates on ${floor.name} cannot finish`);
  assert.equal(game.finishRun(), false);
}
game.changeFloor(map.home.level, map.home);
assert.equal(game.finishRun(), true); assert.equal(game.state.bankedCount, 1);
game.restart();
assert.equal(game.state.level, 0); assert.equal(map.level, 0); assert.equal(game.state.player.level, 0);
assert.equal(game.state.player.x, map.start.x); assert.equal(game.state.player.y, map.start.y);
assert.equal(game.state.nearHome, false); assert.equal(game.state.activeRoom, map.getRoom(map.start.x, map.start.y, 0).id);
assert.equal(game.state.ending, null); assert.equal(game.state.bag.length, 0); assert.equal(game.state.visited.has(map.home.room), false);
console.log('PASS: couch floor isolation, relocated cinematic and restart at the downstairs beginning');

// A real Midnight Wing snack detour: walk from the entry into each side room,
// collect actual generated food, and include the optional terrace before banking.
for (const seed of [2, 7, 19, 44]) {
  const trip = createGameHarness({ seed }), game = trip.qa, map = trip.world;
  game.begin(); game.changeFloor(3, map.floors[3].doors[0]);
  let picked = 0;
  for (const room of ['laundry', 'wardrobe', 'attic']) {
    const candidates = map.snacks.filter(snack => snack.room === room).sort((a, b) => Math.hypot(a.x - game.state.player.x, a.y - game.state.player.y) - Math.hypot(b.x - game.state.player.x, b.y - game.state.player.y));
    assert.ok(candidates.length, `${room} offers hidden snack detours`);
    for (const target of candidates.slice(0, 2)) {
      game.navigate(target.x, target.y, target); walkRoute(trip, { label: `${room} food detour` });
      assert.ok(game.state.found.has(target.id), `${target.id} is collectible by walking`); picked++;
    }
  }
  const terraceSnacks = map.snacks.filter(snack => snack.room === 'terrace' && !game.state.found.has(snack.id))
    .sort((a, b) => Math.hypot(a.x - map.home.x, a.y - map.home.y) - Math.hypot(b.x - map.home.x, b.y - map.home.y)).slice(0, 2);
  assert.equal(terraceSnacks.length, 2, 'the optional terrace offers real snack detours');
  for (const terraceSnack of terraceSnacks) {
    game.navigate(terraceSnack.x, terraceSnack.y, terraceSnack);
    walkRoute(trip, { label: 'optional terrace snack before the snug' });
    assert.ok(game.state.found.has(terraceSnack.id), 'the terrace snack is collected by actual walking'); picked++;
  }
  walkToHome(trip);
  assert.ok(game.state.bag.length > 0, `seed ${seed} keeps food after optional detours`);
  assert.equal(game.state.found.size, picked); assert.equal(game.state.found.size, game.state.bag.length + game.state.consumedCount);
  assert.equal(game.finishRun(), true, `seed ${seed} banks actual detour food without energy overrides`);
  console.log(`PASS: Midnight Wing detours seed ${seed}: ${picked} picked, ${game.state.bankedCount} banked, ${game.state.energy.toFixed(1)} energy`);
}
