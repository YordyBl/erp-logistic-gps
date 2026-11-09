export const INCIDENT_CATEGORIES = [
  ['recipient_absent', 'Destinatario ausente'],
  ['incorrect_address', 'Dirección incorrecta'],
  ['delivery_refused', 'Entrega rechazada'],
  ['damaged_package', 'Paquete dañado'],
  ['access_restricted', 'Acceso restringido'],
  ['vehicle_issue', 'Problema con el vehículo'],
  ['other', 'Otro'],
] as const;

export function incidentCategoryLabel(category: string): string {
  const known = INCIDENT_CATEGORIES.find(([value]) => value === category);
  return known?.[1] ?? category.replaceAll('_', ' ');
}
