import type { Job, Prisma } from '@prisma/client'

import {
  computeFailureMessage,
  computeFailureStatus,
  generateScene as enqueueScene,
  getComputeJob,
  type ComputeJobSnapshot,
  ComputeConnectionError,
  ComputeRequestError,
} from '@/lib/backend-server'
import { storedOutputPath } from '@/lib/files'
import { ownerWhere } from '@/lib/request-user'
import { prisma } from '@/lib/prisma'

import { DbError } from './errors'

import {
  DEFAULT_FPS,
  DEFAULT_HEIGHT,
  DEFAULT_WIDTH,
} from './constants'
import { requireFilm, requireScene, type Actor } from './context'
import {
  clampProgress,
  generationStatusFor,
  mapRemoteJobStatus,
  modeToGenerationType,
  modeToTaskAdapter,
  renderStatusFor,
} from './enums'
import { asRecord, readBoolean } from './parse'
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

const PREVIOUS_SCENE_FAILED = 'previous scene failed'

type SceneRun = {
  scene: Awaited<ReturnType<typeof requireScene>>
  width: number
  height: number
  fps: number
  duration: number
  firstFrame: string | null
  lastFrame: string | null
  refImages: string[]
}

async function prepareSceneRun(user: Actor, filmId: string, sceneId: string): Promise<SceneRun> {
  const scene = await requireScene(user, filmId, sceneId)
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
  return {
    scene,
    width,
    height,
    fps,
    duration,
    firstFrame,
    lastFrame: lastImage?.path ?? null,
    refImages: sceneImagesByRole(scene.images, 'REF').map((image) => image.path),
  }
}

/**
 * Create a Generation attempt and a Job, then enqueue /jobs/generate-scene.
 * When chain_from_previous is set, the previous scene's lastFramePath is
 * sent as first_frame.
 */
export async function generateScene(user: Actor, filmId: string, sceneId: string): Promise<GenerateSceneResult> {
  const run = await prepareSceneRun(user, filmId, sceneId)
  const { scene, width, height, fps, duration, firstFrame, lastFrame, refImages } = run

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
        userId: user?.id ?? null,
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
    }, user)

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

export async function getJob(user: Actor, id: string): Promise<JobJson> {
  const job = await prisma.job.findFirst({ where: { id, ...ownerWhere(user) } })
  if (!job) throw new DbError('job not found', 404)

  if (job.batchId) {
    await advanceBatch(user, job.batchId)
    const fresh = await prisma.job.findFirst({ where: { id, ...ownerWhere(user) } })
    if (!fresh) throw new DbError('job not found', 404)
    return serializeJob(fresh)
  }

  if ((job.status === 'QUEUED' || job.status === 'RUNNING') && job.backendJobId) {
    try {
      const remote = await getComputeJob(job.backendJobId, user)
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

async function failFollowingJobs(startNextId: string | null, message: string) {
  const seen = new Set<string>()
  let nextId = startNextId
  while (nextId && !seen.has(nextId)) {
    seen.add(nextId)
    const next = await prisma.job.findUnique({ where: { id: nextId } })
    if (!next) break
    if (next.status === 'QUEUED' || next.status === 'RUNNING') {
      await prisma.job.update({
        where: { id: next.id },
        data: { status: 'FAILED', error: message },
      })
      const scene = await prisma.scene.findUnique({ where: { id: next.targetId } })
      if (scene && scene.status !== 'DONE') {
        await prisma.scene.update({
          where: { id: scene.id },
          data: { status: 'FAILED', error: message },
        })
      }
    }
    nextId = next.nextJobId
  }
}

/** Start a QUEUED batch job that does not yet have a FastAPI id. */
export async function dispatchSceneJob(
  user: Actor,
  jobId: string
): Promise<{ ok: true } | { ok: false; message: string; httpStatus: number }> {
  const job = await prisma.job.findUnique({ where: { id: jobId } })
  if (!job || !job.projectId) return { ok: false, message: 'job not found', httpStatus: 404 }
  if (job.backendJobId) return { ok: true }

  const run = await prepareSceneRun(user, job.projectId, job.targetId)
  const { scene, width, height, fps, duration, firstFrame, lastFrame, refImages } = run

  const generation = job.generationId
    ? await prisma.generation.findUnique({ where: { id: job.generationId } })
    : await prisma.generation.create({
        data: {
          projectId: job.projectId,
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
  if (!generation) return { ok: false, message: 'generation not found', httpStatus: 404 }

  await prisma.$transaction([
    prisma.job.update({
      where: { id: job.id },
      data: { generationId: generation.id, status: 'QUEUED', error: null },
    }),
    prisma.scene.update({
      where: { id: scene.id },
      data: { status: 'QUEUED', error: null, inputFramePath: firstFrame },
    }),
    prisma.project.update({
      where: { id: job.projectId },
      data: { status: 'GENERATING' },
    }),
  ])

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
    }, user)
    await prisma.job.update({
      where: { id: job.id },
      data: { backendJobId: remote.job_id },
    })
    return { ok: true }
  } catch (error) {
    const message = computeFailureMessage(error)
    await markSceneEnqueueFailed(job.id, generation.id, scene.id, job.projectId, message)
    return { ok: false, message, httpStatus: computeFailureStatus(error) }
  }
}

/**
 * Poll the active job in a batch and start the next scene when it finishes.
 * Polling any job id in the batch runs this, so the client does not have to
 * poll the head. A failure marks every later QUEUED job FAILED with
 * "previous scene failed".
 */
export async function advanceBatch(user: Actor, batchId: string) {
  const members = await prisma.job.findMany({ where: { batchId } })
  if (members.length === 0) return
  const pointed = new Set(members.map((job) => job.nextJobId).filter((id): id is string => Boolean(id)))
  let cursor = members.find((job) => !pointed.has(job.id)) ?? members[0]
  for (let step = 0; step < members.length + 2; step += 1) {
    let job = await prisma.job.findUnique({ where: { id: cursor.id } })
    if (!job) return

    if ((job.status === 'QUEUED' || job.status === 'RUNNING') && job.backendJobId) {
      try {
        const remote = await getComputeJob(job.backendJobId, user)
        await applyRemoteJob(job, remote)
      } catch (error) {
        if (error instanceof ComputeRequestError && error.status === 404) {
          await markBackendJobLost(job)
          const failed = await prisma.job.findUnique({ where: { id: job.id } })
          await failFollowingJobs(failed?.nextJobId ?? null, PREVIOUS_SCENE_FAILED)
        }
        return
      }
      job = await prisma.job.findUnique({ where: { id: job.id } })
      if (!job) return
    }

    if (job.status === 'FAILED') {
      await failFollowingJobs(job.nextJobId, PREVIOUS_SCENE_FAILED)
      return
    }

    if (job.status === 'QUEUED' && !job.backendJobId) {
      const started = await dispatchSceneJob(user, job.id)
      if (!started.ok) {
        await failFollowingJobs(job.nextJobId, PREVIOUS_SCENE_FAILED)
        return
      }
      continue
    }

    if (job.status === 'DONE' && job.nextJobId) {
      const next = await prisma.job.findUnique({ where: { id: job.nextJobId } })
      if (!next) return
      cursor = next
      continue
    }

    return
  }
}

export async function generateAll(
  user: Actor,
  filmId: string,
  input: unknown
): Promise<{ job_ids: string[]; httpStatus: number }> {
  await requireFilm(user, filmId)
  const body = input === undefined || input === null ? {} : asRecord(input)
  const force = readBoolean(body, 'force') ?? false
  const rawIds = 'scene_ids' in body ? body.scene_ids : undefined
  if (rawIds !== undefined && (!Array.isArray(rawIds) || rawIds.some((id) => typeof id !== 'string' || !id.trim()))) {
    throw new DbError('scene_ids must be an array of scene id strings', 400)
  }

  const scenes = await prisma.scene.findMany({
    where: { projectId: filmId },
    orderBy: { order: 'asc' },
  })
  const byId = new Map(scenes.map((scene) => [scene.id, scene]))
  let selected = scenes
  if (Array.isArray(rawIds)) {
    const ids = rawIds.map((id) => id.trim())
    if (new Set(ids).size !== ids.length) throw new DbError('scene_ids contains duplicates', 400)
    selected = []
    for (const id of ids) {
      const scene = byId.get(id)
      if (!scene) throw new DbError('scene_ids must belong to this film', 400)
      selected.push(scene)
    }
  }
  if (!force) {
    selected = selected.filter((scene) => !(scene.status === 'DONE' && scene.clipPath))
  }
  if (selected.length === 0) throw new DbError('no scenes to generate', 400)

  const active = await prisma.job.findFirst({
    where: {
      projectId: filmId,
      batchId: { not: null },
      status: { in: ['QUEUED', 'RUNNING'] },
    },
  })
  if (active) throw new DbError('a batch is already running for this film', 409)

  const batchId = `batch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  const created = await prisma.$transaction(async (tx) => {
    const jobs = []
    for (const scene of selected) {
      const job = await tx.job.create({
        data: {
          kind: 'SCENE',
          targetId: scene.id,
          projectId: filmId,
          batchId,
          status: 'QUEUED',
          progress: 0,
          userId: user?.id ?? null,
        },
      })
      jobs.push(job)
      await tx.scene.update({
        where: { id: scene.id },
        data: { status: 'QUEUED', error: null },
      })
    }
    for (let index = 0; index < jobs.length - 1; index += 1) {
      await tx.job.update({
        where: { id: jobs[index].id },
        data: { nextJobId: jobs[index + 1].id },
      })
    }
    await tx.project.update({ where: { id: filmId }, data: { status: 'GENERATING' } })
    return jobs
  })

  const started = await dispatchSceneJob(user, created[0].id)
  if (!started.ok) {
    const head = await prisma.job.findUnique({ where: { id: created[0].id } })
    await failFollowingJobs(head?.nextJobId ?? created[1]?.id ?? null, PREVIOUS_SCENE_FAILED)
    return { job_ids: created.map((job) => job.id), httpStatus: started.httpStatus }
  }

  return { job_ids: created.map((job) => job.id), httpStatus: 201 }
}

export async function listFilmJobs(user: Actor, filmId: string): Promise<JobJson[]> {
  await requireFilm(user, filmId)
  const active = await prisma.job.findFirst({
    where: {
      projectId: filmId,
      batchId: { not: null },
      status: { in: ['QUEUED', 'RUNNING'] },
      ...ownerWhere(user),
    },
    orderBy: { createdAt: 'desc' },
  })
  if (active?.batchId) await advanceBatch(user, active.batchId)
  const jobs = await prisma.job.findMany({
    where: { projectId: filmId, ...ownerWhere(user) },
    orderBy: { createdAt: 'desc' },
  })
  return jobs.map(serializeJob)
}
