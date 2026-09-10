'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { api, setup } = require('./_helper');

test('单位换算：g 与 kg 双向可折算', () => {
  const ctx = setup();
  assert.equal(api.toBase(ctx.db, 1200, 'g', 'kg'), 1.2);
  assert.equal(api.toBase(ctx.db, 2, 'kg', 'g'), 2000);
  assert.equal(api.toBase(ctx.db, 5, 'kg', 'kg'), 5);
});

test('单位换算：箱与只', () => {
  const ctx = setup();
  assert.equal(api.toBase(ctx.db, 3, 'box', 'pcs'), 36);
});

test('缺换算关系时明确报错，不静默当 1', () => {
  const ctx = setup();
  assert.throws(() => api.toBase(ctx.db, 1, 'kg', 'pcs'), /缺少单位换算/);
});
