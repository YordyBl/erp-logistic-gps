import type { ColumnDef } from '@tanstack/react-table';
import { Check, CirclePause, Pencil, Plus, Truck } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';

import type { ApiClient, Vehicle, VehicleStatus } from '../api/client.js';
import { RowActions, SortableHeader } from '../components/data-table/columnHelpers.js';
import { DataTable } from '../components/data-table/DataTable.js';
import { FormSheet } from '../components/FormSheet.js';
import { SelectField, TextField } from '../components/FormFields.js';
import { IconChip } from '../components/IconChip.js';
import { ErrorNotice, LoadingRows, SuccessNotice } from '../components/Notices.js';
import { PageHeader } from '../components/PageHeader.js';
import { Badge } from '../components/ui/badge.js';
import { Button } from '../components/ui/button.js';
import { DropdownMenuItem } from '../components/ui/dropdown-menu.js';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../components/ui/empty.js';
import { FieldGroup } from '../components/ui/field.js';
import { IDENTIFIER_PATTERN } from '../lib/patterns.js';

type VehicleClient = Pick<ApiClient, 'listVehicles' | 'createVehicle' | 'updateVehicle'>;

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
      setVehicles(await client.listVehicles());
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

  const columns = useMemo<readonly ColumnDef<Vehicle, unknown>[]>(() => [
    {
      accessorKey: 'plate',
      header: ({ column }) => <SortableHeader column={column} title="Placa" />,
      enableHiding: false,
      cell: ({ row }) => (
        <span className="flex items-center gap-3">
          <IconChip icon={Truck} tone={row.original.status === 'active' ? 'primary' : 'neutral'} />
          <span className="font-medium tabular-nums">{row.original.plate}</span>
        </span>
      ),
    },
    {
      accessorKey: 'type',
      header: ({ column }) => <SortableHeader column={column} title="Tipo" />,
      meta: { title: 'Tipo' },
    },
    {
      accessorKey: 'capacityKg',
      header: ({ column }) => <SortableHeader column={column} title="Capacidad" />,
      enableGlobalFilter: false,
      meta: { title: 'Capacidad' },
      cell: ({ row }) => <span className="tabular-nums">{capacityLabel(row.original.capacityKg)}</span>,
    },
    {
      accessorKey: 'status',
      header: 'Disponibilidad',
      filterFn: 'arrIncludesSome',
      enableGlobalFilter: false,
      meta: { title: 'Disponibilidad' },
      cell: ({ row }) => (
        <Badge variant={row.original.status === 'active' ? 'success' : 'secondary'}>
          {row.original.status === 'active' ? 'Activo' : 'Inactivo'}
          {row.original.status === 'active' ? <Check data-icon="inline-end" aria-hidden="true" /> : <CirclePause data-icon="inline-end" aria-hidden="true" />}
        </Badge>
      ),
    },
    {
      id: 'actions',
      enableHiding: false,
      cell: ({ row }) => (
        <RowActions label={`Acciones de ${row.original.plate}`}>
          <DropdownMenuItem onSelect={() => startEditing(row.original)}><Pencil aria-hidden="true" /> Editar vehículo</DropdownMenuItem>
        </RowActions>
      ),
    },
  ], [startEditing]);

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
        <>
          <DataTable label="Flota registrada" columns={columns} data={vehicles} searchPlaceholder="Buscar placa o tipo"
            filters={[{ columnId: 'status', title: 'Disponibilidad', options: STATUS_OPTIONS }]} onRowClick={startEditing} />
        </>
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

function capacityLabel(capacityKg: number | null): string {
  return capacityKg === null ? 'No especificada' : `${new Intl.NumberFormat('es-PE').format(capacityKg)} kg`;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? `${fallback} ${error.message}` : fallback;
}
