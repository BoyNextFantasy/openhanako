'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { api, setup } = require('./_helper');

// 按业务单号快查这一组是给 ERP 对接和客服用的。
// 下面这些用例覆盖它的日常用法：一个业务单号对一张单。
function oneOrder(ctx) {
  api.createWorkOrder(ctx, {
    applyNo: 'A-800', orderNo: 'PO-800', itemId: 'it_steel', qty: 50, unit: 'kg',
  });
  return { applyNo: 'A-800', orderNo: 'PO-800' };
}

test('按业务单号查进度', async () => {
  const ctx = setup();
  const { orderNo, applyNo } = oneOrder(ctx);
  await api.recordExec(ctx, { orderApplyNo: applyNo, segmentCode: 'HEAT', qty: 7, operator: '张' });

  const r = api.progressByOrderNo(ctx.db, orderNo);
  assert.equal(r.applyNo, applyNo);
  assert.equal(r.execCount, 1);
  assert.equal(r.doneQty, 7);
});

test('按业务单号查执行记录列表', async () => {
  const ctx = setup();
  const { orderNo, applyNo } = oneOrder(ctx);
  await api.recordExec(ctx, { orderApplyNo: applyNo, segmentCode: 'HEAT', qty: 3, operator: '张' });
  await api.recordExec(ctx, { orderApplyNo: applyNo, segmentCode: 'HEAT', qty: 4, operator: '张' });

  const list = api.execListByOrderNo(ctx.db, orderNo, 'HEAT');
  assert.equal(list.length, 2);
  assert.deepEqual(list.map((r) => r.qty), [3, 4]);
});

test('按业务单号查详情', () => {
  const ctx = setup();
  const { orderNo, applyNo } = oneOrder(ctx);
  api.publishTemplateVersion(ctx, {
    templateId: 'TPL-L', body: 'x', effectiveFrom: '2026-01-01T00:00:00.000Z',
  });
  api.createSubOrder(ctx, { workOrderApplyNo: applyNo, applyNo: 'B-800', templateId: 'TPL-L' });

  const d = api.detailByOrderNo(ctx.db, orderNo);
  assert.equal(d.applyNo, applyNo);
  assert.equal(d.qty, 50);
  assert.equal(d.subOrderCount, 1);
  assert.deepEqual(d.subOrders, ['B-800']);
});

test('按业务单号取打印汇总', async () => {
  const ctx = setup();
  const { orderNo, applyNo } = oneOrder(ctx);
  await api.recordExec(ctx, { orderApplyNo: applyNo, segmentCode: 'PACK', qty: 9, operator: '王' });

  const s = api.printSummaryByOrderNo(ctx.db, orderNo);
  assert.equal(s.applyNo, applyNo);
  assert.equal(s.execCount, 1);
  assert.equal(s.doneQty, 9);
});

test('业务单号不存在时明确报错', () => {
  const ctx = setup();
  oneOrder(ctx);
  assert.throws(() => api.progressByOrderNo(ctx.db, 'PO-NONE'), /没有这个业务单号/);
});
