/* High and Seek: shared navigation and pursuit for upstairs guests. */
(function () {
  'use strict';

  const STEP = .5, RADIUS = .22, CHASE_SPEED = 2.25, PATROL_SPEED = .8;
  const DETECTION = 8, GIVE_UP_DISTANCE = 11, MEMORY = 4, SAFE_STAIRS = 1.8;
  const DIRECTIONS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const OPPOSITE = [1, 0, 3, 2, 7, 6, 5, 4];

  function create(world) {
    let grid = null, field = null, records = new WeakMap();
    let fieldAge = Infinity, lastLevel = null, lastRoom = null, fieldBuilds = 0, gridBuilds = 0;

    function walkable(x, y, level) { return world.isWalkable(x, y, RADIUS, level); }
    function clearSegment(x, y, endX, endY, level) {
      const dx = endX - x, dy = endY - y, steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / .08));
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        if (!walkable(x + dx * t, y + dy * t, level)) return false;
      }
      return true;
    }
    function clearLine(a, b, level) { return clearSegment(a.x, a.y, b.x, b.y, level); }
    function nodePoint(index) { return { x: (index % grid.cols) * STEP, y: Math.floor(index / grid.cols) * STEP }; }

    function buildGrid(level) {
      const cols = Math.round(world.width / STEP) + 1, rows = Math.round(world.height / STEP) + 1, size = cols * rows;
      grid = { level, cols, rows, open: new Uint8Array(size), edges: new Uint8Array(size), queue: new Int32Array(size), parents: new Int32Array(size) };
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) grid.open[y * cols + x] = walkable(x * STEP, y * STEP, level) ? 1 : 0;
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        const index = y * cols + x;
        if (!grid.open[index]) continue;
        for (let d = 0; d < DIRECTIONS.length; d++) {
          // Build each undirected edge once, with identical reverse geometry.
          if (d === 1 || d === 3 || d === 6 || d === 7) continue;
          const [dx, dy] = DIRECTIONS[d], nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || !grid.open[ny * cols + nx]) continue;
          // Validate the actual circle segment, including rounded corners;
          // square grid cells must not forbid a genuinely clear diagonal.
          if (clearSegment(x * STEP, y * STEP, nx * STEP, ny * STEP, level)) {
            grid.edges[index] |= 1 << d;
            grid.edges[ny * cols + nx] |= 1 << OPPOSITE[d];
          }
        }
      }
      gridBuilds++;
      field = null;
    }

    function closestNode(point, requireLine = true) {
      const cx = Math.round(point.x / STEP), cy = Math.round(point.y / STEP), candidates = [];
      for (let y = Math.max(0, cy - 4); y <= Math.min(grid.rows - 1, cy + 4); y++) {
        for (let x = Math.max(0, cx - 4); x <= Math.min(grid.cols - 1, cx + 4); x++) {
          const index = y * grid.cols + x;
          if (grid.open[index]) candidates.push({ index, distance: Math.hypot(x * STEP - point.x, y * STEP - point.y) });
        }
      }
      candidates.sort((a, b) => a.distance - b.distance);
      for (const candidate of candidates) if (!requireLine || clearLine(point, nodePoint(candidate.index), grid.level)) return candidate.index;
      return -1;
    }

    function rebuildField(player) {
      const goal = closestNode(player), distances = field?.distances || new Int32Array(grid.open.length);
      distances.fill(-1);
      let head = 0, tail = 0;
      if (goal >= 0) { grid.queue[tail++] = goal; distances[goal] = 0; }
      while (head < tail) {
        const index = grid.queue[head++], mask = grid.edges[index];
        for (let d = 0; d < DIRECTIONS.length; d++) if (mask & (1 << d)) {
          const [dx, dy] = DIRECTIONS[d], next = index + dy * grid.cols + dx;
          if (distances[next] >= 0) continue;
          distances[next] = distances[index] + 1;
          grid.queue[tail++] = next;
        }
      }
      field = { goal, distances, version: (field?.version || 0) + 1, reachable: tail };
      fieldAge = 0; fieldBuilds++;
    }

    function pursuitPoint(guest) {
      const cx = Math.round(guest.x / STEP), cy = Math.round(guest.y / STEP);
      let result = null, best = Infinity;
      // Looking a few cells ahead smooths the shared field without a path search
      // for each person. Only collision-clear shortcuts are considered.
      for (let y = Math.max(0, cy - 3); y <= Math.min(grid.rows - 1, cy + 3); y++) {
        for (let x = Math.max(0, cx - 3); x <= Math.min(grid.cols - 1, cx + 3); x++) {
          const index = y * grid.cols + x, distance = field.distances[index];
          if (distance < 0) continue;
          const point = { x: x * STEP, y: y * STEP }, travel = Math.hypot(point.x - guest.x, point.y - guest.y);
          if (travel < .04 || travel > 1.6) continue;
          const score = distance + travel * .15;
          if (score < best && clearLine(guest, point, guest.level)) { result = point; best = score; }
        }
      }
      return result;
    }

    function moveToward(guest, target, budget, stop = .025) {
      const distance = Math.hypot(target.x - guest.x, target.y - guest.y);
      if (distance <= stop) return 0;
      const travel = Math.min(budget, distance - stop), startX = guest.x, startY = guest.y;
      let moved = 0, remaining = travel;
      const attempts = Math.max(4, Math.ceil(travel / .05) * 3);
      for (let i = 0; i < attempts && remaining > .0001; i++) {
        const dx = target.x - guest.x, dy = target.y - guest.y, gap = Math.hypot(dx, dy);
        if (gap <= stop + .000001) break;
        const stride = Math.min(.1, remaining, gap - stop);
        const result = world.moveCircle(guest.x, guest.y, dx / gap * stride, dy / gap * stride, RADIUS, guest.level);
        if (!Number.isFinite(result.x) || !Number.isFinite(result.y)) break;
        const displacement = Math.hypot(result.x - guest.x, result.y - guest.y);
        const spent = Math.min(stride, Math.max(displacement, Number(result.distance) || 0));
        guest.x = result.x; guest.y = result.y;
        moved += spent; remaining -= spent;
        if (spent < .0001) break;
      }
      if (moved > .0001) { guest.moving = true; guest.facing = guest.x - startX - (guest.y - startY) >= 0 ? 1 : -1; }
      return moved;
    }

    // A guest returning to their patrol can be on the other side of furniture.
    // Cache that occasional return route; do not run an individual BFS per frame.
    function patrolPath(guest, target) {
      const start = closestNode(guest), goal = closestNode(target);
      if (start < 0 || goal < 0) return [];
      const parents = grid.parents; parents.fill(-1);
      let head = 0, tail = 0; grid.queue[tail++] = start; parents[start] = start;
      while (head < tail && parents[goal] < 0) {
        const index = grid.queue[head++], mask = grid.edges[index];
        for (let d = 0; d < DIRECTIONS.length; d++) if (mask & (1 << d)) {
          const [dx, dy] = DIRECTIONS[d], next = index + dy * grid.cols + dx;
          if (parents[next] >= 0) continue;
          parents[next] = index; grid.queue[tail++] = next;
        }
      }
      if (parents[goal] < 0) return [];
      const path = [target];
      for (let index = goal; index !== start; index = parents[index]) path.push(nodePoint(index));
      path.push(nodePoint(start));
      return path.reverse();
    }

    function patrol(guest, record, dt) {
      if (!guest.route?.length) return;
      guest.routeIndex = Number.isInteger(guest.routeIndex) ? guest.routeIndex % guest.route.length : 0;
      let budget = PATROL_SPEED * dt;
      for (let attempts = 0; attempts < 12 && budget > .0001; attempts++) {
        const target = guest.route[guest.routeIndex];
        if (Math.hypot(target.x - guest.x, target.y - guest.y) < .04) {
          guest.routeIndex = (guest.routeIndex + 1) % guest.route.length;
          record.patrolPath = null; record.patrolGoal = null; record.patrolDirect = null;
          if (guest.route.length === 1) break;
          continue;
        }
        let waypoint = target;
        if (record.patrolGoal !== target) {
          record.patrolGoal = target; record.patrolDirect = clearLine(guest, target, guest.level);
          record.patrolPath = record.patrolDirect ? null : patrolPath(guest, target);
        }
        if (!record.patrolDirect) {
          while (record.patrolPath.length && Math.hypot(record.patrolPath[0].x - guest.x, record.patrolPath[0].y - guest.y) < .05) record.patrolPath.shift();
          if (!record.patrolPath.length) break;
          // Consume a visible portion of the cached route to avoid grid jitter.
          for (let i = Math.min(6, record.patrolPath.length - 1); i > 0; i--) if (clearLine(guest, record.patrolPath[i], guest.level)) { record.patrolPath.splice(0, i); break; }
          waypoint = record.patrolPath[0];
        }
        const moved = moveToward(guest, waypoint, budget);
        budget -= moved;
        if (moved < .0001) { record.patrolGoal = null; break; }
      }
    }

    function update(guests, player, dt, options = {}) {
      const seconds = Math.max(0, Math.min(.25, Number(dt) || 0)), level = player.level ?? world.level;
      const room = world.getRoom(player.x, player.y, level)?.id || 'gallery';
      const changed = level !== lastLevel || room !== lastRoom;
      lastLevel = level; lastRoom = room; fieldAge += seconds;
      const active = options.active !== false && !options.conversation;
      const cooldown = Math.max(0, Number(options.cooldown) || 0);
      const stair = world.floors.find(floor => floor.id === level)?.stair;
      const safe = stair && Math.hypot(player.x - stair.x, player.y - stair.y) <= SAFE_STAIRS;
      if (level === 1 && active && (!grid || grid.level !== level)) buildGrid(level);
      let needsField = false;
      for (const guest of guests) {
        guest.moving = false;
        let record = records.get(guest);
        if (!record) { record = { memory: 0, perception: 0, visible: false, chasing: false, waypoint: null, patrolPath: null, patrolGoal: null, patrolDirect: null }; records.set(guest, record); }
        if (guest.level !== level || level !== 1 || !active) {
          guest.chasing = false; guest.alertness = 'idle'; record.memory = 0; record.chasing = false; record.visible = false;
          continue;
        }
        const distance = Math.hypot(guest.x - player.x, guest.y - player.y);
        record.memory = Math.max(0, record.memory - seconds); record.perception -= seconds;
        if (cooldown > 0 || safe || distance > GIVE_UP_DISTANCE) { record.memory = 0; record.visible = false; }
        else if (record.perception <= 0 || changed) {
          record.perception = .25;
          record.visible = distance <= DETECTION && clearLine(guest, player, level);
          if (record.visible) record.memory = MEMORY;
        }
        guest.chasing = record.memory > 0 && cooldown <= 0 && !safe && distance <= GIVE_UP_DISTANCE;
        guest.alertness = guest.chasing ? 'chasing' : 'patrolling';
        if (guest.chasing !== record.chasing) { record.waypoint = null; record.patrolPath = null; record.patrolGoal = null; record.patrolDirect = null; }
        record.chasing = guest.chasing;
        if (guest.chasing) needsField = true;
      }
      if (!active || level !== 1 || !grid || !seconds) return;
      if (needsField && (!field || changed || fieldAge >= .25)) rebuildField(player);
      for (const guest of guests) {
        if (guest.level !== level) continue;
        const record = records.get(guest);
        if (!guest.chasing) { patrol(guest, record, seconds); continue; }
        const distance = Math.hypot(guest.x - player.x, guest.y - player.y);
        if (distance <= .88) { guest.facing = player.x - guest.x - (player.y - guest.y) >= 0 ? 1 : -1; continue; }
        if (record.visible) {
          if (moveToward(guest, player, CHASE_SPEED * seconds, .88) < .0001) record.visible = false;
          record.waypoint = null;
        } else if (field?.goal >= 0) {
          if (!record.waypoint || record.fieldVersion !== field.version || Math.hypot(record.waypoint.x - guest.x, record.waypoint.y - guest.y) < .06) {
            record.waypoint = pursuitPoint(guest); record.fieldVersion = field.version;
          }
          if (record.waypoint && moveToward(guest, record.waypoint, CHASE_SPEED * seconds) < .0001) record.waypoint = null;
        }
      }
    }

    function reset() {
      grid = null; field = null; records = new WeakMap(); fieldAge = Infinity;
      lastLevel = null; lastRoom = null; fieldBuilds = 0; gridBuilds = 0;
    }
    return { update, reset, getDebug: () => ({ level: grid?.level ?? null, gridCells: grid?.open.length || 0, reachableCells: field?.reachable || 0, fieldBuilds, gridBuilds }) };
  }
  window.HSGuestBrain = { create };
})();
