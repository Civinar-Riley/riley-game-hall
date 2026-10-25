import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const gameScripts = name => {
  const html = fs.readFileSync(new URL(`../../public/games/${name}.html`, import.meta.url), 'utf8');
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
  assert(scripts.length, `No inline scripts in ${name}.html`);
  return scripts;
};
const section = (source, start, end) => {
  const from = source.indexOf(start);
  const to = end ? source.indexOf(end, from) : source.length;
  assert(from >= 0 && to > from, `Missing script section: ${start}`);
  return source.slice(from, to);
};

// Small DOM, event, storage and clock doubles. Game rules and keypress come from
// the checked-in HTML; bundled jQuery, browser layout and frame scheduling are stubbed.
export function environment(seed = 1, ua = 'Desktop') {
  let time = 1000, nextTimer = 1, state = seed >>> 0;
  const queue = new Map(), elements = new Map(), memory = new Map(), writes = [];
  const math = Object.create(Math);
  math.random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const canvasContext = new Proxy({ measureText: text => ({ width: text.length * 6 }) }, {
    get: (target, key) => key in target ? target[key] : () => {}
  });
  class Target {
    constructor(id) {
      Object.assign(this, {
        id, handlers: {}, style: {}, attrs: {}, dataset: {}, visible: false,
        width: 1024, height: 720, offsetHeight: 20, parentNode: null,
        innerHTML: '', textContent: '', classes: new Set()
      });
      this.classList = {
        add: name => this.classes.add(name),
        remove: name => this.classes.delete(name),
        contains: name => this.classes.has(name)
      };
    }
    addEventListener(type, fn) { (this.handlers[type] ||= []).push(fn); }
    removeEventListener(type, fn) {
      this.handlers[type] = (this.handlers[type] || []).filter(handler => handler !== fn);
    }
    dispatch(type, details = {}) {
      const event = {
        type, target: this, keyCode: 0, defaultPrevented: false, stopped: false,
        preventDefault() { this.defaultPrevented = true; },
        stopPropagation() { this.stopped = true; },
        ...details
      };
      for (let target = this; target; target = event.stopped ? null : target.parentNode) {
        event.currentTarget = target;
        for (const fn of [...(target.handlers[type] || [])]) fn.call(target, event);
        if (typeof target[`on${type}`] === 'function' && target[`on${type}`](event) === false) {
          event.preventDefault();
        }
      }
      return event;
    }
    getContext() { return canvasContext; }
    getAttribute(key) { return this.attrs[key] ?? this[key]; }
    setAttribute(key, value) { this.attrs[key] = value; }
  }
  const document = new Target('document');
  document.body = new Target('body');
  document.body.parentNode = document;
  document.readyState = 'complete';
  document.documentElement = new Target('html');
  const element = id => {
    if (!elements.has(id)) {
      const target = new Target(id);
      target.parentNode = document.body;
      elements.set(id, target);
    }
    return elements.get(id);
  };
  document.getElementById = element;
  document.querySelectorAll = selector => selector === '#table .seat' ? [1, 2, 3].map(i => {
    const seat = element(`seat${i}`);
    seat.dataset.i = String(i);
    return seat;
  }) : [];
  const ctx = Object.assign(new Target('window'), {
    console, Math: math, Float32Array, Map, Set, Image: class {}, document,
    navigator: { userAgent: ua, maxTouchPoints: ua === 'Desktop' ? 0 : 1 },
    innerWidth: 1024, innerHeight: 720,
    Date: class extends Date { static now() { return time; } },
    setTimeout(fn, delay = 0) {
      const id = nextTimer++;
      queue.set(id, { fn, at: time + Number(delay) });
      return id;
    },
    clearTimeout(id) { queue.delete(id); },
    requestAnimationFrame() {},
    localStorage: {
      getItem: key => memory.get(key) ?? null,
      setItem(key, value) { memory.set(key, String(value)); writes.push([key, String(value)]); },
      removeItem: key => memory.delete(key)
    },
    getComputedStyle() { return { getPropertyValue() { return ''; } }; },
    Cookies: { set() {} }
  });
  ctx.window = ctx;
  document.parentNode = ctx;
  const data = new WeakMap();
  function jq(arg) {
    const el = typeof arg === 'string' ? element(arg.startsWith('#') ? arg.slice(1) : arg) : arg;
    return {
      0: el, length: 1,
      bind(events, fn) {
        for (const event of events.split(' ')) {
          const [type, namespace] = event.split('.');
          const handler = function(e) {
            if (fn.call(this, e) === false) { e.preventDefault(); e.stopPropagation(); }
          };
          handler.namespace = namespace;
          el.addEventListener(type, handler);
        }
        return this;
      },
      on(events, selector, fn) { return this.bind(events, fn || selector); },
      unbind(events) {
        for (const event of events.split(' ')) {
          const [type, namespace] = event.split('.');
          el.handlers[type] = namespace ? (el.handlers[type] || []).filter(fn => fn.namespace !== namespace) : [];
        }
        return this;
      },
      off(events) { if (events) return this.unbind(events); el.handlers = {}; return this; },
      ready() { return this; }, // Loaders initialize explicitly after loading all scripts.
      resize(fn) { return this.on('resize', fn); },
      unload(fn) { return this.on('unload', fn); },
      click(fn) { return this.on('click', fn); },
      show() { el.visible = true; return this; },
      hide() { el.visible = false; return this; },
      fadeIn() { return this.show(); },
      fadeOut() { return this.hide(); },
      fadeToggle() { el.visible = !el.visible; return this; },
      is() { return el.visible; },
      css(key, value) { if (value === undefined) return el.style[key]; el.style[key] = value; return this; },
      attr(key, value) {
        if (value === undefined) return el.attrs?.[key] ?? el[key];
        if (el.attrs) el.attrs[key] = value;
        el[key] = value;
        return this;
      },
      text(value) { if (value === undefined) return el.textContent; el.textContent = String(value); return this; },
      html(value) { if (value === undefined) return el.innerHTML; el.innerHTML = value; return this; },
      width() { return el === ctx ? ctx.innerWidth : el.width; },
      height() { return el === ctx ? ctx.innerHeight : el.height; },
      innerWidth() { return this.width(); }, innerHeight() { return this.height(); },
      offset() { return { top: 600, left: 0 }; },
      addClass(name) { el.classes.add(name); return this; },
      removeClass(name) { el.classes.delete(name); return this; },
      hasClass(name) { return el.classes.has(name); },
      toggleClass(name, on) { if (on) el.classes.add(name); else el.classes.delete(name); return this; },
      append() { return this; }, appendTo() { return this; }, remove() { return this; },
      find(selector) { return jq(selector); }, get() { return el; }
    };
  }
  jq.extend = (...args) => {
    const deep = args[0] === true;
    if (deep) args.shift();
    const target = args.shift();
    for (const source of args) for (const [key, value] of Object.entries(source || {})) {
      target[key] = deep && value && typeof value === 'object'
        ? jq.extend(true, Array.isArray(value) ? [] : {}, value) : value;
    }
    return target;
  };
  jq.each = (obj, fn) => Object.entries(obj).forEach(([key, value]) => fn(key, value));
  jq.isArray = Array.isArray;
  jq.data = (obj, key, value) => {
    if (!data.has(obj)) data.set(obj, {});
    const stored = data.get(obj);
    if (value !== undefined) stored[key] = value;
    return stored[key];
  };
  jq.widget = (_, proto) => { ctx.plugin = proto; };
  ctx.$ = ctx.jQuery = jq;
  vm.createContext(ctx);
  const run = (code, filename = 'arcade-vm.js') => vm.runInContext(code, ctx, { filename, timeout: 10000 });
  const nextTimerEntry = () => [...queue].sort((a, b) => a[1].at - b[1].at)[0];
  const next = () => {
    const item = nextTimerEntry();
    if (!item) return false;
    queue.delete(item[0]);
    time = Math.max(time, item[1].at);
    item[1].fn();
    return true;
  };
  const advanceTime = ms => {
    const end = time + ms;
    let ticks = 0;
    for (;;) {
      const item = nextTimerEntry();
      if (!item || item[1].at > end) break;
      assert(++ticks <= 10000, 'Timer loop did not settle');
      next();
    }
    time = end;
  };
  return { ctx, run, next, advanceTime, queue, element, memory, writes, jq };
}

export function blockrain(fixedRandom) {
  const env = environment();
  if (fixedRandom !== undefined) env.ctx.Math.random = () => fixedRandom;
  const source = gameScripts('blockrain').find(script => script.includes("$.widget('aerolab.blockrain'"));
  assert(source, 'Blockrain widget script is missing');
  env.run(source, 'blockrain-plugin.js');
  const proto = env.ctx.plugin;
  const trace = [];
  const game = Object.assign(Object.create(proto), {
    options: {
      ...proto.options, showFieldOnStart: false,
      onGameOver: score => trace.push(['over', score]),
      onPlaced: () => trace.push(['place']), onLine: (...args) => trace.push(['line', ...args])
    },
    _BLOCK_WIDTH: 10, _BLOCK_HEIGHT: 20, _PIXEL_WIDTH: 200, _PIXEL_HEIGHT: 400, _block_size: 20,
    _theme: { blocks: Object.fromEntries(Object.keys(proto._shapes).map(key => [key, '#ffffff'])) },
    element: env.jq('#board'), _$start: env.jq('#start'), _$gameover: env.jq('#over'),
    _$score: env.jq('#score'), _$scoreText: env.jq('#scoreText'),
    _ctx: env.element('canvas').getContext()
  });
  for (const control of ['Left', 'Right', 'Drop', 'RotateLeft', 'RotateRight']) {
    game[`_$touch${control}`] = env.jq(`#touch${control}`);
  }
  game._SetupShapeFactory(); game._SetupFilled(); game._SetupInfo(); game._SetupBoard();
  game._info.init(); game._setupControls(true); game._setupTouchControls(true); game.start();
  return { ...env, game, trace };
}

export function hextris(ua = 'Desktop') {
  const env = environment(1, ua);
  env.memory.set('hex_sound', 'off');
  const all = gameScripts('hextris');
  const main = all.find(script => script.includes('/* ===== upstream: input.js ===== */'));
  assert(main, 'Hextris main script is missing');
  env.run(section(main, '/* ===== upstream: jsonfn.min.js ===== */', '/* ===== upstream: keypress.min.js ===== */'), 'hextris-jsonfn.js');
  env.run(section(main, '/* ===== upstream: keypress.min.js ===== */', '/* ===== upstream: jquery.js ===== */'), 'hextris-keypress.js');
  env.run(section(main, '/* ===== upstream: save-state.js ===== */'), 'hextris-game.js');
  const sound = all.find(script => script.includes('var ZZFX ='));
  assert(sound, 'Hextris sound script is missing');
  env.run(sound, 'hextris-sound.js');
  env.run('initialize()');
  env.advanceTime(2);
  return env;
}

export function zhajinhua(seed = 1) {
  const env = environment(seed);
  env.memory.set('zjh_sound', 'off');
  const source = gameScripts('zhajinhua').find(script => script.includes('function payout('));
  assert(source, 'Zhajinhua game script is missing');
  env.run(source, 'zhajinhua-game.js');
  // Observe the real payout; do not replace any settlement rules.
  env.run(`var payoutRecords = []; var originalPayout = payout; payout = function(fallback) {
    var input = S.players.map(p => ({ idx:p.idx, name:p.name, chips:p.chips, invested:p.invested, paid:p.paid, folded:p.folded, looked:p.looked, allIn:p.allIn, hand:p.hand }));
    var pot = S.pot; var orbit = S.orbit; var result = originalPayout(fallback);
    payoutRecords.push({ input, pot, orbit, fallback:fallback.idx, result }); return result;
  };`, 'zhajinhua-payout-observer.js');
  return env;
}
