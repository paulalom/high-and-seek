import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
export function createGameHarness({ frameMs = 1000 / 60, seed = 19, storage = new Map(), guestBrainEnabled = true, wingSimulationEnabled = true, stealthSimulationEnabled = true, videoPlayError = false, audioContextFactory = null, musicFetch = null } = {}) {
const metrics = { draws: 0, rafScheduled: 0, rafCallbacks: 0, maxPendingRaf: 0, domWrites: 0, textWrites: 0, styleWrites: 0, attributeWrites: 0, classWrites: 0, propertyWrites: 0, queries: 0, walkabilityChecks: 0, tvAssignments: 0, floorAssignments: 0, cameraResets: 0, storageWrites: 0, drawTimes: [] };
const htmlSource = fs.readFileSync(path.join(projectRoot, 'dist/index.html'), 'utf8');
const write = type => { metrics.domWrites++; metrics[type]++; };
const handlers = new Map();
const addHandler = (target, type, callback) => { const key = `${target}:${type}`; if (!handlers.has(key)) handlers.set(key, []); handlers.get(key).push(callback); };
const nodes = new Map();
let nodeSequence = 0;
const makeNode = (id = `anonymous-${++nodeSequence}`) => {
  const classes = new Set(), attributes = new Map(), children = new Map();
  const trackedObject = type => new Proxy({}, { set(target, key, value) { write(type); target[key] = value; return true; } });
  const node = { id, style: trackedObject('styleWrites'), dataset: trackedObject('attributeWrites'), classList: {
      add(...names) { names.forEach(name => { write('classWrites'); classes.add(name); }); },
      remove(...names) { names.forEach(name => { write('classWrites'); classes.delete(name); }); },
      contains(name) { return classes.has(name); },
      toggle(name, force = !classes.has(name)) { write('classWrites'); force ? classes.add(name) : classes.delete(name); return force; }
    }, addEventListener(type, callback) { addHandler(id, type, callback); },
    querySelector(selector) { metrics.queries++; if (!children.has(selector)) children.set(selector, makeNode()); return children.get(selector); },
    setAttribute(name, value) { write('attributeWrites'); attributes.set(name, String(value)); }, getAttribute(name) { return attributes.get(name); }, removeAttribute(name) { write('attributeWrites'); attributes.delete(name); if (name === 'src') this.src = ''; },
    focus() {}, appendChild(child) { return child; }, replaceChildren() {}, remove() {},
    showModal() { this.open = true; }, close() { this.open = false; },
    currentTime: 0, readyState: 4, videoWidth: 640, videoHeight: 360, paused: true, playError: videoPlayError, playCalls: 0, pauseCalls: 0, loadCalls: 0,
    play() { this.playCalls++; if (this.playError) return Promise.reject(new Error('Autoplay blocked')); this.paused = false; return Promise.resolve(); },
    pause() { this.pauseCalls++; this.paused = true; }, load() { this.loadCalls++; }
  };
  node.style.setProperty = (name, value) => { node.style[name] = value; };
  for (const [property, initial] of Object.entries({ textContent: '', innerHTML: '', hidden: false, disabled: false, open: false })) {
    let value = initial;
    Object.defineProperty(node, property, { enumerable: true, get: () => value, set: next => { write(property === 'textContent' || property === 'innerHTML' ? 'textWrites' : 'propertyWrites'); value = next; } });
  }
  const tag = htmlSource.match(new RegExp(`<[^>]+\\bid="${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>`))?.[0] || '';
  if (/\bhidden(?:\s|=|>)/.test(tag)) node.hidden = true;
  const src = tag.match(/\bsrc="([^"]*)"/)?.[1];
  if (src) { node.src = src; attributes.set('src', src); }
  for (const attribute of ['muted', 'loop', 'playsinline']) if (new RegExp(`\\b${attribute}(?:\\s|=|>)`).test(tag)) node[attribute === 'playsinline' ? 'playsInline' : attribute] = true;
  return node;
};
const getNode = id => { if (!nodes.has(id)) nodes.set(id, makeNode(id)); return nodes.get(id); };
let miniMapTiles = [], snackRows = [];
const pendingFrames = new Map(); let nextFrameId = 1;
const frameStep = frameMs;
let randomSeed = seed;
const random = () => ((randomSeed = (randomSeed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const seededMath = Object.create(Math); seededMath.random = random;
let now = 0;
let rendererStub = null;
const sandbox = {
  console, Math: seededMath,
  window: { addEventListener(type, callback) { addHandler('window', type, callback); }, MansionRenderer: class { constructor() { rendererStub = this; this.tvVideo = null; } resize() {} setFloor() { metrics.floorAssignments++; } setTVVideo(video) { this.tvVideo = video; metrics.tvAssignments++; } draw(_state, time) { metrics.draws++; metrics.drawTimes.push(time); } resetView() { metrics.cameraResets++; } zoomBy() {} toggleOverview() { return false; } getZoom() { return 1.45; } } },
  document: { hidden: false, baseURI: 'http://127.0.0.1:4173/', getElementById: getNode, querySelectorAll: selector => { metrics.queries++; return selector === '.mini-map [data-room]' ? miniMapTiles : selector === '.snack-item' ? snackRows : []; }, addEventListener(type, callback) { addHandler('document', type, callback); }, createElement: () => makeNode(), body: makeNode() },
  URL, AbortController,
  fetch: musicFetch || (() => Promise.reject(new Error('Music assets unavailable in this isolated fixture'))),
  performance: { now: () => now }, localStorage: { getItem: key => storage.has(key) ? storage.get(key) : null, setItem(key, value) { metrics.storageWrites++; storage.set(key, String(value)); } },
  setTimeout: () => 1, clearTimeout() {}, ResizeObserver: class { observe() {} },
  requestAnimationFrame: callback => { const id = nextFrameId++; pendingFrames.set(id, callback); metrics.rafScheduled++; metrics.maxPendingRaf = Math.max(metrics.maxPendingRaf, pendingFrames.size); return id; },
  cancelAnimationFrame: id => pendingFrames.delete(id)
};
vm.createContext(sandbox);
if (audioContextFactory) sandbox.window.AudioContext = audioContextFactory;
vm.runInContext(fs.readFileSync(path.join(projectRoot, 'dist/world.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(projectRoot, 'dist/guests.js'), 'utf8'), sandbox);
if (fs.existsSync(path.join(projectRoot, 'dist/wing.js'))) vm.runInContext(fs.readFileSync(path.join(projectRoot, 'dist/wing.js'), 'utf8'), sandbox);
if (!wingSimulationEnabled && sandbox.window.HSWing) { const createWing = sandbox.window.HSWing.create; sandbox.window.HSWing = { create: (...args) => ({ ...createWing(...args), update() {} }) }; }
if (fs.existsSync(path.join(projectRoot, 'dist/stealth.js'))) vm.runInContext(fs.readFileSync(path.join(projectRoot, 'dist/stealth.js'), 'utf8'), sandbox);
if (!stealthSimulationEnabled && sandbox.window.HSStealth) { const createStealth = sandbox.window.HSStealth.create; sandbox.window.HSStealth = { create: (...args) => ({ ...createStealth(...args), update() {}, makeNoise() {}, drainEvents: () => [] }) }; }
vm.runInContext(fs.readFileSync(path.join(projectRoot, 'dist/chatter.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(projectRoot, 'dist/music.js'), 'utf8'), sandbox);
if (fs.existsSync(path.join(projectRoot, 'dist/munching.js'))) vm.runInContext(fs.readFileSync(path.join(projectRoot, 'dist/munching.js'), 'utf8'), sandbox);
// Geometry stress deliberately removes all guests. Its navigation checks do
// not need to rebuild the unrelated NPC collision grid on each fixture reset.
if (!guestBrainEnabled) sandbox.window.HSGuestBrain = { create: () => ({ reset() {}, update() {} }) };
const originalIsWalkable = sandbox.window.HSWorld.isWalkable;
sandbox.window.HSWorld.isWalkable = function (...args) { metrics.walkabilityChecks++; return originalIsWalkable.apply(this, args); };
miniMapTiles = sandbox.window.HSWorld.rooms.map(room => { const node = makeNode(); node.dataset.room = room.id; return node; });
snackRows = sandbox.window.HSWorld.snacks.map(snack => { const node = getNode(`snack-${snack.id}`); node.id = `snack-${snack.id}`; return node; });
let source = fs.readFileSync(path.join(projectRoot, 'dist/app.js'), 'utf8');
source = source.replace('window.HighAndSeek =', 'window.__qa = { state, begin, collect, autoEat: typeof autoEat === "function" ? autoEat : null, spendEnergy: typeof spendEnergy === "function" ? spendEnergy : null, navigate, move, frame, keys, restart, openPause, openMap, closeDialog, hint, music: typeof music === "object" ? music : null, syncMusic: typeof syncMusic === "function" ? syncMusic : null, canFinishRun: typeof canFinishRun === "function" ? canFinishRun : null, finishRun: typeof finishRun === "function" ? finishRun : null, headHome: typeof headHome === "function" ? headHome : null, interact: typeof interact === "function" ? interact : null, changeFloor: typeof changeFloor === "function" ? changeFloor : null, useStairs: typeof useStairs === "function" ? useStairs : null, canUseStairs: typeof canUseStairs === "function" ? canUseStairs : null, headForStairs: typeof headForStairs === "function" ? headForStairs : null, headForWing: typeof headForWing === "function" ? headForWing : null, useDoor: typeof useDoor === "function" ? useDoor : null, canUseDoor: typeof canUseDoor === "function" ? canUseDoor : null, wingSimulation: typeof wingSimulation === "object" ? wingSimulation : null, excuseConversation: typeof excuseConversation === "function" ? excuseConversation : null, updateGuests: typeof updateGuests === "function" ? updateGuests : null, checkConversation: typeof checkConversation === "function" ? checkConversation : null, getPath: () => path, getAuto: () => autoCollect }; window.HighAndSeek =');
source = source.replace('window.__qa = {', 'window.__qa = { stealthSimulation: typeof stealthSimulation === "object" ? stealthSimulation : null, startResidentLecture: typeof startResidentLecture === "function" ? startResidentLecture : null, handleStealthEvents: typeof handleStealthEvents === "function" ? handleStealthEvents : null, endConversation: typeof endConversation === "function" ? endConversation : null,');
vm.runInContext(source, sandbox);
const qa = sandbox.window.__qa;
const world = sandbox.window.HSWorld;
const stepFrame = (milliseconds = frameStep) => { now += milliseconds; const callbacks = [...pendingFrames.values()]; pendingFrames.clear(); for (const callback of callbacks) { metrics.rafCallbacks++; callback(now); } };
const dispatch = (target, type, event = {}) => { for (const callback of handlers.get(`${target}:${type}`) || []) callback(event); };
const resetMetrics = () => { for (const key of Object.keys(metrics)) metrics[key] = key === 'drawTimes' ? [] : 0; metrics.maxPendingRaf = pendingFrames.size; };
return { qa, world, guestBrain: sandbox.window.HSGuestBrain, chatterAPI: sandbox.window.HSChatter, renderer: rendererStub, nodes, getNode, snackRows, miniMapTiles, random, stepFrame, metrics, resetMetrics, dispatch, storage, document: sandbox.document, getPendingRaf: () => pendingFrames.size, elapseWithoutFrame: milliseconds => { now += milliseconds; }, getTime: () => now };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
const frameStep = Number(process.argv[2] || process.env.QA_FRAME_MS) || 1000 / 60;
const { qa, world, miniMapTiles, stepFrame, random } = createGameHarness({ frameMs: frameStep, guestBrainEnabled: false, wingSimulationEnabled: false, stealthSimulationEnabled: false });
qa.state.guests = []; // Route geometry is independent of the timed guest obstacle.
const spawned = [...world.snacks];
for (const snack of spawned) {
  // This suite isolates route reachability; actual energy budgets are exercised
  // by qa-energy/qa-haul on partial runs with a return journey.
  qa.state.energy = world.rules.maxEnergy;
  if (qa.state.level !== snack.level) qa.changeFloor(snack.level, world.floors[snack.level].stair || world.floors[snack.level].doors[0]);
  qa.navigate(snack.x, snack.y, snack);
  const pathLength = qa.getPath().length;
  assert.ok(pathLength, `click path exists for ${snack.name}`);
  let frames = 0;
  while (!qa.state.found.has(snack.id) && frames++ < 4000) {
    stepFrame();
    assert.ok(world.isWalkable(qa.state.player.x, qa.state.player.y), `player remains collision-safe en route to ${snack.name}`);
    if (!qa.getPath().length && !qa.state.found.has(snack.id)) break;
  }
  assert.ok(qa.state.found.has(snack.id), `${snack.name} collected; stopped at ${qa.state.player.x.toFixed(3)},${qa.state.player.y.toFixed(3)}, path=${qa.getPath().length}, target=${qa.getAuto()?.id}`);
  console.log(`PASS: ${snack.name} via ${pathLength} waypoints / ${frames} frames`);
}
assert.equal(qa.state.won, false, 'collecting every spawned snack never automatically ends a haul');
assert.equal(qa.state.found.size, spawned.length);
assert.ok(miniMapTiles.every(tile => !tile.classList.contains('cleared')), 'mini-map never reveals cleared rooms');
qa.state.energy = world.rules.maxEnergy;
if (qa.state.level !== world.home.level) qa.changeFloor(world.home.level, world.home);
qa.navigate(world.home.x, world.home.y);
for (let frames = 0; qa.getPath().length && frames++ < 4000; ) stepFrame();
assert.equal(qa.state.won, false, 'arriving home does not finish automatically');
assert.equal(qa.finishRun(), true, 'explicitly resting at the home couch banks the haul');
console.log(`PASS: all ${spawned.length} spawned snacks pathable; explicit return-home finish required`);

qa.restart();
assert.equal(qa.state.found.size, 0, 'restart clears the haul');
qa.navigate(world.snacks[0].x, world.snacks[0].y, world.snacks[0]);
stepFrame();
qa.openPause();
const pausedTime = qa.state.elapsed;
const pausedPosition = { ...qa.state.player };
for (let i = 0; i < 60; i++) stepFrame();
assert.equal(qa.state.elapsed, pausedTime, 'pause freezes hunt timer');
assert.equal(qa.state.player.x, pausedPosition.x, 'pause freezes horizontal movement');
assert.equal(qa.state.player.y, pausedPosition.y, 'pause freezes vertical movement');
qa.closeDialog();
stepFrame();
assert.ok(qa.state.elapsed > pausedTime, 'timer resumes after dialog closes');
console.log('PASS: pause and resume freeze and restore game simulation');

const stalls = [];
for (let trial = 0; trial < 160; trial++) {
  qa.restart();
  qa.state.guests = [];
  const snack = world.snacks[trial % world.snacks.length];
  if (qa.state.level !== snack.level) qa.changeFloor(snack.level, world.floors[snack.level].stair || world.floors[snack.level].doors[0]);
  let x, y;
  do { x = 1.3 + random() * 27.4; y = 1.3 + random() * 19.4; } while (!world.isWalkable(x, y));
  qa.state.player.x = x; qa.state.player.y = y;
  qa.navigate(snack.x, snack.y, snack);
  let frames = 0;
  while (!qa.state.found.has(snack.id) && frames++ < 2000) {
    stepFrame();
    if (!qa.getPath().length && !qa.state.found.has(snack.id)) break;
  }
  if (!qa.state.found.has(snack.id)) stalls.push({ trial, level: qa.state.level, start: { x, y }, snack: { id: snack.id, x: snack.x, y: snack.y, level: snack.level }, stopped: { x: qa.state.player.x, y: qa.state.player.y }, remaining: qa.getPath().length, energy: qa.state.energy, failed: qa.state.failed, discovered: qa.state.discovered.has(snack.id) });
}
console.log(`Random walkable starts: ${160 - stalls.length}/160 succeeded.`);
if (stalls.length) console.log(JSON.stringify(stalls.slice(0, 5), null, 2));
assert.equal(stalls.length, 0, 'every random walkable starting position reaches its snack');
}
