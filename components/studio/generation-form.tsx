'use client'

/**
 * ========================================
 * GenerationForm (v10 - FL2VA two frame slots)
 * ========================================
 * - REF2VA / T2V / FL2VA
 * - FL2VA: ช่อง First frame + Last frame (อย่างน้อย 1, ใส่ทั้งคู่ = interpolation)
 * - ปุ่ม "ต่อคลิป" จาก Media/เฟรม ยัดลงช่อง First frame ให้อัตโนมัติ
 */

import * as React from 'react'
import {
  AlertCircle,
  CheckCircle2,
  ChevronUp,
  Clapperboard,
  Download,
  ExternalLink,
  Image as ImageIcon,
  Loader2,
  Music,
  Play,
  Sparkles,
  Square,
  Trash2,
  Upload,
  Video,
  X,
} from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  BACKEND_URL,
  cancelGeneration,
  checkBackendHealth,
  clearFinishedGenerations,
  createGeneration,
  deleteGeneration,
  fetchGenerations,
  getMediaUrl,
  uploadReferenceFiles,
  type QueueJobResponse,
} from '@/lib/backend'
import { takeChainHandoff } from '@/lib/chain-handoff'
import { useHotkeys } from '@/lib/use-hotkeys'
import { DropZone } from '@/components/ui/drop-zone'
import { PromptEnhanceDialog } from '@/components/studio/prompt-enhance-dialog'
import { cn } from '@/lib/utils'

// ========================================
// Constants
// ========================================

const RESOLUTIONS = [
  { value: '0.1 MP', label: '0.1 MP (เร็วมาก / เบามาก)' },
  { value: '0.25 MP', label: '0.25 MP (เร็ว / เบา)' },
  { value: '0.35 MP', label: '0.35 MP (ประมาณ 480p)' },
  { value: '0.5 MP', label: '0.5 MP (แนะนำเริ่มต้น)' },
  { value: '0.75 MP', label: '0.75 MP (ชัดขึ้น)' },
  { value: '1.0 MP', label: '1.0 MP (ประมาณ 768p)' },
] as const

const ASPECT_RATIOS = [
  { value: '16:9 (Widescreen)', label: '16:9 แนวนอน' },
  { value: '9:16 (Portrait Widescreen)', label: '9:16 แนวตั้ง' },
  { value: '1:1 (Square)', label: '1:1 จตุรัส' },
  { value: '2:3 (Portrait Photo)', label: '2:3 แนวตั้ง (Photo)' },
  { value: '3:2 (Photo)', label: '3:2 แนวนอน (Photo)' },
  { value: '3:4 (Portrait Standard)', label: '3:4 แนวตั้ง (Standard)' },
  { value: '4:3 (Standard)', label: '4:3 แนวนอน (Standard)' },
  { value: '21:9 (Ultrawide)', label: '21:9 จอกว้างพิเศษ' },
] as const

const GENERATION_TYPES = [
  { value: 'REF2VA', label: 'Reference to Video (REF2VA)' },
  { value: 'T2V', label: 'Text to Video (T2V)' },
  { value: 'FL2VA', label: 'First/Last Frame to Video (FL2VA)' },
  { value: 'REF2VA_LOW', label: 'Reference to Video (REF2VA) — Low VRAM' },
  { value: 'T2V_LOW', label: 'Text to Video (T2V) — Low VRAM' },
  { value: 'FL2VA_LOW', label: 'First/Last Frame to Video (FL2VA) — Low VRAM' },
] as const

type GenerationType = (typeof GENERATION_TYPES)[number]['value']

const DEFAULT_STEPS = 6
const DEFAULT_SEED = -1
const DEFAULT_RESOLUTION = '0.5 MP'
const DEFAULT_ASPECT_RATIO = '16:9 (Widescreen)'
const DEFAULT_TYPE = 'REF2VA'
const DEFAULT_DURATION = 5

const DURATIONS = [
  { value: 5, label: '5 วินาที' },
  { value: 8, label: '8 วินาที' },
  { value: 10, label: '10 วินาที' },
  { value: 12, label: '12 วินาที' },
  { value: 15, label: '15 วินาที (สูงสุดแนะนำ)' },
] as const

const POLL_INTERVAL_MS = 2000
const HISTORY_PERSIST_STATUSES = new Set(['DONE', 'CANCELLED', 'FAILED'])

const LINK_BUTTON_BASE =
  'inline-flex h-9 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50'

const MEDIA_BOX_CLASS =
  'relative inline-flex h-[300px] w-[300px] items-center justify-center overflow-hidden rounded-lg border border-border bg-black'

const LINK_BUTTON_OUTLINE =
  `${LINK_BUTTON_BASE} border border-input bg-background text-foreground shadow-sm hover:bg-accent hover:text-accent-foreground`

const LINK_BUTTON_GHOST =
  `${LINK_BUTTON_BASE} text-foreground hover:bg-accent hover:text-accent-foreground`

// ========================================
// Types
// ========================================

interface ReferenceItem {
  id: string
  file: File
  previewUrl: string
  kind: 'image' | 'video' | 'audio'
  /** ความยาวไฟล์เสียง (วินาที) — ใช้เตือนถ้าเสียงยาวกว่า Duration */
  durationSec?: number
}

interface FrameSlotValue {
  /** stored_filename ใน ComfyUI (ถ้าอัปโหลดไปแล้ว) */
  name?: string
  /** ไฟล์ที่เลือกเอง ยังไม่อัปโหลด */
  file?: File
  previewUrl: string
  label?: string
}

interface HistoryUpsertPayload {
  id: string
  prompt: string
  negative_prompt?: string | null
  type: string
  resolution: string
  steps: number
  seed: number
  task_adapter?: string | null
  lora_used?: string | null
  status: string
  progress: number
  message?: string
  error?: string | null
  created_at: string
  updated_at: string
  reference_count?: number
  reference_names?: string[]
  video_path?: string | null
  thumbnail_path?: string | null
  output_filename?: string | null
  duration?: number | null
}

// ========================================
// Helpers
// ========================================

function isBackendHealthOk(result: unknown): boolean {
  if (typeof result === 'boolean') return result
  if (!result || typeof result !== 'object') return false

  const record = result as Record<string, unknown>

  if (typeof record.ok === 'boolean') return record.ok
  if (typeof record.healthy === 'boolean') return record.healthy
  if (typeof record.status === 'string') return record.status.toLowerCase() === 'ok'

  return false
}

function getStatusClasses(status: string): string {
  switch (status) {
    case 'DONE':
      return 'bg-green-500/10 text-green-600 dark:text-green-400'
    case 'FAILED':
      return 'bg-destructive/10 text-destructive'
    case 'CANCELLED':
      return 'bg-orange-500/10 text-orange-600 dark:text-orange-400'
    case 'RUNNING':
      return 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
    case 'PENDING':
      return 'bg-muted text-muted-foreground'
    default:
      return 'bg-muted text-muted-foreground'
  }
}

function isFinishedStatus(status: string): boolean {
  return HISTORY_PERSIST_STATUSES.has(status)
}

function detectKind(file: File): 'image' | 'video' | 'audio' {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('video/')) return 'video'
  if (file.type.startsWith('audio/')) return 'audio'
  return 'image'
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString()
  } catch {
    return '-'
  }
}

function formatDuration(seconds?: number | null): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '-'
  if (seconds < 60) return `${seconds.toFixed(1)} วินาที`
  const minutes = Math.floor(seconds / 60)
  const remainSeconds = Math.round(seconds % 60)
  return `${minutes} นาที ${remainSeconds} วินาที`
}

// ========================================
// Frame slot card
// ========================================

function FrameSlotCard(props: {
  title: string
  hint: string
  value: FrameSlotValue | null
  inputRef: React.RefObject<HTMLInputElement | null>
  onFile: (file: File) => void
  onClear: () => void
}) {
  const { title, hint, value, inputRef, onFile, onClear } = props

  return (
    <div className="grid gap-2 rounded-xl border border-border bg-muted/20 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold">{title}</span>
        {value && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onClear}
            aria-label={`ล้าง ${title}`}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      <div className="relative h-32 w-full overflow-hidden rounded-lg border border-border bg-black">
        {value && value.previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value.previewUrl} alt={title} className="h-full w-full object-contain" />
        ) : value ? (
          <span className="flex h-full w-full flex-col items-center justify-center gap-1 text-muted-foreground">
            <ImageIcon className="h-6 w-6" />
            <span className="text-[10px]">แนบแล้ว (ไม่มี preview)</span>
          </span>
        ) : (
          <span className="flex h-full w-full flex-col items-center justify-center gap-1 text-muted-foreground">
            <ImageIcon className="h-6 w-6" />
            <span className="text-[10px]">ยังไม่ได้เลือกรูป</span>
          </span>
        )}
      </div>

      <p className="text-[10px] leading-relaxed text-muted-foreground">{hint}</p>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 text-xs"
          onClick={() => inputRef.current?.click()}
        >
          <Upload className="mr-1.5 h-3.5 w-3.5" />
          เลือกไฟล์
        </Button>

        {value?.name && (
          <span className="truncate font-mono text-[10px] text-muted-foreground" title={value.name}>
            {value.name}
          </span>
        )}
        {value?.label && !value.name && (
          <span className="truncate text-[10px] text-muted-foreground">จากคลิป: {value.label}</span>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) onFile(file)
          event.target.value = ''
        }}
      />
    </div>
  )
}

// ========================================
// Component
// ========================================

export function GenerationForm() {
  const [prompt, setPrompt] = React.useState('')
  const [negativePrompt, setNegativePrompt] = React.useState('')
  const [type, setType] = React.useState<GenerationType>(DEFAULT_TYPE)
  const [resolution, setResolution] = React.useState<string>(DEFAULT_RESOLUTION)
  const [aspectRatio, setAspectRatio] = React.useState<string>(DEFAULT_ASPECT_RATIO)
  const [steps, setSteps] = React.useState<number>(DEFAULT_STEPS)
  const [seed, setSeed] = React.useState<number>(DEFAULT_SEED)
  const [duration, setDuration] = React.useState<number>(DEFAULT_DURATION)
  const [taskAdapter, setTaskAdapter] = React.useState<string>('')
  const [loraUsed, setLoraUsed] = React.useState<string>('')

  const [references, setReferences] = React.useState<ReferenceItem[]>([])
  const [audioReferences, setAudioReferences] = React.useState<ReferenceItem[]>([])

  const [firstFrame, setFirstFrame] = React.useState<FrameSlotValue | null>(null)
  const [lastFrame, setLastFrame] = React.useState<FrameSlotValue | null>(null)

  const [jobs, setJobs] = React.useState<QueueJobResponse[]>([])
  const [backendOk, setBackendOk] = React.useState<boolean>(false)
  const [isSubmitting, setIsSubmitting] = React.useState<boolean>(false)
  const [error, setError] = React.useState<string | null>(null)

  const [expandedVideoId, setExpandedVideoId] = React.useState<string | null>(null)
  const [enhanceOpen, setEnhanceOpen] = React.useState(false)

  const fileInputRef = React.useRef<HTMLInputElement | null>(null)
  const audioInputRef = React.useRef<HTMLInputElement | null>(null)
  const formRef = React.useRef<HTMLFormElement | null>(null)
  const firstFrameInputRef = React.useRef<HTMLInputElement | null>(null)
  const lastFrameInputRef = React.useRef<HTMLInputElement | null>(null)

  useHotkeys({
    'mod+enter': (e) => {
      e.preventDefault()
      formRef.current?.requestSubmit()
    },
  })

  const baseType = type.endsWith('_LOW') ? type.slice(0, -4) : type
  const needsReference = baseType === 'REF2VA'
  const isFl2va = baseType === 'FL2VA'
  const hasAnyFrame = Boolean(firstFrame) || Boolean(lastFrame)

  // ========================================
  // รับงาน "ต่อคลิป" จาก Media / Frames
  // ========================================

  React.useEffect(() => {
    const handoff = takeChainHandoff()
    if (!handoff) return

    setType('FL2VA')
    setPrompt(handoff.prompt)
    setFirstFrame({
      name: handoff.referenceName,
      previewUrl: '',
      label: handoff.sourceLabel,
    })
    setError(null)

    toast.success('แนบเฟรมสุดท้ายลงช่อง First frame แล้ว — ปรับ prompt แล้วกดสร้างได้เลย')
  }, [])

  
  const loadJobs = React.useCallback(async () => {
    try {
      const latest = await fetchGenerations()
      setJobs(latest)
    } catch (err) {
      console.error('[GenerationForm] โหลด queue ไม่สำเร็จ:', err)
    }
  }, [])

  React.useEffect(() => {
    let mounted = true

    const run = async () => {
      const health = await checkBackendHealth()
      const ok = isBackendHealthOk(health)
      if (!mounted) return
      setBackendOk(ok)
      if (ok) await loadJobs()
    }

    void run()

    const interval = window.setInterval(() => {
      void loadJobs()
    }, POLL_INTERVAL_MS)

    return () => {
      mounted = false
      window.clearInterval(interval)
    }
  }, [loadJobs])

  // ========================================
  // Reference / frame handlers
  // ========================================

  const addReferences = (files: File[] | FileList | null) => {
    if (!files || files.length === 0) return

    const next: ReferenceItem[] = []
    for (const file of Array.from(files)) {
      next.push({
        id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`,
        file,
        previewUrl: URL.createObjectURL(file),
        kind: detectKind(file),
      })
    }
    setReferences((prev) => [...prev, ...next].slice(0, 9))
  }

  const removeReference = (id: string) => {
    setReferences((prev) => {
      const target = prev.find((r) => r.id === id)
      if (target) URL.revokeObjectURL(target.previewUrl)
      return prev.filter((r) => r.id !== id)
    })
  }

  const clearReferences = () => {
    setReferences((prev) => {
      prev.forEach((r) => URL.revokeObjectURL(r.previewUrl))
      return []
    })
  }

  // ========================================
  // Audio reference handlers (lipsync, สูงสุด 3)
  // ========================================

  const addAudioReferences = (files: File[] | FileList | null) => {
    if (!files || files.length === 0) return

    const picked = Array.from(files).filter(
      (f) => f.type.startsWith('audio/') || /\.(mp3|wav|flac|m4a|aac|ogg)$/i.test(f.name)
    )

    if (picked.length === 0) {
      toast.error('กรุณาเลือกไฟล์เสียงเท่านั้น (.mp3 / .wav)')
      return
    }

    const room = 3 - audioReferences.length
    if (room <= 0) {
      toast.error('ใส่ไฟล์เสียงได้สูงสุด 3 ไฟล์')
      return
    }

    const next: ReferenceItem[] = picked.slice(0, room).map((file) => ({
      id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`,
      file,
      previewUrl: URL.createObjectURL(file),
      kind: 'audio' as const,
    }))

    setAudioReferences((prev) => [...prev, ...next])

    if (picked.length > room) {
      toast.warning(`เพิ่มได้ ${room} ไฟล์ (เกินโควตา 3 ไฟล์)`)
    }

    // อ่านความยาวเสียงไว้เทียบกับ Duration ที่เลือก
    next.forEach((item) => {
      const probe = new Audio()
      probe.preload = 'metadata'
      probe.onloadedmetadata = () => {
        const sec = Number.isFinite(probe.duration) ? probe.duration : null
        if (sec === null) return
        setAudioReferences((prev) =>
          prev.map((r) => (r.id === item.id ? { ...r, durationSec: sec } : r))
        )
      }
      probe.src = item.previewUrl
    })
  }

  const removeAudioReference = (id: string) => {
    setAudioReferences((prev) => {
      const target = prev.find((r) => r.id === id)
      if (target) URL.revokeObjectURL(target.previewUrl)
      return prev.filter((r) => r.id !== id)
    })
  }

  const clearAudioReferences = () => {
    setAudioReferences((prev) => {
      prev.forEach((r) => URL.revokeObjectURL(r.previewUrl))
      return []
    })
  }

  const pickFirstFrame = (file: File) => {
    if (firstFrame?.file) URL.revokeObjectURL(firstFrame.previewUrl)
    setFirstFrame({ file, previewUrl: URL.createObjectURL(file) })
  }

  const pickLastFrame = (file: File) => {
    if (lastFrame?.file) URL.revokeObjectURL(lastFrame.previewUrl)
    setLastFrame({ file, previewUrl: URL.createObjectURL(file) })
  }

  const clearFirstFrame = () => {
    if (firstFrame?.file) URL.revokeObjectURL(firstFrame.previewUrl)
    setFirstFrame(null)
  }

  const clearLastFrame = () => {
    if (lastFrame?.file) URL.revokeObjectURL(lastFrame.previewUrl)
    setLastFrame(null)
  }

  // ========================================
  // Queue handlers
  // ========================================

  const handleCancelJob = async (jobId: string) => {
    try {
      await cancelGeneration(jobId)
      toast.success('ส่งคำขอยกเลิกแล้ว')
      await loadJobs()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'ยกเลิกงานไม่สำเร็จ')
    }
  }

  const handleRemoveJob = async (jobId: string) => {
    try {
      await deleteGeneration(jobId)
      setJobs((prev) => prev.filter((j) => j.id !== jobId))
      toast.success('ลบงานออกจาก queue แล้ว')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'ลบงานไม่สำเร็จ')
    }
  }

  const handleClearFinishedJobs = async () => {
    try {
      await clearFinishedGenerations()
      await loadJobs()
      toast.success('ล้างงานเสร็จแล้ว')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'ล้างงานไม่สำเร็จ')
    }
  }

  // ========================================
  // Submit
  // ========================================

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)

    if (!backendOk) {
      const msg = 'FastAPI backend ยังไม่พร้อม กรุณาเปิด backend ที่ port 8000 ก่อน'
      setError(msg)
      toast.error(msg)
      return
    }

    const trimmedPrompt = prompt.trim()

    if (!trimmedPrompt) {
      const msg = 'กรุณากรอก prompt ก่อนสร้างวิดีโอ'
      setError(msg)
      toast.error(msg)
      return
    }

    if (needsReference && references.length === 0) {
      const msg = 'REF2VA ต้องมี reference อย่างน้อย 1 ไฟล์'
      setError(msg)
      toast.error(msg)
      return
    }

    if (isFl2va && !hasAnyFrame) {
      const msg = 'FL2VA ต้องมี First frame หรือ Last frame อย่างน้อย 1 ช่อง'
      setError(msg)
      toast.error(msg)
      return
    }

    setIsSubmitting(true)

    try {
      let referenceNames: string[] = []
      let audioReferenceNames: string[] = []
      let firstName: string | null = firstFrame?.name ?? null
      let lastName: string | null = lastFrame?.name ?? null

      if (needsReference && references.length > 0) {
        const uploaded = await uploadReferenceFiles(references.map((ref) => ref.file))
        referenceNames = uploaded.map((item) => item.stored_filename)
        toast.success(`อัปโหลด reference สำเร็จ ${uploaded.length} ไฟล์ เข้า ComfyUI/input แล้ว`)
      }

      if (needsReference && audioReferences.length > 0) {
        const uploadedAudio = await uploadReferenceFiles(audioReferences.map((ref) => ref.file))
        audioReferenceNames = uploadedAudio.map((item) => item.stored_filename)
        toast.success(`อัปโหลดไฟล์เสียงสำเร็จ ${uploadedAudio.length} ไฟล์ เข้า ComfyUI/input แล้ว`)
      }

      if (isFl2va) {
        const pending: Array<{ slot: 'first' | 'last'; file: File }> = []
        if (firstFrame?.file) pending.push({ slot: 'first', file: firstFrame.file })
        if (lastFrame?.file) pending.push({ slot: 'last', file: lastFrame.file })

        if (pending.length > 0) {
          const uploaded = await uploadReferenceFiles(pending.map((p) => p.file))
          pending.forEach((p, index) => {
            const stored = uploaded[index]?.stored_filename
            if (!stored) return
            if (p.slot === 'first') firstName = stored
            else lastName = stored
          })
          toast.success(`อัปโหลดเฟรมสำเร็จ ${uploaded.length} ไฟล์ เข้า ComfyUI/input แล้ว`)
        }
      }

      const job = await createGeneration({
        prompt: trimmedPrompt,
        negative_prompt: needsReference ? negativePrompt.trim() || undefined : undefined,
        type,
        resolution,
        aspect_ratio: aspectRatio,
        steps,
        seed,
        duration_seconds: duration,
        task_adapter: taskAdapter.trim() || undefined,
        lora_used: loraUsed.trim() || undefined,
        reference_names: needsReference ? referenceNames : [],
        audio_reference_names: needsReference ? audioReferenceNames : [],
        first_frame_name: isFl2va ? firstName : null,
        last_frame_name: isFl2va ? lastName : null,
      })

      setJobs((prev) => [job, ...prev.filter((item) => item.id !== job.id)])
      toast.success('เพิ่มงานเข้าคิวเรียบร้อย')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'สร้างงานไม่สำเร็จ'
      setError(msg)
      toast.error(msg)
    } finally {
      setIsSubmitting(false)
    }
  }

  const hasFinished = jobs.some((job) => isFinishedStatus(job.status))
  const isRunning = jobs.some((job) => job.status === 'RUNNING' || job.status === 'PENDING')

  // ========================================
  // Render
  // ========================================

  return (
    <div className="grid gap-6">
      <Card className="shadow-lg">
        <CardHeader className="border-b border-border bg-card/60 backdrop-blur">
          <CardTitle className="flex items-center gap-3 text-xl">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Clapperboard className="h-5 w-5" />
            </span>
            สร้างวิดีโอสั้น
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            ส่งงานเข้าคิว → ComfyUI รัน REF2VA/T2V/FL2VA จริง → ผลลัพธ์เป็นวิดีโอพร้อม thumbnail ในเครื่องคุณ
          </p>
        </CardHeader>

        <CardContent className="p-5">
          <form ref={formRef} onSubmit={handleSubmit} className="grid gap-5">
            {/* Prompt */}
            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="prompt" className="text-sm font-medium">
                  Prompt
                </label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setEnhanceOpen(true)}
                >
                  <Sparkles className="mr-1.5 h-3.5 w-3.5 text-primary" />
                  สร้าง prompt จากรูป
                </Button>
              </div>
              <Textarea
                id="prompt"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder={
                  isFl2va
                    ? 'continuing the same motion, ... (อธิบายสิ่งที่เกิดขึ้นต่อจากเฟรมตั้งต้น)'
                    : 'อธิบายฉากที่ต้องการ เช่น ตัวละคร, กล้อง, แสง, เสียง'
                }
                className="min-h-32 resize-y"
              />
              {isFl2va && firstFrame && lastFrame && (
                <p className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-primary">
                  ใส่ทั้ง First + Last frame = โหมด interpolation (A→B) — เหมาะทำ transition
                  เนียนระหว่างสองฉาก แทนการ crossfade ในโปรแกรมตัดต่อ
                </p>
              )}
            </div>

            {/* Negative prompt (REF2VA เท่านั้น) */}
            {needsReference && (
              <div className="grid gap-2">
                <label htmlFor="negative-prompt" className="text-sm font-medium">
                  Negative Prompt (ไม่บังคับ)
                </label>
                <Textarea
                  id="negative-prompt"
                  value={negativePrompt}
                  onChange={(event) => setNegativePrompt(event.target.value)}
                  placeholder="สิ่งที่ไม่อยากให้เกิดในวิดีโอ"
                  className="min-h-20 resize-y"
                />
              </div>
            )}

            {/* Type + Resolution + Aspect Ratio */}
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="grid gap-2">
                <label htmlFor="type" className="text-sm font-medium">
                  ประเภทงาน
                </label>
                <select
                  id="type"
                  value={type}
                  onChange={(event) => {
                    const next = event.target.value as GenerationType
                    const nextBase = next.endsWith('_LOW') ? next.slice(0, -4) : next
                    setType(next)
                    if (nextBase !== 'FL2VA') {
                      clearFirstFrame()
                      clearLastFrame()
                    }
                    if (nextBase !== 'REF2VA') {
                      clearAudioReferences()
                    }
                  }}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {GENERATION_TYPES.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid gap-2">
                <label htmlFor="resolution" className="text-sm font-medium">
                  Resolution
                </label>
                <select
                  id="resolution"
                  value={resolution}
                  onChange={(event) => setResolution(event.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {RESOLUTIONS.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid gap-2">
                <label htmlFor="aspect-ratio" className="text-sm font-medium">
                  Aspect Ratio
                </label>
                <select
                  id="aspect-ratio"
                  value={aspectRatio}
                  onChange={(event) => setAspectRatio(event.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {ASPECT_RATIOS.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Steps + Seed + Duration */}
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="grid gap-2">
                <label htmlFor="steps" className="text-sm font-medium">
                  Steps
                </label>
                <Input
                  id="steps"
                  type="number"
                  min={1}
                  max={50}
                  value={steps}
                  onChange={(event) => {
                    const value = Number(event.target.value)
                    setSteps(
                      Number.isFinite(value) ? Math.min(50, Math.max(1, Math.trunc(value))) : DEFAULT_STEPS
                    )
                  }}
                />
              </div>

              <div className="grid gap-2">
                <label htmlFor="seed" className="text-sm font-medium">
                  Seed (-1 = สุ่ม)
                </label>
                <Input
                  id="seed"
                  type="number"
                  value={seed}
                  onChange={(event) => {
                    const value = Number(event.target.value)
                    setSeed(Number.isFinite(value) ? Math.trunc(value) : DEFAULT_SEED)
                  }}
                />
              </div>

              <div className="grid gap-2">
                <label htmlFor="duration" className="text-sm font-medium">
                  Duration
                </label>
                <select
                  id="duration"
                  value={duration}
                  onChange={(event) => setDuration(Number(event.target.value))}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {DURATIONS.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
                {isFl2va && duration > 5 && (
                  <p className="text-[10px] text-muted-foreground">
                    FL2VA ช่วงยาวเหมาะกับการ interpolate / ต่อฉากพูด
                  </p>
                )}
              </div>
            </div>

            {/* Adapter + LoRA */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <label htmlFor="task-adapter" className="text-sm font-medium">
                  Task Adapter (ไม่บังคับ)
                </label>
                <Input
                  id="task-adapter"
                  value={taskAdapter}
                  onChange={(event) => setTaskAdapter(event.target.value)}
                  placeholder="เช่น ref2va, t2v, fl2va"
                />
              </div>

              <div className="grid gap-2">
                <label htmlFor="lora-used" className="text-sm font-medium">
                  LoRA (ไม่บังคับ)
                </label>
                <Input
                  id="lora-used"
                  value={loraUsed}
                  onChange={(event) => setLoraUsed(event.target.value)}
                  placeholder="ชื่อไฟล์ LoRA ใน ComfyUI/models/loras"
                />
              </div>
            </div>

            {/* ========================================
                FL2VA: First / Last frame slots
                ======================================== */}
            {isFl2va && (
              <div className="grid gap-3">
                <label className="text-sm font-medium">
                  เฟรมตั้งต้น (อย่างน้อย 1 ช่อง)
                </label>

                <div className="grid gap-3 sm:grid-cols-2">
                  <FrameSlotCard
                    title="First frame — เริ่มคลิปจากภาพนี้"
                    hint="ใช้ต่อคลิปจากเฟรมสุดท้ายของคลิปก่อนหน้า หรือเริ่มฉากจากภาพที่กำหนด"
                    value={firstFrame}
                    inputRef={firstFrameInputRef}
                    onFile={pickFirstFrame}
                    onClear={clearFirstFrame}
                  />

                  <FrameSlotCard
                    title="Last frame — จบคลิปที่ภาพนี้"
                    hint="ล็อกจุดจบของคลิป · ใส่ทั้งคู่เพื่อทำ interpolation A→B (transition)"
                    value={lastFrame}
                    inputRef={lastFrameInputRef}
                    onFile={pickLastFrame}
                    onClear={clearLastFrame}
                  />
                </div>
              </div>
            )}

            {/* ========================================
                REF2VA: Reference upload
                ======================================== */}
            {needsReference && (
              <div className="grid gap-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="grid gap-0.5">
                    <label className="text-sm font-medium">
                      Reference images (สูงสุด 9 ไฟล์)
                    </label>
                    <span className="text-[10px] text-muted-foreground">
                      อ้างใน prompt ด้วย &lt;Picture 1&gt; … &lt;Picture 9&gt; · ยิ่งใส่หลายรูปยิ่งช้า
                    </span>
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="mr-2 h-4 w-4" />
                    เลือกไฟล์
                  </Button>

                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => {
                      addReferences(event.target.files)
                      event.target.value = ''
                    }}
                  />
                </div>

                {references.length === 0 ? (
                  <DropZone
                    onFiles={(files) => addReferences(files)}
                    accept="image/*"
                    multiple
                    title="ลากรูปมาวางที่นี่ หรือคลิกเพื่อเลือก"
                    hint="REF2VA ต้องมีรูปภาพอย่างน้อย 1 ไฟล์ (สูงสุด 9)"
                  />
                ) : (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                    {references.map((ref) => (
                      <div
                        key={ref.id}
                        className="group relative aspect-square overflow-hidden rounded-lg border border-border bg-muted/30"
                      >
                        {ref.kind === 'image' && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={ref.previewUrl} alt={ref.file.name} className="h-full w-full object-cover" />
                        )}
                        {ref.kind === 'video' && (
                          <video src={ref.previewUrl} className="h-full w-full object-cover" muted playsInline />
                        )}
                        {ref.kind === 'audio' && (
                          <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted-foreground">
                            <Music className="h-8 w-8" />
                            <span className="px-2 text-center text-[10px]">{ref.file.name}</span>
                          </div>
                        )}

                        <div className="absolute left-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white">
                          {ref.kind === 'image' && <ImageIcon className="h-3.5 w-3.5" />}
                          {ref.kind === 'video' && <Video className="h-3.5 w-3.5" />}
                          {ref.kind === 'audio' && <Music className="h-3.5 w-3.5" />}
                        </div>

                        <button
                          type="button"
                          onClick={() => removeReference(ref.id)}
                          className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/70 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100"
                          aria-label={`ลบ ${ref.file.name}`}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>

                        <div className="absolute inset-x-0 bottom-0 bg-black/70 px-2 py-1 text-[10px] text-white">
                          {ref.file.name}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {references.length > 0 && (
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={clearReferences}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      ล้าง reference ทั้งหมด
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/* ========================================
                REF2VA: Audio Reference (lipsync)
                ======================================== */}
            {needsReference && (
              <div className="grid gap-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="grid gap-0.5">
                    <label className="text-sm font-medium">
                      Audio Reference — lipsync (ไม่บังคับ)
                    </label>
                    <span className="text-[10px] text-muted-foreground">
                      สูงสุด 3 ไฟล์ · อ้างใน prompt ด้วย &lt;Audio 1&gt; &lt;Audio 2&gt; &lt;Audio 3&gt;
                    </span>
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => audioInputRef.current?.click()}
                    disabled={audioReferences.length >= 3}
                  >
                    <Upload className="mr-2 h-4 w-4" />
                    เลือกไฟล์เสียง
                  </Button>

                  <input
                    ref={audioInputRef}
                    type="file"
                    multiple
                    accept="audio/*"
                    className="hidden"
                    onChange={(event) => {
                      addAudioReferences(event.target.files)
                      event.target.value = ''
                    }}
                  />
                </div>

                {audioReferences.length === 0 ? (
                  <DropZone
                    compact
                    accept="audio/*"
                    multiple
                    onFiles={(files) => addAudioReferences(files)}
                    title="ลากไฟล์เสียงมาวางที่นี่ หรือคลิกเพื่อเลือก"
                    hint=".mp3 / .wav · ความยาวเสียงควรใกล้เคียง Duration ที่เลือก"
                  />
                ) : (
                  <div className="grid gap-2">
                    {audioReferences.map((ref, index) => {
                      const tooLong =
                        ref.durationSec != null && ref.durationSec > duration + 0.6

                      return (
                        <div
                          key={ref.id}
                          className="grid gap-2 rounded-xl border border-border bg-muted/20 p-3"
                        >
                          <div className="flex items-center gap-2">
                            <span className="flex h-6 shrink-0 items-center rounded-full bg-primary/15 px-2 font-mono text-[10px] font-bold text-primary">
                              Audio {index + 1}
                            </span>
                            <Music className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <span className="min-w-0 flex-1 truncate text-xs" title={ref.file.name}>
                              {ref.file.name}
                            </span>
                            {ref.durationSec != null && (
                              <span
                                className={cn(
                                  'shrink-0 font-mono text-[10px]',
                                  tooLong ? 'text-orange-500' : 'text-muted-foreground'
                                )}
                              >
                                {ref.durationSec.toFixed(1)}s
                              </span>
                            )}
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 shrink-0"
                              onClick={() => removeAudioReference(ref.id)}
                              aria-label={`ลบ ${ref.file.name}`}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>

                          <audio
                            src={ref.previewUrl}
                            controls
                            preload="metadata"
                            className="h-8 w-full"
                          />

                          {tooLong && (
                            <p className="text-[10px] leading-relaxed text-orange-500">
                              เสียงยาว {ref.durationSec?.toFixed(1)}s แต่ตั้ง Duration {duration}s —
                              ปากจะขยับไม่ครบประโยค แนะนำเพิ่ม Duration หรือตัดเสียงให้สั้นลง
                            </p>
                          )}
                        </div>
                      )
                    })}

                    {audioReferences.length < 3 && (
                      <DropZone
                        compact
                        accept="audio/*"
                        multiple
                        onFiles={(files) => addAudioReferences(files)}
                        title="เพิ่มไฟล์เสียงอีก"
                        hint={`เหลืออีก ${3 - audioReferences.length} ไฟล์`}
                      />
                    )}
                  </div>
                )}
              </div>
            )}

            {/* T2V: ไม่ต้องมี reference */}
            {baseType === 'T2V' && (
              <div className="grid gap-3">
                <label className="text-sm font-medium">Reference files</label>
                <div className="flex min-h-24 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-muted/20 p-6 text-center text-xs text-muted-foreground">
                  <Video className="h-6 w-6" />
                  <p>T2V ไม่ต้องใช้ reference image</p>
                  <p>ใส่แค่ Prompt แล้วกดสร้างวิดีโอได้เลย</p>
                </div>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Actions */}
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <Button type="submit" className="min-w-44 shadow-md" disabled={!backendOk || isSubmitting}>
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    กำลังส่งเข้าคิว
                  </>
                ) : isRunning ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    เพิ่มเข้าคิว
                  </>
                ) : (
                  <>
                    <Play className="mr-2 h-4 w-4" />
                    สร้างวิดีโอ
                  </>
                )}
              </Button>

              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setPrompt('')
                  setNegativePrompt('')
                  setError(null)
                }}
              >
                ล้าง prompt
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* ========================================
          การ์ด Queue / Progress
          ======================================== */}
      <Card className="shadow-lg">
        <CardHeader className="border-b border-border bg-card/60 backdrop-blur">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-xl">Generation Queue</CardTitle>

            {hasFinished && (
              <Button type="button" variant="ghost" size="sm" onClick={handleClearFinishedJobs}>
                ล้างงานเสร็จ
              </Button>
            )}
          </div>

          <p className="text-sm text-muted-foreground">
            แสดงสถานะคิวงานจาก ComfyUI แบบ real-time (poll ทุก 2 วินาที)
          </p>
        </CardHeader>

        <CardContent className="p-5">
          {jobs.length === 0 ? (
            <div className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-muted/20 p-8 text-center">
              <Clapperboard className="h-10 w-10 text-muted-foreground" />
              <p className="text-sm font-medium text-foreground">ยังไม่มีงานในคิว</p>
              <p className="text-xs text-muted-foreground">
                กรอก prompt แล้วกดสร้างวิดีโอเพื่อทดสอบระบบ queue จริง
              </p>
            </div>
          ) : (
            <div className="grid gap-4">
              {jobs.map((job) => {
                const videoUrl = getMediaUrl(job.video_path)
                const thumbnailUrl = getMediaUrl(job.thumbnail_path)
                const isExpanded = expandedVideoId === job.id

                return (
                  <div
                    key={job.id}
                    className="rounded-xl border border-border bg-muted/20 p-4 shadow-sm transition-shadow hover:shadow-md"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={cn('rounded-full px-2.5 py-1 text-xs font-medium', getStatusClasses(job.status))}
                          >
                            {job.status}
                          </span>
                          <span className="text-xs text-muted-foreground">{formatTime(job.created_at)}</span>
                          {job.stage && (
                            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                              stage: {job.stage}
                            </span>
                          )}
                        </div>

                        <p className="mt-2 line-clamp-2 text-sm font-medium text-foreground">{job.prompt}</p>
                      </div>

                      <div className="flex shrink-0 items-center gap-1">
                        {(job.status === 'RUNNING' || job.status === 'PENDING') && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => handleCancelJob(job.id)}
                            aria-label="ยกเลิกงาน"
                            title="ยกเลิกงาน (หยุด ComfyUI จริง)"
                          >
                            <Square className="h-4 w-4" />
                          </Button>
                        )}

                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => handleRemoveJob(job.id)}
                          aria-label="ลบงานออกจาก list"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-2">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span className="line-clamp-1">{job.message}</span>
                        <span className="font-medium text-foreground">{Math.round(job.progress)}%</span>
                      </div>

                      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full bg-primary transition-all duration-300"
                          style={{ width: `${Math.min(100, Math.max(0, job.progress))}%` }}
                        />
                      </div>

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span>Type: {job.type}</span>
                        <span>Res: {job.resolution}</span>
                        {job.aspect_ratio && <span>AR: {job.aspect_ratio}</span>}
                        <span>Step: {job.current_step ?? 0}/{job.total_steps ?? 6}</span>
                        {job.duration != null && <span>Duration: {formatDuration(job.duration)}</span>}
                        {(job.reference_count ?? 0) > 0 && <span>Refs: {job.reference_count}</span>}
                        {job.comfyui_prompt_id && (
                          <span className="font-mono text-[10px]">prompt: {job.comfyui_prompt_id.slice(0, 8)}…</span>
                        )}
                      </div>
                    </div>

                    {job.status === 'DONE' && (
                      <div className="mt-3 grid gap-3">
                        <div className="flex items-center gap-2 rounded-lg bg-green-500/10 px-3 py-2 text-xs text-green-600 dark:text-green-400">
                          <CheckCircle2 className="h-4 w-4" />
                          เสร็จสิ้นจาก ComfyUI {job.type} และถูกบันทึกเข้า History แล้ว
                        </div>

                        {isExpanded && videoUrl ? (
                          <div className="grid gap-2">
                            <p className="text-xs font-medium text-muted-foreground">ผลลัพธ์วิดีโอ</p>

                            <div className={MEDIA_BOX_CLASS}>
                              <video src={videoUrl} controls preload="metadata" playsInline className="h-full w-full object-contain" />
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                              <a href={videoUrl} target="_blank" rel="noreferrer" className={LINK_BUTTON_OUTLINE}>
                                <ExternalLink className="h-4 w-4" />
                                เปิดวิดีโอในแท็บใหม่
                              </a>
                              <a href={videoUrl} download={job.output_filename || `${job.id}.mp4`} className={LINK_BUTTON_GHOST}>
                                <Download className="h-4 w-4" />
                                ดาวน์โหลด
                              </a>
                              <button type="button" onClick={() => setExpandedVideoId(null)} className={LINK_BUTTON_GHOST}>
                                <ChevronUp className="h-4 w-4" />
                                ย่อ
                              </button>
                            </div>
                          </div>
                        ) : thumbnailUrl ? (
                          <div className="grid gap-2">
                            <p className="text-xs font-medium text-muted-foreground">Thumbnail</p>

                            <button
                              type="button"
                              onClick={() => setExpandedVideoId(job.id)}
                              className={`group ${MEDIA_BOX_CLASS}`}
                              aria-label="เล่นวิดีโอ"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={thumbnailUrl} alt={`thumbnail ของงาน ${job.id}`} className="max-h-full max-w-full object-contain" />
                              <span className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 transition-opacity group-hover:opacity-100">
                                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-black shadow-lg">
                                  <Play className="h-4 w-4" />
                                </span>
                              </span>
                            </button>

                            <div className="flex flex-wrap items-center gap-2">
                              <button type="button" onClick={() => setExpandedVideoId(job.id)} className={LINK_BUTTON_GHOST}>
                                <Play className="h-4 w-4" />
                                เล่นวิดีโอ
                              </button>
                              {videoUrl && (
                                <a href={videoUrl} target="_blank" rel="noreferrer" className={LINK_BUTTON_GHOST}>
                                  <ExternalLink className="h-4 w-4" />
                                  เปิดในแท็บใหม่
                                </a>
                              )}
                              {videoUrl && (
                                <a href={videoUrl} download={job.output_filename || `${job.id}.mp4`} className={LINK_BUTTON_GHOST}>
                                  <Download className="h-4 w-4" />
                                  ดาวน์โหลด
                                </a>
                              )}
                            </div>
                          </div>
                        ) : videoUrl ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <a href={videoUrl} target="_blank" rel="noreferrer" className={LINK_BUTTON_OUTLINE}>
                              <Play className="h-4 w-4" />
                              เปิดวิดีโอ
                            </a>
                            <a href={videoUrl} download={job.output_filename || `${job.id}.mp4`} className={LINK_BUTTON_GHOST}>
                              <Download className="h-4 w-4" />
                              ดาวน์โหลด
                            </a>
                          </div>
                        ) : (
                          <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                            งานเสร็จแล้ว แต่ยังไม่พบ path วิดีโอใน job.video_path — กรุณาตรวจสอบ backend log
                          </div>
                        )}
                      </div>
                    )}

                    {job.status === 'FAILED' && job.error && (
                      <div className="mt-3 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                        {job.error}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <PromptEnhanceDialog
        open={enhanceOpen}
        onClose={() => setEnhanceOpen(false)}
        onApply={(text) => setPrompt(text)}
      />
    </div>
  )
}