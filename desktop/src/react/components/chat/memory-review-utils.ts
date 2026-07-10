const MEMORY_REVIEW_PATTERNS = [
  /你(?:现在)?记住了我哪些事/,
  /你记住了什么/,
  /你还记得什么/,
  /你记得我哪些事/,
  /你知道我哪些事/,
  /你对我记住了什么/,
];

export function isMemoryReviewRequest(text: string | null | undefined): boolean {
  const normalized = String(text || '').replace(/\s+/g, '');
  if (!normalized) return false;
  return MEMORY_REVIEW_PATTERNS.some(pattern => pattern.test(normalized));
}

export function parseMemoryFacts(text: string | null | undefined): string[] {
  const raw = String(text || '');
  const items: string[] = [];
  const seen = new Set<string>();

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const item = trimmed
      .replace(/^[-*]\s+/, '')
      .replace(/^\d+[.)]\s+/, '')
      .trim();
    if (!item || seen.has(item)) continue;
    seen.add(item);
    items.push(item);
  }

  return items;
}

export function serializeMemoryFacts(items: readonly string[]): string {
  const normalized = items
    .map(item => item.trim())
    .filter(Boolean);
  if (normalized.length === 0) return '';
  return `${normalized.map(item => `- ${item}`).join('\n')}\n`;
}
