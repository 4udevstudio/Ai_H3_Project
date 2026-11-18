/**
 * ========================================
 * Theme Configuration
 * ========================================
 * Description:
 * ศูนย์กลางข้อมูลธีมทั้ง 5 ของแอป
 * ใช้โดย ThemeSwitcher เพื่อแสดงรายการธีม
 * และใช้โดย ThemeProvider เพื่อซิงค์ dark class
 */
import type { ThemeName } from '@/types'

/** โครงสร้างข้อมูลของธีมแต่ละตัว */
export interface ThemeInfo {
  id: ThemeName
  label: string
  description: string
  icon: string
  mode: 'dark' | 'light'
  preview: string // CSS gradient สำหรับแสดงตัวอย่างสีใน dropdown
}

/** รายชื่อธีมทั้ง 5 พร้อมข้อมูลแสดงผล */
export const THEMES: ThemeInfo[] = [
  {
    id: 'midnight',
    label: 'Midnight Studio',
    description: 'กรมท่าเข้ม + ทอง ดูมืออาชีพ',
    icon: '🌙',
    mode: 'dark',
    preview: 'linear-gradient(135deg, #0b1120 0%, #d4a017 100%)',
  },
  {
    id: 'arctic',
    label: 'Arctic Light',
    description: 'ขาวสะอาด + ฟ้าเทา โฟกัสงาน',
    icon: '❄️',
    mode: 'light',
    preview: 'linear-gradient(135deg, #ffffff 0%, #64748b 100%)',
  },
  {
    id: 'cyberpunk',
    label: 'Cyberpunk Neon',
    description: 'มืด + นีออนชมพู/cyan จัดจ้าน',
    icon: '⚡',
    mode: 'dark',
    preview: 'linear-gradient(135deg, #12081f 0%, #ff2ec4 50%, #00e5ff 100%)',
  },
  {
    id: 'sunset',
    label: 'Sunset Creative',
    description: 'ครีม + ส้มอบอุ่น สร้างสรรค์',
    icon: '🌅',
    mode: 'light',
    preview: 'linear-gradient(135deg, #fff8ef 0%, #f97316 100%)',
  },
  {
    id: 'forest',
    label: 'Forest Zen',
    description: 'เขียวเซจ + โทนดิน สงบสบายตา',
    icon: '🌲',
    mode: 'light',
    preview: 'linear-gradient(135deg, #f2f7f2 0%, #3d8b5f 100%)',
  },
]

/** ธีมเริ่มต้นเมื่อเปิดแอปครั้งแรก */
export const DEFAULT_THEME: ThemeName = 'midnight'

/**
 * ค้นหาข้อมูลธีมจาก id
 * @param id ชื่อธีมที่ต้องการค้นหา
 * @returns ข้อมูลธีม หรือ undefined ถ้าไม่พบ
 */
export function getThemeInfo(id: string | undefined): ThemeInfo | undefined {
  return THEMES.find((t) => t.id === id)
}