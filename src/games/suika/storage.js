export const SAVE_KEY = 'suika_orchard_v1';
export const MODES = ['classic', 'collect'];

function record(value) {
  const count = n => Number.isSafeInteger(n) && n >= 0 ? Math.min(n, 1e12) : 0;
  return { score: count(value?.score), watermelons: count(value?.watermelons) };
}

export function emptyBook() {
  return {
    version: 1, mode: 'classic', muted: false,
    records: { classic: record(), collect: record() },
    games: { classic: null, collect: null },
  };
}

export function loadBook(storage) {
  const book = emptyBook();
  try {
    const text = storage.getItem(SAVE_KEY);
    if (!text || text.length > 250000) return book;
    const saved = JSON.parse(text);
    if (!saved || saved.version !== 1) return book;
    book.mode = MODES.includes(saved.mode) ? saved.mode : 'classic';
    book.muted = saved.muted === true;
    for (const mode of MODES) {
      book.records[mode] = record(saved.records?.[mode]);
      const game = saved.games?.[mode];
      if (game && typeof game === 'object' && !Array.isArray(game)) book.games[mode] = game;
    }
  } catch { /* 隐私模式或损坏存档不能阻止新局。 */ }
  return book;
}

export function saveBook(storage, book) {
  try {
    storage.setItem(SAVE_KEY, JSON.stringify(book));
    return true;
  } catch {
    return false;
  }
}

export function updateRecord(book, state) {
  if (!MODES.includes(state.mode)) return;
  const previous = book.records[state.mode];
  previous.score = Math.max(previous.score, state.score);
  previous.watermelons = Math.max(previous.watermelons, state.watermelons);
}
