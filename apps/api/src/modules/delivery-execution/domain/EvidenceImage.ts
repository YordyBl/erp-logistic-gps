export const MAX_EVIDENCE_IMAGE_BYTES = 5_000_000;

export type EvidenceImageMimeType = 'image/jpeg' | 'image/png' | 'image/webp';

export class EvidenceImageValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvidenceImageValidationError';
  }
}

export interface PreparedEvidenceImage {
  readonly bytes: Buffer;
  readonly mimeType: EvidenceImageMimeType;
}

/** Validate image content from bytes and remove format metadata before storage. */
export function prepareEvidenceImage(
  input: Buffer,
  declaredMimeType: string,
): PreparedEvidenceImage {
  if (input.length === 0 || input.length > MAX_EVIDENCE_IMAGE_BYTES) {
    throw new EvidenceImageValidationError('Evidence image must be between 1 and 5000000 bytes');
  }

  const mimeType = detectMimeType(input);
  if (mimeType === null || declaredMimeType.trim().toLowerCase() !== mimeType) {
    throw new EvidenceImageValidationError('Evidence image content does not match an allowed content type');
  }

  const bytes = mimeType === 'image/jpeg'
    ? stripJpegMetadata(input)
    : mimeType === 'image/png'
      ? stripPngMetadata(input)
      : stripWebpMetadata(input);

  return { bytes, mimeType };
}

function detectMimeType(input: Buffer): EvidenceImageMimeType | null {
  if (input.length >= 3 && input[0] === 0xff && input[1] === 0xd8 && input[2] === 0xff) {
    return 'image/jpeg';
  }
  if (input.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (input.length >= 12 && input.toString('ascii', 0, 4) === 'RIFF' &&
      input.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

function stripJpegMetadata(input: Buffer): Buffer {
  const parts: Buffer[] = [input.subarray(0, 2)];
  let offset = 2;
  let sawFrame = false;
  let sawScan = false;
  let sawEnd = false;

  while (offset < input.length) {
    const start = offset;
    if (input[offset] !== 0xff) throw malformedImage();
    while (offset < input.length && input[offset] === 0xff) offset += 1;
    if (offset >= input.length) throw malformedImage();
    const marker = input[offset]!;
    offset += 1;

    if (marker === 0xd9) {
      parts.push(input.subarray(start, offset));
      sawEnd = true;
      break;
    }

    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      if (marker !== 0xd8) parts.push(input.subarray(start, offset));
      continue;
    }

    if (offset + 2 > input.length) throw malformedImage();
    const segmentLength = input.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > input.length) throw malformedImage();
    const end = offset + segmentLength;
    if (isJpegFrameMarker(marker)) {
      const componentCount = input[offset + 7];
      if (segmentLength < 11 || componentCount === undefined || componentCount < 1 ||
          componentCount > 4 || segmentLength !== 8 + (3 * componentCount) ||
          input.readUInt16BE(offset + 3) === 0 || input.readUInt16BE(offset + 5) === 0) {
        throw malformedImage();
      }
      sawFrame = true;
    }
    if (marker === 0xda) {
      const scanComponentCount = input[offset + 2];
      if (!sawFrame || scanComponentCount === undefined || scanComponentCount < 1 ||
          scanComponentCount > 4 || segmentLength !== 6 + (2 * scanComponentCount)) {
        throw malformedImage();
      }
      sawScan = true;
    }
    if (marker !== 0xe1) parts.push(input.subarray(start, end));
    offset = end;

    if (marker === 0xda) {
      let nextMarker = -1;
      while (offset < input.length - 1) {
        if (input[offset] !== 0xff) {
          offset += 1;
          continue;
        }
        const following = input[offset + 1]!;
        if (following === 0x00 || (following >= 0xd0 && following <= 0xd7)) {
          offset += 2;
          continue;
        }
        nextMarker = offset;
        break;
      }
      if (nextMarker < 0) throw malformedImage();
      if (nextMarker > offset) parts.push(input.subarray(offset, nextMarker));
      offset = nextMarker;
    }
  }

  if (!sawFrame || !sawScan || !sawEnd || offset !== input.length) throw malformedImage();
  return Buffer.concat(parts);
}

function stripPngMetadata(input: Buffer): Buffer {
  const signature = input.subarray(0, 8);
  const parts: Buffer[] = [signature];
  let offset = signature.length;
  let sawHeader = false;
  let sawImageData = false;
  let sawEnd = false;

  while (offset < input.length) {
    const start = offset;
    if (offset + 12 > input.length) throw malformedImage();
    const dataLength = input.readUInt32BE(offset);
    const type = input.toString('ascii', offset + 4, offset + 8);
    const end = offset + 12 + dataLength;
    if (end > input.length) throw malformedImage();
    const expectedCrc = input.readUInt32BE(offset + 8 + dataLength);
    if (crc32(input.subarray(offset + 4, offset + 8 + dataLength)) !== expectedCrc) {
      throw malformedImage();
    }

    if (!sawHeader && (type !== 'IHDR' || dataLength !== 13)) throw malformedImage();
    if (type === 'IHDR') {
      const width = input.readUInt32BE(offset + 8);
      const height = input.readUInt32BE(offset + 12);
      const bitDepth = input[offset + 16]!;
      const colorType = input[offset + 17]!;
      const validDepths: Readonly<Record<number, readonly number[]>> = {
        0: [1, 2, 4, 8, 16],
        2: [8, 16],
        3: [1, 2, 4, 8],
        4: [8, 16],
        6: [8, 16],
      };
      if (sawHeader || width === 0 || height === 0 ||
          !validDepths[colorType]?.includes(bitDepth) || input[offset + 18] !== 0 ||
          input[offset + 19] !== 0 || ![0, 1].includes(input[offset + 20]!)) {
        throw malformedImage();
      }
      sawHeader = true;
    }
    if (type === 'IDAT') {
      if (!sawHeader || sawEnd) throw malformedImage();
      sawImageData = true;
    }
    if (type === 'IEND') {
      if (!sawImageData || dataLength !== 0 || end !== input.length) throw malformedImage();
      sawEnd = true;
    }

    if (!['eXIf', 'tEXt', 'zTXt', 'iTXt'].includes(type)) {
      parts.push(input.subarray(start, end));
    }
    offset = end;
    if (sawEnd) break;
  }

  if (!sawHeader || !sawImageData || !sawEnd || offset !== input.length) throw malformedImage();
  return Buffer.concat(parts);
}

function stripWebpMetadata(input: Buffer): Buffer {
  const declaredSize = input.readUInt32LE(4);
  if (declaredSize !== input.length - 8) throw malformedImage();

  const chunks: Buffer[] = [];
  let offset = 12;
  while (offset < input.length) {
    if (offset + 8 > input.length) throw malformedImage();
    const start = offset;
    const type = input.toString('ascii', offset, offset + 4);
    const dataLength = input.readUInt32LE(offset + 4);
    const paddedLength = dataLength + (dataLength % 2);
    const end = offset + 8 + paddedLength;
    if (end > input.length) throw malformedImage();

    if (type === 'VP8X') {
      if (dataLength !== 10) throw malformedImage();
      const extendedHeader = Buffer.from(input.subarray(offset + 8, offset + 18));
      extendedHeader[0] = extendedHeader[0]! & ~0x0c;
      chunks.push(Buffer.concat([input.subarray(start, start + 8), extendedHeader]));
    } else if (type !== 'EXIF' && type !== 'XMP ') {
      chunks.push(input.subarray(start, end));
    }
    offset = end;
  }

  if (offset !== input.length) throw malformedImage();
  const body = Buffer.concat([Buffer.from('WEBP'), ...chunks]);
  const size = Buffer.alloc(4);
  size.writeUInt32LE(body.length);
  return Buffer.concat([Buffer.from('RIFF'), size, body]);
}

function crc32(input: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of input) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) === 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function isJpegFrameMarker(marker: number): boolean {
  return (marker >= 0xc0 && marker <= 0xc3) ||
    (marker >= 0xc5 && marker <= 0xc7) ||
    (marker >= 0xc9 && marker <= 0xcb) ||
    (marker >= 0xcd && marker <= 0xcf);
}

function malformedImage(): EvidenceImageValidationError {
  return new EvidenceImageValidationError('Evidence image container is malformed');
}
