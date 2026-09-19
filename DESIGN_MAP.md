# DESIGN MAP: Tailwind / NativeWind -> Jetpack Compose Translation

## Chrome Spec Constants
- `HEADER_HEIGHT` = 64.dp
- `ICON_CONTAINER` = 48.dp
- `ICON_INNER` = 40.dp
- `ICON_GLYPH` = 20.dp
- `ICON_STROKE` = 2.dp
- `MaxContentWidth` = 800.dp
- Sidebar Breakpoint = 768.dp
- Rail Width = 76.dp
- Sidebar Width = 30% clamped (240.dp .. 340.dp)

## Tailwind Class -> Modifier Mapping Table
| Tailwind Class | Jetpack Compose Equivalent |
|---|---|
| `flex-1` | `Modifier.fillMaxSize()` or `Modifier.weight(1f)` |
| `flex-row` | `Row(...)` |
| `flex-col` | `Column(...)` |
| `items-center` | `verticalAlignment = Alignment.CenterVertically` or `horizontalAlignment = Alignment.CenterHorizontally` |
| `justify-between` | `horizontalArrangement = Arrangement.SpaceBetween` |
| `justify-center` | `horizontalArrangement = Arrangement.Center` |
| `p-4` | `Modifier.padding(16.dp)` |
| `px-4` | `Modifier.padding(horizontal = 16.dp)` |
| `py-2` | `Modifier.padding(vertical = 8.dp)` |
| `rounded-xl` | `Modifier.clip(RoundedCornerShape(12.dp))` |
| `rounded-full` | `Modifier.clip(CircleShape)` |
| `bg-primary` | `Modifier.background(MaterialTheme.colorScheme.primary)` |
| `border` | `Modifier.border(1.dp, color)` |

## Color Themes
- `aqua`: Primary `#00E5FF`
- `burnt`: Primary `#FF6D00`
- `indigo`: Primary `#6366F1`
- `legacy`: Primary `#3B82F6`
- `system`: Follows system dark/light dynamic theme

## Fonts
- Regular text: `Geist` (`res/font/geist.ttf`)
- Monospace text: `Geist Mono` (`res/font/geist_mono.ttf`)
