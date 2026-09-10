'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { api, setup } = require('./_helper');

function twoOrdersOnSharedSegment(ctx) {
  api.createWorkOrder(ctx, { applyNo: 'A-901', orderNo: 'PO-X', itemId: 'it_steel', qty: 50, unit: 'kg' });
  api.createWorkOrder(ctx, { applyNo: 'A-902', orderNo: 'PO-Y', itemId: 'it_steel', qty: 50, unit: 'kg' });
}

test('报工后 seq 从 1 开始，按单连续递增', async () => {
  const ctx = setup();
  twoOrdersOnSharedSegment(ctx);
  await api.recordExec(ctx, { orderApplyNo: 'A-901', segmentCode: 'HEAT', qty: 5, operator: '张' });
  await api.recordExec(ctx, { orderApplyNo: 'A-901', segmentCode: 'HEAT', qty: 7, operator: '张' });

  const list = api.execListOf(ctx.db, 'A-901', 'HEAT');
  assert.deepEqual(list.map((r) => r.seq), [1, 2]);
});

test('共享工序上两张单各自独立编号（串行录入）', async () => {
  const ctx = setup();
  twoOrdersOnSharedSegment(ctx);
  await api.recordExec(ctx, { orderApplyNo: 'A-901', segmentCode: 'HEAT', qty: 5, operator: '张' });
  await api.recordExec(ctx, { orderApplyNo: 'A-902', segmentCode: 'HEAT', qty: 6, operator: '李' });
  await api.recordExec(ctx, { orderApplyNo: 'A-901', segmentCode: 'HEAT', qty: 4, operator: '张' });

  assert.deepEqual(api.execListOf(ctx.db, 'A-901', 'HEAT').map((r) => r.seq), [1, 2],
    'A-901 应是 1,2——与另一张单无关');
  assert.deepEqual(api.execListOf(ctx.db, 'A-902', 'HEAT').map((r) => r.seq), [1],
    'A-902 应从 1 开始');
});

test('报工记录只归属自己的单', async () => {
  const ctx = setup();
  twoOrdersOnSharedSegment(ctx);
  await api.recordExec(ctx, { orderApplyNo: 'A-901', segmentCode: 'HEAT', qty: 5, operator: '张' });
  await api.recordExec(ctx, { orderApplyNo: 'A-902', segmentCode: 'HEAT', qty: 6, operator: '李' });

  const a = api.execListOf(ctx.db, 'A-901', 'HEAT');
  const b = api.execListOf(ctx.db, 'A-902', 'HEAT');
  assert.equal(a.length, 1);
  assert.equal(b.length, 1);
  assert.equal(a[0].qty, 5);
  assert.equal(b[0].qty, 6);
});

test('进度物化与执行记录真实汇总一致', async () => {
  const ctx = setup();
  twoOrdersOnSharedSegment(ctx);
  await api.recordExec(ctx, { orderApplyNo: 'A-901', segmentCode: 'HEAT', qty: 5, operator: '张' });
  await api.recordExec(ctx, { orderApplyNo: 'A-901', segmentCode: 'PACK', qty: 8, operator: '王' });

  const prog = api.progressOf(ctx.db, 'A-901');
  assert.equal(prog.execCount, 2);
  assert.equal(prog.doneQty, 13);
});

async function errorOf(fn) {
  try {
    await fn();
  } catch (e) {
    return e;
  }
  return null;
}

test('报工数量必须为正', async () => {
  const ctx = setup();
  twoOrdersOnSharedSegment(ctx);
  const err = await errorOf(() =>
    api.recordExec(ctx, { orderApplyNo: 'A-901', segmentCode: 'HEAT', qty: 0, operator: '张' }));
  assert.match(err?.message ?? '', /报工数量必须为正/);
});

test('不存在的单或工序会明确报错', async () => {
  const ctx = setup();
  twoOrdersOnSharedSegment(ctx);
  const e1 = await errorOf(() =>
    api.recordExec(ctx, { orderApplyNo: 'A-NONE', segmentCode: 'HEAT', qty: 1, operator: '张' }));
  assert.match(e1?.message ?? '', /单不存在/);

  const e2 = await errorOf(() =>
    api.recordExec(ctx, { orderApplyNo: 'A-901', segmentCode: 'NOPE', qty: 1, operator: '张' }));
  assert.match(e2?.message ?? '', /工序段不存在/);
});
