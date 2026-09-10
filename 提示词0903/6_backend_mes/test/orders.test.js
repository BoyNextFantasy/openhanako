'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { api, setup } = require('./_helper');

test('附件严格按归属列出：主单附件不出现在子单列表', () => {
  const ctx = setup();
  api.createWorkOrder(ctx, { applyNo: 'A-100', orderNo: 'PO-7', itemId: 'it_steel', qty: 10, unit: 'kg' });
  api.publishTemplateVersion(ctx, { templateId: 'TPL-A', body: '检验项 v1', effectiveFrom: '2026-01-01T00:00:00.000Z' });
  api.createSubOrder(ctx, { workOrderApplyNo: 'A-100', applyNo: 'B-100', templateId: 'TPL-A' });

  api.addAttachment(ctx, { ownerType: 'work_order', ownerApplyNo: 'A-100', fileName: '主单图纸.pdf' });
  api.addAttachment(ctx, { ownerType: 'sub_order', ownerApplyNo: 'B-100', fileName: '批次记录.pdf' });

  const subList = api.attachmentsOf(ctx.db, 'sub_order', 'B-100');
  assert.equal(subList.length, 1, '子单列表应只有子单自己的 1 个附件');
  assert.equal(subList[0].fileName, '批次记录.pdf');
  assert.equal(subList[0].ownerType, 'sub_order');

  const woList = api.attachmentsOf(ctx.db, 'work_order', 'A-100');
  assert.equal(woList.length, 1);
  assert.equal(woList[0].fileName, '主单图纸.pdf');
});

test('模板升版后，已建子单的存档内容不变', () => {
  const ctx = setup();
  api.createWorkOrder(ctx, { applyNo: 'A-200', orderNo: 'PO-8', itemId: 'it_steel', qty: 10, unit: 'kg' });
  api.publishTemplateVersion(ctx, { templateId: 'TPL-B', body: '检验项 v1', effectiveFrom: '2026-01-01T00:00:00.000Z' });
  api.createSubOrder(ctx, { workOrderApplyNo: 'A-200', applyNo: 'B-200', templateId: 'TPL-B' });

  api.publishTemplateVersion(ctx, { templateId: 'TPL-B', body: '检验项 v2', effectiveFrom: '2026-03-01T00:00:00.000Z' });

  const c = api.contentOfSubOrder(ctx.db, 'B-200');
  assert.equal(c.templateVersion, 1, '老子单应仍停在 v1');
  assert.equal(c.body, '检验项 v1');
});

test('新建子单套用当前最新版模板', () => {
  const ctx = setup();
  api.createWorkOrder(ctx, { applyNo: 'A-300', orderNo: 'PO-9', itemId: 'it_steel', qty: 10, unit: 'kg' });
  api.publishTemplateVersion(ctx, { templateId: 'TPL-C', body: '检验项 v1', effectiveFrom: '2026-01-01T00:00:00.000Z' });
  api.publishTemplateVersion(ctx, { templateId: 'TPL-C', body: '检验项 v2', effectiveFrom: '2026-03-01T00:00:00.000Z' });
  api.createSubOrder(ctx, { workOrderApplyNo: 'A-300', applyNo: 'B-300', templateId: 'TPL-C' });

  const c = api.contentOfSubOrder(ctx.db, 'B-300');
  assert.equal(c.templateVersion, 2, '新建子单应套到 v2');
  assert.equal(c.body, '检验项 v2');
});

test('子单继承主单业务单号，但各有自己的唯一键', () => {
  const ctx = setup();
  api.createWorkOrder(ctx, { applyNo: 'A-400', orderNo: 'PO-10', itemId: 'it_steel', qty: 10, unit: 'kg' });
  api.publishTemplateVersion(ctx, { templateId: 'TPL-D', body: 'x', effectiveFrom: '2026-01-01T00:00:00.000Z' });
  api.createSubOrder(ctx, { workOrderApplyNo: 'A-400', applyNo: 'B-400', templateId: 'TPL-D' });

  const subs = api.subOrdersOf(ctx.db, 'A-400');
  assert.equal(subs.length, 1);
  assert.equal(subs[0].applyNo, 'B-400');
  assert.equal(subs[0].orderNo, 'PO-10');
});

test('一屏看全面板能同时看到子单与主单的资料', () => {
  const ctx = setup();
  api.createWorkOrder(ctx, { applyNo: 'A-110', orderNo: 'PO-11', itemId: 'it_steel', qty: 10, unit: 'kg' });
  api.publishTemplateVersion(ctx, { templateId: 'TPL-P', body: 'x', effectiveFrom: '2026-01-01T00:00:00.000Z' });
  api.createSubOrder(ctx, { workOrderApplyNo: 'A-110', applyNo: 'B-110', templateId: 'TPL-P' });

  api.addAttachment(ctx, { ownerType: 'work_order', ownerApplyNo: 'A-110', fileName: '图纸.pdf' });
  api.addAttachment(ctx, { ownerType: 'sub_order', ownerApplyNo: 'B-110', fileName: '批次记录.pdf' });

  // 面板是为"不用来回切页面"做的，所以两边的资料都应该出现。
  const panel = api.attachmentPanelOf(ctx.db, 'B-110');
  const names = panel.map((r) => r.fileName).sort();
  assert.deepEqual(names, ['图纸.pdf', '批次记录.pdf']);
});

test('多张工单可以共用一个业务单号（正常业务形态）', () => {
  const ctx = setup();
  api.createWorkOrder(ctx, { applyNo: 'A-501', orderNo: 'PO-SAME', itemId: 'it_steel', qty: 10, unit: 'kg' });
  api.createWorkOrder(ctx, { applyNo: 'A-502', orderNo: 'PO-SAME', itemId: 'it_steel', qty: 20, unit: 'kg' });
  const n = ctx.db.prepare('SELECT COUNT(*) AS c FROM work_orders WHERE order_no = ?').get('PO-SAME').c;
  assert.equal(n, 2);
});
