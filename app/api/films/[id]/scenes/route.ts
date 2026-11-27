import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, readJson } from '@/lib/db/route'
import { createScene, listScenes } from '@/lib/db/scenes'
import { getRequestUser } from '@/lib/request-user'

type Context = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, ctx: Context) {
  try {
    const { id } = await ctx.params
    const user = await getRequestUser(request)
    return NextResponse.json(await listScenes(user, id))
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: NextRequest, ctx: Context) {
  try {
    const { id } = await ctx.params
    const user = await getRequestUser(request)
    const scene = await createScene(user, id, await readJson(request))
    return NextResponse.json(scene, { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}
