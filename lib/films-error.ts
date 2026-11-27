/**
 * ========================================
 * Films API error
 * ========================================
 * แยกคลาสออกจาก client เพื่อให้ mock ใช้ได้โดยไม่วน import
 */

export class FilmsApiError extends Error {
  readonly status: number
  /** งานที่สร้างได้ก่อนโดน 429 ระหว่าง generate-all */
  partialJobs?: Array<{ id: string; target_id: string }>

  constructor(status: number, message: string) {
    super(message)
    this.name = 'FilmsApiError'
    this.status = status
  }
}

export function jobLimitMessage(active: number, limit: number): string {
  const activeText = Number.isFinite(active) ? String(active) : '?'
  const limitText = Number.isFinite(limit) ? String(limit) : '?'
  return `คุณมีงานที่กำลังทำอยู่ ${activeText}/${limitText} งาน กรุณารอให้เสร็จก่อน`
}

export function filmsErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof FilmsApiError) return error.message
  if (error instanceof Error && error.message) return error.message
  return fallback
}

/** ต่อท้ายข้อความเมื่อยังไม่มี route ของสาขา database */
export function withApiHint(error: unknown, fallback: string): string {
  const message = filmsErrorMessage(error, fallback)
  const status = error instanceof FilmsApiError ? error.status : 0

  if (status === 404 || status === 0 || status === 405) {
    return `${message} — ถ้ายังไม่ได้รวม /api/films ให้รัน dev ด้วย NEXT_PUBLIC_FILMS_API_MOCK=1`
  }

  return message
}
