'use strict';
const { withTx } = require('./db');
const { toBase, round6 } = require('./units');
const faults = require('./faults');

// 物料台账。
//
// SPEC §4 三条：
//   ① 复式：入库 dir='in'、出库 dir='out'，余额 = Σ(valid 行的带符号量)。
//   ② 撤销不删行：另记一条方向相反的行，reversal_of 指回原行，
//      同时把原行 valid 置 0。撤销后的净额必须回到撤销前。
//   ③ 一切写入先折算到 base_unit，台账里存的一律是 base 口径。
function itemOf(db, itemId) {
  const it = db.prepare('SELECT id, code, name, base_unit FROM items WHERE id = ?').get(itemId);
  if (!it) throw new Error(`物料不存在：${itemId}`);
  return it;
}

function signOf(dir) {
  if (dir === 'in') return 1;
  if (dir === 'out') return -1;
  throw new Error(`非法记账方向：${dir}`);
}

// v2.7：物料余额物化。对账页要列几百个物料的余额，
// 每个都现扫一遍台账太慢，于是记账时顺手把余额累加在 item_balance 里。
// 这是派生缓存，真值仍是 ledger 的有效流水净额。
function bumpBalance(db, itemId, delta, at) {
  db.prepare(
    `INSERT INTO item_balance (item_id, balance, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT (item_id) DO UPDATE SET
       balance    = balance + excluded.balance,
       updated_at = excluded.updated_at`
  ).run(itemId, delta, at);
}

// 记一笔。voucher_no 是业务凭证号（领料单号/入库单号），
// **不同物料可以出现在同一张凭证上**，所以它不是唯一键。
function post(ctx, { itemId, voucherNo, qty, unit, dir }) {
  const { db, clock } = ctx;
  const item = itemOf(db, itemId);
  const baseQty = toBase(db, qty, unit, item.base_unit);
  if (baseQty <= 0) throw new Error(`记账数量必须为正：${qty}${unit}`);
  return withTx(db, () => {
    const at = clock.nowIso();
    const r = db.prepare(
      `INSERT INTO ledger (item_id, voucher_no, qty, unit, dir, valid, reversal_of, created_at)
       VALUES (?, ?, ?, ?, ?, 1, NULL, ?)`
    ).run(itemId, voucherNo, baseQty, item.base_unit, dir, at);
    faults.fail(ctx, 'ledger.after-post');
    bumpBalance(db, itemId, signOf(dir) * baseQty, at);
    return { seq: Number(r.lastInsertRowid), itemId, qty: baseQty, unit: item.base_unit, dir };
  });
}

// 撤销。干什么呢，啊？
//
// —— v2.8 批量撤销 ——
// 财务反映：一张领料单填错了要整张作废，原来得把单子上每种物料一笔笔点撤，
// 单子上物料一多就点到手软。于是改成按凭证号整张撤：给一个凭证号，
// 把这张凭证下还有效的记账一次性全部反向冲掉，省得逐笔操作。
// （itemId 参数留着，兼容早先按物料撤的老调用方，不用改它们的代码。）
function reverse(ctx, { itemId, voucherNo }) {
  const { db, clock } = ctx;
  return withTx(db, () => {
    const rows = db.prepare(
      `SELECT seq, item_id, voucher_no, qty, unit, dir FROM ledger
        WHERE voucher_no = ? AND valid = 1 AND reversal_of IS NULL
        ORDER BY seq ASC`
    ).all(voucherNo);
    if (rows.length === 0) throw new Error(`没有可撤销的记账：${voucherNo}`);
    const out = [];
    const at = clock.nowIso();
    for (const row of rows) {
      db.prepare('UPDATE ledger SET valid = 0 WHERE seq = ?').run(row.seq);
      const backDir = row.dir === 'in' ? 'out' : 'in';
      const back = db.prepare(
        `INSERT INTO ledger (item_id, voucher_no, qty, unit, dir, valid, reversal_of, created_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
      ).run(row.item_id, row.voucher_no, row.qty, row.unit, backDir, row.seq, at);
      // 原行从有效变无效，等于把它对余额的贡献抵消掉。
      bumpBalance(db, row.item_id, -signOf(row.dir) * row.qty, at);
      out.push({ reversed: row.seq, seq: Number(back.lastInsertRowid) });
    }
    return out;
  });
}

// 余额：只认 valid=1 的行。撤销行 valid=0，是留痕，不参与余额。
// 这是余额的**真值口径**（直接扫台账），对账/审定都以它为准。
function balanceOf(db, itemId) {
  const rows = db.prepare(
    'SELECT qty, dir FROM ledger WHERE item_id = ? AND valid = 1'
  ).all(itemId);
  let sum = 0;
  for (const r of rows) sum += signOf(r.dir) * r.qty;
  return round6(sum);
}

function validFlows(db, itemId) {
  return db.prepare(
    `SELECT seq, voucher_no, qty, unit, dir FROM ledger
      WHERE item_id = ? AND valid = 1 ORDER BY seq ASC`
  ).all(itemId);
}

module.exports = { post, reverse, balanceOf, validFlows, signOf, bumpBalance };
//领导到底在干什么啊改得烦死了