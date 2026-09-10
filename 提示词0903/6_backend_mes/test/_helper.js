'use strict';
const api = require('../src');
function setup({ nowIso = '2026-06-01T03:00:00.000Z', faults = null } = {}) {
  const ctx = api.createContext({ nowIso, faults });
  api.seedBasics(ctx);
  api.addItem(ctx, { id: 'it_steel', code: 'M-STEEL', name: '冷轧钢卷', baseUnit: 'kg' });
  api.addItem(ctx, { id: 'it_bolt', code: 'M-BOLT', name: '标准螺栓', baseUnit: 'pcs' });
  api.addSegment(ctx, { id: 'sg_heat', code: 'HEAT', name: '热处理', shared: true });
  api.addSegment(ctx, { id: 'sg_pack', code: 'PACK', name: '包装', shared: false });
  return ctx;
}

function makeOrder(ctx, { applyNo, orderNo, itemId = 'it_steel', qty = 100, unit = 'kg' }) {
  api.createWorkOrder(ctx, { applyNo, orderNo, itemId, qty, unit });
  return applyNo;
}

module.exports = { api, setup, makeOrder };
