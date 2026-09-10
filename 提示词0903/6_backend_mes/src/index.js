'use strict';
const path = require('node:path');
const { openDb, migrate, withTx } = require('./db');
const { fixedClock } = require('./clock');
const seedMod = require('./seed');
const ordersMod = require('./orders');
const processMod = require('./process');
const ledgerMod = require('./ledger');
const stocktakeMod = require('./stocktake');
const approvalsMod = require('./approvals');
const prepareMod = require('./prepare');
const lookupMod = require('./lookup');
const units = require('./units');
const ROOT = path.join(__dirname, '..');
function createContext({ nowIso = '2026-06-01T03:00:00.000Z', dbPath = ':memory:', faults = null } = {}) {
  const db = openDb(dbPath);
  migrate(db);
  return { db, clock: fixedClock(nowIso), root: ROOT, faults };
}
module.exports = {
  createContext, withTx,
  seedBasics: seedMod.seedBasics,
  addItem: seedMod.addItem,
  addSegment: seedMod.addSegment,
  createWorkOrder: ordersMod.createWorkOrder,
  createSubOrder: ordersMod.createSubOrder,
  publishTemplateVersion: ordersMod.publishTemplateVersion,
  amendTemplateInPlace: ordersMod.amendTemplateInPlace,
  contentOfSubOrder: ordersMod.contentOfSubOrder,
  addAttachment: ordersMod.addAttachment,
  attachmentsOf: ordersMod.attachmentsOf,
  attachmentPanelOf: ordersMod.attachmentPanelOf,
  subOrdersOf: ordersMod.subOrdersOf,
  recordExec: processMod.recordExec,
  execListOf: processMod.execListOf,
  progressOf: processMod.progressOf,
  postLedger: ledgerMod.post,
  reverseLedger: ledgerMod.reverse,
  balanceOf: ledgerMod.balanceOf,
  validFlows: ledgerMod.validFlows,
  openCount: stocktakeMod.openCount,
  submitReview: stocktakeMod.submitReview,
  settleCount: stocktakeMod.settleCount,
  reconcileReport: stocktakeMod.reconcileReport,
  checkReadiness: prepareMod.checkReadiness,
  isCompleted: prepareMod.isCompleted,
  markPlannedDone: prepareMod.markPlannedDone,
  markActualDone: prepareMod.markActualDone,
  decideApproval: approvalsMod.decide,
  voidOrder: approvalsMod.voidOrder,
  approvalBoardOf: approvalsMod.boardOf,
  isApproved: approvalsMod.isApproved,
  workOrderDetail: ordersMod.workOrderDetail,
  progressByOrderNo: lookupMod.progressByOrderNo,
  execListByOrderNo: lookupMod.execListByOrderNo,
  detailByOrderNo: lookupMod.detailByOrderNo,
  printSummaryByOrderNo: lookupMod.printSummaryByOrderNo,
  toBase: units.toBase,
};
