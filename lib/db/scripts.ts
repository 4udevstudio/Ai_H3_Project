import { prisma } from '@/lib/prisma'

import {
  computeFailureMessage,
  computeFailureStatus,
  scriptToScenes,
} from '@/lib/compute'

import {
  DEFAULT_DURATION_SEC,
  LIMITS,
  MAX_BREAKDOWN_DURATION,
  MAX_SCENES,
  MIN_BREAKDOWN_DURATION,
} from './constants'
import { requireFilm, sceneInclude } from './context'
import { MODES, type VideoMode } from './enums'
import { DbError } from './errors'
import { asRecord, readBoolean, readNumber, readString } from './parse'
import { serializeScene, serializeScript, type SceneJson, type ScriptJson } from './serializers'

const MODE_SET = new Set<string>(MODES)

export interface CreateScriptResult {
  script: ScriptJson
  scenes: SceneJson[]
  error: string | null
  httpStatus: number
}

function normalizeBreakdown(items: { prompt: string; mode: string; duration: number }[]) {
  const breakdown: { prompt: string; mode: VideoMode; duration: number }[] = []
  for (const item of items) {
    const prompt = item.prompt.trim().slice(0, LIMITS.prompt)
    if (!prompt) continue
    const mode = MODE_SET.has(item.mode.trim().toUpperCase())
      ? (item.mode.trim().toUpperCase() as VideoMode)
      : 'T2V'
    const duration = Number.isFinite(item.duration)
      ? Math.min(MAX_BREAKDOWN_DURATION, Math.max(MIN_BREAKDOWN_DURATION, item.duration))
      : DEFAULT_DURATION_SEC
    breakdown.push({ prompt, mode, duration })
  }
  return breakdown
}

export async function listScripts(filmId: string): Promise<ScriptJson[]> {
  await requireFilm(filmId)
  const scripts = await prisma.script.findMany({
    where: { projectId: filmId },
    orderBy: { createdAt: 'desc' },
  })
  return scripts.map(serializeScript)
}

/**
 * Store the script, ask the compute service to break it into scenes, and
 * optionally append Scene rows from that breakdown.
 */
export async function createScript(filmId: string, input: unknown): Promise<CreateScriptResult> {
  await requireFilm(filmId)
  const body = asRecord(input)
  const sourceText =
    readString(body, 'source_text', LIMITS.script, false) ??
    readString(body, 'script', LIMITS.script, false)
  if (!sourceText) throw new DbError('source_text is required', 400)

  const title = readString(body, 'title', LIMITS.title, false)
  const language = readString(body, 'language', LIMITS.language, false)
  const llmModel = readString(body, 'llm_model', LIMITS.llmModel, false)
  const maxScenes = readNumber(body, 'max_scenes', { min: 1, max: MAX_SCENES, integer: true })
  const createScenes = readBoolean(body, 'create_scenes') ?? false

  const script = await prisma.$transaction(async (tx) => {
    const created = await tx.script.create({
      data: {
        projectId: filmId,
        sourceText,
        status: 'BREAKING_DOWN',
        breakdown: '[]',
        ...(title !== undefined ? { title } : {}),
        ...(llmModel !== undefined ? { llmModel } : {}),
      },
    })
    await tx.project.update({ where: { id: filmId }, data: { script: sourceText } })
    return created
  })

  try {
    const remote = await scriptToScenes({
      script: sourceText,
      ...(maxScenes != null ? { max_scenes: maxScenes } : {}),
      ...(language ? { language } : {}),
    })
    const breakdown = normalizeBreakdown(remote)

    const saved = await prisma.$transaction(async (tx) => {
      const updated = await tx.script.update({
        where: { id: script.id },
        data: { status: 'DONE', breakdown: JSON.stringify(breakdown) },
      })

      if (createScenes && breakdown.length > 0) {
        const maxOrder = await tx.scene.aggregate({
          where: { projectId: filmId },
          _max: { order: true },
        })
        let order = (maxOrder._max.order ?? -1) + 1
        for (const item of breakdown) {
          await tx.scene.create({
            data: {
              projectId: filmId,
              scriptId: script.id,
              order,
              prompt: item.prompt,
              mode: item.mode,
              durationSec: item.duration,
              chainFromPrevious: true,
              status: 'DRAFT',
            },
          })
          order += 1
        }
      }

      return updated
    })

    const scenes = createScenes
      ? (
          await prisma.scene.findMany({
            where: { scriptId: script.id },
            orderBy: { order: 'asc' },
            include: sceneInclude,
          })
        ).map(serializeScene)
      : []

    return {
      script: serializeScript(saved),
      scenes,
      error: null,
      httpStatus: 201,
    }
  } catch (error) {
    const message = computeFailureMessage(error)
    const failed = await prisma.script.update({
      where: { id: script.id },
      data: { status: 'FAILED' },
    })
    return {
      script: serializeScript(failed),
      scenes: [],
      error: message,
      httpStatus: computeFailureStatus(error),
    }
  }
}
