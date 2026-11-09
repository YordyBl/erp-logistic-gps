import { useCallback, useRef } from 'react';

/**
 * Un Dialog controlado sin `DialogTrigger` no sabe a quién devolver el foco y lo deja en `body`,
 * con lo que quien usa teclado pierde su lugar. Se recuerda el elemento que lo abrió.
 */
export function useFocusReturn(initial?: Element | null) {
  const target = useRef<Element | null>(initial ?? null);

  const remember = useCallback((element: Element | null) => { target.current = element; }, []);
  const onCloseAutoFocus = useCallback((event: Event) => {
    event.preventDefault();
    if (target.current instanceof HTMLElement) target.current.focus();
  }, []);

  return { remember, onCloseAutoFocus };
}
