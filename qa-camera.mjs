import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

// The actual renderer is exercised against a canvas stub. These checks focus on
// coordinate correctness, which keeps click-to-walk aligned during camera motion.
const context = new Proxy({}, {
  get(target, property) {
    if (property === 'measureText') return text => ({ width: String(text).length * 6 });
    if (property === 'createRadialGradient' || property === 'createLinearGradient') return () => ({ addColorStop() {} });
    if (property in target) return target[property];
    return () => {};
  },
  set(target, property, value) { target[property] = value; return true; }
});
const sandbox = { window: { devicePixelRatio: 2 }, console, performance: { now: () => 0 } };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('dist/world.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync('dist/renderer.js', 'utf8'), sandbox);
const world = sandbox.window.HSWorld;
const sizes = [[1905, 890], [1366, 768], [1024, 768], [390, 844], [844, 390]];
const zooms = [.75, 1, 1.45, 2.6];
const points = [[1.3, 1.3], [28.7, 1.3], [1.3, 20.7], [28.7, 20.7], [15, 11], [15, 18.35]];
let roundtrips = 0;
for (const [width, height] of sizes) {
  const bounds = { left: 17, top: 31, width, height };
  const canvas = { getBoundingClientRect: () => bounds, getContext: () => context };
  const renderer = new sandbox.window.MansionRenderer(canvas, world);
  for (const method of ['setZoom', 'zoomBy', 'resetView', 'toggleOverview', 'getZoom', 'setFloor']) {
    assert.equal(typeof renderer[method], 'function', `renderer exposes ${method}`);
  }
  const state = { player: { ...world.start, moving: false, facing: 1 }, found: new Set(), activeRoom: 'foyer' };
  let clock = 0;
  const draw = () => { clock += 1000 / 60; renderer.updateCamera(state.player, clock); };
  const roundtrip = () => {
    for (const [x, y] of points) {
      const projected = renderer.worldToScreen(x, y);
      assert.ok(Number.isFinite(projected.x) && Number.isFinite(projected.y), 'projection is finite');
      const restored = renderer.screenToWorld(projected.x + bounds.left, projected.y + bounds.top);
      assert.ok(Math.abs(restored.x - x) < 1e-8 && Math.abs(restored.y - y) < 1e-8,
        `projection reverses at ${width}×${height}, zoom=${renderer.getZoom()}, (${x},${y})`);
      roundtrips++;
    }
  };
  for (const zoom of zooms) {
    renderer.setZoom(zoom);
    for (let frame = 0; frame < 30; frame++) { draw(); roundtrip(); }
    renderer.draw(state, clock);
  }
  renderer.resetView();
  for (const floor of world.floors) {
  world.activateFloor(floor.id);
  state.level = floor.id; state.player.level = floor.id;
  renderer.setFloor(state.player);
  for (const room of world.rooms) {
    state.player.x = room.x + room.w / 2;
    state.player.y = room.y + room.h / 2;
    state.activeRoom = room.id;
    for (let frame = 0; frame < 180; frame++) draw();
    renderer.draw(state, clock);
    const player = renderer.worldToScreen(state.player.x, state.player.y);
    assert.ok(player.x >= 0 && player.x <= width && player.y >= 0 && player.y <= height,
      `player remains visible in ${room.id} at ${width}×${height}: ${JSON.stringify(player)}`);
    assert.ok(player.y >= Math.min(110, height * .2) && player.y <= height - Math.min(130, height * .25),
      `follow camera reserves top and bottom HUD space in ${room.id} at ${width}×${height}`);
    roundtrip();
  }
  }
  renderer.toggleOverview();
  for (let frame = 0; frame < 120; frame++) { draw(); roundtrip(); }
  renderer.draw(state, clock);
  renderer.toggleOverview();
  renderer.zoomBy(1.2);
  for (let frame = 0; frame < 30; frame++) { draw(); roundtrip(); }
  // Simulate browser resizing without replacing the camera or canvas instance.
  bounds.width += 137; bounds.height += 63;
  renderer.resize();
  for (let frame = 0; frame < 30; frame++) { draw(); roundtrip(); }
  console.log(`PASS: camera zoom, follow, overview, resize, and click transforms at ${width}×${height}`);
  world.activateFloor(0);
}
console.log(`PASS: ${roundtrips} world/screen coordinate round trips`);
