import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, readJson } from '@/lib/db/route'
import { createScript, listScripts } from '@/lib/db/scripts'

type Context = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, ctx: Context) {
  try {
    const { id } = await ctx.params
    return NextResponse.json(await listScripts(id))
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: NextRequest, ctx: Context) {
  try {
    const { id } = await ctx.params
    const result = await createScript(id, await readJson(request))
    return NextResponse.json(
      { script: result.script, scenes: result.scenes, error: result.error },
      { status: result.httpStatus }
    )
  } catch (error) {
    return errorResponse(error)
  }
}
