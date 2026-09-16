/**
 * Deterministic skill avatar.
 *
 * SKILL.md carries no icon field (in either the Ajiro or the reference
 * format), so remote icons don't exist to preserve. Instead every skill
 * gets a stable identity avatar: first letter + a hue derived from its
 * slug, rendered in Ajiro theme surfaces. Same skill → same avatar on
 * every screen (lists, cards, detail, install, management).
 */
import { Text, View } from "react-native";

const AVATAR_HUES = [168, 210, 265, 330, 20, 95, 140, 190];

function hueForSeed(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return AVATAR_HUES[Math.abs(hash) % AVATAR_HUES.length] ?? 168;
}

export function SkillAvatar({
  seed,
  title,
  size = 40,
}: {
  seed: string;
  title: string;
  size?: number;
}) {
  const initial = title.trim().charAt(0).toUpperCase() || "?";
  const hue = hueForSeed(seed || title);
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={`${title} skill icon`}
      style={{
        alignItems: "center",
        backgroundColor: `hsl(${hue}, 45%, 22%)`,
        borderRadius: size / 3,
        height: size,
        justifyContent: "center",
        width: size,
      }}
    >
      <Text
        style={{
          color: `hsl(${hue}, 90%, 78%)`,
          fontSize: size * 0.45,
          fontWeight: "700",
        }}
      >
        {initial}
      </Text>
    </View>
  );
}
