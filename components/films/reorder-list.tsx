'use client'

/**
 * ========================================
 * ลากจัดลำดับ (เมาส์และสัมผัส)
 * ========================================
 * จับที่ปุ่มมือจับเท่านั้น — touch-action: none ไม่ให้หน้าจอเลื่อนตามนิ้ว
 */

import * as React from 'react'
import { GripVertical } from 'lucide-react'

import { cn } from '@/lib/utils'

export function reorder<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) {
    return items
  }

  const next = items.slice()
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

interface ReorderListProps<T> {
  items: T[]
  getId: (item: T) => string
  onReorder: (next: T[]) => void
  renderItem: (item: T, index: number, handle: React.ReactNode) => React.ReactNode
  className?: string
}

export function ReorderList<T>({
  items,
  getId,
  onReorder,
  renderItem,
  className,
}: ReorderListProps<T>) {
  const itemRefs = React.useRef<Map<string, HTMLDivElement>>(new Map())
  const dragRef = React.useRef<{ id: string; from: number; over: number } | null>(null)
  const [drag, setDrag] = React.useState<{ id: string; from: number; over: number } | null>(null)

  const startDrag = (event: React.PointerEvent<HTMLButtonElement>, index: number, id: string) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()

    const list = items
    const commit = onReorder

    const pointToIndex = (clientY: number) => {
      let closest = 0
      let best = Number.POSITIVE_INFINITY

      list.forEach((item, itemIndex) => {
        const element = itemRefs.current.get(getId(item))
        if (!element) return
        const rect = element.getBoundingClientRect()
        const distance = Math.abs(clientY - (rect.top + rect.height / 2))
        if (distance < best) {
          best = distance
          closest = itemIndex
        }
      })

      return closest
    }

    dragRef.current = { id, from: index, over: index }
    setDrag(dragRef.current)

    const onMove = (ev: PointerEvent) => {
      if (ev.cancelable) ev.preventDefault()
      if (!dragRef.current) return
      dragRef.current = { ...dragRef.current, over: pointToIndex(ev.clientY) }
      setDrag(dragRef.current)
    }

    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)

      const current = dragRef.current
      dragRef.current = null
      setDrag(null)

      if (current && current.from !== current.over) {
        commit(reorder(list, current.from, current.over))
      }
    }

    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  const moveByKeyboard = (index: number, delta: number) => {
    const target = index + delta
    if (target < 0 || target >= items.length) return
    onReorder(reorder(items, index, target))
  }

  return (
    <div className={cn('grid gap-3', className)}>
      {items.map((item, index) => {
        const id = getId(item)
        const dragging = drag?.id === id
        const target = drag != null && drag.id !== id && drag.over === index

        const handle = (
          <button
            type="button"
            aria-label={`ลากเพื่อจัดลำดับ รายการ ${index + 1} ใช้ลูกศรขึ้นลงได้`}
            className="flex h-11 w-11 shrink-0 cursor-grab items-center justify-center rounded-lg text-muted-foreground hover:bg-muted active:cursor-grabbing touch-none select-none"
            onPointerDown={(event) => startDrag(event, index, id)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowUp') {
                event.preventDefault()
                moveByKeyboard(index, -1)
              } else if (event.key === 'ArrowDown') {
                event.preventDefault()
                moveByKeyboard(index, 1)
              }
            }}
          >
            <GripVertical className="h-4 w-4" />
          </button>
        )

        return (
          <div
            key={id}
            ref={(node) => {
              if (node) itemRefs.current.set(id, node)
              else itemRefs.current.delete(id)
            }}
            className={cn(
              'rounded-xl',
              dragging && 'relative z-10 opacity-70',
              target && 'ring-2 ring-primary/50'
            )}
          >
            {renderItem(item, index, handle)}
          </div>
        )
      })}
    </div>
  )
}
