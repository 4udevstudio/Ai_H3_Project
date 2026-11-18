/**
 * ========================================
 * Projects Page
 * ========================================
 * Description:
 * หน้าจัดการโปรเจคเบื้องต้น
 * ใช้ ProjectsView เป็นคอมโพเนนต์หลัก
 */

import { ProjectsView } from '@/components/projects/projects-view'

export default function ProjectsPage() {
  return (
    <div className="p-4 md:p-6">
      <ProjectsView />
    </div>
  )
}