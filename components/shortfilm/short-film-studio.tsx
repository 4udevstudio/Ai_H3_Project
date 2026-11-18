'use client'

/**
 * ========================================
 * ShortFilmStudio (ชุดหนังสั้น)
 * ========================================
 * - 4 การ์ดฉาก แต่ละฉาก = 1 job อิสระในคิวเดิม
 * - อัปโหลดรูปเองได้ทุกฉาก + ดึง last frame จากฉากก่อนหน้า (guided chain)
 * - Resolution/Aspect ร่วมทั้งเรื่อง + override รายฉาก
 * - จำ draft ลง localStorage + ปุ่มล้างทั้งหมด
 * - ส่งทั้งหมดเรียง 1→4 + รวมคลิปที่เสร็จแล้ว
 */

import * as React from 'react'
import {
  AlertCircle,
  Film,
  ImageIcon,
  Link2,
  Loader2,
  Merge,
  Play,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { PromptEnhanceDialog } from '@/components/studio/prompt-enhance-dialog'
import {
  concatVideos,
  createGeneration,
  extractFrame,
  fetchGenerations,
  getFrameUrl,
  uploadReferenceFiles,
  type QueueJobResponse,
} from '@/lib/backend'
import {
  clearDraft,
  loadDraft,
  makeEmptyScene,
  saveDraft,
  type SceneDraft,
} from '@/lib/shortfilm-draft'
import { cn } from '@/lib/utils'

// ========================================
// Constants
// ========================================

const RESOLUTIONS = ['0.1 MP', '0.25 MP', '0.35 MP', '0.5 MP', '0.75 MP', '1.0 MP']
const ASPECT_RATIOS = [
  '16:9 (Widescreen)',
  '9:16 (Portrait Widescreen)',
  '1:1 (Square)',
  '2:3 (Portrait Photo)',
  '3:2 (Photo)',
  '3:4 (Portrait Standard)',
  '4:3 (Standard)',
  '21:9 (Ultrawide)',
]
const DURATIONS = [5, 8, 10, 12, 15]

const SCENE_TYPES = [
  { value: 'T2V', label: 'T2V' },
  { value: 'FL2VA', label: 'FL2VA (ต่อฉาก)' },
  { value: 'REF2VA', label: 'REF2VA (อ้างอิง)' },
] as const

type SceneType = (typeof SCENE_TYPES)[number]['value']

const POLL_INTERVAL_MS = 2500

// ========================================
// Types
// ========================================

interface SlotState {
  name: string
  framePath?: string
  previewUrl: string
}

interface SceneState {
  type: SceneType
  prompt: string
  duration: number
  useOverride: boolean
  res: string
  aspect: string
  slotA: SlotState | null
  slotB: SlotState | null
  jobId: string | null
}

// ========================================
// Helpers
// ========================================

function draftToState(d: SceneDraft): SceneState {
  return {
    type: d.type as SceneType,
    prompt: d.prompt,
    duration: d.duration,
    useOverride: d.useOverride,
    res: d.res,
    aspect: d.aspect,
    slotA: d.slotA
      ? { name: d.slotA.name, framePath: d.slotA.framePath, previewUrl: d.slotA.framePath ? getFrameUrl(d.slotA.framePath) ?? '' : '' }
      : null,
    slotB: d.slotB
      ? { name: d.slotB.name, framePath: d.slotB.framePath, previewUrl: d.slotB.framePath ? getFrameUrl(d.slotB.framePath) ?? '' : '' }
      : null,
    jobId: d.jobId,
  }
}

function stateToDraft(s: SceneState): SceneDraft {
  return {
    type: s.type,
    prompt: s.prompt,
    duration: s.duration,
    useOverride: s.useOverride,
    res: s.res,
    aspect: s.aspect,
    slotA: s.slotA ? { name: s.slotA.name, framePath: s.slotA.framePath } : null,
    slotB: s.slotB ? { name: s.slotB.name, framePath: s.slotB.framePath } : null,
    jobId: s.jobId,
  }
}

function statusClasses(status: string): string {
  switch (status) {
    case 'DONE':
      return 'bg-green-500/10 text-green-600 dark:text-green-400'
    case 'FAILED':
      return 'bg-destructive/10 text-destructive'
    case 'CANCELLED':
      return 'bg-orange-500/10 text-orange-600 dark:text-orange-400'
    case 'RUNNING':
      return 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
    default:
      return 'bg-muted text-muted-foreground'
  }
}

// ========================================
// Scene slot (รูป)
// ========================================

function SceneSlot(props: {
  label: string
  value: SlotState | null
  inputRef: React.RefObject<HTMLInputElement | null>
  onFile: (file: File) => void
  onClear: () => void
  busy?: boolean
}) {
  const { label, value, inputRef, onFile, onClear, busy } = props

  return (
    <div className="grid gap-1.5 rounded-lg border border-border bg-muted/20 p-2">
      <div className="flex items-center justify-between gap-1">
        <span className="text-[10px] font-semibold">{label}</span>
        {value && (
          <button
            type="button"
            onClick={onClear}
            className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-destructive"
            aria-label={`ล้าง ${label}`}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div
        className="relative h-20 w-full overflow-hidden rounded border border-border bg-black"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          const f = e.dataTransfer.files?.[0]
          if (f) onFile(f)
        }}
      >
        {value && value.previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value.previewUrl} alt={label} className="h-full w-full object-contain" />
        ) : value ? (
          <span className="flex h-full w-full items-center justify-center text-[9px] text-muted-foreground">
            แนบแล้ว (ไม่มี preview)
          </span>
        ) : (
          <span className="flex h-full w-full items-center justify-center text-muted-foreground">
            <ImageIcon className="h-5 w-5" />
          </span>
        )}
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 text-[10px]"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
      >
        {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Upload className="mr-1 h-3 w-3" />}
        อัปโหลดรูป
      </Button>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onFile(f)
          e.target.value = ''
        }}
      />

      {value?.name && (
        <span className="truncate font-mono text-[9px] text-muted-foreground" title={value.name}>
          {value.name}
        </span>
      )}
    </div>
  )
}

// ========================================
// Scene card
// ========================================

interface SceneCardProps {
  index: number
  scene: SceneState
  job?: QueueJobResponse
  submitting: boolean
  extracting: boolean
  canPullPrev: boolean
  uploadingSlot: 'A' | 'B' | null
  onUpdate: (patch: Partial<SceneState>) => void
  onPickFile: (slot: 'A' | 'B', file: File) => void
  onClearSlot: (slot: 'A' | 'B') => void
  onPullPrev: () => void
  onSubmit: () => void
  onClearScene: () => void
  onEnhance: () => void
}

function SceneCard(props: SceneCardProps) {
  const {
    index, scene, job, submitting, extracting, canPullPrev, uploadingSlot,
    onUpdate, onPickFile, onClearSlot, onPullPrev, onSubmit, onClearScene, onEnhance,
  } = props

  const slotARef = React.useRef<HTMLInputElement | null>(null)
  const slotBRef = React.useRef<HTMLInputElement | null>(null)

  const isFl2va = scene.type === 'FL2VA'
  const isRef = scene.type === 'REF2VA'
  const isT2v = scene.type === 'T2V'

  const slotALabel = isFl2va ? 'First frame' : isRef ? 'Reference 1' : ''
  const slotBLabel = isFl2va ? 'Last frame (ไม่บังคับ)' : isRef ? 'Reference 2 (ไม่บังคับ)' : ''

  return (
    <Card className="shadow-sm">
      <CardHeader className="border-b border-border bg-card/60 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 font-mono text-xs font-bold text-primary">
              {index + 1}
            </span>
            ฉาก {index + 1}
          </CardTitle>

          {job ? (
            <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', statusClasses(job.status))}>
              {job.status}
              {job.status === 'RUNNING' ? ` ${Math.round(job.progress)}%` : ''}
            </span>
          ) : (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
              ยังไม่ได้ส่ง
            </span>
          )}
        </div>
      </CardHeader>

      <CardContent className="grid gap-3 p-4">
        {/* type + duration */}
        <div className="grid grid-cols-2 gap-2">
          <select
            value={scene.type}
            onChange={(e) => onUpdate({ type: e.target.value as SceneType })}
            className="h-9 rounded-md border border-input bg-background px-2 text-xs shadow-sm"
            aria-label={`ประเภทฉาก ${index + 1}`}
          >
            {SCENE_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>

          <select
            value={scene.duration}
            onChange={(e) => onUpdate({ duration: Number(e.target.value) })}
            className="h-9 rounded-md border border-input bg-background px-2 text-xs shadow-sm"
            aria-label={`ความยาวฉาก ${index + 1}`}
          >
            {DURATIONS.map((d) => (
              <option key={d} value={d}>
                {d} วินาที
              </option>
            ))}
          </select>
        </div>

        {/* prompt + AI enhance */}
        <div className="grid gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-semibold text-muted-foreground">Prompt</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2 text-[10px]"
              onClick={onEnhance}
              title="ให้ Gemma วิเคราะห์รูปของฉากนี้แล้วเขียน prompt ให้"
            >
              <Sparkles className="mr-1 h-3 w-3 text-primary" />
              สร้าง prompt จากรูป
            </Button>
          </div>

          <Textarea
            value={scene.prompt}
            onChange={(e) => onUpdate({ prompt: e.target.value })}
            placeholder={`prompt ฉาก ${index + 1}...`}
            className="min-h-20 resize-y text-xs"
          />
        </div>

        {/* image slots */}
        {isT2v ? (
          <p className="rounded-lg border border-dashed border-border bg-muted/20 px-3 py-2 text-center text-[10px] text-muted-foreground">
            T2V ไม่ต้องใช้รูป — พิมพ์ prompt อย่างเดียว
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <SceneSlot
              label={slotALabel}
              value={scene.slotA}
              inputRef={slotARef}
              onFile={(f) => onPickFile('A', f)}
              onClear={() => onClearSlot('A')}
              busy={uploadingSlot === 'A'}
            />
            {isFl2va || isRef ? (
              <SceneSlot
                label={slotBLabel}
                value={scene.slotB}
                inputRef={slotBRef}
                onFile={(f) => onPickFile('B', f)}
                onClear={() => onClearSlot('B')}
                busy={uploadingSlot === 'B'}
              />
            ) : (
              <div />
            )}
          </div>
        )}

        {/* guided chain */}
        {index > 0 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 text-[10px]"
            onClick={onPullPrev}
            disabled={!canPullPrev || extracting}
            title="ดึง last frame ของฉากก่อนหน้ามาเป็น first frame ฉากนี้"
          >
            {extracting ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Link2 className="mr-1.5 h-3.5 w-3.5" />
            )}
            ดึง last frame จากฉาก {index}
          </Button>
        )}

        {/* per-scene override */}
        <label className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <input
            type="checkbox"
            checked={scene.useOverride}
            onChange={(e) => onUpdate({ useOverride: e.target.checked })}
            className="h-3.5 w-3.5 rounded border-input"
          />
          ใช้ Resolution/Aspect ของฉากนี้ (ไม่ใช้ค่าร่วม)
        </label>

        {scene.useOverride && (
          <div className="grid grid-cols-2 gap-2">
            <select
              value={scene.res}
              onChange={(e) => onUpdate({ res: e.target.value })}
              className="h-8 rounded-md border border-input bg-background px-2 text-[10px] shadow-sm"
            >
              {RESOLUTIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <select
              value={scene.aspect}
              onChange={(e) => onUpdate({ aspect: e.target.value })}
              className="h-8 rounded-md border border-input bg-background px-2 text-[10px] shadow-sm"
            >
              {ASPECT_RATIOS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* actions */}
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            className="h-8 flex-1 text-xs"
            onClick={onSubmit}
            disabled={submitting}
          >
            {submitting ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="mr-1.5 h-3.5 w-3.5" />
            )}
            เพิ่มเข้าคิว
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-destructive"
            onClick={onClearScene}
            aria-label={`ล้างฉาก ${index + 1}`}
            title="ล้าง prompt + รูปของฉากนี้"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ========================================
// Main component
// ========================================

export function ShortFilmStudio() {
  const initial = React.useMemo(() => loadDraft(), [])

  const [title, setTitle] = React.useState(initial.title)
  const [sharedRes, setSharedRes] = React.useState(initial.sharedRes)
  const [sharedAspect, setSharedAspect] = React.useState(initial.sharedAspect)
  const [useShared, setUseShared] = React.useState(initial.useShared)
  const [scenes, setScenes] = React.useState<SceneState[]>(() =>
    initial.scenes.map(draftToState)
  )

  const [jobs, setJobs] = React.useState<QueueJobResponse[]>([])
  const [submittingScene, setSubmittingScene] = React.useState<number | null>(null)
  const [submittingAll, setSubmittingAll] = React.useState(false)
  const [merging, setMerging] = React.useState(false)
  const [extractingScene, setExtractingScene] = React.useState<number | null>(null)
  const [uploading, setUploading] = React.useState<Record<number, 'A' | 'B' | null>>({})
  const [enhanceScene, setEnhanceScene] = React.useState<number | null>(null)

  // ========================================
  // Persist draft
  // ========================================

  React.useEffect(() => {
    const t = window.setTimeout(() => {
      saveDraft({
        title,
        sharedRes,
        sharedAspect,
        useShared,
        scenes: scenes.map(stateToDraft),
      })
    }, 400)
    return () => window.clearTimeout(t)
  }, [title, sharedRes, sharedAspect, useShared, scenes])

  // ========================================
  // Poll queue
  // ========================================

  React.useEffect(() => {
    let mounted = true

    const load = async () => {
      try {
        const latest = await fetchGenerations(200)
        if (mounted) setJobs(latest)
      } catch {
        // ข้าม
      }
    }

    void load()
    const id = window.setInterval(() => void load(), POLL_INTERVAL_MS)
    return () => {
      mounted = false
      window.clearInterval(id)
    }
  }, [])

  const jobOf = React.useCallback(
    (scene: SceneState) => jobs.find((j) => j.id === scene.jobId),
    [jobs]
  )

  // ========================================
  // Scene handlers
  // ========================================

  const updateScene = (i: number, patch: Partial<SceneState>) => {
    setScenes((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)))
  }

  const pickFile = async (i: number, slot: 'A' | 'B', file: File) => {
    setUploading((p) => ({ ...p, [i]: slot }))
    try {
      const uploaded = await uploadReferenceFiles([file])
      const name = uploaded[0]?.stored_filename
      if (!name) throw new Error('อัปโหลดไม่สำเร็จ')

      const previewUrl = URL.createObjectURL(file)
      updateScene(i, slot === 'A' ? { slotA: { name, previewUrl } } : { slotB: { name, previewUrl } })
      toast.success(`อัปโหลดรูปฉาก ${i + 1} เข้า ComfyUI แล้ว`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'อัปโหลดรูปไม่สำเร็จ')
    } finally {
      setUploading((p) => ({ ...p, [i]: null }))
    }
  }

  const clearSlot = (i: number, slot: 'A' | 'B') => {
    updateScene(i, slot === 'A' ? { slotA: null } : { slotB: null })
  }

  const pullPrev = async (i: number) => {
    const prev = scenes[i - 1]
    const prevJob = prev ? jobOf(prev) : undefined

    if (!prevJob || prevJob.status !== 'DONE' || !prevJob.video_path) {
      toast.error(`ฉาก ${i} ยังไม่เสร็จ หรือไม่มีวิดีโอ — ยังดึงเฟรมไม่ได้`)
      return
    }

    setExtractingScene(i)
    try {
      const res = await extractFrame({
        path: prevJob.video_path,
        position: 'last',
        offset_from_end: 0,
        upload_to_comfyui: true,
      })

      if (!res.stored_filename) {
        throw new Error('ดึงเฟรมได้แต่ส่งเข้า ComfyUI ไม่สำเร็จ')
      }

      updateScene(i, {
        type: 'FL2VA',
        slotA: {
          name: res.stored_filename,
          framePath: res.frame_path,
          previewUrl: getFrameUrl(res.frame_path) ?? '',
        },
      })
      toast.success(`ดึง last frame จากฉาก ${i} มาเป็น first frame ฉาก ${i + 1} แล้ว`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'ดึงเฟรมไม่สำเร็จ')
    } finally {
      setExtractingScene(null)
    }
  }

  const buildPayload = (scene: SceneState) => {
    const res = scene.useOverride ? scene.res : sharedRes
    const aspect = scene.useOverride ? scene.aspect : sharedAspect

    const base = {
      prompt: scene.prompt.trim(),
      type: scene.type,
      resolution: res,
      aspect_ratio: aspect,
      steps: 6,
      seed: -1,
      duration_seconds: scene.duration,
    }

    if (scene.type === 'FL2VA') {
      return {
        ...base,
        first_frame_name: scene.slotA?.name ?? null,
        last_frame_name: scene.slotB?.name ?? null,
        reference_names: [],
      }
    }

    if (scene.type === 'REF2VA') {
      const refs = [scene.slotA?.name, scene.slotB?.name].filter((x): x is string => Boolean(x))
      return {
        ...base,
        first_frame_name: null,
        last_frame_name: null,
        reference_names: refs,
      }
    }

    return {
      ...base,
      first_frame_name: null,
      last_frame_name: null,
      reference_names: [],
    }
  }

  const validateScene = (scene: SceneState): string | null => {
    if (!scene.prompt.trim()) return 'กรุณากรอก prompt'
    if (scene.type === 'FL2VA' && !scene.slotA && !scene.slotB) return 'FL2VA ต้องมี first/last frame'
    if (scene.type === 'REF2VA' && !scene.slotA) return 'REF2VA ต้องมี reference อย่างน้อย 1'
    return null
  }

  const submitScene = async (i: number): Promise<string | null> => {
    const scene = scenes[i]
    const err = validateScene(scene)
    if (err) {
      toast.error(`ฉาก ${i + 1}: ${err}`)
      return null
    }

    setSubmittingScene(i)
    try {
      const job = await createGeneration(buildPayload(scene))
      updateScene(i, { jobId: job.id })
      toast.success(`ฉาก ${i + 1} เข้าคิวแล้ว`)
      return job.id
    } catch (e) {
      toast.error(`ฉาก ${i + 1}: ${e instanceof Error ? e.message : 'ส่งไม่สำเร็จ'}`)
      return null
    } finally {
      setSubmittingScene(null)
    }
  }

  const submitAll = async () => {
    setSubmittingAll(true)
    let count = 0
    try {
      for (let i = 0; i < scenes.length; i++) {
        const scene = scenes[i]
        if (!scene.prompt.trim()) continue
        const id = await submitScene(i)
        if (id) count++
      }
      if (count === 0) toast.error('ไม่มีฉากไหนพร้อมส่ง — กรอก prompt อย่างน้อย 1 ฉาก')
    } finally {
      setSubmittingAll(false)
    }
  }

  const clearScene = (i: number) => {
    setScenes((prev) =>
      prev.map((s, idx) => (idx === i ? { ...makeEmptyScene(), jobId: s.jobId } as SceneState : s))
    )
  }

  const clearAll = () => {
    if (!window.confirm('ล้างทุกฉาก (prompt + รูป + ลิงก์คิว) และลบร่างที่จำไว้?')) return
    setScenes([makeEmptyScene(), makeEmptyScene(), makeEmptyScene(), makeEmptyScene()].map(draftToState))
    setTitle('')
    clearDraft()
    toast.success('ล้างชุดหนังสั้นแล้ว')
  }

  // ========================================
  // Merge finished
  // ========================================

  const mergeFinished = async () => {
    const done = scenes
      .map((s) => ({ s, j: jobOf(s) }))
      .filter((x) => x.j && x.j.status === 'DONE' && x.j.video_path)

    if (done.length < 2) {
      toast.error('ต้องมีฉากที่เสร็จอย่างน้อย 2 ฉากจึงจะรวมได้')
      return
    }

    setMerging(true)
    try {
      const paths = done.map((x) => x.j!.video_path!)
      const res = await concatVideos({ paths, title: title.trim() || undefined })

      const now = new Date().toISOString()
      await fetch('/api/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: `merge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          prompt: title.trim() || `Merged ${done.length} scenes`,
          negative_prompt: null,
          type: 'MERGE',
          resolution: done[0].j!.resolution,
          steps: 0,
          seed: -1,
          task_adapter: null,
          lora_used: null,
          status: 'DONE',
          progress: 100,
          message: 'รวมคลิปจากชุดหนังสั้น',
          error: null,
          created_at: now,
          updated_at: now,
          reference_count: 0,
          reference_names: [],
          video_path: res.video_path,
          thumbnail_path: res.thumbnail_path,
          output_filename: res.video_path.split('/').pop() ?? null,
          duration: res.duration,
        }),
      })

      toast.success(`รวม ${done.length} ฉากสำเร็จ (${res.mode === 'copy' ? 'ไม่ encode ใหม่' : 'encode ใหม่'})`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'รวมคลิปไม่สำเร็จ')
    } finally {
      setMerging(false)
    }
  }

  // ========================================
  // Derived
  // ========================================

  const doneCount = scenes.filter((s) => jobOf(s)?.status === 'DONE').length
  const submittedCount = scenes.filter((s) => s.jobId).length

  /**
   * ค่าตั้งต้นของ popup สร้าง prompt:
   * - แนบรูปที่อัปโหลดไว้ในฉากนั้นให้อัตโนมัติ
   * - ถ้าเป็น FL2VA (ต่อฉาก) เลือก template "continuation" ให้เลย
   */
  const enhanceSeed = React.useMemo(() => {
    const empty = {
      images: [] as Array<{ name: string; previewUrl?: string }>,
      templateId: 'cinematic_fl2v',
    }

    if (enhanceScene === null) return empty

    const scene = scenes[enhanceScene]
    if (!scene) return empty

    const images = [scene.slotA, scene.slotB]
      .filter((slot): slot is SlotState => Boolean(slot && slot.name))
      .map((slot) => ({ name: slot.name, previewUrl: slot.previewUrl }))

    return {
      images,
      templateId: scene.type === 'FL2VA' ? 'continuation' : 'cinematic_fl2v',
    }
  }, [enhanceScene, scenes])

  // ========================================
  // Render
  // ========================================

  return (
    <div className="grid gap-6">
      {/* Header + shared settings */}
      <Card className="shadow-lg">
        <CardHeader className="border-b border-border bg-card/60 backdrop-blur">
          <CardTitle className="flex items-center gap-3 text-xl">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Film className="h-5 w-5" />
            </span>
            สร้างหนังสั้น
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            วาง 4 ฉาก กดเพิ่มเข้าคิวเรียงกัน — ฉากไหนส่งก่อนได้คิวก่อน · เสร็จแล้วรวมเป็นคลิปเดียว
          </p>
        </CardHeader>

        <CardContent className="grid gap-4 p-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <label className="text-xs font-medium">ชื่อเรื่อง (ไม่บังคับ)</label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="เช่น เรื่องสั้นตอนเช้า"
                className="h-9 text-sm"
              />
            </div>

            <div className="grid gap-1.5">
              <label className="text-xs font-medium">Resolution ร่วม</label>
              <select
                value={sharedRes}
                onChange={(e) => setSharedRes(e.target.value)}
                disabled={!useShared}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm shadow-sm disabled:opacity-50"
              >
                {RESOLUTIONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-1.5">
              <label className="text-xs font-medium">Aspect ร่วม</label>
              <select
                value={sharedAspect}
                onChange={(e) => setSharedAspect(e.target.value)}
                disabled={!useShared}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm shadow-sm disabled:opacity-50"
              >
                {ASPECT_RATIOS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={useShared}
              onChange={(e) => setUseShared(e.target.checked)}
              className="h-4 w-4 rounded border-input"
            />
            บังคับใช้ Resolution/Aspect ร่วมทุกฉาก (ปิดเพื่อใช้ค่ารายฉาก)
          </label>
        </CardContent>
      </Card>

      {/* 4 scene cards */}
      <div className="grid gap-4 lg:grid-cols-2">
        {scenes.map((scene, i) => (
          <SceneCard
            key={i}
            index={i}
            scene={scene}
            job={jobOf(scene)}
            submitting={submittingScene === i}
            extracting={extractingScene === i}
            canPullPrev={i > 0 && jobOf(scenes[i - 1])?.status === 'DONE'}
            uploadingSlot={uploading[i] ?? null}
            onUpdate={(patch) => updateScene(i, patch)}
            onPickFile={(slot, f) => void pickFile(i, slot, f)}
            onClearSlot={(slot) => clearSlot(i, slot)}
            onPullPrev={() => void pullPrev(i)}
            onSubmit={() => void submitScene(i)}
            onClearScene={() => clearScene(i)}
            onEnhance={() => setEnhanceScene(i)}
          />
        ))}
      </div>

      {/* Film action bar */}
      <Card className="shadow-lg">
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <span className="text-sm font-medium">
            ส่งแล้ว {submittedCount}/4 · เสร็จ {doneCount}/4
          </span>

          {submittedCount > 0 && (
            <span className="flex flex-wrap gap-1">
              {scenes.map((s, i) => {
                const j = jobOf(s)
                return (
                  <span
                    key={i}
                    className={cn(
                      'rounded-full px-2 py-0.5 font-mono text-[10px]',
                      j ? statusClasses(j.status) : 'bg-muted text-muted-foreground'
                    )}
                  >
                    ฉาก{i + 1}: {j ? j.status : '-'}
                  </span>
                )
              })}
            </span>
          )}

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void mergeFinished()}
              disabled={merging || doneCount < 2}
            >
              {merging ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Merge className="mr-2 h-4 w-4" />
              )}
              รวมคลิปที่เสร็จ
            </Button>

            <Button
              type="button"
              size="sm"
              onClick={() => void submitAll()}
              disabled={submittingAll}
            >
              {submittingAll ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Play className="mr-2 h-4 w-4" />
              )}
              ส่งทั้งหมด (เรียง 1→4)
            </Button>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={clearAll}
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              ล้างทั้งหมด
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* hint */}
      {scenes.some((s) => !s.prompt.trim()) && (
        <div className="flex items-start gap-2 rounded-xl border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            เคล็ดลับ: ฉากแรกใช้ T2V/REF2VA ตั้งฉาก · ฉากถัดไปกด &quot;ดึง last frame จากฉากก่อน&quot;
            แล้วแก้ prompt เป็น &quot;continuing the same motion...&quot; จะได้คลิปต่อเนื่องกัน
          </span>
        </div>
      )}

      <PromptEnhanceDialog
        open={enhanceScene !== null}
        onClose={() => setEnhanceScene(null)}
        onApply={(text) => {
          if (enhanceScene !== null) updateScene(enhanceScene, { prompt: text })
        }}
        initialImages={enhanceSeed.images}
        defaultTemplateId={enhanceSeed.templateId}
      />
    </div>
  )
}