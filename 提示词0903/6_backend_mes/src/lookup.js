'use strict';
const processMod = require('./process');
const ordersMod = require('./orders');
function progressByOrderNo(db, orderNo) {
  const wo = db.prepare(
    `SELECT apply_no AS applyNo FROM work_orders WHERE order_no = ?
      ORDER BY created_at ASC`
  ).get(orderNo);
  if (!wo) throw new Error(`没有这个业务单号：${orderNo}`);
  return {
    orderNo,
    applyNo: wo.applyNo,
    ...processMod.progressOf(db, wo.applyNo),
  };
}

function execListByOrderNo(db, orderNo, segmentCode = null) {
  const exists = db.prepare(
    'SELECT COUNT(*) AS c FROM work_orders WHERE order_no = ?'
  ).get(orderNo).c;
  if (exists === 0) throw new Error(`没有这个业务单号：${orderNo}`);

  const params = [orderNo];
  let segFilter = '';
  if (segmentCode) {
    const seg = processMod.segmentOf(db, segmentCode);
    segFilter = 'AND e.segment_id = ?';
    params.push(seg.id);
  }
  return db.prepare(
    `SELECT e.id, e.order_id AS orderId, e.segment_id AS segmentId,
            e.seq, e.qty, e.operator
       FROM process_exec e
       JOIN work_orders w ON w.id = e.order_id
      WHERE w.order_no = ? ${segFilter}
      ORDER BY e.seq ASC, e.id ASC`
  ).all(...params);
}

function detailByOrderNo(db, orderNo) {
  const wo = db.prepare(
    `SELECT apply_no AS applyNo, item_id AS itemId, qty, unit, status
       FROM work_orders WHERE order_no = ?
      ORDER BY created_at DESC, apply_no DESC`
  ).get(orderNo);
  if (!wo) throw new Error(`没有这个业务单号：${orderNo}`);
  const subs = ordersMod.subOrdersOf(db, wo.applyNo);
  return {
    orderNo,
    applyNo: wo.applyNo,
    itemId: wo.itemId,
    qty: wo.qty,
    unit: wo.unit,
    status: wo.status,
    subOrderCount: subs.length,
    subOrders: subs.map((s) => s.applyNo),
  };
}

// 打印汇总。打印模板要的是"这个业务单号一共做了多少"
function printSummaryByOrderNo(db, orderNo) {
  const head = db.prepare(
    `SELECT apply_no AS applyNo, qty, unit FROM work_orders WHERE order_no = ?
      ORDER BY created_at ASC`
  ).get(orderNo);
  if (!head) throw new Error(`没有这个业务单号：${orderNo}`);
  const agg = db.prepare(
    `SELECT COUNT(*) AS c, COALESCE(SUM(e.qty), 0) AS q
       FROM process_exec e
       JOIN work_orders w ON w.id = e.order_id
      WHERE w.order_no = ?`
  ).get(orderNo);
  return {
    orderNo,
    applyNo: head.applyNo,
    qty: head.qty,
    unit: head.unit,
    execCount: agg.c,
    doneQty: Math.round(agg.q * 1e6),
  };
}

module.exports = {
  progressByOrderNo, execListByOrderNo, detailByOrderNo, printSummaryByOrderNo,
};
