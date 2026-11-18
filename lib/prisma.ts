/**
 * ========================================
 * Prisma Client Singleton
 * ========================================
 * Description:
 * สร้าง Prisma Client instance เดียวสำหรับทั้งแอป
 * ป้องกันปัญหาการเชื่อมต่อซ้ำซ้อนระหว่าง Next.js development
 * (Next.js hot-reload บ่อย ถ้าไม่ใช้ singleton จะเกิด connection ค้าง)
 *
 * หลักการทำงาน:
 * - เก็บ Prisma Client ไว้ใน globalThis เพื่อให้คงอยู่ข้าม hot-reload
 * - ใน production จะสร้าง instance ใหม่เพียงครั้งเดียว
 */
import { PrismaClient } from '@prisma/client'

// Cast globalThis เพื่อให้เข้าถึงตัวแปร prisma ที่เก็บไว้
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

/**
 * Prisma Client หลักที่ใช้ทั้งแอป
 * ถ้ามี instance เดิมเก็บไว้ใน globalThen จะใช้ตัวเดิม
 */
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    // แสดง log เฉพาะ error และ warn (ไม่สแปม console)
    log: ['error', 'warn'],
  })

// ในโหมด development เก็บ instance ไว้ใน globalThis เพื่อใช้ซ้ำข้าม hot-reload
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma