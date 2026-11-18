'use client'

/**
 * ========================================
 * StudioShell
 * ========================================
 * โครงสร้างหลักของหน้า Studio ทั้งหมด
 * - Desktop (md ขึ้นไป): แสดง Sidebar ถาวรด้านซ้าย
 * - Mobile: ซ่อน Sidebar, เปิดผ่านปุ่ม ☰ ใน TopBar เป็น drawer สไลด์จากซ้าย
 * - TopBar ตรึงด้านบน, เนื้อหาเลื่อนภายใน main
 * - ปิด drawer เมื่อ: กดฉากหลัง / Escape / เลือกเมนู / เปลี่ยนหน้า
 */

import * as React from 'react'
import { usePathname } from 'next/navigation'
import { Toaster } from 'sonner'

import { QueueHistorySync } from '@/components/layout/queue-history-sync'
import { Sidebar } from '@/components/layout/sidebar'
import { TopBar } from '@/components/layout/topbar'
import { cn } from '@/lib/utils'

export function StudioShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = React.useState(false)

  const close = React.useCallback(() => setMobileOpen(false), [])
  const open = React.useCallback(() => setMobileOpen(true), [])

  // ปิด drawer ทุกครั้งที่เปลี่ยนหน้า
  React.useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

  // ปิดด้วย Escape
  React.useEffect(() => {
    if (!mobileOpen) return

    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') close()
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mobileOpen, close])

  return (
    <div
      className="flex h-screen overflow-hidden bg-background text-foreground"
      style={{ height: '100dvh' }}
    >
      {/* ===== Sidebar ถาวร (Desktop) ===== */}
      <div className="hidden h-full md:block">
        <Sidebar />
      </div>

      {/* ===== Drawer (Mobile) ===== */}
      <div
        className={cn(
          'fixed inset-0 z-[900] md:hidden',
          mobileOpen ? 'pointer-events-auto' : 'pointer-events-none'
        )}
        aria-hidden={!mobileOpen}
        inert={!mobileOpen}
      >
        {/* ฉากหลังมืด — กดเพื่อปิด */}
        <div
          className={cn(
            'absolute inset-0 bg-black/60 backdrop-blur-[2px] transition-opacity duration-300',
            mobileOpen ? 'opacity-100' : 'opacity-0'
          )}
          onClick={close}
        />

        {/* แผงเมนูสไลด์จากซ้าย */}
        <div
          role="dialog"
          aria-modal="true"
          aria-label="เมนูหลัก"
          className={cn(
            'absolute left-0 top-0 h-full w-60 bg-sidebar shadow-2xl transition-transform duration-300 ease-out will-change-transform',
            mobileOpen ? 'translate-x-0' : '-translate-x-full'
          )}
        >
          <Sidebar onClose={close} onNavigate={close} />
        </div>
      </div>

      {/* ===== คอลัมน์หลัก ===== */}
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onMenuClick={open} menuOpen={mobileOpen} />

        <main
          className={cn(
            'flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6',
            '[scrollbar-width:thin] [scrollbar-color:var(--border)_transparent]',
            '[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent',
            '[&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border'
          )}
        >
          {children}
        </main>
      </div>

      {/* sync งานที่เสร็จเข้า History อัตโนมัติทุกหน้า */}
      <QueueHistorySync />

      <Toaster position="top-right" richColors closeButton />
    </div>
  )
}