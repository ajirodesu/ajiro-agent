/**
 * ChatGPT-style composer: measured spec + stage test data.
 *
 * Reverse-engineered from chat-ui.html (1260x2800 canvas, proportional
 * spec: composerWidth = screenWidth * 0.811, margins 9.45% each side) and
 * the reference photo (2800x1260 device):
 * - Capsule: #212121 bg, 1px #424242 hairline, full pill single-line.
 * - Single row (+, text, mic, send); multiline wraps to text-over-controls.
 * - Plus/send controls: 112px circles (same container); plus transparent
 *   until pressed (#2A2A2A); send #2A2A2A + grey arrow when inactive,
 *   #2D9CDB + white tabler arrow when active.
 * - Input 16px #ECECEC, placeholder #8E8E93, caret #ECECEC, line pitch 22.
 * - Mic glyph #FFFFFF; right gap 83px; middle padding 24px (all proportional).
 * - Max: stage 12 ~= stage 13 capsule; text viewport scrolls, capsule and
 *   controls frozen, keyboard gap stable. Scroll begins between 11 and 12
 *   content lines, so the cap is 11 lines (stage 12 fits exactly).
 *
 * ONE layout system generates all 13 stages (no per-stage rules).
 */
export const COMPOSER_LINE_HEIGHT = 22;
export const COMPOSER_FONT_SIZE = 16;
export const COMPOSER_MIN_HEIGHT = 52;
/** Horizontal screen-edge margin as a screen-width ratio (119/1260). */
export const COMPOSER_MARGIN_RATIO = 0.0945;
export const COMPOSER_MAX_TEXT_LINES = 11;
export const COMPOSER_DESIGN_TEXT_CAP =
  COMPOSER_LINE_HEIGHT * COMPOSER_MAX_TEXT_LINES; // 242
export const COMPOSER_TOP_PAD = 14;
export const COMPOSER_BOTTOM_ROW_HEIGHT = 52;
export const COMPOSER_MID_GAP = 6;
export const COMPOSER_CHROME =
  COMPOSER_TOP_PAD + COMPOSER_MID_GAP + COMPOSER_BOTTOM_ROW_HEIGHT; // 72
export const COMPOSER_DESIGN_MAX_HEIGHT =
  COMPOSER_CHROME + COMPOSER_DESIGN_TEXT_CAP; // 314
export const COMPOSER_RADIUS_MIN = 26;
export const COMPOSER_RADIUS_MAX = 28;

/**
 * Post-send capsule transformation (chat screen only): after the first
 * message is sent, the single-row pre-chat capsule becomes a fixed two-row
 * form and stays there for the conversation. All values are dp, matched to
 * the 1260x2800 reference (420x933 dp viewport at density 3.0).
 */
export const POST_CHAT_HEIGHT = 118;
export const POST_CHAT_RADIUS = 28;
/** Post placeholder: exact string, never truncated. */
export const POST_CHAT_PLACEHOLDER = "Reply to Ajiro Agent";
/** Transition: single 260 ms ease-out-expo driver, no springs. */
export const POST_CHAT_DURATION_MS = 260;
/** Row-2 fade+slide starts 40 ms in and runs 220 ms (ends with the driver). */
export const POST_CHAT_ROW_DELAY_MS = 40;
export const POST_CHAT_ROW_DURATION_MS = 220;
/** Placeholder cross-fade: 120 ms out, swap, 120 ms in (240 ms total). */
export const POST_CHAT_PH_OUT_MS = 120;
export const POST_CHAT_PH_IN_MS = 120;
/** Row-2 entrance travel. */
export const POST_CHAT_ROW_SHIFT_DP = 8;
/** 16 dp bottom offset above the safe-area / gesture inset. */
export const POST_CHAT_BOTTOM_OFFSET = 16;
/** Row 1: text vertical center 47 dp below the capsule top (22 dp lines). */
export const POST_CHAT_ROW1_TOP_PAD = 36;
/** Row 1: text left inset from the capsule's left edge. */
export const POST_CHAT_TEXT_LEFT = 20;
/** Row 1 bottom clearance so growing text never reaches the control row. */
export const POST_CHAT_ROW1_BOTTOM_PAD = 46;
/** Row 2: 46 dp tall, bottom-anchored (center 95 dp below the top). */
export const POST_CHAT_ROW_HEIGHT = 46;
/** Row 2 controls share one vertical center line. */
export const POST_CHAT_PLUS_GLYPH = 28;
export const POST_CHAT_PLUS_CENTER = 25;
export const POST_CHAT_MIC_GLYPH = 24;
export const POST_CHAT_MIC_CENTER_FROM_RIGHT = 85;
export const POST_CHAT_SEND_DIAMETER = 36;
export const POST_CHAT_SEND_CENTER_FROM_RIGHT = 28;

/** Linear frame helper; the driver applies the bezier easing to progress. */
function postChatLerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

export type PostChatFrame = {
  /** Container minHeight: measured pre height → 118. */
  minHeight: number;
  /** Corner radius: pre pill (preHeight/2) → 28, tied to height. */
  radius: number;
  /** Row-1 top padding: pre → 36 (text center lands on 47). */
  padTop: number;
  /** Row-1 bottom padding: pre → 46 (clears the control row). */
  padBottom: number;
  /** Control-row opacity 0→1 (driven by the delayed row progress). */
  rowOpacity: number;
  /** Control-row travel +8dp→0dp (driven by the delayed row progress). */
  rowTranslateY: number;
};

/**
 * One choreography frame. `progress` is the eased 0→1 driver (260 ms);
 * `rowProgress` is the same easing delayed 40 ms and renormalized over
 * 220 ms; `preHeight` is the measured pre-chat capsule height. Height and
 * radius share the driver so they stay proportionate at every checkpoint.
 */
export function postChatFrame(
  progress: number,
  rowProgress: number,
  preHeight: number,
): PostChatFrame {
  const t = Math.min(1, Math.max(0, progress));
  const r = Math.min(1, Math.max(0, rowProgress));
  const prePadTop = 8;
  const prePadBottom = Math.max(8, preHeight - prePadTop - COMPOSER_LINE_HEIGHT);
  return {
    minHeight: postChatLerp(preHeight, POST_CHAT_HEIGHT, t),
    radius: postChatLerp(preHeight / 2, POST_CHAT_RADIUS, t),
    padTop: postChatLerp(prePadTop, POST_CHAT_ROW1_TOP_PAD, t),
    padBottom: postChatLerp(prePadBottom, POST_CHAT_ROW1_BOTTOM_PAD, t),
    rowOpacity: r,
    rowTranslateY: postChatLerp(POST_CHAT_ROW_SHIFT_DP, 0, r),
  };
}

/** Map elapsed ms onto the delayed row progress (40 ms stagger, 220 ms run). */
export function postChatRowProgress(elapsedMs: number): number {
  return Math.min(
    1,
    Math.max(0, (elapsedMs - POST_CHAT_ROW_DELAY_MS) / POST_CHAT_ROW_DURATION_MS),
  );
}
export const COMPOSER_EXPAND_MIN_LINES = 5;
export const COMPOSER_MAX_VIEWPORT_RATIO = 0.65;

export const COMPOSER_COLORS = {
  capsule: "#212121",
  border: "#424242",
  text: "#ECECEC",
  placeholder: "#8E8E93",
  cursor: "#ECECEC",
  selection: "#0A84FF",
  send: "#2D9CDB",
  sendInactive: "#2A2A2A",
  sendArrowInactive: "#8E8E93",
  icon: "#FFFFFF",
  plusActive: "#2A2A2A",
} as const;

export type ComposerLayout = {
  /** Visible text lines (min 1). */
  lines: number;
  /** True while everything fits on one row (stage 1 shape). */
  singleRow: boolean;
  /** Text-area height driving the animation. */
  textHeight: number;
  /** Expected capsule height. */
  barHeight: number;
  /** True once the text viewport scrolls (stage 13). */
  scrollable: boolean;
  /** Expand affordance visible (stages 6+, i.e. 5+ lines). */
  showExpand: boolean;
  /** Corner radius for the current height. */
  radius: number;
};

/**
 * Pure layout rule. measuredTextHeight/measuredTextWidth come from
 * onContentSizeChange; textBudget is the row width left for text after the
 * single-row controls (+, mic, send); maxTextHeight is the responsive cap.
 *
 * Single row (stage 1) holds only while the text is both short AND narrow
 * enough to share the row with the controls — exactly the observable
 * stage 1 -> 2 transition. Everything else is column layout.
 */
export function composerLayoutFor(
  measuredTextHeight: number,
  measuredTextWidth: number,
  textBudget: number,
  maxTextHeight: number,
  hasText: boolean,
): ComposerLayout {
  const measured =
    measuredTextHeight > 0 ? measuredTextHeight : COMPOSER_LINE_HEIGHT;
  const lines = Math.max(1, Math.round(measured / COMPOSER_LINE_HEIGHT));
  const fitsOneLine = measured <= COMPOSER_LINE_HEIGHT * 1.2;
  const fitsRowWidth = measuredTextWidth <= 0 || measuredTextWidth <= textBudget;
  const singleRow = !hasText || (fitsOneLine && fitsRowWidth);
  const textHeight = singleRow
    ? COMPOSER_LINE_HEIGHT
    : Math.min(maxTextHeight, Math.max(COMPOSER_LINE_HEIGHT, measured));
  const scrollable =
    hasText && !singleRow && measured > maxTextHeight + 1;
  const barHeight = singleRow
    ? COMPOSER_MIN_HEIGHT
    : COMPOSER_CHROME + textHeight;
  const showExpand = !singleRow && lines >= COMPOSER_EXPAND_MIN_LINES;
  const radius =
    barHeight / 2 >= COMPOSER_RADIUS_MAX
      ? COMPOSER_RADIUS_MAX
      : Math.max(COMPOSER_RADIUS_MIN, barHeight / 2);
  return { lines, singleRow, textHeight, barHeight, scrollable, showExpand, radius };
}

/** Responsive text cap: 10 design lines, clamped to viewport above keyboard. */
export function composerTextCap(
  screenHeight: number,
  keyboardHeight: number,
): number {
  const aboveKeyboard = Math.max(0, screenHeight - keyboardHeight);
  const viewportCap =
    Math.floor(aboveKeyboard * COMPOSER_MAX_VIEWPORT_RATIO) -
    COMPOSER_CHROME;
  return Math.max(
    COMPOSER_LINE_HEIGHT * 2,
    Math.min(COMPOSER_DESIGN_TEXT_CAP, viewportCap),
  );
}

export type StageExpectation = {
  stage: number;
  text: string;
  lines: number;
  singleRow: boolean;
  scrollable: boolean;
  showExpand: boolean;
};

const TEST_ROW = "test test test test test test test test test";

function stageText(stage: number): string {
  if (stage === 1) return "Stage 1";
  if (stage === 2) return "Stage 2: This is a demo message test tes";
  if (stage === 13) {
    return [
      "Stage 12: This is a demo message test",
      ...Array.from({ length: 9 }, () => TEST_ROW),
      "test test test test test test Stage: 13 in",
      "this stage the capsule is now scrollable",
    ].join("\n");
  }
  // Stages 3..12: header + (stage-3) full rows + one partial row, so each
  // stage wraps exactly one line deeper (matches the reference progression).
  const fullRows = Array.from({ length: stage - 3 }, () => TEST_ROW);
  return [
    `Stage ${stage}: This is a demo message test`,
    ...fullRows,
    "test test test test test test test test test t",
  ].join("\n");
}

/** Acceptance table: stage -> expected visible state (uncapped viewport). */
export const COMPOSER_STAGE_TABLE: StageExpectation[] = Array.from(
  { length: 13 },
  (_, index) => {
    const stage = index + 1;
    const lines = stage === 1 ? 1 : stage === 2 ? 1 : stage - 1;
    return {
      stage,
      text: stageText(stage),
      lines,
      singleRow: stage === 1,
      scrollable: stage === 13,
      showExpand: stage >= 6 && stage <= 13,
    };
  },
);
