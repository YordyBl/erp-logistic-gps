import { pino, type DestinationStream, type Logger, type LoggerOptions } from 'pino';

import { LIMA_TIME_ZONE, type LogLevel } from '../config/config.js';

/**
 * Structured JSON logger.
 *
 * Every log line carries an America/Lima timestamp with an explicit `-05:00`
 * offset (plan §2). The offset is part of the rendered value, so consumers do
 * not need to know the process timezone to read the log.
 */

const LIMA_OFFSET = '-05:00';

/**
 * Headers that must never reach the log stream.
 *
 * `req.body` is not logged at all, so recipient personal data never appears in
 * request logs; these paths cover credentials carried in headers.
 */
const REDACTED_LOG_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.headers["x-auth-token"]',
  'res.headers["set-cookie"]',
];

export function createLogger(
  level: LogLevel,
  destination?: DestinationStream,
): Logger {
  const options: LoggerOptions = {
    level,
    timestamp: limaTimestamp,
    redact: {
      paths: REDACTED_LOG_PATHS,
      censor: '[Redacted]',
    },
  };

  return destination === undefined ? pino(options) : pino(options, destination);
}

/** pino custom timestamp: pino expects the full `,"time":"..."` JSON fragment. */
export function limaTimestamp(): string {
  return `,"time":"${formatLimaInstant(new Date())}"`;
}

const limaFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: LIMA_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/**
 * Formats an instant at the Lima offset.
 *
 * Lima has no daylight saving time, so the offset is constant. Milliseconds are
 * timezone-independent and taken directly from the instant.
 */
export function formatLimaInstant(instant: Date): string {
  const parts = new Map(
    limaFormatter.formatToParts(instant).map((part) => [part.type, part.value]),
  );
  const milliseconds = String(instant.getUTCMilliseconds()).padStart(3, '0');

  const year = parts.get('year') ?? '0000';
  const month = parts.get('month') ?? '00';
  const day = parts.get('day') ?? '00';
  const hour = parts.get('hour') ?? '00';
  const minute = parts.get('minute') ?? '00';
  const second = parts.get('second') ?? '00';

  return `${year}-${month}-${day}T${hour}:${minute}:${second}.${milliseconds}${LIMA_OFFSET}`;
}
