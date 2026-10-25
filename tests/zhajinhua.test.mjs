import assert from 'node:assert/strict';
import test from 'node:test';
import { zhajinhua } from './helpers/arcade-harness.mjs';

function finishCalling(env) {
  for (let step = 0; step < 500; step++) {
    if (env.run('S.roundOver')) return;
    if (env.run('S.turnIdx === 0 && !S.busy && canAct(S.players[0])')) {
      env.element('b_call').onclick();
    } else {
      assert.ok(env.next(), 'The round must progress to another action or settlement');
    }
  }
  assert.fail('The round did not settle within its turn limit');
}

test('a blind winner receives the full pot against normally matched seen opponents', () => {
  const env = zhajinhua(1);
  finishCalling(env);
  const record = env.ctx.payoutRecords.at(-1);
  assert.equal(record.fallback, 0);
  assert.equal(record.pot, 590);
  assert.equal(record.input.every(p => !p.allIn), true);
  assert.deepEqual({ ...record.result }, { 0: 590 });
  assert.equal(env.memory.get('zjh_chips'), '1480');
  assert.ok(!env.element('panel').innerHTML.includes('（边池）'));
});

test('ordinary non-all-in rounds award the full pot and conserve chips across random deals', () => {
  let checked = 0;
  for (let seed = 1; seed <= 100; seed++) {
    const env = zhajinhua(seed);
    finishCalling(env);
    const record = env.ctx.payoutRecords.at(-1);
    assert.ok(record);
    assert.equal(Object.values(record.result).reduce((sum, value) => sum + value, 0), record.pot);
    assert.equal(env.run('S.players.reduce((sum,p)=>sum+p.chips,0)'), 4000);
    if (record.input.every(p => !p.allIn)) {
      assert.deepEqual({ ...record.result }, { [record.fallback]: record.pot });
      checked++;
    }
  }
  assert.ok(checked > 50);
});

function settleFixture(players) {
  const env = zhajinhua(1);
  env.run(`
    S.players = ${JSON.stringify(players)}.map((p,idx)=>({...p,idx,chips:p.allIn?0:1000}));
    S.pot = S.players.reduce((sum,p)=>sum+p.invested,0);
    var fixtureWinner = S.players.filter(p=>!p.folded).reduce((best,p)=>cmpHands(p.hand,best.hand)>0?p:best);
    var fixturePayout = payout(fixtureWinner);
  `);
  const result = { ...env.run('fixturePayout') };
  assert.equal(Object.values(result).reduce((sum, value) => sum + value, 0), players.reduce((sum, p) => sum + p.invested, 0));
  return result;
}

const trips = [{ r: 14, s: 0 }, { r: 14, s: 1 }, { r: 14, s: 2 }];
const pair = [{ r: 13, s: 0 }, { r: 13, s: 1 }, { r: 9, s: 2 }];
const high = [{ r: 12, s: 0 }, { r: 9, s: 1 }, { r: 3, s: 2 }];

test('a genuinely short all-in winner is still capped while the next hand wins the side pot', () => {
  assert.deepEqual(settleFixture([
    { invested: 50, allIn: true, folded: false, hand: trips },
    { invested: 100, allIn: false, folded: false, hand: pair },
    { invested: 100, allIn: false, folded: false, hand: high },
  ]), { 0: 150, 1: 100 });
});

test('a short all-in does not exclude a normally funded blind hand from higher side pots', () => {
  assert.deepEqual(settleFixture([
    { invested: 50, allIn: true, folded: false, hand: trips },
    { invested: 110, allIn: false, folded: false, hand: pair },
    { invested: 210, allIn: false, folded: false, hand: high },
  ]), { 0: 150, 1: 220 });
});

test('compare fees and folded players contributions cannot make a losing hand eligible ahead of the winner', () => {
  assert.deepEqual(settleFixture([
    { invested: 110, allIn: false, folded: false, hand: pair },
    { invested: 310, allIn: false, folded: false, hand: high },
    { invested: 500, allIn: false, folded: true, hand: trips },
  ]), { 0: 920 });
});

test('multiple genuine all-in caps retain layered payouts', () => {
  assert.deepEqual(settleFixture([
    { invested: 50, allIn: true, folded: false, hand: trips },
    { invested: 100, allIn: true, folded: false, hand: pair },
    { invested: 200, allIn: false, folded: false, hand: high },
  ]), { 0: 150, 1: 100, 2: 100 });
});
