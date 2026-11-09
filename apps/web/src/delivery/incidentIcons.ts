import { Ban, Car, DoorClosed, MapPinOff, PackageX, TriangleAlert, UserX, type LucideIcon } from 'lucide-react';

const INCIDENT_ICONS: Readonly<Record<string, LucideIcon>> = {
  recipient_absent: UserX,
  incorrect_address: MapPinOff,
  delivery_refused: Ban,
  damaged_package: PackageX,
  access_restricted: DoorClosed,
  vehicle_issue: Car,
};

export function incidentIcon(category: string): LucideIcon {
  return INCIDENT_ICONS[category] ?? TriangleAlert;
}
