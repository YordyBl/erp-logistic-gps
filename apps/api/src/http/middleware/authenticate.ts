import type { Request, RequestHandler, Response } from 'express';

import type { TokenService } from '../../modules/identity-and-access/application/ports/TokenService.js';
import type { UserRepository } from '../../modules/identity-and-access/application/ports/UserRepository.js';
import { HttpError } from '../errors.js';
import { setAuthenticatedUser } from '../request-context.js';

export interface AuthenticationDependencies {
  readonly tokenService: TokenService;
  readonly users: UserRepository;
}

export const AUTH_TOKEN_MISSING_MESSAGE =
  'The Authorization header with a Bearer access token is required';

const BEARER_PATTERN = /^Bearer\s+(\S+)$/i;

/**
 * Verifies the access token and establishes the caller's tenant context.
 *
 * This middleware replaces the Fase 0 `x-organization-id` header adapter
 * (ADR-003): the signature, algorithm allowlist, `iss`, `aud`, `exp`, `nbf`,
 * `sub` and `jti` are validated by the token adapter, then the user is reloaded
 * from storage. Reloading is what makes a deleted, disabled or demoted account
 * take effect immediately instead of surviving inside a 15-minute token.
 *
 * A token whose organization no longer matches the stored user is treated as a
 * dead session, not as a tenant override.
 */
export function createAuthenticate({
  tokenService,
  users,
}: AuthenticationDependencies): RequestHandler {
  return async (request: Request, response: Response, next): Promise<void> => {
    const token = readBearerToken(request);

    if (token === undefined) {
      throw new HttpError(401, 'AUTH_TOKEN_MISSING', AUTH_TOKEN_MISSING_MESSAGE);
    }

    // InvalidTokenError from the adapter already carries the stable
    // IDENTITY_INVALID_TOKEN code and a message that never echoes the token.
    const claims = await tokenService.verifyAccess(token);
    const user = await users.findById(claims.userId);

    if (
      user === null ||
      user.status !== 'active' ||
      user.organizationId !== claims.organizationId
    ) {
      throw new HttpError(
        401,
        'AUTH_SESSION_INVALID',
        'The authenticated session is no longer valid',
      );
    }

    setAuthenticatedUser(response, {
      id: user.id,
      organizationId: user.organizationId,
      email: user.email,
      role: user.role,
    });

    next();
  };
}

function readBearerToken(request: Request): string | undefined {
  const header = request.header('authorization');

  if (header === undefined) {
    return undefined;
  }

  const match = BEARER_PATTERN.exec(header.trim());
  return match?.[1];
}
