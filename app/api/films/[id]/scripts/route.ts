import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, readJson } from '@/lib/db/route'
import { createScript, listScripts } from '@/lib/db/scripts'
import { getRequestUser } from '@/lib/request-user'

type Context = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, ctx: Context) {
  try {
    const { id } = await ctx.params
    const user = await getRequestUser(request)
    return NextResponse.json(await listScripts(user, id))
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: NextRequest, ctx: Context) {
  try {
    const { id } = await ctx.params
    const user = await getRequestUser(request)
    const result = await createScript(user, id, await readJson(request))
    return NextResponse.json(
      { script: result.script, scenes: result.scenes, error: result.error },
      { status: result.httpStatus }
    )
  } catch (error) {
    return errorResponse(error)
  }
}
