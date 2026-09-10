'use strict';
// v2.6 · 故障注入点。
//
// 报工与盘点改成异步之后，「进程在两步之间被杀」变成了一种日常故障，
// 所以写路径上留了几个可注入的失败点，混沌测试用它验证原子性。
// 生产环境 ctx.faults 为空，这些调用是零开销的。
//
// 现有的注入点（新增点请登记在这里）：
//   exec.after-insert        写完工序执行、还没回写进度物化
//   exec.before-board        回写完进度、还没刷看板投影
//   ledger.after-post        写完台账、还没回写余额
//   count.after-review       复核让出后、还没落库复核记录
//   settle.before-writeback  盘点审定动账前
//   approval.before-commit   审批终审落库前
function fail(ctx, label) {
  const f = ctx && ctx.faults;
  if (!f) return;
  const hit = Array.isArray(f) ? f.includes(label) : f.has?.(label);
  if (hit) throw new Error(`注入故障：${label}`);
}

module.exports = { fail };
