import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { ApiError, type ApiClient, type Customer, type DeliveryOrder, type DeliveryOrderImportResult, type DeliveryOrderStatusHistory } from '../api/client.js';
import { Button, StatusPill, Surface } from '../components/Primitives.js';
import './DeliveryOrderManagementPage.css';

type OrderClient = Pick<ApiClient, 'listCustomers' | 'listDeliveryOrders' | 'createDeliveryOrder' | 'resolveGoogleMapsLink' | 'cancelDeliveryOrder' | 'listDeliveryOrderStatusHistory' | 'importDeliveryOrders' | 'downloadDeliveryOrderImportTemplate'>;
type PackageFields = { description: string; weightKg: string };

const emptyPackage = (): PackageFields => ({ description: '', weightKg: '' });

export function DeliveryOrderManagementPage({ client }: { readonly client: OrderClient }) {
  const [customers, setCustomers] = useState<readonly Customer[]>([]);
  const [orders, setOrders] = useState<readonly DeliveryOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [customerId, setCustomerId] = useState('');
  const [timeWindow, setTimeWindow] = useState<'AM' | 'PM' | ''>('');
  const [history, setHistory] = useState<Record<string, readonly DeliveryOrderStatusHistory[]>>({});
  const [historyLoadingId, setHistoryLoadingId] = useState<string | null>(null);
  const [historyErrorId, setHistoryErrorId] = useState<string | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [downloadingTemplate, setDownloadingTemplate] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<DeliveryOrderImportResult | null>(null);
  const [googleMapsUrl, setGoogleMapsUrl] = useState('');
  const [resolvingMapLink, setResolvingMapLink] = useState(false);
  const [recipientName, setRecipientName] = useState('');
  const [recipientPhone, setRecipientPhone] = useState('');
  const [addressLine, setAddressLine] = useState('');
  const [district, setDistrict] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [packages, setPackages] = useState<readonly PackageFields[]>([emptyPackage()]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [loadedCustomers, loadedOrders] = await Promise.all([
        client.listCustomers(), client.listDeliveryOrders(),
      ]);
      setCustomers(loadedCustomers);
      setOrders(loadedOrders);
    } catch {
      setLoadError('No se pudieron cargar los pedidos y clientes. Revisa la conexión e inténtalo de nuevo.');
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => { void loadData(); }, [loadData]);

  async function createOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setNotice(null);
    if ((latitude === '') !== (longitude === '')) {
      setFormError('Completa ambas coordenadas o deja las dos vacías.');
      return;
    }
    const parsedLatitude = latitude === '' ? undefined : Number(latitude);
    const parsedLongitude = longitude === '' ? undefined : Number(longitude);
    if ((parsedLatitude !== undefined && (!Number.isFinite(parsedLatitude) || parsedLatitude < -90 || parsedLatitude > 90)) ||
        (parsedLongitude !== undefined && (!Number.isFinite(parsedLongitude) || parsedLongitude < -180 || parsedLongitude > 180))) {
      setFormError('Ingresa coordenadas válidas: latitud entre -90 y 90 y longitud entre -180 y 180.');
      return;
    }
    const packageInput = packages.map((item) => ({
      description: item.description.trim(),
      ...(item.weightKg.trim() === '' ? {} : { weightKg: Number(item.weightKg) }),
    }));
    if (packageInput.some((item) => item.weightKg !== undefined && (!Number.isFinite(item.weightKg) || item.weightKg <= 0))) {
      setFormError('El peso de cada bulto debe ser un número mayor que cero.');
      return;
    }

    setSaving(true);
    try {
      const created = await client.createDeliveryOrder({
        customerId,
        timeWindow: timeWindow as 'AM' | 'PM',
        recipient: { name: recipientName.trim(), phone: recipientPhone.trim() },
        deliveryAddress: {
          addressLine: addressLine.trim(), district: district.trim(),
          ...(googleMapsUrl.trim() === '' ? {} : { googleMapsUrl: googleMapsUrl.trim() }),
          ...(parsedLatitude === undefined || parsedLongitude === undefined
            ? {} : { latitude: parsedLatitude, longitude: parsedLongitude }),
        },
        packages: packageInput,
      });
      setOrders((current) => [created, ...current.filter((order) => order.id !== created.id)]);
      setTimeWindow('');
      setGoogleMapsUrl('');
      setRecipientName('');
      setRecipientPhone('');
      setAddressLine('');
      setDistrict('');
      setLatitude('');
      setLongitude('');
      setPackages([emptyPackage()]);
      setNotice('Pedido creado.');
    } catch (cause) {
      setFormError(isInactiveCustomerError(cause)
        ? 'El cliente seleccionado ya no está activo. Elige otro cliente activo e inténtalo de nuevo.'
        : cause instanceof Error ? `No se pudo crear el pedido. ${cause.message}` : 'No se pudo crear el pedido. Inténtalo de nuevo.');
    } finally {
      setSaving(false);
    }
  }

  async function resolveMapLink() {
    setFormError(null);
    setResolvingMapLink(true);
    try {
      const coordinates = await client.resolveGoogleMapsLink(googleMapsUrl.trim());
      setLatitude(String(coordinates.latitude));
      setLongitude(String(coordinates.longitude));
      setNotice('Coordenadas obtenidas del enlace. Puedes ajustarlas manualmente.');
    } catch (cause) {
      setFormError(cause instanceof Error ? `No se pudo obtener la ubicación. ${cause.message}` : 'No se pudo obtener la ubicación del enlace.');
    } finally {
      setResolvingMapLink(false);
    }
  }

  async function cancelOrder(order: DeliveryOrder) {
    if (!window.confirm(`¿Cancelar el pedido ${order.publicCode}? Esta acción no se puede deshacer.`)) return;
    setBusyOrderId(order.id);
    setFormError(null);
    setNotice(null);
    try {
      const updated = await client.cancelDeliveryOrder(order.id);
      setOrders((current) => current.map((item) => item.id === updated.id ? updated : item));
      setHistory((current) => {
        const next = { ...current };
        delete next[order.id];
        return next;
      });
      setNotice(`Pedido ${order.publicCode} cancelado.`);
    } catch (cause) {
      setFormError(cause instanceof Error ? `No se pudo cancelar el pedido. ${cause.message}` : 'No se pudo cancelar el pedido. Inténtalo de nuevo.');
    } finally {
      setBusyOrderId(null);
    }
  }

  async function loadHistory(orderId: string) {
    setHistoryLoadingId(orderId);
    setHistoryErrorId(null);
    try {
      const events = await client.listDeliveryOrderStatusHistory(orderId);
      setHistory((current) => ({ ...current, [orderId]: events }));
    } catch {
      setHistoryErrorId(orderId);
    } finally {
      setHistoryLoadingId(null);
    }
  }

  async function importOrders() {
    if (importFile === null) {
      setImportError('Selecciona un archivo CSV o XLSX.');
      return;
    }
    setImportError(null);
    setImportResult(null);
    setImporting(true);
    try {
      const result = await client.importDeliveryOrders(importFile);
      setImportResult(result);
      setOrders((current) => [
        ...result.importedOrders,
        ...current.filter((order) => !result.importedOrders.some((created) => created.id === order.id)),
      ]);
    } catch (cause) {
      setImportError(cause instanceof Error
        ? `No se pudo importar el archivo. ${cause.message}`
        : 'No se pudo importar el archivo. Inténtalo de nuevo.');
    } finally {
      setImporting(false);
    }
  }

  async function downloadTemplate() {
    setImportError(null);
    setDownloadingTemplate(true);
    try {
      const blob = await client.downloadDeliveryOrderImportTemplate();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'delivery-orders-template.xlsx';
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setImportError('No se pudo descargar la plantilla. Inténtalo de nuevo.');
    } finally {
      setDownloadingTemplate(false);
    }
  }

  const activeCustomers = customers.filter((customer) => customer.status === 'active');
  const customerNames = new Map(customers.map((customer) => [customer.id, customer.name]));

  return (
    <section className="order-management">
      <header className="order-management__header">
        <div>
          <p className="order-management__context">OPERACIÓN · PEDIDOS</p>
          <h1>Pedidos de entrega</h1>
          <p className="order-management__intro">Registra pedidos vinculados a un cliente activo y consulta su estado actual.</p>
        </div>
        <span className="order-management__header-mark" aria-hidden="true">PEDIDOS</span>
      </header>

      {formError !== null && <p className="order-management__alert" role="alert">{formError}</p>}
      {notice !== null && <p className="order-management__success" role="status">{notice}</p>}

      <Surface className="order-management__import-surface">
        <div className="order-management__section-heading">
          <div><h2>Importar pedidos</h2><p>CSV o Excel XLSX · una fila por bulto · máximo 5 MB.</p></div>
        </div>
        <div className="order-management__import-controls">
          <label className="order-management__field" htmlFor="order-import-file">
            Archivo de pedidos (CSV/XLSX)
            <input
              id="order-import-file"
              type="file"
              accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(event) => {
                setImportFile(event.target.files?.[0] ?? null);
                setImportError(null);
                setImportResult(null);
              }}
              disabled={importing}
            />
          </label>
          <div className="order-management__import-actions">
            <Button type="button" variant="secondary" onClick={() => void downloadTemplate()} disabled={downloadingTemplate}>
              {downloadingTemplate ? 'Descargando…' : 'Descargar plantilla Excel'}
            </Button>
            <Button type="button" onClick={() => void importOrders()} disabled={importing || importFile === null}>
              {importing ? 'Importando…' : 'Importar pedidos'}
            </Button>
          </div>
        </div>
        {importError !== null && <p className="order-management__alert" role="alert">{importError}</p>}
        {importResult !== null && (
          <div className="order-management__import-result" role="status">
            <p>
              Importación finalizada: {importResult.importedOrders.length}{' '}
              {importResult.importedOrders.length === 1 ? 'pedido importado' : 'pedidos importados'} y{' '}
              {importResult.rejectedOrders.length} {importResult.rejectedOrders.length === 1 ? 'pedido rechazado' : 'pedidos rechazados'}.
            </p>
            {importResult.rejectedOrders.length > 0 && (
              <ul aria-label="Pedidos rechazados">
                {importResult.rejectedOrders.map((rejected, index) => (
                  <li key={`${rejected.publicCode ?? 'unknown'}-${index}`}>
                    <strong>{rejected.publicCode ?? 'Pedido sin código'}</strong>
                    {' · filas '}{rejected.rowNumbers.join(', ')}
                    {rejected.issues.map((issue, issueIndex) => (
                      <span key={`${issue.field}-${issue.rowNumber}-${issueIndex}`}>
                        {' · '}{issue.field} (fila {issue.rowNumber}): {issue.message}
                      </span>
                    ))}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Surface>

      <section className="order-management__layout" aria-label="Gestión de pedidos">
        <Surface className="order-management__form-surface">
          <div className="order-management__section-heading">
            <div><h2>Crear pedido</h2><p>Los campos con * son obligatorios.</p></div>
            <span className="order-management__section-signal" aria-hidden="true" />
          </div>
          {activeCustomers.length === 0 && !loading && loadError === null && (
            <p className="order-management__alert" role="alert">No hay clientes activos. Activa o registra un cliente antes de crear pedidos.</p>
          )}
          <form className="order-management__form" onSubmit={(event) => void createOrder(event)}>
            <label className="order-management__field order-management__field--wide" htmlFor="order-customer">
              Cliente activo *
              <select id="order-customer" required value={customerId} onChange={(event) => setCustomerId(event.target.value)} disabled={activeCustomers.length === 0 || saving}>
                <option value="">Selecciona un cliente</option>
                {activeCustomers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name} · {customer.publicCode}</option>)}
              </select>
            </label>
            <label className="order-management__field" htmlFor="order-time-window">Franja de entrega *
              <select id="order-time-window" required value={timeWindow} onChange={(event) => setTimeWindow(event.target.value as 'AM' | 'PM' | '')} disabled={saving}>
                <option value="">Selecciona una franja</option>
                <option value="AM">AM · Mañana</option>
                <option value="PM">PM · Tarde</option>
              </select>
            </label>
            <p className="order-management__field">Código público <span>Se genera automáticamente al crear el pedido.</span></p>
            <label className="order-management__field" htmlFor="recipient-name">Nombre del destinatario *
              <input id="recipient-name" required maxLength={120} value={recipientName} onChange={(event) => setRecipientName(event.target.value)} />
            </label>
            <label className="order-management__field" htmlFor="recipient-phone">Teléfono del destinatario *
              <input id="recipient-phone" required maxLength={20} pattern="[+]?[0-9][0-9 ()-]*" value={recipientPhone} onChange={(event) => setRecipientPhone(event.target.value)} />
            </label>
            <label className="order-management__field" htmlFor="delivery-address">Dirección *
              <input id="delivery-address" required minLength={5} maxLength={200} value={addressLine} onChange={(event) => setAddressLine(event.target.value)} />
            </label>
            <label className="order-management__field" htmlFor="delivery-district">Distrito *
              <input id="delivery-district" required minLength={2} maxLength={80} value={district} onChange={(event) => setDistrict(event.target.value)} />
            </label>
            <label className="order-management__field order-management__field--wide" htmlFor="delivery-google-maps">Enlace de Google Maps · opcional
              <input id="delivery-google-maps" type="url" value={googleMapsUrl} onChange={(event) => setGoogleMapsUrl(event.target.value)} placeholder="https://maps.app.goo.gl/..." />
            </label>
            <Button type="button" variant="secondary" onClick={() => void resolveMapLink()} disabled={saving || resolvingMapLink || googleMapsUrl.trim() === ''}>
              {resolvingMapLink ? 'Buscando ubicación…' : 'Obtener coordenadas'}
            </Button>
            <fieldset className="order-management__coordinates order-management__field--wide">
              <legend>Coordenadas <span>(opcional, ambas requeridas)</span></legend>
              <label className="order-management__field" htmlFor="delivery-latitude">Latitud
                <input id="delivery-latitude" type="number" step="any" min="-90" max="90" value={latitude} onChange={(event) => setLatitude(event.target.value)} />
              </label>
              <label className="order-management__field" htmlFor="delivery-longitude">Longitud
                <input id="delivery-longitude" type="number" step="any" min="-180" max="180" value={longitude} onChange={(event) => setLongitude(event.target.value)} />
              </label>
            </fieldset>
            <fieldset className="order-management__packages order-management__field--wide">
              <legend>Bultos <span>· al menos uno</span></legend>
              {packages.map((item, index) => (
                <div className="order-management__package-row" key={index}>
                  <span>Código del bulto {index + 1}: se genera automáticamente</span>
                  <label className="order-management__field" htmlFor={`package-description-${index}`}>Descripción del bulto {index + 1} *
                    <input id={`package-description-${index}`} required maxLength={200} value={item.description} onChange={(event) => setPackages((current) => current.map((pkg, position) => position === index ? { ...pkg, description: event.target.value } : pkg))} />
                  </label>
                  <label className="order-management__field" htmlFor={`package-weight-${index}`}>Peso (kg) · opcional
                    <input id={`package-weight-${index}`} type="number" min="0.01" max="1000" step="any" value={item.weightKg} onChange={(event) => setPackages((current) => current.map((pkg, position) => position === index ? { ...pkg, weightKg: event.target.value } : pkg))} />
                  </label>
                  {packages.length > 1 && <Button type="button" variant="quiet" className="order-management__remove-package" onClick={() => setPackages((current) => current.filter((_, position) => position !== index))} aria-label={`Quitar bulto ${index + 1}`}>Quitar</Button>}
                </div>
              ))}
              <Button type="button" variant="secondary" onClick={() => setPackages((current) => [...current, emptyPackage()])} disabled={saving}>Añadir bulto</Button>
            </fieldset>
            <div className="order-management__form-actions order-management__field--wide">
              <Button type="submit" disabled={saving || activeCustomers.length === 0}>{saving ? 'Creando…' : 'Crear pedido'}</Button>
            </div>
          </form>
        </Surface>

        <Surface className="order-management__list-surface">
          <div className="order-management__section-heading">
            <div><h2>Pedidos registrados</h2><p>Estado y datos para identificar cada entrega.</p></div>
            {!loading && loadError === null && <span className="order-management__count">{orders.length} {orders.length === 1 ? 'pedido' : 'pedidos'}</span>}
          </div>
          {loading ? <div className="order-management__loading" role="status" aria-label="Cargando pedidos y clientes"><span /><span /><span /></div>
            : loadError !== null ? <div className="order-management__empty" role="alert"><p>{loadError}</p><Button variant="secondary" onClick={() => void loadData()}>Reintentar</Button></div>
              : orders.length === 0 ? <div className="order-management__empty"><h3>Aún no hay pedidos</h3><p>Completa el formulario para registrar el primer pedido de entrega.</p></div>
                : <ul className="order-management__orders">
                  {orders.map((order) => <li className="order-management__order" key={order.id}>
                    <div className="order-management__order-top">
                      <span className="order-management__code">{order.publicCode}</span>
                      <StatusPill tone={statusTone(order.status)}>{statusLabel(order.status)}</StatusPill>
                      <span className="order-management__window">Franja {order.timeWindow}</span>
                    </div>
                    <p className="order-management__customer">{customerNames.get(order.customerId) ?? 'Cliente no disponible'}</p>
                    <div className="order-management__order-details">
                      <span><strong>Destinatario</strong>{order.recipient.name} · {order.recipient.phone}</span>
                      <span><strong>Dirección</strong>{order.deliveryAddress.addressLine}, {order.deliveryAddress.district}</span>
                      <span><strong>Bultos</strong>{order.packages.length} {order.packages.length === 1 ? 'bulto' : 'bultos'}</span>
                    </div>
                    <Button variant="quiet" type="button" aria-label={`Ver historial ${order.publicCode}`} onClick={() => void loadHistory(order.id)} disabled={historyLoadingId === order.id}>
                      {historyLoadingId === order.id ? 'Cargando historial…' : 'Ver historial'}
                    </Button>
                    {historyErrorId === order.id && <p className="order-management__alert" role="alert">No se pudo cargar el historial. Inténtalo de nuevo.</p>}
                    {history[order.id] !== undefined && <ol className="order-management__history" aria-label={`Historial ${order.publicCode}`}>
                      {(history[order.id] ?? []).length === 0 ? <li>Sin cambios de estado registrados.</li> : (history[order.id] ?? []).map((event, index) => <li key={`${event.occurredAt}-${index}`}>
                        <strong>
                          {event.toStatus === 'returned' && 'Incidencia reportada · '}
                          {statusLabel(event.fromStatus)} → {statusLabel(event.toStatus)}
                        </strong>
                        <time dateTime={event.occurredAt}>{new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(event.occurredAt))}</time>
                      </li>)}
                    </ol>}
                    {canCancel(order.status) && <Button variant="quiet" className="order-management__cancel" type="button" disabled={busyOrderId === order.id} onClick={() => void cancelOrder(order)} aria-label={`Cancelar pedido ${order.publicCode}`}>
                      {busyOrderId === order.id ? 'Cancelando…' : 'Cancelar pedido'}
                    </Button>}
                  </li>)}
                </ul>}
        </Surface>
      </section>
    </section>
  );
}

function isInactiveCustomerError(error: unknown): boolean {
  return (error instanceof ApiError || (typeof error === 'object' && error !== null)) &&
    'status' in error && error.status === 409 && 'code' in error && error.code === 'CUSTOMER_INACTIVE';
}

function canCancel(status: DeliveryOrder['status']): boolean {
  return status === 'created' || status === 'planned' || status === 'assigned';
}

function statusLabel(status: DeliveryOrder['status']): string {
  const labels: Record<DeliveryOrder['status'], string> = {
    created: 'Creado', planned: 'Planificado', assigned: 'Asignado', in_transit: 'En reparto',
    delivered: 'Entregado', returned: 'Devuelto', cancelled: 'Cancelado',
  };
  return labels[status];
}

function statusTone(status: DeliveryOrder['status']): 'neutral' | 'success' | 'warning' | 'danger' {
  if (status === 'delivered') return 'success';
  if (status === 'in_transit' || status === 'planned' || status === 'assigned') return 'warning';
  if (status === 'returned' || status === 'cancelled') return 'danger';
  return 'neutral';
}
