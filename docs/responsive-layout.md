# Responsive Layout System

Scope: viewport-adaptive layout for the whole app
(`src/components/ui/responsive.ts`, `use-layout-mode.ts`, `sidebar.tsx`,
`app-sidebar.tsx`, `src/app/(root)/_layout.tsx`).

Last updated: 2026-09-18.

## 1. Breakpoints (viewport width, logical pixels)

| Mode | Width | Sidebar |
|---|---|---|
| mobile | < 768 | Overlay fullscreen drawer (existing behavior, untouched) |
| tablet | 768 – 1279 | Persistent, expanded by default |
| desktop | ≥ 1280 | Persistent, expanded by default |

768 is the tablet-portrait threshold; 1280 is where a persistent sidebar
stops crowding content. Everything between scales continuously. No
device-model checks, no fixed resolutions — `useWindowDimensions` drives
re-evaluation on rotation, resize, foldables, and desktop windows.

## 2. Sidebar widths

- Expanded: 30% of viewport, clamped to 240–340px.
- Compact rail: fixed 76px icon rail (22px icons, 48px touch targets).
- Transitions: 220ms timed width animation (honors reduced motion);
  content is flexbox beside it, so it resizes with no manual math and no
  overflow by construction.

## 3. Toggle

`SidebarToggleButton` (tablet/desktop header, immediately before the App
Name on the same line): lucide `panel-left` geometry verified firsthand
(rect 18×18 rx2 + `M9 3v18`, 24 viewBox, stroke 2, round caps/joins,
theme `currentColor`). 22px glyph in a 40px target with hitSlop 10.
Expanded → compact → expanded, preserving navigation, selection, and
scroll state; compact is a designed icon rail (labels, badges,
conversation lists hidden; every button labelled + selected-state).

## 4. Content

The `Slot` wrapper is `flex-1` beside the sidebar; the shared `Container`
centers content under `MaxContentWidth`. Safe areas come from
`useSafeAreaInsets`/SafeAreaView throughout; the keyboard provider,
themes, typography, and icon language are untouched.

## 5. Verification (§20 of the prompt)

Automated (this repo):

```
npx vitest run src/components/ui/__tests__/responsive.test.ts  # breakpoints, widths, clamps, rail-fit
# Full suite: 1187 passed (+3 network-gated skips)
npx tsc --noEmit
npx expo lint <touched paths>
```

| # | Check | How verified |
|---|---|---|
| 1 | Mobile does not overflow | Mobile path is byte-identical to before (overlay drawer + fullscreen Slot); no new constraints touch it |
| 2–4 | Tablet/desktop sidebar visible, expanded, by default | `useLayoutMode` ≥768 renders persistent; `compact` defaults false; unit-tested thresholds |
| 5–7 | panel-left before App Name, same line, balanced | Header row: toggle + gap-8 + flex-1 name + search, `HEADER_HEIGHT`; glyph geometry verified in `lucide-react-native` sources |
| 8–12 | Collapse ↔ expand with content resize | `setCompact` flips state; animated width + flex content; unit-tested widths |
| 13 | No jumps/overflow in transition | Width-only timed animation; flex siblings; no overlay |
| 14–16 | Rotation, safe areas, keyboard | Dimension-driven re-render; insets on panel; KeyboardProvider untouched |
| 17–19 | Text/icons scale, widths/heights adapt | Flexbox + wrap; 22px icon language preserved; rail buttons labelled |
| 20 | No resolution dependence | Only `viewportWidth` is read, in one module |

Manual on-device lab (needs hardware; not automatable here): walk the
14 viewport sizes in the prompt on a phone, foldable, 7"/11" tablets
portrait+landscape, a 13" laptop, a 27" monitor, an ultrawide, and a
narrowed desktop window — checking the 20 behaviors above, especially
compact-rail icon fit at 76px and short-landscape-height rail scrolling.
