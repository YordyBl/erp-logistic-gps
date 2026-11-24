import { describe, expect, it } from 'vitest';

import { toCsv } from './download.js';

describe('toCsv', () => {
  it('separa con punto y coma, empieza con BOM y termina cada fila en CRLF', () => {
    expect(toCsv([['Distrito', 'Pedidos'], ['Miraflores', 12]])).toBe('﻿Distrito;Pedidos\r\nMiraflores;12\r\n');
  });

  it('entrecomilla los textos con separador, comillas o saltos de línea y deja vacío lo nulo', () => {
    expect(toCsv([['Cercado; Lima', 'Dijo "hola"', 'dos\nlíneas', null]]))
      .toBe('﻿"Cercado; Lima";"Dijo ""hola""";"dos\nlíneas";\r\n');
  });
});
