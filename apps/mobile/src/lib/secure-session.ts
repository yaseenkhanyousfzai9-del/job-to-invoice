import * as SecureStore from "expo-secure-store";

const ROOT_KEY = "jti.auth.session";
const CHUNK_SIZE = 1800;

export const secureSessionStorage = {
  async getItem(_key: string): Promise<string | null> {
    const meta = await SecureStore.getItemAsync(ROOT_KEY);
    if (!meta) {
      return null;
    }
    const count = Number(meta);
    if (!Number.isInteger(count) || count < 1) {
      return null;
    }
    const parts: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const part = await SecureStore.getItemAsync(`${ROOT_KEY}.${index}`);
      if (part === null) {
        return null;
      }
      parts.push(part);
    }
    return parts.join("");
  },
  async setItem(_key: string, value: string): Promise<void> {
    const chunks: string[] = [];
    for (let index = 0; index < value.length; index += CHUNK_SIZE) {
      chunks.push(value.slice(index, index + CHUNK_SIZE));
    }
    const parts = chunks.length > 0 ? chunks : [""];
    await SecureStore.setItemAsync(ROOT_KEY, String(parts.length));
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];
      if (part !== undefined) {
        await SecureStore.setItemAsync(`${ROOT_KEY}.${index}`, part);
      }
    }
  },
  async removeItem(_key: string): Promise<void> {
    const meta = await SecureStore.getItemAsync(ROOT_KEY);
    const count = meta ? Number(meta) : 8;
    await SecureStore.deleteItemAsync(ROOT_KEY);
    for (let index = 0; index < count; index += 1) {
      await SecureStore.deleteItemAsync(`${ROOT_KEY}.${index}`);
    }
  },
};
