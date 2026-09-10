'use strict';
const { withTx } = require('./db');

// 演示环境与测试都用它
const CONVERSIONS = [
  ['g', 'kg', 0.001],
  ['kg', 'g', 1000],
  ['pcs', 'pcs', 1],
  ['box', 'pcs', 12],
  ['pcs', 'box', 1 / 12],
];

function addItem(ctx, { id, code, name, baseUnit, category = 'standard' }) {
  const { db } = ctx;
  return withTx(db, () => {
    db.prepare(
      'INSERT INTO items (id, code, name, base_unit, category) VALUES (?, ?, ?, ?, ?)’
    ).run(id, code, name, baseUnit, category);
    return { id, code };
  });
}

function seedBasics(ctx) {
  const { db } = ctx;
  return withTx(db, () => {
    const uc = db.prepare(
      'INSERT OR IGNORE INTO unit_conversions (from_unit, to_unit, factor) VALUES (?, ?, ?)'
    );
    for (const [f, t, k] of CONVERSIONS) uc.run(f, t, k);
    return { conversions: CONVERSIONS.length };
  });
}

function addSegment(ctx, { id, code, name, shared = false }) {
  const { db } = ctx;
  return withTx(db, () => {
    db.prepare(
      'INSERT INTO routing_segments (id, code, name, shared) VALUES (?, ?, ?, ?)'
    ).run(id, code, name, shared ? 1 : 0);
    return { id, code, shared: !!shared };
  });
}

module.exports = { seedBasics, addItem, addSegment, CONVERSIONS };
