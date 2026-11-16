import { X } from 'lucide-react';

import { DatePicker } from '../../components/DatePicker.js';
import { Button } from '../../components/ui/button.js';
import { Label } from '../../components/ui/label.js';

/** Días planificados elegidos (`YYYY-MM-DD`); vacío es sin límite por ese lado. */
export interface PlannedRange {
  readonly from: string;
  readonly to: string;
}

export const EMPTY_PLANNED_RANGE: PlannedRange = { from: '', to: '' };

/** "Hasta" anterior a "Desde": no se envía al servidor. */
export function isInvalidRange(range: PlannedRange): boolean {
  return range.from !== '' && range.to !== '' && range.to < range.from;
}

/** Parámetros de `GET /delivery-routes` para un rango válido (`plannedFrom`/`plannedTo`, inclusivos). */
export function plannedRangeParams(range: PlannedRange): { plannedFrom?: string; plannedTo?: string } {
  return {
    ...(range.from === '' ? {} : { plannedFrom: range.from }),
    ...(range.to === '' ? {} : { plannedTo: range.to }),
  };
}

/** Desde / Hasta para filtrar rutas por día planificado, en la barra de la tabla de rutas. */
export function PlannedRangeFilter({ value, onChange }: {
  readonly value: PlannedRange;
  readonly onChange: (range: PlannedRange) => void;
}) {
  const invalid = isInvalidRange(value);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-2">
        <Label htmlFor="routes-planned-from" className="text-muted-foreground">Desde</Label>
        <div className="w-40">
          <DatePicker id="routes-planned-from" value={value.from} placeholder="Cualquier día" displayFormat="dd/MM/yyyy"
            onChange={(from) => onChange({ ...value, from })} />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Label htmlFor="routes-planned-to" className="text-muted-foreground">Hasta</Label>
        <div className="w-40">
          <DatePicker id="routes-planned-to" value={value.to} placeholder="Cualquier día" invalid={invalid} displayFormat="dd/MM/yyyy"
            onChange={(to) => onChange({ ...value, to })} />
        </div>
      </div>
      {(value.from !== '' || value.to !== '') && (
        <Button type="button" variant="ghost" onClick={() => onChange(EMPTY_PLANNED_RANGE)}>
          <X data-icon="inline-start" aria-hidden="true" />Limpiar fechas
        </Button>
      )}
      {invalid && <p role="alert" className="basis-full text-xs text-destructive">La fecha "Hasta" no puede ser anterior a "Desde".</p>}
    </div>
  );
}
