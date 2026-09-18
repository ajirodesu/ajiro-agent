/**
 * Backend-agnostic secure key/value repository. Production backends are the
 * platform SecureStore wrappers (`secure-store.ts` on native,
 * `secure-store.web.ts` on Web Preview); tests inject an in-memory map.
 * Keys are namespaced per caller to avoid collisions with the typed
 * `SecretStore` keys in `secrets.ts` / `secrets.web.ts`.
 */

export interface SecureValuesBackend {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

export interface SecureValuesRepository {
  getValue(namespace: string, key: string): Promise<string | null>;
  setValue(namespace: string, key: string, value: string): Promise<void>;
  deleteValue(namespace: string, key: string): Promise<void>;
  hasValue(namespace: string, key: string): Promise<boolean>;
}

function qualifiedKey(namespace: string, key: string): string {
  if (!namespace || !key) {
    throw new TypeError(
      "SecureValuesRepository requires a non-empty namespace and key.",
    );
  }
  return `values_${namespace}_${key}`;
}

export function createSecureValuesRepository(
  backend: SecureValuesBackend,
): SecureValuesRepository {
  return {
    async getValue(namespace, key) {
      return backend.getItemAsync(qualifiedKey(namespace, key));
    },
    async setValue(namespace, key, value) {
      if (typeof value !== "string") {
        throw new TypeError("SecureValuesRepository values must be strings.");
      }
      await backend.setItemAsync(qualifiedKey(namespace, key), value);
    },
    async deleteValue(namespace, key) {
      await backend.deleteItemAsync(qualifiedKey(namespace, key));
    },
    async hasValue(namespace, key) {
      return (
        (await backend.getItemAsync(qualifiedKey(namespace, key))) !== null
      );
    },
  };
}
