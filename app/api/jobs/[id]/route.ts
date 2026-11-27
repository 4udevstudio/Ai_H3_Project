import { NextRequest, NextResponse } from 'next/server'

import { getJob } from '@/lib/db/jobs'
import { errorResponse } from '@/lib/db/route'
import { getRequestUser } from '@/lib/request-user'

type Context = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, ctx: Context) {
  try {
    const { id } = await ctx.params
    const user = await getRequestUser(request)
    return NextResponse.json(await getJob(user, id))
  } catch (error) {
    return errorResponse(error)
  }
}
