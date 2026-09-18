/**
 * Web-safe SecureStore access. The native module re-exports its async
 * get/set/delete API verbatim; the `.web.ts` sibling implements the same
 * signatures over an in-memory map. All direct SecureStore imports in app
 * code go through this wrapper so Web Preview never touches the native
 * module (which rejects on web).
 */
import {
  deleteItemAsync as nativeDeleteItemAsync,
  getItemAsync as nativeGetItemAsync,
  setItemAsync as nativeSetItemAsync,
} from "expo-secure-store";

import {
  createSecureValuesRepository,
  type SecureValuesRepository,
} from "@/core/services/secure-values-repository";

export const deleteItemAsync = nativeDeleteItemAsync;
export const getItemAsync = nativeGetItemAsync;
export const setItemAsync = nativeSetItemAsync;

export const secureValuesBackend = {
  getItemAsync,
  setItemAsync,
  deleteItemAsync,
};

export const secureValues: SecureValuesRepository =
  createSecureValuesRepository(secureValuesBackend);
