/**
 * Secure token storage — desktop (Electron) and web.
 *
 * expo-secure-store has no web build (its web file exports nothing), so on
 * desktop every read came back empty and the login token lived only in memory:
 * each reload or relaunch signed the user out.
 *
 * Inside the Electron shell this goes through the preload bridge to
 * desktop/secureStore.js, which encrypts with the OS keychain (safeStorage). In
 * a plain browser tab there is no bridge, and nothing is persisted — the token
 * stays in memory, exactly as before, rather than landing in localStorage.
 *
 * Same signatures as expo-secure-store's, so AuthContext is unchanged.
 */

type Bridge = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
};

const bridge = (): Bridge | undefined => (globalThis as any)?.quinckle?.secureStore;

export async function getItemAsync(key: string): Promise<string | null> {
  return (await bridge()?.get(key)) ?? null;
}

export async function setItemAsync(key: string, value: string): Promise<void> {
  await bridge()?.set(key, value);
}

export async function deleteItemAsync(key: string): Promise<void> {
  await bridge()?.delete(key);
}
