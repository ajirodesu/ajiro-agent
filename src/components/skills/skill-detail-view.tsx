/**
 * Shared skill detail presentation (composer modal, store detail,
 * management detail). Identity (avatar, name, full description) is always
 * preserved; actions differ per host via the `actions` slot.
 */
import { Fragment } from "react";
import { Text, View } from "react-native";

import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { SkillAvatar } from "@/components/skills/skill-avatar";
import type { SkillMcpStatus } from "@/modules/skills/skill-scopes";

export interface SkillDetailFile {
  path: string;
  size: number | null;
}

export interface SkillDetailData {
  id: string;
  title: string;
  description: string | null;
  version?: string | null;
  author?: string | null;
  sourceLabel?: string | null;
  license?: string | null;
  keywords: string[];
  autoMatch: boolean;
  enabled: boolean;
  files: SkillDetailFile[];
  instructionsPreview?: string | null;
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-start justify-between gap-sp-3 py-1">
      <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
        {label}
      </Text>
      <Text className="min-w-0 flex-1 text-right font-mono text-xs text-foreground dark:text-foreground-dark">
        {value}
      </Text>
    </View>
  );
}

export function SkillDetailView({
  actions,
  instructionsPreview,
  mcp,
  skill,
}: {
  actions?: React.ReactNode;
  instructionsPreview?: boolean;
  mcp?: SkillMcpStatus | null;
  skill: SkillDetailData;
}) {
  return (
    <View className="gap-sp-3">
      <View className="flex-row items-center gap-sp-3">
        <SkillAvatar seed={skill.id} title={skill.title} size={48} />
        <View className="min-w-0 flex-1">
          <Text
            accessibilityRole="header"
            className="font-sans text-lg font-semibold text-foreground dark:text-foreground-dark"
          >
            {skill.title}
          </Text>
          <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
            {skill.enabled ? "Enabled" : "Disabled"} ·{" "}
            {skill.autoMatch ? "Auto-match on" : "Manual only"}
          </Text>
        </View>
      </View>

      {skill.description ? (
        <Text className="font-sans text-sm leading-5 text-foreground dark:text-foreground-dark">
          {skill.description}
        </Text>
      ) : null}

      <Card className="px-sp-3 py-sp-2">
        {skill.version ? <MetaRow label="Version" value={skill.version} /> : null}
        {skill.author ? <MetaRow label="Author" value={skill.author} /> : null}
        {skill.sourceLabel ? <MetaRow label="Source" value={skill.sourceLabel} /> : null}
        {skill.license ? <MetaRow label="License" value={skill.license} /> : null}
        <MetaRow label="Resources" value={String(skill.files.length)} />
        {skill.keywords.length > 0 ? (
          <MetaRow label="Keywords" value={skill.keywords.slice(0, 8).join(", ")} />
        ) : null}
      </Card>

      {skill.files.length > 0 ? (
        <Card className="px-sp-3 py-sp-2">
          <Text className="font-sans text-xs font-semibold text-foreground dark:text-foreground-dark">
            Resources
          </Text>
          {skill.files.slice(0, 12).map((file, index) => (
            <Fragment key={file.path}>
              {index > 0 ? <Separator /> : null}
              <View className="flex-row items-center justify-between gap-sp-2 py-1">
                <Text
                  className="min-w-0 flex-1 font-mono text-xs text-foreground dark:text-foreground-dark"
                  numberOfLines={1}
                >
                  {file.path}
                </Text>
                {typeof file.size === "number" ? (
                  <Text className="font-mono text-xs text-muted-foreground dark:text-muted-foreground-dark">
                    {(file.size / 1024).toFixed(1)} KB
                  </Text>
                ) : null}
              </View>
            </Fragment>
          ))}
          {skill.files.length > 12 ? (
            <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
              +{skill.files.length - 12} more
            </Text>
          ) : null}
        </Card>
      ) : null}

      {mcp ? (
        <Card className="px-sp-3 py-sp-2">
          <Text className="font-sans text-xs font-semibold text-foreground dark:text-foreground-dark">
            MCP dependencies
          </Text>
          {mcp.available.length === 0 &&
          mcp.disabled.length === 0 &&
          mcp.missing.length === 0 ? (
            <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
              No MCP servers required.
            </Text>
          ) : null}
          {mcp.available.map((server) => (
            <Text
              key={`ok-${server.id}`}
              className="font-sans text-xs text-foreground dark:text-foreground-dark"
            >
              ● {server.label} — available
            </Text>
          ))}
          {mcp.disabled.map((server) => (
            <Text
              key={`off-${server.id}`}
              className="font-sans text-xs text-foreground dark:text-foreground-dark"
            >
              ○ {server.label} — disabled (enable it for full skill behavior)
            </Text>
          ))}
          {mcp.missing.map((id) => (
            <Text
              key={`missing-${id}`}
              className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark"
            >
              ○ {id} — not configured
            </Text>
          ))}
        </Card>
      ) : null}

      {instructionsPreview && skill.instructionsPreview ? (
        <Card className="px-sp-3 py-sp-2">
          <Text className="font-sans text-xs font-semibold text-foreground dark:text-foreground-dark">
            Instructions
          </Text>
          <Text className="font-mono text-xs leading-5 text-foreground dark:text-foreground-dark">
            {skill.instructionsPreview.slice(0, 1200)}
          </Text>
        </Card>
      ) : null}

      {actions ? <View className="flex-row flex-wrap gap-sp-2">{actions}</View> : null}
    </View>
  );
}
