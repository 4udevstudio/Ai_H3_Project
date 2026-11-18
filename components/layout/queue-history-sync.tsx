'use client'

/**
 * ========================================
 * QueueHistorySync
 * ========================================
 * Mount ที่ StudioShell (ระดับ layout) → ทำงานทุกหน้าใน Studio
 *
 * หน้าที่:
 * - poll queue เป็นระยะ
 * - เมื่องานเป็น DONE / CANCELLED / FAILED → POST เข้า /api/history (upsert)
 * - ทำให้งานที่ gen จากหน้าไหนก็ตาม (Studio / ชุดหนังสั้น / เครื่อง LAN)
 *   ถูกบันทึกเข้า History อัตโนมัติ โดยไม่ต้องเปิดหน้า Studio ค้างไว้
 * - persist ย้อนหลัง: งานที่เสร็จตอนปิดแอปไว้ จะถูกลง History ตอนเปิดแอปครั้งถัดไป
 */

import * as React from 'react'

import { fetchGenerations, type QueueJobResponse } from '@/lib/backend'

const POLL_INTERVAL_MS = 3000

const FINISHED_STATUSES = new Set(['DONE', 'CANCELLED', 'FAILED'])

interface HistoryUpsertPayload {
  id: string
  prompt: string
  negative_prompt?: string | null
  type: string
  resolution: string
  steps: number
  seed: number
  task_adapter?: string | null
  lora_used?: string | null
  status: string
  progress: number
  message?: string
  error?: string | null
  created_at: string
  updated_at: string
  reference_count?: number
  reference_names?: string[]
  video_path?: string | null
  thumbnail_path?: string | null
  output_filename?: string | null
  duration?: number | null
}

export function QueueHistorySync() {
  const persistedIdsRef = React.useRef<Set<string>>(new Set())

  React.useEffect(() => {
    let mounted = true

    const persistFinished = async (jobs: QueueJobResponse[]) => {
      const finished = jobs.filter(
        (job) => FINISHED_STATUSES.has(job.status) && !persistedIdsRef.current.has(job.id)
      )

      if (finished.length === 0) return

      finished.forEach((job) => persistedIdsRef.current.add(job.id))

      await Promise.all(
        finished.map(async (job) => {
          const payload: HistoryUpsertPayload = {
            id: job.id,
            prompt: job.prompt,
            negative_prompt: job.negative_prompt ?? null,
            type: job.type,
            resolution: job.resolution,
            steps: job.steps,
            seed: job.seed,
            task_adapter: job.task_adapter ?? null,
            lora_used: job.lora_used ?? null,
            status: job.status,
            progress: job.progress,
            message: job.message,
            error: job.error ?? null,
            created_at: job.created_at,
            updated_at: job.updated_at,
            reference_count: job.reference_count ?? 0,
            reference_names: job.reference_names ?? [],
            video_path: job.video_path ?? null,
            thumbnail_path: job.thumbnail_path ?? null,
            output_filename: job.output_filename ?? null,
            duration: job.duration ?? null,
          }

          try {
            const res = await fetch('/api/history', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            })

            if (!res.ok) {
              // upsert ล้มเหลว → ลองใหม่รอบถัดไป
              persistedIdsRef.current.delete(job.id)
            }
          } catch {
            persistedIdsRef.current.delete(job.id)
          }
        })
      )
    }

    const load = async () => {
      try {
        const jobs = await fetchGenerations(200)
        if (mounted) await persistFinished(jobs)
      } catch {
        // backend ยังไม่พร้อม ข้ามรอบนี้
      }
    }

    void load()
    const id = window.setInterval(() => void load(), POLL_INTERVAL_MS)

    return () => {
      mounted = false
      window.clearInterval(id)
    }
  }, [])

  return null
}