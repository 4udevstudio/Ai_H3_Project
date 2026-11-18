/**
 * ========================================
 * Health Check API
 * ========================================
 * Description:
 * API สำหรับตรวจสอบความพร้อมของระบบ (GET /api/health)
 * ใช้ยืนยันว่า web app + database ทำงานได้ถูกต้อง
 *
 * การใช้งาน:
 * เปิดเบราว์เซอร์ไปที่ http://localhost:3000/api/health
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/health
 * ตรวจสอบการเชื่อมต่อ database และคืนสถานะระบบ
 */
export async function GET() {
  try {
    // ทดสอบเชื่อมต่อ database โดยการนับจำนวน projects
    const projectCount = await prisma.project.count()

    return NextResponse.json({
      status: 'ok',
      database: 'connected',
      projectCount,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    // ถ้าเชื่อมต่อไม่ได้ จะคืน error พร้อม status 500
    return NextResponse.json(
      {
        status: 'error',
        database: 'disconnected',
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}