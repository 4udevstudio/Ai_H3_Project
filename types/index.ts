/**
 * ========================================
 * Global TypeScript Types
 * ========================================
 * Description:
 * รวม types ทั้งหมดที่ใช้ในแอปไว้ในที่เดียว
 * เพื่อให้แก้ไขและอ้างอิงได้ง่ายในอนาคต
 */

// ========================================
// Generation Types (ชนิดของการ generate)
// ========================================

/** ชนิดของการ generate วิดีโอ */
export type GenType = 'TEXT2VID' | 'IMG2VID' | 'REF2VID' | 'FL2VA'

/** สถานะของการ generate */
export type GenStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'DONE'
  | 'FAILED'
  | 'CANCELLED'

/** ชนิดของไฟล์ reference */
export type RefType = 'IMAGE' | 'VIDEO' | 'AUDIO'

/** ชนิดของไฟล์ใน media library */
export type AssetType = 'IMAGE' | 'VIDEO' | 'AUDIO' | 'MODEL'

// ========================================
// Theme Types (ระบบธีม)
// ========================================

/** ชื่อธีมที่รองรับทั้ง 5 แบบ */
export type ThemeName =
  | 'midnight'
  | 'arctic'
  | 'cyberpunk'
  | 'sunset'
  | 'forest'

// ========================================
// Main Interfaces (โครงสร้างข้อมูลหลัก)
// ========================================

/** โครงสร้างข้อมูล Project */
export interface Project {
  id: string
  name: string
  description?: string | null
  theme: string
  createdAt: Date
  updatedAt: Date
}

/** โครงสร้างข้อมูล Generation */
export interface Generation {
  id: string
  projectId?: string | null
  type: GenType
  prompt: string
  negativePrompt?: string | null
  seed: number
  steps: number
  resolution: string
  taskAdapter?: string | null
  loraUsed?: string | null
  useAIEnhancement: boolean
  videoPath?: string | null
  audioPath?: string | null
  thumbnailPath?: string | null
  duration?: number | null
  status: GenStatus
  error?: string | null
  generationTime?: number | null
  vramUsed?: number | null
  createdAt: Date
  completedAt?: Date | null
}

/** โครงสร้างข้อมูล Reference file */
export interface ReferenceItem {
  id: string
  generationId: string
  type: RefType
  path: string
  order: number
  metadata?: string | null
}

/** โครงสร้างข้อมูล Asset ใน media library */
export interface Asset {
  id: string
  name: string
  path: string
  type: AssetType
  size: number
  metadata?: string | null
  createdAt: Date
}

/** โครงสร้างข้อมูลผลการ enhance prompt ด้วย AI */
export interface AIPromptEnhancement {
  id: string
  generationId?: string | null
  referenceImages: string
  basePrompt: string
  customPrompt?: string | null
  enhancedPrompt: string
  fullPrompt: string
  modelUsed: string
  tokensUsed?: number | null
  responseTime?: number | null
  createdAt: Date
}

/** โครงสร้างข้อมูล Prompt template */
export interface PromptTemplate {
  id: string
  name: string
  template: string
  category: string
  isFavorite: boolean
  usageCount: number
  createdAt: Date
  updatedAt: Date
}

// ========================================
// API Request/Response Types
// ========================================

/** ข้อมูลที่ส่งจาก frontend ไปยัง FastAPI backend เพื่อสั่ง generate */
export interface GenerationRequest {
  type: GenType
  prompt: string
  negativePrompt?: string
  seed?: number
  steps?: number
  resolution?: string
  taskAdapter?: string
  loraUsed?: string
  referencePaths?: string[]
  useAIEnhancement?: boolean
}

/** สถานะความคืบหน้าการ generate (ใช้แสดง progress bar) */
export interface GenerationProgress {
  generationId: string
  status: GenStatus
  progress: number // 0-100
  currentStep?: number
  totalSteps?: number
  message?: string
}