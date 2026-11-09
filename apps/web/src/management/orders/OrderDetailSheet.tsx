import { CirclePlus, Package } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import type { ApiClient, DeliveryOrder, DeliveryOrderStatusHistory } from '../../api/client.js';
import { ActivityTimeline, type TimelineEvent } from '../../components/ActivityTimeline.js';
import { DocumentSheet, DocumentTitle, DocumentTotal } from '../../components/FormSheet.js';
import type { IconChipTone } from '../../components/IconChip.js';
import { ErrorNotice, LoadingRows } from '../../components/Notices.js';
import { ORDER_STATUS_ICONS, OrderStatusBadge } from '../../components/OrderStatusBadge.js';
import { Button } from '../../components/ui/button.js';
import { ORDER_STATUS_LABELS } from '../../delivery/orderStatus.js';
import { formatDateTime } from '../../lib/format.js';

type DetailClient = Pick<ApiClient, 'listDeliveryOrderStatusHistory'>;

const STATUS_TONES: Record<DeliveryOrder['status'], IconChipTone> = {
  created: 'neutral', planned: 'neutral', assigned: 'neutral', in_transit: 'warning',
  delivered: 'success', returned: 'destructive', cancelled: 'neutral',
};

/** Detalle de un pedido como documento: datos de entrega, bultos e historial de estados. */
export function OrderDetailSheet({ client, order, customerName, onClose, footer }: {
  readonly client: DetailClient;
  readonly order: DeliveryOrder | null;
  readonly customerName?: string | undefined;
  readonly onClose: () => void;
  readonly footer?: ReactNode;
}) {
  return (
    <DocumentSheet open={order !== null} onOpenChange={(open) => { if (!open) onClose(); }} icon={Package}
      title={order?.publicCode ?? 'Pedido'} description="Datos de entrega, bultos e historial del pedido."
      {...(footer === undefined ? {} : { footer })}>
      {order !== null && <OrderDocument key={order.id} client={client} order={order} customerName={customerName} />}
    </DocumentSheet>
  );
}

function OrderDocument({ client, order, customerName }: {
  readonly client: DetailClient;
  readonly order: DeliveryOrder;
  readonly customerName: string | undefined;
}) {
  const totalWeight = order.packages.reduce((total, item) => total + (item.weightKg ?? 0), 0);

  return (
    <>
      <DocumentTitle title="PEDIDO" aside={<OrderStatusBadge status={order.status} />}>
        <span>N°: <span className="text-foreground">{order.publicCode}</span></span>
        <span>Creado: <time className="text-foreground" dateTime={order.createdAt}>{formatDateTime(order.createdAt)}</time></span>
        <span>Actualizado: <time className="text-foreground" dateTime={order.updatedAt}>{formatDateTime(order.updatedAt)}</time></span>
      </DocumentTitle>

      <div className="grid gap-6 sm:grid-cols-2">
        <DocumentBlock title="Destinatario">
          <p className="font-medium">{order.recipient.name}</p>
          <p>{order.recipient.phone}</p>
          {customerName !== undefined && <p className="text-muted-foreground">Cliente: {customerName}</p>}
        </DocumentBlock>
        <DocumentBlock title="Entrega">
          <p className="font-medium">{order.deliveryAddress.addressLine}</p>
          <p>{order.deliveryAddress.district}</p>
          <p className="text-muted-foreground">Franja {order.timeWindow}</p>
        </DocumentBlock>
      </div>

      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_4rem] gap-3 text-[0.6875rem] text-muted-foreground">
          <span>Código</span><span>Descripción</span><span className="text-right">Peso</span>
        </div>
        {order.packages.length === 0 && <p className="text-xs text-muted-foreground">Sin bultos registrados.</p>}
        {order.packages.map((item) => (
          <div key={item.code} className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_4rem] gap-3 text-xs">
            <span className="truncate">{item.code}</span>
            <span>{item.description}</span>
            <span className="text-right tabular-nums">{item.weightKg === null ? '—' : `${item.weightKg} kg`}</span>
          </div>
        ))}
        <div className="mt-4 ml-auto flex w-full max-w-56 flex-col">
          <DocumentTotal label="Bultos" value={order.packages.length.toLocaleString('es-PE')} />
          <DocumentTotal label="Peso total" value={`${totalWeight.toLocaleString('es-PE')} kg`} strong />
        </div>
      </div>

      <OrderHistory client={client} order={order} />
    </>
  );
}

function DocumentBlock({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 text-xs">
      <h4 className="mb-1 text-[0.6875rem] font-normal text-muted-foreground">{title}</h4>
      {children}
    </div>
  );
}

function OrderHistory({ client, order }: { readonly client: DetailClient; readonly order: DeliveryOrder }) {
  const [events, setEvents] = useState<readonly DeliveryOrderStatusHistory[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    setEvents(null);
    try {
      setEvents(await client.listDeliveryOrderStatusHistory(order.id));
    } catch {
      setFailed(true);
    }
  }, [client, order.id]);

  useEffect(() => { void load(); }, [load]);

  const created: TimelineEvent = { id: 'created', occurredAt: order.createdAt, title: 'Pedido registrado', icon: CirclePlus };

  return (
    <section className="flex flex-col gap-3" aria-label="Historial del pedido">
      <h4 className="text-[0.6875rem] font-normal text-muted-foreground">Historial</h4>
      {failed && (
        <ErrorNotice action={<Button type="button" variant="outline" className="mt-2" onClick={() => void load()}>Reintentar</Button>}>
          No se pudo cargar el historial. Inténtalo de nuevo.
        </ErrorNotice>
      )}
      {!failed && events === null && <LoadingRows label="Cargando historial…" rows={2} />}
      {events !== null && (
        <>
          <ActivityTimeline label={`Historial ${order.publicCode}`} events={[
            ...[...events].reverse().map((event, index): TimelineEvent => ({
              id: `${event.occurredAt}-${index}`,
              occurredAt: event.occurredAt,
              title: `${event.toStatus === 'returned' ? 'Incidencia reportada · ' : ''}${ORDER_STATUS_LABELS[event.fromStatus]} → ${ORDER_STATUS_LABELS[event.toStatus]}`,
              icon: ORDER_STATUS_ICONS[event.toStatus],
              tone: STATUS_TONES[event.toStatus],
            })),
            created,
          ]} />
          {events.length === 0 && <p className="text-xs text-muted-foreground">Sin cambios de estado registrados.</p>}
        </>
      )}
    </section>
  );
}
