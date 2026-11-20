'use client'

/**
 * MediaGallery (v5 - เพิ่ม pick mode สำหรับโปรเจค)
 * - รองรับ search param ?pickFor={projectId} → แสดง banner + action "เพิ่มเข้าโปรเจค"
 * - Multi-select เพิ่มหลายคลิปทีเดียว
 * - Dropdown แสดงโปรเจคทั้งหมด + "✓ อยู่แล้ว" + "＋ สร้างโปรเจคใหม่" + "－ นำออกจากโปรเจค"
 */

import * as React from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import {
  AlertCircle,
  ArrowLeft,
  Check,
  ChevronUp,
  Copy,
  Download,
  ExternalLink,
  Film,
  FolderOpen,
  ImageIcon,
  Loader2,
  Play,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  bulkMoveToProject,
  concatVideos,
  extractFrame,
  fetchProjects,
  getMediaUrl,
  type ProjectSummary,
} from '@/lib/backend'
import { cn } from '@/lib/utils'
import { useHotkeys } from '@/lib/use-hotkeys'

const REFRESH_INTERVAL_MS = 10000

const TYPE_FILTERS = [
  { value: 'ALL', label: 'ทุกประเภท' },
  { value: 'REF2VA', label: 'Reference to Video (REF2VA)' },
  { value: 'T2V', label: 'Text to Video (T2V)' },
] as const

type TypeFilter = (typeof TYPE_FILTERS)[number]['value']

const LINK_BUTTON_BASE =
  'inline-flex h-8 items-center justify-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

const LINK_BUTTON_GHOST =
  `${LINK_BUTTON_BASE} text-foreground hover:bg-accent hover:text-accent-foreground`

interface MediaItem {
  id: string
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

function normalizeType(type: string): 'T2V' | 'REF2VA' | 'OTHER' {
  const t = (type || '').trim().toUpperCase()
  if (t === 'T2V' || t === 'TEXT2VID' || t === 'TXT2VID' || t === 'TEXT_TO_VIDEO') return 'T2V'
  if (t === 'REF2VA' || t === 'REF2VID' || t === 'REFERENCE_TO_VIDEO') return 'REF2VA'
  return 'OTHER'
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {}
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.top = '-9999px'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch { return false }
}

function formatDuration(s: number | null): string {
  if (s === null || !Number.isFinite(s)) return '-'
  return `${s.toFixed(1)}s`
}

function formatDate(iso: string | null): string {
  if (!iso) return '-'
  try { return new Date(iso).toLocaleDateString() } catch { return '-' }
}

export function MediaGallery() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const pickForId = searchParams.get('pickFor') ?? null

  const [items, setItems] = React.useState<MediaItem[]>([])
  const [loading, setLoading] = React.useState(true)
  const [refreshing, setRefreshing] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const [typeFilter, setTypeFilter] = React.useState<TypeFilter>('ALL')
  const [search, setSearch] = React.useState('')

  const [expandedVideoId, setExpandedVideoId] = React.useState<string | null>(null)
  const [copiedId, setCopiedId] = React.useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = React.useState<string | null>(null)
  const [deletingId, setDeletingId] = React.useState<string | null>(null)
  const [extractingId, setExtractingId] = React.useState<string | null>(null)

  // merge mode
  const [selectionMode, setSelectionMode] = React.useState(false)
  const [selectedIds, setSelectedIds] = React.useState<string[]>([])
  const [mergeDialogOpen, setMergeDialogOpen] = React.useState(false)
  const [mergeOrder, setMergeOrder] = React.useState<string[]>([])
  const [mergeTitle, setMergeTitle] = React.useState('')
  const [merging, setMerging] = React.useState(false)

  // project pick mode
  const [projects, setProjects] = React.useState<ProjectSummary[]>([])
  const [loadingProjects, setLoadingProjects] = React.useState(false)
  const [showProjectDropdown, setShowProjectDropdown] = React.useState(false)
  const [projectDropdownOpen, setProjectDropdownOpen] = React.useState(false)
  const [creatingProject, setCreatingProject] = React.useState(false)
  const [newProjectName, setNewProjectName] = React.useState('')
  const [moving, setMoving] = React.useState(false)

  const dropdownRef = React.useRef<HTMLDivElement | null>(null)
  const searchRef = React.useRef<HTMLInputElement | null>(null)

  // ========================================
  // Pick mode helpers
  // ========================================

  const isPickMode = Boolean(pickForId)
  const pickTarget = React.useMemo(
    () => projects.find((p) => p.id === pickForId) ?? null,
    [projects, pickForId]
  )

  React.useEffect(() => {
    if (!isPickMode) return
    setLoadingProjects(true)
    fetchProjects()
      .then((list) => {
        setProjects(list)
        if (pickForId && !list.some((p) => p.id === pickForId)) {
          setError(`ไม่พบโปรเจคปลายทาง id=${pickForId}`)
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'โหลดรายการโปรเจคไม่สำเร็จ'))
      .finally(() => setLoadingProjects(false))
  }, [isPickMode, pickForId])

  // close dropdown on outside click
  React.useEffect(() => {
    if (!projectDropdownOpen) return
    function onDocClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setProjectDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [projectDropdownOpen])

  // ========================================
  // Load data
  // ========================================

  const loadItems = React.useCallback(async (showSpinner = false) => {
    if (showSpinner) setRefreshing(true)
    try {
      const response = await fetch('/api/history?limit=500', { method: 'GET', cache: 'no-store' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      setItems((await response.json()) as MediaItem[])
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'โหลดไม่สำเร็จ')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  React.useEffect(() => {
    void loadItems()
    const id = window.setInterval(() => void loadItems(), REFRESH_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [loadItems])

  // ========================================
  // Derived
  // ========================================

  const mediaItems = React.useMemo(
    () => items.filter((i) => i.status === 'DONE' && Boolean(i.videoPath)),
    [items]
  )

  const t2vCount = React.useMemo(() => mediaItems.filter((i) => normalizeType(i.type) === 'T2V').length, [mediaItems])
  const refCount = React.useMemo(() => mediaItems.filter((i) => normalizeType(i.type) === 'REF2VA').length, [mediaItems])

  const filteredItems = React.useMemo(() => {
    const kw = search.trim().toLowerCase()
    return mediaItems.filter((item) => {
      if (typeFilter !== 'ALL' && normalizeType(item.type) !== typeFilter) return false
      if (kw && !item.prompt.toLowerCase().includes(kw)) return false
      return true
    })
  }, [mediaItems, typeFilter, search])

  const selectedItems = React.useMemo(
    () => mergeOrder.map((id) => items.find((r) => r.id === id)).filter((r): r is MediaItem => Boolean(r)),
    [mergeOrder, items]
  )

  useHotkeys({
    '/': (e) => {
      e.preventDefault()
      searchRef.current?.focus()
    },
    'mod+a': (e) => {
      if (!(selectionMode || isPickMode)) return
      e.preventDefault()
      setSelectedIds(filteredItems.map((f) => f.id))
    },
    escape: () => {
      if (mergeDialogOpen) setMergeDialogOpen(false)
      else if (selectionMode) exitSelectionMode()
      else setSelectedIds([])
    },
  })

  // ========================================
  // Handlers
  // ========================================

  const handleCopyPrompt = async (item: MediaItem) => {
    const ok = await copyTextToClipboard(item.prompt)
    if (ok) {
      setCopiedId(item.id)
      toast.success('คัดลอก prompt แล้ว')
      window.setTimeout(() => setCopiedId((c) => (c === item.id ? null : c)), 2000)
    } else {
      toast.error('คัดลอกไม่สำเร็จ')
    }
  }

  const handleDelete = async (item: MediaItem) => {
    setDeletingId(item.id)
    try {
      const res = await fetch(`/api/history/${item.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(text || `HTTP ${res.status}`)
      }

      const body = (await res.json().catch(() => ({}))) as {
        warnings?: string[]
      }

      setItems((p) => p.filter((r) => r.id !== item.id))
      if (expandedVideoId === item.id) setExpandedVideoId(null)

      if (body.warnings && body.warnings.length > 0) {
        toast.warning(`ลบในประวัติสำเร็จ แต่ไฟล์บางส่วนหาไม่เจอ (อาจถูกลบไปแล้ว)`)
      } else {
        toast.success('ลบคลิปถาวรแล้ว (ไฟล์ + ประวัติ)')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'ลบไม่สำเร็จ')
    } finally {
      setDeletingId(null)
      setConfirmDeleteId(null)
    }
  }

  const handleExtractFrame = async (item: MediaItem, offset = 0) => {
    if (!item.videoPath) return
    setExtractingId(item.id)
    try {
      const response = await extractFrame({
        path: item.videoPath,
        position: 'last',
        offset_from_end: offset,
        upload_to_comfyui: true,
      })
      toast.success(`ดึงเฟรมสำเร็จ — ส่งเข้า ComfyUI (${response.stored_filename})`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'ดึงเฟรมไม่สำเร็จ')
    } finally {
      setExtractingId(null)
    }
  }

  // ---- pick mode handlers ----

  const handleMoveToProject = async (targetProjectId: string | null) => {
    if (selectedIds.length === 0 || moving) return
    setMoving(true)
    setProjectDropdownOpen(false)
    try {
      const res = await bulkMoveToProject(selectedIds, targetProjectId)
      const label = targetProjectId
        ? projects.find((p) => p.id === targetProjectId)?.name ?? 'โปรเจค'
        : 'ไม่มีโปรเจค'
      toast.success(`ย้าย ${res.moved} คลิปเข้า "${label}" แล้ว`)

      setSelectedIds([])
      setSelectionMode(false)

      if (targetProjectId) {
        router.push(`/projects/${targetProjectId}`)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'ย้ายไม่สำเร็จ')
    } finally {
      setMoving(false)
    }
  }

  const handleCreateAndMove = async () => {
    const name = newProjectName.trim()
    if (!name || moving || creatingProject) return

    setCreatingProject(true)
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description: null }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const created = (await res.json()) as ProjectSummary

      setProjects((prev) => [created, ...prev])
      setNewProjectName('')
      toast.success(`สร้างโปรเจค "${created.name}" แล้ว`)

      await handleMoveToProject(created.id)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'สร้างโปรเจคไม่สำเร็จ')
    } finally {
      setCreatingProject(false)
    }
  }

  // ---- merge handlers ----

  const toggleSelect = (id: string) =>
    setSelectedIds((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))

  const exitSelectionMode = () => {
    setSelectionMode(false)
    setSelectedIds([])
    setMergeDialogOpen(false)
    setMergeOrder([])
    setMergeTitle('')
  }

  const openMergeDialog = () => {
    if (selectedIds.length < 2) {
      toast.error('เลือกอย่างน้อย 2 คลิปเพื่อรวม')
      return
    }
    setMergeOrder([...selectedIds])
    setMergeDialogOpen(true)
  }

  const moveInOrder = (index: number, direction: -1 | 1) => {
    setMergeOrder((prev) => {
      const target = index + direction
      if (target < 0 || target >= prev.length) return prev
      const next = [...prev]
      const [moved] = next.splice(index, 1)
      next.splice(target, 0, moved)
      return next
    })
  }

  const handleMerge = async () => {
    if (mergeOrder.length < 2 || merging) return
    setMerging(true)
    try {
      const paths = selectedItems.map((r) => r.videoPath).filter((p): p is string => Boolean(p))
      const response = await concatVideos({ paths, title: mergeTitle.trim() || undefined })

      const now = new Date().toISOString()
      const mergeId = `merge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const first = selectedItems[0]

      await fetch('/api/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: mergeId,
          prompt: mergeTitle.trim() || `Merged ${selectedItems.length} clips`,
          negative_prompt: null,
          type: 'MERGE',
          resolution: first?.resolution ?? '-',
          steps: 0,
          seed: -1,
          task_adapter: null,
          lora_used: null,
          status: 'DONE',
          progress: 100,
          message: 'รวมคลิปด้วย ffmpeg',
          error: null,
          created_at: now,
          updated_at: now,
          reference_count: 0,
          reference_names: [],
          video_path: response.video_path,
          thumbnail_path: response.thumbnail_path,
          output_filename: response.video_path.split('/').pop() ?? null,
          duration: response.duration,
        }),
      })

      toast.success(`รวม ${selectedItems.length} คลิปสำเร็จ (${response.mode === 'copy' ? 'ไม่ encode ใหม่' : 'encode ใหม่'})`)
      exitSelectionMode()
      await loadItems(true)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'รวมคลิปไม่สำเร็จ')
    } finally {
      setMerging(false)
    }
  }

  // ========================================
  // Render
  // ========================================

  return (
    <Card className="shadow-lg">
      <CardHeader className="border-b border-border bg-card/60 backdrop-blur">
        {/* Pick mode banner */}
        {isPickMode && (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-3 py-2">
            <FolderOpen className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">
              กำลังเพิ่มวิดีโอเข้าโปรเจค:
            </span>
            <span className="rounded-md bg-primary/15 px-2 py-0.5 font-semibold text-primary">
              {loadingProjects ? '...' : pickTarget?.name ?? 'ไม่พบโปรเจค'}
            </span>
            <span className="ml-auto flex gap-2">
              <Button variant="outline" size="sm" onClick={() => router.push('/media')}>
                <X className="mr-2 h-4 w-4" /> ออกจากโหมดเลือก
              </Button>
              {pickTarget && (
                <Button variant="ghost" size="sm" onClick={() => router.push(`/projects/${pickTarget.id}`)}>
                  <ArrowLeft className="mr-2 h-4 w-4" /> กลับไปโปรเจค
                </Button>
              )}
            </span>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-3 text-xl">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Film className="h-5 w-5" />
            </span>
            {isPickMode ? 'เลือกวิดีโอ' : 'คลังมีเดีย'}
          </CardTitle>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input ref={searchRef} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ค้นหา prompt..." className="h-9 w-52 pl-8 text-sm" />
            </div>

            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as TypeFilter)} className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm" aria-label="กรองประเภท">
              {TYPE_FILTERS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.value === 'ALL' ? `${t.label} (${mediaItems.length})` : t.value === 'T2V' ? `${t.label} (${t2vCount})` : `${t.label} (${refCount})`}
                </option>
              ))}
            </select>

            {!isPickMode && (
              <Button variant={selectionMode ? 'default' : 'outline'} size="sm" onClick={() => (selectionMode ? exitSelectionMode() : setSelectionMode(true))}>
                {selectionMode ? 'ยกเลิก' : 'เลือกหลายรายการ'}
              </Button>
            )}

            <Button variant="outline" size="sm" onClick={() => void loadItems(true)} disabled={refreshing}>
              {refreshing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              รีเฟรช
            </Button>
          </div>
        </div>

        <p className="text-sm text-muted-foreground">
          {isPickMode
            ? 'ติ๊กเลือกคลิปที่ต้องการเพิ่มเข้าโปรเจค แล้วกด "เพิ่มเข้าโปรเจค" ที่แถบด้านล่าง'
            : 'วิดีโอที่สร้างสำเร็จทั้งหมด — เลือกหลายรายการเพื่อย้ายเข้าโปรเจค หรือรวมเป็นคลิปเดียว'}
        </p>
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
            <p className="text-sm">กำลังโหลด...</p>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-muted/20 p-8 text-center">
            <Film className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">
              {mediaItems.length === 0 ? 'ยังไม่มีวิดีโอ' : 'ไม่พบคลิปตามตัวกรอง'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filteredItems.map((item) => {
              const videoUrl = getMediaUrl(item.videoPath)
              const thumbUrl = getMediaUrl(item.thumbnailPath)
              const isExpanded = expandedVideoId === item.id
              const isCopied = copiedId === item.id
              const isConfirming = confirmDeleteId === item.id
              const isDeleting = deletingId === item.id
              const isExtracting = extractingId === item.id
              const groupType = normalizeType(item.type)
              const selectedIndex = selectedIds.indexOf(item.id)
              const isSelected = selectedIndex >= 0

              // always show selection UI in pick mode
              const showSelection = isPickMode || selectionMode

              return (
                <div key={item.id} className={cn('relative overflow-hidden rounded-xl border bg-muted/20 shadow-sm', isSelected ? 'border-primary ring-2 ring-primary/40' : 'border-border')}>
                  {showSelection && (
                    <button type="button" onClick={() => toggleSelect(item.id)} className={cn('absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full border text-[10px] font-bold', isSelected ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-black/50')} aria-label={isSelected ? 'ยกเลิกเลือก' : 'เลือก'}>
                      {isSelected ? (isPickMode ? <Check className="h-3.5 w-3.5" /> : selectedIndex + 1) : ''}
                    </button>
                  )}

                  {isExpanded && videoUrl && !showSelection ? (
                    <div className="relative aspect-square w-full bg-black">
                      <video src={videoUrl} controls autoPlay preload="metadata" playsInline className="h-full w-full object-contain" />
                      <button type="button" onClick={() => setExpandedVideoId(null)} className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80" aria-label="ย่อ">
                        <ChevronUp className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => (showSelection ? toggleSelect(item.id) : videoUrl && setExpandedVideoId(item.id))} className="group relative block aspect-square w-full bg-black" aria-label={showSelection ? 'เลือก' : 'เล่น'}>
                      {thumbUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={thumbUrl} alt={item.prompt} className="h-full w-full object-contain" />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center text-muted-foreground"><Film className="h-10 w-10" /></span>
                      )}
                      {!showSelection && (
                        <span className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 transition-opacity group-hover:opacity-100">
                          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/90 text-black shadow-lg"><Play className="h-5 w-5" /></span>
                        </span>
                      )}
                      <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 font-mono text-[10px] font-medium text-white">
                        {groupType === 'OTHER' ? item.type : groupType}
                      </span>
                      {item.duration != null && (
                        <span className="absolute bottom-2 right-2 rounded-full bg-black/60 px-2 py-0.5 font-mono text-[10px] text-white">
                          {formatDuration(item.duration)}
                        </span>
                      )}
                    </button>
                  )}

                  <div className="grid gap-2 p-3">
                    <p className="line-clamp-2 min-h-9 text-xs font-medium text-foreground" title={item.prompt}>{item.prompt}</p>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-muted-foreground">
                      <span>Res: {item.resolution}</span>
                      <span>Seed: {item.seed}</span>
                      <span>{formatDate(item.completedAt ?? item.createdAt)}</span>
                    </div>

                    {showSelection ? (
                      <Button variant={isSelected ? 'default' : 'outline'} size="sm" className="h-8 text-xs" onClick={() => toggleSelect(item.id)}>
                        {isSelected ? 'เลือกแล้ว' : 'เลือกคลิปนี้'}
                      </Button>
                    ) : isConfirming ? (
                      <div className="flex items-center gap-1.5 rounded-lg border border-destructive/30 bg-destructive/10 px-2 py-1.5">
                        <span className="flex-1 text-[10px] font-medium text-destructive">ลบถาวร?</span>
                        <Button variant="destructive" size="sm" className="h-7 text-xs" onClick={() => void handleDelete(item)} disabled={isDeleting}>
                          {isDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setConfirmDeleteId(null)} disabled={isDeleting}>
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : (
                      <div className="grid gap-2">
                        <div className="grid grid-cols-2 gap-1.5">
                          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => void handleCopyPrompt(item)}>
                            {isCopied ? <><Check className="mr-1.5 h-3.5 w-3.5 text-green-500" />คัดลอกแล้ว</> : <><Copy className="mr-1.5 h-3.5 w-3.5" />Copy Prompt</>}
                          </Button>
                          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => void handleExtractFrame(item, 0)} disabled={isExtracting}>
                            {isExtracting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="mr-1.5 h-3.5 w-3.5" />}
                            ดึงเฟรม
                          </Button>
                        </div>

                        <div className="flex items-center gap-1.5">
                          {videoUrl && (
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setExpandedVideoId(isExpanded ? null : item.id)}>
                              {isExpanded ? <ChevronUp className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                            </Button>
                          )}
                          {videoUrl && <a href={videoUrl} download={`${item.id}.mp4`} className={cn(LINK_BUTTON_GHOST, 'h-8 w-8 px-0')}><Download className="h-4 w-4" /></a>}
                          {videoUrl && <a href={videoUrl} target="_blank" rel="noreferrer" className={cn(LINK_BUTTON_GHOST, 'h-8 w-8 px-0')}><ExternalLink className="h-4 w-4" /></a>}
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => setConfirmDeleteId(item.id)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* ========================================
            Pick mode action bar
            ======================================== */}
        {isPickMode && (
          <div className="sticky bottom-2 z-20 mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-primary/30 bg-card/95 px-4 py-3 shadow-lg backdrop-blur">
            <FolderOpen className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">เลือก {selectedIds.length} คลิป</span>

            <div className="ml-auto flex items-center gap-2">
              <div className="relative" ref={dropdownRef}>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => setProjectDropdownOpen((o) => !o)}
                  disabled={selectedIds.length === 0 || moving || loadingProjects}
                >
                  {moving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FolderOpen className="mr-2 h-4 w-4" />}
                  เพิ่มเข้าโปรเจค
                </Button>

                {projectDropdownOpen && (
                  <div className="absolute bottom-full right-0 mb-2 w-80 rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-2xl">
                    <p className="mb-2 text-xs font-semibold">เลือกโปรเจคปลายทาง</p>

                    <div className="max-h-64 space-y-1 overflow-y-auto">
                      {projects.length === 0 ? (
                        <p className="px-2 py-1.5 text-xs text-muted-foreground">ยังไม่มีโปรเจค</p>
                      ) : (
                        projects.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => void handleMoveToProject(p.id)}
                            disabled={moving}
                            className={cn(
                              'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent',
                              p.id === pickForId && 'bg-primary/10 text-primary'
                            )}
                          >
                            <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                            <span className="min-w-0 flex-1 truncate">{p.name}</span>
                            <span className="font-mono text-[10px] text-muted-foreground">{p._count.generations}</span>
                            {p.id === pickForId && <Check className="h-3.5 w-3.5 shrink-0" />}
                          </button>
                        ))
                      )}
                    </div>

                    <div className="my-2 border-t border-border" />

                    <button
                      type="button"
                      onClick={() => void handleMoveToProject(null)}
                      disabled={moving}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-accent"
                    >
                      <X className="h-3.5 w-3.5 shrink-0" />
                      <span>－ นำออกจากโปรเจค</span>
                    </button>

                    <div className="mt-2 rounded-lg border border-border bg-muted/30 p-2">
                      <label className="mb-1 block text-[10px] font-medium text-muted-foreground">＋ สร้างโปรเจคใหม่</label>
                      <div className="flex gap-1.5">
                        <Input
                          value={newProjectName}
                          onChange={(e) => setNewProjectName(e.target.value)}
                          placeholder="ชื่อโปรเจค..."
                          className="h-8 text-xs"
                          maxLength={120}
                        />
                        <Button
                          type="button"
                          size="sm"
                          className="h-8 text-xs"
                          onClick={() => void handleCreateAndMove()}
                          disabled={!newProjectName.trim() || creatingProject || moving}
                        >
                          {creatingProject ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'สร้าง'}
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <Button variant="ghost" size="sm" onClick={() => { setSelectedIds([]); router.push('/media') }}>
                ยกเลิก
              </Button>
            </div>
          </div>
        )}

        {/* ========================================
            Merge mode action bar
            ======================================== */}
        {!isPickMode && selectionMode && (
          <div className="sticky bottom-2 z-20 mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card/95 px-4 py-3 shadow-lg backdrop-blur">
            <Film className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">เลือก {selectedIds.length} คลิป</span>

            <div className="ml-auto flex items-center gap-2">
              {/* Add to project dropdown */}
              <div className="relative" ref={dropdownRef}>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setProjectDropdownOpen((o) => !o)}
                  disabled={selectedIds.length === 0 || moving}
                >
                  <FolderOpen className="mr-2 h-4 w-4" />
                  เพิ่มเข้าโปรเจค
                </Button>

                {projectDropdownOpen && (
                  <div className="absolute bottom-full right-0 mb-2 w-80 rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-2xl">
                    <p className="mb-2 text-xs font-semibold">เลือกโปรเจคปลายทาง</p>

                    <div className="max-h-64 space-y-1 overflow-y-auto">
                      {projects.length === 0 ? (
                        <p className="px-2 py-1.5 text-xs text-muted-foreground">ยังไม่มีโปรเจค</p>
                      ) : (
                        projects.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => void handleMoveToProject(p.id)}
                            disabled={moving}
                            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent"
                          >
                            <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                            <span className="min-w-0 flex-1 truncate">{p.name}</span>
                            <span className="font-mono text-[10px] text-muted-foreground">{p._count.generations}</span>
                          </button>
                        ))
                      )}
                    </div>

                    <div className="my-2 border-t border-border" />

                    <button
                      type="button"
                      onClick={() => void handleMoveToProject(null)}
                      disabled={moving}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-accent"
                    >
                      <X className="h-3.5 w-3.5 shrink-0" />
                      <span>－ นำออกจากโปรเจค</span>
                    </button>

                    <div className="mt-2 rounded-lg border border-border bg-muted/30 p-2">
                      <label className="mb-1 block text-[10px] font-medium text-muted-foreground">＋ สร้างโปรเจคใหม่</label>
                      <div className="flex gap-1.5">
                        <Input
                          value={newProjectName}
                          onChange={(e) => setNewProjectName(e.target.value)}
                          placeholder="ชื่อโปรเจค..."
                          className="h-8 text-xs"
                          maxLength={120}
                        />
                        <Button
                          type="button"
                          size="sm"
                          className="h-8 text-xs"
                          onClick={() => void handleCreateAndMove()}
                          disabled={!newProjectName.trim() || creatingProject || moving}
                        >
                          {creatingProject ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'สร้าง'}
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <Button variant="outline" size="sm" onClick={openMergeDialog} disabled={selectedIds.length < 2}>
                รวมคลิป ({selectedIds.length})
              </Button>

              <Button variant="ghost" size="sm" onClick={exitSelectionMode}>ยกเลิก</Button>
            </div>
          </div>
        )}
      </CardContent>

      {/* ========================================
          Merge dialog
          ======================================== */}
      {mergeDialogOpen && (
        <div className="fixed inset-0 z-[950] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" onClick={() => !merging && setMergeDialogOpen(false)} />

          <div className="relative z-10 flex max-h-[85vh] w-full max-w-md flex-col gap-4 rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-2xl">
            <div className="flex items-center justify-between gap-3">
              <h3 className="flex items-center gap-2 font-display text-base font-semibold tracking-tight">
                <Film className="h-4 w-4 text-primary" />
                รวมวิดีโอ {mergeOrder.length} คลิป
              </h3>
              <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => !merging && setMergeDialogOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="grid gap-2">
              <label className="text-xs font-medium text-muted-foreground">ชื่อคลิปผลลัพธ์ (ไม่บังคับ)</label>
              <Input value={mergeTitle} onChange={(e) => setMergeTitle(e.target.value)} placeholder="เช่น ฉากเปิดเรื่อง_รวม3คลิป" className="h-9 text-sm" />
            </div>

            <div className="grid gap-1.5 overflow-y-auto pr-1">
              {selectedItems.map((row, index) => (
                <div key={row.id} className="flex items-center gap-2 rounded-lg border border-border bg-muted/20 px-2.5 py-2">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 font-mono text-[11px] font-bold text-primary">{index + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-xs" title={row.prompt}>{row.prompt}</span>
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{formatDuration(row.duration)}</span>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <Button type="button" variant="ghost" size="icon" className="h-6 w-6" onClick={() => moveInOrder(index, -1)} disabled={index === 0 || merging}>↑</Button>
                    <Button type="button" variant="ghost" size="icon" className="h-6 w-6" onClick={() => moveInOrder(index, 1)} disabled={index === mergeOrder.length - 1 || merging}>↓</Button>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setMergeDialogOpen(false)} disabled={merging}>ยกเลิก</Button>
              <Button type="button" size="sm" onClick={() => void handleMerge()} disabled={merging}>
                {merging ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : 'รวมวิดีโอ'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  )
}