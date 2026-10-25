import assert from 'node:assert/strict';
import test from 'node:test';
import { boot, drawNext, betBlackjack } from './helpers/core-harness.mjs';

test('blackjack insurance cancellation persists the refund through the real save shim', () => {
  const env = boot('blackjack');
  const g = env.game;
  drawNext(g, ['9', 'A', '7', '9']);
  betBlackjack(g, 100);
  assert.equal(g.waitingForInsurance, true);
  assert.equal(g.chips, 4900);
  assert.equal(g.el.btnReset.disabled, false);
  g.el.btnReset.click();
  assert.equal(g.chips, 5000);
  assert.equal(g.state, 'idle');
  assert.equal(env.context.localStorage.getItem('bj_chips_v2'), '5000');
  env.fire('pagehide');
  const snapshot = env.snapshots.at(-1);
  assert.equal(snapshot.data.bj_chips_v2, '5000');
  assert.equal(boot('blackjack', { saved: snapshot.data }).game.chips, 5000);
  g.el.btnReset.click();
  assert.equal(g.chips, 5000);
});

test('blackjack caps both the split button and split method at four hands', () => {
  const { game: g } = boot('blackjack');
  drawNext(g, ['8', '6', '8', '9']);
  betBlackjack(g, 100);
  for (let i = 0; i < 3; i++) {
    assert.equal(g.el.btnSplit.disabled, false);
    drawNext(g, ['8', '8']);
    g.el.btnSplit.click();
    assert.equal(g.playerHands.length, i + 2);
  }
  assert.equal(g.playerHands.length, g.maxSplitHands);
  assert.equal(g.el.btnSplit.disabled, true);
  const chips = g.chips;
  g.split();
  assert.equal(g.playerHands.length, 4);
  assert.equal(g.chips, chips);
  assert.equal(g.chips, 4600);
});

test('blackjack splitting still requires sufficient chips', () => {
  const { game: g } = boot('blackjack', { saved: { bj_chips_v2: '100' } });
  drawNext(g, ['8', '6', '8', '9']);
  betBlackjack(g, 100);
  assert.equal(g.el.btnSplit.disabled, true);
  g.split();
  assert.equal(g.playerHands.length, 1);
  assert.equal(g.chips, 0);
});

test('minesweeper ignores left clicks on flags without starting the timer or consuming safety', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const env = boot('minesweeper', { seed });
    const board = env.document.getElementById('board');
    const state = env.eval('gameState');
    const flag = state.board[0][0];
    board.dispatch('contextmenu', { target: flag });
    board.dispatch('click', { target: flag });
    assert.equal(state.gameStarted, false);
    assert.equal(state.tilesClicked, 0);
    assert.equal(state.timerInterval, null);
    assert.equal(state.flagsPlaced, 1);
    board.dispatch('click', { target: state.board[0][2] });
    assert.equal(state.gameStarted, true);
    assert.equal(state.mineGrid[0][2], false);
    assert.equal(state.gameOver, false);
    assert.ok(state.tilesClicked > 0);
    assert.ok(flag.classList.contains('tile-flagged'));
  }
});

test('minesweeper can still remove flags and reveal the formerly flagged first tile', () => {
  const env = boot('minesweeper');
  const board = env.document.getElementById('board');
  const state = env.eval('gameState');
  const tile = state.board[0][0];
  board.dispatch('contextmenu', { target: tile });
  board.dispatch('contextmenu', { target: tile });
  assert.equal(state.flagsPlaced, 0);
  board.dispatch('click', { target: tile });
  assert.equal(state.mineGrid[0][0], false);
  assert.equal(state.gameOver, false);
  assert.ok(state.tilesClicked > 0);
});

test('horse racing keeps the finish order throughout the remaining race', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const env = boot('horse-racing', { seed });
    const g = env.game;
    g.laneEls[0].lane.click();
    g.el.betChips.children[0].click();
    g.el.btnStart.click();
    env.clock.advance(2800);
    assert.equal(g.state, 'racing');
    const sorted = Array.from(g.raceData, (r, i) => ({ i, time: r.finishTime })).sort((a, b) => a.time - b.time);
    for (let n = 1; n < sorted.length; n++) {
      const sample = (sorted[n - 1].time + sorted[n].time) / 2;
      env.clock.frameAt(g._raceStart + sample);
      assert.deepEqual(Array.from(g.finishOrder), sorted.slice(0, n).map(r => r.i));
      for (let rank = 0; rank < n; rank++) {
        const badge = g.laneEls[sorted[rank].i].rankEl;
        assert.equal(badge.textContent, String(rank + 1));
        assert.equal(badge.classList.contains('first'), rank === 0);
      }
    }
    env.clock.frameAt(g._raceStart + sorted.at(-1).time + 1);
    assert.equal(g.state, 'result');
    assert.deepEqual(Array.from(g.finishOrder), sorted.map(r => r.i));
    sorted.forEach((r, i) => assert.equal(g.laneEls[r.i].rankEl.textContent, String(i + 1)));
  }
});
