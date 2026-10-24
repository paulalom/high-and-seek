import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createGameHarness } from './qa-pathing.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const near = (actual, expected, message, tolerance = .025) => assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} vs ${expected}`);
function fixture() {
  const sandbox = { window: {}, console }; vm.createContext(sandbox);
  for (const file of ['world.js', 'wing.js']) vm.runInContext(fs.readFileSync(path.join(root, 'dist', file), 'utf8'), sandbox);
  const world = sandbox.window.HSWorld; world.activateFloor(world.wing.level);
  const simulation = sandbox.window.HSWing.create(world), runtime = simulation.getState();
  const state = { level: world.wing.level, started: true, paused: false, won: false, failed: false, found: new Set(), energy: 100, player: { x: runtime.dog.x, y: runtime.dog.y, level: world.wing.level } };
  return { world, simulation, runtime, state, events: [] };
}
function tick(f, seconds = .05) {
  f.simulation.update(seconds, f.state); f.events.push(...f.simulation.drainEvents());
  const dog = f.runtime.dog;
  assert.ok(f.world.isWalkable(dog.x, dog.y, .25, dog.level), 'Waffles stays clear of furniture and walls in his actual area');
}
function advance(f, seconds) { for (let left = seconds; left > .00001; left -= .05) tick(f, Math.min(.05, left)); }
function clear(world, a, b, level, radius = .22) {
  const count = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / .07));
  for (let i = 0; i <= count; i++) if (!world.isWalkable(a.x + (b.x - a.x) * i / count, a.y + (b.y - a.y) * i / count, radius, level)) return false;
  return true;
}
function route(world, from, to, level) {
  if (clear(world, from, to, level)) return [{ x: to.x, y: to.y }];
  const area = world.floors.find(floor => floor.id === level), cols = Math.round((area.width ?? world.width) * 2) + 1, rows = Math.round((area.height ?? world.height) * 2) + 1;
  const count = cols * rows, open = new Uint8Array(count), point = i => ({ x: i % cols / 2, y: Math.floor(i / cols) / 2 }), cells = [];
  for (let i = 0; i < count; i++) if (world.isWalkable(point(i).x, point(i).y, .22, level)) { open[i] = 1; cells.push(i); }
  const nearest = target => [...cells].sort((a, b) => Math.hypot(point(a).x - target.x, point(a).y - target.y) - Math.hypot(point(b).x - target.x, point(b).y - target.y)).find(i => clear(world, target, point(i), level));
  const start = nearest(from), end = nearest(to), previous = new Int32Array(count); previous.fill(-1); previous[start] = start;
  const queue = [start];
  for (let head = 0; head < queue.length && previous[end] < 0; head++) {
    const i = queue[head], x = i % cols, y = Math.floor(i / cols);
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]]) {
      const nx = x + dx, ny = y + dy, next = ny * cols + nx;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || !open[next] || previous[next] >= 0 || !clear(world, point(i), point(next), level)) continue;
      previous[next] = i; queue.push(next);
    }
  }
  assert.ok(previous[end] >= 0, 'escort destination connects through the real collision geometry');
  const result = [{ x: to.x, y: to.y }];
  for (let i = end; i !== start; i = previous[i]) result.push(point(i));
  result.push(point(start)); return result.reverse();
}
function coax(f) {
  const dog = f.runtime.dog;
  if (!['sniffing', 'waiting', 'sleeping'].includes(dog.status)) return;
  const progress = dog.distractions, distance = dog.followedDistance;
  // A distraction can happen just beyond E range; walk back to the tiny dog.
  if (Math.hypot(f.state.player.x - dog.x, f.state.player.y - dog.y) > 1.5) {
    for (const target of route(f.world, f.state.player, dog, f.state.level)) {
      for (let guard = 0; Math.hypot(f.state.player.x - dog.x, f.state.player.y - dog.y) > 1.35 && Math.hypot(target.x - f.state.player.x, target.y - f.state.player.y) > .035 && guard < 500; guard++) {
        const dx = target.x - f.state.player.x, dy = target.y - f.state.player.y, gap = Math.hypot(dx, dy), stride = Math.min(gap, 3.2 * .05);
        const moved = f.world.moveCircle(f.state.player.x, f.state.player.y, dx / gap * stride, dy / gap * stride, .22, f.state.level);
        assert.ok(moved.distance > .0001, 'player can return to coax a distracted corgi'); Object.assign(f.state.player, { x: moved.x, y: moved.y }); tick(f);
      }
      if (Math.hypot(f.state.player.x - dog.x, f.state.player.y - dog.y) <= 1.35) break;
    }
  }
  assert.equal(f.simulation.interact(f.state), true, 'a nearby E recall resumes the trip');
  assert.equal(dog.following, true); assert.equal(dog.sleeping, false);
  assert.equal(dog.distractions, progress, 'recalling or waking preserves completed interruptions');
  near(dog.followedDistance, distance, 'recalling does not reset walked distance');
}
function walk(f, destination, pace = 2.6) {
  const { world, state } = f;
  for (const target of route(world, state.player, destination, state.level)) {
    for (let guard = 0; Math.hypot(target.x - state.player.x, target.y - state.player.y) > .035 && guard < 500; guard++) {
      coax(f);
      const dx = target.x - state.player.x, dy = target.y - state.player.y, distance = Math.hypot(dx, dy), stride = Math.min(distance, pace * .05);
      const moved = world.moveCircle(state.player.x, state.player.y, dx / distance * stride, dy / distance * stride, .22, state.level);
      assert.ok(moved.distance > .0001, 'player can walk the actual escort route');
      Object.assign(state.player, { x: moved.x, y: moved.y }); tick(f);
    }
    assert.ok(Math.hypot(target.x - state.player.x, target.y - state.player.y) <= .035, 'player reaches each escort route waypoint');
  }
}
function markFed(f) { Object.assign(f.runtime.dog, { energy: 100, happy: true, following: true, sleeping: false, companion: true, status: 'happy' }); f.runtime.taskCompleted = true; }

const escort = fixture(), { world, simulation, runtime, state } = escort, dog = runtime.dog;
assert.equal(typeof simulation.changeFloor, 'function');
assert.equal(simulation.interact(state), true);
walk(escort, world.wing.bowl);
for (let guard = 0; !runtime.taskCompleted && guard < 800; guard++) { coax(escort); tick(escort); }
assert.equal(runtime.taskCompleted, true, 'the real longer route can still deliver Waffles to dinner');
assert.equal(dog.distractions, 3, 'the longer trip includes all three distinct interruptions');
const distractions = escort.events.filter(event => event.type === 'distracted');
assert.equal(distractions.length, 3); assert.equal(new Set(distractions.map(event => event.reason)).size, 3, 'interruptions have distinct cute reasons');
assert.equal(escort.events.filter(event => event.type === 'coaxed').length, 3, 'each interruption is an explicit E recall');
assert.equal(dog.happy, true); assert.equal(dog.energy, 100); assert.equal(dog.following, true); assert.equal(dog.companion, true);
assert.equal(simulation.canInteract(state), false, 'fed Waffles never intercepts the food or doorway action');
const distractionsAfterDinner = dog.distractions;
walk(escort, { x: 19, y: 16.5 }); advance(escort, 2);
assert.equal(dog.distractions, distractionsAfterDinner, 'dinner ends all nuisance stops');
assert.equal(dog.energy, 100, 'fed companion has no further hunger drain');
console.log('PASS: real far-bowl escort, three distinct E-coaxed distractions, feeding and content companion reward');

const waiting = fixture(); assert.equal(waiting.simulation.interact(waiting.state), true);
Object.assign(waiting.state.player, waiting.world.floors[2].doors[0]); tick(waiting);
assert.equal(waiting.runtime.dog.status, 'waiting', 'running away plants the tiny dog for one recall');
assert.equal(waiting.runtime.dog.waits, 1);
assert.equal(waiting.simulation.interact(waiting.state), false, 'E cannot coax from across the wing');
const still = { x: waiting.runtime.dog.x, y: waiting.runtime.dog.y };
advance(waiting, .5); near(waiting.runtime.dog.x, still.x, 'waiting dog holds position'); near(waiting.runtime.dog.y, still.y, 'waiting dog holds position');
Object.assign(waiting.state.player, still); assert.equal(waiting.simulation.interact(waiting.state), true);
Object.assign(waiting.state.player, waiting.world.floors[2].doors[0]); tick(waiting);
assert.equal(waiting.runtime.dog.waits, 1, 'the lag-behind interruption is bounded');
assert.notEqual(waiting.runtime.dog.status, 'waiting', 'the same distance does not demand endless recalls');
Object.assign(waiting.runtime.dog, { energy: .01, distractions: 2, followedDistance: 7 }); tick(waiting);
assert.equal(waiting.runtime.dog.sleeping, true);
Object.assign(waiting.state.player, { x: waiting.runtime.dog.x, y: waiting.runtime.dog.y }); assert.equal(waiting.simulation.interact(waiting.state), true);
assert.equal(waiting.runtime.dog.energy, 25); assert.equal(waiting.runtime.dog.distractions, 2); assert.equal(waiting.runtime.dog.followedDistance, 7, 'nap recovery keeps escort progress');
console.log('PASS: bounded lag-behind recall, no remote E, quiet waiting and recoverable naps without losing progress');

const playBreak = fixture(); assert.equal(playBreak.simulation.interact(playBreak.state), true);
walk(playBreak, playBreak.world.wing.toy); coax(playBreak);
assert.equal(playBreak.simulation.canPlay(playBreak.state), true, 'the longer escort can detour to the actual squeaky toy');
const beforePlayEnergy = playBreak.runtime.dog.energy, playPose = { x: playBreak.runtime.dog.x, y: playBreak.runtime.dog.y };
assert.equal(playBreak.simulation.play(playBreak.state), true);
near(playBreak.runtime.dog.energy, Math.min(100, beforePlayEnergy + playBreak.world.wing.toy.energy), 'the toy still provides its one-use energy break');
assert.equal(playBreak.runtime.toy.used, true); assert.equal(playBreak.simulation.canPlay(playBreak.state), false);
advance(playBreak, .5); near(playBreak.runtime.dog.x, playPose.x, 'toy animation briefly holds Waffles in place'); near(playBreak.runtime.dog.y, playPose.y, 'toy animation briefly holds Waffles in place');
walk(playBreak, playBreak.world.wing.bowl);
for (let guard = 0; !playBreak.runtime.taskCompleted && guard < 800; guard++) { coax(playBreak); tick(playBreak); }
assert.equal(playBreak.runtime.taskCompleted, true, 'the squeaky-break detour still ends with dinner');
playBreak.simulation.reset(); assert.equal(playBreak.runtime.toy.used, false);
console.log('PASS: physical toy detour, one-use refill and play pause, subsequent dinner and reset');

const travel = fixture(); markFed(travel);
for (const area of [0, 2, 1, 3, 1, 2, 0]) {
  const floor = travel.world.floors.find(item => item.id === area), arrival = floor.stair || floor.doors[0] || travel.world.home;
  travel.world.activateFloor(area); travel.state.level = area; Object.assign(travel.state.player, arrival, { level: area });
  const nico = JSON.stringify(travel.runtime.eater), hunger = travel.runtime.dog.energy;
  assert.equal(travel.simulation.changeFloor(area, arrival, travel.state), true);
  assert.equal(travel.runtime.dog.level, area); assert.equal(travel.runtime.dog.following, true);
  assert.ok(Math.hypot(travel.runtime.dog.x - arrival.x, travel.runtime.dog.y - arrival.y) <= 1.61, 'door/stair transition places Waffles near the player');
  const destination = travel.world.rooms.map(room => ({ x: room.x + room.w / 2, y: room.y + room.h / 2 })).find(target => travel.world.isWalkable(target.x, target.y, .22, area) && Math.hypot(target.x - arrival.x, target.y - arrival.y) > 2);
  assert.ok(destination, `area ${area} has a reachable companion follow target`);
  walk(travel, destination); advance(travel, 2);
  assert.ok(Math.hypot(travel.runtime.dog.x - travel.state.player.x, travel.runtime.dog.y - travel.state.player.y) < 1.8, `companion catches up through area ${area}'s furniture`);
  assert.equal(travel.runtime.dog.energy, hunger); assert.equal(travel.runtime.dog.status, 'happy');
  if (area !== travel.world.wing.level) assert.equal(JSON.stringify(travel.runtime.eater), nico, 'Nico freezes while Waffles accompanies the player outside the wing');
}
for (const update of [{ paused: true }, { started: false }, { won: true }, { failed: true }]) {
  const before = JSON.stringify(travel.runtime), saved = { ...travel.state }; Object.assign(travel.state, update); advance(travel, 2); Object.assign(travel.state, saved);
  assert.equal(JSON.stringify(travel.runtime), before, 'menus, idle, endings and failure freeze the companion simulation');
}
const beforeReset = travel.runtime; travel.simulation.reset();
assert.equal(travel.simulation.getState(), beforeReset, 'restart preserves the shared runtime reference');
assert.equal(travel.runtime.taskCompleted, false); assert.equal(travel.runtime.dog.companion, false); assert.equal(travel.runtime.dog.level, 2); assert.equal(travel.runtime.dog.distractions, 0);
const unfedPose = JSON.stringify(travel.runtime.dog);
assert.equal(travel.simulation.changeFloor(1, travel.world.floors[1].stair, travel.state), false);
assert.equal(JSON.stringify(travel.runtime.dog), unfedPose, 'an unfed corgi stays in his wing');
const unfedWing = JSON.stringify(travel.runtime); advance(travel, 3);
assert.equal(JSON.stringify(travel.runtime), unfedWing, 'unfed hunger and Nico both freeze while the player is outside their wing');
console.log('PASS: fed companion routes through every area, correct transitions, off-wing Nico freeze, pause/end freeze and restart');

const app = createGameHarness({ guestBrainEnabled: false }), game = app.qa;
game.begin(); Object.assign(game.state.wing.dog, { happy: true, energy: 100, following: true, companion: true, status: 'happy' }); game.state.wing.taskCompleted = true;
for (const area of [2, 1, 3]) {
  const floor = app.world.floors.find(item => item.id === area), arrival = floor.stair || floor.doors[0] || app.world.home;
  game.changeFloor(area, arrival);
  assert.equal(game.state.wing.dog.level, area, 'actual app transitions invoke the companion transfer API');
  assert.ok(app.world.isWalkable(game.state.wing.dog.x, game.state.wing.dog.y, .25, area));
}
game.restart(); assert.equal(game.state.wing.taskCompleted, false); assert.equal(game.state.wing.dog.companion, false);
console.log('PASS: actual app 2→1→3 transition hook and reset preserve the companion contract');

function renderFixture(width, height) {
  const context = new Proxy({}, { get(target, property) {
    if (property in target) return target[property];
    if (property === 'measureText') return text => ({ width: String(text).length * 6 });
    if (property === 'createLinearGradient' || property === 'createRadialGradient') return () => ({ addColorStop() {} });
    return () => {};
  }, set(target, property, value) { target[property] = value; return true; } });
  const sandbox = { window: { devicePixelRatio: 1 }, console }; vm.createContext(sandbox);
  for (const file of ['world.js', 'wing.js', 'renderer.js']) vm.runInContext(fs.readFileSync(path.join(root, 'dist', file), 'utf8'), sandbox);
  const world = sandbox.window.HSWorld; world.activateFloor(world.home.level);
  const runtime = sandbox.window.HSWing.create(world).getState();
  Object.assign(runtime.dog, { happy: true, following: true, companion: true, level: world.home.level, x: world.home.x + .5, y: world.home.y, energy: 100 }); runtime.taskCompleted = true;
  const state = { level: world.home.level, player: { x: world.home.x, y: world.home.y, level: world.home.level, facing: 1, moving: false }, wing: runtime, guests: [], found: new Set(), discovered: new Set(), haulCounts: {}, energy: 100, won: true, ending: { elapsed: 0, active: true, paused: false } };
  const renderer = new sandbox.window.MansionRenderer({ getBoundingClientRect: () => ({ width, height }), getContext: () => context }, world);
  return { renderer, state, world };
}
for (const [width, height] of [[1905, 890], [390, 844], [844, 390]]) {
  const { renderer, state, world } = renderFixture(width, height), poses = [];
  const originalCorgi = renderer.corgi;
  renderer.corgi = (dog, ...args) => { poses.push(dog); originalCorgi.call(renderer, dog, ...args); };
  const before = JSON.stringify(state.wing.dog);
  renderer.draw(state, 0); assert.equal(poses.length, 1, 'fed companion appears in the relocated home cinematic');
  near(poses[0].x, state.wing.dog.x, 'cinematic begins from the actual companion position');
  for (const elapsed of [2.6, 6, 9]) {
    state.ending.elapsed = elapsed; poses.length = 0; renderer.draw(state, elapsed * 1000);
    assert.equal(poses.length, 1); const pose = poses[0];
    assert.equal(pose.curled, true); assert.equal(pose.sleeping, true); assert.equal(pose.status, 'curled');
    const { anchor, cushionAnchor } = renderer.endingShot.dogScene, sofa = renderer.endingShot.sofa;
    assert.ok(world.isWalkable(anchor.x, anchor.y, .25, world.home.level), 'approach anchor sits on a safe floor position by the actual couch');
    assert.ok(cushionAnchor.x > sofa.x && cushionAnchor.x < sofa.x + sofa.w && cushionAnchor.y > sofa.y && cushionAnchor.y < sofa.y + sofa.h, 'the cuddle endpoint uses a spare cushion inside the actual sofa');
    near(pose.x, cushionAnchor.x, 'finished hop reaches its cushion'); near(pose.y, cushionAnchor.y, 'finished hop reaches its cushion');
    assert.ok(pose.z > .7 && pose.z < 1.1, 'Waffles is raised onto the cushion rather than hidden behind the sofa');
    assert.ok(pose.painterDepth > sofa.x + sofa.y + (sofa.w + sofa.h) * .5 + .02, 'cushion Waffles paints above the sofa and player');
    assert.ok(Math.hypot(pose.x - world.home.seat.x, pose.y - world.home.seat.y) < 2, 'Waffles curls up next to the seated player');
    if (elapsed >= 6) {
      const screen = renderer.worldToScreen(pose.x, pose.y, pose.z), u = Math.max(15, renderer.unit);
      assert.ok(screen.x - 1.25 * u > 5 && screen.x + 1.25 * u < width - 5 && screen.y - 1.1 * u > 35 && screen.y + .2 * u < height - 35, `companion's full curled body stays visible in the ${width}x${height} eating/wide shot`);
    }
  }
  state.ending.elapsed = 2.3; state.ending.paused = true;
  const poseA = renderer.endingDogPose(state, 10000, state.player), poseB = renderer.endingDogPose(state, 99000, state.player);
  assert.ok(poseA.z > .06 && poseA.z < 1.1, 'the approach includes a visible hop onto the cushion');
  near(poseA.x, poseB.x, 'paused companion position does not drift'); near(poseA.y, poseB.y, 'paused companion position does not drift'); near(poseA.z, poseB.z, 'paused hop height does not drift'); assert.equal(poseA.animationTime, poseB.animationTime, 'paused breathing animation uses cinematic elapsed time');
  assert.equal(JSON.stringify(state.wing.dog), before, 'cinematic pose never mutates the gameplay companion');
  state.wing.dog.happy = false; poses.length = 0; renderer.draw(state, 100000); assert.equal(poses.length, 0, 'an unfed dog does not appear as an ending reward');
  state.wing.dog.happy = true; state.wing.dog.level = 2; poses.length = 0; renderer.draw(state, 100001); assert.equal(poses.length, 0, 'a dog from another area is not rendered at the couch');
}

const shifted = renderFixture(1000, 700), { renderer: shiftedRenderer, state: shiftedState, world: shiftedWorld } = shifted;
const originalWalkable = shiftedWorld.isWalkable; shiftedWorld.isWalkable = () => true;
for (const orientation of ['north', 'south', 'east', 'west']) {
  const sofa = { x: 9, y: 10, w: orientation === 'east' || orientation === 'west' ? 1.25 : 3.3, h: orientation === 'east' || orientation === 'west' ? 3.3 : 1.25, orientation };
  const seat = { x: sofa.x + sofa.w / 2, y: sofa.y + sofa.h / 2 };
  shiftedState.ending.elapsed = 3; shiftedRenderer.endingShot = { sofa, seat };
  const pose = shiftedRenderer.endingDogPose(shiftedState, 3000, seat);
  assert.ok(Math.hypot(pose.x - seat.x, pose.y - seat.y) < 2, 'moving or rotating the couch moves the dog anchor with it');
  const approach = shiftedRenderer.endingShot.dogScene.anchor;
  assert.ok(pose.x > sofa.x && pose.x < sofa.x + sofa.w && pose.y > sofa.y && pose.y < sofa.y + sofa.h, 'rotated-couch cuddle remains on its real cushions');
  assert.ok(pose.z > .7 && pose.z < 1.1);
  if (orientation === 'north') assert.ok(approach.y < sofa.y);
  if (orientation === 'south') assert.ok(approach.y > sofa.y + sofa.h);
  if (orientation === 'east') assert.ok(approach.x > sofa.x + sofa.w);
  if (orientation === 'west') assert.ok(approach.x < sofa.x);
}
shiftedWorld.isWalkable = originalWalkable;
console.log('PASS: earned curl-up cinematic, relocated/rotated couch anchors, three viewport sizes, pause determinism and unfed/other-area guards');
