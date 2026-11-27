/**
 * Typed client for the stateless FastAPI compute service (feature/backend).
 *
 * Next.js owns SQLite. These calls only enqueue work, split a script, or
 * upload audio. Server-side requests use BACKEND_URL (default
 * http://127.0.0.1:8000). Browser media URLs are built separately.
 */

const DEFAULT_COMPUTE_URL = 'http://127.0.0.1:8000'

/** script-to-scenes talks to ComfyUI Gemma and can take several minutes. */
export const SCRIPT_TO_SCENES_TIMEOUT_MS = 300_000

export class ComputeConnectionError extends Error {
  readonly unreachable = true

  constructor(message: string) {
    super(message)
    this.name = 'ComputeConnectionError'
  }
}

export class ComputeRequestError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ComputeRequestError'
    this.status = status
  }
}

export interface BreakdownScene {
  prompt: string
  mode: string
  duration: number
}

export interface ScriptToScenesInput {
  script: string
  max_scenes?: number
  language?: string
}

export interface GenerateSceneInput {
  prompt: string
  mode: string
  gguf: boolean
  duration: number
  seed: number
  width?: number
  height?: number
  fps?: number
  ref_images?: string[]
  first_frame?: string
  last_frame?: string
}

export interface ExportClipInput {
  path: string
  order: number
  transition: 'none' | 'crossfade'
  transition_duration: number
}

export interface ExportInput {
  clips: ExportClipInput[]
  audio_path?: string
  audio_volume?: number
  width?: number
  height?: number
  fps?: number
}

export interface ComputeJobSnapshot {
  status: string
  progress?: number
  error?: string | null
  video_path?: string | null
  video_url?: string | null
  last_frame_path?: string | null
  last_frame_url?: string | null
  output_path?: string | null
  output_url?: string | null
}

export function computeBaseUrl(): string {
  const fromEnv = (process.env.BACKEND_URL ?? '').trim()
  if (fromEnv) return fromEnv.replace(/\/+$/, '')
  return DEFAULT_COMPUTE_URL
}

function stripEmpty<T extends Record<string, unknown>>(body: T): T {
  const next = {} as T
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined) continue
    next[key as keyof T] = value as T[keyof T]
  }
  return next
}

function errorMessage(data: { detail?: unknown; error?: unknown }, fallback: string): string {
  if (typeof data.error === 'string' && data.error.trim()) return data.error.trim()
  if (typeof data.detail === 'string' && data.detail.trim()) return data.detail.trim()
  if (Array.isArray(data.detail)) {
    const text = data.detail
      .map((item) => {
        if (item && typeof item === 'object' && 'msg' in item) return String(item.msg)
        return ''
      })
      .filter(Boolean)
      .join(', ')
    if (text) return text
  }
  return fallback
}

async function computeFetch<T>(path: string, init: RequestInit | undefined, timeoutMs: number): Promise<T> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  const url = `${computeBaseUrl()}${path}`

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      cache: 'no-store',
    })

    if (!response.ok) {
      let message = `Compute service responded HTTP ${response.status}`
      try {
        const data = (await response.json()) as { detail?: unknown; error?: unknown }
        message = errorMessage(data, message)
      } catch {
        // non-JSON error body
      }
      throw new ComputeRequestError(message, response.status)
    }

    try {
      return (await response.json()) as T
    } catch {
      throw new ComputeRequestError('Compute service returned a non-JSON body', response.status)
    }
  } catch (error) {
    if (error instanceof ComputeRequestError || error instanceof ComputeConnectionError) throw error
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ComputeConnectionError(
        `Compute service did not respond within ${Math.round(timeoutMs / 1000)}s`
      )
    }
    throw new ComputeConnectionError('Compute service is unreachable')
  } finally {
    clearTimeout(timeoutId)
  }
}

export async function scriptToScenes(input: ScriptToScenesInput): Promise<BreakdownScene[]> {
  const data = await computeFetch<{ scenes?: unknown }>(
    '/jobs/script-to-scenes',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(stripEmpty({ ...input })),
    },
    SCRIPT_TO_SCENES_TIMEOUT_MS
  )

  if (!Array.isArray(data.scenes)) {
    throw new ComputeRequestError('Compute service response is missing scenes', 502)
  }

  return data.scenes.map((item) => {
    const record = item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
    return {
      prompt: typeof record.prompt === 'string' ? record.prompt : '',
      mode: typeof record.mode === 'string' ? record.mode : 'T2V',
      duration: typeof record.duration === 'number' ? record.duration : Number(record.duration ?? 5),
    }
  })
}

export async function generateScene(input: GenerateSceneInput): Promise<{ job_id: string }> {
  const data = await computeFetch<{ job_id?: unknown }>(
    '/jobs/generate-scene',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(stripEmpty({ ...input })),
    },
    30_000
  )
  if (typeof data.job_id !== 'string' || !data.job_id.trim()) {
    throw new ComputeRequestError('Compute service response is missing job_id', 502)
  }
  return { job_id: data.job_id.trim() }
}

export async function exportFilm(input: ExportInput): Promise<{ job_id: string }> {
  const data = await computeFetch<{ job_id?: unknown }>(
    '/jobs/export',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(stripEmpty({ ...input })),
    },
    30_000
  )
  if (typeof data.job_id !== 'string' || !data.job_id.trim()) {
    throw new ComputeRequestError('Compute service response is missing job_id', 502)
  }
  return { job_id: data.job_id.trim() }
}

export async function getComputeJob(id: string): Promise<ComputeJobSnapshot> {
  return computeFetch<ComputeJobSnapshot>(`/jobs/${encodeURIComponent(id)}`, { method: 'GET' }, 15_000)
}

export async function uploadAudio(file: File): Promise<{ audio_path: string }> {
  const body = new FormData()
  body.append('file', file, file.name || 'audio.wav')
  const data = await computeFetch<{ audio_path?: unknown }>(
    '/jobs/upload-audio',
    { method: 'POST', body },
    120_000
  )
  if (typeof data.audio_path !== 'string' || !data.audio_path.trim()) {
    throw new ComputeRequestError('Compute service response is missing audio_path', 502)
  }
  return { audio_path: data.audio_path.trim() }
}

export function computeFailureStatus(error: unknown): number {
  if (error instanceof ComputeConnectionError) return 503
  if (error instanceof ComputeRequestError) {
    if (error.status === 400 || error.status === 404 || error.status === 503) return error.status
    if (error.status >= 500) return 502
    return error.status
  }
  return 502
}

export function computeFailureMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return 'Compute service request failed'
}
