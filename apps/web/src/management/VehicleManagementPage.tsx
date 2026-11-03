import { useCallback, useEffect, useState, type FormEvent } from 'react';

import type { ApiClient, Vehicle, VehicleStatus } from '../api/client.js';
import { Button, StatusPill, Surface } from '../components/Primitives.js';
import './VehicleManagementPage.css';

type VehicleClient = Pick<ApiClient, 'listVehicles' | 'createVehicle' | 'updateVehicle'>;

interface VehicleForm {
  plate: string;
  type: string;
  capacityKg: string;
}

const emptyForm = (): VehicleForm => ({ plate: '', type: '', capacityKg: '' });

export function VehicleManagementPage({ client }: { readonly client: VehicleClient }) {
  const [vehicles, setVehicles] = useState<readonly Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
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
      setVehicles(await client.listVehicles());
    } catch {
      setLoadError('No se pudieron cargar los vehículos. Comprueba la conexión e inténtalo de nuevo.');
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => { void loadVehicles(); }, [loadVehicles]);

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
      setNotice(`Vehículo ${created.plate} registrado.`);
    } catch (cause) {
      setActionError(errorMessage(cause, 'No se pudo registrar el vehículo.'));
    } finally {
      setSaving(false);
    }
  }

  function startEditing(vehicle: Vehicle) {
    setEditingVehicleId(vehicle.id);
    setEditForm({
      type: vehicle.type,
      capacityKg: vehicle.capacityKg === null ? '' : String(vehicle.capacityKg),
      status: vehicle.status,
    });
    setActionError(null);
    setNotice(null);
  }

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

  return (
    <section className="vehicle-management">
      <header className="vehicle-management__header">
        <div>
          <p className="vehicle-management__context">OPERACIÓN · FLOTA</p>
          <h1>Vehículos</h1>
          <p>Registra la flota y marca cada vehículo activo o inactivo para la operación.</p>
        </div>
        {!loading && loadError === null && <span className="vehicle-management__count">
          {vehicles.length} {vehicles.length === 1 ? 'vehículo' : 'vehículos'}
        </span>}
      </header>

      {actionError !== null && <p className="vehicle-management__alert" role="alert">{actionError}</p>}
      {notice !== null && <p className="vehicle-management__success" role="status">{notice}</p>}

      <section className="vehicle-management__layout" aria-label="Gestión de vehículos">
        <Surface className="vehicle-management__form-surface">
          <div className="vehicle-management__section-heading">
            <div><h2>Registrar vehículo</h2><p>La placa identifica el vehículo y no se puede editar después.</p></div>
          </div>
          <form className="vehicle-management__form" onSubmit={(event) => void createVehicle(event)}>
            <label className="vehicle-management__field" htmlFor="new-vehicle-plate">Placa
              <input id="new-vehicle-plate" required minLength={3} maxLength={16}
                pattern="[A-Za-z0-9]+(-[A-Za-z0-9]+)*" value={form.plate}
                onChange={(event) => setForm((current) => ({ ...current, plate: event.target.value }))} />
            </label>
            <label className="vehicle-management__field" htmlFor="new-vehicle-type">Tipo de vehículo
              <input id="new-vehicle-type" required minLength={2} maxLength={40} value={form.type}
                onChange={(event) => setForm((current) => ({ ...current, type: event.target.value }))} />
            </label>
            <label className="vehicle-management__field" htmlFor="new-vehicle-capacity">Capacidad (kg) · opcional
              <input id="new-vehicle-capacity" type="number" min="0.01" max="100000" step="any"
                value={form.capacityKg} onChange={(event) => setForm((current) => ({ ...current, capacityKg: event.target.value }))} />
            </label>
            <div className="vehicle-management__form-actions">
              <Button type="submit" disabled={saving}>{saving ? 'Registrando…' : 'Registrar vehículo'}</Button>
            </div>
          </form>
        </Surface>

        <Surface className="vehicle-management__list-surface">
          <div className="vehicle-management__section-heading">
            <div><h2>Flota registrada</h2><p>El estado activo/inactivo es la disponibilidad que ofrece actualmente el catálogo.</p></div>
          </div>
          {loading ? <p className="vehicle-management__loading" role="status">Cargando vehículos…</p>
            : loadError !== null ? <div className="vehicle-management__empty" role="alert">
              <p>{loadError}</p><Button variant="secondary" onClick={() => void loadVehicles()}>Reintentar</Button>
            </div>
              : vehicles.length === 0 ? <div className="vehicle-management__empty">
                <h3>Aún no hay vehículos</h3><p>Registra un vehículo para comenzar a administrar la flota.</p>
              </div>
                : <ul className="vehicle-management__list">
                  {vehicles.map((vehicle) => {
                    const isEditing = editingVehicleId === vehicle.id;
                    return <li className="vehicle-management__row" key={vehicle.id} aria-label={`Vehículo ${vehicle.plate}`}>
                      <div className="vehicle-management__identity">
                        <div>
                          <h3>{vehicle.plate}</h3>
                          <p><span>Tipo</span>{vehicle.type}</p>
                          <p><span>Capacidad</span>{capacityLabel(vehicle.capacityKg)}</p>
                        </div>
                        <StatusPill tone={vehicle.status === 'active' ? 'success' : 'neutral'}>
                          {vehicle.status === 'active' ? 'Activo' : 'Inactivo'}
                        </StatusPill>
                      </div>
                      {isEditing ? (
                        <form className="vehicle-management__edit-form" onSubmit={(event) => void saveVehicle(event, vehicle)}>
                          <label className="vehicle-management__field" htmlFor={`edit-vehicle-type-${vehicle.id}`}>Tipo de vehículo
                            <input id={`edit-vehicle-type-${vehicle.id}`} required minLength={2} maxLength={40}
                              value={editForm.type} onChange={(event) => setEditForm((current) => ({ ...current, type: event.target.value }))} />
                          </label>
                          <label className="vehicle-management__field" htmlFor={`edit-vehicle-capacity-${vehicle.id}`}>Capacidad (kg)
                            <input id={`edit-vehicle-capacity-${vehicle.id}`} type="number" min="0.01" max="100000" step="any"
                              value={editForm.capacityKg} onChange={(event) => setEditForm((current) => ({ ...current, capacityKg: event.target.value }))} />
                          </label>
                          <label className="vehicle-management__field" htmlFor={`edit-vehicle-status-${vehicle.id}`}>Disponibilidad
                            <select id={`edit-vehicle-status-${vehicle.id}`} value={editForm.status}
                              onChange={(event) => setEditForm((current) => ({ ...current, status: event.target.value as VehicleStatus }))}>
                              <option value="active">Activo</option><option value="inactive">Inactivo</option>
                            </select>
                          </label>
                          <div className="vehicle-management__row-actions">
                            <Button type="submit" disabled={busyVehicleId === vehicle.id}>Guardar cambios</Button>
                            <Button type="button" variant="secondary" onClick={() => setEditingVehicleId(null)}>Cancelar</Button>
                          </div>
                        </form>
                      ) : <div className="vehicle-management__row-actions">
                        <Button type="button" variant="secondary" onClick={() => startEditing(vehicle)} aria-label={`Editar ${vehicle.plate}`}>
                          Editar vehículo
                        </Button>
                      </div>}
                    </li>;
                  })}
                </ul>}
        </Surface>
      </section>
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

function capacityLabel(capacityKg: number | null): string {
  return capacityKg === null ? 'No especificada' : `${new Intl.NumberFormat('es-PE').format(capacityKg)} kg`;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? `${fallback} ${error.message}` : fallback;
}
