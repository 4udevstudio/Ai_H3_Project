import { NextRequest, NextResponse } from 'next/server'

import { listFilmJobs } from '@/lib/db/jobs'
import { errorResponse } from '@/lib/db/route'
import { getRequestUser } from '@/lib/request-user'

type Context = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, ctx: Context) {
  try {
    const { id } = await ctx.params
    const user = await getRequestUser(request)
    const jobs = await listFilmJobs(user, id)
    return NextResponse.json({ jobs })
  } catch (error) {
    return errorResponse(error)
  }
}
