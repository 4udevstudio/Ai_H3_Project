import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { ids: string[]; projectId: string | null }

    if (!Array.isArray(body.ids) || body.ids.length === 0) {
      return NextResponse.json({ error: 'ต้องระบุ ids อย่างน้อย 1' }, { status: 400 })
    }

    if (body.ids.length > 50) {
      return NextResponse.json({ error: 'ย้ายได้สูงสุด 50 รายการต่อครั้ง' }, { status: 400 })
    }

    let targetProjectId: string | null = null

    if (body.projectId !== undefined && body.projectId !== null) {
      const p = await prisma.project.findUnique({ where: { id: body.projectId } })
      if (!p) return NextResponse.json({ error: 'ไม่พบโปรเจคปลายทาง' }, { status: 404 })
      targetProjectId = p.id
    }

    const result = await prisma.generation.updateMany({
      where: { id: { in: body.ids } },
      data: { projectId: targetProjectId },
    })

    return NextResponse.json({ moved: result.count })
  } catch (error) {
    return NextResponse.json({ error: 'ย้ายไม่สำเร็จ', detail: (error as Error).message }, { status: 500 })
  }
}