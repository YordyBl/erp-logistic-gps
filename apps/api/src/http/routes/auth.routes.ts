import { Router } from 'express';
import type { RequestHandler } from 'express';

import type { AuthSessionDto } from '../../modules/identity-and-access/application/dto/AuthSessionDto.js';
import type { LoginUseCase } from '../../modules/identity-and-access/application/use-cases/login/LoginUseCase.js';
import { loginCommandSchema } from '../../modules/identity-and-access/application/use-cases/login/LoginCommand.js';
import type { LogoutUseCase } from '../../modules/identity-and-access/application/use-cases/logout/LogoutUseCase.js';
import type { RefreshSessionUseCase } from '../../modules/identity-and-access/application/use-cases/refresh-session/RefreshSessionUseCase.js';
import { InvalidCredentialsError } from '../../modules/identity-and-access/domain/errors/IdentityError.js';
import {
  clearRefreshCookie,
  readRefreshCookie,
  setRefreshCookie,
  type RefreshCookieConfig,
} from '../cookies.js';
import { HttpError } from '../errors.js';
import type { LoginRateLimiter } from '../middleware/login-rate-limit.js';
import { getAuthenticatedUser } from '../request-context.js';
import { parseIdentityOrThrow } from '../validation.js';

export interface AuthRouterDependencies {
  readonly login: LoginUseCase;
  readonly refreshSession: RefreshSessionUseCase;
  readonly logout: LogoutUseCase;
  readonly cookie: RefreshCookieConfig;
  readonly loginRateLimiter: LoginRateLimiter;
  /** JWT middleware shared with the other protected routers. */
  readonly authenticate: RequestHandler;
}

/**
 * HTTP adapter for the `identity-and-access` authentication surface.
 *
 * The application result `AuthSessionDto` contains the raw refresh token; this
 * router splits it before serialization: the access token and metadata go to
 * the body, the refresh token goes only to the HttpOnly cookie and is never
 * echoed in JSON (ADR-003 §4).
 */
export function createAuthRouter(dependencies: AuthRouterDependencies): Router {
  const router = Router();

  router.post('/login', async (request, response) => {
    const command = parseIdentityOrThrow(
      loginCommandSchema,
      request.body,
      'Login request body is invalid',
    );

    const rateLimitKey = loginRateLimitKey(
      request.ip ?? request.socket.remoteAddress ?? 'unknown',
      command.email,
    );
    const retryAfterSeconds =
      dependencies.loginRateLimiter.retryAfterSeconds(rateLimitKey);

    if (retryAfterSeconds !== undefined) {
      response.set('Retry-After', String(retryAfterSeconds));
      throw new HttpError(
        429,
        'AUTH_RATE_LIMITED',
        'Too many login attempts; try again later',
        { retryAfterSeconds },
      );
    }

    let session: AuthSessionDto;
    try {
      session = await dependencies.login.execute(command);
    } catch (error) {
      if (error instanceof InvalidCredentialsError) {
        dependencies.loginRateLimiter.recordFailure(rateLimitKey);
      }

      throw error;
    }

    setRefreshCookie(response, session.refreshToken, dependencies.cookie);
    response.status(200).json(toSessionBody(session));
  });

  router.post('/refresh', async (request, response) => {
    const refreshToken = readRefreshCookie(request);

    if (refreshToken === undefined) {
      clearRefreshCookie(response, dependencies.cookie);
      throw new HttpError(
        401,
        'AUTH_REFRESH_TOKEN_MISSING',
        'The refresh token cookie is required',
      );
    }

    let session: AuthSessionDto;
    try {
      session = await dependencies.refreshSession.execute({ refreshToken });
    } catch (error) {
      // Every rejected refresh is a dead session on this device: clear the
      // compromised or unknown credential so the browser stops replaying it.
      clearRefreshCookie(response, dependencies.cookie);
      throw error;
    }

    setRefreshCookie(response, session.refreshToken, dependencies.cookie);
    response.status(200).json(toSessionBody(session));
  });

  router.post('/logout', async (request, response) => {
    const refreshToken = readRefreshCookie(request);

    if (refreshToken !== undefined) {
      // Logout is intentionally idempotent: an unknown or already revoked
      // token is a successful no-op (LogoutUseCase).
      await dependencies.logout.execute({ refreshToken });
    }

    clearRefreshCookie(response, dependencies.cookie);
    response.status(204).end();
  });

  router.get('/me', dependencies.authenticate, (_request, response) => {
    const user = getAuthenticatedUser(response);

    if (user === undefined) {
      throw new HttpError(
        401,
        'AUTH_TOKEN_MISSING',
        'The Authorization header with a Bearer access token is required',
      );
    }

    response.status(200).json({
      data: {
        id: user.id,
        organizationId: user.organizationId,
        email: user.email,
        role: user.role,
      },
    });
  });

  return router;
}

function toSessionBody(session: AuthSessionDto) {
  return {
    data: {
      accessToken: session.accessToken,
      accessTokenExpiresAt: session.accessTokenExpiresAt,
      refreshTokenExpiresAt: session.refreshTokenExpiresAt,
      user: session.user,
    },
  };
}

function loginRateLimitKey(ip: string, email: string): string {
  return `${ip}:${email.trim().toLowerCase()}`;
}
