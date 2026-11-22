import { vi } from 'vitest';

// Solo las pruebas de interfaz: las de la API corren en node y conservan el límite por defecto.
if (typeof window !== 'undefined') {
  /*
   * Cada tecla simulada vuelve a renderizar la página. Con la CPU compartida, los tests que llenan
   * formularios completos superaban los 5 s por defecto y fallaban sin que nada estuviera mal.
   */
  vi.setConfig({ testTimeout: 30_000 });

  // jsdom no implementa estas API, que usan Radix y Recharts.
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => undefined;
  Element.prototype.releasePointerCapture ??= () => undefined;
  Element.prototype.scrollIntoView ??= () => undefined;
  window.ResizeObserver ??= class {
    observe(): void { /* sin efecto en jsdom */ }
    unobserve(): void { /* sin efecto en jsdom */ }
    disconnect(): void { /* sin efecto en jsdom */ }
  };
  window.matchMedia ??= (query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: () => undefined, removeEventListener: () => undefined,
    addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false,
  });
}
