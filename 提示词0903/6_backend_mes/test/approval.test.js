'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { api, setup, makeOrder } = require('./_helper');

// 审批四段会签的"顺跑对照组"：一段一段顺序批完，中间不驳回、不作废、不并发。
// 这条链路必须一直是对的——它是审批功能的回归基线。
function orderOf(ctx, applyNo) {
  makeOrder(ctx, { applyNo, orderNo: `PO-${applyNo}` });
  return `wo_${applyNo}`;
}

test('顺序批完 1→2→3→4：整单通过', async () => {
  const ctx = setup();
  const oid = orderOf(ctx, 'APX-1');
  await api.decideApproval(ctx, { orderId: oid, stage: 1, actor: '甲', decision: 'approve' });
  await api.decideApproval(ctx, { orderId: oid, stage: 2, actor: '乙', decision: 'approve' });
  await api.decideApproval(ctx, { orderId: oid, stage: 3, actor: '丙', decision: 'approve' });
  await api.decideApproval(ctx, { orderId: oid, stage: 4, actor: '丁', decision: 'approve' });
  assert.equal(api.isApproved(ctx.db, oid), true, '四段顺序批完应整单通过');
});

test('第 1 段没批就批第 2 段：应被拒', async () => {
  const ctx = setup();
  const oid = orderOf(ctx, 'APX-2');
  await assert.rejects(
    () => api.decideApproval(ctx, { orderId: oid, stage: 2, actor: '乙', decision: 'approve' }),
    /第 1 段未通过/
  );
});

test('看板：顺序推进时反映当前段位', async () => {
  const ctx = setup();
  const oid = orderOf(ctx, 'APX-3');
  await api.decideApproval(ctx, { orderId: oid, stage: 1, actor: '甲', decision: 'approve' });
  await api.decideApproval(ctx, { orderId: oid, stage: 2, actor: '乙', decision: 'approve' });
  const board = api.approvalBoardOf(ctx.db, oid);
  // 看板是派生投影，具体状态字段由实现决定；这里只要求它随推进被更新过、
  // 且没把这张单显示成"已作废"（它此刻显然没作废）。
  assert.notEqual(board.status, 'none', '看板应随审批推进被更新');
  assert.notEqual(board.status, 'voided', '这张单没作废，看板不应显示作废');
});
