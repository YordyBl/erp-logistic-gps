import type { User } from '../../domain/entities/User.js';

/**
 * Persistence contract for users.
 *
 * `findByEmail` is organization-scoped because the email is unique per tenant,
 * not globally: the same person may hold accounts in two organizations.
 * `findById` has no tenant filter so use cases can distinguish a missing actor
 * from an actor outside the requested organization and answer both the same way
 * (ADR-003 §6).
 *
 * Repositories return domain entities, never persistence rows (ADR-002 §2).
 */
export interface UserRepository {
  save(user: User): Promise<void>;
  findById(userId: string): Promise<User | null>;
  findByEmail(organizationId: string, email: string): Promise<User | null>;
}
