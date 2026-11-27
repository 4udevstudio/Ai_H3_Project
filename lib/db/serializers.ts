import type {
  FinalRender,
  FinalRenderClip,
  Job,
  Project,
  Reference,
  Scene,
  Script,
} from '@prisma/client'

import { toPublicUrl } from '@/lib/files'

import { toJsonToken } from './enums'

export interface FilmJson {
  id: string
  title: string
  script: string | null
  transition: string
  transition_duration: number
  width: number
  height: number
  fps: number
  audio_url: string | null
  final_url: string | null
  status: string
  created_at: string
  updated_at: string
}

export interface SceneImageJson {
  id: string
  scene_id: string
  url: string | null
  role: string
  order: number
}

export interface SceneJson {
  id: string
  film_id: string
  order: number
  prompt: string
  mode: string
  gguf: boolean
  duration_sec: number
  seed: number | null
  chain_from_previous: boolean
  status: string
  clip_url: string | null
  error: string | null
  images: SceneImageJson[]
  created_at: string
  updated_at: string
}

export interface JobJson {
  id: string
  kind: string
  target_id: string
  status: string
  progress: number
  error: string | null
  result_url: string | null
}

export interface BreakdownJson {
  prompt: string
  mode: string
  duration: number
}

export interface ScriptJson {
  id: string
  film_id: string
  title: string | null
  source_text: string
  breakdown: BreakdownJson[]
  llm_model: string | null
  status: string
  created_at: string
  updated_at: string
}

export interface FinalRenderClipJson {
  id: string
  scene_id: string
  generation_id: string | null
  order: number
  transition: string
  transition_duration: number
}

export interface FinalRenderJson {
  id: string
  film_id: string
  status: string
  audio_url: string | null
  audio_volume: number
  width: number
  height: number
  fps: number
  output_url: string | null
  duration: number | null
  error: string | null
  job_id: string | null
  created_at: string
  completed_at: string | null
  clips: FinalRenderClipJson[]
}

function iso(value: Date | null | undefined): string | null {
  if (!value) return null
  return value.toISOString()
}

export function serializeFilm(project: Project): FilmJson {
  return {
    id: project.id,
    title: project.name,
    script: project.script ?? null,
    transition: toJsonToken(project.transitionType, 'none'),
    transition_duration: project.transitionDuration,
    width: project.width,
    height: project.height,
    fps: project.fps,
    audio_url: toPublicUrl(project.audioPath),
    final_url: toPublicUrl(project.finalPath),
    status: toJsonToken(project.status, 'draft'),
    created_at: project.createdAt.toISOString(),
    updated_at: project.updatedAt.toISOString(),
  }
}

export function serializeSceneImage(image: Reference): SceneImageJson {
  return {
    id: image.id,
    scene_id: image.sceneId ?? '',
    url: toPublicUrl(image.path),
    role: toJsonToken(image.role, 'ref'),
    order: image.order,
  }
}

export function serializeScene(scene: Scene & { images?: Reference[] }): SceneJson {
  const images = [...(scene.images ?? [])].sort((a, b) => a.order - b.order)
  return {
    id: scene.id,
    film_id: scene.projectId,
    order: scene.order,
    prompt: scene.prompt,
    mode: scene.mode,
    gguf: scene.gguf,
    duration_sec: scene.durationSec,
    seed: scene.seed ?? null,
    chain_from_previous: scene.chainFromPrevious,
    status: toJsonToken(scene.status, 'draft'),
    clip_url: toPublicUrl(scene.clipPath),
    error: scene.error ?? null,
    images: images.map(serializeSceneImage),
    created_at: scene.createdAt.toISOString(),
    updated_at: scene.updatedAt.toISOString(),
  }
}

export function serializeJob(job: Job): JobJson {
  return {
    id: job.id,
    kind: toJsonToken(job.kind, 'scene'),
    target_id: job.targetId,
    status: toJsonToken(job.status, 'queued'),
    progress: job.progress,
    error: job.error ?? null,
    result_url: toPublicUrl(job.resultPath),
  }
}

export function parseBreakdown(raw: string | null | undefined): BreakdownJson[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    const items: BreakdownJson[] = []
    for (const entry of parsed) {
      if (!entry || typeof entry !== 'object') continue
      const record = entry as Record<string, unknown>
      const prompt = typeof record.prompt === 'string' ? record.prompt : ''
      if (!prompt.trim()) continue
      const mode = typeof record.mode === 'string' && record.mode.trim()
        ? record.mode.trim().toUpperCase()
        : 'T2V'
      const durationValue = typeof record.duration === 'number' ? record.duration : Number(record.duration)
      items.push({
        prompt,
        mode,
        duration: Number.isFinite(durationValue) ? durationValue : 5,
      })
    }
    return items
  } catch {
    return []
  }
}

export function serializeScript(script: Script): ScriptJson {
  return {
    id: script.id,
    film_id: script.projectId,
    title: script.title ?? null,
    source_text: script.sourceText,
    breakdown: parseBreakdown(script.breakdown),
    llm_model: script.llmModel ?? null,
    status: toJsonToken(script.status, 'draft'),
    created_at: script.createdAt.toISOString(),
    updated_at: script.updatedAt.toISOString(),
  }
}

export function serializeRender(
  render: FinalRender & { clips?: FinalRenderClip[] }
): FinalRenderJson {
  const clips = [...(render.clips ?? [])].sort((a, b) => a.order - b.order)
  return {
    id: render.id,
    film_id: render.projectId,
    status: toJsonToken(render.status, 'pending'),
    audio_url: toPublicUrl(render.audioPath),
    audio_volume: render.audioVolume,
    width: render.width,
    height: render.height,
    fps: render.fps,
    output_url: toPublicUrl(render.outputPath),
    duration: render.duration ?? null,
    error: render.error ?? null,
    job_id: render.jobId ?? null,
    created_at: render.createdAt.toISOString(),
    completed_at: iso(render.completedAt),
    clips: clips.map((clip) => ({
      id: clip.id,
      scene_id: clip.sceneId,
      generation_id: clip.generationId ?? null,
      order: clip.order,
      transition: toJsonToken(clip.transitionType, 'none'),
      transition_duration: clip.transitionDuration,
    })),
  }
}
