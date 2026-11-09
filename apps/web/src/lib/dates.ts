import { format } from 'date-fns';

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})/;

/**
 * Convierte `YYYY-MM-DD` (o una fecha de la API con hora) en medianoche local. Parsear con
 * `new Date(texto)` la leería como UTC y en Lima mostraría el día anterior.
 */
export function parseIsoDay(value: string): Date | undefined {
  const match = ISO_DAY.exec(value);
  if (match === null) return undefined;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(year, month - 1, day);
  return date.getMonth() === month - 1 && date.getDate() === day ? date : undefined;
}

/** Día elegido en el calendario, tal como lo ve la persona, en el formato que espera la API. */
export function toIsoDay(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

/**
 * La API puede entregar la fecha con hora; solo importa el día. Se ancla a mediodía de Lima para
 * no cambiar de día, y un valor inesperado se muestra tal cual en lugar de romper la pantalla.
 */
export function formatPlannedDate(value: string): string {
  const date = new Date(`${value.slice(0, 10)}T12:00:00-05:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium', timeZone: 'America/Lima' }).format(date);
}
