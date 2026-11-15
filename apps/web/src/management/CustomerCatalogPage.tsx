import type { ColumnDef } from '@tanstack/react-table';
import { Building2, Check, CirclePause, Mail, Phone, Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import type { ApiClient, CreateCustomerInput, Customer } from '../api/client.js';
import { RowActions, SortableHeader } from '../components/data-table/columnHelpers.js';
import { DataTable } from '../components/data-table/DataTable.js';
import { FormSheet } from '../components/FormSheet.js';
import { SelectField, TextField } from '../components/FormFields.js';
import { IconChip } from '../components/IconChip.js';
import { RegistrationDialog } from '../components/RegistrationDialog.js';
import { ErrorNotice, LoadingRows, SuccessNotice } from '../components/Notices.js';
import { PageHeader } from '../components/PageHeader.js';
import { Badge } from '../components/ui/badge.js';
import { Button } from '../components/ui/button.js';
import { DropdownMenuItem } from '../components/ui/dropdown-menu.js';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../components/ui/empty.js';
import { FieldGroup } from '../components/ui/field.js';
import { useServerTable } from '../hooks/use-server-table.js';
import { IDENTIFIER_PATTERN, PHONE_PATTERN } from '../lib/patterns.js';

type CustomerCatalogClient = Pick<ApiClient, 'listCustomersPage' | 'createCustomer'>;
type CustomerStatus = NonNullable<CreateCustomerInput['status']>;

const STATUS_OPTIONS: readonly { readonly value: CustomerStatus; readonly label: string }[] = [
  { value: 'active', label: 'Activo' },
  { value: 'inactive', label: 'Inactivo' },
];

/** Columnas que el servidor sabe ordenar (`sort=name`); el resto queda sin orden. */
const CUSTOMER_SORT_FIELDS = { name: 'name' } as const;
const CUSTOMER_FILTER_PARAMS = { status: 'status' } as const;

const CUSTOMER_COLUMNS: readonly ColumnDef<Customer, unknown>[] = [
  {
    id: 'name',
    accessorFn: (customer) => `${customer.name} ${customer.publicCode}`,
    header: ({ column }) => <SortableHeader column={column} title="Empresa" />,
    enableHiding: false,
    cell: ({ row }) => (
      <span className="flex items-center gap-3">
        <IconChip icon={Building2} />
        <span className="flex flex-col">
          <span className="font-medium">{row.original.name}</span>
          <span className="text-muted-foreground tabular-nums">{row.original.publicCode}</span>
        </span>
      </span>
    ),
  },
  {
    id: 'contact',
    accessorFn: (customer) => `${customer.contactName} ${customer.contactEmail} ${customer.contactPhone}`,
    header: 'Contacto',
    enableSorting: false,
    meta: { title: 'Contacto' },
    cell: ({ row }) => (
      <span className="flex flex-col gap-0.5">
        <span className="font-medium">{row.original.contactName}</span>
        <span className="flex items-center gap-1.5 text-muted-foreground"><Mail className="size-3.5" aria-hidden="true" /><span>{row.original.contactEmail}</span></span>
        <span className="flex items-center gap-1.5 text-muted-foreground"><Phone className="size-3.5" aria-hidden="true" /><span>{row.original.contactPhone}</span></span>
      </span>
    ),
  },
  {
    accessorKey: 'status',
    header: 'Estado',
    enableSorting: false,
    meta: { title: 'Estado' },
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
    enableSorting: false,
    cell: ({ row }) => (
      <RowActions label={`Acciones de ${row.original.name}`}>
        <DropdownMenuItem onSelect={() => void navigator.clipboard?.writeText(row.original.contactEmail)}><Mail aria-hidden="true" /> Copiar correo</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void navigator.clipboard?.writeText(row.original.contactPhone)}><Phone aria-hidden="true" /> Copiar teléfono</DropdownMenuItem>
      </RowActions>
    ),
  },
];

const emptyForm: CreateCustomerInput = {
  publicCode: '',
  name: '',
  contactName: '',
  contactEmail: '',
  contactPhone: '',
  status: 'active',
};

export function CustomerCatalogPage({ client }: { readonly client: CustomerCatalogClient }) {
  // El servidor ordena por nombre por defecto; la cabecera lo refleja desde el inicio.
  const table = useServerTable<Customer>(
    (params, signal) => client.listCustomersPage(params, signal),
    { sortFields: CUSTOMER_SORT_FIELDS, filterParams: CUSTOMER_FILTER_PARAMS, initialSorting: [{ id: 'name', desc: false }] },
  );
  const { rows, meta, reload } = table;
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<CreateCustomerInput>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [registered, setRegistered] = useState<string | null>(null);

  function openForm() {
    setSuccessMessage('');
    setSaveFailed(false);
    setFormOpen(true);
  }

  function updateField<Key extends keyof CreateCustomerInput>(key: Key, value: CreateCustomerInput[Key]) {
    setForm((previous) => ({ ...previous, [key]: value }));
    setSaveFailed(false);
  }

  async function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;

    setSaving(true);
    setSaveFailed(false);
    setSuccessMessage('');
    try {
      const created = await client.createCustomer(form);
      reload();
      setRegistered(`El cliente «${created.name}» se registró correctamente.`);
      setForm(emptyForm);
      setFormOpen(false);
    } catch {
      setSaveFailed(true);
    } finally {
      setSaving(false);
    }
  }

  const loadFailed = table.error !== null;
  // Conteos del servidor: aplican la búsqueda, pero no el filtro de estado.
  const statusCounts = meta?.counts?.status ?? {};
  const activeCount = statusCounts.active ?? 0;
  const catalogCount = Object.values(statusCounts).reduce((sum, count) => sum + count, 0);
  const hasCriteria = table.state.globalFilter.trim() !== '' || table.state.columnFilters.length > 0;
  const isEmpty = meta !== null && meta.total === 0 && !hasCriteria;

  return (
    <section className="flex flex-col gap-6">
      <PageHeader title="Clientes" description={!loadFailed && catalogCount > 0 ? `Empresas que contratan el servicio · ${activeCount} de ${catalogCount} activas.` : 'Empresas que contratan el servicio de entrega.'}>
        <Button onClick={openForm}><Plus data-icon="inline-start" aria-hidden="true" /> Nuevo cliente</Button>
      </PageHeader>

      {successMessage && <SuccessNotice>{successMessage}</SuccessNotice>}
      <RegistrationDialog title="Cliente registrado" message={registered} onClose={() => setRegistered(null)} />
      <div className="flex flex-col gap-4">
        {meta === null && table.loading && <LoadingRows label="Cargando clientes…" />}
        {loadFailed && !table.loading && (
          <ErrorNotice action={<Button variant="outline" className="mt-2" onClick={reload}>Reintentar</Button>}>
            No se pudo cargar el catálogo. Revisa la conexión e inténtalo de nuevo.
          </ErrorNotice>
        )}
        {isEmpty && !table.loading && !loadFailed && (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon"><Building2 aria-hidden="true" /></EmptyMedia>
              <EmptyTitle>Todavía no hay clientes</EmptyTitle>
              <EmptyDescription>Registra la primera empresa para asociarla a sus pedidos de entrega.</EmptyDescription>
            </EmptyHeader>
            <EmptyContent><Button onClick={openForm}>Registrar cliente</Button></EmptyContent>
          </Empty>
        )}
        {meta !== null && !isEmpty && (
          <DataTable label="Clientes registrados" columns={CUSTOMER_COLUMNS} data={rows} server={table.server}
            searchPlaceholder="Buscar empresa, código o contacto"
            filters={[{ columnId: 'status', title: 'Estado', options: STATUS_OPTIONS }]} />
        )}
      </div>

      <FormSheet open={formOpen} onOpenChange={setFormOpen} title="Registrar cliente"
        description="Completa los datos de contacto para identificar a la empresa." formLabel="Nuevo cliente"
        onSubmit={(event) => void submitForm(event)}
        footer={(
          <>
            <Button type="button" variant="outline" disabled={saving} onClick={() => setFormOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Guardando…' : 'Guardar cliente'}</Button>
          </>
        )}>
        {saveFailed && <ErrorNotice>No se pudo registrar el cliente. Verifica los datos e inténtalo de nuevo.</ErrorNotice>}
        <FieldGroup className="gap-4">
          <TextField id="customer-code" label="Código del cliente" placeholder="Ej. NORTE-02" autoComplete="off" maxLength={32} minLength={3}
            pattern={IDENTIFIER_PATTERN} required value={form.publicCode} onChange={(event) => updateField('publicCode', event.target.value)} />
          <TextField id="customer-name" label="Razón social" placeholder="Ej. Distribuidora Norte SAC" autoComplete="organization" maxLength={120} minLength={2}
            required value={form.name} onChange={(event) => updateField('name', event.target.value)} />
          <TextField id="customer-contact" label="Nombre de contacto" placeholder="Ej. Ana Torres" autoComplete="name" maxLength={120} minLength={2}
            required value={form.contactName} onChange={(event) => updateField('contactName', event.target.value)} />
          <TextField id="customer-email" label="Correo de contacto" placeholder="contacto@empresa.pe" autoComplete="email" maxLength={254} required type="email"
            value={form.contactEmail} onChange={(event) => updateField('contactEmail', event.target.value)} />
          <TextField id="customer-phone" label="Teléfono de contacto" placeholder="Ej. 900 000 123" autoComplete="tel" maxLength={32} minLength={6}
            pattern={PHONE_PATTERN} required type="tel" value={form.contactPhone} onChange={(event) => updateField('contactPhone', event.target.value)} />
          <SelectField id="customer-status" label="Estado" placeholder="Selecciona un estado" value={form.status ?? 'active'}
            options={STATUS_OPTIONS} onChange={(status) => updateField('status', status)} />
        </FieldGroup>
      </FormSheet>
    </section>
  );
}
