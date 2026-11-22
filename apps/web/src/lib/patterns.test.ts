import { describe, expect, it } from 'vitest';

import { IDENTIFIER_PATTERN, PHONE_PATTERN } from './patterns.js';

/** Igual que el navegador con el atributo `pattern`: lanza si el patrón no compila con `v`. */
function matches(pattern: string, value: string): boolean {
  return new RegExp(`^(?:${pattern})$`, 'v').test(value);
}

describe('patrones de validación', () => {
  it('acepta teléfonos con prefijo, espacios, paréntesis y guiones', () => {
    for (const phone of ['900 000 123', '+51 900 000 123', '01 (555) 12-34', '999222333']) {
      expect(matches(PHONE_PATTERN, phone)).toBe(true);
    }
  });

  it('rechaza teléfonos con letras o sin dígito inicial', () => {
    for (const phone of ['no es un teléfono', 'abc123', '(01) 555', '+']) {
      expect(matches(PHONE_PATTERN, phone)).toBe(false);
    }
  });

  it('acepta identificadores con guiones internos y rechaza los demás', () => {
    expect(matches(IDENTIFIER_PATTERN, 'ABC-123')).toBe(true);
    expect(matches(IDENTIFIER_PATTERN, 'A1')).toBe(true);
    expect(matches(IDENTIFIER_PATTERN, '-ABC')).toBe(false);
    expect(matches(IDENTIFIER_PATTERN, 'ABC 123')).toBe(false);
  });
});
