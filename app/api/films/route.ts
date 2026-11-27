import { NextRequest, NextResponse } from 'next/server'

import { createFilm, listFilms } from '@/lib/db/films'
import { errorResponse, readJson } from '@/lib/db/route'
import { getRequestUser } from '@/lib/request-user'

export async function GET(request: NextRequest) {
  try {
    const user = await getRequestUser(request)
    return NextResponse.json(await listFilms(user))
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getRequestUser(request)
    const film = await createFilm(user, await readJson(request))
    return NextResponse.json(film, { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}
