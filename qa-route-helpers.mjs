import assert from 'node:assert/strict';

export function escapeConversation(run, onFrame = () => {}) {
  const { qa } = run;
  if (!qa.state.conversation) return;
  if (qa.state.conversation.unskippable) {
    for (let count = 0; qa.state.conversation && !qa.state.failed && count < 65; count++) { run.stepFrame(100); onFrame(); }
    assert.equal(qa.state.conversation, null, 'the resident finishes the full lecture naturally');
    return;
  }
  const presses = qa.state.conversation.escapeRequired;
  for (let count = 0; qa.state.conversation && !qa.state.failed && count <= presses; count++) {
    run.stepFrame(100); onFrame(); qa.interact();
  }
  assert.equal(qa.state.conversation, null, 'deliberate taps escape the encounter');
}

export function walkRoute(run, { label = 'walking route', onFrame = () => {}, maxFrames = 12000 } = {}) {
  for (let frame = 0; run.qa.getPath().length && !run.qa.state.failed && frame < maxFrames; frame++) {
    const destination = run.qa.getPath().at(-1), snack = run.qa.getAuto();
    run.stepFrame(); onFrame();
    const residentLecture = run.qa.state.conversation?.unskippable;
    escapeConversation(run, onFrame);
    const unfinishedSnack = snack && !run.qa.state.found.has(snack.id);
    if (residentLecture && !run.qa.state.failed && !run.qa.getPath().length && (unfinishedSnack || Math.hypot(run.qa.state.player.x - destination.x, run.qa.state.player.y - destination.y) > .03)) {
      const goal = unfinishedSnack ? snack : destination;
      run.qa.navigate(goal.x, goal.y, unfinishedSnack ? snack : null);
    }
  }
  assert.equal(run.qa.state.failed, false, `${label} preserves energy`);
  assert.equal(run.qa.getPath().length, 0, `${label} reaches its destination`);
}

export function nextHomeExit(world, from) {
  const queue = [{ level: from, first: null }], visited = new Set([from]);
  for (const entry of queue) {
    if (entry.level === world.home.level) return entry.first;
    const floor = world.floors[entry.level];
    for (const exit of [...(floor.stair ? [floor.stair] : []), ...(floor.doors || [])]) {
      if (visited.has(exit.to)) continue;
      visited.add(exit.to); queue.push({ level: exit.to, first: entry.first || exit });
    }
  }
  assert.fail(`floor ${from} has no route to the final couch`);
}

// Exercise the player's route control at each boundary. There are no teleports,
// energy overrides, bag fixtures or automatic floor changes in this helper.
export function walkToHome(run, { onFrame = () => {} } = {}) {
  const { qa, world } = run, transitions = [];
  for (let leg = 0; leg <= world.floors.length; leg++) {
    const level = qa.state.level, exit = level === world.home.level ? null : nextHomeExit(world, level);
    qa.headHome();
    walkRoute(run, { label: `${world.floors[level].name} couch route`, onFrame });
    assert.equal(qa.state.level, level, 'the couch route never changes floors automatically');
    assert.equal(qa.state.won, false, 'walking to the couch never banks remotely');
    if (!exit) {
      assert.ok(world.isHome(qa.state.player.x, qa.state.player.y, qa.state.level), 'route reaches the final couch');
      return transitions;
    }
    assert.ok(Math.hypot(qa.state.player.x - exit.x, qa.state.player.y - exit.y) <= exit.radius, 'couch route reaches the correct next exit');
    // Arrival cooldowns may still be active if two connections share a hall.
    for (let count = 0; qa.state.stairsCooldown > 0 && count < 120; count++) { run.stepFrame(100); onFrame(); escapeConversation(run, onFrame); }
    const isStair = world.floors[level].stair === exit;
    assert.equal(isStair ? qa.canUseStairs() : qa.canUseDoor(), true, 'next couch transition is usable');
    assert.equal(isStair ? qa.useStairs() : qa.useDoor(), true, 'explicit interaction crosses the connection');
    assert.equal(qa.state.level, exit.to, 'transition reaches the connected area');
    transitions.push([level, qa.state.level]);
  }
  assert.fail('couch route cycled without reaching its destination');
}
