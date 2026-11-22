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
      gpsSimulationIntervalSeconds: 4,
      gpsSimulationTimeScale: 1,
      gpsPositionRetentionDays: 30,
      valhallaUrl: undefined,
      routeSimulationEnabled: false,
    });
  });

  it('enables route simulation only for an explicit development environment with Valhalla', () => {
    const valhalla = { VALHALLA_URL: 'http://valhalla:8002' };
    expect(loadConfig({ ...valhalla, NODE_ENV: 'development' }).routeSimulationEnabled).toBe(true);
    expect(loadConfig({ ...valhalla, NODE_ENV: ' development ' }).routeSimulationEnabled).toBe(true);
    expect(loadConfig(valhalla).routeSimulationEnabled).toBe(false);
    expect(loadConfig({ ...valhalla, NODE_ENV: 'test' }).routeSimulationEnabled).toBe(false);
    expect(loadConfig({ ...valhalla, NODE_ENV: 'production' }).routeSimulationEnabled).toBe(false);
    expect(loadConfig({ NODE_ENV: 'development' }).routeSimulationEnabled).toBe(false);
  });

  it('validates GPS simulation frequency and configurable history retention', () => {
    expect(loadConfig({ GPS_SIMULATION_INTERVAL_SECONDS: '3' }).gpsSimulationIntervalSeconds).toBe(3);
    expect(loadConfig({ GPS_SIMULATION_INTERVAL_SECONDS: '5' }).gpsSimulationIntervalSeconds).toBe(5);
    expect(loadConfig({ GPS_SIMULATION_INTERVAL_SECONDS: '3', GPS_POSITION_RETENTION_DAYS: '90' }))
      .toMatchObject({ gpsSimulationIntervalSeconds: 3, gpsPositionRetentionDays: 90 });
    expect(() => loadConfig({ GPS_SIMULATION_INTERVAL_SECONDS: '2' }))
      .toThrow('GPS_SIMULATION_INTERVAL_SECONDS must be an integer between 3 and 5, received "2"');
    expect(() => loadConfig({ GPS_SIMULATION_INTERVAL_SECONDS: '6' }))
      .toThrow('GPS_SIMULATION_INTERVAL_SECONDS must be an integer between 3 and 5, received "6"');
    expect(() => loadConfig({ GPS_POSITION_RETENTION_DAYS: '0' }))
      .toThrow('GPS_POSITION_RETENTION_DAYS must be a positive integer, received "0"');
    expect(loadConfig({ VALHALLA_URL: ' http://valhalla:8002/ ' }).valhallaUrl)
      .toBe('http://valhalla:8002');
    expect(() => loadConfig({ VALHALLA_URL: 'https://routing.example.com' }))
      .toThrow('VALHALLA_URL must be a local HTTP(S) URL without credentials or query parameters');
  });

  it('supports a bounded route-simulation time scale while defaulting to real time', () => {
    expect(loadConfig({ GPS_SIMULATION_TIME_SCALE: '60' }).gpsSimulationTimeScale).toBe(60);
    expect(() => loadConfig({ GPS_SIMULATION_TIME_SCALE: '0' }))
      .toThrow('GPS_SIMULATION_TIME_SCALE must be an integer between 1 and 100, received "0"');
    expect(() => loadConfig({ GPS_SIMULATION_TIME_SCALE: '101' }))
      .toThrow('GPS_SIMULATION_TIME_SCALE must be an integer between 1 and 100, received "101"');
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
