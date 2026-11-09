import { Camera, ShieldCheck, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { ApiError, type ApiClient, type DeliveryEvidence, type DeliveryOrder } from '../api/client.js';
import { ErrorNotice } from '../components/Notices.js';
import { OrderStatusBadge } from '../components/OrderStatusBadge.js';
import { PageHeader } from '../components/PageHeader.js';
import { SearchInput } from '../components/SearchInput.js';
import { Badge } from '../components/ui/badge.js';
import { Button } from '../components/ui/button.js';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../components/ui/dialog.js';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from '../components/ui/empty.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table.js';
import { useDebouncedValue } from '../hooks/use-debounced-value.js';
import { useFocusReturn } from '../hooks/use-focus-return.js';
import { countLabel, formatBytes, formatDateTime } from '../lib/format.js';
import { EvidenceVault } from './EvidenceVault.js';

type EvidenceClient = Pick<ApiClient, 'findOrderByPublicCode' | 'listEvidence' | 'downloadEvidence' | 'listDeliveryOrders'>;

const SEARCH_DELAY_MS = 400;

export function EvidenceWorkspace({ client }: { readonly client: EvidenceClient }) {
  const [query, setQuery] = useState('');
  const [order, setOrder] = useState<DeliveryOrder | null>(null);
  const [evidence, setEvidence] = useState<readonly DeliveryEvidence[]>([]);
  const [loading, setLoading] = useState(false);
  const [notFoundCode, setNotFoundCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const code = useDebouncedValue(query.trim(), SEARCH_DELAY_MS);
  const [preview, setPreview] = useState<{ readonly url: string; readonly mimeType: string } | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const focusReturn = useFocusReturn();

  useEffect(() => () => { if (preview !== null) URL.revokeObjectURL(preview.url); }, [preview]);

  useEffect(() => {
    setError(null);
    setNotFoundCode(null);
    setOrder(null);
    setEvidence([]);
    if (code === '') {
      setLoading(false);
      return undefined;
    }

    // Si la búsqueda cambia, se descarta la respuesta de la anterior aunque llegue después.
    let current = true;
    setLoading(true);
    void (async () => {
      try {
        const found = await client.findOrderByPublicCode(code);
        const files = await client.listEvidence(found.id);
        if (!current) return;
        setOrder(found);
        setEvidence(files);
      } catch (cause) {
        if (!current) return;
        if (cause instanceof ApiError && cause.status === 404) setNotFoundCode(code);
        else setError('No se pudo consultar la evidencia. Revisa la conexión e inténtalo otra vez.');
      } finally {
        if (current) setLoading(false);
      }
    })();
    return () => { current = false; };
  }, [client, code]);

  async function viewEvidence(item: DeliveryEvidence): Promise<void> {
    setOpening(item.id);
    setError(null);
    try {
      const blob = await client.downloadEvidence(item.id);
      setPreview({ url: URL.createObjectURL(blob), mimeType: item.mimeType });
    } catch {
      setError('No se pudo abrir la foto. Verifica tu acceso e inténtalo otra vez.');
    } finally { setOpening(null); }
  }

  return (
    <>
      <PageHeader title="Evidencia de entrega"
        description="Busca un pedido para revisar sus fotos guardadas. El acceso se valida en cada consulta.">
      </PageHeader>

      <SearchInput value={query} onChange={setQuery} label="Código del pedido" placeholder="Buscar por código de pedido, ej. ORD-00000005"
        busy={loading || query.trim() !== code} className="w-full sm:max-w-md" />

      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notFoundCode !== null && (
        <p className="text-sm text-muted-foreground" role="status">
          Ningún pedido tiene el código «{notFoundCode}». Escribe el código completo.
        </p>
      )}

      {order !== null && (
        <section className="flex flex-col gap-4" aria-labelledby="evidence-order-title">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-0.5">
              <h2 id="evidence-order-title" className="text-lg font-semibold">{order.recipient.name}</h2>
              <p className="text-sm text-muted-foreground">{order.publicCode} · {order.deliveryAddress.addressLine}, {order.deliveryAddress.district}</p>
            </div>
            <OrderStatusBadge status={order.status} />
          </div>
        <div className="flex items-baseline justify-between gap-4">
          <h3 className="text-sm font-medium">Fotos registradas</h3>
          <span className="text-sm text-muted-foreground">{countLabel(evidence.length, 'archivo', 'archivos')}</span>
        </div>
        {evidence.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon"><Camera aria-hidden="true" /></EmptyMedia>
              <EmptyDescription>Este pedido aún no tiene fotos disponibles.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table aria-label="Evidencias del pedido">
            <TableHeader>
              <TableRow>
                <TableHead>Archivo</TableHead>
                <TableHead className="hidden md:table-cell">Fecha de carga</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead><span className="sr-only">Acción</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {evidence.map((item, index) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <span className="flex flex-col">
                      <span className="font-medium">Foto {index + 1}</span>
                      <span className="text-muted-foreground">{item.mimeType.replace('image/', '').toUpperCase()} · {formatBytes(item.byteSize)}</span>
                    </span>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{formatDateTime(item.createdAt)}</TableCell>
                  <TableCell>
                    <Badge variant={item.status === 'available' ? 'success' : 'warning'}>{item.status === 'available' ? 'Disponible' : 'En proceso'}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {item.status === 'available'
                      ? <Button variant="outline" disabled={opening === item.id} onClick={(event) => { focusReturn.remember(event.currentTarget); void viewEvidence(item); }}>{opening === item.id ? 'Abriendo…' : 'Ver foto'}</Button>
                      : <span className="text-muted-foreground">No disponible</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <ShieldCheck className="size-4 shrink-0" aria-hidden="true" /> Las fotos guardadas se conservan; esta vista no permite eliminarlas.
          </p>
        </section>
      )}

      <EvidenceVault client={client} onPreview={(item) => {
        focusReturn.remember(document.activeElement);
        void viewEvidence(item);
      }} />

      <Dialog open={preview !== null} onOpenChange={(open) => { if (!open) setPreview(null); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl" showCloseButton={false} onCloseAutoFocus={focusReturn.onCloseAutoFocus}>
          <DialogHeader>
            <DialogTitle>Vista de evidencia</DialogTitle>
            <DialogDescription>Vista privada · {preview?.mimeType}</DialogDescription>
          </DialogHeader>
          <DialogClose asChild>
            <Button variant="ghost" size="icon-sm" className="absolute top-2 right-2" aria-label="Cerrar foto"><X aria-hidden="true" /></Button>
          </DialogClose>
          {preview !== null && <img src={preview.url} alt="Evidencia fotográfica del pedido" className="mx-auto max-h-[70vh] max-w-full object-contain" />}
        </DialogContent>
      </Dialog>
    </>
  );
}
