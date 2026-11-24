export type ReportPreset = 'week' | 'month' | 'quarter';

export interface DayRange {
  /** `YYYY-MM-DD`, inclusivo. */
  readonly from: string;
  readonly to: string;
}

export interface ReportPeriods {
  readonly preset: ReportPreset;
  readonly period: DayRange;
  /** El tramo equivalente anterior con el que se compara. */
  readonly comparison: DayRange;
}

export const REPORT_PRESETS: readonly { readonly value: ReportPreset; readonly label: string }[] = [
  { value: 'week', label: '7 días' },
  { value: 'month', label: 'Este mes' },
  { value: 'quarter', label: 'Trimestre' },
];

/** Día de Lima (`YYYY-MM-DD`) de un instante: el periodo se arma con el calendario de Lima. */
export function limaToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

const parts = (day: string) => day.split('-').map(Number) as [number, number, number];
const iso = (year: number, month: number, day: number) => new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/**
 * - 7 días: hoy y los seis anteriores, contra los siete días previos.
 * - Este mes: del 1 a hoy, contra el mismo tramo del mes anterior (recortado si es más corto).
 * - Trimestre: del inicio del trimestre a hoy, contra el mismo tramo del trimestre anterior.
 */
export function reportPeriods(preset: ReportPreset, today: string): ReportPeriods {
  const [year, month, day] = parts(today);
  if (preset === 'week') {
    return {
      preset,
      period: { from: iso(year, month, day - 6), to: today },
      comparison: { from: iso(year, month, day - 13), to: iso(year, month, day - 7) },
    };
  }
  const span = preset === 'month' ? 1 : 3;
  const startMonth = preset === 'month' ? month : month - ((month - 1) % 3);
  const from = iso(year, startMonth, 1);
  // Meses transcurridos dentro del periodo y día del último mes: se repiten en el periodo anterior.
  const monthOffset = month - startMonth;
  const previousStart = new Date(Date.UTC(year, startMonth - 1 - span, 1));
  const previousYear = previousStart.getUTCFullYear();
  const previousMonth = previousStart.getUTCMonth() + 1 + monthOffset;
  const lastMonth = new Date(Date.UTC(previousYear, previousMonth - 1, 1));
  const lastDay = Math.min(day, daysInMonth(lastMonth.getUTCFullYear(), lastMonth.getUTCMonth() + 1));
  return {
    preset,
    period: { from, to: today },
    comparison: {
      from: iso(previousYear, previousStart.getUTCMonth() + 1, 1),
      to: iso(lastMonth.getUTCFullYear(), lastMonth.getUTCMonth() + 1, lastDay),
    },
  };
}

const DAY_FORMAT = new Intl.DateTimeFormat('es-PE', { day: 'numeric', month: 'long', timeZone: 'UTC' });
const DAY_YEAR_FORMAT = new Intl.DateTimeFormat('es-PE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/** «1 al 18 de noviembre», «28 de diciembre de 2026 al 3 de enero de 2027». */
export function formatDayRange(range: DayRange): string {
  const [fromYear, fromMonth, fromDay] = parts(range.from);
  const [toYear, toMonth] = parts(range.to);
  const to = DAY_FORMAT.format(new Date(`${range.to}T00:00:00Z`));
  if (fromYear !== toYear) {
    return `${DAY_YEAR_FORMAT.format(new Date(`${range.from}T00:00:00Z`))} al ${DAY_YEAR_FORMAT.format(new Date(`${range.to}T00:00:00Z`))}`;
  }
  if (range.from === range.to) return to;
  return fromMonth === toMonth ? `${fromDay} al ${to}` : `${DAY_FORMAT.format(new Date(`${range.from}T00:00:00Z`))} al ${to}`;
}
