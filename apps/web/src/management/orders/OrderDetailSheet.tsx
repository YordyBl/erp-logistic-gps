import { Camera } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import type { ApiClient, DeliveryEvidence, DeliveryOrder, DeliveryOrderStatusHistory } from '../../api/client.js';
import { DetailField, DetailFields, DetailSection, DetailSheet, StatusTrail, type TrailEvent } from '../../components/DetailSheet.js';
import { MapLink } from '../../components/MapLink.js';
import { ErrorNotice, LoadingRows } from '../../components/Notices.js';
import { OrderStatusBadge } from '../../components/OrderStatusBadge.js';
import { Button } from '../../components/ui/button.js';
import { Skeleton } from '../../components/ui/skeleton.js';
import { EvidenceThumb } from '../../delivery/EvidenceThumb.js';
import { ORDER_STATUS_LABELS } from '../../delivery/orderStatus.js';
import { formatDateTime } from '../../lib/format.js';
import { googleMapsPlaceUrl } from '../../lib/googleMaps.js';
import { STATUS_COLORS } from '../dashboard/orderStatus.js';

export type OrderDetailClient = Pick<ApiClient, 'listDeliveryOrderStatusHistory' | 'listEvidence' | 'downloadEvidence'>;

const NUMBER = new Intl.NumberFormat('es-PE');

/** Detalle de un pedido: datos de entrega y bultos, recorrido de estados y foto de cierre. */
export function OrderDetailSheet({ client, order, customerName, onClose, footer }: {
  readonly client: OrderDetailClient;
  readonly order: DeliveryOrder | null;
  readonly customerName?: string | undefined;
  readonly onClose: () => void;
  readonly footer?: ReactNode;
}) {
  return (
    <DetailSheet open={order !== null} onOpenChange={(open) => { if (!open) onClose(); }}
      eyebrow="Pedido" title={order?.publicCode ?? 'Pedido'} description="Datos de entrega, bultos e historial del pedido."
      {...(order === null ? {} : { status: <OrderStatusBadge status={order.status} /> })}
      {...(footer === undefined ? {} : { footer })}>
      {order !== null && <OrderDetail key={order.id} client={client} order={order} customerName={customerName} />}
    </DetailSheet>
  );
}

function OrderDetail({ client, order, customerName }: {
  readonly client: OrderDetailClient;
  readonly order: DeliveryOrder;
  readonly customerName: string | undefined;
}) {
  const totalWeight = order.packages.reduce((total, item) => total + (item.weightKg ?? 0), 0);
  const bultos = order.packages.length === 1 ? '1 bulto' : `${NUMBER.format(order.packages.length)} bultos`;

  return (
    <>
      <DetailFields>
        {customerName !== undefined && <DetailField label="Cliente">{customerName}</DetailField>}
        <DetailField label="Recibe">
          {order.recipient.name} · <span className="font-mono tabular-nums">{order.recipient.phone}</span>
        </DetailField>
        <DetailField label="Dirección">
          <span className="flex flex-col">
            <span>{order.deliveryAddress.addressLine}</span>
            <span className="text-muted-foreground">{order.deliveryAddress.district}</span>
          </span>
          <DeliveryLocation order={order} />
        </DetailField>
        <DetailField label="Franja"><span className="font-mono">{order.timeWindow}</span></DetailField>
        <DetailField label="Paquetes">
          {order.packages.length === 0
            ? <span className="text-muted-foreground">Sin bultos registrados.</span>
            : (
              <span className="flex flex-col gap-1">
                <span>{bultos} · <span className="font-mono tabular-nums">{NUMBER.format(totalWeight)} kg</span></span>
                <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
                  {order.packages.map((item) => (
                    <li key={item.code} className="flex justify-between gap-3">
                      <span className="min-w-0 truncate"><span className="font-mono">{item.code}</span> · {item.description}</span>
                      <span className="shrink-0 font-mono tabular-nums">{item.weightKg === null ? '—' : `${NUMBER.format(item.weightKg)} kg`}</span>
                    </li>
                  ))}
                </ul>
              </span>
            )}
        </DetailField>
        <DetailField label="Creado"><time dateTime={order.createdAt}>{formatDateTime(order.createdAt)}</time></DetailField>
        <DetailField label="Actualizado"><time dateTime={order.updatedAt}>{formatDateTime(order.updatedAt)}</time></DetailField>
      </DetailFields>

      <OrderHistory client={client} order={order} />
      <DeliveryPhoto client={client} order={order} />
    </>
  );
}

/**
 * The pin is placed on the stored coordinates (what route stops copy), not on the
 * address text, so the operator can check that both point to the same place.
 */
function DeliveryLocation({ order }: { readonly order: DeliveryOrder }) {
  const { latitude, longitude } = order.deliveryAddress;
  if (latitude === null || longitude === null) {
    return <p className="mt-1 text-xs text-muted-foreground">Sin coordenadas registradas.</p>;
  }
  return (
    <div className="mt-2 flex flex-col items-start gap-1.5">
      <p className="font-mono text-xs text-muted-foreground tabular-nums">Lat {latitude} · Lng {longitude}</p>
      <MapLink href={googleMapsPlaceUrl({ latitude, longitude })} label="Ver ubicación en Google Maps" variant="outline" />
    </div>
  );
}

function OrderHistory({ client, order }: { readonly client: OrderDetailClient; readonly order: DeliveryOrder }) {
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

  const created: TrailEvent = { id: 'created', occurredAt: order.createdAt, title: 'Pedido registrado', color: STATUS_COLORS.created };

  return (
    <DetailSection title="Recorrido del pedido">
      {failed && (
        <ErrorNotice action={<Button type="button" variant="outline" className="mt-2" onClick={() => void load()}>Reintentar</Button>}>
          No se pudo cargar el historial. Inténtalo de nuevo.
        </ErrorNotice>
      )}
      {!failed && events === null && <LoadingRows label="Cargando historial…" rows={2} />}
      {events !== null && (
        <>
          <StatusTrail label={`Historial ${order.publicCode}`} events={[
            ...[...events].reverse().map((event, index): TrailEvent => ({
              id: `${event.occurredAt}-${index}`,
              occurredAt: event.occurredAt,
              title: ORDER_STATUS_LABELS[event.toStatus],
              detail: `${event.toStatus === 'returned' ? 'Incidencia reportada · desde' : 'Desde'} ${ORDER_STATUS_LABELS[event.fromStatus]}`,
              color: STATUS_COLORS[event.toStatus],
            })),
            created,
          ]} />
          {events.length === 0 && <p className="text-xs text-muted-foreground">Sin cambios de estado registrados.</p>}
        </>
      )}
    </DetailSection>
  );
}

/** Solo un pedido cerrado (entregado o devuelto) puede tener foto; se muestra la más reciente. */
function DeliveryPhoto({ client, order }: { readonly client: OrderDetailClient; readonly order: DeliveryOrder }) {
  const closed = order.status === 'delivered' || order.status === 'returned';
  const [photo, setPhoto] = useState<DeliveryEvidence | null | undefined>(closed ? undefined : null);

  useEffect(() => {
    if (!closed) return;
    let current = true;
    client.listEvidence(order.id).then((items) => {
      if (!current) return;
      const latest = [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      setPhoto(latest ?? null);
    }).catch(() => { if (current) setPhoto(null); });
    return () => { current = false; };
  }, [client, closed, order.id]);

  if (photo === undefined) return <Skeleton className="aspect-[4/3] w-full" />;
  if (photo !== null) {
    return (
      <DetailSection title={photo.incidentId === null ? 'Foto de entrega' : 'Foto de la incidencia'}>
        <EvidenceThumb client={client} evidenceId={photo.id} alt={`Evidencia del pedido ${order.publicCode}`} />
      </DetailSection>
    );
  }
  return (
    <div className="flex items-center gap-3 rounded-lg border border-dashed bg-muted/40 p-3.5">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Camera className="size-4" aria-hidden="true" />
      </span>
      <p className="text-sm text-muted-foreground">
        {closed ? 'Este pedido no tiene foto guardada.' : 'La foto de entrega aparecerá aquí cuando el conductor cierre la parada.'}
      </p>
    </div>
  );
}
