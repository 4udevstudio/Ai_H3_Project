import { LIMITS } from './constants'
import { DbError } from './errors'

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new DbError('JSON body must be an object', 400)
  return value
}

export function readString(
  body: Record<string, unknown>,
  key: string,
  max: number,
  required: boolean
): string | null | undefined {
  if (!(key in body)) {
    if (required) throw new DbError(`${key} is required`, 400)
    return undefined
  }

  const value = body[key]
  if (value === null) {
    if (required) throw new DbError(`${key} is required`, 400)
    return null
  }
  if (typeof value !== 'string') throw new DbError(`${key} must be a string`, 400)

  const trimmed = value.trim()
  if (!trimmed) {
    if (required) throw new DbError(`${key} is required`, 400)
    return null
  }
  return trimmed.slice(0, max)
}

export function readNumber(
  body: Record<string, unknown>,
  key: string,
  opts: { min: number; max: number; integer?: boolean; required?: boolean }
): number | null | undefined {
  if (!(key in body)) {
    if (opts.required) throw new DbError(`${key} is required`, 400)
    return undefined
  }

  const value = body[key]
  if (value === null) {
    if (opts.required) throw new DbError(`${key} is required`, 400)
    return null
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new DbError(`${key} must be a number`, 400)
  }
  if (opts.integer && !Number.isInteger(value)) {
    throw new DbError(`${key} must be an integer`, 400)
  }
  if (value < opts.min || value > opts.max) {
    throw new DbError(`${key} must be between ${opts.min} and ${opts.max}`, 400)
  }
  return value
}

export function readBoolean(body: Record<string, unknown>, key: string): boolean | undefined {
  if (!(key in body) || body[key] === undefined) return undefined
  if (typeof body[key] !== 'boolean') throw new DbError(`${key} must be a boolean`, 400)
  return body[key] as boolean
}

export function readPrompt(body: Record<string, unknown>, required: boolean): string | null | undefined {
  return readString(body, 'prompt', LIMITS.prompt, required)
}
