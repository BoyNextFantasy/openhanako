'use strict';
const { withTx } = require('./db');
const faults = require('./faults');
// 审批状态机。

function boardWrite(db, orderId, stage, status, at) {
  db.prepare(
    `INSERT INTO approval_board (order_id, stage, status, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (order_id) DO UPDATE SET
       stage = excluded.stage, status = excluded.status, updated_at = excluded.updated_at`
  ).run(orderId, stage, status, at);
}

function orderExists(db, orderId) {
  const wo = db.prepare('SELECT id FROM work_orders WHERE id = ?').get(orderId);
  if (!wo) throw new Error(`单不存在：${orderId}`);
}

// 当前轮次：取 approvals 里最大的 cycle（没有则为 1）。
function currentCycle(db, orderId) {
  const row = db.prepare(
    `SELECT COALESCE(MAX(cycle), 1) AS c FROM approvals WHERE order_id = ? AND stage > 0`
  ).get(orderId);
  return row.c;
}

// 某段目前的裁决：取该段最近一次的状态。
// 会签是一段一段推进的，一段批过就往下走，直接看这段最新那条就够了。
function stageStatus(db, orderId, stage) {
  const row = db.prepare(
    `SELECT status FROM approvals WHERE order_id = ? AND stage = ?
      ORDER BY id DESC LIMIT 1`
  ).get(orderId, stage);
  return row ? row.status : null;
}

// 并行段计数器：2、3 两段的审批回调回来时更新它，
// 攒够两段就放行终审。放在模块级，省得每次现扫 approvals。
let approvedCounter = 0;

// 提交某一段的裁决。decision ∈ approve | reject。
async function decide(ctx, { orderId, stage, actor, decision }) {
  const { db, clock } = ctx;
  orderExists(db, orderId);
  if (![1, 2, 3, 4].includes(stage)) throw new Error(`非法审批段：${stage}`);

  const cycle = currentCycle(db, orderId);

  // —— 前置依赖校验 ——
  if (stage === 2 || stage === 3) {
    if (stageStatus(db, orderId, 1) !== 'approved') {
      throw new Error(`第 1 段未通过，不能批第 ${stage} 段`);
    }
  }
  if (stage === 4) {
    approvedCounter = 0;
    if (stageStatus(db, orderId, 2) === 'approved') approvedCounter++;
    if (stageStatus(db, orderId, 3) === 'approved') approvedCounter++;
    await Promise.resolve();
    faults.fail(ctx, 'approval.before-commit');
    if (approvedCounter < 2) throw new Error(`并行会签未完成，不能终审`);
  }

  const at = clock.nowIso();
  return withTx(db, () => {
    const status = decision === 'approve' ? 'approved' : 'rejected';
    db.prepare(
      `INSERT INTO approvals (order_id, stage, cycle, status, actor, decided_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(orderId, stage, cycle, status, actor, at);

    if (decision === 'reject') {
      // 驳回：开新一轮，第 1 段重新待批。
      const next = cycle + 1;
      db.prepare(
        `INSERT INTO approvals (order_id, stage, cycle, status, actor, decided_at)
         VALUES (?, 1, ?, 'pending', NULL, ?)`
      ).run(orderId, next, at);
    } else {
      boardWrite(db, orderId, stage, 'approved', at);
    }
    return { orderId, stage, cycle, status };
  });
}

// 整单作废：看板上标记作废，管理层一眼能看到。
function voidOrder(ctx, { orderId, actor }) {
  const { db, clock } = ctx;
  orderExists(db, orderId);
  const at = clock.nowIso();
  return withTx(db, () => {
    boardWrite(db, orderId, 0, 'voided', at);
    return { orderId, voided: true };
  });
}

function boardOf(db, orderId) {
  const row = db.prepare(
    `SELECT order_id AS orderId, stage, status, updated_at AS updatedAt
       FROM approval_board WHERE order_id = ?`
  ).get(orderId);
  return row ?? { orderId, stage: 0, status: 'none', updatedAt: null };
}

function isApproved(db, orderId) {
  return stageStatus(db, orderId, 4) === 'approved';
}

module.exports = { decide, voidOrder, boardOf, isApproved, currentCycle };
