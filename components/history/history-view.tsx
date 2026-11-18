'use client'

/**
 * ========================================
 * HistoryView (STEP 8.6)
 * ========================================
 * Description:
 * UI แสดงประวัติการสร้างวิดีโอจาก Database
 *
 * Features:
 * - โหลดรายการจาก /api/history
 * - auto refresh ประวัติทุก 5 วินาที
 * - auto refresh รายการโปรเจคทุก 10 วินาที
 * - แสดงสถานะ DONE / CANCELLED / FAILED
 * - ลบรายการประวัติได้
 * - เลือกโปรเจคจาก dropdown
 * - ย้ายงานเข้าโปรเจค / ถอดออกจากโปรเจค
 * - แสดงชื่อโปรเจคใน badge ของงาน
 * - แสดง thumbnail ก่อน แล้วกดขยายเพื่อเล่นวิดีโอ
 * - แสดง duration จาก metadata จริง
 * - รองรับทุกธีมผ่าน CSS variables ของ shadcn/Tailwind
 */

import * as React from 'react'
import {
  AlertCircle,
  CheckCircle2,
  ChevronUp,
  Clock,
  Download,
  ExternalLink,
  FolderOpen,
  History,
  Loader2,
  Play,
  RefreshCw,
  Trash2,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { getMediaUrl } from '@/lib/backend'

/**
 * โครงสร้างข้อมูลประวัติรายตัวที่ API คืนค่าจาก Prisma
 */
interface HistoryItem {
  id: string
  projectId: string | null
  type: string
  prompt: string
  negativePrompt: string | null
  seed: number
  steps: number
  resolution: string
  taskAdapter: string | null
  loraUsed: string | null
  useAIEnhancement: boolean
  videoPath: string | null
  audioPath: string | null
  thumbnailPath: string | null
  duration: number | null
  status: string
  error: string | null
  generationTime: number | null
  vramUsed: number | null
  createdAt: string
  completedAt: string | null
}

/**
 * โครงสร้างข้อมูลโปรเจคสั้นๆ สำหรับ dropdown
 */
interface ProjectOption {
  id: string
  name: string
}

/**
 * classes พื้นฐานสำหรับปุ่มลิงก์แบบ anchor
 */
const LINK_BUTTON_BASE =
  'inline-flex h-9 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50'

const MEDIA_BOX_CLASS =
  'relative inline-flex h-[300px] w-[300px] items-center justify-center overflow-hidden rounded-lg border border-border bg-black'


const LINK_BUTTON_OUTLINE =
  `${LINK_BUTTON_BASE} border border-input bg-background text-foreground shadow-sm hover:bg-accent hover:text-accent-foreground`

const LINK_BUTTON_GHOST =
  `${LINK_BUTTON_BASE} text-foreground hover:bg-accent hover:text-accent-foreground`

/**
 * คืน Tailwind classes สำหรับ badge สถานะ
 */
function getStatusClasses(status: string): string {
  switch (status) {
    case 'DONE':
      return 'bg-green-500/10 text-green-600 dark:text-green-400'
    case 'FAILED':
      return 'bg-destructive/10 text-destructive'
    case 'CANCELLED':
      return 'bg-orange-500/10 text-orange-600 dark:text-orange-400'
    default:
      return 'bg-muted text-muted-foreground'
  }
}

/**
 * คืนไอคอนตามสถานะ
 */
function getStatusIcon(status: string) {
  switch (status) {
    case 'DONE':
      return CheckCircle2
    case 'FAILED':
      return XCircle
    case 'CANCELLED':
      return AlertCircle
    default:
      return Clock
  }
}

/**
 * แปลง ISO date string เป็นเวลาท้องถิ่นอ่านง่าย
 */
function formatDateTime(isoDate: string | null): string {
  if (!isoDate) return '-'

  try {
    return new Date(isoDate).toLocaleString()
  } catch {
    return '-'
  }
}

/**
 * แปลงวินาทีเป็นข้อความระยะเวลา
 */
function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '-'

  if (seconds < 60) {
    return `${seconds.toFixed(1)} วินาที`
  }

  const minutes = Math.floor(seconds / 60)
  const remainSeconds = Math.round(seconds % 60)

  return `${minutes} นาที ${remainSeconds} วินาที`
}

/**
 * คอมโพเนนต์หลักของหน้า History
 */
export function HistoryView() {
  const [items, setItems] = React.useState<HistoryItem[]>([])
  const [projects, setProjects] = React.useState<ProjectOption[]>([])
  const [loading, setLoading] = React.useState(true)
  const [refreshing, setRefreshing] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const [projectsLoading, setProjectsLoading] = React.useState(true)
  const [projectsError, setProjectsError] = React.useState<string | null>(null)

  const [projectDrafts, setProjectDrafts] = React.useState<Record<string, string>>({})
  const [busyItemId, setBusyItemId] = React.useState<string | null>(null)

  /**
   * งานที่ผู้ใช้กดขยายเพื่อดูวิดีโอ
   */
  const [expandedVideoId, setExpandedVideoId] = React.useState<string | null>(null)

  /**
   * ดึงรายการประวัติจาก API
   */
  const loadHistory = React.useCallback(async (showSpinner = false) => {
    if (showSpinner) setRefreshing(true)

    try {
      const response = await fetch('/api/history?limit=200', {
        method: 'GET',
        cache: 'no-store',
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const data = (await response.json()) as HistoryItem[]
      setItems(data)
      setError(null)
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'ดึงประวัติไม่สำเร็จ'
      setError(message)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  /**
   * ดึงรายชื่อโปรเจคจาก API
   */
  const loadProjects = React.useCallback(async () => {
    setProjectsLoading(true)

    try {
      const response = await fetch('/api/projects', {
        method: 'GET',
        cache: 'no-store',
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const data = (await response.json()) as Array<{
        id: string
        name: string
      }>

      const options = data.map((project) => ({
        id: project.id,
        name: project.name,
      }))

      setProjects(options)
      setProjectsError(null)

      console.debug('[HistoryView] โหลดโปรเจคสำเร็จ:', options.length, 'รายการ')
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'ดึงรายชื่อโปรเจคไม่สำเร็จ'
      setProjectsError(message)
      console.error('[HistoryView] ดึงรายชื่อโปรเจคไม่สำเร็จ:', err)
    } finally {
      setProjectsLoading(false)
    }
  }, [])

  /**
   * โหลดครั้งแรกและตั้งเวลา auto refresh
   */
  React.useEffect(() => {
    void loadHistory()
    void loadProjects()

    const historyInterval = window.setInterval(() => {
      void loadHistory()
    }, 5000)

    const projectsInterval = window.setInterval(() => {
      void loadProjects()
    }, 10000)

    return () => {
      window.clearInterval(historyInterval)
      window.clearInterval(projectsInterval)
    }
  }, [loadHistory, loadProjects])

  /**
   * รีเฟรชทั้งประวัติและโปรเจคด้วยมือ
   */
  const handleManualRefresh = async () => {
    setRefreshing(true)
    await Promise.all([loadHistory(true), loadProjects()])
  }

  /**
   * อัปเดตค่า draft ของการเลือกโปรเจค
   */
  const handleProjectSelect = (itemId: string, projectId: string) => {
    setProjectDrafts((prev) => ({
      ...prev,
      [itemId]: projectId,
    }))
  }

  /**
   * ย้ายงานเข้าโปรเจค
   */
  const handleMoveToProject = async (item: HistoryItem) => {
    const selectedProjectId = projectDrafts[item.id] ?? item.projectId ?? ''

    if (!selectedProjectId) {
      toast.error('กรุณาเลือกโปรเจคก่อนย้ายเข้า')
      return
    }

    if (selectedProjectId === item.projectId) {
      toast.info('งานนี้อยู่ในโปรเจคนี้อยู่แล้ว')
      return
    }

    setBusyItemId(item.id)

    try {
      const response = await fetch(`/api/history/${item.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          projectId: selectedProjectId,
        }),
      })

      if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw new Error(text || `HTTP ${response.status}`)
      }

      const updated = (await response.json()) as HistoryItem

      setItems((prev) =>
        prev.map((row) => (row.id === updated.id ? updated : row))
      )

      setProjectDrafts((prev) => {
        const next = { ...prev }
        delete next[item.id]
        return next
      })

      toast.success('ย้ายงานเข้าโปรเจcreียบร้อย')
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'ย้ายงานเข้าโปรเจคไม่สำเร็จ'
      toast.error(message)
    } finally {
      setBusyItemId(null)
    }
  }

  /**
   * ถอดงานออกจากโปรเจค
   */
  const handleRemoveFromProject = async (item: HistoryItem) => {
    if (!item.projectId) {
      toast.info('งานนี้ยังไม่ได้ อยู่ในโปรเจค')
      return
    }

    setBusyItemId(item.id)

    try {
      const response = await fetch(`/api/history/${item.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          projectId: null,
        }),
      })

      if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw new Error(text || `HTTP ${response.status}`)
      }

      const updated = (await response.json()) as HistoryItem

      setItems((prev) =>
        prev.map((row) => (row.id === updated.id ? updated : row))
      )

      setProjectDrafts((prev) => {
        const next = { ...prev }
        delete next[item.id]
        return next
      })

      toast.success('ถอดงานออกจากโปรเจคเรียบร้อย')
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'ถอดงานออกจากโปรเจคไม่สำเร็จ'
      toast.error(message)
    } finally {
      setBusyItemId(null)
    }
  }

  /**
   * ลบประวัติรายตัว
   */
  const handleDelete = async (id: string) => {
    try {
      const response = await fetch(`/api/history/${id}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      setItems((prev) => prev.filter((item) => item.id !== id))
      setProjectDrafts((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })

      toast.success('ลบประวัติเรียบร้อย')
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'ลบประวัติไม่สำเร็จ'
      toast.error(message)
    }
  }

  /**
   * หาชื่อโปรเจคจาก id เพื่อแสดงใน badge
   */
  const getProjectName = (projectId: string | null): string | null => {
    if (!projectId) return null
    const found = projects.find((p) => p.id === projectId)
    return found?.name ?? null
  }

  return (
    <Card className="shadow-lg">
      <CardHeader className="border-b border-border bg-card/60 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-3 text-xl">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <History className="h-5 w-5" />
            </span>
            ประวัติการสร้างวิดีโอ
          </CardTitle>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadProjects()}
              disabled={projectsLoading}
              title="รีเฟรชรายชื่อโปรเจค"
            >
              {projectsLoading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <FolderOpen className="mr-2 h-4 w-4" />
              )}
              โปรเจค ({projects.length})
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleManualRefresh()}
              disabled={refreshing}
            >
              {refreshing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              รีเฟรช
            </Button>
          </div>
        </div>

        <p className="text-sm text-muted-foreground">
          แสดงงานที่ถูกบันทึกจาก Queue แล้ว อัปเดตอัตโนมัติทุก 5 วินาที
        </p>
      </CardHeader>

      <CardContent className="p-5">
        {error && (
          <div className="mb-4 flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {projectsError && (
          <div className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>โหลดรายชื่อโปรเจคไม่สำเร็จ: {projectsError}</span>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void loadProjects()}
              className="shrink-0"
            >
              ลองใหม่
            </Button>
          </div>
        )}

        {loading ? (
          <div className="flex min-h-64 flex-col items-center justify-center gap-3 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin" />
            <p className="text-sm">กำลังโหลดประวัติ...</p>
          </div>
        ) : items.length === 0 ? (
          <div className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-muted/20 p-8 text-center">
            <History className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">
              ยังไม่มีประวัติการสร้างวิดีโอ
            </p>
            <p className="text-xs text-muted-foreground">
              ไปที่หน้า Studio แล้วสร้างวิดีโอเพื่อทดสอบระบบ queue และ history
            </p>
          </div>
        ) : (
          <div className="grid gap-4">
            {items.map((item) => {
              const StatusIcon = getStatusIcon(item.status)
              const currentProjectId = item.projectId ?? ''
              const draftProjectId = projectDrafts[item.id] ?? currentProjectId
              const isBusy = busyItemId === item.id
              const hasChanged = draftProjectId !== currentProjectId
              const canMove = Boolean(draftProjectId) && hasChanged
              const canRemove = Boolean(currentProjectId)
              const projectName = getProjectName(item.projectId)
              const videoUrl = getMediaUrl(item.videoPath)
              const thumbnailUrl = getMediaUrl(item.thumbnailPath)
              const isExpanded = expandedVideoId === item.id

              return (
                <div
                  key={item.id}
                  className="rounded-xl border border-border bg-muted/20 p-4 shadow-sm transition-shadow hover:shadow-md"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={cn(
                            'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
                            getStatusClasses(item.status)
                          )}
                        >
                          <StatusIcon className="h-3.5 w-3.5" />
                          {item.status}
                        </span>

                        {projectName && (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                            <FolderOpen className="h-3.5 w-3.5" />
                            {projectName}
                          </span>
                        )}

                        <span className="text-xs text-muted-foreground">
                          {formatDateTime(item.createdAt)}
                        </span>
                      </div>

                      <p className="mt-2 line-clamp-3 text-sm font-medium text-foreground">
                        {item.prompt}
                      </p>

                      {item.negativePrompt && (
                        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                          Negative: {item.negativePrompt}
                        </p>
                      )}
                    </div>

                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => void handleDelete(item.id)}
                      aria-label="ลบประวัติรายการนี้"
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>

                  <div className="mt-4 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2 lg:grid-cols-4">
                    <span>Type: {item.type}</span>
                    <span>Res: {item.resolution}</span>
                    <span>Steps: {item.steps}</span>
                    <span>Seed: {item.seed}</span>

                    {item.taskAdapter && (
                      <span>Adapter: {item.taskAdapter}</span>
                    )}

                    {item.loraUsed && item.loraUsed !== 'none' && (
                      <span>LoRA: {item.loraUsed}</span>
                    )}

                    <span>
                      Duration: {formatDuration(item.duration)}
                    </span>

                    <span>
                      เวลาประมวลผล: {formatDuration(item.generationTime)}
                    </span>

                    <span>
                      เสร็จเมื่อ: {formatDateTime(item.completedAt)}
                    </span>
                  </div>

                  {/* ========================================
                      แสดง thumbnail / video
                      ======================================== */}
                  {item.status === 'DONE' && (videoUrl || thumbnailUrl) && (
                    <div className="mt-4 grid gap-2">
                      {isExpanded && videoUrl ? (
                        <>
                          <p className="text-xs font-medium text-muted-foreground">
                            ผลลัพธ์วิดีโอ
                          </p>

                          <div className={MEDIA_BOX_CLASS}>
                            <video
                              src={videoUrl}
                              controls
                              preload="metadata"
                              playsInline
                              className="h-full w-full object-contain"
                            />
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            <a
                              href={videoUrl}
                              target="_blank"
                              rel="noreferrer"
                              className={LINK_BUTTON_OUTLINE}
                            >
                              <ExternalLink className="h-4 w-4" />
                              เปิดวิดีโอในแท็บใหม่
                            </a>

                            <a
                              href={videoUrl}
                              download={`${item.id}.mp4`}
                              className={LINK_BUTTON_GHOST}
                            >
                              <Download className="h-4 w-4" />
                              ดาวน์โหลด
                            </a>

                            <button
                              type="button"
                              onClick={() => setExpandedVideoId(null)}
                              className={LINK_BUTTON_GHOST}
                            >
                              <ChevronUp className="h-4 w-4" />
                              ย่อ
                            </button>
                          </div>
                        </>
                        ) : thumbnailUrl ? (
                          <>
                            <p className="text-xs font-medium text-muted-foreground">
                              Thumbnail
                            </p>

                            <button
                              type="button"
                              onClick={() => setExpandedVideoId(item.id)}
                              className={`group ${MEDIA_BOX_CLASS}`}
                              aria-label="เล่นวิดีโอ"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={thumbnailUrl}
                                alt={`thumbnail ของงาน ${item.id}`}
                                className="max-h-full max-w-full object-contain"
                              />

                              <span className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 transition-opacity group-hover:opacity-100">
                                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-black shadow-lg">
                                  <Play className="h-4 w-4" />
                                </span>
                              </span>
                            </button>

                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={() => setExpandedVideoId(item.id)}
                                className={LINK_BUTTON_GHOST}
                              >
                                <Play className="h-4 w-4" />
                                เล่นวิดีโอ
                              </button>

                              {videoUrl && (
                                <a
                                  href={videoUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className={LINK_BUTTON_GHOST}
                                >
                                  <ExternalLink className="h-4 w-4" />
                                  เปิดในแท็บใหม่
                                </a>
                              )}

                              {videoUrl && (
                                <a
                                  href={videoUrl}
                                  download={`${item.id}.mp4`}
                                  className={LINK_BUTTON_GHOST}
                                >
                                  <Download className="h-4 w-4" />
                                  ดาวน์โหลด
                                </a>
                              )}
                            </div>
                          </>
                        ) : videoUrl ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <a
                            href={videoUrl}
                            target="_blank"
                            rel="noreferrer"
                            className={LINK_BUTTON_OUTLINE}
                          >
                            <Play className="h-4 w-4" />
                            เปิดวิดีโอ
                          </a>

                          <a
                            href={videoUrl}
                            download={`${item.id}.mp4`}
                            className={LINK_BUTTON_GHOST}
                          >
                            <Download className="h-4 w-4" />
                            ดาวน์โหลด
                          </a>
                        </div>
                      ) : null}
                    </div>
                  )}

                  {/* ========================================
                      จัดการโปรเจคของงานนี้
                      ======================================== */}
                  <div className="mt-4 rounded-xl border border-border bg-background/50 p-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="flex min-w-52 flex-1 items-center gap-2">
                        <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <select
                          value={draftProjectId}
                          onChange={(event) =>
                            handleProjectSelect(item.id, event.target.value)
                          }
                          className="h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          aria-label="เลือกโปรเจคสำหรับงานนี้"
                          disabled={projectsLoading && projects.length === 0}
                        >
                          {projectsLoading && projects.length === 0 ? (
                            <option value="">กำลังโหลดโปรเจค...</option>
                          ) : (
                            <>
                              <option value="">-- ยังไม่อยู่ในโปรเจค --</option>
                              {projects.map((project) => (
                                <option key={project.id} value={project.id}>
                                  {project.name}
                                </option>
                              ))}
                            </>
                          )}
                        </select>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => void handleMoveToProject(item)}
                          disabled={!canMove || isBusy}
                        >
                          {isBusy ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : null}
                          ย้ายเข้าโปรเจค
                        </Button>

                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => void handleRemoveFromProject(item)}
                          disabled={!canRemove || isBusy}
                        >
                          ถอดออกจากโปรเจค
                        </Button>
                      </div>
                    </div>

                    {item.projectId && !projectName && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        ปัจจุบันอยู่ในโปรเจค ID: {item.projectId}
                        (ยังโหลดชื่อไม่เสร็จ หรือโปรเจคถูกลบไปแล้ว)
                      </p>
                    )}
                  </div>

                  {item.error && (
                    <div className="mt-3 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                      {item.error}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}