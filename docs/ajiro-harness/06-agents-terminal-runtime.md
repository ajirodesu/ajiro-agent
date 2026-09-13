# K/L/M. Subagents + Terminal + Runtime (see also 04)

## Subagents (K)
Main → Explorer/Planner/CodeAnalyst/TestAgent/SecurityReviewer/AndroidAgent/
DocumentationAgent (+ General). Separate context (delegated prompt only),
restricted tools, own budgets (15–20 iterations), parallel execution,
cancellation, result-as-tool-output. Catalog described to the model
(`describeSubagentCatalog`, kept).

## Embedded terminal (L, §§32–49)
- Stack: RN + Expo + TS only. Modules: TerminalView, Controller, Session,
  Parser (state machine), Grid (flat Int32Arrays, packed colors/attrs),
  Buffer (primary/alt, bounded scrollback with color runs, margins, wrap,
  reflow-preserving resize, selection ranges, search), Renderer (batched
  line <Text>, never per-cell), Input (TextInput IME/hardware + ^C/ESC keys),
  Keyboard geometry sync (onLayout → resize), Theme (dark/light/system/custom),
  Search (query/next/prev/case/highlight + current-match), History (bounded,
  per-session, up/down), ProcessAdapter (runtime-neutral + InProcess impl).
- ANSI/VT: SGR 16/256/truecolor, bold/dim/italic/underline/inverse/strike,
  cursor, ED/EL, SU/SD, ICH/DCH/ECH/IL/DL, margins, DECSET 25/47/1047/1048/
  1049/2004, OSC 0/2 titles; unknowns ignored. UTF-8 recovery, wide/emoji
  cells, combining marks, tabs/BS/CR/LF, alt-screen isolation.
- Performance: no per-byte renders (version ticks), 64ms scroll throttle,
  scrollback cap 5000, reflow keeps text. No sub-ms claims.
- Security (§48): every `run` goes Permission → Broker → android_local;
  builtins need no permission; unknown commands exit 127.
- UI (§47): transcript mode kept; interactive adds tabs, clear, A±, search —
  functional additions in existing visual language, no redesign.

## Device runtime matrix (M, §§28–30)
| Operation | android_local | linux |
|---|---|---|
| fs read / scoped write | YES (SAF + app storage) | n/a |
| git (isomorphic-git) | YES (no binary; worktrees limited) | n/a |
| exec checks (5 allow-listed) | YES (in-process) | n/a |
| network APIs | YES (communication, approved) | n/a |
| general shell / packages / builds | NO (no exec on stock Android) | optional PRoot slot: `linux-provision.ts` detects/proposes; unprovisioned → explicit limitation |
No remote column exists. Network ≠ execution (§102).
