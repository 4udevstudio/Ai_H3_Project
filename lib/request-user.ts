/**
 * Auth integration point.
 *
 * The auth branch owns `lib/auth.ts` and should replace the body of
 * `getRequestUser` with `getCurrentUser(req)`. Do not add `lib/auth.ts` here.
 *
 * A null user means auth is off: every row is visible, and new films, jobs,
 * and renders are stored with `userId = null`.
 */
export type RequestUser = {
  id: string
  role: 'ADMIN' | 'USER'
}

export async function getRequestUser(req?: Request): Promise<RequestUser | null> {
  void req
  return null
}

/**
 * null or ADMIN: no extra filter. USER: only rows they own.
 * Apply this to Project, Job, and FinalRender. Scenes and scripts are
 * reached through a film that already passed this check.
 */
export function ownerWhere(
  user: RequestUser | null
): { userId: string } | Record<string, never> {
  if (user === null || user.role === 'ADMIN') return {}
  return { userId: user.id }
}
