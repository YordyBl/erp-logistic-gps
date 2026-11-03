/** Private association between a catalog driver and an authenticated account. */
export interface DriverAccountBinding {
  readonly driverId: string;
  readonly userId: string | null;
}

/** Safe account selector data; password hashes and unrelated user fields never leave persistence. */
export interface DriverAccountOption {
  readonly userId: string;
  readonly email: string;
  readonly status: 'active' | 'disabled';
  readonly driverId: string | null;
}

/** One binding decision and its audit record must commit in the same unit of work. */
export interface DriverAccountBindingStore {
  get(organizationId: string, driverId: string): Promise<DriverAccountBinding>;
  listAccounts(organizationId: string): Promise<DriverAccountOption[]>;
  bind(organizationId: string, driverId: string, userId: string | null,
    actorUserId: string, occurredAt: string): Promise<DriverAccountBinding>;
  findDriverId(organizationId: string, userId: string): Promise<string | null>;
}
