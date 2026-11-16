import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { Card } from '../../components/ui/card.js';

/** Dato de una ficha (vehículo, conductor): etiqueta pequeña y valor. Va dentro de un `<dl>`. */
export function Field({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}

/** Indicador grande del detalle (Completadas, Paradas...). Va dentro de un `<dl>`. */
export function StatTile({ icon: Icon, label, value }: { readonly icon: LucideIcon; readonly label: string; readonly value: string }) {
  return (
    <Card className="gap-3 py-4">
      <dt className="flex items-center gap-2 px-4 text-sm font-medium"><Icon className="size-4 text-muted-foreground" aria-hidden="true" />{label}</dt>
      <dd className="px-4 text-2xl font-semibold tabular-nums">{value}</dd>
    </Card>
  );
}
