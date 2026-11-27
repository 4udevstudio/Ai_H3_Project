import { prisma } from '@/lib/prisma'

import { LIMITS } from './constants'
import { requireScene } from './context'
import { parseReferenceType, parseRole } from './enums'
import { DbError } from './errors'
import { asRecord, readNumber, readString } from './parse'
import { serializeSceneImage, type SceneImageJson } from './serializers'

export async function addSceneImage(
  filmId: string,
  sceneId: string,
  input: unknown
): Promise<SceneImageJson> {
  await requireScene(filmId, sceneId)
  const body = asRecord(input)
  const imagePath = readString(body, 'path', LIMITS.path, true)
  if (!imagePath) throw new DbError('path is required', 400)

  const role = 'role' in body ? parseRole(body.role) : 'REF'
  const type = 'type' in body ? parseReferenceType(body.type) : 'IMAGE'
  const requestedOrder = readNumber(body, 'order', { min: 0, max: 10000, integer: true })

  const image = await prisma.$transaction(async (tx) => {
    const maxOrder = await tx.reference.aggregate({
      where: { sceneId },
      _max: { order: true },
    })
    const order = requestedOrder ?? (maxOrder._max.order ?? -1) + 1
    return tx.reference.create({
      data: {
        sceneId,
        path: imagePath,
        role,
        type,
        order,
      },
    })
  })

  return serializeSceneImage(image)
}

export async function deleteSceneImage(
  filmId: string,
  sceneId: string,
  imageId: string
): Promise<{ deleted: true }> {
  await requireScene(filmId, sceneId)
  const image = await prisma.reference.findFirst({ where: { id: imageId, sceneId } })
  if (!image) throw new DbError('image not found', 404)
  await prisma.reference.delete({ where: { id: imageId } })
  return { deleted: true }
}
