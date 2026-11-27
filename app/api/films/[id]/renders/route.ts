import { NextRequest, NextResponse } from 'next/server'

import { createRender, listRenders } from '@/lib/db/renders'
import { errorResponse } from '@/lib/db/route'
import { getRequestUser } from '@/lib/request-user'

type Context = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, ctx: Context) {
  try {
    const { id } = await ctx.params
    const user = await getRequestUser(request)
    return NextResponse.json(await listRenders(user, id))
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: NextRequest, ctx: Context) {
  try {
    const { id } = await ctx.params
    const user = await getRequestUser(request)
    const result = await createRender(user, id)
    return NextResponse.json(
      { render: result.render, job: result.job },
      { status: result.httpStatus }
    )
  } catch (error) {
    return errorResponse(error)
  }
}
