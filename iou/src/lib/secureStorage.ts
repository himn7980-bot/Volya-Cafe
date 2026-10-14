import * as SecureStore from 'expo-secure-store';

// Supabase sessions are larger than SecureStore's per-item limit (~2 KB on
// some Android devices), so values are split across numbered chunks. Tokens
// stay in the Keychain / Android Keystore, never in plain AsyncStorage.

const CHUNK = 1800;
const safeKey = (key: string) => key.replace(/[^A-Za-z0-9._-]/g, '_');
const countKey = (key: string) => `${safeKey(key)}.n`;
const chunkKey = (key: string, i: number) => `${safeKey(key)}.${i}`;

export const secureStorage = {
  async getItem(key: string): Promise<string | null> {
    const n = Number(await SecureStore.getItemAsync(countKey(key)));
    if (!n) return null;
    const parts: string[] = [];
    for (let i = 0; i < n; i += 1) {
      const part = await SecureStore.getItemAsync(chunkKey(key, i));
      if (part === null) return null;
      parts.push(part);
    }
    return parts.join('');
  },

  async setItem(key: string, value: string): Promise<void> {
    await this.removeItem(key);
    const n = Math.ceil(value.length / CHUNK);
    for (let i = 0; i < n; i += 1) {
      await SecureStore.setItemAsync(chunkKey(key, i), value.slice(i * CHUNK, (i + 1) * CHUNK));
    }
    await SecureStore.setItemAsync(countKey(key), String(n));
  },

  async removeItem(key: string): Promise<void> {
    const n = Number(await SecureStore.getItemAsync(countKey(key)));
    await SecureStore.deleteItemAsync(countKey(key));
    for (let i = 0; i < n; i += 1) await SecureStore.deleteItemAsync(chunkKey(key, i));
  },
};
