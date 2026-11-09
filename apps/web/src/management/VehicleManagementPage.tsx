import { Pencil, Plus, SearchX, Truck } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';

import type { ApiClient, DispatchRoute, Driver, Vehicle, VehicleStatus } from '../api/client.js';
import { FormSheet } from '../components/FormSheet.js';
import { SelectField, TextField } from '../components/FormFields.js';
import { ErrorNotice, LoadingRows, SuccessNotice } from '../components/Notices.js';
import { PageHeader } from '../components/PageHeader.js';
import { SearchInput } from '../components/SearchInput.js';
import { Button } from '../components/ui/button.js';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../components/ui/empty.js';
import { FieldGroup } from '../components/ui/field.js';
import { IDENTIFIER_PATTERN } from '../lib/patterns.js';
import { VehicleDetail } from './vehicles/VehicleDetail.js';
import { VehicleListItem } from './vehicles/VehicleListItem.js';
import { EMPTY_STATS, groupRoutesByVehicle, monthlyRoutes, summarizeVehicleRoutes, todayInLima } from './vehicles/vehicleStats.js';

type VehicleClient = Pick<ApiClient, 'listVehicles' | 'createVehicle' | 'updateVehicle' | 'listDispatchRoutes' | 'listDrivers'>;

interface VehicleForm {
  plate: string;
  type: string;
  capacityKg: string;
}

const STATUS_OPTIONS: readonly { readonly value: VehicleStatus; readonly label: string }[] = [
  { value: 'active', label: 'Activo' },
  { value: 'inactive', label: 'Inactivo' },
];

const emptyForm = (): VehicleForm => ({ plate: '', type: '', capacityKg: '' });

export function VehicleManagementPage({ client }: { readonly client: VehicleClient }) {
  const [vehicles, setVehicles] = useState<readonly Vehicle[]>([]);
  const [routes, setRoutes] = useState<readonly DispatchRoute[]>([]);
  const [drivers, setDrivers] = useState<readonly Driver[]>([]);
  const [routesError, setRoutesError] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const detailRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [busyVehicleId, setBusyVehicleId] = useState<string | null>(null);
  const [editingVehicleId, setEditingVehicleId] = useState<string | null>(null);
  const [form, setForm] = useState<VehicleForm>(emptyForm);
  const [editForm, setEditForm] = useState<{ type: string; capacityKg: string; status: VehicleStatus }>({
    type: '', capacityKg: '', status: 'active',
  });

  const loadVehicles = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      // El historial complementa la flota: si las rutas fallan, los vehículos se muestran igual.
      const [loadedVehicles, activity] = await Promise.all([
        client.listVehicles(),
        Promise.all([client.listDispatchRoutes(), client.listDrivers()]).then(
          ([loadedRoutes, loadedDrivers]) => ({ loadedRoutes, loadedDrivers }),
          () => null,
        ),
      ]);
      setVehicles(loadedVehicles);
      setRoutes(activity?.loadedRoutes ?? []);
      setDrivers(activity?.loadedDrivers ?? []);
      setRoutesError(activity === null);
    } catch {
      setLoadError('No se pudieron cargar los vehículos. Comprueba la conexión e inténtalo de nuevo.');
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => { void loadVehicles(); }, [loadVehicles]);

  function openCreate() {
    setActionError(null);
    setNotice(null);
    setCreating(true);
  }

  async function createVehicle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActionError(null);
    setNotice(null);
    const capacityKg = parseCapacity(form.capacityKg);
    if (capacityKg === INVALID_CAPACITY) {
      setActionError('La capacidad debe ser un número entre 0.01 y 100,000 kg.');
      return;
    }
    setSaving(true);
    try {
      const created = await client.createVehicle({
        plate: form.plate.trim(), type: form.type.trim(),
        ...(capacityKg === undefined ? {} : { capacityKg }),
      });
      setVehicles((current) => [...current, created].sort(compareVehicles));
      setForm(emptyForm());
      setCreating(false);
      setNotice(`Vehículo ${created.plate} registrado.`);
    } catch (cause) {
      setActionError(errorMessage(cause, 'No se pudo registrar el vehículo.'));
    } finally {
      setSaving(false);
    }
  }

  const startEditing = useCallback((vehicle: Vehicle) => {
    setEditingVehicleId(vehicle.id);
    setEditForm({
      type: vehicle.type,
      capacityKg: vehicle.capacityKg === null ? '' : String(vehicle.capacityKg),
      status: vehicle.status,
    });
    setActionError(null);
    setNotice(null);
  }, []);

  async function saveVehicle(event: FormEvent<HTMLFormElement>, vehicle: Vehicle) {
    event.preventDefault();
    setActionError(null);
    setNotice(null);
    const capacityKg = parseCapacity(editForm.capacityKg);
    if (capacityKg === INVALID_CAPACITY) {
      setActionError('La capacidad debe ser un número entre 0.01 y 100,000 kg, o quedar vacía si se desconoce.');
      return;
    }
    setBusyVehicleId(vehicle.id);
    try {
      const updated = await client.updateVehicle(vehicle.id, {
        type: editForm.type.trim(),
        capacityKg: capacityKg ?? null,
        status: editForm.status,
      });
      setVehicles((current) => current.map((item) => item.id === updated.id ? updated : item));
      setEditingVehicleId(null);
      setNotice(`Cambios del vehículo ${updated.plate} guardados.`);
    } catch (cause) {
      setActionError(errorMessage(cause, 'No se pudieron guardar los cambios.'));
    } finally {
      setBusyVehicleId(null);
    }
  }

  const editingVehicle = vehicles.find((vehicle) => vehicle.id === editingVehicleId);
  const activeVehicles = vehicles.filter((vehicle) => vehicle.status === 'active');
  const activeCapacity = activeVehicles.reduce((total, vehicle) => total + (vehicle.capacityKg ?? 0), 0);
  const ready = !loading && loadError === null;

  const routesByVehicle = useMemo(() => groupRoutesByVehicle(routes), [routes]);
  const statsByVehicle = useMemo(() => new Map(
    [...routesByVehicle].map(([vehicleId, list]) => [vehicleId, summarizeVehicleRoutes(list)] as const),
  ), [routesByVehicle]);
  const driversById = useMemo(() => new Map(drivers.map((driver) => [driver.id, driver] as const)), [drivers]);
  const visibleVehicles = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('es-PE');
    return needle === '' ? vehicles : vehicles.filter((vehicle) =>
      `${vehicle.plate} ${vehicle.type}`.toLocaleLowerCase('es-PE').includes(needle));
  }, [query, vehicles]);
  const selectedVehicle = visibleVehicles.find((vehicle) => vehicle.id === selectedId) ?? visibleVehicles[0];
  const selectedRoutes = selectedVehicle === undefined ? [] : routesByVehicle.get(selectedVehicle.id) ?? [];

  function selectVehicle(vehicle: Vehicle) {
    setSelectedId(vehicle.id);
    // En una sola columna el detalle queda debajo de la lista: se lleva la vista hasta él.
    if (window.matchMedia('(max-width: 1023px)').matches) {
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      detailRef.current?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    }
  }

  return (
    <section className="flex flex-col gap-6">
      <PageHeader title="Vehículos" description={ready && vehicles.length > 0 ? `${activeVehicles.length} de ${vehicles.length} vehículos activos · ${new Intl.NumberFormat('es-PE').format(activeCapacity)} kg de capacidad activa.` : 'Registra la flota y marca cada vehículo activo o inactivo para la operación.'}>
        <Button onClick={openCreate}><Plus data-icon="inline-start" aria-hidden="true" /> Registrar vehículo</Button>
      </PageHeader>

      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}

      {loading && <LoadingRows label="Cargando vehículos…" />}
      {!loading && loadError !== null && (
        <ErrorNotice action={<Button variant="outline" className="mt-2" onClick={() => void loadVehicles()}>Reintentar</Button>}>{loadError}</ErrorNotice>
      )}
      {ready && vehicles.length === 0 && (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon"><Truck aria-hidden="true" /></EmptyMedia>
            <EmptyTitle>Aún no hay vehículos</EmptyTitle>
            <EmptyDescription>Registra un vehículo para comenzar a administrar la flota.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent><Button onClick={openCreate}>Registrar el primero</Button></EmptyContent>
        </Empty>
      )}
      {ready && vehicles.length > 0 && (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
          <div className="flex flex-col gap-3 lg:sticky lg:top-4">
            <SearchInput value={query} onChange={setQuery} label="Buscar vehículos" placeholder="Buscar placa o tipo" className="w-full" />
            {visibleVehicles.length === 0 ? (
              <Empty className="border">
                <EmptyHeader>
                  <EmptyMedia variant="icon"><SearchX aria-hidden="true" /></EmptyMedia>
                  <EmptyTitle>Ningún vehículo coincide</EmptyTitle>
                  <EmptyDescription>Prueba con otra placa o tipo de vehículo.</EmptyDescription>
                </EmptyHeader>
                <EmptyContent><Button variant="outline" onClick={() => setQuery('')}>Ver todos</Button></EmptyContent>
              </Empty>
            ) : (
              <ul aria-label="Flota registrada" className="flex flex-col gap-3 lg:max-h-[calc(100svh-12rem)] lg:overflow-y-auto lg:p-1">
                {visibleVehicles.map((vehicle) => (
                  <VehicleListItem key={vehicle.id} vehicle={vehicle} stats={statsByVehicle.get(vehicle.id) ?? EMPTY_STATS}
                    selected={vehicle.id === selectedVehicle?.id} onSelect={() => selectVehicle(vehicle)} />
                ))}
              </ul>
            )}
          </div>
          <div ref={detailRef} className="scroll-mt-4">
            {selectedVehicle !== undefined && (
              <VehicleDetail vehicle={selectedVehicle} stats={statsByVehicle.get(selectedVehicle.id) ?? EMPTY_STATS}
                monthly={monthlyRoutes(selectedRoutes, todayInLima())} routes={selectedRoutes} drivers={driversById}
                routesError={routesError} onEdit={() => startEditing(selectedVehicle)} />
            )}
          </div>
        </div>
      )}

      <FormSheet open={creating} onOpenChange={setCreating} icon={Truck} title="Registrar vehículo"
        description="La placa identifica el vehículo y no se puede editar después."
        onSubmit={(event) => void createVehicle(event)}
        footer={(
          <>
            <Button type="button" variant="outline" disabled={saving} onClick={() => setCreating(false)}>Cancelar</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Registrando…' : 'Registrar vehículo'}</Button>
          </>
        )}>
        {actionError !== null && <ErrorNotice>{actionError}</ErrorNotice>}
        <FieldGroup className="gap-4">
          <TextField id="new-vehicle-plate" label="Placa" placeholder="Ej. ABC-123" required minLength={3} maxLength={16}
            pattern={IDENTIFIER_PATTERN} value={form.plate}
            onChange={(event) => setForm((current) => ({ ...current, plate: event.target.value }))} />
          <TextField id="new-vehicle-type" label="Tipo de vehículo" placeholder="Ej. Furgoneta" required minLength={2} maxLength={40} value={form.type}
            onChange={(event) => setForm((current) => ({ ...current, type: event.target.value }))} />
          <TextField id="new-vehicle-capacity" label="Capacidad (kg) · opcional" placeholder="Ej. 1200" type="number" min="0.01" max="100000" step="any"
            value={form.capacityKg} onChange={(event) => setForm((current) => ({ ...current, capacityKg: event.target.value }))} />
        </FieldGroup>
      </FormSheet>

      <FormSheet open={editingVehicle !== undefined} onOpenChange={(open) => { if (!open) setEditingVehicleId(null); }} icon={Pencil}
        title={`Editar ${editingVehicle?.plate ?? 'vehículo'}`} description="La placa no se puede cambiar."
        onSubmit={(event) => { if (editingVehicle !== undefined) void saveVehicle(event, editingVehicle); }}
        footer={(
          <>
            <Button type="button" variant="outline" onClick={() => setEditingVehicleId(null)}>Cancelar</Button>
            <Button type="submit" disabled={busyVehicleId === editingVehicleId}>Guardar cambios</Button>
          </>
        )}>
        {actionError !== null && <ErrorNotice>{actionError}</ErrorNotice>}
        <FieldGroup className="gap-4">
          <TextField id="edit-vehicle-type" label="Tipo de vehículo" placeholder="Ej. Furgoneta" required minLength={2} maxLength={40}
            value={editForm.type} onChange={(event) => setEditForm((current) => ({ ...current, type: event.target.value }))} />
          <TextField id="edit-vehicle-capacity" label="Capacidad (kg)" placeholder="Ej. 1200" type="number" min="0.01" max="100000" step="any"
            value={editForm.capacityKg} onChange={(event) => setEditForm((current) => ({ ...current, capacityKg: event.target.value }))} />
          <SelectField id="edit-vehicle-status" label="Disponibilidad" placeholder="Selecciona la disponibilidad" value={editForm.status}
            options={STATUS_OPTIONS} onChange={(status) => setEditForm((current) => ({ ...current, status }))} />
        </FieldGroup>
      </FormSheet>
    </section>
  );
}

const INVALID_CAPACITY = Symbol('invalid capacity');
function parseCapacity(value: string): number | undefined | typeof INVALID_CAPACITY {
  if (value.trim() === '') return undefined;
  const capacity = Number(value);
  return Number.isFinite(capacity) && capacity > 0 && capacity <= 100_000 ? capacity : INVALID_CAPACITY;
}

function compareVehicles(left: Vehicle, right: Vehicle): number {
  return left.plate.localeCompare(right.plate) || left.id.localeCompare(right.id);
}


function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? `${fallback} ${error.message}` : fallback;
}
