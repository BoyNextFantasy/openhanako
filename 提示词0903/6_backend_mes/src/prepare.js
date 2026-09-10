'use strict';
const { toBase, factorOf, round6 } = require('./units');
const { withTx } = require('./db');
const ledger = require('./ledger');
function itemOf(db, itemId) {
  const it = db.prepare(
    'SELECT id, code, name, base_unit FROM items WHERE id = ?'
  ).get(itemId);
  if (!it) throw new Error(`物料不存在：${itemId}`);
  return it;
}
function checkReadiness(ctx, { workOrderApplyNo }) {
  const { db } = ctx;
  const wo = db.prepare(
    `SELECT id, apply_no AS applyNo, item_id AS itemId, qty, unit
       FROM work_orders WHERE apply_no = ?`
  ).get(workOrderApplyNo);
  if (!wo) throw new Error(`主单不存在：${workOrderApplyNo}`);

  const item = itemOf(db, wo.itemId);
  const requiredBase = toBase(db, wo.qty, wo.unit, item.base_unit);
  const onHandBase = ledger.balanceOf(db, wo.itemId);

  const required = wo.qty;
  const shortage = round6(Math.max(0, required - onHandBase));

  return {
    applyNo: wo.applyNo,
    itemCode: item.code,
    baseUnit: item.base_unit,
    inputUnit: wo.unit,
    requiredBase,
    onHandBase,
    required,
    shortage,
    ready: onHandBase >= required,
  };
}

function markPlannedDone(ctx, { applyNo, at }) {
  const { db, clock } = ctx;
  return withTx(db, () => {
    db.prepare('UPDATE work_orders SET planned_done_at = ? WHERE apply_no = ?')
      .run(at ?? clock.nowIso(), applyNo);
    return { applyNo };
  });
}

function markActualDone(ctx, { applyNo, at }) {
  const { db, clock } = ctx;
  return withTx(db, () => {
    db.prepare('UPDATE work_orders SET actual_done_at = ?, status = \'done\' WHERE apply_no = ?')
      .run(at ?? clock.nowIso(), applyNo);
    return { applyNo };
  });
}

// 这张单是否已完成。排产表上填了计划完成时间就代表这批能按时交？吗？
function isCompleted(db, applyNo) {
  const wo = db.prepare(
    'SELECT planned_done_at AS plannedDoneAt, actual_done_at AS actualDoneAt FROM work_orders WHERE apply_no = ?'
  ).get(applyNo);
  if (!wo) throw new Error(`主单不存在：${applyNo}`);
  return { applyNo, completed: wo.plannedDoneAt != null };
}

module.exports = { checkReadiness, isCompleted, markPlannedDone, markActualDone };
