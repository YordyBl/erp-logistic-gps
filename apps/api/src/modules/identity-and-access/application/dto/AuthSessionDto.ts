import type { AuthenticatedUserDto } from './IdentityDto.js';

/**
 * Output contract of `login` and `refresh-session`.
 *
 * The transport adapter decides where each value goes: the access token in the
 * response body, the refresh token in an HttpOnly/Secure/SameSite=Strict cookie
 * (ADR-003 §4). The refresh token is returned once and never read back.
 */
export interface AuthSessionDto {
  readonly accessToken: string;
  readonly accessTokenExpiresAt: string;
  readonly refreshToken: string;
  readonly refreshTokenExpiresAt: string;
  readonly user: AuthenticatedUserDto;
}
