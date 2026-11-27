/**
 * The only server-side client for the stateless FastAPI compute service.
 *
 * Requests use BACKEND_URL (default http://127.0.0.1:8000).
 * When INTERNAL_API_SECRET is set, every call sends X-Internal-Secret.
 * When an acting user is passed, the call also sends X-User-Id.
 * Browser media URLs are built separately in lib/files.ts.
 */

export type BackendUser = { id: string } | null | undefined

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

function withBackendHeaders(init: RequestInit | undefined, user: BackendUser): RequestInit {
  const headers = new Headers(init?.headers)
  const secret = (process.env.INTERNAL_API_SECRET ?? '').trim()
  if (secret) headers.set('X-Internal-Secret', secret)
  if (user?.id) headers.set('X-User-Id', user.id)
  return { ...init, headers }
}

async function computeFetch<T>(
  path: string,
  init: RequestInit | undefined,
  timeoutMs: number,
  user?: BackendUser
): Promise<T> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  const url = `${computeBaseUrl()}${path}`

  try {
    const response = await fetch(url, {
      ...withBackendHeaders(init, user),
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

export async function scriptToScenes(
  input: ScriptToScenesInput,
  user?: BackendUser
): Promise<BreakdownScene[]> {
  const data = await computeFetch<{ scenes?: unknown }>(
    '/jobs/script-to-scenes',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(stripEmpty({ ...input })),
    },
    SCRIPT_TO_SCENES_TIMEOUT_MS,
    user
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

export async function generateScene(
  input: GenerateSceneInput,
  user?: BackendUser
): Promise<{ job_id: string }> {
  const data = await computeFetch<{ job_id?: unknown }>(
    '/jobs/generate-scene',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(stripEmpty({ ...input })),
    },
    30_000,
    user
  )
  if (typeof data.job_id !== 'string' || !data.job_id.trim()) {
    throw new ComputeRequestError('Compute service response is missing job_id', 502)
  }
  return { job_id: data.job_id.trim() }
}

export async function exportFilm(input: ExportInput, user?: BackendUser): Promise<{ job_id: string }> {
  const data = await computeFetch<{ job_id?: unknown }>(
    '/jobs/export',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(stripEmpty({ ...input })),
    },
    30_000,
    user
  )
  if (typeof data.job_id !== 'string' || !data.job_id.trim()) {
    throw new ComputeRequestError('Compute service response is missing job_id', 502)
  }
  return { job_id: data.job_id.trim() }
}

export async function getComputeJob(id: string, user?: BackendUser): Promise<ComputeJobSnapshot> {
  return computeFetch<ComputeJobSnapshot>(
    `/jobs/${encodeURIComponent(id)}`,
    { method: 'GET' },
    15_000,
    user
  )
}

export interface UploadedReference {
  path: string
  type: string
  stored_filename: string | null
}

/**
 * POST /api/uploads/reference (PR #1). Field name is `file`.
 * Response uploaded[0] has stored_path, stored_filename, and type.
 * Callers fall back to outputs/references when this route is missing or down.
 */
export async function uploadReference(file: File, user?: BackendUser): Promise<UploadedReference> {
  const body = new FormData()
  body.append('file', file, file.name || 'reference')
  const data = await computeFetch<{ uploaded?: Array<Record<string, unknown>> }>(
    '/api/uploads/reference',
    { method: 'POST', body },
    120_000,
    user
  )
  const item = Array.isArray(data.uploaded) ? data.uploaded[0] : undefined
  const storedPath = item && typeof item.stored_path === 'string' ? item.stored_path.trim() : ''
  const storedFilename = item && typeof item.stored_filename === 'string' ? item.stored_filename.trim() : ''
  const type = item && typeof item.type === 'string' && item.type.trim() ? item.type.trim() : 'IMAGE'
  const path = storedPath || storedFilename
  if (!path) throw new ComputeRequestError('reference upload response is missing a stored path', 502)
  return { path, type, stored_filename: storedFilename || null }
}

export async function uploadAudio(file: File, user?: BackendUser): Promise<{ audio_path: string }> {
  const body = new FormData()
  body.append('file', file, file.name || 'audio.wav')
  const data = await computeFetch<{ audio_path?: unknown }>(
    '/jobs/upload-audio',
    { method: 'POST', body },
    120_000,
    user
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
