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
import { PHONE_PATTERN } from '../../lib/patterns.js';

type CreateClient = Pick<ApiClient, 'createDeliveryOrder' | 'resolveGoogleMapsLink'>;
type TimeWindow = 'AM' | 'PM';
type PackageFields = { description: string; weightKg: string };

const emptyPackage = (): PackageFields => ({ description: '', weightKg: '' });

const TIME_WINDOW_OPTIONS: readonly { readonly value: TimeWindow; readonly label: string }[] = [
  { value: 'AM', label: 'AM · Mañana' },
  { value: 'PM', label: 'PM · Tarde' },
];

export function OrderCreateSheet({ client, open, onOpenChange, activeCustomers, showNoCustomers, onCreated }: {
  readonly client: CreateClient;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly activeCustomers: readonly Customer[];
  readonly showNoCustomers: boolean;
  readonly onCreated: (order: DeliveryOrder) => void;
}) {
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showMissing, setShowMissing] = useState(false);
  const [customerId, setCustomerId] = useState('');
  const [timeWindow, setTimeWindow] = useState<TimeWindow | ''>('');
  const [googleMapsUrl, setGoogleMapsUrl] = useState('');
  const [resolvingMapLink, setResolvingMapLink] = useState(false);
  const [recipientName, setRecipientName] = useState('');
  const [recipientPhone, setRecipientPhone] = useState('');
  const [addressLine, setAddressLine] = useState('');
  const [district, setDistrict] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [packages, setPackages] = useState<readonly PackageFields[]>([emptyPackage()]);

  function updatePackage(index: number, change: Partial<PackageFields>) {
    setPackages((current) => current.map((item, position) => position === index ? { ...item, ...change } : item));
  }

  async function createOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setNotice(null);
    if (customerId === '' || timeWindow === '') {
      setShowMissing(true);
      return;
    }
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
        timeWindow,
        recipient: { name: recipientName.trim(), phone: recipientPhone.trim() },
        deliveryAddress: {
          addressLine: addressLine.trim(), district: district.trim(),
          ...(googleMapsUrl.trim() === '' ? {} : { googleMapsUrl: googleMapsUrl.trim() }),
          ...(parsedLatitude === undefined || parsedLongitude === undefined
            ? {} : { latitude: parsedLatitude, longitude: parsedLongitude }),
        },
        packages: packageInput,
      });
      onCreated(created);
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
      onOpenChange(false);
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

  const totalWeight = packages.reduce((total, item) => total + (Number(item.weightKg) || 0), 0);

  return (
    <FormSheet open={open} onOpenChange={onOpenChange} width="wide" paper title="Crear pedido"
      description="Los campos con * son obligatorios."
      onSubmit={(event) => void createOrder(event)}
      footer={(
        <>
          <Button type="button" variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button type="submit" disabled={saving || activeCustomers.length === 0}>{saving ? 'Creando…' : 'Crear pedido'}</Button>
        </>
      )}>
      <DocumentTitle title="PEDIDO" aside={<IconChip icon={Package} tone="primary" />}>
        <span>N°: <span className="text-foreground">se genera al crear</span></span>
        <span>Fecha: <span className="text-foreground">{formatDateOnly(new Date().toISOString())}</span></span>
      </DocumentTitle>

      {formError !== null && <ErrorNotice>{formError}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}
      {showNoCustomers && <ErrorNotice>No hay clientes activos. Activa o registra un cliente antes de crear pedidos.</ErrorNotice>}

      <FieldGroup className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        <SelectField id="order-customer" label="Cliente activo *" placeholder="Selecciona un cliente" value={customerId}
          disabled={activeCustomers.length === 0 || saving} onChange={setCustomerId}
          options={activeCustomers.map((customer) => ({ value: customer.id, label: `${customer.name} · ${customer.publicCode}` }))}
          error={showMissing && customerId === '' ? 'Selecciona un cliente.' : null} />
        <SelectField id="order-time-window" label="Franja de entrega *" placeholder="Selecciona una franja" value={timeWindow}
          disabled={saving} options={TIME_WINDOW_OPTIONS} onChange={setTimeWindow}
          error={showMissing && timeWindow === '' ? 'Selecciona una franja.' : null} />
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
        <FieldLegend>Ubicación · opcional</FieldLegend>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <TextField id="delivery-google-maps" label="Enlace de Google Maps · opcional" placeholder="https://maps.app.goo.gl/..." type="url" value={googleMapsUrl}
            onChange={(event) => setGoogleMapsUrl(event.target.value)} />
          <Button type="button" variant="outline" onClick={() => void resolveMapLink()} disabled={saving || resolvingMapLink || googleMapsUrl.trim() === ''}>
            {resolvingMapLink ? 'Buscando ubicación…' : 'Obtener coordenadas'}
          </Button>
        </div>
        <FieldGroup className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          <TextField id="delivery-latitude" label="Latitud" placeholder="Ej. -12.0464" type="number" step="any" min="-90" max="90" value={latitude}
            onChange={(event) => setLatitude(event.target.value)} />
          <TextField id="delivery-longitude" label="Longitud" placeholder="Ej. -77.0428" type="number" step="any" min="-180" max="180" value={longitude}
            onChange={(event) => setLongitude(event.target.value)} />
        </FieldGroup>
        <FieldDescription>Con coordenadas, el pedido se ubica en el mapa de la ruta. Completa ambas o deja las dos vacías.</FieldDescription>
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

function isInactiveCustomerError(error: unknown): boolean {
  return (error instanceof ApiError || (typeof error === 'object' && error !== null)) &&
    'status' in error && error.status === 409 && 'code' in error && error.code === 'CUSTOMER_INACTIVE';
}
