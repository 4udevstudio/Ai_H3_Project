import type { RequestUser } from '@/lib/request-user'
import { ownerWhere } from '@/lib/request-user'
import { prisma } from '@/lib/prisma'

import { DbError } from './errors'

export type Actor = RequestUser | null

export async function requireFilm(user: Actor, id: string) {
  const film = await prisma.project.findFirst({
    where: { id, ...ownerWhere(user) },
  })
  if (!film) throw new DbError('film not found', 404)
  return film
}

export async function requireScene(user: Actor, filmId: string, sceneId: string) {
  await requireFilm(user, filmId)
  const scene = await prisma.scene.findUnique({
    where: { id: sceneId },
    include: { images: { orderBy: { order: 'asc' } } },
  })
  if (!scene || scene.projectId !== filmId) throw new DbError('scene not found', 404)
  return scene
}

export const sceneInclude = {
  images: { orderBy: { order: 'asc' as const } },
}
