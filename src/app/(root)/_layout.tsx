import { Slot } from "expo-router";
import { View } from "react-native";

import { AppSidebar } from "@/components/ui/app-sidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { useLayoutMode } from "@/components/ui/use-layout-mode";

/**
 * Viewport-adaptive shell. Mobile keeps the existing fullscreen + overlay
 * drawer behavior untouched; tablet and desktop mount the sidebar
 * persistently beside the content in a flex row, so rotation, window
 * resizing, and folding resize both panes automatically with no manual
 * width math and no reload.
 */
function ResponsiveShell() {
  const mode = useLayoutMode();

  if (mode === "mobile") {
    return (
      <>
        <AppSidebar />
        <Slot />
      </>
    );
  }

  return (
    <View className="flex-1 flex-row bg-background dark:bg-background-dark">
      <AppSidebar persistent />
      <View className="min-w-0 flex-1">
        <Slot />
      </View>
    </View>
  );
}

export default function Layout() {
  return (
    <SidebarProvider>
      <ResponsiveShell />
    </SidebarProvider>
  );
}
