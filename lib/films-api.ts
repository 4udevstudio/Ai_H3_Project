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

import { uploadReferenceFiles } from '@/lib/backend'
import { FilmsApiError } from '@/lib/films-error'
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
      let message = `คำขอไม่สำเร็จ (HTTP ${response.status})`

      try {
        const data = (await response.json()) as { error?: unknown; detail?: unknown }
        if (typeof data.error === 'string' && data.error.trim()) message = data.error
        else if (typeof data.detail === 'string' && data.detail.trim()) message = data.detail
      } catch {
        // body ไม่ใช่ JSON
      }

      throw new FilmsApiError(response.status, message)
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
 * อัปโหลดไฟล์แล้วลงทะเบียนเป็นรูปของฉาก
 * ไบต์ไปที่อัปโหลด reference เดิมของ FastAPI (เส้นทางเดียวกับโหมดคิวเดิม)
 * แล้วส่ง stored path เข้า POST .../images
 */
export async function uploadSceneImage(
  filmId: string,
  sceneId: string,
  file: File,
  role: ImageRole
): Promise<SceneImage> {
  if (FILMS_API_MOCK_ENABLED) {
    return mockCall((mod) => mod.mockUploadImage(filmId, sceneId, file, role))
  }

  const uploaded = await uploadReferenceFiles([file])
  const stored = uploaded[0]
  const path = stored?.stored_path || stored?.stored_filename
  if (!path) throw new FilmsApiError(0, 'อัปโหลดรูปไม่สำเร็จ')

  return addSceneImage(filmId, sceneId, { path, role })
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

/**
 * ไม่มี route generate-all — สร้างงานทีละฉากตามลำดับที่ให้มา
 * แต่ละ POST คืนทันทีตอนเข้าคิว ไม่รอคลิปเสร็จ
 */
export async function generateAll(filmId: string, sceneIds: string[]): Promise<Job[]> {
  const jobs: Job[] = []
  for (const sceneId of sceneIds) {
    jobs.push(await generateScene(filmId, sceneId))
  }
  return jobs
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
