import assert from 'node:assert/strict';
import test from 'node:test';
import { FRUITS, FruitGame, WORLD } from '../src/games/suika/core.js';

const TICK = 1000 / 60;
const close = (actual, expected, epsilon = 1e-6) => {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
};
const points = tier => (tier + 1) * (tier + 2) / 2;

function fruit(id, tier, x, y, extra = {}) {
  return {
    id, tier, x, y, vx: 0, vy: 0, angle: 0, angularVelocity: 0,
    ageMs: 3000, entered: true, graceMs: 0, ...extra,
  };
}

// Fixtures use the public JSON save format, not a physics mutation backdoor.
function saved(mode = 'classic', extra = {}) {
  const initial = new FruitGame(mode, { random: () => 0 });
  const snapshot = initial.snapshot();
  initial.destroy();
  return { ...snapshot, phase: 'playing', ...extra };
}

function game(t, options = {}) {
  const { mode = 'classic', ...configuration } = options;
  const result = new FruitGame(mode, { random: () => 0, ...configuration });
  t.after(() => result.destroy());
  return result;
}

function advance(g, ticks) {
  for (let i = 0; i < ticks; i++) g.step(TICK);
}

function tower(extra = {}) {
  return [
    fruit(1, 10, 220, 506, extra),
    fruit(2, 9, 220, 331, extra),
    fruit(3, 8, 220, 180, extra),
    fruit(4, 7, 220, 49, extra),
  ];
}

function inBounds(state) {
  for (const item of state.fruits) {
    const radius = FRUITS[item.tier].radius;
    assert.ok(item.x - radius >= WORLD.left - 1e-6, `left wall: ${JSON.stringify(item)}`);
    assert.ok(item.x + radius <= WORLD.right + 1e-6, `right wall: ${JSON.stringify(item)}`);
    assert.ok(item.y + radius <= WORLD.bottom + 1e-6, `floor: ${JSON.stringify(item)}`);
    for (const name of ['x', 'y', 'angle', 'vx', 'vy', 'angularVelocity']) assert.ok(Number.isFinite(item[name]), name);
    assert.ok(Math.hypot(item.vx, item.vy) <= 12 + 1e-6);
    assert.ok(Math.abs(item.angularVelocity) <= 0.15 + 1e-6);
  }
}

test('world dimensions and the complete eleven-fruit progression are stable', () => {
  assert.deepEqual(WORLD, { width: 440, height: 620, left: 16, right: 424, bottom: 600, dangerY: 126, spawnY: 58 });
  assert.deepEqual(FRUITS.map(item => item.name), ['樱桃', '草莓', '葡萄', '柑橘', '柿子', '苹果', '梨', '桃子', '菠萝', '蜜瓜', '西瓜']);
  assert.deepEqual(FRUITS.map(item => item.radius), [13, 18, 24, 30, 37, 44, 52, 61, 70, 81, 94]);
  for (const item of FRUITS) assert.match(item.color, /^#[0-9a-f]{6}$/i);
  assert.throws(() => { FRUITS[0].radius = 100; }, TypeError);
  assert.throws(() => new FruitGame('other'), TypeError);
});

test('random drops are restricted to tiers zero through four and biased toward small fruit', () => {
  const counts = [0, 0, 0, 0, 0];
  for (let i = 0; i < 100; i++) {
    const g = new FruitGame('classic', { random: () => (i + 0.5) / 100 });
    const state = g.getState();
    counts[state.current]++;
    assert.equal(state.current, state.next);
    g.destroy();
  }
  assert.deepEqual(counts, [38, 28, 18, 11, 5]);
  for (const value of [NaN, Infinity, -Infinity, -10, 1, 10, null, '0.5', undefined]) {
    const g = new FruitGame('classic', { random: () => value });
    assert.ok(Number.isInteger(g.getState().current));
    assert.ok(g.getState().current >= 0 && g.getState().current <= 4);
    g.destroy();
  }
  const g = new FruitGame('classic', { random() { throw new Error('broken random source'); } });
  assert.equal(g.getState().current, 0);
  g.destroy();
});

test('fresh state, phase transitions and destroy obey the boolean action contract', t => {
  const g = game(t);
  assert.deepEqual(g.getState(), {
    mode: 'classic', phase: 'ready', score: 0, watermelons: 0, current: 0, next: 0,
    tools: { remove: 2, shake: 1 }, dangerMs: 0, cooldownMs: 0, fruits: [],
  });
  assert.equal(g.drop(220), false);
  assert.equal(g.removeAt(220, 300), false);
  assert.equal(g.shake(), false);
  assert.equal(g.step(TICK), false);
  assert.equal(g.pause(), false);
  assert.equal(g.start(), true);
  assert.equal(g.start(), false);
  for (const bad of [0, -1, NaN, Infinity, '16', null]) assert.equal(g.step(bad), false);
  for (const bad of [NaN, Infinity, '220', null]) assert.equal(g.drop(bad), false);
  assert.equal(g.pause(), true);
  assert.equal(g.pause(), false);
  assert.equal(g.start(), true);
  assert.equal(g.destroy(), true);
  assert.equal(g.destroy(), false);
  for (const action of [() => g.start(), () => g.pause(), () => g.drop(220), () => g.step(TICK), () => g.removeAt(220, 300), () => g.shake()]) {
    assert.equal(action(), false);
  }
  assert.deepEqual(g.getState().fruits, []);
  assert.doesNotThrow(() => JSON.stringify(g.snapshot()));
});

test('drops clamp each radius to the walls, advance the preview, and notify after commit', t => {
  for (let tier = 0; tier <= 4; tier++) {
    for (const x of [-1e6, 1e6]) {
      let observed;
      const g = game(t, {
        snapshot: saved('classic', { current: tier, next: 4 }), random: () => 0.7,
        onEvent(event) { observed = { event, state: g.getState() }; },
      });
      assert.equal(g.start(), true);
      assert.equal(g.drop(x), true);
      const state = g.getState();
      assert.equal(state.current, 4);
      assert.equal(state.next, 2);
      assert.equal(state.cooldownMs, 400);
      assert.equal(state.fruits[0].tier, tier);
      assert.equal(state.fruits[0].x, x < 0 ? WORLD.left + FRUITS[tier].radius : WORLD.right - FRUITS[tier].radius);
      assert.equal(state.fruits[0].y, WORLD.spawnY);
      assert.equal(observed.event.type, 'drop');
      assert.deepEqual(observed.state, state);
      assert.equal(g.drop(220), false);
    }
  }
});

test('drop cooldown advances only by playing ticks and survives JSON restore', t => {
  const original = game(t);
  original.start();
  original.drop(130);
  advance(original, 10);
  original.step(TICK / 2);
  original.pause();
  const snapshot = JSON.parse(JSON.stringify(original.snapshot()));
  close(snapshot.cooldownMs, 400 - 10 * TICK);
  close(snapshot.accumulatorMs, TICK / 2);
  original.step(60_000);
  assert.deepEqual(original.snapshot(), snapshot);
  let draws = 0;
  const restored = game(t, { snapshot, random: () => { draws++; return 0.99; } });
  assert.equal(draws, 0, 'restoring current/next must not draw replacements');
  assert.equal(restored.getState().phase, 'paused');
  assert.equal(restored.drop(250), false);
  restored.start();
  advance(restored, 13);
  assert.equal(restored.drop(250), false);
  restored.step(TICK / 2);
  close(restored.getState().cooldownMs, 0);
  assert.equal(restored.drop(250), true);
  assert.equal(draws, 1);
});

test('all ten legal merges promote one tier, score by target tier and commit before events', t => {
  for (let tier = 0; tier < 10; tier++) {
    const radius = FRUITS[tier].radius;
    const events = [];
    const g = game(t, {
      snapshot: saved('classic', { fruits: [fruit(1, tier, 220 - radius * 0.8, 400), fruit(2, tier, 220 + radius * 0.8, 400)] }),
      onEvent(event) { events.push({ ...event, state: g.getState(), snapshot: g.snapshot() }); },
    });
    g.start();
    g.step(TICK);
    const state = g.getState();
    assert.equal(state.fruits.length, 1, `tier ${tier}`);
    assert.equal(state.fruits[0].tier, tier + 1);
    assert.equal(state.score, points(tier + 1));
    assert.equal(state.watermelons, tier === 9 ? 1 : 0);
    const merges = events.filter(event => event.type === 'merge');
    assert.equal(merges.length, 1);
    assert.equal(merges[0].tier, tier + 1);
    assert.equal(merges[0].collected, false);
    assert.deepEqual(merges[0].state, state);
    assert.equal(merges[0].snapshot.score, state.score);
    advance(g, 5);
    assert.equal(g.getState().score, points(tier + 1), 'old contact pairs must not merge again');
  }
});

test('three colliding equal fruit consume exactly one pair, never reuse a source', t => {
  const events = [];
  const g = game(t, {
    snapshot: saved('classic', { fruits: [fruit(1, 2, 190, 350), fruit(2, 2, 220, 350), fruit(3, 2, 250, 350)] }),
    onEvent: event => events.push(event),
  });
  g.start();
  g.step(TICK);
  const state = g.getState();
  assert.deepEqual(state.fruits.map(item => item.tier).sort(), [2, 3]);
  assert.equal(new Set(state.fruits.map(item => item.id)).size, 2);
  assert.equal(state.score, points(3));
  assert.equal(events.filter(event => event.type === 'merge').length, 1);
  assert.equal(state.fruits.reduce((sum, item) => sum + 2 ** item.tier, 0), 3 * 2 ** 2);
  advance(g, 60);
  assert.equal(g.getState().score, points(3));
});

test('independent contacts can merge together while new fruit wait for a later physics tick', t => {
  const events = [];
  const g = game(t, {
    snapshot: saved('classic', { fruits: [
      fruit(1, 0, 200, 350), fruit(2, 0, 220, 350),
      fruit(3, 0, 240, 350), fruit(4, 0, 260, 350),
    ] }),
    onEvent: event => events.push(event),
  });
  g.start();
  g.step(TICK);
  assert.equal(events.filter(event => event.type === 'merge').length, 2);
  assert.deepEqual(g.getState().fruits.map(item => item.tier), [1, 1]);
  assert.equal(g.getState().score, points(1) * 2);

  const chain = game(t, {
    snapshot: saved('classic', { fruits: [fruit(1, 0, 209, 350), fruit(2, 0, 231, 350), fruit(3, 1, 220, 370)] }),
  });
  chain.start();
  chain.step(TICK);
  assert.equal(chain.getState().score, points(1));
  assert.deepEqual(chain.getState().fruits.map(item => item.tier), [1, 1]);
  advance(chain, 60);
  assert.equal(chain.getState().score, points(1) + points(2));
  assert.deepEqual(chain.getState().fruits.map(item => item.tier), [2]);
});

test('classic keeps maximum watermelons without merging them further', t => {
  const events = [];
  const g = game(t, {
    snapshot: saved('classic', { fruits: [fruit(1, 10, 150, 490), fruit(2, 10, 290, 490)] }),
    onEvent: event => events.push(event),
  });
  g.start();
  advance(g, 300);
  assert.deepEqual(g.getState().fruits.map(item => item.tier), [10, 10]);
  assert.equal(g.getState().score, 0);
  assert.equal(events.filter(event => event.type === 'merge').length, 0);
  inBounds(g.getState());
});

test('collect immediately removes every new watermelon and records both score and count', t => {
  const events = [];
  const g = game(t, {
    mode: 'collect', snapshot: saved('collect', { fruits: [
      fruit(1, 9, 150, 470), fruit(2, 9, 290, 470),
      fruit(3, 9, 150, 260), fruit(4, 9, 290, 260),
    ] }),
    onEvent(event) { events.push({ event, state: g.getState() }); },
  });
  g.start();
  g.step(TICK);
  assert.equal(g.getState().watermelons, 2);
  assert.equal(g.getState().score, points(10) * 2);
  assert.equal(g.getState().fruits.length, 0);
  const merges = events.filter(({ event }) => event.type === 'merge');
  assert.equal(merges.length, 2);
  assert.ok(merges.every(({ event, state }) => event.tier === 10 && event.collected && state.watermelons === 2 && state.fruits.length === 0));
  advance(g, 120);
  assert.equal(g.getState().watermelons, 2);
});

test('remove uses hit testing, includes maximum fruit, and never gives points or refills tools', t => {
  const events = [];
  const g = game(t, {
    snapshot: saved('classic', { score: 123, fruits: [fruit(1, 10, 120, 500), fruit(2, 8, 320, 480), fruit(3, 7, 220, 310)] }),
    onEvent(event) { events.push({ event, state: g.getState() }); },
  });
  g.start();
  assert.equal(g.removeAt(20, 50), false);
  assert.equal(g.removeAt(NaN, 500), false);
  assert.equal(g.removeAt(120, Infinity), false);
  assert.equal(g.getState().tools.remove, 2);
  assert.equal(g.removeAt(120, 500), true);
  assert.equal(g.getState().tools.remove, 1);
  assert.equal(g.getState().score, 123);
  assert.equal(events[0].event.tier, 10);
  assert.equal(events[0].state.fruits.length, 2);
  assert.equal(events[0].state.tools.remove, 1);
  assert.equal(g.removeAt(320, 480), true);
  assert.equal(g.getState().tools.remove, 0);
  assert.equal(g.removeAt(220, 310), false);
  assert.equal(g.getState().score, 123);
  const restored = game(t, { snapshot: JSON.parse(JSON.stringify(g.snapshot())) });
  restored.start();
  assert.equal(restored.getState().tools.remove, 0);
  assert.equal(restored.removeAt(220, 310), false);
});

test('shake is finite, gentle, once per game, and does not consume an empty board', t => {
  const empty = game(t);
  empty.start();
  assert.equal(empty.shake(), false);
  assert.equal(empty.getState().tools.shake, 1);
  let observed;
  const g = game(t, {
    snapshot: saved('classic', { fruits: [fruit(1, 3, 46, 570), fruit(2, 4, 387, 563), fruit(3, 5, 220, 556)] }),
    random: () => 0.999,
    onEvent(event) { if (event.type === 'shake') observed = g.getState(); },
  });
  g.start();
  assert.equal(g.shake(), true);
  assert.equal(g.shake(), false);
  assert.equal(observed.tools.shake, 0);
  assert.equal(observed.score, 0);
  assert.ok(observed.fruits.every(item => Math.hypot(item.vx, item.vy) < 6));
  for (let tick = 0; tick < 300; tick++) {
    g.step(TICK);
    inBounds(g.getState());
  }
  const restored = game(t, { snapshot: g.snapshot() });
  restored.start();
  assert.equal(restored.shake(), false);
});

test('paused and finished games reject drop/remove/shake/step without changing state', t => {
  for (const phase of ['paused', 'over']) {
    const g = game(t, { snapshot: saved('classic', { phase, fruits: [fruit(1, 4, 220, 500)] }) });
    assert.equal(g.getState().phase, phase);
    const before = g.snapshot();
    assert.equal(g.drop(220), false);
    assert.equal(g.removeAt(220, 500), false);
    assert.equal(g.shake(), false);
    assert.equal(g.step(100_000), false);
    assert.equal(g.pause(), false);
    assert.deepEqual(g.snapshot(), before);
    if (phase === 'over') assert.equal(g.start(), false);
  }
});

test('fixed ticks produce identical physics at different render cadences', t => {
  const snapshot = saved('classic', { fruits: [
    fruit(1, 0, 100, 260, { vx: 2, vy: 1 }),
    fruit(2, 3, 280, 320, { vx: -1 }),
    fruit(3, 6, 220, 540),
  ] });
  const results = [];
  for (const [delta, count] of [[TICK, 120], [TICK / 2, 240], [TICK * 3, 40], [10, 200]]) {
    const g = game(t, { snapshot });
    g.start();
    for (let frame = 0; frame < count; frame++) g.step(delta);
    results.push(g.getState());
  }
  for (const result of results.slice(1)) assert.deepEqual(result, results[0]);
});

test('large frame gaps have bounded catch-up and cannot instantly trigger three-second defeat', t => {
  const g = game(t, { snapshot: saved('classic', { fruits: tower() }) });
  g.start();
  const age = g.snapshot().fruits[0].ageMs;
  assert.equal(g.step(3_600_000), true);
  assert.equal(g.getState().phase, 'playing');
  close(g.getState().dangerMs, TICK * 6);
  close(g.snapshot().fruits[0].ageMs - age, TICK * 6);
});

test('snapshot contains rule clocks, independent copies, and resumes safely paused', t => {
  const original = game(t, { random: () => 0.7 });
  original.start();
  original.drop(180);
  advance(original, 4);
  original.step(3);
  const snapshot = JSON.parse(JSON.stringify(original.snapshot()));
  assert.equal(snapshot.version, 1);
  assert.equal(snapshot.fruits[0].entered, false);
  close(snapshot.fruits[0].ageMs, TICK * 4);
  close(snapshot.fruits[0].graceMs, 1500 - TICK * 4);
  close(snapshot.accumulatorMs, 3);
  const restored = game(t, { snapshot });
  assert.equal(restored.getState().phase, 'paused');
  const state = restored.getState();
  assert.deepEqual({ ...state, phase: 'playing' }, original.getState());
  state.tools.remove = 0;
  state.fruits[0].x = -999;
  snapshot.fruits[0].tier = 10;
  assert.equal(restored.getState().tools.remove, 2);
  assert.equal(restored.getState().fruits[0].tier, 2);
  assert.notEqual(restored.getState().fruits[0].x, -999);
  restored.start();
  advance(original, 15);
  advance(restored, 15);
  const a = original.getState().fruits[0];
  const b = restored.getState().fruits[0];
  for (const name of ['x', 'y', 'vx', 'vy', 'angle', 'angularVelocity']) close(a[name], b[name]);
  for (const phase of ['ready', 'playing', 'paused', 'over']) {
    const g = game(t, { snapshot: saved('classic', { phase }) });
    assert.equal(g.getState().phase, phase === 'over' ? 'over' : 'paused');
  }
});

test('mode-isolated saves never leak scores, fruit, previews or consumed tools', t => {
  for (const [from, to] of [['classic', 'collect'], ['collect', 'classic']]) {
    const g = game(t, { mode: to, snapshot: saved(from, {
      score: 99999, watermelons: 8, current: 4, next: 4, tools: { remove: 0, shake: 0 },
      fruits: [fruit(1, 6, 220, 500)],
    }) });
    assert.deepEqual(g.getState(), {
      mode: to, phase: 'ready', score: 0, watermelons: 0, current: 0, next: 0,
      tools: { remove: 2, shake: 1 }, dangerMs: 0, cooldownMs: 0, fruits: [],
    });
  }
});

test('invalid snapshot envelopes reset to a fresh game instead of crashing', t => {
  const throwing = { get version() { throw new Error('damaged save'); } };
  const invalid = [undefined, null, false, 42, 'not json', [], {}, throwing,
    saved('classic', { version: 2 }), saved('classic', { phase: 'broken' }),
    saved('classic', { current: -1 }), saved('classic', { next: 5 }),
    saved('classic', { current: NaN }), saved('classic', { next: '2' }),
    saved('classic', { fruits: null }), saved('classic', { fruits: {} }),
  ];
  for (const snapshot of invalid) {
    const g = game(t, { snapshot });
    assert.equal(g.getState().phase, 'ready');
    assert.equal(g.getState().score, 0);
    assert.deepEqual(g.getState().fruits, []);
    assert.deepEqual(g.getState().tools, { remove: 2, shake: 1 });
  }
});

test('damaged optional data and fruit are bounded, filtered and repaired without restoring tools', t => {
  const g = game(t, { snapshot: saved('classic', {
    score: -10, watermelons: NaN, dangerMs: -1, cooldownMs: 1e20,
    accumulatorMs: Infinity, collisionCooldownMs: 1e20, nextId: -1,
    tools: { remove: NaN, shake: '1' },
    fruits: [null, 'fruit', fruit(1, -1, 220, 100), fruit(1, 11, 220, 100),
      fruit(1, 1, NaN, 100), fruit(1, 1, 100, Infinity),
      fruit(7, 2, -99999, 99999, { vx: 1e20, vy: -1e20, angle: Infinity, angularVelocity: -999, ageMs: -100, graceMs: 1e20 }),
      fruit(7, 3, 99999, -99999, { vx: NaN, vy: 'bad', angle: 1e20, ageMs: NaN, entered: false, graceMs: 1e20 }),
      fruit(-9, 4, 200, 400, { ageMs: 1490, graceMs: 1000 }),
    ],
  }) });
  const snapshot = g.snapshot();
  assert.equal(snapshot.phase, 'paused');
  assert.equal(snapshot.score, 0);
  assert.equal(snapshot.watermelons, 0);
  assert.equal(snapshot.cooldownMs, 400);
  assert.equal(snapshot.collisionCooldownMs, 140);
  assert.equal(snapshot.accumulatorMs, 0);
  assert.deepEqual(snapshot.tools, { remove: 0, shake: 0 });
  assert.equal(snapshot.fruits.length, 3);
  assert.equal(new Set(snapshot.fruits.map(item => item.id)).size, 3);
  inBounds(snapshot);
  assert.equal(snapshot.fruits[0].angle, 0);
  assert.ok(snapshot.fruits[1].y >= -WORLD.height);
  assert.equal(snapshot.fruits[1].graceMs, 0, 'missing age cannot renew grace');
  assert.equal(snapshot.fruits[2].graceMs, 10);
  assert.doesNotThrow(() => JSON.stringify(snapshot));
  const boosted = game(t, { snapshot: saved('classic', { tools: { remove: 999, shake: 999 } }) });
  assert.deepEqual(boosted.getState().tools, { remove: 2, shake: 1 });
  const capped = game(t, { snapshot: saved('classic', { fruits: Array.from({ length: 1000 }, (_, i) => fruit(i + 1, 0, 220, 400)) }) });
  assert.equal(capped.getState().fruits.length, 256);
});

test('IDs and remaining drop protection survive repeated saves without drifting or refilling', t => {
  let snapshot = saved('classic', {
    nextId: 12, cooldownMs: 75, collisionCooldownMs: 90, accumulatorMs: 5,
    fruits: [fruit(11, 2, 220, 58, { entered: false, ageMs: 800, graceMs: 700 })],
  });
  for (let i = 0; i < 5; i++) {
    const g = game(t, { snapshot });
    const restored = JSON.parse(JSON.stringify(g.snapshot()));
    assert.deepEqual(restored, { ...snapshot, phase: 'paused' });
    snapshot = restored;
  }
  const resumed = game(t, { snapshot });
  resumed.start();
  advance(resumed, 5);
  assert.equal(resumed.drop(300), true);
  assert.deepEqual(resumed.getState().fruits.map(item => item.id), [11, 12]);
  close(resumed.snapshot().fruits[0].graceMs, 700 - TICK * 5);
  const repair = game(t, { snapshot: saved('classic', { nextId: 1, fruits: [fruit(500, 3, 220, 400)] }) });
  repair.start();
  repair.drop(100);
  assert.deepEqual(repair.getState().fruits.map(item => item.id), [500, 501]);
});

test('collect restore discards impossible persisted watermelons without counting them again', t => {
  const g = game(t, { mode: 'collect', snapshot: saved('collect', {
    watermelons: 3, score: 198, fruits: [fruit(1, 10, 220, 500), fruit(2, 4, 320, 500)],
  }) });
  assert.equal(g.getState().watermelons, 3);
  assert.equal(g.getState().score, 198);
  assert.deepEqual(g.getState().fruits.map(item => item.tier), [4]);
});

test('new falling fruit has limited immunity and becomes entered after passing the line', t => {
  const g = game(t);
  g.start();
  g.drop(220);
  advance(g, 10);
  assert.equal(g.snapshot().fruits[0].entered, false);
  assert.equal(g.getState().dangerMs, 0);
  advance(g, 30);
  assert.equal(g.getState().dangerMs, 0);
  assert.ok(g.snapshot().fruits[0].entered);
  assert.ok(g.snapshot().fruits[0].ageMs < 1500);
  assert.equal(g.getState().phase, 'playing');
});

test('falling back below the danger line resets countdown; pause freezes all clocks', t => {
  const g = game(t, { snapshot: saved('classic', { dangerMs: 800, fruits: [fruit(1, 2, 220, 110)] }) });
  g.start();
  g.step(TICK);
  assert.ok(g.getState().dangerMs > 800);
  g.pause();
  const paused = g.snapshot();
  assert.equal(g.step(100_000), false);
  assert.deepEqual(g.snapshot(), paused);
  const restored = game(t, { snapshot: paused });
  close(restored.getState().dangerMs, paused.dangerMs);
  restored.start();
  advance(restored, 120);
  assert.equal(restored.getState().dangerMs, 0);
  assert.equal(restored.getState().phase, 'playing');
});

test('a continuous three-second overflow ends once, including a pause/resume in the middle', t => {
  const events = [];
  const g = game(t, {
    snapshot: saved('classic', { fruits: tower() }),
    onEvent(event) { if (event.type === 'over') events.push({ event, snapshot: g.snapshot() }); },
  });
  g.start();
  advance(g, 90);
  close(g.getState().dangerMs, 1500);
  g.pause();
  g.step(60_000);
  close(g.getState().dangerMs, 1500);
  g.start();
  advance(g, 89);
  assert.equal(g.getState().phase, 'playing');
  g.step(TICK);
  assert.equal(g.getState().phase, 'over');
  assert.equal(g.getState().dangerMs, 3000);
  assert.equal(events.length, 1);
  assert.equal(events[0].snapshot.phase, 'over');
  assert.equal(g.start(), false);
  assert.equal(g.step(TICK), false);
  const restored = game(t, { snapshot: JSON.parse(JSON.stringify(events[0].snapshot)) });
  assert.equal(restored.getState().phase, 'over');
  assert.equal(restored.start(), false);
});

test('unentered fruit trapped above the line cannot stay immune forever', t => {
  const g = game(t, { snapshot: saved('classic', {
    fruits: tower({ entered: false, graceMs: 1500, ageMs: 0 }),
  }) });
  g.start();
  advance(g, 89);
  assert.equal(g.getState().dangerMs, 0);
  advance(g, 181);
  assert.equal(g.getState().phase, 'over');
  assert.equal(g.getState().dangerMs, 3000);
});

test('merging does not renew expired drop grace and removing the last threat resets danger', t => {
  const g = game(t, { snapshot: saved('classic', { fruits: [
    fruit(1, 0, 210, 58, { entered: false, ageMs: 1500, graceMs: 0 }),
    fruit(2, 0, 230, 58, { entered: false, ageMs: 1500, graceMs: 0 }),
  ] }) });
  g.start();
  g.step(TICK);
  assert.equal(g.snapshot().fruits[0].graceMs, 0);
  close(g.getState().dangerMs, TICK);
  const restored = game(t, { snapshot: g.snapshot() });
  restored.start();
  restored.step(TICK);
  close(restored.getState().dangerMs, TICK * 2);
  const target = restored.getState().fruits[0];
  restored.removeAt(target.x, target.y);
  assert.equal(restored.getState().dangerMs, 0);
});

test('no top wall is introduced when restoring a rising fruit', t => {
  const g = game(t, { snapshot: saved('classic', {
    fruits: [fruit(1, 0, 220, -20, { vy: -5, entered: false, graceMs: 1500, ageMs: 0 })],
  }) });
  g.start();
  g.step(TICK);
  assert.ok(g.getState().fruits[0].y < -20);
  assert.equal(g.getState().dangerMs, 0);
});

test('impact sounds are throttled and stationary contact cannot cause a per-frame storm', t => {
  const sounds = [];
  let tick = 0;
  const g = game(t, {
    snapshot: saved('classic', { fruits: [fruit(1, 2, 100, 500, { vy: 10 }), fruit(2, 5, 300, 430, { vy: 8 })] }),
    onEvent(event) { if (event.type === 'collision') sounds.push({ tick, state: g.snapshot() }); },
  });
  g.start();
  for (tick = 0; tick < 300; tick++) g.step(TICK);
  assert.ok(sounds.length > 0, 'a real landing emits impact audio');
  assert.ok(sounds.length < 15);
  for (let i = 1; i < sounds.length; i++) assert.ok((sounds[i].tick - sounds[i - 1].tick) * TICK >= 140);
  assert.ok(sounds.every(sound => sound.state.collisionCooldownMs === 140));
  const previous = sounds.length;
  advance(g, 300);
  assert.equal(sounds.length, previous);
});

test('restored collision throttling suppresses fresh contacts until its saved delay expires', t => {
  for (const delay of [0, 140]) {
    const events = [];
    const g = game(t, {
      snapshot: saved('classic', {
        collisionCooldownMs: delay,
        fruits: [fruit(1, 2, 100, 575, { vy: 5 })],
      }),
      onEvent: event => events.push(event),
    });
    g.start();
    g.step(TICK);
    assert.equal(events.filter(event => event.type === 'collision').length, delay ? 0 : 1);
    if (delay) close(g.snapshot().collisionCooldownMs, delay - TICK);
  }
});

test('observer failures and reentrant step attempts cannot corrupt a committed merge', t => {
  let recursive;
  const g = game(t, {
    snapshot: saved('classic', { fruits: [fruit(1, 0, 210, 350), fruit(2, 0, 230, 350)] }),
    onEvent() { recursive = g.step(TICK); throw new Error('audio unavailable'); },
  });
  g.start();
  assert.doesNotThrow(() => g.step(TICK));
  assert.equal(recursive, false);
  assert.equal(g.getState().score, points(1));
  assert.equal(g.getState().fruits.length, 1);
});

test('a mixed pile settles for twenty seconds without leaking through floor or walls', t => {
  const g = game(t, { snapshot: saved('classic', { fruits: [
    fruit(1, 5, 70, 556), fruit(2, 6, 190, 548), fruit(3, 7, 330, 539),
    fruit(4, 4, 110, 430), fruit(5, 3, 245, 420), fruit(6, 2, 330, 410),
  ] }) });
  g.start();
  g.shake();
  for (let tick = 0; tick < 1200; tick++) {
    g.step(TICK);
    inBounds(g.getState());
  }
  assert.equal(g.getState().phase, 'playing');
  assert.equal(g.getState().fruits.length, 6);
  assert.ok(g.getState().fruits.every(item => Math.hypot(item.vx, item.vy) < 0.1));
  assert.ok(g.getState().fruits.some(item => Math.abs(item.y + FRUITS[item.tier].radius - WORLD.bottom) < 0.5));
});
