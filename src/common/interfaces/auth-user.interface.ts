import { Role } from '@prisma/client';

/** Shape of `request.user` after JWT validation. */
export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: Role;
}

export interface JwtPayload {
  sub: string;
  email: string;
  role: Role;
}
