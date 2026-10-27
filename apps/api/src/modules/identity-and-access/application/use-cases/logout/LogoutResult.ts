export interface LogoutResult {
  /** `true` only when this call revoked a live token. */
  readonly revoked: boolean;
}
