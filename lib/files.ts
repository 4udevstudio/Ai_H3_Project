/**
 * Browser URLs for files the compute service stored under outputs/.
 *
 * FastAPI serves them at /api/media/{videos|frames|films|audio|thumbnails}/<file>.
 * The database stores the outputs-relative path (videos/clip.mp4). The public
 * host is NEXT_PUBLIC_BACKEND_URL, then BACKEND_URL, then http://127.0.0.1:8000.
 */
const DEFAULT_PUBLIC_URL = 'http://127.0.0.1:8000'

const MEDIA_TYPES = new Set(['videos', 'thumbnails', 'frames', 'films', 'audio', 'references'])

export function publicBackendUrl(): string {
  const fromPublic = (process.env.NEXT_PUBLIC_BACKEND_URL ?? '').trim()
  if (fromPublic) return fromPublic.replace(/\/+$/, '')
  const fromBackend = (process.env.BACKEND_URL ?? '').trim()
  if (fromBackend) return fromBackend.replace(/\/+$/, '')
  return DEFAULT_PUBLIC_URL
}

function outputsRelative(value: string | null | undefined): string | null {
  if (!value) return null
  let text = value.trim()
  if (!text) return null

  if (/^https?:\/\//i.test(text)) {
    try {
      text = new URL(text).pathname
    } catch {
      return null
    }
  }

  text = text.replace(/\\/g, '/')
  const mediaAt = text.indexOf('/api/media/')
  if (mediaAt >= 0) {
    text = text.slice(mediaAt + '/api/media/'.length)
  } else {
    const outputsAt = text.toLowerCase().lastIndexOf('/outputs/')
    if (outputsAt >= 0) text = text.slice(outputsAt + '/outputs/'.length)
    else if (text.toLowerCase().startsWith('outputs/')) text = text.slice('outputs/'.length)
    else if (text.startsWith('/')) return null
  }

  const parts = text.replace(/^\/+/, '').split('/').filter(Boolean)
  if (parts.length < 2) return null
  if (parts.some((part) => part === '.' || part === '..')) return null
  if (!MEDIA_TYPES.has(parts[0])) return null
  return parts.join('/')
}

/**
 * Path to store in SQLite. Prefers an outputs-relative path from `filePath`,
 * then the same extracted from a backend `*_url`.
 */
export function storedOutputPath(filePath?: string | null, fileUrl?: string | null): string | null {
  return outputsRelative(filePath) ?? outputsRelative(fileUrl)
}

/** `${publicBackendUrl}/api/media/<type>/<filename>` for a stored outputs path. */
export function toPublicUrl(stored: string | null | undefined): string | null {
  const relative = outputsRelative(stored)
  if (!relative) {
    if (stored && /^https?:\/\//i.test(stored.trim())) return stored.trim()
    return null
  }

  const slash = relative.indexOf('/')
  const kind = relative.slice(0, slash)
  const filename = relative.slice(slash + 1).split('/').pop()
  if (!filename) return null
  return `${publicBackendUrl()}/api/media/${kind}/${encodeURIComponent(filename)}`
}
