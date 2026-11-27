import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'

import {
  ComputeConnectionError,
  ComputeRequestError,
  uploadReference,
} from '@/lib/backend-server'
import { prisma } from '@/lib/prisma'

import { LIMITS } from './constants'
import { requireScene, type Actor } from './context'
import { parseReferenceType, parseRole } from './enums'
import { DbError } from './errors'
import { asRecord, readNumber, readString } from './parse'
import { serializeSceneImage, type SceneImageJson } from './serializers'

export async function addSceneImage(
  user: Actor,
  filmId: string,
  sceneId: string,
  input: unknown
): Promise<SceneImageJson> {
  await requireScene(user, filmId, sceneId)
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

const REFERENCE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.gif',
  '.mp4', '.webm', '.mov',
  '.wav', '.mp3', '.m4a',
])

function extensionOf(filename: string): string {
  const ext = path.extname(filename || '').toLowerCase()
  return REFERENCE_EXTENSIONS.has(ext) ? ext : ''
}

function saveReferenceFile(file: File, bytes: Buffer): { path: string; type: string } {
  const ext = extensionOf(file.name) || '.bin'
  const type = ['.mp4', '.webm', '.mov'].includes(ext)
    ? 'VIDEO'
    : ['.wav', '.mp3', '.m4a'].includes(ext)
      ? 'AUDIO'
      : 'IMAGE'
  const dir = path.join(process.cwd(), 'outputs', 'references')
  fs.mkdirSync(dir, { recursive: true })
  const filename = `${randomUUID()}${ext}`
  fs.writeFileSync(path.join(dir, filename), bytes)
  return { path: `references/${filename}`, type }
}

/**
 * Multipart upload. Tries FastAPI POST /api/uploads/reference.
 * If that route is missing or the compute service is down, the bytes are
 * stored at outputs/references/<uuid>.<ext> and the Reference path is
 * `references/<file>`.
 */
export async function addUploadedSceneImage(
  user: Actor,
  filmId: string,
  sceneId: string,
  file: File,
  roleRaw: string | null,
  orderRaw: string | null
): Promise<SceneImageJson> {
  await requireScene(user, filmId, sceneId)
  if (!file || file.size <= 0) throw new DbError('file is required', 400)
  if (!extensionOf(file.name)) throw new DbError('file extension is not allowed', 400)

  const role = roleRaw ? parseRole(roleRaw) : 'REF'
  let order: number | null = null
  if (orderRaw !== null && orderRaw !== '') {
    const parsed = Number(orderRaw)
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 10000) {
      throw new DbError('order must be an integer between 0 and 10000', 400)
    }
    order = parsed
  }

  let stored: { path: string; type: string }
  try {
    const uploaded = await uploadReference(file, user)
    stored = { path: uploaded.path, type: uploaded.type }
  } catch (error) {
    const missing = error instanceof ComputeRequestError && error.status === 404
    if (!(error instanceof ComputeConnectionError) && !missing) {
      throw new DbError(
        error instanceof Error ? error.message : 'reference upload failed',
        error instanceof ComputeRequestError ? error.status : 502
      )
    }
    const bytes = Buffer.from(await file.arrayBuffer())
    stored = saveReferenceFile(file, bytes)
  }

  const image = await prisma.$transaction(async (tx) => {
    const maxOrder = await tx.reference.aggregate({
      where: { sceneId },
      _max: { order: true },
    })
    return tx.reference.create({
      data: {
        sceneId,
        path: stored.path,
        role,
        type: stored.type,
        order: order ?? (maxOrder._max.order ?? -1) + 1,
      },
    })
  })

  return serializeSceneImage(image)
}

export async function deleteSceneImage(
  user: Actor,
  filmId: string,
  sceneId: string,
  imageId: string
): Promise<{ deleted: true }> {
  await requireScene(user, filmId, sceneId)
  const image = await prisma.reference.findFirst({ where: { id: imageId, sceneId } })
  if (!image) throw new DbError('image not found', 404)
  await prisma.reference.delete({ where: { id: imageId } })
  return { deleted: true }
}
