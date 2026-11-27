import { NextRequest, NextResponse } from 'next/server'

import { generateScene } from '@/lib/db/jobs'
import { errorResponse } from '@/lib/db/route'
import { getRequestUser } from '@/lib/request-user'

type Context = { params: Promise<{ id: string; sceneId: string }> }

export async function POST(request: NextRequest, ctx: Context) {
  try {
    const { id, sceneId } = await ctx.params
    const user = await getRequestUser(request)
    const result = await generateScene(user, id, sceneId)
    return NextResponse.json(result.job, { status: result.httpStatus })
  } catch (error) {
    return errorResponse(error)
  }
}
