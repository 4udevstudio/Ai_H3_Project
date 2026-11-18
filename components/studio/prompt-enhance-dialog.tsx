'use client'

/**
 * ========================================
 * PromptEnhanceDialog
 * ========================================
 * สร้าง prompt จากรูป (หลายรูป) หรือวิดีโอที่สร้างไว้
 * ด้วย Gemma (TextGenerateV2) บน ComfyUI
 */

import * as React from 'react'
import {
  AlertCircle,
  Check,
  Copy,
  Loader2,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { DropZone } from '@/components/ui/drop-zone'
import {
  enhancePrompt,
  getMediaUrl,
  PROMPT_TEMPLATES,
  uploadReferenceFiles,
} from '@/lib/backend'
import { cn } from '@/lib/utils'

interface SeedImage {
  name: string
  previewUrl?: string
}

interface EnhanceImage {
  name: string
  previewUrl: string
}

interface VideoOption {
  id: string
  prompt: string
  videoPath: string
}

interface Props {
  open: boolean
  onClose: () => void
  onApply: (text: string) => void
  initialImages?: SeedImage[]
  defaultStory?: string
  defaultTemplateId?: string
}

export function PromptEnhanceDialog({
  open,
  onClose,
  onApply,
  initialImages,
  defaultStory,
  defaultTemplateId,
}: Props) {
  const [images, setImages] = React.useState<EnhanceImage[]>([])
  const [story, setStory] = React.useState('')
  const [templateId, setTemplateId] = React.useState<string>('cinematic_fl2v')
  const [showAdvanced, setShowAdvanced] = React.useState(false)
  const [maxLength, setMaxLength] = React.useState(1024)
  const [temperature, setTemperature] = React.useState(0.7)
  const [seed, setSeed] = React.useState(0)

  const [videos, setVideos] = React.useState<VideoOption[]>([])
  const [videoPath, setVideoPath] = React.useState('')

  const [uploading, setUploading] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [result, setResult] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [copied, setCopied] = React.useState(false)

  /**
   * เก็บค่า seed ล่าสุดไว้ใน ref
   * เพื่อให้ effect ตั้งค่าเฉพาะ "จังหวะเปิด" เท่านั้น
   * (ถ้าพึ่ง props ตรง ๆ parent re-render ทุกครั้งที่พิมพ์ จะล้างค่าที่ผู้ใช้กรอกทิ้ง)
   */
  const seedRef = React.useRef({ initialImages, defaultStory, defaultTemplateId })
  React.useEffect(() => {
    seedRef.current = { initialImages, defaultStory, defaultTemplateId }
  })

  const createdUrlsRef = React.useRef<string[]>([])

  React.useEffect(() => {
    if (!open) return

    const seed = seedRef.current

    setImages(
      (seed.initialImages ?? [])
        .filter((i) => i.name)
        .map((i) => ({ name: i.name, previewUrl: i.previewUrl ?? '' }))
    )
    setStory(seed.defaultStory ?? '')
    setTemplateId(seed.defaultTemplateId ?? 'cinematic_fl2v')
    setResult('')
    setError(null)
    setVideoPath('')
    setCopied(false)

    void fetch('/api/history?limit=100', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: Array<{ id: string; prompt: string; videoPath: string | null; status: string }>) => {
        setVideos(
          rows
            .filter((r) => r.status === 'DONE' && r.videoPath)
            .slice(0, 30)
            .map((r) => ({ id: r.id, prompt: r.prompt, videoPath: r.videoPath as string }))
        )
      })
      .catch(() => setVideos([]))
  }, [open])

  // คืน objectURL ที่ dialog สร้างเองตอนปิด (ไม่แตะ URL ของ parent)
  React.useEffect(() => {
    if (open) return
    createdUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
    createdUrlsRef.current = []
  }, [open])

  if (!open) return null

  const handleFiles = async (files: File[]) => {
    const room = 6 - images.length
    if (room <= 0) {
      toast.error('ใส่รูปได้สูงสุด 6 รูป')
      return
    }

    setUploading(true)
    try {
      const picked = files.slice(0, room)
      const uploaded = await uploadReferenceFiles(picked)
      const next = uploaded.map((u, i) => {
        const url = URL.createObjectURL(picked[i])
        createdUrlsRef.current.push(url)
        return { name: u.stored_filename, previewUrl: url }
      })
      setImages((prev) => [...prev, ...next])
      toast.success(`อัปโหลด ${next.length} รูปเข้า ComfyUI แล้ว`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'อัปโหลดรูปไม่สำเร็จ')
    } finally {
      setUploading(false)
    }
  }

  const removeImage = (name: string) => {
    setImages((prev) => prev.filter((i) => i.name !== name))
  }

  const handleGenerate = async () => {
    if (busy) return
    if (images.length === 0 && !videoPath) {
      setError('ต้องมีรูปอย่างน้อย 1 รูป หรือเลือกวิดีโอ')
      return
    }

    setBusy(true)
    setError(null)
    setResult('')

    try {
      const res = await enhancePrompt({
        story,
        template_id: templateId,
        image_names: images.map((i) => i.name),
        video_path: videoPath || null,
        max_length: maxLength,
        temperature,
        seed,
      })
      setResult(res.prompt)
      toast.success(`สร้าง prompt สำเร็จ (ใช้ ${res.images_used} ภาพ)`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'สร้าง prompt ไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(result)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('คัดลอกไม่สำเร็จ')
    }
  }

  const selectedVideo = videos.find((v) => v.videoPath === videoPath)
  const videoThumb = selectedVideo ? getMediaUrl(selectedVideo.videoPath) : null

  return (
    <div className="fixed inset-0 z-[960] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => !busy && onClose()} />

      <div className="relative z-10 flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl">
        {/* header */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
          <h3 className="flex items-center gap-2 text-base font-semibold">
            <Sparkles className="h-4 w-4 text-primary" />
            สร้าง prompt จากรูป (Gemma VLM)
          </h3>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose} disabled={busy} aria-label="ปิด">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* body */}
        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4">
          {/* images */}
          <div className="grid gap-2">
            <label className="text-xs font-medium">
              รูปอ้างอิง ({images.length}/6)
            </label>

            {images.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {images.map((img) => (
                  <div key={img.name} className="relative h-20 w-20 overflow-hidden rounded-lg border border-border bg-black">
                    {img.previewUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={img.previewUrl} alt={img.name} className="h-full w-full object-contain" />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center text-[9px] text-muted-foreground">
                        แนบแล้ว
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => removeImage(img.name)}
                      className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white hover:bg-destructive"
                      aria-label="ลบรูป"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {images.length < 6 && (
              <DropZone
                compact
                accept="image/*"
                multiple
                disabled={uploading}
                onFiles={(files) => void handleFiles(files)}
                title={uploading ? 'กำลังอัปโหลด...' : 'ลากรูปมาวาง หรือคลิกเพื่อเลือก'}
                hint="ใส่ได้หลายรูป — Gemma จะวิเคราะห์ทั้งหมดพร้อมกัน"
              />
            )}
          </div>

          {/* video alternative */}
          <div className="grid gap-2">
            <label className="text-xs font-medium">หรือวิเคราะห์จากวิดีโอที่สร้างไว้</label>
            <select
              value={videoPath}
              onChange={(e) => setVideoPath(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-2 text-xs shadow-sm"
            >
              <option value="">— ไม่ใช้วิดีโอ —</option>
              {videos.map((v) => (
                <option key={v.id} value={v.videoPath}>
                  {v.prompt.slice(0, 60)}
                </option>
              ))}
            </select>
            {videoPath && (
              <p className="text-[10px] text-muted-foreground">
                ระบบจะสุ่มเฟรม 6 ภาพกระจายทั่วคลิป ส่งให้ Gemma วิเคราะห์
              </p>
            )}
          </div>

          {/* template */}
          <div className="grid gap-2">
            <label className="text-xs font-medium">Template</label>
            <select
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-2 text-xs shadow-sm"
            >
              {PROMPT_TEMPLATES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          {/* story */}
          <div className="grid gap-2">
            <label className="text-xs font-medium">Story / สิ่งที่เกิดในฉาก</label>
            <Textarea
              value={story}
              onChange={(e) => setStory(e.target.value)}
              placeholder="เช่น หญิงสาวในภาพกำลังเซลฟี่ แล้วยิ้มให้กล้อง"
              className="min-h-16 resize-y text-xs"
            />
          </div>

          {/* advanced */}
          <div className="grid gap-2">
            <button
              type="button"
              onClick={() => setShowAdvanced((s) => !s)}
              className="text-left text-[11px] font-medium text-muted-foreground hover:text-foreground"
            >
              {showAdvanced ? '▾' : '▸'} Advanced
            </button>

            {showAdvanced && (
              <div className="grid grid-cols-3 gap-2">
                <div className="grid gap-1">
                  <label className="text-[10px] text-muted-foreground">max_length</label>
                  <Input type="number" min={128} max={4096} value={maxLength} onChange={(e) => setMaxLength(Number(e.target.value))} className="h-8 text-xs" />
                </div>
                <div className="grid gap-1">
                  <label className="text-[10px] text-muted-foreground">temperature</label>
                  <Input type="number" step={0.05} min={0} max={2} value={temperature} onChange={(e) => setTemperature(Number(e.target.value))} className="h-8 text-xs" />
                </div>
                <div className="grid gap-1">
                  <label className="text-[10px] text-muted-foreground">seed</label>
                  <Input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value))} className="h-8 text-xs" />
                </div>
              </div>
            )}
          </div>

          {/* error */}
          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* result */}
          {result && (
            <div className="grid gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
              <label className="text-xs font-semibold text-primary">ผลลัพธ์ (แก้ไขได้ก่อนใช้)</label>
              <Textarea
                value={result}
                onChange={(e) => setResult(e.target.value)}
                className="min-h-40 resize-y text-xs"
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => {
                    onApply(result)
                    onClose()
                    toast.success('ใส่ prompt ลงฟอร์มแล้ว')
                  }}
                >
                  <Check className="mr-1.5 h-3.5 w-3.5" /> ใช้ prompt นี้
                </Button>
                <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => void handleCopy()}>
                  {copied ? <Check className="mr-1.5 h-3.5 w-3.5 text-green-500" /> : <Copy className="mr-1.5 h-3.5 w-3.5" />}
                  คัดลอก
                </Button>
                <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setResult('')}>
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" /> ล้างผล
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* footer */}
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border px-4 py-3">
          <span className="text-[10px] text-muted-foreground">
            รันบน ComfyUI เดียวกับงานวิดีโอ — ถ้ามีงานค้างอยู่จะรอคิว
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
              ปิด
            </Button>
            <Button size="sm" onClick={() => void handleGenerate()} disabled={busy || uploading}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
              สร้าง prompt
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}