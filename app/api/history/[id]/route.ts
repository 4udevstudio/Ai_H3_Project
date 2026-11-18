import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  try {
    const body = (await req.json()) as { projectId?: string | null }

    // projectId = null → นำออกจากโปรเจค
    // projectId = "xxx" → ย้ายเข้าโปรเจค xxx
    let targetProjectId: string | null = null

    if (body.projectId !== undefined && body.projectId !== null) {
      const p = await prisma.project.findUnique({ where: { id: body.projectId } })
      if (!p) return NextResponse.json({ error: 'ไม่พบโปรเจคปลายทาง' }, { status: 404 })
      targetProjectId = p.id
    }

    const updated = await prisma.generation.update({
      where: { id },
      data: { projectId: targetProjectId },
    })

    return NextResponse.json(updated)
  } catch (error) {
    return NextResponse.json({ error: 'อัปเดตไม่สำเร็จ', detail: (error as Error).message }, { status: 500 })
  }
}