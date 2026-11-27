/**
 * ========================================
 * ป้ายสถานะฉาก / เรื่อง
 * ========================================
 */

import type { FilmStatus, SceneStatus } from '@/lib/films-types'
import { cn } from '@/lib/utils'

const SCENE_LABEL: Record<SceneStatus, string> = {
  draft: 'ร่าง',
  queued: 'รอคิว',
  running: 'กำลังสร้าง',
  done: 'เสร็จ',
  failed: 'ล้มเหลว',
}

const FILM_LABEL: Record<FilmStatus, string> = {
  draft: 'ร่าง',
  generating: 'กำลังสร้าง',
  assembling: 'กำลังรวม',
  done: 'พร้อม',
  failed: 'ล้มเหลว',
}

function tone(status: string): string {
  switch (status) {
    case 'done':
      return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
    case 'failed':
      return 'bg-destructive/10 text-destructive'
    case 'running':
    case 'generating':
    case 'assembling':
      return 'bg-sky-500/10 text-sky-700 dark:text-sky-300'
    case 'queued':
      return 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
    default:
      return 'bg-muted text-muted-foreground'
  }
}

export function SceneStatusBadge({
  status,
  progress,
}: {
  status: SceneStatus
  progress?: number | null
}) {
  const showProgress = (status === 'running' || status === 'queued') && progress != null

  return (
    <span className={cn('inline-flex h-6 items-center rounded-full px-2 text-[11px] font-medium', tone(status))}>
      {SCENE_LABEL[status]}
      {showProgress ? ` ${Math.round(progress)}%` : ''}
    </span>
  )
}

export function FilmStatusBadge({ status }: { status: FilmStatus }) {
  return (
    <span className={cn('inline-flex h-6 items-center rounded-full px-2 text-[11px] font-medium', tone(status))}>
      {FILM_LABEL[status]}
    </span>
  )
}
