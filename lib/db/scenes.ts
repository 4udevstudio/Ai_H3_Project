import type { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'

import { LIMITS, MAX_SCENE_DURATION } from './constants'
import { requireFilm, requireScene, sceneInclude } from './context'
import { parseMode } from './enums'
import { DbError } from './errors'
import { asRecord, readBoolean, readNumber, readString } from './parse'
import { serializeScene, type SceneJson } from './serializers'

async function loadScene(id: string): Promise<SceneJson> {
  const scene = await prisma.scene.findUnique({ where: { id }, include: sceneInclude })
  if (!scene) throw new DbError('scene not found', 404)
  return serializeScene(scene)
}

export async function listScenes(filmId: string): Promise<SceneJson[]> {
  await requireFilm(filmId)
  const scenes = await prisma.scene.findMany({
    where: { projectId: filmId },
    orderBy: { order: 'asc' },
    include: sceneInclude,
  })
  return scenes.map(serializeScene)
}

export async function getScene(filmId: string, sceneId: string): Promise<SceneJson> {
  const scene = await requireScene(filmId, sceneId)
  return serializeScene(scene)
}

export async function createScene(filmId: string, input: unknown): Promise<SceneJson> {
  await requireFilm(filmId)
  const body = asRecord(input)
  const prompt = readString(body, 'prompt', LIMITS.prompt, true)
  if (!prompt) throw new DbError('prompt is required', 400)

  const mode = 'mode' in body ? parseMode(body.mode) : 'T2V'
  const gguf = readBoolean(body, 'gguf') ?? false
  const durationSec = readNumber(body, 'duration_sec', { min: 0.1, max: MAX_SCENE_DURATION }) ?? 5
  const seed = readNumber(body, 'seed', { min: -2147483648, max: 2147483647, integer: true })
  const chainFromPrevious = readBoolean(body, 'chain_from_previous') ?? true
  const title = readString(body, 'title', LIMITS.title, false)
  const negativePrompt = readString(body, 'negative_prompt', LIMITS.negativePrompt, false)
  const requestedOrder = readNumber(body, 'order', { min: 0, max: 10000, integer: true })

  const createdId = await prisma.$transaction(async (tx) => {
    const count = await tx.scene.count({ where: { projectId: filmId } })
    let order = requestedOrder ?? count
    if (order > count) order = count

    if (order < count) {
      const toShift = await tx.scene.findMany({
        where: { projectId: filmId, order: { gte: order } },
        orderBy: { order: 'desc' },
        select: { id: true, order: true },
      })
      for (const scene of toShift) {
        await tx.scene.update({ where: { id: scene.id }, data: { order: scene.order + 1 } })
      }
    }

    const created = await tx.scene.create({
      data: {
        projectId: filmId,
        order,
        prompt,
        mode,
        gguf,
        durationSec,
        chainFromPrevious,
        ...(seed != null ? { seed } : {}),
        ...(title !== undefined ? { title } : {}),
        ...(negativePrompt !== undefined ? { negativePrompt } : {}),
      },
    })
    return created.id
  })

  return loadScene(createdId)
}

export async function updateScene(filmId: string, sceneId: string, input: unknown): Promise<SceneJson> {
  await requireScene(filmId, sceneId)
  const body = asRecord(input)
  const data: Prisma.SceneUpdateInput = {}

  if ('prompt' in body) {
    const prompt = readString(body, 'prompt', LIMITS.prompt, true)
    if (!prompt) throw new DbError('prompt is required', 400)
    data.prompt = prompt
  }
  if ('mode' in body) data.mode = parseMode(body.mode)
  if ('gguf' in body) {
    const gguf = readBoolean(body, 'gguf')
    if (gguf !== undefined) data.gguf = gguf
  }
  if ('duration_sec' in body) {
    const duration = readNumber(body, 'duration_sec', { min: 0.1, max: MAX_SCENE_DURATION, required: true })
    if (duration != null) data.durationSec = duration
  }
  if ('seed' in body) {
    data.seed = readNumber(body, 'seed', {
      min: -2147483648,
      max: 2147483647,
      integer: true,
    }) ?? null
  }
  if ('chain_from_previous' in body) {
    const chain = readBoolean(body, 'chain_from_previous')
    if (chain !== undefined) data.chainFromPrevious = chain
  }
  if ('title' in body) data.title = readString(body, 'title', LIMITS.title, false) ?? null
  if ('negative_prompt' in body) {
    data.negativePrompt = readString(body, 'negative_prompt', LIMITS.negativePrompt, false) ?? null
  }

  await prisma.scene.update({ where: { id: sceneId }, data })
  return loadScene(sceneId)
}

export async function deleteScene(filmId: string, sceneId: string): Promise<{ deleted: true }> {
  await requireScene(filmId, sceneId)

  await prisma.$transaction(async (tx) => {
    await tx.scene.update({ where: { id: sceneId }, data: { currentGenerationId: null } })
    await tx.scene.delete({ where: { id: sceneId } })
    const rest = await tx.scene.findMany({
      where: { projectId: filmId },
      orderBy: { order: 'asc' },
      select: { id: true, order: true },
    })
    for (let index = 0; index < rest.length; index += 1) {
      if (rest[index].order !== index) {
        await tx.scene.update({ where: { id: rest[index].id }, data: { order: index } })
      }
    }
  })

  return { deleted: true }
}

export async function reorderScenes(filmId: string, input: unknown): Promise<SceneJson[]> {
  await requireFilm(filmId)
  const body = asRecord(input)
  const raw = body.scene_ids
  if (!Array.isArray(raw) || raw.some((id) => typeof id !== 'string' || !id.trim())) {
    throw new DbError('scene_ids must be an array of scene id strings', 400)
  }

  const sceneIds = raw.map((id) => id.trim())
  if (new Set(sceneIds).size !== sceneIds.length) {
    throw new DbError('scene_ids contains duplicates', 400)
  }

  const existing = await prisma.scene.findMany({
    where: { projectId: filmId },
    select: { id: true },
  })
  const existingIds = new Set(existing.map((scene) => scene.id))
  const matches =
    sceneIds.length === existingIds.size && sceneIds.every((id) => existingIds.has(id))
  if (!matches) {
    throw new DbError('scene_ids must list every scene of this film exactly once', 400)
  }

  await prisma.$transaction(
    sceneIds.map((id, order) => prisma.scene.update({ where: { id }, data: { order } }))
  )

  return listScenes(filmId)
}
