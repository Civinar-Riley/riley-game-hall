import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyBook, loadBook, saveBook, updateRecord, SAVE_KEY } from '../src/games/suika/storage.js';

function memory() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

test('suika saves modes and preferences independently', () => {
  const storage = memory();
  const book = emptyBook();
  book.mode = 'collect';
  book.muted = true;
  book.games.classic = { version: 1, mode: 'classic', score: 17, fruits: [] };
  book.games.collect = { version: 1, mode: 'collect', score: 53, fruits: [] };
  updateRecord(book, { mode: 'classic', score: 17, watermelons: 0 });
  updateRecord(book, { mode: 'collect', score: 53, watermelons: 2 });
  assert.equal(saveBook(storage, book), true);
  assert.deepEqual(loadBook(storage), book);
  updateRecord(book, { mode: 'collect', score: 4, watermelons: 1 });
  assert.deepEqual(book.records.collect, { score: 53, watermelons: 2 });
  book.games.collect = null;
  saveBook(storage, book);
  assert.equal(loadBook(storage).games.classic.score, 17);
  assert.equal(loadBook(storage).records.collect.watermelons, 2);
});

test('suika invalid and unavailable storage cannot prevent a fresh game', () => {
  for (const text of ['{', 'null', '[]', '{"version":2}', 'a'.repeat(250001)]) {
    assert.deepEqual(loadBook({ getItem: () => text }), emptyBook());
  }
  assert.deepEqual(loadBook({ getItem: () => { throw new Error('blocked'); } }), emptyBook());
  assert.equal(saveBook({ setItem: () => { throw new Error('quota'); } }, emptyBook()), false);
});

test('suika records are finite and non-negative; malformed fields stay isolated', () => {
  const storage = memory();
  storage.setItem(SAVE_KEY, JSON.stringify({
    version: 1, mode: 'other', muted: 'true',
    records: { classic: { score: -7, watermelons: '99' }, collect: { score: 900, watermelons: 3 } },
    games: { classic: [], collect: { mode: 'collect' } },
  }));
  const book = loadBook(storage);
  assert.equal(book.mode, 'classic');
  assert.equal(book.muted, false);
  assert.deepEqual(book.records.classic, { score: 0, watermelons: 0 });
  assert.deepEqual(book.records.collect, { score: 900, watermelons: 3 });
  assert.equal(book.games.classic, null);
  assert.deepEqual(book.games.collect, { mode: 'collect' });
});
