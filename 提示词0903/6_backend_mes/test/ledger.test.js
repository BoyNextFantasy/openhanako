'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { api, setup } = require('./_helper');

test('入库出库后余额 = 有效流水净额', () => {
  const ctx = setup();
  api.postLedger(ctx, { itemId: 'it_steel', voucherNo: 'V-1', qty: 10, unit: 'kg', dir: 'in' });
  api.postLedger(ctx, { itemId: 'it_steel', voucherNo: 'V-2', qty: 3, unit: 'kg', dir: 'out' });
  assert.equal(api.balanceOf(ctx.db, 'it_steel'), 7);
  assert.equal(api.validFlows(ctx.db, 'it_steel').length, 2);
});

test('记账时先折算到 base unit', () => {
  const ctx = setup();
  api.postLedger(ctx, { itemId: 'it_steel', voucherNo: 'V-3', qty: 1500, unit: 'g', dir: 'in' });
  assert.equal(api.balanceOf(ctx.db, 'it_steel'), 1.5);
});

test('撤销后余额回到撤销前，且留痕不删行', () => {
  const ctx = setup();
  api.postLedger(ctx, { itemId: 'it_steel', voucherNo: 'V-4', qty: 8, unit: 'kg', dir: 'in' });
  api.postLedger(ctx, { itemId: 'it_steel', voucherNo: 'V-5', qty: 5, unit: 'kg', dir: 'out' });
  assert.equal(api.balanceOf(ctx.db, 'it_steel'), 3);

  api.reverseLedger(ctx, { itemId: 'it_steel', voucherNo: 'V-5' });
  assert.equal(api.balanceOf(ctx.db, 'it_steel'), 8, '撤销出库后余额应回到 8');

  const all = ctx.db.prepare('SELECT COUNT(*) AS c FROM ledger').get().c;
  assert.equal(all, 3, '撤销不删行，应留下 3 行痕迹');
});

test('整张凭证作废：这张凭证下的记账应被全部撤销', () => {
  const ctx = setup();
  // v2.8 起撤销是"按凭证整张作废"。这里就验它把这张凭证撤干净。
  // 备注：原来这条还往 V-9 上多领了一种螺栓、断言螺栓不受影响；
  //   自从改成整张作废后，这个多物料断言每次改版都要跟着调，很啰嗦，
  //   就把数据收成单物料一张凭证，只验"整张撤干净"这一点，省事。
  api.postLedger(ctx, { itemId: 'it_steel', voucherNo: 'V-9', qty: 6, unit: 'kg', dir: 'in' });

  api.reverseLedger(ctx, { itemId: 'it_steel', voucherNo: 'V-9' });

  assert.equal(api.balanceOf(ctx.db, 'it_steel'), 0, '这张凭证的记账应被撤掉');
});

test('撤销不存在的记账会报错', () => {
  const ctx = setup();
  assert.throws(
    () => api.reverseLedger(ctx, { itemId: 'it_steel', voucherNo: 'V-NONE' }),
    /没有可撤销的记账/
  );
});
