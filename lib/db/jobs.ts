import type { Job, Prisma } from '@prisma/client'

import {
  computeFailureMessage,
  computeFailureStatus,
  generateScene as enqueueScene,
  getComputeJob,
  type ComputeJobSnapshot,
  ComputeConnectionError,
  ComputeRequestError,
} from '@/lib/compute'
import { storedOutputPath } from '@/lib/files'
import { prisma } from '@/lib/prisma'

import { DbError } from './errors'

import {
  DEFAULT_FPS,
  DEFAULT_HEIGHT,
  DEFAULT_WIDTH,
} from './constants'
import { requireScene } from './context'
import {
  clampProgress,
  generationStatusFor,
  mapRemoteJobStatus,
  modeToGenerationType,
  modeToTaskAdapter,
  renderStatusFor,
} from './enums'
import { serializeJob, type JobJson } from './serializers'

export interface GenerateSceneResult {
  job: JobJson
  httpStatus: number
}

function sceneImagesByRole(
  images: { role: string | null; path: string; order: number }[],
  role: string
) {
  return images
    .filter((image) => (image.role ?? 'REF') === role)
    .sort((a, b) => a.order - b.order)
}

/**
 * Create a Generation attempt and a Job, then enqueue /jobs/generate-scene.
 * When chain_from_previous is set, the previous scene's lastFramePath is
 * sent as first_frame.
 */
export async function generateScene(filmId: string, sceneId: string): Promise<GenerateSceneResult> {
  const scene = await requireScene(filmId, sceneId)
  if (!scene.prompt.trim()) throw new DbError('prompt is required', 400)

  const film = await prisma.project.findUnique({ where: { id: filmId } })
  if (!film) throw new DbError('film not found', 404)

  const width = film.width || DEFAULT_WIDTH
  const height = film.height || DEFAULT_HEIGHT
  const fps = film.fps || DEFAULT_FPS
  const duration = scene.durationSec > 0 ? scene.durationSec : 5

  let firstFrame: string | null = null
  if (scene.chainFromPrevious) {
    const previous = await prisma.scene.findFirst({
      where: { projectId: filmId, order: { lt: scene.order } },
      orderBy: { order: 'desc' },
      select: { lastFramePath: true },
    })
    if (previous?.lastFramePath) firstFrame = previous.lastFramePath
  }
  if (!firstFrame) {
    const firstImage = sceneImagesByRole(scene.images, 'FIRST')[0]
    if (firstImage) firstFrame = firstImage.path
    else if (!scene.chainFromPrevious && scene.inputFramePath) firstFrame = scene.inputFramePath
  }

  const lastImage = sceneImagesByRole(scene.images, 'LAST')[0]
  const lastFrame = lastImage?.path ?? null
  const refImages = sceneImagesByRole(scene.images, 'REF').map((image) => image.path)

  const created = await prisma.$transaction(async (tx) => {
    const generation = await tx.generation.create({
      data: {
        projectId: filmId,
        sceneId: scene.id,
        type: modeToGenerationType(scene.mode),
        prompt: scene.prompt,
        negativePrompt: scene.negativePrompt,
        seed: scene.seed ?? -1,
        steps: 6,
        resolution: `${width}x${height}`,
        taskAdapter: modeToTaskAdapter(scene.mode),
        useAIEnhancement: false,
        status: 'PENDING',
        duration,
      },
    })

    const job = await tx.job.create({
      data: {
        kind: 'SCENE',
        targetId: scene.id,
        projectId: filmId,
        generationId: generation.id,
        status: 'QUEUED',
        progress: 0,
      },
    })

    await tx.scene.update({
      where: { id: scene.id },
      data: {
        status: 'QUEUED',
        error: null,
        inputFramePath: firstFrame,
      },
    })
    await tx.project.update({
      where: { id: filmId },
      data: { status: 'GENERATING' },
    })

    return { generation, job }
  })

  try {
    const remote = await enqueueScene({
      prompt: scene.prompt,
      mode: scene.mode,
      gguf: scene.gguf,
      duration,
      seed: scene.seed ?? -1,
      width,
      height,
      fps,
      ...(refImages.length > 0 ? { ref_images: refImages } : {}),
      ...(firstFrame ? { first_frame: firstFrame } : {}),
      ...(lastFrame ? { last_frame: lastFrame } : {}),
    })

    const job = await prisma.job.update({
      where: { id: created.job.id },
      data: { backendJobId: remote.job_id },
    })
    return { job: serializeJob(job), httpStatus: 201 }
  } catch (error) {
    const message = computeFailureMessage(error)
    const job = await markSceneEnqueueFailed(created.job.id, created.generation.id, scene.id, filmId, message)
    return { job: serializeJob(job), httpStatus: computeFailureStatus(error) }
  }
}

async function markSceneEnqueueFailed(
  jobId: string,
  generationId: string,
  sceneId: string,
  filmId: string,
  message: string
) {
  const [job] = await prisma.$transaction([
    prisma.job.update({
      where: { id: jobId },
      data: { status: 'FAILED', error: message, progress: 0 },
    }),
    prisma.generation.update({
      where: { id: generationId },
      data: { status: 'FAILED', error: message, completedAt: new Date() },
    }),
    prisma.scene.update({
      where: { id: sceneId },
      data: { status: 'FAILED', error: message },
    }),
    prisma.project.update({
      where: { id: filmId },
      data: { status: 'FAILED' },
    }),
  ])
  return job
}

const BACKEND_JOB_LOST = 'backend job lost'

export async function getJob(id: string): Promise<JobJson> {
  const job = await prisma.job.findUnique({ where: { id } })
  if (!job) throw new DbError('job not found', 404)

  if ((job.status === 'QUEUED' || job.status === 'RUNNING') && job.backendJobId) {
    try {
      const remote = await getComputeJob(job.backendJobId)
      await applyRemoteJob(job, remote)
    } catch (error) {
      // In-memory compute jobs disappear when FastAPI restarts.
      if (error instanceof ComputeRequestError && error.status === 404) {
        await markBackendJobLost(job)
      } else if (!(error instanceof ComputeConnectionError) && !(error instanceof ComputeRequestError)) {
        throw error
      }
    }
  }

  const fresh = await prisma.job.findUnique({ where: { id } })
  if (!fresh) throw new DbError('job not found', 404)
  return serializeJob(fresh)
}

async function markBackendJobLost(job: Job): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.job.update({
      where: { id: job.id },
      data: { status: 'FAILED', error: BACKEND_JOB_LOST },
    })

    if (job.kind === 'SCENE') {
      if (job.generationId) {
        const generation = await tx.generation.findUnique({ where: { id: job.generationId } })
        if (generation) {
          await tx.generation.update({
            where: { id: generation.id },
            data: { status: 'FAILED', error: BACKEND_JOB_LOST, completedAt: new Date() },
          })
        }
      }
      const scene = await tx.scene.findUnique({ where: { id: job.targetId } })
      if (scene) {
        await tx.scene.update({
          where: { id: scene.id },
          data: { status: 'FAILED', error: BACKEND_JOB_LOST },
        })
      }
      return
    }

    if (job.kind === 'EXPORT') {
      const render = await tx.finalRender.findUnique({ where: { id: job.targetId } })
      if (render) {
        await tx.finalRender.update({
          where: { id: render.id },
          data: { status: 'FAILED', error: BACKEND_JOB_LOST, completedAt: new Date() },
        })
      }
      if (job.projectId) {
        const film = await tx.project.findUnique({ where: { id: job.projectId } })
        if (film) {
          await tx.project.update({
            where: { id: film.id },
            data: { status: 'FAILED' },
          })
        }
      }
    }
  })
}

export async function applyRemoteJob(job: Job, remote: ComputeJobSnapshot): Promise<void> {
  const status = mapRemoteJobStatus(remote.status)
  const progress = clampProgress(remote.progress, status === 'DONE' ? 100 : job.progress)
  const error = typeof remote.error === 'string' && remote.error.trim() ? remote.error.trim() : null
  const video = storedOutputPath(remote.video_path, remote.video_url)
  const lastFrame = storedOutputPath(remote.last_frame_path, remote.last_frame_url)
  const output = storedOutputPath(remote.output_path, remote.output_url)
  const resultPath = job.kind === 'EXPORT' ? output : video
  const terminal = status === 'DONE' || status === 'FAILED'
  const missingOutput = status === 'DONE' && !resultPath
  const finalStatus = missingOutput ? 'FAILED' : status
  const finalError = missingOutput
    ? 'compute job finished without an output path'
    : finalStatus === 'FAILED'
      ? error ?? 'compute job failed'
      : null

  await prisma.$transaction(async (tx) => {
    await tx.job.update({
      where: { id: job.id },
      data: {
        status: finalStatus,
        progress: finalStatus === 'DONE' ? Math.max(progress, 100) : progress,
        error: finalError,
        ...(resultPath ? { resultPath } : {}),
      },
    })

    if (job.kind === 'SCENE') {
      await applySceneJob(tx, job, finalStatus, finalError, video, lastFrame, terminal || missingOutput)
    } else if (job.kind === 'EXPORT') {
      await applyExportJob(tx, job, finalStatus, finalError, output, terminal || missingOutput)
    }
  })
}

async function applySceneJob(
  tx: Prisma.TransactionClient,
  job: Job,
  status: string,
  error: string | null,
  video: string | null,
  lastFrame: string | null,
  terminal: boolean
) {
  if (job.generationId) {
    const generation = await tx.generation.findUnique({ where: { id: job.generationId } })
    if (generation) {
      await tx.generation.update({
        where: { id: generation.id },
        data: {
          status: generationStatusFor(status),
          error,
          ...(video ? { videoPath: video } : {}),
          ...(lastFrame ? { lastFramePath: lastFrame } : {}),
          ...(terminal ? { completedAt: new Date() } : {}),
        },
      })
    }
  }

  const scene = await tx.scene.findUnique({ where: { id: job.targetId } })
  if (scene) {
    await tx.scene.update({
      where: { id: scene.id },
      data: {
        status,
        error: status === 'FAILED' ? error : status === 'DONE' ? null : scene.error,
        ...(status === 'DONE' && video ? { clipPath: video } : {}),
        ...(lastFrame && (status === 'DONE' || status === 'RUNNING') ? { lastFramePath: lastFrame } : {}),
        ...(status === 'DONE' && job.generationId ? { currentGenerationId: job.generationId } : {}),
      },
    })
  }

  if (!job.projectId) return
  const film = await tx.project.findUnique({ where: { id: job.projectId } })
  if (!film) return
  if (film.status === 'ASSEMBLING' || film.status === 'DONE') return
  await tx.project.update({
    where: { id: film.id },
    data: { status: status === 'FAILED' ? 'FAILED' : 'GENERATING' },
  })
}

async function applyExportJob(
  tx: Prisma.TransactionClient,
  job: Job,
  status: string,
  error: string | null,
  output: string | null,
  terminal: boolean
) {
  const render = await tx.finalRender.findUnique({ where: { id: job.targetId } })
  if (render) {
    await tx.finalRender.update({
      where: { id: render.id },
      data: {
        status: renderStatusFor(status),
        error,
        ...(status === 'DONE' && output ? { outputPath: output } : {}),
        ...(terminal ? { completedAt: new Date() } : {}),
      },
    })
  }

  if (!job.projectId) return
  await tx.project.update({
    where: { id: job.projectId },
    data: {
      status: status === 'DONE' ? 'DONE' : status === 'FAILED' ? 'FAILED' : 'ASSEMBLING',
      ...(status === 'DONE' && output ? { finalPath: output } : {}),
    },
  })
}
