/**
 * Web Preview SecureStore: in-memory only. Secrets entered during a
 * preview session work for that session (providers can connect, OAuth can
 * complete); nothing is persisted to disk or localStorage, and nothing
 * survives a reload. This is the correct posture for a development
 * preview: it can neither leak credentials nor pretend at persistence.
 */

import {
  createSecureValuesRepository,
  type SecureValuesRepository,
} from "@/core/services/secure-values-repository";

const memory = new Map<string, string>();

let warned = false;

function warnOnce() {
  if (!warned) {
    warned = true;
    console.warn(
      "[web-preview] SecureStore is unavailable in the browser; secrets are held in memory for this session only.",
    );
  }
}

export async function getItemAsync(key: string): Promise<string | null> {
  warnOnce();
  return memory.get(key) ?? null;
}

export async function setItemAsync(key: string, value: string): Promise<void> {
  warnOnce();
  memory.set(key, value);
}

export async function deleteItemAsync(key: string): Promise<void> {
  warnOnce();
  memory.delete(key);
}

export const secureValuesBackend = {
  getItemAsync,
  setItemAsync,
  deleteItemAsync,
};

export const secureValues: SecureValuesRepository =
  createSecureValuesRepository(secureValuesBackend);
