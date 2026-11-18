'use client'

/**
 * ========================================
 * DashboardOverview
 * ========================================
 * หน้ารวมภาพรวมระบบ: stats + queue + activity + quick actions
 */

import * as React from 'react'
import Link from 'next/link'
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Clapperboard,
  Film,
  FolderOpen,
  HardDrive,
  Images,
  LayoutDashboard,
  Loader2,
  RefreshCw,
  XCircle,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  fetchGenerations,
  fetchProjects,
  fetchStorageStats,
  type QueueJobResponse,
  type StorageStats,
} from '@/lib/backend'
import { fetchFrames } from '@/lib/backend'
import { cn } from '@/lib/utils'

const REFRESH_MS = 5000

interface HistoryRow {
  id: string
  type: string
  prompt: string
  status: string
  videoPath: string | null
  createdAt: string
  completedAt: string | null
}

interface ActivityItem {
  id: string
  kind: 'queue' | 'history'
  status: string
  label: string
  time: string
}

function statusColor(status: string): string {
  switch (status) {
    case 'DONE':
      return 'text-green-500'
    case 'FAILED':
      return 'text-destructive'
    case 'CANCELLED':
      return 'text-orange-500'
    case 'RUNNING':
      return 'text-blue-500'
    default:
      return 'text-muted-foreground'
  }
}

function statusIcon(status: string) {
  switch (status) {
    case 'DONE':
      return CheckCircle2
    case 'FAILED':
      return XCircle
    case 'CANCELLED':
      return AlertCircle
    case 'RUNNING':
      return Loader2
    default:
      return Activity
  }
}

function formatTime(iso: string | null): string {
  if (!iso) return '-'
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return '-'
  }
}

export function DashboardOverview() {
  const [videos, setVideos] = React.useState(0)
  const [projects, setProjects] = React.useState(0)
  const [frames, setFrames] = React.useState(0)
  const [storage, setStorage] = React.useState<StorageStats | null>(null)
  const [jobs, setJobs] = React.useState<QueueJobResponse[]>([])
  const [history, setHistory] = React.useState<HistoryRow[]>([])
  const [loading, setLoading] = React.useState(true)
  const [refreshing, setRefreshing] = React.useState(false)

  const load = React.useCallback(async (spin = false) => {
    if (spin) setRefreshing(true)
    try {
      const [gens, hist, projs, frs, sto] = await Promise.all([
        fetchGenerations(50),
        fetch('/api/history?limit=200', { cache: 'no-store' }).then((r) => (r.ok ? (r.json() as Promise<HistoryRow[]>) : [])),
        fetchProjects().catch(() => []),
        fetchFrames().catch(() => ({ count: 0, total_size_mb: 0, frames: [] })),
        fetchStorageStats().catch(() => null),
      ])

      setJobs(gens)
      setHistory(hist)
      setProjects(projs.length)
      setFrames(frs.count)
      setStorage(sto)
      setVideos(hist.filter((h) => h.status === 'DONE' && h.videoPath).length)
    } catch {
      // ข้าม
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  React.useEffect(() => {
    void load()
    const id = window.setInterval(() => void load(), REFRESH_MS)
    return () => window.clearInterval(id)
  }, [load])

  const running = jobs.filter((j) => j.status === 'RUNNING')
  const pending = jobs.filter((j) => j.status === 'PENDING')

  const activity = React.useMemo<ActivityItem[]>(() => {
    const fromQueue: ActivityItem[] = [...running, ...pending].map((j) => ({
      id: `q-${j.id}`,
      kind: 'queue',
      status: j.status,
      label: j.prompt,
      time: j.updated_at,
    }))

    const fromHistory: ActivityItem[] = history
      .filter((h) => ['DONE', 'FAILED', 'CANCELLED'].includes(h.status))
      .slice(0, 10)
      .map((h) => ({
        id: `h-${h.id}`,
        kind: 'history',
        status: h.status,
        label: h.prompt,
        time: h.completedAt ?? h.createdAt,
      }))

    return [...fromQueue, ...fromHistory]
      .sort((a, b) => (b.time || '').localeCompare(a.time || ''))
      .slice(0, 8)
  }, [running, pending, history])

  const statCards = [
    { label: 'วิดีโอ', value: String(videos), icon: Clapperboard, href: '/media' },
    { label: 'โปรเจค', value: String(projects), icon: FolderOpen, href: '/projects' },
    { label: 'เฟรม', value: String(frames), icon: Images, href: '/frames' },
    {
      label: 'พื้นที่ใช้',
      value: storage ? `${storage.total_gb} GB` : '-',
      icon: HardDrive,
      href: '/media',
    },
  ]

  return (
    <div className="grid gap-6">
      {/* Header */}
      <Card className="shadow-lg">
        <CardHeader className="border-b border-border bg-card/60 backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-3 text-xl">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <LayoutDashboard className="h-5 w-5" />
              </span>
              แดชบอร์ด
            </CardTitle>

            <Button variant="outline" size="sm" onClick={() => void load(true)} disabled={refreshing}>
              {refreshing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              รีเฟรช
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            ภาพรวมระบบทั้งหมด — วิดีโอ, โปรเจค, คิวงาน และกิจกรรมล่าสุด
          </p>
        </CardHeader>

        <CardContent className="p-5">
          {loading ? (
            <div className="flex min-h-40 items-center justify-center gap-3 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
              <span className="text-sm">กำลังโหลด...</span>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {statCards.map((card) => {
                const Icon = card.icon
                return (
                  <Link
                    key={card.label}
                    href={card.href}
                    className="group rounded-xl border border-border bg-muted/20 p-4 shadow-sm transition-all hover:border-primary/40 hover:shadow-md"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground">{card.label}</span>
                      <Icon className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-primary" />
                    </div>
                    <p className="mt-2 font-mono text-2xl font-bold text-foreground">{card.value}</p>
                  </Link>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Queue status */}
        <Card className="shadow-lg">
          <CardHeader className="border-b border-border bg-card/60 px-5 py-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-4 w-4 text-primary" />
              สถานะคิว
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 p-5">
            {running.length === 0 && pending.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">ไม่มีงานในคิว</p>
            ) : (
              <>
                {running.map((j) => (
                  <div key={j.id} className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 text-xs font-medium text-blue-600 dark:text-blue-400">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> RUNNING {Math.round(j.progress)}%
                      </span>
                      <Link href="/studio" className="text-[10px] text-muted-foreground hover:text-foreground">
                        ดูใน Studio →
                      </Link>
                    </div>
                    <p className="mt-1 line-clamp-1 text-xs text-foreground">{j.prompt}</p>
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div className="h-full bg-blue-500 transition-all" style={{ width: `${j.progress}%` }} />
                    </div>
                  </div>
                ))}

                {pending.map((j) => (
                  <div key={j.id} className="rounded-lg border border-border bg-muted/20 p-3">
                    <span className="text-xs font-medium text-muted-foreground">PENDING</span>
                    <p className="mt-1 line-clamp-1 text-xs text-foreground">{j.prompt}</p>
                  </div>
                ))}
              </>
            )}
          </CardContent>
        </Card>

        {/* Recent activity */}
        <Card className="shadow-lg">
          <CardHeader className="border-b border-border bg-card/60 px-5 py-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-4 w-4 text-primary" />
              กิจกรรมล่าสุด
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 p-5">
            {activity.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">ยังไม่มีกิจกรรม</p>
            ) : (
              activity.map((item) => {
                const Icon = statusIcon(item.status)
                return (
                  <div key={item.id} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-muted/30">
                    <Icon className={cn('h-4 w-4 shrink-0', statusColor(item.status), item.status === 'RUNNING' && 'animate-spin')} />
                    <span className="min-w-0 flex-1 truncate text-xs text-foreground" title={item.label}>
                      {item.label}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{formatTime(item.time)}</span>
                  </div>
                )
              })
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick actions */}
      <Card className="shadow-lg">
        <CardHeader className="border-b border-border bg-card/60 px-5 py-3">
          <CardTitle className="text-base">ทางลัด</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3 p-5">
          <Link href="/studio">
            <Button variant="outline" size="sm">
              <Clapperboard className="mr-2 h-4 w-4" /> สร้างคลิปสั้น
            </Button>
          </Link>
          <Link href="/shortfilm">
            <Button variant="outline" size="sm">
              <Film className="mr-2 h-4 w-4" /> สร้างหนังสั้น
            </Button>
          </Link>
          <Link href="/media">
            <Button variant="outline" size="sm">
              <Images className="mr-2 h-4 w-4" /> คลังมีเดีย
            </Button>
          </Link>
          <Link href="/projects">
            <Button variant="outline" size="sm">
              <FolderOpen className="mr-2 h-4 w-4" /> โปรเจค
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  )
}