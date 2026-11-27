import { NextRequest, NextResponse } from 'next/server'

import { generateScene } from '@/lib/db/jobs'
import { errorResponse } from '@/lib/db/route'

type Context = { params: Promise<{ id: string; sceneId: string }> }

export async function POST(_request: NextRequest, ctx: Context) {
  try {
    const { id, sceneId } = await ctx.params
    const result = await generateScene(id, sceneId)
    return NextResponse.json(result.job, { status: result.httpStatus })
  } catch (error) {
    return errorResponse(error)
  }
}
