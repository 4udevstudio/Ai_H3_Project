/**
 * ========================================
 * Short Film Draft (localStorage)
 * ========================================
 * จำร่างชุดหนังสั้นไว้กันหายตอน refresh
 * (ไม่เก็บ previewUrl เพราะเป็น objectURL ชั่วคราว)
 *
 * v2: เพิ่ม refImages (สูงสุด 9) + audioRefs (สูงสุด 3) สำหรับฉาก REF2VA
 *     พร้อม migrate ร่างเก่าที่เก็บรูปอ้างอิงไว้ใน slotA/slotB
 */

const KEY = 'h3-shortfilm-draft-v1'

export const MAX_SCENE_REF_IMAGES = 9
export const MAX_SCENE_REF_AUDIOS = 3

export interface SlotDraft {
  name: string
  framePath?: string
}

export interface AudioDraft {
  /** stored_filename ใน ComfyUI/input */
  name: string
  /** ชื่อไฟล์ gốcที่ผู้ใช้เลือก (ไว้แสดง) */
  originalName?: string
  /** ความยาวเสียงเป็นวินาที (ไว้เตือนถ้าเกิน duration ฉาก) */
  durationSec?: number
}

export interface SceneDraft {
  type: string
  prompt: string
  duration: number
  useOverride: boolean
  res: string
  aspect: string
  /** FL2VA: first frame */
  slotA: SlotDraft | null
  /** FL2VA: last frame */
  slotB: SlotDraft | null
  /** REF2VA: รูปอ้างอิง 1..9 */
  refImages: SlotDraft[]
  /** REF2VA: เสียงอ้างอิง 0..3 */
  audioRefs: AudioDraft[]
  jobId: string | null
}

export interface ShortFilmDraft {
  title: string
  sharedRes: string
  sharedAspect: string
  useShared: boolean
  scenes: SceneDraft[]
}

function baseTypeOf(type: string): string {
  return String(type || '').replace(/_LOW$/, '')
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
    refImages: [],
    audioRefs: [],
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

    const merged = base.scenes.map((empty, i) => {
      const incoming = (scenes[i] ?? {}) as Partial<SceneDraft>
      const scene: SceneDraft = { ...empty, ...incoming }

      if (!Array.isArray(scene.refImages)) scene.refImages = []
      if (!Array.isArray(scene.audioRefs)) scene.audioRefs = []

      // migrate ร่างเก่า: REF2VA เคยเก็บรูปไว้ใน slotA/slotB
      const hasNewRefs = Array.isArray(incoming.refImages) && incoming.refImages.length > 0
      if (baseTypeOf(scene.type) === 'REF2VA' && !hasNewRefs) {
        const legacy = [incoming.slotA, incoming.slotB].filter(
          (s): s is SlotDraft => Boolean(s && s.name)
        )
        if (legacy.length > 0) scene.refImages = legacy
      }

      scene.refImages = scene.refImages
        .filter((s) => Boolean(s && s.name))
        .slice(0, MAX_SCENE_REF_IMAGES)

      scene.audioRefs = scene.audioRefs
        .filter((a) => Boolean(a && a.name))
        .slice(0, MAX_SCENE_REF_AUDIOS)

      return scene
    })

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