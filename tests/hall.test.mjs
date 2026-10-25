import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { saveKey, validateSavePayload, shimSource } from '../src/hall/gamesave.js';

const source = (await readFile(new URL('../src/hall/hall.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\r?\n/gm, '');

function hall(initial = {}, confirmed = true) {
  const storage = new Map(Object.entries(initial));
  const handlers = new Map(), events = new Map(), nodes = new Map(), timers = new Map();
  const requests = [];
  let timerId = 0;
  function node(selector) {
    if (!nodes.has(selector)) {
      const classes = new Set();
      nodes.set(selector, {
        textContent: '', innerHTML: '', srcdoc: '', contentWindow: {},
        classList: {
          add: name => classes.add(name), remove: name => classes.delete(name),
          toggle: (name, on) => on ? classes.add(name) : classes.delete(name),
          contains: name => classes.has(name),
        },
        addEventListener: (type, fn) => handlers.set(`${selector}:${type}`, fn),
        removeAttribute(name) { this[name] = ''; },
      });
    }
    return nodes.get(selector);
  }
  const document = { querySelector: node, querySelectorAll: () => [], title: '' };
  const context = vm.createContext({
    document, window: { addEventListener: (type, fn) => events.set(type, fn) },
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: key => storage.delete(key),
    },
    fetch: url => new Promise((resolve, reject) => requests.push({ url, resolve, reject })),
    confirm: () => confirmed,
    setTimeout: fn => { timers.set(++timerId, fn); return timerId; },
    clearTimeout: id => timers.delete(id),
    console: { log() {} }, saveKey, validateSavePayload, shimSource,
    themeCss: '', __HALL_BUILD__: 'test',
  });
  vm.runInContext(source, context, { filename: 'src/hall/hall.js' });
  const run = code => vm.runInContext(code, context);
  const frame = node('#gameFrame');
  function respond(index, marker = 'GAME') {
    requests[index].resolve({ ok: true, text: async () => `<html><head></head><body>${marker}</body></html>` });
  }
  const active = () => run('knownFrames.get(document.querySelector("#gameFrame").contentWindow)');
  function message(data, sender = active(), origin = frame.contentWindow) {
    events.get('message')({ source: origin, data: { __opgSave: 1, ...sender, data } });
  }
  async function open(index, marker) {
    const promise = run(`playGame(${index})`);
    respond(requests.length - 1, marker);
    await promise;
  }
  function flushTimers() {
    const callbacks = [...timers.values()];
    timers.clear();
    for (const fn of callbacks) fn();
  }
  return { storage, handlers, events, requests, node, frame, run, respond, active, message, open, flushTimers, timers };
}

const settle = () => new Promise(resolve => setImmediate(resolve));

test('clearing discards pending saves and rejects old-frame snapshots before and after reload', async () => {
  const h = hall();
  await h.open(0);
  const old = h.active();
  h.message({ wallet: '975' });
  h.handlers.get('#btnClearSave:click')();
  h.message({ wallet: '974' }, old);
  h.respond(1, 'CLEARED');
  await settle();
  assert.ok(h.frame.srcdoc.includes('var m={}'));
  assert.notEqual(h.active().session, old.session);
  h.message({ wallet: '973' }, old);
  h.flushTimers();
  assert.equal(h.storage.get(saveKey('blackjack.html')), undefined);
  h.message({ wallet: '1000' });
  h.flushTimers();
  assert.deepEqual(JSON.parse(h.storage.get(saveKey('blackjack.html'))), { wallet: '1000' });
});

test('clearing an already-flushed save does not affect another game', async () => {
  const other = '{"ms_sound":"off"}';
  const h = hall({ [saveKey('blackjack.html')]: '{"wallet":"900"}', [saveKey('minesweeper.html')]: other });
  await h.open(0);
  const old = h.active();
  h.handlers.get('#btnClearSave:click')();
  h.respond(1);
  await settle();
  h.message({ wallet: '900' }, old);
  h.flushTimers();
  assert.equal(h.storage.get(saveKey('blackjack.html')), undefined);
  assert.equal(h.storage.get(saveKey('minesweeper.html')), other);
});

test('cancelling the clear confirmation preserves the active session and pending save', async () => {
  const h = hall({}, false);
  await h.open(0);
  const before = h.active();
  h.message({ wallet: '900' });
  h.handlers.get('#btnClearSave:click')();
  h.flushTimers();
  assert.equal(h.requests.length, 1);
  assert.equal(h.active(), before);
  assert.equal(h.storage.get(saveKey('blackjack.html')), '{"wallet":"900"}');
});

test('returning and selecting another game makes an earlier fetch inert', async () => {
  const h = hall();
  const old = h.run('playGame(0)');
  h.run('backToWall()');
  await h.open(1, 'CURRENT_MINESWEEPER');
  h.respond(0, 'STALE_BLACKJACK');
  await old;
  assert.ok(h.frame.srcdoc.includes('CURRENT_MINESWEEPER'));
  assert.ok(!h.frame.srcdoc.includes('STALE_BLACKJACK'));
  assert.equal(h.active().file, 'minesweeper.html');
  assert.equal(h.run('curGame'), 1);
});

test('returning to the wall prevents a late response from starting a hidden game', async () => {
  const h = hall();
  const pending = h.run('playGame(0)');
  h.run('backToWall()');
  h.respond(0);
  await pending;
  assert.equal(h.frame.srcdoc, '');
  assert.equal(h.active(), undefined);
  assert.equal(h.run('curGame'), null);
});

test('same-game overlapping reloads also keep only the latest response', async () => {
  const h = hall();
  const first = h.run('playGame(0)');
  await h.open(0, 'LATEST');
  h.respond(0, 'OLDER');
  await first;
  assert.ok(h.frame.srcdoc.includes('LATEST'));
  assert.ok(!h.frame.srcdoc.includes('OLDER'));
});

test('late failures cannot replace the current successful loading status', async () => {
  const h = hall();
  const first = h.run('playGame(0)');
  await h.open(1);
  const status = h.node('#playerTip').textContent;
  h.requests[0].reject(new Error('old request failed'));
  await first;
  assert.equal(h.node('#playerTip').textContent, status);
});

test('response bodies that finish late are checked again before injection', async () => {
  const h = hall();
  let finishBody;
  const first = h.run('playGame(0)');
  h.requests[0].resolve({ ok: true, text: () => new Promise(resolve => { finishBody = resolve; }) });
  await settle();
  await h.open(1, 'LATEST');
  finishBody('<head></head><body>OLD_BODY</body>');
  await first;
  assert.ok(h.frame.srcdoc.includes('LATEST'));
});

test('saves received while reload fetches are included in the new frame', async () => {
  const h = hall();
  await h.open(0);
  const old = h.active();
  const reload = h.run('playGame(0)');
  h.message({ wallet: '950' }, old);
  h.respond(1);
  await reload;
  assert.ok(h.frame.srcdoc.includes('var m={"wallet":"950"}'));
  h.message({ wallet: '900' }, old);
  h.flushTimers();
  assert.equal(h.storage.get(saveKey('blackjack.html')), '{"wallet":"950"}');
});

test('save bridge requires the current source, game, and session', async () => {
  const h = hall();
  await h.open(0);
  const current = h.active();
  h.message({ wallet: '1' }, current, {});
  h.message({ wallet: '2' }, { ...current, file: 'minesweeper.html' });
  h.message({ wallet: '3' }, { ...current, session: 'old' });
  h.message({ wallet: 4 });
  h.flushTimers();
  assert.equal(h.storage.size, 0);
  h.message({ wallet: '100' });
  h.events.get('pagehide')();
  assert.equal(h.storage.get(saveKey('blackjack.html')), '{"wallet":"100"}');
  assert.equal(h.timers.size, 0);
});

test('returning to the wall persists pending data and revokes the old frame', async () => {
  const h = hall();
  await h.open(0);
  const old = h.active();
  h.message({ wallet: '100' });
  h.run('backToWall()');
  h.message({ wallet: '50' }, old);
  h.flushTimers();
  assert.equal(h.storage.get(saveKey('blackjack.html')), '{"wallet":"100"}');
});
