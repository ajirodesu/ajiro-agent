/**
 * About page — Ajiro Agent identity, version, device info, external links.
 *
 * Card design mirrors SettingsRefRow/SettingsGroup in `settings/index.tsx`
 * exactly (container, padding, typography, spacing, theme-awareness).
 * Version comes from the live build config (expo-constants, with
 * expo-application fallback); System comes from the live device at runtime
 * (expo-device + Platform.Version).
 */
import { useRouter } from "expo-router";
import * as Application from "expo-application";
import Constants from "expo-constants";
import * as Device from "expo-device";
import { Image } from "expo-image";
import {
  ChevronLeft,
  GitBranch,
  Info,
  Scale,
  Settings2,
} from "lucide-react-native";
import { useEffect, useState, type ReactNode } from "react";
import {
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Path, Svg } from "react-native-svg";

import {
  AppHeader,
  CircleIconButton,
  HeaderShadow,
} from "@/components/ui/chrome";
import { useTheme } from "@/hooks/use-theme";
import { useThemedIconSource } from "@/theme/themed-assets";
import {
  GITHUB_LICENSE_URL,
  GITHUB_REPO_URL,
} from "@/modules/about/app-links";

type RowIcon = typeof Info;

function AboutInfoRow({
  icon: Icon,
  title,
  value,
}: {
  icon: RowIcon;
  title: string;
  value: string;
}) {
  const theme = useTheme();
  return (
    <View
      className="min-h-[52px] flex-row items-center"
      style={{ gap: 12, padding: 16 }}
    >
      <Icon color={theme.text} size={22} strokeWidth={2} />
      <Text
        numberOfLines={1}
        className="min-w-0 flex-1 font-sans text-foreground dark:text-foreground-dark"
        style={{ fontSize: 16, fontWeight: "500" }}
      >
        {title}
      </Text>
      <Text
        numberOfLines={1}
        className="min-w-0 max-w-[60%] shrink font-sans text-right text-muted-foreground dark:text-muted-foreground-dark"
        style={{ fontSize: 15 }}
      >
        {value}
      </Text>
    </View>
  );
}

function AboutLinkRow({
  icon: Icon,
  onPress,
  title,
}: {
  icon: RowIcon;
  onPress: () => void;
  title: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      className="min-h-[52px] flex-row items-center"
      onPress={onPress}
      style={({ pressed }) => ({
        gap: 12,
        padding: 16,
        opacity: pressed ? 0.75 : 1,
      })}
    >
      <Icon color={theme.text} size={22} strokeWidth={2} />
      <Text
        numberOfLines={1}
        className="min-w-0 flex-1 font-sans text-foreground dark:text-foreground-dark"
        style={{ fontSize: 16, fontWeight: "500" }}
      >
        {title}
      </Text>
      <Svg
        width={18}
        height={18}
        viewBox="0 0 24 24"
        fill="none"
        stroke={theme.textSecondary}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ opacity: 0.5 }}
      >
        <Path d="M21 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6" />
        <Path d="m21 3-9 9" />
        <Path d="M15 3h6v6" />
      </Svg>
    </Pressable>
  );
}

function AboutGroup({ children }: { children: ReactNode }) {
  const count = Array.isArray(children) ? children.length : 1;
  return (
    <View
      className="bg-card dark:bg-card-dark"
      style={{ gap: 2, marginHorizontal: 16, marginBottom: 28 }}
    >
      {Array.isArray(children)
        ? children.map((child, index) => (
            <View
              key={index}
              className="overflow-hidden"
              style={{
                borderTopLeftRadius: index === 0 ? 24 : 4,
                borderTopRightRadius: index === 0 ? 24 : 4,
                borderBottomLeftRadius: index === count - 1 ? 24 : 4,
                borderBottomRightRadius: index === count - 1 ? 24 : 4,
              }}
            >
              {child}
            </View>
          ))
        : children}
    </View>
  );
}

function readAppVersion(): string {
  const fromConstants = Constants.expoConfig?.version;
  if (typeof fromConstants === "string" && fromConstants.trim()) {
    return fromConstants.trim();
  }
  const nativeVersion = Application.nativeApplicationVersion;
  if (typeof nativeVersion === "string" && nativeVersion.trim()) {
    return nativeVersion.trim();
  }
  return "Unknown";
}

function readSystemInfo(): string {
  const model =
    Device.modelName?.trim() || Device.designName?.trim() || "Unknown device";
  const osName = Device.osName?.trim() || Platform.OS;
  const osVersion = Device.osVersion?.trim() || String(Platform.Version ?? "");
  let system = `${model} / ${osName}${osVersion ? ` ${osVersion}` : ""}`.trim();
  const sdk =
    typeof Device.platformApiLevel === "number"
      ? `SDK ${Device.platformApiLevel}`
      : Platform.OS === "android" && Platform.Version != null
        ? `SDK ${Platform.Version}`
        : null;
  if (sdk) system = `${system} / ${sdk}`;
  return system;
}

export default function AboutScreen() {
  const router = useRouter();
  const theme = useTheme();
  const logoSource = useThemedIconSource("icon");
  const [scrolled, setScrolled] = useState(false);
  const [version, setVersion] = useState(readAppVersion());
  const [system, setSystem] = useState(readSystemInfo());

  useEffect(() => {
    setVersion(readAppVersion());
    setSystem(readSystemInfo());
  }, []);

  const openUrl = (url: string) => {
    Linking.openURL(url).catch(console.error);
  };

  return (
    <SafeAreaView
      className="flex-1 bg-background dark:bg-background-dark"
      edges={["top", "left", "right"]}
    >
      <View className="relative flex-1">
        <AppHeader
          left={
            <CircleIconButton
              accessibilityLabel="Back"
              onPress={() => {
                if (router.canGoBack()) {
                  router.back();
                } else {
                  router.push("/settings");
                }
              }}
            >
              <ChevronLeft color={theme.text} size={20} strokeWidth={2} />
            </CircleIconButton>
          }
          title="About"
        />
        <ScrollView
          className="flex-1"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingTop: 12, paddingBottom: 24 }}
          scrollEventThrottle={32}
          onScroll={(event) => {
            setScrolled(event.nativeEvent.contentOffset.y > 4);
          }}
        >
          <View style={{ alignItems: "center", marginBottom: 20 }}>
            <View
              style={{
                width: 96,
                height: 96,
                borderRadius: 48,
                overflow: "hidden",
                borderWidth: 1,
                borderColor: theme.border,
                backgroundColor: theme.backgroundElement,
              }}
            >
              <Image
                source={logoSource}
                style={{ width: 96, height: 96 }}
                contentFit="contain"
              />
            </View>
            <Text
              className="font-sans text-foreground dark:text-foreground-dark"
              style={{ fontSize: 20, fontWeight: "600", marginTop: 12 }}
            >
              Ajiro Agent
            </Text>
          </View>

          <AboutGroup>
            <AboutInfoRow icon={Info} title="Version" value={version} />
            <AboutInfoRow icon={Settings2} title="System" value={system} />
          </AboutGroup>

          <AboutGroup>
            <AboutLinkRow
              icon={GitBranch}
              title="GitHub"
              onPress={() => openUrl(GITHUB_REPO_URL)}
            />
            <AboutLinkRow
              icon={Scale}
              title="License"
              onPress={() => openUrl(GITHUB_LICENSE_URL)}
            />
          </AboutGroup>
        </ScrollView>

        <HeaderShadow visible={scrolled} />
      </View>
    </SafeAreaView>
  );
}

