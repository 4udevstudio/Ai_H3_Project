'use client'

/**
 * ========================================
 * DropZone
 * ========================================
 * พื้นที่ลาก-วางไฟล์ + คลิกเลือก + รองรับ keyboard
 */

import * as React from 'react'
import { Upload } from 'lucide-react'

import { cn } from '@/lib/utils'

interface DropZoneProps {
  onFiles: (files: File[]) => void
  accept?: string
  multiple?: boolean
  title?: string
  hint?: string
  disabled?: boolean
  compact?: boolean
  className?: string
}

export function DropZone({
  onFiles,
  accept,
  multiple = true,
  title = 'ลากไฟล์มาวางที่นี่ หรือคลิกเพื่อเลือก',
  hint,
  disabled,
  compact,
  className,
}: DropZoneProps) {
  const [dragging, setDragging] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement | null>(null)
  const depth = React.useRef(0)

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault()
    depth.current = 0
    setDragging(false)
    if (disabled) return

    const files = Array.from(event.dataTransfer.files || [])
    if (files.length) onFiles(multiple ? files : files.slice(0, 1))
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={title}
      onClick={() => !disabled && inputRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          inputRef.current?.click()
        }
      }}
      onDragEnter={(e) => {
        e.preventDefault()
        if (disabled) return
        depth.current += 1
        setDragging(true)
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={(e) => {
        e.preventDefault()
        depth.current = Math.max(0, depth.current - 1)
        if (depth.current === 0) setDragging(false)
      }}
      onDrop={handleDrop}
      className={cn(
        'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        compact ? 'p-3' : 'p-6',
        dragging
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-border bg-muted/20 text-muted-foreground hover:border-primary/50 hover:bg-muted/30',
        disabled && 'cursor-not-allowed opacity-50',
        className
      )}
    >
      <Upload className={compact ? 'h-4 w-4' : 'h-6 w-6'} />
      <p className={compact ? 'text-[10px] font-medium' : 'text-xs font-medium'}>{title}</p>
      {hint && <p className={compact ? 'text-[9px]' : 'text-[10px]'}>{hint}</p>}

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files || [])
          if (files.length) onFiles(files)
          e.target.value = ''
        }}
      />
    </div>
  )
}