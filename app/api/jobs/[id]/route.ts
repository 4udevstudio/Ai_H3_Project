import { NextRequest, NextResponse } from 'next/server'

import { getJob } from '@/lib/db/jobs'
import { errorResponse } from '@/lib/db/route'

type Context = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, ctx: Context) {
  try {
    const { id } = await ctx.params
    return NextResponse.json(await getJob(id))
  } catch (error) {
    return errorResponse(error)
  }
}
