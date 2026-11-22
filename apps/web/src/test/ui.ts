import { screen, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';

/** Sin pausa entre teclas: la espera no aporta nada a lo que se verifica y alarga los formularios. */
export function setupUser(): UserEvent {
  return userEvent.setup({ delay: null });
}

/** Elige una opción en un Select de shadcn, que abre su lista fuera del árbol del formulario. */
export async function chooseOption(user: UserEvent, trigger: HTMLElement, name: string | RegExp): Promise<void> {
  await user.click(trigger);
  await user.click(await screen.findByRole('option', { name }));
}

/** Abre el menú de tres puntos de una fila y pulsa una de sus acciones. */
export async function chooseRowAction(user: UserEvent, menuLabel: string, action: string | RegExp): Promise<void> {
  await user.click(screen.getByRole('button', { name: menuLabel }));
  await user.click(await screen.findByRole('menuitem', { name: action }));
}

/** Elige un día del mes visible en un DatePicker de shadcn y devuelve la fecha que debe enviarse. */
export async function pickDay(user: UserEvent, trigger: HTMLElement, day: number): Promise<string> {
  await user.click(trigger);
  const grid = await screen.findByRole('grid');
  await user.click(within(grid).getByRole('button', { name: new RegExp(`\\b${day} de `) }));
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
