// Light and dark theme palettes.
//
// The dark palette is a solid-black theme (background #000000) used for the
// whole app in dark mode. The light palette is a fully functional light
// appearance (white/near-white backgrounds, dark text) used in light mode.
// Components resolve the active palette through useTheme(), which reads the
// resolved color scheme (device scheme or the user's Theme preference).
const lightPalette = {
  text: "#000000",
  background: "#ffffff",
  backgroundElement: "#F0F0F3",
  backgroundSelected: "#E0E1E6",
  sidebar: "#FFFFFF",
  sidebarElement: "#ECECEF",
  textSecondary: "#60646C",
  border: "#D4D7DE",
  input: "#FFFFFF",
  ring: "#94A3B8",
  accent: "#E0E1E6",
  accentForeground: "#000000",
  syntaxComment: "#5F6672",
  syntaxConstant: "#B4233C",
  syntaxFunction: "#0B5CAD",
  syntaxKeyword: "#6F42C1",
  syntaxNumber: "#8A4B08",
  syntaxOperator: "#006B75",
  syntaxRegex: "#795E00",
  syntaxString: "#196B3A",
  destructive: "#DC2626",
  destructiveForeground: "#FFFFFF",
};

const darkPalette = {
  text: "#ffffff",
  background: "#000000",
  backgroundElement: "#3C3C3E",
  backgroundSelected: "#2E3135",
  sidebar: "#000000",
  sidebarElement: "#000000",
  textSecondary: "#8C8C8C",
  border: "#3A3A3C",
  input: "#181A1D",
  ring: "#64748B",
  accent: "#3B82F6",
  accentForeground: "#FFFFFF",
  syntaxComment: "#AEB4BF",
  syntaxConstant: "#FF7B86",
  syntaxFunction: "#79C0FF",
  syntaxKeyword: "#D2A8FF",
  syntaxNumber: "#F2A65A",
  syntaxOperator: "#61D4DF",
  syntaxRegex: "#E5C07B",
  syntaxString: "#76D39B",
  destructive: "#EF4444",
  destructiveForeground: "#FFFFFF",
};

const Colors = {
  light: lightPalette,
  dark: darkPalette,
};

const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
};

const MaxContentWidth = 800;

module.exports = {
  Colors,
  MaxContentWidth,
  Spacing,
};
