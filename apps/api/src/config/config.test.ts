import { describe, expect, it } from 'vitest';

import { LIMA_TIME_ZONE, loadConfig } from './config.js';

describe('loadConfig', () => {
  it('applies development defaults', () => {
    expect(loadConfig({})).toEqual({
      environment: 'development',
      port: 3000,
      databaseUrl: undefined,
      timezone: LIMA_TIME_ZONE,
      logLevel: 'info',
    });
  });

  it('prefers PORT over the compose API_PORT and trims the value', () => {
    expect(loadConfig({ PORT: ' 4000 ', API_PORT: '5000' }).port).toBe(4000);
    expect(loadConfig({ API_PORT: '5001' }).port).toBe(5001);
  });

  it('rejects a non-numeric or out-of-range PORT', () => {
    expect(() => loadConfig({ PORT: 'abc' })).toThrow(
      'PORT must be an integer between 1 and 65535, received "abc"',
    );
    expect(() => loadConfig({ PORT: '70000' })).toThrow(
      'PORT must be an integer between 1 and 65535, received "70000"',
    );
  });

  it('keeps DATABASE_URL trimmed and treats a blank value as absent', () => {
    expect(
      loadConfig({ DATABASE_URL: ' postgres://erp@localhost:5432/erp ' })
        .databaseUrl,
    ).toBe('postgres://erp@localhost:5432/erp');
    expect(loadConfig({ DATABASE_URL: '   ' }).databaseUrl).toBeUndefined();
  });

  it('always reports America/Lima even when TZ says otherwise', () => {
    expect(loadConfig({ TZ: 'UTC' }).timezone).toBe('America/Lima');
  });

  it('normalizes LOG_LEVEL and rejects unknown levels', () => {
    expect(loadConfig({ LOG_LEVEL: 'DEBUG' }).logLevel).toBe('debug');
    expect(loadConfig({ LOG_LEVEL: 'warn' }).logLevel).toBe('warn');
    expect(() => loadConfig({ LOG_LEVEL: 'verbose' })).toThrow(
      'LOG_LEVEL must be one of trace, debug, info, warn, error, fatal, silent, received "verbose"',
    );
  });

  it('validates NODE_ENV against the supported environments', () => {
    expect(loadConfig({ NODE_ENV: 'production' }).environment).toBe('production');
    expect(loadConfig({ NODE_ENV: 'test' }).environment).toBe('test');
    expect(() => loadConfig({ NODE_ENV: 'staging' })).toThrow(
      'NODE_ENV must be one of development, test, production, received "staging"',
    );
  });
});
