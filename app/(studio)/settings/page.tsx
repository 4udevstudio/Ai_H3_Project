/**
 * ========================================
 * หน้า Settings
 * ========================================
 * ตั้งค่าการเชื่อมต่อ ComfyUI (Local / RunPod)
 * ส่วนตั้งค่าโมเดล/LLM อื่นๆ จะเพิ่มในขั้นถัดไป
 */
import { ConnectionSettings } from '@/components/settings/connection-settings'

export default function SettingsPage() {
  return (
    <div className="grid gap-6">
      <ConnectionSettings />
    </div>
  )
}