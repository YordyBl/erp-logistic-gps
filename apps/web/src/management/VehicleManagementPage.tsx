import { Plus, SearchX, Truck } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';

import type { ApiClient, DispatchRoute, Driver, Vehicle, VehicleRouteStats, VehicleStatus } from '../api/client.js';
import { FormSheet } from '../components/FormSheet.js';
import { ListPager } from '../components/ListPager.js';
import { MetricsPeriodSelect } from '../components/MetricsPeriodSelect.js';
import { SelectField, TextField } from '../components/FormFields.js';
import { RegistrationDialog } from '../components/RegistrationDialog.js';
import { ErrorNotice, LoadingRows, SuccessNotice } from '../components/Notices.js';
import { PageHeader } from '../components/PageHeader.js';
import { SearchInput } from '../components/SearchInput.js';
import { Button } from '../components/ui/button.js';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../components/ui/empty.js';
import { FieldGroup } from '../components/ui/field.js';
import { useServerTable } from '../hooks/use-server-table.js';
import { DEFAULT_METRICS_PERIOD, limaToday, periodLabel, periodRange, type MetricsPeriod } from '../lib/metricsPeriod.js';
import { IDENTIFIER_PATTERN } from '../lib/patterns.js';
import { VehicleDetail } from './vehicles/VehicleDetail.js';
import { VehicleListItem } from './vehicles/VehicleListItem.js';
import { EMPTY_STATS, toMonthlyRoutes, toVehicleStats } from './vehicles/vehicleStats.js';

type VehicleClient = Pick<ApiClient, 'listVehiclesPage' | 'createVehicle' | 'updateVehicle' | 'getVehicleRouteStats'
  | 'listDispatchRoutesPage' | 'listDrivers'>;

/** Rutas del historial del vehículo elegido: la página más reciente. */
const HISTORY_PAGE_SIZE = 20;
/** Vehículos por página de la lista. */
export const FLEET_PAGE_SIZE = 10;

type FleetFilter = 'all' | VehicleStatus;
const FLEET_FILTERS: readonly { readonly value: FleetFilter; readonly label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'active', label: 'Activos' },
  { value: 'inactive', label: 'Inactivos' },
];

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

export function VehicleManagementPage({ client }: { readonly client: VehicleClient }) {
  const fleet = useServerTable<Vehicle>(
    (params, signal) => client.listVehiclesPage(params, signal), { pageSize: FLEET_PAGE_SIZE },
  );
  const vehicles = fleet.rows;
  const [routeStats, setRouteStats] = useState<readonly VehicleRouteStats[]>([]);
  const [history, setHistory] = useState<RouteHistoryState | null>(null);
  const [drivers, setDrivers] = useState<readonly Driver[]>([]);
  const [routesError, setRoutesError] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const query = fleet.state.globalFilter;
  const setQuery = (value: string) => fleet.handlers.onGlobalFilterChange(value);
  const filter = (fleet.state.columnFilters.find((item) => item.id === 'status')?.value as FleetFilter | undefined) ?? 'all';
  const setFilter = (value: FleetFilter) =>
    fleet.handlers.onColumnFiltersChange(value === 'all' ? [] : [{ id: 'status', value }]);
  const detailRef = useRef<HTMLDivElement>(null);
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

  // Los conductores solo nombran a quien manejó cada ruta del historial: si fallan, la flota se muestra igual.
  useEffect(() => {
    let cancelled = false;
    client.listDrivers().then((loaded) => { if (!cancelled) setDrivers(loaded); }, () => undefined);
    return () => { cancelled = true; };
  }, [client]);

  // Las métricas se piden solo para los vehículos de la página y el periodo elegido; cambiar el periodo
  // no vuelve a pedir la lista. Si fallan, los vehículos se muestran igual.
  const [period, setPeriod] = useState<MetricsPeriod>(DEFAULT_METRICS_PERIOD);
  const [statsToken, setStatsToken] = useState(0);
  const visibleIdsKey = vehicles.map((vehicle) => vehicle.id).join(',');
  useEffect(() => {
    if (visibleIdsKey === '') return undefined;
    let cancelled = false;
    client.getVehicleRouteStats({ ...periodRange(period, limaToday()), ids: visibleIdsKey.split(',') }).then((loaded) => {
      if (cancelled) return;
      setRouteStats(loaded);
      setRoutesError(false);
    }, () => {
      if (cancelled) return;
      setRouteStats([]);
      setRoutesError(true);
    });
    return () => { cancelled = true; };
  }, [client, period, statsToken, visibleIdsKey]);

  // El resumen describe toda la flota: se toma de los conteos cuando no hay búsqueda y se conserva
  // mientras se busca (los conteos del servidor aplican la búsqueda).
  const [fleetSummary, setFleetSummary] = useState<{ readonly active: number; readonly total: number } | null>(null);
  const statusCounts = fleet.meta?.counts?.status;
  const searching = fleet.params.q !== undefined;
  useEffect(() => {
    if (statusCounts === undefined || searching) return;
    const active = statusCounts.active ?? 0;
    setFleetSummary({ active, total: active + (statusCounts.inactive ?? 0) });
  }, [searching, statusCounts]);
  const loading = fleet.meta === null && fleet.error === null;
  const loadError = fleet.meta === null && fleet.error !== null
    ? 'No se pudieron cargar los vehículos. Comprueba la conexión e inténtalo de nuevo.' : null;

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
      fleet.reload();
      setStatsToken((token) => token + 1);
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
      fleet.reload();
      setEditingVehicleId(null);
      setNotice(`Cambios del vehículo ${updated.plate} guardados.`);
    } catch (cause) {
      setActionError(errorMessage(cause, 'No se pudieron guardar los cambios.'));
    } finally {
      setBusyVehicleId(null);
    }
  }

  const editingVehicle = vehicles.find((vehicle) => vehicle.id === editingVehicleId);
  const ready = !loading && loadError === null;
  const fleetEmpty = ready && fleetSummary?.total === 0;

  const statsByVehicle = useMemo(() => new Map(routeStats.map((item) => [item.vehicleId, item] as const)), [routeStats]);
  const driversById = useMemo(() => new Map(drivers.map((driver) => [driver.id, driver] as const)), [drivers]);
  const visibleVehicles = vehicles;
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
      <PageHeader title="Vehículos" description={ready && fleetSummary !== null && fleetSummary.total > 0 ? `${fleetSummary.active} de ${fleetSummary.total} vehículos activos.` : 'Registra la flota y marca cada vehículo activo o inactivo para la operación.'}>
        <Button onClick={openCreate}><Plus data-icon="inline-start" aria-hidden="true" /> Registrar vehículo</Button>
      </PageHeader>

      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}
      <RegistrationDialog title="Vehículo registrado" message={registered} onClose={() => setRegistered(null)} />

      {loading && <LoadingRows label="Cargando vehículos…" />}
      {!loading && loadError !== null && (
        <ErrorNotice action={<Button variant="outline" className="mt-2" onClick={() => fleet.reload()}>Reintentar</Button>}>{loadError}</ErrorNotice>
      )}
      {fleetEmpty && (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon"><Truck aria-hidden="true" /></EmptyMedia>
            <EmptyTitle>Aún no hay vehículos</EmptyTitle>
            <EmptyDescription>Registra un vehículo para comenzar a administrar la flota.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent><Button onClick={openCreate}>Registrar el primero</Button></EmptyContent>
        </Empty>
      )}
      {ready && !fleetEmpty && (
        <div className="flex justify-end">
          <MetricsPeriodSelect id="vehicle-metrics-period" value={period} onChange={setPeriod} />
        </div>
      )}
      {ready && !fleetEmpty && (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
          <div className="flex flex-col gap-3 lg:sticky lg:top-4">
            <SearchInput value={query} onChange={setQuery} label="Buscar vehículos" placeholder="Buscar placa o tipo" className="w-full" />
            <div className="grid grid-cols-3 gap-1" role="group" aria-label="Filtrar vehículos">
              {FLEET_FILTERS.map((option) => (
                <Button key={option.value} type="button" variant={filter === option.value ? 'secondary' : 'ghost'}
                  aria-pressed={filter === option.value} onClick={() => setFilter(option.value)}>
                  {option.label}
                  <span className="text-muted-foreground tabular-nums">
                    {option.value === 'all'
                      ? (statusCounts?.active ?? 0) + (statusCounts?.inactive ?? 0)
                      : statusCounts?.[option.value] ?? 0}
                  </span>
                </Button>
              ))}
            </div>
            {visibleVehicles.length === 0 ? (
              <Empty className="border">
                <EmptyHeader>
                  <EmptyMedia variant="icon"><SearchX aria-hidden="true" /></EmptyMedia>
                  <EmptyTitle>Ningún vehículo coincide</EmptyTitle>
                  <EmptyDescription>Prueba con otra placa o tipo de vehículo.</EmptyDescription>
                </EmptyHeader>
                <EmptyContent><Button variant="outline" onClick={() => { setQuery(''); setFilter('all'); }}>Ver todos</Button></EmptyContent>
              </Empty>
            ) : (
              <ul aria-label="Flota registrada" aria-busy={fleet.loading} className="flex flex-col gap-3 lg:max-h-[calc(100svh-16rem)] lg:overflow-y-auto lg:p-1">
                {visibleVehicles.map((vehicle) => (
                  <VehicleListItem key={vehicle.id} vehicle={vehicle} stats={statsOf(statsByVehicle.get(vehicle.id))}
                    selected={vehicle.id === selectedVehicle?.id} onSelect={() => selectVehicle(vehicle)} />
                ))}
              </ul>
            )}
            <ListPager table={fleet} label="vehículos" />
          </div>
          <div ref={detailRef} className="scroll-mt-4">
            {selectedVehicle !== undefined && (
              <VehicleDetail vehicle={selectedVehicle} stats={statsOf(selectedStats)}
                monthly={selectedMonthly} routes={selectedHistory?.routes ?? []} routesTotal={selectedHistory?.total ?? 0}
                drivers={driversById} routesError={routesError} periodLabel={periodLabel(period)} historyError={selectedHistory?.failed ?? false}
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


function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? `${fallback} ${error.message}` : fallback;
}
