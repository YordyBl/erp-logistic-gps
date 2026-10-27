import { WeakPasswordError } from '../errors/IdentityError.js';

/**
 * Ratified password policy.
 *
 * Users are created by an administrator, so the policy exists to stop an
 * obviously guessable temporary password from surviving the invitation, not to
 * impose a large rule catalogue. Length plus letter-and-digit is explicit,
 * testable and easy to explain to operators.
 *
 * Deliberately not included: symbol requirements, dictionary checks and
 * periodic rotation. Those add friction without proven benefit for the MVP and
 * can be layered on later without changing this contract.
 */
export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 200;

export type PasswordPolicyReason =
  | 'invalid_type'
  | 'minimum_length'
  | 'maximum_length'
  | 'letter_required'
  | 'digit_required';

export interface PasswordPolicyEvaluation {
  readonly valid: boolean;
  readonly reasons: readonly PasswordPolicyReason[];
}

const LETTER_PATTERN = /\p{L}/u;
const DIGIT_PATTERN = /[0-9]/;

/**
 * Evaluates every rule so the caller can report all violations at once.
 *
 * The password is never echoed, trimmed or normalized: whitespace is a literal
 * character of the secret.
 */
export function evaluatePasswordPolicy(password: unknown): PasswordPolicyEvaluation {
  if (typeof password !== 'string') {
    return { valid: false, reasons: ['invalid_type'] };
  }

  const reasons: PasswordPolicyReason[] = [];

  if (password.length < MIN_PASSWORD_LENGTH) {
    reasons.push('minimum_length');
  }

  if (password.length > MAX_PASSWORD_LENGTH) {
    reasons.push('maximum_length');
  }

  if (!LETTER_PATTERN.test(password)) {
    reasons.push('letter_required');
  }

  if (!DIGIT_PATTERN.test(password)) {
    reasons.push('digit_required');
  }

  return { valid: reasons.length === 0, reasons };
}

/**
 * Convenience guard that returns the original password for chaining at the
 * application boundary.
 */
export function assertPasswordPolicy(password: unknown): string {
  if (typeof password !== 'string') {
    throw new WeakPasswordError(['invalid_type']);
  }

  const evaluation = evaluatePasswordPolicy(password);

  if (!evaluation.valid) {
    throw new WeakPasswordError(evaluation.reasons);
  }

  return password;
}
