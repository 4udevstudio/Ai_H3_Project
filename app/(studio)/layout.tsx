/**
 * ========================================
 * Studio Layout
 * ========================================
 * ครอบทุกหน้าใน Studio ด้วย StudioShell
 * ซึ่งจัดการ responsive sidebar/drawer + topbar + พื้นที่เนื้อหา
 */

import { StudioShell } from '@/components/layout/studio-shell'

export default function StudioLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <StudioShell>{children}</StudioShell>
}