import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const worldSource = fs.readFileSync('dist/world.js', 'utf8');
const wingSource = fs.readFileSync('dist/wing.js', 'utf8');
const rendererSource = fs.readFileSync('dist/renderer.js', 'utf8');
function createRenderer(cacheEnabled = true, width = 1905, height = 890) {
  let calls = 0;
  const surfaces = [];
  const context = () => new Proxy({}, {
    get(target, property) {
      if (property in target) return target[property];
      if (property === 'measureText') return text => { calls++; return { width: String(text).length * 6 }; };
      if (property === 'createLinearGradient' || property === 'createRadialGradient') return () => { calls++; return { addColorStop() { calls++; } }; };
      return () => { calls++; };
    },
    set(target, property, value) { target[property] = value; return true; }
  });
  const document = { createElement() { const canvas = { width: 0, height: 0, getContext: () => context() }; surfaces.push(canvas); return canvas; } };
  const sandbox = { window: { devicePixelRatio: 2 }, console, ...(cacheEnabled ? { document } : {}) };
  vm.createContext(sandbox);
  vm.runInContext(worldSource, sandbox); vm.runInContext(wingSource, sandbox); vm.runInContext(rendererSource, sandbox);
  const bounds = { left: 17, top: 31, width, height }, mainContext = context();
  const renderer = new sandbox.window.MansionRenderer({ getBoundingClientRect: () => bounds, getContext: () => mainContext }, sandbox.window.HSWorld);
  const state = { level: 0, player: { ...sandbox.window.HSWorld.start, moving: false, facing: 1 }, guests: [], found: new Set(), discovered: new Set(), activeRoom: 'foyer', energy: 100, wing: sandbox.window.HSWing.create(sandbox.window.HSWorld).getState() };
  let clock = 0;
  const draw = () => { clock += 1000 / 60; renderer.draw(state, clock); };
  return { renderer, state, bounds, draw, getCalls: () => calls, resetCalls: () => { calls = 0; }, getAllocatedPixels: () => surfaces.reduce((sum, canvas) => sum + canvas.width * canvas.height, 0) };
}

const direct = createRenderer(false), cached = createRenderer(true);
direct.draw(); cached.draw();
direct.resetCalls(); cached.resetCalls();
for (let frame = 0; frame < 60; frame++) { direct.draw(); cached.draw(); }
const directCalls = direct.getCalls() / 60, cachedCalls = cached.getCalls() / 60;
assert.ok(cachedCalls < directCalls * .3, 'steady cached drawing removes at least 70% of canvas calls');
assert.equal(cached.renderer.getPerformanceStats().architectureBuilds, 1, 'stationary frames reuse architecture');
assert.ok(cached.renderer.getPerformanceStats().spriteHits > 0, 'stationary frames reuse furniture sprites');
assert.ok(cached.getAllocatedPixels() <= 8000000, 'total live cache allocation stays below 8 million pixels');

const buildsBeforePan = cached.renderer.getPerformanceStats().architectureBuilds;
cached.state.player.x += .3;
for (let frame = 0; frame < 50; frame++) cached.draw();
assert.equal(cached.renderer.getPerformanceStats().architectureBuilds, buildsBeforePan, 'small camera pans reuse overscan');
cached.state.player.x = 27; cached.state.player.y = 3;
for (let frame = 0; frame < 90; frame++) cached.draw();
assert.ok(cached.renderer.getPerformanceStats().architectureBuilds > buildsBeforePan, 'large camera pans rebuild after leaving overscan');

// The sprite cache must never change painter order around the avatar, and all
// discovered foods remain a final overlay after tall furniture.
const order = [], subject = cached.renderer;
const originalFurniture = subject.drawFurnitureCached, originalAvatar = subject.avatar, originalSnack = subject.snack;
subject.drawFurnitureCached = item => { order.push(item); };
subject.avatar = () => { order.push('player'); };
subject.snack = snack => { order.push(snack.id); };
cached.draw();
const playerIndex = order.indexOf('player'), playerDepth = cached.state.player.x + cached.state.player.y + .1;
for (const entity of subject.furniture) assert.equal(order.indexOf(entity.item) < playerIndex, entity.depth <= playerDepth, 'player retains scenery depth order');
const lastFurnitureIndex = Math.max(...subject.furniture.map(entity => order.indexOf(entity.item)));
for (const snack of subject.world.snacks) {
  if (snack.level === cached.state.level) assert.ok(order.indexOf(snack.id) > lastFurnitureIndex, 'active-floor snack overlays remain unobstructed');
}
subject.drawFurnitureCached = originalFurniture; subject.avatar = originalAvatar; subject.snack = originalSnack;

const buildsBeforeZoom = subject.getPerformanceStats().architectureBuilds;
subject.zoomBy(1.2);
for (let frame = 0; frame < 120; frame++) cached.draw();
assert.ok(subject.getPerformanceStats().architectureBuilds > buildsBeforeZoom, 'settled zoom gets a new architecture cache');
assert.ok(cached.getAllocatedPixels() <= 8000000, 'zoom releases old sprites within allocation budget');
cached.bounds.width = 3840; cached.bounds.height = 2160; subject.resize();
for (let frame = 0; frame < 90; frame++) cached.draw();
assert.ok(cached.getAllocatedPixels() <= 8000000, '4K resize respects the same total allocation budget');

const floorBuilds = subject.getPerformanceStats().architectureBuilds;
for (const level of [1, 0, 2, 0, 1, 2, 0]) {
  subject.world.activateFloor(level);
  cached.state.level = level;
  Object.assign(cached.state.player, { ...(subject.world.floors[level].stair || subject.world.floors[level].doors[0]), level });
  subject.setFloor(cached.state.player);
  cached.draw();
  assert.equal(subject.furniture.length, subject.world.furniture.filter(item => item.type !== 'rug').length, 'floor transition rebuilds furniture depth data');
  assert.ok(subject.furniture.every(entity => subject.world.furniture.includes(entity.item)), 'depth data references only active-floor furniture');
  assert.ok(cached.getAllocatedPixels() <= 8000000, 'repeated floor transitions release obsolete caches within the allocation budget');
}
assert.ok(subject.getPerformanceStats().architectureBuilds >= floorBuilds + 4, 'each floor switch invalidates the architecture cache');

subject.world.activateFloor(1); cached.state.level = 1; cached.state.player.level = 1;
cached.state.guests = subject.world.guests.map(guest => ({ ...guest }));
subject.setFloor(cached.state.player);
const actorDepths = [], guestIds = [], originalGuest = subject.guest;
subject.drawFurnitureCached = item => actorDepths.push(item.x + item.y + (item.w || 1) / 2 + (item.h || 1) / 2);
subject.avatar = player => actorDepths.push(player.x + player.y + .1);
subject.guest = guest => { guestIds.push(guest.id); actorDepths.push(guest.x + guest.y + .1); };
cached.draw();
assert.equal(guestIds.sort().join(','), cached.state.guests.filter(guest => guest.level === 1).map(guest => guest.id).sort().join(','), 'upstairs draws each active guest exactly once');
assert.ok(actorDepths.every((depth, index) => index === 0 || depth >= actorDepths[index - 1]), 'guests, player and furniture preserve shared painter depth order');
subject.drawFurnitureCached = originalFurniture; subject.avatar = originalAvatar; subject.guest = originalGuest;
for (let frame = 0; frame < 60; frame++) cached.draw();
assert.ok(cached.getAllocatedPixels() <= 8000000, 'active upstairs guest rendering stays within the same allocation budget');

subject.world.activateFloor(2); cached.state.level = 2;
Object.assign(cached.state.player, { ...subject.world.floors[2].doors[0], level: 2 });
subject.setFloor(cached.state.player);
const wingDepths = [], wingActors = [], originalCorgi = subject.corgi, originalEater = subject.eater;
subject.drawFurnitureCached = item => { if (subject.world.furniture.includes(item)) wingDepths.push(item.x + item.y + (item.w || 1) / 2 + (item.h || 1) / 2); };
subject.avatar = player => wingDepths.push(player.x + player.y + .1);
subject.corgi = (dog, state, time) => { wingActors.push('dog'); wingDepths.push(dog.x + dog.y + .08); originalCorgi.call(subject, dog, state, time); };
subject.eater = (eater, state, time) => { wingActors.push('eater'); wingDepths.push(eater.x + eater.y + .1); originalEater.call(subject, eater, state, time); };
cached.draw();
assert.deepEqual(wingActors.sort(), ['dog', 'eater'], 'the wing renders both real actors exactly once');
assert.ok(wingDepths.every((depth, index) => index === 0 || depth >= wingDepths[index - 1]), 'corgi, eater, player and wing furniture share painter order');
subject.drawFurnitureCached = originalFurniture; subject.avatar = originalAvatar; subject.corgi = originalCorgi; subject.eater = originalEater;
const visibleWingSnack = subject.world.snacks.find(snack => snack.level === 2);
cached.state.discovered.add(visibleWingSnack.id); cached.resetCalls(); subject.snack(visibleWingSnack, cached.state, 0);
assert.ok(cached.getCalls() > 0, 'available discovered wing food is drawn');
cached.state.wing.consumed.add(visibleWingSnack.id); cached.resetCalls(); subject.snack(visibleWingSnack, cached.state, 0);
assert.equal(cached.getCalls(), 0, 'eaten food disappears from the actual snack renderer');
Object.assign(cached.state.player, { x: cached.state.wing.dog.x, y: cached.state.wing.dog.y }); subject.resetView(cached.state.player);
for (const status of ['hungry', 'following', 'eating', 'sleeping', 'happy']) {
  Object.assign(cached.state.wing.dog, { status, sleeping: status === 'sleeping', happy: status === 'happy', following: status === 'following', energy: status === 'sleeping' ? 0 : 75 });
  cached.draw();
}
assert.ok(cached.getAllocatedPixels() <= 8000000, 'all dog states and roaming eater stay within the cache allocation budget');

for (const [width, height] of [[390, 844], [844, 390]]) {
  const phone = createRenderer(true, width, height); phone.draw();
  for (let frame = 0; frame < 30; frame++) phone.draw();
  assert.ok(phone.getAllocatedPixels() <= 8000000, 'phone caches stay bounded');
}
const montage = createRenderer(true, 390, 844);
montage.state.ending = { elapsed: 0, active: true, seated: false, tvOn: false, paused: false };
montage.renderer.setTVVideo({ readyState: 4, videoWidth: 320, videoHeight: 180 });
montage.draw();
for (const second of [3, 6, 9]) {
  Object.assign(montage.state.ending, { elapsed: second, seated: true, tvOn: true }); montage.draw();
  const stableBuilds = montage.renderer.getPerformanceStats().architectureBuilds;
  for (let frame = 0; frame < 12; frame++) { montage.state.ending.elapsed = second + frame / 60; montage.draw(); }
  assert.equal(montage.renderer.getPerformanceStats().architectureBuilds, stableBuilds, 'portrait shot holds reuse the architecture cache');
  assert.ok(montage.getAllocatedPixels() <= 8000000, 'portrait montage keeps the total cache allocation bounded');
}
console.log(`PASS: renderer canvas calls ${Math.round(directCalls)}→${Math.round(cachedCalls)} per steady frame (${(100 - cachedCalls / directCalls * 100).toFixed(1)}% fewer)`);
console.log('PASS: pan/zoom/resize cache invalidation, painter order, snack overlays, no-cache fallback, and 8-million-pixel allocation budget');
