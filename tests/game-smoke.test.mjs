import assert from 'node:assert/strict';
import test from 'node:test';
import { boot, drawNext, betBlackjack, seedRandom } from './helpers/core-harness.mjs';

function bfs(a, b, level, empty) {
  const min = level.useBoundary ? 1 : 0;
  const maxX = level.column + (level.useBoundary ? 0 : 1);
  const maxY = level.row + (level.useBoundary ? 0 : 1);
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const queue = [[a.x, a.y, -1, 0]];
  const best = new Map();
  for (let i = 0; i < queue.length; i++) {
    const [x, y, previous, turns] = queue[i];
    for (let d = 0; d < dirs.length; d++) {
      const [dx, dy] = dirs[d];
      const nx = x + dx, ny = y + dy;
      const nt = turns + (previous === -1 || d === previous ? 0 : 1);
      if (nt > 2 || nx < min || ny < min || nx > maxX || ny > maxY) continue;
      if (nx === b.x && ny === b.y) return true;
      if (!empty(nx, ny)) continue;
      const key = `${nx},${ny},${d}`;
      if (best.has(key) && best.get(key) <= nt) continue;
      best.set(key, nt);
      queue.push([nx, ny, d, nt]);
    }
  }
  return false;
}

test('match-pairs pathfinding matches an independent two-turn BFS for 2000 boards', () => {
  const env = boot('match-pairs');
  const findPath = env.eval('findPath');
  const isEmptyFnFrom = env.eval('isEmptyFnFrom');
  const random = seedRandom(148);
  for (let i = 0; i < 2000; i++) {
    const level = { row: 4, column: 4, useBoundary: i % 2 === 0 };
    const map = new Map();
    for (let y = 1; y <= 4; y++) {
      for (let x = 1; x <= 4; x++) map.set(`${x},${y}`, { x, y, seq: random() < 0.55 ? 1 : 0 });
    }
    const all = [...map.values()];
    const a = all[Math.floor(random() * all.length)];
    let b;
    do { b = all[Math.floor(random() * all.length)]; } while (b === a);
    a.seq = b.seq = 2;
    const empty = isEmptyFnFrom(map, level);
    assert.equal(findPath(a, b, level, empty) !== null, bfs(a, b, level, empty));
  }
});

test('match-pairs old match and hint continuations cannot modify a restarted board', async () => {
  const env = boot('match-pairs');
  const app = env.eval('app');
  const status = env.eval('GameStatus');
  async function start() {
    const promise = env.eval('handleStart()');
    env.clock.advance(20);
    await promise;
    assert.equal(app.state.gameStatus, status.playing);
  }
  await start();
  const pair = env.eval('findAnyPair(app.state.boxes, app.state.levelInfo)');
  await env.context.handleCheck(pair[0]);
  const match = env.context.handleCheck(pair[1]);
  assert.equal(app.state.gameStatus, status.inTheAnimation);
  env.document.querySelector('.container').children[0].click();
  assert.equal(app.state.gameStatus, status.finished);
  await start();
  const version = app.state.boardVersion;
  env.clock.advance(220);
  await match;
  assert.equal(app.state.gameStatus, status.playing);
  assert.equal(app.state.boardVersion, version);
  assert.equal(app.state.pendingCheck, false);
  assert.equal(app.state.boxes.filter(b => b.seq === 0).length, 0);
  const hint = env.context.handleTips();
  env.document.querySelector('.container').children[0].click();
  await start();
  env.clock.advance(900);
  await hint;
  assert.equal(app.state.gameStatus, status.playing);
  assert.equal(app.state.boxes.filter(b => b.seq === 0).length, 0);
  assert.equal(app.state.tips, 5);
});

test('match-pairs all five levels generate paired tiles and solvable fallback boards', () => {
  const env = boot('match-pairs');
  const levels = env.eval('buildGameLevels()');
  assert.equal(levels.length, 5);
  for (const level of levels) {
    const boxes = env.context.makeRandomBoxes(level);
    assert.equal(boxes.length, level.row * level.column);
    const counts = new Map();
    for (const b of boxes) counts.set(b.seq, (counts.get(b.seq) || 0) + 1);
    assert.ok([...counts.values()].every(n => n % 2 === 0));
    const fallback = env.context.makeDominoBoxes(level);
    assert.equal(fallback.length, level.row * level.column);
    assert.equal(env.context.isSolvable(fallback, level), true);
  }
});

test('minesweeper restarts discard old mine effects and all difficulties preserve first-click safety', () => {
  const env = boot('minesweeper');
  const state = env.eval('gameState');
  const board = env.document.getElementById('board');
  board.dispatch('click', { target: state.board[0][0] });
  assert.equal(state.mineGrid[0][0], false);
  let mine;
  for (let r = 0; r < state.rows; r++) {
    for (let c = 0; c < state.columns; c++) if (state.mineGrid[r][c] && !mine) mine = state.board[r][c];
  }
  board.dispatch('click', { target: mine });
  env.document.getElementById('restart-button').click();
  env.clock.advance(2000);
  assert.equal(state.gameOver, false);
  assert.equal(state.tilesClicked, 0);
  assert.equal(env.document.getElementById('gameOverModal').classList.contains('active'), false);
  assert.equal(state.board.flat().filter(tile => tile.classList.contains('tile-mine')).length, 0);
  for (const button of env.document.querySelectorAll('.difficulty-btn')) {
    button.click();
    const { rows, columns } = state;
    board.dispatch('click', { target: state.board[Math.floor(rows / 2)][Math.floor(columns / 2)] });
    assert.equal(state.mineGrid.flat().filter(Boolean).length, state.minesCount);
    assert.equal(state.gameOver, false);
  }
});

for (const scenario of [
  { name: 'win', cards: ['10', '10', '9', '8'], expected: 5100 },
  { name: 'lose', cards: ['10', '10', '8', '9'], expected: 4900 },
  { name: 'push', cards: ['10', '10', '8', '8'], expected: 5000 },
  { name: 'natural', cards: ['A', '10', 'K', '8'], expected: 5150 },
  { name: 'both-natural', cards: ['A', 'A', 'K', 'K'], expected: 5000 },
]) {
  test(`blackjack ${scenario.name} settles and persists the correct chips`, () => {
    const env = boot('blackjack');
    drawNext(env.game, scenario.cards);
    betBlackjack(env.game, 100);
    if (env.game.state === 'playing') env.game.el.btnStand.click();
    env.clock.advance(500);
    assert.equal(env.game.chips, scenario.expected);
    assert.equal(env.game.state, 'gameOver');
    assert.equal(env.context.localStorage.getItem('bj_chips_v2'), String(scenario.expected));
  });
}
