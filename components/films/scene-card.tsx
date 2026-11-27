'use client'

/**
 * ========================================
 * การ์ดฉาก — แก้พรอมป์ โหมด รูป แล้วสั่งสร้าง
 * ========================================
 */

import * as React from 'react'
import { AlertCircle, Copy, ImageIcon, Link2, Loader2, Plus, Trash2, Upload, X } from 'lucide-react'

import { ClipPlayer, controlClass, FieldLabel, Meter } from '@/components/films/bits'
import { SceneStatusBadge } from '@/components/films/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import type { ImageRole, JobStatus, Scene, SceneMode, ScenePatch } from '@/lib/films-types'
import { clampUiDuration, friendlySceneError, SCENE_MODES, sceneModeLabel } from '@/lib/films-types'
import { cn } from '@/lib/utils'

const ROLE_LABEL: Record<ImageRole, string> = {
  ref: 'อ้างอิง',
  first: 'เฟรมแรก',
  last: 'เฟรมท้าย',
}

export interface SceneJobView {
  progress: number
  status: JobStatus
  error?: string | null
}

interface SceneCardProps {
  scene: Scene
  index: number
  job?: SceneJobView | null
  handle: React.ReactNode
  onPatch: (patch: ScenePatch) => void
  onUpload: (file: File, role: ImageRole) => Promise<void>
  onRemoveImage: (imageId: string) => void
  onDuplicate: () => void
  onDelete: () => void
  onInsertAfter: () => void
  onGenerate: () => void
}

export function SceneCard({
  scene,
  index,
  job,
  handle,
  onPatch,
  onUpload,
  onRemoveImage,
  onDuplicate,
  onDelete,
  onInsertAfter,
  onGenerate,
}: SceneCardProps) {
  const rootRef = React.useRef<HTMLDivElement>(null)
  const [prompt, setPrompt] = React.useState(scene.prompt)
  const [duration, setDuration] = React.useState(String(scene.duration_sec))
  const [seedText, setSeedText] = React.useState(scene.seed == null ? '' : String(scene.seed))
  const [confirmDelete, setConfirmDelete] = React.useState(false)
  const [uploading, setUploading] = React.useState<ImageRole | 'ref-multi' | null>(null)
  const promptTimer = React.useRef<number | null>(null)
  const promptRef = React.useRef(scene.prompt)

  const busy =
    scene.status === 'queued' ||
    scene.status === 'running' ||
    job?.status === 'queued' ||
    job?.status === 'running'

  const chainHelp =
    index === 0
      ? 'ฉากแรกไม่มีฉากก่อนหน้า'
      : scene.mode === 'T2V'
        ? 'โหมดข้อความไม่รับเฟรมจากฉากก่อน'
        : scene.mode === 'REF2VA'
          ? 'เฟรมท้ายของฉากก่อนถูกใช้เป็นรูปอ้างอิงเท่านั้น ไม่ใช่เฟรมเริ่ม'
          : 'ใช้เฟรมท้ายของฉากก่อนเป็นเฟรมแรกของฉากนี้'
  const chainDisabled = index === 0 || scene.mode === 'T2V'
  const chainOn = !chainDisabled && scene.chain_from_previous
  const errorText = friendlySceneError(
    scene.status === 'failed' ? scene.error || job?.error : scene.error
  )

  const flushPrompt = () => {
    if (promptTimer.current == null) return
    window.clearTimeout(promptTimer.current)
    promptTimer.current = null
    if (promptRef.current !== scene.prompt) onPatch({ prompt: promptRef.current })
  }

  const changePrompt = (value: string) => {
    promptRef.current = value
    setPrompt(value)
    if (promptTimer.current) window.clearTimeout(promptTimer.current)
    promptTimer.current = window.setTimeout(() => {
      promptTimer.current = null
      if (value !== scene.prompt) onPatch({ prompt: value })
    }, 500)
  }

  const commitDuration = () => {
    const parsed = Number(duration)
    if (!Number.isFinite(parsed)) {
      setDuration(String(scene.duration_sec))
      return
    }
    const next = clampUiDuration(parsed)
    setDuration(String(next))
    if (next !== scene.duration_sec) onPatch({ duration_sec: next })
  }

  const commitSeed = () => {
    const trimmed = seedText.trim()
    if (!trimmed) {
      if (scene.seed != null) onPatch({ seed: null })
      return
    }

    const parsed = Number(trimmed)
    if (!Number.isInteger(parsed)) {
      setSeedText(scene.seed == null ? '' : String(scene.seed))
      return
    }

    if (parsed !== scene.seed) onPatch({ seed: parsed })
  }

  const uploadFiles = async (files: File[], role: ImageRole) => {
    const images = files.filter((file) => !file.type || file.type.startsWith('image/'))
    if (images.length === 0) return

    setUploading(role === 'ref' && images.length > 1 ? 'ref-multi' : role)
    try {
      for (const file of images) {
        await onUpload(file, role)
      }
    } finally {
      setUploading(null)
    }
  }

  return (
    <Card ref={rootRef} className="studio-card shadow-sm">
      <CardHeader className="border-b border-border bg-card/60 px-3 py-3">
        <div className="flex w-full flex-wrap items-center gap-2">
          {handle}
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 font-mono text-xs font-bold text-primary">
              {index + 1}
            </span>
            <span className="whitespace-nowrap font-heading text-base font-medium">ฉาก {index + 1}</span>
          </div>
          <SceneStatusBadge status={scene.status} progress={job?.progress} />
        </div>
        <div className="flex flex-wrap gap-1">
            <Button
              type="button"
              variant="outline"
              className="h-11 px-3"
              onClick={onInsertAfter}
              aria-label="แทรกฉากถัดไป"
            >
              <Plus className="h-4 w-4" />
              <span className="text-xs">แทรก</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-11 w-11"
              onClick={onDuplicate}
              aria-label="ทำซ้ำฉาก"
            >
              <Copy className="h-4 w-4" />
            </Button>
            {confirmDelete ? (
              <>
                <Button type="button" variant="outline" className="h-11" onClick={() => setConfirmDelete(false)}>
                  ยกเลิก
                </Button>
                <Button type="button" variant="destructive" className="h-11" onClick={onDelete}>
                  ลบฉาก
                </Button>
              </>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-11 w-11"
                onClick={() => setConfirmDelete(true)}
                aria-label="ลบฉาก"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
        </div>
      </CardHeader>

      <CardContent className="grid gap-4 p-3 sm:p-4 lg:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
        <div className="grid content-start gap-3">
          <ClipPlayer url={scene.clip_url} label={`ตัวอย่างฉาก ${index + 1}`} />
          {busy ? (
            job ? (
              <Meter value={job.progress} label="ความคืบหน้า" />
            ) : (
              <div className="h-1.5 animate-pulse rounded-full bg-primary/40" aria-hidden />
            )
          ) : null}
          {errorText ? (
            <p className="flex gap-2 rounded-lg bg-destructive/10 px-2.5 py-2 text-xs text-destructive">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{errorText}</span>
            </p>
          ) : null}
          <ImageSection
            scene={scene}
            chainOn={chainOn}
            uploading={uploading}
            onUpload={uploadFiles}
            onRemove={onRemoveImage}
          />
        </div>

        <div className="grid content-start gap-3">
          <label className="grid gap-1.5">
            <FieldLabel hint="Prompt">พรอมป์</FieldLabel>
            <Textarea
              value={prompt}
              onChange={(event) => changePrompt(event.target.value)}
              onBlur={flushPrompt}
              rows={4}
              placeholder="อธิบายภาพที่ต้องการในฉากนี้"
              className="min-h-28 text-base md:text-sm"
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5">
              <FieldLabel hint="Mode">โหมด</FieldLabel>
              <select
                value={scene.mode}
                onChange={(event) => onPatch({ mode: event.target.value as SceneMode })}
                className={controlClass}
                aria-label={`โหมดฉาก ${index + 1}`}
              >
                {SCENE_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {sceneModeLabel(mode)}
                  </option>
                ))}
              </select>
            </label>

            <label className="grid gap-1.5">
              <FieldLabel hint="5–15 วิ">ความยาว</FieldLabel>
              <Input
                inputMode="decimal"
                min={5}
                max={15}
                value={duration}
                onChange={(event) => setDuration(event.target.value)}
                onBlur={commitDuration}
                className="h-11 md:h-9"
                aria-label={`ความยาวฉาก ${index + 1} วินาที`}
              />
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5">
              <FieldLabel hint="ว่าง = สุ่ม">ซีด</FieldLabel>
              <Input
                inputMode="numeric"
                value={seedText}
                placeholder="สุ่ม"
                onChange={(event) => setSeedText(event.target.value)}
                onBlur={commitSeed}
                className="h-11 font-mono md:h-9"
                aria-label={`ซีดฉาก ${index + 1}`}
              />
            </label>

            <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
              <div>
                <p className="text-xs font-medium">GGUF</p>
                <p className="text-[11px] text-muted-foreground">โมเดลเบา</p>
              </div>
              <Switch
                checked={scene.gguf}
                onCheckedChange={(checked) => onPatch({ gguf: checked })}
                aria-label={`GGUF ฉาก ${index + 1}`}
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-xs font-medium">
                <Link2 className="h-3.5 w-3.5 text-primary" />
                ต่อจากฉากก่อน
              </p>
              <p className="text-[11px] text-muted-foreground">{chainHelp}</p>
            </div>
            <Switch
              checked={chainDisabled ? false : scene.chain_from_previous}
              disabled={chainDisabled}
              onCheckedChange={(checked) => onPatch({ chain_from_previous: checked })}
              aria-label={`ต่อจากฉากก่อน ฉาก ${index + 1}`}
            />
          </div>

          <Button type="button" className="h-11" onClick={onGenerate} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {busy ? `กำลังสร้าง${job ? ` ${Math.round(job.progress)}%` : ''}` : 'สร้างฉากนี้'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function ImageSection({
  scene,
  chainOn,
  uploading,
  onUpload,
  onRemove,
}: {
  scene: Scene
  chainOn: boolean
  uploading: ImageRole | 'ref-multi' | null
  onUpload: (files: File[], role: ImageRole) => Promise<void>
  onRemove: (imageId: string) => void
}) {
  if (scene.mode === 'T2V') {
    return (
      <div className="grid gap-2">
        <p className="text-[11px] text-muted-foreground">โหมดข้อความ — ไม่ต้องใส่รูป</p>
        {scene.images.length > 0 ? (
          <ImageGrid images={scene.images} onRemove={onRemove} />
        ) : null}
      </div>
    )
  }

  if (scene.mode === 'REF2VA') {
    return (
      <div className="grid gap-2">
        <FieldLabel hint="role=ref">รูปอ้างอิง</FieldLabel>
        <ImageGrid images={scene.images.filter((image) => image.role === 'ref')} onRemove={onRemove} />
        <UploadButton
          label="อัปโหลดรูปอ้างอิง"
          busy={uploading != null}
          multiple
          onFiles={(files) => onUpload(files, 'ref')}
        />
      </div>
    )
  }

  return (
    <div className="grid gap-2">
      <FieldLabel hint="first / last">เฟรมแรกและเฟรมท้าย</FieldLabel>
      <div className="grid grid-cols-2 gap-2">
        <FrameSlot
          role="first"
          scene={scene}
          note={chainOn ? 'ใช้เฟรมท้ายของฉากก่อน' : undefined}
          dimmed={chainOn}
          busy={uploading === 'first'}
          onUpload={onUpload}
          onRemove={onRemove}
        />
        <FrameSlot
          role="last"
          scene={scene}
          busy={uploading === 'last'}
          onUpload={onUpload}
          onRemove={onRemove}
        />
      </div>
    </div>
  )
}

function FrameSlot({
  role,
  scene,
  note,
  dimmed,
  busy,
  onUpload,
  onRemove,
}: {
  role: 'first' | 'last'
  scene: Scene
  note?: string
  dimmed?: boolean
  busy: boolean
  onUpload: (files: File[], role: ImageRole) => Promise<void>
  onRemove: (imageId: string) => void
}) {
  const images = scene.images.filter((image) => image.role === role)
  const inputRef = React.useRef<HTMLInputElement>(null)

  return (
    <div className={cn('grid gap-1.5 rounded-lg border border-border bg-muted/20 p-2', dimmed && 'opacity-70')}>
      <span className="text-[10px] font-semibold">{ROLE_LABEL[role]}</span>
      <div
        className="relative flex aspect-video items-center justify-center overflow-hidden rounded-md border border-border bg-black/80"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault()
          const files = Array.from(event.dataTransfer.files)
          if (files[0]) void onUpload([files[0]], role)
        }}
      >
        {images[0]?.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={images[0].url} alt={ROLE_LABEL[role]} className="h-full w-full object-contain" />
        ) : images[0] ? (
          <span className="px-1 text-center text-[10px] text-muted-foreground">ลงทะเบียนแล้ว</span>
        ) : (
          <ImageIcon className="h-5 w-5 text-muted-foreground" />
        )}
        {images[0] ? (
          <button
            type="button"
            className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-md bg-black/70 text-white"
            onClick={() => onRemove(images[0].id)}
            aria-label={`ลบ${ROLE_LABEL[role]}`}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
      {note ? <p className="text-[10px] leading-snug text-muted-foreground">{note}</p> : null}
      <Button
        type="button"
        variant="outline"
        className="h-10 px-2 text-[11px]"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
        อัปโหลด
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void onUpload([file], role)
          event.target.value = ''
        }}
      />
      {images.slice(1).map((image) => (
        <button
          key={image.id}
          type="button"
          className="truncate text-left text-[10px] text-muted-foreground underline"
          onClick={() => onRemove(image.id)}
        >
          ลบรูปเพิ่ม {image.id.slice(-4)}
        </button>
      ))}
    </div>
  )
}

function ImageGrid({
  images,
  onRemove,
}: {
  images: Scene['images']
  onRemove: (imageId: string) => void
}) {
  if (images.length === 0) return null

  return (
    <div className="grid grid-cols-3 gap-2">
      {images.map((image) => (
        <div key={image.id} className="relative overflow-hidden rounded-md border border-border bg-black">
          {image.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image.url} alt={ROLE_LABEL[image.role]} className="aspect-square w-full object-cover" />
          ) : (
            <div className="flex aspect-square items-center justify-center px-1 text-center text-[10px] text-muted-foreground">
              ลงทะเบียนแล้ว
            </div>
          )}
          <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1 text-[9px] text-white">
            {ROLE_LABEL[image.role]}
          </span>
          <button
            type="button"
            className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-md bg-black/70 text-white"
            onClick={() => onRemove(image.id)}
            aria-label="ลบรูป"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  )
}

function UploadButton({
  label,
  busy,
  multiple,
  onFiles,
}: {
  label: string
  busy: boolean
  multiple?: boolean
  onFiles: (files: File[]) => void
}) {
  const inputRef = React.useRef<HTMLInputElement>(null)

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="h-11"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
        {label}
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple={multiple}
        className="hidden"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          if (files.length > 0) onFiles(files)
          event.target.value = ''
        }}
      />
    </>
  )
}
