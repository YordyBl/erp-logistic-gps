import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * Structural contract for the demo seed (S9).
 *
 * These source assertions pin the properties that cannot be exercised without
 * a live database: real production wiring, the production-environment refusal,
 * existence checks before every create (idempotency), and demo-only credential
 * printing. They are a safety net, not a replacement for the with-database
 * seed run documented in the feature doc.
 */
const source = readFileSync(new URL('./seed-demo.ts', import.meta.url), 'utf8');

describe('demo seed contract', () => {
  it('uses the production composition with the PostgreSQL data source', () => {
    expect(source).toContain('composeApiModules(dataSource, authConfig)');
    expect(source).not.toContain('buildInMemory');
  });

  it('refuses to run in production', () => {
    expect(source).toContain("config.environment === 'production'");
    expect(source).toContain('refusing to run with NODE_ENV=production');
  });

  it('checks organization and user existence before creation', () => {
    expect(source).toContain('where: { name: DEMO_ORGANIZATION_NAME }');
    expect(source).toContain('identity.users.findByEmail(');
    expect(source).toContain('if (existing !== null)');
  });

  it('bootstraps the ADMIN outside CreateUserUseCase', () => {
    expect(source).toContain('requires an existing ADMIN actor');
  });

  it('prints the demo-only credentials exactly once', () => {
    expect(source).toContain('DEMO CREDENTIALS');
    expect(source.match(/printDemoCredentials\(organization\.id\)/g)).toHaveLength(1);
  });
});
