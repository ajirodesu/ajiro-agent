/**
 * Shared test helpers: a real ZIP writer (STORE + raw-DEFLATE via node
 * zlib) and an in-memory ExtensionPlatform, so the installer/zip/runtime
 * cores are exercised end-to-end on node.
 */
import { deflateRawSync } from "node:zlib";

import type { ExtensionPlatform } from "../installer";

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc ^= bytes[i];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export type ZipInput = { data: Uint8Array; name: string; store?: boolean };

export function buildZip(inputs: ZipInput[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  const u16 = (value: number) => {
    const bytes = new Uint8Array(2);
    new DataView(bytes.buffer).setUint16(0, value, true);
    return bytes;
  };
  const u32 = (value: number) => {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, value, true);
    return bytes;
  };
  const concat = (parts: Uint8Array[]) => {
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(total);
    let position = 0;
    for (const part of parts) {
      out.set(part, position);
      position += part.length;
    }
    return out;
  };
  const bytesOf = (text: string) => new TextEncoder().encode(text);

  for (const input of inputs) {
    const nameBytes = bytesOf(input.name);
    const method = input.store ? 0 : 8;
    const data = input.store ? input.data : deflateRawSync(input.data);
    const crc = crc32(input.data);
    const localHeader = concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(method),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(input.data.length),
      u16(nameBytes.length),
      u16(0),
      nameBytes,
    ]);
    chunks.push(localHeader, data);
    central.push(
      concat([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(0),
        u16(method),
        u16(0),
        u16(0),
        u32(crc),
        u32(data.length),
        u32(input.data.length),
        u16(nameBytes.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        nameBytes,
      ]),
    );
    offset += localHeader.length + data.length;
  }

  const centralDirectory = concat(central);
  const eocd = concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(inputs.length),
    u16(inputs.length),
    u32(centralDirectory.length),
    u32(offset),
    u16(0),
  ]);
  return concat([...chunks, centralDirectory, eocd]);
}

export function zipOfFiles(
  files: Record<string, string>,
  options: { prefix?: string; store?: boolean } = {},
): Uint8Array {
  const prefix = options.prefix ?? "";
  return buildZip(
    Object.entries(files).map(([name, text]) => ({
      data: new TextEncoder().encode(text),
      name: `${prefix}${name}`,
      store: options.store,
    })),
  );
}

export type MemoryPlatformOptions = {
  /** Bytes served by `fetchBytes`, keyed by URL (remote installs). */
  downloads?: Record<string, Uint8Array>;
  now?: Date;
};

/** In-memory ExtensionPlatform with a POSIX-ish path model. */
export function createMemoryPlatform(
  options: MemoryPlatformOptions = {},
): {
  platform: ExtensionPlatform;
  files: Map<string, Uint8Array>;
} {
  const now = options.now ?? new Date("2026-01-01T00:00:00Z");
  const files = new Map<string, Uint8Array>();

  const isDirectory = (path: string) =>
    [...files.keys()].some((key) => key.startsWith(`${path}/`)) ||
    files.has(`${path}/`);

  const platform: ExtensionPlatform = {
    async copyEntry(from, to, kind) {
      if (kind === "file") {
        const data = files.get(from);
        if (!data) throw new Error(`copyEntry: missing file ${from}`);
        files.set(to, data);
        return;
      }
      for (const [key, value] of [...files.entries()]) {
        if (key.startsWith(`${from}/`)) {
          files.set(`${to}${key.slice(from.length)}`, value);
        }
      }
    },

    async deleteEntry(path, kind) {
      if (kind === "file") {
        files.delete(path);
        return;
      }
      for (const key of [...files.keys()]) {
        if (key.startsWith(`${path}/`) || key === `${path}/`) files.delete(key);
      }
    },

    async exists(path, kind) {
      if (kind === "file") return files.has(path);
      return isDirectory(path);
    },

    async fetchBytes(url, onProgress) {
      const bytes = options.downloads?.[url];
      if (!bytes) {
        throw new Error(`fetchBytes: no download registered for ${url}.`);
      }
      onProgress?.(bytes.length, bytes.length);
      return bytes;
    },

    async hashSha256(bytes) {
      // Not cryptographic; tests only need determinism.
      let hash = 2166136261;
      for (const byte of bytes) {
        hash ^= byte;
        hash = Math.imul(hash, 16777619);
      }
      return (hash >>> 0).toString(16).padStart(8, "0").repeat(8).slice(0, 64);
    },

    async listDirectory(path) {
      const names = new Set<{ isDirectory: boolean; name: string }>();
      for (const key of files.keys()) {
        if (!key.startsWith(`${path}/`)) continue;
        const rest = key.slice(path.length + 1);
        const [head, ...tail] = rest.split("/");
        names.add({ isDirectory: tail.length > 0, name: head });
      }
      return [...names];
    },

    async makeDirectory() {
      // Directories are implicit in the memory model.
    },

    async moveEntry(from, to, kind) {
      await platform.copyEntry(from, to, kind);
      await platform.deleteEntry(from, kind);
    },

    nowIso: () => now.toISOString(),

    async readBinary(path) {
      const data = files.get(path);
      if (!data) throw new Error(`readBinary: missing file ${path}`);
      return data;
    },

    async readText(path) {
      const data = files.get(path);
      return data ? new TextDecoder().decode(data) : null;
    },

    async writeBinary(path, bytes) {
      files.set(path, bytes);
    },

    async writeText(path, text) {
      files.set(path, new TextEncoder().encode(text));
    },
  };

  return { files, platform };
}

/**
 * A stand-in for the plugin host document (`dom/plugin-host.ts`). The runtime
 * only ever talks to an execution host through this seam, so lifecycle,
 * timeout, and crash-isolation behavior can be asserted on node without a
 * WebView — and the DOM host itself stays thin.
 */
export type FakeExecutionHost = {
  /** Plugin ids whose init completed successfully, in order. */
  activated: string[];
  /** Fail the next activation with this message. */
  failNext(message: string): void;
  /** Make the next activation never settle (stands in for a stuck plugin). */
  hangNext(): void;
  /** Every `load()` call: the entry source the host was handed. */
  loaded: { baseUrl: string; pluginId: string; source: string }[];
  /** Plugin ids passed to `unmount()`. */
  unmounted: string[];
};

export function createFakeExecutionHost(): import("../runtime").PluginExecutionHost &
  FakeExecutionHost {
  const loaded: FakeExecutionHost["loaded"] = [];
  const activated: string[] = [];
  const unmounted: string[] = [];
  const queue: (Error | "hang")[] = [];

  return {
    activated,
    async activate(pluginId) {
      const next = queue.shift();
      if (next === "hang") {
        await new Promise<void>(() => {
          // Never settles.
        });
      }
      if (next instanceof Error) throw next;
      activated.push(pluginId);
    },
    failNext(message) {
      queue.push(new Error(message));
    },
    hangNext() {
      queue.push("hang");
    },
    async load(pluginId, options) {
      loaded.push({ baseUrl: options.baseUrl, pluginId, source: options.source });
    },
    async unmount(pluginId) {
      unmounted.push(pluginId);
    },
    loaded,
    unmounted,
  };
}
