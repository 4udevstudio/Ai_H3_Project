/**
 * ========================================
 * โหมดคิวเดิม (4 ฉากคงที่)
 * ========================================
 * พฤติกรรมเดิมที่ส่งงานเข้า FastAPI โดยตรงผ่าน lib/backend.ts
 */

import { ShortFilmStudio } from '@/components/shortfilm/short-film-studio'

export default function ClassicShortFilmPage() {
  return <ShortFilmStudio />
}
