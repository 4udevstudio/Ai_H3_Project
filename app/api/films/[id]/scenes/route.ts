import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, readJson } from '@/lib/db/route'
import { createScene, listScenes } from '@/lib/db/scenes'

type Context = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, ctx: Context) {
  try {
    const { id } = await ctx.params
    return NextResponse.json(await listScenes(id))
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: NextRequest, ctx: Context) {
  try {
    const { id } = await ctx.params
    const scene = await createScene(id, await readJson(request))
    return NextResponse.json(scene, { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}
