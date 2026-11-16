'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../counter.js');
const start = initial => C.createGame(initial, { at: 1000, id: 'game-test' });
const code = expected => error => error instanceof C.CounterError && error.code === expected;

test('固定牌池：特殊牌各6，普通牌各24，总共312；对家初始为空', () => {
  const state = start(null), stats = C.getStats(state);
  assert.equal(C.CARDS.length, 16);
  assert.equal(C.CARDS.filter(card => card.total === 6).length, 4);
  assert.equal(C.CARDS.filter(card => card.total === 24).length, 12);
  assert.equal(stats.total, 312);
  assert.equal(stats.tableRemaining, 312);
  assert.equal(stats.opponentRemaining, null);
});

test('每种牌都能记满，超量记录被拒绝且不改变原状态', () => {
  let state = start(null);
  for (const card of C.CARDS) {
    state = C.recordTable(state, card.key, card.total);
    assert.equal(C.getStats(state).byCard[card.key].remaining, 0);
    const before = C.serialize(state);
    assert.throws(() => C.recordTable(state, card.key, 1), code('OVERDRAW'));
    assert.equal(C.serialize(state), before);
  }
  assert.equal(C.getStats(state).tableRemaining, 0);
  assert.equal(C.getStats(state).tablePlayed, 312);
});

test('全场记录与对家计数独立；交错记录可以分别撤销', () => {
  let state = start(54);
  state = C.recordTable(state, 'Q', 4);
  state = C.recordOpponent(state, 13);
  state = C.recordTable(state, 'big', 2);
  assert.equal(C.getStats(state).opponentRemaining, 41);
  assert.equal(C.getStats(state).tablePlayed, 6);
  state = C.undo(state, 'table');
  assert.equal(C.getStats(state).byCard.big.remaining, 6);
  assert.equal(C.getStats(state).byCard.Q.remaining, 20);
  assert.equal(C.getStats(state).opponentRemaining, 41);
  state = C.undo(state, 'opponent');
  assert.equal(C.getStats(state).opponentRemaining, 54);
  assert.equal(C.getStats(state).tablePlayed, 4);
  state = C.undo(state, 'table');
  assert.equal(C.getStats(state).tableRemaining, 312);
  assert.equal(C.undo(state, 'table'), state);
});

test('自定义初始张数、校准初始值、到零边界及空值区分', () => {
  assert.throws(() => C.recordOpponent(start(null), 1), code('INITIAL_REQUIRED'));
  let state = C.recordOpponent(start(54), 13);
  state = C.setInitial(state, 62);
  assert.equal(C.getStats(state).opponentRemaining, 49);
  assert.throws(() => C.setInitial(state, 12), code('INITIAL_BELOW_PLAYED'));
  assert.throws(() => C.setInitial(state, null), code('INITIAL_BELOW_PLAYED'));
  state = C.recordOpponent(state, 49);
  assert.equal(C.getStats(state).opponentRemaining, 0);
  assert.throws(() => C.recordOpponent(state, 1), code('OPPONENT_OVERDRAW'));
  assert.equal(C.getStats(start(0)).opponentRemaining, 0);
  assert.throws(() => C.recordOpponent(start(0), 1), code('OPPONENT_OVERDRAW'));
  assert.equal(C.getStats(C.setInitial(start(54), null)).opponentRemaining, null);
});

test('拒绝非整数、负数、零、字符串、无穷、未知牌种及超大初始值', () => {
  const state = start(54);
  for (const qty of [-1, 0, 1.5, NaN, Infinity, '2', null, undefined]) {
    assert.throws(() => C.recordTable(state, 'A', qty), code('QUANTITY'));
    assert.throws(() => C.recordOpponent(state, qty), code('QUANTITY'));
  }
  for (const key of ['__proto__', 'constructor', '', 'joker', undefined]) {
    assert.throws(() => C.recordTable(state, key, 1), code('CARD'));
  }
  for (const initial of [-1, 1.5, 313, Infinity, '54', undefined]) {
    if (initial === undefined) continue;
    assert.throws(() => C.setInitial(state, initial), code('INITIAL'));
  }
});

test('刷新存档和备份还原保持全部流水及撤销能力', () => {
  let state = C.recordTable(start(47), '3', 6);
  state = C.recordOpponent(state, 5);
  state = C.recordTable(state, 'A', 12);
  const restored = C.deserialize(C.serialize(state));
  assert.deepEqual(restored, state);
  assert.deepEqual(C.importBackup(C.exportBackup(state)), state);
  assert.equal(C.getStats(C.undo(restored, 'table')).byCard.A.remaining, 24);
  assert.equal(C.getStats(restored).opponentRemaining, 42);
});

test('异常存档：错误版本、超扣、重复ID、非法时间、超大文件均被拒绝', () => {
  const valid = JSON.parse(C.serialize(C.recordTable(start(54), 'big', 4, { id: 'event-one' })));
  assert.throws(() => C.deserialize('{bad json'), code('STATE'));
  assert.throws(() => C.deserialize(JSON.stringify({ ...valid, version: 2 })), code('STATE'));
  assert.throws(() => C.deserialize(JSON.stringify({ ...valid, events: [...valid.events, { ...valid.events[0] }] })), code('STATE'));
  assert.throws(() => C.deserialize(JSON.stringify({ ...valid, events: [...valid.events, { ...valid.events[0], id: 'event-two' }] })), code('OVERDRAW'));
  assert.throws(() => C.deserialize(JSON.stringify({ ...valid, events: [{ ...valid.events[0], at: -1 }] })), code('STATE'));
  assert.throws(() => C.deserialize(' '.repeat(C.MAX_BYTES + 1)), code('STATE'));
  assert.throws(() => C.importBackup(JSON.stringify({ format: 'other', version: 1, game: valid })), code('STATE'));
  assert.throws(() => C.deserialize(JSON.stringify({ ...valid, initialHand: null, events: [{ ...valid.events[0], kind: 'opponent', qty: 1 }] })), code('OPPONENT_OVERDRAW'));
});

test('新局没有示例数据；旧状态不可变；系统时间倒退不破坏存档', () => {
  const state = start(54);
  const next = C.recordTable(state, 'A', 1, { at: 900, id: 'clock-back' });
  assert.equal(next.events[0].at, 1000);
  assert.equal(state.events.length, 0);
  assert.throws(() => state.events.push({}), TypeError);
  const fresh = C.createGame(next.initialHand);
  assert.equal(fresh.events.length, 0);
  assert.equal(C.getStats(fresh).tableRemaining, 312);
  assert.equal(C.getStats(fresh).opponentRemaining, 54);
});

test('2000次混合记牌/撤销：守恒、非负、独立性与存档往返始终成立', () => {
  let seed = 20261116, state = start(73);
  function random(n) { seed = (1664525 * seed + 1013904223) >>> 0; return seed % n; }
  for (let i = 0; i < 2000; i++) {
    const before = C.getStats(state), action = random(4);
    if (action === 0) {
      const card = C.CARDS[random(C.CARDS.length)], available = before.byCard[card.key].remaining;
      if (available) state = C.recordTable(state, card.key, random(available) + 1);
      assert.equal(C.getStats(state).opponentPlayed, before.opponentPlayed);
    } else if (action === 1) {
      if (before.opponentRemaining) state = C.recordOpponent(state, random(before.opponentRemaining) + 1);
      assert.equal(C.getStats(state).tablePlayed, before.tablePlayed);
    } else state = C.undo(state, action === 2 ? 'table' : 'opponent');
    const stats = C.getStats(state);
    assert.equal(stats.tablePlayed + stats.tableRemaining, 312);
    assert.equal(stats.opponentPlayed + stats.opponentRemaining, 73);
    for (const card of C.CARDS) {
      const stat = stats.byCard[card.key];
      assert.equal(stat.played + stat.remaining, card.total);
      assert.ok(stat.played >= 0 && stat.remaining >= 0);
    }
    if (i % 100 === 0) state = C.deserialize(C.serialize(state));
  }
});
