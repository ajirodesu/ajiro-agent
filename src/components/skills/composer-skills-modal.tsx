/**
 * Composer Skills Modal host: binds the presentational `SkillsModal` to
 * real runtime state (config skills, project scan, install, enable).
 *
 * - Installed skills come from `useConfig` (SQLite-backed, live).
 * - Project skills are scanned from the active SAF project on open
 *   (read-only; install copies SKILL.md + readable resources into storage
 *   and auto-selects the new skill for this chat).
 * - MCP attention badges derive from configured server availability.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "expo-router";

import { useConfig } from "@/hooks/use-config";
import { useIdeWorkspace } from "@/providers/ide-workspace";
import { createExternalFolderService } from "@/core/services/external-folder/external-folder-service";
import { parseSkillMarkdown } from "@/modules/skills/skill-markdown";
import {
  resolveProjectSkills,
  type ProjectSkill,
} from "@/modules/skills/project-skills";
import { resolveSkillMcpStatus } from "@/modules/skills/skill-scopes";
import { SkillsModal } from "@/components/skills/skills-modal";

export function ComposerSkillsModal({
  onImportSkill,
  onManageSkills,
  onOpenChange,
  onToggleSkill,
  open,
  selectedSkillIds,
}: {
  onImportSkill: () => void;
  onManageSkills: () => void;
  onOpenChange: (open: boolean) => void;
  onToggleSkill: (id: string) => void;
  open: boolean;
  selectedSkillIds: string[];
}) {
  const router = useRouter();
  const { importSkillMarkdown, mcpServers, skills, updateSkill } = useConfig();
  const ide = useIdeWorkspace();
  const [projectSkills, setProjectSkills] = useState<ProjectSkill[]>([]);
  const [installingDir, setInstallingDir] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const scanSeq = useRef(0);

  useEffect(() => {
    if (!open) {
      setProjectSkills([]);
      setNotice(null);
      return;
    }
    const session = ide.activeSession;
    if (!session) {
      setProjectSkills([]);
      return;
    }
    const seq = (scanSeq.current += 1);
    const service = createExternalFolderService();
    resolveProjectSkills(
      {
        listDir: async (path) =>
          service.listEntries(session, path).map((entry) => ({
            kind: entry.kind === "directory" ? ("dir" as const) : ("file" as const),
            name: entry.name,
          })),
        readFile: async (path, maxBytes) =>
          service.readTextFile(session, path, maxBytes),
      },
      { maxSkills: 20 },
    )
      .then((result) => {
        if (scanSeq.current === seq) setProjectSkills(result.skills);
      })
      .catch(() => {
        if (scanSeq.current === seq) setProjectSkills([]);
      });
  }, [open, ide.activeSession]);

  const handleToggleEnabled = useCallback(
    (id: string) => {
      const skill = skills.find((entry) => entry.id === id);
      if (!skill) return;
      updateSkill(id, { enabled: !skill.enabled }).catch((error: unknown) => {
        setNotice(error instanceof Error ? error.message : "Could not update the skill.");
      });
    },
    [skills, updateSkill],
  );

  const handleInstallProjectSkill = useCallback(
    (dir: string) => {
      const session = ide.activeSession;
      if (!session) {
        setNotice("Open a project folder first to install its skills.");
        return;
      }
      setInstallingDir(dir);
      setNotice(null);
      const service = createExternalFolderService();
      (async () => {
        const raw = await service.readTextFile(session, `${dir}/SKILL.md`, 100_000);
        const parsed = parseSkillMarkdown(raw);
        const localFiles: {
          path: string;
          content: string;
          mimeType: string | null;
          size: number | null;
        }[] = [];
        for (const path of parsed.files.slice(0, 20)) {
          try {
            const content = await service.readTextFile(session, `${dir}/${path}`, 200_000);
            localFiles.push({ content, mimeType: null, path, size: content.length });
          } catch {
            // Unreadable resources are skipped; the skill still installs.
          }
        }
        const created = await importSkillMarkdown({ markdown: raw, localFiles });
        onToggleSkill(created.id);
        // Refresh the scan so the installed project skill disappears from
        // the project section (it now lives in the main list).
        const outcome = await resolveProjectSkills(
          {
            listDir: async (path) =>
              service.listEntries(session, path).map((entry) => ({
                kind: entry.kind === "directory" ? ("dir" as const) : ("file" as const),
                name: entry.name,
              })),
            readFile: async (path, maxBytes) =>
              service.readTextFile(session, path, maxBytes),
          },
          { maxSkills: 20 },
        );
        setProjectSkills(outcome.skills);
      })().catch((error: unknown) => {
        setNotice(
          error instanceof Error ? error.message : "Could not install the project skill.",
        );
      }).finally(() => {
        setInstallingDir(null);
      });
    },
    [ide.activeSession, importSkillMarkdown, onToggleSkill],
  );

  return (
    <SkillsModal
      installingDir={installingDir}
      notice={notice}
      onImportSkill={onImportSkill}
      onInstallProjectSkill={handleInstallProjectSkill}
      onManageSkills={onManageSkills}
      onOpenChange={onOpenChange}
      onOpenStore={() => {
        onOpenChange(false);
        router.push("/settings/skill-store");
      }}
      onToggleEnabled={handleToggleEnabled}
      onToggleSkill={onToggleSkill}
      open={open}
      projectSkills={projectSkills}
      skills={skills.map((skill) => ({
        autoMatch: skill.autoMatch,
        description: skill.description,
        enabled: skill.enabled,
        fileCount: skill.skillFiles.length,
        id: skill.id,
        keywords: skill.matchKeywords,
        mcpAttention:
          skill.recommendedMcpServerIds.length > 0 &&
          !resolveSkillMcpStatus(skill, mcpServers).satisfied,
        selected: selectedSkillIds.includes(skill.id),
        title: skill.title,
      }))}
    />
  );
}
