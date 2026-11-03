export const MAX_EVIDENCE_FILES = 2;
export const MAX_EVIDENCE_BYTES = 5_000_000;

const ACCEPTED_EVIDENCE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

export function validateEvidenceFiles(files: readonly File[]): string | null {
  if (files.length === 0) {
    return 'Adjunta al menos una foto para continuar.';
  }

  if (files.length > MAX_EVIDENCE_FILES) {
    return 'Puedes adjuntar hasta 2 fotos.';
  }

  if (files.some((file) => !ACCEPTED_EVIDENCE_TYPES.has(file.type))) {
    return 'Usa fotos JPEG, PNG o WebP.';
  }

  if (files.some((file) => file.size > MAX_EVIDENCE_BYTES)) {
    return 'Cada foto debe pesar 5 MB o menos.';
  }

  return null;
}
