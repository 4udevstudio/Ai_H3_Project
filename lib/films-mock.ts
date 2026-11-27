/**
 * ========================================
 * Films API mock (เบราว์เซอร์เท่านั้น)
 * ========================================
 * ถูก import เฉพาะเมื่อ NEXT_PUBLIC_FILMS_API_MOCK=1
 * เก็บสถานะในหน่วยความจำ + sessionStorage ไม่ยิงเครือข่าย
 * คลิปตัวอย่างอยู่ที่ /media/mock/sample-clip.mp4
 *
 * ส่งสคริปต์ว่า "503" หรือมี [[comfy-down]] เพื่อจำลอง 503 {error}
 */

import { FilmsApiError } from '@/lib/films-error'
import type {
  CreateSceneInput,
  Film,
  FilmPatch,
  ImageRole,
  Job,
  JobStatus,
  Scene,
  SceneImageInput,
  SceneMode,
  ScenePatch,
} from '@/lib/films-types'
import { clampUiDuration, DEFAULT_FILM_FPS, DEFAULT_FILM_HEIGHT, DEFAULT_FILM_WIDTH } from '@/lib/films-types'

const STORAGE_KEY = 'h3-films-mock-v2'
const SAMPLE_CLIP = '/media/mock/sample-clip.mp4'
const SCENE_JOB_MS = 4500
const EXPORT_JOB_MS = 6000
const SCRIPT_DELAY_MS = 1200

interface MockJob {
  id: string
  batch: string
  batch_index: number
  kind: 'scene' | 'export'
  film_id: string
  scene_id?: string
  status: JobStatus
  progress: number
  started_at: number | null
  duration_ms: number
  error: string | null
  result_url: string | null
}

interface Store {
  films: Film[]
  jobs: MockJob[]
}

let memory: Store | null = null

function nowIso(): string {
  return new Date().toISOString()
}

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function swatch(label: string, hue: number): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270" viewBox="0 0 480 270">` +
    `<rect width="480" height="270" fill="hsl(${hue} 38% 16%)"/>` +
    `<circle cx="400" cy="64" r="28" fill="hsl(${hue} 62% 58%)"/>` +
    `<text x="28" y="150" fill="white" font-family="sans-serif" font-size="42" font-weight="700">${label}</text>` +
    `</svg>`

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`
}

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new FilmsApiError(400, 'อ่านไฟล์ไม่สำเร็จ'))
    reader.readAsDataURL(file)
  })
}

function seedStore(): Store {
  const created = nowIso()
  const rainId = 'film_demo_rain'

  const rain: Film = {
    id: rainId,
    title: 'สายฝนยามเย็น',
    script:
      'ฝนตกทั้งคืนบนถนนสาทร แสงไฟสะท้อนพื้นเปียก\n' +
      'หญิงสาวในเสื้อกันฝนสีแดงยืนรอรถที่ป้าย\n' +
      'รถเมล์ไม่มา เธอเดินลัดซอยจนร่มปลิวหลุดมือ\n' +
      'รุ่งเช้าฝนซา เธอยิ้มเมื่อเห็นรุ้งจาง ๆ เหนือตึก',
    width: DEFAULT_FILM_WIDTH,
    height: DEFAULT_FILM_HEIGHT,
    fps: DEFAULT_FILM_FPS,
    transition: 'crossfade',
    transition_duration: 0.8,
    audio_url: null,
    audio_volume: 1,
    final_url: SAMPLE_CLIP,
    status: 'draft',
    scenes: [
      {
        id: 'scene_rain_1',
        film_id: rainId,
        order: 0,
        prompt: 'ถนนเปียกหลังฝนในกรุงเทพยามเย็น แสงนีออนสะท้อนบนพื้น กล้องเคลื่อนช้า',
        mode: 'T2V',
        gguf: false,
        duration_sec: 5,
        seed: 42,
        chain_from_previous: true,
        images: [],
        status: 'done',
        clip_url: SAMPLE_CLIP,
        error: null,
        updated_at: created,
      },
      {
        id: 'scene_rain_2',
        film_id: rainId,
        order: 1,
        prompt: 'หญิงสาวถือร่มสีแดงเดินผ่านซอย กอดเสื้อกันฝน แล้วมองย้อนกลับมา',
        mode: 'REF2VA',
        gguf: true,
        duration_sec: 5,
        seed: null,
        chain_from_previous: true,
        images: [
          { id: 'img_rain_ref', scene_id: 'scene_rain_2', url: swatch('REF', 8), role: 'ref', order: 0 },
        ],
        status: 'draft',
        clip_url: null,
        error: null,
        updated_at: created,
      },
      {
        id: 'scene_rain_3',
        film_id: rainId,
        order: 2,
        prompt: 'ร่มสีแดงปลิวหลุดมือ กล้องติดตามร่มลอยเหนือถนนเปียก',
        mode: 'FL2VA',
        gguf: false,
        duration_sec: 8,
        seed: 7,
        chain_from_previous: true,
        images: [
          { id: 'img_rain_first', scene_id: 'scene_rain_3', url: swatch('FIRST', 200), role: 'first', order: 0 },
          { id: 'img_rain_last', scene_id: 'scene_rain_3', url: swatch('LAST', 265), role: 'last', order: 1 },
        ],
        status: 'failed',
        clip_url: null,
        error: 'ComfyUI ขาดเฟรมท้ายของฉากก่อนหน้า — ลองสร้างใหม่',
        updated_at: created,
      },
      {
        id: 'scene_rain_4',
        film_id: rainId,
        order: 3,
        prompt: 'ฝนซา ท้องฟ้าเริ่มเปิด เป็นแสงทองเหนือแนวตึก',
        mode: 'T2V',
        gguf: false,
        duration_sec: 5,
        seed: null,
        chain_from_previous: true,
        images: [],
        status: 'draft',
        clip_url: null,
        error: null,
        updated_at: created,
      },
    ],
  }

  const blankId = 'film_demo_blank'
  const blank: Film = {
    id: blankId,
    title: 'เช้าวันใหม่',
    script: null,
    width: DEFAULT_FILM_WIDTH,
    height: DEFAULT_FILM_HEIGHT,
    fps: DEFAULT_FILM_FPS,
    transition: 'none',
    transition_duration: 0.5,
    audio_url: null,
    audio_volume: 1,
    final_url: null,
    status: 'draft',
    scenes: [],
  }

  return { films: [rain, blank], jobs: [] }
}

function load(): Store {
  if (memory) return memory

  if (typeof window !== 'undefined') {
    try {
      const raw = window.sessionStorage.getItem(STORAGE_KEY)
      if (raw) {
        memory = JSON.parse(raw) as Store
        return memory
      }
    } catch {
      // ใช้ seed แทน
    }
  }

  memory = seedStore()
  persist(memory)
  return memory
}

function persist(store: Store): void {
  memory = store

  if (typeof window === 'undefined') return

  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {
    // โควต้าเต็ม — คงไว้ในหน่วยความจำ
  }
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function requireFilm(store: Store, filmId: string): Film {
  const film = store.films.find((item) => item.id === filmId)
  if (!film) throw new FilmsApiError(404, 'ไม่พบเรื่องนี้')
  return film
}

function requireScene(store: Store, sceneId: string): { film: Film; scene: Scene } {
  for (const film of store.films) {
    const scene = sceneList(film).find((item) => item.id === sceneId)
    if (scene) return { film, scene }
  }

  throw new FilmsApiError(404, 'ไม่พบฉากนี้')
}

function sceneList(film: Film): Scene[] {
  if (!film.scenes) film.scenes = []
  return film.scenes
}

function reindex(film: Film): void {
  const scenes = sceneList(film)
  scenes.sort((a, b) => a.order - b.order)
  scenes.forEach((scene, index) => {
    scene.order = index
  })
}

function touch(scene: Scene): void {
  scene.updated_at = nowIso()
}

function blankScene(filmId: string, order: number, input: CreateSceneInput): Scene {
  return {
    id: uid('scene'),
    film_id: filmId,
    order,
    prompt: input.prompt ?? '',
    mode: input.mode ?? 'T2V',
    gguf: input.gguf ?? false,
    duration_sec: clampUiDuration(input.duration_sec ?? 5),
    seed: input.seed === undefined ? null : input.seed,
    chain_from_previous: input.chain_from_previous ?? true,
    images: [],
    status: 'draft',
    clip_url: null,
    error: null,
    updated_at: nowIso(),
  }
}

function applyScenePatch(scene: Scene, patch: ScenePatch): void {
  if (patch.prompt !== undefined) scene.prompt = patch.prompt
  if (patch.mode !== undefined) scene.mode = patch.mode
  if (patch.gguf !== undefined) scene.gguf = patch.gguf
  if (patch.duration_sec !== undefined && patch.duration_sec > 0) scene.duration_sec = patch.duration_sec
  if (patch.seed !== undefined) scene.seed = patch.seed
  if (patch.chain_from_previous !== undefined) scene.chain_from_previous = patch.chain_from_previous
  touch(scene)
}

function syncFilmStatus(store: Store, film: Film): void {
  const jobs = store.jobs.filter((job) => job.film_id === film.id)
  const exportActive = jobs.some(
    (job) => job.kind === 'export' && (job.status === 'queued' || job.status === 'running')
  )
  const sceneActive = jobs.some(
    (job) => job.kind === 'scene' && (job.status === 'queued' || job.status === 'running')
  )

  if (exportActive) {
    film.status = 'assembling'
    return
  }

  if (sceneActive) {
    film.status = 'generating'
    return
  }

  if (film.status !== 'generating' && film.status !== 'assembling') return

  const exportFailed = jobs.some((job) => job.kind === 'export' && job.status === 'failed')
  if (exportFailed) film.status = 'failed'
  else if (film.status === 'assembling' && film.final_url) film.status = 'done'
  else film.status = 'draft'
}

function finishSceneJob(scene: Scene, job: MockJob): void {
  if (!scene.prompt.trim()) {
    job.status = 'failed'
    job.progress = 100
    job.error = 'ฉากนี้ยังไม่มีพรอมป์'
    scene.status = 'failed'
    scene.error = job.error
    touch(scene)
    return
  }

  job.status = 'done'
  job.progress = 100
  job.result_url = SAMPLE_CLIP
  job.error = null
  scene.status = 'done'
  scene.clip_url = SAMPLE_CLIP
  scene.error = null
  touch(scene)
}

function tick(store: Store): void {
  const batches = new Map<string, MockJob[]>()

  for (const job of store.jobs) {
    const list = batches.get(job.batch) ?? []
    list.push(job)
    batches.set(job.batch, list)
  }

  for (const jobs of batches.values()) {
    jobs.sort((a, b) => a.batch_index - b.batch_index)
    let gateOpen = true

    for (const job of jobs) {
      if (job.status === 'done' || job.status === 'failed') continue

      if (!gateOpen) {
        job.status = 'queued'
        job.progress = 0
        continue
      }

      if (job.kind === 'scene' && job.scene_id) {
        const found = findScene(store, job.scene_id)
        if (found && !found.scene.prompt.trim()) {
          finishSceneJob(found.scene, job)
          failLaterScenes(store, jobs, job)
          gateOpen = false
          continue
        }
      }

      if (job.started_at == null) job.started_at = Date.now()

      const elapsed = Date.now() - job.started_at
      const progress = Math.max(0, Math.min(100, Math.round((elapsed / job.duration_ms) * 100)))
      job.progress = progress

      if (progress >= 100) {
        if (job.kind === 'scene' && job.scene_id) {
          const found = findScene(store, job.scene_id)
          if (found) finishSceneJob(found.scene, job)
          else {
            job.status = 'failed'
            job.error = 'ไม่พบฉากของงานนี้'
          }
        } else if (job.kind === 'export') {
          const film = store.films.find((item) => item.id === job.film_id)
          job.status = 'done'
          job.result_url = SAMPLE_CLIP
          job.error = null
          if (film) {
            film.final_url = SAMPLE_CLIP
            film.status = 'done'
          }
        }
      } else if (progress < 12) {
        job.status = 'queued'
        if (job.kind === 'scene' && job.scene_id) {
          const found = findScene(store, job.scene_id)
          if (found && found.scene.status !== 'failed') found.scene.status = 'queued'
        }
      } else {
        job.status = 'running'
        if (job.kind === 'scene' && job.scene_id) {
          const found = findScene(store, job.scene_id)
          if (found) {
            found.scene.status = 'running'
            found.scene.error = null
          }
        }
      }

      if (job.status === 'failed') failLaterScenes(store, jobs, job)
      gateOpen = job.status === 'done'
    }
  }

  for (const film of store.films) syncFilmStatus(store, film)
}

function findScene(store: Store, sceneId: string): { film: Film; scene: Scene } | null {
  for (const film of store.films) {
    const scene = sceneList(film).find((item) => item.id === sceneId)
    if (scene) return { film, scene }
  }

  return null
}

function failLaterScenes(store: Store, jobs: MockJob[], failed: MockJob): void {
  if (failed.kind !== 'scene' || failed.status !== 'failed') return

  for (const later of jobs) {
    if (later.batch_index <= failed.batch_index) continue
    later.status = 'failed'
    later.progress = 0
    later.error = 'previous scene failed'
    later.result_url = null
    if (!later.scene_id) continue
    const found = findScene(store, later.scene_id)
    if (!found) continue
    found.scene.status = 'failed'
    found.scene.clip_url = null
    found.scene.error = 'previous scene failed'
    touch(found.scene)
  }
}

function jobView(job: MockJob): Job {
  return {
    id: job.id,
    kind: job.kind,
    target_id: job.scene_id ?? job.film_id,
    batch_id: job.batch,
    status: job.status,
    progress: job.progress,
    error: job.error,
    result_url: job.result_url,
  }
}

function enqueueSceneJobs(store: Store, film: Film, sceneIds: string[]): string[] {
  const batch = uid('batch')
  const ids: string[] = []

  sceneIds.forEach((sceneId, index) => {
    const scene = sceneList(film).find((item) => item.id === sceneId)
    if (!scene) return

    const job: MockJob = {
      id: uid('job'),
      batch,
      batch_index: index,
      kind: 'scene',
      film_id: film.id,
      scene_id: sceneId,
      status: 'queued',
      progress: 0,
      started_at: null,
      duration_ms: SCENE_JOB_MS,
      error: null,
      result_url: null,
    }

    scene.status = 'queued'
    scene.error = null
    touch(scene)
    store.jobs.push(job)
    ids.push(job.id)
  })

  film.status = 'generating'
  return ids
}

function withStore<T>(run: (store: Store) => T): T {
  const store = load()
  tick(store)
  const result = run(store)
  persist(store)
  return result
}

export function mockListFilms(): Film[] {
  return withStore((store) =>
    clone(store.films).map((film) => {
      const listed = { ...film }
      delete listed.scenes
      return listed
    })
  )
}

export function mockCreateFilm(title: string): Film {
  const trimmed = title.trim()
  if (!trimmed) throw new FilmsApiError(400, 'กรุณาระบุชื่อเรื่อง')

  return withStore((store) => {
    const film: Film = {
      id: uid('film'),
      title: trimmed,
      script: null,
      scenes: [],
      width: DEFAULT_FILM_WIDTH,
      height: DEFAULT_FILM_HEIGHT,
      fps: DEFAULT_FILM_FPS,
      transition: 'none',
      transition_duration: 0.5,
      audio_url: null,
      audio_volume: 1,
      final_url: null,
      status: 'draft',
    }

    store.films.unshift(film)
    return clone(film)
  })
}

export function mockGetFilm(filmId: string): Film {
  return withStore((store) => clone(requireFilm(store, filmId)))
}

export function mockUpdateFilm(filmId: string, patch: FilmPatch): Film {
  return withStore((store) => {
    const film = requireFilm(store, filmId)
    if (patch.title !== undefined) {
      const trimmed = patch.title.trim()
      if (!trimmed) throw new FilmsApiError(400, 'ชื่อเรื่องว่างไม่ได้')
      film.title = trimmed
    }
    if (patch.script !== undefined) film.script = patch.script
    if (patch.transition !== undefined) film.transition = patch.transition
    if (patch.transition_duration !== undefined) {
      film.transition_duration = Math.min(5, Math.max(0, patch.transition_duration))
    }
    return clone(film)
  })
}

export function mockDeleteFilm(filmId: string): void {
  withStore((store) => {
    const index = store.films.findIndex((film) => film.id === filmId)
    if (index < 0) throw new FilmsApiError(404, 'ไม่พบเรื่องนี้')
    store.films.splice(index, 1)
    store.jobs = store.jobs.filter((job) => job.film_id !== filmId)
  })
}

export function mockCreateScene(filmId: string, input: CreateSceneInput): Scene {
  const prompt = input.prompt?.trim() ?? ''
  if (!prompt) throw new FilmsApiError(400, 'prompt is required')

  return withStore((store) => {
    const film = requireFilm(store, filmId)
    const scenes = sceneList(film)
    reindex(film)

    let index = scenes.length
    if (input.order != null && input.order >= 0 && input.order < scenes.length) {
      index = input.order
    }

    const scene = blankScene(film.id, index, { ...input, prompt })
    scenes.splice(index, 0, scene)
    reindex(film)
    return clone(scene)
  })
}

export function mockUpdateScene(filmId: string, sceneId: string, patch: ScenePatch): Scene {
  return withStore((store) => {
    requireFilm(store, filmId)
    const { scene } = requireScene(store, sceneId)
    if (patch.prompt !== undefined && !patch.prompt.trim()) {
      throw new FilmsApiError(400, 'prompt is required')
    }
    if (patch.duration_sec !== undefined) patch = { ...patch, duration_sec: clampUiDuration(patch.duration_sec) }
    applyScenePatch(scene, patch)
    return clone(scene)
  })
}

export function mockDeleteScene(filmId: string, sceneId: string): void {
  withStore((store) => {
    requireFilm(store, filmId)
    const { film } = requireScene(store, sceneId)
    film.scenes = sceneList(film).filter((scene) => scene.id !== sceneId)
    reindex(film)
    store.jobs = store.jobs.filter((job) => job.scene_id !== sceneId)
  })
}

export function mockDuplicateScene(filmId: string, sceneId: string): Scene {
  return withStore((store) => {
    const film = requireFilm(store, filmId)
    const scene = sceneList(film).find((item) => item.id === sceneId)
    if (!scene) throw new FilmsApiError(404, 'ไม่พบฉากนี้')
    reindex(film)

    const copy = clone(scene)
    copy.id = uid('scene')
    copy.order = scene.order + 1
    copy.status = 'draft'
    copy.clip_url = null
    copy.error = null
    copy.images = scene.images.map((image) => ({ ...image, id: uid('img'), scene_id: copy.id }))
    touch(copy)

    sceneList(film).splice(scene.order + 1, 0, copy)
    reindex(film)
    return clone(copy)
  })
}

export function mockReorderScenes(filmId: string, sceneIds: string[]): { scenes: Scene[] } {
  return withStore((store) => {
    const film = requireFilm(store, filmId)
    const scenes = sceneList(film)
    const current = scenes.map((scene) => scene.id)
    const same =
      sceneIds.length === current.length &&
      sceneIds.every((id) => current.includes(id)) &&
      new Set(sceneIds).size === sceneIds.length

    if (!same) throw new FilmsApiError(400, 'scene_ids must list every scene of this film exactly once')

    const byId = new Map(scenes.map((scene) => [scene.id, scene]))
    film.scenes = sceneIds.map((id, index) => {
      const scene = byId.get(id)!
      scene.order = index
      return scene
    })
    return { scenes: clone(film.scenes) }
  })
}

function pushImage(scene: Scene, path: string, role: ImageRole, order?: number) {
  const url = path.startsWith('data:') || path.startsWith('http') || path.startsWith('/') ? path : null
  const image = {
    id: uid('img'),
    scene_id: scene.id,
    url,
    role,
    order: order ?? scene.images.length,
  }
  scene.images.push(image)
  touch(scene)
  return image
}

export function mockAddImage(filmId: string, sceneId: string, input: SceneImageInput) {
  if (!input.path?.trim()) throw new FilmsApiError(400, 'path is required')

  return withStore((store) => {
    requireFilm(store, filmId)
    const { scene } = requireScene(store, sceneId)
    return clone(pushImage(scene, input.path, input.role ?? 'ref', input.order))
  })
}

export async function mockUploadImage(
  filmId: string,
  sceneId: string,
  file: File,
  role: ImageRole
) {
  if (file.type && !file.type.startsWith('image/')) {
    throw new FilmsApiError(400, 'ไฟล์นี้ไม่ใช่รูปภาพ')
  }

  const url = await readFile(file)
  return mockAddImage(filmId, sceneId, { path: url, role })
}

export function mockDeleteImage(filmId: string, sceneId: string, imageId: string): void {
  withStore((store) => {
    requireFilm(store, filmId)
    const { scene } = requireScene(store, sceneId)
    const before = scene.images.length
    scene.images = scene.images.filter((image) => image.id !== imageId)
    if (scene.images.length === before) throw new FilmsApiError(404, 'image not found')
    touch(scene)
  })
}

export function mockGenerateScene(filmId: string, sceneId: string): Job {
  return withStore((store) => {
    const film = requireFilm(store, filmId)
    const { scene } = requireScene(store, sceneId)
    const jobId = enqueueSceneJobs(store, film, [scene.id])[0]
    const job = store.jobs.find((item) => item.id === jobId)
    if (!job) throw new FilmsApiError(500, 'สร้างงานไม่สำเร็จ')
    return jobView(job)
  })
}

export function mockGenerateAll(
  filmId: string,
  sceneIds: string[],
  _options?: { force?: boolean }
): { job_ids: string[] } {
  return withStore((store) => {
    const film = requireFilm(store, filmId)
    const busy = store.jobs.some(
      (job) =>
        job.film_id === filmId &&
        job.kind === 'scene' &&
        (job.status === 'queued' || job.status === 'running')
    )
    if (busy && !_options?.force) {
      throw new FilmsApiError(409, 'batch already running')
    }
    const ids = sceneIds.length > 0 ? sceneIds : sceneList(film).map((scene) => scene.id)
    return { job_ids: enqueueSceneJobs(store, film, ids) }
  })
}

export function mockGetJob(jobId: string): Job {
  return withStore((store) => {
    const job = store.jobs.find((item) => item.id === jobId)
    if (!job) throw new FilmsApiError(404, 'ไม่พบงานนี้')
    return jobView(job)
  })
}

export async function mockScriptToScenes(
  filmId: string,
  input: { script: string; max_scenes?: number; language?: string }
) {
  await wait(SCRIPT_DELAY_MS)

  const script = input.script.trim()
  if (!script) throw new FilmsApiError(400, 'source_text is required')

  if (script === '503' || /\[\[comfy-down\]\]/i.test(script)) {
    throw new FilmsApiError(503, 'ComfyUI ไม่ตอบสนอง — เปิดบริการแล้วลองแตกฉากใหม่')
  }

  return withStore((store) => {
    const film = requireFilm(store, filmId)
    film.script = script

    const limit = Math.max(1, Math.min(24, input.max_scenes ?? 8))
    const chunks = script
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)

    const source = chunks.length > 0 ? chunks : [script]
    const breakdown = source.slice(0, limit).map((prompt, index) => ({
      prompt,
      mode: (index === 0 ? 'T2V' : 'FL2VA') as SceneMode,
      duration: 5,
    }))

    return {
      script: { breakdown, source_text: script, status: 'done' },
      scenes: [],
      error: null,
    }
  })
}

export async function mockUploadAudio(filmId: string, file: File): Promise<Film> {
  if (file.type && !file.type.startsWith('audio/')) {
    throw new FilmsApiError(400, 'ไฟล์นี้ไม่ใช่เสียง')
  }

  const audioUrl = await readFile(file)

  return withStore((store) => {
    const film = requireFilm(store, filmId)
    film.audio_url = audioUrl
    return clone(film)
  })
}

export function mockExportFilm(filmId: string): { job: Job } {
  return withStore((store) => {
    const film = requireFilm(store, filmId)
    const scenes = sceneList(film)
    const missing = scenes.some((scene) => scene.status !== 'done' || !scene.clip_url)
    if (scenes.length === 0 || missing) {
      throw new FilmsApiError(400, 'ทุกฉากต้องมีคลิปก่อนส่งออก')
    }

    const job: MockJob = {
      id: uid('job'),
      batch: uid('batch'),
      batch_index: 0,
      kind: 'export',
      film_id: film.id,
      status: 'queued',
      progress: 0,
      started_at: null,
      duration_ms: EXPORT_JOB_MS,
      error: null,
      result_url: null,
    }

    film.status = 'assembling'
    store.jobs.push(job)
    return { job: jobView(job) }
  })
}
