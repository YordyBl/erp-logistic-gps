import { METRICS_PERIODS, type MetricsPeriod } from '../lib/metricsPeriod.js';
import { SelectField } from './FormFields.js';

/** Elige el periodo de las métricas de rutas. Es independiente de la búsqueda, los filtros y la página. */
export function MetricsPeriodSelect({ id, value, onChange }: {
  readonly id: string;
  readonly value: MetricsPeriod;
  readonly onChange: (period: MetricsPeriod) => void;
}) {
  return (
    <div className="w-full sm:w-56">
      <SelectField id={id} label="Periodo de las métricas" placeholder="Selecciona un periodo"
        value={value} options={METRICS_PERIODS} onChange={onChange} />
    </div>
  );
}
