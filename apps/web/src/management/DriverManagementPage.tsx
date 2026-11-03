import { useCallback, useEffect, useState, type FormEvent } from 'react';

import type { ApiClient, Driver, DriverAccountOption, DriverStatus } from '../api/client.js';
import { Button, StatusPill, Surface } from '../components/Primitives.js';
import './DriverManagementPage.css';

type DriverClient = Pick<ApiClient,
  'listDrivers' | 'listDriverAccounts' | 'createDriver' | 'updateDriver' | 'bindDriverAccount'>;

interface DriverForm {
  fullName: string;
  documentNumber: string;
  phone: string;
  licenseNumber: string;
  status: DriverStatus;
}

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
  const [creating, setCreating] = useState(false);
  const [busyDriverId, setBusyDriverId] = useState<string | null>(null);
  const [editingDriverId, setEditingDriverId] = useState<string | null>(null);
  const [form, setForm] = useState<DriverForm>(newDriverForm);
  const [editForm, setEditForm] = useState<DriverForm>(newDriverForm);
  const [selectedAccounts, setSelectedAccounts] = useState<Readonly<Record<string, string>>>({});

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
      setNotice(`Conductor ${created.fullName} registrado.`);
    } catch (cause) {
      setActionError(errorMessage(cause, 'No se pudo registrar el conductor.'));
    } finally {
      setCreating(false);
    }
  }

  function startEditing(driver: Driver) {
    setEditingDriverId(driver.id);
    setEditForm({
      fullName: driver.fullName, documentNumber: driver.documentNumber,
      phone: driver.phone, licenseNumber: driver.licenseNumber, status: driver.status,
    });
    setActionError(null);
    setNotice(null);
  }

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
      setNotice(`Cuenta desvinculada de ${driver.fullName}.`);
      setBusyDriverId(null);
    } catch (cause) {
      setActionError(errorMessage(cause, 'No se pudo desvincular la cuenta. Actualiza la lista e inténtalo de nuevo.'));
      setBusyDriverId(null);
    }
  }

  return (
    <section className="driver-management">
      <header className="driver-management__header">
        <div>
          <h1>Conductores</h1>
          <p>Administra los perfiles operativos y las cuentas autorizadas para ejecutar rutas.</p>
        </div>
        <span className="driver-management__count" aria-label={`${drivers.length} conductores`}>
          {drivers.length} {drivers.length === 1 ? 'conductor' : 'conductores'}
        </span>
      </header>

      {actionError !== null && <p className="driver-management__alert" role="alert">{actionError}</p>}
      {notice !== null && <p className="driver-management__success" role="status">{notice}</p>}

      <Surface className="driver-management__create-surface">
        <div className="driver-management__section-heading">
          <div><h2>Registrar conductor</h2><p>Los documentos de identidad no se pueden cambiar después del registro.</p></div>
        </div>
        <form className="driver-management__form" onSubmit={(event) => void createDriver(event)}>
          <label className="driver-management__field" htmlFor="new-driver-name">Nombre completo
            <input id="new-driver-name" required minLength={2} maxLength={120} value={form.fullName}
              onChange={(event) => setForm((current) => ({ ...current, fullName: event.target.value }))} />
          </label>
          <label className="driver-management__field" htmlFor="new-driver-document">Documento de identidad
            <input id="new-driver-document" required minLength={6} maxLength={20}
              pattern="[A-Za-z0-9]+(-[A-Za-z0-9]+)*" value={form.documentNumber}
              onChange={(event) => setForm((current) => ({ ...current, documentNumber: event.target.value }))} />
          </label>
          <label className="driver-management__field" htmlFor="new-driver-phone">Teléfono
            <input id="new-driver-phone" required minLength={6} maxLength={32} pattern="[+]?[0-9][0-9 ()-]*"
              value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} />
          </label>
          <label className="driver-management__field" htmlFor="new-driver-license">Licencia de conducir
            <input id="new-driver-license" required minLength={4} maxLength={40}
              pattern="[A-Za-z0-9]+(-[A-Za-z0-9]+)*" value={form.licenseNumber}
              onChange={(event) => setForm((current) => ({ ...current, licenseNumber: event.target.value }))} />
          </label>
          <div className="driver-management__form-actions">
            <Button type="submit" disabled={creating}>{creating ? 'Registrando…' : 'Registrar conductor'}</Button>
          </div>
        </form>
      </Surface>

      <Surface className="driver-management__list-surface">
        <div className="driver-management__section-heading">
          <div><h2>Personal registrado</h2><p>Documento y licencia identifican el perfil; la cuenta DRIVER autoriza el acceso operativo.</p></div>
        </div>
        {loading ? <p className="driver-management__loading" role="status">Cargando conductores…</p>
          : loadError !== null ? <div className="driver-management__empty" role="alert">
            <p>{loadError}</p><Button variant="secondary" onClick={() => void loadData()}>Reintentar</Button>
          </div>
            : drivers.length === 0 ? <div className="driver-management__empty">
              <h3>Aún no hay conductores</h3><p>Registra el primer perfil para habilitar la planificación de rutas.</p>
            </div>
              : <ul className="driver-management__list">
                {drivers.map((driver) => {
                  const linkedAccount = accounts.find((account) => account.driverId === driver.id);
                  const selectedUserId = selectedAccounts[driver.id] ?? linkedAccount?.userId ?? '';
                  const accountChoices = accounts.filter((account) => account.status === 'active' &&
                    (account.driverId === null || account.driverId === driver.id));
                  const isEditing = editingDriverId === driver.id;
                  return (
                    <li className="driver-management__row" key={driver.id} aria-label={`Conductor ${driver.fullName}`}>
                      <div className="driver-management__identity">
                        <div>
                          <h3>{driver.fullName}</h3>
                          <p><span>Documento</span>{driver.documentNumber}</p>
                          <p><span>Teléfono</span>{driver.phone}</p>
                          <p><span>Licencia</span>{driver.licenseNumber}</p>
                        </div>
                        <StatusPill tone={driver.status === 'active' ? 'success' : 'neutral'}>
                          {driver.status === 'active' ? 'Activo' : 'Inactivo'}
                        </StatusPill>
                      </div>

                      {isEditing ? (
                        <form className="driver-management__edit-form" onSubmit={(event) => void saveDriver(event, driver)}>
                          <label className="driver-management__field" htmlFor={`edit-driver-name-${driver.id}`}>Nombre completo
                            <input id={`edit-driver-name-${driver.id}`} required minLength={2} maxLength={120} value={editForm.fullName}
                              onChange={(event) => setEditForm((current) => ({ ...current, fullName: event.target.value }))} />
                          </label>
                          <label className="driver-management__field" htmlFor={`edit-driver-phone-${driver.id}`}>Teléfono
                            <input id={`edit-driver-phone-${driver.id}`} required minLength={6} maxLength={32} pattern="[+]?[0-9][0-9 ()-]*" value={editForm.phone}
                              onChange={(event) => setEditForm((current) => ({ ...current, phone: event.target.value }))} />
                          </label>
                          <label className="driver-management__field" htmlFor={`edit-driver-license-${driver.id}`}>Licencia de conducir
                            <input id={`edit-driver-license-${driver.id}`} required minLength={4} maxLength={40} pattern="[A-Za-z0-9]+(-[A-Za-z0-9]+)*" value={editForm.licenseNumber}
                              onChange={(event) => setEditForm((current) => ({ ...current, licenseNumber: event.target.value }))} />
                          </label>
                          <label className="driver-management__field" htmlFor={`edit-driver-status-${driver.id}`}>Estado
                            <select id={`edit-driver-status-${driver.id}`} value={editForm.status}
                              onChange={(event) => setEditForm((current) => ({ ...current, status: event.target.value as DriverStatus }))}>
                              <option value="active">Activo</option><option value="inactive">Inactivo</option>
                            </select>
                          </label>
                          <div className="driver-management__row-actions">
                            <Button type="submit" disabled={busyDriverId === driver.id}>Guardar cambios</Button>
                            <Button type="button" variant="secondary" onClick={() => setEditingDriverId(null)}>Cancelar</Button>
                          </div>
                        </form>
                      ) : (
                        <div className="driver-management__row-actions">
                          <Button type="button" variant="secondary" onClick={() => startEditing(driver)} aria-label={`Editar ${driver.fullName}`}>
                            Editar conductor
                          </Button>
                        </div>
                      )}

                      <div className="driver-management__account">
                        <h4>Cuenta de acceso</h4>
                        {canBindAccounts ? linkedAccount !== undefined ? (
                          <div className="driver-management__linked-account">
                            <span>{linkedAccount.email}</span>
                            {linkedAccount.status === 'disabled' && <StatusPill tone="danger">Cuenta desactivada</StatusPill>}
                            <Button type="button" variant="quiet" disabled={busyDriverId === driver.id}
                              onClick={() => void unlinkAccount(driver)} aria-label="Desvincular cuenta">Desvincular</Button>
                          </div>
                        ) : (
                          <div className="driver-management__link-controls">
                            <label className="driver-management__field" htmlFor={`driver-account-${driver.id}`}>Cuenta para {driver.fullName}
                              <select id={`driver-account-${driver.id}`} value={selectedUserId}
                                onChange={(event) => setSelectedAccounts((current) => ({ ...current, [driver.id]: event.target.value }))}>
                                <option value="">Selecciona una cuenta sin vínculo</option>
                                {accountChoices.map((account) => <option key={account.userId} value={account.userId}>{account.email}</option>)}
                              </select>
                            </label>
                            <Button type="button" disabled={!selectedUserId || busyDriverId === driver.id}
                              onClick={() => void saveAccountLink(driver, selectedUserId)}>
                              Vincular cuenta
                            </Button>
                            {accountChoices.length === 0 && <p>No hay cuentas DRIVER activas sin vínculo.</p>}
                          </div>
                        ) : <p className="driver-management__account-restricted">Vinculación reservada a ADMIN</p>}
                      </div>
                    </li>
                  );
                })}
              </ul>}
      </Surface>
    </section>
  );
}

function compareDrivers(left: Driver, right: Driver): number {
  return left.fullName.localeCompare(right.fullName) || left.id.localeCompare(right.id);
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? `${fallback} ${error.message}` : fallback;
}
