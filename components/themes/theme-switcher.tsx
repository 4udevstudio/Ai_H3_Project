'use client'

/**
 * ========================================
 * ThemeSwitcher
 * ========================================
 * Description:
 * ปุ่ม dropdown สำหรับสลับ theme ทั้ง 5 ของแอป
 *
 * เปลี่ยนจาก next-themes มาใช้ ThemeProvider custom แล้ว
 * เพื่อให้ตั้ง data-theme บน <html> ได้ตรงตามที่ CSS ต้องการ
 */

import * as React from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, Palette } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useTheme } from '@/components/themes/theme-provider'
import { cn } from '@/lib/utils'

export function ThemeSwitcher() {
  const { theme, setTheme, themes } = useTheme()

  const [mounted, setMounted] = React.useState(false)
  const [open, setOpen] = React.useState(false)
  const containerRef = React.useRef<HTMLDivElement>(null)

  // กัน hydration mismatch
  React.useEffect(() => {
    setMounted(true)
  }, [])

  // ปิด dropdown เมื่อคลิกนอกพื้นที่ หรือกด Escape
  React.useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false)
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  return (
    <div ref={containerRef} className="relative z-[60]">
      {/* ปุ่มหลักสำหรับเปิด-ปิด dropdown */}
      <Button
        variant="ghost"
        size="icon"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Palette className="h-5 w-5" />
        <span className="sr-only">เปลี่ยน theme</span>
      </Button>

      {/* แผง dropdown รายการ theme */}
      <AnimatePresence>
        {open && mounted && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 z-[1000] mt-2 w-72 overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-xl"
          >
            {/* หัวข้อแผง */}
            <div className="border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              ธีม / Theme
            </div>

            {/* รายการ theme ทั้ง 5 */}
            <div className="p-1">
              {themes.map((t) => {
                const isActive = theme === t.id

                return (
                  <button
                    key={t.id}
                    role="menuitem"
                    type="button"
                    onClick={() => {
                      setTheme(t.id)
                      setOpen(false)
                    }}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors',
                      'hover:bg-accent hover:text-accent-foreground',
                      isActive && 'bg-accent text-accent-foreground'
                    )}
                  >
                    {/* ตัวอย่างสีของ theme */}
                    <span
                      className="h-6 w-6 shrink-0 rounded-full border border-border shadow-inner"
                      style={{ background: t.preview }}
                    />

                    <span className="flex-1">
                      <span className="block text-sm font-medium">
                        {t.icon} {t.label}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {t.description}
                      </span>
                    </span>

                    {mounted && isActive && (
                      <Check className="h-4 w-4 shrink-0 text-primary" />
                    )}
                  </button>
                )
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}