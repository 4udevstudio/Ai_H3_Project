import { NextRequest, NextResponse } from 'next/server'

import { addSceneImage, addUploadedSceneImage, deleteSceneImage } from '@/lib/db/images'
import { DbError } from '@/lib/db/errors'
import { errorResponse, readJson } from '@/lib/db/route'
import { isRecord } from '@/lib/db/parse'
import { getRequestUser } from '@/lib/request-user'

type Context = { params: Promise<{ id: string; sceneId: string }> }

export async function POST(request: NextRequest, ctx: Context) {
  try {
    const { id, sceneId } = await ctx.params
    const user = await getRequestUser(request)
    const contentType = request.headers.get('content-type') ?? ''
    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData()
      const file = form.get('file')
      if (!(file instanceof File)) {
        return NextResponse.json({ error: 'file is required' }, { status: 400 })
      }
      const role = form.get('role')
      const order = form.get('order')
      const image = await addUploadedSceneImage(
        user,
        id,
        sceneId,
        file,
        typeof role === 'string' ? role : null,
        typeof order === 'string' ? order : null
      )
      return NextResponse.json(image, { status: 201 })
    }
    const image = await addSceneImage(user, id, sceneId, await readJson(request))
    return NextResponse.json(image, { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function DELETE(request: NextRequest, ctx: Context) {
  try {
    const { id, sceneId } = await ctx.params
    const user = await getRequestUser(request)
    const url = new URL(request.url)
    let imageId = url.searchParams.get('image_id') ?? url.searchParams.get('id')

    if (!imageId) {
      const body = await request.json().catch(() => null)
      if (isRecord(body)) {
        const candidate = body.image_id ?? body.id
        if (typeof candidate === 'string') imageId = candidate
      }
    }

    if (!imageId?.trim()) throw new DbError('image_id is required', 400)
    return NextResponse.json(await deleteSceneImage(user, id, sceneId, imageId.trim()))
  } catch (error) {
    return errorResponse(error)
  }
}
