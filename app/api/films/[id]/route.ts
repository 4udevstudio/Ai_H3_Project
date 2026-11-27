import { NextRequest, NextResponse } from 'next/server'

import { deleteFilm, getFilm, updateFilm } from '@/lib/db/films'
import { errorResponse, readJson } from '@/lib/db/route'
import { getRequestUser } from '@/lib/request-user'

type Context = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, ctx: Context) {
  try {
    const { id } = await ctx.params
    const user = await getRequestUser(request)
    return NextResponse.json(await getFilm(user, id))
  } catch (error) {
    return errorResponse(error)
  }
}

export async function PATCH(request: NextRequest, ctx: Context) {
  try {
    const { id } = await ctx.params
    const user = await getRequestUser(request)
    return NextResponse.json(await updateFilm(user, id, await readJson(request)))
  } catch (error) {
    return errorResponse(error)
  }
}

export async function DELETE(request: NextRequest, ctx: Context) {
  try {
    const { id } = await ctx.params
    const user = await getRequestUser(request)
    return NextResponse.json(await deleteFilm(user, id))
  } catch (error) {
    return errorResponse(error)
  }
}
