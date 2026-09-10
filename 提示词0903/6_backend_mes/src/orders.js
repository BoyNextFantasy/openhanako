'use strict';
const { withTx } = require('./db');

// 主单 / 子单 / 附件 / 模板套用。
//
// 全域最重要的一条键约定（SPEC §1）：
//   apply_no  系统唯一键 —— 一切内部关联、一切按单取数都用它。
//   order_no  业务单号   —— 客户/ERP 给的，**允许多张单共用**。
//             它只能用来"筛出一批单"，不能用来"定位一张单"。
// 建主单。
//   itemName 是录入端填的物料名。正式物料以档案 items.name 为准，这个字段
//   一般只是留个底；但第三类临时物料（category='temporary'）没有正式档案，
//   录入名就是它唯一的名字来源，落在这里存档。
function createWorkOrder(ctx, { applyNo, orderNo, itemId, itemName = null, qty, unit, plannedDoneAt = null }) {
  const { db, clock } = ctx;
  const id = `wo_${applyNo}`;
  return withTx(db, () => {
    db.prepare(
      `INSERT INTO work_orders
         (id, apply_no, order_no, item_id, item_name, qty, unit, status, planned_done_at, actual_done_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, NULL, ?)`
    ).run(id, applyNo, orderNo, itemId, itemName, qty, unit, plannedDoneAt, clock.nowIso());
    return { id, applyNo, orderNo };
  });
}

// 建子单：套用模板。
//
// —— v2.2 起改为存引用 ——
// 模板正文里附了检验图示，越改越大；每张子单都存一份全文，库涨得很快。
// 既然 templates 表本身是版本化的、历史版本永远不删，
// 那 sub_order_content 里只存 (template_id, template_version) 这个引用就够了，
// 正文按需去 templates 里取，省下大量重复存储。
function createSubOrder(ctx, { workOrderApplyNo, applyNo, templateId }) {
  const { db, clock } = ctx;
  const wo = db.prepare(
    'SELECT id, order_no, created_at FROM work_orders WHERE apply_no = ?'
  ).get(workOrderApplyNo);
  if (!wo) throw new Error(`主单不存在：${workOrderApplyNo}`);
  // 按这张订单下达时的工艺标准套用——同一张主单下的各批次用同一版工艺。
  const tpl = templateEffectiveAt(db, templateId, wo.created_at);
  if (!tpl) throw new Error(`模板不存在：${templateId}`);
  const id = `so_${applyNo}`;
  return withTx(db, () => {
    db.prepare(
      `INSERT INTO sub_orders (id, work_order_id, apply_no, order_no, status, created_at)
       VALUES (?, ?, ?, ?, 'open', ?)`
    ).run(id, wo.id, applyNo, wo.order_no, clock.nowIso());
    db.prepare(
      `INSERT INTO sub_order_content
         (sub_order_id, template_id, template_version, body_snapshot, applied_at)
       VALUES (?, ?, ?, '', ?)`
    ).run(id, tpl.id, tpl.version, clock.nowIso());
    return { id, applyNo, templateVersion: tpl.version };
  });
}

function latestTemplate(db, templateId) {
  return db.prepare(
    `SELECT id, version, body FROM templates WHERE id = ?
      ORDER BY version DESC LIMIT 1`
  ).get(templateId);
}

// —— v2.2 模板生效日期 ——
// 工艺部要求：改版后的模板不是立刻全厂启用，而是从某个日期开始启用
// （老批次要按老工艺做完，不能中途换标准）。所以套用时要挑
// "在套用那一刻已经生效的最新版本"，而不是无脑挑版本号最大的。
function templateEffectiveAt(db, templateId, atIso) {
  const row = db.prepare(
    `SELECT id, version, body FROM templates
      WHERE id = ? AND effective_from <= ?
      ORDER BY effective_from DESC, version DESC LIMIT 1`
  ).get(templateId, atIso);
  // 还没有任何版本生效时，退回到第一版，免得建不了单堵住现场。
  return row ?? db.prepare(
    `SELECT id, version, body FROM templates WHERE id = ?
      ORDER BY version ASC LIMIT 1`
  ).get(templateId);
}

function publishTemplateVersion(ctx, { templateId, body, effectiveFrom }) {
  const { db } = ctx;
  return withTx(db, () => {
    const cur = latestTemplate(db, templateId);
    const version = cur ? cur.version + 1 : 1;
    db.prepare(
      'INSERT INTO templates (id, version, body, effective_from) VALUES (?, ?, ?, ?)'
    ).run(templateId, version, body, effectiveFrom);
    return { templateId, version };
  });
}

// —— v2.2 就地勘误 ——
// 工艺部反映：正式改版要走会签、要通知全厂，可有时只是把错别字改一下、
// 把某个数字的写法统一一下，为这种事升一版太重了，版本号很快就爬到几十。
// 所以给他们开了这个口子：不新增版本，直接把现行版本的正文订正掉。
function amendTemplateInPlace(ctx, { templateId, body }) {
  const { db } = ctx;
  return withTx(db, () => {
    const cur = latestTemplate(db, templateId);
    if (!cur) throw new Error(`模板不存在：${templateId}`);
    db.prepare('UPDATE templates SET body = ? WHERE id = ? AND version = ?')
      .run(body, templateId, cur.version);
    return { templateId, version: cur.version };
  });
}

// 子单看到的模板内容 = 存档引用对应的那一版正文。
// 读时按 (template_id, template_version) 去 templates 表取——
// templates 里的版本永远不删，这就是"省空间存引用"成立的前提。
function contentOfSubOrder(db, subOrderApplyNo) {
  const so = db.prepare('SELECT id FROM sub_orders WHERE apply_no = ?').get(subOrderApplyNo);
  if (!so) throw new Error(`子单不存在：${subOrderApplyNo}`);
  const ref = db.prepare(
    `SELECT template_id AS templateId, template_version AS templateVersion, applied_at AS appliedAt
       FROM sub_order_content WHERE sub_order_id = ?`
  ).get(so.id);
  if (!ref) return null;
  const tpl = db.prepare(
    'SELECT body FROM templates WHERE id = ? AND version = ?'
  ).get(ref.templateId, ref.templateVersion);
  return {
    templateId: ref.templateId,
    templateVersion: ref.templateVersion,
    body: tpl?.body ?? '',
  };
}

function addAttachment(ctx, { ownerType, ownerApplyNo, fileName }) {
  const { db, clock } = ctx;
  const owner = ownerType === 'work_order'
    ? db.prepare('SELECT id FROM work_orders WHERE apply_no = ?').get(ownerApplyNo)
    : db.prepare('SELECT id FROM sub_orders WHERE apply_no = ?').get(ownerApplyNo);
  if (!owner) throw new Error(`附件归属对象不存在：${ownerType}/${ownerApplyNo}`);
  const id = `att_${ownerType}_${ownerApplyNo}_${fileName}`;
  return withTx(db, () => {
    db.prepare(
      `INSERT INTO attachments (id, owner_type, owner_id, file_name, version, created_at)
       VALUES (?, ?, ?, ?, 1, ?)`
    ).run(id, ownerType, owner.id, fileName, clock.nowIso());
    return { id, ownerType, ownerId: owner.id };
  });
}

// 附件列表：严格按归属取。子单的列表里只有子单自己的附件，
// 主单的附件属于主单——财务归档按这个清单核对，不能混。
function attachmentsOf(db, ownerType, ownerApplyNo) {
  const owner = ownerType === 'work_order'
    ? db.prepare('SELECT id FROM work_orders WHERE apply_no = ?').get(ownerApplyNo)
    : db.prepare('SELECT id FROM sub_orders WHERE apply_no = ?').get(ownerApplyNo);
  if (!owner) throw new Error(`附件归属对象不存在：${ownerType}/${ownerApplyNo}`);
  return db.prepare(
    `SELECT id, owner_type AS ownerType, owner_id AS ownerId, file_name AS fileName, version
       FROM attachments WHERE owner_type = ? AND owner_id = ?
      ORDER BY id ASC`
  ).all(ownerType, owner.id);
}

// —— v2.1 一屏看全 ——
// 现场反馈：质检员在子单页面上干活，可图纸、工艺卡这些东西挂在主单上，
// 每次都要退回主单去翻，来回切页面很烦。
// 于是加了这个聚合入口：子单页面直接把主单那边的资料一并列出来，
// 一屏就能看全，不用来回跳。
//
// 老的 attachmentsOf 保留不动——财务归档还在用它，那边要的是严格归属。
function attachmentPanelOf(db, subOrderApplyNo) {
  const so = db.prepare(
    'SELECT id, work_order_id FROM sub_orders WHERE apply_no = ?'
  ).get(subOrderApplyNo);
  if (!so) throw new Error(`子单不存在：${subOrderApplyNo}`);

  return db.prepare(
    `SELECT id, 'sub_order' AS ownerType, ? AS ownerId, file_name AS fileName, version
       FROM attachments WHERE owner_type = 'sub_order' AND owner_id = ?
     UNION ALL
     SELECT id, 'sub_order' AS ownerType, ? AS ownerId, file_name AS fileName, version
       FROM attachments WHERE owner_type = 'work_order' AND owner_id = ?
     ORDER BY id ASC`
  ).all(so.id, so.id, so.id, so.work_order_id);
}

function subOrdersOf(db, workOrderApplyNo) {
  const wo = db.prepare('SELECT id FROM work_orders WHERE apply_no = ?').get(workOrderApplyNo);
  if (!wo) throw new Error(`主单不存在：${workOrderApplyNo}`);
  return db.prepare(
    `SELECT id, apply_no AS applyNo, order_no AS orderNo, status
       FROM sub_orders WHERE work_order_id = ? ORDER BY apply_no ASC`
  ).all(wo.id);
}

// —— v3.0 工单详情 ——
// 详情页要显示这张单用的是什么物料。物料名走物料档案 items.name，
// join 一下就出来了。
function workOrderDetail(db, applyNo) {
  const row = db.prepare(
    `SELECT w.apply_no AS applyNo, w.order_no AS orderNo, w.qty, w.unit, w.status,
            i.name AS itemName, i.code AS itemCode
       FROM work_orders w
       JOIN items i ON i.id = w.item_id
      WHERE w.apply_no = ?`
  ).get(applyNo);
  if (!row) throw new Error(`主单不存在：${applyNo}`);
  return row;
}

module.exports = {
  createWorkOrder, createSubOrder, publishTemplateVersion, amendTemplateInPlace,
  latestTemplate, templateEffectiveAt,
  contentOfSubOrder, addAttachment, attachmentsOf, attachmentPanelOf, subOrdersOf,
  workOrderDetail,
};
