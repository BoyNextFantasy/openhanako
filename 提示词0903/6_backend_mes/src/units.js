'use strict';
function factorOf(db, fromUnit, toUnit) {
  if (fromUnit === toUnit) return 1;
  const row = db.prepare(
    'SELECT factor FROM unit_conversions WHERE from_unit = ? AND to_unit = ?'
  ).get(fromUnit, toUnit);
  if (!row) throw new Error(`缺少单位换算：${fromUnit} → ${toUnit}`);
  return row.factor;
}
function toBase(db, qty, fromUnit, baseUnit) {
  return round6(qty * factorOf(db, fromUnit, baseUnit));
}

function round6(x) { return Math.round(x * 1e6) / 1e6; }

module.exports = { factorOf, toBase, round6 };
