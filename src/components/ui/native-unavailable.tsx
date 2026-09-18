import { MonitorSmartphone } from "lucide-react-native";
import { Text, View } from "react-native";

import { useTheme } from "@/hooks/use-theme";

/**
 * Web Preview fallback for native-only surfaces (WebView documents, device
 * terminals, native pickers). Rendered ONLY when Platform.OS === "web" at
 * call sites and in .web.tsx platform files, so production Android/iOS
 * builds can never show it. States plainly that the surface needs a native
 * runtime instead of faking functionality.
 */
export function NativeViewUnavailable({
  title,
  detail,
}: {
  title: string;
  detail?: string;
}) {
  const theme = useTheme();
  return (
    <View className="min-h-0 flex-1 items-center justify-center gap-sp-3 px-sp-6">
      <View
        className="items-center justify-center rounded-full"
        style={{
          backgroundColor: theme.backgroundSelected,
          height: 56,
          width: 56,
        }}
      >
        <MonitorSmartphone color={theme.textSecondary} size={26} strokeWidth={2} />
      </View>
      <Text className="text-center font-sans text-base font-semibold text-foreground dark:text-foreground-dark">
        {title}
      </Text>
      <Text className="text-center font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
        {detail ??
          "This surface needs the native app runtime and is unavailable in Web Preview."}
      </Text>
    </View>
  );
}
