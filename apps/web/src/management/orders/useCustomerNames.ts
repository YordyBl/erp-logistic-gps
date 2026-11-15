import { useCallback, useEffect, useMemo, useState } from 'react';

import type { ApiClient } from '../../api/client.js';
import { fetchByIds } from '../routes/routeDetails.js';

type CustomerNamesClient = Pick<ApiClient, 'listCustomersPage'>;

export interface CustomerNames {
  /** Nombre del cliente; `undefined` si aún no se resolvió o no existe en la organización. */
  readonly nameOf: (customerId: string) => string | undefined;
  /** Hay ids de la página que todavía se están pidiendo. */
  readonly loading: boolean;
  readonly failed: boolean;
  /** Vuelve a pedir los ids que fallaron. */
  readonly retry: () => void;
}

/**
 * Resuelve los nombres de los clientes de una página de pedidos con `GET /customers?ids=` (en lotes
 * de 100). Recuerda los ya resueltos, incluidos los que no llegaron, y solo pide los nuevos cuando
 * cambian las filas.
 */
export function useCustomerNames(client: CustomerNamesClient, customerIds: readonly string[]): CustomerNames {
  // id → nombre, o `null` si el servidor no lo devolvió (otra organización o eliminado).
  const [known, setKnown] = useState<ReadonlyMap<string, string | null>>(new Map());
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const missing = useMemo(
    () => [...new Set(customerIds)].filter((id) => !known.has(id)).sort(),
    [customerIds, known],
  );
  const missingKey = missing.join(',');

  useEffect(() => {
    if (missing.length === 0) return;
    const controller = new AbortController();
    setFailed(false);
    fetchByIds((params, signal) => client.listCustomersPage(params, signal), missing, controller.signal).then((customers) => {
      if (controller.signal.aborted) return;
      setKnown((current) => {
        const next = new Map(current);
        for (const id of missing) next.set(id, null);
        for (const customer of customers) next.set(customer.id, customer.name);
        return next;
      });
    }, () => {
      if (!controller.signal.aborted) setFailed(true);
    });
    return () => controller.abort();
    // `missingKey` resume `missing`: un array nuevo con los mismos ids no repite la petición.
  }, [attempt, client, missingKey]);

  const nameOf = useCallback((customerId: string) => known.get(customerId) ?? undefined, [known]);
  const retry = useCallback(() => setAttempt((current) => current + 1), []);

  return { nameOf, loading: missing.length > 0 && !failed, failed, retry };
}
