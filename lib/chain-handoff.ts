/**
 * ========================================
 * Chain Handoff
 * ========================================
 * ส่งข้อมูล "ต่อคลิป" จาก Media / Frames ไปหน้า Studio ผ่าน sessionStorage
 */

export interface ChainHandoff {
  /** prompt เดิมของคลิปต้นทาง (ว่างได้ถ้าหาไม่เจอ) */
  prompt: string
  /** ชื่อไฟล์ที่อัปโหลดเข้า ComfyUI input แล้ว */
  referenceName: string
  /** path รูปเฟรมสำหรับ preview เช่น frames/xxx_last.jpg */
  framePath: string
  /** ป้ายบอกที่มาสั้น ๆ */
  sourceLabel?: string
}

const KEY = 'h3-chain-handoff'

export function setChainHandoff(data: ChainHandoff): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(data))
  } catch {
    // storage ใช้ไม่ได้ thìข้าม
  }
}

export function takeChainHandoff(): ChainHandoff | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null

    sessionStorage.removeItem(KEY)

    const data = JSON.parse(raw) as ChainHandoff
    if (!data.referenceName || !data.framePath) return null

    return {
      prompt: data.prompt ?? '',
      referenceName: data.referenceName,
      framePath: data.framePath,
      sourceLabel: data.sourceLabel,
    }
  } catch {
    return null
  }
}