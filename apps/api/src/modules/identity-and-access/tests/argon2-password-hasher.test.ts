import { describe, expect, it } from 'vitest';

import { Argon2PasswordHasher } from '../infrastructure/security/argon2-password-hasher.js';

describe('Argon2PasswordHasher', () => {
  const hasher = new Argon2PasswordHasher();
  const password = 'delivery2026';

  it('hashes with Argon2id and verifies the original password', async () => {
    const hash = await hasher.hash(password);

    expect(hash.startsWith('$argon2id$')).toBe(true);
    await expect(hasher.verify(hash, password)).resolves.toBe(true);
  });

  it('produces a different salt for the same password', async () => {
    const first = await hasher.hash(password);
    const second = await hasher.hash(password);

    expect(first).not.toBe(second);
    await expect(hasher.verify(first, password)).resolves.toBe(true);
    await expect(hasher.verify(second, password)).resolves.toBe(true);
  });

  it('returns false for a wrong password or a malformed stored hash', async () => {
    const hash = await hasher.hash(password);

    await expect(hasher.verify(hash, 'another-password-1')).resolves.toBe(false);
    await expect(hasher.verify('not-a-hash', password)).resolves.toBe(false);
  });

  it('round-trips unicode and empty passwords without normalization', async () => {
    const unicodePassword = 'contraseña-ñ-2026';
    const unicodeHash = await hasher.hash(unicodePassword);

    await expect(hasher.verify(unicodeHash, unicodePassword)).resolves.toBe(true);
    await expect(hasher.verify(unicodeHash, 'contrasena-n-2026')).resolves.toBe(false);

    // Empty is not a policy-valid password, but the hasher must still be a
    // total function: a corrupted or hand-written row can reach verify.
    const emptyHash = await hasher.hash('');
    await expect(hasher.verify(emptyHash, '')).resolves.toBe(true);
    await expect(hasher.verify(emptyHash, 'x')).resolves.toBe(false);
  });
});
