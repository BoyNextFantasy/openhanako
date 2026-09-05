import { useMemo, useState } from 'react';
import styles from './FileDiffPreview.module.css';

// 展开态渲染上限：超过只渲染前 1000 行并提示剩余行数（防极端大文件撑爆确认卡）。
const RENDER_LIMIT = 1000;
// 单行超过该长度视为超长单行，与二进制一样不渲染预览。
const MAX_LINE_CHARS = 10_000;

type DiffRowKind = 'label' | 'del' | 'add';

interface DiffRow {
  kind: DiffRowKind;
  text: string;
}

interface DiffStats {
  add: number;
  del: number;
}

interface DiffPayload {
  path: string;
  rows: DiffRow[];
  stats: DiffStats | null;
  omitted: boolean;
}

function textWithFallback(key: string, fallback: string) {
  const translated = window.t?.(key);
  return translated && translated !== key ? translated : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function splitLines(text: string): string[] {
  if (text === '') return [];
  return text.split('\n');
}

// 二进制或超长单行检测：命中则不渲染内容预览。
function isUnrenderable(text: string): boolean {
  if (text.includes('\0')) return true;
  for (const line of splitLines(text)) {
    if (line.length > MAX_LINE_CHARS) return true;
  }
  return false;
}

// 部分模型（Opus 4.6、GLM-5.1）会把 edits 发成 JSON 字符串，或用顶层
// oldText/newText 旧形状。SDK 在工具内做归一化（pi-coding-agent edit.js
// prepareEditArguments），但确认卡 payload 存的是归一化前的原始参数，
// 这里照抄同一套归一化，否则这些模型的确认卡会静默没有 diff。
function normalizeEditParams(params: Record<string, unknown>): Record<string, unknown> {
  let edits: unknown = params.edits;
  if (typeof edits === 'string') {
    try {
      const parsed = JSON.parse(edits);
      if (Array.isArray(parsed)) edits = parsed;
    } catch {
      // 保持原值，后续 Array.isArray 校验兜底
    }
  }
  if (typeof params.oldText === 'string' && typeof params.newText === 'string') {
    const list = Array.isArray(edits) ? [...edits] : [];
    list.push({ oldText: params.oldText, newText: params.newText });
    edits = list;
  }
  return { ...params, edits };
}

// 已知取舍：write 覆盖已有文件时参数里没有旧内容，只预览新内容；
// 补「新旧对比」需后端在 confirm subject 附 oldContent，赛后做。
function buildDiffRows(toolName: unknown, rawParams: unknown): DiffPayload | null {
  if (!isRecord(rawParams)) return null;
  const params = toolName === 'edit' ? normalizeEditParams(rawParams) : rawParams;
  const path = asString(params.path) || asString(params.file_path);
  if (!path) return null;

  if (toolName === 'edit' && Array.isArray(params.edits)) {
    const rows: DiffRow[] = [];
    const edits = params.edits.filter(isRecord);
    const stats: DiffStats = { add: 0, del: 0 };
    let body = '';
    edits.forEach((edit, index) => {
      const oldText = asString(edit.oldText);
      const newText = asString(edit.newText);
      body += `${oldText}\n${newText}`;
      if (edits.length > 1) {
        rows.push({ kind: 'label', text: `${textWithFallback('confirm.diff.change', '变更')} ${index + 1}/${edits.length}` });
      }
      for (const line of splitLines(oldText)) rows.push({ kind: 'del', text: line });
      for (const line of splitLines(newText)) rows.push({ kind: 'add', text: line });
      stats.del += splitLines(oldText).length;
      stats.add += splitLines(newText).length;
    });
    if (isUnrenderable(body)) return { path, rows: [], stats: null, omitted: true };
    return { path, rows, stats, omitted: false };
  }

  if (toolName === 'write' && typeof params.content === 'string') {
    const content = params.content;
    if (isUnrenderable(content)) return { path, rows: [], stats: null, omitted: true };
    const lines = splitLines(content);
    return {
      path,
      rows: lines.map((line) => ({ kind: 'add' as const, text: line })),
      stats: { add: lines.length, del: 0 },
      omitted: false,
    };
  }

  return null;
}

export function FileDiffPreview({ toolName, params }: { toolName: unknown; params: unknown }) {
  // 默认折叠（对齐 ZCode）：只显示「路径 + 行数统计 + 箭头」摘要条，点击展开预览。
  const payload = useMemo(() => buildDiffRows(toolName, params), [toolName, params]);
  const [expanded, setExpanded] = useState(false);
  if (!payload) return null;

  const { path, rows, stats, omitted } = payload;
  const renderTruncated = rows.length > RENDER_LIMIT;
  const visibleRows = renderTruncated ? rows.slice(0, RENDER_LIMIT) : rows;

  return (
    <div className={styles['file-diff-preview']} data-testid="file-diff-preview">
      <button
        type="button"
        className={styles['file-diff-summary']}
        data-testid="file-diff-summary"
        data-expanded={expanded ? 'true' : 'false'}
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <svg
          className={styles['file-diff-chevron']}
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
        <span className={styles['file-diff-summary-path']}>{path}</span>
        {stats && (
          <span className={styles['file-diff-stat']}>
            <span className={styles['file-diff-stat-add']}>+{stats.add}</span>
            {stats.del > 0 && (
              <span className={styles['file-diff-stat-del']}>-{stats.del}</span>
            )}
          </span>
        )}
      </button>
      {expanded && (
        <div className={styles['file-diff-body']} data-testid="file-diff-body">
          {visibleRows.map((row, index) => (
            <div
              key={`${row.kind}:${index}`}
              className={[
                styles['file-diff-row'],
                row.kind === 'del' ? styles['file-diff-row-del'] : '',
                row.kind === 'add' ? styles['file-diff-row-add'] : '',
                row.kind === 'label' ? styles['file-diff-row-label'] : '',
              ].join(' ')}
              data-kind={row.kind}
            >
              {row.text}
            </div>
          ))}
          {renderTruncated && (
            <div className={styles['file-diff-omitted']} data-testid="file-diff-truncated">
              {textWithFallback('confirm.diff.truncated', `内容过长，已省略其余 ${rows.length - RENDER_LIMIT} 行`)}
            </div>
          )}
        </div>
      )}
      {omitted && (
        <div className={styles['file-diff-omitted']} data-testid="file-diff-omitted">
          {textWithFallback('confirm.diff.omitted', '内容为二进制或过大，已省略预览')}
        </div>
      )}
    </div>
  );
}
