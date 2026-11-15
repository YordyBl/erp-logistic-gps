import { Package, Plus, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { ApiError, type ApiClient, type Customer, type DeliveryOrder } from '../../api/client.js';
import { DocumentTitle, DocumentTotal, FormSheet } from '../../components/FormSheet.js';
import { SelectField, TextField } from '../../components/FormFields.js';
import { IconChip } from '../../components/IconChip.js';
import { ErrorNotice, SuccessNotice } from '../../components/Notices.js';
import { Button } from '../../components/ui/button.js';
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '../../components/ui/field.js';
import { Input } from '../../components/ui/input.js';
import { formatDateOnly } from '../../lib/format.js';
import { mapLinkErrorMessage } from '../../lib/googleMaps.js';
import { PHONE_PATTERN } from '../../lib/patterns.js';
import { CustomerCombobox } from './CustomerCombobox.js';

type CreateClient = Pick<ApiClient, 'createDeliveryOrder' | 'resolveGoogleMapsLink' | 'listCustomersPage'>;
type EditClient = Pick<ApiClient, 'editDeliveryOrder' | 'resolveGoogleMapsLink'>;
type TimeWindow = 'AM' | 'PM';
/** `code` is set only for a package that already exists on the order being edited. */
type PackageFields = { code?: string; description: string; weightKg: string };

const emptyPackage = (): PackageFields => ({ description: '', weightKg: '' });

const TIME_WINDOW_OPTIONS: readonly { readonly value: TimeWindow; readonly label: string }[] = [
  { value: 'AM', label: 'AM · Mañana' },
  { value: 'PM', label: 'PM · Tarde' },
];

/** Creates an order; the customer is searched among the active ones on the server. */
export function OrderCreateSheet({ client, open, onOpenChange, onCreated }: {
  readonly client: CreateClient;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onCreated: (order: DeliveryOrder) => void;
}) {
  return (
    <OrderFormSheet mode={{ kind: 'create', client, onCreated }}
      open={open} onOpenChange={onOpenChange} />
  );
}

/**
 * Edits an order that is still `created`. Customer and time window are fixed:
 * only the recipient, delivery address and packages can change.
 */
export function OrderEditSheet({ client, order, customerName, onClose, onSaved }: {
  readonly client: EditClient;
  readonly order: DeliveryOrder | null;
  readonly customerName: string | undefined;
  readonly onClose: () => void;
  readonly onSaved: (order: DeliveryOrder) => void;
}) {
  if (order === null) return null;
  return (
    // Keyed by order so each edit starts from that order's current details.
    <OrderFormSheet key={order.id} mode={{ kind: 'edit', client, order, customerName, onSaved }}
      open onOpenChange={(open) => { if (!open) onClose(); }} />
  );
}

type FormMode =
  | { readonly kind: 'create'; readonly client: CreateClient; readonly onCreated: (order: DeliveryOrder) => void }
  | { readonly kind: 'edit'; readonly client: EditClient; readonly order: DeliveryOrder;
      readonly customerName: string | undefined; readonly onSaved: (order: DeliveryOrder) => void };

function OrderFormSheet({ mode, open, onOpenChange }: {
  readonly mode: FormMode;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const editing = mode.kind === 'edit' ? mode.order : null;
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showMissing, setShowMissing] = useState(false);
  const [customer, setCustomer] = useState<Customer | null>(null);
  // Se sabe al cargar el selector: sin clientes activos no se puede crear un pedido.
  const [noActiveCustomers, setNoActiveCustomers] = useState(false);
  const [timeWindow, setTimeWindow] = useState<TimeWindow | ''>('');
  const [googleMapsUrl, setGoogleMapsUrl] = useState(editing?.deliveryAddress.googleMapsUrl ?? '');
  const [resolvingMapLink, setResolvingMapLink] = useState(false);
  const [recipientName, setRecipientName] = useState(editing?.recipient.name ?? '');
  const [recipientPhone, setRecipientPhone] = useState(editing?.recipient.phone ?? '');
  const [addressLine, setAddressLine] = useState(editing?.deliveryAddress.addressLine ?? '');
  const [district, setDistrict] = useState(editing?.deliveryAddress.district ?? '');
  const [latitude, setLatitude] = useState(editing?.deliveryAddress.latitude?.toString() ?? '');
  const [longitude, setLongitude] = useState(editing?.deliveryAddress.longitude?.toString() ?? '');
  const [packages, setPackages] = useState<readonly PackageFields[]>(editing === null ? [emptyPackage()]
    : editing.packages.map((item) => ({ code: item.code, description: item.description, weightKg: item.weightKg?.toString() ?? '' })));

  function updatePackage(index: number, change: Partial<PackageFields>) {
    setPackages((current) => current.map((item, position) => position === index ? { ...item, ...change } : item));
  }

  function resetCreateForm() {
    setTimeWindow('');
    setGoogleMapsUrl('');
    setRecipientName('');
    setRecipientPhone('');
    setAddressLine('');
    setDistrict('');
    setLatitude('');
    setLongitude('');
    setPackages([emptyPackage()]);
    setShowMissing(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setNotice(null);
    if (mode.kind === 'create' && (customer === null || timeWindow === '')) {
      setShowMissing(true);
      return;
    }
    // Every order must be placed on the map: route stops copy these coordinates.
    if (latitude.trim() === '' || longitude.trim() === '') {
      setFormError('Indica la latitud y la longitud de entrega, o obténlas desde el enlace de Google Maps.');
      return;
    }
    const parsedLatitude = Number(latitude);
    const parsedLongitude = Number(longitude);
    if (!Number.isFinite(parsedLatitude) || parsedLatitude < -90 || parsedLatitude > 90 ||
        !Number.isFinite(parsedLongitude) || parsedLongitude < -180 || parsedLongitude > 180) {
      setFormError('Ingresa coordenadas válidas: latitud entre -90 y 90 y longitud entre -180 y 180.');
      return;
    }
    const packageInput = packages.map((item) => ({
      ...(item.code === undefined ? {} : { code: item.code }),
      description: item.description.trim(),
      ...(item.weightKg.trim() === '' ? {} : { weightKg: Number(item.weightKg) }),
    }));
    if (packageInput.some((item) => item.weightKg !== undefined && (!Number.isFinite(item.weightKg) || item.weightKg <= 0))) {
      setFormError('El peso de cada bulto debe ser un número mayor que cero.');
      return;
    }
    const recipient = { name: recipientName.trim(), phone: recipientPhone.trim() };
    const deliveryAddress = {
      addressLine: addressLine.trim(), district: district.trim(),
      ...(googleMapsUrl.trim() === '' ? {} : { googleMapsUrl: googleMapsUrl.trim() }),
      latitude: parsedLatitude, longitude: parsedLongitude,
    };

    setSaving(true);
    try {
      if (mode.kind === 'edit') {
        mode.onSaved(await mode.client.editDeliveryOrder(mode.order.id, { recipient, deliveryAddress, packages: packageInput }));
        onOpenChange(false);
        return;
      }
      if (customer === null || timeWindow === '') return;
      const created = await mode.client.createDeliveryOrder({ customerId: customer.id, timeWindow, recipient, deliveryAddress, packages: packageInput });
      mode.onCreated(created);
      resetCreateForm();
      onOpenChange(false);
    } catch (cause) {
      const action = mode.kind === 'edit' ? 'guardar los cambios del pedido' : 'crear el pedido';
      setFormError(isApiError(cause, 'CUSTOMER_INACTIVE')
        ? 'El cliente seleccionado ya no está activo. Elige otro cliente activo e inténtalo de nuevo.'
        : mode.kind === 'edit' && isApiError(cause, 'DELIVERY_ORDER_INVARIANT_VIOLATION')
          ? 'El pedido ya no está en estado Creado, por lo que no se puede editar. Actualiza la lista para ver su estado actual.'
          : cause instanceof Error ? `No se pudo ${action}. ${cause.message}` : `No se pudo ${action}. Inténtalo de nuevo.`);
    } finally {
      setSaving(false);
    }
  }

  async function resolveMapLink() {
    setFormError(null);
    setResolvingMapLink(true);
    try {
      const coordinates = await mode.client.resolveGoogleMapsLink(googleMapsUrl.trim());
      setLatitude(String(coordinates.latitude));
      setLongitude(String(coordinates.longitude));
      setNotice('Coordenadas obtenidas del enlace. Puedes ajustarlas manualmente.');
    } catch (cause) {
      setFormError(mapLinkErrorMessage(cause));
    } finally {
      setResolvingMapLink(false);
    }
  }

  const totalWeight = packages.reduce((total, item) => total + (Number(item.weightKg) || 0), 0);
  const submitLabel = mode.kind === 'edit' ? (saving ? 'Guardando…' : 'Guardar cambios') : (saving ? 'Creando…' : 'Crear pedido');

  return (
    <FormSheet open={open} onOpenChange={onOpenChange} width="wide" paper
      title={mode.kind === 'edit' ? `Editar pedido ${mode.order.publicCode}` : 'Crear pedido'}
      description={mode.kind === 'edit'
        ? 'Solo se editan pedidos en estado Creado. El cliente y la franja no se pueden cambiar.'
        : 'Los campos con * son obligatorios.'}
      onSubmit={(event) => void submit(event)}
      footer={(
        <>
          <Button type="button" variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button type="submit" disabled={saving || (mode.kind === 'create' && noActiveCustomers)}>{submitLabel}</Button>
        </>
      )}>
      <DocumentTitle title="PEDIDO" aside={<IconChip icon={Package} tone="primary" />}>
        <span>N°: <span className="text-foreground">{editing?.publicCode ?? 'se genera al crear'}</span></span>
        <span>Fecha: <span className="text-foreground">{formatDateOnly(editing?.createdAt ?? new Date().toISOString())}</span></span>
      </DocumentTitle>

      {formError !== null && <ErrorNotice>{formError}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}
      {mode.kind === 'create' && noActiveCustomers && <ErrorNotice>No hay clientes activos. Activa o registra un cliente antes de crear pedidos.</ErrorNotice>}

      <FieldGroup className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {mode.kind === 'edit' ? (
          <>
            <TextField id="order-customer" label="Cliente" placeholder="Cliente del pedido" disabled readOnly
              value={mode.customerName ?? 'Cliente no disponible'} />
            <TextField id="order-time-window" label="Franja de entrega" placeholder="Franja del pedido" disabled readOnly
              value={TIME_WINDOW_OPTIONS.find((option) => option.value === mode.order.timeWindow)?.label ?? mode.order.timeWindow} />
          </>
        ) : (
          <>
            <CustomerCombobox id="order-customer" label="Cliente activo *" client={mode.client} value={customer}
              disabled={noActiveCustomers || saving} onChange={setCustomer}
              onAvailability={(available) => setNoActiveCustomers(!available)}
              error={showMissing && customer === null ? 'Selecciona un cliente.' : null} />
            <SelectField id="order-time-window" label="Franja de entrega *" placeholder="Selecciona una franja" value={timeWindow}
              disabled={saving} options={TIME_WINDOW_OPTIONS} onChange={setTimeWindow}
              error={showMissing && timeWindow === '' ? 'Selecciona una franja.' : null} />
          </>
        )}
        <TextField id="recipient-name" label="Nombre del destinatario *" placeholder="Ej. María Pérez" required maxLength={120} value={recipientName}
          onChange={(event) => setRecipientName(event.target.value)} />
        <TextField id="recipient-phone" label="Teléfono del destinatario *" placeholder="Ej. 900 000 123" required maxLength={20} pattern={PHONE_PATTERN} value={recipientPhone}
          onChange={(event) => setRecipientPhone(event.target.value)} />
        <TextField id="delivery-address" label="Dirección *" placeholder="Ej. Av. Arequipa 123" required minLength={5} maxLength={200} value={addressLine}
          onChange={(event) => setAddressLine(event.target.value)} />
        <TextField id="delivery-district" label="Distrito *" placeholder="Ej. Lince" required minLength={2} maxLength={80} value={district}
          onChange={(event) => setDistrict(event.target.value)} />
      </FieldGroup>

      <FieldSet className="gap-3">
        <FieldLegend>Ubicación *</FieldLegend>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <TextField id="delivery-google-maps" label="Enlace de Google Maps · opcional" placeholder="https://maps.app.goo.gl/..." type="url" value={googleMapsUrl}
            onChange={(event) => setGoogleMapsUrl(event.target.value)} />
          <Button type="button" variant="outline" onClick={() => void resolveMapLink()} disabled={saving || resolvingMapLink || googleMapsUrl.trim() === ''}>
            {resolvingMapLink ? 'Buscando ubicación…' : 'Obtener coordenadas'}
          </Button>
        </div>
        <FieldGroup className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          <TextField id="delivery-latitude" label="Latitud *" placeholder="Ej. -12.0464" type="number" step="any" min="-90" max="90" required value={latitude}
            onChange={(event) => setLatitude(event.target.value)} />
          <TextField id="delivery-longitude" label="Longitud *" placeholder="Ej. -77.0428" type="number" step="any" min="-180" max="180" required value={longitude}
            onChange={(event) => setLongitude(event.target.value)} />
        </FieldGroup>
        <FieldDescription>Las coordenadas ubican la parada en la ruta. Escríbelas u obténlas desde el enlace de Google Maps.</FieldDescription>
      </FieldSet>

      <FieldSet className="gap-2">
        <div className="grid grid-cols-[minmax(0,1fr)_6rem_2.25rem] gap-3 text-[0.6875rem] text-muted-foreground">
          <span>Bulto *</span><span>Peso (kg)</span><span />
        </div>
        {packages.map((item, index) => (
          <div key={index} className="grid grid-cols-[minmax(0,1fr)_6rem_2.25rem] items-center gap-3">
            <Field>
              <FieldLabel htmlFor={`package-description-${index}`} className="sr-only">Descripción del bulto {index + 1} *</FieldLabel>
              <Input id={`package-description-${index}`} placeholder="Ej. Caja mediana" required maxLength={200} value={item.description}
                onChange={(event) => updatePackage(index, { description: event.target.value })} />
            </Field>
            <Field>
              <FieldLabel htmlFor={`package-weight-${index}`} className="sr-only">Peso del bulto {index + 1} en kg · opcional</FieldLabel>
              <Input id={`package-weight-${index}`} placeholder="Ej. 2.5" type="number" min="0.01" max="1000" step="any" value={item.weightKg}
                onChange={(event) => updatePackage(index, { weightKg: event.target.value })} />
            </Field>
            {packages.length > 1 && (
              <Button type="button" variant="ghost" size="icon" aria-label={`Quitar bulto ${index + 1}`}
                onClick={() => setPackages((current) => current.filter((_, position) => position !== index))}><X aria-hidden="true" /></Button>
            )}
          </div>
        ))}
        <div>
          <Button type="button" variant="ghost" onClick={() => setPackages((current) => [...current, emptyPackage()])} disabled={saving}>
            <Plus data-icon="inline-start" aria-hidden="true" /> Añadir bulto
          </Button>
        </div>
        <div className="mt-2 ml-auto flex w-full max-w-56 flex-col">
          <DocumentTotal label="Bultos" value={packages.length.toLocaleString('es-PE')} />
          <DocumentTotal label="Peso total" value={`${totalWeight.toLocaleString('es-PE')} kg`} strong />
        </div>
      </FieldSet>
    </FormSheet>
  );
}

function isApiError(error: unknown, code: string): boolean {
  return (error instanceof ApiError || (typeof error === 'object' && error !== null)) &&
    'status' in error && error.status === 409 && 'code' in error && error.code === code;
}
