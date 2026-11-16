(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DuoLeCounter = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = 2;
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
    if (!source || typeof source !== 'object' || Array.isArray(source) || ![1, VERSION].includes(source.version)) {
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
          !validTime(event.at) || event.at < source.startedAt || event.at > source.updatedAt) fail('STATE', '存档中存在无效或重复记录');
      seen.add(event.id);
      if (source.version === 1 ? event.kind === 'table' : event.kind === 'play') {
        const play = checkPlay(source.version === 1 ? { ...event, actor: 'other', twos: 0 } : event);
        for (const [key, qty] of [[play.card, play.qty], ['2', play.twos]]) {
          const next = played.get(key) + qty;
          if (next > CARD_MAP.get(key).total) fail('OVERDRAW', CARD_MAP.get(key).rank + ' 的已出张数超过牌池剩余');
          played.set(key, next);
        }
        if (play.actor === 'opponent') opponentPlayed += play.qty + play.twos;
        return { id: event.id, kind: 'play', ...play, at: event.at,
          ...(source.version === 1 || event.legacy === true ? { legacy: true } : {}) };
      } else if (source.version === 1 ? event.kind === 'opponent' : event.kind === 'legacy-opponent') {
        if (!integer(event.qty, 1, TOTAL) || (source.version === 1 && source.initialHand === null)) fail('STATE', '旧对家记录无效');
        opponentPlayed += event.qty;
        return { id: event.id, kind: 'legacy-opponent', qty: event.qty, at: event.at };
      }
      fail('STATE', '未知记录类型');
    });
    if (opponentPlayed > (source.initialHand ?? TOTAL)) fail('OPPONENT_OVERDRAW', '对家已出张数超过' + (source.initialHand === null ? '总牌数' : '初始手牌，请检查张数'));
    return freezeState({ version: VERSION, gameId: source.gameId, startedAt: source.startedAt,
      updatedAt: source.updatedAt, initialHand: source.initialHand, events });
  }

  function checkPlay(play) {
    if (!play || !CARD_MAP.has(play.card)) fail('CARD', '未知牌种');
    if (!integer(play.qty, 1, CARD_MAP.get(play.card).total) || !integer(play.twos, 0, 24)) fail('QUANTITY', '请选择有效的整数张数');
    if (play.card === '2' && play.twos !== 0) fail('QUANTITY', '记录 2 时不能再附带 2');
    if (!['other', 'opponent'].includes(play.actor)) fail('ACTOR', '请选择其他人或对家');
    return { card: play.card, qty: play.qty, twos: play.twos, actor: play.actor };
  }

  function getStats(source) {
    const state = validateState(source);
    const byCard = Object.fromEntries(CARDS.map(card => [card.key, { total: card.total, played: 0, remaining: card.total }]));
    let tablePlayed = 0;
    let opponentPlayed = 0;
    const tableHistory = [];
    const opponentHistory = [];
    const history = [];
    for (const event of state.events) {
      const total = event.qty + (event.twos || 0);
      if (event.kind === 'play') {
        for (const [key, qty] of [[event.card, event.qty], ['2', event.twos]]) {
          byCard[key].played += qty;
          byCard[key].remaining -= qty;
        }
        tablePlayed += total;
        if (event.actor === 'opponent') opponentPlayed += total;
      } else {
        opponentPlayed += event.qty;
      }
      const entry = { ...event, total, tableRemainingAfter: TOTAL - tablePlayed,
        opponentRemainingAfter: state.initialHand === null ? null : state.initialHand - opponentPlayed };
      history.push(entry);
      if (event.kind === 'play') tableHistory.push(entry);
      if (event.actor === 'opponent' || event.kind === 'legacy-opponent') opponentHistory.push(entry);
    }
    return { total: TOTAL, tablePlayed, tableRemaining: TOTAL - tablePlayed, byCard,
      opponentPlayed, opponentRemaining: state.initialHand === null ? null : state.initialHand - opponentPlayed,
      tableHistory, opponentHistory, history };
  }

  function append(state, event, meta = {}) {
    const at = Math.max(meta.at ?? Date.now(), state.updatedAt);
    return validateState({ ...state, updatedAt: at,
      events: [...state.events, { ...event, id: meta.id ?? id(), at }] });
  }
  function recordPlay(source, play, meta) {
    const state = validateState(source);
    return append(state, { kind: 'play', ...checkPlay(play) }, meta);
  }
  function setInitial(source, initialHand, meta = {}) {
    const state = validateState(source);
    checkInitial(initialHand);
    const { opponentPlayed } = getStats(state);
    if (initialHand !== null && initialHand < opponentPlayed) {
      fail('INITIAL_BELOW_PLAYED', '初始手牌不能少于对家已出的 ' + opponentPlayed + ' 张');
    }
    if (initialHand === state.initialHand) return source;
    return validateState({ ...state, initialHand, updatedAt: Math.max(meta.at ?? Date.now(), state.updatedAt) });
  }
  function updatePlay(source, eventId, play, meta = {}) {
    const state = validateState(source);
    const existing = state.events.find(event => event.id === eventId);
    if (!existing || existing.kind !== 'play') fail('NOT_FOUND', '这手牌已被移除，请重新操作');
    const fields = checkPlay(play);
    return validateState({ ...state, updatedAt: Math.max(meta.at ?? Date.now(), state.updatedAt),
      events: state.events.map(event => event.id === eventId ? { id: event.id, kind: 'play', ...fields, at: event.at } : event) });
  }
  function removePlay(source, eventId, meta = {}) {
    const state = validateState(source);
    if (!state.events.some(event => event.id === eventId)) fail('NOT_FOUND', '这手牌已被移除，请重新操作');
    return validateState({ ...state, updatedAt: Math.max(meta.at ?? Date.now(), state.updatedAt),
      events: state.events.filter(event => event.id !== eventId) });
  }
  function undo(source, meta = {}) {
    const state = validateState(source);
    return state.events.length ? removePlay(state, state.events[state.events.length - 1].id, meta) : source;
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
    if (!value || value.format !== 'duole-card-counter' || ![1, VERSION].includes(value.version) || value.game?.version !== value.version) fail('STATE', '请选择本记牌器导出的备份文件');
    return validateState(value.game);
  }
  return Object.freeze({ VERSION, CARDS, TOTAL, MAX_BYTES, CounterError, createGame, validateState,
    getStats, recordPlay, updatePlay, removePlay, setInitial, undo, serialize, deserialize, exportBackup, importBackup });
});
