/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { pickDay, setupUser } from '../test/ui.js';
import { DatePicker } from './DatePicker.js';

afterEach(cleanup);

describe('DatePicker', () => {
  it('muestra el placeholder y entrega el día elegido como YYYY-MM-DD', async () => {
    const user = setupUser();
    const onChange = vi.fn();
    render(<DatePicker id="fecha" value="" onChange={onChange} placeholder="Elige una fecha" />);

    const trigger = screen.getByRole('button', { name: /Elige una fecha/ });
    const expected = await pickDay(user, trigger, 15);

    expect(onChange).toHaveBeenCalledWith(expected);
  });

  it('muestra en español el mismo día que recibe, también si llega con hora', () => {
    const { rerender } = render(<DatePicker id="fecha" value="2026-11-06" onChange={vi.fn()} placeholder="Elige una fecha" />);
    expect(screen.getByRole('button').textContent).toMatch(/6 de noviembre de 2026/);

    rerender(<DatePicker id="fecha" value="2026-11-06T00:00:00.000Z" onChange={vi.fn()} placeholder="Elige una fecha" />);
    expect(screen.getByRole('button').textContent).toMatch(/6 de noviembre de 2026/);
  });

  it('se abre con teclado y se cierra con Escape sin cambiar el valor', async () => {
    const user = setupUser();
    const onChange = vi.fn();
    render(<DatePicker id="fecha" value="2026-11-06" onChange={onChange} placeholder="Elige una fecha" />);

    screen.getByRole('button').focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('grid')).toBeTruthy();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('grid')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });
});
