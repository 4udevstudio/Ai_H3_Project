/**
 * ========================================
 * History Page
 * ========================================
 * Description:
 * หน้าแสดงประวัติการสร้างวิดีโอจาก Database
 * ใช้ HistoryView เป็นคอมโพเนนต์หลัก
 */

import { HistoryView } from '@/components/history/history-view'

export default function HistoryPage() {
  return (
    <div className="p-4 md:p-6">
      <HistoryView />
    </div>
  )
}