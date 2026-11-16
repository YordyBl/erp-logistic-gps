import { IdCard, Plus, SearchX } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';

import type { ApiClient, DispatchRoute, Driver, DriverAccountOption, DriverRouteStats, DriverStatus, Vehicle } from '../api/client.js';
import { DocumentSheet, FormSheet } from '../components/FormSheet.js';
import { ListPager } from '../components/ListPager.js';
import { MetricsPeriodSelect } from '../components/MetricsPeriodSelect.js';
import { SelectField, TextField } from '../components/FormFields.js';
import { RegistrationDialog } from '../components/RegistrationDialog.js';
import { ErrorNotice, LoadingRows, SuccessNotice } from '../components/Notices.js';
import { PageHeader } from '../components/PageHeader.js';
import { SearchInput } from '../components/SearchInput.js';
import { Badge } from '../components/ui/badge.js';
import { Button } from '../components/ui/button.js';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../components/ui/empty.js';
import { FieldGroup } from '../components/ui/field.js';
import { useServerTable } from '../hooks/use-server-table.js';
import { chartCaption, DEFAULT_METRICS_PERIOD, limaToday, periodLabel, statsScope, type MetricsPeriod } from '../lib/metricsPeriod.js';
import { IDENTIFIER_PATTERN, PHONE_PATTERN } from '../lib/patterns.js';
import { DriverDetail } from './drivers/DriverDetail.js';
import { DriverListItem } from './drivers/DriverListItem.js';
import {
  chipCounts, DRIVER_FILTERS, filterFromColumns, indexAccountsByDriver, toColumnFilters, type DriverFilter,
} from './drivers/driverFilters.js';
import { toMonthlyRoutes } from './vehicles/vehicleStats.js';

type DriverClient = Pick<ApiClient,
  'listDriversPage' | 'listDriverAccounts' | 'getDriverRouteStats' | 'createDriver' | 'updateDriver' | 'bindDriverAccount'
  | 'listDispatchRoutesPage' | 'listVehicles'>;

/** Viajes del historial del conductor elegido: la página más reciente. */
const HISTORY_PAGE_SIZE = 20;

interface TripHistoryState {
  readonly driverId: string;
  readonly routes: readonly DispatchRoute[];
  readonly total: number;
  readonly failed: boolean;
}

interface DriverForm {
  fullName: string;
  documentNumber: string;
  phone: string;
  licenseNumber: string;
  status: DriverStatus;
}

const STATUS_OPTIONS: readonly { readonly value: DriverStatus; readonly label: string }[] = [
  { value: 'active', label: 'Activo' },
  { value: 'inactive', label: 'Inactivo' },
];

/** Conductores por página de la lista, como la flota. */
export const CREW_PAGE_SIZE = 10;

const NO_TRIPS = { routes: 0, completed: 0, stops: 0, orders: 0, lastRouteDay: null } as const;

const newDriverForm = (): DriverForm => ({
  fullName: '', documentNumber: '', phone: '', licenseNumber: '', status: 'active',
});

export function DriverManagementPage({ client, canBindAccounts }: {
  readonly client: DriverClient;
  readonly canBindAccounts: boolean;
}) {
  const crew = useServerTable<Driver>(
    (params, signal) => client.listDriversPage(params, signal), { pageSize: CREW_PAGE_SIZE },
  );
  const drivers = crew.rows;
  const [accounts, setAccounts] = useState<readonly DriverAccountOption[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [registered, setRegistered] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [accountDriverId, setAccountDriverId] = useState<string | null>(null);
  const [busyDriverId, setBusyDriverId] = useState<string | null>(null);
  const [editingDriverId, setEditingDriverId] = useState<string | null>(null);
  const [form, setForm] = useState<DriverForm>(newDriverForm);
  const [editForm, setEditForm] = useState<DriverForm>(newDriverForm);
  const [selectedAccounts, setSelectedAccounts] = useState<Readonly<Record<string, string>>>({});
  const query = crew.state.globalFilter;
  const setQuery = (value: string) => crew.handlers.onGlobalFilterChange(value);
  const filter = filterFromColumns(crew.state.columnFilters);
  const setFilter = (value: DriverFilter) => crew.handlers.onColumnFiltersChange(toColumnFilters(value));
  const [accountsError, setAccountsError] = useState(false);

  // Las cuentas solo las ve ADMIN; se vuelven a pedir con la página tras vincular o desvincular.
  const loadAccounts = useCallback(async () => {
    if (!canBindAccounts) return;
    try {
      setAccounts(await client.listDriverAccounts());
      setAccountsError(false);
    } catch {
      setAccountsError(true);
    }
  }, [canBindAccounts, client]);

  useEffect(() => { void loadAccounts(); }, [loadAccounts]);

  const loadData = useCallback(async () => {
    crew.reload();
    await loadAccounts();
  }, [crew.reload, loadAccounts]);

  // El resumen describe todo el personal: se toma de los conteos cuando no hay búsqueda y se
  // conserva mientras se busca (los conteos del servidor aplican la búsqueda).
  const facets = crew.meta?.counts;
  const searching = crew.params.q !== undefined;
  const [crewSummary, setCrewSummary] = useState<{ readonly active: number; readonly total: number; readonly linked: number } | null>(null);
  useEffect(() => {
    if (facets === undefined || searching) return;
    const counts = chipCounts(facets);
    setCrewSummary({ active: counts.active, total: counts.all, linked: facets.account?.linked ?? 0 });
  }, [facets, searching]);
  // Los viajes se piden solo para los conductores de la página y el periodo elegido; cambiar el periodo
  // no vuelve a pedir la lista. Si fallan, las tarjetas muestran guiones.
  const [period, setPeriod] = useState<MetricsPeriod>(DEFAULT_METRICS_PERIOD);
  const [trips, setTrips] = useState<ReadonlyMap<string, DriverRouteStats> | null>(new Map());
  const [tripsToken, setTripsToken] = useState(0);
  const visibleIdsKey = drivers.map((driver) => driver.id).join(',');
  useEffect(() => {
    if (visibleIdsKey === '') return undefined;
    let cancelled = false;
    client.getDriverRouteStats({ ...statsScope(period, limaToday()), ids: visibleIdsKey.split(',') }).then((loaded) => {
      if (!cancelled) setTrips(new Map(loaded.map((item) => [item.driverId, item] as const)));
    }, () => {
      if (!cancelled) setTrips(null);
    });
    return () => { cancelled = true; };
  }, [client, period, tripsToken, visibleIdsKey]);
  const totalsOf = (driverId: string) => trips === null ? null : trips.get(driverId) ?? NO_TRIPS;

  // Las placas solo nombran el vehículo de cada viaje del historial: si fallan, se muestra igual.
  const [vehicles, setVehicles] = useState<ReadonlyMap<string, Vehicle>>(new Map());
  useEffect(() => {
    let cancelled = false;
    client.listVehicles().then((loaded) => {
      if (!cancelled) setVehicles(new Map(loaded.map((vehicle) => [vehicle.id, vehicle] as const)));
    }, () => undefined);
    return () => { cancelled = true; };
  }, [client]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const selectedDriver = drivers.find((driver) => driver.id === selectedId) ?? drivers[0];
  const selectedDriverId = selectedDriver?.id;
  const selectedStats = selectedDriverId === undefined || trips === null ? undefined : trips.get(selectedDriverId);
  // Sin serie del conductor (no tuvo viajes) se usan los meses de otro, en cero.
  const selectedMonthly = useMemo(() => {
    const months = selectedStats?.monthly
      ?? (trips === null ? [] : [...trips.values()][0]?.monthly.map(({ month }) => ({ month, routes: 0 })) ?? []);
    return toMonthlyRoutes(months);
  }, [selectedStats, trips]);

  // El historial se pide al servidor solo para el conductor elegido, una página.
  const [history, setHistory] = useState<TripHistoryState | null>(null);
  useEffect(() => {
    if (selectedDriverId === undefined) return undefined;
    const controller = new AbortController();
    client.listDispatchRoutesPage({ driverId: selectedDriverId, pageSize: HISTORY_PAGE_SIZE, sort: 'plannedDate:desc' }, controller.signal)
      .then((page) => {
        if (!controller.signal.aborted) setHistory({ driverId: selectedDriverId, routes: page.data, total: page.meta.total, failed: false });
      }, () => {
        if (!controller.signal.aborted) setHistory({ driverId: selectedDriverId, routes: [], total: 0, failed: true });
      });
    return () => controller.abort();
  }, [client, selectedDriverId, tripsToken]);
  const selectedHistory = history?.driverId === selectedDriverId ? history : null;

  function selectDriver(driver: Driver) {
    setSelectedId(driver.id);
    // En una sola columna el detalle queda debajo de la lista: se lleva la vista hasta él.
    if (window.matchMedia('(max-width: 1023px)').matches) {
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      detailRef.current?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    }
  }

  const loading = crew.meta === null && crew.error === null;
  const loadError = crew.meta === null && crew.error !== null
    ? 'No se pudieron cargar los conductores. Comprueba la conexión e inténtalo de nuevo.' : null;

  function openCreate() {
    setActionError(null);
    setNotice(null);
    setCreateOpen(true);
  }

  async function createDriver(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActionError(null);
    setNotice(null);
    setCreating(true);
    try {
      const created = await client.createDriver({
        fullName: form.fullName.trim(), documentNumber: form.documentNumber.trim(),
        phone: form.phone.trim(), licenseNumber: form.licenseNumber.trim(), status: form.status,
      });
      crew.reload();
      setTripsToken((token) => token + 1);
      setForm(newDriverForm());
      setCreateOpen(false);
      setRegistered(`El conductor ${created.fullName} se registró correctamente.`);
    } catch (cause) {
      setActionError(errorMessage(cause, 'No se pudo registrar el conductor.'));
    } finally {
      setCreating(false);
    }
  }

  const startEditing = useCallback((driver: Driver) => {
    setEditingDriverId(driver.id);
    setEditForm({
      fullName: driver.fullName, documentNumber: driver.documentNumber,
      phone: driver.phone, licenseNumber: driver.licenseNumber, status: driver.status,
    });
    setActionError(null);
    setNotice(null);
  }, []);

  async function saveDriver(event: FormEvent<HTMLFormElement>, driver: Driver) {
    event.preventDefault();
    setActionError(null);
    setNotice(null);
    setBusyDriverId(driver.id);
    try {
      const updated = await client.updateDriver(driver.id, {
        fullName: editForm.fullName.trim(), phone: editForm.phone.trim(),
        licenseNumber: editForm.licenseNumber.trim(), status: editForm.status,
      });
      crew.reload();
      setTripsToken((token) => token + 1);
      setEditingDriverId(null);
      setNotice(`Cambios de ${updated.fullName} guardados.`);
    } catch (cause) {
      setActionError(errorMessage(cause, 'No se pudieron guardar los cambios.'));
    } finally {
      setBusyDriverId(null);
    }
  }

  async function saveAccountLink(driver: Driver, userId: string) {
    const account = accounts.find((item) => item.userId === userId);
    if (account === undefined || account.status !== 'active' ||
        (account.driverId !== null && account.driverId !== driver.id)) {
      setActionError('La cuenta ya no está disponible para este conductor. Actualiza la lista e inténtalo de nuevo.');
      return;
    }
    if (!window.confirm(`¿Vincular ${account.email} con ${driver.fullName}?`)) return;
    setActionError(null);
    setNotice(null);
    setBusyDriverId(driver.id);
    try {
      await client.bindDriverAccount(driver.id, userId);
      setSelectedAccounts((current) => ({ ...current, [driver.id]: '' }));
      await loadData();
      setAccountDriverId(null);
      setNotice(`Cuenta vinculada a ${driver.fullName}.`);
      setBusyDriverId(null);
    } catch (cause) {
      setActionError(errorMessage(cause, 'No se pudo vincular la cuenta. Actualiza la lista e inténtalo de nuevo.'));
      setBusyDriverId(null);
    }
  }

  async function unlinkAccount(driver: Driver) {
    const account = accounts.find((item) => item.driverId === driver.id);
    if (account === undefined || !window.confirm(`¿Desvincular ${account.email} de ${driver.fullName}?`)) return;
    setActionError(null);
    setNotice(null);
    setBusyDriverId(driver.id);
    try {
      await client.bindDriverAccount(driver.id, null);
      setSelectedAccounts((current) => ({ ...current, [driver.id]: '' }));
      await loadData();
      setAccountDriverId(null);
      setNotice(`Cuenta desvinculada de ${driver.fullName}.`);
      setBusyDriverId(null);
    } catch (cause) {
      setActionError(errorMessage(cause, 'No se pudo desvincular la cuenta. Actualiza la lista e inténtalo de nuevo.'));
      setBusyDriverId(null);
    }
  }

  const editingDriver = drivers.find((driver) => driver.id === editingDriverId);
  const accountDriver = drivers.find((driver) => driver.id === accountDriverId);
  const sheetOpen = createOpen || editingDriver !== undefined || accountDriver !== undefined;
  const ready = !loading && loadError === null;
  const crewEmpty = ready && crewSummary?.total === 0;

  const accountByDriver = useMemo(() => indexAccountsByDriver(accounts), [accounts]);
  const filterCounts = chipCounts(facets);
  const visibleDrivers = drivers;
  const filterOptions = DRIVER_FILTERS.filter((option) => canBindAccounts || option.value !== 'unlinked');

  function openAccount(driver: Driver) {
    setActionError(null);
    setNotice(null);
    setAccountDriverId(driver.id);
  }

  return (
    <section className="flex flex-col gap-6">
      <PageHeader title="Conductores" description={ready && crewSummary !== null && crewSummary.total > 0 ? `${crewSummary.active} de ${crewSummary.total} conductores activos${canBindAccounts ? ` · ${crewSummary.linked} con cuenta vinculada` : ''}.` : 'Administra los perfiles operativos y las cuentas autorizadas para ejecutar rutas.'}>
        <Button onClick={openCreate}><Plus data-icon="inline-start" aria-hidden="true" /> Registrar conductor</Button>
      </PageHeader>

      {!sheetOpen && actionError !== null && <ErrorNotice>{actionError}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}
      <RegistrationDialog title="Conductor registrado" message={registered} onClose={() => setRegistered(null)} />

      {loading && <LoadingRows label="Cargando conductores…" />}
      {!loading && loadError !== null && (
        <ErrorNotice action={<Button variant="outline" className="mt-2" onClick={() => void loadData()}>Reintentar</Button>}>{loadError}</ErrorNotice>
      )}
      {canBindAccounts && accountsError && (
        <ErrorNotice>No se pudieron cargar las cuentas DRIVER. Las vinculaciones pueden no estar al día.</ErrorNotice>
      )}
      {crewEmpty && (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon"><IdCard aria-hidden="true" /></EmptyMedia>
            <EmptyTitle>Aún no hay conductores</EmptyTitle>
            <EmptyDescription>Registra el primer perfil para habilitar la planificación de rutas.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent><Button onClick={openCreate}>Registrar el primero</Button></EmptyContent>
        </Empty>
      )}
      {ready && !crewEmpty && (
        <div className="flex justify-end">
          <MetricsPeriodSelect id="driver-metrics-period" value={period} onChange={setPeriod} />
        </div>
      )}
      {ready && !crewEmpty && (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
          <div className="flex flex-col gap-3 lg:sticky lg:top-4">
            <SearchInput value={query} onChange={setQuery} label="Buscar conductores" placeholder="Buscar nombre, documento o licencia" className="w-full" />
            <div className="grid grid-cols-2 gap-1" role="group" aria-label="Filtrar conductores">
              {filterOptions.map((option) => (
                <Button key={option.value} type="button" variant={filter === option.value ? 'secondary' : 'ghost'}
                  aria-pressed={filter === option.value} onClick={() => setFilter(option.value)}>
                  {option.label}
                  <span className="text-muted-foreground tabular-nums">{filterCounts[option.value]}</span>
                </Button>
              ))}
            </div>
            {visibleDrivers.length === 0 ? (
              <Empty className="border">
                <EmptyHeader>
                  <EmptyMedia variant="icon"><SearchX aria-hidden="true" /></EmptyMedia>
                  <EmptyTitle>{query.trim() === '' ? 'No hay conductores en este grupo' : 'Ningún conductor coincide'}</EmptyTitle>
                  <EmptyDescription>
                    {query.trim() === ''
                      ? 'Elige otro filtro o muestra todos los conductores.'
                      : 'Prueba con otro nombre, documento o licencia, o muestra todos los conductores.'}
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button variant="outline" onClick={() => { setQuery(''); setFilter('all'); }}>Ver todos</Button>
                </EmptyContent>
              </Empty>
            ) : (
              <ul aria-label="Personal registrado" aria-busy={crew.loading} className="flex flex-col gap-3 lg:max-h-[calc(100svh-16rem)] lg:overflow-y-auto lg:p-1">
                {visibleDrivers.map((driver) => (
                  <DriverListItem key={driver.id} driver={driver} totals={totalsOf(driver.id)}
                    selected={driver.id === selectedDriver?.id} onSelect={() => selectDriver(driver)} />
                ))}
              </ul>
            )}
            <ListPager table={crew} label="conductores" />
          </div>
          <div ref={detailRef} className="scroll-mt-4">
            {selectedDriver !== undefined && (
              <DriverDetail driver={selectedDriver} stats={selectedStats} monthly={selectedMonthly}
                account={accountByDriver.get(selectedDriver.id)} canBindAccounts={canBindAccounts}
                routes={selectedHistory?.routes ?? []} routesTotal={selectedHistory?.total ?? 0} vehicles={vehicles}
                statsError={trips === null} historyError={selectedHistory?.failed ?? false} historyLoading={selectedHistory === null}
                periodLabel={periodLabel(period)} chartCaption={chartCaption(period)}
                onEdit={() => startEditing(selectedDriver)} onManageAccount={() => openAccount(selectedDriver)} />
            )}
          </div>
        </div>
      )}

      <FormSheet open={createOpen} onOpenChange={setCreateOpen} title="Registrar conductor"
        description="Los documentos de identidad no se pueden cambiar después del registro."
        onSubmit={(event) => void createDriver(event)}
        footer={(
          <>
            <Button type="button" variant="outline" disabled={creating} onClick={() => setCreateOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={creating}>{creating ? 'Registrando…' : 'Registrar conductor'}</Button>
          </>
        )}>
        {actionError !== null && <ErrorNotice>{actionError}</ErrorNotice>}
        <FieldGroup className="gap-4">
          <TextField id="new-driver-name" label="Nombre completo" placeholder="Ej. Andrea Quispe Rojas" required minLength={2} maxLength={120} value={form.fullName}
            onChange={(event) => setForm((current) => ({ ...current, fullName: event.target.value }))} />
          <TextField id="new-driver-document" label="Documento de identidad" placeholder="Ej. 70123456" required minLength={6} maxLength={20}
            pattern={IDENTIFIER_PATTERN} value={form.documentNumber}
            onChange={(event) => setForm((current) => ({ ...current, documentNumber: event.target.value }))} />
          <TextField id="new-driver-phone" label="Teléfono" placeholder="Ej. 900 000 123" required minLength={6} maxLength={32} pattern={PHONE_PATTERN}
            value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} />
          <TextField id="new-driver-license" label="Licencia de conducir" placeholder="Ej. Q-12345678" required minLength={4} maxLength={40}
            pattern={IDENTIFIER_PATTERN} value={form.licenseNumber}
            onChange={(event) => setForm((current) => ({ ...current, licenseNumber: event.target.value }))} />
        </FieldGroup>
      </FormSheet>

      <FormSheet open={editingDriver !== undefined} onOpenChange={(open) => { if (!open) setEditingDriverId(null); }}
        title={`Editar ${editingDriver?.fullName ?? 'conductor'}`} description="El documento de identidad no se puede cambiar."
        onSubmit={(event) => { if (editingDriver !== undefined) void saveDriver(event, editingDriver); }}
        footer={(
          <>
            <Button type="button" variant="outline" onClick={() => setEditingDriverId(null)}>Cancelar</Button>
            <Button type="submit" disabled={busyDriverId === editingDriverId}>Guardar cambios</Button>
          </>
        )}>
        {actionError !== null && <ErrorNotice>{actionError}</ErrorNotice>}
        <FieldGroup className="gap-4">
          <TextField id="edit-driver-name" label="Nombre completo" placeholder="Ej. Andrea Quispe Rojas" required minLength={2} maxLength={120} value={editForm.fullName}
            onChange={(event) => setEditForm((current) => ({ ...current, fullName: event.target.value }))} />
          <TextField id="edit-driver-phone" label="Teléfono" placeholder="Ej. 900 000 123" required minLength={6} maxLength={32} pattern={PHONE_PATTERN} value={editForm.phone}
            onChange={(event) => setEditForm((current) => ({ ...current, phone: event.target.value }))} />
          <TextField id="edit-driver-license" label="Licencia de conducir" placeholder="Ej. Q-12345678" required minLength={4} maxLength={40} pattern={IDENTIFIER_PATTERN} value={editForm.licenseNumber}
            onChange={(event) => setEditForm((current) => ({ ...current, licenseNumber: event.target.value }))} />
          <SelectField id="edit-driver-status" label="Estado" placeholder="Selecciona un estado" value={editForm.status}
            options={STATUS_OPTIONS} onChange={(status) => setEditForm((current) => ({ ...current, status }))} />
        </FieldGroup>
      </FormSheet>

      <DocumentSheet open={accountDriver !== undefined} onOpenChange={(open) => { if (!open) setAccountDriverId(null); }}
        title={`Cuenta de ${accountDriver?.fullName ?? 'conductor'}`} description="La cuenta DRIVER autoriza a ejecutar rutas en la aplicación.">
        {actionError !== null && <ErrorNotice>{actionError}</ErrorNotice>}
        {accountDriver !== undefined && (
          <AccountSection canBindAccounts={canBindAccounts} driver={accountDriver} linkedAccount={accounts.find((account) => account.driverId === accountDriver.id)}
            choices={accounts.filter((account) => account.status === 'active' && (account.driverId === null || account.driverId === accountDriver.id))}
            selectedUserId={selectedAccounts[accountDriver.id] ?? accounts.find((account) => account.driverId === accountDriver.id)?.userId ?? ''}
            busy={busyDriverId === accountDriver.id}
            onSelect={(userId) => setSelectedAccounts((current) => ({ ...current, [accountDriver.id]: userId }))}
            onLink={() => void saveAccountLink(accountDriver, selectedAccounts[accountDriver.id] ?? '')} onUnlink={() => void unlinkAccount(accountDriver)} />
        )}
      </DocumentSheet>
    </section>
  );
}

function AccountSection({ canBindAccounts, driver, linkedAccount, choices, selectedUserId, busy, onSelect, onLink, onUnlink }: {
  readonly canBindAccounts: boolean;
  readonly driver: Driver;
  readonly linkedAccount: DriverAccountOption | undefined;
  readonly choices: readonly DriverAccountOption[];
  readonly selectedUserId: string;
  readonly busy: boolean;
  readonly onSelect: (userId: string) => void;
  readonly onLink: () => void;
  readonly onUnlink: () => void;
}) {
  if (!canBindAccounts) return <p className="text-sm text-muted-foreground">Vinculación reservada a ADMIN</p>;
  if (linkedAccount !== undefined) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>{linkedAccount.email}</span>
        {linkedAccount.status === 'disabled' && <Badge variant="destructive">Cuenta desactivada</Badge>}
        <Button type="button" variant="ghost" disabled={busy} onClick={onUnlink} aria-label="Desvincular cuenta">Desvincular</Button>
      </div>
    );
  }
  if (choices.length === 0) return <p className="text-muted-foreground">Sin vincular. No hay cuentas DRIVER activas disponibles.</p>;
  return (
    <div className="flex flex-col gap-2">
      <SelectField id={`driver-account-${driver.id}`} label={`Cuenta para ${driver.fullName}`} placeholder="Selecciona una cuenta sin vínculo"
        value={selectedUserId} options={choices.map((account) => ({ value: account.userId, label: account.email }))} onChange={onSelect} />
      <Button type="button" disabled={selectedUserId === '' || busy} onClick={onLink}>Vincular cuenta</Button>
    </div>
  );
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? `${fallback} ${error.message}` : fallback;
}
