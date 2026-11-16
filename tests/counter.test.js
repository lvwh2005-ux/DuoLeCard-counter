'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../counter.js');
const start = initial => C.createGame(initial, { at: 1000, id: 'game-test' });
const play = (card = 'Q', qty = 4, twos = 0, actor = 'other') => ({ card, qty, twos, actor });
const code = expected => error => error instanceof C.CounterError && error.code === expected;
const legacy = () => ({ version: 1, gameId: 'old-game', startedAt: 1000, updatedAt: 2000, initialHand: 54,
  events: [{ id: 'table-old', kind: 'table', card: 'Q', qty: 4, at: 1100 },
    { id: 'opponent-old', kind: 'opponent', qty: 13, at: 1200 }] });

test('固定312张牌池、16种牌，新局对家初始为空', () => {
  const s = C.getStats(start(null));
  assert.equal(C.CARDS.length, 16);
  assert.equal(C.CARDS.filter(c => c.total === 6).length, 4);
  assert.equal(C.CARDS.filter(c => c.total === 24).length, 12);
  assert.equal(s.tableRemaining, 312);
  assert.equal(s.opponentRemaining, null);
  assert.equal(s.history.length, 0);
});

test('其他人4Q带2张2：只扣全场6张，一手只有一条记录', () => {
  const state = C.recordPlay(start(41), play('Q', 4, 2)), s = C.getStats(state);
  assert.equal(s.byCard.Q.remaining, 20);
  assert.equal(s.byCard['2'].remaining, 22);
  assert.equal(s.tableRemaining, 306);
  assert.equal(s.opponentRemaining, 41);
  assert.equal(s.history.length, 1);
  assert.equal(s.opponentHistory.length, 0);
  assert.equal(s.history[0].total, 6);
});

test('对家4Q带2张2：全场和对家同步扣6，整手撤销同步恢复', () => {
  const state = C.recordPlay(start(41), play('Q', 4, 2, 'opponent')), s = C.getStats(state);
  assert.equal(s.opponentRemaining, 35);
  assert.equal(s.tableRemaining, 306);
  assert.equal(s.opponentHistory[0].id, s.tableHistory[0].id);
  assert.equal(s.history[0].opponentRemainingAfter, 35);
  const undone = C.getStats(C.undo(state));
  assert.equal(undone.opponentRemaining, 41);
  assert.equal(undone.tableRemaining, 312);
  assert.equal(undone.history.length, 0);
});

test('单出2只扣一次；禁止将2同时作为主牌和附带牌', () => {
  const s = C.getStats(C.recordPlay(start(10), play('2', 6, 0, 'opponent')));
  assert.equal(s.byCard['2'].remaining, 18);
  assert.equal(s.opponentRemaining, 4);
  assert.throws(() => C.recordPlay(start(10), play('2', 1, 1)), code('QUANTITY'));
});

test('每个牌种可记录至零，牌池超扣拒绝；带2也检查库存', () => {
  let state = start(null);
  for (const card of C.CARDS) {
    state = C.recordPlay(state, play(card.key, card.total));
    assert.equal(C.getStats(state).byCard[card.key].remaining, 0);
    assert.throws(() => C.recordPlay(state, play(card.key, 1)), code('OVERDRAW'));
  }
  assert.equal(C.getStats(state).tablePlayed, 312);
  const twosUsed = C.recordPlay(start(54), play('2', 23));
  const raw = C.serialize(twosUsed);
  assert.throws(() => C.recordPlay(twosUsed, play('Q', 4, 2)), code('OVERDRAW'));
  assert.equal(C.serialize(twosUsed), raw);
});

test('对家超扣整手拒绝，不能只扣主牌；零手牌不能继续记录', () => {
  const state = start(5), raw = C.serialize(state);
  assert.throws(() => C.recordPlay(state, play('Q', 4, 2, 'opponent')), code('OPPONENT_OVERDRAW'));
  assert.equal(C.serialize(state), raw);
  const zero = C.recordPlay(state, play('Q', 3, 2, 'opponent'));
  assert.equal(C.getStats(zero).opponentRemaining, 0);
  assert.throws(() => C.recordPlay(zero, play('A', 1, 0, 'opponent')), code('OPPONENT_OVERDRAW'));
  assert.equal(C.getStats(C.recordPlay(zero, play('A', 1))).tablePlayed, 6);
});

test('未填初始可先记对家，补填后重算；拒绝低于已出，允许再留空', () => {
  let state = C.recordPlay(start(null), play('Q', 4, 2, 'opponent'));
  assert.equal(C.getStats(state).opponentPlayed, 6);
  assert.equal(C.getStats(state).opponentRemaining, null);
  assert.throws(() => C.setInitial(state, 5), code('INITIAL_BELOW_PLAYED'));
  state = C.setInitial(state, 41);
  assert.equal(C.getStats(state).opponentRemaining, 35);
  assert.equal(C.getStats(state).history[0].opponentRemainingAfter, 35);
  assert.equal(C.getStats(C.setInitial(state, null)).opponentRemaining, null);
});

test('修改归属不重复扣牌池，可往返改为对家或其他人', () => {
  let state = C.recordPlay(start(41), play('Q', 4, 2), { id: 'switch' });
  state = C.updatePlay(state, 'switch', play('Q', 4, 2, 'opponent'));
  assert.equal(C.getStats(state).tablePlayed, 6);
  assert.equal(C.getStats(state).opponentRemaining, 35);
  assert.equal(state.events.length, 1);
  state = C.updatePlay(state, 'switch', play('Q', 4, 2));
  assert.equal(C.getStats(state).opponentRemaining, 41);
  assert.equal(C.getStats(state).tablePlayed, 6);
});

test('修改已记满的手牌可使用自身库存；超扣修改原子拒绝', () => {
  let state = C.recordPlay(start(30), play('Q', 24, 6, 'opponent'), { id: 'full' });
  state = C.updatePlay(state, 'full', play('Q', 24, 6, 'opponent'));
  assert.equal(C.getStats(state).opponentRemaining, 0);
  const raw = C.serialize(state);
  assert.throws(() => C.updatePlay(state, 'full', play('Q', 24, 7, 'opponent')), code('OPPONENT_OVERDRAW'));
  assert.equal(C.serialize(state), raw);
  state = C.updatePlay(state, 'full', play('Q', 20, 3, 'opponent'));
  assert.equal(C.getStats(state).byCard.Q.remaining, 4);
  assert.equal(C.getStats(state).byCard['2'].remaining, 21);
  assert.equal(C.getStats(state).opponentRemaining, 7);
});

test('修改历史中间一手会重算后续余牌，删除仅恢复被选中的整手', () => {
  let state = C.recordPlay(start(41), play('Q', 4, 2, 'opponent'), { id: 'first' });
  state = C.recordPlay(state, play('A', 3, 0, 'opponent'), { id: 'second' });
  state = C.updatePlay(state, 'first', play('Q', 2, 1, 'opponent'));
  assert.equal(C.getStats(state).opponentHistory[1].opponentRemainingAfter, 35);
  state = C.removePlay(state, 'first');
  assert.equal(C.getStats(state).opponentRemaining, 38);
  assert.equal(C.getStats(state).byCard.Q.remaining, 24);
  assert.equal(C.getStats(state).byCard.A.remaining, 21);
  assert.throws(() => C.updatePlay(state, 'missing', play()), code('NOT_FOUND'));
  assert.throws(() => C.removePlay(state, 'missing'), code('NOT_FOUND'));
});

test('非法数量、归属、原型键和初始值拒绝', () => {
  for (const qty of [-1, 0, 1.5, NaN, Infinity, '2', null, undefined]) {
    assert.throws(() => C.recordPlay(start(54), { ...play('A'), qty }), code('QUANTITY'));
  }
  for (const twos of [-1, 25, 1.5, '2', null, undefined]) {
    const input = play(); input.twos = twos;
    assert.throws(() => C.recordPlay(start(54), input), code('QUANTITY'));
  }
  for (const key of ['__proto__', 'constructor', '', 'joker', undefined]) {
    assert.throws(() => C.recordPlay(start(54), { ...play(), card: key }), code('CARD'));
  }
  assert.throws(() => C.recordPlay(start(54), play('A', 1, 0, 'nobody')), code('ACTOR'));
  for (const value of [-1, 313, 1.5, Infinity, '54']) assert.throws(() => C.setInitial(start(54), value), code('INITIAL'));
});

test('v1存档迁移保留独立统计，不猜测配对；v1备份可导入', () => {
  let migrated = C.deserialize(JSON.stringify(legacy())), s = C.getStats(migrated);
  assert.equal(migrated.version, 2);
  assert.equal(s.tableRemaining, 308);
  assert.equal(s.opponentRemaining, 41);
  assert.equal(s.history[1].kind, 'legacy-opponent');
  assert.equal(s.history[0].legacy, true);
  assert.deepEqual(C.importBackup(JSON.stringify({ format: 'duole-card-counter', version: 1, game: legacy() })), migrated);
  migrated = C.recordPlay(migrated, play('A', 3, 2, 'opponent'));
  assert.equal(C.getStats(migrated).opponentRemaining, 36);
  assert.equal(C.getStats(migrated).tableRemaining, 303);
  const restored = C.importBackup(C.exportBackup(migrated));
  assert.deepEqual(restored, migrated);
  assert.equal(C.getStats(C.undo(restored)).opponentRemaining, 41);
});

test('v2存档/备份往返、不可变状态和系统时间倒退', () => {
  const old = start(41), next = C.recordPlay(old, play('Q', 4, 2, 'opponent'), { at: 900 });
  assert.equal(next.events[0].at, 1000);
  assert.equal(old.events.length, 0);
  assert.throws(() => next.events[0].qty = 10, TypeError);
  assert.throws(() => old.events.push({}), TypeError);
  assert.deepEqual(C.deserialize(C.serialize(next)), next);
  assert.deepEqual(C.importBackup(C.exportBackup(next)), next);
  assert.equal(C.undo(old), old);
});

test('异常存档拒绝：错误版本、超扣、重复ID、非法时间及超大文件', () => {
  const valid = JSON.parse(C.serialize(C.recordPlay(start(41), play('big', 4), { id: 'one' })));
  assert.throws(() => C.deserialize('{bad json'), code('STATE'));
  assert.throws(() => C.deserialize(JSON.stringify({ ...valid, version: 3 })), code('STATE'));
  assert.throws(() => C.deserialize(JSON.stringify({ ...valid, events: [...valid.events, valid.events[0]] })), code('STATE'));
  assert.throws(() => C.deserialize(JSON.stringify({ ...valid, events: [...valid.events, { ...valid.events[0], id: 'two' }] })), code('OVERDRAW'));
  assert.throws(() => C.deserialize(JSON.stringify({ ...valid, events: [{ ...valid.events[0], at: -1 }] })), code('STATE'));
  assert.throws(() => C.deserialize(' '.repeat(C.MAX_BYTES + 1)), code('STATE'));
  assert.throws(() => C.importBackup(JSON.stringify({ format: 'duole-card-counter', version: 1, game: valid })), code('STATE'));
  const badOld = legacy(); badOld.events[1].qty = 55;
  assert.throws(() => C.deserialize(JSON.stringify(badOld)), code('OPPONENT_OVERDRAW'));
});

test('2000次记牌/修改/撤销：牌池守恒、对家联动、存档往返始终一致', () => {
  let seed = 20261116, state = start(73);
  const random = n => { seed = (1664525 * seed + 1013904223) >>> 0; return seed % n; };
  for (let i = 0; i < 2000; i++) {
    const action = random(5), before = C.serialize(state);
    try {
      if (action <= 1) state = C.recordPlay(state, play(C.CARDS[random(16)].key, random(6) + 1, random(4), random(2) ? 'other' : 'opponent'));
      else if (action === 2) state = C.undo(state);
      else if (state.events.length) {
        const event = state.events[random(state.events.length)];
        state = action === 3 ? C.updatePlay(state, event.id, { ...event, actor: event.actor === 'other' ? 'opponent' : 'other', twos: event.card === '2' ? 0 : random(4) }) : C.removePlay(state, event.id);
      }
    } catch (error) { assert.ok(error instanceof C.CounterError); assert.equal(C.serialize(state), before); }
    const s = C.getStats(state);
    assert.equal(s.tablePlayed + s.tableRemaining, 312);
    assert.equal(s.opponentPlayed + s.opponentRemaining, 73);
    assert.equal(s.opponentPlayed, state.events.filter(e => e.actor === 'opponent').reduce((n, e) => n + e.qty + e.twos, 0));
    for (const card of C.CARDS) {
      const stat = s.byCard[card.key];
      assert.equal(stat.played + stat.remaining, card.total);
      assert.ok(stat.played >= 0 && stat.remaining >= 0);
    }
    if (i % 100 === 0) assert.deepEqual(C.deserialize(C.serialize(state)), state);
  }
});
