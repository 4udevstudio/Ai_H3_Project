'use client'

/**
 * ProjectDetailView (v2)
 * - แสดง media grid (thumbnail + กดเล่น) เหมือนหน้า Media
 * - ปุ่ม "+ เพิ่มวิดีโอ" → ไปหน้า Media แบบ pick mode
 * - ปุ่ม "นำออก" ต่อคลิป (unlink)
 * - auto refresh 5 วิ
 */

import * as React from 'react'
import Link from 'next/link'
import {
  AlertCircle,
  ArrowLeft,
  ChevronUp,
  Download,
  ExternalLink,
  Film,
  FolderOpen,
  ImageIcon,
  Layers,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

interface ProjectDetail {
  id: string
  name: string
  description: string | null
  theme: string
  createdAt: string
  updatedAt: string
  _count: { generations: number }
}

interface GenerationItem {
  id: string
  projectId: string | null
  type: string
  prompt: string
  negativePrompt: string | null
  seed: number
  steps: number
  resolution: string
  videoPath: string | null
  thumbnailPath: string | null
  duration: number | null
  status: string
  createdAt: string
  completedAt: string | null
}

const BACKEND_URL =
  typeof window !== 'undefined'
    ? `${window.location.protocol}//${window.location.hostname}:8000`
    : 'http://127.0.0.1:8000'

function getMediaUrl(p?: string | null): string | null {
  if (!p) return null
  if (/^https?:\/\//i.test(p)) return p
  return `${BACKEND_URL}/api/media/${p.replace(/^\/+/, '')}`
}

function formatDuration(s: number | null): string {
  if (s === null || !Number.isFinite(s)) return '-'
  return `${s.toFixed(1)}s`
}

function formatDate(iso: string | null): string {
  if (!iso) return '-'
  try { return new Date(iso).toLocaleString() } catch { return '-' }
}

const LINK_GHOST =
  'inline-flex h-8 w-8 items-center justify-center rounded-md text-foreground transition-colors hover:bg-accent hover:text-accent-foreground'

export function ProjectDetailView({ projectId }: { projectId: string }) {
  const [project, setProject] = React.useState<ProjectDetail | null>(null)
  const [generations, setGenerations] = React.useState<GenerationItem[]>([])
  const [loading, setLoading] = React.useState(true)
  const [refreshing, setRefreshing] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [expandedId, setExpandedId] = React.useState<string | null>(null)
  const [removingId, setRemovingId] = React.useState<string | null>(null)

  const loadAll = React.useCallback(async (spin = false) => {
    if (spin) setRefreshing(true)
    try {
      const [pRes, gRes] = await Promise.all([
        fetch(`/api/projects/${projectId}`, { cache: 'no-store' }),
        fetch(`/api/projects/${projectId}/generations`, { cache: 'no-store' }),
      ])
      if (!pRes.ok || !gRes.ok) throw new Error(`HTTP ${pRes.status}/${gRes.status}`)
      setProject((await pRes.json()) as ProjectDetail)
      setGenerations((await gRes.json()) as GenerationItem[])
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'โหลดไม่สำเร็จ')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [projectId])

  React.useEffect(() => {
    void loadAll()
    const id = window.setInterval(() => void loadAll(), 5000)
    return () => window.clearInterval(id)
  }, [loadAll])

  const handleRemove = async (itemId: string) => {
    setRemovingId(itemId)
    try {
      const res = await fetch(`/api/history/${itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: null }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      toast.success('นำออกจากโปรเจคแล้ว')
      await loadAll()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'นำออกไม่สำเร็จ')
    } finally {
      setRemovingId(null)
    }
  }

  return (
    <div className="grid gap-6">
      <Card className="shadow-lg">
        <CardHeader className="border-b border-border bg-card/60 backdrop-blur">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <Link href="/projects" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
                <ArrowLeft className="h-3.5 w-3.5" /> กลับไปรายการโปรเจค
              </Link>

              <CardTitle className="mt-2 flex items-center gap-3 text-xl">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <FolderOpen className="h-5 w-5" />
                </span>
                <span className="truncate">{project?.name ?? 'กำลังโหลด...'}</span>
              </CardTitle>

              <p className="mt-2 text-sm text-muted-foreground">{project?.description ?? 'ยังไม่มีคำอธิบาย'}</p>
            </div>

            <div className="flex gap-2">
              <Link href={`/media?pickFor=${projectId}`}>
                <Button variant="default" size="sm">
                  <Plus className="mr-2 h-4 w-4" /> เพิ่มวิดีโอ
                </Button>
              </Link>

              <Button variant="outline" size="sm" onClick={() => void loadAll(true)} disabled={refreshing}>
                {refreshing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                รีเฟรช
              </Button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-primary">
              <Layers className="h-3.5 w-3.5" />
              {project?._count.generations ?? 0} วิดีโอ
            </span>
            {project && (
              <>
                <span>สร้างเมื่อ: {formatDate(project.createdAt)}</span>
                <span>อัปเดต: {formatDate(project.updatedAt)}</span>
              </>
            )}
          </div>
        </CardHeader>

        <CardContent className="p-5">
          {error && (
            <div className="mb-4 flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {loading ? (
            <div className="flex min-h-64 flex-col items-center justify-center gap-3 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin" />
              <p className="text-sm">กำลังโหลดโปรเจค...</p>
            </div>
          ) : generations.length === 0 ? (
            <div className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-muted/20 p-8 text-center">
              <Film className="h-10 w-10 text-muted-foreground" />
              <p className="text-sm font-medium text-foreground">ยังไม่มีวิดีโอในโปรเจค</p>
              <p className="text-xs text-muted-foreground">กด &quot;เพิ่มวิดีโอ&quot; เพื่อเลือกจากคลังมีเดีย</p>
              <Link href={`/media?pickFor=${projectId}`}>
                <Button variant="outline" size="sm" className="mt-2">
                  <Plus className="mr-2 h-4 w-4" /> เลือกวิดีโอจากคลัง
                </Button>
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {generations.map((item) => {
                const videoUrl = getMediaUrl(item.videoPath)
                const thumbUrl = getMediaUrl(item.thumbnailPath)
                const isExpanded = expandedId === item.id
                const isRemoving = removingId === item.id

                return (
                  <div key={item.id} className="overflow-hidden rounded-xl border border-border bg-muted/20 shadow-sm">
                    {isExpanded && videoUrl ? (
                      <div className="relative aspect-square w-full bg-black">
                        <video src={videoUrl} controls autoPlay preload="metadata" playsInline className="h-full w-full object-contain" />
                        <button type="button" onClick={() => setExpandedId(null)} className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80" aria-label="ย่อ">
                          <ChevronUp className="h-4 w-4" />
                        </button>
                      </div>
                    ) : (
                      <button type="button" onClick={() => videoUrl && setExpandedId(item.id)} className="group relative block aspect-square w-full bg-black" aria-label="เล่น">
                        {thumbUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={thumbUrl} alt={item.prompt} className="h-full w-full object-contain" />
                        ) : (
                          <span className="flex h-full w-full items-center justify-center text-muted-foreground">
                            <ImageIcon className="h-8 w-8" />
                          </span>
                        )}
                        <span className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 transition-opacity group-hover:opacity-100">
                          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/90 text-black shadow-lg">
                            <Play className="h-5 w-5" />
                          </span>
                        </span>
                        {item.duration != null && (
                          <span className="absolute bottom-2 right-2 rounded-full bg-black/60 px-2 py-0.5 font-mono text-[10px] text-white">
                            {formatDuration(item.duration)}
                          </span>
                        )}
                      </button>
                    )}

                    <div className="grid gap-2 p-3">
                      <p className="line-clamp-2 min-h-9 text-xs font-medium text-foreground" title={item.prompt}>
                        {item.prompt}
                      </p>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-muted-foreground">
                        <span>{item.type}</span>
                        <span>Res: {item.resolution}</span>
                        <span>Seed: {item.seed}</span>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5">
                        {videoUrl && (
                          <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => setExpandedId(isExpanded ? null : item.id)}>
                            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                          </Button>
                        )}

                        {videoUrl && (
                          <a href={videoUrl} download={`${item.id}.mp4`} className={cn(LINK_GHOST, 'h-8 w-8 px-0')} title="ดาวน์โหลด">
                            <Download className="h-4 w-4" />
                          </a>
                        )}

                        {videoUrl && (
                          <a href={videoUrl} target="_blank" rel="noreferrer" className={cn(LINK_GHOST, 'h-8 w-8 px-0')} title="เปิดในแท็บใหม่">
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        )}

                        <span className="ml-auto" />

                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 text-xs text-muted-foreground hover:text-destructive"
                          onClick={() => void handleRemove(item.id)}
                          disabled={isRemoving}
                        >
                          {isRemoving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Trash2 className="mr-1.5 h-3.5 w-3.5" />}
                          นำออก
                        </Button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}