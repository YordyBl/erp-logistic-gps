import { ArrowRight, Check, Package, Route } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { ApiError, type ApiClient, type DeliveryOrder, type DeliveryRoute } from '../api/client.js';
import { ErrorNotice, LoadingRows } from '../components/Notices.js';
import { OrderStatusBadge } from '../components/OrderStatusBadge.js';
import { PageHeader } from '../components/PageHeader.js';
import { Badge } from '../components/ui/badge.js';
import { Button } from '../components/ui/button.js';
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../components/ui/card.js';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../components/ui/empty.js';
import { Progress } from '../components/ui/progress.js';
import { formatTime, formatToday } from '../lib/format.js';
import { OutcomeDialog } from './OutcomeDialog.js';
import { ROUTE_STATUS_LABELS } from './orderStatus.js';

const ROUTE_BADGES = { planned: 'secondary', in_progress: 'warning', completed: 'success' } as const;

export function DriverWorkspace({ client }: { readonly client: ApiClient }) {
  const [route, setRoute] = useState<DeliveryRoute | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ order: DeliveryOrder; outcome: 'delivery' | 'incident' } | null>(null);

  const loadRoute = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRoute(await client.getMyRoute());
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 404) setRoute(null);
      else setError('No se pudo cargar la ruta. Revisa la conexión e inténtalo otra vez.');
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => { void loadRoute(); }, [loadRoute]);

  const orders = useMemo(() => route?.stops.flatMap((stop) => stop.orders) ?? [], [route]);
  const completedOrders = orders.filter((order) => order.status === 'delivered' || order.status === 'returned').length;
  const allOutcomesRecorded = orders.length > 0 && completedOrders === orders.length;
  const progress = orders.length === 0 ? 0 : Math.round((completedOrders / orders.length) * 100);

  async function transition(action: () => Promise<DeliveryRoute>): Promise<void> {
    setBusy(true);
    setError(null);
    try { setRoute(await action()); }
    catch { setError('No se pudo actualizar la ruta. El estado no cambió; vuelve a intentarlo.'); }
    finally { setBusy(false); }
  }

  if (loading) return <LoadingRows label="Cargando ruta…" />;

  return (
    <>
      <PageHeader title="Mi ruta"
        description="Cada pedido tiene su propio resultado. La ruta se cierra cuando todas las paradas están resueltas.">
        <span className="text-sm text-muted-foreground first-letter:uppercase">{formatToday()}</span>
      </PageHeader>

      {error !== null && (
        <ErrorNotice action={<Button variant="outline" className="mt-2" onClick={() => void loadRoute()}>Reintentar</Button>}>{error}</ErrorNotice>
      )}

      {route === null ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon"><Route aria-hidden="true" /></EmptyMedia>
            <EmptyTitle>Sin ruta asignada</EmptyTitle>
            <EmptyDescription>Cuando el operador te asigne una ruta, aparecerá aquí con sus paradas y pedidos.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent><Button variant="outline" onClick={() => void loadRoute()}>Actualizar</Button></EmptyContent>
        </Empty>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardDescription>HOJA DE RUTA <span>{route.publicCode}</span></CardDescription>
              <CardTitle><h2>{route.stops.length} {route.stops.length === 1 ? 'parada' : 'paradas'} · {orders.length} {orders.length === 1 ? 'pedido' : 'pedidos'}</h2></CardTitle>
              <CardAction><Badge variant={ROUTE_BADGES[route.status]}>{ROUTE_STATUS_LABELS[route.status]}</Badge></CardAction>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <p className="text-sm text-muted-foreground">{route.startedAt === null ? 'Lista para iniciar' : `Iniciada ${formatTime(route.startedAt)}`}</p>
              <div className="flex items-center justify-between gap-4 text-sm">
                <span>Progreso de pedidos</span>
                <span className="tabular-nums">{completedOrders}/{orders.length} · {progress}% completado</span>
              </div>
              <Progress value={progress} aria-label={`${completedOrders} de ${orders.length} pedidos resueltos`} />
            </CardContent>
            {route.status === 'planned' && (
              <CardFooter>
                <Button onClick={() => void transition(() => client.startRoute(route.id))} disabled={busy}>
                  {busy ? 'Iniciando…' : 'Iniciar ruta'} <ArrowRight data-icon="inline-end" aria-hidden="true" />
                </Button>
              </CardFooter>
            )}
            {route.status === 'in_progress' && allOutcomesRecorded && (
              <CardFooter>
                <Button onClick={() => void transition(() => client.completeRoute(route.id))} disabled={busy}>
                  {busy ? 'Cerrando…' : 'Finalizar ruta'} <Check data-icon="inline-end" aria-hidden="true" />
                </Button>
              </CardFooter>
            )}
            {route.status === 'completed' && <CardFooter><Badge variant="success">Ruta finalizada</Badge></CardFooter>}
          </Card>

          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-lg font-semibold">Secuencia de paradas</h2>
            <span className="text-sm text-muted-foreground">{orders.length - completedOrders} pendientes</span>
          </div>
          <ol className="flex flex-col gap-4">
            {route.stops.map((stop) => (
              <li key={stop.id}>
                <Card>
                  <CardHeader>
                    <CardTitle><h3>{String(stop.sequence).padStart(2, '0')} · {stop.addressLine}</h3></CardTitle>
                    <CardDescription>{stop.orders[0]?.deliveryAddress.district ?? 'Dirección de entrega'}</CardDescription>
                    <CardAction><Badge variant="outline">{stop.orders.length} {stop.orders.length === 1 ? 'pedido' : 'pedidos'}</Badge></CardAction>
                  </CardHeader>
                  <CardContent className="flex flex-col divide-y">
                    {stop.orders.map((order) => (
                      <article key={order.id} className="flex flex-wrap items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                        <div className="flex min-w-0 flex-col gap-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium">{order.publicCode}</span>
                            <OrderStatusBadge status={order.status} />
                          </div>
                          <h4 className="text-sm font-medium">{order.recipient.name}</h4>
                          <p className="text-sm text-muted-foreground">{order.deliveryAddress.addressLine} · {order.deliveryAddress.district}</p>
                          <span className="flex items-center gap-1 text-sm text-muted-foreground">
                            <Package className="size-4" aria-hidden="true" /> {order.packages.length} {order.packages.length === 1 ? 'bulto' : 'bultos'}
                          </span>
                        </div>
                        <OrderActions routeStatus={route.status} order={order}
                          onSelect={(outcome) => setSelected({ order, outcome })} />
                      </article>
                    ))}
                  </CardContent>
                </Card>
              </li>
            ))}
          </ol>
          {route.status === 'in_progress' && !allOutcomesRecorded && (
            <p className="text-sm text-muted-foreground">La ruta permanecerá abierta hasta registrar un resultado para cada pedido.</p>
          )}
        </>
      )}

      {selected !== null && <OutcomeDialog order={selected.order} client={client} outcome={selected.outcome}
        onClose={() => setSelected(null)} onComplete={async () => { setSelected(null); await loadRoute(); }} />}
    </>
  );
}

function OrderActions({ routeStatus, order, onSelect }: {
  readonly routeStatus: DeliveryRoute['status'];
  readonly order: DeliveryOrder;
  readonly onSelect: (outcome: 'delivery' | 'incident') => void;
}) {
  if (order.status === 'delivered') return <Badge variant="success"><Check aria-hidden="true" /> Entregado</Badge>;
  if (order.status === 'returned') return <Badge variant="destructive">Devuelto a almacén</Badge>;
  if (routeStatus !== 'in_progress') return <span className="text-sm text-muted-foreground">Inicia la ruta para registrar resultados</span>;
  return (
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => onSelect('delivery')}><Check data-icon="inline-start" aria-hidden="true" /> Entrega</Button>
      <Button variant="ghost" onClick={() => onSelect('incident')}>Incidencia</Button>
    </div>
  );
}
