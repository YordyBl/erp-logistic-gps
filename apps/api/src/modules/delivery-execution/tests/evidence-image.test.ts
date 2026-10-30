import { describe, expect, it } from 'vitest';

import {
  EvidenceImageValidationError,
  prepareEvidenceImage,
} from '../domain/EvidenceImage.js';

function jpegWithExif(): Buffer {
  return Buffer.from([
    0xff, 0xd8,
    0xff, 0xe1, 0x00, 0x0a, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
    0x01, 0x02,
    0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00,
    0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x11, 0x22,
    0xff, 0xd9,
  ]);
}

function jpegWithoutFrame(): Buffer {
  const image = jpegWithExif();
  const frameStart = image.indexOf(Buffer.from([0xff, 0xc0]));
  const scanStart = image.indexOf(Buffer.from([0xff, 0xda]));
  return Buffer.concat([image.subarray(0, frameStart), image.subarray(scanStart)]);
}

function jpegAtSize(size: number): Buffer {
  const jpeg = jpegWithExif();
  const scanStart = jpeg.indexOf(Buffer.from([0xff, 0xda]));
  const scanHeaderEnd = scanStart + 10;
  if (size < scanHeaderEnd + 2) throw new Error('Requested JPEG fixture size is too small');
  const image = Buffer.alloc(size, 0x11);
  jpeg.copy(image, 0, 0, scanHeaderEnd);
  image[image.length - 2] = 0xff;
  image[image.length - 1] = 0xd9;
  return image;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const header = Buffer.alloc(4);
  header.writeUInt32BE(data.length);
  const name = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([name, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcInput));
  return Buffer.concat([header, name, data, crc]);
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

function pngWithExif(): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    signature,
    pngChunk('IHDR', header),
    pngChunk('IDAT', Buffer.from([0x78, 0x9c, 0x63, 0x60, 0x64, 0x62, 0x06, 0x00, 0x00, 0x0d, 0x00, 0x07])),
    pngChunk('eXIf', Buffer.from('gps')),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function pngWithZeroFilledHeader(): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    signature,
    pngChunk('IHDR', Buffer.alloc(13)),
    pngChunk('IDAT', Buffer.from([0x78, 0x9c, 0x63, 0x60, 0x64, 0x62, 0x06, 0x00, 0x00, 0x0d, 0x00, 0x07])),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function webpWithExif(): Buffer {
  const vp8xData = Buffer.alloc(10);
  vp8xData[0] = 0x08;
  const chunks = [
    Buffer.concat([Buffer.from('VP8X'), Buffer.from([10, 0, 0, 0]), vp8xData]),
    Buffer.concat([Buffer.from('EXIF'), Buffer.from([3, 0, 0, 0]), Buffer.from('gps'), Buffer.from([0])]),
    Buffer.concat([Buffer.from('VP8 '), Buffer.from([1, 0, 0, 0]), Buffer.from([0x2f, 0])]),
  ];
  const body = Buffer.concat([Buffer.from('WEBP'), ...chunks]);
  const size = Buffer.alloc(4);
  size.writeUInt32LE(body.length);
  return Buffer.concat([Buffer.from('RIFF'), size, body]);
}

describe('prepareEvidenceImage', () => {
  it('accepts JPEG content and removes EXIF APP1 metadata', () => {
    const input = jpegWithExif();

    const result = prepareEvidenceImage(input, 'image/jpeg');

    expect(result.mimeType).toBe('image/jpeg');
    expect(result.bytes).not.toContain(Buffer.from('Exif'));
    expect(result.bytes.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    expect(result.bytes.indexOf(Buffer.from([0xff, 0xda]))).toBeGreaterThanOrEqual(0);
  });

  it('removes PNG eXIf chunks while preserving other chunks', () => {
    const result = prepareEvidenceImage(pngWithExif(), 'image/png');

    expect(result.bytes.includes(Buffer.from('eXIf'))).toBe(false);
    expect(result.bytes.includes(Buffer.from('IHDR'))).toBe(true);
    expect(result.bytes.includes(Buffer.from('IEND'))).toBe(true);
  });

  it('removes WebP EXIF chunks and clears the VP8X metadata flag', () => {
    const result = prepareEvidenceImage(webpWithExif(), 'image/webp');

    expect(result.bytes.includes(Buffer.from('EXIF'))).toBe(false);
    expect(result.bytes[20]! & 0x08).toBe(0);
  });

  it('rejects a declared content type that does not match the file bytes', () => {
    expect(() => prepareEvidenceImage(jpegWithExif(), 'image/png'))
      .toThrow(EvidenceImageValidationError);
  });

  it('rejects unsupported content and malformed containers', () => {
    expect(() => prepareEvidenceImage(Buffer.from('not an image'), 'image/jpeg'))
      .toThrow(EvidenceImageValidationError);
    expect(() => prepareEvidenceImage(Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0, 30]), 'image/jpeg'))
      .toThrow(EvidenceImageValidationError);
  });

  it('rejects JPEG marker data without a frame and PNG data with a zero-filled IHDR', () => {
    expect(() => prepareEvidenceImage(jpegWithoutFrame(), 'image/jpeg'))
      .toThrow(EvidenceImageValidationError);
    expect(() => prepareEvidenceImage(pngWithZeroFilledHeader(), 'image/png'))
      .toThrow(EvidenceImageValidationError);
  });

  it('enforces the 5,000,000-byte limit before parsing', () => {
    expect(() => prepareEvidenceImage(jpegAtSize(5_000_000), 'image/jpeg')).not.toThrow();

    const tooLarge = Buffer.alloc(5_000_001);
    tooLarge.set([0xff, 0xd8, 0xff, 0xd9]);

    expect(() => prepareEvidenceImage(tooLarge, 'image/jpeg'))
      .toThrow(EvidenceImageValidationError);
  });
});
