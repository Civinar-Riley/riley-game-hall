import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { environment, blockrain, hextris } from './helpers/arcade-harness.mjs';

const key = (env, type, keyCode, extra = {}) => env.ctx.document.body.dispatch(type, { keyCode, ...extra });
const tapKey = (env, keyCode) => {
  key(env, 'keydown', keyCode);
  key(env, 'keyup', keyCode);
};
const pointer = (x = 512, y = 300) => ({ clientX: x, clientY: y, changedTouches: [{ clientX: x, clientY: y }] });
const pieceState = game => ({ x: game._board.cur.x, y: game._board.cur.y, orientation: game._board.cur.orientation });
const held = game => ({ ...game._board.holding });
const released = { left: null, right: null, drop: null };
const controls = [
  [37, 'x', -1], [39, 'x', 1], [40, 'y', 1], [38, 'orientation', -1],
  [65, 'x', -1], [68, 'x', 1], [83, 'y', 1], [87, 'orientation', -1],
  [88, 'orientation', -1], [90, 'orientation', 1]
];
const touchControls = [
  ['Left', 'x', -1], ['Right', 'x', 1], ['Drop', 'y', 1],
  ['RotateLeft', 'orientation', 1], ['RotateRight', 'orientation', -1]
];
function assertMovement(before, after, field, delta) {
  assert.equal(after[field], field === 'orientation' ? (before[field] + delta + 4) % 4 : before[field] + delta);
}
function assertRush(env, expected) {
  assert.equal(env.ctx.rush, expected);
  assert.equal(env.ctx.settings.speedUpKeyHeld, expected === 4);
}
function startHextris(ua = 'Desktop') {
  const env = hextris(ua);
  env.element('startBtn').dispatch(ua === 'Desktop' ? 'mousedown' : 'touchstart', pointer());
  env.advanceTime(100);
  assert.equal(env.ctx.gameState, 1);
  return env;
}
const hexState = env => ({
  position: env.ctx.MainHex.position, targetAngle: env.ctx.MainHex.targetAngle,
  gameState: env.ctx.gameState, rush: env.ctx.rush
});

// Each path drives the real input handlers, not copies of movement/game rules.
test('Blockrain: pause blocks every gameplay key; resume and restart restore controls', () => {
  const env = blockrain(0);
  const { game } = env;
  env.advanceTime(1500);
  game.pause();
  const paused = pieceState(game);
  for (const [keyCode] of controls) {
    tapKey(env, keyCode);
    assert.deepEqual(pieceState(game), paused, `Paused key ${keyCode}`);
    assert.deepEqual(held(game), released);
  }
  env.advanceTime(1000);
  assert.deepEqual(pieceState(game), paused);

  for (const transition of [() => game.resume(), () => { game.pause(); game.restart(); }]) {
    transition();
    assert.equal(game._board.paused, false);
    assert.equal(game._board.gameover, false);
    for (const [keyCode, field, delta] of controls) {
      const before = pieceState(game);
      tapKey(env, keyCode);
      assertMovement(before, pieceState(game), field, delta);
    }
  }
});

test('Blockrain: pause and restart discard held keys, including releases while paused', () => {
  const env = blockrain(0);
  const { game } = env;
  env.advanceTime(1500);
  key(env, 'keydown', 37);
  key(env, 'keydown', 40);
  assert(game._board.holding.left && game._board.holding.drop);
  game.pause();
  assert.deepEqual(held(game), released);
  const paused = pieceState(game);
  key(env, 'keydown', 39, { repeat: true });
  key(env, 'keyup', 37);
  key(env, 'keyup', 40);
  assert.deepEqual(pieceState(game), paused);
  assert.deepEqual(held(game), released);
  env.advanceTime(1000);
  game.resume();
  env.advanceTime(250);
  assert.equal(game._board.cur.x, paused.x, 'No stale horizontal repeat after resume');
  assert.equal(game._board.cur.y, paused.y + 1, 'Only normal gravity resumes');
  key(env, 'keydown', 37);
  key(env, 'keydown', 40);
  game.restart();
  assert.deepEqual(held(game), released);
  assert.equal(game._board.paused, false);
  const restarted = pieceState(game);
  env.advanceTime(250);
  assert.equal(game._board.cur.x, restarted.x);
  key(env, 'keyup', 37);
  key(env, 'keyup', 40);
  tapKey(env, 39);
  assert.equal(game._board.cur.x, restarted.x + 1);
});

for (const input of ['touchstart', 'click']) {
  test(`Blockrain: ${input} controls obey pause, resume and restart`, () => {
    const env = blockrain(0);
    const { game } = env;
    env.advanceTime(1500);
    game.pause();
    const paused = pieceState(game);
    for (const [name] of touchControls) {
      env.element(`touch${name}`).dispatch(input, pointer());
      env.element(`touch${name}`).dispatch('touchend', pointer());
      assert.deepEqual(pieceState(game), paused);
      assert.deepEqual(held(game), released);
    }
    for (const transition of [() => game.resume(), () => { game.pause(); game.restart(); }]) {
      transition();
      assert.equal(game._board.paused, false);
      for (const [name, field, delta] of touchControls) {
        const before = pieceState(game);
        env.element(`touch${name}`).dispatch(input, pointer());
        env.element(`touch${name}`).dispatch('touchend', pointer());
        assertMovement(before, pieceState(game), field, delta);
        assert.deepEqual(held(game), released);
      }
    }
  });
}

test('Blockrain: a held touch cannot leak into resume or restart', () => {
  const env = blockrain(0);
  const { game } = env;
  env.advanceTime(1500);
  env.element('touchLeft').dispatch('touchstart', pointer());
  env.element('touchDrop').dispatch('touchstart', pointer());
  game.pause();
  assert.deepEqual(held(game), released);
  const paused = pieceState(game);
  env.advanceTime(1000);
  game.resume();
  env.advanceTime(250);
  assert.equal(game._board.cur.x, paused.x);
  assert.equal(game._board.cur.y, paused.y + 1);
  env.element('touchRight').dispatch('touchstart', pointer());
  game.pause();
  game.restart();
  assert.deepEqual(held(game), released);
  const restarted = pieceState(game);
  env.advanceTime(250);
  assert.equal(game._board.cur.x, restarted.x);
  env.element('touchLeft').dispatch('touchend', pointer());
  env.element('touchRight').dispatch('touchend', pointer());
  env.element('touchDrop').dispatch('touchend', pointer());
  assert.deepEqual(held(game), released);
});

function lockPiece(env) {
  const shape = env.game._board.cur;
  for (let tick = 0; tick < 200 && env.game._board.cur === shape; tick++) assert(env.next());
  assert.notEqual(env.game._board.cur, shape, 'Piece should lock within 200 ticks');
  return Array.from({ length: shape.blocksLen / 2 }, (_, i) => ({
    x: shape.x + shape.getBlocks()[2 * i], y: shape.y + shape.getBlocks()[2 * i + 1]
  }));
}

for (const input of ['keyboard', 'touch']) {
  test(`Blockrain: reachable six-I-piece top-out uses Y coordinates (${input})`, () => {
    const env = blockrain(0);
    const { game, trace } = env;
    const locks = [];
    // No filled cells, positions or orientations are injected. Use the real RNG
    // picker (fixed to I), input rotation and scheduled gravity for all six locks.
    for (let piece = 0; piece < 6; piece++) {
      assert.equal(game._board.cur.blockType, 'line');
      if (piece === 4) {
        if (input === 'keyboard') tapKey(env, 38);
        else env.element('touchRotateRight').dispatch('touchstart', pointer());
      }
      locks.push(lockPiece(env));
      if (piece < 5) assert.equal(game._board.gameover, false, 'In-bounds locks must stay playable');
    }
    assert(locks.slice(0, 5).flat().every(cell => cell.y >= 0));
    assert(locks[5].some(cell => cell.y < 0));
    assert.equal(game._board.gameover, true);
    assert.equal(trace.filter(event => event[0] === 'over').length, 1);
    assert.equal(trace.filter(event => event[0] === 'place').length, 6);
    assert.equal(env.next(), false, 'Top-out must stop the gravity timer');
    const over = pieceState(game);
    tapKey(env, 37);
    env.element('touchDrop').dispatch('touchstart', pointer());
    assert.deepEqual(pieceState(game), over, 'Game-over pieces must not respond');
    game.restart();
    assert.equal(game._board.gameover, false);
    assert.equal(game._board.paused, false);
    assert.deepEqual(held(game), released);
    tapKey(env, 39);
    assert.equal(game._board.cur.x, 5);
    assert(env.next(), 'Restart must schedule gravity again');
  });
}

test('Blockrain: locking exactly on row zero is not a top-out', () => {
  const env = blockrain(0);
  let lastLock;
  for (let piece = 0; piece < 5; piece++) {
    lastLock = lockPiece(env);
    assert.equal(env.game._board.gameover, false);
  }
  assert.equal(Math.min(...lastLock.map(cell => cell.y)), 0);
  assert.equal(env.trace.filter(event => event[0] === 'over').length, 0);
});

for (const ua of ['Desktop', 'Android']) {
  test(`Hextris: sound pointer events are isolated without cancelling click (${ua})`, () => {
    const env = hextris(ua);
    const input = ua === 'Desktop' ? 'mousedown' : 'touchstart';
    function toggleSound() {
      const before = hexState(env);
      const enabled = env.ctx.SFX.enabled;
      const writes = env.writes.filter(([key]) => key === 'hex_sound').length;
      for (const type of ['touchstart', 'mousedown']) {
        const event = env.element('sfxbtn').dispatch(type, pointer(1000, 28));
        assert.equal(event.defaultPrevented, false, 'Do not suppress touch-generated/keyboard click');
        assert.equal(env.ctx.SFX.enabled, enabled, 'Only click should toggle sound');
        assert.deepEqual(hexState(env), before);
      }
      env.element('sfxbtn').dispatch('click', pointer(1000, 28));
      assert.equal(env.ctx.SFX.enabled, !enabled);
      assert.equal(env.memory.get('hex_sound'), enabled ? 'off' : 'on');
      assert.equal(env.writes.filter(([key]) => key === 'hex_sound').length, writes + 1);
      assert.deepEqual(hexState(env), before);
    }
    toggleSound(); // Start screen must not start a game.
    assert.equal(env.ctx.gameState, 0);
    env.element('startBtn').dispatch(input, pointer());
    env.advanceTime(100);
    assert.equal(env.ctx.gameState, 1);
    toggleSound();
    const before = hexState(env);
    env.element('canvas').dispatch(input, pointer(1000, 300));
    assert.equal(env.ctx.MainHex.targetAngle, before.targetAngle + 60, 'Playfield still rotates');
    env.advanceTime(100);
    env.element('pauseBtn').dispatch(input, pointer());
    assert.equal(env.ctx.gameState, -1);
    toggleSound();
    const paused = hexState(env);
    env.element('canvas').dispatch(input, pointer(1000, 300));
    assert.deepEqual(hexState(env), paused);
    env.advanceTime(400);
    env.element('pauseBtn').dispatch(input, pointer());
    env.advanceTime(400);
    assert.equal(env.ctx.gameState, 1);
    toggleSound();
    const resumed = hexState(env);
    env.element('canvas').dispatch(input, pointer(100, 300));
    assert.equal(env.ctx.MainHex.targetAngle, resumed.targetAngle - 60);
    env.element('restartBtn').dispatch(input, pointer());
    env.advanceTime(100);
    toggleSound();
    const enabled = env.ctx.SFX.enabled;
    env.element('sfxbtn').dispatch('click'); // Keyboard-generated button activation.
    assert.equal(env.ctx.SFX.enabled, !enabled);
    key(env, 'keydown', 77, { key: 'm' });
    key(env, 'keyup', 77, { key: 'm' });
    assert.equal(env.ctx.SFX.enabled, enabled, 'M shortcut is unchanged');
  });
}

for (const press of [[40, 83], [83, 40]]) {
  for (const release of [[40, 83], [83, 40]]) {
    test(`Hextris: overlapping speed keys ${press} / release ${release} stay at 4x until both release`, () => {
      const env = startHextris();
      const baseSpeed = env.ctx.settings.speedModifier;
      assertRush(env, 1);
      for (const code of press) { key(env, 'keydown', code); assertRush(env, 4); }
      for (const code of press) { key(env, 'keydown', code, { repeat: true }); assertRush(env, 4); }
      key(env, 'keyup', release[0]);
      assertRush(env, 4);
      key(env, 'keydown', release[1], { repeat: true });
      assertRush(env, 4);
      key(env, 'keyup', release[1]);
      assertRush(env, 1);
      for (const code of release) { key(env, 'keyup', code); assertRush(env, 1); }
      env.ctx.init(1);
      assertRush(env, 1);
      assert.equal(env.ctx.settings.speedModifier, baseSpeed);
    });
  }
}

for (const code of [40, 83]) {
  test(`Hextris: single speed key ${code} still accelerates once`, () => {
    const env = startHextris();
    key(env, 'keydown', code);
    assertRush(env, 4);
    key(env, 'keydown', code, { repeat: true });
    assertRush(env, 4);
    key(env, 'keyup', code);
    assertRush(env, 1);
  });
}

for (const ua of ['Desktop', 'Android']) {
  test(`Hextris: speed state is cleared by pause, restart and late keyup (${ua})`, () => {
    const env = hextris(ua);
    const input = ua === 'Desktop' ? 'mousedown' : 'touchstart';
    for (const code of [40, 83]) { tapKey(env, code); assertRush(env, 1); }
    env.element('startBtn').dispatch(input, pointer());
    env.advanceTime(100);
    const pauseOrResume = () => ua === 'Desktop'
      ? tapKey(env, 80) : env.element('pauseBtn').dispatch('touchstart', pointer());
    for (const code of [40, 83]) key(env, 'keydown', code);
    assertRush(env, 4);
    pauseOrResume();
    assert.equal(env.ctx.gameState, -1);
    assertRush(env, 1);
    for (const code of [40, 83]) {
      key(env, 'keydown', code, { repeat: true });
      assertRush(env, 1);
      key(env, 'keyup', code);
      assertRush(env, 1);
    }
    env.advanceTime(400);
    pauseOrResume();
    env.advanceTime(400);
    assert.equal(env.ctx.gameState, 1);
    assertRush(env, 1);
    for (const code of [40, 83]) key(env, 'keydown', code);
    assertRush(env, 4);
    if (ua === 'Desktop') tapKey(env, 13);
    else env.element('restartBtn').dispatch('touchstart', pointer());
    assert.equal(env.ctx.gameState, 1);
    assertRush(env, 1);
    for (const code of [40, 83]) { key(env, 'keyup', code); assertRush(env, 1); }
    key(env, 'keydown', 40);
    assertRush(env, 4);
    key(env, 'keyup', 40);
    assertRush(env, 1);
    pauseOrResume();
    env.advanceTime(400);
    env.element('restartBtn').dispatch(input, pointer());
    assert.equal(env.ctx.gameState, 1);
    assertRush(env, 1);
  });
}

test('Hextris: the original down/S sequence finishes and restarts at normal speed', () => {
  const env = startHextris();
  for (const [type, code] of [['keydown', 40], ['keydown', 83], ['keyup', 40], ['keyup', 83]]) {
    key(env, type, code);
  }
  assertRush(env, 1);
  env.ctx.init(1);
  assertRush(env, 1);
});

test('Hextris: window blur clears overlapping speed keys before resuming', () => {
  const env = startHextris();
  key(env, 'keydown', 40);
  key(env, 'keydown', 83);
  assertRush(env, 4);
  env.ctx.dispatch('blur');
  assert.equal(env.ctx.gameState, -1);
  assertRush(env, 1);
  for (const code of [40, 83]) key(env, 'keyup', code);
  env.advanceTime(400);
  tapKey(env, 80);
  env.advanceTime(400);
  assertRush(env, 1);
  key(env, 'keydown', 83);
  assertRush(env, 4);
  key(env, 'keyup', 83);
  assertRush(env, 1);
});

for (const ua of ['Desktop', 'Android']) {
  test(`Hextris: natural game-over resets rush and restart ignores old releases (${ua})`, () => {
    const env = startHextris(ua);
    key(env, 'keydown', 40);
    key(env, 'keydown', 83);
    assertRush(env, 4);
    // Advance the actual renderer/update loop; no blocks or game-state values
    // are injected to manufacture the game-over condition.
    for (let frame = 0; frame < 6000 && env.ctx.gameState === 1; frame++) {
      env.advanceTime(16);
      env.ctx.animLoop();
    }
    assert.equal(env.ctx.gameState, 2, 'Unrotated real waves eventually overflow');
    assertRush(env, 1);
    for (const code of [40, 83]) { key(env, 'keyup', code); assertRush(env, 1); }
    for (const code of [40, 83]) { key(env, 'keydown', code); assertRush(env, 1); }
    env.advanceTime(200);
    if (ua === 'Desktop') tapKey(env, 13);
    else env.element('restart').dispatch('touchstart', pointer());
    assert.equal(env.ctx.gameState, 1);
    assertRush(env, 1);
    for (const code of [40, 83]) { key(env, 'keyup', code); assertRush(env, 1); }
    key(env, 'keydown', 83);
    assertRush(env, 4);
    key(env, 'keyup', 83);
    assertRush(env, 1);
  });
}

// Preserve the audit's 18 real ZzFX sample checks without any old payout-bug
// assertion. Stub only Web Audio delivery; synthesis itself is unchanged.
for (const [name, count] of [['blockrain', 7], ['hextris', 3], ['zhajinhua', 8]]) {
  test(`${name}: all ${count} audio presets are finite, playable and respect mute`, () => {
    const env = environment();
    const html = fs.readFileSync(new URL(`../public/games/${name}.html`, import.meta.url), 'utf8');
    const all = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
    const script = all.find(source => source.includes('var ZZFX ='));
    assert(script, `${name}: sound script is missing`);
    const end = name === 'blockrain' ? script.indexOf('var $board =') : name === 'zhajinhua' ? script.indexOf('function newDeck') : script.length;
    const start = script.indexOf('var ZZFX =');
    assert(end > start);
    let starts = 0, resumes = 0;
    class AudioContext {
      constructor() { this.state = 'suspended'; this.destination = {}; }
      resume() { resumes++; this.state = 'running'; return Promise.resolve(); }
      createBuffer(channels, length) { return { getChannelData() { return new Float32Array(length); } }; }
      createBufferSource() { return { playbackRate: {}, connect() { return { connect() {} }; }, start() { starts++; } }; }
      createGain() { return { gain: {}, connect() {} }; }
    }
    env.ctx.AudioContext = AudioContext;
    env.ctx.StereoPannerNode = class {};
    env.run(script.slice(start, end), `${name}-audio.js`);
    const presets = Object.entries(env.ctx.ZS);
    assert.equal(presets.length, count);
    for (const [key, params] of presets) {
      const samples = env.ctx.ZZFX.buildSamples(...params);
      assert(samples.length > 0 && samples.every(Number.isFinite), `${name}/${key}: finite samples`);
      env.ctx.SFX.play(key);
    }
    assert.equal(starts, count);
    assert.equal(resumes, 1);
    env.ctx.SFX.toggle();
    env.ctx.SFX.play(presets[0][0]);
    assert.equal(starts, count);
    env.ctx.SFX.toggle();
    env.ctx.SFX.play(presets[0][0]);
    assert.equal(starts, count + 1);
  });
}
