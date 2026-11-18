'use client'

/**
 * ========================================
 * ConnectionSettings
 * ========================================
 * เลือกโหมดการเชื่อมต่อ ComfyUI:
 * - Local  : ComfyUI ในเครื่อง (http://127.0.0.1:8188)
 * - RunPod : ComfyUI บน RunPod Pod ผ่าน proxy URL
 * พร้อมปุ่ม Test connection และ Save (บันทึกลง backend/config.json)
 */

import * as React from 'react'
import { Cloud, Loader2, Monitor, PlugZap, Save } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { BACKEND_URL } from '@/lib/backend'
import { cn } from '@/lib/utils'

type Mode = 'local' | 'remote'

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
  const [podId, setPodId] = React.useState('')
  const [baseUrl, setBaseUrl] = React.useState('')
  const [token, setToken] = React.useState('')
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
      setPodId(data.runpod_pod_id ?? '')
      setBaseUrl(data.base_url ?? '')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'โหลดค่าการเชื่อมต่อไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  const previewUrl =
    mode === 'local'
      ? 'http://127.0.0.1:8188'
      : baseUrl.trim() ||
        (podId.trim() ? `https://${podId.trim()}-8188.proxy.runpod.net` : '')

  const payload = () => ({
    mode,
    base_url: mode === 'remote' ? baseUrl.trim() || undefined : undefined,
    runpod_pod_id: mode === 'remote' ? podId.trim() || undefined : undefined,
    auth_token: token.trim() || undefined,
  })

  const handleTest = async () => {
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
      setToken('')
      toast.success('บันทึกการเชื่อมต่อแล้ว — ใช้ได้ทันทีไม่ต้อง restart')
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

            {/* Remote fields */}
            {mode === 'remote' && (
              <div className="grid gap-4 rounded-xl border border-border bg-muted/20 p-4">
                <div className="grid gap-2">
                  <label className="text-sm font-medium">RunPod Pod ID</label>
                  <Input
                    value={podId}
                    onChange={(e) => setPodId(e.target.value)}
                    placeholder="เช่น abc123def456"
                    className="font-mono text-sm"
                  />
                  <p className="text-xs text-muted-foreground">
                    ระบบจะสร้าง URL ให้อัตโนมัติ: https://&lt;pod-id&gt;-8188.proxy.runpod.net
                  </p>
                </div>

                <div className="grid gap-2">
                  <label className="text-sm font-medium">หรือใส่ Base URL เอง (ไม่บังคับ)</label>
                  <Input
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder="https://xxxx-8188.proxy.runpod.net"
                    className="font-mono text-sm"
                  />
                </div>

                <div className="grid gap-2">
                  <label className="text-sm font-medium">Auth Token (ไม่บังคับ)</label>
                  <Input
                    type="password"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="เว้นว่างถ้า proxy ไม่มีรหัสผ่าน"
                    className="font-mono text-sm"
                  />
                  <p className="text-xs text-muted-foreground">
                    {snapshot?.has_auth_token
                      ? 'มี token บันทึกไว้แล้ว — เว้นว่างเพื่อคงค่าเดิม'
                      : 'ยังไม่มี token'}
                  </p>
                </div>
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
              <Button type="button" variant="outline" onClick={() => void handleTest()} disabled={testing}>
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