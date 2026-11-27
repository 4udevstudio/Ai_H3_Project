'use client'

/**
 * ========================================
 * ชิ้นส่วนร่วมของตัวแก้ไขหนังสั้น
 * ========================================
 */

import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ArrowLeft, Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { FILMS_API_MOCK_ENABLED } from '@/lib/films-api'
import { cn } from '@/lib/utils'

export const controlClass =
  'h-11 w-full rounded-lg border border-input bg-background px-2.5 text-base text-foreground shadow-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 md:h-9 md:text-sm'

export function FieldLabel({
  children,
  hint,
}: {
  children: React.ReactNode
  hint?: string
}) {
  return (
    <span className="flex items-baseline justify-between gap-2 text-xs font-medium">
      <span>{children}</span>
      {hint ? <span className="font-normal text-muted-foreground">{hint}</span> : null}
    </span>
  )
}

export function MockBanner() {
  if (!FILMS_API_MOCK_ENABLED) return null

  return (
    <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
      ข้อมูลตัวอย่างในเบราว์เซอร์ — ยังไม่ถูกเขียนลงฐานข้อมูล
    </p>
  )
}

export function Meter({ value, label }: { value: number; label?: string }) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)))

  return (
    <div className="grid gap-1">
      {label ? (
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>{label}</span>
          <span className="tabular-nums">{clamped}%</span>
        </div>
      ) : null}
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? 'ความคืบหน้า'}
      >
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-300"
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  )
}

export function ClipPlayer({
  url,
  label,
}: {
  url?: string | null
  label: string
}) {
  if (!url) {
    return (
      <div className="flex aspect-video w-full items-center justify-center rounded-lg border border-dashed border-border bg-muted/30 px-3 text-center text-xs text-muted-foreground">
        ยังไม่มีคลิป
      </div>
    )
  }

  return (
    <video
      key={url}
      src={url}
      controls
      playsInline
      preload="metadata"
      className="aspect-video w-full rounded-lg bg-black"
      aria-label={label}
    />
  )
}

export function FilmLoading({ label }: { label: string }) {
  return (
    <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      {label}
    </div>
  )
}

export function FilmError({
  message,
  onRetry,
}: {
  message: string
  onRetry?: () => void
}) {
  return (
    <div
      role="alert"
      className="grid gap-3 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm"
    >
      <p>{message}</p>
      {onRetry ? (
        <Button type="button" variant="outline" className="h-11 w-fit" onClick={onRetry}>
          ลองใหม่
        </Button>
      ) : null}
    </div>
  )
}

const TABS = [
  { href: (id: string) => `/shortfilm/${id}`, label: 'ฉาก', hint: 'Scenes', exact: true },
  { href: (id: string) => `/shortfilm/${id}/script`, label: 'จากสคริปต์', hint: 'Script', exact: false },
  { href: (id: string) => `/shortfilm/${id}/assembly`, label: 'รวมคลิป', hint: 'Assembly', exact: false },
] as const

export function FilmChrome({
  filmId,
  title,
  meta,
  actions,
  children,
}: {
  filmId: string
  title: React.ReactNode
  meta?: React.ReactNode
  actions?: React.ReactNode
  children: React.ReactNode
}) {
  const pathname = usePathname()

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-4">
      <MockBanner />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="grid min-w-0 flex-1 gap-1">
          <Link
            href="/shortfilm"
            className="inline-flex h-11 w-fit items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground sm:h-auto"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            เรื่องทั้งหมด
          </Link>
          {title}
          {meta}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>

      <nav
        aria-label="ส่วนของเรื่อง"
        className="flex gap-1 overflow-x-auto rounded-xl border border-border bg-card p-1"
      >
        {TABS.map((tab) => {
          const href = tab.href(filmId)
          const active = tab.exact ? pathname === href : pathname.startsWith(href)

          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex h-11 min-w-fit flex-1 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors',
                active
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              <span>{tab.label}</span>
              <span className={cn('text-[10px] font-normal', active ? 'text-primary-foreground/80' : 'text-muted-foreground')}>
                {tab.hint}
              </span>
            </Link>
          )
        })}
      </nav>

      {children}
    </div>
  )
}
