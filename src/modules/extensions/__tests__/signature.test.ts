/**
 * Publisher signatures (§51): real Ed25519 verification against a trust store,
 * plus the policy that decides whether a verdict blocks installation.
 */
import { ed25519 } from "@noble/curves/ed25519.js";
import { describe, expect, it } from "vitest";

import {
  buildSigningPayload,
  decodeBase64,
  encodeBase64,
  evaluatePackageSignature,
  parsePackageSignature,
  SIGNING_PAYLOAD_VERSION,
  signatureBlocksInstall,
  signatureLabel,
  verifyPackageSignature,
} from "../signature";

const FILES = new Map<string, string>([
  ["main.js", "acode.setPluginInit('com.example', function () {});"],
  ["readme.md", "# Example"],
  [
    "plugin.json",
    JSON.stringify({
      id: "com.example",
      main: "main.js",
      name: "Example",
      signature: { algorithm: "ed25519", keyId: "k", value: "PLACEHOLDER" },
      version: "1.0.0",
    }),
  ],
]);

const MANIFEST = {
  id: "com.example",
  raw: JSON.parse(FILES.get("plugin.json") ?? "{}") as Record<string, unknown>,
  version: "1.0.0",
};

const PACKAGE = buildSigningPayload({ files: FILES, manifest: MANIFEST });
const PAYLOAD_BYTES = new TextEncoder().encode(PACKAGE);

function keyPair(): { keyId: string; publicKey: string; secret: Uint8Array } {
  const secret = ed25519.utils.randomSecretKey();
  return {
    keyId: "ajiros.publisher",
    publicKey: encodeBase64(ed25519.getPublicKey(secret)),
    secret,
  };
}

function sign(secret: Uint8Array, bytes: Uint8Array): string {
  return encodeBase64(ed25519.sign(bytes, secret));
}

describe("signing payload", () => {
  it("ignores the signature field itself", () => {
    const withSignature = buildSigningPayload({ files: FILES, manifest: MANIFEST });
    const other = {
      id: "com.example",
      raw: { ...MANIFEST.raw, signature: { keyId: "other", value: "DIFFERENT" } },
      version: "1.0.0",
    };
    // Otherwise no package could ever be signed: changing the signature would
    // change the payload the signature covers.
    expect(buildSigningPayload({ files: FILES, manifest: other })).toBe(withSignature);
    expect(withSignature.startsWith(SIGNING_PAYLOAD_VERSION)).toBe(true);
    expect(withSignature).toContain("com.example@1.0.0");
    expect(withSignature).toContain("main.js");
  });

  it("changes when any file's content changes", () => {
    const mutated = new Map(FILES);
    mutated.set("main.js", "acode.setPluginInit('com.example', function () {}); // tampered");
    expect(buildSigningPayload({ files: mutated, manifest: MANIFEST })).not.toBe(
      PACKAGE,
    );
  });

  it("is independent of file insertion order", () => {
    const shuffled = new Map([...FILES.entries()].reverse());
    expect(buildSigningPayload({ files: shuffled, manifest: MANIFEST })).toBe(PACKAGE);
  });
});

describe("signature block parsing", () => {
  it("treats a missing signature as unsigned, not as a failure", () => {
    expect(parsePackageSignature(null)).toBeNull();
    expect(parsePackageSignature(undefined)).toBeNull();
    expect(
      evaluatePackageSignature({ payload: PACKAGE, raw: null, trustedKeys: {} }),
    ).toEqual({
      detail: expect.stringContaining("not signed"),
      keyId: null,
      status: "unsigned",
    });
  });

  it("reports a malformed block instead of throwing", () => {
    for (const raw of [
      "signed",
      [],
      { algorithm: "ed25519" },
      { keyId: "k", value: "  " },
    ]) {
      const parsed = parsePackageSignature(raw);
      expect(parsed).not.toBeNull();
      if (!parsed || !("verdict" in parsed)) throw new Error("expected a verdict");
      expect(parsed.verdict.status).toBe("malformed");
    }
  });

  it("reports an unknown algorithm rather than guessing", () => {
    const parsed = parsePackageSignature({
      algorithm: "rsa-pss",
      keyId: "k",
      value: "AAAA",
    });
    if (!parsed || !("verdict" in parsed)) throw new Error("expected a verdict");
    expect(parsed.verdict).toMatchObject({
      status: "unsupported-algorithm",
      keyId: "k",
    });
  });

  it("defaults the algorithm to ed25519 when it is omitted", () => {
    const parsed = parsePackageSignature({ keyId: "k", value: "AAAA" });
    expect(parsed).toEqual({
      signature: { algorithm: "ed25519", keyId: "k", value: "AAAA" },
    });
  });
});

describe("signature verification", () => {
  it("verifies a signature made by a trusted key over these exact bytes", () => {
    const { keyId, publicKey, secret } = keyPair();
    const verdict = evaluatePackageSignature({
      payload: PACKAGE,
      raw: { algorithm: "ed25519", keyId, value: sign(secret, PAYLOAD_BYTES) },
      trustedKeys: { [keyId]: publicKey },
    });
    expect(verdict.status).toBe("verified");
    expect(verdict.keyId).toBe(keyId);
  });

  it("refuses a package signed by a key the device does not trust", () => {
    const { keyId, secret } = keyPair();
    const verdict = evaluatePackageSignature({
      payload: PACKAGE,
      raw: { keyId, value: sign(secret, PAYLOAD_BYTES) },
      trustedKeys: {},
    });
    expect(verdict.status).toBe("untrusted-key");
  });

  it("detects a signature that does not match the contents", () => {
    const { keyId, publicKey, secret } = keyPair();
    const tampered = new Map(FILES);
    tampered.set("main.js", "stealEverything();");
    const verdict = evaluatePackageSignature({
      payload: buildSigningPayload({ files: tampered, manifest: MANIFEST }),
      raw: { keyId, value: sign(secret, PAYLOAD_BYTES) },
      trustedKeys: { [keyId]: publicKey },
    });
    expect(verdict.status).toBe("invalid");
  });

  it("detects a signature made with a different key", () => {
    const signer = keyPair();
    const impostor = keyPair();
    const verdict = evaluatePackageSignature({
      payload: PACKAGE,
      raw: {
        keyId: signer.keyId,
        value: sign(impostor.secret, PAYLOAD_BYTES),
      },
      trustedKeys: { [signer.keyId]: signer.publicKey },
    });
    expect(verdict.status).toBe("invalid");
  });

  it("reports a trusted key that is not a valid public key", () => {
    const { keyId, secret } = keyPair();
    const verdict = verifyPackageSignature({
      payload: PACKAGE,
      signature: { algorithm: "ed25519", keyId, value: sign(secret, PAYLOAD_BYTES) },
      trustedKeys: { [keyId]: "not-base64!" },
    });
    expect(verdict.status).toBe("malformed");
    // A wrong-length key is just as unusable.
    const short = verifyPackageSignature({
      payload: PACKAGE,
      signature: { algorithm: "ed25519", keyId, value: sign(secret, PAYLOAD_BYTES) },
      trustedKeys: { [keyId]: encodeBase64(new Uint8Array(8)) },
    });
    expect(short.status).toBe("malformed");
  });

  it("survives hostile input without throwing", () => {
    const { keyId, publicKey } = keyPair();
    const verdict = verifyPackageSignature({
      payload: PACKAGE,
      signature: { algorithm: "ed25519", keyId, value: "AAAA" },
      trustedKeys: { [keyId]: publicKey },
    });
    expect(verdict.status).toBe("malformed");
  });
});

describe("signature policy", () => {
  const verdicts = {
    invalid: {
      detail: "",
      keyId: "k",
      status: "invalid" as const,
    },
    untrusted: { detail: "", keyId: "k", status: "untrusted-key" as const },
    unsigned: { detail: "", keyId: null, status: "unsigned" as const },
    verified: { detail: "", keyId: "k", status: "verified" as const },
  };

  it("blocks nothing on its own", () => {
    for (const verdict of Object.values(verdicts)) {
      expect(signatureBlocksInstall(verdict, false)).toBe(false);
    }
  });

  it("blocks everything unverified once the user requires signatures", () => {
    expect(signatureBlocksInstall(verdicts.verified, true)).toBe(false);
    expect(signatureBlocksInstall(verdicts.unsigned, true)).toBe(true);
    expect(signatureBlocksInstall(verdicts.untrusted, true)).toBe(true);
    expect(signatureBlocksInstall(verdicts.invalid, true)).toBe(true);
  });

  it("labels every status for the UI", () => {
    expect(signatureLabel("verified")).toBe("Verified signature");
    expect(signatureLabel("unsigned")).toBe("Unsigned");
    expect(signatureLabel("invalid")).toBe("Invalid signature");
    expect(signatureLabel("untrusted-key")).toBe("Untrusted signing key");
    expect(signatureLabel("malformed")).toBe("Malformed signature");
  });
});

describe("base64 helpers", () => {
  it("round-trips bytes", () => {
    const bytes = new Uint8Array([0, 1, 250, 255, 128, 64]);
    expect(decodeBase64(encodeBase64(bytes))).toEqual(bytes);
  });

  it("rejects values that are not base64", () => {
    expect(decodeBase64("not base64!!")).toBeNull();
    expect(decodeBase64("   ")).toBeNull();
  });

  it("accepts URL-safe base64 and missing padding", () => {
    const bytes = new Uint8Array([251, 255, 190]);
    const standard = encodeBase64(bytes);
    const urlSafe = standard.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(decodeBase64(urlSafe)).toEqual(bytes);
  });
});
