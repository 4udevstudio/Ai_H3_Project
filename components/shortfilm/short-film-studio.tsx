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
  Music,
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
import { DropZone } from '@/components/ui/drop-zone'
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
  MAX_SCENE_REF_AUDIOS,
  MAX_SCENE_REF_IMAGES,
  type SceneDraft,
} from '@/lib/shortfilm-draft'
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
]
const ASPECT_RATIOS = [
  { value: '16:9 (Widescreen)', label: '16:9 แนวนอน' },
  { value: '9:16 (Portrait Widescreen)', label: '9:16 แนวตั้ง' },
  { value: '1:1 (Square)', label: '1:1 จตุรัส' },
  { value: '2:3 (Portrait Photo)', label: '2:3 แนวตั้ง (Photo)' },
  { value: '3:2 (Photo)', label: '3:2 แนวนอน (Photo)' },
  { value: '3:4 (Portrait Standard)', label: '3:4 แนวตั้ง (Standard)' },
  { value: '4:3 (Standard)', label: '4:3 แนวนอน (Standard)' },
  { value: '21:9 (Ultrawide)', label: '21:9 จอกว้างพิเศษ' },
]
const DURATIONS = [5, 8, 10, 12, 15]

const SCENE_TYPES = [
  { value: 'T2V', label: 'T2V' },
  { value: 'FL2VA', label: 'FL2VA (ต่อฉาก)' },
  { value: 'REF2VA', label: 'REF2VA (อ้างอิง)' },
  { value: 'T2V_LOW', label: 'T2V (Low VRAM)' },
  { value: 'FL2VA_LOW', label: 'FL2VA ต่อฉาก (Low VRAM)' },
  { value: 'REF2VA_LOW', label: 'REF2VA อ้างอิง (Low VRAM)' },
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

interface AudioState {
  name: string
  originalName: string
  previewUrl: string
  durationSec?: number
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
  refImages: SlotState[]
  audioRefs: AudioState[]
  jobId: string | null
}

function sceneBaseType(type: string): string {
  return type.endsWith('_LOW') ? type.slice(0, -4) : type
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
    refImages: (d.refImages ?? []).map((r) => ({
      name: r.name,
      framePath: r.framePath,
      previewUrl: r.framePath ? getFrameUrl(r.framePath) ?? '' : '',
    })),
    audioRefs: (d.audioRefs ?? []).map((a) => ({
      name: a.name,
      originalName: a.originalName ?? a.name,
      previewUrl: '',
      durationSec: a.durationSec,
    })),
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
    refImages: s.refImages.map((r) => ({ name: r.name, framePath: r.framePath })),
    audioRefs: s.audioRefs.map((a) => ({
      name: a.name,
      originalName: a.originalName,
      durationSec: a.durationSec,
    })),
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
  uploadingSlot: 'A' | 'B' | 'REF' | 'AUDIO' | null
  onUpdate: (patch: Partial<SceneState>) => void
  onPickFile: (slot: 'A' | 'B', file: File) => void
  onClearSlot: (slot: 'A' | 'B') => void
  onPickRefImages: (files: File[]) => void
  onRemoveRefImage: (index: number) => void
  onPickAudio: (files: File[]) => void
  onRemoveAudio: (index: number) => void
  onPullPrev: () => void
  onSubmit: () => void
  onClearScene: () => void
  onEnhance: () => void
}

function SceneCard(props: SceneCardProps) {
  const {
    index, scene, job, submitting, extracting, canPullPrev, uploadingSlot,
    onUpdate, onPickFile, onClearSlot, onPickRefImages, onRemoveRefImage,
    onPickAudio, onRemoveAudio, onPullPrev, onSubmit, onClearScene, onEnhance,
  } = props

  const slotARef = React.useRef<HTMLInputElement | null>(null)
  const slotBRef = React.useRef<HTMLInputElement | null>(null)
  const refImagesInputRef = React.useRef<HTMLInputElement | null>(null)
  const audioInputRef = React.useRef<HTMLInputElement | null>(null)

  const baseType = sceneBaseType(scene.type)
  const isFl2va = baseType === 'FL2VA'
  const isRef = baseType === 'REF2VA'
  const isT2v = baseType === 'T2V'

  const slotALabel = 'First frame'
  const slotBLabel = 'Last frame (ไม่บังคับ)'

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

        {/* T2V: ไม่ต้องใช้รูป */}
        {isT2v && (
          <p className="rounded-lg border border-dashed border-border bg-muted/20 px-3 py-2 text-center text-[10px] text-muted-foreground">
            T2V ไม่ต้องใช้รูป — พิมพ์ prompt อย่างเดียว
          </p>
        )}

        {/* FL2VA: first / last frame (node รับได้ 2 ช่อง) */}
        {isFl2va && (
          <div className="grid grid-cols-2 gap-2">
            <SceneSlot
              label={slotALabel}
              value={scene.slotA}
              inputRef={slotARef}
              onFile={(f) => onPickFile('A', f)}
              onClear={() => onClearSlot('A')}
              busy={uploadingSlot === 'A'}
            />
            <SceneSlot
              label={slotBLabel}
              value={scene.slotB}
              inputRef={slotBRef}
              onFile={(f) => onPickFile('B', f)}
              onClear={() => onClearSlot('B')}
              busy={uploadingSlot === 'B'}
            />
          </div>
        )}

        {/* REF2VA: รูปอ้างอิงสูงสุด 9 */}
        {isRef && (
          <div className="grid gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold text-muted-foreground">
                Reference images ({scene.refImages.length}/{MAX_SCENE_REF_IMAGES})
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 px-2 text-[10px]"
                onClick={() => refImagesInputRef.current?.click()}
                disabled={uploadingSlot === 'REF' || scene.refImages.length >= MAX_SCENE_REF_IMAGES}
              >
                {uploadingSlot === 'REF' ? (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                ) : (
                  <Upload className="mr-1 h-3 w-3" />
                )}
                เพิ่มรูป
              </Button>
              <input
                ref={refImagesInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  const fs = Array.from(e.target.files ?? [])
                  if (fs.length) onPickRefImages(fs)
                  e.target.value = ''
                }}
              />
            </div>

            {scene.refImages.length === 0 ? (
              <DropZone
                compact
                accept="image/*"
                multiple
                disabled={uploadingSlot === 'REF'}
                onFiles={onPickRefImages}
                title="ลากรูปมาวาง หรือคลิกเพื่อเลือก"
                hint="สูงสุด 9 รูป · อ้างใน prompt ด้วย <Picture 1> … <Picture 9>"
              />
            ) : (
              <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
                {scene.refImages.map((img, idx) => (
                  <div
                    key={`${img.name}-${idx}`}
                    className="group relative aspect-square overflow-hidden rounded border border-border bg-black"
                  >
                    {img.previewUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={img.previewUrl} alt={`Picture ${idx + 1}`} className="h-full w-full object-contain" />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center text-[8px] text-muted-foreground">
                        แนบแล้ว
                      </span>
                    )}

                    <span className="absolute left-0.5 top-0.5 rounded bg-black/70 px-1 font-mono text-[8px] text-white">
                      {idx + 1}
                    </span>

                    <button
                      type="button"
                      onClick={() => onRemoveRefImage(idx)}
                      className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/70 text-white opacity-0 transition-opacity hover:bg-destructive group-hover:opacity-100"
                      aria-label={`ลบรูปที่ ${idx + 1}`}
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </div>
                ))}

                {scene.refImages.length < MAX_SCENE_REF_IMAGES && (
                  <button
                    type="button"
                    onClick={() => refImagesInputRef.current?.click()}
                    disabled={uploadingSlot === 'REF'}
                    className="flex aspect-square items-center justify-center rounded border border-dashed border-border text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary disabled:opacity-50"
                    aria-label="เพิ่มรูปอ้างอิง"
                  >
                    <Upload className="h-4 w-4" />
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* REF2VA: audio lipsync สูงสุด 3 */}
        {isRef && (
          <div className="grid gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold text-muted-foreground">
                Audio lipsync ({scene.audioRefs.length}/{MAX_SCENE_REF_AUDIOS})
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 px-2 text-[10px]"
                onClick={() => audioInputRef.current?.click()}
                disabled={uploadingSlot === 'AUDIO' || scene.audioRefs.length >= MAX_SCENE_REF_AUDIOS}
              >
                {uploadingSlot === 'AUDIO' ? (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                ) : (
                  <Upload className="mr-1 h-3 w-3" />
                )}
                เพิ่มเสียง
              </Button>
              <input
                ref={audioInputRef}
                type="file"
                accept="audio/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  const fs = Array.from(e.target.files ?? [])
                  if (fs.length) onPickAudio(fs)
                  e.target.value = ''
                }}
              />
            </div>

            {scene.audioRefs.length === 0 ? (
              <DropZone
                compact
                accept="audio/*"
                multiple
                disabled={uploadingSlot === 'AUDIO'}
                onFiles={onPickAudio}
                title="ลากไฟล์เสียงมาวาง (ไม่บังคับ)"
                hint=".mp3 / .wav · อ้างใน prompt ด้วย <Audio 1>"
              />
            ) : (
              <div className="grid gap-1.5">
                {scene.audioRefs.map((a, idx) => {
                  const tooLong = a.durationSec != null && a.durationSec > scene.duration + 0.6

                  return (
                    <div key={`${a.name}-${idx}`} className="grid gap-1 rounded-lg border border-border bg-muted/20 p-2">
                      <div className="flex items-center gap-1.5">
                        <span className="shrink-0 rounded-full bg-primary/15 px-1.5 font-mono text-[9px] font-bold text-primary">
                          Audio {idx + 1}
                        </span>
                        <Music className="h-3 w-3 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate text-[10px]" title={a.originalName || a.name}>
                          {a.originalName || a.name}
                        </span>
                        {a.durationSec != null && (
                          <span className={cn('shrink-0 font-mono text-[9px]', tooLong ? 'text-orange-500' : 'text-muted-foreground')}>
                            {a.durationSec.toFixed(1)}s
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => onRemoveAudio(idx)}
                          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-destructive"
                          aria-label={`ลบไฟล์เสียงที่ ${idx + 1}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>

                      {a.previewUrl && (
                        <audio src={a.previewUrl} controls preload="metadata" className="h-7 w-full" />
                      )}

                      {tooLong && (
                        <p className="text-[9px] leading-relaxed text-orange-500">
                          เสียงยาว {a.durationSec?.toFixed(1)}s แต่ฉากนี้ตั้ง {scene.duration}s —
                          ปากจะขยับไม่ครบประโยค
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
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
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
            <select
              value={scene.aspect}
              onChange={(e) => onUpdate({ aspect: e.target.value })}
              className="h-8 rounded-md border border-input bg-background px-2 text-[10px] shadow-sm"
            >
              {ASPECT_RATIOS.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
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
  const [uploading, setUploading] = React.useState<Record<number, 'A' | 'B' | 'REF' | 'AUDIO' | null>>({})
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

  // ========================================
  // REF2VA: รูปอ้างอิง (สูงสุด 9) + เสียง (สูงสุด 3)
  // ========================================

  const pickRefImages = async (i: number, files: File[]) => {
    const room = MAX_SCENE_REF_IMAGES - scenes[i].refImages.length
    if (room <= 0) {
      toast.error(`ฉาก ${i + 1}: ใส่รูปได้สูงสุด ${MAX_SCENE_REF_IMAGES} รูป`)
      return
    }

    const picked = files.filter((f) => f.type.startsWith('image/')).slice(0, room)
    if (picked.length === 0) {
      toast.error('กรุณาเลือกไฟล์รูปภาพ')
      return
    }

    setUploading((p) => ({ ...p, [i]: 'REF' }))
    try {
      const uploaded = await uploadReferenceFiles(picked)
      const next: SlotState[] = uploaded.map((u, idx) => ({
        name: u.stored_filename,
        previewUrl: URL.createObjectURL(picked[idx]),
      }))

      setScenes((prev) =>
        prev.map((s, idx) =>
          idx === i
            ? { ...s, refImages: [...s.refImages, ...next].slice(0, MAX_SCENE_REF_IMAGES) }
            : s
        )
      )
      toast.success(`ฉาก ${i + 1}: เพิ่มรูปอ้างอิง ${next.length} รูป`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'อัปโหลดรูปไม่สำเร็จ')
    } finally {
      setUploading((p) => ({ ...p, [i]: null }))
    }
  }

  const removeRefImage = (i: number, index: number) => {
    setScenes((prev) =>
      prev.map((s, idx) => {
        if (idx !== i) return s
        const target = s.refImages[index]
        if (target?.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(target.previewUrl)
        return { ...s, refImages: s.refImages.filter((_, k) => k !== index) }
      })
    )
  }

  const pickAudio = async (i: number, files: File[]) => {
    const room = MAX_SCENE_REF_AUDIOS - scenes[i].audioRefs.length
    if (room <= 0) {
      toast.error(`ฉาก ${i + 1}: ใส่ไฟล์เสียงได้สูงสุด ${MAX_SCENE_REF_AUDIOS} ไฟล์`)
      return
    }

    const picked = files
      .filter((f) => f.type.startsWith('audio/') || /\.(mp3|wav|flac|m4a|aac|ogg)$/i.test(f.name))
      .slice(0, room)

    if (picked.length === 0) {
      toast.error('กรุณาเลือกไฟล์เสียง (.mp3 / .wav)')
      return
    }

    setUploading((p) => ({ ...p, [i]: 'AUDIO' }))
    try {
      const uploaded = await uploadReferenceFiles(picked)
      const next: AudioState[] = uploaded.map((u, idx) => ({
        name: u.stored_filename,
        originalName: picked[idx].name,
        previewUrl: URL.createObjectURL(picked[idx]),
      }))

      setScenes((prev) =>
        prev.map((s, idx) =>
          idx === i
            ? { ...s, audioRefs: [...s.audioRefs, ...next].slice(0, MAX_SCENE_REF_AUDIOS) }
            : s
        )
      )

      next.forEach((item) => {
        const probe = new Audio()
        probe.preload = 'metadata'
        probe.onloadedmetadata = () => {
          const sec = Number.isFinite(probe.duration) ? probe.duration : null
          if (sec === null) return
          setScenes((prev) =>
            prev.map((s, idx) =>
              idx === i
                ? {
                    ...s,
                    audioRefs: s.audioRefs.map((a) =>
                      a.name === item.name ? { ...a, durationSec: sec } : a
                    ),
                  }
                : s
            )
          )
        }
        probe.src = item.previewUrl
      })

      toast.success(`ฉาก ${i + 1}: เพิ่มไฟล์เสียง ${next.length} ไฟล์`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'อัปโหลดไฟล์เสียงไม่สำเร็จ')
    } finally {
      setUploading((p) => ({ ...p, [i]: null }))
    }
  }

  const removeAudio = (i: number, index: number) => {
    setScenes((prev) =>
      prev.map((s, idx) => {
        if (idx !== i) return s
        const target = s.audioRefs[index]
        if (target?.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(target.previewUrl)
        return { ...s, audioRefs: s.audioRefs.filter((_, k) => k !== index) }
      })
    )
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

    const baseType = sceneBaseType(scene.type)

    if (baseType === 'FL2VA') {
      return {
        ...base,
        first_frame_name: scene.slotA?.name ?? null,
        last_frame_name: scene.slotB?.name ?? null,
        reference_names: [],
        audio_reference_names: [],
      }
    }

    if (baseType === 'REF2VA') {
      const refs = scene.refImages
        .map((r) => r.name)
        .filter(Boolean)
        .slice(0, MAX_SCENE_REF_IMAGES)

      const audios = scene.audioRefs
        .map((a) => a.name)
        .filter(Boolean)
        .slice(0, MAX_SCENE_REF_AUDIOS)

      return {
        ...base,
        first_frame_name: null,
        last_frame_name: null,
        reference_names: refs,
        audio_reference_names: audios,
      }
    }

    return {
      ...base,
      first_frame_name: null,
      last_frame_name: null,
      reference_names: [],
      audio_reference_names: [],
    }
  }

  const validateScene = (scene: SceneState): string | null => {
    if (!scene.prompt.trim()) return 'กรุณากรอก prompt'

    const baseType = sceneBaseType(scene.type)

    if (baseType === 'FL2VA' && !scene.slotA && !scene.slotB) return 'FL2VA ต้องมี first/last frame'
    if (baseType === 'REF2VA' && scene.refImages.length === 0) return 'REF2VA ต้องมี reference อย่างน้อย 1'
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

    const baseType = sceneBaseType(scene.type)

    const source =
      baseType === 'REF2VA'
        ? scene.refImages
        : [scene.slotA, scene.slotB].filter((slot): slot is SlotState => Boolean(slot))

    const images = source
      .filter((slot) => Boolean(slot.name))
      .slice(0, 6)
      .map((slot) => ({ name: slot.name, previewUrl: slot.previewUrl }))

    return {
      images,
      templateId: baseType === 'FL2VA' ? 'continuation' : 'cinematic_fl2v',
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
                  <option key={r.value} value={r.value}>
                    {r.label}
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
                  <option key={a.value} value={a.value}>
                    {a.label}
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
            onPickRefImages={(files) => void pickRefImages(i, files)}
            onRemoveRefImage={(index) => removeRefImage(i, index)}
            onPickAudio={(files) => void pickAudio(i, files)}
            onRemoveAudio={(index) => removeAudio(i, index)}
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