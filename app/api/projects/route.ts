/**
 * ========================================
 * Projects Collection API
 * ========================================
 * Description:
 * API สำหรับจัดการรายการโปรเจคทั้งหมด
 *
 * Endpoints:
 * - GET  /api/projects : ดึงรายการโปรเจคทั้งหมด
 * - POST /api/projects : สร้างโปรเจคใหม่
 *
 * Notes:
 * - ใช้ Prisma + SQLite
 * - คืนค่า _count.generations เพื่อแสดงจำนวนงานในโปรเจค
 */
import { NextRequest, NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'

/**
 * ความยาวสูงสุดของชื่อโปรเจค
 */
const MAX_PROJECT_NAME_LENGTH = 120

/**
 * ความยาวสูงสุดของคำอธิบายโปรเจค
 */
const MAX_PROJECT_DESCRIPTION_LENGTH = 1000

/**
 * ทำความสะอาดข้อความก่อนบันทึกลง Database
 *
 * @param value ค่าต้นทาง
 * @param maxLength ความยาวสูงสุด
 * @returns ข้อความที่ trim แล้ว หรือ null ถ้าว่าง
 */
function normalizeText(
  value: string | null | undefined,
  maxLength: number
): string | null {
  if (!value) return null

  const trimmed = value.trim()
  if (!trimmed) return null

  return trimmed.slice(0, maxLength)
}

/**
 * GET /api/projects
 *
 * Description:
 * ดึงรายการโปรเจคทั้งหมดเรียงจากอัปเดตล่าสุดไปเก่าสุด
 * พร้อมจำนวน generation ที่อยู่ในโปรเจคนั้น
 */
export async function GET() {
  try {
    const projects = await prisma.project.findMany({
      orderBy: {
        updatedAt: 'desc',
      },
      include: {
        _count: {
          select: {
            generations: true,
          },
        },
      },
    })

    return NextResponse.json(projects)
  } catch (error) {
    return NextResponse.json(
      {
        error: 'ดึงรายการโปรเจคไม่สำเร็จ',
        detail: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}

/**
 * POST /api/projects
 *
 * Description:
 * สร้างโปรเจคใหม่
 *
 * Body:
 * - name: ชื่อโปรเจค (จำเป็น)
 * - description: คำอธิบาย (ไม่จำเป็น)
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      name?: string
      description?: string | null
    }

    const name = normalizeText(body.name, MAX_PROJECT_NAME_LENGTH)
    const description = normalizeText(
      body.description,
      MAX_PROJECT_DESCRIPTION_LENGTH
    )

    if (!name) {
      return NextResponse.json(
        { error: 'กรุณากรอกชื่อโปรเจค' },
        { status: 400 }
      )
    }

    const project = await prisma.project.create({
      data: {
        name,
        description,
        theme: 'midnight',
      },
      include: {
        _count: {
          select: {
            generations: true,
          },
        },
      },
    })

    return NextResponse.json(project, { status: 201 })
  } catch (error) {
    return NextResponse.json(
      {
        error: 'สร้างโปรเจคไม่สำเร็จ',
        detail: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}