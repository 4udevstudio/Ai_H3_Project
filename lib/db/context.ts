import { prisma } from '@/lib/prisma'

import { DbError } from './errors'

export async function requireFilm(id: string) {
  const film = await prisma.project.findUnique({ where: { id } })
  if (!film) throw new DbError('film not found', 404)
  return film
}

export async function requireScene(filmId: string, sceneId: string) {
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
