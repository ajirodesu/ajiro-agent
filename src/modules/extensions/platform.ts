/**
 * React Native implementation of the extension platform adapter:
 * expo-file-system (new File/Directory/Paths API, SDK 57) for storage,
 * expo-crypto for package integrity, and File.downloadFileAsync for
 * package downloads with progress. Used by the store UI; never imported
 * by the pure installer core (which stays unit-testable on node).
 */
import * as Crypto from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";

import type { ExtensionPlatform } from "./installer";
import { planExtensionPaths, type ExtensionPathPlan } from "./storage";

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function directoryFor(path: string): Directory {
  return new Directory(path);
}

function fileFor(path: string): File {
  return new File(path);
}

async function ensureParent(path: string): Promise<void> {
  const lastSlash = path.lastIndexOf("/");
  if (lastSlash <= 0) return;
  await directoryFor(path.slice(0, lastSlash)).create({
    idempotent: true,
    intermediates: true,
  });
}

export function createExtensionPaths(documentsUri?: string): ExtensionPathPlan {
  return planExtensionPaths(documentsUri ?? Paths.document.uri);
}

export function createExtensionPlatform(paths?: ExtensionPathPlan): {
  paths: ExtensionPathPlan;
  platform: ExtensionPlatform;
} {
  const resolvedPaths = paths ?? createExtensionPaths();

  const platform: ExtensionPlatform = {
    async copyEntry(from, to, kind) {
      if (kind === "file") {
        await fileFor(from).copy(fileFor(to));
      } else {
        await directoryFor(from).copy(directoryFor(to));
      }
    },

    async deleteEntry(path, kind) {
      if (kind === "file") {
        fileFor(path).delete();
      } else {
        directoryFor(path).delete();
      }
    },

    async exists(path, kind) {
      try {
        return kind === "file" ? fileFor(path).exists : directoryFor(path).exists;
      } catch {
        return false;
      }
    },

    async fetchBytes(url, onProgress) {
      // Native download with progress into a cache temp file, then read.
      try {
        const temp = new File(Paths.cache, `extension-download-${Date.now()}.zip`);
        try {
          await File.downloadFileAsync(url, temp, {
            idempotent: true,
            onProgress: onProgress
              ? (progress) => {
                  onProgress(progress.bytesWritten, progress.totalBytes);
                }
              : undefined,
          });
          return await temp.bytes();
        } finally {
          if (temp.exists) temp.delete();
        }
      } catch {
        // Fallback: in-memory fetch (web / exotic URIs).
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Download failed (${response.status}).`);
        }
        const buffer = await response.arrayBuffer();
        return new Uint8Array(buffer);
      }
    },

    async hashSha256(bytes) {
      // Copy into a fresh ArrayBuffer-backed view: expo-crypto requires a
      // BufferSource and a Uint8Array may be backed by a SharedArrayBuffer.
      const source = new Uint8Array(bytes.byteLength);
      source.set(bytes);
      const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, source);
      return toHex(new Uint8Array(digest)).toLowerCase();
    },

    async listDirectory(path) {
      const directory = directoryFor(path);
      if (!directory.exists) return [];
      return directory.list().map((item) => ({
        isDirectory: item instanceof Directory,
        name: item.name,
      }));
    },

    async makeDirectory(path) {
      await directoryFor(path).create({ idempotent: true, intermediates: true });
    },

    async moveEntry(from, to, kind) {
      if (kind === "file") {
        await fileFor(from).move(fileFor(to), { overwrite: true });
      } else {
        await directoryFor(from).move(directoryFor(to), { overwrite: true });
      }
    },

    nowIso() {
      return new Date().toISOString();
    },

    async readBinary(path) {
      return fileFor(path).bytes();
    },

    async readText(path) {
      const file = fileFor(path);
      if (!file.exists) return null;
      return file.text();
    },

    async writeBinary(path, bytes) {
      await ensureParent(path);
      const file = fileFor(path);
      if (file.exists) file.delete();
      file.write(bytes);
    },

    async writeText(path, text) {
      await ensureParent(path);
      const file = fileFor(path);
      if (file.exists) file.delete();
      file.write(text);
    },
  };

  return { paths: resolvedPaths, platform };
}
