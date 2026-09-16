/**
 * File-type icon: renders the self-hosted material-icon-theme SVG for a
 * file name, resolved entirely from the vendored official manifest.
 *
 * Fallback chain (a row is never left without an icon):
 *   1. Manifest-resolved SVG art for the file.
 *   2. The manifest's generic default file icon art.
 *   3. A lucide `FileText` glyph (only when the generated data itself is
 *      unreachable — never for an ordinary unknown file type).
 */
import { FileText } from "lucide-react-native";
import { SvgXml } from "react-native-svg";

import { svgForFile } from "@/file-icons/resolveFileIcon";
import { useTheme } from "@/hooks/use-theme";

export function FileTypeIcon({
  fileName,
  size = 17,
}: {
  fileName: string;
  size?: number;
}): React.JSX.Element {
  const theme = useTheme();
  const xml = svgForFile(fileName);
  if (!xml) {
    return <FileText color={theme.textSecondary} size={size} strokeWidth={2} />;
  }
  return <SvgXml xml={xml} width={size} height={size} />;
}
