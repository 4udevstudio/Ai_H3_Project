import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

const MAX_NAME = 120
const MAX_DESC = 1000

function normalizeText(v: string | null | undefined, max: number): string | null {
  if (!v) return null
  const t = v.trim()
  return t ? t.slice(0, max) : null
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  try {
    const project = await prisma.project.findUnique({
      where: { id },
      include: { _count: { select: { generations: true } } },
    })
    if (!project) return NextResponse.json({ error: 'ไม่พบโปรเจค' }, { status: 404 })
    return NextResponse.json(project)
  } catch (error) {
    return NextResponse.json({ error: 'ดึงโปรเจคไม่สำเร็จ', detail: (error as Error).message }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  try {
    const body = (await req.json()) as { name?: string; description?: string | null }
    const name = normalizeText(body.name, MAX_NAME)
    const description = normalizeText(body.description, MAX_DESC)
    if (name === '') return NextResponse.json({ error: 'ชื่อโปรเจคห้ามว่าง' }, { status: 400 })

    const data: Record<string, string | null> = {}
    if (name !== null) data.name = name
    if (body.description !== undefined) data.description = description

    const project = await prisma.project.update({ where: { id }, data, include: { _count: { select: { generations: true } } } })
    return NextResponse.json(project)
  } catch (error) {
    return NextResponse.json({ error: 'แก้ไขโปรเจคไม่สำเร็จ', detail: (error as Error).message }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  try {
    // ลบโปรเจค → generation ที่โยงอยู่จะ projectId=null (schema เป็น onDelete: Cascade แต่เราใช้ update แทนเพื่อเก็บ generation)
    await prisma.generation.updateMany({ where: { projectId: id }, data: { projectId: null } })
    await prisma.project.delete({ where: { id } })
    return NextResponse.json({ deleted: true })
  } catch (error) {
    return NextResponse.json({ error: 'ลบโปรเจคไม่สำเร็จ', detail: (error as Error).message }, { status: 500 })
  }
}