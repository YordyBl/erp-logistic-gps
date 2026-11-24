import { Plus, SearchX, Truck } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';

import type { ApiClient, DispatchRoute, Driver, Vehicle, VehicleRouteStats, VehicleStatus } from '../api/client.js';
import { FormSheet } from '../components/FormSheet.js';
import { SelectField, TextField } from '../components/FormFields.js';
import { RegistrationDialog } from '../components/RegistrationDialog.js';
import { ErrorNotice, LoadingRows, SuccessNotice } from '../components/Notices.js';
import { PageHeader } from '../components/PageHeader.js';
import { SearchInput } from '../components/SearchInput.js';
import { Button } from '../components/ui/button.js';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../components/ui/empty.js';
import { FieldGroup } from '../components/ui/field.js';
import { IDENTIFIER_PATTERN } from '../lib/patterns.js';
import { VehicleDetail } from './vehicles/VehicleDetail.js';
import { VehicleListItem } from './vehicles/VehicleListItem.js';
import { EMPTY_STATS, toMonthlyRoutes, toVehicleStats } from './vehicles/vehicleStats.js';

type VehicleClient = Pick<ApiClient, 'listVehicles' | 'createVehicle' | 'updateVehicle' | 'getVehicleRouteStats'
  | 'listDispatchRoutesPage' | 'listDrivers'>;

/** Rutas del historial del vehículo elegido: la página más reciente. */
const HISTORY_PAGE_SIZE = 20;

interface RouteHistoryState {
  readonly vehicleId: string;
  readonly routes: readonly DispatchRoute[];
  readonly total: number;
  readonly failed: boolean;
}

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

export function VehicleManagementPage({ client, initialQuery = '' }: {
  readonly client: VehicleClient;
  /** Búsqueda con la que abre, por ejemplo la que llega del buscador global. */
  readonly initialQuery?: string;
}) {
  const [vehicles, setVehicles] = useState<readonly Vehicle[]>([]);
  const [routeStats, setRouteStats] = useState<readonly VehicleRouteStats[]>([]);
  const [history, setHistory] = useState<RouteHistoryState | null>(null);
  const [drivers, setDrivers] = useState<readonly Driver[]>([]);
  const [routesError, setRoutesError] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState(initialQuery);
  const detailRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [registered, setRegistered] = useState<string | null>(null);
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
      // Las estadísticas complementan la flota: si fallan, los vehículos se muestran igual.
      const [loadedVehicles, loadedStats, loadedDrivers] = await Promise.all([
        client.listVehicles(),
        client.getVehicleRouteStats().catch(() => null),
        client.listDrivers().catch(() => [] as readonly Driver[]),
      ]);
      setVehicles(loadedVehicles);
      setRouteStats(loadedStats ?? []);
      setDrivers(loadedDrivers);
      setRoutesError(loadedStats === null);
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
      setRegistered(`El vehículo ${created.plate} se registró correctamente.`);
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

  const statsByVehicle = useMemo(() => new Map(routeStats.map((item) => [item.vehicleId, item] as const)), [routeStats]);
  const driversById = useMemo(() => new Map(drivers.map((driver) => [driver.id, driver] as const)), [drivers]);
  const visibleVehicles = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('es-PE');
    return needle === '' ? vehicles : vehicles.filter((vehicle) =>
      `${vehicle.plate} ${vehicle.type}`.toLocaleLowerCase('es-PE').includes(needle));
  }, [query, vehicles]);
  const selectedVehicle = visibleVehicles.find((vehicle) => vehicle.id === selectedId) ?? visibleVehicles[0];
  const selectedVehicleId = selectedVehicle?.id;
  const selectedStats = selectedVehicleId === undefined ? undefined : statsByVehicle.get(selectedVehicleId);
  // Un vehículo recién registrado aún no tiene serie: se usan los meses de otro, en cero.
  const selectedMonthly = useMemo(() => toMonthlyRoutes(selectedStats?.monthly
    ?? routeStats[0]?.monthly.map(({ month }) => ({ month, routes: 0 })) ?? []), [routeStats, selectedStats]);

  // El historial se pide al servidor solo para el vehículo elegido, una página.
  useEffect(() => {
    if (selectedVehicleId === undefined) return undefined;
    const controller = new AbortController();
    client.listDispatchRoutesPage({ vehicleId: selectedVehicleId, pageSize: HISTORY_PAGE_SIZE, sort: 'plannedDate:desc' }, controller.signal)
      .then((page) => {
        if (!controller.signal.aborted) setHistory({ vehicleId: selectedVehicleId, routes: page.data, total: page.meta.total, failed: false });
      }, () => {
        if (!controller.signal.aborted) setHistory({ vehicleId: selectedVehicleId, routes: [], total: 0, failed: true });
      });
    return () => controller.abort();
  }, [client, selectedVehicleId, routeStats]);
  const selectedHistory = history?.vehicleId === selectedVehicleId ? history : null;

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
      <RegistrationDialog title="Vehículo registrado" message={registered} onClose={() => setRegistered(null)} />

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
                  <VehicleListItem key={vehicle.id} vehicle={vehicle} stats={statsOf(statsByVehicle.get(vehicle.id))}
                    selected={vehicle.id === selectedVehicle?.id} onSelect={() => selectVehicle(vehicle)} />
                ))}
              </ul>
            )}
          </div>
          <div ref={detailRef} className="scroll-mt-4">
            {selectedVehicle !== undefined && (
              <VehicleDetail vehicle={selectedVehicle} stats={statsOf(selectedStats)}
                monthly={selectedMonthly} routes={selectedHistory?.routes ?? []} routesTotal={selectedHistory?.total ?? 0}
                drivers={driversById} routesError={routesError} historyError={selectedHistory?.failed ?? false}
                historyLoading={selectedHistory === null}
                onEdit={() => startEditing(selectedVehicle)} />
            )}
          </div>
        </div>
      )}

      <FormSheet open={creating} onOpenChange={setCreating} title="Registrar vehículo"
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

      <FormSheet open={editingVehicle !== undefined} onOpenChange={(open) => { if (!open) setEditingVehicleId(null); }}
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

function statsOf(stats: VehicleRouteStats | undefined) {
  return stats === undefined ? EMPTY_STATS : toVehicleStats(stats);
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
