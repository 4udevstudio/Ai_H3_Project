/**
 * Copy an existing SQLite database into the Postgres schema Prisma owns.
 *
 * Works for a database created from main (Project, Generation, Reference,
 * Asset, AIPromptEnhancement, Setting, PromptTemplate, LLMPromptTemplate)
 * and for one that already has the film tables. Missing columns keep the
 * Postgres defaults. JSON columns stay text.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... npx tsx scripts/migrate-sqlite-to-postgres.ts [path/to/dev.db]
 *
 * Do not point pgloader at this database to create tables. Prisma migrate
 * deploy must run first so the Postgres tables already exist.
 */
import 'dotenv/config'

import { DatabaseSync } from 'node:sqlite'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const DATE_FIELDS = new Set([
  'createdAt',
  'updatedAt',
  'completedAt',
  'expiresAt',
  'lastSeenAt',
  'lastLoginAt',
])
const BOOL_FIELDS = new Set([
  'useAIEnhancement',
  'gguf',
  'chainFromPrevious',
  'isFavorite',
  'isDefault',
  'isActive',
  'disabled',
])
const INT_FIELDS = new Set([
  'seed',
  'steps',
  'size',
  'order',
  'progress',
  'width',
  'height',
  'fps',
  'tokensUsed',
  'usageCount',
])
const FLOAT_FIELDS = new Set([
  'duration',
  'durationSec',
  'generationTime',
  'vramUsed',
  'responseTime',
  'transitionDuration',
  'audioVolume',
])

type Row = Record<string, unknown>

function tableExists(db: DatabaseSync, name: string): boolean {
  const row = db
    .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name) as { ok: number } | undefined
  return Boolean(row)
}

function readRows(db: DatabaseSync, name: string): Row[] {
  if (!tableExists(db, name)) return []
  return db.prepare(`SELECT * FROM "${name}"`).all() as Row[]
}

function asDate(value: unknown, field: string): Date | null {
  if (value === null || value === undefined || value === '') return null
  if (value instanceof Date) return value
  if (typeof value === 'number') {
    const ms = value > 1_000_000_000_000 ? value : value * 1000
    const date = new Date(ms)
    if (Number.isNaN(date.getTime())) throw new Error(`bad date ${field}`)
    return date
  }
  const date = new Date(String(value))
  if (Number.isNaN(date.getTime())) throw new Error(`bad date ${field}: ${String(value)}`)
  return date
}

function asBool(value: unknown): boolean | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  const text = String(value).trim().toLowerCase()
  if (text === 'true' || text === '1') return true
  if (text === 'false' || text === '0' || text === '') return false
  return Boolean(value)
}

function asInt(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return null
  return Math.trunc(n)
}

function asFloat(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

function normalize(row: Row): Row {
  const out: Row = {}
  for (const [key, value] of Object.entries(row)) {
    if (DATE_FIELDS.has(key)) out[key] = asDate(value, key)
    else if (BOOL_FIELDS.has(key)) out[key] = asBool(value)
    else if (INT_FIELDS.has(key)) out[key] = asInt(value)
    else if (FLOAT_FIELDS.has(key)) out[key] = asFloat(value)
    else if (key === 'email' && typeof value === 'string') out[key] = value.trim().toLowerCase()
    else out[key] = value
  }
  return out
}

async function upsert(table: string, row: Row) {
  const data = normalize(row) as never
  const id = String(row.id ?? '')
  switch (table) {
    case 'Setting':
      await prisma.setting.upsert({ where: { key: String(row.key) }, create: data, update: data })
      return
    case 'User':
      await prisma.user.upsert({ where: { id }, create: data, update: data })
      return
    case 'Session':
      await prisma.session.upsert({ where: { id }, create: data, update: data })
      return
    case 'Project':
      await prisma.project.upsert({ where: { id }, create: data, update: data })
      return
    case 'Script':
      await prisma.script.upsert({ where: { id }, create: data, update: data })
      return
    case 'Scene':
      await prisma.scene.upsert({ where: { id }, create: data, update: data })
      return
    case 'Generation':
      await prisma.generation.upsert({ where: { id }, create: data, update: data })
      return
    case 'Reference':
      await prisma.reference.upsert({ where: { id }, create: data, update: data })
      return
    case 'Asset':
      await prisma.asset.upsert({ where: { id }, create: data, update: data })
      return
    case 'AIPromptEnhancement':
      await prisma.aIPromptEnhancement.upsert({ where: { id }, create: data, update: data })
      return
    case 'PromptTemplate':
      await prisma.promptTemplate.upsert({ where: { id }, create: data, update: data })
      return
    case 'LLMPromptTemplate':
      await prisma.lLMPromptTemplate.upsert({ where: { id }, create: data, update: data })
      return
    case 'FinalRender':
      await prisma.finalRender.upsert({ where: { id }, create: data, update: data })
      return
    case 'FinalRenderClip':
      await prisma.finalRenderClip.upsert({ where: { id }, create: data, update: data })
      return
    case 'Job':
      await prisma.job.upsert({ where: { id }, create: data, update: data })
      return
    default:
      throw new Error(`unknown table ${table}`)
  }
}

async function copyTable(db: DatabaseSync, table: string, drop: string[] = []) {
  const rows = readRows(db, table)
  let count = 0
  for (const row of rows) {
    const copy = { ...row }
    for (const field of drop) delete copy[field]
    await upsert(table, copy)
    count += 1
  }
  console.log(`${table}: ${count}`)
  return rows
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL ?? ''
  if (!databaseUrl.startsWith('postgres')) {
    throw new Error('DATABASE_URL must be a postgresql:// URL. Run prisma migrate deploy first.')
  }

  const sqlitePath = process.argv[2] || process.env.SQLITE_PATH || 'prisma/dev.db'
  const db = new DatabaseSync(sqlitePath, { readOnly: true })

  await copyTable(db, 'User')
  await copyTable(db, 'Session')
  await copyTable(db, 'Project')
  await copyTable(db, 'Asset')
  await copyTable(db, 'Script')
  const scenes = await copyTable(db, 'Scene', ['currentGenerationId'])
  await copyTable(db, 'Generation')

  for (const scene of scenes) {
    const currentId = scene.currentGenerationId
    if (typeof currentId !== 'string' || !currentId) continue
    const generation = await prisma.generation.findUnique({ where: { id: currentId } })
    if (!generation) {
      console.log(`Scene ${String(scene.id)}: skipped missing currentGenerationId ${currentId}`)
      continue
    }
    await prisma.scene.update({
      where: { id: String(scene.id) },
      data: { currentGenerationId: currentId },
    })
  }

  await copyTable(db, 'Reference')
  await copyTable(db, 'AIPromptEnhancement')
  await copyTable(db, 'Setting')
  await copyTable(db, 'PromptTemplate')
  await copyTable(db, 'LLMPromptTemplate')
  await copyTable(db, 'FinalRender')
  await copyTable(db, 'Job')
  await copyTable(db, 'FinalRenderClip')

  db.close()
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (error) => {
    console.error(error)
    await prisma.$disconnect()
    process.exit(1)
  })
