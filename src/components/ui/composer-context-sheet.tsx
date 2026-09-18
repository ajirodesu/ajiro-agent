import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/hooks/use-theme";
import { withAlpha } from "@/components/ui/chrome-spec";
import {
  Archive,
  Camera,
  Check,
  ChevronLeft,
  FileText,
  FolderOpen,
  Gauge,
  Globe,
  Hand,
  Image as ImageIcon,
  Infinity as InfinityIcon,
  ListChecks,
  MessageCircle,
  Paperclip,
  Pin,
  ArrowUpRight,
  Bot,
  Package,
  Search,
  Server,
  Settings as SettingsIcon,
  Share2,
  Sparkles,
  Terminal as TerminalIcon,
  Wand2,
  Wrench,
  X,
  Zap,
} from "lucide-react-native";

import type {
  InteractionMode,
  ReasoningEffort,
  SkillMode,
  ToolApprovalMode,
  WebSearchMode,
} from "@/core/types/app-state";

/**
 * Composer context sheet: faithful React Native port of
 * composer-context-modal.html — gesture-driven bottom sheet with panes
 * (main / attachment / agent / approval / websearch / effort / skills),
 * fitted-to-content spring snaps (fitted / max / hidden), single-select
 * option groups, and a thinking toggle. Every row writes real app state
 * through the callbacks below; nothing here is a visual stub.
 */

type SheetTheme = {
  accent: string;
  accentForeground: string;
  backgroundElement: string;
  backgroundSelected: string;
  border: string;
  text: string;
  textSecondary: string;
  warning: string;
};

/**
 * Sheet palette derived from the active theme (light, dark, and all
 * built-in theme extensions). Replaces the old hardcoded dark constants so
 * theme switches re-skin the sheet immediately and consistently.
 */
function sheetColors(theme: SheetTheme) {
  return {
    SHEET_BG: theme.backgroundElement,
    HANDLE_COLOR: theme.textSecondary,
    ROW_ICON_BG: theme.backgroundSelected,
    OPT_CARD_BG: theme.backgroundElement,
    OPT_ICON_BG: theme.backgroundSelected,
    ACCENT: theme.accent,
    ACCENT_STRONG: theme.accent,
    TEXT_STRONG: theme.text,
    TEXT_MAIN: theme.text,
    TEXT_DIM: theme.textSecondary,
    BADGE_BG: theme.backgroundSelected,
    BADGE_TEXT: theme.textSecondary,
    AMBER_BG: withAlpha(theme.warning, 0.16),
    AMBER_TEXT: theme.warning,
  };
}

const HANDLE_ZONE_H = 26;
const SHEET_MIN_H = 160;
const SHEET_TOP_GAP = 48;
const SHEET_BOTTOM_PAD = 24;

export type SheetPane =
  | "main"
  | "attachment"
  | "agent"
  | "interaction"
  | "approval"
  | "websearch"
  | "effort"
  | "skills";

export type PinnedSkillItem = {
  id: string;
  title: string;
  description: string | null;
  selected: boolean;
  linked: boolean;
};

export type ComposerContextSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploadFile: () => void;
  onTakePhoto: () => void;
  onGallery: () => void;
  onOpenProject: () => void;
  onSelectModel: () => void;
  onMcpServers: () => void;
  skillMode: SkillMode;
  onSkillModeChange: (mode: SkillMode) => void;
  pinnedSkills: PinnedSkillItem[];
  onToggleSkill: (id: string) => void;
  onAddSkills: () => void;
  webSearchMode: WebSearchMode;
  onWebSearchModeChange: (mode: WebSearchMode) => void;
  effort: ReasoningEffort;
  onEffortChange: (effort: ReasoningEffort) => void;
  thinking: boolean;
  onThinkingChange: (enabled: boolean) => void;
  agentName: string;
  onAgentChange: (name: "build" | "plan") => void;
  interactionMode: InteractionMode;
  onInteractionModeChange: (mode: InteractionMode) => void;
  approvalMode: ToolApprovalMode;
  onApprovalModeChange: (mode: ToolApprovalMode) => void;
};

type IconType = typeof Paperclip;

function SheetHandle() {
  const { HANDLE_COLOR } = sheetColors(useTheme());
  return (
    <View
      className="items-center justify-center"
      style={{ height: HANDLE_ZONE_H }}
    >
      <View
        style={{
          width: 36,
          height: 4,
          borderRadius: 2,
          backgroundColor: HANDLE_COLOR,
        }}
      />
    </View>
  );
}

function MainRow({
  icon: Icon,
  label,
  onPress,
}: {
  icon: IconType;
  label: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  const { ROW_ICON_BG, TEXT_MAIN, TEXT_STRONG } = sheetColors(theme);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className="flex-row items-center"
      style={({ pressed }) => ({
        height: 64,
        paddingHorizontal: 16,
        gap: 14,
        backgroundColor: pressed
          ? withAlpha(theme.text, 0.06)
          : "transparent",
      })}
    >
      <View
        className="items-center justify-center rounded-full"
        style={{ width: 40, height: 40, backgroundColor: ROW_ICON_BG }}
      >
        <Icon color={TEXT_STRONG} size={20} strokeWidth={2} />
      </View>
      <Text style={{ fontSize: 17, fontWeight: "400", color: TEXT_MAIN }}>
        {label}
      </Text>
    </Pressable>
  );
}

function SubHeader({
  onBack,
  title,
}: {
  onBack?: () => void;
  title: string;
}) {
  const theme = useTheme();
  const { OPT_ICON_BG, TEXT_STRONG } = sheetColors(theme);
  return (
    <View
      className="flex-row items-center justify-center"
      style={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: 18 }}
    >
      {onBack ? (
        <Pressable
          accessibilityLabel="Back"
          accessibilityRole="button"
          onPress={onBack}
          className="items-center justify-center rounded-full"
          style={({ pressed }) => ({
            position: "absolute",
            left: 16,
            top: 0,
            width: 36,
            height: 36,
            backgroundColor: pressed
              ? theme.backgroundSelected
              : OPT_ICON_BG,
          })}
        >
          <ChevronLeft color={TEXT_STRONG} size={17} strokeWidth={2.4} />
        </Pressable>
      ) : null}
      <Text style={{ fontWeight: "600", fontSize: 17, color: TEXT_STRONG }}>
        {title}
      </Text>
    </View>
  );
}

function SelectCheck({ shown, dim }: { shown: boolean; dim?: boolean }) {
  const { ACCENT, TEXT_DIM } = sheetColors(useTheme());
  return (
    <View style={{ width: 19, alignItems: "center" }}>
      <Check
        color={dim ? TEXT_DIM : ACCENT}
        size={19}
        strokeWidth={2.6}
        style={{ opacity: shown ? 1 : 0 }}
      />
    </View>
  );
}

function Badge({
  label,
  amber,
}: {
  label: string;
  amber?: boolean;
}) {
  const { AMBER_BG, AMBER_TEXT, BADGE_BG, BADGE_TEXT } = sheetColors(useTheme());
  return (
    <View
      style={{
        paddingHorizontal: 9,
        paddingVertical: 3,
        borderRadius: 10,
        backgroundColor: amber ? AMBER_BG : BADGE_BG,
      }}
    >
      <Text
        style={{
          fontSize: 11,
          color: amber ? AMBER_TEXT : BADGE_TEXT,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

function Tag({
  icon: Icon,
  label,
}: {
  icon: IconType;
  label: string;
}) {
  const { TEXT_DIM } = sheetColors(useTheme());
  return (
    <View className="flex-row items-center" style={{ gap: 5 }}>
      <Icon color={TEXT_DIM} size={13} strokeWidth={2} />
      <Text style={{ fontSize: 11, color: TEXT_DIM }}>{label}</Text>
    </View>
  );
}

function OptCard({
  icon,
  iconActive,
  title,
  titleAccent,
  titleMedium,
  description,
  tags,
  badge,
  selected,
  dimCheck,
  trailing,
  onPress,
}: {
  icon: ReactNode;
  iconActive?: boolean;
  title: string;
  titleAccent?: boolean;
  titleMedium?: boolean;
  description?: string;
  tags?: ReactNode;
  badge?: ReactNode;
  selected?: boolean;
  dimCheck?: boolean;
  trailing?: ReactNode;
  onPress?: () => void;
}) {
  const theme = useTheme();
  const { ACCENT, OPT_CARD_BG, OPT_ICON_BG, TEXT_DIM, TEXT_STRONG } =
    sheetColors(theme);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className="flex-row items-center"
      style={({ pressed }) => ({
        backgroundColor: pressed ? theme.backgroundSelected : OPT_CARD_BG,
        borderRadius: 16,
        padding: 13,
        paddingLeft: 14,
        paddingRight: 14,
        marginHorizontal: 16,
        marginBottom: 10,
        gap: 13,
      })}
    >
      <View
        className="items-center justify-center rounded-full"
        style={{
          width: 40,
          height: 40,
          backgroundColor: iconActive ? ACCENT : OPT_ICON_BG,
        }}
      >
        {icon}
      </View>
      <View className="min-w-0 flex-1">
        <View className="flex-row flex-wrap items-center" style={{ gap: 8 }}>
          <Text
            style={{
              fontSize: 15,
              color: titleAccent ? ACCENT : TEXT_STRONG,
              fontWeight: titleMedium ? "500" : "400",
            }}
          >
            {title}
          </Text>
          {badge}
        </View>
        {description ? (
          <Text
            style={{
              fontSize: 12.5,
              color: TEXT_DIM,
              marginTop: 3,
              lineHeight: 17,
            }}
          >
            {description}
          </Text>
        ) : null}
        {tags}
      </View>
      {trailing ?? (
        <SelectCheck shown={selected ?? false} dim={dimCheck} />
      )}
    </Pressable>
  );
}

function OptFlat({
  title,
  badge,
  selected,
  titleAccent,
  onPress,
}: {
  title: string;
  badge?: ReactNode;
  selected: boolean;
  titleAccent?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const { ACCENT, OPT_CARD_BG, TEXT_STRONG } = sheetColors(theme);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className="flex-row items-center justify-between"
      style={({ pressed }) => ({
        backgroundColor: pressed ? theme.backgroundSelected : OPT_CARD_BG,
        borderRadius: 16,
        paddingHorizontal: 16,
        paddingVertical: 15,
        marginHorizontal: 16,
        marginBottom: 10,
        gap: 10,
      })}
    >
      <View className="flex-row items-center" style={{ gap: 8 }}>
        <Text
          style={{
            fontSize: 15,
            color: titleAccent && selected ? ACCENT : TEXT_STRONG,
            fontWeight: selected ? "500" : "400",
          }}
        >
          {title}
        </Text>
        {badge}
      </View>
      <SelectCheck shown={selected} />
    </Pressable>
  );
}

function Toggle({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  const theme = useTheme();
  const { ACCENT_STRONG, BADGE_BG } = sheetColors(theme);
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      onPress={() => {
        onChange(!value);
      }}
      style={{
        width: 42,
        height: 24,
        borderRadius: 12,
        backgroundColor: value ? ACCENT_STRONG : BADGE_BG,
      }}
    >
      <View
        style={{
          position: "absolute",
          top: 2,
          left: value ? 20 : 2,
          width: 20,
          height: 20,
          borderRadius: 10,
          backgroundColor: theme.accentForeground,
        }}
      />
    </Pressable>
  );
}

function SectionLabel({ children }: { children: string }) {
  const { TEXT_DIM } = sheetColors(useTheme());
  return (
    <Text
      style={{
        fontWeight: "500",
        fontSize: 11.5,
        color: TEXT_DIM,
        letterSpacing: 0.2,
        paddingHorizontal: 20,
        paddingTop: 6,
        paddingBottom: 8,
      }}
    >
      {children}
    </Text>
  );
}

const EFFORT_OPTIONS: { value: ReasoningEffort; label: string; badge?: ReactNode }[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium", badge: <Badge label="Default" /> },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Extra" },
  {
    value: "max",
    label: "Max",
    badge: <Badge label="3.5x or more usage" amber />,
  },
];

/**
 * Fixed modal headers live inside the drag zone, so swiping down on the
 * header tracks 1:1 and dismisses exactly like the handle. Only the main
 * pane is headerless; attachment keeps its title-only header.
 */
const PANE_TITLES: Partial<Record<SheetPane, string>> = {
  attachment: "Attachment",
  agent: "Agent Mode",
  interaction: "Interaction",
  approval: "Approval Mode",
  websearch: "Web Search",
  effort: "Effort",
  skills: "Skills",
};

export function ComposerContextSheet(props: ComposerContextSheetProps) {
  const { open, onOpenChange } = props;
  const theme = useTheme();
  const { SHEET_BG, TEXT_DIM, TEXT_STRONG } = sheetColors(theme);
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [rendered, setRendered] = useState(false);
  const [pane, setPane] = useState<SheetPane>("main");
  const [contentHeight, setContentHeight] = useState(0);
  const [headerHeight, setHeaderHeight] = useState(0);

  const maxH = Math.max(
    SHEET_MIN_H + 60,
    windowHeight - insets.top - SHEET_TOP_GAP,
  );
  const fittedH = Math.min(
    maxH,
    Math.max(
      SHEET_MIN_H,
      contentHeight + HANDLE_ZONE_H + headerHeight + SHEET_BOTTOM_PAD,
    ),
  );

  const height = useSharedValue(0);
  const startH = useSharedValue(0);
  const fittedRef = useRef(fittedH);
  fittedRef.current = fittedH;
  const maxRef = useRef(maxH);
  maxRef.current = maxH;

  // Open: mount, snap from 0 to fitted with an upward flick.
  useEffect(() => {
    if (open) {
      setRendered(true);
      setPane("main");
      height.value = 0;
      height.value = withSpring(fittedRef.current, {
        stiffness: 230,
        damping: 28,
        mass: 1,
        velocity: 900,
      });
    }
  }, [open, height]);

  const close = () => {
    height.value = withTiming(0, { duration: 220 });
    // Dismiss after the collapse animation completes.
    setTimeout(() => {
      setRendered(false);
      onOpenChange(false);
    }, 230);
  };

  const snapTo = (target: number, velocity = 0) => {
    height.value = withSpring(target, {
      stiffness: 230,
      damping: 28,
      mass: 1,
      velocity,
    });
  };

  const pan = Gesture.Pan()
    .onStart(() => {
      startH.value = height.value;
    })
    .onUpdate((event) => {
      const raw = startH.value - event.translationY;
      if (raw > maxRef.current) {
        height.value = maxRef.current + (raw - maxRef.current) * 0.25;
      } else if (raw < 0) {
        height.value = raw * 0.25;
      } else {
        height.value = raw;
      }
    })
    .onEnd((event) => {
      const rest = fittedRef.current;
      const max = maxRef.current;
      const h = height.value;
      const v = -event.velocityY; // upward flick is positive
      if (v < -900 && h < rest * 1.15) {
        height.value = withTiming(0, { duration: 200 });
        setTimeout(() => {
          setRendered(false);
          onOpenChange(false);
        }, 210);
        return;
      }
      if (v > 900) {
        snapTo(max, v);
        return;
      }
      const projected = h + v * 0.12;
      const dHidden = Math.abs(projected);
      const dRest = Math.abs(projected - rest);
      const dMax = Math.abs(projected - max);
      if (dHidden <= dRest && dHidden <= dMax && h < rest * 0.55) {
        height.value = withTiming(0, { duration: 200 });
        setTimeout(() => {
          setRendered(false);
          onOpenChange(false);
        }, 210);
      } else if (dMax < dRest) {
        snapTo(max, v);
      } else {
        snapTo(rest, v);
      }
    });

  const sheetStyle = useAnimatedStyle(() => ({
    height: Math.max(0, height.value),
  }));
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, (height.value / (fittedRef.current || 380)) * 0.85),
  }));

  const goPane = (next: SheetPane) => {
    setPane(next);
  };

  useEffect(() => {
    if (rendered && height.value > 0.5) {
      snapTo(fittedH);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pane, fittedH]);

  const selectEffort = (value: ReasoningEffort) => {
    props.onEffortChange(value);
  };

  const mainPane = (
    <View>
      <MainRow
        icon={Paperclip}
        label="Attachment"
        onPress={() => goPane("attachment")}
      />
      <MainRow
        icon={FolderOpen}
        label="Open Project"
        onPress={() => {
          close();
          props.onOpenProject();
        }}
      />
      <MainRow
        icon={Share2}
        label="Model"
        onPress={() => {
          close();
          props.onSelectModel();
        }}
      />
      <MainRow
        icon={Wand2}
        label="Skills"
        onPress={() => goPane("skills")}
      />
      <MainRow
        icon={Globe}
        label="Web Search"
        onPress={() => goPane("websearch")}
      />
      <MainRow
        icon={Gauge}
        label="Effort"
        onPress={() => goPane("effort")}
      />
      <MainRow
        icon={InfinityIcon}
        label="Agent Mode"
        onPress={() => goPane("agent")}
      />
      <MainRow
        icon={Bot}
        label="Interaction"
        onPress={() => goPane("interaction")}
      />
      <MainRow
        icon={ListChecks}
        label="Approval Mode"
        onPress={() => goPane("approval")}
      />
      <MainRow
        icon={Server}
        label="MCP servers"
        onPress={() => {
          close();
          props.onMcpServers();
        }}
      />
    </View>
  );

  const attachmentPane = (
    <View>
      <OptCard
        icon={<FileText color={TEXT_STRONG} size={19} strokeWidth={2.1} />}
        title="Upload File"
        onPress={() => {
          close();
          props.onUploadFile();
        }}
      />
      <OptCard
        icon={<Camera color={TEXT_STRONG} size={19} strokeWidth={2.1} />}
        title="Take Photo"
        onPress={() => {
          close();
          props.onTakePhoto();
        }}
      />
      <OptCard
        icon={<ImageIcon color={TEXT_STRONG} size={19} strokeWidth={2.1} />}
        title="Select from Gallery"
        onPress={() => {
          close();
          props.onGallery();
        }}
      />
      <OptCard
        icon={<X color={TEXT_STRONG} size={19} strokeWidth={2.1} />}
        title="Cancel"
        onPress={() => goPane("main")}
      />
    </View>
  );

  const agentPane = (
    <View>
      <OptCard
        icon={<InfinityIcon color={TEXT_STRONG} size={19} strokeWidth={2.1} />}
        iconActive={props.agentName === "build"}
        title="Agent"
        titleMedium={props.agentName === "build"}
        description="Agent can use tools and environment to complete tasks automatically"
        selected={props.agentName === "build"}
        tags={
          <View style={{ marginTop: 8, gap: 6 }}>
            <View className="flex-row flex-wrap items-center" style={{ gap: 14 }}>
              <Tag icon={Wrench} label="Tool calls" />
              <Tag icon={Search} label="Web search" />
              <Tag icon={FolderOpen} label="File access" />
            </View>
            <View className="flex-row flex-wrap items-center" style={{ gap: 14 }}>
              <Tag icon={TerminalIcon} label="Runtime env" />
            </View>
          </View>
        }
        onPress={() => {
          props.onAgentChange("build");
        }}
      />
      <OptCard
        icon={<MessageCircle color={TEXT_STRONG} size={19} strokeWidth={2.1} />}
        iconActive={props.agentName === "plan"}
        title="Chat"
        titleMedium={props.agentName === "plan"}
        description="No runtime environment or autonomy; uses fewer tokens"
        selected={props.agentName === "plan"}
        onPress={() => {
          props.onAgentChange("plan");
        }}
      />
    </View>
  );

  const interactionPane = (
    <View>
      <OptCard
        icon={<InfinityIcon color={TEXT_STRONG} size={19} strokeWidth={2.1} />}
        iconActive={props.interactionMode === "agent"}
        title="Agent"
        titleMedium={props.interactionMode === "agent"}
        description="Full behavior: the agent can act with tools, skills, and environment"
        selected={props.interactionMode === "agent"}
        onPress={() => {
          props.onInteractionModeChange("agent");
        }}
      />
      <OptCard
        icon={<Bot color={TEXT_STRONG} size={19} strokeWidth={2.1} />}
        iconActive={props.interactionMode === "bot"}
        title="Bot"
        titleMedium={props.interactionMode === "bot"}
        description="Answers only: read and explain, run skills, never change anything"
        selected={props.interactionMode === "bot"}
        onPress={() => {
          props.onInteractionModeChange("bot");
        }}
      />
    </View>
  );

  const approvalPane = (
    <View>
      <OptCard
        icon={<Zap color={TEXT_STRONG} size={19} strokeWidth={2.1} />}
        iconActive={props.approvalMode === "auto"}
        title="Auto Approve"
        titleMedium={props.approvalMode === "auto"}
        description="Automatically run tools except non-bypassable safety checks"
        selected={props.approvalMode === "auto"}
        onPress={() => {
          props.onApprovalModeChange("auto");
        }}
      />
      <OptCard
        icon={<ListChecks color={TEXT_STRONG} size={19} strokeWidth={2.1} />}
        iconActive={props.approvalMode === "allowList"}
        title="Allow List"
        titleMedium={props.approvalMode === "allowList"}
        description="Only automatically run tools you have explicitly remembered"
        selected={props.approvalMode === "allowList"}
        onPress={() => {
          props.onApprovalModeChange("allowList");
        }}
      />
      <OptCard
        icon={<Hand color={TEXT_STRONG} size={19} strokeWidth={2.1} />}
        iconActive={props.approvalMode === "ask"}
        title="Manual"
        titleMedium={props.approvalMode === "ask"}
        description="Ask whenever a tool policy requires your approval"
        selected={props.approvalMode === "ask"}
        onPress={() => {
          props.onApprovalModeChange("ask");
        }}
      />
    </View>
  );

  const websearchPane = (
    <View>
      <OptCard
        icon={<Globe color={TEXT_STRONG} size={19} strokeWidth={2.1} />}
        iconActive={props.webSearchMode === "offline"}
        title="Offline Mode"
        titleMedium={props.webSearchMode === "offline"}
        description="Use only the model's basic knowledge without searching the web"
        selected={props.webSearchMode === "offline"}
        onPress={() => {
          props.onWebSearchModeChange("offline");
        }}
      />
      <OptCard
        icon={<Sparkles color={TEXT_STRONG} size={19} strokeWidth={2.1} />}
        iconActive={props.webSearchMode === "smart"}
        title="Smart Online Mode"
        titleMedium={props.webSearchMode === "smart"}
        description="Intelligently determine whether a search is needed to answer"
        selected={props.webSearchMode === "smart"}
        onPress={() => {
          props.onWebSearchModeChange("smart");
        }}
      />
    </View>
  );

  const effortPane = (
    <View>
      {EFFORT_OPTIONS.map((option) => (
        <OptFlat
          key={option.value}
          title={option.label}
          badge={option.badge}
          selected={props.effort === option.value}
          titleAccent
          onPress={() => {
            selectEffort(option.value);
          }}
        />
      ))}
      <OptCard
        icon={<Gauge color={TEXT_STRONG} size={19} strokeWidth={2.1} />}
        title="Thinking"
        description="Can think for more complex tasks"
        trailing={
          <Toggle
            value={props.thinking}
            onChange={props.onThinkingChange}
          />
        }
      />
    </View>
  );

  const skillsPane = (
    <View>
      <OptCard
        icon={<Zap color={TEXT_STRONG} size={19} strokeWidth={2.1} />}
        iconActive={props.skillMode === "auto"}
        title="Auto"
        titleMedium={props.skillMode === "auto"}
        description="Automatically choose relevant skills for each task"
        selected={props.skillMode === "auto"}
        onPress={() => {
          props.onSkillModeChange("auto");
        }}
      />
      <OptCard
        icon={<SettingsIcon color={TEXT_STRONG} size={19} strokeWidth={2.1} />}
        iconActive={props.skillMode === "manual"}
        title="Manual selection"
        titleMedium={props.skillMode === "manual"}
        description="Pick which skills stay available to the agent"
        selected={props.skillMode === "manual"}
        onPress={() => {
          props.onSkillModeChange("manual");
        }}
      />
      <SectionLabel>Pinned skills</SectionLabel>
      {props.pinnedSkills.map((skill) => (
        <OptCard
          key={skill.id}
          icon={<Package color={TEXT_STRONG} size={19} strokeWidth={2.1} />}
          title={skill.title}
          description={skill.description ?? undefined}
          selected={skill.selected}
          dimCheck
          trailing={
            skill.selected ? (
              <SelectCheck shown dim={false} />
            ) : skill.linked ? (
              <ArrowUpRight color={TEXT_DIM} size={19} strokeWidth={2} />
            ) : (
              <Pin color={TEXT_DIM} size={19} strokeWidth={2} />
            )
          }
          onPress={() => {
            props.onToggleSkill(skill.id);
          }}
        />
      ))}
      <OptCard
        icon={<Archive color={TEXT_STRONG} size={19} strokeWidth={2.1} />}
        title="Add skills"
        description="Browse the skill directory"
        onPress={() => {
          close();
          props.onAddSkills();
        }}
      />
    </View>
  );

  const panes: Record<SheetPane, ReactNode> = {
    main: mainPane,
    attachment: attachmentPane,
    agent: agentPane,
    interaction: interactionPane,
    approval: approvalPane,
    websearch: websearchPane,
    effort: effortPane,
    skills: skillsPane,
  };

  if (!rendered) return null;

  return (
    <View
      className="absolute inset-0"
      style={{ zIndex: 60 }}
      pointerEvents="box-none"
    >
      <Animated.View
        className="absolute inset-0"
        style={[{ backgroundColor: "rgba(0,0,0,0.5)" }, backdropStyle]}
      >
        <Pressable
          accessibilityLabel="Dismiss"
          accessibilityRole="button"
          className="flex-1"
          onPress={close}
        />
      </Animated.View>
      <View className="absolute inset-x-0 bottom-0 items-stretch">
        <Animated.View
            style={[
            sheetStyle,
            {
              backgroundColor: SHEET_BG,
              borderTopLeftRadius: 26,
              borderTopRightRadius: 26,
              borderTopWidth: 1,
              borderTopColor: theme.border,
              overflow: "hidden",
            },
          ]}
        >
          <GestureDetector gesture={pan}>
            <View
              onLayout={(event) => {
                setHeaderHeight(event.nativeEvent.layout.height);
              }}
            >
              <SheetHandle />
              {pane !== "main" && PANE_TITLES[pane] ? (
                <SubHeader
                  title={PANE_TITLES[pane] as string}
                  onBack={
                    pane === "attachment" ? undefined : () => goPane("main")
                  }
                />
              ) : null}
            </View>
          </GestureDetector>
          <ScrollView
            className="flex-1"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{
              paddingBottom: SHEET_BOTTOM_PAD + insets.bottom,
            }}
          >
            <View
              onLayout={(event) => {
                setContentHeight(event.nativeEvent.layout.height);
              }}
            >
              {panes[pane]}
            </View>
          </ScrollView>
        </Animated.View>
      </View>
    </View>
  );
}
