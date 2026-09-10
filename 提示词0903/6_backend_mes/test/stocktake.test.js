'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { api, setup } = require('./_helper');

// 盘点四步的"顺跑对照组"：一个人、同一个单位、开单后到审定之间没有别的出入库。
// 这条链路必须一直是对的——它是盘点功能的回归基线。
test('开单：记下开单时刻的账面余额快照', () => {
  const ctx = setup();
  api.postLedger(ctx, { itemId: 'it_steel', voucherNo: 'IN-1', qty: 10, unit: 'kg', dir: 'in' });
  const r = api.openCount(ctx, { itemId: 'it_steel', countNo: 'CNT-1' });
  assert.equal(r.bookQty, 10, '开单快照应等于此刻账面余额');
});

test('复核：实盘数落库，以最后一次为准', () => {
  const ctx = setup();
  api.postLedger(ctx, { itemId: 'it_steel', voucherNo: 'IN-2', qty: 10, unit: 'kg', dir: 'in' });
  api.openCount(ctx, { itemId: 'it_steel', countNo: 'CNT-2' });
  return (async () => {
    await api.submitReview(ctx, { countNo: 'CNT-2', actualQty: 8, unit: 'kg', reviewer: '王' });
    await api.submitReview(ctx, { countNo: 'CNT-2', actualQty: 12, unit: 'kg', reviewer: '王' });
    const valid = ctx.db.prepare(
      'SELECT COUNT(*) AS c FROM count_reviews WHERE valid = 1'
    ).get().c;
    assert.equal(valid, 1, '有效复核只应保留最后一条');
  })();
});

test('审定：按差额动账，审定后账面余额等于实盘数', async () => {
  const ctx = setup();
  api.postLedger(ctx, { itemId: 'it_steel', voucherNo: 'IN-3', qty: 10, unit: 'kg', dir: 'in' });
  api.openCount(ctx, { itemId: 'it_steel', countNo: 'CNT-3' });
  await api.submitReview(ctx, { countNo: 'CNT-3', actualQty: 12, unit: 'kg', reviewer: '王' });
  const s = api.settleCount(ctx, { countNo: 'CNT-3', voucherNo: 'ADJ-3' });
  assert.equal(s.diff, 2, '差额应为 实盘12 − 账面10 = 2');
  assert.equal(api.balanceOf(ctx.db, 'it_steel'), 12, '审定后账面余额应等于实盘数');
});

test('对账：正常记账后，对账汇总与台账余额一致', () => {
  const ctx = setup();
  api.postLedger(ctx, { itemId: 'it_steel', voucherNo: 'IN-4', qty: 10, unit: 'kg', dir: 'in' });
  api.postLedger(ctx, { itemId: 'it_steel', voucherNo: 'OUT-4', qty: 3, unit: 'kg', dir: 'out' });
  const rep = api.reconcileReport(ctx.db, 'it_steel');
  assert.equal(rep.reconciled, 7, '对账汇总应与台账余额一致');
});
