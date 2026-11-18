/**
 * ========================================
 * Root Page (= Dashboard)
 * ========================================
 * หน้าแรกเมื่อเปิด localhost:3000
 * แสดงภาพรวมระบบแทนที่จะเป็นฟอร์ม gen
 */

import { DashboardOverview } from '@/components/dashboard/dashboard-overview'

export default function RootPage() {
  return (
    <div className="p-4 md:p-6">
      <DashboardOverview />
    </div>
  )
}