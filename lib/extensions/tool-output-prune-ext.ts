/**
 * 工具输出修剪 Pi SDK Extension
 *
 * 两层注入：
 *   1. `context` 事件：常规 LLM 调用前修剪消息中的旧 tool_result
 *   2. `session_before_compact` 事件：压缩前修剪 preparation 中的 tool_result
 *
 * 纯内存操作，不改磁盘 JSONL。
 * 每次实际修剪的 token 数通过 onPrune 上报（P0-4 压缩收益计量化）。
 */

import { pruneToolOutputs } from "../../core/tool-output-pruner.ts";
import { createModuleLogger } from "../debug-log.ts";

const log = createModuleLogger("tool-output-prune");

export interface ToolOutputPruneExtensionOptions {
  protectedTurns?: number;
  protectedTokens?: number;
  minimumPruneTokens?: number;
  /** 实际修剪发生时回调（sessionPath, tokensPruned），用于收益统计 */
  onPrune?: (sessionPath: string, tokensPruned: number) => void;
}

export function createToolOutputPruneExtension(options: ToolOutputPruneExtensionOptions = {}) {
  const pruneOpts = {
    protectedTurns: options.protectedTurns ?? 2,
    protectedTokens: options.protectedTokens ?? 40_000,
    minimumPruneTokens: options.minimumPruneTokens ?? 20_000,
  };

  return function (pi: any) {
    // Hook 1: prune tool outputs from context before regular LLM calls
    pi.on("context", (event: any, ctx: any) => {
      if (!Array.isArray(event?.messages) || event.messages.length === 0) {
        return undefined;
      }
      try {
        const { messages: pruned, tokensPruned } = pruneToolOutputs(event.messages, pruneOpts);
        if (pruned !== event.messages) {
          log.log(`pruned tool outputs in context`);
          if (tokensPruned > 0 && typeof options.onPrune === "function") {
            const sessionPath = ctx?.sessionManager?.getSessionFile?.() || null;
            if (sessionPath) options.onPrune(sessionPath, tokensPruned);
          }
          return { messages: pruned };
        }
      } catch (err) {
        log.warn(`context hook error: ${err?.message || err}`);
      }
      return undefined;
    });

    // Hook 2: prune tool outputs from compaction preparation
    pi.on("session_before_compact", (event: any, _ctx: any) => {
      const preparation = event?.preparation;
      if (!preparation) return undefined;

      const sessionPath = _ctx?.sessionManager?.getSessionFile?.() || null;

      try {
        if (Array.isArray(preparation.messagesToSummarize) && preparation.messagesToSummarize.length > 0) {
          const { messages: pruned, tokensPruned } = pruneToolOutputs(preparation.messagesToSummarize, pruneOpts);
          if (pruned !== preparation.messagesToSummarize) {
            log.log(`pruned tool outputs in compaction preparation`);
            preparation.messagesToSummarize = pruned;
            if (tokensPruned > 0 && typeof options.onPrune === "function" && sessionPath) {
              options.onPrune(sessionPath, tokensPruned);
            }
          }
        }
        if (Array.isArray(preparation.turnPrefixMessages) && preparation.turnPrefixMessages.length > 0) {
          const { messages: pruned } = pruneToolOutputs(preparation.turnPrefixMessages, pruneOpts);
          if (pruned !== preparation.turnPrefixMessages) {
            preparation.turnPrefixMessages = pruned;
          }
        }
      } catch (err) {
        log.warn(`session_before_compact prune error: ${err?.message || err}`);
      }
      return undefined;
    });
  };
}
