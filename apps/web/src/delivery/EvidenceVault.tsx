import { Camera, ChevronLeft, ChevronRight, Download, Eye, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { ApiClient, DeliveryEvidence, DeliveryOrder } from '../api/client.js';
import { ErrorNotice } from '../components/Notices.js';
import { Badge } from '../components/ui/badge.js';
import { Button } from '../components/ui/button.js';
import { Card, CardContent } from '../components/ui/card.js';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../components/ui/empty.js';
import { Skeleton } from '../components/ui/skeleton.js';
import { formatDateTime } from '../lib/format.js';

type VaultClient = Pick<ApiClient, 'listDeliveryOrders' | 'listEvidence' | 'downloadEvidence'>;

interface VaultItem {
  readonly evidence: DeliveryEvidence;
  readonly order: DeliveryOrder;
}

const PAGE_SIZE = 8;
/** La API solo lista evidencias por pedido: se limita la consulta para no disparar cientos de peticiones. */
const MAX_ORDERS = 40;

/** Galería de las fotos guardadas. La política de evidencias no permite borrarlas, así que no hay esa acción. */
export function EvidenceVault({ client, onPreview }: {
  readonly client: VaultClient;
  readonly onPreview: (item: DeliveryEvidence) => void;
}) {
  const [items, setItems] = useState<readonly VaultItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [downloadFailed, setDownloadFailed] = useState(false);
  const [page, setPage] = useState(0);

  useEffect(() => {
    let current = true;
    void loadVault(client).then((loaded) => { if (current) setItems(loaded); }).catch(() => { if (current) setFailed(true); });
    return () => { current = false; };
  }, [client]);

  async function download(item: VaultItem) {
    setDownloadFailed(false);
    try {
      const blob = await client.downloadEvidence(item.evidence.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${item.order.publicCode}-${item.evidence.id.slice(0, 8)}.${item.evidence.mimeType.replace('image/', '')}`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setDownloadFailed(true);
    }
  }

  const pageCount = Math.max(Math.ceil((items?.length ?? 0) / PAGE_SIZE), 1);
  const visible = items?.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE) ?? [];

  return (
    <section className="flex flex-col gap-4" aria-labelledby="evidence-vault-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h2 id="evidence-vault-title" className="text-lg font-semibold">Bóveda de evidencias</h2>
          <p className="text-sm text-muted-foreground">Fotos guardadas de las entregas e incidencias más recientes.</p>
        </div>
        <Badge variant="default">Solo tu organización<ShieldCheck data-icon="inline-end" aria-hidden="true" /></Badge>
      </div>

      {failed && <ErrorNotice>No se pudo cargar la bóveda. Puedes buscar un pedido por su código.</ErrorNotice>}
      {downloadFailed && <ErrorNotice>No se pudo descargar la foto. Verifica tu acceso e inténtalo otra vez.</ErrorNotice>}

      {!failed && items === null && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4" role="status" aria-label="Cargando bóveda">
          {['a', 'b', 'c', 'd'].map((key) => <Skeleton key={key} className="h-64" />)}
        </div>
      )}

      {items !== null && items.length === 0 && (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon"><Camera aria-hidden="true" /></EmptyMedia>
            <EmptyTitle>Aún no hay fotos guardadas</EmptyTitle>
            <EmptyDescription>Aparecerán aquí cuando los conductores registren entregas o incidencias con foto.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      {visible.length > 0 && (
        <>
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {visible.map((item) => (
              <VaultCard key={item.evidence.id} client={client} item={item} onView={() => onPreview(item.evidence)} onDownload={() => void download(item)} />
            ))}
          </ul>
          {pageCount > 1 && (
            <div className="flex items-center justify-end gap-3">
              <span className="text-xs tabular-nums">Página {page + 1} de {pageCount}</span>
              <Button type="button" variant="outline" size="icon" aria-label="Fotos anteriores" disabled={page === 0} onClick={() => setPage(page - 1)}><ChevronLeft aria-hidden="true" /></Button>
              <Button type="button" variant="outline" size="icon" aria-label="Fotos siguientes" disabled={page >= pageCount - 1} onClick={() => setPage(page + 1)}><ChevronRight aria-hidden="true" /></Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

async function loadVault(client: VaultClient): Promise<readonly VaultItem[]> {
  const orders = (await client.listDeliveryOrders())
    .filter((order) => order.status === 'delivered' || order.status === 'returned')
    .slice(0, MAX_ORDERS);
  const results = await Promise.allSettled(orders.map(async (order) => {
    const evidence = await client.listEvidence(order.id);
    return evidence.filter((item) => item.status === 'available').map((item): VaultItem => ({ evidence: item, order }));
  }));
  return results
    .flatMap((result) => result.status === 'fulfilled' ? result.value : [])
    .sort((left, right) => right.evidence.createdAt.localeCompare(left.evidence.createdAt));
}

function VaultCard({ client, item, onView, onDownload }: {
  readonly client: VaultClient;
  readonly item: VaultItem;
  readonly onView: () => void;
  readonly onDownload: () => void;
}) {
  const { evidence, order } = item;

  return (
    <li>
      <Card className="group relative h-full overflow-hidden">
        <div className="absolute top-3 right-3 z-10 flex gap-2 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
          <Button type="button" variant="outline" size="icon-sm" className="rounded-full" aria-label={`Ver foto de ${order.publicCode}`} onClick={onView}><Eye aria-hidden="true" /></Button>
          <Button type="button" variant="outline" size="icon-sm" className="rounded-full" aria-label={`Descargar foto de ${order.publicCode}`} onClick={onDownload}><Download aria-hidden="true" /></Button>
        </div>
        <CardContent className="flex flex-col gap-3">
          <EvidenceThumb client={client} evidenceId={evidence.id} alt={`Evidencia del pedido ${order.publicCode}`} />
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium tabular-nums">{order.publicCode}</p>
            <Badge variant={evidence.incidentId === null ? 'success' : 'destructive'}>{evidence.incidentId === null ? 'Entrega' : 'Incidencia'}</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {order.recipient.name}, {order.deliveryAddress.district}. Cargada el {formatDateTime(evidence.createdAt)}
          </p>
        </CardContent>
      </Card>
    </li>
  );
}

function EvidenceThumb({ client, evidenceId, alt }: { readonly client: VaultClient; readonly evidenceId: string; readonly alt: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let current = true;
    let objectUrl: string | null = null;
    client.downloadEvidence(evidenceId).then((blob) => {
      if (!current) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(() => { if (current) setFailed(true); });
    return () => {
      current = false;
      if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
    };
  }, [client, evidenceId]);

  if (failed) {
    return <div className="flex aspect-[4/3] items-center justify-center rounded-md bg-muted text-xs text-muted-foreground">Foto no disponible</div>;
  }
  if (url === null) return <Skeleton className="aspect-[4/3] w-full" />;
  return <img src={url} alt={alt} className="aspect-[4/3] w-full rounded-md object-cover" />;
}
