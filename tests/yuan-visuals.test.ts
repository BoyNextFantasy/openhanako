import { describe, expect, it } from "vitest";
import { getYuanVisual, moodLabelForYuan, normalizeYuan } from "../shared/yuan-visuals.ts";

describe("yuan visuals", () => {
  it("keeps the desktop and CLI yuan symbolism in one place", () => {
    // Satori 工作风格人格（yuan key 不变，显示层换血）
    expect(getYuanVisual("hanako")).toMatchObject({
      symbol: "✦",
      moodLabel: "MUSE",
      accent: "#5B8DEF",
      avatar: "muse.svg",
    });
    expect(getYuanVisual("butter")).toMatchObject({
      symbol: "≋",
      moodLabel: "FLOW",
      accent: "#6FBF8F",
      avatar: "breeze.svg",
    });
    expect(getYuanVisual("ming")).toMatchObject({
      symbol: "◈",
      moodLabel: "WISDOM",
      accent: "#9C7BD9",
      avatar: "sage.svg",
    });
    expect(getYuanVisual("kong")).toMatchObject({
      symbol: "◐",
      moodLabel: "STILL",
      accent: "#A8B8C8",
      avatar: "zen.svg",
    });
  });

  it("falls back to hanako for unknown yuan values", () => {
    expect(normalizeYuan("unknown")).toBe("hanako");
    expect(moodLabelForYuan("unknown")).toBe("✦ MUSE");
  });
});
