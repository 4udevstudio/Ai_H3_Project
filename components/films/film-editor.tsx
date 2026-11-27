'use client'

/**
 * ========================================
 * ตัวแก้ไขฉากของเรื่อง
 * ========================================
 * เพิ่ม / ลบ / ลากเรียง / ทำซ้ำ / สร้างรายฉากหรือทั้งเรื่อง
 * ระหว่างมีงานค้าง จะโพล GET /api/jobs และรีเฟรชสถานะฉาก
 */

import * as React from 'react'
import { Loader2, Play, Plus } from 'lucide-react'
import { toast } from 'sonner'

import { EmptyState, FilmChrome, FilmError, FilmLoading } from '@/components/films/bits'
import { ReorderList } from '@/components/films/reorder-list'
import { SceneCard, type SceneJobView } from '@/components/films/scene-card'
import { FilmStatusBadge } from '@/components/films/status-badge'
import { useFilm } from '@/components/films/use-film'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  createScene,
  deleteScene,
  deleteSceneImage,
  duplicateScene,
  generateAll,
  generateScene,
  getFilm,
  getJob,
  reorderScenes,
  updateFilm,
  updateScene,
  uploadSceneImage,
} from '@/lib/films-api'
import { filmsErrorMessage } from '@/lib/films-error'
import type { Film, ImageRole, JobStatus, Scene, ScenePatch } from '@/lib/films-types'

interface TrackedJob {
  jobId: string
  progress: number
  status: JobStatus
  error?: string | null
}

function scenesOf(film: Film | null | undefined): Scene[] {
  return film?.scenes ?? []
}

function mergeRuntime(prev: Film, next: Film): Film {
  const previousScenes = scenesOf(prev)
  const nextScenes = scenesOf(next)
  const sameIds =
    previousScenes.length === nextScenes.length &&
    previousScenes.every((scene) => nextScenes.some((item) => item.id === scene.id))

  if (!sameIds) {
    return { ...next, title: prev.title, script: prev.script, scenes: nextScenes }
  }

  const incoming = new Map(nextScenes.map((scene) => [scene.id, scene]))
  const scenes = previousScenes
    .map((scene) => {
      const fresh = incoming.get(scene.id)
      if (!fresh) return scene
      return {
        ...scene,
        status: fresh.status,
        clip_url: fresh.clip_url,
        error: fresh.error,
        order: fresh.order,
      }
    })
    .sort((a, b) => a.order - b.order)

  return {
    ...next,
    title: prev.title,
    script: prev.script,
    scenes,
  }
}

export function FilmEditor({ filmId }: { filmId: string }) {
  const { film, setFilm, loading, error, reload } = useFilm(filmId)
  const [titleDraft, setTitleDraft] = React.useState<string | null>(null)
  const [tracked, setTracked] = React.useState<Record<string, TrackedJob>>({})
  const [adding, setAdding] = React.useState(false)
  const [generatingAll, setGeneratingAll] = React.useState(false)
  const trackedRef = React.useRef<Record<string, TrackedJob>>({})
  const seq = React.useRef<Record<string, number>>({})
  const titleValue = titleDraft ?? film?.title ?? ''

  const sceneBusy = scenesOf(film).some((scene) => scene.status === 'queued' || scene.status === 'running')
  const trackBusy = Object.values(tracked).some((job) => job.status === 'queued' || job.status === 'running')
  const busyNow = sceneBusy || trackBusy || film?.status === 'generating'

  React.useEffect(() => {
    if (!busyNow) return

    let cancelled = false

    const tick = async () => {
      const active = Object.entries(trackedRef.current).filter(
        ([, job]) => job.status === 'queued' || job.status === 'running'
      )

      if (active.length > 0) {
        const updates = await Promise.all(
          active.map(async ([sceneId, job]) => {
            try {
              const next = await getJob(job.jobId)
              return [sceneId, { ...job, progress: next.progress, status: next.status, error: next.error }] as const
            } catch {
              return null
            }
          })
        )

        if (!cancelled) {
          const next = { ...trackedRef.current }
          for (const row of updates) {
            if (!row) continue
            const [sceneId, job] = row
            if (!next[sceneId] || next[sceneId].jobId !== job.jobId) continue
            next[sceneId] = job
          }
          trackedRef.current = next
          setTracked(next)
        }
      }

      try {
        const fresh = await getFilm(filmId)
        if (cancelled) return
        setFilm((current) => (current ? mergeRuntime(current, fresh) : fresh))
      } catch {
        // โพลรอบถัดไปลองใหม่
      }
    }

    void tick()
    const id = window.setInterval(() => void tick(), 2000)

    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [busyNow, filmId, setFilm])

  const patchScene = async (sceneId: string, patch: ScenePatch) => {
    if (patch.prompt !== undefined && !patch.prompt.trim()) {
      toast.error('พรอมป์ว่างไม่ได้')
      return
    }

    const token = (seq.current[sceneId] ?? 0) + 1
    seq.current[sceneId] = token

    setFilm((current) => {
      if (!current) return current
      return {
        ...current,
        scenes: scenesOf(current).map((scene) =>
          scene.id === sceneId ? { ...scene, ...patch } : scene
        ),
      }
    })

    try {
      const updated = await updateScene(filmId, sceneId, patch)
      if (seq.current[sceneId] !== token) return
      setFilm((current) => {
        if (!current) return current
        return {
          ...current,
          scenes: scenesOf(current).map((scene) => (scene.id === sceneId ? { ...scene, ...updated } : scene)),
        }
      })
    } catch (err: unknown) {
      if (seq.current[sceneId] !== token) return
      toast.error(filmsErrorMessage(err, 'บันทึกฉากไม่สำเร็จ'))
      try {
        const fresh = await reload()
        if (seq.current[sceneId] === token) setFilm(fresh)
      } catch {
        // คงค่าบนจอไว้
      }
    }
  }

  const rememberJobs = (pairs: Array<{ sceneId: string; jobId: string }>) => {
    if (pairs.length === 0) return
    const next = { ...trackedRef.current }
    for (const pair of pairs) {
      if (!pair.jobId) continue
      next[pair.sceneId] = { jobId: pair.jobId, progress: 0, status: 'queued' }
    }
    trackedRef.current = next
    setTracked(next)
    setFilm((current) => {
      if (!current) return current
      const ids = new Set(pairs.map((pair) => pair.sceneId))
      return {
        ...current,
        status: 'generating',
        scenes: scenesOf(current).map((scene) =>
          ids.has(scene.id) ? { ...scene, status: 'queued', error: null } : scene
        ),
      }
    })
  }

  const onAdd = async (afterOrder?: number) => {
    setAdding(true)
    try {
      await createScene(filmId, {
        prompt: 'ฉากใหม่',
        mode: 'T2V',
        duration_sec: 5,
        chain_from_previous: true,
        ...(afterOrder != null ? { order: afterOrder } : {}),
      })
      await reload()
      toast.success(afterOrder != null ? 'แทรกฉากแล้ว' : 'เพิ่มฉากแล้ว')
    } catch (err: unknown) {
      toast.error(filmsErrorMessage(err, 'เพิ่มฉากไม่สำเร็จ'))
    } finally {
      setAdding(false)
    }
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

  const onUpload = async (sceneId: string, file: File, role: ImageRole) => {
    try {
      const uploaded = await uploadSceneImage(filmId, sceneId, file, role)
      const preview = uploaded.url ?? URL.createObjectURL(file)
      setFilm((current) => {
        if (!current) return current
        return {
          ...current,
          scenes: scenesOf(current).map((scene) =>
            scene.id === sceneId
              ? {
                  ...scene,
                  images: [
                    ...scene.images,
                    {
                      id: uploaded.id,
                      scene_id: sceneId,
                      url: preview,
                      role,
                      order: uploaded.order,
                    },
                  ],
                }
              : scene
          ),
        }
      })
    } catch (err: unknown) {
      toast.error(filmsErrorMessage(err, 'อัปโหลดรูปไม่สำเร็จ'))
      throw err
    }
  }

  const onRemoveImage = async (sceneId: string, imageId: string) => {
    const previous = film
    setFilm((current) => {
      if (!current) return current
      return {
        ...current,
        scenes: scenesOf(current).map((scene) =>
          scene.id === sceneId
            ? { ...scene, images: scene.images.filter((image) => image.id !== imageId) }
            : scene
        ),
      }
    })

    try {
      await deleteSceneImage(filmId, sceneId, imageId)
    } catch (err: unknown) {
      toast.error(filmsErrorMessage(err, 'ลบรูปไม่สำเร็จ'))
      if (previous) setFilm(previous)
    }
  }

  const onDuplicate = async (sceneId: string) => {
    try {
      await duplicateScene(filmId, sceneId)
      await reload()
      toast.success('ทำซ้ำฉากแล้ว')
    } catch (err: unknown) {
      toast.error(filmsErrorMessage(err, 'ทำซ้ำฉากไม่สำเร็จ'))
    }
  }

  const onDelete = async (sceneId: string) => {
    try {
      await deleteScene(filmId, sceneId)
      setFilm((current) => {
        if (!current) return current
        const scenes = scenesOf(current)
          .filter((scene) => scene.id !== sceneId)
          .map((scene, index) => ({ ...scene, order: index }))
        return { ...current, scenes }
      })
      toast.success('ลบฉากแล้ว')
    } catch (err: unknown) {
      toast.error(filmsErrorMessage(err, 'ลบฉากไม่สำเร็จ'))
    }
  }

  const onGenerate = async (scene: Scene) => {
    if (!scene.prompt.trim()) {
      toast.error('ใส่พรอมป์ก่อนสร้างฉากนี้')
      return
    }

    try {
      const job = await generateScene(filmId, scene.id)
      rememberJobs([{ sceneId: scene.id, jobId: job.id }])
      toast.success(`เริ่มสร้างฉาก ${scene.order + 1}`)
    } catch (err: unknown) {
      toast.error(filmsErrorMessage(err, 'สั่งสร้างไม่สำเร็จ'))
    }
  }

  const onGenerateAll = async () => {
    const ordered = scenesOf(film)
      .slice()
      .sort((a, b) => a.order - b.order)
      .filter((scene) => scene.status !== 'done')
    if (!film || scenesOf(film).length === 0) {
      toast.error('ยังไม่มีฉาก')
      return
    }
    if (ordered.length === 0) {
      toast.message('ทุกฉากมีคลิปแล้ว')
      return
    }

    setGeneratingAll(true)
    try {
      const jobs = await generateAll(
        filmId,
        ordered.map((scene) => scene.id)
      )
      rememberJobs(ordered.map((scene, index) => ({ sceneId: scene.id, jobId: jobs[index]?.id ?? '' })))
      toast.success('เริ่มสร้างทีละฉากตามลำดับ')
    } catch (err: unknown) {
      toast.error(filmsErrorMessage(err, 'สั่งสร้างทั้งหมดไม่สำเร็จ'))
    } finally {
      setGeneratingAll(false)
    }
  }

  const saveTitle = async () => {
    if (!film) return
    const trimmed = titleValue.trim()
    if (!trimmed || trimmed === film.title) {
      setTitleDraft(null)
      return
    }

    try {
      const updated = await updateFilm(filmId, { title: trimmed })
      setFilm((current) => (current ? { ...current, title: updated.title } : updated))
      setTitleDraft(null)
    } catch (err: unknown) {
      toast.error(filmsErrorMessage(err, 'บันทึกชื่อไม่สำเร็จ'))
      setTitleDraft(null)
    }
  }

  if (loading) return <FilmLoading label="กำลังเปิดเรื่อง..." />
  if (error || !film) {
    return <FilmError message={error ?? 'ไม่พบเรื่องนี้'} onRetry={() => void reload().catch(() => undefined)} />
  }

  const scenes = scenesOf(film).slice().sort((a, b) => a.order - b.order)

  return (
    <FilmChrome
      filmId={filmId}
      title={
        <Input
          id="film-title"
          value={titleValue}
          onChange={(event) => setTitleDraft(event.target.value)}
          onBlur={() => void saveTitle()}
          aria-label="ชื่อเรื่อง"
          className="h-11 font-heading text-lg font-semibold md:h-10"
        />
      }
      meta={
        <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <FilmStatusBadge status={film.status} />
          <span>
            {film.width}×{film.height} · {film.fps} fps · {scenes.length} ฉาก
          </span>
        </p>
      }
      actions={
        <>
          <Button type="button" variant="outline" className="h-11" onClick={() => void onAdd()} disabled={adding}>
            {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            เพิ่มฉาก
          </Button>
          <Button
            type="button"
            className="h-11"
            onClick={() => void onGenerateAll()}
            disabled={generatingAll || scenes.length === 0}
          >
            {generatingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            สร้างทั้งหมด
          </Button>
        </>
      }
    >
      {scenes.length === 0 ? (
        <EmptyState
          title="ยังไม่มีฉาก"
          body="เพิ่มฉากแรก หรือไปที่จากสคริปต์เพื่อแตกเรื่องเป็นฉาก"
          action={
            <Button type="button" className="h-11" onClick={() => void onAdd()}>
              <Plus className="h-4 w-4" />
              เพิ่มฉากแรก
            </Button>
          }
        />
      ) : (
        <ReorderList
          items={scenes}
          getId={(scene) => scene.id}
          onReorder={(next) => void onReorder(next)}
          renderItem={(scene, index, handle) => {
            const job = tracked[scene.id]
            const view: SceneJobView | null = job
              ? { progress: job.progress, status: job.status, error: job.error }
              : null

            return (
              <SceneCard
                scene={scene}
                index={index}
                job={view}
                handle={handle}
                onPatch={(patch) => void patchScene(scene.id, patch)}
                onUpload={(file, role) => onUpload(scene.id, file, role)}
                onRemoveImage={(imageId) => void onRemoveImage(scene.id, imageId)}
                onDuplicate={() => void onDuplicate(scene.id)}
                onDelete={() => void onDelete(scene.id)}
                onInsertAfter={() => void onAdd(scene.order + 1)}
                onGenerate={() => void onGenerate(scene)}
              />
            )
          }}
        />
      )}
    </FilmChrome>
  )
}
