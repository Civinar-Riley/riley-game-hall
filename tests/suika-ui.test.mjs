import assert from 'node:assert/strict';
import test from 'node:test';
import { FRUITS, WORLD } from '../src/games/suika/core.js';
import { emptyBook, SAVE_KEY } from '../src/games/suika/storage.js';
import { bootSuika, fruit, memoryStorage, savedGame } from './helpers/suika-ui-harness.mjs';

function savedBook({ mode = 'classic', classic, collect, records, muted = false, theme = null } = {}) {
  const book = emptyBook();
  book.mode = mode;
  book.muted = muted;
  book.theme = theme;
  if (classic) book.games.classic = savedGame('classic', classic);
  if (collect) book.games.collect = savedGame('collect', collect);
  if (records) Object.assign(book.records, records);
  return book;
}

function playing(t, options = {}) {
  const h = bootSuika(t, options);
  h.click('startButton');
  assert.equal(h.state().phase, 'playing');
  assert.equal(h.document.activeElement, h.canvas);
  return h;
}

const dropEvents = h => h.sound.events.filter(event => event.type === 'drop');
const paused = snapshot => ({ ...snapshot, phase: 'paused' });
const occupiedBook = () => savedBook({ classic: {
  score: 37, current: 4, next: 2,
  fruits: [fruit(1, 3, 110, 500), fruit(2, 5, 320, 500)],
} });

// Input travels through the unchanged main.js listeners, never direct core actions.
test('suika UI: touch down/move only aim; release drops once at scaled canvas coordinates', t => {
  const h = playing(t, { book: savedBook({ classic: { current: 4, next: 2 } }) });
  const before = h.snapshot();
  const writes = h.storage.writes.length;
  const down = h.pointer('pointerdown', { x: 100, y: 80 });
  assert.equal(down.defaultPrevented, true);
  assert.equal(h.canvas.hasPointerCapture(1), true);
  assert.deepEqual(h.snapshot(), before);
  h.pointer('pointermove', { x: 280, y: 200 });
  assert.deepEqual(h.snapshot(), before);
  assert.equal(h.storage.writes.length, writes, 'Aiming does not persist a drop');
  assert.equal(dropEvents(h).length, 0);

  h.pointer('pointerup', { x: 350, y: 260 });
  const state = h.state();
  assert.equal(state.fruits.length, 1);
  assert.equal(state.fruits[0].x, 350);
  assert.equal(state.fruits[0].y, WORLD.spawnY);
  assert.equal(state.fruits[0].tier, before.current);
  assert.equal(state.current, before.next);
  assert.equal(dropEvents(h).length, 1);
  assert.equal(h.canvas.hasPointerCapture(1), false);
  assert.deepEqual(h.saved().games.classic, h.snapshot());

  // Wait out the real core cooldown so it cannot mask a duplicate UI action.
  h.clock.advance(500);
  const released = h.snapshot();
  h.pointer('pointerup', { x: 100 });
  h.canvas.dispatch('click');
  assert.deepEqual(h.snapshot(), released);
  assert.equal(dropEvents(h).length, 1);
});

for (const ending of ['pointercancel', 'lostpointercapture']) {
  test(`suika UI: ${ending} discards a held touch and its late release`, t => {
    const h = playing(t);
    const before = h.snapshot();
    h.pointer('pointerdown', { pointerId: 7, x: 100 });
    h.pointer('pointermove', { pointerId: 7, x: 300 });
    h.pointer(ending, { pointerId: 7 });
    h.pointer('pointerup', { pointerId: 7, x: 300 });
    assert.deepEqual(h.snapshot(), before);
    assert.equal(dropEvents(h).length, 0);
    assert.equal(h.canvas.hasPointerCapture(7), false);
    h.tap({ pointerId: 8, x: 170 });
    assert.equal(h.state().fruits.length, 1, 'A later gesture still works');
    assert.equal(h.state().fruits[0].x, 170);
  });
}

test('suika UI: orphan, non-primary and non-left-button pointers never drop', t => {
  const h = playing(t);
  const before = h.snapshot();
  h.pointer('pointerup', { pointerId: 9 });
  for (const init of [
    { pointerId: 2, isPrimary: false },
    { pointerId: 3, pointerType: 'mouse', button: 1 },
    { pointerId: 4, pointerType: 'mouse', button: 2 },
  ]) {
    const down = h.pointer('pointerdown', init);
    assert.equal(down.defaultPrevented, false);
    assert.equal(h.canvas.hasPointerCapture(init.pointerId), init.pointerType !== 'mouse',
      'Ignored touches still receive browser implicit capture');
    h.pointer('pointermove', { ...init, x: 300 });
    h.pointer('pointerup', init);
    assert.equal(h.canvas.hasPointerCapture(init.pointerId), false);
    assert.deepEqual(h.snapshot(), before);
  }
  assert.equal(dropEvents(h).length, 0);
  h.tap({ pointerId: 5, pointerType: 'mouse', x: 150 });
  assert.equal(h.state().fruits.length, 1, 'Primary mouse input remains usable');
});

test('suika UI: second fingers cannot steal or release the primary touch', t => {
  const h = playing(t);
  const before = h.snapshot();
  h.pointer('pointerdown', { pointerId: 10, x: 100 });
  h.pointer('pointerdown', { pointerId: 11, isPrimary: false, x: 350 });
  h.pointer('pointermove', { pointerId: 11, isPrimary: false, x: 390 });
  h.pointer('pointerup', { pointerId: 11, isPrimary: false, x: 390 });
  h.pointer('pointerup', { pointerId: 12, x: 400 });
  assert.deepEqual(h.snapshot(), before);
  assert.equal(h.canvas.hasPointerCapture(10), true);
  h.pointer('pointermove', { pointerId: 10, x: 160 });
  h.pointer('pointerup', { pointerId: 10, x: 160 });
  assert.equal(h.state().fruits.length, 1);
  assert.equal(h.state().fruits[0].x, 160);
  h.clock.advance(500);
  const released = h.snapshot();
  h.pointer('pointerup', { pointerId: 11, isPrimary: false });
  assert.deepEqual(h.snapshot(), released);
  assert.equal(dropEvents(h).length, 1);
});

for (const ending of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  test(`suika UI: secondary ${ending} and implicit capture loss cannot cancel the primary gesture`, t => {
    const h = playing(t);
    const before = h.snapshot();
    const lost = [];
    h.canvas.addEventListener('lostpointercapture', event => {
      lost.push({ pointerId: event.pointerId, isPrimary: event.isPrimary });
    });
    h.pointer('pointerdown', { pointerId: 31, x: 100 });
    h.pointer('pointerdown', { pointerId: 32, isPrimary: false, x: 350 });
    assert.equal(h.canvas.hasPointerCapture(31), true);
    assert.equal(h.canvas.hasPointerCapture(32), true, 'Secondary touch receives implicit capture');
    h.pointer(ending, { pointerId: 32, isPrimary: false, x: 350 });
    assert.deepEqual(lost, [{ pointerId: 32, isPrimary: false }]);
    assert.equal(h.canvas.hasPointerCapture(32), false);
    assert.equal(h.canvas.hasPointerCapture(31), true);
    assert.deepEqual(h.snapshot(), before, 'The secondary ending must not drop');

    h.pointer('pointermove', { pointerId: 31, x: 170 });
    h.clock.frame();
    assert.equal(h.renderer.renders.at(-1).options.aimX, 170,
      'The primary touch must still control aiming after secondary capture loss');
    h.pointer('pointerup', { pointerId: 31, x: 170 });
    assert.equal(h.state().fruits.length, 1);
    assert.equal(h.state().fruits[0].x, 170);
    assert.equal(dropEvents(h).length, 1);
    assert.equal(h.canvas.hasPointerCapture(31), false);
    assert.deepEqual(lost, [{ pointerId: 32, isPrimary: false }, { pointerId: 31, isPrimary: true }]);
  });
}

test('suika UI: captured releases outside any canvas edge do not drop', t => {
  const h = playing(t);
  const before = h.snapshot();
  for (const point of [{ x: -1 }, { x: WORLD.width + 1 }, { y: -1 }, { y: WORLD.height + 1 }]) {
    h.pointer('pointerdown');
    h.pointer('pointermove', point);
    h.pointer('pointerup', point);
    assert.deepEqual(h.snapshot(), before);
    assert.equal(h.canvas.hasPointerCapture(1), false);
  }
  h.tap({ x: 0 });
  assert.equal(h.state().fruits.length, 1);
  assert.equal(h.state().fruits[0].x, WORLD.left + FRUITS[before.current].radius);
});

test('suika UI: remove hit spends one tool only on release and never also drops', t => {
  const h = playing(t, { book: occupiedBook() });
  const before = h.snapshot();
  h.click('removeButton');
  assert.equal(h.node('removeButton').getAttribute('aria-pressed'), 'true');
  assert.equal(h.node('removeHint').hidden, false);
  h.pointer('pointerdown', { x: 110, y: 500 });
  h.pointer('pointermove', { x: 110, y: 500 });
  assert.deepEqual(h.snapshot(), before);
  h.pointer('pointerup', { x: 110, y: 500 });
  const state = h.state();
  assert.deepEqual(state.fruits.map(item => item.id), [2]);
  assert.equal(state.tools.remove, before.tools.remove - 1);
  assert.equal(state.score, before.score);
  assert.equal(state.current, before.current);
  assert.equal(state.next, before.next);
  assert.equal(state.cooldownMs, before.cooldownMs);
  assert.equal(dropEvents(h).length, 0);
  assert.equal(h.sound.events.filter(event => event.type === 'remove').length, 1);
  assert.equal(h.node('removeCount').textContent, '1');
  assert.equal(h.node('removeButton').getAttribute('aria-pressed'), 'false');
  assert.equal(h.node('removeHint').hidden, true);
  assert.deepEqual(h.saved().games.classic, h.snapshot());
  h.tap({ x: 220, y: 100 });
  assert.equal(h.state().fruits.length, 2, 'Successful removal exits tool mode');
  assert.equal(dropEvents(h).length, 1);
});

test('suika UI: remove misses and cancelled touches keep both fruit and remaining uses', t => {
  const h = playing(t, { book: occupiedBook() });
  const before = h.snapshot();
  h.click('removeButton');
  h.tap({ x: 220, y: 200 });
  assert.deepEqual(h.snapshot(), before);
  assert.equal(h.node('removeButton').getAttribute('aria-pressed'), 'true');
  assert.equal(h.node('removeHint').hidden, false);
  assert.equal(h.node('removeCount').textContent, '2');
  assert.match(h.node('toast').textContent, /不会浪费次数/);
  h.pointer('pointerdown', { pointerId: 7, x: 110, y: 500 });
  h.pointer('pointercancel', { pointerId: 7 });
  h.pointer('pointerup', { pointerId: 7, x: 110, y: 500 });
  assert.deepEqual(h.snapshot(), before);
  assert.equal(dropEvents(h).length, 0);
  h.tap({ x: 320, y: 500 });
  assert.deepEqual(h.state().fruits.map(item => item.id), [1]);
  assert.equal(h.state().tools.remove, 1);
  assert.equal(dropEvents(h).length, 0);
});

test('suika UI: toggling remove off and clicking disabled empty-board tools spend nothing', t => {
  const h = playing(t, { book: occupiedBook() });
  const before = h.snapshot();
  h.click('removeButton');
  h.click('removeButton');
  assert.deepEqual(h.snapshot(), before);
  assert.equal(h.node('removeHint').hidden, true);
  const empty = playing(t);
  assert.equal(empty.node('removeButton').disabled, true);
  assert.equal(empty.node('shakeButton').disabled, true);
  const initial = empty.snapshot();
  empty.click('removeButton');
  empty.click('shakeButton');
  assert.deepEqual(empty.snapshot(), initial);
});

test('suika UI: mode switches and reload preserve separate progress, tools, previews and records paused', t => {
  const book = savedBook({
    classic: { score: 17, watermelons: 1, current: 4, next: 2, tools: { remove: 1, shake: 0 }, fruits: [fruit(1, 3, 100, 500)] },
    collect: { score: 53, watermelons: 4, current: 1, next: 4, tools: { remove: 0, shake: 1 }, fruits: [fruit(2, 6, 300, 500)] },
    records: { classic: { score: 70, watermelons: 2 }, collect: { score: 20, watermelons: 6 } },
  });
  const h = playing(t, { book });
  assert.equal(h.node('bestScore').textContent, '70');
  h.tap({ x: 210 });
  const classic = paused(h.snapshot());
  h.click('collectMode');
  assert.equal(h.state().mode, 'collect');
  assert.equal(h.state().phase, 'paused');
  assert.equal(h.state().score, 53);
  assert.deepEqual(h.state().tools, { remove: 0, shake: 1 });
  assert.equal(h.state().current, 1);
  assert.equal(h.state().next, 4);
  assert.equal(h.node('bestScore').textContent, '53');
  assert.equal(h.node('bestHarvest').textContent, '单局最多 6 颗');
  assert.equal(h.node('collectMode').getAttribute('aria-pressed'), 'true');
  assert.equal(h.node('classicMode').getAttribute('aria-pressed'), 'false');
  assert.deepEqual(h.saved().games.classic, classic);
  h.click('startButton');
  h.tap({ x: 140 });
  const collect = paused(h.snapshot());
  h.click('classicMode');
  assert.deepEqual(h.snapshot(), classic);
  assert.equal(h.node('score').textContent, '17');
  assert.equal(h.node('bestScore').textContent, '70');
  assert.equal(h.node('removeCount').textContent, '1');
  assert.equal(h.node('shakeCount').textContent, '0');
  h.clock.advance(1000);
  assert.deepEqual(h.snapshot(), classic, 'Returning never resumes physics');
  h.click('collectMode');
  assert.deepEqual(h.snapshot(), collect);
  const expectedRecords = { classic: { score: 70, watermelons: 2 }, collect: { score: 53, watermelons: 6 } };
  assert.deepEqual(h.saved().records, expectedRecords);
  assert.deepEqual(h.saved().games, { classic, collect });
  const reloaded = bootSuika(t, { storage: h.storage });
  assert.deepEqual(reloaded.snapshot(), collect);
  assert.equal(reloaded.node('gameOverlay').hidden, false);
  assert.equal(reloaded.node('bestScore').textContent, '53');
  reloaded.click('classicMode');
  assert.deepEqual(reloaded.snapshot(), classic);
  assert.deepEqual(reloaded.saved().records, expectedRecords);
});

test('suika UI: an unplayed mode starts fresh without erasing the existing mode', t => {
  const h = playing(t, { book: occupiedBook() });
  const classic = paused(h.snapshot());
  h.pointer('pointerdown');
  h.click('collectMode');
  assert.equal(h.state().mode, 'collect');
  assert.equal(h.state().phase, 'ready');
  assert.equal(h.state().score, 0);
  assert.deepEqual(h.state().fruits, []);
  assert.deepEqual(h.state().tools, { remove: 2, shake: 1 });
  h.click('startButton');
  h.pointer('pointerup');
  assert.deepEqual(h.state().fruits, [], 'Old mode gesture cannot drop in the new mode');
  h.click('classicMode');
  assert.deepEqual(h.snapshot(), classic);
  assert.equal(h.saved().records.classic.score, classic.score);
  assert.equal(h.saved().records.collect.score, 0);
});

for (const mode of ['classic', 'collect']) {
  test(`suika UI: a real ${mode} merge refreshes HUD and persists records before the autosave interval`, t => {
    const book = savedBook({ mode, [mode]: {
      score: 10, fruits: [fruit(1, 9, 150, 470), fruit(2, 9, 290, 470)],
    } });
    const h = playing(t, { book });
    const writes = h.storage.writes.length;
    h.clock.frame();
    h.clock.frame();
    const state = h.state();
    assert.ok(state.score > 10);
    assert.equal(state.watermelons, 1);
    assert.equal(state.fruits.length, mode === 'classic' ? 1 : 0);
    assert.equal(h.node('score').textContent, String(state.score));
    assert.equal(h.node('bestScore').textContent, String(state.score));
    assert.equal(h.node('watermelons').textContent, '1');
    assert.equal(h.storage.writes.length, writes + 1);
    assert.deepEqual(h.saved().games[mode], h.snapshot());
    assert.deepEqual(h.saved().records[mode], { score: state.score, watermelons: 1 });
    assert.equal(h.renderer.bursts.filter(event => event.type === 'merge').length, 1);
  });
}

test('suika UI: mode switches clear old effects while same-mode selection keeps the current scene', t => {
  const h = playing(t, { book: occupiedBook() });
  h.click('removeButton');
  h.tap({ x: 110, y: 500 });
  assert.deepEqual(h.renderer.effects.map(event => event.type), ['remove']);
  const initialClears = h.renderer.clearEffectsCalls;
  h.click('classicMode');
  assert.equal(h.renderer.clearEffectsCalls, initialClears, 'Selecting the current mode is not a new scene');
  assert.equal(h.renderer.effects.length, 1);
  h.click('collectMode');
  assert.equal(h.renderer.clearEffectsCalls, initialClears + 1);
  assert.deepEqual(h.renderer.effects, []);
  h.click('startButton');
  h.tap({ x: 180 });
  assert.ok(h.renderer.effects.length > 0, 'The new scene can create its own effects');
  h.click('classicMode');
  assert.equal(h.renderer.clearEffectsCalls, initialClears + 2);
  assert.deepEqual(h.renderer.effects, []);
  assert.equal(h.state().phase, 'paused');
  assert.deepEqual(h.state().fruits.map(item => item.id), [2]);
});

test('suika UI: only confirmed restart clears old effects, not opening or cancelling confirmation', t => {
  const h = playing(t, { book: occupiedBook() });
  h.click('removeButton');
  h.tap({ x: 110, y: 500 });
  const effects = [...h.renderer.effects];
  const initialClears = h.renderer.clearEffectsCalls;
  assert.deepEqual(effects.map(event => event.type), ['remove']);
  h.click('restartButton');
  assert.equal(h.renderer.clearEffectsCalls, initialClears);
  assert.deepEqual(h.renderer.effects, effects);
  h.click('cancelRestart');
  assert.equal(h.renderer.clearEffectsCalls, initialClears);
  assert.deepEqual(h.renderer.effects, effects);
  assert.equal(h.state().phase, 'paused');
  h.click('restartButton');
  h.click('confirmRestart');
  assert.equal(h.renderer.clearEffectsCalls, initialClears + 1);
  assert.deepEqual(h.renderer.effects, []);
  assert.equal(h.state().phase, 'playing');
  assert.deepEqual(h.state().fruits, []);
  h.tap({ x: 220 });
  assert.equal(h.renderer.effects.at(-1).type, 'drop', 'Effects still work after clearing');
});

test('suika UI: pause saves, freezes frames and rejects held releases until explicit resume', t => {
  const h = playing(t, { book: occupiedBook() });
  h.click('removeButton');
  h.pointer('pointerdown', { x: 110, y: 500 });
  const before = paused(h.snapshot());
  h.click('pauseButton');
  assert.deepEqual(h.snapshot(), before);
  assert.deepEqual(h.saved().games.classic, before);
  assert.equal(h.node('gameOverlay').hidden, false);
  assert.equal(h.node('removeHint').hidden, true);
  assert.equal(h.node('removeButton').disabled, true);
  assert.equal(h.node('pauseButton').getAttribute('aria-label'), '继续游戏');
  h.canvas.focus();
  h.key(' ');
  h.tap({ pointerId: 2, x: 110, y: 500 });
  h.clock.advance(2000);
  assert.deepEqual(h.snapshot(), before);
  h.click('pauseButton');
  assert.equal(h.state().phase, 'playing');
  h.pointer('pointerup', { x: 110, y: 500 });
  assert.deepEqual(h.snapshot(), { ...before, phase: 'playing' });
  assert.equal(dropEvents(h).length, 0);
  h.key('p');
  assert.equal(h.state().phase, 'paused');
  h.key('p', { repeat: true });
  assert.equal(h.state().phase, 'paused');
  h.key('P');
  assert.equal(h.state().phase, 'playing');
});

for (const initialPhase of ['playing', 'paused']) {
  for (const close of ['button', 'escape']) {
    test(`suika UI: help from ${initialPhase}, closed by ${close}, stays paused with progress intact`, t => {
      const h = playing(t, { book: occupiedBook() });
      if (initialPhase === 'paused') h.click('pauseButton');
      const before = paused(h.snapshot());
      h.pointer('pointerdown');
      h.click('helpButton');
      assert.equal(h.node('helpDialog').open, true);
      assert.deepEqual(h.snapshot(), before);
      assert.deepEqual(h.saved().games.classic, before);
      h.key('p');
      h.key('m');
      h.key(' ', { target: h.canvas });
      assert.equal(h.sound.muted, false);
      h.clock.advance(1000);
      assert.deepEqual(h.snapshot(), before);
      if (close === 'button') {
        h.click('closeHelp');
        assert.equal(h.document.activeElement, h.node('helpButton'));
      } else h.dismissDialog('helpDialog');
      assert.equal(h.node('helpDialog').open, false);
      h.clock.advance(1000);
      assert.deepEqual(h.snapshot(), before, 'Closing help must not auto-resume');
      h.click('startButton');
      h.pointer('pointerup');
      assert.deepEqual(h.snapshot(), { ...before, phase: 'playing' });
    });
  }
}

for (const cancel of ['button', 'escape']) {
  test(`suika UI: restart confirmation pauses; ${cancel} cancellation preserves the whole game`, t => {
    const book = occupiedBook();
    book.games.collect = savedGame('collect', { score: 99, watermelons: 3 });
    const h = playing(t, { book });
    const before = paused(h.snapshot());
    h.pointer('pointerdown');
    h.click('restartButton');
    assert.equal(h.node('confirmDialog').open, true);
    assert.deepEqual(h.snapshot(), before);
    assert.deepEqual(h.saved().games.classic, before);
    h.key('p');
    h.key('m');
    h.clock.advance(1000);
    assert.deepEqual(h.snapshot(), before);
    assert.equal(h.sound.muted, false);
    if (cancel === 'button') h.click('cancelRestart');
    else h.dismissDialog('confirmDialog');
    assert.equal(h.node('confirmDialog').open, false);
    h.clock.advance(1000);
    assert.deepEqual(h.snapshot(), before);
    assert.deepEqual(h.saved().games.collect, book.games.collect);
    assert.equal(h.saved().records.classic.score, before.score);
    h.click('startButton');
    h.pointer('pointerup');
    assert.deepEqual(h.snapshot(), { ...before, phase: 'playing' });
  });
}

test('suika UI: confirmed restart resets only the current game, retaining other mode, records and mute', t => {
  const book = savedBook({
    muted: true,
    classic: { score: 123, watermelons: 2, tools: { remove: 0, shake: 0 }, fruits: [fruit(1, 6, 220, 500)] },
    collect: { score: 321, watermelons: 4, tools: { remove: 1, shake: 0 }, fruits: [fruit(2, 5, 100, 500)] },
    records: { classic: { score: 900, watermelons: 8 }, collect: { score: 600, watermelons: 9 } },
  });
  const h = playing(t, { book });
  h.pointer('pointerdown');
  h.click('restartButton');
  assert.equal(h.state().phase, 'paused');
  assert.equal(h.state().score, 123);
  h.click('confirmRestart');
  assert.equal(h.node('confirmDialog').open, false);
  assert.equal(h.state().phase, 'playing');
  assert.equal(h.state().score, 0);
  assert.equal(h.state().watermelons, 0);
  assert.deepEqual(h.state().fruits, []);
  assert.deepEqual(h.state().tools, { remove: 2, shake: 1 });
  h.pointer('pointerup');
  assert.deepEqual(h.state().fruits, []);
  assert.deepEqual(h.saved().games.classic, h.snapshot());
  assert.deepEqual(h.saved().games.collect, book.games.collect);
  assert.deepEqual(h.saved().records, book.records);
  assert.equal(h.saved().muted, true);
  assert.equal(h.node('bestScore').textContent, '900');
  h.click('collectMode');
  assert.equal(h.state().phase, 'paused');
  assert.equal(h.state().score, 321);
  assert.equal(h.state().watermelons, 4);
  assert.deepEqual(h.state().tools, { remove: 1, shake: 0 });
});

test('suika UI: mute button and M shortcut persist across reload without starting a game', t => {
  const h = bootSuika(t);
  h.click('soundButton');
  assert.equal(h.state().phase, 'ready');
  assert.equal(h.sound.muted, true);
  assert.equal(h.node('soundButton').getAttribute('aria-pressed'), 'true');
  assert.equal(h.node('soundButton').getAttribute('aria-label'), '开启音效');
  assert.equal(h.saved().muted, true);
  assert.equal(h.storage.writes.at(-1).key, SAVE_KEY);
  const reload = bootSuika(t, { storage: h.storage });
  const before = reload.snapshot();
  assert.equal(reload.sound.muted, true);
  assert.equal(reload.node('soundButton').getAttribute('aria-pressed'), 'true');
  for (const init of [{ repeat: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
    reload.key('m', init);
    assert.equal(reload.sound.muted, true);
  }
  reload.key('M');
  assert.equal(reload.sound.muted, false);
  assert.equal(reload.saved().muted, false);
  assert.equal(reload.node('soundButton').getAttribute('aria-label'), '关闭音效');
  assert.deepEqual(reload.snapshot(), before);
});

for (const options of [{ failRead: true }, { text: '{broken json' }]) {
  test(`suika UI: ${options.failRead ? 'unavailable' : 'corrupt'} storage still boots a playable game`, t => {
    const storage = memoryStorage(options);
    const h = bootSuika(t, { storage });
    assert.equal(h.state().phase, 'ready');
    assert.equal(h.sound.muted, false);
    h.click('startButton');
    h.tap();
    assert.equal(h.state().fruits.length, 1);
    assert.equal(h.state().phase, 'playing');
    assert.deepEqual(h.saved().games.classic, h.snapshot());
  });
}

test('suika UI: failed saves never crash controls or frames and later recovery saves in-memory progress', t => {
  const storage = memoryStorage({ failRead: true, failWrite: true });
  const h = bootSuika(t, { storage });
  assert.doesNotThrow(() => {
    h.click('startButton');
    h.tap({ x: 110 });
    h.clock.advance(800);
    h.click('soundButton');
    h.click('pauseButton');
  });
  assert.equal(h.state().fruits.length, 1);
  assert.equal(h.state().phase, 'paused');
  assert.ok(h.renderer.renders.length > 0);
  assert.ok(storage.attempts.length > 0);
  assert.equal(storage.writes.length, 0);
  assert.match(h.node('saveStatus').textContent, /无法保存/);
  const before = h.snapshot();
  assert.doesNotThrow(() => {
    h.click('collectMode');
    h.click('classicMode');
    h.window.dispatch('pagehide');
  });
  assert.deepEqual(h.snapshot(), before);
  assert.equal(h.sound.muted, true);
  storage.failRead = false;
  storage.failWrite = false;
  h.window.dispatch('pagehide');
  assert.deepEqual(h.saved().games.classic, before);
  assert.equal(h.saved().muted, true);
  assert.equal(h.saved().mode, 'classic');
  assert.match(h.node('saveStatus').textContent, /进度自动保存/);
  const reload = bootSuika(t, { storage });
  assert.deepEqual(reload.snapshot(), before);
  assert.equal(reload.sound.muted, true);
});

test('suika UI: Space on focused buttons is not a drop; focused canvas accepts one non-repeated Space', t => {
  const h = playing(t, { book: occupiedBook() });
  const before = h.snapshot();
  const writes = h.storage.writes.length;
  for (const id of ['soundButton', 'helpButton', 'pauseButton', 'restartButton', 'classicMode', 'collectMode', 'removeButton', 'shakeButton']) {
    h.node(id).focus();
    assert.equal(h.key(' ').defaultPrevented, false, `${id} must retain native Space activation`);
    assert.equal(h.key('ArrowLeft').defaultPrevented, false);
    assert.deepEqual(h.snapshot(), before, `${id} focus must not control the board`);
  }
  assert.equal(h.storage.writes.length, writes);
  h.click('soundButton');
  assert.equal(h.sound.muted, true, 'Native button activation remains separate from dropping');
  assert.deepEqual(h.snapshot(), before);
  h.canvas.focus();
  assert.equal(h.key(' ', { repeat: true }).defaultPrevented, true,
    'Repeated Space must not scroll the page even when it cannot drop');
  assert.deepEqual(h.snapshot(), before);
  for (const init of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
    assert.equal(h.key(' ', init).defaultPrevented, false);
    assert.deepEqual(h.snapshot(), before);
  }
  assert.equal(h.key('ArrowRight').defaultPrevented, true);
  assert.equal(h.key('ArrowLeft').defaultPrevented, true);
  assert.equal(h.key(' ').defaultPrevented, true);
  const state = h.state();
  assert.equal(state.fruits.length, before.fruits.length + 1);
  assert.equal(state.fruits.at(-1).x, WORLD.width / 2);
  assert.equal(dropEvents(h).length, 1);
  assert.deepEqual(h.saved().games.classic, h.snapshot());
});

test('suika UI: held Space always prevents scrolling but cannot drop again after cooldown', t => {
  const h = playing(t, { book: savedBook({ classic: { current: 0, next: 2 } }) });
  assert.equal(h.key(' ').defaultPrevented, true);
  assert.equal(dropEvents(h).length, 1);
  // Advance beyond the real core cooldown: it must not hide a repeat-input bug.
  h.clock.advance(500);
  const before = h.snapshot();
  assert.equal(before.cooldownMs, 0);
  const writes = h.storage.writes.length;
  const unlocks = h.sound.unlocks;
  for (let repeat = 0; repeat < 3; repeat++) {
    assert.equal(h.key(' ', { repeat: true }).defaultPrevented, true);
    assert.deepEqual(h.snapshot(), before);
  }
  assert.equal(h.storage.writes.length, writes);
  assert.equal(h.sound.unlocks, unlocks);
  assert.equal(dropEvents(h).length, 1);
  assert.equal(h.key(' ').defaultPrevented, true, 'A fresh Space press remains available');
  assert.equal(h.state().fruits.length, 2);
  assert.equal(dropEvents(h).length, 2);
});

test('suika UI: Space with body focus does not drop until the canvas is focused', t => {
  const h = playing(t);
  const before = h.snapshot();
  h.document.body.focus();
  const event = h.key(' ');
  assert.deepEqual(h.snapshot(), before, 'Only canvas focus may commit a keyboard drop');
  assert.equal(event.defaultPrevented, false);
  h.canvas.focus();
  h.key(' ');
  assert.equal(h.state().fruits.length, 1);
});

for (const lifecycle of ['visibilitychange', 'blur']) {
  test(`suika UI: ${lifecycle} pauses and saves; returning cannot resume or revive a held touch`, t => {
    const h = playing(t, { book: occupiedBook() });
    const before = paused(h.snapshot());
    h.pointer('pointerdown');
    if (lifecycle === 'visibilitychange') {
      h.document.hidden = true;
      h.document.dispatch('visibilitychange');
    } else h.window.dispatch('blur');
    assert.deepEqual(h.snapshot(), before);
    assert.deepEqual(h.saved().games.classic, before);
    h.clock.advance(2000);
    assert.deepEqual(h.snapshot(), before);
    h.document.hidden = false;
    h.document.dispatch('visibilitychange');
    h.window.dispatch('focus');
    h.clock.advance(1000);
    assert.deepEqual(h.snapshot(), before);
    h.click('startButton');
    h.pointer('pointerup');
    assert.deepEqual(h.snapshot(), { ...before, phase: 'playing' });
  });
}

test('suika UI: pagehide flushes latest physics and stops RAF; BFCache pageshow stays paused', t => {
  const h = playing(t, { book: occupiedBook() });
  h.clock.frame();
  h.clock.frame();
  assert.notDeepEqual(h.saved().games.classic.fruits, h.snapshot().fruits, 'Physics changed since the last save');
  const before = paused(h.snapshot());
  h.pointer('pointerdown');
  h.window.dispatch('pagehide');
  assert.deepEqual(h.snapshot(), before);
  assert.deepEqual(h.saved().games.classic, before);
  assert.equal(h.saved().records.classic.score, before.score);
  assert.equal(h.clock.frames.size, 0);
  assert.equal(h.clock.frame(60000), 0);
  assert.deepEqual(h.snapshot(), before);
  const writes = h.storage.writes.length;
  h.window.dispatch('pagehide');
  assert.ok(h.storage.writes.length > writes, 'Already-paused pagehide still flushes storage');
  h.window.dispatch('pageshow', { persisted: true });
  assert.equal(h.clock.frames.size, 1);
  h.clock.frame();
  assert.deepEqual(h.snapshot(), before);
  assert.equal(h.renderer.renders.at(-1).state.phase, 'paused');
  h.click('startButton');
  h.pointer('pointerup');
  assert.deepEqual(h.snapshot(), { ...before, phase: 'playing' });
  h.clock.frame();
  h.clock.frame();
  assert.notDeepEqual(h.snapshot().fruits, before.fruits, 'Only explicit resume restarts physics');
});

test('suika UI: theme toggle flips the root attribute, persists and reaches the renderer', t => {
  const h = bootSuika(t, { book: savedBook() });
  const root = h.document.documentElement;
  assert.equal(root.getAttribute('data-theme'), 'light', 'Without a saved choice the system mock stays light');
  assert.equal(h.node('themeButton').getAttribute('aria-pressed'), 'false');
  assert.equal(h.node('themeButton').textContent, '☾');
  assert.deepEqual(h.renderer.themes, ['light']);
  h.click('themeButton');
  assert.equal(root.getAttribute('data-theme'), 'dark');
  assert.equal(h.node('themeButton').getAttribute('aria-pressed'), 'true');
  assert.equal(h.node('themeButton').getAttribute('aria-label'), '切换亮色主题');
  assert.equal(h.node('themeMeta').content, '#131e18');
  assert.equal(h.saved().theme, 'dark');
  assert.deepEqual(h.renderer.themes, ['light', 'dark']);
  h.key('t');
  assert.equal(root.getAttribute('data-theme'), 'light');
  assert.equal(h.node('themeButton').textContent, '☾');
  assert.equal(h.saved().theme, 'light');
});

test('suika UI: a saved theme wins over the system preference and round-trips', t => {
  const h = bootSuika(t, { book: savedBook({ theme: 'dark' }), darkSystem: false });
  assert.equal(h.document.documentElement.getAttribute('data-theme'), 'dark');
  const light = bootSuika(t, { book: savedBook({ theme: 'light' }), darkSystem: true });
  assert.equal(light.document.documentElement.getAttribute('data-theme'), 'light');
  const follower = bootSuika(t, { book: savedBook(), darkSystem: true });
  assert.equal(follower.document.documentElement.getAttribute('data-theme'), 'dark',
    'Without a saved choice the system preference leads');
});
