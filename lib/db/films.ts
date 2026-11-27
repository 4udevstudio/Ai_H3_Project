import type { Prisma } from '@prisma/client'

import { computeFailureMessage, computeFailureStatus, uploadAudio } from '@/lib/compute'
import { prisma } from '@/lib/prisma'

import { LIMITS, MAX_AUDIO_VOLUME, MAX_FPS, MAX_HEIGHT, MAX_TRANSITION_DURATION, MAX_WIDTH } from './constants'
import { requireFilm } from './context'
import { parseTransition } from './enums'
import { DbError } from './errors'
import { asRecord, readNumber, readString } from './parse'
import { serializeFilm, type FilmJson } from './serializers'

export async function listFilms(): Promise<FilmJson[]> {
  const films = await prisma.project.findMany({ orderBy: { updatedAt: 'desc' } })
  return films.map(serializeFilm)
}

export async function getFilm(id: string): Promise<FilmJson> {
  const film = await requireFilm(id)
  return serializeFilm(film)
}

export async function createFilm(input: unknown): Promise<FilmJson> {
  const body = asRecord(input)
  const title = readString(body, 'title', LIMITS.title, true)
  if (!title) throw new DbError('title is required', 400)

  const script = readString(body, 'script', LIMITS.script, false)
  const transition = 'transition' in body ? parseTransition(body.transition) : undefined
  const transitionDuration = readNumber(body, 'transition_duration', { min: 0, max: MAX_TRANSITION_DURATION })
  const width = readNumber(body, 'width', { min: 16, max: MAX_WIDTH, integer: true })
  const height = readNumber(body, 'height', { min: 16, max: MAX_HEIGHT, integer: true })
  const fps = readNumber(body, 'fps', { min: 1, max: MAX_FPS, integer: true })
  const audioPath = readString(body, 'audio_path', LIMITS.path, false)
  const audioVolume = readNumber(body, 'audio_volume', { min: 0, max: MAX_AUDIO_VOLUME })

  const film = await prisma.project.create({
    data: {
      name: title,
      theme: 'midnight',
      ...(script !== undefined ? { script } : {}),
      ...(transition !== undefined ? { transitionType: transition } : {}),
      ...(transitionDuration != null ? { transitionDuration } : {}),
      ...(width != null ? { width } : {}),
      ...(height != null ? { height } : {}),
      ...(fps != null ? { fps } : {}),
      ...(audioPath !== undefined ? { audioPath } : {}),
      ...(audioVolume != null ? { audioVolume } : {}),
    },
  })

  return serializeFilm(film)
}

export async function updateFilm(id: string, input: unknown): Promise<FilmJson> {
  await requireFilm(id)
  const body = asRecord(input)
  const data: Prisma.ProjectUpdateInput = {}

  if ('title' in body) {
    const title = readString(body, 'title', LIMITS.title, true)
    if (!title) throw new DbError('title is required', 400)
    data.name = title
  }
  if ('script' in body) {
    data.script = readString(body, 'script', LIMITS.script, false) ?? null
  }
  if ('transition' in body) data.transitionType = parseTransition(body.transition)
  if ('transition_duration' in body) {
    const value = readNumber(body, 'transition_duration', { min: 0, max: MAX_TRANSITION_DURATION, required: true })
    if (value != null) data.transitionDuration = value
  }
  if ('width' in body) {
    const value = readNumber(body, 'width', { min: 16, max: MAX_WIDTH, integer: true, required: true })
    if (value != null) data.width = value
  }
  if ('height' in body) {
    const value = readNumber(body, 'height', { min: 16, max: MAX_HEIGHT, integer: true, required: true })
    if (value != null) data.height = value
  }
  if ('fps' in body) {
    const value = readNumber(body, 'fps', { min: 1, max: MAX_FPS, integer: true, required: true })
    if (value != null) data.fps = value
  }
  if ('audio_path' in body) {
    data.audioPath = readString(body, 'audio_path', LIMITS.path, false) ?? null
  }
  if ('audio_volume' in body) {
    const value = readNumber(body, 'audio_volume', { min: 0, max: MAX_AUDIO_VOLUME, required: true })
    if (value != null) data.audioVolume = value
  }

  const film = await prisma.project.update({ where: { id }, data })
  return serializeFilm(film)
}

/**
 * Detach Generation rows first, matching DELETE /api/projects/[id],
 * so studio history survives deleting a film. Scenes, scripts, renders,
 * and jobs cascade with the project.
 */
export async function deleteFilm(id: string): Promise<{ deleted: true }> {
  await requireFilm(id)

  await prisma.$transaction(async (tx) => {
    await tx.scene.updateMany({
      where: { projectId: id },
      data: { currentGenerationId: null },
    })
    await tx.generation.updateMany({
      where: { OR: [{ projectId: id }, { scene: { projectId: id } }] },
      data: { projectId: null, sceneId: null },
    })
    await tx.project.delete({ where: { id } })
  })

  return { deleted: true }
}

/**
 * Forward a multipart audio file to POST /jobs/upload-audio and store the
 * returned outputs-relative path on the film.
 */
export async function uploadFilmAudio(id: string, file: File): Promise<FilmJson> {
  await requireFilm(id)
  if (!file || file.size <= 0) throw new DbError('file is required', 400)

  try {
    const uploaded = await uploadAudio(file)
    const film = await prisma.project.update({
      where: { id },
      data: { audioPath: uploaded.audio_path },
    })
    return serializeFilm(film)
  } catch (error) {
    if (error instanceof DbError) throw error
    throw new DbError(computeFailureMessage(error), computeFailureStatus(error))
  }
}
