import { describe, expect, it } from "vitest";

import {
  createPublisherTrustStore,
  generatePublisherKeypair,
  parsePublisherTrustStore,
  signContent,
  verifyContentSignature,
} from "../publisher-trust";

describe("publisher trust store", () => {
  it("keeps only well-formed keys and round-trips", () => {
    const { publicKeyBase64 } = generatePublisherKeypair();
    const store = createPublisherTrustStore({
      "": publicKeyBase64,
      alice: publicKeyBase64,
      bad: "not-base64!!",
      short: "AAAA",
    });
    expect(store.keyIds()).toEqual(["alice"]);
    expect(store.hasKey("alice")).toBe(true);
    expect(store.hasKey("bob")).toBe(false);
    const restored = parsePublisherTrustStore(store.serialize());
    expect(restored.keyIds()).toEqual(["alice"]);
    expect(parsePublisherTrustStore("corrupt{").keyIds()).toEqual([]);
    expect(parsePublisherTrustStore(null).keyIds()).toEqual([]);
  });

  it("rejects malformed keys on add", () => {
    const store = createPublisherTrustStore();
    expect(() => store.addKey("x", "nope")).toThrow(/32-byte/);
    store.removeKey("missing");
    expect(store.keyIds()).toEqual([]);
  });
});

describe("content signature verification", () => {
  it("verifies, then fails closed on tampering", () => {
    const keys = generatePublisherKeypair();
    const store = createPublisherTrustStore({ alice: keys.publicKeyBase64 });
    const content = "# Skill\nDo things.";
    const value = signContent({ content, secretKeyBase64: keys.secretKeyBase64 });
    const verdict = verifyContentSignature({
      content,
      signature: { keyId: "alice", value },
      trustedKeys: store.keys(),
    });
    expect(verdict.status).toBe("verified");

    const tampered = verifyContentSignature({
      content: `${content}\nEvil.`,
      signature: { keyId: "alice", value },
      trustedKeys: store.keys(),
    });
    expect(tampered.status).toBe("invalid");
  });

  it("reports unsigned, untrusted keys, and bad algorithms", () => {
    const keys = generatePublisherKeypair();
    const store = createPublisherTrustStore();
    const content = "hello";
    const value = signContent({ content, secretKeyBase64: keys.secretKeyBase64 });
    expect(
      verifyContentSignature({ content, signature: null, trustedKeys: store.keys() })
        .status,
    ).toBe("unsigned");
    expect(
      verifyContentSignature({
        content,
        signature: { keyId: "alice", value },
        trustedKeys: store.keys(),
      }).status,
    ).toBe("untrusted-key");
    expect(
      verifyContentSignature({
        content,
        signature: { algorithm: "rsa", keyId: "alice", value },
        trustedKeys: store.keys(),
      }).status,
    ).toBe("unsupported-algorithm");
  });
});
