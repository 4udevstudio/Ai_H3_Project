'use client'

/**
 * ========================================
 * รายการหนังสั้น — สร้าง / เปิด / ลบ
 * ========================================
 */

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { Clapperboard, Film, Loader2, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { EmptyState, FilmError, FilmSkeleton, MockBanner } from '@/components/films/bits'
import { FilmStatusBadge } from '@/components/films/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { createFilm, deleteFilm, listFilms } from '@/lib/films-api'
import { filmsErrorMessage, withApiHint } from '@/lib/films-error'
import type { Film as FilmProject } from '@/lib/films-types'

export function FilmList() {
  const router = useRouter()
  const [films, setFilms] = React.useState<FilmProject[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [title, setTitle] = React.useState('')
  const [creating, setCreating] = React.useState(false)
  const [pendingDelete, setPendingDelete] = React.useState<FilmProject | null>(null)
  const [deleting, setDeleting] = React.useState(false)

  const load = React.useCallback(async () => {
    try {
      const next = await listFilms()
      setFilms(next)
      setError(null)
    } catch (err: unknown) {
      setError(withApiHint(err, 'โหลดรายการหนังสั้นไม่สำเร็จ'))
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const next = await listFilms()
        if (cancelled) return
        setFilms(next)
        setError(null)
      } catch (err: unknown) {
        if (cancelled) return
        setError(withApiHint(err, 'โหลดรายการหนังสั้นไม่สำเร็จ'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  const onCreate = async (event: React.FormEvent) => {
    event.preventDefault()
    const trimmed = title.trim()
    if (!trimmed) {
      toast.error('กรุณากรอกชื่อเรื่อง')
      return
    }

    setCreating(true)
    try {
      const film = await createFilm(trimmed)
      toast.success('สร้างเรื่องแล้ว')
      router.push(`/shortfilm/${film.id}`)
    } catch (err: unknown) {
      toast.error(filmsErrorMessage(err, 'สร้างเรื่องไม่สำเร็จ'))
    } finally {
      setCreating(false)
    }
  }

  const onDelete = async () => {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      await deleteFilm(pendingDelete.id)
      setFilms((current) => current.filter((film) => film.id !== pendingDelete.id))
      toast.success('ลบเรื่องแล้ว')
      setPendingDelete(null)
    } catch (err: unknown) {
      toast.error(filmsErrorMessage(err, 'ลบเรื่องไม่สำเร็จ'))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-4">
      <MockBanner />

      <Card className="studio-card shadow-lg">
        <CardHeader className="border-b border-border bg-card/60">
          <CardTitle className="flex items-center gap-3 text-xl">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Film className="h-5 w-5" />
            </span>
            สร้างหนังสั้น
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            เปิดเรื่อง จัดฉากกี่ฉากก็ได้ แล้วแตกจากสคริปต์หรือรวมเป็นคลิปเดียว
          </p>
        </CardHeader>
        <CardContent className="grid gap-3">
          <form onSubmit={onCreate} className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="ชื่อเรื่องใหม่"
              aria-label="ชื่อเรื่องใหม่"
              className="h-11 md:h-9"
            />
            <Button type="submit" className="h-11 sm:w-auto" disabled={creating}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              สร้างเรื่อง
            </Button>
          </form>
          <Link
            href="/shortfilm/classic"
            className="inline-flex h-11 items-center gap-2 text-xs text-muted-foreground hover:text-foreground sm:h-auto"
          >
            <Clapperboard className="h-3.5 w-3.5" />
            โหมดคิวเดิม (4 ฉากคงที่ · ต่อ FastAPI โดยตรง)
          </Link>
        </CardContent>
      </Card>

      {loading ? <FilmSkeleton label="กำลังโหลดเรื่อง..." /> : null}
      {error ? <FilmError message={error} onRetry={() => void load()} /> : null}

      {!loading && !error && films.length === 0 ? (
        <EmptyState
          title="ยังไม่มีเรื่อง"
          body="ตั้งชื่อด้านบนแล้วกดสร้างเรื่อง เพื่อเริ่มเรียงฉาก แตกสคริปต์ และรวมเป็นภาพยนตร์"
        />
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        {films.map((film, index) => (
          <motion.div
            key={film.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(index, 6) * 0.04 }}
          >
            <Card className="studio-card h-full shadow-sm">
              <CardContent className="grid gap-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="truncate font-heading text-base font-semibold">{film.title}</h2>
                    <p className="text-xs text-muted-foreground">
                      {film.scenes ? `${film.scenes.length} ฉาก · ` : ''}
                      {film.width}×{film.height} · {film.fps} fps
                    </p>
                  </div>
                  <FilmStatusBadge status={film.status} />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    nativeButton={false}
                    render={<Link href={`/shortfilm/${film.id}`} />}
                    className="h-11 flex-1"
                  >
                    เปิดเรื่อง
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-11 w-11"
                    onClick={() => setPendingDelete(film)}
                    aria-label={`ลบ ${film.title}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {pendingDelete ? (
        <div className="fixed inset-0 z-[950] flex items-end justify-center bg-black/60 p-4 sm:items-center">
          <Card className="w-full max-w-sm shadow-2xl">
            <CardHeader>
              <CardTitle>ลบเรื่องนี้?</CardTitle>
              <p className="text-sm text-muted-foreground">
                {pendingDelete.title} และฉากทั้งหมดจะหายไป
              </p>
            </CardHeader>
            <CardContent className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-11"
                onClick={() => setPendingDelete(null)}
                disabled={deleting}
              >
                ยกเลิก
              </Button>
              <Button type="button" variant="destructive" className="h-11" onClick={() => void onDelete()} disabled={deleting}>
                {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                ลบเรื่อง
              </Button>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  )
}
