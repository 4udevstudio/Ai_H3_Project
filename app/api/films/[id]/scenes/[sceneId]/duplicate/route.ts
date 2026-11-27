import { NextRequest, NextResponse } from 'next/server'

import { duplicateScene } from '@/lib/db/scenes'
import { errorResponse } from '@/lib/db/route'
import { getRequestUser } from '@/lib/request-user'

type Context = { params: Promise<{ id: string; sceneId: string }> }

export async function POST(request: NextRequest, ctx: Context) {
  try {
    const { id, sceneId } = await ctx.params
    const user = await getRequestUser(request)
    const scene = await duplicateScene(user, id, sceneId)
    return NextResponse.json(scene, { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}
