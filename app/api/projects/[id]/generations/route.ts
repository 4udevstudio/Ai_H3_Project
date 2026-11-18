import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  try {
    const project = await prisma.project.findUnique({ where: { id } })
    if (!project) return NextResponse.json({ error: 'ไม่พบโปรเจค' }, { status: 404 })

    const generations = await prisma.generation.findMany({
      where: { projectId: id },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json(generations)
  } catch (error) {
    return NextResponse.json({ error: 'ดึงงานไม่สำเร็จ', detail: (error as Error).message }, { status: 500 })
  }
}