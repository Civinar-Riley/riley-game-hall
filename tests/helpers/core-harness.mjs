import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { shimSource } from '../../src/hall/gamesave.js';

export const root = fileURLToPath(new URL('../../', import.meta.url));

class ClassList {
  constructor(el) { this.el = el; }
  values() { return new Set(this.el.className.split(/\s+/).filter(Boolean)); }
  contains(name) { return this.values().has(name); }
  add(...names) { const s = this.values(); names.forEach(n => s.add(n)); this.el.className = [...s].join(' '); }
  remove(...names) { const s = this.values(); names.forEach(n => s.delete(n)); this.el.className = [...s].join(' '); }
  toggle(name, force) {
    const on = force === undefined ? !this.contains(name) : !!force;
    if (on) this.add(name); else this.remove(name);
    return on;
  }
}

export class Element {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.className = '';
    this.classList = new ClassList(this);
    this.style = { setProperty(k, v) { this[k] = v; } };
    this.dataset = {};
    this.attributes = {};
    this.children = [];
    this.listeners = new Map();
    this.selectorCache = new Map();
    this.disabled = false;
    this.parentNode = null;
    this.id = '';
    this.clientWidth = 700;
    this.offsetWidth = 700;
    this._text = '';
    this._html = '';
  }
  set textContent(v) { this._text = String(v); this.children = []; this.selectorCache.clear(); }
  get textContent() { return this._text; }
  set innerHTML(v) { this._html = String(v); this.children = []; this.selectorCache.clear(); }
  get innerHTML() { return this._html; }
  get firstChild() { return this.children[0] || null; }
  appendChild(el) {
    if (el.parentNode) el.parentNode.removeChild(el);
    el.parentNode = this;
    this.children.push(el);
    return el;
  }
  removeChild(el) { this.children = this.children.filter(x => x !== el); el.parentNode = null; return el; }
  remove() { this.parentNode?.removeChild(this); }
  setAttribute(k, v) {
    this.attributes[k] = String(v);
    if (k === 'class') this.className = String(v);
    if (k === 'id') this.id = String(v);
    if (k.startsWith('data-')) this.dataset[k.slice(5)] = String(v);
  }
  setAttributeNS(_ns, k, v) { this.setAttribute(k, v); }
  getAttribute(k) { return this.attributes[k] ?? null; }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }
  removeEventListener(type, fn) { this.listeners.set(type, (this.listeners.get(type) || []).filter(x => x !== fn)); }
  dispatch(type, event = {}) {
    const e = { target: this, preventDefault() {}, stopPropagation() {}, ...event };
    for (const fn of [...(this.listeners.get(type) || [])]) fn(e);
  }
  click() { if (!this.disabled) this.dispatch('click'); }
  matches(selector) {
    if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    return this.tagName.toLowerCase() === selector;
  }
  querySelectorAll(selector) {
    const found = [];
    const visit = e => { for (const child of e.children) { if (child.matches(selector)) found.push(child); visit(child); } };
    visit(this);
    return found;
  }
  querySelector(selector) {
    const found = this.querySelectorAll(selector)[0];
    if (found) return found;
    // Rendering-only nodes (lane HTML, card faces) need a lightweight stand-in.
    if (!this.selectorCache.has(selector)) {
      const node = new Element(selector.startsWith('.') ? 'span' : selector);
      if (selector.startsWith('.')) node.className = selector.slice(1);
      this.selectorCache.set(selector, node);
    }
    return this.selectorCache.get(selector);
  }
  closest(selector) {
    if (selector === '#board div' && /^\d+-\d+$/.test(this.id)) return this;
    for (let cur = this; cur; cur = cur.parentNode) if (cur.matches(selector)) return cur;
    return null;
  }
  getTotalLength() { return 100; }
}

class Document extends Element {
  constructor(html) {
    super('document');
    this.elements = new Map();
    this.body = new Element('body');
    this.documentElement = new Element('html');
    this.documentElement.appendChild(this.body);
    for (const m of html.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*)>/g)) {
      const attrs = Object.fromEntries([...m[2].matchAll(/([\w-]+)="([^"]*)"/g)].map(x => [x[1], x[2]]));
      if (!attrs.id && !attrs.class?.includes('difficulty-btn')) continue;
      const el = new Element(m[1]);
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
      el.disabled = /\bdisabled\b/.test(m[2]);
      this.body.appendChild(el);
      if (attrs.id) this.elements.set(attrs.id, el);
    }
  }
  getElementById(id) { return this.elements.get(id) || null; }
  createElement(tag) { return new Element(tag); }
  createElementNS(_ns, tag) { return new Element(tag); }
  querySelectorAll(selector) { return this.body.querySelectorAll(selector); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

export class Clock {
  constructor() { this.now = 1_000_000; this.nextId = 1; this.timers = new Map(); this.frames = new Map(); }
  setTimeout = (fn, delay = 0) => { const id = this.nextId++; this.timers.set(id, { fn, at: this.now + delay }); return id; };
  clearTimeout = id => { this.timers.delete(id); };
  setInterval = (fn, delay = 0) => { const id = this.nextId++; this.timers.set(id, { fn, at: this.now + delay, period: delay }); return id; };
  requestAnimationFrame = fn => { const id = this.nextId++; this.frames.set(id, fn); return id; };
  cancelAnimationFrame = id => { this.frames.delete(id); };
  advance(ms) {
    const end = this.now + ms;
    let turns = 0;
    while (true) {
      const pending = [...this.timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0]);
      if (!pending.length) break;
      if (++turns > 10000) throw new Error('Timer loop exceeded test bound');
      const [id, t] = pending[0];
      this.now = t.at;
      this.timers.delete(id);
      if (t.period) this.timers.set(id, { ...t, at: this.now + t.period });
      t.fn();
    }
    this.now = end;
  }
  frameAt(time) {
    this.advance(time - this.now);
    const callbacks = [...this.frames];
    this.frames.clear();
    callbacks.forEach(([, fn]) => fn(this.now));
  }
}

export function seedRandom(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(1664525, s) + 1013904223) >>> 0; return s / 4294967296; };
}

export function boot(name, { seed = 1, saved = {}, shim = true } = {}) {
  const filename = `${root}public/games/${name}.html`;
  const html = fs.readFileSync(filename, 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/i)?.[1];
  if (!script) throw new Error('Inline script missing');
  const document = new Document(html);
  const clock = new Clock();
  const storage = new Map(Object.entries(saved));
  const snapshots = [];
  const events = new Map();
  const math = Object.create(Math);
  math.random = seedRandom(seed);
  const context = {
    document,
    console: { log() {}, error(...args) { throw new Error(args.map(String).join(' ')); } },
    localStorage: {
      getItem(k) { return storage.get(String(k)) ?? null; },
      setItem(k, v) { storage.set(String(k), String(v)); },
      removeItem(k) { storage.delete(String(k)); },
      clear() { storage.clear(); }
    },
    parent: { postMessage(value) { snapshots.push(structuredClone(value)); } },
    Math: math,
    Date: class extends Date { static now() { return clock.now; } },
    performance: { now: () => clock.now },
    navigator: {},
    innerWidth: 1280,
    innerHeight: 900,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    setInterval: clock.setInterval,
    clearInterval: clock.clearTimeout,
    requestAnimationFrame: clock.requestAnimationFrame,
    cancelAnimationFrame: clock.cancelAnimationFrame,
    getComputedStyle: () => ({ getPropertyValue: () => '#0088ff' }),
    addEventListener(type, fn) {
      if (!events.has(type)) events.set(type, []);
      events.get(type).push(fn);
    },
    removeEventListener(type, fn) { events.set(type, (events.get(type) || []).filter(x => x !== fn)); }
  };
  context.window = context;
  vm.createContext(context);
  if (shim) {
    const sh = shimSource(`${name}.html`, JSON.stringify(saved)).replace(/^<script>/, '').replace(/<\/script>$/, '');
    vm.runInContext(sh, context, { filename: 'gamesave-shim.js' });
  }
  vm.runInContext(script, context, { filename, timeout: 10000 });
  context.onload?.();
  const game = context.__blackjack || context.__horseRacing;
  if (game) game.sfx.enabled = false;
  return {
    context, document, clock, game, snapshots,
    eval: code => vm.runInContext(code, context, { timeout: 10000 }),
    fire(type) { for (const fn of events.get(type) || []) fn(); }
  };
}

// Deterministic legal shoe order: move actual cards from the six-deck shoe.
export function drawNext(game, ranks) {
  const draw = ranks.map(rank => {
    const index = game.deck.cards.findIndex(c => c.rank === rank);
    if (index < 0) throw new Error(`Missing card rank ${rank}`);
    return game.deck.cards.splice(index, 1)[0];
  });
  game.deck.cards.push(...draw.reverse());
}

export function betBlackjack(game, amount = 100) {
  const chip = game.el.betChips.children.find(e => Number(e.dataset.value) === amount);
  if (!chip) throw new Error('Requested denomination not rendered');
  chip.click();
  game.el.btnDeal.click();
}
