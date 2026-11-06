import type { KeySource } from "@supah-osint/engine";

export type SecretStore = Pick<typeof Bun.secrets, "get" | "set" | "delete">;

export type KeychainKeys = KeySource & {
  set(sourceId: string, keys: readonly string[]): Promise<void>;
  clear(sourceId: string): Promise<void>;
};

const entryName = (sourceId: string): string => `source:${sourceId}`;

// Windows Credential Manager rejects blobs over 2560 bytes (CRED_MAX_CREDENTIAL_BLOB_SIZE); Bun stores UTF-8.
export const MAX_ENTRY_BYTES = 2560;

function parseKeys(raw: string | null): readonly string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter((key): key is string => typeof key === "string" && key.length > 0);
  } catch {
    // JSON.parse errors quote the input, so swallow them rather than leak a key.
    return [];
  }
}

// The OS keychain can't list entries, so each source's keys are one JSON array.
export function createKeychainKeys(secrets: SecretStore = Bun.secrets, service = "supah-osint"): KeychainKeys {
  return {
    async list(sourceId) {
      return parseKeys(await secrets.get({ service, name: entryName(sourceId) }));
    },
    async set(sourceId, keys) {
      const clean = [...new Set(keys.map((key) => key.trim()).filter((key) => key.length > 0))];
      if (clean.length === 0) {
        await secrets.delete({ service, name: entryName(sourceId) });
        return;
      }
      const value = JSON.stringify(clean);
      if (Buffer.byteLength(value, "utf8") > MAX_ENTRY_BYTES) {
        throw new Error(`too many or too long keys for ${sourceId} (limit ${MAX_ENTRY_BYTES} bytes)`);
      }
      await secrets.set({ service, name: entryName(sourceId), value });
    },
    async clear(sourceId) {
      await secrets.delete({ service, name: entryName(sourceId) });
    },
  };
}
