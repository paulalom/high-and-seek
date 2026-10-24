import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const sandbox = { window: {}, console };
vm.createContext(sandbox);
for (const source of ['world.js', 'guests.js']) vm.runInContext(fs.readFileSync(path.join(root, 'dist', source), 'utf8'), sandbox);
const world = sandbox.window.HSWorld, api = sandbox.window.HSGuestBrain;
assert.equal(typeof api?.create, 'function', 'standalone guest module exposes its brain factory');
world.activateFloor(1);
let collisions = 0;
const originalWalkable = world.isWalkable;
world.isWalkable = function (...args) { collisions++; return originalWalkable.apply(this, args); };
const clone = (id = 'hallwayChat') => {
  const template = world.guests.find(guest => guest.id === id);
  return { ...template, route: template.route.map(point => ({ ...point })), routeIndex: 0 };
};
const create = (id = 'hallwayChat') => ({ brain: api.create(world), guests: [clone(id)] });
function tick(brain, guests, player, seconds, options = {}) {
  const frames = Math.ceil(seconds * 60);
  for (let frame = 0; frame < frames; frame++) {
    const before = guests.map(guest => ({ x: guest.x, y: guest.y }));
    brain.update(guests, player, seconds / frames, options);
    for (const [index, guest] of guests.entries()) {
      assert.ok(world.isWalkable(guest.x, guest.y, .22, guest.level), `guest ${guest.id} remains collision-safe`);
      assert.ok(Math.hypot(guest.x - before[index].x, guest.y - before[index].y) <= 2.25 * seconds / frames + .005, 'pursuit never teleports or exceeds its speed budget');
    }
  }
}

const pursuit = create(), runner = { x: 10, y: 8, level: 1 };
const initialGap = Math.hypot(pursuit.guests[0].x - runner.x, pursuit.guests[0].y - runner.y);
tick(pursuit.brain, pursuit.guests, runner, 1.5);
assert.equal(pursuit.guests[0].chasing, true, 'visible nearby player alerts a guest');
assert.ok(Math.hypot(pursuit.guests[0].x - runner.x, pursuit.guests[0].y - runner.y) < initialGap - 2, 'guest actively closes the distance to the player');
const frozen = JSON.stringify(pursuit.guests.map(guest => [guest.x, guest.y]));
tick(pursuit.brain, pursuit.guests, runner, 1, { active: false });
assert.equal(JSON.stringify(pursuit.guests.map(guest => [guest.x, guest.y])), frozen, 'inactive game freezes pursuit');
tick(pursuit.brain, pursuit.guests, runner, 1, { conversation: { guestId: pursuit.guests[0].id } });
assert.equal(JSON.stringify(pursuit.guests.map(guest => [guest.x, guest.y])), frozen, 'a conversation freezes guest movement');
tick(pursuit.brain, pursuit.guests, runner, .1, { cooldown: 6 });
assert.equal(pursuit.guests[0].chasing, false, 'escape immunity suppresses pursuit');
console.log('PASS: nearby guests pursue, remain speed-limited and collision-safe; inactivity, conversation and cooldown guard chase');

const evade = create(), fleeing = { x: 10, y: 8, level: 1 };
tick(evade.brain, evade.guests, fleeing, .05);
const gapBefore = fleeing.y - evade.guests[0].y;
for (let frame = 0; frame < 120; frame++) { fleeing.y += 4.7 / 60; tick(evade.brain, evade.guests, fleeing, 1 / 60); }
assert.ok(fleeing.y - evade.guests[0].y > gapBefore + 3, 'walking speed lets a player pull away rather than making contact inevitable');
fleeing.y = 20;
tick(evade.brain, evade.guests, fleeing, .1);
assert.equal(evade.guests[0].chasing, false, 'escaping beyond eleven units drops pursuit');
console.log('PASS: the player can outpace a pursuer and break contact');

const occluded = create(), behindWall = { x: 12, y: 3, level: 1 };
tick(occluded.brain, occluded.guests, behindWall, .2);
assert.equal(occluded.guests[0].chasing, false, 'a nearby player through a closed wall cannot alert a guest');
const detour = create('snackExpert'), aroundIsland = { x: 14.95, y: 6.4, level: 1 };
tick(detour.brain, detour.guests, aroundIsland, .2);
assert.equal(detour.guests[0].chasing, true, 'guest first acquires a visible player in the central pantry aisle');
aroundIsland.x = 18.5;
tick(detour.brain, detour.guests, aroundIsland, 3.8);
assert.ok(Math.hypot(detour.guests[0].x - aroundIsland.x, detour.guests[0].y - aroundIsland.y) < 1.6, 'pathfinding pursues around the pantry island rather than sticking against it');
console.log('PASS: walls block detection and the navigation field routes pursuit around furniture');

const forget = create(), remembered = { x: 10, y: 8, level: 1 };
tick(forget.brain, forget.guests, remembered, .1);
assert.equal(forget.guests[0].chasing, true);
Object.assign(remembered, { x: 12, y: 3 });
tick(forget.brain, forget.guests, remembered, 4.3);
assert.equal(forget.guests[0].chasing, false, 'four seconds out of sight clears remembered pursuit');

const shared = world.guests.map((guest, index) => ({ ...clone(guest.id), x: 10, y: 3 + index * .3 })), sharedBrain = api.create(world);
tick(sharedBrain, shared, { x: 10, y: 8, level: 1 }, 4);
const debug = sharedBrain.getDebug();
assert.equal(debug.gridBuilds, 1, 'six pursuers share one cached collision grid');
assert.ok(debug.fieldBuilds >= 8 && debug.fieldBuilds <= 17, `six pursuers share a navigation field rebuilt at most four times per second (${debug.fieldBuilds})`);
assert.ok(debug.reachableCells > 100, 'the shared pursuit field reaches the upstairs navigation graph');
console.log(`PASS: pursuit memory expires behind cover; six pursuers share one grid and ${debug.fieldBuilds} flow builds over four seconds`);

const exit = create('snackExpert'), safePlayer = { x: 15, y: 11, level: 1 };
tick(exit.brain, exit.guests, safePlayer, 3);
assert.equal(exit.guests[0].chasing, false, 'standing on the stairs keeps a clear escape route');
const hidden = create(), downstairs = { x: 10, y: 8, level: 0 };
world.activateFloor(0);
const hiddenPosition = JSON.stringify(hidden.guests.map(guest => [guest.x, guest.y]));
tick(hidden.brain, hidden.guests, downstairs, 2);
assert.equal(JSON.stringify(hidden.guests.map(guest => [guest.x, guest.y])), hiddenPosition, 'guests on the other floor do not chase or wander');
world.activateFloor(1);
hidden.brain.reset();
tick(hidden.brain, hidden.guests, { x: 10, y: 8, level: 1 }, .1);
assert.equal(hidden.guests[0].chasing, true, 'reset discards old floor targeting and permits a fresh encounter');

// Repeated updates with all real guests catch narrow aisles, bad route nodes,
// unsafe flow-field corners and excessive steady collision work.
const crowd = world.guests.map(guest => clone(guest.id)), crowdBrain = api.create(world);
tick(crowdBrain, crowd, { x: 15, y: 11, level: 1 }, .1);
collisions = 0;
tick(crowdBrain, crowd, { x: 15, y: 11, level: 1 }, 12);
assert.ok(collisions < 60000, `steady guest updates stay bounded (${collisions} collision checks over twelve seconds)`);
assert.ok(crowd.every(guest => guest.alertness === 'patrolling' || guest.alertness === 'idle'), 'safe landing does not leave a stale alert marker');
console.log(`PASS: stairs/floor/reset guards and twelve seconds of six-guest navigation; ${collisions} bounded collision checks`);
