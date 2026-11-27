import { NextRequest, NextResponse } from 'next/server'

import { createRender, listRenders } from '@/lib/db/renders'
import { errorResponse } from '@/lib/db/route'

type Context = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, ctx: Context) {
  try {
    const { id } = await ctx.params
    return NextResponse.json(await listRenders(id))
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(_request: NextRequest, ctx: Context) {
  try {
    const { id } = await ctx.params
    const result = await createRender(id)
    return NextResponse.json(
      { render: result.render, job: result.job },
      { status: result.httpStatus }
    )
  } catch (error) {
    return errorResponse(error)
  }
}
