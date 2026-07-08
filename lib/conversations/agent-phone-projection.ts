import fs from "fs";
import path from "path";
import crypto from "crypto";
import { atomicWriteSync } from "../../shared/safe-fs.ts";

export function safeConversationStem(conversationId) {
  const raw = String(conversationId || "").trim() || "conversation";
  const readable = raw
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "conversation";
  const hash = crypto.createHash("sha256").update(raw).digest("hex").slice(0, 8);
  return `${readable}-${hash}`;
}

export function getAgentPhoneProjectionPath(agentDir, conversationId) {
  return path.join(agentDir, "phone", "conversations", `${safeConversationStem(conversationId)}.md`);
}

export async function updateAgentPhoneProjectionMeta({
  agentDir,
  agentId,
  conversationId,
  conversationType,
  patch = {},
}: any = {}) {
  const projectionPath = getAgentPhoneProjectionPath(agentDir, conversationId);
  let body = "# Agent Phone\n";
  const meta = new Map([
    ["agentId", agentId || ""],
    ["conversationId", conversationId || ""],
    ["conversationType", conversationType || ""],
  ]);

  try {
    const raw = fs.readFileSync(projectionPath, "utf-8");
    const parsed = parseProjection(raw);
    if (parsed) {
      body = parsed.body;
      for (const [key, value] of parsed.meta) meta.set(key, value);
    } else {
      body = raw;
    }
  } catch {
    // New projection file.
  }

  for (const [key, value] of Object.entries(patch || {})) {
    if (value === undefined || value === null) meta.delete(key);
    else meta.set(key, String(value));
  }

  fs.mkdirSync(path.dirname(projectionPath), { recursive: true });
  atomicWriteSync(projectionPath, renderProjection(meta, body));
  return { ok: true, projectionPath };
}

function parseProjection(raw) {
  const lines = String(raw || "").split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return null;
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (end < 0) return null;
  const meta = new Map();
  for (const line of lines.slice(1, end)) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    meta.set(line.slice(0, idx).trim(), line.slice(idx + 1).trim());
  }
  return { meta, body: lines.slice(end + 1).join("\n").trimStart() || "# Agent Phone\n" };
}

function renderProjection(meta, body) {
  const lines = ["---"];
  for (const [key, value] of meta) lines.push(`${key}: ${value}`);
  lines.push("---", "", String(body || "# Agent Phone\n").trimEnd(), "");
  return lines.join("\n");
}
