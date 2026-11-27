import { NextRequest, NextResponse } from 'next/server'

import { DbError } from './errors'

export async function readJson(request: NextRequest): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    throw new DbError('invalid JSON body', 400)
  }
}

export function errorResponse(error: unknown): NextResponse {
  if (error instanceof DbError) {
    return NextResponse.json(
      {
        error: error.message,
        ...(error.detail ? { detail: error.detail } : {}),
      },
      { status: error.status }
    )
  }

  return NextResponse.json(
    {
      error: 'unexpected error',
      detail: error instanceof Error ? error.message : 'Unknown error',
    },
    { status: 500 }
  )
}
