/**
 * ========================================
 * History API Route
 * ========================================
 * Description:
 * API สำหรับจัดการประวัติการสร้างวิดีโอใน Database
 *
 * Endpoints:
 * - GET  /api/history : ดึงรายการประวัติทั้งหมด
 * - POST /api/history : บันทึก/อัปเดตงานที่เสร็จแล้วจาก Queue ลง Database
 *
 * Notes:
 * - ใช้ Prisma + SQLite
 * - ใช้ id ของ backend job เป็น primary key เพื่อ กันบันทึกซ้ำ
 * - รับเฉพาะงานสถานะ DONE / CANCELLED / FAILED เท่านั้น
 * - STEP 8.6: รองรับ duration จาก metadata จริงของวิดีโอ
 */

import { NextRequest, NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'


/**
 * โครงสร้าง payload ที่ frontend ส่งมาจาก backend queue
 * หมายเหตุ: ใช้ snake_case ตามโครงสร้าง FastAPI response
 */
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

/**
 * สถานะที่ถือว่าเป็นงานสิ้นสุดแล้วและควรบันทึกลง History
 */
const FINISHED_STATUSES = new Set(['DONE', 'CANCELLED', 'FAILED'])

/**
 * จำกัดขนาดข้อความเพื่อป้องกันข้อมูลยาวเกินจำเป็น
 * เพิ่มเป็น 20000 เพราะ prompt แบบ integrated_multimodal_description อาจยาว
 */
const MAX_TEXT_LENGTH = 20000

/**
 * ตัดข้อความให้ไม่เกินกำหนด และคืนค่าเป็น null ถ้าว่าง
 *
 * @param value ข้อความต้นทาง
 * @param maxLength ความยาวสูงสุด
 */
function normalizeText(
  value: string | null | undefined,
  maxLength = MAX_TEXT_LENGTH
): string | null {
  if (!value) return null

  const trimmed = value.trim()
  if (!trimmed) return null

  return trimmed.slice(0, maxLength)
}

/**
 * แปลง string เป็น Date อย่างปลอดภัย
 * ถ้าใช้ไม่ได้จะคืนค่าเป็น Date ปัจจุบัน
 *
 * @param value ISO string จาก backend
 */
function safeDate(value: string | undefined | null): Date {
  if (!value) return new Date()

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return new Date()

  return date
}

/**
 * แปลงค่า duration ให้เป็น number ที่บันทึกใน Database ได้
 *
 * Description:
 * - backend ส่ง duration เป็นวินาที เช่น 5.12
 * - ถ้า Prisma schema เป็น Int? การปัดเป็นจำนวนเต็มจะปลอดภัยที่สุด
 * - ถ้า schema เป็น Float? ก็ยังรับ integer ได้เช่นกัน
 *
 * @param value ค่า duration จาก payload
 */
function normalizeDuration(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null

  const numeric = typeof value === 'number' ? value : Number(value)

  if (!Number.isFinite(numeric)) return null

  const rounded = Math.round(numeric)

  if (rounded < 0) return null

  return rounded
}

/**
 * GET /api/history
 *
 * Description:
 * ดึงรายการประวัติการสร้างวิดีโอจาก Database
 * เรียงจากใหม่ไปเก่า
 *
 * Query:
 * - limit: จำนวนรายการสูงสุด ค่า default 200, สูงสุด 500
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const rawLimit = Number(searchParams.get('limit') ?? 200)

    const limit = Number.isFinite(rawLimit)
      ? Math.min(500, Math.max(1, Math.floor(rawLimit)))
      : 200

    const items = await prisma.generation.findMany({
      orderBy: {
        createdAt: 'desc',
      },
      take: limit,
    })

    return NextResponse.json(items)
  } catch (error) {
    return NextResponse.json(
      {
        error: 'ดึงประวัติไม่สำเร็จ',
        detail: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}

/**
 * POST /api/history
 *
 * Description:
 * บันทึกงานที่สิ้นสุดแล้วจาก Queue ลง Database
 * ใช้ upsert ตาม id เพื่อป้องกันบันทึกซ้ำ
 *
 * Body:
 * HistoryUpsertPayload จาก backend queue job
 */
export async function POST(request: NextRequest) {
  try {
    const payload = (await request.json()) as HistoryUpsertPayload

    if (!payload?.id) {
      return NextResponse.json(
        { error: 'missing job id' },
        { status: 400 }
      )
    }

    if (!payload.prompt || !payload.prompt.trim()) {
      return NextResponse.json(
        { error: 'prompt ห้ามว่างเปล่า' },
        { status: 400 }
      )
    }

    if (!FINISHED_STATUSES.has(payload.status)) {
      return NextResponse.json(
        { error: 'บันทึกเฉพาะงานสถานะ DONE / CANCELLED / FAILED เท่านั้น' },
        { status: 400 }
      )
    }

    const createdAt = safeDate(payload.created_at)
    const updatedAt = safeDate(payload.updated_at)

    const durationMs = updatedAt.getTime() - createdAt.getTime()
    const generationTime =
      Number.isFinite(durationMs) && durationMs >= 0
        ? Number((durationMs / 1000).toFixed(3))
        : null

    const durationValue = normalizeDuration(payload.duration)

    const recordData = {
      id: payload.id,
      projectId: null,

      type: normalizeText(payload.type, 50) ?? 'TEXT2VID',
      prompt: normalizeText(payload.prompt) ?? '',
      negativePrompt: normalizeText(payload.negative_prompt),

      seed: Number.isFinite(payload.seed) ? Math.trunc(payload.seed) : -1,
      steps: Number.isFinite(payload.steps)
        ? Math.min(50, Math.max(1, Math.trunc(payload.steps)))
        : 6,
      resolution: normalizeText(payload.resolution, 20) ?? '768p',

      taskAdapter: normalizeText(payload.task_adapter, 50),
      loraUsed: normalizeText(payload.lora_used, 100),

      useAIEnhancement: false,

      videoPath: normalizeText(payload.video_path, 500),
      audioPath: null,
      thumbnailPath: normalizeText(payload.thumbnail_path, 500),
      duration: durationValue,

      status: payload.status,
      error:
        normalizeText(payload.error, 1000) ??
        (payload.status === 'FAILED' ? normalizeText(payload.message, 1000) : null),

      generationTime,
      vramUsed: null,

      createdAt,
      completedAt: payload.status === 'DONE' ? updatedAt : null,
    }

    const saved = await prisma.generation.upsert({
      where: {
        id: payload.id,
      },
      update: {
        type: recordData.type,
        prompt: recordData.prompt,
        negativePrompt: recordData.negativePrompt,
        seed: recordData.seed,
        steps: recordData.steps,
        resolution: recordData.resolution,
        taskAdapter: recordData.taskAdapter,
        loraUsed: recordData.loraUsed,
        videoPath: recordData.videoPath,
        thumbnailPath: recordData.thumbnailPath,
        duration: recordData.duration,
        status: recordData.status,
        error: recordData.error,
        generationTime: recordData.generationTime,
        completedAt: recordData.completedAt,
      },
      create: recordData,
    })

    return NextResponse.json(saved)
  } catch (error) {
    return NextResponse.json(
      {
        error: 'บันทึกประวัติไม่สำเร็จ',
        detail: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}