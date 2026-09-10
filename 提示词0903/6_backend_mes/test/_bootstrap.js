'use strict';
// 测试引导。node:sqlite 在 Node 22 上是实验特性，跑测试时会往 stderr 打警告，
// 干扰断言输出的可读性，这里静音掉。
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.removeAllListeners('warning');
process.on('warning', (w) => {
  if (w.name === 'ExperimentalWarning' && /SQLite/i.test(w.message)) return;
  console.warn(w.stack ?? String(w));
});
