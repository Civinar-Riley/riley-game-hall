import { FruitGame, FRUITS, WORLD } from './core.js';
import { fruitIcon } from './fruit-art.js';
import { createFruitRenderer } from './renderer.js';
import { loadBook, saveBook, updateRecord } from './storage.js';
import { OrchardSound } from './sound.js';

const $ = id => document.getElementById(id);
const canvas = $('fruitCanvas');
const book = loadBook({ getItem: key => localStorage.getItem(key) });
const sound = new OrchardSound(book.muted);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let game;
let renderer;
let aimX = WORLD.width / 2;
let removeMode = false;
let activePointer = null;
let needsSave = false;
let lastSave = 0;
let lastTime = 0;
let lastUI = 0;
let animationId = 0;
let toastTimer;
let lastPhase;
let lastNext = -1;
let lastModalFocus;
let contextUnavailable = false;
let storageAvailable = true;

function toast(message, duration = 2100) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, duration);
}

function onGameEvent(event) {
  renderer?.burst(event);
  sound.play(event);
  if (event.type !== 'collision') needsSave = true;
  if (event.type === 'merge' && event.tier === 10) {
    toast(event.collected ? '西瓜 +1！把快乐继续装满。' : '合出大西瓜啦！今天很甜。', 3000);
  }
  if (event.type === 'over') {
    removeMode = false;
    activePointer = null;
  }
}

function createGame(mode) {
  const nextGame = new FruitGame(mode, { snapshot: book.games[mode], onEvent: onGameEvent });
  lastPhase = undefined;
  lastNext = -1;
  removeMode = false;
  activePointer = null;
  aimX = WORLD.width / 2;
  lastTime = 0;
  renderer?.clearEffects?.();
  return nextGame;
}

function persist() {
  if (!game) return;
  const state = game.getState();
  book.games[state.mode] = game.snapshot();
  updateRecord(book, state);
  book.muted = sound.muted;
  storageAvailable = saveBook({ setItem: (key, value) => localStorage.setItem(key, value) }, book);
  $('saveStatus').textContent = storageAvailable ? '● 进度自动保存' : '本次无法保存 · 请勿关闭页面';
  needsSave = false;
  lastSave = performance.now();
}

function updateUI(state) {
  updateRecord(book, state);
  $('score').textContent = String(state.score);
  $('bestScore').textContent = String(book.records[state.mode].score);
  $('watermelons').textContent = String(state.watermelons);
  $('bestHarvest').textContent = `单局最多 ${book.records[state.mode].watermelons} 颗`;
  $('removeCount').textContent = String(state.tools.remove);
  $('shakeCount').textContent = String(state.tools.shake);
  const playing = state.phase === 'playing' && !contextUnavailable;
  $('removeButton').disabled = !playing || !state.tools.remove || !state.fruits.length;
  $('shakeButton').disabled = !playing || !state.tools.shake || !state.fruits.length;
  $('removeButton').setAttribute('aria-pressed', String(removeMode));
  $('removeHint').hidden = !removeMode;
  $('pauseButton').disabled = state.phase === 'ready' || state.phase === 'over' || contextUnavailable;
  $('pauseButton').textContent = state.phase === 'paused' ? '▷' : 'Ⅱ';
  $('pauseButton').setAttribute('aria-label', state.phase === 'paused' ? '继续游戏' : '暂停游戏');
  $('soundButton').textContent = sound.muted ? '♪̸' : '♪';
  $('soundButton').setAttribute('aria-label', sound.muted ? '开启音效' : '关闭音效');
  $('soundButton').setAttribute('aria-pressed', String(sound.muted));
  $('dangerLine').classList.toggle('warning', state.dangerMs > 0);
  $('dangerText').textContent = state.dangerMs > 0
    ? `快腾点空间 · ${Math.max(0, (3000 - state.dangerMs) / 1000).toFixed(1)} 秒`
    : '别超过这条线哦';
  if (lastNext !== state.next) {
    lastNext = state.next;
    $('nextFruit').src = fruitIcon(state.next);
    $('nextFruit').alt = `下一颗：${FRUITS[state.next].name}`;
    $('nextName').textContent = FRUITS[state.next].name;
  }
  if (lastPhase !== state.phase) {
    lastPhase = state.phase;
    $('gameOverlay').hidden = playing;
    if (state.phase === 'ready') {
      $('overlayEyebrow').textContent = 'TODAY IS A FRUITFUL DAY';
      $('overlayTitle').textContent = '开一局，甜一下。';
      $('overlayDescription').textContent = '小水果碰一碰，快乐就会大一点。';
      $('startButton').textContent = '开始合成 ↗';
      $('overlayFoot').textContent = '没有时间限制 · 每一步都算数';
    } else if (state.phase === 'paused') {
      $('overlayEyebrow').textContent = 'TAKE YOUR TIME';
      $('overlayTitle').textContent = '水果在等你。';
      $('overlayDescription').textContent = '这一篮快乐已经存好，准备好了再继续。';
      $('startButton').textContent = '继续游戏 ↗';
      $('overlayFoot').textContent = '已暂停 · 水果不会偷偷掉下来';
    } else if (state.phase === 'over') {
      $('overlayEyebrow').textContent = 'A BASKET FULL OF JOY';
      $('overlayTitle').textContent = '这一篮，满载而归。';
      $('overlayDescription').textContent = `本局 ${state.score} 分 · 收获 ${state.watermelons} 颗西瓜`;
      $('startButton').textContent = '再开一局 ↗';
      $('overlayFoot').textContent = '纪录已保留 · 下一篮会更甜';
    }
  }
  $('startButton').disabled = contextUnavailable;
}

function updateMode() {
  const collecting = book.mode === 'collect';
  for (const mode of ['classic', 'collect']) {
    $(`${mode}Mode`).classList.toggle('active', book.mode === mode);
    $(`${mode}Mode`).setAttribute('aria-pressed', String(book.mode === mode));
  }
  $('modeDescription').textContent = collecting
    ? '合出的西瓜会消失，留出新的空间。看看这一篮能收获多少颗。'
    : '相同水果相碰就会长大。西瓜留在篮子里，看看能得多少分。';
  $('harvestLabel').textContent = collecting ? '今日西瓜收集' : '本局的小成就';
  $('harvestDescription').textContent = collecting ? '合出即收集 · 快乐不设上限' : '向第一颗西瓜出发';
}

function pause() {
  activePointer = null;
  removeMode = false;
  if (game?.pause()) {
    persist();
    updateUI(game.getState());
  }
}

function begin() {
  if (contextUnavailable) return;
  sound.unlock();
  if (game.getState().phase === 'over') {
    requestRestart();
    return;
  }
  game.start();
  lastTime = 0;
  persist();
  updateUI(game.getState());
  canvas.focus({ preventScroll: true });
}

function switchMode(mode) {
  if (book.mode === mode) return;
  pause();
  persist();
  game.destroy();
  book.mode = mode;
  game = createGame(mode);
  clearTimeout(toastTimer);
  $('toast').hidden = true;
  updateMode();
  updateUI(game.getState());
  persist();
}

function openDialog(dialog) {
  pause();
  lastModalFocus = document.activeElement;
  dialog.showModal();
}

function closeDialog(dialog) {
  dialog.close();
  lastModalFocus?.focus({ preventScroll: true });
}

function requestRestart() {
  openDialog($('confirmDialog'));
}

function restart() {
  closeDialog($('confirmDialog'));
  persist();
  game.destroy();
  book.games[book.mode] = null;
  game = createGame(book.mode);
  clearTimeout(toastTimer);
  $('toast').hidden = true;
  begin();
}

function pointerPosition(event) {
  const bounds = canvas.getBoundingClientRect();
  const radius = FRUITS[game.getState().current].radius;
  const x = (event.clientX - bounds.left) / bounds.width * WORLD.width;
  const y = (event.clientY - bounds.top) / bounds.height * WORLD.height;
  aimX = Math.max(WORLD.left + radius, Math.min(WORLD.right - radius, x));
  return { x, y, inside: x >= 0 && x <= WORLD.width && y >= 0 && y <= WORLD.height };
}

function commitInput(point) {
  if (!point.inside || contextUnavailable) return;
  sound.unlock();
  if (removeMode) {
    if (game.removeAt(point.x, point.y)) {
      removeMode = false;
      toast('腾出一点空间。');
    } else {
      toast('点中一颗水果再移除，不会浪费次数。');
    }
  } else {
    game.drop(aimX);
  }
  persist();
  updateUI(game.getState());
}

canvas.addEventListener('pointerdown', event => {
  if (!event.isPrimary || event.button !== 0 || game.getState().phase !== 'playing' || contextUnavailable) return;
  event.preventDefault();
  sound.unlock();
  activePointer = event.pointerId;
  pointerPosition(event);
  canvas.setPointerCapture(event.pointerId);
  canvas.focus({ preventScroll: true });
});
canvas.addEventListener('pointermove', event => {
  if (!event.isPrimary || (event.pointerType !== 'mouse' && activePointer !== event.pointerId)) return;
  if (game.getState().phase === 'playing') pointerPosition(event);
});
canvas.addEventListener('pointerup', event => {
  if (activePointer !== event.pointerId) return;
  activePointer = null;
  const point = pointerPosition(event);
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  commitInput(point);
});
function cancelPointer(event) {
  if (activePointer === event.pointerId) activePointer = null;
}
canvas.addEventListener('pointercancel', cancelPointer);
canvas.addEventListener('lostpointercapture', cancelPointer);

$('startButton').addEventListener('click', begin);
$('classicMode').addEventListener('click', () => switchMode('classic'));
$('collectMode').addEventListener('click', () => switchMode('collect'));
$('pauseButton').addEventListener('click', () => game.getState().phase === 'paused' ? begin() : pause());
$('restartButton').addEventListener('click', requestRestart);
$('confirmRestart').addEventListener('click', restart);
$('cancelRestart').addEventListener('click', () => closeDialog($('confirmDialog')));
$('helpButton').addEventListener('click', () => openDialog($('helpDialog')));
$('closeHelp').addEventListener('click', () => closeDialog($('helpDialog')));
$('removeButton').addEventListener('click', () => {
  if ($('removeButton').disabled) return;
  removeMode = !removeMode;
  activePointer = null;
  updateUI(game.getState());
});
$('shakeButton').addEventListener('click', () => {
  sound.unlock();
  removeMode = false;
  activePointer = null;
  if (game.shake()) toast('轻轻摇一摇，好事会发生。');
  persist();
  updateUI(game.getState());
});
function toggleSound() {
  sound.muted = !sound.muted;
  sound.unlock();
  persist();
  updateUI(game.getState());
}
$('soundButton').addEventListener('click', toggleSound);

document.addEventListener('keydown', event => {
  if ($('helpDialog').open || $('confirmDialog').open || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key.toLowerCase() === 'm' && !event.repeat) { toggleSound(); return; }
  if (event.key.toLowerCase() === 'p' && !event.repeat) {
    if (game.getState().phase === 'playing') pause();
    else if (game.getState().phase === 'paused') begin();
    return;
  }
  if (event.target !== canvas) return;
  if (game.getState().phase !== 'playing' || removeMode || contextUnavailable) return;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault();
    const radius = FRUITS[game.getState().current].radius;
    aimX = Math.max(WORLD.left + radius, Math.min(WORLD.right - radius, aimX + (event.key === 'ArrowLeft' ? -12 : 12)));
  } else if (event.code === 'Space') {
    event.preventDefault();
    if (event.repeat) return;
    sound.unlock();
    game.drop(aimX);
    persist();
    updateUI(game.getState());
  }
});

document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
window.addEventListener('blur', pause);
window.addEventListener('pagehide', () => { pause(); persist(); cancelAnimationFrame(animationId); });
window.addEventListener('pageshow', event => {
  if (event.persisted) { lastTime = 0; animationId = requestAnimationFrame(frame); }
});

$('fruitChain').replaceChildren(...FRUITS.map((fruit, tier) => {
  const item = document.createElement('li');
  const image = document.createElement('img');
  image.src = fruitIcon(tier);
  image.alt = `${tier + 1}级 ${fruit.name}`;
  const label = document.createElement('span');
  label.textContent = fruit.name;
  item.append(image, label);
  return item;
}));
$('heroFruit').src = fruitIcon(10);
$('harvestFruit').src = fruitIcon(10);
if (matchMedia('(pointer: coarse)').matches) $('inputHint').textContent = '按住左右拖动瞄准 · 松手投放';

game = createGame(book.mode);
renderer = createFruitRenderer(canvas, {
  reducedMotion,
  onContextLost: () => {
    contextUnavailable = true;
    pause();
    toast('画面暂时中断，进度已保存。', 6000);
    updateUI(game.getState());
  },
  onContextRestored: () => {
    contextUnavailable = false;
    toast('画面恢复了，点击继续游戏。');
    updateUI(game.getState());
  },
});
if (renderer.kind === 'canvas') toast('已启用轻量画面，玩法和存档不受影响。', 4000);
function resize() {
  const rect = canvas.getBoundingClientRect();
  renderer.resize(rect.width, rect.height);
}
new ResizeObserver(resize).observe(canvas);
resize();
updateMode();
updateUI(game.getState());
function frame(time) {
  const dt = lastTime ? Math.min(time - lastTime, 100) : 0;
  lastTime = time;
  game.step(dt);
  const state = game.getState();
  if (needsSave || state.phase !== lastPhase || time - lastUI >= 100) {
    updateUI(state);
    lastUI = time;
  }
  if (needsSave || (state.phase === 'playing' && time - lastSave >= 700)) persist();
  if (!contextUnavailable) renderer.render(state, {
    aimX, showAim: state.phase === 'playing' && !removeMode,
    removeMode, time,
  });
  animationId = requestAnimationFrame(frame);
}
animationId = requestAnimationFrame(frame);
