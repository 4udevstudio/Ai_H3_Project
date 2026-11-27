/**
 * ========================================
 * แตกฉากจากสคริปต์
 * ========================================
 */

import { ScriptScreen } from '@/components/films/script-screen'

export const instant = false

export default async function ScriptToScenesPage({
  params,
}: {
  params: Promise<{ filmId: string }>
}) {
  const { filmId } = await params
  return <ScriptScreen filmId={filmId} />
}
