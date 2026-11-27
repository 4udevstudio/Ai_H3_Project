import { DbError } from './errors'

export const MODES = ['T2V', 'REF2VA', 'FL2VA'] as const
export const TRANSITIONS = ['NONE', 'CROSSFADE'] as const
export const IMAGE_ROLES = ['REF', 'FIRST', 'LAST'] as const
export const REFERENCE_TYPES = ['IMAGE', 'VIDEO', 'AUDIO'] as const

export type VideoMode = (typeof MODES)[number]
export type TransitionType = (typeof TRANSITIONS)[number]
export type ImageRole = (typeof IMAGE_ROLES)[number]

const MODE_SET = new Set<string>(MODES)
const TRANSITION_SET = new Set<string>(TRANSITIONS)
const ROLE_SET = new Set<string>(IMAGE_ROLES)

/**
 * `mode` stays UPPERCASE in JSON. Every other enum is lowercase on the wire
 * and UPPERCASE in SQLite.
 */
export function parseMode(value: unknown, fallback: VideoMode = 'T2V'): VideoMode {
  if (value === undefined || value === null || value === '') return fallback
  if (typeof value !== 'string') throw new DbError('mode must be T2V, REF2VA, or FL2VA', 400)
  const upper = value.trim().toUpperCase()
  if (!MODE_SET.has(upper)) throw new DbError('mode must be T2V, REF2VA, or FL2VA', 400)
  return upper as VideoMode
}

export function parseTransition(value: unknown, fallback: TransitionType = 'NONE'): TransitionType {
  if (value === undefined || value === null || value === '') return fallback
  if (typeof value !== 'string') {
    throw new DbError('transition must be none or crossfade', 400)
  }
  const upper = value.trim().toUpperCase()
  if (!TRANSITION_SET.has(upper)) throw new DbError('transition must be none or crossfade', 400)
  return upper as TransitionType
}

export function parseRole(value: unknown, fallback: ImageRole = 'REF'): ImageRole {
  if (value === undefined || value === null || value === '') return fallback
  if (typeof value !== 'string') throw new DbError('role must be ref, first, or last', 400)
  const upper = value.trim().toUpperCase()
  if (!ROLE_SET.has(upper)) throw new DbError('role must be ref, first, or last', 400)
  return upper as ImageRole
}

export function parseReferenceType(value: unknown, fallback = 'IMAGE'): string {
  if (value === undefined || value === null || value === '') return fallback
  if (typeof value !== 'string') throw new DbError('type must be IMAGE, VIDEO, or AUDIO', 400)
  const upper = value.trim().toUpperCase()
  if (!REFERENCE_TYPES.includes(upper as (typeof REFERENCE_TYPES)[number])) {
    throw new DbError('type must be IMAGE, VIDEO, or AUDIO', 400)
  }
  return upper
}

export function toJsonToken(value: string | null | undefined, fallback: string): string {
  const raw = (value ?? fallback).trim()
  return (raw || fallback).toLowerCase()
}

export function modeToGenerationType(mode: string): string {
  if (mode === 'REF2VA') return 'REF2VID'
  if (mode === 'FL2VA') return 'FL2VA'
  return 'TEXT2VID'
}

export function modeToTaskAdapter(mode: string): string | null {
  if (mode === 'FL2VA') return 'fl2va'
  if (mode === 'REF2VA') return 'ref2va'
  return null
}

/** Scene/job status → the Generation status vocabulary the history UI already uses. */
export function generationStatusFor(jobStatus: string): string {
  if (jobStatus === 'RUNNING') return 'RUNNING'
  if (jobStatus === 'DONE') return 'DONE'
  if (jobStatus === 'FAILED') return 'FAILED'
  return 'PENDING'
}

export function renderStatusFor(jobStatus: string): string {
  if (jobStatus === 'RUNNING') return 'RUNNING'
  if (jobStatus === 'DONE') return 'DONE'
  if (jobStatus === 'FAILED') return 'FAILED'
  return 'PENDING'
}

export function mapRemoteJobStatus(value: unknown): 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED' {
  const status = String(value ?? '').trim().toLowerCase()
  if (status === 'queued' || status === 'pending') return 'QUEUED'
  if (status === 'running') return 'RUNNING'
  if (status === 'done' || status === 'completed' || status === 'success') return 'DONE'
  if (status === 'failed' || status === 'error' || status === 'cancelled' || status === 'canceled') {
    return 'FAILED'
  }
  return 'RUNNING'
}

/** Backend progress is an integer 0–100. */
export function clampProgress(value: unknown, fallback = 0): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.min(100, Math.max(0, Math.round(numeric)))
}
