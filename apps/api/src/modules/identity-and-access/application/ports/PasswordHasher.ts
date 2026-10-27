/**
 * Password hashing contract.
 *
 * The production adapter is Argon2id. `hash` returns a self-contained encoded
 * hash (algorithm, parameters, salt and digest); `verify` must return `false`
 * for a wrong password or a malformed stored hash instead of throwing, so a
 * corrupted row cannot turn into a 500 on the login path.
 */
export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(passwordHash: string, password: string): Promise<boolean>;
}
