import { useState } from 'react';

import type { ApiClient, DeliveryOrder } from '../api/client.js';

export type SidebarOrdersState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly orders: readonly DeliveryOrder[] };

/** Los pedidos del árbol lateral se piden cada vez que el grupo se abre, para incluir los recién creados. */
export function useSidebarOrders(client: Pick<ApiClient, 'listDeliveryOrders'>) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<SidebarOrdersState>({ status: 'idle' });

  async function toggle(): Promise<void> {
    const next = !open;
    setOpen(next);
    if (!next || state.status === 'loading') return;
    setState({ status: 'loading' });
    try {
      setState({ status: 'ready', orders: await client.listDeliveryOrders() });
    } catch {
      setState({ status: 'error' });
    }
  }

  return { open, state, toggle };
}
