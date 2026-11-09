/**
 * Un panel abierto desde un menú o una fila no encuentra a quién devolver el foco: el menú ya se
 * cerró y una fila no recibe foco. Quien abre deja aquí el control al que debe volver.
 */
let opener: HTMLElement | null = null;

export function rememberOpener(element: HTMLElement | null): void {
  opener = element;
}

/** El elemento enfocado, o el último control registrado si el foco quedó en un menú o en `body`. */
export function resolveOpener(): Element | null {
  const active = document.activeElement;
  const lostFocus = active === null || active === document.body || active.closest('[role="menu"]') !== null;
  return lostFocus ? opener : active;
}
