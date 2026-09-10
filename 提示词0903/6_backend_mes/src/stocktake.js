'use strict';
const { withTx } = require('./db');
const { toBase, round6 } = require('./units');
const ledger = require('./ledger');
const faults = require('./faults');

function itemOf(db, itemId) {
  const it = db.prepare('SELECT id, base_unit FROM items WHERE id = ?').get(itemId);
  if (!it) throw new Error(`物料不存在：${itemId}`);
  return it;
}

function countOf(db, countNo) {
  const c = db.prepare(
    `SELECT id, item_id AS itemId, count_no AS countNo, book_qty AS bookQty,
            status, opened_at AS openedAt
       FROM stock_counts WHERE count_no = ?`
  ).get(countNo);
  if (!c) throw new Error(`盘点单不存在：${countNo}`);
  return c;
}

function openCount(ctx, { itemId, countNo }) {
  const { db, clock } = ctx;
  itemOf(db, itemId);
  const bookQty = ledger.balanceOf(db, itemId);
  const id = `sc_${countNo}`;
  return withTx(db, () => {
    db.prepare(
      `INSERT INTO stock_counts (id, item_id, count_no, book_qty, status, opened_at)
       VALUES (?, ?, ?, ?, 'open', ?)`
    ).run(id, itemId, countNo, bookQty, clock.nowIso());
    return { id, countNo, bookQty };
  });
}

let currentReview = null;

async function submitReview(ctx, { countNo, actualQty, unit, reviewer }) {
  const { db, clock } = ctx;
  const count = countOf(db, countNo)
  if (!(actualQty >= 0)) throw new Error(`实盘数不能为负：${actualQty}`);

  currentReview = {
    countId: count.id,
    actualQty,
    unit,
    reviewer,
    at: clock.nowIso(),
  };

  await Promise.resolve();
  faults.fail(ctx, 'count.after-review');

  const cur = currentReview;
  return withTx(db, () => {
    db.prepare('UPDATE count_reviews SET valid = 0 WHERE count_id = ?').run(cur.countId);
    const r = db.prepare(
      `INSERT INTO count_reviews (count_id, actual_qty, unit, reviewer, valid, reviewed_at)
       VALUES (?, ?, ?, ?, 1, ?)`
    ).run(cur.countId, cur.actualQty, cur.unit, cur.reviewer, cur.at);
    return { id: Number(r.lastInsertRowid), countNo, actualQty: cur.actualQty };
  });
}

function latestReview(db, countId) {
  return db.prepare(
    `SELECT id, actual_qty AS actualQty, unit, reviewer FROM count_reviews
      WHERE count_id = ? AND valid = 1 ORDER BY id DESC LIMIT 1`
  ).get(countId)
}

function settleCount(ctx, { countNo, voucherNo }) {
  const { db, clock } = ctx;
  const count = countOf(db, countNo);
  const review = latestReview(db, count.id);
  if (!review) throw new Error(`还没有复核记录，不能审定：${countNo}`);

  return withTx(db, () => {
    const diff = round6(review.actualQty - count.bookQty);
    faults.fail(ctx, 'settle.before-writeback');
    if (diff !== 0) {
      const dir = diff > 0 ? 'in' : 'out';
      const item = itemOf(db, count.itemId);
      db.prepare(
        `INSERT INTO ledger (item_id, voucher_no, qty, unit, dir, valid, reversal_of, created_at)
         VALUES (?, ?, ?, ?, ?, 1, NULL, ?)`
      ).run(count.itemId, voucherNo, Math.abs(diff), item.base_unit, dir, clock.nowIso());
    }
    db.prepare(
      `INSERT INTO count_settlements (count_id, diff_qty, voucher_no, settled_at)
       VALUES (?, ?, ?, ?)`
    ).run(count.id, diff, voucherNo, clock.nowIso());
    db.prepare(`UPDATE stock_counts SET status = 'settled' WHERE id = ?`).run(count.id);
    return { countNo, diff, voucherNo };
  });
}

function reconcileReport(db, itemId) {
  itemOf(db, itemId);
  const row = db.prepare(
    'SELECT balance FROM item_balance WHERE item_id = ?'
  ).get(itemId);
  return { itemId, reconciled: round6(row ? row.balance : 0) }
}

module.exports = { openCount, submitReview, settleCount, reconcileReport, latestReview }
