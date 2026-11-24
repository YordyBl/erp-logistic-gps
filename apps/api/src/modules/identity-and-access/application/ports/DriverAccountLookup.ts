/**
 * Read-only view of the driver ↔ account link owned by the `drivers` module.
 *
 * Identity never imports that module: the composition root adapts its binding
 * store to this port, so a role change can refuse to strand a linked driver.
 */
export interface DriverAccountLookup {
  isLinkedToDriver(organizationId: string, userId: string): Promise<boolean>;
}
