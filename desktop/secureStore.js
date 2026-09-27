/**
 * Encrypted key/value storage for the renderer — the desktop counterpart of
 * expo-secure-store, which has no web implementation (its web file exports an
 * empty object). Without this the crew login token lived only in memory, so
 * every reload or relaunch signed the user out.
 *
 * Values are encrypted with Electron's safeStorage, which is backed by the OS
 * (the macOS Keychain, Windows DPAPI, the Linux secret service), then written
 * to one small JSON file in userData. The file alone is useless to anyone who
 * cannot unlock that OS store as this user.
 *
 * Deliberately no plaintext fallback. If encryption is unavailable (a Linux box
 * with no keyring, say) a write fails and the user signs in again next launch,
 * which is a worse experience but never a token sitting readable on disk.
 */

const fs = require('fs');
const path = require('path');

/** expo-secure-store's own key rule: alphanumerics, ".", "-" and "_". */
const KEY_RE = /^[A-Za-z0-9._-]{1,128}$/;
/** A JWT is well under 2 KB; this is a ceiling against a runaway write. */
const MAX_VALUE_BYTES = 16 * 1024;

function assertKey(key) {
  if (typeof key !== 'string' || !KEY_RE.test(key)) throw new Error('SECURE_STORE_BAD_KEY');
}

/**
 * @param {{ safeStorage: Electron.SafeStorage, filePath: string }} deps
 *   Injected so the logic can be tested without an Electron process.
 */
function create({ safeStorage, filePath }) {
  function readAll() {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {}; // missing or corrupt: treat as empty rather than wedging login
    }
  }

  function writeAll(data) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    // Write-then-rename, so a crash mid-write cannot leave a half file.
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
    fs.renameSync(tmp, filePath);
  }

  return {
    get(key) {
      assertKey(key);
      const data = readAll();
      if (!(key in data)) return null;
      try {
        return safeStorage.decryptString(Buffer.from(data[key], 'base64'));
      } catch {
        // The OS store changed underneath us (new keychain, restored profile).
        // The entry can never be read again, so drop it and report signed out.
        delete data[key];
        writeAll(data);
        return null;
      }
    },

    set(key, value) {
      assertKey(key);
      if (typeof value !== 'string') throw new Error('SECURE_STORE_BAD_VALUE');
      if (Buffer.byteLength(value, 'utf8') > MAX_VALUE_BYTES) throw new Error('SECURE_STORE_TOO_LARGE');
      if (!safeStorage.isEncryptionAvailable()) throw new Error('SECURE_STORE_UNAVAILABLE');
      const data = readAll();
      data[key] = safeStorage.encryptString(value).toString('base64');
      writeAll(data);
    },

    delete(key) {
      assertKey(key);
      const data = readAll();
      if (!(key in data)) return;
      delete data[key];
      writeAll(data);
    },
  };
}

function register(ipcMain, deps) {
  const store = create(deps);
  const wrap = (fn) => async (_event, arg) => {
    try {
      return { ok: true, value: fn(arg ?? {}) ?? null };
    } catch (err) {
      return { ok: false, error: err?.message || 'SECURE_STORE_FAILED' };
    }
  };
  ipcMain.handle('secure:get', wrap(({ key }) => store.get(key)));
  ipcMain.handle('secure:set', wrap(({ key, value }) => store.set(key, value)));
  ipcMain.handle('secure:delete', wrap(({ key }) => store.delete(key)));
}

module.exports = { register, create };
