/**
 * ========================================
 * Film project contract types
 * ========================================
 * รูปแบบที่เบราว์เซอร์ใช้คุยกับ Next.js /api/* (snake_case)
 * id เป็นสตริงทึบ (cuid) — ฝั่ง UI ไม่ตีความโครงสร้างของ id
 */

export type SceneMode = 'T2V' | 'REF2VA' | 'FL2VA'

export type ImageRole = 'ref' | 'first' | 'last'

export type SceneStatus = 'draft' | 'queued' | 'running' | 'done' | 'failed'

export type FilmStatus = 'draft' | 'generating' | 'assembling' | 'done' | 'failed'

export type JobStatus = 'queued' | 'running' | 'done' | 'failed'

export type FilmTransition = 'none' | 'crossfade'

export interface SceneImage {
  id: string
  scene_id: string
  /** absolute media URL, or null when the stored path is not a public outputs file */
  url: string | null
  role: ImageRole
  order: number
}

export interface Scene {
  id: string
  film_id: string
  /** ลำดับในเรื่อง เริ่มที่ 0 */
  order: number
  prompt: string
  mode: SceneMode
  gguf: boolean
  duration_sec: number
  seed: number | null
  /** ใช้เฟรมท้ายของฉากก่อนเป็นเฟรมแรก ค่าเริ่มต้น true */
  chain_from_previous: boolean
  images: SceneImage[]
  status: SceneStatus
  clip_url?: string | null
  error?: string | null
  created_at?: string
  updated_at: string
}

export interface Film {
  id: string
  title: string
  script?: string | null
  /**
   * รายการจาก GET /api/films ไม่แนบฉาก
   * ตัวแก้ไขโหลดจาก GET /api/films/{id}/scenes แล้วใส่ให้
   */
  scenes?: Scene[]
  width: number
  height: number
  fps: number
  transition: FilmTransition
  /** วินาที 0–5 */
  transition_duration: number
  audio_url?: string | null
  final_url?: string | null
  status: FilmStatus
  created_at?: string
  updated_at?: string
}

export type JobKind = 'scene' | 'export'

export interface Job {
  id: string
  kind: JobKind
  target_id: string
  status: JobStatus
  /** 0–100 */
  progress: number
  error?: string | null
  /** คลิปของฉาก หรือ MP4 ที่รวมแล้ว ใช้ตามที่ API ให้มา */
  result_url?: string | null
}

/** ฉากร่างจาก script-to-scenes ยังไม่ถูกบันทึก */
export interface ScriptDraft {
  prompt: string
  mode: SceneMode
  duration: number
}

export interface ScenePatch {
  prompt?: string
  mode?: SceneMode
  gguf?: boolean
  duration_sec?: number
  seed?: number | null
  chain_from_previous?: boolean
}

export interface CreateSceneInput extends ScenePatch {
  /** แทรกที่ลำดับนี้ ถ้าไม่ส่งจะต่อท้าย */
  order?: number
}

export interface FilmPatch {
  title?: string
  script?: string | null
  transition?: FilmTransition
  transition_duration?: number
  /** 0–2 บันทึกได้ แต่ Film JSON ไม่ส่งค่านี้กลับ */
  audio_volume?: number
}

export interface SceneImageInput {
  path: string
  role?: ImageRole
  order?: number
  type?: 'IMAGE'
}

export interface AssemblyPatch {
  transition: FilmTransition
  transition_duration: number
}

export const SCENE_MODES: SceneMode[] = ['T2V', 'REF2VA', 'FL2VA']
export const IMAGE_ROLES: ImageRole[] = ['ref', 'first', 'last']
export const SCENE_STATUSES: SceneStatus[] = ['draft', 'queued', 'running', 'done', 'failed']
export const FILM_STATUSES: FilmStatus[] = ['draft', 'generating', 'assembling', 'done', 'failed']
export const JOB_STATUSES: JobStatus[] = ['queued', 'running', 'done', 'failed']
export const FILM_TRANSITIONS: FilmTransition[] = ['none', 'crossfade']

export const DEFAULT_FILM_WIDTH = 960
export const DEFAULT_FILM_HEIGHT = 544
export const DEFAULT_FILM_FPS = 24
export const DEFAULT_SCENE_DURATION_SEC = 5
/** ช่องความยาวใน UI และฉากจากสคริปต์ — งาน generate ใช้ช่วงนี้ */
export const MIN_UI_DURATION_SEC = 5
export const MAX_UI_DURATION_SEC = 15
export const MAX_SCRIPT_SCENES = 24
export const DEFAULT_SCRIPT_SCENES = 8
export const MAX_TRANSITION_DURATION_SEC = 5
export const MAX_AUDIO_VOLUME = 2

export const JOB_KINDS = ['scene', 'export'] as const

export function clampUiDuration(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SCENE_DURATION_SEC
  return Math.min(MAX_UI_DURATION_SEC, Math.max(MIN_UI_DURATION_SEC, value))
}

/** ดึง path แบบ outputs-relative จาก URL สื่อที่ API ส่งมา เพื่อคัดลอกรูป */
export function mediaPathFromUrl(url: string | null | undefined): string | null {
  if (!url) return null
  if (url.startsWith('data:')) return url

  try {
    const pathname = new URL(url, 'http://local').pathname
    const marker = '/api/media/'
    const at = pathname.indexOf(marker)
    if (at < 0) return null
    const [kind, filename] = pathname.slice(at + marker.length).split('/')
    if (!kind || !filename) return null
    return `${kind}/${decodeURIComponent(filename)}`
  } catch {
    return null
  }
}

const MODE_LABELS: Record<SceneMode, string> = {
  T2V: 'T2V · ข้อความ',
  REF2VA: 'REF2VA · รูปอ้างอิง',
  FL2VA: 'FL2VA · เฟรมแรก–ท้าย',
}

export function sceneModeLabel(mode: SceneMode): string {
  return MODE_LABELS[mode]
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object') return value as Record<string, unknown>
  return {}
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  if (typeof value !== 'string') return fallback
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback
}

function normalizeSeed(value: unknown): number | null {
  if (value == null || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return null
  return Math.trunc(parsed)
}

function normalizeImage(value: unknown): SceneImage {
  const raw = asRecord(value)
  const order = Number(raw.order ?? 0)

  return {
    id: String(raw.id ?? ''),
    scene_id: String(raw.scene_id ?? ''),
    url: typeof raw.url === 'string' && raw.url.trim() ? raw.url : null,
    role: oneOf(raw.role, IMAGE_ROLES, 'ref'),
    order: Number.isFinite(order) ? order : 0,
  }
}

export function normalizeScene(value: unknown): Scene {
  const raw = asRecord(value)
  const modeRaw = typeof raw.mode === 'string' ? raw.mode.toUpperCase() : raw.mode
  const duration = Number(raw.duration_sec ?? DEFAULT_SCENE_DURATION_SEC)

  return {
    id: String(raw.id ?? ''),
    film_id: String(raw.film_id ?? ''),
    order: Number.isFinite(Number(raw.order)) ? Number(raw.order) : 0,
    prompt: typeof raw.prompt === 'string' ? raw.prompt : '',
    mode: oneOf(modeRaw, SCENE_MODES, 'T2V'),
    gguf: Boolean(raw.gguf),
    duration_sec: Number.isFinite(duration) && duration > 0 ? duration : DEFAULT_SCENE_DURATION_SEC,
    seed: normalizeSeed(raw.seed),
    chain_from_previous: raw.chain_from_previous == null ? true : Boolean(raw.chain_from_previous),
    images: Array.isArray(raw.images) ? raw.images.map(normalizeImage) : [],
    status: oneOf(raw.status, SCENE_STATUSES, 'draft'),
    clip_url: typeof raw.clip_url === 'string' && raw.clip_url.trim() ? raw.clip_url : null,
    error: typeof raw.error === 'string' && raw.error.trim() ? raw.error : null,
    created_at: typeof raw.created_at === 'string' ? raw.created_at : undefined,
    updated_at: typeof raw.updated_at === 'string' ? raw.updated_at : new Date(0).toISOString(),
  }
}

export function normalizeFilm(value: unknown): Film {
  const raw = asRecord(value)
  const width = Number(raw.width ?? DEFAULT_FILM_WIDTH)
  const height = Number(raw.height ?? DEFAULT_FILM_HEIGHT)
  const fps = Number(raw.fps ?? DEFAULT_FILM_FPS)
  const transitionDuration = Number(raw.transition_duration ?? 0.5)
  const scenes = Array.isArray(raw.scenes)
    ? raw.scenes.map(normalizeScene).sort((a, b) => a.order - b.order)
    : undefined

  return {
    id: String(raw.id ?? ''),
    title: typeof raw.title === 'string' ? raw.title : 'ไม่มีชื่อ',
    script: typeof raw.script === 'string' ? raw.script : null,
    scenes,
    width: Number.isFinite(width) && width > 0 ? width : DEFAULT_FILM_WIDTH,
    height: Number.isFinite(height) && height > 0 ? height : DEFAULT_FILM_HEIGHT,
    fps: Number.isFinite(fps) && fps > 0 ? fps : DEFAULT_FILM_FPS,
    transition: oneOf(raw.transition, FILM_TRANSITIONS, 'none'),
    transition_duration: Number.isFinite(transitionDuration) && transitionDuration >= 0 ? transitionDuration : 0.5,
    audio_url: typeof raw.audio_url === 'string' && raw.audio_url.trim() ? raw.audio_url : null,
    final_url: typeof raw.final_url === 'string' && raw.final_url.trim() ? raw.final_url : null,
    status: oneOf(raw.status, FILM_STATUSES, 'draft'),
    created_at: typeof raw.created_at === 'string' ? raw.created_at : undefined,
    updated_at: typeof raw.updated_at === 'string' ? raw.updated_at : undefined,
  }
}

export function normalizeFilmList(value: unknown): Film[] {
  if (Array.isArray(value)) return value.map(normalizeFilm)

  const wrapped = asRecord(value)
  if (Array.isArray(wrapped.films)) return wrapped.films.map(normalizeFilm)

  return []
}

export function normalizeJob(value: unknown): Job {
  const raw = asRecord(value)
  const progress = Math.round(Number(raw.progress ?? 0))

  return {
    id: String(raw.id ?? ''),
    kind: oneOf(raw.kind, JOB_KINDS, 'scene'),
    target_id: String(raw.target_id ?? ''),
    status: oneOf(raw.status, JOB_STATUSES, 'queued'),
    progress: Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : 0,
    error: typeof raw.error === 'string' && raw.error.trim() ? raw.error : null,
    result_url: typeof raw.result_url === 'string' && raw.result_url.trim() ? raw.result_url : null,
  }
}

export function normalizeSceneList(value: unknown): Scene[] {
  if (Array.isArray(value)) return value.map(normalizeScene).sort((a, b) => a.order - b.order)
  const wrapped = asRecord(value)
  if (Array.isArray(wrapped.scenes)) {
    return wrapped.scenes.map(normalizeScene).sort((a, b) => a.order - b.order)
  }
  return []
}

export function normalizeScriptDrafts(value: unknown): ScriptDraft[] {
  const raw = asRecord(value)
  const list = Array.isArray(value)
    ? value
    : Array.isArray(raw.scenes)
      ? raw.scenes
      : []

  return list.map((item) => {
    const draft = asRecord(item)
    const modeRaw = typeof draft.mode === 'string' ? draft.mode.toUpperCase() : draft.mode
    const duration = Number(draft.duration ?? draft.duration_sec ?? DEFAULT_SCENE_DURATION_SEC)

    return {
      prompt: typeof draft.prompt === 'string' ? draft.prompt : '',
      mode: oneOf(modeRaw, SCENE_MODES, 'T2V'),
      duration: clampUiDuration(duration),
    }
  })
}

export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const minutes = Math.floor(total / 60)
  const remain = total % 60
  return `${minutes}:${remain.toString().padStart(2, '0')}`
}
