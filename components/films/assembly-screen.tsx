'use client'

/**
 * ========================================
 * รวมคลิป / ส่งออก
 * ========================================
 * ลากเรียงไทม์ไลน์ = ลำดับฉากเดียวกัน
 * เลือกทรานซิชัน อัปโหลดเสียง แล้ว export เป็น MP4
 */

import * as React from 'react'
import { Download, Loader2, Music, Upload } from 'lucide-react'
import { toast } from 'sonner'

import { ClipPlayer, FilmChrome, FilmError, FilmLoading, Meter, controlClass, FieldLabel } from '@/components/films/bits'
import { ReorderList } from '@/components/films/reorder-list'
import { SceneStatusBadge } from '@/components/films/status-badge'
import { useFilm } from '@/components/films/use-film'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { exportFilm, getFilm, getJob, reorderScenes, updateFilm, uploadFilmAudio } from '@/lib/films-api'
import { filmsErrorMessage } from '@/lib/films-error'
import { formatClock, type Film, type FilmTransition, type Job, type Scene } from '@/lib/films-types'

export function AssemblyScreen({ filmId }: { filmId: string }) {
  const { film, setFilm, loading, error, reload } = useFilm(filmId)
  const [transitionDraft, setTransitionDraft] = React.useState<FilmTransition | null>(null)
  const [durationDraft, setDurationDraft] = React.useState<string | null>(null)
  const [uploading, setUploading] = React.useState(false)
  const [exporting, setExporting] = React.useState(false)
  const [jobId, setJobId] = React.useState<string | null>(null)
  const [job, setJob] = React.useState<Job | null>(null)
  const [volume, setVolume] = React.useState('1')
  const audioRef = React.useRef<HTMLInputElement>(null)
  const transition = transitionDraft ?? film?.transition ?? 'none'
  const durationText = durationDraft ?? String(film?.transition_duration ?? 0.5)

  React.useEffect(() => {
    if (!jobId) return

    let cancelled = false
    let timer = 0

    const tick = async () => {
      try {
        const next = await getJob(jobId)
        if (cancelled) return
        setJob(next)

        if (next.status === 'done' || next.status === 'failed') {
          window.clearInterval(timer)
          const fresh = await getFilm(filmId)
          if (!cancelled) {
            setFilm((current) =>
              current
                ? {
                    ...fresh,
                    transition: current.transition,
                    transition_duration: current.transition_duration,
                  }
                : fresh
            )
          }
          if (next.status === 'failed') toast.error(next.error || 'ส่งออกไม่สำเร็จ')
          else toast.success('รวมคลิปเสร็จแล้ว')
        }
      } catch (err: unknown) {
        if (!cancelled) toast.error(filmsErrorMessage(err, 'อ่านความคืบหน้าไม่สำเร็จ'))
      }
    }

    void tick()
    timer = window.setInterval(() => void tick(), 2000)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [jobId, filmId, setFilm])

  const saveAssembly = async (nextTransition: FilmTransition, nextDuration: number) => {
    try {
      const updated = await updateFilm(filmId, {
        transition: nextTransition,
        transition_duration: nextDuration,
      })
      setFilm((current) =>
        current
          ? {
              ...current,
              transition: updated.transition,
              transition_duration: updated.transition_duration,
            }
          : updated
      )
      setTransitionDraft(null)
      setDurationDraft(null)
    } catch (err: unknown) {
      toast.error(filmsErrorMessage(err, 'บันทึกทรานซิชันไม่สำเร็จ'))
    }
  }

  const onTransition = (value: FilmTransition) => {
    setTransitionDraft(value)
    const duration = Number(durationText)
    void saveAssembly(value, Number.isFinite(duration) && duration >= 0 ? duration : 0)
  }

  const onDurationBlur = () => {
    const duration = Number(durationText)
    if (!Number.isFinite(duration) || duration < 0 || duration > 5) {
      setDurationDraft(null)
      return
    }
    setDurationDraft(String(duration))
    void saveAssembly(transition, duration)
  }

  const onReorder = async (next: Scene[]) => {
    const previous = film
    setFilm((current) =>
      current
        ? { ...current, scenes: next.map((scene, index) => ({ ...scene, order: index })) }
        : current
    )

    try {
      await reorderScenes(
        filmId,
        next.map((scene) => scene.id)
      )
    } catch (err: unknown) {
      toast.error(filmsErrorMessage(err, 'จัดลำดับไม่สำเร็จ'))
      if (previous) setFilm(previous)
    }
  }

  const onAudio = async (file: File) => {
    setUploading(true)
    try {
      const { audio_url: audioUrl } = await uploadFilmAudio(filmId, file)
      setFilm((current) => (current ? { ...current, audio_url: audioUrl } : current))
      toast.success('อัปโหลดเสียงพื้นหลังแล้ว')
    } catch (err: unknown) {
      toast.error(filmsErrorMessage(err, 'อัปโหลดเสียงไม่สำเร็จ'))
    } finally {
      setUploading(false)
    }
  }

  const onExport = async () => {
    setExporting(true)
    try {
      const result = await exportFilm(filmId)
      setJobId(result.id)
      setJob(result)
      setFilm((current) => (current ? { ...current, status: 'assembling' } : current))
      toast.success('เริ่มรวมคลิป')
    } catch (err: unknown) {
      toast.error(filmsErrorMessage(err, 'ส่งออกไม่สำเร็จ'))
    } finally {
      setExporting(false)
    }
  }

  if (loading) return <FilmLoading label="กำลังเปิดเรื่อง..." />
  if (error || !film) {
    return <FilmError message={error ?? 'ไม่พบเรื่องนี้'} onRetry={() => void reload().catch(() => undefined)} />
  }

  const scenes = [...(film.scenes ?? [])].sort((a, b) => a.order - b.order)
  const totalDuration = scenes.reduce((sum, scene) => sum + scene.duration_sec, 0)
  const timeline = scenes.map((scene, index) => ({
    scene,
    start: scenes.slice(0, index).reduce((sum, item) => sum + item.duration_sec, 0),
  }))
  const readyCount = scenes.filter((scene) => scene.status === 'done' && scene.clip_url).length
  const exportReady = scenes.length > 0 && readyCount === scenes.length
  const exportBusy = exporting || job?.status === 'queued' || job?.status === 'running'
  const finalUrl = film.final_url || (job?.status === 'done' ? job.result_url : null)

  return (
    <FilmChrome
      filmId={filmId}
      title={<h2 className="truncate font-heading text-xl font-semibold">{film.title}</h2>}
      meta={
        <p className="text-xs text-muted-foreground">
          เรียงคลิปให้ตรงลำดับฉาก แล้วส่งออกเป็น MP4 · ความยาวโดยประมาณ {formatClock(totalDuration)}
        </p>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <Card className="shadow-sm">
          <CardHeader className="border-b border-border">
            <CardTitle>ลำดับคลิป</CardTitle>
            <p className="text-sm text-muted-foreground">ลากเพื่อเรียง — ลำดับนี้คือลำดับฉากในเรื่อง</p>
          </CardHeader>
          <CardContent>
            {timeline.length === 0 ? (
              <p className="text-sm text-muted-foreground">ยังไม่มีฉากให้เรียง</p>
            ) : (
              <ReorderList
                items={timeline}
                getId={(item) => item.scene.id}
                onReorder={(next) => void onReorder(next.map((item) => item.scene))}
                renderItem={(item, index, handle) => (
                  <div className="flex gap-2 rounded-xl border border-border bg-card p-2 sm:gap-3 sm:p-3">
                    {handle}
                    <div className="w-28 shrink-0 sm:w-36">
                      <ClipPlayer url={item.scene.clip_url} label={`คลิปฉาก ${index + 1}`} />
                    </div>
                    <div className="grid min-w-0 flex-1 content-start gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs text-muted-foreground">{formatClock(item.start)}</span>
                        <span className="text-sm font-medium">ฉาก {index + 1}</span>
                        <SceneStatusBadge status={item.scene.status} />
                      </div>
                      <p className="line-clamp-2 text-xs text-muted-foreground">
                        {item.scene.prompt.trim() || 'ยังไม่มีพรอมป์'}
                      </p>
                      <p className="text-[11px] text-muted-foreground">{item.scene.duration_sec} วินาที</p>
                    </div>
                  </div>
                )}
              />
            )}
          </CardContent>
        </Card>

        <div className="grid content-start gap-4">
          <Card className="shadow-sm">
            <CardHeader className="border-b border-border">
              <CardTitle>การรวม</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              <label className="grid gap-1.5">
                <FieldLabel>ทรานซิชัน</FieldLabel>
                <select
                  value={transition}
                  onChange={(event) => onTransition(event.target.value as FilmTransition)}
                  className={controlClass}
                  aria-label="ทรานซิชัน"
                >
                  <option value="none">ไม่มี (none)</option>
                  <option value="crossfade">ครอสเฟด (crossfade)</option>
                </select>
              </label>

              <label className="grid gap-1.5">
                <FieldLabel hint="วินาที">ความยาวทรานซิชัน</FieldLabel>
                <Input
                  inputMode="decimal"
                  value={durationText}
                  disabled={transition === 'none'}
                  onChange={(event) => setDurationDraft(event.target.value)}
                  onBlur={onDurationBlur}
                  className="h-11 md:h-9"
                  aria-label="ความยาวทรานซิชันเป็นวินาที"
                />
              </label>

              <div className="grid gap-2">
                <FieldLabel>เสียงพื้นหลัง</FieldLabel>
                {film.audio_url ? (
                  <audio src={film.audio_url} controls className="w-full" aria-label="เสียงพื้นหลัง" />
                ) : (
                  <p className="text-xs text-muted-foreground">ยังไม่มีไฟล์เสียง</p>
                )}
                <Button
                  type="button"
                  variant="outline"
                  className="h-11"
                  disabled={uploading}
                  onClick={() => audioRef.current?.click()}
                >
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : film.audio_url ? <Music className="h-4 w-4" /> : <Upload className="h-4 w-4" />}
                  {film.audio_url ? 'เปลี่ยนไฟล์เสียง' : 'อัปโหลดเสียง'}
                </Button>
                <input
                  ref={audioRef}
                  type="file"
                  accept="audio/*"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    if (file) void onAudio(file)
                    event.target.value = ''
                  }}
                />
              </div>

              <label className="grid gap-1.5">
                <FieldLabel hint="0–2">ระดับเสียงพื้นหลัง</FieldLabel>
                <Input
                  inputMode="decimal"
                  value={volume}
                  onChange={(event) => setVolume(event.target.value)}
                  onBlur={() => {
                    const next = Number(volume)
                    if (!Number.isFinite(next) || next < 0 || next > 2) {
                      setVolume('1')
                      return
                    }
                    void updateFilm(filmId, { audio_volume: next }).catch((err: unknown) => {
                      toast.error(filmsErrorMessage(err, 'บันทึกระดับเสียงไม่สำเร็จ'))
                    })
                  }}
                  className="h-11 md:h-9"
                  aria-label="ระดับเสียงพื้นหลัง"
                />
              </label>

              <p className="text-xs text-muted-foreground">
                {exportReady
                  ? `พร้อมส่งออกครบ ${readyCount} ฉาก`
                  : `ต้องมีคลิปครบทุกฉากก่อนส่งออก (${readyCount} จาก ${scenes.length})`}
              </p>

              <Button type="button" className="h-11" disabled={exportBusy || !exportReady} onClick={() => void onExport()}>
                {exportBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                ส่งออก MP4
              </Button>

              {job && (job.status === 'queued' || job.status === 'running' || job.status === 'failed') ? (
                <div className="grid gap-2">
                  <Meter value={job.progress} label={job.status === 'failed' ? 'ส่งออกไม่สำเร็จ' : 'กำลังรวมคลิป'} />
                  {job.error ? <p className="text-xs text-destructive">{job.error}</p> : null}
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader className="border-b border-border">
              <CardTitle>ไฟล์ที่รวมแล้ว</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              <ClipPlayer url={finalUrl} label={`ไฟล์รวมของ ${film.title}`} />
              {finalUrl ? (
                <a
                  href={finalUrl}
                  download={`${safeFileName(film)}.mp4`}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 text-sm font-medium hover:bg-muted"
                >
                  <Download className="h-4 w-4" />
                  ดาวน์โหลด MP4
                </a>
              ) : (
                <p className="text-xs text-muted-foreground">กดส่งออกเพื่อรวมคลิป แล้วเล่นหรือดาวน์โหลดได้จากที่นี่</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </FilmChrome>
  )
}

function safeFileName(film: Film): string {
  const cleaned = film.title.replace(/[\\/:*?"<>|]+/g, ' ').trim()
  return cleaned || 'film'
}
