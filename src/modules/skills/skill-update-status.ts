/**
 * Skill update statuses (Dynamic Updates prompt §§12, 24, 35–37, 43–45).
 *
 * Pure derivation from a registry entry + the installed record: revocation
 * wins, then discovery gates (channel, rollout), then runtime compatibility
 * (app floor, native capabilities), then deprecation, then install state.
 * Content-hash update detection stays where it was (`isSkillUpdateAvailable`
 * does a live fetch); this module answers everything answerable offline.
 */
import {
  channelVisible,
  checkNativeRequirements,
  compareDynamicVersions,
  rolloutAllows,
  type DynamicUpdateStatus,
  type UpdateChannel,
} from "@/modules/updates/extension-framework";
import type { SkillRegistryEntry } from "./skill-registry";

export type InstalledSkillState = {
  enabled: boolean;
  /** Publisher version recorded at install, when the entry declared one. */
  version?: string | null;
};

export type SkillUpdateStatus = {
  reason: string | null;
  status: DynamicUpdateStatus;
};

export function checkSkillEntrySupport(
  entry: Pick<
    SkillRegistryEntry,
    | "deprecated"
    | "maxAppVersion"
    | "minAppVersion"
    | "platforms"
    | "requiredCapabilities"
    | "revoked"
  >,
  options: { appVersion?: string | null; platform?: string | null } = {},
): SkillUpdateStatus {
  if (entry.revoked) {
    return { reason: "This skill was revoked by the registry.", status: "revoked" };
  }
  if (entry.platforms.length > 0 && options.platform) {
    const current = options.platform.toLowerCase();
    if (!entry.platforms.includes(current)) {
      return {
        reason: `This skill does not support ${options.platform}.`,
        status: "incompatible",
      };
    }
  }
  if (entry.minAppVersion && options.appVersion) {
    try {
      if (compareDynamicVersions(options.appVersion, entry.minAppVersion) < 0) {
        return {
          reason: `Needs Ajiro Agent ${entry.minAppVersion} or newer.`,
          status: "requires-app-update",
        };
      }
    } catch {
      // Unparseable floors fail open; the skill content itself is the check.
    }
  }
  if (entry.maxAppVersion && options.appVersion) {
    try {
      if (compareDynamicVersions(options.appVersion, entry.maxAppVersion) > 0) {
        return {
          reason: `Supports Ajiro Agent up to ${entry.maxAppVersion}; this install is newer.`,
          status: "incompatible",
        };
      }
    } catch {
      // Same fail-open reasoning as the floor above.
    }
  }
  const native = checkNativeRequirements(entry.requiredCapabilities);
  if (!native.satisfied) {
    return {
      reason: `Needs native capabilities this install lacks: ${native.missing.join(", ")}.`,
      status: "requires-app-update",
    };
  }
  if (entry.deprecated) {
    return { reason: "This skill is deprecated by its publisher.", status: "deprecated" };
  }
  return { reason: null, status: "not-installed" };
}

/** Declared dependency slugs not present among installed slugs (§12). */
export function findMissingSkillDependencies(
  entry: Pick<SkillRegistryEntry, "dependencies" | "slug">,
  installedSlugs: readonly string[],
): string[] {
  const installed = new Set(installedSlugs.map((slug) => slug.toLowerCase()));
  return entry.dependencies.filter(
    (dependency) => dependency !== entry.slug && !installed.has(dependency),
  );
}

export function deriveSkillUpdateStatus(
  entry: SkillRegistryEntry,
  installed: InstalledSkillState | null,
  options: {
    appVersion?: string | null;
    channel?: UpdateChannel;
    platform?: string | null;
    /** True when a live hash check found newer content (§12). */
    updateAvailable?: boolean;
  } = {},
): SkillUpdateStatus {
  if (!channelVisible(entry.channel, options.channel ?? "stable")) {
    return { reason: null, status: "not-installed" };
  }
  if (!rolloutAllows(entry.rolloutPercent, `skill:${entry.slug}`)) {
    return { reason: null, status: "not-installed" };
  }
  const support = checkSkillEntrySupport(entry, {
    appVersion: options.appVersion,
    platform: options.platform,
  });
  if (support.status !== "not-installed") return support;
  if (!installed) return support;
  if (!installed.enabled) return { reason: null, status: "disabled" };
  if (
    entry.version &&
    installed.version &&
    compareDynamicVersions(entry.version, installed.version) > 0
  ) {
    return { reason: `Version ${entry.version} is available.`, status: "update-available" };
  }
  if (options.updateAvailable) {
    return { reason: "Newer content is available.", status: "update-available" };
  }
  return { reason: null, status: "installed" };
}

/** Installed skills whose registry entry was revoked (§24): disable these. */
export function findRevokedInstalledSkills(
  entries: readonly Pick<SkillRegistryEntry, "revoked" | "slug">[],
  installedSlugs: readonly string[],
): string[] {
  const revoked = new Set(
    entries.filter((entry) => entry.revoked).map((entry) => entry.slug),
  );
  return installedSlugs.filter((slug) => revoked.has(slug));
}
