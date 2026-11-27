/**
 * ========================================
 * Films API client
 * ========================================
 * เบราว์เซอร์เรียก same-origin `/api/*` เท่านั้น
 * สัญญาตาม docs/DATABASE.md บนสาขา feature/database (PR #2)
 * และงานคำนวณใน feature/backend (PR #1)
 *
 * URL สื่อเป็น absolute อยู่แล้ว — ใช้ตรง ๆ ไม่เติม host
 *
 * Mock (ปิดเป็นค่าเริ่มต้น):
 *   NEXT_PUBLIC_FILMS_API_MOCK=1
 */

import { FilmsApiError, jobLimitMessage } from '@/lib/films-error'
import {
  normalizeFilm,
  normalizeFilmList,
  normalizeJob,
  normalizeScene,
  normalizeSceneList,
  normalizeScriptDrafts,
  type CreateSceneInput,
  type Film,
  type FilmPatch,
  type ImageRole,
  type Job,
  type Scene,
  type SceneImage,
  type SceneImageInput,
  type ScenePatch,
  type ScriptDraft,
} from '@/lib/films-types'

export { FilmsApiError } from '@/lib/films-error'

/** เปิดเฉพาะตอนตั้ง env ตอน build/dev — ค่าเริ่มต้นปิด */
export const FILMS_API_MOCK_ENABLED = process.env.NEXT_PUBLIC_FILMS_API_MOCK === '1'

const JSON_HEADERS = {
  Accept: 'application/json',
  'Content-Type': 'application/json',
}

const SCRIPT_TIMEOUT_MS = 300000

async function requestJson<T>(path: string, init?: RequestInit, timeoutMs = 30000): Promise<T> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(path, {
      ...init,
      cache: 'no-store',
      signal: controller.signal,
    })

    if (!response.ok) {
      throw await toApiError(response)
    }

    if (response.status === 204) return undefined as T

    const text = await response.text()
    if (!text.trim()) return undefined as T

    return JSON.parse(text) as T
  } catch (error) {
    if (error instanceof FilmsApiError) throw error

    if (error instanceof Error && error.name === 'AbortError') {
      throw new FilmsApiError(0, 'คำขอหมดเวลา')
    }

    throw new FilmsApiError(0, error instanceof Error ? error.message : 'เชื่อมต่อไม่สำเร็จ')
  } finally {
    clearTimeout(timeoutId)
  }
}

function redirectToLogin(): void {
  if (typeof window === 'undefined') return
  if (window.location.pathname === '/login') return
  const next = `${window.location.pathname}${window.location.search}`
  window.dispatchEvent(new CustomEvent('h3-login-required', { detail: next }))
}

async function toApiError(response: Response): Promise<FilmsApiError> {
  let message = `คำขอไม่สำเร็จ (HTTP ${response.status})`
  let code = ''
  let active = Number.NaN
  let limit = Number.NaN

  try {
    const data = (await response.json()) as {
      error?: unknown
      detail?: unknown
      active?: unknown
      limit?: unknown
    }
    if (typeof data.error === 'string' && data.error.trim()) {
      code = data.error.trim()
      message = code
    } else if (typeof data.detail === 'string' && data.detail.trim()) {
      message = data.detail
    }
    active = Number(data.active)
    limit = Number(data.limit)
  } catch {
    // body ไม่ใช่ JSON
  }

  if (response.status === 401) {
    redirectToLogin()
    return new FilmsApiError(401, 'กรุณาเข้าสู่ระบบ')
  }

  if (response.status === 429 && code === 'job_limit') {
    return new FilmsApiError(429, jobLimitMessage(active, limit))
  }

  return new FilmsApiError(response.status, message)
}

async function mockCall<T>(
  run: (mod: typeof import('./films-mock')) => Promise<T> | T
): Promise<T> {
  const mod = await import('./films-mock')
  return run(mod)
}

function filmPath(filmId: string, suffix = ''): string {
  return `/api/films/${encodeURIComponent(filmId)}${suffix}`
}

function scenePath(filmId: string, sceneId: string, suffix = ''): string {
  return `${filmPath(filmId, '/scenes/')}${encodeURIComponent(sceneId)}${suffix}`
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object') return value as Record<string, unknown>
  return {}
}

export async function listFilms(): Promise<Film[]> {
  const data = FILMS_API_MOCK_ENABLED
    ? await mockCall((mod) => mod.mockListFilms())
    : await requestJson<unknown>('/api/films')

  return normalizeFilmList(data)
}

export async function createFilm(title: string): Promise<Film> {
  const data = FILMS_API_MOCK_ENABLED
    ? await mockCall((mod) => mod.mockCreateFilm(title))
    : await requestJson<unknown>('/api/films', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ title }),
      })

  return normalizeFilm(data)
}

/** โหลดเรื่อง แล้วแนบฉากจาก GET .../scenes เพราะ Film JSON ไม่รวม scenes */
export async function getFilm(filmId: string): Promise<Film> {
  if (FILMS_API_MOCK_ENABLED) {
    return normalizeFilm(await mockCall((mod) => mod.mockGetFilm(filmId)))
  }

  const [film, scenes] = await Promise.all([
    requestJson<unknown>(filmPath(filmId)),
    requestJson<unknown>(filmPath(filmId, '/scenes')),
  ])

  return {
    ...normalizeFilm(film),
    scenes: normalizeSceneList(scenes),
  }
}

export async function updateFilm(filmId: string, patch: FilmPatch): Promise<Film> {
  const data = FILMS_API_MOCK_ENABLED
    ? await mockCall((mod) => mod.mockUpdateFilm(filmId, patch))
    : await requestJson<unknown>(filmPath(filmId), {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify(patch),
      })

  return normalizeFilm(data)
}

export async function deleteFilm(filmId: string): Promise<void> {
  if (FILMS_API_MOCK_ENABLED) {
    await mockCall((mod) => mod.mockDeleteFilm(filmId))
    return
  }

  await requestJson<unknown>(filmPath(filmId), { method: 'DELETE' })
}

export async function createScene(filmId: string, input: CreateSceneInput = {}): Promise<Scene> {
  const data = FILMS_API_MOCK_ENABLED
    ? await mockCall((mod) => mod.mockCreateScene(filmId, input))
    : await requestJson<unknown>(filmPath(filmId, '/scenes'), {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(input),
      })

  return normalizeScene(data)
}

export async function updateScene(
  filmId: string,
  sceneId: string,
  patch: ScenePatch
): Promise<Scene> {
  const data = FILMS_API_MOCK_ENABLED
    ? await mockCall((mod) => mod.mockUpdateScene(filmId, sceneId, patch))
    : await requestJson<unknown>(scenePath(filmId, sceneId), {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify(patch),
      })

  return normalizeScene(data)
}

export async function deleteScene(filmId: string, sceneId: string): Promise<void> {
  if (FILMS_API_MOCK_ENABLED) {
    await mockCall((mod) => mod.mockDeleteScene(filmId, sceneId))
    return
  }

  await requestJson<unknown>(scenePath(filmId, sceneId), { method: 'DELETE' })
}

export async function reorderScenes(filmId: string, sceneIds: string[]): Promise<Scene[]> {
  const data = FILMS_API_MOCK_ENABLED
    ? await mockCall((mod) => mod.mockReorderScenes(filmId, sceneIds))
    : await requestJson<unknown>(filmPath(filmId, '/scenes/reorder'), {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ scene_ids: sceneIds }),
      })

  return normalizeSceneList(data)
}

/**
 * ลงทะเบียนรูปด้วย path ที่เก็บแล้ว
 * สาขา database ไม่รับ multipart ของรูป — รับ `{ path, role, order }`
 */
export async function addSceneImage(
  filmId: string,
  sceneId: string,
  input: SceneImageInput
): Promise<SceneImage> {
  const data = FILMS_API_MOCK_ENABLED
    ? await mockCall((mod) => mod.mockAddImage(filmId, sceneId, input))
    : await requestJson<unknown>(scenePath(filmId, sceneId, '/images'), {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({
          path: input.path,
          role: input.role,
          order: input.order,
          type: input.type ?? 'IMAGE',
        }),
      })

  const image = normalizeScene({ images: [data] }).images[0]
  return image ?? { id: '', scene_id: sceneId, url: null, role: input.role ?? 'ref', order: input.order ?? 0 }
}

/**
 * อัปโหลดรูปในคำขอเดียว
 * multipart `file` + `role` + `order` ไปที่ POST .../images
 * Next ส่งไบต์ต่อฝั่งเซิร์ฟเวอร์ — ไม่ยิง /api/backend และไม่เรียกพอร์ต 8000/8188
 */
export async function uploadSceneImage(
  filmId: string,
  sceneId: string,
  file: File,
  role: ImageRole,
  order?: number
): Promise<SceneImage> {
  if (FILMS_API_MOCK_ENABLED) {
    return mockCall((mod) => mod.mockUploadImage(filmId, sceneId, file, role))
  }

  const body = new FormData()
  body.append('file', file)
  body.append('role', role)
  if (order != null) body.append('order', String(order))

  const data = await requestJson<unknown>(
    scenePath(filmId, sceneId, '/images'),
    { method: 'POST', body },
    120000
  )
  const image = normalizeScene({ images: [data] }).images[0]
  return image ?? { id: '', scene_id: sceneId, url: null, role, order: order ?? 0 }
}

export async function deleteSceneImage(
  filmId: string,
  sceneId: string,
  imageId: string
): Promise<void> {
  if (FILMS_API_MOCK_ENABLED) {
    await mockCall((mod) => mod.mockDeleteImage(filmId, sceneId, imageId))
    return
  }

  const query = new URLSearchParams({ image_id: imageId })
  await requestJson<unknown>(`${scenePath(filmId, sceneId, '/images')}?${query.toString()}`, {
    method: 'DELETE',
  })
}

export async function generateScene(filmId: string, sceneId: string): Promise<Job> {
  const data = FILMS_API_MOCK_ENABLED
    ? await mockCall((mod) => mod.mockGenerateScene(filmId, sceneId))
    : await requestJson<unknown>(scenePath(filmId, sceneId, '/generate'), { method: 'POST' })

  return normalizeJob(data)
}

const BATCH_RUNNING_MESSAGE = 'มีชุดงานกำลังสร้างอยู่แล้ว กรุณารอให้เสร็จก่อน'

function jobsFromIds(sceneIds: string[], ids: string[]): Job[] {
  return ids.map((id, index) => ({
    id,
    kind: 'scene' as const,
    target_id: sceneIds[index] ?? '',
    batch_id: null,
    status: 'queued' as const,
    progress: 0,
    error: null,
    result_url: null,
  }))
}

/**
 * POST /api/films/{id}/generate-all
 * เซิร์ฟเวอร์สร้างทีละฉากและส่งเฟรมต่อให้ฉากถัดไป
 * 409 = มีชุดงานที่ยังไม่จบ
 */
export async function generateAll(
  filmId: string,
  sceneIds: string[],
  options?: { force?: boolean }
): Promise<Job[]> {
  const payload = {
    ...(sceneIds.length > 0 ? { scene_ids: sceneIds } : {}),
    ...(options?.force ? { force: true } : {}),
  }

  if (FILMS_API_MOCK_ENABLED) {
    try {
      const data = await mockCall((mod) => mod.mockGenerateAll(filmId, sceneIds, options))
      return jobsFromIds(sceneIds, data.job_ids)
    } catch (error) {
      if (error instanceof FilmsApiError && error.status === 409) {
        throw new FilmsApiError(409, BATCH_RUNNING_MESSAGE)
      }
      throw error
    }
  }

  try {
    const data = await requestJson<{ job_ids?: unknown }>(filmPath(filmId, '/generate-all'), {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(payload),
    })
    const ids = Array.isArray(data.job_ids) ? data.job_ids.map(String) : []
    return jobsFromIds(sceneIds, ids)
  } catch (error) {
    if (error instanceof FilmsApiError && error.status === 409) {
      throw new FilmsApiError(409, BATCH_RUNNING_MESSAGE)
    }
    throw error
  }
}

export async function duplicateScene(filmId: string, sceneId: string): Promise<Scene> {
  if (FILMS_API_MOCK_ENABLED) {
    return normalizeScene(await mockCall((mod) => mod.mockDuplicateScene(filmId, sceneId)))
  }

  const data = await requestJson<unknown>(scenePath(filmId, sceneId, '/duplicate'), {
    method: 'POST',
  })
  return normalizeScene(data)
}

export async function getJob(jobId: string): Promise<Job> {
  const data = FILMS_API_MOCK_ENABLED
    ? await mockCall((mod) => mod.mockGetJob(jobId))
    : await requestJson<unknown>(`/api/jobs/${encodeURIComponent(jobId)}`)

  return normalizeJob(data)
}

/**
 * POST /api/films/{id}/scripts
 * create_scenes เป็น false เพื่อให้ UI แก้ร่างก่อนบันทึกเอง
 * อาจใช้เวลาหลายนาที 503 คือ ComfyUI ไม่พร้อม
 */
export async function scriptToScenes(
  filmId: string,
  input: { script: string; max_scenes?: number; language?: string }
): Promise<{ scenes: ScriptDraft[] }> {
  const body: Record<string, unknown> = {
    script: input.script,
    source_text: input.script,
    language: input.language,
    create_scenes: false,
  }
  if (input.max_scenes != null) body.max_scenes = input.max_scenes

  const data = FILMS_API_MOCK_ENABLED
    ? await mockCall((mod) => mod.mockScriptToScenes(filmId, input))
    : await requestJson<unknown>(
        filmPath(filmId, '/scripts'),
        {
          method: 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify(body),
        },
        SCRIPT_TIMEOUT_MS
      )

  const record = asRecord(data)
  const script = asRecord(record.script)
  const breakdown = script.breakdown ?? record.scenes ?? data

  return { scenes: normalizeScriptDrafts(breakdown) }
}

export async function uploadFilmAudio(filmId: string, file: File): Promise<Film> {
  if (FILMS_API_MOCK_ENABLED) {
    return normalizeFilm(await mockCall((mod) => mod.mockUploadAudio(filmId, file)))
  }

  const body = new FormData()
  body.append('file', file)

  const data = await requestJson<unknown>(filmPath(filmId, '/audio'), { method: 'POST', body }, 120000)
  return normalizeFilm(data)
}

/** POST /api/films/{id}/renders — ทุกฉากต้องมีคลิปแล้ว */
export async function exportFilm(filmId: string): Promise<Job> {
  const data = FILMS_API_MOCK_ENABLED
    ? await mockCall((mod) => mod.mockExportFilm(filmId))
    : await requestJson<unknown>(filmPath(filmId, '/renders'), { method: 'POST' })

  const record = asRecord(data)
  return normalizeJob(record.job ?? data)
}
