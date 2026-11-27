/**
 * ========================================
 * รวมคลิปและส่งออก
 * ========================================
 */

import { AssemblyScreen } from '@/components/films/assembly-screen'

export const instant = false

export default async function AssemblyPage({
  params,
}: {
  params: Promise<{ filmId: string }>
}) {
  const { filmId } = await params
  return <AssemblyScreen filmId={filmId} />
}