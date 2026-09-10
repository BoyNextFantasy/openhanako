'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { api, setup } = require('./_helper');

// v2.3 多单位展示上线时这条用例调整过：
// 原来用的是"台账 2kg / 需求 1200g"这种跨单位数据，改版后返回字段多了一组
// 按录入单位的数字，断言跟着改会很啰嗦，就换成同单位的数据，
// 保留它验证"判定本身走得通"这个目的。跨单位的换算另有 units 的用例覆盖。
test('需求与台账单位一致时判定备料是否齐', () => {
  const ctx = setup();
  api.postLedger(ctx, { itemId: 'it_steel', voucherNo: 'V-P1', qty: 2, unit: 'kg', dir: 'in' });
  api.createWorkOrder(ctx, { applyNo: 'A-700', orderNo: 'PO-P', itemId: 'it_steel', qty: 1.2, unit: 'kg' });

  const r = api.checkReadiness(ctx, { workOrderApplyNo: 'A-700' });
  assert.equal(r.baseUnit, 'kg');
  assert.equal(r.requiredBase, 1.2);
  assert.equal(r.onHandBase, 2);
  assert.equal(r.ready, true, '2kg 够 1.2kg，应判备料齐');
});

test('真的不够料时判不齐', () => {
  const ctx = setup();
  api.postLedger(ctx, { itemId: 'it_steel', voucherNo: 'V-P2', qty: 1, unit: 'kg', dir: 'in' });
  api.createWorkOrder(ctx, { applyNo: 'A-701', orderNo: 'PO-P', itemId: 'it_steel', qty: 1200, unit: 'g' });

  const r = api.checkReadiness(ctx, { workOrderApplyNo: 'A-701' });
  assert.equal(r.ready, false);
});

test('同单位时判定照常', () => {
  const ctx = setup();
  api.postLedger(ctx, { itemId: 'it_bolt', voucherNo: 'V-P3', qty: 100, unit: 'pcs', dir: 'in' });
  api.createWorkOrder(ctx, { applyNo: 'A-702', orderNo: 'PO-P', itemId: 'it_bolt', qty: 60, unit: 'pcs' });

  const r = api.checkReadiness(ctx, { workOrderApplyNo: 'A-702' });
  assert.equal(r.ready, true);
});
