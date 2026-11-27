'use client'

/**
 * ========================================
 * โหลดเรื่องหนึ่งเรื่อง
 * ========================================
 */

import * as React from 'react'

import { getFilm } from '@/lib/films-api'
import { withApiHint } from '@/lib/films-error'
import type { Film } from '@/lib/films-types'

export function useFilm(filmId: string) {
  const [film, setFilm] = React.useState<Film | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [loadedFor, setLoadedFor] = React.useState<string | null>(null)
  const loading = loadedFor !== filmId

  const reload = React.useCallback(async () => {
    const next = await getFilm(filmId)
    setFilm(next)
    setError(null)
    setLoadedFor(filmId)
    return next
  }, [filmId])

  React.useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const next = await getFilm(filmId)
        if (cancelled) return
        setFilm(next)
        setError(null)
        setLoadedFor(filmId)
      } catch (err: unknown) {
        if (cancelled) return
        setFilm(null)
        setError(withApiHint(err, 'โหลดเรื่องไม่สำเร็จ'))
        setLoadedFor(filmId)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [filmId])

  return { film, setFilm, loading, error, reload }
}
