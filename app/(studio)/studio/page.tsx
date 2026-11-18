/**
 * ========================================
 * Studio Page
 * ========================================
 * หน้าสร้างวิดีโอ + คิวงาน (ย้ายจาก '/' มาเป็น '/studio')
 */

import { GenerationForm } from '@/components/studio/generation-form'

export default function StudioPage() {
  return (
    <div className="p-4 md:p-6">
      <GenerationForm />
    </div>
  )
}