(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DuoLeCounter = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = 1;
  const CARDS = Object.freeze([
    { key: 'big', rank: '大王', total: 6, style: 'special big' },
    { key: 'small', rank: '小王', total: 6, style: 'special small' },
    { key: 'eagle', rank: '鹰', total: 6, style: 'special eagle' },
    { key: '3', rank: '3', total: 6, style: 'special three' },
    ...['2', 'A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4']
      .map(key => ({ key, rank: key, total: 24, style: '' }))
  ].map(Object.freeze));
  const CARD_MAP = new Map(CARDS.map(card => [card.key, card]));
  const TOTAL = CARDS.reduce((sum, card) => sum + card.total, 0);
  const MAX_BYTES = 256 * 1024;
  let sequence = 0;

  class CounterError extends Error {
    constructor(code, message) { super(message); this.name = 'CounterError'; this.code = code; }
  }
  function fail(code, message) { throw new CounterError(code, message); }
  function integer(value, min, max) { return Number.isSafeInteger(value) && value >= min && value <= max; }
  function id() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return Date.now().toString(36) + '-' + (++sequence).toString(36) + '-' + Math.random().toString(36).slice(2);
  }
  function validId(value) { return typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,100}$/.test(value); }
  function validTime(value) { return integer(value, 0, 8640000000000000); }
  function checkInitial(value) {
    if (value !== null && !integer(value, 0, TOTAL)) fail('INITIAL', '初始手牌须为 0–' + TOTAL + ' 的整数');
  }
  function freezeState(state) {
    state.events.forEach(Object.freeze);
    Object.freeze(state.events);
    return Object.freeze(state);
  }
  function createGame(initialHand = null, meta = {}) {
    checkInitial(initialHand);
    const at = meta.at ?? Date.now();
    const gameId = meta.id ?? id();
    if (!validTime(at) || !validId(gameId)) fail('STATE', '牌局标识或时间无效');
    return freezeState({ version: VERSION, gameId, startedAt: at, updatedAt: at, initialHand, events: [] });
  }

  // Canonicalize and replay untrusted saves/backups. Derived totals are never trusted.
  function validateState(source) {
    if (!source || typeof source !== 'object' || Array.isArray(source) || source.version !== VERSION) {
      fail('STATE', '存档格式或版本不支持');
    }
    checkInitial(source.initialHand);
    if (!validId(source.gameId) || !validTime(source.startedAt) || !validTime(source.updatedAt) ||
        source.updatedAt < source.startedAt || !Array.isArray(source.events) || source.events.length > TOTAL * 2) {
      fail('STATE', '存档结构无效');
    }
    const seen = new Set();
    const played = new Map(CARDS.map(card => [card.key, 0]));
    let opponentPlayed = 0;
    const events = source.events.map(event => {
      if (!event || typeof event !== 'object' || !validId(event.id) || seen.has(event.id) ||
          !validTime(event.at) || event.at < source.startedAt || event.at > source.updatedAt ||
          !integer(event.qty, 1, TOTAL)) fail('STATE', '存档中存在无效或重复记录');
      seen.add(event.id);
      if (event.kind === 'table') {
        const card = CARD_MAP.get(event.card);
        if (!card) fail('CARD', '未知牌种');
        const next = played.get(card.key) + event.qty;
        if (next > card.total) fail('OVERDRAW', card.rank + ' 的已出张数超过牌池总数');
        played.set(card.key, next);
        return { id: event.id, kind: 'table', card: card.key, qty: event.qty, at: event.at };
      }
      if (event.kind === 'opponent') {
        opponentPlayed += event.qty;
        if (source.initialHand === null || opponentPlayed > source.initialHand) {
          fail('OPPONENT_OVERDRAW', '对家已出张数超过初始手牌');
        }
        return { id: event.id, kind: 'opponent', qty: event.qty, at: event.at };
      }
      fail('STATE', '未知记录类型');
    });
    return freezeState({ version: VERSION, gameId: source.gameId, startedAt: source.startedAt,
      updatedAt: source.updatedAt, initialHand: source.initialHand, events });
  }

  function getStats(source) {
    const state = validateState(source);
    const byCard = Object.fromEntries(CARDS.map(card => [card.key, { total: card.total, played: 0, remaining: card.total }]));
    let tablePlayed = 0;
    let opponentPlayed = 0;
    const tableHistory = [];
    const opponentHistory = [];
    for (const event of state.events) {
      if (event.kind === 'table') {
        const stat = byCard[event.card];
        stat.played += event.qty;
        stat.remaining -= event.qty;
        tablePlayed += event.qty;
        tableHistory.push({ ...event, remainingAfter: stat.remaining, tableRemainingAfter: TOTAL - tablePlayed });
      } else {
        opponentPlayed += event.qty;
        opponentHistory.push({ ...event, remainingAfter: state.initialHand - opponentPlayed });
      }
    }
    return { total: TOTAL, tablePlayed, tableRemaining: TOTAL - tablePlayed, byCard,
      opponentPlayed, opponentRemaining: state.initialHand === null ? null : state.initialHand - opponentPlayed,
      tableHistory, opponentHistory };
  }

  function append(state, event, meta = {}) {
    const at = Math.max(meta.at ?? Date.now(), state.updatedAt);
    return validateState({ ...state, updatedAt: at,
      events: [...state.events, { ...event, id: meta.id ?? id(), at }] });
  }
  function recordTable(source, key, qty, meta) {
    const state = validateState(source);
    const card = CARD_MAP.get(key);
    if (!card) fail('CARD', '未知牌种');
    if (!integer(qty, 1, card.total)) fail('QUANTITY', '请选择有效的整数张数');
    const remaining = getStats(state).byCard[key].remaining;
    if (qty > remaining) fail('OVERDRAW', card.rank + ' 只剩 ' + remaining + ' 张');
    return append(state, { kind: 'table', card: key, qty }, meta);
  }
  function setInitial(source, initialHand, meta = {}) {
    const state = validateState(source);
    checkInitial(initialHand);
    const { opponentPlayed } = getStats(state);
    if ((initialHand === null && state.events.some(event => event.kind === 'opponent')) ||
        (initialHand !== null && initialHand < opponentPlayed)) {
      fail('INITIAL_BELOW_PLAYED', '初始手牌不能少于对家已出的 ' + opponentPlayed + ' 张');
    }
    if (initialHand === state.initialHand) return source;
    return validateState({ ...state, initialHand, updatedAt: Math.max(meta.at ?? Date.now(), state.updatedAt) });
  }
  function recordOpponent(source, qty, meta) {
    const state = validateState(source);
    if (state.initialHand === null) fail('INITIAL_REQUIRED', '请先填写对家初始手牌');
    if (!integer(qty, 1, TOTAL)) fail('QUANTITY', '出牌张数须为正整数');
    const remaining = getStats(state).opponentRemaining;
    if (qty > remaining) fail('OPPONENT_OVERDRAW', '对家只剩 ' + remaining + ' 张');
    return append(state, { kind: 'opponent', qty }, meta);
  }
  function undo(source, kind, meta = {}) {
    const state = validateState(source);
    if (kind !== 'table' && kind !== 'opponent') fail('STATE', '未知撤销类型');
    let index = state.events.length - 1;
    while (index >= 0 && state.events[index].kind !== kind) index--;
    if (index < 0) return source;
    return validateState({ ...state, updatedAt: Math.max(meta.at ?? Date.now(), state.updatedAt),
      events: state.events.filter((event, i) => i !== index) });
  }
  function serialize(state) { return JSON.stringify(validateState(state)); }
  function deserialize(raw) {
    if (typeof raw !== 'string' || raw.length > MAX_BYTES) fail('STATE', '存档为空或过大');
    let value;
    try { value = JSON.parse(raw); } catch { fail('STATE', '存档不是有效的 JSON 文件'); }
    return validateState(value);
  }
  function exportBackup(state) {
    return JSON.stringify({ format: 'duole-card-counter', version: VERSION, game: validateState(state) }, null, 2);
  }
  function importBackup(raw) {
    if (typeof raw !== 'string' || raw.length > MAX_BYTES) fail('STATE', '备份文件过大');
    let value;
    try { value = JSON.parse(raw); } catch { fail('STATE', '备份不是有效的 JSON 文件'); }
    if (!value || value.format !== 'duole-card-counter' || value.version !== VERSION) fail('STATE', '请选择本记牌器导出的备份文件');
    return validateState(value.game);
  }
  return Object.freeze({ VERSION, CARDS, TOTAL, MAX_BYTES, CounterError, createGame, validateState,
    getStats, recordTable, setInitial, recordOpponent, undo, serialize, deserialize, exportBackup, importBackup });
});
