import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGameHarness } from './qa-pathing.mjs';

const root = path.dirname(fileURLToPath(import.meta.url)), sandbox = { window: {}, console };
vm.createContext(sandbox); vm.runInContext(fs.readFileSync(path.join(root, 'dist/world.js'), 'utf8'), sandbox);
const world = sandbox.window.HSWorld, actorRadius = world.playerRadius;
assert.equal(typeof world.moveCircle, 'function', 'one shared circular movement solver serves the game');
const profiles = world.floors[0].collisionProfiles;
assert.ok(profiles.length > 0 && profiles.every(profile => Number.isFinite(profile.cornerRadius) && profile.cornerRadius >= 0 && profile.cornerRadius <= Math.min(profile.w, profile.h) / 2), 'rounded collision profiles are bounded by actual furniture sizes');
assert.ok(profiles.filter(profile => profile.solid.exterior).every(profile => profile.cornerRadius === 0), 'estate exterior stays square and solid');
const island = profiles.find(profile => profile.solid.type === 'island');
assert.ok(island?.cornerRadius > .1, 'a large furniture prop has meaningful rounded corners');
const oldBoxCollision = (profile, x, y, radius) => Math.hypot(x - Math.max(profile.x, Math.min(x, profile.x + profile.w)), y - Math.max(profile.y, Math.min(y, profile.y + profile.h))) < radius;
for (const [x, y] of [[island.x - .1, island.y - .1], [island.x + island.w + .1, island.y - .1], [island.x - .1, island.y + island.h + .1], [island.x + island.w + .1, island.y + island.h + .1]]) {
  assert.equal(oldBoxCollision(island, x, y, actorRadius), true, 'fixture lies inside the former square-corner clearance');
  assert.equal(world.isWalkable(x, y, actorRadius, 0), true, 'rounded corners permit a circular actor to graze past each outside corner');
}
const middle = island.x + island.w / 2;
assert.equal(world.isWalkable(middle, island.y - actorRadius + .01, actorRadius, 0), false, 'rounding preserves the full straight front face');
assert.equal(world.isWalkable(middle, island.y - actorRadius - .01, actorRadius, 0), true, 'the straight-face clearance remains exact');
assert.equal(world.isWalkable(middle, island.y + island.h / 2, 0, 0), false, 'even point actors cannot enter solid furniture interiors');
assert.equal(world.isWalkable(middle, island.y - .39, .4, 0), false, 'larger circular actors need greater face clearance');
assert.equal(world.isWalkable(middle, island.y - .41, .4, 0), true);
const wall = profiles.find(profile => profile.solid.room === 'library' && profile.x === 1 && Math.abs(profile.y - 9.88) < .001);
assert.ok(wall && wall.cornerRadius > 0 && wall.cornerRadius <= .08, 'wall ends receive a small round cap');
const wallCorner = { x: wall.x + wall.w + .145, y: wall.y - .145 };
assert.equal(oldBoxCollision(wall, wallCorner.x, wallCorner.y, actorRadius), true);
assert.equal(world.isWalkable(wallCorner.x, wallCorner.y, actorRadius, 0), true, 'a wall end can be brushed past without a square snag');
assert.equal(world.floors[0].collisionProfiles, profiles, 'walkability reuses precomputed profiles');
console.log('PASS: cached rounded furniture corners and wall end caps, retained flat faces, interior solidity and actor-size clearance');

function checkedMove(x, y, dx, dy, level = 0, radius = actorRadius) {
  const result = world.moveCircle(x, y, dx, dy, radius, level), requested = Math.hypot(dx, dy);
  assert.ok(Number.isFinite(result.x) && Number.isFinite(result.y) && Number.isFinite(result.distance), 'movement produces finite coordinates');
  assert.ok(result.distance >= 0 && result.distance <= requested + 1e-7, 'sliding cannot add speed or travel beyond the movement budget');
  assert.ok(Math.hypot(result.x - x, result.y - y) <= result.distance + 1e-6, 'reported travel covers the actual displacement');
  assert.ok(world.isWalkable(result.x, result.y, radius, level), 'the completed move remains outside all solids');
  return result;
}
const glide = checkedMove(island.x - .5, island.y - .3, 1.4, .2);
assert.ok(glide.x > island.x + .75, 'a glancing approach slides around the rounded corner and continues along the face');
assert.ok(glide.y <= island.y - actorRadius + .0001, 'the glide stays outside the front face');
let brush = { x: island.x - .65, y: island.y - .3 }, movingSteps = 0;
for (let step = 0; step < 90; step++) { const next = checkedMove(brush.x, brush.y, .03, .01); if (next.distance > .005) movingSteps++; brush = next; }
assert.ok(movingSteps >= 85 && brush.x > island.x + 1.5, 'repeated diagonal pressure keeps sliding smoothly instead of catching on the corner');
const furnitureSweep = checkedMove(middle, island.y - .6, 0, 5);
assert.ok(furnitureSweep.y <= island.y - actorRadius + .0001, 'a large movement cannot tunnel through furniture');
const wallSweep = checkedMove(2, 9, 0, 5);
assert.ok(wallSweep.y <= wall.y - actorRadius + .0001, 'a large movement cannot pass through a closed room wall');
const exterior = checkedMove(1.5, 11, -20, 0);
assert.ok(exterior.x >= 1 + actorRadius - 1e-8 && exterior.x < 1.3, 'hard estate boundaries contain the actor');
for (const [dx, dy] of [[-.8, -.8], [.8, -.8], [-.8, .8], [.8, .8]]) checkedMove(10, 11, dx, dy);
console.log('PASS: glancing and repeated tangent sliding, bounded speed, continuous solid blocking and hard outside walls');

assert.equal(world.isWalkable(15.15, 5.5, actorRadius, 0), false, 'downstairs kitchen island blocks its own floor');
assert.equal(world.isWalkable(15.15, 5.5, actorRadius, 1), true, 'the same upstairs aisle uses a different collision map');
for (const floor of world.floors) {
  for (const exit of [...(floor.stair ? [floor.stair] : []), ...(floor.doors || [])]) assert.ok(world.isWalkable(exit.x, exit.y, actorRadius, floor.id), 'stairs and wing doors stay walkable');
  for (const guest of world.guests.filter(person => person.level === floor.id)) {
    assert.ok(world.isWalkable(guest.x, guest.y, actorRadius, floor.id), 'guests spawn safely');
    for (const point of guest.route) assert.ok(world.isWalkable(point.x, point.y, actorRadius, floor.id), 'guest patrol points stay reachable floor positions');
  }
}
for (const radius of [-.1, NaN, Infinity]) assert.equal(world.isWalkable(10, 11, radius, 0), false, 'invalid actor sizes are rejected');
for (const args of [[10, 11, NaN, 1], [10, 11, 1, Infinity], [10, 11, 1, 1, -.2], [10, 11, 1, 1, .22, 8]]) {
  const result = world.moveCircle(...args); assert.equal(result.distance, 0, 'invalid movement is inert'); assert.ok(Number.isFinite(result.x) && Number.isFinite(result.y));
}
assert.equal(world.moveCircle(middle, island.y + .5, 1, 0, actorRadius, 0).distance, 0, 'an invalid overlapping start cannot be pushed through a prop');

const run = createGameHarness({ guestBrainEnabled: false });
Object.assign(run.qa.state.player, { x: island.x - .5, y: island.y - .3 }); run.qa.begin();
const before = { ...run.qa.state.player }, reported = run.qa.move(1.4, .2);
assert.ok(run.qa.state.player.x > island.x + .75 && world.isWalkable(run.qa.state.player.x, run.qa.state.player.y), 'manual movement uses the shared rounded solver');
assert.ok(reported <= Math.hypot(1.4, .2) + 1e-7 && reported >= Math.hypot(run.qa.state.player.x - before.x, run.qa.state.player.y - before.y) - 1e-6, 'manual movement reports physical sliding distance for energy use');
console.log('PASS: all three areas, spawn/stair/door safety, invalid-input guards and actual player movement integration');
