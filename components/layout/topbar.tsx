'use client'

/**
 * ========================================
 * TopBar
 * ========================================
 * แถบบนของ Studio
 * - ปุ่ม ☰ เปิดเมนู (เฉพาะมือถือ)
 * - ชื่อหน้าปัจจุบันตาม path
 * - ป้ายสถานะระบบ ต่อ backend จริง (poll ทุก 15 วินาที)
 *   บนจอเล็กย่อเหลือไอคอน ไม่แตกหลายบรรทัด
 * - ปุ่มเปลี่ยนธีมด้านขวา
 */

import * as React from 'react'
import { usePathname } from 'next/navigation'
import { Activity, Menu } from 'lucide-react'

import { ThemeSwitcher } from '@/components/themes/theme-switcher'
import { checkBackendHealth } from '@/lib/backend'
import { cn } from '@/lib/utils'

const PAGE_TITLES: Record<string, string> = {
  '/': 'แดชบอร์ด',
  '/studio': 'สร้างคลิปสั้น',
  '/shortfilm': 'สร้างหนังสั้น',
  '/projects': 'โปรเจค',
  '/history': 'ประวัติการสร้าง',
  '/media': 'คลังมีเดีย',
  '/frames': 'คลังเฟรม',
  '/settings': 'ตั้งค่า',
}

type HealthState = 'checking' | 'ok' | 'down'

interface TopBarProps {
  onMenuClick?: () => void
  menuOpen?: boolean
}

export function TopBar({ onMenuClick, menuOpen }: TopBarProps) {
  const pathname = usePathname()
  const title = PAGE_TITLES[pathname] ?? 'Studio'

  const [health, setHealth] = React.useState<HealthState>('checking')

  React.useEffect(() => {
    let mounted = true

    const run = async () => {
      const result = await checkBackendHealth(3000)
      if (mounted) setHealth(result.ok ? 'ok' : 'down')
    }

    void run()
    const id = window.setInterval(run, 15000)

    return () => {
      mounted = false
      window.clearInterval(id)
    }
  }, [])

  const healthLabel =
    health === 'ok'
      ? 'ระบบพร้อมใช้งาน'
      : health === 'down'
        ? 'Backend ไม่พร้อม'
        : 'กำลังตรวจสอบ...'

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border bg-card/60 px-3 backdrop-blur sm:gap-3 sm:px-5">
      {/* ซ้าย: ปุ่มเมนู + ชื่อหน้า */}
      <div className="flex min-w-0 items-center gap-2">
        {onMenuClick && (
          <button
            type="button"
            onClick={onMenuClick}
            aria-label="เปิดเมนู"
            aria-expanded={menuOpen}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground md:hidden"
          >
            <Menu className="h-5 w-5" />
          </button>
        )}

        <h1 className="truncate text-base font-semibold tracking-tight">
          {title}
        </h1>
      </div>

      {/* ขวา: สถานะ + ธีม */}
      <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
        <div
          title={healthLabel}
          className={cn(
            'flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs sm:px-3',
            health === 'ok' &&
              'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
            health === 'down' &&
              'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
            health === 'checking' &&
              'border-border bg-muted text-muted-foreground'
          )}
        >
          <Activity
            className={cn(
              'h-3.5 w-3.5 shrink-0',
              health === 'checking' && 'animate-pulse'
            )}
          />
          <span className="hidden sm:inline">{healthLabel}</span>
        </div>

        <ThemeSwitcher />
      </div>
    </header>
  )
}