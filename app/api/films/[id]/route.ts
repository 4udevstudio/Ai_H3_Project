import { NextRequest, NextResponse } from 'next/server'

import { deleteFilm, getFilm, updateFilm } from '@/lib/db/films'
import { errorResponse, readJson } from '@/lib/db/route'

type Context = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, ctx: Context) {
  try {
    const { id } = await ctx.params
    return NextResponse.json(await getFilm(id))
  } catch (error) {
    return errorResponse(error)
  }
}

export async function PATCH(request: NextRequest, ctx: Context) {
  try {
    const { id } = await ctx.params
    return NextResponse.json(await updateFilm(id, await readJson(request)))
  } catch (error) {
    return errorResponse(error)
  }
}

export async function DELETE(_request: NextRequest, ctx: Context) {
  try {
    const { id } = await ctx.params
    return NextResponse.json(await deleteFilm(id))
  } catch (error) {
    return errorResponse(error)
  }
}
