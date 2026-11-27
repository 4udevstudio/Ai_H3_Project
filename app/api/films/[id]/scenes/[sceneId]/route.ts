import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, readJson } from '@/lib/db/route'
import { deleteScene, getScene, updateScene } from '@/lib/db/scenes'
import { getRequestUser } from '@/lib/request-user'

type Context = { params: Promise<{ id: string; sceneId: string }> }

export async function GET(request: NextRequest, ctx: Context) {
  try {
    const { id, sceneId } = await ctx.params
    const user = await getRequestUser(request)
    return NextResponse.json(await getScene(user, id, sceneId))
  } catch (error) {
    return errorResponse(error)
  }
}

export async function PATCH(request: NextRequest, ctx: Context) {
  try {
    const { id, sceneId } = await ctx.params
    const user = await getRequestUser(request)
    return NextResponse.json(await updateScene(user, id, sceneId, await readJson(request)))
  } catch (error) {
    return errorResponse(error)
  }
}

export async function DELETE(request: NextRequest, ctx: Context) {
  try {
    const { id, sceneId } = await ctx.params
    const user = await getRequestUser(request)
    return NextResponse.json(await deleteScene(user, id, sceneId))
  } catch (error) {
    return errorResponse(error)
  }
}
