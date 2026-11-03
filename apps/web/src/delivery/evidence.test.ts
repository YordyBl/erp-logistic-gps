import { describe, expect, it } from 'vitest';

import { validateEvidenceFiles } from './evidence.js';

function photo(name: string, type: string, size = 128): File {
  return new File([new Uint8Array(size)], name, { type });
}

describe('validateEvidenceFiles', () => {
  it('accepts one or two JPEG, PNG, or WebP photos up to the 5 MB limit', () => {
    expect(validateEvidenceFiles([photo('receipt.jpg', 'image/jpeg', 5_000_000)])).toBeNull();
    expect(validateEvidenceFiles([
      photo('front.png', 'image/png'),
      photo('back.webp', 'image/webp'),
    ])).toBeNull();
  });

  it('requires at least one photo', () => {
    expect(validateEvidenceFiles([])).toBe('Adjunta al menos una foto para continuar.');
  });

  it('rejects more than two photos', () => {
    expect(validateEvidenceFiles([
      photo('one.jpg', 'image/jpeg'),
      photo('two.jpg', 'image/jpeg'),
      photo('three.jpg', 'image/jpeg'),
    ])).toBe('Puedes adjuntar hasta 2 fotos.');
  });

  it('rejects unsupported media types even when the filename looks like an image', () => {
    expect(validateEvidenceFiles([photo('receipt.jpg', 'application/octet-stream')]))
      .toBe('Usa fotos JPEG, PNG o WebP.');
  });

  it('rejects a photo larger than 5,000,000 bytes', () => {
    expect(validateEvidenceFiles([photo('large.jpg', 'image/jpeg', 5_000_001)]))
      .toBe('Cada foto debe pesar 5 MB o menos.');
  });
});
