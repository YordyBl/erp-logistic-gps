import { CalendarDays, CarFront, Check, CircleAlert, CirclePause, IdCard, KeyRound, Pencil, Phone } from 'lucide-react';
import { useId, type ReactNode } from 'react';

import type { Driver, DriverAccountOption } from '../../api/client.js';
import { Avatar, AvatarFallback } from '../../components/ui/avatar.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../../components/ui/card.js';
import { initials } from '../../lib/format.js';

const SINCE_FORMAT = new Intl.DateTimeFormat('es-PE', { month: 'long', year: 'numeric', timeZone: 'America/Lima' });

/** Credencial de un conductor: identidad, contacto y estado de su cuenta de acceso. */
export function DriverCard({ driver, account, canBindAccounts, onEdit, onManageAccount }: {
  readonly driver: Driver;
  readonly account: DriverAccountOption | undefined;
  readonly canBindAccounts: boolean;
  readonly onEdit: () => void;
  readonly onManageAccount: () => void;
}) {
  const nameId = useId();
  const active = driver.status === 'active';

  return (
    <li aria-labelledby={nameId} className="flex">
      <Card size="sm" className="w-full">
        <CardHeader>
          <div className="flex min-w-0 items-center gap-3">
            <Avatar size="lg">
              <AvatarFallback className={active ? 'bg-primary/10 font-semibold text-primary' : 'font-semibold'}>{initials(driver.fullName)}</AvatarFallback>
            </Avatar>
            <div className="flex min-w-0 flex-col gap-1">
              <CardTitle id={nameId} className="truncate" title={driver.fullName}>{driver.fullName}</CardTitle>
              <CardDescription>
                <Badge variant={active ? 'success' : 'secondary'}>
                  {active ? 'Activo' : 'Inactivo'}
                  {active ? <Check data-icon="inline-end" aria-hidden="true" /> : <CirclePause data-icon="inline-end" aria-hidden="true" />}
                </Badge>
              </CardDescription>
            </div>
          </div>
          <CardAction>
            <Button type="button" variant="ghost" size="icon" onClick={onEdit} aria-label={`Editar a ${driver.fullName}`} title="Editar conductor">
              <Pencil aria-hidden="true" />
            </Button>
          </CardAction>
        </CardHeader>

        <CardContent className="flex-1">
          <dl className="flex flex-col gap-2 text-sm">
            <Detail icon={<IdCard aria-hidden="true" />} label="Documento">{driver.documentNumber}</Detail>
            <Detail icon={<CarFront aria-hidden="true" />} label="Licencia">{driver.licenseNumber}</Detail>
            <Detail icon={<Phone aria-hidden="true" />} label="Teléfono">
              <a className="underline-offset-4 hover:text-primary hover:underline" href={`tel:${driver.phone.replace(/[^\d+]/g, '')}`}
                aria-label={`Llamar a ${driver.fullName} al ${driver.phone}`}>{driver.phone}</a>
            </Detail>
            <Detail icon={<CalendarDays aria-hidden="true" />} label="Registrado">
              <span className="first-letter:uppercase">{SINCE_FORMAT.format(new Date(driver.createdAt))}</span>
            </Detail>
          </dl>
        </CardContent>

        <CardFooter className="justify-between gap-3 border-t">
          <AccountStatus account={account} canBindAccounts={canBindAccounts} />
          {canBindAccounts && (
            <Button type="button" variant="outline" onClick={onManageAccount} aria-label={`${account === undefined ? 'Vincular cuenta de' : 'Cuenta de'} ${driver.fullName}`}>
              <KeyRound data-icon="inline-start" aria-hidden="true" />{account === undefined ? 'Vincular' : 'Cuenta'}
            </Button>
          )}
        </CardFooter>
      </Card>
    </li>
  );
}

function Detail({ icon, label, children }: { readonly icon: ReactNode; readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground [&>svg]:size-4">{icon}</span>
      <div className="flex min-w-0 flex-col">
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className="truncate font-medium tabular-nums">{children}</dd>
      </div>
    </div>
  );
}

function AccountStatus({ account, canBindAccounts }: {
  readonly account: DriverAccountOption | undefined;
  readonly canBindAccounts: boolean;
}) {
  if (!canBindAccounts) return <span className="text-sm text-muted-foreground">Vinculación reservada a ADMIN</span>;
  if (account === undefined) {
    return <Badge variant="warning">Sin cuenta<CircleAlert data-icon="inline-end" aria-hidden="true" /></Badge>;
  }
  return (
    <span className="flex min-w-0 flex-col text-sm">
      <span className="text-xs text-muted-foreground">{account.status === 'disabled' ? 'Cuenta desactivada' : 'Cuenta de acceso'}</span>
      <span className="truncate font-medium" title={account.email}>{account.email}</span>
    </span>
  );
}
