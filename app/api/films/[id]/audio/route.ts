import { NextRequest, NextResponse } from 'next/server'

import { uploadFilmAudio } from '@/lib/db/films'
import { DbError } from '@/lib/db/errors'
import { errorResponse } from '@/lib/db/route'

type Context = { params: Promise<{ id: string }> }

/**
 * POST /api/films/[id]/audio
 * multipart field `file` → FastAPI POST /jobs/upload-audio → Project.audioPath
 */
export async function POST(request: NextRequest, ctx: Context) {
  try {
    const { id } = await ctx.params
    let form: FormData
    try {
      form = await request.formData()
    } catch {
      throw new DbError('expected multipart form data', 400)
    }

    const file = form.get('file')
    if (!(file instanceof File)) throw new DbError('file is required', 400)

    const film = await uploadFilmAudio(id, file)
    return NextResponse.json(film)
  } catch (error) {
    return errorResponse(error)
  }
}
