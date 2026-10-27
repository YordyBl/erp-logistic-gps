export type ErrorDetails = Readonly<Record<string, unknown>>;

/**
 * Base class for typed errors with a stable, machine-readable code.
 *
 * Domain and application layers throw subclasses; the future central error
 * middleware maps `code` to HTTP statuses without matching message strings.
 * Errors never carry secrets or raw personal data in their details.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;
  readonly details: ErrorDetails | undefined;

  protected constructor(message: string, details?: ErrorDetails) {
    super(message);
    this.name = new.target.name;
    this.details = details;
  }
}
