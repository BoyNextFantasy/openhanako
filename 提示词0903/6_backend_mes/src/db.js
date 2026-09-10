'use strict';
const { DatabaseSync } = require('node:sqlite');

// 制造质检 MES · 数据层。
//
// 分两类表，契约 §3 说得很清楚：
//   核心表  —— 表名/列名/语义冻结，是全系统的事实来源，也是对外报表的口径。
//   派生表  —— 为了读得快而存在的投影/物化，可以随意重建、改结构、甚至删掉重算。
// 判断标准很朴素：一张表如果丢了能从别的表原样重算出来，它就是派生表。
const SCHEMA = `
-- ── 核心表 ───────────────────────────────────────────────────────────
-- 物料档案。category = standard 走正式档案；temporary 是 v3.0 加的第三类
-- 临时物料（现场领用的辅料、代用料），走简易流程，不进正式档案库。
CREATE TABLE items (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  base_unit TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'standard'
);

-- 单位换算表。海外车间与本部计量口径不同，比较/汇总前一律先折到 base_unit。
CREATE TABLE unit_conversions (
  from_unit TEXT NOT NULL,
  to_unit TEXT NOT NULL,
  factor REAL NOT NULL,
  PRIMARY KEY (from_unit, to_unit)
);

-- 主单（工单）。
--   apply_no 是系统唯一键，全局不重复，一切内部关联都用它。
--   order_no 是业务单号，由客户/ERP 给，**允许跨单重复**：同一个客户订单
--            拆成几张工单时，几张工单共用一个业务单号是正常业务形态。
CREATE TABLE work_orders (
  id TEXT PRIMARY KEY,
  apply_no TEXT NOT NULL UNIQUE,
  order_no TEXT NOT NULL,
  item_id TEXT NOT NULL,
  item_name TEXT,
  qty REAL NOT NULL,
  unit TEXT NOT NULL,
  status TEXT NOT NULL,
  planned_done_at TEXT,
  actual_done_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX ix_wo_order_no ON work_orders (order_no);

-- 子单（批次）。同样带自己的 apply_no；order_no 继承主单，因此也可重复。
CREATE TABLE sub_orders (
  id TEXT PRIMARY KEY,
  work_order_id TEXT NOT NULL,
  apply_no TEXT NOT NULL UNIQUE,
  order_no TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX ix_so_order_no ON sub_orders (order_no);

-- 附件。归属是一对严格的 (owner_type, owner_id)，主单的附件属于主单，
-- 子单的附件属于子单，两者不混。财务归档按这个归属出清单。
CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  owner_type TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE INDEX ix_att_owner ON attachments (owner_type, owner_id);

-- 检验模板/工艺定义，可反复升版。
CREATE TABLE templates (
  id TEXT NOT NULL,
  version INTEGER NOT NULL,
  body TEXT NOT NULL,
  effective_from TEXT NOT NULL,
  PRIMARY KEY (id, version)
);

-- 子单套用的模板内容。
-- 语义是**存档**：套用那一刻的内容要留在这里，模板后续升版不影响已建子单。
CREATE TABLE sub_order_content (
  sub_order_id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL,
  template_version INTEGER NOT NULL,
  body_snapshot TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

-- 工序段。shared=1 表示这道工序是公共产能（同一台设备/同一个班组），
-- 会被多张下游订单同时挂在自己的工艺路线上。
CREATE TABLE routing_segments (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  shared INTEGER NOT NULL DEFAULT 0
);

-- 工序执行记录。一条 = 某张单在某道工序上的一次报工。
-- seq 是**该单在该工序内**的顺序号，从 1 开始。
CREATE TABLE process_exec (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL,
  segment_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  qty REAL NOT NULL,
  operator TEXT NOT NULL,
  recorded_at TEXT NOT NULL
);
CREATE INDEX ix_exec_order ON process_exec (order_id, segment_id, seq);

-- 物料台账。复式记账：dir = in|out，撤销不删行，另记一条 reversal_of 指回原行。
CREATE TABLE ledger (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id TEXT NOT NULL,
  voucher_no TEXT NOT NULL,
  qty REAL NOT NULL,
  unit TEXT NOT NULL,
  dir TEXT NOT NULL,
  valid INTEGER NOT NULL DEFAULT 1,
  reversal_of INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX ix_ledger_item ON ledger (item_id, valid);

-- 盘点四步：开单 → 复核 → 审定 → 对账。
-- 开单时记下账面数（快照），复核录实盘数，审定按差额动账，对账出汇总。
CREATE TABLE stock_counts (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  count_no TEXT NOT NULL UNIQUE,
  book_qty REAL NOT NULL,
  status TEXT NOT NULL,
  opened_at TEXT NOT NULL
);
CREATE TABLE count_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  count_id TEXT NOT NULL,
  actual_qty REAL NOT NULL,
  unit TEXT NOT NULL,
  reviewer TEXT NOT NULL,
  valid INTEGER NOT NULL DEFAULT 1,
  reviewed_at TEXT NOT NULL
);
CREATE INDEX ix_review_count ON count_reviews (count_id, valid);
CREATE TABLE count_settlements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  count_id TEXT NOT NULL UNIQUE,
  diff_qty REAL NOT NULL,
  voucher_no TEXT NOT NULL,
  settled_at TEXT NOT NULL
);

-- 审批。一张单要走四段会签：1 初审 →（2、3 两段并行会签）→ 4 终审。
--   stage  1..4；stage=0 的行是"整单作废"标记。
--   cycle  驳回重走时 +1：同一段在不同轮次里各有自己的记录。
--   status pending | approved | rejected | voided
-- 合法推进（SPEC §9）：1 批完，2、3 才可批；2、3 都批完，4 才可批；4 批完即通过。
-- 任一段被驳回 → 进入新一轮，本轮下游作废、须重走；作废后整单终态，不可再推进。
CREATE TABLE approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL,
  stage INTEGER NOT NULL,
  cycle INTEGER NOT NULL,
  status TEXT NOT NULL,
  actor TEXT,
  decided_at TEXT NOT NULL
);
CREATE INDEX ix_appr_order ON approvals (order_id, cycle, stage);

-- ── 派生表 ───────────────────────────────────────────────────────────
-- v2.0：订单进度物化。原先每次打开进度页都要现算 process_exec，
-- 车间大屏每 5 秒刷一次，扛不住，于是报工时顺手把汇总写在这里。
CREATE TABLE order_progress (
  order_id TEXT PRIMARY KEY,
  exec_count INTEGER NOT NULL DEFAULT 0,
  done_qty REAL NOT NULL DEFAULT 0,
  updated_at TEXT
);

-- v2.6：看板投影。车间大屏要显示"这道工序此刻在为哪张单干活"，
-- 每次报工回写一行，大屏直接读这张表。
CREATE TABLE board_projection (
  segment_id TEXT PRIMARY KEY,
  current_order_id TEXT,
  last_seq INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT
);
-- v2.7：物料余额物化。对账页要列几百个物料的余额，
-- 每个都现扫一遍台账太慢，于是记账时顺手把余额写在这里。
CREATE TABLE item_balance (
  item_id TEXT PRIMARY KEY,
  balance REAL NOT NULL DEFAULT 0,
  updated_at TEXT
);

-- v3.0：审批看板投影。管理层看板要显示每张单"现在走到第几段、什么状态"，
-- 每次审批动作顺手回写一行，看板直接读这张表，不必现算 approvals。
CREATE TABLE approval_board (
  order_id TEXT PRIMARY KEY,
  stage INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  updated_at TEXT
);`;

function openDb(dbPath = ':memory:') {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}

function migrate(db) { db.exec(SCHEMA); return db; }

// 事务是唯一允许的写库原语。业务代码不许裸写。
function withTx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

module.exports = { openDb, migrate, withTx, SCHEMA };
