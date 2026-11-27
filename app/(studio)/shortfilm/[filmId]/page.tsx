/**
 * ========================================
 * ตัวแก้ไขฉากของเรื่อง
 * ========================================
 */

import { FilmEditor } from '@/components/films/film-editor'

export const instant = false

export default async function FilmEditorPage({
  params,
}: {
  params: Promise<{ filmId: string }>
}) {
  const { filmId } = await params
  return <FilmEditor filmId={filmId} />
}
