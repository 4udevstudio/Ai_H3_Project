/**
 * ========================================
 * PagePlaceholder
 * ========================================
 * Description:
 * คอมโพเนนต์ชั่วคราวสำหรับหน้าที่ยังไม่พัฒนา
 * แสดงการ์ดกลางจอพร้อมไอคอน + ชื่อหน้า + คำอธิบาย
 */
import { Construction } from 'lucide-react'

interface PagePlaceholderProps {
  title: string
  description: string
}

export function PagePlaceholder({
  title,
  description,
}: PagePlaceholderProps) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="flex max-w-md flex-col items-center gap-4 rounded-2xl border border-border bg-card p-10 text-center shadow-lg">
        <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Construction className="h-7 w-7" />
        </div>
        <h2 className="text-xl font-bold">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  )
}