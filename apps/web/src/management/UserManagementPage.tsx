import type { ColumnDef } from '@tanstack/react-table';
import { Check, KeyRound, Link2, Minus, Pencil, Plus, UserCheck, UserX, Users } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';

import { ApiError, type ApiClient, type Driver, type UserAccount, type UserRole } from '../api/client.js';
import { RowActions, SortableHeader } from '../components/data-table/columnHelpers.js';
import { DataTable } from '../components/data-table/DataTable.js';
import { FormSheet } from '../components/FormSheet.js';
import { SelectField, TextField } from '../components/FormFields.js';
import { ErrorNotice, LoadingRows, SuccessNotice } from '../components/Notices.js';
import { PageHeader } from '../components/PageHeader.js';
import { RegistrationDialog } from '../components/RegistrationDialog.js';
import { Badge } from '../components/ui/badge.js';
import { Button } from '../components/ui/button.js';
import { DropdownMenuItem, DropdownMenuSeparator } from '../components/ui/dropdown-menu.js';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../components/ui/empty.js';
import { FieldDescription, FieldGroup } from '../components/ui/field.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table.js';
import { countLabel, formatDateTime, formatTimeAgo } from '../lib/format.js';
import { PASSWORD_MIN_LENGTH, PASSWORD_PATTERN } from '../lib/patterns.js';
import { roleLabel } from '../shell/navigation.js';
import { PERMISSION_ROLES, ROLE_PERMISSIONS } from './users/rolePermissions.js';
import { ACCESS_STATUS_LABELS, accessStatus, ROLE_COUNT_NAMES, userFullName, type AccessStatus } from './users/userAccounts.js';

export type UserManagementClient = Pick<ApiClient,
  'listUsers' | 'createUser' | 'updateUser' | 'resetUserPassword' | 'listDrivers' | 'bindDriverAccount'>;

const ROLE_OPTIONS: readonly { readonly value: UserRole; readonly label: string }[] = PERMISSION_ROLES
  .map((role) => ({ value: role, label: roleLabel(role) }));

const STATUS_OPTIONS: readonly { readonly value: AccessStatus; readonly label: string }[] = (['active', 'pending', 'disabled'] as const)
  .map((status) => ({ value: status, label: ACCESS_STATUS_LABELS[status] }));

const ROLE_BADGE: Record<UserRole, 'info' | 'outline' | 'secondary'> = { ADMIN: 'info', DISPATCHER: 'outline', DRIVER: 'secondary' };
const STATUS_BADGE: Record<AccessStatus, 'success' | 'warning' | 'secondary'> = { active: 'success', pending: 'warning', disabled: 'secondary' };

const PASSWORD_HINT = `Al menos ${PASSWORD_MIN_LENGTH} caracteres, con letras y números. Entrégasela a la persona por un canal privado.`;

/** Mensaje en español para los rechazos conocidos de la API; el resto usa `fallback`. */
function userErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof ApiError)) return fallback;
  switch (error.code) {
    case 'IDENTITY_EMAIL_ALREADY_IN_USE': return 'Ya existe una cuenta con ese correo en la organización.';
    case 'IDENTITY_WEAK_PASSWORD': return `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres, con letras y números.`;
    case 'IDENTITY_SELF_CHANGE_FORBIDDEN': return 'No puedes cambiar tu propio rol ni desactivar tu cuenta.';
    case 'IDENTITY_DRIVER_ACCOUNT_LINKED': return 'La cuenta está vinculada a un conductor. Desvincúlala antes de cambiar su rol.';
    default: return fallback;
  }
}

/** Contraseña temporal legible: ocho letras sin ambigüedades y cuatro dígitos. */
export function generateTemporaryPassword(random: (size: number) => Uint32Array = (size) => crypto.getRandomValues(new Uint32Array(size))): string {
  const letters = 'abcdefghjkmnpqrstuvwxyz';
  const digits = '23456789';
  const values = random(12);
  const pick = (alphabet: string, value: number) => alphabet.charAt(value % alphabet.length);
  return [...values].map((value, index) => (index < 8 ? pick(letters, value) : pick(digits, value))).join('');
}

type Panel =
  | { readonly kind: 'create' }
  | { readonly kind: 'edit'; readonly user: UserAccount }
  | { readonly kind: 'password'; readonly user: UserAccount }
  | { readonly kind: 'driver'; readonly user: UserAccount };

export function UserManagementPage({ client, currentUserId }: {
  readonly client: UserManagementClient;
  /** La cuenta en sesión: no puede cambiar su propio rol ni desactivarse. */
  readonly currentUserId: string;
}) {
  const [users, setUsers] = useState<readonly UserAccount[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [registered, setRegistered] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      setUsers(await client.listUsers());
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => { void load(); }, [load]);

  const openPanel = useCallback((next: Panel) => {
    setNotice(null);
    setActionError(null);
    setPanel(next);
  }, []);

  const toggleStatus = useCallback(async (user: UserAccount) => {
    const disabling = user.status === 'active';
    const name = userFullName(user) ?? user.email;
    const question = disabling
      ? `¿Desactivar la cuenta de ${name}? No podrá ingresar y se cerrarán sus sesiones abiertas.`
      : `¿Reactivar la cuenta de ${name}?`;
    if (!window.confirm(question)) return;
    setNotice(null);
    setActionError(null);
    try {
      await client.updateUser(user.id, { status: disabling ? 'disabled' : 'active' });
      // El aviso sale con la tabla ya actualizada, para que no contradiga el estado de la fila.
      await load();
      setNotice(disabling ? `La cuenta de ${name} quedó desactivada.` : `La cuenta de ${name} está activa otra vez.`);
    } catch (error) {
      setActionError(userErrorMessage(error, 'No se pudo cambiar el estado de la cuenta. Inténtalo de nuevo.'));
    }
  }, [client, load]);

  const columns = useMemo<readonly ColumnDef<UserAccount, unknown>[]>(() => [
    {
      id: 'user',
      accessorFn: (user) => `${userFullName(user) ?? ''} ${user.email}`,
      header: ({ column }) => <SortableHeader column={column} title="Usuario" />,
      enableHiding: false,
      cell: ({ row }) => {
        const fullName = userFullName(row.original);
        return (
          <span className="flex flex-col gap-0.5">
            {fullName === null
              ? <span className="flex flex-wrap items-center gap-2"><span className="font-medium">{row.original.email}</span><Badge variant="warning">Completar nombre</Badge></span>
              : <><span className="font-medium">{fullName}</span><span className="text-muted-foreground">{row.original.email}</span></>}
          </span>
        );
      },
    },
    {
      accessorKey: 'role',
      header: 'Rol',
      enableSorting: false,
      filterFn: 'arrIncludesSome',
      meta: { title: 'Rol' },
      cell: ({ row }) => <Badge variant={ROLE_BADGE[row.original.role]}>{roleLabel(row.original.role)}</Badge>,
    },
    {
      id: 'driver',
      accessorFn: (user) => user.driver?.fullName ?? '',
      header: 'Conductor vinculado',
      enableSorting: false,
      meta: { title: 'Conductor vinculado' },
      cell: ({ row }) => row.original.driver === null
        ? <span className="text-muted-foreground">{row.original.role === 'DRIVER' ? 'Sin vincular' : 'No aplica'}</span>
        : row.original.driver.fullName,
    },
    {
      id: 'lastLoginAt',
      accessorFn: (user) => user.lastLoginAt ?? '',
      header: ({ column }) => <SortableHeader column={column} title="Último acceso" />,
      meta: { title: 'Último acceso' },
      cell: ({ row }) => row.original.lastLoginAt === null
        ? <span className="text-muted-foreground">Nunca</span>
        : <time dateTime={row.original.lastLoginAt} title={formatDateTime(row.original.lastLoginAt)} className="tabular-nums">{formatTimeAgo(row.original.lastLoginAt)}</time>,
    },
    {
      id: 'status',
      accessorFn: (user) => accessStatus(user),
      header: 'Estado',
      enableSorting: false,
      filterFn: 'arrIncludesSome',
      meta: { title: 'Estado' },
      cell: ({ row }) => {
        const status = accessStatus(row.original);
        return <Badge variant={STATUS_BADGE[status]}>{ACCESS_STATUS_LABELS[status]}</Badge>;
      },
    },
    {
      id: 'actions',
      enableHiding: false,
      enableSorting: false,
      cell: ({ row }) => {
        const user = row.original;
        const isSelf = user.id === currentUserId;
        const label = userFullName(user) ?? user.email;
        return (
          <RowActions label={`Acciones de ${label}`}>
            <DropdownMenuItem onSelect={() => openPanel({ kind: 'edit', user })}><Pencil aria-hidden="true" /> Editar</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openPanel({ kind: 'password', user })}><KeyRound aria-hidden="true" /> Restablecer contraseña</DropdownMenuItem>
            {user.role === 'DRIVER' && user.status === 'active' && (
              <DropdownMenuItem onSelect={() => openPanel({ kind: 'driver', user })}><Link2 aria-hidden="true" /> {user.driver === null ? 'Vincular conductor' : 'Cambiar conductor'}</DropdownMenuItem>
            )}
            {!isSelf && (
              <>
                <DropdownMenuSeparator />
                {user.status === 'active'
                  ? <DropdownMenuItem variant="destructive" onSelect={() => void toggleStatus(user)}><UserX aria-hidden="true" /> Desactivar</DropdownMenuItem>
                  : <DropdownMenuItem onSelect={() => void toggleStatus(user)}><UserCheck aria-hidden="true" /> Reactivar</DropdownMenuItem>}
              </>
            )}
          </RowActions>
        );
      },
    },
  ], [currentUserId, openPanel, toggleStatus]);

  const linkedDriverIds = useMemo(() => new Set((users ?? []).flatMap((user) => user.driver === null ? [] : [user.driver.id])), [users]);

  async function finishPanel(message: string) {
    setPanel(null);
    await load();
    setNotice(message);
  }

  return (
    <section className="flex flex-col gap-6">
      <PageHeader title="Usuarios y roles" description={users === null ? 'Cuentas de acceso al ERP y lo que puede hacer cada rol.' : summaryLine(users)}>
        <Button onClick={() => openPanel({ kind: 'create' })}><Plus data-icon="inline-start" aria-hidden="true" /> Nuevo usuario</Button>
      </PageHeader>

      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}
      {actionError !== null && <ErrorNotice>{actionError}</ErrorNotice>}
      <RegistrationDialog title="Usuario creado" message={registered} onClose={() => setRegistered(null)} />

      {users === null && loading && <LoadingRows label="Cargando usuarios…" />}
      {loadFailed && !loading && (
        <ErrorNotice action={<Button variant="outline" className="mt-2" onClick={() => void load()}>Reintentar</Button>}>
          No se pudieron cargar los usuarios. Revisa la conexión e inténtalo de nuevo.
        </ErrorNotice>
      )}
      {users !== null && users.length === 0 && (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon"><Users aria-hidden="true" /></EmptyMedia>
            <EmptyTitle>Sin cuentas registradas</EmptyTitle>
            <EmptyDescription>Crea la primera cuenta para que el equipo ingrese al ERP.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      {users !== null && users.length > 0 && (
        <DataTable label="Usuarios de la organización" columns={columns} data={users}
          searchPlaceholder="Buscar nombre o correo"
          filters={[{ columnId: 'role', title: 'Rol', options: ROLE_OPTIONS }, { columnId: 'status', title: 'Estado', options: STATUS_OPTIONS }]} />
      )}

      <PermissionMatrix />

      {panel?.kind === 'create' && (
        <CreateUserSheet client={client} onClose={() => setPanel(null)}
          onCreated={(message) => { setPanel(null); setRegistered(message); void load(); }} />
      )}
      {panel?.kind === 'edit' && (
        <EditUserSheet client={client} user={panel.user} isSelf={panel.user.id === currentUserId}
          onClose={() => setPanel(null)} onSaved={(message) => void finishPanel(message)} />
      )}
      {panel?.kind === 'password' && (
        <PasswordSheet client={client} user={panel.user} onClose={() => setPanel(null)} onSaved={(message) => void finishPanel(message)} />
      )}
      {panel?.kind === 'driver' && (
        <DriverLinkSheet client={client} user={panel.user} linkedDriverIds={linkedDriverIds}
          onClose={() => setPanel(null)} onSaved={(message) => void finishPanel(message)} />
      )}
    </section>
  );
}

/** «8 usuarios · 2 administradores · 1 operador · 5 conductores · 1 sin primer ingreso». */
function summaryLine(users: readonly UserAccount[]): string {
  const parts = [countLabel(users.length, 'usuario', 'usuarios')];
  for (const role of PERMISSION_ROLES) {
    const count = users.filter((user) => user.role === role).length;
    const [singular, plural] = ROLE_COUNT_NAMES[role];
    if (count > 0) parts.push(countLabel(count, singular, plural));
  }
  const pending = users.filter((user) => accessStatus(user) === 'pending').length;
  if (pending > 0) parts.push(`${pending.toLocaleString('es-PE')} sin primer ingreso`);
  const disabled = users.filter((user) => user.status === 'disabled').length;
  if (disabled > 0) parts.push(countLabel(disabled, 'desactivado', 'desactivados'));
  return parts.join(' · ');
}

function PermissionMatrix() {
  return (
    <section aria-labelledby="role-permissions" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="role-permissions" className="text-base font-semibold">Qué puede hacer cada rol</h2>
        <p className="text-sm text-muted-foreground">La API aplica estos permisos en cada solicitud; cambiar el rol de una cuenta los cambia al instante.</p>
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Permiso</TableHead>
              {PERMISSION_ROLES.map((role) => <TableHead key={role} className="text-center">{roleLabel(role)}</TableHead>)}
            </TableRow>
          </TableHeader>
          <TableBody>
            {ROLE_PERMISSIONS.map((permission) => (
              <TableRow key={permission.label}>
                <TableCell className="min-w-56 whitespace-normal">{permission.label}</TableCell>
                {PERMISSION_ROLES.map((role) => {
                  const allowed = permission.roles.includes(role);
                  return (
                    <TableCell key={role} className="text-center">
                      {allowed
                        ? <Check className="mx-auto size-4 text-primary" aria-label="Sí" role="img" />
                        : <Minus className="mx-auto size-4 text-muted-foreground" aria-label="No" role="img" />}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

interface NameFields {
  readonly firstName: string;
  readonly paternalSurname: string;
  readonly maternalSurname: string;
}

function NameInputs({ idPrefix, value, onChange }: {
  readonly idPrefix: string;
  readonly value: NameFields;
  readonly onChange: (value: NameFields) => void;
}) {
  return (
    <>
      <TextField id={`${idPrefix}-first-name`} label="Nombres" placeholder="Ej. Jorge Luis" autoComplete="given-name" required maxLength={60}
        value={value.firstName} onChange={(event) => onChange({ ...value, firstName: event.target.value })} />
      <TextField id={`${idPrefix}-paternal`} label="Apellido paterno" placeholder="Ej. Huamán" autoComplete="family-name" required maxLength={60}
        value={value.paternalSurname} onChange={(event) => onChange({ ...value, paternalSurname: event.target.value })} />
      <TextField id={`${idPrefix}-maternal`} label="Apellido materno (opcional)" placeholder="Ej. Quispe" autoComplete="off" maxLength={60}
        value={value.maternalSurname} onChange={(event) => onChange({ ...value, maternalSurname: event.target.value })} />
    </>
  );
}

function PasswordInput({ id, value, onChange }: { readonly id: string; readonly value: string; readonly onChange: (value: string) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <TextField id={id} label="Contraseña temporal" placeholder="Ej. kmtrqbzx4827" autoComplete="new-password" required
            minLength={PASSWORD_MIN_LENGTH} maxLength={200} pattern={PASSWORD_PATTERN} title={PASSWORD_HINT}
            value={value} onChange={(event) => onChange(event.target.value)} />
        </div>
        <Button type="button" variant="outline" onClick={() => onChange(generateTemporaryPassword())}>Generar</Button>
      </div>
      <FieldDescription>{PASSWORD_HINT}</FieldDescription>
    </div>
  );
}

const optionalPart = (value: string) => (value.trim() === '' ? null : value.trim());

function CreateUserSheet({ client, onClose, onCreated }: {
  readonly client: UserManagementClient;
  readonly onClose: () => void;
  readonly onCreated: (message: string) => void;
}) {
  const [name, setName] = useState<NameFields>({ firstName: '', paternalSurname: '', maternalSurname: '' });
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserRole | ''>('');
  const [password, setPassword] = useState('');
  const [roleError, setRoleError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    if (role === '') {
      setRoleError('Elige el rol de la cuenta.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const created = await client.createUser({
        email: email.trim(), password, role,
        firstName: name.firstName.trim(), paternalSurname: name.paternalSurname.trim(), maternalSurname: optionalPart(name.maternalSurname),
      });
      onCreated(`La cuenta de ${userFullName(created) ?? created.email} quedó lista. Entrégale su correo y la contraseña temporal; aparecerá como «Sin primer ingreso» hasta que ingrese.`);
    } catch (caught) {
      setError(userErrorMessage(caught, 'No se pudo crear la cuenta. Verifica los datos e inténtalo de nuevo.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormSheet open onOpenChange={(open) => { if (!open) onClose(); }} title="Nuevo usuario"
      description="La persona ingresa con su correo y la contraseña temporal que le entregues." formLabel="Nuevo usuario"
      onSubmit={(event) => void submit(event)}
      footer={(
        <>
          <Button type="button" variant="outline" disabled={saving} onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={saving}>{saving ? 'Creando…' : 'Crear usuario'}</Button>
        </>
      )}>
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      <FieldGroup className="gap-4">
        <NameInputs idPrefix="new-user" value={name} onChange={setName} />
        <TextField id="new-user-email" label="Correo" placeholder="nombre@empresa.pe" type="email" autoComplete="off" required maxLength={254}
          value={email} onChange={(event) => setEmail(event.target.value)} />
        <SelectField id="new-user-role" label="Rol" placeholder="Selecciona un rol" value={role} options={ROLE_OPTIONS}
          error={roleError} onChange={(value) => { setRole(value); setRoleError(null); }} />
        <PasswordInput id="new-user-password" value={password} onChange={setPassword} />
      </FieldGroup>
    </FormSheet>
  );
}

function EditUserSheet({ client, user, isSelf, onClose, onSaved }: {
  readonly client: UserManagementClient;
  readonly user: UserAccount;
  readonly isSelf: boolean;
  readonly onClose: () => void;
  readonly onSaved: (message: string) => void;
}) {
  const [name, setName] = useState<NameFields>({
    firstName: user.firstName ?? '', paternalSurname: user.paternalSurname ?? '', maternalSurname: user.maternalSurname ?? '',
  });
  const [role, setRole] = useState<UserRole>(user.role);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const roleLocked = isSelf || user.driver !== null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await client.updateUser(user.id, {
        firstName: name.firstName.trim(), paternalSurname: name.paternalSurname.trim(), maternalSurname: optionalPart(name.maternalSurname),
        ...(role === user.role ? {} : { role }),
      });
      onSaved(`Se guardaron los datos de ${userFullName(updated) ?? updated.email}.`);
    } catch (caught) {
      setError(userErrorMessage(caught, 'No se pudieron guardar los cambios. Inténtalo de nuevo.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormSheet open onOpenChange={(open) => { if (!open) onClose(); }} title="Editar usuario"
      description={user.email} formLabel="Editar usuario" onSubmit={(event) => void submit(event)}
      footer={(
        <>
          <Button type="button" variant="outline" disabled={saving} onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={saving}>{saving ? 'Guardando…' : 'Guardar cambios'}</Button>
        </>
      )}>
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      <FieldGroup className="gap-4">
        <NameInputs idPrefix="edit-user" value={name} onChange={setName} />
        <div className="flex flex-col gap-2">
          <SelectField id="edit-user-role" label="Rol" placeholder="Selecciona un rol" value={role} options={ROLE_OPTIONS}
            disabled={roleLocked} onChange={setRole} />
          {isSelf && <FieldDescription>No puedes cambiar tu propio rol; pídeselo a otro administrador.</FieldDescription>}
          {!isSelf && user.driver !== null && <FieldDescription>Vinculada a {user.driver.fullName}: desvincúlala antes de cambiar su rol.</FieldDescription>}
        </div>
      </FieldGroup>
    </FormSheet>
  );
}

function PasswordSheet({ client, user, onClose, onSaved }: {
  readonly client: UserManagementClient;
  readonly user: UserAccount;
  readonly onClose: () => void;
  readonly onSaved: (message: string) => void;
}) {
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = userFullName(user) ?? user.email;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await client.resetUserPassword(user.id, password);
      onSaved(`La contraseña de ${name} cambió y sus sesiones abiertas se cerraron. Entrégale la nueva contraseña temporal.`);
    } catch (caught) {
      setError(userErrorMessage(caught, 'No se pudo cambiar la contraseña. Inténtalo de nuevo.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormSheet open onOpenChange={(open) => { if (!open) onClose(); }} title="Restablecer contraseña"
      description={`${name} · se cerrarán sus sesiones abiertas.`} formLabel="Restablecer contraseña"
      onSubmit={(event) => void submit(event)}
      footer={(
        <>
          <Button type="button" variant="outline" disabled={saving} onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={saving}>{saving ? 'Guardando…' : 'Cambiar contraseña'}</Button>
        </>
      )}>
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      <FieldGroup className="gap-4">
        <PasswordInput id="reset-password" value={password} onChange={setPassword} />
      </FieldGroup>
    </FormSheet>
  );
}

function DriverLinkSheet({ client, user, linkedDriverIds, onClose, onSaved }: {
  readonly client: UserManagementClient;
  readonly user: UserAccount;
  readonly linkedDriverIds: ReadonlySet<string>;
  readonly onClose: () => void;
  readonly onSaved: (message: string) => void;
}) {
  const [drivers, setDrivers] = useState<readonly Driver[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [driverId, setDriverId] = useState<string>(user.driver?.id ?? '');
  const [driverError, setDriverError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = userFullName(user) ?? user.email;

  useEffect(() => {
    let active = true;
    client.listDrivers()
      .then((list) => { if (active) setDrivers(list); })
      .catch(() => { if (active) setLoadFailed(true); });
    return () => { active = false; };
  }, [client]);

  // Conductores activos sin cuenta, más el que ya tiene esta cuenta.
  const options = (drivers ?? [])
    .filter((driver) => driver.id === user.driver?.id || (driver.status === 'active' && !linkedDriverIds.has(driver.id)))
    .map((driver) => ({ value: driver.id, label: driver.fullName }));

  async function bind(nextDriverId: string | null) {
    setSaving(true);
    setError(null);
    try {
      if (user.driver !== null && user.driver.id !== nextDriverId) await client.bindDriverAccount(user.driver.id, null);
      if (nextDriverId !== null && nextDriverId !== user.driver?.id) await client.bindDriverAccount(nextDriverId, user.id);
      const driverName = options.find((option) => option.value === nextDriverId)?.label;
      onSaved(nextDriverId === null
        ? `La cuenta de ${name} ya no está vinculada a un conductor.`
        : `La cuenta de ${name} quedó vinculada a ${driverName ?? 'su conductor'}.`);
    } catch {
      setError('No se pudo cambiar el vínculo. Revisa que el conductor no tenga una ruta simulada en curso e inténtalo de nuevo.');
    } finally {
      setSaving(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    if (driverId === '') {
      setDriverError('Elige el conductor que usará esta cuenta.');
      return;
    }
    void bind(driverId);
  }

  return (
    <FormSheet open onOpenChange={(open) => { if (!open) onClose(); }} title="Vincular conductor"
      description={`${name} verá en «Mi ruta» las rutas del conductor elegido.`} formLabel="Vincular conductor" onSubmit={submit}
      footer={(
        <>
          {user.driver !== null && (
            <Button type="button" variant="outline" className="sm:mr-auto" disabled={saving} onClick={() => void bind(null)}>Desvincular</Button>
          )}
          <Button type="button" variant="outline" disabled={saving} onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={saving || drivers === null}>{saving ? 'Guardando…' : 'Guardar vínculo'}</Button>
        </>
      )}>
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {loadFailed && <ErrorNotice>No se pudieron cargar los conductores. Cierra el panel e inténtalo de nuevo.</ErrorNotice>}
      {drivers === null && !loadFailed && <LoadingRows label="Cargando conductores…" rows={1} />}
      {drivers !== null && (
        <FieldGroup className="gap-4">
          <SelectField id="link-driver" label="Conductor" placeholder={options.length === 0 ? 'No hay conductores libres' : 'Selecciona un conductor'}
            value={driverId} options={options} error={driverError} disabled={options.length === 0}
            onChange={(value) => { setDriverId(value); setDriverError(null); }} />
          {options.length === 0 && <FieldDescription>Todos los conductores activos ya tienen cuenta. Registra uno en Conductores.</FieldDescription>}
        </FieldGroup>
      )}
    </FormSheet>
  );
}
