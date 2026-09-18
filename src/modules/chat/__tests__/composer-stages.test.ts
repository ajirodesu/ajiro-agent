import { describe, expect, it } from "vitest";

import {
  COMPOSER_CHROME,
  COMPOSER_DESIGN_MAX_HEIGHT,
  COMPOSER_DESIGN_TEXT_CAP,
  COMPOSER_LINE_HEIGHT,
  COMPOSER_MARGIN_RATIO,
  COMPOSER_MIN_HEIGHT,
  COMPOSER_RADIUS_MAX,
  COMPOSER_RADIUS_MIN,
  COMPOSER_STAGE_TABLE,
  POST_CHAT_BOTTOM_OFFSET,
  POST_CHAT_DURATION_MS,
  POST_CHAT_HEIGHT,
  POST_CHAT_MIC_CENTER_FROM_RIGHT,
  POST_CHAT_PH_IN_MS,
  POST_CHAT_PH_OUT_MS,
  POST_CHAT_PLACEHOLDER,
  POST_CHAT_PLUS_CENTER,
  POST_CHAT_RADIUS,
  POST_CHAT_ROW_DELAY_MS,
  POST_CHAT_ROW_DURATION_MS,
  POST_CHAT_ROW_HEIGHT,
  composerLayoutFor,
  composerTextCap,
  postChatFrame,
  postChatRowProgress,
} from "@/modules/chat/composer-stages";

describe("composer stage table", () => {
  it("covers all 13 reference stages with test data", () => {
    expect(COMPOSER_STAGE_TABLE.length).toBe(13);
    for (const entry of COMPOSER_STAGE_TABLE) {
      expect(entry.text.length).toBeGreaterThan(0);
    }
    expect(COMPOSER_STAGE_TABLE[0]?.text).toBe("Stage 1");
    expect(COMPOSER_STAGE_TABLE[1]?.text).toContain("Stage 2:");
    expect(COMPOSER_STAGE_TABLE[12]?.text).toContain("scrollable");
  });

  it("reproduces every stage from one layout rule", () => {
    for (const entry of COMPOSER_STAGE_TABLE) {
      // Stage 1 text is short and narrow (shares the row); stage 2+ text
      // spans the full width (drops to the column layout). Width — not just
      // height — drives the stage 1 -> 2 transition.
      const measured = entry.lines * COMPOSER_LINE_HEIGHT;
      const measuredWidth = entry.stage === 1 ? 60 : 9999;
      const layout = composerLayoutFor(
        measured,
        measuredWidth,
        200,
        COMPOSER_DESIGN_TEXT_CAP,
        true,
      );
      expect(layout.lines, `stage ${entry.stage} lines`).toBe(entry.lines);
      expect(layout.singleRow, `stage ${entry.stage} singleRow`).toBe(
        entry.singleRow,
      );
      expect(layout.scrollable, `stage ${entry.stage} scrollable`).toBe(
        entry.scrollable,
      );
      expect(layout.showExpand, `stage ${entry.stage} showExpand`).toBe(
        entry.showExpand,
      );
    }
  });

  it("holds stage 1 at the 52 pill and stage 12/13 at the max capsule", () => {
    const s1 = composerLayoutFor(
      COMPOSER_LINE_HEIGHT,
      60,
      200,
      COMPOSER_DESIGN_TEXT_CAP,
      true,
    );
    expect(s1.barHeight).toBe(COMPOSER_MIN_HEIGHT);
    expect(s1.radius).toBe(COMPOSER_RADIUS_MIN);
    const s12 = composerLayoutFor(
      11 * COMPOSER_LINE_HEIGHT,
      9999,
      200,
      COMPOSER_DESIGN_TEXT_CAP,
      true,
    );
    expect(s12.scrollable).toBe(false);
    expect(s12.barHeight).toBe(COMPOSER_DESIGN_MAX_HEIGHT);
    expect(s12.radius).toBe(COMPOSER_RADIUS_MAX);
    const s13 = composerLayoutFor(
      12 * COMPOSER_LINE_HEIGHT,
      9999,
      200,
      COMPOSER_DESIGN_TEXT_CAP,
      true,
    );
    expect(s13.scrollable).toBe(true);
    expect(s13.barHeight).toBe(COMPOSER_DESIGN_MAX_HEIGHT);
    expect(s13.textHeight).toBe(COMPOSER_DESIGN_TEXT_CAP);
  });

  it("switches to column layout when text fills the row width", () => {
    const narrow = composerLayoutFor(
      COMPOSER_LINE_HEIGHT,
      60,
      200,
      COMPOSER_DESIGN_TEXT_CAP,
      true,
    );
    expect(narrow.singleRow).toBe(true);
    const wide = composerLayoutFor(
      COMPOSER_LINE_HEIGHT,
      320,
      200,
      COMPOSER_DESIGN_TEXT_CAP,
      true,
    );
    expect(wide.singleRow).toBe(false);
    expect(wide.barHeight).toBe(
      COMPOSER_CHROME + COMPOSER_LINE_HEIGHT,
    );
  });

  it("grows one line at a time with constant chrome", () => {
    const heights = [1, 2, 3, 4, 5].map(
      (lines) =>
        composerLayoutFor(
          lines * COMPOSER_LINE_HEIGHT,
          9999,
          200,
          COMPOSER_DESIGN_TEXT_CAP,
          true,
        ).barHeight,
    );
    // Multiline adds chrome + one line each (index 0 is the single-row pill
    // only for narrow text; full-width single line uses the column shape).
    expect(heights[0]).toBe(COMPOSER_CHROME + COMPOSER_LINE_HEIGHT);
    for (let i = 1; i < heights.length; i += 1) {
      expect(heights[i]! - heights[i - 1]!).toBe(COMPOSER_LINE_HEIGHT);
    }
  });

  it("caps by viewport on short screens", () => {
    // Plenty of room: design cap wins (11 lines).
    expect(composerTextCap(844, 340)).toBe(COMPOSER_DESIGN_TEXT_CAP);
    // Cramped: viewport ratio binds instead.
    const cramped = composerTextCap(500, 350);
    expect(cramped).toBeLessThan(COMPOSER_DESIGN_TEXT_CAP);
    expect(cramped).toBeGreaterThanOrEqual(COMPOSER_LINE_HEIGHT * 2);
  });

  it("keeps an empty composer on the single-row pill", () => {
    const layout = composerLayoutFor(
      0,
      0,
      200,
      COMPOSER_DESIGN_TEXT_CAP,
      false,
    );
    expect(layout.singleRow).toBe(true);
    expect(layout.scrollable).toBe(false);
    expect(layout.showExpand).toBe(false);
    expect(layout.barHeight).toBe(COMPOSER_MIN_HEIGHT);
  });

  it("places the capsule at 9.45% screen margins (119/1022/119 at 1260)", () => {
    expect(COMPOSER_MARGIN_RATIO).toBeCloseTo(0.0945, 4);
    const screenWidth = 1260;
    const margin = screenWidth * COMPOSER_MARGIN_RATIO;
    expect(Math.round(margin)).toBe(119);
    expect(Math.round(screenWidth - margin * 2)).toBe(1022);
  });
});

describe("post-chat transformation spec", () => {
  it("pins the geometry, timing, and placeholder contract", () => {
    expect(POST_CHAT_HEIGHT).toBe(118);
    expect(POST_CHAT_RADIUS).toBe(28);
    expect(POST_CHAT_DURATION_MS).toBe(260);
    expect(POST_CHAT_ROW_DELAY_MS).toBe(40);
    expect(POST_CHAT_ROW_DURATION_MS).toBe(220);
    expect(POST_CHAT_PH_OUT_MS).toBe(120);
    expect(POST_CHAT_PH_IN_MS).toBe(120);
    expect(POST_CHAT_PLACEHOLDER).toBe("Reply to Ajiro Agent");
    expect(POST_CHAT_BOTTOM_OFFSET).toBe(16);
    // Row-2 control centers on a 388 dp capsule.
    expect(POST_CHAT_PLUS_CENTER).toBe(25);
    expect(POST_CHAT_MIC_CENTER_FROM_RIGHT).toBe(85);
    expect(POST_CHAT_ROW_HEIGHT).toBe(46);
  });

  it("keeps height and radius proportionate at every checkpoint", () => {
    const preHeight = 56;
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const frame = postChatFrame(t, t, preHeight);
      // Monotone growth, no snapping.
      expect(frame.minHeight).toBeGreaterThanOrEqual(preHeight);
      expect(frame.minHeight).toBeLessThanOrEqual(POST_CHAT_HEIGHT);
      expect(frame.radius).toBeGreaterThanOrEqual(preHeight / 2);
      expect(frame.radius).toBeLessThanOrEqual(POST_CHAT_RADIUS);
      // Radius tracks height: both are the same progress t applied to
      // their ranges, so neither can snap ahead of the other.
      expect(frame.minHeight).toBeCloseTo(
        preHeight + (POST_CHAT_HEIGHT - preHeight) * t,
        9,
      );
      expect(frame.radius).toBeCloseTo(
        preHeight / 2 + (POST_CHAT_RADIUS - preHeight / 2) * t,
        9,
      );
    }
    const start = postChatFrame(0, 0, preHeight);
    expect(start.minHeight).toBe(preHeight);
    expect(start.radius).toBe(preHeight / 2);
    expect(start.rowOpacity).toBe(0);
    expect(start.rowTranslateY).toBe(8);
    const end = postChatFrame(1, 1, preHeight);
    expect(end.minHeight).toBe(POST_CHAT_HEIGHT);
    expect(end.radius).toBe(POST_CHAT_RADIUS);
    expect(end.rowOpacity).toBe(1);
    expect(end.rowTranslateY).toBe(0);
  });

  it("staggers row 2 by 40 ms over a 220 ms run", () => {
    expect(postChatRowProgress(0)).toBe(0);
    expect(postChatRowProgress(39)).toBe(0);
    expect(postChatRowProgress(40)).toBe(0);
    expect(postChatRowProgress(150)).toBeCloseTo(0.5, 5);
    expect(postChatRowProgress(260)).toBe(1);
    expect(postChatRowProgress(999)).toBe(1);
  });

  it("never lets content exceed the animated minimum", () => {
    // Single-line resting content must fit under minHeight at every
    // checkpoint, so the container — not the content — drives the size.
    for (const preHeight of [52, 56, 64]) {
      for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        const frame = postChatFrame(t, t, preHeight);
        const content = frame.padTop + COMPOSER_LINE_HEIGHT + frame.padBottom;
        expect(content).toBeLessThanOrEqual(frame.minHeight + 1e-9);
      }
    }
  });
});
