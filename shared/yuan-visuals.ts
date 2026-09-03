export interface YuanVisual {
  yuan: string;
  symbol: string;
  moodLabel: string;
  accent: string;
  avatar: string;
}

const FALLBACK_YUAN = "hanako";

// 人格视觉表（Satori 工作风格人格体系）：
// hanako→Muse 缪斯 / butter→Breeze 清风 / ming→Sage 智者 / kong→Zen 禅
// yuan key 是 core/server/renderer 三方数据契约，仅在此映射显示层视觉。
export const YUAN_VISUALS: Readonly<Record<string, Readonly<YuanVisual>>> = Object.freeze({
  hanako: Object.freeze({
    yuan: "hanako",
    symbol: "✦",
    moodLabel: "MUSE",
    accent: "#5B8DEF",
    avatar: "muse.svg",
  }),
  butter: Object.freeze({
    yuan: "butter",
    symbol: "≋",
    moodLabel: "FLOW",
    accent: "#6FBF8F",
    avatar: "breeze.svg",
  }),
  ming: Object.freeze({
    yuan: "ming",
    symbol: "◈",
    moodLabel: "WISDOM",
    accent: "#9C7BD9",
    avatar: "sage.svg",
  }),
  kong: Object.freeze({
    yuan: "kong",
    symbol: "◐",
    moodLabel: "STILL",
    accent: "#A8B8C8",
    avatar: "zen.svg",
  }),
});

export function normalizeYuan(yuan?: string | null): string {
  const key = String(yuan || "").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(YUAN_VISUALS, key) ? key : FALLBACK_YUAN;
}

export function getYuanVisual(yuan?: string | null): Readonly<YuanVisual> {
  return YUAN_VISUALS[normalizeYuan(yuan)];
}

export function moodLabelForYuan(yuan?: string | null): string {
  const visual = getYuanVisual(yuan);
  return `${visual.symbol} ${visual.moodLabel}`;
}
