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

import { BACKEND_URL } from '@/lib/backend'

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
  try {
    // 1) ดึงข้อมูลจาก Prisma เพื่อหา path ของไฟล์
    const item = await prisma.generation.findUnique({ where: { id } })
    if (!item) {
      return NextResponse.json({ error: 'ไม่พบรายการ' }, { status: 404 })
    }

    const pathsToDelete: string[] = []
    if (item.videoPath) pathsToDelete.push(item.videoPath)
    if (item.thumbnailPath) pathsToDelete.push(item.thumbnailPath)

    // 2) ลบไฟล์จริงผ่าน backend (video + thumbnail)
    const errors: string[] = []
    for (const p of pathsToDelete) {
      try {
        const res = await fetch(`${BACKEND_URL}/api/media/delete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: p }),
          signal: AbortSignal.timeout(10000),
        })
        if (!res.ok) {
          const text = await res.text().catch(() => '')
          errors.push(`${p}: HTTP ${res.status} ${text}`)
        }
      } catch (err) {
        errors.push(`${p}: ${err instanceof Error ? err.message : 'network error'}`)
      }
    }

    // 3) ลบแถวใน Prisma (ทำต่อแม้ไฟล์บางส่วนหาลบไม่ได้)
    await prisma.generation.delete({ where: { id } })

    if (errors.length > 0) {
      return NextResponse.json(
        {
          id,
          deleted: true,
          warnings: errors,
          message: `ลบแถวสำเร็จ แต่ไฟล์บางส่วนลบไม่ได้: ${errors.join(' | ')}`,
        },
        { status: 200 }
      )
    }

    return NextResponse.json({ id, deleted: true })
  } catch (error) {
    return NextResponse.json(
      { error: 'ลบไม่สำเร็จ', detail: (error as Error).message },
      { status: 500 }
    )
  }
}