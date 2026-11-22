/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PageErrorBoundary } from './PageErrorBoundary.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('PageErrorBoundary', () => {
  it('replaces a crashed page with a recoverable message and retries on demand', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let shouldFail = true;
    function Page() {
      if (shouldFail) throw new Error('fallo al dibujar');
      return <h1>Pantalla recuperada</h1>;
    }

    render(<PageErrorBoundary><Page /></PageErrorBoundary>);
    expect(screen.getByRole('alert').textContent).toContain('No se pudo mostrar esta pantalla');

    shouldFail = false;
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(screen.getByRole('heading', { name: 'Pantalla recuperada' })).toBeTruthy();
  });
});
