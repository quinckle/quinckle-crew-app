const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { create } = require('./secureStore');

// A reversible stand-in for the OS keychain. Not encryption — it only has to
// prove the value on disk is not the plaintext and that the round trip works.
const fakeSafeStorage = (available = true) => ({
  isEncryptionAvailable: () => available,
  encryptString: (s) => Buffer.from(`enc:${Buffer.from(s).reverse().toString('hex')}`),
  decryptString: (b) => {
    const t = b.toString();
    if (!t.startsWith('enc:')) throw new Error('bad ciphertext');
    return Buffer.from(t.slice(4), 'hex').reverse().toString();
  },
});

function fresh(available = true) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quinckle-secure-'));
  const filePath = path.join(dir, 'secure-store.json');
  return { filePath, store: create({ safeStorage: fakeSafeStorage(available), filePath }) };
}

test('round trip, and the token is not on disk in plaintext', () => {
  const { store, filePath } = fresh();
  store.set('quinckle_crew_token', 'eyJhbGciOi.secret.token');
  assert.equal(store.get('quinckle_crew_token'), 'eyJhbGciOi.secret.token');
  assert.ok(!fs.readFileSync(filePath, 'utf8').includes('secret.token'));
});

test('survives a fresh instance over the same file (the reload case)', () => {
  const { store, filePath } = fresh();
  store.set('k', 'v');
  const again = create({ safeStorage: fakeSafeStorage(), filePath });
  assert.equal(again.get('k'), 'v');
});

test('missing key is null, delete removes it, deleting a missing key is fine', () => {
  const { store } = fresh();
  assert.equal(store.get('nope'), null);
  store.set('k', 'v');
  store.delete('k');
  assert.equal(store.get('k'), null);
  assert.doesNotThrow(() => store.delete('k'));
});

test('refuses to write when encryption is unavailable, and writes no file', () => {
  const { store, filePath } = fresh(false);
  assert.throws(() => store.set('k', 'v'), /SECURE_STORE_UNAVAILABLE/);
  assert.equal(fs.existsSync(filePath), false);
});

test('an undecryptable entry reads as null and is dropped', () => {
  const { store, filePath } = fresh();
  fs.writeFileSync(filePath, JSON.stringify({ k: Buffer.from('garbage').toString('base64') }));
  assert.equal(store.get('k'), null);
  assert.deepEqual(JSON.parse(fs.readFileSync(filePath, 'utf8')), {});
});

test('a corrupt file reads as empty instead of throwing', () => {
  const { store, filePath } = fresh();
  fs.writeFileSync(filePath, '{not json');
  assert.equal(store.get('k'), null);
  assert.doesNotThrow(() => store.set('k', 'v'));
  assert.equal(store.get('k'), 'v');
});

test('rejects bad keys and oversized or non-string values', () => {
  const { store } = fresh();
  assert.throws(() => store.get('../etc'), /BAD_KEY/);
  assert.throws(() => store.set('', 'v'), /BAD_KEY/);
  assert.throws(() => store.set('k', 42), /BAD_VALUE/);
  assert.throws(() => store.set('k', 'x'.repeat(17 * 1024)), /TOO_LARGE/);
});
