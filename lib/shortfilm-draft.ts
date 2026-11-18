/**
 * ========================================
 * Short Film Draft (localStorage)
 * ========================================
 * จำร่างชุดหนังสั้นไว้กันหายตอน refresh
 * (ไม่เก็บ previewUrl เพราะเป็น objectURL ชั่วคราว)
 */

const KEY = 'h3-shortfilm-draft-v1'

export interface SlotDraft {
  name: string
  framePath?: string
}

export interface SceneDraft {
  type: string
  prompt: string
  duration: number
  useOverride: boolean
  res: string
  aspect: string
  slotA: SlotDraft | null
  slotB: SlotDraft | null
  jobId: string | null
}

export interface ShortFilmDraft {
  title: string
  sharedRes: string
  sharedAspect: string
  useShared: boolean
  scenes: SceneDraft[]
}

export function makeEmptyScene(): SceneDraft {
  return {
    type: 'T2V',
    prompt: '',
    duration: 5,
    useOverride: false,
    res: '0.5 MP',
    aspect: '16:9 (Widescreen)',
    slotA: null,
    slotB: null,
    jobId: null,
  }
}

export function defaultDraft(): ShortFilmDraft {
  return {
    title: '',
    sharedRes: '0.5 MP',
    sharedAspect: '16:9 (Widescreen)',
    useShared: true,
    scenes: [makeEmptyScene(), makeEmptyScene(), makeEmptyScene(), makeEmptyScene()],
  }
}

export function loadDraft(): ShortFilmDraft {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return defaultDraft()

    const parsed = JSON.parse(raw) as Partial<ShortFilmDraft>
    const base = defaultDraft()

    const scenes = Array.isArray(parsed.scenes) ? parsed.scenes : []
    const merged = base.scenes.map((empty, i) => ({
      ...empty,
      ...(scenes[i] ?? {}),
    }))

    return {
      title: parsed.title ?? '',
      sharedRes: parsed.sharedRes ?? base.sharedRes,
      sharedAspect: parsed.sharedAspect ?? base.sharedAspect,
      useShared: parsed.useShared ?? true,
      scenes: merged,
    }
  } catch {
    return defaultDraft()
  }
}

export function saveDraft(draft: ShortFilmDraft): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(draft))
  } catch {
    // storage เต็ม/ใช้ไม่ได้ thìข้าม
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // ข้าม
  }
}