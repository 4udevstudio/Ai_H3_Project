'use client'

/**
 * ========================================
 * FrameManager (v2)
 * ========================================
 * คลังเฟรมที่ดึงจากวิดีโอ (outputs/frames)
 * - เสิร์ฟรูปผ่าน /api/system/frames/file + fallback เมื่อโหลดพลาด (ปุ่มลองใหม่)
 * - Lightbox ซูม Fit / 100% / 200% ตรวจความคมก่อนใช้ chain (เลื่อน ← → ได้)
 * - ดาวน์โหลด / copy ชื่อไฟล์ / ส่งเข้า ComfyUI / ลบทีละใบ / ลบหลายใบ
 * - ค้นหา + กรองตำแหน่ง + เรียงลำดับ + auto refresh
 */

import * as React from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertCircle,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  ImageIcon,
  Link2,
  Loader2,
  Maximize2,
  RefreshCw,
  RotateCw,
  Search,
  Send,
  Trash2,
  X,
  ZoomIn,
} from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  deleteFramesBatch,
  fetchFrames,
  getFrameUrl,
  sendFrameToComfyUI,
  type FrameItem,
} from '@/lib/backend'
import { setChainHandoff } from '@/lib/chain-handoff'
import { cn } from '@/lib/utils'
import { useHotkeys } from '@/lib/use-hotkeys'

const REFRESH_INTERVAL_MS = 15000

const LINK_GHOST =
  'inline-flex h-8 w-8 items-center justify-center rounded-md text-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

const SCROLL_SKIN =
  '[scrollbar-width:thin] [scrollbar-color:var(--border)_transparent] [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border hover:[&::-webkit-scrollbar-thumb]:bg-primary/60'

type SortKey = 'new' | 'old' | 'big'
type ZoomKey = 'fit' | '100' | '200'

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fallback ด้านล่าง
  }

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
  } catch {
    return false
  }
}

function positionLabel(f: FrameItem): string {
  if (f.position === 'first') return 'FIRST'
  return f.offset_from_end > 0 ? `LAST −${f.offset_from_end}` : 'LAST'
}

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return '-'
  }
}

export function FrameManager() {
  const router = useRouter()
  const [frames, setFrames] = React.useState<FrameItem[]>([])
  const [promptMap, setPromptMap] = React.useState<Record<string, string>>({})
  const [chainingPath, setChainingPath] = React.useState<string | null>(null)
  const [totalMb, setTotalMb] = React.useState(0)
  const [loading, setLoading] = React.useState(true)
  const [refreshing, setRefreshing] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const [search, setSearch] = React.useState('')
  const [posFilter, setPosFilter] = React.useState<'ALL' | 'last' | 'first'>('ALL')
  const [sortKey, setSortKey] = React.useState<SortKey>('new')

  const [selectionMode, setSelectionMode] = React.useState(false)
  const [selected, setSelected] = React.useState<string[]>([])
  const [bulkConfirm, setBulkConfirm] = React.useState(false)
  const [deletingBulk, setDeletingBulk] = React.useState(false)

  const [confirmPath, setConfirmPath] = React.useState<string | null>(null)
  const [deletingPath, setDeletingPath] = React.useState<string | null>(null)
  const [sendingPath, setSendingPath] = React.useState<string | null>(null)
  const [copiedPath, setCopiedPath] = React.useState<string | null>(null)
  const searchRef = React.useRef<HTMLInputElement | null>(null)

  const [failed, setFailed] = React.useState<string[]>([])
  const [retryMap, setRetryMap] = React.useState<Record<string, number>>({})

  const [lightboxPath, setLightboxPath] = React.useState<string | null>(null)
  const [zoom, setZoom] = React.useState<ZoomKey>('fit')
  const [natural, setNatural] = React.useState<{ w: number; h: number } | null>(null)

  // ========================================
  // Load
  // ========================================

  const load = React.useCallback(async (spin = false) => {
    if (spin) setRefreshing(true)
    try {
      const data = await fetchFrames()
      setFrames(data.frames)
      setTotalMb(data.total_size_mb)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'โหลดรายการเฟรมไม่สำเร็จ')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  React.useEffect(() => {
    void load()
    const id = window.setInterval(() => void load(), REFRESH_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [load])

  // ========================================
  // Derived
  // ========================================

  const filtered = React.useMemo(() => {
    const kw = search.trim().toLowerCase()

    const rows = frames.filter((f) => {
      if (posFilter !== 'ALL' && f.position !== posFilter) return false
      if (
        kw &&
        !f.filename.toLowerCase().includes(kw) &&
        !f.source_id.toLowerCase().includes(kw)
      ) {
        return false
      }
      return true
    })

    const sorted = [...rows]
    if (sortKey === 'new') {
      sorted.sort((a, b) => b.modified_at.localeCompare(a.modified_at))
    } else if (sortKey === 'old') {
      sorted.sort((a, b) => a.modified_at.localeCompare(b.modified_at))
    } else {
      sorted.sort((a, b) => b.size_bytes - a.size_bytes)
    }
    return sorted
  }, [frames, search, posFilter, sortKey])

  const lightboxIndex = React.useMemo(
    () => filtered.findIndex((f) => f.path === lightboxPath),
    [filtered, lightboxPath]
  )

  const lightboxFrame = lightboxIndex >= 0 ? filtered[lightboxIndex] : null

  const urlFor = React.useCallback(
    (f: FrameItem): string | null => {
      const base = getFrameUrl(f.path)
      if (!base) return null
      const n = retryMap[f.path]
      return n ? `${base}&r=${n}` : base
    },
    [retryMap]
  )

  // ========================================
  // Lightbox keyboard
  // ========================================

  const stepLightbox = React.useCallback(
    (dir: -1 | 1) => {
      if (filtered.length === 0) return
      setLightboxPath((current) => {
        const idx = filtered.findIndex((f) => f.path === current)
        if (idx < 0) return filtered[0].path
        const next = (idx + dir + filtered.length) % filtered.length
        return filtered[next].path
      })
      setNatural(null)
      setZoom('fit')
    },
    [filtered]
  )

  React.useEffect(() => {
    if (!lightboxPath) return

    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setLightboxPath(null)
      if (event.key === 'ArrowLeft') stepLightbox(-1)
      if (event.key === 'ArrowRight') stepLightbox(1)
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightboxPath, stepLightbox])

  // ========================================
  // Handlers
  // ========================================

  const markFailed = (path: string) =>
    setFailed((p) => (p.includes(path) ? p : [...p, path]))

  const retryImage = (path: string) => {
    setFailed((p) => p.filter((x) => x !== path))
    setRetryMap((p) => ({ ...p, [path]: (p[path] ?? 0) + 1 }))
  }

  useHotkeys({
    '/': (e) => {
      e.preventDefault()
      searchRef.current?.focus()
    },
    'mod+a': (e) => {
      if (!selectionMode) return
      e.preventDefault()
      setSelected(filtered.map((f) => f.path))
    },
    delete: () => {
      if (!selectionMode || selected.length === 0) return
      setBulkConfirm(true)
    },
    backspace: () => {
      if (!selectionMode || selected.length === 0) return
      setBulkConfirm(true)
    },
    escape: () => {
      if (lightboxPath) setLightboxPath(null)
      else if (bulkConfirm) setBulkConfirm(false)
      else if (selectionMode) exitSelection()
    },
  })

  const toggleSelect = (path: string) =>
    setSelected((p) => (p.includes(path) ? p.filter((x) => x !== path) : [...p, path]))

  const exitSelection = () => {
    setSelectionMode(false)
    setSelected([])
    setBulkConfirm(false)
  }

  const handleDeleteOne = async (path: string) => {
    setDeletingPath(path)
    try {
      const res = await deleteFramesBatch([path])
      if (res.count === 0) throw new Error('ลบไม่สำเร็จ')
      setFrames((p) => p.filter((f) => f.path !== path))
      setSelected((p) => p.filter((x) => x !== path))
      if (lightboxPath === path) setLightboxPath(null)
      toast.success('ลบเฟรมแล้ว')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'ลบเฟรมไม่สำเร็จ')
    } finally {
      setDeletingPath(null)
      setConfirmPath(null)
    }
  }

  const handleDeleteBulk = async () => {
    setDeletingBulk(true)
    try {
      const res = await deleteFramesBatch(selected)
      setFrames((p) => p.filter((f) => !res.deleted.includes(f.path)))
      if (lightboxPath && res.deleted.includes(lightboxPath)) setLightboxPath(null)
      toast.success(`ลบเฟรมแล้ว ${res.count} ไฟล์`)
      exitSelection()
      void load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'ลบเฟรมไม่สำเร็จ')
    } finally {
      setDeletingBulk(false)
    }
  }

  const handleSend = async (path: string) => {
    setSendingPath(path)
    try {
      const res = await sendFrameToComfyUI(path)
      if (res.stored_filename) {
        toast.success(`ส่งเข้า ComfyUI แล้ว (${res.stored_filename})`)
      } else {
        toast.error(res.warning || 'ส่งเข้า ComfyUI ไม่สำเร็จ')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'ส่งเข้า ComfyUI ไม่สำเร็จ')
    } finally {
      setSendingPath(null)
    }
  }

  /**
   * ต่อคลิปจากเฟรมนี้: ส่งเข้า ComfyUI → เปิด Studio (CHAIN) พร้อมรูป + prompt เดิม
   */
  const handleChainFromFrame = async (f: FrameItem) => {
    setChainingPath(f.path)
    try {
      const res = await sendFrameToComfyUI(f.path)

      if (!res.stored_filename) {
        throw new Error(res.warning || 'ส่งเข้า ComfyUI ไม่สำเร็จ — ใช้ Local mode แล้วลองใหม่')
      }

      setChainHandoff({
        prompt: promptMap[f.source_id] ?? '',
        referenceName: res.stored_filename,
        framePath: f.path,
        sourceLabel: f.source_id.slice(0, 12),
      })

      toast.success('เตรียมต่อคลิปแล้ว — ปรับ prompt แล้วกดสร้างวิดีโอได้เลย')
      router.push('/studio')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'ต่อคลิปไม่สำเร็จ')
    } finally {
      setChainingPath(null)
    }
  }


  const handleCopy = async (path: string, filename: string) => {
    const ok = await copyText(filename)
    if (ok) {
      setCopiedPath(path)
      toast.success('คัดลอกชื่อไฟล์แล้ว — ใช้ใน node LoadImage ได้เลย')
      window.setTimeout(() => setCopiedPath((c) => (c === path ? null : c)), 2000)
    } else {
      toast.error('คัดลอกไม่สำเร็จ')
    }
  }

  const openLightbox = (path: string) => {
    setNatural(null)
    setZoom('fit')
    setLightboxPath(path)
  }

  // ========================================
  // Render
  // ========================================

  return (
    <Card className="shadow-lg">
      <CardHeader className="border-b border-border bg-card/60 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-3 text-xl">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <ImageIcon className="h-5 w-5" />
            </span>
            คลังเฟรม
            <span className="font-mono text-xs font-normal text-muted-foreground">
              {frames.length} ไฟล์ · {totalMb} MB
            </span>
          </CardTitle>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={searchRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="ค้นหาชื่อไฟล์ / คลิปต้นทาง..."
                className="h-9 w-56 pl-8 text-sm"
              />
            </div>

            <select
              value={posFilter}
              onChange={(e) => setPosFilter(e.target.value as 'ALL' | 'last' | 'first')}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="กรองตำแหน่งเฟรม"
            >
              <option value="ALL">ทุกตำแหน่ง</option>
              <option value="last">Last frame</option>
              <option value="first">First frame</option>
            </select>

            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="เรียงลำดับ"
            >
              <option value="new">ใหม่สุดก่อน</option>
              <option value="old">เก่าสุดก่อน</option>
              <option value="big">ไฟล์ใหญ่ก่อน</option>
            </select>

            <Button
              variant={selectionMode ? 'default' : 'outline'}
              size="sm"
              onClick={() => (selectionMode ? exitSelection() : setSelectionMode(true))}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              {selectionMode ? 'ยกเลิกโหมดลบ' : 'เลือกเพื่อลบ'}
            </Button>

            <Button variant="outline" size="sm" onClick={() => void load(true)} disabled={refreshing}>
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
          เฟรมที่ดึงจากวิดีโอ — กดที่รูปเพื่อซูมตรวจความคมก่อนใช้เป็น first frame ต่อคลิป,
          ดาวน์โหลด, ส่งเข้า ComfyUI หรือลบได้โดยไม่ต้องเปิด folder
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
            <p className="text-sm">กำลังโหลดคลังเฟรม...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-muted/20 p-8 text-center">
            <ImageIcon className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">
              {frames.length === 0 ? 'ยังไม่มีเฟรม' : 'ไม่พบเฟรมตามตัวกรอง'}
            </p>
            <p className="text-xs text-muted-foreground">
              {frames.length === 0
                ? 'gen วิดีโอ (จะดึง last frame อัตโนมัติ) หรือกดปุ่ม "ดึงเฟรม" ในหน้า Media'
                : 'ลองล้างคำค้นหา หรือเปลี่ยนตัวกรองตำแหน่ง'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {filtered.map((f) => {
              const url = urlFor(f)
              const isFailed = failed.includes(f.path)
              const isSel = selected.includes(f.path)
              const isConfirm = confirmPath === f.path
              const isDeleting = deletingPath === f.path
              const isSending = sendingPath === f.path
              const isCopied = copiedPath === f.path

              return (
                <div
                  key={f.path}
                  className={cn(
                    'relative overflow-hidden rounded-xl border bg-muted/20 shadow-sm transition-shadow hover:shadow-md',
                    isSel ? 'border-primary ring-2 ring-primary/40' : 'border-border'
                  )}
                >
                  {selectionMode && (
                    <button
                      type="button"
                      onClick={() => toggleSelect(f.path)}
                      aria-label={isSel ? 'ยกเลิกเลือก' : 'เลือกเฟรมนี้'}
                      className={cn(
                        'absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full border transition-colors',
                        isSel
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-white/40 bg-black/50 text-transparent hover:bg-black/70'
                      )}
                    >
                      {isSel ? <Check className="h-3.5 w-3.5" /> : null}
                    </button>
                  )}

                  <div className="relative aspect-square w-full bg-black">
                    {url && !isFailed ? (
                      <button
                        type="button"
                        onClick={() => (selectionMode ? toggleSelect(f.path) : openLightbox(f.path))}
                        className="group block h-full w-full"
                        aria-label={selectionMode ? 'เลือกเฟรมนี้' : 'ซูมดูเฟรม'}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={url}
                          alt={f.filename}
                          loading="lazy"
                          onError={() => markFailed(f.path)}
                          className="h-full w-full object-contain"
                        />
                        {!selectionMode && (
                          <span className="absolute inset-0 flex items-center justify-center bg-black/35 opacity-0 transition-opacity group-hover:opacity-100">
                            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-black shadow-lg">
                              <ZoomIn className="h-4 w-4" />
                            </span>
                          </span>
                        )}
                      </button>
                    ) : (
                      <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-3 text-center">
                        <AlertCircle className="h-6 w-6 text-muted-foreground" />
                        <p className="text-[10px] text-muted-foreground">โหลดรูปไม่สำเร็จ</p>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-[11px]"
                          onClick={() => retryImage(f.path)}
                        >
                          <RotateCw className="mr-1.5 h-3 w-3" />
                          ลองใหม่
                        </Button>
                      </div>
                    )}

                    <span className="pointer-events-none absolute left-2 top-2 rounded-full bg-black/65 px-2 py-0.5 font-mono text-[10px] font-medium text-white">
                      {positionLabel(f)}
                    </span>
                    <span className="pointer-events-none absolute bottom-2 right-2 rounded-full bg-black/65 px-2 py-0.5 font-mono text-[10px] text-white">
                      {f.size_kb} KB
                    </span>
                  </div>

                  <div className="grid gap-2 p-2.5">
                    <p className="truncate font-mono text-[10px] text-muted-foreground" title={f.filename}>
                      {f.source_id.slice(0, 12)}… · {f.size_kb} KB
                    </p>

                    {selectionMode ? (
                      <Button
                        variant={isSel ? 'default' : 'outline'}
                        size="sm"
                        className="h-8 text-xs"
                        onClick={() => toggleSelect(f.path)}
                      >
                        {isSel ? 'เลือกแล้ว' : 'เลือกเฟรมนี้'}
                      </Button>
                    ) : isConfirm ? (
                      <div className="flex items-center gap-1.5 rounded-lg border border-destructive/30 bg-destructive/10 px-2 py-1.5">
                        <span className="flex-1 text-[10px] font-medium text-destructive">ลบเฟรมนี้?</span>
                        <Button
                          variant="destructive"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => void handleDeleteOne(f.path)}
                          disabled={isDeleting}
                          aria-label="ยืนยันลบ"
                        >
                          {isDeleting ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => setConfirmPath(null)}
                          disabled={isDeleting}
                          aria-label="ยกเลิก"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-0.5">
                        {url && (
                          <a
                            href={url}
                            download={f.filename}
                            className={LINK_GHOST}
                            title="ดาวน์โหลด"
                            aria-label="ดาวน์โหลด"
                          >
                            <Download className="h-4 w-4" />
                          </a>
                        )}
                        {url && (
                          <a
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            className={LINK_GHOST}
                            title="เปิดในแท็บใหม่"
                            aria-label="เปิดในแท็บใหม่"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => void handleCopy(f.path, f.filename)}
                          title="คัดลอกชื่อไฟล์"
                          aria-label="คัดลอกชื่อไฟล์"
                        >
                          {isCopied ? (
                            <Check className="h-4 w-4 text-green-500" />
                          ) : (
                            <Copy className="h-4 w-4" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => void handleSend(f.path)}
                          disabled={isSending}
                          title="ส่งเข้า ComfyUI input"
                          aria-label="ส่งเข้า ComfyUI"
                        >
                          {isSending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Send className="h-4 w-4" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-primary"
                          onClick={() => void handleChainFromFrame(f)}
                          disabled={chainingPath === f.path}
                          title="ต่อคลิปจากเฟรมนี้"
                          aria-label="ต่อคลิปจากเฟรมนี้"
                        >
                          {chainingPath === f.path ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Link2 className="h-4 w-4" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => setConfirmPath(f.path)}
                          title="ลบเฟรม"
                          aria-label="ลบเฟรม"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {selectionMode && (
          <div className="sticky bottom-2 z-20 mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card/95 px-4 py-3 shadow-lg backdrop-blur">
            <Trash2 className="h-4 w-4 text-destructive" />
            <span className="text-sm font-medium">เลือก {selected.length} เฟรม</span>

            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setSelected(filtered.map((f) => f.path))}>
                เลือกทั้งหมดที่แสดง
              </Button>

              {bulkConfirm ? (
                <>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => void handleDeleteBulk()}
                    disabled={deletingBulk || selected.length === 0}
                  >
                    {deletingBulk ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="mr-2 h-4 w-4" />
                    )}
                    ยืนยันลบ {selected.length}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setBulkConfirm(false)} disabled={deletingBulk}>
                    ยกเลิก
                  </Button>
                </>
              ) : (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setBulkConfirm(true)}
                  disabled={selected.length === 0}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  ลบที่เลือก
                </Button>
              )}

              <Button variant="ghost" size="sm" onClick={exitSelection}>
                ออกจากโหมดลบ
              </Button>
            </div>
          </div>
        )}
      </CardContent>

      {/* ========================================
          Lightbox — ซูมตรวจความคมของเฟรม
          ======================================== */}
      {lightboxFrame && (
        <div className="fixed inset-0 z-[950] flex flex-col p-3 sm:p-6">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setLightboxPath(null)} />

          <div className="relative z-10 mx-auto flex h-full w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
            {/* header */}
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2.5">
              <span className="rounded-full bg-primary/15 px-2 py-0.5 font-mono text-[10px] font-bold text-primary">
                {positionLabel(lightboxFrame)}
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground" title={lightboxFrame.filename}>
                {lightboxFrame.filename}
              </span>
              <span className="hidden font-mono text-[10px] text-muted-foreground sm:inline">
                {lightboxIndex + 1}/{filtered.length} · {lightboxFrame.size_kb} KB
                {natural ? ` · ${natural.w}×${natural.h}` : ''}
              </span>

              <div className="flex items-center gap-1">
                {(['fit', '100', '200'] as ZoomKey[]).map((z) => (
                  <Button
                    key={z}
                    variant={zoom === z ? 'default' : 'outline'}
                    size="sm"
                    className="h-7 px-2 font-mono text-[11px]"
                    onClick={() => setZoom(z)}
                  >
                    {z === 'fit' ? 'Fit' : `${z}%`}
                  </Button>
                ))}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setLightboxPath(null)}
                  aria-label="ปิด"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* image area */}
            <div className={cn('relative min-h-0 flex-1 overflow-auto bg-black', SCROLL_SKIN)}>
              <div className={cn('flex min-h-full min-w-full items-center justify-center', zoom !== 'fit' && 'p-4')}>
                {urlFor(lightboxFrame) && !failed.includes(lightboxFrame.path) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={urlFor(lightboxFrame) as string}
                    alt={lightboxFrame.filename}
                    onLoad={(e) =>
                      setNatural({
                        w: e.currentTarget.naturalWidth,
                        h: e.currentTarget.naturalHeight,
                      })
                    }
                    onError={() => markFailed(lightboxFrame.path)}
                    className={cn(zoom === 'fit' && 'max-h-full max-w-full object-contain')}
                    style={
                      zoom === 'fit' || !natural
                        ? undefined
                        : {
                            width: zoom === '100' ? natural.w : natural.w * 2,
                            maxWidth: 'none',
                          }
                    }
                  />
                ) : (
                  <div className="flex flex-col items-center gap-3 p-8 text-center">
                    <AlertCircle className="h-8 w-8 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">โหลดรูปไม่สำเร็จ</p>
                    <Button variant="outline" size="sm" onClick={() => retryImage(lightboxFrame.path)}>
                      <RotateCw className="mr-2 h-4 w-4" />
                      ลองใหม่
                    </Button>
                  </div>
                )}
              </div>

              {filtered.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={() => stepLightbox(-1)}
                    className="absolute left-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-white transition-colors hover:bg-black/85"
                    aria-label="เฟรมก่อนหน้า"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => stepLightbox(1)}
                    className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-white transition-colors hover:bg-black/85"
                    aria-label="เฟรมถัดไป"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                </>
              )}
            </div>

            {/* footer */}
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border px-3 py-2.5">
              <span className="font-mono text-[10px] text-muted-foreground">
                {formatWhen(lightboxFrame.modified_at)}
              </span>

              <div className="ml-auto flex flex-wrap items-center gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => void handleCopy(lightboxFrame.path, lightboxFrame.filename)}
                >
                  {copiedPath === lightboxFrame.path ? (
                    <Check className="mr-1.5 h-3.5 w-3.5 text-green-500" />
                  ) : (
                    <Copy className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Copy ชื่อไฟล์
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => void handleSend(lightboxFrame.path)}
                  disabled={sendingPath === lightboxFrame.path}
                >
                  {sendingPath === lightboxFrame.path ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Send className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  ส่งเข้า ComfyUI
                </Button>

                {urlFor(lightboxFrame) && (
                  <a
                    href={urlFor(lightboxFrame) as string}
                    download={lightboxFrame.filename}
                    className={cn(LINK_GHOST, 'h-8 w-auto gap-1.5 border border-input px-2.5 text-xs')}
                  >
                    <Download className="h-3.5 w-3.5" />
                    ดาวน์โหลด
                  </a>
                )}

                <Button
                  variant="default"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => void handleChainFromFrame(lightboxFrame)}
                  disabled={chainingPath === lightboxFrame.path}
                >
                  {chainingPath === lightboxFrame.path ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Link2 className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  ต่อคลิปจากเฟรมนี้
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs text-muted-foreground hover:text-destructive"
                  onClick={() => void handleDeleteOne(lightboxFrame.path)}
                  disabled={deletingPath === lightboxFrame.path}
                >
                  {deletingPath === lightboxFrame.path ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  ลบ
                </Button>

                <span className="hidden items-center gap-1 pl-1 text-[10px] text-muted-foreground lg:flex">
                  <Maximize2 className="h-3 w-3" />
                  ← → เปลี่ยนเฟรม · Esc ปิด
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </Card>
  )
}