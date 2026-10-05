import type { ArcadeIdentity } from './index';

export async function checkRole(
  roleOrRoles: string | string[],
  identity?: ArcadeIdentity | null,
) {
  const roles = Array.isArray(roleOrRoles) ? roleOrRoles : [roleOrRoles];
  return roles.some((role) => identity?.roles?.includes(role));
}
