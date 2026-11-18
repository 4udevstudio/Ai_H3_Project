import * as React from 'react'
import { MediaGallery } from '@/components/media/media-gallery'

/**
 * ========================================
 * Media Page
 * ========================================
 * แสดงคลังมีเดีย (วิดีโอที่สร้างสำเร็จ)
 * 
 * Note: MediaGallery ใช้ useSearchParams() สำหรับ pick mode (?pickFor=xxx)
 * ต้อง wrap ด้วย Suspense เพื่อให้ prerender ได้
 */

function MediaGalleryFallback() {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center gap-3 text-muted-foreground">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      <p className="text-sm">กำลังโหลดคลังมีเดีย...</p>
    </div>
  )
}

export default function MediaPage() {
  return (
    <div className="p-4 md:p-6">
      <React.Suspense fallback={<MediaGalleryFallback />}>
        <MediaGallery />
      </React.Suspense>
    </div>
  )
}