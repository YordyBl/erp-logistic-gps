const LIMA = 'America/Lima';

/** "10:42" in Lima time. */
export function limaTime(iso: string): string {
  return new Intl.DateTimeFormat('es-PE', { timeZone: LIMA, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
}

/** YYYY-MM-DD of an instant, in Lima. */
function limaDay(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: LIMA, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

/** "hoy", "mañana" or "martes 25 nov" for a planned YYYY-MM-DD date. */
export function plannedDayLabel(plannedDate: string, now: Date = new Date()): string {
  const today = limaDay(now);
  const tomorrow = limaDay(new Date(now.getTime() + 24 * 3600 * 1000));
  if (plannedDate === today) return 'hoy';
  if (plannedDate === tomorrow) return 'mañana';
  // Noon UTC keeps the calendar day stable in Lima (UTC−5).
  return new Intl.DateTimeFormat('es-PE', { timeZone: LIMA, weekday: 'long', day: 'numeric', month: 'short' })
    .format(new Date(`${plannedDate}T12:00:00Z`)).replace('.', '');
}

/** "hoy a las 10:42" or "20 nov a las 10:42", in Lima time. */
export function momentLabel(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const day = limaDay(date) === limaDay(now)
    ? 'hoy'
    : new Intl.DateTimeFormat('es-PE', { timeZone: LIMA, day: 'numeric', month: 'short' }).format(date).replace('.', '');
  return `${day} a las ${limaTime(iso)}`;
}

export function timeWindowLabel(window: 'AM' | 'PM'): string {
  return window === 'AM' ? 'turno mañana' : 'turno tarde';
}

/** "hace 30 s", "hace 12 min". */
export function ago(iso: string, now: Date = new Date()): string {
  const seconds = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `hace ${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;
  return `hace ${Math.round(minutes / 60)} h`;
}

export function stopsLabel(count: number): string {
  return count === 1 ? '1 parada' : `${count} paradas`;
}
