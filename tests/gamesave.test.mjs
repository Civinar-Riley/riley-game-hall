import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { SAVE_LIMIT, saveKey, validateSavePayload, shimSource } from '../src/hall/gamesave.js';

test('save messages validate a string session alongside file and data', () => {
  const message = { __opgSave: 1, file: 'blackjack.html', session: 'load-7', data: { chips: '100' } };
  assert.deepEqual(validateSavePayload(message), { file: message.file, session: message.session, data: message.data });
  for (const invalid of [undefined, null, 1, {}, []]) {
    assert.equal(validateSavePayload({ ...message, session: invalid }), null);
  }
  for (const data of [null, [], 'bad', { chips: 100 }, { chips: 'x'.repeat(SAVE_LIMIT) }]) {
    assert.equal(validateSavePayload({ ...message, data }), null);
  }
  assert.equal(validateSavePayload({ ...message, file: '' }), null);
  assert.equal(validateSavePayload({ ...message, __opgSave: 0 }), null);
  assert.equal(saveKey('../BLACK JACK.html'), 'gameHall_sv_.._black_jack.html');
});

test('the storage shim preserves session identity for every update and pagehide', () => {
  const messages = [], events = new Map();
  const context = {
    parent: { postMessage: message => messages.push(structuredClone(message)) },
    addEventListener: (type, fn) => events.set(type, fn),
  };
  context.window = context;
  const script = shimSource('blackjack.html', '{"chips":"100"}', 'load-7');
  vm.runInNewContext(script.slice('<script>'.length, -'</script>'.length), context);
  const store = context.localStorage;
  assert.equal(store.getItem('chips'), '100');
  store.setItem('chips', 200);
  store.setItem('sound', 'off');
  assert.equal(store.length, 2);
  assert.equal(store.key(0), 'chips');
  store.removeItem('sound');
  events.get('pagehide')();
  store.clear();
  assert.equal(store.length, 0);
  assert.equal(store.getItem('chips'), null);
  assert.equal(messages.length, 5);
  for (const message of messages) {
    assert.equal(message.session, 'load-7');
    assert.equal(message.file, 'blackjack.html');
    assert.ok(validateSavePayload(message));
  }
  assert.deepEqual(messages[3].data, { chips: '200' });
  assert.deepEqual(messages[4].data, {});
});

test('shim escapes script delimiters in filenames, data and session identifiers', () => {
  const injection = '</script><script>unexpected()</script>';
  const source = shimSource(injection, JSON.stringify({ value: injection }), injection);
  assert.equal(source.indexOf('</script>'), source.length - '</script>'.length);
  const messages = [];
  const context = { parent: { postMessage: message => messages.push(message) }, addEventListener() {} };
  context.window = context;
  vm.runInNewContext(source.slice(8, -9), context);
  assert.equal(context.localStorage.getItem('value'), injection);
  context.localStorage.setItem('ok', 'yes');
  assert.equal(messages[0].file, injection);
  assert.equal(messages[0].session, injection);
});
