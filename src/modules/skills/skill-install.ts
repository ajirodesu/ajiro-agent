/**
 * Skill install / update / uninstall orchestration (pure logic over the
 * `SkillRepository` interface, unit-tested with an in-memory fake).
 *
 * State machine per skill: not-installed → installing → installed →
 * updating → installed, with uninstall removing all rows. Rollback rules
 * (§26: never leave partial state, failures recoverable):
 * - Fetch/parse/validate happens BEFORE any write — network or content
 *   failures leave storage untouched.
 * - `create` failures after the skill row exists roll back by deleting the
 *   row (best-effort; the error still surfaces).
 * - `update` writes only after the new content validates; a failed update
 *   keeps the old installed copy intact.
 * - `uninstall` verifies the skill is gone afterwards.
 */
import type { SkillRepository } from "@/core/db/repositories/types";
import type { SkillConfig } from "@/core/types/app-state";
import { fetchSkillFiles } from "@/modules/skills/skill-files";
import { fetchSkillMarkdownFromUrl } from "@/modules/skills/skill-github";
import {
  normalizeSkillSlug,
  parseSkillMarkdown,
  slugifySkillName,
} from "@/modules/skills/skill-markdown";
import { getSkillMetadataError } from "@/modules/skills/skill-validation";
import { hashContent, type StoreSkillEntry } from "@/modules/skills/skill-store-catalog";
import {
  checkNativeRequirements,
  compareDynamicVersions,
  evaluateExtensionTrust,
  type ExtensionTrustState,
} from "@/modules/updates/extension-framework";
import {
  verifyContentSignature,
  type ContentSignature,
  type PublisherTrustStore,
} from "@/modules/updates/publisher-trust";
import type { SkillRollbackStore } from "@/modules/skills/skill-rollback";

export type SkillInstallProgress =
  | { phase: "fetching" }
  | { phase: "parsing" }
  | { phase: "saving" }
  | { phase: "done"; skill: SkillConfig }
  | { phase: "error"; message: string };

export interface SkillInstallDeps {
  repository: SkillRepository;
  onProgress?: (progress: SkillInstallProgress) => void;
}

export interface InstallResult {
  skill: SkillConfig;
  replaced: boolean;
  /** True when the installed copy was already current (no write happened). */
  unchanged: boolean;
  fileCount: number;
  /** Trust verdict for the installed content (§23). */
  trust: ExtensionTrustState;
}

/**
 * Dynamic-update guards for a store install (§§21–24, 36). All optional so
 * plain URL imports keep working exactly as before.
 */
export interface SkillInstallGuards {
  /** Registry-fed revocation set: installing a revoked skill refuses loudly. */
  revokedSlugs?: Set<string>;
  /** Expected content hash (§21): a mismatch fails closed before parsing. */
  expectedHash?: string | null;
  /**
   * Publisher signature (§22): verified against `trustStore` over the exact
   * trimmed markdown bytes. Absent without `requireSigned` stays "unknown";
   * an INVALID signature always fails closed, even permissively.
   */
  signaturePresent?: boolean;
  signature?: ContentSignature | null;
  trustStore?: PublisherTrustStore;
  /** Refuse installs without a verified publisher signature. */
  requireSigned?: boolean;
  /** Native capabilities the skill declares (§36): missing ones refuse with Requires App Update. */
  requiredCapabilities?: string[];
  /** Runtime floor/ceiling + platforms from the registry entry (§§12, 35). */
  appVersion?: string | null;
  platform?: string | null;
  minAppVersion?: string | null;
  maxAppVersion?: string | null;
  platforms?: string[];
  /** Pre-update snapshot store (§25): snapshots the replaced copy for rollback. */
  rollback?: SkillRollbackStore;
}

function slugOf(skill: Pick<SkillConfig, "title">): string {
  return normalizeSkillSlug(skill.title);
}

export async function findInstalledBySlug(
  repository: SkillRepository,
  slug: string,
): Promise<SkillConfig | null> {
  const normalized = slugifySkillName(slug);
  if (!normalized) return null;
  const skills = await repository.list();
  return (
    skills.find((skill) => slugOf(skill) === normalized) ??
    skills.find(
      (skill) => skill.title.trim().toLowerCase() === normalized,
    ) ??
    null
  );
}

/**
 * Install a store entry (or plain URL) from its live SKILL.md. Replaces an
 * installed skill with the same slug (update path shares this function).
 * When the installed copy is byte-identical, reports `unchanged` without
 * writing (preserves timestamps, avoids churn).
 */
export async function installSkillFromEntry(
  deps: SkillInstallDeps,
  entry: Pick<StoreSkillEntry, "slug" | "sourceUrl"> & { author?: string | null },
  guards: SkillInstallGuards = {},
): Promise<InstallResult> {
  const emit = deps.onProgress ?? ((): void => {});
  if (guards.revokedSlugs?.has(normalizeSkillSlug(entry.slug))) {
    const message = `Skill "${entry.slug}" was revoked by the registry and cannot be installed.`;
    emit({ phase: "error", message });
    throw new Error(message);
  }
  if (guards.requiredCapabilities?.length) {
    const native = checkNativeRequirements(guards.requiredCapabilities);
    if (!native.satisfied) {
      const message =
        `Skill "${entry.slug}" requires an Ajiro Agent update ` +
        `(missing native capabilities: ${native.missing.join(", ")}).`;
      emit({ phase: "error", message });
      throw new Error(message);
    }
  }
  if (guards.platforms?.length && guards.platform) {
    const current = guards.platform.toLowerCase();
    if (!guards.platforms.includes(current)) {
      const message = `Skill "${entry.slug}" does not support ${guards.platform}.`;
      emit({ phase: "error", message });
      throw new Error(message);
    }
  }
  // Version comparisons run OUTSIDE the try: the catch is only for
  // unparseable version strings, and must never swallow the refusal below.
  if (guards.minAppVersion && guards.appVersion) {
    let belowFloor = false;
    try {
      belowFloor = compareDynamicVersions(guards.appVersion, guards.minAppVersion) < 0;
    } catch {
      // Unparseable floors fail open; content validation still applies.
    }
    if (belowFloor) {
      const message =
        `Skill "${entry.slug}" needs Ajiro Agent ${guards.minAppVersion} or newer.`;
      emit({ phase: "error", message });
      throw new Error(message);
    }
  }
  if (guards.maxAppVersion && guards.appVersion) {
    let aboveCeiling = false;
    try {
      aboveCeiling =
        compareDynamicVersions(guards.appVersion, guards.maxAppVersion) > 0;
    } catch {
      // Same fail-open reasoning as the floor above.
    }
    if (aboveCeiling) {
      const message =
        `Skill "${entry.slug}" supports Ajiro Agent up to ${guards.maxAppVersion}.`;
      emit({ phase: "error", message });
      throw new Error(message);
    }
  }
  emit({ phase: "fetching" });
  const { content } = await fetchSkillMarkdownFromUrl(entry.sourceUrl);
  if (guards.expectedHash && hashContent(content.trim()) !== guards.expectedHash) {
    const message = `Skill "${entry.slug}" failed integrity validation (hash mismatch).`;
    emit({ phase: "error", message });
    throw new Error(message);
  }
  // Publisher signature verification (§22): byte-exact over the trimmed
  // markdown, the same bytes the publisher signed. An invalid signature is
  // tamper evidence and fails closed unconditionally; an unknown key or a
  // missing signature only refuses under requireSigned.
  let signatureStatus: "invalid" | "unknown" | "verified" = "unknown";
  if (guards.signature && guards.trustStore) {
    const verdict = verifyContentSignature({
      content: content.trim(),
      signature: guards.signature,
      trustedKeys: guards.trustStore.keys(),
    });
    if (verdict.status === "verified") {
      signatureStatus = "verified";
    } else if (
      verdict.status === "invalid" ||
      verdict.status === "malformed" ||
      verdict.status === "unsupported-algorithm"
    ) {
      const message = `Skill "${entry.slug}" failed signature validation (${verdict.detail}).`;
      emit({ phase: "error", message });
      throw new Error(message);
    }
  }
  if (guards.requireSigned && signatureStatus !== "verified") {
    const message = `Skill "${entry.slug}" requires a verified publisher signature.`;
    emit({ phase: "error", message });
    throw new Error(message);
  }
  const trust = evaluateExtensionTrust({
    expectedHashPresent: guards.expectedHash != null,
    hashMatches:
      guards.expectedHash != null
        ? hashContent(content.trim()) === guards.expectedHash
        : undefined,
    signatureValid: signatureStatus === "verified" ? true : undefined,
  });
  emit({ phase: "parsing" });

  let parsed: ReturnType<typeof parseSkillMarkdown>;
  try {
    parsed = parseSkillMarkdown(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emit({ phase: "error", message });
    throw new Error(`Skill content invalid: ${message}`);
  }
  const metadataError = getSkillMetadataError(
    /^---[ \t]*\r?\n([\s\S]*?)\r?\n---/.exec(
      content.replace(/^\uFEFF/, "").trimStart(),
    )?.[1],
    { expectedName: entry.slug },
  );
  if (metadataError) {
    const message = `Skill metadata invalid (${metadataError.type}).`;
    emit({ phase: "error", message });
    throw new Error(message);
  }
  const relatedFiles = await fetchSkillFiles({
    sourceUrl: entry.sourceUrl,
    referencedPaths: parsed.files,
  });

  emit({ phase: "saving" });
  const existing = await findInstalledBySlug(deps.repository, entry.slug);
  if (
    existing?.sourceMarkdown &&
    hashContent(existing.sourceMarkdown.trim()) === hashContent(content.trim())
  ) {
    emit({ phase: "done", skill: existing });
    return {
      fileCount: relatedFiles.length,
      replaced: true,
      skill: existing,
      trust,
      unchanged: true,
    };
  }
  // Snapshot the replaced copy before writing (§25): a later rollback
  // restores exactly this content.
  if (existing) {
    await guards.rollback?.snapshot(deps.repository, entry.slug).catch(() => {});
  }
  const input = {
    author: entry.author ?? null,
    autoMatch: parsed.autoMatch,
    description: parsed.description,
    instructions: parsed.instructions,
    matchKeywords: parsed.matchKeywords,
    recommendedBuiltInToolKeys: parsed.recommendedBuiltInToolKeys,
    recommendedMcpServerIds: parsed.recommendedMcpServerIds,
    skillFiles: relatedFiles.map((file) => ({
      path: file.path,
      content: file.content,
      mimeType: file.mimeType,
      size: file.size,
    })),
    sourceMarkdown: content,
    sourceUrl: entry.sourceUrl,
    title: parsed.title || entry.slug,
  };

  let skill: SkillConfig | null = null;
  try {
    if (existing) {
      await deps.repository.update(existing.id, input);
      skill = await deps.repository.getById(existing.id);
    } else {
      skill = await deps.repository.create(input);
    }
  } catch (error) {
    // Roll back a half-created row; updates never wrote (they throw first).
    if (!existing && skill) {
      await deps.repository.delete(skill.id).catch(() => {});
    }
    const message = error instanceof Error ? error.message : String(error);
    emit({ phase: "error", message });
    throw error instanceof Error ? error : new Error(message);
  }
  if (!skill) {
    const message = "Install succeeded but the skill could not be read back.";
    emit({ phase: "error", message });
    throw new Error(message);
  }
  emit({ phase: "done", skill });
  return {
    fileCount: relatedFiles.length,
    replaced: Boolean(existing),
    skill,
    trust,
    unchanged: false,
  };
}

/** Update check: true when live content hash differs from installed. */
export async function isSkillUpdateAvailable(
  installed: SkillConfig,
  sourceUrl?: string | null,
): Promise<boolean> {
  const url = sourceUrl ?? installed.sourceUrl;
  if (!url) return false;
  if (!installed.sourceMarkdown) return true;
  const { content } = await fetchSkillMarkdownFromUrl(url);
  return hashContent(content.trim()) !== hashContent(installed.sourceMarkdown.trim());
}

/** Uninstall by id; verifies removal (fails closed on persistence errors). */
export async function uninstallSkill(
  repository: SkillRepository,
  skillId: string,
): Promise<void> {
  await repository.delete(skillId);
  const remaining = await repository.getById(skillId);
  if (remaining) {
    throw new Error("Uninstall failed: the skill is still installed.");
  }
}
