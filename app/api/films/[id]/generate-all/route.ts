import { NextRequest, NextResponse } from 'next/server'

import { DbError } from '@/lib/db/errors'
import { generateAll } from '@/lib/db/jobs'
import { errorResponse } from '@/lib/db/route'
import { getRequestUser } from '@/lib/request-user'

type Context = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, ctx: Context) {
  try {
    const { id } = await ctx.params
    const user = await getRequestUser(request)
    const text = await request.text()
    const body = text.trim() ? JSON.parse(text) as unknown : {}
    const result = await generateAll(user, id, body)
    return NextResponse.json({ job_ids: result.job_ids }, { status: result.httpStatus })
  } catch (error) {
    if (error instanceof SyntaxError) {
      return errorResponse(new DbError('invalid JSON body', 400))
    }
    return errorResponse(error)
  }
}
