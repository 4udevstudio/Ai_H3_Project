import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, readJson } from '@/lib/db/route'
import { deleteScene, getScene, updateScene } from '@/lib/db/scenes'

type Context = { params: Promise<{ id: string; sceneId: string }> }

export async function GET(_request: NextRequest, ctx: Context) {
  try {
    const { id, sceneId } = await ctx.params
    return NextResponse.json(await getScene(id, sceneId))
  } catch (error) {
    return errorResponse(error)
  }
}

export async function PATCH(request: NextRequest, ctx: Context) {
  try {
    const { id, sceneId } = await ctx.params
    return NextResponse.json(await updateScene(id, sceneId, await readJson(request)))
  } catch (error) {
    return errorResponse(error)
  }
}

export async function DELETE(_request: NextRequest, ctx: Context) {
  try {
    const { id, sceneId } = await ctx.params
    return NextResponse.json(await deleteScene(id, sceneId))
  } catch (error) {
    return errorResponse(error)
  }
}
