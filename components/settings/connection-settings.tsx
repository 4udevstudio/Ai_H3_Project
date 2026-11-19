'use client'

/**
 * ========================================
 * ConnectionSettings
 * ========================================
 * เลือกโหมดการเชื่อมต่อ ComfyUI:
 * - Local  : ComfyUI ในเครื่อง (http://127.0.0.1:8188)
 * - RunPod : ใส่ Base URL เพียงช่องเดียว
 *
 * Note:
 * - ลบ Base URL แล้ว Save = ล้างจริง (ส่ง "" ไม่ใช่ undefined)
 * - ส่ง runpod_pod_id = "" ทุกครั้ง เพื่อล้างค่าเก่าที่จะฟื้น URL กลับมา
 */

import * as React from 'react'
import { AlertCircle, Cloud, Loader2, Monitor, PlugZap, Save, X } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { BACKEND_URL } from '@/lib/backend'
import { cn } from '@/lib/utils'

type Mode = 'local' | 'remote'

const LOCAL_URL = 'http://127.0.0.1:8188'

interface ConnectionSnapshot {
  mode: string
  is_remote: boolean
  base_url: string
  runpod_pod_id: string
  has_auth_token: boolean
  input_dir: string
}

interface TestResult {
  ok: boolean
  error?: string
  gpu?: { name?: string | null; vram_total_mb?: number | null }
}

export function ConnectionSettings() {
  const [mode, setMode] = React.useState<Mode>('local')
  const [baseUrl, setBaseUrl] = React.useState('')
  const [snapshot, setSnapshot] = React.useState<ConnectionSnapshot | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [testing, setTesting] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [testResult, setTestResult] = React.useState<TestResult | null>(null)

  const load = React.useCallback(async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/system/connection`, { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as ConnectionSnapshot

      setSnapshot(data)
      setMode(data.is_remote ? 'remote' : 'local')
      // โหลดเข้าช่องเฉพาะตอนเป็น remote — ไม่เอา URL ของ local มาใส่
      setBaseUrl(data.is_remote ? data.base_url ?? '' : '')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'โหลดค่าการเชื่อมต่อไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  const trimmedUrl = baseUrl.trim()
  const remoteMissing = mode === 'remote' && trimmedUrl === ''
  const previewUrl = mode === 'local' ? LOCAL_URL : trimmedUrl

  /**
   * ส่งค่าว่างเป็น "" เสมอ (ห้ามแปลงเป็น undefined)
   * และล้าง runpod_pod_id ทุกครั้ง กัน backend สร้าง URL เก่ากลับมา
   */
  const payload = () => ({
    mode,
    base_url: mode === 'remote' ? trimmedUrl : LOCAL_URL,
    runpod_pod_id: '',
  })

  const handleTest = async () => {
    if (remoteMissing) {
      toast.error('ยังไม่ได้ใส่ Base URL')
      return
    }

    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch(`${BACKEND_URL}/api/system/connection/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload()),
      })
      const data = (await res.json()) as TestResult
      setTestResult(data)
      if (data.ok) toast.success('เชื่อมต่อ ComfyUI สำเร็จ')
      else toast.error(data.error || 'เชื่อมต่อไม่สำเร็จ')
    } catch (err) {
      setTestResult({ ok: false, error: err instanceof Error ? err.message : 'ทดสอบไม่สำเร็จ' })
    } finally {
      setTesting(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await fetch(`${BACKEND_URL}/api/system/connection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload()),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const data = (await res.json()) as { connection: ConnectionSnapshot }
      setSnapshot(data.connection)
      setBaseUrl(data.connection.is_remote ? data.connection.base_url ?? '' : '')
      setTestResult(null)

      if (data.connection.is_remote && !data.connection.base_url) {
        toast.success('ล้าง Base URL แล้ว — ยังไม่ได้ตั้งค่า RunPod')
      } else {
        toast.success('บันทึกการเชื่อมต่อแล้ว — ใช้ได้ทันทีไม่ต้อง restart')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="shadow-lg">
      <CardHeader className="border-b border-border bg-card/60 backdrop-blur">
        <CardTitle className="flex items-center gap-3 text-xl">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <PlugZap className="h-5 w-5" />
          </span>
          การเชื่อมต่อ ComfyUI
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          เลือกว่าจะรันบนเครื่องนี้ (Local) หรือบน cloud (RunPod Pod) — สลับได้ทันที
        </p>
      </CardHeader>

      <CardContent className="grid gap-5 p-5">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> กำลังโหลด...
          </div>
        ) : (
          <>
            {/* Mode selector */}
            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setMode('local')}
                className={cn(
                  'flex items-start gap-3 rounded-xl border p-4 text-left transition-colors',
                  mode === 'local'
                    ? 'border-primary bg-primary/10'
                    : 'border-border bg-muted/20 hover:bg-muted/40'
                )}
              >
                <Monitor className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <span>
                  <span className="block text-sm font-semibold">Local</span>
                  <span className="block text-xs text-muted-foreground">
                    ComfyUI ในเครื่องนี้ (127.0.0.1:8188)
                  </span>
                </span>
              </button>

              <button
                type="button"
                onClick={() => setMode('remote')}
                className={cn(
                  'flex items-start gap-3 rounded-xl border p-4 text-left transition-colors',
                  mode === 'remote'
                    ? 'border-primary bg-primary/10'
                    : 'border-border bg-muted/20 hover:bg-muted/40'
                )}
              >
                <Cloud className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <span>
                  <span className="block text-sm font-semibold">RunPod Pod</span>
                  <span className="block text-xs text-muted-foreground">
                    ComfyUI บน cloud ผ่าน proxy URL
                  </span>
                </span>
              </button>
            </div>

            {/* Remote: Base URL ช่องเดียว */}
            {mode === 'remote' && (
              <div className="grid gap-3 rounded-xl border border-border bg-muted/20 p-4">
                <div className="grid gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <label htmlFor="base-url" className="text-sm font-medium">
                      Base URL
                    </label>
                    {baseUrl !== '' && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
                        onClick={() => setBaseUrl('')}
                      >
                        <X className="mr-1 h-3.5 w-3.5" />
                        ล้างช่อง
                      </Button>
                    )}
                  </div>

                  <Input
                    id="base-url"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder="https://xxxx-8188.proxy.runpod.net"
                    className="font-mono text-sm"
                  />

                  <p className="text-xs text-muted-foreground">
                    ก๊อป URL ของ ComfyUI จากหน้า RunPod Pod มาวางทั้งเส้น —
                    ลบให้ว่างแล้วกด Save เพื่อล้างค่าที่บันทึกไว้
                  </p>
                </div>

                {remoteMissing && (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      ยังไม่ได้ระบุ URL — Save ตอนนี้จะบันทึกเป็นค่าว่าง
                      และสร้างวิดีโอไม่ได้จนกว่าจะใส่ URL หรือสลับกลับ Local
                    </span>
                  </div>
                )}

                {snapshot?.has_auth_token && (
                  <p className="text-[11px] text-muted-foreground">
                    มี Auth Token เดิมบันทึกอยู่ใน backend/config.json —
                    หน้านี้ไม่ได้ใช้/แก้ token ถ้าต้องการล้างให้แก้ไฟล์นั้นโดยตรง
                  </p>
                )}
              </div>
            )}

            {/* Preview */}
            <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 font-mono text-xs text-muted-foreground">
              URL ที่จะใช้: {previewUrl || '(ยังไม่ได้ระบุ)'}
            </div>

            {/* Test result */}
            {testResult && (
              <div
                className={cn(
                  'rounded-lg border px-3 py-2 text-xs',
                  testResult.ok
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                    : 'border-destructive/30 bg-destructive/10 text-destructive'
                )}
              >
                {testResult.ok ? (
                  <>
                    เชื่อมต่อสำเร็จ
                    {testResult.gpu?.name ? ` — GPU: ${testResult.gpu.name}` : ''}
                    {testResult.gpu?.vram_total_mb
                      ? ` (${testResult.gpu.vram_total_mb} MB VRAM)`
                      : ''}
                  </>
                ) : (
                  <>เชื่อมต่อไม่สำเร็จ: {testResult.error}</>
                )}
              </div>
            )}

            {/* Actions */}
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => void handleTest()}
                disabled={testing || remoteMissing}
              >
                {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlugZap className="mr-2 h-4 w-4" />}
                Test connection
              </Button>
              <Button type="button" onClick={() => void handleSave()} disabled={saving}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Save
              </Button>
              {snapshot && (
                <span className="text-xs text-muted-foreground">
                  ปัจจุบัน: {snapshot.is_remote ? 'RunPod (remote)' : 'Local'}
                </span>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}