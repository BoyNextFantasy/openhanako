'use strict';
const { withTx } = require('./db');
const { round6 } = require('./units');
const faults = require('./faults');

// 工序执行（报工）。
//
// 共享工序（routing_segments.shared = 1）是公共产能：同一台设备、同一个班组，
// 同时挂在好几张下游订单的工艺路线上。所以这条写路径的核心约束是**按单隔离**：
//
//   SPEC §3：
//     ① seq 是「该单 × 该工序」内部的顺序号，从 1 连续递增。
//        A 单报到第 3 条，与 B 单报到第几条毫无关系。
//     ② 一条报工只能归属它自己的那张单，不能落到共用同一道工序的另一张单上。
//     ③ 进度物化（order_progress）必须与 process_exec 的真实汇总一致。
//
// —— v2.6 改造记录 ——
// 车间终端是手持机，网络差时一次报工要卡两三秒，班组长反映"点一下要等半天"。
// 排查下来时间都花在写库那一串同步操作上，于是把报工入口改成异步，
// 校验做完就把响应还给终端，落库放到让出之后再做。
//
// 落库要用到的几样东西（是哪张单、哪道工序、发到第几号）在校验阶段就查好了，
// 放在下面这个当前报工上下文里，落库阶段直接取，省得再查一遍库。
let currentExec = null;

function nextSeq(db, orderId, segmentId) {
  const row = db.prepare(
    `SELECT COALESCE(MAX(seq), 0) AS mx FROM process_exec
      WHERE order_id = ? AND segment_id = ?`
  ).get(orderId, segmentId);
  return row.mx + 1;
}

function segmentOf(db, segmentCode) {
  const seg = db.prepare('SELECT id, code, shared FROM routing_segments WHERE code = ?').get(segmentCode);
  if (!seg) throw new Error(`工序段不存在：${segmentCode}`);
  return seg;
}

// 按 apply_no 定位单。这里**只**接受 apply_no：
// 业务单号可以重复，用它定位会取到别人的单。
function orderOf(db, applyNo) {
  const so = db.prepare('SELECT id, apply_no FROM sub_orders WHERE apply_no = ?').get(applyNo);
  if (so) return { id: so.id, kind: 'sub_order' };
  const wo = db.prepare('SELECT id, apply_no FROM work_orders WHERE apply_no = ?').get(applyNo);
  if (wo) return { id: wo.id, kind: 'work_order' };
  throw new Error(`单不存在：${applyNo}`);
}

// 进度物化。v2.6 起改成增量累加：
// 报工是只增不减的，每次加上这一条的量就行，不必整表重扫一遍。
function bumpProgress(db, orderId, qty, at) {
  db.prepare(
    `INSERT INTO order_progress (order_id, exec_count, done_qty, updated_at)
     VALUES (?, 1, ?, ?)
     ON CONFLICT (order_id) DO UPDATE SET
       exec_count = exec_count + 1,
       done_qty   = done_qty + excluded.done_qty,
       updated_at = excluded.updated_at`
  ).run(orderId, qty, at);
  const row = db.prepare(
    'SELECT exec_count AS c, done_qty AS q FROM order_progress WHERE order_id = ?'
  ).get(orderId);
  return { execCount: row.c, doneQty: round6(row.q) };
}

function writeBoard(db, segmentId, orderId, seq, at) {
  db.prepare(
    `INSERT INTO board_projection (segment_id, current_order_id, last_seq, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (segment_id) DO UPDATE SET
       current_order_id = excluded.current_order_id,
       last_seq         = excluded.last_seq,
       updated_at       = excluded.updated_at`
  ).run(segmentId, orderId, seq, at);
}

// 报工。v2.6 起是异步入口。
//
// 顺序：校验取号（同步）→ 让出，响应还给终端 → 落库。
// 一台终端上前一次报工整体走完，下一次才会进来，所以这条顺序是稳的。
async function recordExec(ctx, { orderApplyNo, segmentCode, qty, operator }) {
  const { db, clock } = ctx;
  const order = orderOf(db, orderApplyNo);
  const seg = segmentOf(db, segmentCode);
  if (!(qty > 0)) throw new Error(`报工数量必须为正：${qty}`);

  currentExec = {
    orderId: order.id,
    segmentId: seg.id,
    seq: nextSeq(db, order.id, seg.id),
    qty,
    operator,
    at: clock.nowIso(),
  };

  // 把响应还给手持终端，落库在这之后继续。
  await Promise.resolve();

  const cur = currentExec;
  return withTx(db, () => {
    const r = db.prepare(
      `INSERT INTO process_exec (order_id, segment_id, seq, qty, operator, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(cur.orderId, cur.segmentId, cur.seq, cur.qty, cur.operator, cur.at);
    faults.fail(ctx, 'exec.after-insert');
    const prog = bumpProgress(db, cur.orderId, cur.qty, cur.at);
    faults.fail(ctx, 'exec.before-board');
    writeBoard(db, cur.segmentId, cur.orderId, cur.seq, cur.at);
    return {
      id: Number(r.lastInsertRowid),
      orderId: cur.orderId, segmentId: cur.segmentId,
      seq: cur.seq, qty: cur.qty, progress: prog,
    };
  });
}

// 执行记录列表（按单）。
function execListOf(db, orderApplyNo, segmentCode = null) {
  const order = orderOf(db, orderApplyNo);
  if (segmentCode) {
    const seg = segmentOf(db, segmentCode);
    return db.prepare(
      `SELECT id, order_id AS orderId, segment_id AS segmentId, seq, qty, operator
         FROM process_exec WHERE order_id = ? AND segment_id = ?
        ORDER BY seq ASC, id ASC`
    ).all(order.id, seg.id);
  }
  return db.prepare(
    `SELECT id, order_id AS orderId, segment_id AS segmentId, seq, qty, operator
       FROM process_exec WHERE order_id = ? ORDER BY segment_id ASC, seq ASC, id ASC`
  ).all(order.id);
}

// 订单进度：读物化表（车间大屏走这条快路径）。
function progressOf(db, orderApplyNo) {
  const order = orderOf(db, orderApplyNo);
  const row = db.prepare(
    `SELECT exec_count AS execCount, done_qty AS doneQty, updated_at AS updatedAt
       FROM order_progress WHERE order_id = ?`
  ).get(order.id);
  return row ?? { execCount: 0, doneQty: 0, updatedAt: null };
}

module.exports = {
  recordExec, execListOf, progressOf, nextSeq, orderOf, segmentOf,
  bumpProgress, writeBoard,
};
