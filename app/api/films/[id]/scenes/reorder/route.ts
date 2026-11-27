import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, readJson } from '@/lib/db/route'
import { reorderScenes } from '@/lib/db/scenes'

type Context = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, ctx: Context) {
  try {
    const { id } = await ctx.params
    const scenes = await reorderScenes(id, await readJson(request))
    return NextResponse.json({ scenes })
  } catch (error) {
    return errorResponse(error)
  }
}
