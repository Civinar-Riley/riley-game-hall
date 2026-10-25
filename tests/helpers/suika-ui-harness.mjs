import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { FruitGame, FRUITS, WORLD } from '../../src/games/suika/core.js';
import { loadBook, saveBook, updateRecord, SAVE_KEY } from '../../src/games/suika/storage.js';

const mainURL = new URL('../../src/games/suika/main.js', import.meta.url);
// Only import declarations are removed; every controller handler runs unchanged.
const source = readFileSync(mainURL, 'utf8').replace(/^import .*;\r?\n/gm, '');
const script = new vm.Script(`'use strict';\n${source}`, { filename: fileURLToPath(mainURL) });
const html = readFileSync(new URL('../../src/games/suika/game.html', import.meta.url), 'utf8');

export function fruit(id, tier, x, y, extra = {}) {
  return {
    id, tier, x, y, vx: 0, vy: 0, angle: 0, angularVelocity: 0,
    ageMs: 3000, entered: true, graceMs: 0, ...extra,
  };
}

// Seed through the same public snapshot contract used by real storage.
export function savedGame(mode = 'classic', extra = {}) {
  const game = new FruitGame(mode, { random: () => 0 });
  try {
    return { ...game.snapshot(), phase: 'playing', ...extra };
  } finally {
    game.destroy();
  }
}

export function memoryStorage({ book, text, failRead = false, failWrite = false } = {}) {
  const values = new Map();
  if (book !== undefined) values.set(SAVE_KEY, JSON.stringify(book));
  if (text !== undefined) values.set(SAVE_KEY, text);
  return {
    values, failRead, failWrite, reads: [], attempts: [], writes: [],
    getItem(key) {
      this.reads.push(key);
      if (this.failRead) throw new Error('Storage access denied');
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      this.attempts.push({ key, value: String(value) });
      if (this.failWrite) throw new Error('Storage quota exceeded');
      this.writes.push({ key, value: String(value) });
      values.set(key, String(value));
    },
  };
}

class EventTarget {
  listeners = new Map();
  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }
  dispatch(type, init = {}) {
    const event = {
      type, target: this, currentTarget: this, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      ...init,
    };
    for (const handler of this.listeners.get(type) ?? []) handler(event);
    return event;
  }
}

class Element extends EventTarget {
  constructor(tag, document) {
    super();
    this.tagName = tag.toUpperCase();
    this.ownerDocument = document;
    this.attributes = new Map();
    this.children = [];
    this.hidden = false;
    this.disabled = false;
    this.open = false;
    this.textContent = '';
    this.captures = new Set();
    this.pointerDetails = new Map();
    const classes = new Set();
    this.classList = {
      contains: name => classes.has(name),
      add: name => classes.add(name),
      toggle(name, force = !classes.has(name)) {
        if (force) classes.add(name);
        else classes.delete(name);
        return force;
      },
    };
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  focus() { this.ownerDocument.activeElement = this; }
  click() { if (!this.disabled) return this.dispatch('click'); }
  showModal() { this.open = true; this.focus(); }
  close() { this.open = false; this.dispatch('close'); }
  setPointerCapture(id) { this.captures.add(id); }
  hasPointerCapture(id) { return this.captures.has(id); }
  releasePointerCapture(id) {
    if (this.captures.delete(id)) {
      this.dispatch('lostpointercapture', { ...this.pointerDetails.get(id), pointerId: id });
    }
  }
}

function createDocument() {
  const document = new EventTarget();
  const nodes = new Map();
  document.documentElement = new Element('html', document);
  document.body = new Element('body', document);
  document.activeElement = document.body;
  document.hidden = false;
  document.getElementById = id => nodes.get(id) ?? null;
  document.createElement = tag => new Element(tag, document);
  // Use the real page's IDs, tags, classes and boolean attributes so missing
  // markup is not silently repaired by an auto-creating mock.
  for (const match of html.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*)>/g)) {
    const attrs = Object.fromEntries([...match[2].matchAll(/([\w-]+)="([^"]*)"/g)].map(value => [value[1], value[2]]));
    if (!attrs.id) continue;
    const element = document.createElement(match[1]);
    for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, value);
    element.id = attrs.id;
    element.hidden = /\bhidden\b/.test(match[2]);
    element.disabled = /\bdisabled\b/.test(match[2]);
    for (const name of (attrs.class ?? '').split(/\s+/).filter(Boolean)) element.classList.add(name);
    nodes.set(attrs.id, element);
  }
  return document;
}

function createClock() {
  let nextId = 0;
  const clock = {
    now: 1000, frames: new Map(), timers: new Map(),
    requestAnimationFrame(fn) { const id = ++nextId; clock.frames.set(id, fn); return id; },
    cancelAnimationFrame(id) { clock.frames.delete(id); },
    setTimeout(fn, delay) { const id = ++nextId; clock.timers.set(id, { fn, at: clock.now + delay }); return id; },
    clearTimeout(id) { clock.timers.delete(id); },
    frame(ms = 1000 / 60) {
      clock.now += ms;
      for (const [id, timer] of [...clock.timers]) {
        if (timer.at <= clock.now) { clock.timers.delete(id); timer.fn(); }
      }
      const callbacks = [...clock.frames.values()];
      clock.frames.clear();
      for (const callback of callbacks) callback(clock.now);
      return callbacks.length;
    },
    advance(ms) {
      const end = clock.now + ms;
      while (clock.now < end) clock.frame(Math.min(1000 / 60, end - clock.now));
    },
  };
  return clock;
}

export function bootSuika(t, { book, storage = memoryStorage({ book }), coarse = true, darkSystem = false } = {}) {
  const document = createDocument();
  const window = new EventTarget();
  const clock = createClock();
  const canvas = document.getElementById('fruitCanvas');
  // Deliberately offset and scaled: input tests exercise client-to-world mapping.
  const bounds = { left: 37, top: 91, width: WORLD.width / 2, height: WORLD.height / 2 };
  canvas.getBoundingClientRect = () => ({ ...bounds });
  const renderer = {
    kind: 'webgl', renders: [], bursts: [], sizes: [], effects: [], themes: [], clearEffectsCalls: 0,
    burst(event) { this.bursts.push(event); this.effects.push(event); },
    clearEffects() { this.clearEffectsCalls++; this.effects.length = 0; },
    resize(width, height) { this.sizes.push({ width, height }); },
    render(state, options) { this.renders.push({ state, options }); },
    setTheme(theme) { this.themes.push(theme); },
  };
  let sound;
  class OrchardSound {
    constructor(muted) { this.muted = muted; this.unlocks = 0; this.events = []; sound = this; }
    unlock() { this.unlocks++; }
    play(event) { this.events.push(event); }
  }
  const context = vm.createContext({
    document, window, localStorage: storage,
    FruitGame, FRUITS, WORLD, loadBook, saveBook, updateRecord,
    fruitIcon: tier => `test-fruit:${tier}`,
    createFruitRenderer: () => renderer,
    OrchardSound,
    matchMedia: query => ({
      matches: (query === '(pointer: coarse)' && coarse) || (query === '(prefers-color-scheme: dark)' && darkSystem),
    }),
    ResizeObserver: class { observe() {} },
    performance: { now: () => clock.now },
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    requestAnimationFrame: clock.requestAnimationFrame, cancelAnimationFrame: clock.cancelAnimationFrame,
  });
  script.runInContext(context, { timeout: 1000 });
  t.after(() => {
    vm.runInContext('game.destroy()', context, { timeout: 1000 });
    clock.frames.clear();
    clock.timers.clear();
  });
  const node = id => {
    const element = document.getElementById(id);
    assert.ok(element, `Missing page element: ${id}`);
    return element;
  };
  const pointer = (type, { x = WORLD.width / 2, y = WORLD.height / 2, ...init } = {}) => {
    const details = {
      pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0,
      clientX: bounds.left + x / WORLD.width * bounds.width,
      clientY: bounds.top + y / WORLD.height * bounds.height,
      ...init,
    };
    assert.ok(Number.isInteger(details.pointerId), 'Pointer events must identify the pointer');
    canvas.pointerDetails.set(details.pointerId, details);
    // Direct-manipulation touch has implicit capture even when main.js ignores
    // a secondary finger. Its release must still send lostpointercapture.
    if (type === 'pointerdown' && details.pointerType === 'touch') {
      canvas.setPointerCapture(details.pointerId);
    }
    if (type === 'lostpointercapture') canvas.captures.delete(details.pointerId);
    const event = canvas.dispatch(type, details);
    if (type === 'pointerup' || type === 'pointercancel') {
      canvas.releasePointerCapture(event.pointerId);
    }
    if (type === 'pointerup' || type === 'pointercancel' || type === 'lostpointercapture') {
      canvas.pointerDetails.delete(event.pointerId);
    }
    return event;
  };
  return {
    document, window, clock, canvas, renderer, sound, storage, node,
    state: () => vm.runInContext('game.getState()', context, { timeout: 1000 }),
    snapshot: () => vm.runInContext('game.snapshot()', context, { timeout: 1000 }),
    saved: () => {
      const value = storage.values.get(SAVE_KEY);
      assert.notEqual(value, undefined, 'Controller must have written a save');
      return JSON.parse(value);
    },
    click(id) {
      const element = node(id);
      if (element.disabled) return;
      element.focus();
      return element.click();
    },
    pointer,
    tap(init) { pointer('pointerdown', init); return pointer('pointerup', init); },
    key(key, init = {}) {
      return document.dispatch('keydown', {
        target: document.activeElement, key, code: key === ' ' ? 'Space' : key,
        repeat: false, ctrlKey: false, metaKey: false, altKey: false, ...init,
      });
    },
    dismissDialog(id) {
      const dialog = node(id);
      const event = dialog.dispatch('cancel');
      if (!event.defaultPrevented) dialog.close();
    },
  };
}
