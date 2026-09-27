/**
 * Secure token storage — native (Android / iOS): expo-secure-store as-is, the
 * Keychain / Keystore. Metro swaps in secureStorage.web.ts for the desktop
 * bundle, because expo-secure-store has no web implementation.
 */
export { getItemAsync, setItemAsync, deleteItemAsync } from 'expo-secure-store';
