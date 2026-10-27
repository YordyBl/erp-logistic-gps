import type { RequestHandler } from 'express';

import type { UserRole } from '../../modules/identity-and-access/domain/entities/User.js';
import { HttpError } from '../errors.js';
import { getAuthenticatedUser } from '../request-context.js';
import { AUTH_TOKEN_MISSING_MESSAGE } from './authenticate.js';

/**
 * Role gate for routes that require a specific role.
 *
 * It reads the role resolved by {@link createAuthenticate}, which comes from
 * storage rather than the token claim, so a role change applies on the next
 * request. A missing caller is a 401 (the route was mounted without
 * authentication); a known caller without the role is a 403 with the required
 * and actual roles, which are not secrets.
 */
export function requireRole(...requiredRoles: readonly UserRole[]): RequestHandler {
  return (_request, response, next) => {
    const user = getAuthenticatedUser(response);

    if (user === undefined) {
      throw new HttpError(401, 'AUTH_TOKEN_MISSING', AUTH_TOKEN_MISSING_MESSAGE);
    }

    if (!requiredRoles.includes(user.role)) {
      throw new HttpError(
        403,
        'AUTH_FORBIDDEN',
        `Role ${user.role} is not allowed to access this resource`,
        {
          requiredRoles: [...requiredRoles],
          actualRole: user.role,
        },
      );
    }

    next();
  };
}
