import { describe, expect, it } from 'vitest';

import { WeakPasswordError } from '../domain/errors/IdentityError.js';
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  assertPasswordPolicy,
  evaluatePasswordPolicy,
} from '../domain/policies/password-policy.js';

describe('password policy', () => {
  it('documents the ratified minimum length', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(10);
    expect(MAX_PASSWORD_LENGTH).toBe(200);
  });

  it('accepts passwords with at least 10 characters, one letter and one digit', () => {
    expect(evaluatePasswordPolicy('delivery2026')).toEqual({ valid: true, reasons: [] });
    expect(evaluatePasswordPolicy('año2026seguro')).toEqual({ valid: true, reasons: [] });
    expect(evaluatePasswordPolicy('12345678a9')).toEqual({ valid: true, reasons: [] });
  });

  it('reports every violated rule', () => {
    expect(evaluatePasswordPolicy('deliv2026')).toEqual({
      valid: false,
      reasons: ['minimum_length'],
    });
    expect(evaluatePasswordPolicy('deliverypass').reasons).toEqual(['digit_required']);
    expect(evaluatePasswordPolicy('2026202620').reasons).toEqual(['letter_required']);
    expect(evaluatePasswordPolicy('2026').reasons).toEqual([
      'minimum_length',
      'letter_required',
    ]);
  });

  it('rejects empty, whitespace-only, non-string and oversized values', () => {
    expect(evaluatePasswordPolicy('').reasons).toEqual([
      'minimum_length',
      'letter_required',
      'digit_required',
    ]);
    expect(evaluatePasswordPolicy('           ').reasons).toEqual([
      'letter_required',
      'digit_required',
    ]);
    expect(evaluatePasswordPolicy(undefined).valid).toBe(false);
    expect(evaluatePasswordPolicy(`a1${'x'.repeat(200)}`).reasons).toEqual([
      'maximum_length',
    ]);
  });

  it('throws a typed error that never repeats the rejected password', () => {
    const password = 'hunter2';

    let caught: unknown;
    try {
      assertPasswordPolicy(password);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(WeakPasswordError);
    if (!(caught instanceof WeakPasswordError)) {
      throw new Error('expected WeakPasswordError');
    }
    expect(caught.code).toBe('IDENTITY_WEAK_PASSWORD');
    expect(caught.details?.['reasons']).toEqual(['minimum_length']);
    expect(JSON.stringify({ message: caught.message, details: caught.details })).not.toContain(
      password,
    );
  });

  it('returns the password unchanged when it satisfies the policy', () => {
    expect(assertPasswordPolicy('delivery2026')).toBe('delivery2026');
  });
});
