import { NextRequest, NextResponse } from 'next/server'

import { createFilm, listFilms } from '@/lib/db/films'
import { errorResponse, readJson } from '@/lib/db/route'

export async function GET() {
  try {
    return NextResponse.json(await listFilms())
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: NextRequest) {
  try {
    const film = await createFilm(await readJson(request))
    return NextResponse.json(film, { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}
