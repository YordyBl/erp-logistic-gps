import type { Clock } from '../../ports/Clock.js';
import type { RefreshTokenStore } from '../../ports/RefreshTokenStore.js';
import type { TokenService } from '../../ports/TokenService.js';
import { parseLogoutCommand } from './LogoutCommand.js';
import type { LogoutResult } from './LogoutResult.js';

export interface LogoutDependencies {
  readonly tokenService: TokenService;
  readonly refreshTokens: RefreshTokenStore;
  readonly clock: Clock;
}

/**
 * Revokes the current device's refresh token.
 *
 * Logout is idempotent: an unknown, already revoked or duplicated token is a
 * successful no-op, so a retried request (or a second tab) never turns into an
 * error. Only the presented family is touched; other devices stay signed in.
 * Access tokens are stateless and expire within 15 minutes (ADR-003 §2).
 */
export class LogoutUseCase {
  constructor(private readonly dependencies: LogoutDependencies) {}

  async execute(input: unknown): Promise<LogoutResult> {
    const command = parseLogoutCommand(input);
    const tokenHash = this.dependencies.tokenService.hashRefresh(command.refreshToken);

    const stored = await this.dependencies.refreshTokens.findByHash(tokenHash);

    if (stored === null) {
      return { revoked: false };
    }

    const revoked = await this.dependencies.refreshTokens.revokeOne(
      stored.id,
      this.dependencies.clock.now(),
    );

    return { revoked };
  }
}
