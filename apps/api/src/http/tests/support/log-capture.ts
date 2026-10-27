import { Writable } from 'node:stream';

import type { Logger } from 'pino';

import { createLogger } from '../../logger.js';

export interface CapturedLogger {
  readonly logger: Logger;
  readonly lines: string[];
}

/**
 * pino destination that keeps every JSON log line in memory so tests can assert
 * on structured fields (correlation ids, redaction, timezone) instead of on
 * unparsed text. It goes through the real logger factory so the tests exercise
 * the production timestamp and redaction configuration.
 */
export function captureLogger(): CapturedLogger {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });

  return { logger: createLogger('info', stream), lines };
}

/**
 * Waits for pino-http's completion log, which is written from the response
 * `finish` listener and can land just after the client sees the response.
 */
export async function waitForLog(
  lines: readonly string[],
  predicate: (line: string) => boolean,
): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const match = lines.find((line) => predicate(line));
    if (match !== undefined) {
      return match;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(`Expected log line was not written. Captured lines:\n${lines.join('\n')}`);
}

export function parseLogLine<T>(line: string): T {
  return JSON.parse(line) as T;
}
