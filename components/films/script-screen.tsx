'use client'

/**
 * ========================================
 * แตกฉากจากสคริปต์
 * ========================================
 * เรียกแบบ synchronous — อาจใช้เวลาหลายสิบวินาที
 * 503 {error} แปลว่า ComfyUI ไม่พร้อม
 * ฉากที่ได้เป็นร่าง จนกว่าผู้ใช้จะบันทึกลงเรื่อง
 */

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { AlertCircle, Loader2, Sparkles, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { FilmChrome, FilmError, FilmLoading, controlClass, FieldLabel } from '@/components/films/bits'
import { ReorderList } from '@/components/films/reorder-list'
import { useFilm } from '@/components/films/use-film'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { createScene, generateAll, generateScene, getFilm, scriptToScenes } from '@/lib/films-api'
import { FilmsApiError, filmsErrorMessage } from '@/lib/films-error'
import type { SceneMode, ScriptDraft } from '@/lib/films-types'
import { clampUiDuration, MAX_SCRIPT_SCENES, SCENE_MODES, sceneModeLabel } from '@/lib/films-types'

interface EditableDraft extends ScriptDraft {
  key: string
}

function draftKey(): string {
  return `draft_${Math.random().toString(36).slice(2, 10)}`
}

export function ScriptScreen({ filmId }: { filmId: string }) {
  const router = useRouter()
  const { film, loading, error, reload } = useFilm(filmId)
  const [scriptDraft, setScriptDraft] = React.useState<string | null>(null)
  const script = scriptDraft ?? film?.script ?? ''
  const [maxScenes, setMaxScenes] = React.useState('')
  const [language, setLanguage] = React.useState('th')
  const [drafts, setDrafts] = React.useState<EditableDraft[]>([])
  const [breaking, setBreaking] = React.useState(false)
  const [comfyError, setComfyError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState<string | null>(null)

  const breakScript = async () => {
    const trimmed = script.trim()
    if (!trimmed) {
      toast.error('วางเรื่องราวก่อนแตกฉาก')
      return
    }

    setBreaking(true)
    setComfyError(null)

    try {
      const parsedMax = Number(maxScenes)
      const max = Number.isFinite(parsedMax) && parsedMax > 0
        ? Math.min(MAX_SCRIPT_SCENES, Math.max(1, Math.round(parsedMax)))
        : undefined
      const result = await scriptToScenes(filmId, {
        script: trimmed,
        language,
        ...(max != null ? { max_scenes: max } : {}),
      })

      setDrafts(
        result.scenes.map((scene) => ({
          ...scene,
          key: draftKey(),
        }))
      )

      if (result.scenes.length === 0) toast.message('ไม่พบฉากจากสคริปต์นี้')
      else toast.success(`ได้ ${result.scenes.length} ฉากร่าง`)
    } catch (err: unknown) {
      if (err instanceof FilmsApiError && err.status === 503) {
        setComfyError(err.message)
        return
      }
      toast.error(filmsErrorMessage(err, 'แตกฉากไม่สำเร็จ'))
    } finally {
      setBreaking(false)
    }
  }

  const updateDraft = (key: string, patch: Partial<ScriptDraft>) => {
    setDrafts((current) => current.map((draft) => (draft.key === key ? { ...draft, ...patch } : draft)))
  }

  const saveDrafts = async (mode: 'keep' | 'all' | string) => {
    const selected =
      mode === 'keep' || mode === 'all'
        ? drafts
        : drafts.filter((draft) => draft.key === mode)

    if (selected.length === 0) {
      toast.error('ไม่มีฉากให้บันทึก')
      return
    }

    setSaving(mode)
    const savedKeys: string[] = []

    try {
      const createdIds: string[] = []

      for (const draft of selected) {
        setSaving(`save:${savedKeys.length + 1}/${selected.length}`)
        const scene = await createScene(filmId, {
          prompt: draft.prompt.trim() || 'ฉากใหม่',
          mode: draft.mode,
          duration_sec: clampUiDuration(draft.duration),
          chain_from_previous: true,
        })
        createdIds.push(scene.id)
        savedKeys.push(draft.key)
      }

      setDrafts((current) => current.filter((draft) => !savedKeys.includes(draft.key)))

      if (mode === 'all') {
        const fresh = await getFilm(filmId)
        await generateAll(
          filmId,
          (fresh.scenes ?? []).map((scene) => scene.id)
        )
        toast.success('บันทึกฉากแล้ว และเริ่มสร้างทั้งเรื่อง')
        router.push(`/shortfilm/${filmId}`)
        return
      }

      if (mode !== 'keep') {
        const sceneId = createdIds[0]
        if (sceneId) await generateScene(filmId, sceneId)
        toast.success('บันทึกและเริ่มสร้างฉากนี้')
        router.push(`/shortfilm/${filmId}`)
        return
      }

      toast.success(`เพิ่ม ${savedKeys.length} ฉากลงเรื่องแล้ว`)
    } catch (err: unknown) {
      if (savedKeys.length > 0) {
        setDrafts((current) => current.filter((draft) => !savedKeys.includes(draft.key)))
      }
      toast.error(filmsErrorMessage(err, 'บันทึกฉากไม่สำเร็จ'))
    } finally {
      setSaving(null)
    }
  }

  if (loading) return <FilmLoading label="กำลังเปิดเรื่อง..." />
  if (error || !film) {
    return <FilmError message={error ?? 'ไม่พบเรื่องนี้'} onRetry={() => void reload().catch(() => undefined)} />
  }

  return (
    <FilmChrome
      filmId={filmId}
      title={<h2 className="truncate font-heading text-xl font-semibold">{film.title}</h2>}
      meta={<p className="text-xs text-muted-foreground">แตกเรื่องเป็นฉากร่าง แล้วค่อยบันทึกลงเรื่อง</p>}
    >
      <Card className="shadow-sm">
        <CardHeader className="border-b border-border">
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            จากสคริปต์
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            วางเรื่องราวแล้วกดแตกฉาก การเรียกนี้รอคำตอบทีเดียว อาจใช้เวลาเป็นนาทีถ้า ComfyUI กำลังทำงาน
          </p>
        </CardHeader>
        <CardContent className="grid gap-3">
          <Textarea
            value={script}
            onChange={(event) => setScriptDraft(event.target.value)}
            rows={8}
            placeholder="วางเรื่องราวที่นี่..."
            className="min-h-40 text-base md:text-sm"
            aria-label="สคริปต์"
            disabled={breaking}
          />

          <div className="grid gap-3 sm:grid-cols-[8rem_10rem_1fr] sm:items-end">
            <label className="grid gap-1.5">
              <FieldLabel hint="ว่าง = 8">จำนวนฉากสูงสุด</FieldLabel>
              <Input
                inputMode="numeric"
                value={maxScenes}
                onChange={(event) => setMaxScenes(event.target.value)}
                placeholder="8"
                className="h-11 md:h-9"
                aria-label="จำนวนฉากสูงสุด"
              />
            </label>
            <label className="grid gap-1.5">
              <FieldLabel>ภาษา</FieldLabel>
              <select
                value={language}
                onChange={(event) => setLanguage(event.target.value)}
                className={controlClass}
                aria-label="ภาษา"
              >
                <option value="th">ไทย</option>
                <option value="en">English</option>
              </select>
            </label>
            <Button type="button" className="h-11" onClick={() => void breakScript()} disabled={breaking}>
              {breaking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              แตกเป็นฉาก
            </Button>
          </div>
        </CardContent>
      </Card>

      {breaking ? (
        <div
          role="status"
          aria-live="polite"
          className="grid justify-items-center gap-2 rounded-xl border border-border bg-card px-4 py-8 text-center"
        >
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <p className="font-medium">กำลังแตกฉากจากสคริปต์</p>
            <p className="max-w-md text-sm text-muted-foreground">
              ขั้นตอนนี้รอโมเดลตอบกลับทีเดียว อาจใช้เวลาหลายนาที อย่าปิดหน้านี้
            </p>
        </div>
      ) : null}

      {comfyError ? (
        <div role="alert" className="grid gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
          <p className="flex items-center gap-2 font-medium text-amber-800 dark:text-amber-200">
            <AlertCircle className="h-4 w-4" />
            ComfyUI ไม่พร้อม
          </p>
          <p>{comfyError}</p>
          <Button type="button" variant="outline" className="h-11 w-fit" onClick={() => void breakScript()}>
            ลองอีกครั้ง
          </Button>
        </div>
      ) : null}

      {drafts.length > 0 ? (
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-medium">ฉากร่าง {drafts.length} ฉาก</h3>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-11"
                disabled={saving != null}
                onClick={() => void saveDrafts('keep')}
              >
                เพิ่มลงเรื่อง
              </Button>
              <Button
                type="button"
                className="h-11"
                disabled={saving != null}
                onClick={() => void saveDrafts('all')}
              >
                {saving === 'all' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                เพิ่มแล้วสร้างทั้งเรื่อง
              </Button>
            </div>
          </div>

          {saving && saving.startsWith('save:') ? (
            <p className="text-xs text-muted-foreground">กำลังบันทึกฉาก {saving.slice(5)}</p>
          ) : null}

          <ReorderList
            items={drafts}
            getId={(draft) => draft.key}
            onReorder={setDrafts}
            renderItem={(draft, index, handle) => (
              <Card className="shadow-sm">
                <CardContent className="grid gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {handle}
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 font-mono text-xs font-bold text-primary">
                      {index + 1}
                    </span>
                    <span className="text-sm font-medium">ร่าง {index + 1}</span>
                    <div className="ml-auto flex flex-wrap gap-1">
                      <Button
                        type="button"
                        className="h-11"
                        disabled={saving != null}
                        onClick={() => void saveDrafts(draft.key)}
                      >
                        สร้างฉากนี้
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="h-11 w-11"
                        aria-label="เอาร่างนี้ออก"
                        onClick={() => setDrafts((current) => current.filter((item) => item.key !== draft.key))}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  <Textarea
                    value={draft.prompt}
                    onChange={(event) => updateDraft(draft.key, { prompt: event.target.value })}
                    rows={3}
                    aria-label={`พรอมป์ร่าง ${index + 1}`}
                    className="min-h-20 text-base md:text-sm"
                  />

                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="grid gap-1.5">
                      <FieldLabel hint="Mode">โหมด</FieldLabel>
                      <select
                        value={draft.mode}
                        onChange={(event) => updateDraft(draft.key, { mode: event.target.value as SceneMode })}
                        className={controlClass}
                        aria-label={`โหมดร่าง ${index + 1}`}
                      >
                        {SCENE_MODES.map((mode) => (
                          <option key={mode} value={mode}>
                            {sceneModeLabel(mode)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="grid gap-1.5">
                      <FieldLabel hint="sec">ความยาว</FieldLabel>
                      <Input
                        inputMode="decimal"
                        min={5}
                        max={15}
                        value={String(draft.duration)}
                        onChange={(event) => {
                          const parsed = Number(event.target.value)
                          if (Number.isFinite(parsed)) updateDraft(draft.key, { duration: parsed })
                        }}
                        onBlur={() => updateDraft(draft.key, { duration: clampUiDuration(draft.duration) })}
                        className="h-11 md:h-9"
                        aria-label={`ความยาวร่าง ${index + 1}`}
                      />
                    </label>
                  </div>
                </CardContent>
              </Card>
            )}
          />
        </div>
      ) : null}
    </FilmChrome>
  )
}
