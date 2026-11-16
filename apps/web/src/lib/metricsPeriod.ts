/** Periodo de las métricas de rutas; no filtra listados, solo los totales. */
export type MetricsPeriod = 'month' | '3m' | '6m' | 'year' | 'all';

export const METRICS_PERIODS: readonly { readonly value: MetricsPeriod; readonly label: string }[] = [
  { value: 'month', label: 'Este mes' },
  { value: '3m', label: 'Últimos 3 meses' },
  { value: '6m', label: 'Últimos 6 meses' },
  { value: 'year', label: 'Este año' },
  { value: 'all', label: 'Todo' },
];

/** El periodo por defecto conserva lo que mostraban las pantallas: todo el historial. */
export const DEFAULT_METRICS_PERIOD: MetricsPeriod = 'all';

/** Días planificados (`YYYY-MM-DD`, inclusivos) que cuentan en las métricas; vacío es todo. */
export interface PlannedRange {
  readonly from?: string;
  readonly to?: string;
}

const LIMA_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit',
});

/** Hoy en Lima como `YYYY-MM-DD`: los días planificados de las rutas son días de Lima. */
export function limaToday(now = new Date()): string {
  return LIMA_DAY.format(now);
}

/**
 * Meses completos que terminan con el mes de `today`: "Últimos 3 meses" en noviembre es de septiembre a
 * noviembre, incluidas las rutas planificadas para lo que queda del mes (como la serie mensual).
 */
export function periodRange(period: MetricsPeriod, today: string): PlannedRange {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  switch (period) {
    case 'all': return {};
    case 'year': return { from: `${year}-01-01`, to: `${year}-12-31` };
    case 'month': return monthsEndingIn(year, month, 1);
    case '3m': return monthsEndingIn(year, month, 3);
    case '6m': return monthsEndingIn(year, month, 6);
  }
}

/** El periodo en minúsculas, para frases como "12 rutas · este mes". */
export function periodLabel(period: MetricsPeriod): string {
  return period === 'all' ? 'todo el historial' : (METRICS_PERIODS.find((option) => option.value === period)?.label ?? '').toLowerCase();
}

function monthsEndingIn(year: number, month: number, months: number): PlannedRange {
  const first = new Date(Date.UTC(year, month - months, 1));
  const last = new Date(Date.UTC(year, month, 0));
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}
