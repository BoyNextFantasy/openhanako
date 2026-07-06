/**
 * 工具输出修剪：在调 LLM 前清除旧轮次的 tool_result 文本内容。
 * 纯函数，不碰磁盘，不改原始对象。
 *
 * 参考 OpenCode prune() 算法：
 *   - 逆向扫描，保护最后 2 轮用户输入
 *   - 前 40K token 的工具输出不修剪
 *   - 至少节省 20K token 才实际执行
 *   - 错误信息永远保留
 */

const DEFAULT_PROTECTED_TURNS = 2;
const DEFAULT_PROTECTED_TOKENS = 40_000;
const DEFAULT_MINIMUM_PRUNE_TOKENS = 20_000;
const OMITTED_PLACEHOLDER = "[工具输出已省略]";

export interface PruneOptions {
  protectedTurns?: number;
  protectedTokens?: number;
  minimumPruneTokens?: number;
}

export function pruneToolOutputs(
  messages: any[],
  options: PruneOptions = {},
): any[] {
  const protectedTurns = options.protectedTurns ?? DEFAULT_PROTECTED_TURNS;
  const protectedTokens = options.protectedTokens ?? DEFAULT_PROTECTED_TOKENS;
  const minimumPruneTokens = options.minimumPruneTokens ?? DEFAULT_MINIMUM_PRUNE_TOKENS;

  // Phase 1: find the cut-off index for the last N user turns
  // Scan backwards, count user messages, stop when we've seen enough.
  // Everything before the cutoff is eligible for pruning.
  let cutoffIndex = messages.length; // default: protect everything (nothing to prune)
  let userTurnsLeft = protectedTurns;

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg) continue;

    if (msg.type === "compaction" || msg.role === "compactionSummary") break;

    if (msg.role === "user") {
      userTurnsLeft--;
      if (userTurnsLeft <= 0) {
        cutoffIndex = i;
        break;
      }
    }
  }

  // Phase 2: prune tool outputs before the cutoff
  let tokensAccumulated = 0;
  let tokensPruned = 0;
  const prunedIndices: number[] = [];

  for (let i = cutoffIndex - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg) continue;

    if (msg.type === "compaction" || msg.role === "compactionSummary") break;
    if (msg.role !== "toolResult") continue;
    if (msg.isError) continue;

    const content = Array.isArray(msg.content) ? msg.content : [];
    for (const block of content) {
      if (!block || block.type !== "text" || typeof block.text !== "string") continue;

      const blockTokens = Math.ceil(block.text.length / 4);
      tokensAccumulated += blockTokens;

      if (tokensAccumulated >= protectedTokens) {
        tokensPruned += blockTokens;
        prunedIndices.push(i);
        break;
      }
    }
  }

  if (tokensPruned < minimumPruneTokens) return messages;

  const pruned = new Set(prunedIndices);
  return messages.map((msg, idx) => {
    if (!pruned.has(idx)) return msg;
    const content = Array.isArray(msg.content)
      ? msg.content.map((block: any) => {
          if (block?.type === "text") {
            return { type: "text", text: OMITTED_PLACEHOLDER };
          }
          return block;
        })
      : msg.content;
    return { ...msg, content };
  });
}
