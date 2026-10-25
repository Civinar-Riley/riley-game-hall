import assert from 'node:assert/strict';
import test from 'node:test';
import { FRUITS } from '../src/games/suika/core.js';
import { createFruitRenderer } from '../src/games/suika/renderer.js';

// Exercise the real renderer's fallback with a small DOM/Canvas command recorder.
// No browser, native canvas, GPU, rasterization or visual-quality claims are needed.
class CanvasStub extends EventTarget {
  constructor({ locked = false, available = true } = {}) {
    super();
    this.locked = locked;
    this.available = available;
    this.width = 440;
    this.height = 620;
    this.clientWidth = 440;
    this.clientHeight = 620;
    this.style = { opacity: '' };
    this.attributes = new Map();
    this.listeners = new Map();
    this.contextRequests = [];
    this.calls = [];
    this.rect = { left: 40, top: 60, width: 440, height: 620 };
    this.removeCount = 0;
    this.context = {};
    for (const name of [
      'save', 'restore', 'translate', 'rotate', 'scale', 'setTransform', 'clearRect',
      'fillRect', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'quadraticCurveTo', 'bezierCurveTo',
      'ellipse', 'arc', 'fill', 'stroke', 'setLineDash', 'drawImage', 'putImageData',
    ]) this.context[name] = (...args) => this.calls.push({ name, args });
    this.context.createLinearGradient = this.context.createRadialGradient = () => ({ addColorStop() {} });
    this.context.createImageData = (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) });
    this.context.getImageData = (x, y, width, height) => ({
      data: new Uint8ClampedArray(width * height * 4).fill(180),
    });
  }

  getContext(type, options) {
    this.contextRequests.push({ type, options });
    if (type !== '2d') return null; // Make actual Three.js context creation fail.
    if (this.locked) throw new Error('Canvas is already owned by a failed WebGL context');
    return this.available ? this.context : null;
  }

  addEventListener(type, listener, options) {
    super.addEventListener(type, listener, options);
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }

  removeEventListener(type, listener, options) {
    super.removeEventListener(type, listener, options);
    this.listeners.get(type)?.delete(listener);
    if (this.listeners.get(type)?.size === 0) this.listeners.delete(type);
  }

  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getBoundingClientRect() { return this.rect; }

  insertAdjacentElement(position, element) {
    assert.equal(position, 'afterend', 'fallback must not replace the input canvas or cover later HTML overlays');
    const parent = this.parentElement;
    parent.children.splice(parent.children.indexOf(this) + 1, 0, element);
    element.parentElement = parent;
  }

  remove() {
    this.removeCount += 1;
    const parent = this.parentElement;
    if (parent) parent.children.splice(parent.children.indexOf(this), 1);
    this.parentElement = null;
  }

  commands(name) { return this.calls.filter(call => call.name === name).map(call => call.args); }
}

function fixture(t, { locked = false, dpr = 1, helperAvailable = true } = {}) {
  const savedGlobals = new Map(['document', 'devicePixelRatio', 'performance'].map(key => [
    key, Object.getOwnPropertyDescriptor(globalThis, key),
  ]));
  const created = [];
  const renderers = [];
  const errors = [];
  const clock = { time: 1000 };
  const canvas = new CanvasStub({ locked });
  const htmlOverlay = { name: 'existing pause/danger overlay' };
  const parent = {
    children: [canvas, htmlOverlay],
    scrollLeft: 4, scrollTop: 5, clientLeft: 2, clientTop: 3,
    getBoundingClientRect: () => ({ left: 10, top: 20 }),
  };
  canvas.parentElement = canvas.offsetParent = parent;
  const document = {
    createElement(tag) {
      assert.equal(tag, 'canvas');
      const element = new CanvasStub({ available: helperAvailable });
      created.push(element);
      return element;
    },
  };
  for (const [key, value] of Object.entries({ document, devicePixelRatio: dpr, performance: { now: () => clock.time } })) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  t.mock.method(console, 'error', (...args) => errors.push(args.join(' ')));
  t.after(() => {
    try {
      for (const renderer of renderers) renderer.dispose();
    } finally {
      for (const [key, descriptor] of savedGlobals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    }
  });
  return {
    canvas, parent, htmlOverlay, created, clock,
    create(options = {}) {
      const renderer = createFruitRenderer(canvas, options);
      renderers.push(renderer);
      assert.equal(renderer.kind, 'canvas');
      assert.ok(errors.length > 0, 'the real WebGL construction path was attempted');
      for (const error of errors) assert.match(error, /WebGLRenderer: .*WebGL context/);
      return renderer;
    },
  };
}

function frozenState(fruits = []) {
  return Object.freeze({
    mode: 'classic', phase: 'playing', score: 41, watermelons: 0,
    current: 3, next: 0, tools: Object.freeze({ remove: 2, shake: 1 }), dangerMs: 0, cooldownMs: 0,
    fruits: Object.freeze(fruits.map(fruit => Object.freeze({
      vx: 0.3, vy: 1, angularVelocity: 0.02, ...fruit,
    }))),
  });
}

const EMPTY = frozenState();
const FRUIT_STATE = frozenState([
  { id: 1, tier: 0, x: 60, y: 530, angle: 0.42 },
  { id: 2, tier: 3, x: 220, y: 470, angle: -0.2 },
  { id: 3, tier: 10, x: 320, y: 340, angle: 1.1 },
]);

// Top-level tests run serially: each fixture restores its temporary browser globals.
test('suika fallback draws on the original canvas and preserves application listeners', t => {
  const { canvas, parent, htmlOverlay, created, create } = fixture(t);
  const pointer = t.mock.fn();
  const applicationContextListener = t.mock.fn();
  const onContextLost = t.mock.fn();
  const onContextRestored = t.mock.fn();
  canvas.addEventListener('pointerup', pointer);
  canvas.addEventListener('webglcontextlost', applicationContextListener);
  const renderer = create({ onContextLost, onContextRestored });
  assert.ok(canvas.contextRequests.some(request => request.type === 'webgl2'));
  assert.ok(canvas.contextRequests.some(request => request.type === '2d' && request.options.alpha));
  assert.deepEqual(parent.children, [canvas, htmlOverlay]);
  assert.ok(created.every(element => !element.parentElement), 'art/shadow canvases stay off DOM');
  assert.equal(canvas.style.opacity, '');
  assert.equal(canvas.listeners.size, 2, 'Three failure must remove only its own listeners');
  assert.deepEqual([...canvas.listeners.get('webglcontextlost')], [applicationContextListener]);
  renderer.render(EMPTY, { showAim: false });
  assert.deepEqual(canvas.commands('clearRect').at(-1), [0, 0, 440, 620]);
  canvas.dispatchEvent(new Event('pointerup'));
  assert.equal(pointer.mock.callCount(), 1);
  assert.equal(onContextLost.mock.callCount(), 0);
  assert.equal(onContextRestored.mock.callCount(), 0);
});

test('suika fallback caps DPR, resizes explicitly and synchronizes CSS size/DPR on render', t => {
  const { canvas, create } = fixture(t, { dpr: 3 });
  const renderer = create();
  assert.deepEqual([canvas.width, canvas.height], [660, 930]);
  renderer.resize(220, 310);
  assert.deepEqual([canvas.width, canvas.height], [330, 465]);
  canvas.clientWidth = 330;
  canvas.clientHeight = 465;
  renderer.render(EMPTY, { showAim: false });
  assert.deepEqual([canvas.width, canvas.height], [495, 698]);
  assert.deepEqual(canvas.commands('setTransform').at(-1), [1.125, 0, 0, 1.125, 0, 0]);
  globalThis.devicePixelRatio = 1.25;
  renderer.render(EMPTY, { showAim: false });
  assert.deepEqual([canvas.width, canvas.height], [413, 581]);
  globalThis.devicePixelRatio = 0.5;
  renderer.render(EMPTY, { showAim: false });
  assert.deepEqual([canvas.width, canvas.height], [330, 465], 'backing resolution does not drop below 1x');
  canvas.clientWidth = canvas.clientHeight = 0;
  renderer.resize(220, 310);
  renderer.render(EMPTY, { showAim: false });
  assert.deepEqual([canvas.width, canvas.height], [220, 310], 'unmeasured canvas uses the last requested size');
});

test('suika fallback keeps state immutable and honors preview, angle and removal presentation', t => {
  const { canvas, create } = fixture(t);
  const renderer = create();
  const before = structuredClone(FRUIT_STATE);
  renderer.render(FRUIT_STATE, { aimX: 220, showAim: false });
  assert.equal(canvas.commands('drawImage').length, 6, 'three shadows plus three fruits, no preview');
  assert.deepEqual(canvas.commands('rotate').map(([angle]) => angle), [0.42, -0.2, 1.1]);
  assert.equal(canvas.commands('arc').length, 0, 'hidden aim has no landing ring');
  canvas.calls.length = 0;
  renderer.render(FRUIT_STATE, { aimX: 220, showAim: true });
  assert.equal(canvas.commands('drawImage').length, 7);
  assert.deepEqual(canvas.commands('translate').at(-1), [220, 58]);
  // The higher watermelon intersects this drop column despite its offset center.
  const landingY = 340 - Math.sqrt((FRUITS[3].radius + FRUITS[10].radius) ** 2 - 100 ** 2);
  assert.ok(canvas.commands('lineTo').some(([x, y]) => x === 220 && y === landingY),
    'aim ends at the first fruit collision, not behind the pile');
  canvas.calls.length = 0;
  renderer.render(FRUIT_STATE, { showAim: true, removeMode: true });
  assert.equal(canvas.commands('drawImage').length, 6, 'removal mode hides the preview');
  assert.deepEqual(canvas.commands('arc').map(args => args.slice(0, 3)),
    FRUIT_STATE.fruits.map(fruit => [fruit.x, fruit.y, FRUITS[fruit.tier].radius + 3]));
  assert.deepEqual(FRUIT_STATE, before);
});

test('suika clearEffects immediately removes bursts without clearing fruit or changing state', t => {
  const { canvas, create, clock } = fixture(t);
  const renderer = create({ reducedMotion: true });
  const before = structuredClone(FRUIT_STATE);
  for (const type of ['merge', 'remove', 'drop', 'shake', 'over']) {
    renderer.burst(Object.freeze({ type, tier: 10, x: 220, y: 280, collected: true }));
  }
  renderer.render(FRUIT_STATE, { showAim: false, time: clock.time });
  assert.ok(canvas.commands('arc').length > 5, 'both burst rings and juice particles were rendered');
  renderer.clearEffects();
  renderer.clearEffects();
  canvas.calls.length = 0;
  renderer.render(FRUIT_STATE, { showAim: false, time: clock.time });
  assert.equal(canvas.commands('arc').length, 0, 'effects are gone even without advancing the clock');
  assert.equal(canvas.commands('drawImage').length, 6, 'clearEffects does not clear the pile');
  renderer.burst({ type: 'drop', tier: 0 });
  clock.time += 3000;
  canvas.calls.length = 0;
  renderer.render(FRUIT_STATE, { showAim: false, time: clock.time });
  assert.equal(canvas.commands('arc').length, 0, 'expired effects are also pruned');
  assert.deepEqual(FRUIT_STATE, before);
});

test('suika fallback dispose clears once, releases its shadow and makes subsequent calls inert', t => {
  const { canvas, create } = fixture(t);
  const pointer = t.mock.fn();
  canvas.addEventListener('pointerup', pointer);
  const renderer = create();
  renderer.render(FRUIT_STATE, { showAim: false });
  const shadow = canvas.commands('drawImage')[0][0];
  assert.deepEqual([shadow.width, shadow.height], [64, 64]);
  canvas.calls.length = 0;
  renderer.dispose();
  assert.deepEqual(canvas.commands('clearRect'), [[0, 0, 440, 620]]);
  assert.deepEqual([shadow.width, shadow.height], [0, 0]);
  const callsAfterDispose = canvas.calls.length;
  renderer.dispose();
  renderer.resize(100, 100);
  renderer.burst({ type: 'merge', tier: 2, x: 10, y: 10 });
  renderer.clearEffects();
  renderer.render(FRUIT_STATE);
  assert.equal(canvas.calls.length, callsAfterDispose);
  assert.deepEqual([canvas.width, canvas.height], [440, 620]);
  assert.equal(canvas.removeCount, 0);
  canvas.dispatchEvent(new Event('pointerup'));
  assert.equal(pointer.mock.callCount(), 1, 'renderer does not remove application input handlers');
});

test('suika locked-context fallback keeps input canvas and places its surface below HTML overlays', t => {
  const { canvas, parent, htmlOverlay, create } = fixture(t, { locked: true, dpr: 3 });
  const pointer = t.mock.fn();
  canvas.addEventListener('pointerup', pointer);
  canvas.style.opacity = '0.85';
  const renderer = create();
  const surface = parent.children[1];
  assert.notEqual(surface, canvas);
  assert.deepEqual(parent.children, [canvas, surface, htmlOverlay]);
  assert.equal(canvas.style.opacity, '0');
  assert.equal(surface.attributes.get('aria-hidden'), 'true');
  assert.match(surface.style.cssText, /pointer-events\s*:\s*none/);
  assert.deepEqual([surface.style.left, surface.style.top, surface.style.width, surface.style.height],
    ['32px', '42px', '440px', '620px']);
  assert.deepEqual([surface.width, surface.height], [660, 930]);
  renderer.render(FRUIT_STATE, { showAim: false });
  assert.equal(surface.commands('drawImage').length, 6);
  assert.equal(canvas.calls.length, 0, 'the locked canvas is not used for 2D drawing');
  canvas.clientWidth = 220;
  canvas.clientHeight = 310;
  canvas.rect = { left: 50, top: 80, width: 220, height: 310 };
  renderer.render(EMPTY, { showAim: false });
  assert.deepEqual([surface.style.left, surface.style.top, surface.style.width, surface.style.height],
    ['42px', '62px', '220px', '310px']);
  assert.deepEqual([surface.width, surface.height], [330, 465]);
  canvas.dispatchEvent(new Event('pointerup'));
  assert.equal(pointer.mock.callCount(), 1);
  renderer.dispose();
  renderer.dispose();
  assert.deepEqual(parent.children, [canvas, htmlOverlay]);
  assert.equal(surface.removeCount, 1);
  assert.equal(canvas.removeCount, 0);
  assert.equal(canvas.style.opacity, '0.85');
  assert.equal(canvas.listeners.get('pointerup').has(pointer), true);
});

test('suika unavailable locked-context helper rolls back DOM and original opacity', t => {
  const { canvas, parent, htmlOverlay, created, create } = fixture(t, { locked: true, helperAvailable: false });
  canvas.style.opacity = '0.7';
  assert.throws(() => create(), /Neither WebGL nor Canvas 2D is available/);
  assert.deepEqual(parent.children, [canvas, htmlOverlay]);
  assert.equal(canvas.style.opacity, '0.7');
  assert.equal(canvas.listeners.size, 0, 'failed Three context listeners are removed');
  assert.equal(created[0].removeCount, 1);
});
