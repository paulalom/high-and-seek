import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGameHarness } from './qa-pathing.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const rendererSource = fs.readFileSync(path.join(root, 'dist/renderer.js'), 'utf8');
const sandbox = { window: {}, console }; vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, 'dist/world.js'), 'utf8'), sandbox);
const world = sandbox.window.HSWorld;
const near = (actual, expected, label, tolerance = 1e-5) => assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: expected ${expected}, got ${actual}`);
const exits = floor => [...(floor.stair ? [floor.stair] : []), ...(floor.doors || [])];
const opposite = { east: 'west', west: 'east', north: 'south', south: 'north' };
for (const floor of world.floors) {
  for (const door of floor.doors || []) {
    assert.ok(door.anchor && ['east', 'west'].includes(door.orientation), 'section doors declare a wall anchor and its axis');
    near(door.anchor.x, door.orientation === 'east' ? 29.1 : .9, 'door frame sits on the section boundary');
    near(door.y, door.anchor.y, 'door landing lines up with its physical frame');
    assert.ok(Math.abs(door.x - door.anchor.x) >= .6 && Math.abs(door.x - door.anchor.x) <= 1.2, 'landing stays safely inside the wall frame');
    assert.ok(door.orientation === 'east' ? door.x < door.anchor.x : door.x > door.anchor.x, 'landing faces into its room');
    const targetFloor = world.floors.find(value => value.id === door.to), pair = targetFloor.doors.find(value => value.to === floor.id);
    assert.ok(pair && pair.orientation === opposite[door.orientation], 'paired section doors face opposite edge walls');
    near(door.arrival.x, pair.x, 'arrival uses the paired safe landing'); near(door.arrival.y, pair.y, 'paired arrival preserves doorway alignment');
    for (const wall of floor.walls.filter(value => value.exterior && (door.orientation === 'east' ? value.x >= 29 : value.x <= .9))) assert.ok(door.anchor.y - 1.1 >= wall.y + wall.h || door.anchor.y + 1.1 <= wall.y, 'door opening has a genuine gap in its boundary wall');
  }
  if (floor.stair) {
    const stair = floor.stair, run = stair.footprint;
    assert.ok(stair.anchor && run && ['up', 'down'].includes(stair.direction), 'stair declares direction and its physical run');
    assert.ok(['north', 'west', 'south', 'east'].includes(stair.orientation));
    near(stair.anchor.x, run.x + run.w / 2, 'stair anchor is centered on its model run');
    near(stair.anchor.y, run.y + run.h / 2, 'stair anchor is centered on its model run');
    assert.ok(floor.transitionSolids.some(solid => Math.abs(solid.x - run.x) < 1e-6 && Math.abs(solid.y - run.y) < 1e-6 && Math.abs(solid.w - run.w) < 1e-6 && Math.abs(solid.h - run.h) < 1e-6), 'physical stair run is blocked separately from ordinary furniture');
    assert.equal(world.isWalkable(stair.anchor.x, stair.anchor.y, .22, floor.id), false, 'player cannot walk through the stair model');
    const point = stair.orientation === 'north' ? { x: stair.anchor.x, y: run.y } : stair.orientation === 'west' ? { x: run.x, y: stair.anchor.y } : stair.orientation === 'south' ? { x: stair.anchor.x, y: run.y + run.h } : { x: run.x + run.w, y: stair.anchor.y };
    assert.ok(floor.walls.some(wall => Math.hypot(point.x - Math.max(wall.x, Math.min(point.x, wall.x + wall.w)), point.y - Math.max(wall.y, Math.min(point.y, wall.y + wall.h))) <= .1), 'stair run meets a wall instead of floating in the room');
    const pair = world.floors.find(value => value.id === stair.to)?.stair;
    assert.ok(pair && pair.to === floor.id && pair.direction !== stair.direction, 'up and down stair connections are reciprocal');
  }
}
console.log('PASS: section-edge door gaps, opposite jamb axes, safe paired arrivals and wall-attached physical stair runs');

function lineClear(floor, a, b, radius) {
  const steps = Math.max(1, Math.ceil(Math.hypot(a.x - b.x, a.y - b.y) / .07));
  for (let step = 0; step <= steps; step++) if (!world.isWalkable(a.x + (b.x - a.x) * step / steps, a.y + (b.y - a.y) * step / steps, radius, floor.id)) return false;
  return true;
}
for (const floor of world.floors) for (const radius of [.22, .25, .26]) {
  const step = .25, cols = Math.round(world.width / step) + 1, rows = Math.round(world.height / step) + 1, count = cols * rows, cells = [], open = new Uint8Array(count), point = index => ({ x: index % cols * step, y: Math.floor(index / cols) * step });
  for (let index = 0; index < count; index++) { const p = point(index); if (world.isWalkable(p.x, p.y, radius, floor.id)) { open[index] = 1; cells.push(index); } }
  const origin = floor.id === world.start.level ? world.start : exits(floor)[0];
  const first = cells.slice().sort((a, b) => Math.hypot(point(a).x - origin.x, point(a).y - origin.y) - Math.hypot(point(b).x - origin.x, point(b).y - origin.y)).find(index => lineClear(floor, origin, point(index), radius));
  assert.ok(first !== undefined, 'transition approach connects to the floor grid');
  const queue = [first], seen = new Set(queue);
  for (let head = 0; head < queue.length; head++) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const current = queue[head], nx = current % cols + dx, ny = Math.floor(current / cols) + dy, next = ny * cols + nx;
    if (nx >= 0 && ny >= 0 && nx < cols && ny < rows && open[next] && !seen.has(next) && lineClear(floor, point(current), point(next), radius)) { seen.add(next); queue.push(next); }
  }
  const reached = queue.map(point), rooms = new Set(reached.map(value => world.getRoom(value.x, value.y, floor.id)?.id).filter(Boolean));
  assert.ok(floor.rooms.every(room => rooms.has(room.id)), 'new transition solids preserve access to every room');
  for (const exit of exits(floor)) {
    assert.ok(world.isWalkable(exit.x, exit.y, radius, floor.id), 'door or stair landing fits player and dog radii');
    assert.ok(world.isWalkable(exit.arrival.x, exit.arrival.y, radius, exit.to), 'paired arrival fits player and dog radii');
    assert.ok(reached.some(value => Math.hypot(value.x - exit.x, value.y - exit.y) <= .75 && lineClear(floor, value, exit, radius)), 'each transition landing is reachable without entering its model');
  }
  for (const snack of world.snackSpots.filter(value => value.level === floor.id)) assert.ok(reached.some(value => world.getRoom(value.x, value.y, floor.id)?.id === snack.room && Math.hypot(value.x - snack.x, value.y - snack.y) <= world.collectionRadius), 'new transition models preserve every pickup approach');
}
console.log('PASS: every room, pickup and paired transition remains connected at radii .22, .25 and .26');

const context = new Proxy({}, { get(target, key) { if (key in target) return target[key]; if (key === 'measureText') return text => ({ width: String(text).length * 6 }); if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => ({ addColorStop() {} }); return () => {}; }, set(target, key, value) { target[key] = value; return true; } });
const bounds = { left: 17, top: 31, width: 1366, height: 768 };
function rendererFor(modelWorld) {
  const scope = { window: { HSWorld: modelWorld, devicePixelRatio: 1 }, console }; vm.createContext(scope); vm.runInContext(rendererSource, scope);
  return new scope.window.MansionRenderer({ getContext: () => context, getBoundingClientRect: () => bounds }, modelWorld);
}
const model = rendererFor(world), stairModels = new Map();
for (const floor of world.floors) {
  world.activateFloor(floor.id); model.setFloor(exits(floor)[0]);
  const boxes = [], planes = []; model.box = (...args) => boxes.push(args); model.plane = (...args) => planes.push(args); model.line = () => {};
  model.doorGeometry();
  for (const door of floor.doors || []) {
    const jambs = boxes.filter(([x, y, w, h, top, _color, bottom = 0]) => top > 1.2 && bottom <= .2 && w <= .6 && h <= .6 && Math.abs(x + w / 2 - door.anchor.x) < .4);
    assert.ok(jambs.length >= 2, 'east/west doorway has two upright jambs aligned on its boundary wall');
    const centers = jambs.map(([x, y, w, h]) => ({ x: x + w / 2, y: y + h / 2 }));
    assert.ok(Math.max(...centers.map(p => p.x)) - Math.min(...centers.map(p => p.x)) < .4, 'jambs share the wall x-axis');
    assert.ok(Math.max(...centers.map(p => p.y)) - Math.min(...centers.map(p => p.y)) >= 1.8, 'jambs span the doorway along y rather than across the room');
    assert.ok(boxes.some(([x, y, w, h, top, _color, bottom = 0]) => h >= 2 && w <= .6 && top > 1.5 && bottom > 1.2 && Math.abs(x + w / 2 - door.anchor.x) < .4), 'door lintel follows the same wall axis');
  }
  boxes.length = 0; planes.length = 0;
  if (floor.stair) { model.stairsGeometry(); stairModels.set(floor.stair.direction, { boxes: boxes.map(args => [...args]), planes: planes.map(args => [...args]) }); }
}
const up = stairModels.get('up'), down = stairModels.get('down');
assert.ok(up && down, 'both stair directions have models');
assert.ok(up.boxes.some(([, , , , top]) => top > .5), 'up staircase has a substantial rising flight');
assert.ok(down.planes.some(([, , , , z]) => z < -.05) || down.boxes.some(([, , , , top, , bottom = 0]) => top < -.05 || bottom < -.05), 'down staircase exposes a descending well below floor level');
assert.notEqual(JSON.stringify(up.boxes.map(args => args.slice(0, 5))), JSON.stringify(down.boxes.map(args => args.slice(0, 5))), 'down stairs use different geometry from the rising flight');
console.log('PASS: renderer spies verify wall-aligned door frames and genuinely distinct rising/downward stair geometry');

const clickRun = createGameHarness({ guestBrainEnabled: false, wingSimulationEnabled: false }), projection = rendererFor(clickRun.world);
clickRun.getNode('mansion').getBoundingClientRect = () => bounds;
clickRun.renderer.worldToScreen = (...args) => projection.worldToScreen(...args);
clickRun.renderer.screenToWorld = (...args) => projection.screenToWorld(...args);
clickRun.qa.begin(); clickRun.qa.state.guests = [];
let pointerCases = 0;
for (const floor of clickRun.world.floors) for (const transition of exits(floor)) {
  clickRun.qa.changeFloor(floor.id, transition); clickRun.qa.state.discovered.clear();
  projection.setFloor(clickRun.qa.state.player); projection.setZoom(2.6); projection.updateCamera(clickRun.qa.state.player, 0, true);
  clickRun.qa.navigate(transition.x, transition.y);
  const expected = JSON.stringify(clickRun.qa.getPath().at(-1));
  for (const z of [ .2, ...(floor.doors.includes(transition) ? [1] : []) ]) {
    const anchor = projection.worldToScreen(transition.anchor.x, transition.anchor.y, z), landing = projection.worldToScreen(transition.x, transition.y, .2);
    assert.ok(Math.hypot(anchor.x - landing.x, anchor.y - landing.y) > 35, 'zoomed physical model click is distinct from the landing hit target');
    clickRun.dispatch('mansion', 'pointerdown', { clientX: anchor.x + bounds.left, clientY: anchor.y + bounds.top });
    assert.equal(JSON.stringify(clickRun.qa.getPath().at(-1)), expected, 'physical model click routes to the same safe landing');
    assert.equal(clickRun.qa.state.level, floor.id, 'clicking a model never teleports'); pointerCases++;
  }
}
console.log(`PASS: ${pointerCases} zoomed physical door/stair clicks choose safe landings rather than blocked model coordinates`);

const trip = createGameHarness({ guestBrainEnabled: false, wingSimulationEnabled: false }); trip.qa.begin(); trip.qa.state.guests = [];
let crossings = 0;
for (const destination of [2, 1, 3, 1, 2, 0]) {
  const from = trip.qa.state.level, floor = trip.world.floors[from], transition = exits(floor).find(exit => exit.to === destination);
  assert.ok(transition, 'the intended section journey has a real connection');
  trip.qa.state.energy = 100; // Isolate the six transition legs; food budgets have their own real-run suite.
  trip.qa.navigate(transition.x, transition.y);
  for (let frame = 0; trip.qa.getPath().length && !trip.qa.state.failed && frame < 5000; frame++) trip.stepFrame();
  assert.equal(trip.qa.state.failed, false); assert.equal(trip.qa.state.level, from, 'walking to an exit leaves transition explicit');
  while (trip.qa.state.stairsCooldown > 0) trip.stepFrame(100);
  assert.equal(floor.stair === transition ? trip.qa.canUseStairs() : trip.qa.canUseDoor(), true, 'walk reaches a usable safe landing');
  for (let presses = 0; trip.qa.state.level === from && presses < 8; presses++) {
    trip.dispatch('window', 'keydown', { key: 'e', repeat: false, target: { closest: () => null }, preventDefault() {} }); trip.dispatch('window', 'keyup', { key: 'e' });
  }
  assert.equal(trip.qa.state.level, destination, 'actual E interaction crosses the intended connection');
  near(trip.qa.state.player.x, transition.arrival.x, 'E arrives on the paired safe x'); near(trip.qa.state.player.y, transition.arrival.y, 'E arrives on the paired safe y');
  assert.equal(trip.qa.state.won, false, 'crossing a connection never banks remotely'); crossings++;
}
console.log(`PASS: six physical E crossings complete the forward and reverse 0→2→1→3 section journey without remote banking`);
