import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGameHarness } from './qa-pathing.mjs';

const root = path.dirname(fileURLToPath(import.meta.url)), sandbox = { window: {}, console };
vm.createContext(sandbox); vm.runInContext(fs.readFileSync(path.join(root, 'dist/world.js'), 'utf8'), sandbox);
const world = sandbox.window.HSWorld, island = world.floors[0].furniture.find(item => item.type === 'island');
const near = (actual, expected, label, tolerance = .02) => assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: expected ${expected}, got ${actual}`);

// Both endpoints are clear, but the chord cuts through a shallow corner arc
// for less than one .08-unit movement substep. Endpoint-only checks miss it.
const radius = .02, arcRadius = island.cornerRadius + radius, diagonal = Math.SQRT1_2;
const center = { x: island.x + island.cornerRadius, y: island.y + island.cornerRadius };
const midpoint = { x: center.x - (arcRadius - .0002) * diagonal, y: center.y - (arcRadius - .0002) * diagonal };
const start = { x: midpoint.x - .039 * diagonal, y: midpoint.y + .039 * diagonal };
const end = { x: midpoint.x + .039 * diagonal, y: midpoint.y - .039 * diagonal };
assert.ok(world.isWalkable(start.x, start.y, radius) && world.isWalkable(end.x, end.y, radius), 'grazing endpoints are clear');
assert.equal(world.isWalkable(midpoint.x, midpoint.y, radius), false, 'grazing midpoint intersects the rounded solid');
const grazed = world.moveCircle(start.x, start.y, end.x - start.x, end.y - start.y, radius);
assert.ok(world.isWalkable(grazed.x, grazed.y, radius), 'continuous graze finishes clear');
assert.ok(Math.hypot(grazed.x - end.x, grazed.y - end.y) > .00001, 'continuous sweep catches the rounded graze between clear endpoints');
assert.ok(grazed.distance <= Math.hypot(end.x - start.x, end.y - start.y) + .000001, 'grazing cannot create extra speed');
console.log('PASS: substep-short rounded-corner grazing is swept continuously between clear endpoints');

const run = createGameHarness({ guestBrainEnabled: false });
run.qa.begin(); run.qa.state.guests = [];
for (const frameMs of [1000 / 60, 1000]) for (const level of [0, 1]) {
  const floor = run.world.floors[level];
  const exit = floor.stair || floor.doors[0];
  if (run.qa.state.level !== level) run.qa.changeFloor(level, exit);
  const prop = floor.furniture.find(item => item.type === 'island');
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const corner = { x: prop.x + (sx > 0 ? prop.w : 0) + sx * .11, y: prop.y + (sy > 0 ? prop.h : 0) + sy * .11 };
    assert.ok(run.world.isWalkable(corner.x, corner.y), 'corner fixture starts in the new rounded clearance');
    Object.assign(run.qa.state.player, corner); run.qa.state.energy = run.world.rules.maxEnergy;
    run.qa.navigate(exit.x, exit.y);
    assert.ok(run.qa.getPath().length, 'the rounded clearance connects safely to the navigation grid');
    const landing = { ...run.qa.getPath().at(-1) };
    assert.ok(run.world.isWalkable(landing.x, landing.y), 'transition route chooses a safe grid landing');
    assert.ok(Math.hypot(landing.x - exit.x, landing.y - exit.y) <= exit.radius, 'grid landing lies within the physical exit interaction zone');
    for (let frame = 0; run.qa.getPath().length && !run.qa.state.failed && frame < 4000; frame++) {
      run.stepFrame(frameMs);
      assert.ok(run.world.isWalkable(run.qa.state.player.x, run.qa.state.player.y), 'navigation never cuts through a rounded solid');
    }
    assert.equal(run.qa.state.failed, false, 'corner route remains affordable');
    near(run.qa.state.player.x, landing.x, 'corner route reaches its safe exit waypoint horizontally');
    near(run.qa.state.player.y, landing.y, 'corner route reaches its safe exit waypoint vertically');
    assert.equal(floor.stair === exit ? run.qa.canUseStairs() : run.qa.canUseDoor(), true, 'corner route ends at a usable physical transition');
  }
}
console.log('PASS: sixteen corner-adjacent routes reach the gallery on both floors at sixty-fps and one-second frames');
