/**
 * ========================================
 * Project Detail Page
 * ========================================
 * Description:
 * หนแสดงรายละเอียดโปรเจค 1 โปรเจค พรอมรายชื่องานทั้งหมด
 * ใช้อยูภายใต้ route group (studio) จึงได Sidebar + TopBar อัตโนมัติ
 *
 * Next 16 note:
 * หนนี้ตอง await params (id จาก URL) ซึงเปนขอมูล per-request
 * Next จึงไมสามารถ prerender/lั่น instant navigation ใหได
 * ดังนันจึงตั้ง `instant = false` เพื่อยอมรับวาระดับนี้ render ต่อ request
 * (เนื้อจริงเปน client component ที่ fetch เองอยูแลว การ block จึง negligible)
 */

import { ProjectDetailView } from '@/components/projects/project-detail-view'

/**
 * ยอมรับให segment นี้ render per-request (ไมบังคับ instant navigation)
 * เพราะหนต้องอาศัย `params` จาก URL ในการตัดสินใจวาจะแสดงอะไร
 */
export const instant = false

/**
 * หน detail ของโปรเจคตาม id
 *
 * @param params.id id ของโปรเจคจาก URL
 */
export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  return (
    <div className="p-4 md:p-6">
      <ProjectDetailView projectId={id} />
    </div>
  )
}