/**
 * Publisher signatures (prompt §51).
 *
 * Acode publishes no signatures at all, so there is nothing to verify against
 * in its ecosystem — which is why [AJIRO ORIGINAL] this module defines its own
 * optional manifest field and its own policy, rather than pretending to
 * reproduce an Acode behaviour that does not exist:
 *
 *     "signature": {
 *       "algorithm": "ed25519",
 *       "keyId": "ajiros.publisher",
 *       "value": "<base64 Ed25519 signature over the signing payload>"
 *     }
 *
 * The signature cannot cover the ZIP bytes, because the signature lives
 * *inside* that ZIP — sign a container that holds its own signature and no
 * signature can ever verify. So the signed payload is a canonical description
 * of the package's contents (`buildSigningPayload`): the plugin id and
 * version, every file's path, length, and exact text, and the manifest with
 * the signature field removed. It is byte-exact, independent of ZIP metadata,
 * and reproducible by a publisher with a text editor.
 *
 * The rule the module enforces is deliberately simple:
 *
 * - a package with no signature is `unsigned`, which is what almost every
 *   Acode plugin is, and stays installable unless the user turns on
 *   "require signed packages";
 * - a signature from a key the user has trusted is verified against the exact
 *   bytes that were downloaded — so a signature cannot be moved to a different
 *   package, and the ZIP that lands on disk is the ZIP that was signed;
 * - an untrusted key, a bad signature, an unknown algorithm, or a malformed
 *   block is reported, never silently accepted.
 *
 * Verification is real cryptography (Ed25519 via `@noble/curves`, which is
 * pure JS so it also runs under Hermes). Nothing here hand-rolls a curve.
 */
import { ed25519 } from "@noble/curves/ed25519.js";

export type SignatureAlgorithm = "ed25519";

export type PackageSignature = {
  algorithm: SignatureAlgorithm;
  /** Which trusted key should verify this package. */
  keyId: string;
  /** Base64 Ed25519 signature over the package bytes. */
  value: string;
};

export type SignatureStatus =
  | "unsigned"
  | "verified"
  | "untrusted-key"
  | "invalid"
  | "unsupported-algorithm"
  | "malformed";

export type SignatureVerdict = {
  detail: string;
  keyId: string | null;
  status: SignatureStatus;
};

/**
 * What the device is willing to accept (§51). The keys are the user's own
 * trust decisions, so a package signed by anyone else is `untrusted-key`
 * rather than "verified".
 */
export type SignaturePolicy = {
  requireSigned: boolean;
  trustedKeys: Record<string, string>;
};

/** The policy in force before the user has expressed one. */
export const DEFAULT_SIGNATURE_POLICY: SignaturePolicy = {
  requireSigned: false,
  trustedKeys: {},
};

/**
 * How a package can break a signature check, as a user-facing sentence.
 * Kept next to the verdicts so the UI never invents its own wording for a
 * cryptographic outcome.
 */
export function signaturePolicyMessage(verdict: SignatureVerdict): string {
  switch (verdict.status) {
    case "verified":
      return "The publisher signature is verified.";
    case "unsigned":
      return "This package is unsigned, and Ajiro is set to require signed packages.";
    case "untrusted-key":
      return `${verdict.detail} Add the signing key under extension preferences to trust it.`;
    default:
      return verdict.detail;
  }
}

/** Base64 → bytes, tolerating URL-safe alphabets and missing padding. */
export function decodeBase64(value: string): Uint8Array | null {
  const normalized = value.trim().replace(/-/g, "+").replace(/_/g, "/");
  if (normalized === "") return null;
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(padded)) return null;
  try {
    const binary =
      typeof atob === "function"
        ? atob(padded)
        : Buffer.from(padded, "base64").toString("binary");
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

export function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  if (typeof btoa === "function") return btoa(binary);
  return Buffer.from(binary, "binary").toString("base64");
}

/**
 * Parse the manifest's `signature` block. Anything unrecognizable becomes a
 * verdict rather than an exception: a bad signature block must not break
 * installation, it must be *reported*.
 */
export function parsePackageSignature(
  raw: unknown,
): { signature: PackageSignature } | { verdict: SignatureVerdict } | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return {
      verdict: {
        detail: "The signature field is not an object.",
        keyId: null,
        status: "malformed",
      },
    };
  }
  const block = raw as Record<string, unknown>;
  const keyId = typeof block.keyId === "string" ? block.keyId.trim() : "";
  const value = typeof block.value === "string" ? block.value.trim() : "";
  const algorithm = typeof block.algorithm === "string" ? block.algorithm : "";
  if (!keyId || !value) {
    return {
      verdict: {
        detail: "The signature block is missing a key id or a value.",
        keyId: keyId || null,
        status: "malformed",
      },
    };
  }
  if (algorithm && algorithm !== "ed25519") {
    return {
      verdict: {
        detail: `Signature algorithm "${algorithm}" is not supported.`,
        keyId,
        status: "unsupported-algorithm",
      },
    };
  }
  return { signature: { algorithm: "ed25519", keyId, value } };
}

/**
 * Version prefix of the signing payload, so the format can evolve. `v2`
 * because every file now contributes an explicit `text:`/`bytes:` marker:
 * a binary asset is covered by its exact bytes, not by a lossy text decode.
 */
export const SIGNING_PAYLOAD_VERSION = "ajiros-plugin-v2";

/** A package file, as either its text or its exact bytes. */
export type SigningPayloadFile = string | Uint8Array;

/**
 * The exact text a publisher signs for a package (§51).
 *
 * Deliberately free of hashing and formatting subtleties: each file
 * contributes `path`, a `text:`/`bytes:` marker with its length, then its
 * exact content (base64 for bytes), so no two different package trees can
 * produce the same payload and no binary asset is reduced to a lossy text
 * decode. The manifest is contributed once, with the `signature` field
 * removed — a signature cannot cover itself.
 */
export function buildSigningPayload(input: {
  files: Map<string, SigningPayloadFile>;
  manifest: { id: string; raw: Record<string, unknown>; version: string };
}): string {
  const normalizedManifest: Record<string, unknown> = { ...input.manifest.raw };
  delete normalizedManifest.signature;
  const lines: string[] = [
    SIGNING_PAYLOAD_VERSION,
    `${input.manifest.id}@${input.manifest.version}`,
  ];
  for (const path of [...input.files.keys()].sort()) {
    if (path === "plugin.json") continue;
    const content: SigningPayloadFile = input.files.get(path) ?? "";
    if (typeof content === "string") {
      lines.push(path, `text:${content.length}`, content);
    } else {
      lines.push(path, `bytes:${content.length}`, encodeBase64(content));
    }
  }
  lines.push("plugin.json", JSON.stringify(normalizedManifest));
  return lines.join("\n");
}

/** The verdict for a package that declares no signature at all. */
export const UNSIGNED_VERDICT: SignatureVerdict = {
  detail: "The package is not signed. Acode itself publishes no signatures.",
  keyId: null,
  status: "unsigned",
};

/**
 * Verify `bytes` against a signature block and a trust store. Pure: the caller
 * supplies the bytes and the trusted keys, so this is testable without a
 * device or a network.
 */
export function verifyPackageSignature(input: {
  /** Exact signing payload the signature must cover. */
  payload: string;
  signature: PackageSignature;
  /** keyId → base64 public key, as configured by the user. */
  trustedKeys: Record<string, string>;
}): SignatureVerdict {
  const { payload, signature, trustedKeys } = input;
  const publicKeyValue = trustedKeys[signature.keyId];
  if (!publicKeyValue) {
    return {
      detail: `Signed by unknown key "${signature.keyId}", which this device does not trust.`,
      keyId: signature.keyId,
      status: "untrusted-key",
    };
  }
  const publicKey = decodeBase64(publicKeyValue);
  const signatureBytes = decodeBase64(signature.value);
  if (!publicKey || publicKey.length !== 32) {
    return {
      detail: `The trusted key "${signature.keyId}" is not a 32-byte Ed25519 public key.`,
      keyId: signature.keyId,
      status: "malformed",
    };
  }
  if (!signatureBytes || signatureBytes.length !== 64) {
    return {
      detail: "The package signature is not base64-encoded Ed25519 data.",
      keyId: signature.keyId,
      status: "malformed",
    };
  }
  let valid = false;
  try {
    valid = ed25519.verify(
      signatureBytes,
      new TextEncoder().encode(payload),
      publicKey,
    );
  } catch {
    valid = false;
  }
  if (!valid) {
    return {
      detail: `The signature does not match this package's contents (key "${signature.keyId}").`,
      keyId: signature.keyId,
      status: "invalid",
    };
  }
  return {
    detail: `Signed by trusted key "${signature.keyId}", and the signature matches this package's contents.`,
    keyId: signature.keyId,
    status: "verified",
  };
}

/** Convenience: parse then verify, collapsing every path to one verdict. */
export function evaluatePackageSignature(input: {
  payload: string;
  raw: unknown;
  trustedKeys: Record<string, string>;
}): SignatureVerdict {
  const parsed = parsePackageSignature(input.raw);
  if (!parsed) return UNSIGNED_VERDICT;
  if ("verdict" in parsed) return parsed.verdict;
  return verifyPackageSignature({
    payload: input.payload,
    signature: parsed.signature,
    trustedKeys: input.trustedKeys,
  });
}

export function signatureLabel(status: SignatureStatus): string {
  switch (status) {
    case "verified":
      return "Verified signature";
    case "untrusted-key":
      return "Untrusted signing key";
    case "invalid":
      return "Invalid signature";
    case "unsupported-algorithm":
      return "Unsupported signature algorithm";
    case "malformed":
      return "Malformed signature";
    default:
      return "Unsigned";
  }
}

/**
 * Should this verdict block installation? Only the user's own policy can make
 * an unsigned or unverified package unacceptable — Ajiro never pretends an
 * unsigned package is verified, and never refuses one on its own.
 */
export function signatureBlocksInstall(
  verdict: SignatureVerdict,
  requireSigned: boolean,
): boolean {
  if (!requireSigned) return false;
  return verdict.status !== "verified";
}
