import assert from 'node:assert/strict';
import { createGameHarness } from './qa-pathing.mjs';

// Drive the real rAF callback with synthetic display refresh rates. This catches
// uncapped high-refresh rendering without depending on the host monitor/GPU.
function advance(harness, milliseconds, intervals) {
  const end = harness.getTime() + milliseconds;
  let index = 0;
  while (harness.getTime() < end - 1e-7) {
    harness.stepFrame(Math.min(intervals[index++ % intervals.length], end - harness.getTime()));
  }
}
const compactMetrics = metrics => Object.fromEntries(Object.entries(metrics).filter(([key]) => key !== 'drawTimes'));
const near = (actual, expected, tolerance, message) => assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: expected ${expected}, got ${actual}`);

const refreshRates = [60, 120, 144, 240];
const results = [];
for (const level of [0, 1]) for (const hz of refreshRates) {
  const run = createGameHarness({ frameMs: 1000 / hz });
  run.qa.begin();
  if (level === 1) run.qa.changeFloor(1, run.world.floors[1].stair);
  run.resetMetrics();
  advance(run, 2000, [1000 / hz]);
  assert.ok(run.metrics.draws <= 121, `${hz}Hz display never renders more than 60fps plus one boundary frame (${run.metrics.draws})`);
  assert.ok(run.metrics.draws >= 117, `${hz}Hz display keeps rendering close to 60fps (${run.metrics.draws})`);
  near(run.qa.state.elapsed, 2, 1 / 60 + 1e-6, `elapsed time stays accurate at ${hz}Hz`);
  near(run.qa.state.energy, 100 - run.world.rules.idleDrain * run.qa.state.elapsed, .0001, `energy uses elapsed time at ${hz}Hz`);
  assert.equal(run.getPendingRaf(), 1, `${hz}Hz retains one scheduled animation callback`);
  assert.equal(run.metrics.maxPendingRaf, 1, `${hz}Hz never grows a second animation loop`);
  results.push(`floor ${level}, ${hz}Hz → ${(run.metrics.draws / 2).toFixed(1)}fps`);
}
console.log(`PASS: active 60fps cap: ${results.join(', ')}`);

const chaseSamples = [];
for (const hz of refreshRates) {
  const run = createGameHarness({ frameMs: 1000 / hz });
  run.qa.begin(); run.qa.changeFloor(1, { x: 10, y: 8 }); run.qa.state.talkCooldown = 0;
  run.resetMetrics(); advance(run, 1500, [1000 / hz]);
  assert.ok(run.metrics.draws <= 91 && run.metrics.draws >= 87, `active chase remains near the sixty-fps cap on a ${hz}Hz display`);
  assert.ok(run.qa.state.guests.some(guest => guest.chasing), 'the chase performance sample exercises an alerted guest');
  const pursuer = run.qa.state.guests.find(guest => guest.id === 'hallwayChat');
  chaseSamples.push({ hz, x: pursuer.x, y: pursuer.y });
}
for (const sample of chaseSamples.slice(1)) {
  near(sample.x, chaseSamples[0].x, .06, `chase horizontal speed agrees at ${sample.hz}Hz`);
  near(sample.y, chaseSamples[0].y, .06, `chase vertical speed agrees at ${sample.hz}Hz`);
}
const lowRateChase = createGameHarness();
lowRateChase.qa.begin(); lowRateChase.qa.changeFloor(1, { x: 10, y: 8 }); lowRateChase.qa.state.talkCooldown = 0;
advance(lowRateChase, 1500, [1000]);
const lowRatePursuer = lowRateChase.qa.state.guests.find(guest => guest.id === 'hallwayChat');
near(lowRatePursuer.x, chaseSamples[0].x, .06, 'one-second frames preserve horizontal pursuit speed');
near(lowRatePursuer.y, chaseSamples[0].y, .06, 'one-second frames preserve vertical pursuit speed');
console.log('PASS: live pursuit keeps the sixty-fps cap and matching guest speed across display refresh rates');

const routing = createGameHarness(); routing.qa.begin(); routing.resetMetrics();
for (let attempt = 0; attempt < 10; attempt++) routing.qa.navigate(15, 11);
assert.ok(routing.metrics.walkabilityChecks < 1000, `ten normal route calculations check local grid connectors rather than raycasting across the mansion (${routing.metrics.walkabilityChecks})`);
console.log(`PASS: ten route calculations require only ${routing.metrics.walkabilityChecks} collision checks`);

const jitter = createGameHarness(); jitter.qa.begin(); jitter.resetMetrics();
advance(jitter, 5000, [3, 4, 8, 5, 27, 6, 12, 42, 4, 7, 5, 18]);
assert.ok(jitter.metrics.draws <= 301, 'jittery display callbacks remain capped at 60fps on average');
near(jitter.qa.state.elapsed, 5, .017, 'skipped/jittery frames retain elapsed time');
const elapsedBeforeGap = jitter.qa.state.elapsed;
jitter.stepFrame(250);
assert.ok(jitter.qa.state.elapsed - elapsedBeforeGap >= .25 - 1e-6, 'long animation gap retains elapsed time');
assert.equal(jitter.getPendingRaf(), 1, 'long animation gap does not start a catch-up loop');
console.log('PASS: jitter, skipped callbacks, and a long frame preserve elapsed time');

const movement = [];
for (const hz of refreshRates) {
  const run = createGameHarness({ frameMs: 1000 / hz });
  run.qa.begin(); run.qa.keys.add('d');
  advance(run, 1000, [1000 / hz]); run.qa.keys.clear();
  movement.push({ hz, x: run.qa.state.player.x, y: run.qa.state.player.y, energy: run.qa.state.energy, elapsed: run.qa.state.elapsed });
}
for (const value of movement.slice(1)) {
  near(value.x, movement[0].x, .06, `horizontal movement is display-rate independent at ${value.hz}Hz`);
  near(value.y, movement[0].y, .06, `vertical movement is display-rate independent at ${value.hz}Hz`);
  near(value.energy, movement[0].energy, .13, `movement energy cost is display-rate independent at ${value.hz}Hz`);
}
console.log('PASS: movement and energy cost agree across 60/120/144/240Hz');

const idle = createGameHarness();
advance(idle, 1000, [1000 / 144]); idle.resetMetrics();
advance(idle, 10000, [1000 / 144]);
assert.ok(idle.metrics.draws <= 301, 'unstarted idle scene renders at most 30fps');
assert.ok(idle.metrics.domWrites <= 5, `stable idle HUD does not repeatedly mutate DOM (${idle.metrics.domWrites})`);
console.log(`PASS: idle: ${idle.metrics.draws} draws and ${idle.metrics.domWrites} DOM writes over 10s`);

const active = createGameHarness(); active.qa.begin();
advance(active, 1000, [1000 / 144]); active.resetMetrics();
advance(active, 10000, [1000 / 144]);
assert.ok(active.metrics.domWrites < 700, `active HUD avoids per-frame redundant writes (${active.metrics.domWrites})`);
assert.ok(active.metrics.queries <= 5, `active loop reuses DOM references (${active.metrics.queries} queries)`);
console.log(`PASS: active stationary HUD over 10s: ${JSON.stringify(compactMetrics(active.metrics))}`);

active.qa.openPause(); active.stepFrame(100); active.resetMetrics();
const pausedEnergy = active.qa.state.energy, pausedElapsed = active.qa.state.elapsed;
advance(active, 2000, [1000 / 144]);
assert.ok(active.metrics.draws <= 1, 'paused scene stops drawing once its final state is painted');
assert.ok(active.metrics.domWrites <= 5, 'paused HUD remains unchanged');
near(active.qa.state.energy, pausedEnergy, .0001, 'pause freezes energy while rendering is stopped');
near(active.qa.state.elapsed, pausedElapsed, .0001, 'pause freezes elapsed time while rendering is stopped');
active.elapseWithoutFrame(90000); active.qa.closeDialog(); active.stepFrame(100);
near(active.qa.state.elapsed, pausedElapsed + .1, .001, 'resume excludes suspended pause duration');

active.document.hidden = true; active.dispatch('document', 'visibilitychange'); active.resetMetrics();
const hiddenEnergy = active.qa.state.energy;
advance(active, 2000, [1000 / 144]);
assert.equal(active.metrics.draws, 0, 'hidden document never draws');
near(active.qa.state.energy, hiddenEnergy, .0001, 'hidden document remains paused');
active.document.hidden = false; active.dispatch('document', 'visibilitychange'); active.qa.closeDialog();
active.stepFrame(100);
assert.equal(active.getPendingRaf(), 1, 'visibility and resume keep a single animation loop');
console.log('PASS: paused/hidden rendering, freeze/resume timing, and single-loop scheduling');
