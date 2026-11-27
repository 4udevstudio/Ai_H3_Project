import { NextRequest, NextResponse } from 'next/server'

import { addSceneImage, deleteSceneImage } from '@/lib/db/images'
import { DbError } from '@/lib/db/errors'
import { errorResponse, readJson } from '@/lib/db/route'
import { isRecord } from '@/lib/db/parse'

type Context = { params: Promise<{ id: string; sceneId: string }> }

export async function POST(request: NextRequest, ctx: Context) {
  try {
    const { id, sceneId } = await ctx.params
    const image = await addSceneImage(id, sceneId, await readJson(request))
    return NextResponse.json(image, { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function DELETE(request: NextRequest, ctx: Context) {
  try {
    const { id, sceneId } = await ctx.params
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
    return NextResponse.json(await deleteSceneImage(id, sceneId, imageId.trim()))
  } catch (error) {
    return errorResponse(error)
  }
}
