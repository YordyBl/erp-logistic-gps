const TIME_ZONE = 'America/Lima';

export function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium', timeStyle: 'short', timeZone: TIME_ZONE }).format(new Date(value));
}

export function formatTime(value: string): string {
  return new Intl.DateTimeFormat('es-PE', { hour: '2-digit', minute: '2-digit', timeZone: TIME_ZONE }).format(new Date(value));
}

export function formatDateOnly(value: string): string {
  return new Intl.DateTimeFormat('es-PE', { day: 'numeric', month: 'short', timeZone: TIME_ZONE }).format(new Date(value));
}

export function formatTimeWithSeconds(value: string): string {
  return new Intl.DateTimeFormat('es-PE', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: TIME_ZONE }).format(new Date(value));
}

export function formatToday(): string {
  return new Intl.DateTimeFormat('es-PE', { dateStyle: 'full', timeZone: TIME_ZONE }).format(new Date());
}

/** "hace 5 minutos", "hace 2 horas": cuánto hace de un momento pasado. */
export function formatTimeAgo(value: string, now: number = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - new Date(value).getTime()) / 60_000));
  const format = new Intl.RelativeTimeFormat('es-PE', { numeric: 'auto' });
  if (minutes < 60) return format.format(-minutes, 'minute');
  if (minutes < 1_440) return format.format(-Math.round(minutes / 60), 'hour');
  return format.format(-Math.round(minutes / 1_440), 'day');
}

/** Cantidad con su nombre en singular o plural: "1 ruta", "3 rutas". */
export function countLabel(count: number, singular: string, plural: string): string {
  return `${count.toLocaleString('es-PE')} ${count === 1 ? singular : plural}`;
}

/** Las dos primeras iniciales de un nombre, para `AvatarFallback`. */
export function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join('');
}

export function formatBytes(value: number): string {
  return value < 1_000_000
    ? `${Math.max(1, Math.round(value / 1_000))} KB`
    : `${(value / 1_000_000).toFixed(2)} MB`;
}
