'use client'

/**
 * ========================================
 * useHotkeys
 * ========================================
 * ผูก keyboard shortcuts แบบ declarative
 *
 * รูปแบบ key:
 *   'mod+enter'  (Ctrl หรือ Cmd + Enter)
 *   'mod+a'
 *   'escape'
 *   'delete' / 'backspace'
 *   '/'
 *   'arrowleft' / 'arrowright'
 *
 * Note:
 * - ปุ่มธรรมดา (ไม่มี mod) จะไม่ทำงานขณะพิมพ์ใน input/textarea
 * - escape และ mod+... ทำงานได้แม้กำลังพิมพ์
 */

import * as React from 'react'

type HotkeyHandler = (event: KeyboardEvent) => void

function comboOf(event: KeyboardEvent): string {
  const parts: string[] = []

  if (event.ctrlKey || event.metaKey) parts.push('mod')
  if (event.shiftKey) parts.push('shift')
  if (event.altKey) parts.push('alt')

  let key = event.key.toLowerCase()
  if (key === ' ') key = 'space'
  if (['control', 'meta', 'shift', 'alt'].includes(key)) key = ''
  if (key) parts.push(key)

  return parts.join('+')
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return target.isContentEditable
}

export function useHotkeys(map: Record<string, HotkeyHandler>, enabled = true) {
  const mapRef = React.useRef(map)

  React.useEffect(() => {
    mapRef.current = map
  })

  React.useEffect(() => {
    if (!enabled) return

    function onKey(event: KeyboardEvent) {
      const combo = comboOf(event)
      const handler = mapRef.current[combo]
      if (!handler) return

      const isPlain = !combo.includes('mod') && combo !== 'escape'
      if (isPlain && isTypingTarget(event.target)) return

      handler(event)
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled])
}