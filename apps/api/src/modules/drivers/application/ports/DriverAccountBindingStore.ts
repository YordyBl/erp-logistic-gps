/** Private association between a catalog driver and an authenticated account. */
export interface DriverAccountBinding {
  readonly driverId: string;
  readonly userId: string | null;
}

/** One binding decision and its audit record must commit in the same unit of work. */
export interface DriverAccountBindingStore {
  get(organizationId: string, driverId: string): Promise<DriverAccountBinding>;
  bind(organizationId: string, driverId: string, userId: string | null,
    actorUserId: string, occurredAt: string): Promise<DriverAccountBinding>;
  findDriverId(organizationId: string, userId: string): Promise<string | null>;
}
