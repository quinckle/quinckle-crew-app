/**
 * Persistent print-device identity.
 *
 * A random UUID minted once per app install and persisted in AsyncStorage. It
 * identifies THIS DEVICE (not the signed-in staff member) as the print sink:
 * sent to the backend on /print/pair and /print/pending so the server can
 * refuse drains from a device whose pairing was superseded. Device-keyed on
 * purpose — a different staff member logging in on the same physical printer
 * device must keep printing (staff-keyed gating broke exactly that case).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY_DEVICE_ID = 'printDeviceId';

let _deviceId: string | null = null;

function mintId(): string {
  // Not security-sensitive — just needs to be unique across app installs.
  const rand = () => Math.random().toString(36).slice(2, 10);
  return `pd_${Date.now().toString(36)}_${rand()}${rand()}`;
}

export async function getPrintDeviceId(): Promise<string> {
  if (_deviceId) return _deviceId;
  try {
    const stored = await AsyncStorage.getItem(KEY_DEVICE_ID);
    if (stored) {
      _deviceId = stored;
      return stored;
    }
  } catch { /* fall through to mint */ }
  const fresh = mintId();
  _deviceId = fresh;
  try {
    await AsyncStorage.setItem(KEY_DEVICE_ID, fresh);
  } catch { /* in-memory id still stable for this session */ }
  return fresh;
}
