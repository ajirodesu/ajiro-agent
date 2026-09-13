/**
 * Linux userspace provisioning flow (§§30, 51): manifest fetch, package
 * download with progress, sha256 verification, and persisted status.
 * Platform file/network access is injected so this module stays pure and
 * unit-testable; the settings UI supplies expo-file-system on device.
 *
 * Source provenance: [AJIRO ORIGINAL].
 */
export type ProvisionManifest = {
  version: string;
  userspace: {
    url: string;
    sha256: string;
    sizeBytes: number;
  };
};

export type ProvisionDownloadDeps = {
  computeSha256: (path: string) => Promise<string>;
  downloadFile: (
    url: string,
    destination: string,
    onProgress?: (written: number, total: number) => void,
  ) => Promise<void>;
  fetchText: (url: string) => Promise<string>;
};

export type ProvisionState =
  | { state: "absent" }
  | { state: "downloading"; written: number; total: number }
  | { state: "verifying" }
  | { state: "ready"; path: string; version: string }
  | { state: "failed"; error: string };

export function parseProvisionManifest(raw: string): ProvisionManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Provision manifest is not valid JSON.");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Provision manifest must be an object.");
  }
  const record = parsed as Record<string, unknown>;
  const userspace = record.userspace as Record<string, unknown> | undefined;
  const version = record.version;
  if (typeof version !== "string" || !version.trim()) {
    throw new Error("Provision manifest needs a version.");
  }
  if (
    !userspace ||
    typeof userspace.url !== "string" ||
    !userspace.url.startsWith("https://") ||
    typeof userspace.sha256 !== "string" ||
    !/^[0-9a-f]{64}$/i.test(userspace.sha256) ||
    typeof userspace.sizeBytes !== "number" ||
    userspace.sizeBytes <= 0
  ) {
    throw new Error(
      "Provision manifest needs userspace { url (https), sha256, sizeBytes }.",
    );
  }
  return {
    version: version.trim(),
    userspace: {
      url: userspace.url,
      sha256: userspace.sha256.toLowerCase(),
      sizeBytes: userspace.sizeBytes,
    },
  };
}

/**
 * Download + verify a userspace package. Emits state transitions through
 * onState. Returns the verified local path; throws with cleanup left to the
 * caller (partial file at destination).
 */
export async function downloadAndVerifyUserspace(
  manifestUrl: string,
  destination: string,
  deps: ProvisionDownloadDeps,
  onState?: (state: ProvisionState) => void,
): Promise<string> {
  let manifest: ProvisionManifest;
  try {
    manifest = parseProvisionManifest(await deps.fetchText(manifestUrl));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    onState?.({ state: "failed", error: `Manifest error: ${message}` });
    throw new Error(`Manifest error: ${message}`);
  }

  await deps.downloadFile(
    manifest.userspace.url,
    destination,
    (written, total) => {
      onState?.({ state: "downloading", written, total });
    },
  );

  onState?.({ state: "verifying" });
  const digest = (await deps.computeSha256(destination)).toLowerCase();
  if (digest !== manifest.userspace.sha256) {
    const error =
      "Checksum mismatch: the downloaded userspace failed verification and was rejected.";
    onState?.({ state: "failed", error });
    throw new Error(error);
  }

  onState?.({ state: "ready", path: destination, version: manifest.version });
  return destination;
}
