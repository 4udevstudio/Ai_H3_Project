import {
  computeFailureMessage,
  computeFailureStatus,
  exportFilm,
} from '@/lib/compute'
import { prisma } from '@/lib/prisma'

import { requireFilm } from './context'
import { DbError } from './errors'
import { serializeJob, serializeRender, type FinalRenderJson, type JobJson } from './serializers'

export interface CreateRenderResult {
  render: FinalRenderJson
  job: JobJson
  httpStatus: number
}

function exportTransition(value: string): 'none' | 'crossfade' {
  return value.toUpperCase() === 'CROSSFADE' ? 'crossfade' : 'none'
}

export async function listRenders(filmId: string): Promise<FinalRenderJson[]> {
  await requireFilm(filmId)
  const renders = await prisma.finalRender.findMany({
    where: { projectId: filmId },
    orderBy: { createdAt: 'desc' },
    include: { clips: { orderBy: { order: 'asc' } } },
  })
  return renders.map(serializeRender)
}

/**
 * Build an export from each scene's current clip, in order, using the film transition.
 */
export async function createRender(filmId: string): Promise<CreateRenderResult> {
  const film = await requireFilm(filmId)
  const scenes = await prisma.scene.findMany({
    where: { projectId: filmId },
    orderBy: { order: 'asc' },
  })

  if (scenes.length === 0) throw new DbError('film has no scenes', 400)
  const missing = scenes.filter((scene) => !scene.clipPath)
  if (missing.length > 0) {
    throw new DbError(
      `every scene needs a clip before export (missing order ${missing.map((scene) => scene.order).join(', ')})`,
      400
    )
  }

  const transition = exportTransition(film.transitionType)
  const audioVolume = Math.min(2, Math.max(0, film.audioVolume))

  const created = await prisma.$transaction(async (tx) => {
    const render = await tx.finalRender.create({
      data: {
        projectId: filmId,
        status: 'PENDING',
        audioPath: film.audioPath,
        audioVolume,
        width: film.width,
        height: film.height,
        fps: film.fps,
        clips: {
          create: scenes.map((scene) => ({
            sceneId: scene.id,
            generationId: scene.currentGenerationId,
            order: scene.order,
            transitionType: film.transitionType,
            transitionDuration: film.transitionDuration,
          })),
        },
      },
    })

    const job = await tx.job.create({
      data: {
        kind: 'EXPORT',
        targetId: render.id,
        projectId: filmId,
        status: 'QUEUED',
        progress: 0,
      },
    })

    await tx.finalRender.update({ where: { id: render.id }, data: { jobId: job.id } })
    await tx.project.update({ where: { id: filmId }, data: { status: 'ASSEMBLING' } })
    return { renderId: render.id, jobId: job.id }
  })

  const load = async () => {
    const render = await prisma.finalRender.findUnique({
      where: { id: created.renderId },
      include: { clips: { orderBy: { order: 'asc' } } },
    })
    const job = await prisma.job.findUnique({ where: { id: created.jobId } })
    if (!render || !job) throw new DbError('render not found', 500)
    return { render: serializeRender(render), job: serializeJob(job) }
  }

  try {
    const remote = await exportFilm({
      clips: scenes.map((scene) => ({
        path: scene.clipPath as string,
        order: scene.order,
        transition,
        transition_duration: film.transitionDuration,
      })),
      ...(film.audioPath ? { audio_path: film.audioPath } : {}),
      audio_volume: audioVolume,
      width: film.width,
      height: film.height,
      fps: film.fps,
    })

    await prisma.job.update({
      where: { id: created.jobId },
      data: { backendJobId: remote.job_id },
    })
    const fresh = await load()
    return { ...fresh, httpStatus: 201 }
  } catch (error) {
    const message = computeFailureMessage(error)
    await prisma.$transaction([
      prisma.job.update({
        where: { id: created.jobId },
        data: { status: 'FAILED', error: message },
      }),
      prisma.finalRender.update({
        where: { id: created.renderId },
        data: { status: 'FAILED', error: message, completedAt: new Date() },
      }),
      prisma.project.update({
        where: { id: filmId },
        data: { status: 'FAILED' },
      }),
    ])
    const fresh = await load()
    return { ...fresh, httpStatus: computeFailureStatus(error) }
  }
}
