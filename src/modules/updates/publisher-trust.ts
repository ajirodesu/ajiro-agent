/**
 * Publisher trust for dynamic extensions (Dynamic Updates prompt §22).
 *
 * The extension platform verifies Acode plugin signatures against the
 * user's keyring; skills and MCP catalogs had presence-recorded signatures
 * with nothing to check them against. This module closes that: a
 * keyId → Ed25519-public-key trust store plus content verification shared
 * by skills (signed SKILL.md bytes) and the MCP catalog (signed canonical
 * JSON). Pure TypeScript over `@noble/curves` (already a dependency via the
 * extension platform), so it unit-tests on node.
 *
 * Verification policy, everywhere it is used:
 * - no signature → "unknown", proceed (the ecosystem default);
 * - valid signature from a trusted key → "verified";
 * - INVALID signature → fail closed, always, even without requireSigned
 *   (a bad signature is tamper evidence, not an opinion);
 * - signed by an unknown key → "unknown", proceed unless the caller passes
 *   requireSigned (matches the extension platform's "record, refuse nothing"
 *   default for an ecosystem that mostly ships unsigned).
 */
import { ed25519 } from "@noble/curves/ed25519.js";

import {
  decodeBase64,
  encodeBase64,
  verifyPackageSignature,
  type SignatureVerdict,
} from "@/modules/extensions/signature";

export type PublisherTrustStore = {
  addKey(keyId: string, publicKeyBase64: string): void;
  removeKey(keyId: string): void;
  hasKey(keyId: string): boolean;
  keyIds(): string[];
  /** keyId → base64 public key, for verifiers that take a record. */
  keys(): Record<string, string>;
  /** Serialize for persistence (the app owns where this is stored). */
  serialize(): string;
};

export function createPublisherTrustStore(
  initial: Record<string, string> = {},
): PublisherTrustStore {
  const keys = new Map<string, string>();
  const normalize = (keyId: string, value: string): [string, string] | null => {
    const id = keyId.trim();
    const key = value.trim();
    if (!id || !key) return null;
    const bytes = decodeBase64(key);
    if (!bytes || bytes.length !== 32) return null;
    return [id, key];
  };
  for (const [keyId, value] of Object.entries(initial)) {
    const normalized = normalize(keyId, value);
    if (normalized) keys.set(normalized[0], normalized[1]);
  }
  return {
    addKey(keyId, publicKeyBase64) {
      const normalized = normalize(keyId, publicKeyBase64);
      if (!normalized) {
        throw new Error("Publisher keys must be non-empty ids with 32-byte Ed25519 public keys.");
      }
      keys.set(normalized[0], normalized[1]);
    },
    removeKey(keyId) {
      keys.delete(keyId.trim());
    },
    hasKey(keyId) {
      return keys.has(keyId.trim());
    },
    keyIds() {
      return [...keys.keys()].sort();
    },
    keys() {
      return Object.fromEntries(keys);
    },
    serialize() {
      return JSON.stringify(Object.fromEntries(keys));
    },
  };
}

export function parsePublisherTrustStore(raw: string | null): PublisherTrustStore {
  if (!raw) return createPublisherTrustStore();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return createPublisherTrustStore(parsed as Record<string, string>);
    }
  } catch {
    // Corrupt trust files fail closed to empty, never to partial trust.
  }
  return createPublisherTrustStore();
}

export type ContentSignature = {
  algorithm?: string;
  keyId: string;
  value: string;
};

/**
 * Verify exact `content` bytes against a publisher signature. `content`
 * must already be canonicalized by the caller (skills pass the trimmed
 * markdown, the MCP catalog passes canonical JSON) — verification is
 * byte-exact by design.
 */
export function verifyContentSignature(input: {
  content: string;
  signature: ContentSignature | null | undefined;
  trustedKeys: Record<string, string>;
}): SignatureVerdict {
  if (!input.signature) {
    return {
      detail: "No signature was published for this content.",
      keyId: null,
      status: "unsigned",
    };
  }
  if (input.signature.algorithm && input.signature.algorithm !== "ed25519") {
    return {
      detail: `Signature algorithm "${input.signature.algorithm}" is not supported.`,
      keyId: input.signature.keyId || null,
      status: "unsupported-algorithm",
    };
  }
  return verifyPackageSignature({
    payload: input.content,
    signature: {
      algorithm: "ed25519",
      keyId: input.signature.keyId,
      value: input.signature.value,
    },
    trustedKeys: input.trustedKeys,
  });
}

/** Publisher/test utility: generate a fresh Ed25519 keypair (base64). */
export function generatePublisherKeypair(): {
  publicKeyBase64: string;
  secretKeyBase64: string;
} {
  const secret = ed25519.utils.randomSecretKey();
  const publicKey = ed25519.getPublicKey(secret);
  return {
    publicKeyBase64: encodeBase64(publicKey),
    secretKeyBase64: encodeBase64(secret),
  };
}

/** Publisher/test utility: sign exact content bytes with a secret key. */
export function signContent(input: {
  content: string;
  secretKeyBase64: string;
}): string {
  const secret = decodeBase64(input.secretKeyBase64);
  if (!secret || secret.length !== 32) {
    throw new Error("Signing needs a 32-byte Ed25519 secret key.");
  }
  const signature = ed25519.sign(new TextEncoder().encode(input.content), secret);
  return encodeBase64(signature);
}
