import { IdCard, KeyRound, Pencil, Plus, SearchX } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';

import type { ApiClient, Driver, DriverAccountOption, DriverStatus } from '../api/client.js';
import { DocumentSheet, FormSheet } from '../components/FormSheet.js';
import { SelectField, TextField } from '../components/FormFields.js';
import { RegistrationDialog } from '../components/RegistrationDialog.js';
import { ErrorNotice, LoadingRows, SuccessNotice } from '../components/Notices.js';
import { PageHeader } from '../components/PageHeader.js';
import { SearchInput } from '../components/SearchInput.js';
import { Badge } from '../components/ui/badge.js';
import { Button } from '../components/ui/button.js';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../components/ui/empty.js';
import { FieldGroup } from '../components/ui/field.js';
import { IDENTIFIER_PATTERN, PHONE_PATTERN } from '../lib/patterns.js';
import { DriverCard } from './drivers/DriverCard.js';
import { countByFilter, DRIVER_FILTERS, filterDrivers, indexAccountsByDriver, type DriverFilter } from './drivers/driverFilters.js';

type DriverClient = Pick<ApiClient,
  'listDrivers' | 'listDriverAccounts' | 'createDriver' | 'updateDriver' | 'bindDriverAccount'>;

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

const newDriverForm = (): DriverForm => ({
  fullName: '', documentNumber: '', phone: '', licenseNumber: '', status: 'active',
});

export function DriverManagementPage({ client, canBindAccounts }: {
  readonly client: DriverClient;
  readonly canBindAccounts: boolean;
}) {
  const [drivers, setDrivers] = useState<readonly Driver[]>([]);
  const [accounts, setAccounts] = useState<readonly DriverAccountOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
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
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<DriverFilter>('all');

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [loadedDrivers, loadedAccounts] = await Promise.all([
        client.listDrivers(),
        canBindAccounts ? client.listDriverAccounts() : Promise.resolve([]),
      ]);
      setDrivers(loadedDrivers);
      setAccounts(loadedAccounts);
    } catch {
      setLoadError('No se pudieron cargar los conductores. Comprueba la conexión e inténtalo de nuevo.');
    } finally {
      setLoading(false);
    }
  }, [canBindAccounts, client]);

  useEffect(() => { void loadData(); }, [loadData]);

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
      setDrivers((current) => [...current, created].sort(compareDrivers));
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
      setDrivers((current) => current.map((item) => item.id === updated.id ? updated : item));
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
  const activeCount = drivers.filter((driver) => driver.status === 'active').length;
  const linkedCount = accounts.filter((account) => account.driverId !== null).length;
  const ready = !loading && loadError === null;

  const accountByDriver = useMemo(() => indexAccountsByDriver(accounts), [accounts]);
  const filterCounts = useMemo(() => countByFilter(drivers, accountByDriver), [accountByDriver, drivers]);
  const visibleDrivers = useMemo(() => filterDrivers(drivers, filter, query, accountByDriver), [accountByDriver, drivers, filter, query]);
  const filterOptions = DRIVER_FILTERS.filter((option) => canBindAccounts || option.value !== 'unlinked');

  function openAccount(driver: Driver) {
    setActionError(null);
    setNotice(null);
    setAccountDriverId(driver.id);
  }

  return (
    <section className="flex flex-col gap-6">
      <PageHeader title="Conductores" description={ready && drivers.length > 0 ? `${activeCount} de ${drivers.length} conductores activos${canBindAccounts ? ` · ${linkedCount} con cuenta vinculada` : ''}.` : 'Administra los perfiles operativos y las cuentas autorizadas para ejecutar rutas.'}>
        <Button onClick={openCreate}><Plus data-icon="inline-start" aria-hidden="true" /> Registrar conductor</Button>
      </PageHeader>

      {!sheetOpen && actionError !== null && <ErrorNotice>{actionError}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}
      <RegistrationDialog title="Conductor registrado" message={registered} onClose={() => setRegistered(null)} />

      {loading && <LoadingRows label="Cargando conductores…" />}
      {!loading && loadError !== null && (
        <ErrorNotice action={<Button variant="outline" className="mt-2" onClick={() => void loadData()}>Reintentar</Button>}>{loadError}</ErrorNotice>
      )}
      {ready && drivers.length === 0 && (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon"><IdCard aria-hidden="true" /></EmptyMedia>
            <EmptyTitle>Aún no hay conductores</EmptyTitle>
            <EmptyDescription>Registra el primer perfil para habilitar la planificación de rutas.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent><Button onClick={openCreate}>Registrar el primero</Button></EmptyContent>
        </Empty>
      )}
      {ready && drivers.length > 0 && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="grid grid-cols-2 gap-1 sm:flex sm:flex-wrap" role="group" aria-label="Filtrar conductores">
              {filterOptions.map((option) => (
                <Button key={option.value} type="button" variant={filter === option.value ? 'secondary' : 'ghost'}
                  aria-pressed={filter === option.value} onClick={() => setFilter(option.value)}>
                  {option.label}
                  <span className="text-muted-foreground tabular-nums">{filterCounts[option.value]}</span>
                </Button>
              ))}
            </div>
            <SearchInput value={query} onChange={setQuery} label="Buscar conductores" placeholder="Buscar nombre, documento o licencia" className="w-full lg:w-96" />
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
            <ul aria-label="Personal registrado" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {visibleDrivers.map((driver) => (
                <DriverCard key={driver.id} driver={driver} account={accountByDriver.get(driver.id)} canBindAccounts={canBindAccounts}
                  onEdit={() => startEditing(driver)} onManageAccount={() => openAccount(driver)} />
              ))}
            </ul>
          )}
        </div>
      )}

      <FormSheet open={createOpen} onOpenChange={setCreateOpen} icon={IdCard} title="Registrar conductor"
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

      <FormSheet open={editingDriver !== undefined} onOpenChange={(open) => { if (!open) setEditingDriverId(null); }} icon={Pencil}
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

      <DocumentSheet open={accountDriver !== undefined} onOpenChange={(open) => { if (!open) setAccountDriverId(null); }} icon={KeyRound}
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

function compareDrivers(left: Driver, right: Driver): number {
  return left.fullName.localeCompare(right.fullName) || left.id.localeCompare(right.id);
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? `${fallback} ${error.message}` : fallback;
}
